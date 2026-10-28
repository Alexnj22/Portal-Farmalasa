-- El número de boleta sólo es único DENTRO de quien lo numera (2026-10-28).
--
-- `boleta_ya_en_caja` comparaba el número y nada más, y el freno de
-- `operar-caja` bloqueaba cualquier coincidencia del mismo sentido. Medido ese
-- día en Salud 2: la boleta 000956 del POS Promerica (pago de ANDA, $3.99,
-- 17-oct) y el voucher 000956 de la terminal de tarjeta Atlántida (reserva de
-- una báscula, $48.00, 27-oct) son dos operaciones reales con el mismo número.
-- Cada banco numera por su lado, y una factura de proveedor trae el número de
-- su emisor: con la regla vieja, la sala podía quedarse SIN PODER REGISTRAR
-- un movimiento real.
--
-- La familia de numeración:
--   · voucher (tarjeta/transferencia) → no se juzga acá: un voucher se reparte
--     legítimamente entre varias partes y `operar-caja` ya tiene su propio
--     tope (la suma de las partes no pasa del total).
--   · POS Promerica (entrada o salida) → el número es el ID de transacción
--     del aparato: basta el número.
--   · cualquier otro tipo (proveedor, compra, otro) → el número es del
--     EMISOR, que no conocemos; dos papeles distintos pueden coincidir, así
--     que además tiene que coincidir el monto.
--
-- `misma_operacion` es NULL cuando quien pregunta no dice qué está anotando
-- (la firma vieja): ahí se conserva el comportamiento de antes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_familia_de_boleta(p_tipo_codigo text, p_forma_pago text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
           WHEN coalesce(p_forma_pago, 'EFECTIVO') <> 'EFECTIVO' THEN 'VOUCHER:' || p_forma_pago
           WHEN p_tipo_codigo LIKE 'POS_PROMERICA%' THEN 'POS_PROMERICA'
           ELSE coalesce(p_tipo_codigo, 'SIN_TIPO')
         END;
$function$;

CREATE OR REPLACE FUNCTION public.caja_misma_operacion_de_boleta(
  a_tipo_codigo text, a_forma_pago text, a_monto numeric,
  b_tipo_codigo text, b_forma_pago text, b_monto numeric)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago) LIKE 'VOUCHER:%'
             OR public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) LIKE 'VOUCHER:%' THEN false
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago)
                <> public.caja_familia_de_boleta(b_tipo_codigo, b_forma_pago) THEN false
           WHEN public.caja_familia_de_boleta(a_tipo_codigo, a_forma_pago) = 'POS_PROMERICA' THEN true
           ELSE a_monto IS NULL OR b_monto IS NULL OR round(a_monto, 2) = round(b_monto, 2)
         END;
$function$;

DROP FUNCTION IF EXISTS public.boleta_ya_en_caja(bigint, text);

CREATE FUNCTION public.boleta_ya_en_caja(
  p_branch_id bigint, p_numero_boleta text,
  p_tipo_codigo text DEFAULT NULL, p_forma_pago text DEFAULT NULL, p_monto numeric DEFAULT NULL)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT m.id, m.tipo, m.tipo_codigo, m.forma_pago, m.monto, m.concepto, m.numero_boleta,
           m.fecha, m.registrado_at,
           CASE WHEN p_tipo_codigo IS NULL AND p_forma_pago IS NULL THEN NULL
                ELSE public.caja_misma_operacion_de_boleta(
                       m.tipo_codigo, m.forma_pago, m.monto, p_tipo_codigo, p_forma_pago, p_monto)
           END AS misma_operacion
    FROM public.caja_movimientos_portal m
    WHERE m.branch_id = p_branch_id
      AND m.anulado_at IS NULL
      AND m.numero_boleta IS NOT NULL
      AND ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0') <> ''
      AND ltrim(regexp_replace(m.numero_boleta, '\D', '', 'g'), '0')
        = ltrim(regexp_replace(p_numero_boleta, '\D', '', 'g'), '0')
    ORDER BY m.registrado_at DESC
    LIMIT 5
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.caja_familia_de_boleta(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.caja_misma_operacion_de_boleta(text, text, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_familia_de_boleta(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caja_misma_operacion_de_boleta(text, text, numeric, text, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.boleta_ya_en_caja(bigint, text, text, text, numeric) TO authenticated, service_role;
