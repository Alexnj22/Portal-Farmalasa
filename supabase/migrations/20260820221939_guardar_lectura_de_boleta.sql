SET lock_timeout = '5s';

-- Deja el rastro de la lectura automática sobre una operación recién creada.
--
-- Va en una función APARTE y no como un parámetro más de
-- `registrar_salida_de_bolsa` a propósito: esa función mueve efectivo, valida
-- diez cosas y está probada en sala. Agregarle un parámetro obliga a
-- DROP + CREATE —cambia la firma— o sea a reescribir su cuerpo entero para
-- guardar un dato de auditoría. El riesgo de esa reescritura es mayor que lo
-- que aporta tenerlo en la misma transacción.
--
-- Consecuencia que hay que conocer: si esta llamada falla, la salida queda
-- registrada SIN su rastro. Es un dato de auditoría, no del negocio — y es
-- preferible a que un fallo escribiendo el rastro deshaga una salida de dinero
-- que ya ocurrió en la realidad.
--
-- Sólo escribe si está vacío y sólo sobre una operación propia y reciente: no
-- es una puerta para reescribir el rastro de una salida vieja.
CREATE OR REPLACE FUNCTION public.guardar_lectura_de_boleta(
    p_operacion_id bigint,
    p_lectura jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid := (SELECT auth_employee_id());
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    UPDATE public.bolsas_operaciones
       SET foto_lectura = p_lectura
     WHERE id = p_operacion_id
       AND registrado_por = v_yo
       AND foto_lectura IS NULL
       AND registrado_at > now() - interval '10 minutes';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guardar_lectura_de_boleta(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_lectura_de_boleta(bigint, jsonb) TO authenticated, service_role;
