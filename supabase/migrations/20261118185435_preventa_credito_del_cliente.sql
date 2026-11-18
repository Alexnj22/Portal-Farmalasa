SET lock_timeout = '5s';

-- El crédito del cliente, a la vista al venderle y al cobrarle (usuario,
-- 2026-11-18: «al facturar a alguien que tiene crédito, agrégalo en la
-- preventa / venta un indicador»). Sale del espejo de cuentas por cobrar
-- (`creditos_de_clientes`). Vencido = pasó su plazo con saldo: `vencio_el` se
-- OBSERVA (`docs/reglas/caja-creditos-y-cierre.md`) y «vencido exige saldo».
CREATE OR REPLACE FUNCTION public.preventa_credito_del_cliente(p_customer bigint)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
           'pendiente', round(sum(c.saldo), 2),
           'documentos', count(*),
           'vencido', round(coalesce(sum(c.saldo) FILTER (WHERE c.vencio_el < (now() AT TIME ZONE 'America/El_Salvador')::date), 0), 2),
           'vencidos', count(*) FILTER (WHERE c.vencio_el < (now() AT TIME ZONE 'America/El_Salvador')::date),
           'dias_mas_viejo', max((now() AT TIME ZONE 'America/El_Salvador')::date - c.fecha)) END
    FROM public.creditos_de_clientes c
   WHERE c.customer_id = p_customer AND c.estado = 'PENDIENTE' AND c.saldo > 0.004;
$$;
REVOKE EXECUTE ON FUNCTION public.preventa_credito_del_cliente(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_credito_del_cliente(bigint) TO service_role;

-- `preventa_cliente` lo devuelve en `credito`. Se parte de su definición VIVA y
-- se le agrega una sola clave, para no pisar lo que otra sesión le haya hecho.
DO $do$
DECLARE d text := pg_get_functiondef('public.preventa_cliente(bigint,bigint)'::regprocedure);
BEGIN
  IF position('preventa_credito_del_cliente' in d) > 0 THEN RETURN; END IF;
  IF position('''ultimas_compras'', coalesce(v_ultimas' in d) = 0 THEN
    RAISE NOTICE 'preventa_cliente cambió de forma: no se le agrega el crédito.';
    RETURN;
  END IF;
  d := replace(d, '''ultimas_compras'', coalesce(v_ultimas',
                  '''credito'', public.preventa_credito_del_cliente(c.id), ''ultimas_compras'', coalesce(v_ultimas');
  EXECUTE d;
END
$do$;
