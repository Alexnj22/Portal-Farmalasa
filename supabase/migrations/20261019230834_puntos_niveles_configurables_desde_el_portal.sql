SET lock_timeout = '5s';

-- ═══ Puntos: niveles, raspable y beneficios configurables desde el portal ═══
-- Decisión del dueño (2026-10-19, auditoría de niveles): todo lo que el
-- programa promete por nivel se cambia desde el portal —sin migración— y cada
-- cambio queda escrito con quién, cuándo, antes y después:
--   · umbral, factor, cumpleaños y horas de retiro de reserva por nivel;
--   · días de anticipo para ver las ofertas (hasta hoy Platino = 2, escrito
--     en el código de `app-clientes` y `avisos-clientes`);
--   · los premios del RASPABLE del penúltimo y del último nivel (tabla con
--     probabilidades), cambiables cada mes;
--   · el tope mensual de puntos del raspable (vacío = sin tope);
--   · el cumpleaños y el raspable del Cliente Mayorista por RANGO (Condiciones
--     del Cliente Mayorista §5), detrás de su propio interruptor, APAGADO.
--
-- Ninguna de estas tablas es caliente (4 filas, 1 fila, 4 filas): el DDL entra
-- con el lock_timeout de siempre y nada que sincronice cada minuto las toca.

-- ── Los niveles ya no se escriben directo ───────────────────────────────────
-- Tenían UPDATE abierto a `puntos.can_edit` sin rastro. Desde hoy se cambian
-- sólo por `puntos_nivel_guardar`, que valida la escalera y anota el
-- historial (nadie en el código escribía directo: verificado con grep).
DROP POLICY IF EXISTS puntos_niveles_update ON public.puntos_niveles;

-- ── Columnas nuevas ─────────────────────────────────────────────────────────
ALTER TABLE public.puntos_niveles
  ADD COLUMN IF NOT EXISTS dias_anticipo_ofertas integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'puntos_niveles_anticipo_rango') THEN
    ALTER TABLE public.puntos_niveles ADD CONSTRAINT puntos_niveles_anticipo_rango
      CHECK (dias_anticipo_ofertas BETWEEN 0 AND 14);
  END IF;
END $$;
-- Lo que ya hacía el código: Platino ve las ofertas 2 días antes.
UPDATE public.puntos_niveles SET dias_anticipo_ofertas = 2 WHERE clave = 'platino' AND dias_anticipo_ofertas = 0;

-- El interruptor del mayoreo: apagado. Encenderlo es una decisión del dueño,
-- igual que `niveles_activos`.
ALTER TABLE public.puntos_config
  ADD COLUMN IF NOT EXISTS mayoreo_beneficios_activos boolean NOT NULL DEFAULT false;

-- El tope del raspable vacío = sin tope (decisión del dueño). La columna era
-- NOT NULL: se suelta, y `puntos_dar_cupones` lee el NULL como «sin tope».
ALTER TABLE public.puntos_config ALTER COLUMN cupon_presupuesto_mensual DROP NOT NULL;

-- ── Cumpleaños y raspable del Cliente Mayorista, por rango ──────────────────
-- El rango lo decide `mayorista_rango` (frente de MAYOREO); acá sólo vive lo
-- que cada rango recibe de este programa. Los valores iniciales son los de las
-- Condiciones §5: cumpleaños 50/75/100/100; raspable Rubí = el de Oro y
-- Diamante = el de Platino (se copian los premios de hoy de esos niveles; desde
-- acá se editan por separado).
CREATE TABLE IF NOT EXISTS public.puntos_mayoreo_beneficios (
  clave              text PRIMARY KEY CHECK (clave IN ('jade', 'zafiro', 'rubi', 'diamante')),
  nombre             text NOT NULL,
  orden              integer NOT NULL,
  puntos_cumpleanos  integer NOT NULL DEFAULT 0 CHECK (puntos_cumpleanos BETWEEN 0 AND 5000),
  cupon_mensual      integer NOT NULL DEFAULT 0 CHECK (cupon_mensual BETWEEN 0 AND 10000),
  cupon_premios      jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.puntos_mayoreo_beneficios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_mayoreo_beneficios_select ON public.puntos_mayoreo_beneficios;
CREATE POLICY puntos_mayoreo_beneficios_select ON public.puntos_mayoreo_beneficios
  FOR SELECT TO authenticated USING (true);
-- Sin policy de escritura: se escribe sólo por `puntos_mayoreo_guardar`
-- (DEFINER), que anota el historial. Un UPDATE directo devolvería 0 filas.

INSERT INTO public.puntos_mayoreo_beneficios (clave, nombre, orden, puntos_cumpleanos, cupon_mensual, cupon_premios)
SELECT v.clave, v.nombre, v.orden, v.cumple,
       coalesce((SELECT n.cupon_mensual FROM public.puntos_niveles n WHERE n.clave = v.como), 0),
       (SELECT n.cupon_premios FROM public.puntos_niveles n WHERE n.clave = v.como)
  FROM (VALUES ('jade', 'Jade', 0, 50, NULL), ('zafiro', 'Zafiro', 1, 75, NULL),
               ('rubi', 'Rubí', 2, 100, 'oro'), ('diamante', 'Diamante', 3, 100, 'platino')) v(clave, nombre, orden, cumple, como)
ON CONFLICT (clave) DO NOTHING;

-- ── Historial de cambios ────────────────────────────────────────────────────
-- Historial de negocio: NO se purga (regla 7). Append-only: sin policy de
-- escritura ni de borrado; lo escriben sólo las funciones de abajo.
CREATE TABLE IF NOT EXISTS public.puntos_config_historial (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  employee_id  uuid,
  tabla        text NOT NULL CHECK (tabla IN ('config', 'nivel', 'mayoreo')),
  clave        text,
  antes        jsonb,
  despues      jsonb,
  nota         text
);
CREATE INDEX IF NOT EXISTS puntos_config_historial_created_idx ON public.puntos_config_historial (created_at DESC);
ALTER TABLE public.puntos_config_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_config_historial_select ON public.puntos_config_historial;
CREATE POLICY puntos_config_historial_select ON public.puntos_config_historial
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_niveles', 'can_view')));

-- ── Permiso de la pestaña «Niveles» de la vista Puntos ─────────────────────
-- Ver y editar: los cuatro cargos de administración (y la cuenta de QA).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'puntos_tab_niveles', true, true, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'Jefe/a de Talento Humano', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, can_edit = true;

-- ── Validación de una tabla de premios ──────────────────────────────────────
-- Sólo PUNTOS: el motor (`puntos_dar_cupones` → `puntos_lote`) no sabe dar un
-- descuento, y la app sólo lo pintaba en el modo de prueba. Ofrecerlo en el
-- portal sería prometer algo que la caja no cobra (2026-10-19). Si algún día
-- se quiere, primero el motor y el canje, después esta lista.
CREATE OR REPLACE FUNCTION public.puntos_premios_validos(p_premios jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE e jsonb;
BEGIN
  IF p_premios IS NULL OR p_premios = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_premios) <> 'array' THEN RETURN 'Los premios tienen que ser una lista.'; END IF;
  IF jsonb_array_length(p_premios) = 0 THEN RETURN NULL; END IF;
  IF jsonb_array_length(p_premios) > 12 THEN RETURN 'Como máximo 12 premios.'; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_premios) x LOOP
    IF jsonb_typeof(e) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(e) k WHERE k NOT IN ('puntos', 'peso')) > 0 THEN
      RETURN 'Cada premio lleva sólo puntos y probabilidad.';
    END IF;
    IF jsonb_typeof(e->'puntos') <> 'number' OR (e->>'puntos')::numeric <> floor((e->>'puntos')::numeric)
       OR (e->>'puntos')::numeric < 1 OR (e->>'puntos')::numeric > 10000 THEN
      RETURN 'Los puntos de un premio van de 1 a 10,000, sin decimales.';
    END IF;
    IF jsonb_typeof(e->'peso') <> 'number' OR (e->>'peso')::numeric <= 0 OR (e->>'peso')::numeric > 100 THEN
      RETURN 'La probabilidad de cada premio va de más de 0 a 100.';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_premios_validos(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_premios_validos(jsonb) TO authenticated, service_role;

-- ── Guardar un nivel ────────────────────────────────────────────────────────
-- `p_cambios` lleva sólo lo que cambia. El raspable (cupon_*) sólo en los dos
-- niveles más altos: es lo que decidió el dueño (penúltimo y último).
CREATE OR REPLACE FUNCTION public.puntos_nivel_guardar(p_clave text, p_cambios jsonb, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_antes public.puntos_niveles; v_nuevo public.puntos_niveles;
  v_clave text; v_err text; v_orden_max integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['puntos_tab_niveles'])) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar los niveles del programa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_antes FROM public.puntos_niveles WHERE clave = p_clave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese nivel no existe.'; END IF;
  FOR v_clave IN SELECT jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) LOOP
    IF v_clave NOT IN ('nombre', 'desde', 'factor', 'puntos_cumpleanos', 'horas_reserva',
                       'cupon_mensual', 'cupon_premios', 'dias_anticipo_ofertas') THEN
      RAISE EXCEPTION 'No se puede cambiar «%» desde aquí.', v_clave;
    END IF;
  END LOOP;

  v_nuevo := v_antes;
  IF p_cambios ? 'nombre' THEN v_nuevo.nombre := nullif(btrim(p_cambios->>'nombre'), ''); END IF;
  IF p_cambios ? 'desde' THEN v_nuevo.desde := (p_cambios->>'desde')::numeric; END IF;
  IF p_cambios ? 'factor' THEN v_nuevo.factor := (p_cambios->>'factor')::numeric; END IF;
  IF p_cambios ? 'puntos_cumpleanos' THEN v_nuevo.puntos_cumpleanos := (p_cambios->>'puntos_cumpleanos')::integer; END IF;
  IF p_cambios ? 'horas_reserva' THEN v_nuevo.horas_reserva := (p_cambios->>'horas_reserva')::integer; END IF;
  IF p_cambios ? 'dias_anticipo_ofertas' THEN v_nuevo.dias_anticipo_ofertas := (p_cambios->>'dias_anticipo_ofertas')::integer; END IF;
  IF p_cambios ? 'cupon_mensual' THEN v_nuevo.cupon_mensual := coalesce((p_cambios->>'cupon_mensual')::integer, 0); END IF;
  IF p_cambios ? 'cupon_premios' THEN
    v_nuevo.cupon_premios := CASE WHEN jsonb_typeof(p_cambios->'cupon_premios') = 'array'
                                   AND jsonb_array_length(p_cambios->'cupon_premios') > 0
                                  THEN p_cambios->'cupon_premios' END;
  END IF;

  IF v_nuevo.nombre IS NULL OR length(v_nuevo.nombre) > 30 THEN RAISE EXCEPTION 'El nombre va de 1 a 30 letras.'; END IF;
  IF v_nuevo.desde IS NULL OR v_nuevo.desde < 0 THEN RAISE EXCEPTION 'El monto para llegar al nivel no puede ser negativo.'; END IF;
  -- El primer nivel es el de entrada: desde $0, siempre.
  IF v_antes.orden = (SELECT min(orden) FROM public.puntos_niveles) AND v_nuevo.desde <> 0 THEN
    RAISE EXCEPTION 'El nivel de entrada empieza en $0.';
  END IF;
  -- Escalera: cada nivel pide más que el anterior y menos que el siguiente.
  IF EXISTS (SELECT 1 FROM public.puntos_niveles n WHERE n.clave <> p_clave
              AND ((n.orden < v_antes.orden AND n.desde >= v_nuevo.desde)
                OR (n.orden > v_antes.orden AND n.desde <= v_nuevo.desde))) THEN
    RAISE EXCEPTION 'Cada nivel tiene que pedir más compra que el anterior y menos que el siguiente.';
  END IF;
  IF v_nuevo.factor IS NULL OR v_nuevo.factor < 1 OR v_nuevo.factor > 5 THEN
    RAISE EXCEPTION 'Los puntos por dólar van de 1 a 5.';
  END IF;
  IF v_nuevo.puntos_cumpleanos IS NULL OR v_nuevo.puntos_cumpleanos < 0 OR v_nuevo.puntos_cumpleanos > 5000 THEN
    RAISE EXCEPTION 'Los puntos de cumpleaños van de 0 a 5,000.';
  END IF;
  IF v_nuevo.horas_reserva IS NULL OR v_nuevo.horas_reserva < 1 OR v_nuevo.horas_reserva > 168 THEN
    RAISE EXCEPTION 'Las horas para retirar una reserva van de 1 a 168 (7 días).';
  END IF;
  IF v_nuevo.dias_anticipo_ofertas < 0 OR v_nuevo.dias_anticipo_ofertas > 14 THEN
    RAISE EXCEPTION 'Los días de anticipo de las ofertas van de 0 a 14.';
  END IF;
  IF v_nuevo.cupon_mensual < 0 OR v_nuevo.cupon_mensual > 10000 THEN
    RAISE EXCEPTION 'Los puntos del raspable van de 0 a 10,000.';
  END IF;
  v_err := public.puntos_premios_validos(v_nuevo.cupon_premios);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  SELECT max(orden) INTO v_orden_max FROM public.puntos_niveles;
  IF v_antes.orden < v_orden_max - 1 AND (v_nuevo.cupon_mensual > 0 OR v_nuevo.cupon_premios IS NOT NULL) THEN
    RAISE EXCEPTION 'El raspable es sólo de los dos niveles más altos.';
  END IF;

  IF row(v_nuevo.*) IS NOT DISTINCT FROM row(v_antes.*) THEN
    RETURN json_build_object('ok', true, 'cambio', false);
  END IF;
  UPDATE public.puntos_niveles SET
    nombre = v_nuevo.nombre, desde = v_nuevo.desde, factor = v_nuevo.factor,
    puntos_cumpleanos = v_nuevo.puntos_cumpleanos, horas_reserva = v_nuevo.horas_reserva,
    dias_anticipo_ofertas = v_nuevo.dias_anticipo_ofertas,
    cupon_mensual = v_nuevo.cupon_mensual, cupon_premios = v_nuevo.cupon_premios, updated_at = now()
   WHERE clave = p_clave;
  -- El cumpleaños del nivel de entrada vivía también en `puntos_config`
  -- (lo leen `puntos_dar_cumpleanos` y la app): se mueven juntos para que no
  -- haya dos números para la misma promesa.
  IF v_antes.orden = (SELECT min(orden) FROM public.puntos_niveles) THEN
    UPDATE public.puntos_config SET puntos_cumpleanos = v_nuevo.puntos_cumpleanos, updated_at = now()
     WHERE id AND puntos_cumpleanos IS DISTINCT FROM v_nuevo.puntos_cumpleanos;
  END IF;
  INSERT INTO public.puntos_config_historial (employee_id, tabla, clave, antes, despues, nota)
  VALUES (public.auth_employee_id(), 'nivel', p_clave,
          to_jsonb(v_antes) - 'created_at' - 'updated_at', to_jsonb(v_nuevo) - 'created_at' - 'updated_at',
          nullif(btrim(p_nota), ''));
  RETURN json_build_object('ok', true, 'cambio', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_nivel_guardar(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_nivel_guardar(text, jsonb, text) TO authenticated, service_role;

-- ── Guardar un rango de mayoreo ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_mayoreo_guardar(p_clave text, p_cambios jsonb, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_antes public.puntos_mayoreo_beneficios; v_nuevo public.puntos_mayoreo_beneficios; v_clave text; v_err text;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['puntos_tab_niveles'])) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar los beneficios del Cliente Mayorista.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_antes FROM public.puntos_mayoreo_beneficios WHERE clave = p_clave FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese rango no existe.'; END IF;
  FOR v_clave IN SELECT jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) LOOP
    IF v_clave NOT IN ('puntos_cumpleanos', 'cupon_mensual', 'cupon_premios') THEN
      RAISE EXCEPTION 'No se puede cambiar «%» desde aquí.', v_clave;
    END IF;
  END LOOP;
  v_nuevo := v_antes;
  IF p_cambios ? 'puntos_cumpleanos' THEN v_nuevo.puntos_cumpleanos := (p_cambios->>'puntos_cumpleanos')::integer; END IF;
  IF p_cambios ? 'cupon_mensual' THEN v_nuevo.cupon_mensual := coalesce((p_cambios->>'cupon_mensual')::integer, 0); END IF;
  IF p_cambios ? 'cupon_premios' THEN
    v_nuevo.cupon_premios := CASE WHEN jsonb_typeof(p_cambios->'cupon_premios') = 'array'
                                   AND jsonb_array_length(p_cambios->'cupon_premios') > 0
                                  THEN p_cambios->'cupon_premios' END;
  END IF;
  IF v_nuevo.puntos_cumpleanos IS NULL OR v_nuevo.puntos_cumpleanos < 0 OR v_nuevo.puntos_cumpleanos > 5000 THEN
    RAISE EXCEPTION 'Los puntos de cumpleaños van de 0 a 5,000.';
  END IF;
  IF v_nuevo.cupon_mensual < 0 OR v_nuevo.cupon_mensual > 10000 THEN
    RAISE EXCEPTION 'Los puntos del raspable van de 0 a 10,000.';
  END IF;
  v_err := public.puntos_premios_validos(v_nuevo.cupon_premios);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;
  -- Penúltimo y último rango (Rubí y Diamante), como en los niveles.
  IF v_antes.orden < (SELECT max(orden) FROM public.puntos_mayoreo_beneficios) - 1
     AND (v_nuevo.cupon_mensual > 0 OR v_nuevo.cupon_premios IS NOT NULL) THEN
    RAISE EXCEPTION 'El raspable es sólo de los dos rangos más altos.';
  END IF;
  IF row(v_nuevo.*) IS NOT DISTINCT FROM row(v_antes.*) THEN
    RETURN json_build_object('ok', true, 'cambio', false);
  END IF;
  UPDATE public.puntos_mayoreo_beneficios SET puntos_cumpleanos = v_nuevo.puntos_cumpleanos,
         cupon_mensual = v_nuevo.cupon_mensual, cupon_premios = v_nuevo.cupon_premios, updated_at = now()
   WHERE clave = p_clave;
  INSERT INTO public.puntos_config_historial (employee_id, tabla, clave, antes, despues, nota)
  VALUES (public.auth_employee_id(), 'mayoreo', p_clave,
          to_jsonb(v_antes) - 'created_at' - 'updated_at', to_jsonb(v_nuevo) - 'created_at' - 'updated_at',
          nullif(btrim(p_nota), ''));
  RETURN json_build_object('ok', true, 'cambio', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_mayoreo_guardar(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_mayoreo_guardar(text, jsonb, text) TO authenticated, service_role;

-- ── Guardar la configuración general ────────────────────────────────────────
-- El tope del raspable (null = sin tope) y los dos interruptores. Encender
-- los niveles es la decisión más grande del programa: la pantalla la confirma
-- dos veces y acá queda anotada como cualquier otro cambio.
CREATE OR REPLACE FUNCTION public.puntos_config_guardar(p_cambios jsonb, p_nota text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_antes jsonb; v_despues jsonb; v_clave text; v_tope integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['puntos_tab_niveles'])) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar la configuración del programa.' USING ERRCODE = '42501';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) LOOP
    IF v_clave NOT IN ('cupon_presupuesto_mensual', 'niveles_activos', 'mayoreo_beneficios_activos') THEN
      RAISE EXCEPTION 'No se puede cambiar «%» desde aquí.', v_clave;
    END IF;
  END LOOP;
  SELECT jsonb_build_object('cupon_presupuesto_mensual', cupon_presupuesto_mensual,
                            'niveles_activos', niveles_activos,
                            'mayoreo_beneficios_activos', mayoreo_beneficios_activos)
    INTO v_antes FROM public.puntos_config WHERE id FOR UPDATE;
  IF p_cambios ? 'cupon_presupuesto_mensual' THEN
    v_tope := CASE WHEN jsonb_typeof(p_cambios->'cupon_presupuesto_mensual') = 'null' THEN NULL
                   ELSE (p_cambios->>'cupon_presupuesto_mensual')::integer END;
    IF v_tope IS NOT NULL AND (v_tope < 0 OR v_tope > 10000000) THEN
      RAISE EXCEPTION 'El tope del raspable va de 0 a 10,000,000 puntos, o vacío para no tener tope.';
    END IF;
  END IF;
  UPDATE public.puntos_config SET
    cupon_presupuesto_mensual = CASE WHEN p_cambios ? 'cupon_presupuesto_mensual' THEN v_tope ELSE cupon_presupuesto_mensual END,
    niveles_activos = CASE WHEN p_cambios ? 'niveles_activos' THEN (p_cambios->>'niveles_activos')::boolean ELSE niveles_activos END,
    mayoreo_beneficios_activos = CASE WHEN p_cambios ? 'mayoreo_beneficios_activos'
                                      THEN (p_cambios->>'mayoreo_beneficios_activos')::boolean ELSE mayoreo_beneficios_activos END,
    updated_at = now()
   WHERE id;
  SELECT jsonb_build_object('cupon_presupuesto_mensual', cupon_presupuesto_mensual,
                            'niveles_activos', niveles_activos,
                            'mayoreo_beneficios_activos', mayoreo_beneficios_activos)
    INTO v_despues FROM public.puntos_config WHERE id;
  IF v_despues IS NOT DISTINCT FROM v_antes THEN RETURN json_build_object('ok', true, 'cambio', false); END IF;
  INSERT INTO public.puntos_config_historial (employee_id, tabla, clave, antes, despues, nota)
  VALUES (public.auth_employee_id(), 'config', NULL, v_antes, v_despues, nullif(btrim(p_nota), ''));
  RETURN json_build_object('ok', true, 'cambio', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_config_guardar(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_config_guardar(jsonb, text) TO authenticated, service_role;

-- ── Lo que pinta la pestaña ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_niveles_panel()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_niveles', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los niveles del programa.' USING ERRCODE = '42501';
  END IF;
  RETURN json_build_object(
    'config', (SELECT json_build_object('niveles_activos', c.niveles_activos,
                                        'mayoreo_beneficios_activos', c.mayoreo_beneficios_activos,
                                        'cupon_presupuesto_mensual', c.cupon_presupuesto_mensual)
                 FROM public.puntos_config c WHERE c.id),
    'niveles', (SELECT coalesce(json_agg(to_json(n) ORDER BY n.orden), '[]'::json) FROM public.puntos_niveles n),
    'mayoreo', (SELECT coalesce(json_agg(to_json(m) ORDER BY m.orden), '[]'::json) FROM public.puntos_mayoreo_beneficios m),
    -- Lo ya repartido este mes en raspables: para leer el tope contra algo.
    'cupon_dado_mes', (SELECT coalesce(sum(l.puntos), 0) FROM public.puntos_lote l
                        WHERE l.origen = 'cupon'
                          AND l.ganado_el >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador')::date)::date),
    'historial', (SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
                    SELECT h.id, h.created_at, h.employee_id, e.name AS quien, h.tabla, h.clave, h.antes, h.despues, h.nota
                      FROM public.puntos_config_historial h
                      LEFT JOIN public.employees e ON e.id = h.employee_id
                     ORDER BY h.created_at DESC LIMIT 100) x));
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_niveles_panel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_niveles_panel() TO authenticated, service_role;
