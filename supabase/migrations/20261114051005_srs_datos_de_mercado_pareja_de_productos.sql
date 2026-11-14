-- Datos de mercado de la SRS (2026-11-14).
--
-- Cada año la Superintendencia de Regulación Sanitaria pide, por
-- establecimiento, existencias y precio real de venta de todo medicamento de
-- uso humano (Captura General de Datos de Mercado, datosmercado.srs.gob.sv).
-- Su sistema identifica cada producto con un `crp` propio («13273-2» =
-- registro 13273, presentación 2) y se llena producto por producto.
--
-- Esta tabla es la PAREJA de cada producto del portal con su `crp`. La propone
-- un emparejador (nombre, concentración, forma, cantidad y laboratorio contra
-- el buscador de la SRS) y la confirma una persona; lo confirmado no lo vuelve
-- a tocar ninguna carga automática, así que el año siguiente ya está hecho.
--   estado = propuesto   lo dejó el emparejador, falta que alguien lo mire
--            confirmado  una persona dijo «es éste» (o eligió otro)
--            no_aplica   no es medicamento (cepillos, curitas, leches…): la
--                        SRS no lo pide
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.srs_mercado_productos (
    product_id       integer PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
    crp              text,
    n_registro       text,
    nombre_srs       text,
    presentacion_srs text,
    laboratorio_srs  text,
    confianza        text NOT NULL DEFAULT 'sin_pareja'
                     CHECK (confianza IN ('alta','media','baja','sin_pareja','manual')),
    estado           text NOT NULL DEFAULT 'propuesto'
                     CHECK (estado IN ('propuesto','confirmado','no_aplica')),
    alternativas     jsonb NOT NULL DEFAULT '[]'::jsonb,
    revisado_por     uuid REFERENCES public.employees(id),
    revisado_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (estado <> 'confirmado' OR crp IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS srs_mercado_productos_crp ON public.srs_mercado_productos (crp) WHERE crp IS NOT NULL;

ALTER TABLE public.srs_mercado_productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.srs_mercado_productos;
CREATE POLICY bloqueo_global ON public.srs_mercado_productos AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS srs_mercado_productos_select ON public.srs_mercado_productos;
CREATE POLICY srs_mercado_productos_select ON public.srs_mercado_productos FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('cumplimiento_tab_datos_mercado', 'can_view')));
REVOKE ALL ON public.srs_mercado_productos FROM anon;
GRANT SELECT ON public.srs_mercado_productos TO authenticated;
-- Se escribe sólo por las dos funciones de abajo.

-- La lista de la pantalla: todo producto con existencia (o ya emparejado),
-- con su pareja. JSON para no caer bajo el techo de 1000 filas.
CREATE OR REPLACE FUNCTION public.srs_mercado_lista()
 RETURNS json LANGUAGE sql STABLE
 SET search_path = public, extensions
AS $function$
  WITH ex AS (
    SELECT i.erp_product_id AS product_id, sum(i.cantidad)::int AS existencia
      FROM public.inventory i
     WHERE i.cantidad > 0 AND NOT i.is_vencidos
     GROUP BY 1
  ), base AS (
    SELECT p.id AS product_id, p.nombre, l.nombre AS laboratorio, coalesce(ex.existencia, 0) AS existencia,
           s.crp, s.n_registro, s.nombre_srs, s.presentacion_srs, s.laboratorio_srs,
           coalesce(s.confianza, 'sin_pareja') AS confianza, coalesce(s.estado, 'propuesto') AS estado,
           coalesce(s.alternativas, '[]'::jsonb) AS alternativas, s.revisado_at
      FROM public.products p
      LEFT JOIN ex ON ex.product_id = p.id
      LEFT JOIN public.srs_mercado_productos s ON s.product_id = p.id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
     WHERE ex.product_id IS NOT NULL OR s.product_id IS NOT NULL
  )
  SELECT coalesce(json_agg(to_json(b) ORDER BY b.nombre), '[]'::json) FROM base b
   WHERE (SELECT public.auth_has_module_permission('cumplimiento_tab_datos_mercado', 'can_view'));
$function$;

-- Lo que decide una persona.
CREATE OR REPLACE FUNCTION public.srs_mercado_revisar(
    p_product_id integer, p_estado text, p_crp text DEFAULT NULL, p_n_registro text DEFAULT NULL,
    p_nombre_srs text DEFAULT NULL, p_presentacion_srs text DEFAULT NULL, p_laboratorio_srs text DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v_fila public.srs_mercado_productos;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT public.auth_has_module_permission('cumplimiento_tab_datos_mercado', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes revisar los datos de mercado.';
  END IF;
  IF p_estado NOT IN ('propuesto','confirmado','no_aplica') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;
  IF p_estado = 'confirmado' AND nullif(trim(coalesce(p_crp, '')), '') IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.srs_mercado_productos WHERE product_id = p_product_id AND crp IS NOT NULL) THEN
    RAISE EXCEPTION 'FALTA_PRODUCTO' USING HINT = 'Elige el producto de la SRS antes de confirmar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'PRODUCTO_INEXISTENTE';
  END IF;

  INSERT INTO public.srs_mercado_productos AS s
         (product_id, crp, n_registro, nombre_srs, presentacion_srs, laboratorio_srs,
          confianza, estado, revisado_por, revisado_at)
  VALUES (p_product_id,
          CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE p_crp END,
          CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE p_n_registro END,
          CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE p_nombre_srs END,
          CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE p_presentacion_srs END,
          CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE p_laboratorio_srs END,
          'manual', p_estado, v_yo, now())
  ON CONFLICT (product_id) DO UPDATE SET
          crp              = CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE coalesce(p_crp, s.crp) END,
          n_registro       = CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE coalesce(p_n_registro, s.n_registro) END,
          nombre_srs       = CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE coalesce(p_nombre_srs, s.nombre_srs) END,
          presentacion_srs = CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE coalesce(p_presentacion_srs, s.presentacion_srs) END,
          laboratorio_srs  = CASE WHEN p_estado = 'no_aplica' THEN NULL ELSE coalesce(p_laboratorio_srs, s.laboratorio_srs) END,
          confianza        = CASE WHEN p_crp IS NOT NULL AND p_crp IS DISTINCT FROM s.crp THEN 'manual' ELSE s.confianza END,
          estado           = p_estado,
          revisado_por     = v_yo,
          revisado_at      = now(),
          updated_at       = now()
  RETURNING * INTO v_fila;
  RETURN to_json(v_fila);
END;
$function$;

-- Lo que deja el emparejador (sólo el servidor). Nunca pisa lo que ya decidió
-- una persona, y no reescribe una fila igual.
CREATE OR REPLACE FUNCTION public.srs_mercado_cargar_propuestas(p_filas json)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_n int;
BEGIN
  WITH f AS (
    SELECT (x->>'product_id')::int AS product_id, nullif(x->>'crp', '') AS crp,
           nullif(x->>'n_registro', '') AS n_registro, x->>'nombre_srs' AS nombre_srs,
           x->>'presentacion_srs' AS presentacion_srs, x->>'laboratorio_srs' AS laboratorio_srs,
           x->>'confianza' AS confianza, coalesce(x->'alternativas', '[]'::json)::jsonb AS alternativas
      FROM json_array_elements(p_filas) x
     WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = (x->>'product_id')::int)
  ), up AS (
    INSERT INTO public.srs_mercado_productos AS s
           (product_id, crp, n_registro, nombre_srs, presentacion_srs, laboratorio_srs, confianza, alternativas)
    SELECT product_id, crp, n_registro, nombre_srs, presentacion_srs, laboratorio_srs, confianza, alternativas FROM f
    ON CONFLICT (product_id) DO UPDATE SET
           crp = EXCLUDED.crp, n_registro = EXCLUDED.n_registro, nombre_srs = EXCLUDED.nombre_srs,
           presentacion_srs = EXCLUDED.presentacion_srs, laboratorio_srs = EXCLUDED.laboratorio_srs,
           confianza = EXCLUDED.confianza, alternativas = EXCLUDED.alternativas, updated_at = now()
     WHERE s.estado = 'propuesto'
       AND (s.crp, s.confianza, s.alternativas) IS DISTINCT FROM (EXCLUDED.crp, EXCLUDED.confianza, EXCLUDED.alternativas)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM up;
  RETURN json_build_object('escritas', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.srs_mercado_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.srs_mercado_lista() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.srs_mercado_revisar(integer, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.srs_mercado_revisar(integer, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.srs_mercado_cargar_propuestas(json) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srs_mercado_cargar_propuestas(json) TO service_role;

-- Permiso: gerencia, administración, supervisión de ventas y la cuenta de QA.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r, 'cumplimiento_tab_datos_mercado', true, true, 'ALL'
  FROM unnest(ARRAY[2, 3, 13, 33]) r
  JOIN public.roles ro ON ro.id = r
ON CONFLICT (role_id, module_key) DO NOTHING;
