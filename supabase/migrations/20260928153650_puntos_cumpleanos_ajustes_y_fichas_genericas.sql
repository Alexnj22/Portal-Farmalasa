SET lock_timeout = '5s';

-- ═══ Puntos: lo que faltaba para el 1-oct (decisiones del usuario, 2026-09-28) ═
-- La revisión previa al arranque encontró tres cosas que el sistema anterior
-- hacía y el portal no, o que el portal haría de más:
--
--   1. Acumula «toda ficha con nombre» (decisión del usuario). Pero CUATRO fichas
--      son genéricas —se factura ahí a quien no da su nombre— y se llevaban
--      ~24,000 puntos al mes que no son de nadie. Dejan de acumular, igual que
--      MAPFRE. Ningún canje del último mes se hizo sobre ellas.
--   2. Una persona regalaba 50 puntos por cumpleaños a mano (4,600 veces desde
--      2023). Desde el arranque los da el portal SOLO, el día del cumpleaños, a
--      toda ficha con fecha de nacimiento: «de igual forma los puntos vencen, si
--      no compra se van a vencer».
--   3. No había forma de dar ni quitar puntos a mano. Ahora sí, con permiso
--      propio (`puntos_ajustar`) y motivo obligatorio.
--
-- Además: el vencimiento queda programado desde ya (vence lo primero el
-- 1-oct-2027; un cron que nadie pone a tiempo es un vencimiento que no ocurre).

-- ── 1 · Las fichas genéricas no acumulan ──────────────────────────────────
-- Por id y verificando el nombre: si alguna vez se renombra una, esto no pisa
-- una ficha de persona.
UPDATE public.customers SET acumula_puntos = false
 WHERE (id, name) IN ((3299, 'CLIENTES VARIOS'), (22085, 'CLIENTE FRECUENTE'),
                      (11639, 'CLIENTE FRECUENTE NUEVO'), (9513, 'CLIENTE VIP (FRECUENTE)'))
   AND acumula_puntos IS DISTINCT FROM false;

-- ── 2 · El lote de cumpleaños ─────────────────────────────────────────────
ALTER TABLE public.puntos_lote DROP CONSTRAINT puntos_lote_origen_check;
ALTER TABLE public.puntos_lote ADD CONSTRAINT puntos_lote_origen_check
  CHECK (origen = ANY (ARRAY['venta', 'ajuste', 'migracion', 'cumpleanos']));

-- Uno por cliente y por año, garantizado por la tabla y no por la función.
CREATE UNIQUE INDEX IF NOT EXISTS puntos_lote_un_cumpleanos_por_anio
  ON public.puntos_lote (customer_id, (date_part('year', ganado_el)))
  WHERE origen = 'cumpleanos';

-- Cuántos se regalan es una fila, no una constante (mismo criterio que el mínimo).
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS puntos_cumpleanos integer NOT NULL DEFAULT 50
  CHECK (puntos_cumpleanos >= 0);

CREATE OR REPLACE FUNCTION public.puntos_dar_cumpleanos(
  p_dia date DEFAULT NULL, p_simular boolean DEFAULT false
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_pts integer;
  v_bisiesto boolean;
  r record; v_n integer := 0;
BEGIN
  -- Antes del arranque los regala el sistema anterior: dos a la vez daría dos.
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT puntos_cumpleanos INTO v_pts FROM public.puntos_config WHERE id;
  IF coalesce(v_pts, 0) <= 0 THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'puntos_cumpleanos en 0');
  END IF;
  v_bisiesto := (date_part('year', v_dia)::int % 4 = 0 AND date_part('year', v_dia)::int % 100 <> 0)
                OR date_part('year', v_dia)::int % 400 = 0;

  FOR r IN
    SELECT c.id
      FROM public.customers c
     WHERE c.fecha_nacimiento IS NOT NULL
       AND coalesce(c.acumula_puntos, true)
       AND (to_char(c.fecha_nacimiento, 'MM-DD') = to_char(v_dia, 'MM-DD')
            -- El 29 de febrero, en un año que no lo tiene, cumple el 28.
            OR (NOT v_bisiesto AND to_char(v_dia, 'MM-DD') = '02-28'
                AND to_char(c.fecha_nacimiento, 'MM-DD') = '02-29'))
       -- Ya regalado este año (por el portal).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.origen = 'cumpleanos'
                          AND date_part('year', l.ganado_el) = date_part('year', v_dia))
       -- Ya regalado a mano en el sistema anterior en los últimos dos meses: la
       -- persona que los daba lo hacía en el mes del cumpleaños, a veces antes.
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.motivo ILIKE 'cortes%cumple%'
                          AND l.ganado_el >= v_dia - 60)
  LOOP
    v_n := v_n + 1;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cumpleanos', v_pts, v_pts, v_dia, public.puntos_vence_el(v_dia), 'Cortesía Cumpleaños');
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_n * v_pts);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_dar_cumpleanos(date, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_dar_cumpleanos(date, boolean) TO service_role;

-- ── 3 · Dar y quitar a mano, con permiso ──────────────────────────────────
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'puntos_ajustar', true, false, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;

CREATE OR REPLACE FUNCTION public.puntos_ajustar(
  p_customer_id bigint, p_puntos integer, p_motivo text, p_nota text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_quien uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_texto text;
  v_saldo integer;
  v_salida bigint;
  v_tomados integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para dar ni quitar puntos.' USING ERRCODE = '42501';
  END IF;
  -- Antes del arranque el saldo lo manda el sistema anterior y el cuadre de cada
  -- noche lo pisaría: un ajuste hecho acá se perdería sin avisar.
  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'Los ajustes se habilitan el 1 de octubre, cuando el programa pasa al portal.';
  END IF;
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Falta el motivo.'; END IF;
  IF p_puntos IS NULL OR p_puntos = 0 OR abs(p_puntos) > 100000 THEN
    RAISE EXCEPTION 'La cantidad tiene que ser distinta de cero y de hasta 100,000 puntos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'No existe el cliente %.', p_customer_id;
  END IF;
  v_texto := v_motivo || coalesce(' · ' || nullif(btrim(p_nota), ''), '');

  INSERT INTO public.puntos_cuenta (customer_id) VALUES (p_customer_id) ON CONFLICT (customer_id) DO NOTHING;
  -- Fila tomada: dos ajustes a la vez sobre la misma persona se ponen en fila.
  SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = p_customer_id FOR UPDATE;

  IF p_puntos > 0 THEN
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo, creado_por)
    VALUES (p_customer_id, 'ajuste', p_puntos, p_puntos,
            (now() AT TIME ZONE 'America/El_Salvador')::date,
            public.puntos_vence_el((now() AT TIME ZONE 'America/El_Salvador')::date), v_texto, v_quien);
    UPDATE public.puntos_cuenta
       SET saldo = saldo + p_puntos, ganados = ganados + p_puntos, updated_at = now()
     WHERE customer_id = p_customer_id;
  ELSE
    -- Nunca deja la cuenta debiendo: quitar más de lo que tiene se rechaza, no
    -- se recorta en silencio.
    IF -p_puntos > v_saldo THEN
      RAISE EXCEPTION 'El cliente tiene % puntos; no se le pueden quitar %.', v_saldo, -p_puntos;
    END IF;
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, motivo, autorizado_por)
    VALUES (p_customer_id, 'ajuste', -p_puntos, v_texto, v_quien)
    RETURNING id INTO v_salida;
    v_tomados := public.puntos_consumir(p_customer_id, -p_puntos, v_salida);
    IF v_tomados <> -p_puntos THEN
      RAISE EXCEPTION 'El libro no cuadra: se pidieron % y había % en lotes.', -p_puntos, v_tomados;
    END IF;
    UPDATE public.puntos_cuenta
       SET saldo = saldo + p_puntos, usados = usados - p_puntos, updated_at = now()
     WHERE customer_id = p_customer_id;
  END IF;

  SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = p_customer_id;
  RETURN json_build_object('ok', true, 'puntos', p_puntos, 'saldo', v_saldo);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_ajustar(bigint, integer, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_ajustar(bigint, integer, text, text) TO authenticated, service_role;

-- ── 4 · El estado de cuenta nombra el cumpleaños ──────────────────────────
-- Reescrita desde la definición VIVA. Único cambio: el tipo `cumpleanos`, para
-- que ni el portal ni «Mis puntos» lo pinten como una compra — también el de
-- los 4,600 migrados, que llegan con el motivo del sistema anterior.
CREATE OR REPLACE FUNCTION public.puntos_estado_cuenta(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  SELECT json_build_object(
    'customer_id', p_customer_id,
    'saldo',   coalesce((SELECT saldo   FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'ganados', coalesce((SELECT ganados FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'usados',  coalesce((SELECT usados  FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'vencimientos', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.vence_el)
      FROM (SELECT vence_el, sum(restantes)::int AS puntos
              FROM public.puntos_lote
             WHERE customer_id = p_customer_id AND restantes > 0
             GROUP BY vence_el) x), '[]'::json),
    'movimientos', coalesce((
      SELECT json_agg(to_json(m) ORDER BY m.fecha DESC, m.id DESC)
      FROM (
        SELECT id, CASE WHEN origen = 'ajuste' THEN 'ajuste'
                        WHEN origen = 'cumpleanos' OR motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                        ELSE 'compra' END::text AS tipo,
               ganado_el AS fecha, sucursal, puntos,
               CASE WHEN origen = 'venta' THEN NULL ELSE motivo END AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT id, tipo, created_at::date, sucursal, -puntos, motivo
          FROM public.puntos_salida WHERE customer_id = p_customer_id
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$function$;

-- ── 5 · Los crons ─────────────────────────────────────────────────────────
-- Guarda «sólo si existe» (regla del branch de pruebas). Los dos son SQL puro
-- y los dos no hacen nada mientras el programa siga en el sistema anterior.
SELECT cron.unschedule('puntos-cumpleanos-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-cumpleanos-diario');
SELECT cron.schedule('puntos-cumpleanos-diario', '10 12 * * *',
  $c$SELECT public.puntos_dar_cumpleanos()$c$);

SELECT cron.unschedule('puntos-vencer-diario')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-vencer-diario');
SELECT cron.schedule('puntos-vencer-diario', '5 12 * * *',
  $c$SELECT public.puntos_vencer_lotes((now() AT TIME ZONE 'America/El_Salvador')::date, false)
      WHERE public.puntos_fuente() = 'portal'$c$);
