-- Las condiciones de crédito del proveedor se guardan por RPC, no por UPDATE.
--
-- `proveedores_maestro` **no tiene policy de UPDATE** —sólo de SELECT—, así que
-- un `.update()` desde el navegador devuelve **cero filas y ningún error**: el
-- botón diría «guardado» y no habría guardado nada. Por eso toda esa tabla se
-- escribe por funciones SECURITY DEFINER (`update_proveedor_manual`,
-- `set_proveedor_clasificacion_fiscal`), y ésta sigue el mismo camino.
--
-- Va como función PROPIA y no como tres parámetros más de
-- `update_proveedor_manual` por el motivo que ya está escrito en
-- `src/data/proveedores.js`: esa función tiene dos sobrecargas con DEFAULT y
-- una tercera vuelve ambigua la llamada. Y además esto es otro acto: son las
-- condiciones comerciales, no los datos de contacto.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_proveedor_condiciones_credito(
    p_id             bigint,
    p_dias_credito   integer,
    p_limite_credito numeric,
    p_forma_pago     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  -- Lo puede cambiar quien maneja proveedores o quien maneja las cuentas por
  -- pagar: las dos pantallas ofrecen el mismo campo, y quien registra un pago
  -- necesita poder poner el plazo que falta sin cambiar de módulo.
  IF NOT (public.auth_can_edit_any(ARRAY['proveedores'])
          OR public.auth_has_module_permission('cuentas_por_pagar','can_edit')) THEN
    RAISE EXCEPTION 'No tenés permiso para cambiar las condiciones de un proveedor.';
  END IF;

  IF p_dias_credito IS NOT NULL AND (p_dias_credito < 0 OR p_dias_credito > 365) THEN
    RAISE EXCEPTION 'Los días de crédito van de 0 a 365.';
  END IF;
  IF p_limite_credito IS NOT NULL AND p_limite_credito < 0 THEN
    RAISE EXCEPTION 'El límite de crédito no puede ser negativo.';
  END IF;
  IF p_forma_pago IS NOT NULL
     AND p_forma_pago NOT IN ('efectivo','cheque','transferencia','otro') THEN
    RAISE EXCEPTION 'Forma de pago desconocida: %', p_forma_pago;
  END IF;

  UPDATE public.proveedores_maestro
     SET dias_credito   = p_dias_credito,
         limite_credito = p_limite_credito,
         forma_pago     = p_forma_pago,
         updated_at     = now()
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese proveedor no existe.';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_proveedor_condiciones_credito(bigint, integer, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_proveedor_condiciones_credito(bigint, integer, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_proveedor_condiciones_credito(bigint, integer, numeric, text) IS
    'Días de crédito, límite y forma de pago de un proveedor. Por RPC porque `proveedores_maestro` no tiene policy de UPDATE: un update directo devolvería cero filas sin error.';
