-- Datos de mercado de la SRS (2026-11-14): «Es éste» fallaba SIEMPRE con
-- «violates check constraint srs_mercado_productos_check». La pantalla
-- confirma sin volver a mandar el producto de la SRS (p_crp NULL: «el que ya
-- tiene»), y el INSERT … ON CONFLICT arma primero la fila NUEVA con crp NULL
-- y estado 'confirmado'. Postgres revisa el CHECK (confirmado ⇒ crp) sobre
-- esa fila propuesta ANTES de resolver el conflicto, así que la rama UPDATE
-- —que sí completaba con coalesce(p_crp, s.crp)— nunca llegaba a correr.
-- Arreglo: completar los p_* con la fila existente antes del INSERT. Cuerpo
-- partido de la definición viva (igual a 20261114051005).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.srs_mercado_revisar(
    p_product_id integer, p_estado text, p_crp text DEFAULT NULL, p_n_registro text DEFAULT NULL,
    p_nombre_srs text DEFAULT NULL, p_presentacion_srs text DEFAULT NULL, p_laboratorio_srs text DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
DECLARE
  v_yo uuid := public.auth_employee_id();
  v_fila public.srs_mercado_productos;
  v_prev public.srs_mercado_productos;
  v_crp text; v_reg text; v_nom text; v_pres text; v_lab text;
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

  -- Sin producto nuevo = el que ya tiene (ver encabezado de la migración).
  SELECT * INTO v_prev FROM public.srs_mercado_productos WHERE product_id = p_product_id;
  IF p_estado = 'no_aplica' THEN
    v_crp := NULL; v_reg := NULL; v_nom := NULL; v_pres := NULL; v_lab := NULL;
  ELSE
    v_crp  := coalesce(p_crp, v_prev.crp);
    v_reg  := coalesce(p_n_registro, v_prev.n_registro);
    v_nom  := coalesce(p_nombre_srs, v_prev.nombre_srs);
    v_pres := coalesce(p_presentacion_srs, v_prev.presentacion_srs);
    v_lab  := coalesce(p_laboratorio_srs, v_prev.laboratorio_srs);
  END IF;

  INSERT INTO public.srs_mercado_productos AS s
         (product_id, crp, n_registro, nombre_srs, presentacion_srs, laboratorio_srs,
          confianza, estado, revisado_por, revisado_at)
  VALUES (p_product_id, v_crp, v_reg, v_nom, v_pres, v_lab, 'manual', p_estado, v_yo, now())
  ON CONFLICT (product_id) DO UPDATE SET
          crp              = v_crp,
          n_registro       = v_reg,
          nombre_srs       = v_nom,
          presentacion_srs = v_pres,
          laboratorio_srs  = v_lab,
          confianza        = CASE WHEN p_crp IS NOT NULL AND p_crp IS DISTINCT FROM s.crp THEN 'manual' ELSE s.confianza END,
          estado           = p_estado,
          revisado_por     = v_yo,
          revisado_at      = now(),
          updated_at       = now()
  RETURNING * INTO v_fila;
  RETURN to_json(v_fila);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.srs_mercado_revisar(integer, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.srs_mercado_revisar(integer, text, text, text, text, text, text) TO authenticated, service_role;
