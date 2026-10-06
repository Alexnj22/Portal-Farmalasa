-- App de clientes: referidos, avisos al teléfono y cumpleaños (2026-10-06).
--
-- ── Referidos ───────────────────────────────────────────────────────────────
-- Decisión del usuario (2026-10-06): 50 puntos para quien invita y 50 para el
-- invitado, cuando el invitado hace su PRIMERA compra de $10 o más. Tope de 10
-- premios por persona al mes, para que no sea una fábrica de puntos.
--
-- El código de invitación es OTRO, no el de 7 letras de la tarjeta: ése sirve
-- para ENTRAR a la cuenta, y compartirlo por WhatsApp sería regalar el acceso.
--
-- Sólo cuenta un cliente NUEVO: si el invitado ya tenía una venta válida antes
-- de anotarse, se rechaza («ya era cliente»). Sin eso, cualquiera «invitaría»
-- a su familia que ya compra y cobraría 50 puntos por persona.
--
-- ── Avisos ──────────────────────────────────────────────────────────────────
-- `app_cliente_avisos` es la bitácora de lo que se le mandó a cada teléfono, y
-- su UNIQUE (customer_id, tipo, ref) es lo que impide mandar dos veces el mismo
-- aviso: la función que los envía corre cada 15 minutos. Retención: 180 días.
SET lock_timeout = '5s';

-- El origen nuevo del lote. NOT VALID + VALIDATE: la validación no toma el
-- candado fuerte (la tabla la escribe el motor de puntos cada minuto).
ALTER TABLE public.puntos_lote DROP CONSTRAINT puntos_lote_origen_check;
ALTER TABLE public.puntos_lote ADD CONSTRAINT puntos_lote_origen_check
  CHECK (origen = ANY (ARRAY['venta', 'ajuste', 'migracion', 'cumpleanos', 'venta_pasada', 'referido'])) NOT VALID;
ALTER TABLE public.puntos_lote VALIDATE CONSTRAINT puntos_lote_origen_check;

-- La muestra de cumpleaños (para ver la tarjeta sin esperar al día).
ALTER TABLE public.app_cliente_muestras DROP CONSTRAINT app_cliente_muestras_tipo_check;
ALTER TABLE public.app_cliente_muestras ADD CONSTRAINT app_cliente_muestras_tipo_check
  CHECK (tipo IN ('oferta', 'inyeccion', 'vencimiento', 'cumpleanos'));

CREATE TABLE public.app_cliente_referido_codigo (
    customer_id  bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
    codigo       text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9]{6}$'),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.app_cliente_referidos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    referidor_id    bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    preregistro_id  uuid UNIQUE REFERENCES public.app_cliente_preregistros(id) ON DELETE SET NULL,
    invitado_id     bigint REFERENCES public.customers(id) ON DELETE SET NULL,
    codigo          text NOT NULL,
    estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'premiado', 'vencido', 'rechazado')),
    motivo          text,
    invoice_id      bigint,
    premiado_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_cliente_referidos_referidor_idx ON public.app_cliente_referidos (referidor_id, estado);
CREATE UNIQUE INDEX app_cliente_referidos_invitado_uniq ON public.app_cliente_referidos (invitado_id) WHERE invitado_id IS NOT NULL;

CREATE TABLE public.app_cliente_avisos (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    tipo         text NOT NULL,
    ref          text NOT NULL,
    titulo       text NOT NULL,
    cuerpo       text NOT NULL,
    enviado      boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (customer_id, tipo, ref)
);
CREATE INDEX app_cliente_avisos_created_idx ON public.app_cliente_avisos (created_at);

-- RLS: las tres las escribe y lee sólo `app-clientes` / `avisos-clientes` con
-- la llave del servidor. El portal ve los referidos (es información de
-- clientes), el resto no.
ALTER TABLE public.app_cliente_referido_codigo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_cliente_referidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_cliente_avisos ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_referido_codigo_select ON public.app_cliente_referido_codigo
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
CREATE POLICY app_cliente_referidos_select ON public.app_cliente_referidos
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
CREATE POLICY app_cliente_avisos_select ON public.app_cliente_avisos
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
REVOKE ALL ON public.app_cliente_referido_codigo, public.app_cliente_referidos, public.app_cliente_avisos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_cliente_referido_codigo, public.app_cliente_referidos, public.app_cliente_avisos TO authenticated;
GRANT ALL ON public.app_cliente_referido_codigo, public.app_cliente_referidos, public.app_cliente_avisos TO service_role;

-- El movimiento «referido» en el estado de cuenta (antes caía en «compra»).
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
                        WHEN origen = 'referido' THEN 'referido'
                        WHEN origen = 'cumpleanos' OR motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                        ELSE 'compra' END::text AS tipo,
               ganado_el AS fecha, sucursal, puntos,
               CASE WHEN origen = 'venta' THEN NULL ELSE motivo END AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT s.id, s.tipo,
               CASE WHEN s.tipo = 'canje' AND si.fecha IS NOT NULL THEN si.fecha
                    ELSE (s.created_at AT TIME ZONE 'America/El_Salvador')::date END,
               s.sucursal, -s.puntos, s.motivo
          FROM public.puntos_salida s
          LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
         WHERE s.customer_id = p_customer_id
        UNION ALL
        SELECT id, 'canje_devuelto', (revertida_at AT TIME ZONE 'America/El_Salvador')::date, sucursal, puntos,
               'la factura del canje se anuló'
          FROM public.puntos_salida
         WHERE customer_id = p_customer_id AND tipo = 'canje' AND revertida_at IS NOT NULL
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$function$;

-- Premiar los referidos que ya cumplieron. Corre cada hora; idempotente (sólo
-- toca los `pendiente`, y premiar los pasa a `premiado` en la misma vuelta).
CREATE OR REPLACE FUNCTION public.puntos_premiar_referidos(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  c_pts      constant integer := 50;
  c_minimo   constant numeric := 10;
  c_tope_mes constant integer := 10;
  c_dias     constant integer := 120;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  r record; f record;
  v_premiados int := 0; v_rechazados int := 0; v_vencidos int := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa todavía no funciona en el portal');
  END IF;

  -- 1. El invitado se registró desde la app: su ficha sale del pre-registro.
  IF NOT p_simular THEN
    UPDATE public.app_cliente_referidos rf
       SET invitado_id = p.customer_id
      FROM public.app_cliente_preregistros p
     WHERE rf.estado = 'pendiente' AND rf.invitado_id IS NULL
       AND p.id = rf.preregistro_id AND p.customer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.app_cliente_referidos o WHERE o.invitado_id = p.customer_id);
  END IF;

  FOR r IN
    SELECT * FROM public.app_cliente_referidos WHERE estado = 'pendiente' ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    -- Se le pasó el plazo sin comprar.
    IF r.created_at < now() - make_interval(days => c_dias) THEN
      v_vencidos := v_vencidos + 1;
      IF NOT p_simular THEN
        UPDATE public.app_cliente_referidos SET estado = 'vencido', motivo = 'sin compra en ' || c_dias || ' días' WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;
    CONTINUE WHEN r.invitado_id IS NULL;

    -- Ya era cliente: una venta válida ANTES de anotarse.
    IF EXISTS (SELECT 1 FROM public.sales_invoices si
                WHERE si.customer_id = r.invitado_id AND public.venta_valida(si.estado)
                  AND si.fecha < (r.created_at AT TIME ZONE 'America/El_Salvador')::date)
       OR r.invitado_id = r.referidor_id THEN
      v_rechazados := v_rechazados + 1;
      IF NOT p_simular THEN
        UPDATE public.app_cliente_referidos SET estado = 'rechazado',
               motivo = CASE WHEN r.invitado_id = r.referidor_id THEN 'se invitó a sí mismo' ELSE 'ya era cliente' END
         WHERE id = r.id;
      END IF;
      CONTINUE;
    END IF;

    -- Su primera compra de $10 o más desde que se anotó.
    SELECT si.id, si.fecha INTO f
      FROM public.sales_invoices si
     WHERE si.customer_id = r.invitado_id AND public.venta_valida(si.estado)
       AND si.fecha >= (r.created_at AT TIME ZONE 'America/El_Salvador')::date
       AND si.total >= c_minimo
     ORDER BY si.fecha, si.id LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    -- Tope del mes para quien invita: el invitado igual recibe lo suyo.
    v_premiados := v_premiados + 1;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.invitado_id), (r.referidor_id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.invitado_id, 'referido', c_pts, c_pts, v_hoy, public.puntos_vence_el(v_hoy), 'Bienvenida por invitación');
    UPDATE public.puntos_cuenta SET saldo = saldo + c_pts, ganados = ganados + c_pts, updated_at = now()
     WHERE customer_id = r.invitado_id;

    IF (SELECT count(*) FROM public.app_cliente_referidos
         WHERE referidor_id = r.referidor_id AND estado = 'premiado' AND motivo IS NULL
           AND premiado_at >= date_trunc('month', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador') < c_tope_mes
       AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = r.referidor_id
                     AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false) THEN
      INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
      VALUES (r.referidor_id, 'referido', c_pts, c_pts, v_hoy, public.puntos_vence_el(v_hoy), 'Invitaste a un amigo');
      UPDATE public.puntos_cuenta SET saldo = saldo + c_pts, ganados = ganados + c_pts, updated_at = now()
       WHERE customer_id = r.referidor_id;
      UPDATE public.app_cliente_referidos SET estado = 'premiado', premiado_at = now(), invoice_id = f.id WHERE id = r.id;
    ELSE
      UPDATE public.app_cliente_referidos SET estado = 'premiado', premiado_at = now(), invoice_id = f.id,
             motivo = 'quien invita llegó al tope del mes o no está en el programa' WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'premiados', v_premiados, 'rechazados', v_rechazados, 'vencidos', v_vencidos);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_premiar_referidos(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_premiar_referidos(boolean) TO service_role;

-- Cada hora, a los 20. Y la purga de la bitácora de avisos.
SELECT cron.schedule('puntos-referidos-hora', '20 * * * *', $$SELECT public.puntos_premiar_referidos()$$);
SELECT cron.schedule('purge-app-cliente-avisos', '40 9 * * *',
  $$DELETE FROM public.app_cliente_avisos WHERE created_at < now() - interval '180 days'$$);
