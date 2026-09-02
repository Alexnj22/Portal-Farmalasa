-- Cuántos BILLETES hay en el cajón, sumados EN LA BASE.
--
-- La primera versión de esto vivía en `operar-caja` y bajaba las facturas del
-- día para sumarlas en JavaScript. Lo levantó `npm run gate:data` como
-- `sin-paginar`, y tenía razón: PostgREST trunca en 1000 filas sin avisar, y el
-- día que una sala las cruce el descuento de las ventas que no fueron en
-- efectivo saldría de menos — o sea, el cajón parecería tener MÁS de lo que
-- tiene, que es la dirección peligrosa: manda a alguien a buscar billetes que
-- no están. (Medido hoy: el máximo por sala y día son 273 facturas. El techo no
-- está cerca, y por eso el defecto habría vivido callado hasta el día que sí.)
--
-- Sumar acá además convierte tres viajes en uno y no manda ni una fila de datos
-- por la red.
--
-- ── Qué corrige, y por qué «Monto Registrado» no sirve tal cual ────────────
-- El panel del origen muestra su `total_corte`:
--
--     total_tike + total_factura + total_credito + monto_apertura
--     + total_entrada − total_salida
--
-- 1. **Le sobran las ventas que no fueron en efectivo**: una venta con tarjeta
--    entra ahí y no deja un billete.
-- 2. **Le sobra lo que ya se embolsó hoy**: meter el dinero en una bolsa no le
--    avisa nada al origen, que le sigue contando esa plata hasta el Z. Medido
--    en Salud 3 el 30-ago: corte de las 12:14 con $438.69 contados → bolsa de
--    $438.69, y el corte de las 18:04 esperaba $969.30, o sea que seguía
--    contando los $438.69 que ya estaban dentro de una bolsa sellada.
-- 3. **Hay que devolver los vales ya anotados** de bolsas de hoy: el portal ya
--    se los restó al origen y esa misma plata está dentro de `embolsado`.
--    Restar las dos la contaría dos veces.
-- 4. **Le falta el cobro de créditos**, el defecto conocido del origen
--    (docs/AUDITORIA-CORTE-DESDE-EL-PORTAL-2026-09-02.md §2). Ese dinero SÍ
--    entra en billetes, así que no sumarlo deja el número POR DEBAJO — y ésa
--    es la dirección segura: de menos manda la salida a las bolsas, que es lo
--    que se hacía siempre.
--
-- Nada de esto escribe una diferencia en ningún lado: decide de dónde sale la
-- plata, no le corrige el corte al origen — eso se decidió dejarlo como está.
--
-- SECURITY DEFINER porque el alcance de `cortes_caja` lo tienen 9 de 24 cargos
-- y sin él un select sobre `sales_invoices` devuelve cero filas **sin error**,
-- o sea un cajón que parece lleno. La llama `operar-caja` con la llave de
-- servicio; a `authenticated` no se le da EXECUTE porque el número es
-- justamente el que el conteo a ciegas del corte no puede publicar.
--
-- `plpgsql` y no `sql`: una `LANGUAGE sql` con `SET search_path` se planifica
-- una sola vez con los argumentos como `Params` y nunca ve un valor (trampa 4
-- de CLAUDE.md). Acá el plan bueno no depende de los argumentos, así que no
-- haría daño — pero el cuerpo va a crecer y el modo de falla es invisible.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_efectivo_piezas(
    p_branch_id integer, p_dia date
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  SELECT json_build_object(
      'ventas_no_efectivo', (
          SELECT round(coalesce(sum(si.total), 0), 2)
            FROM public.sales_invoices si
           WHERE si.branch_id = p_branch_id
             AND si.fecha = p_dia
             AND si.estado = 'FINALIZADA'
             AND coalesce(si.tipo_pago, '') <> 'efectivo'),
      'embolsado_hoy', (
          SELECT round(coalesce(sum(b.monto_inicial), 0), 2)
            FROM public.bolsas b
           WHERE b.branch_id = p_branch_id
             AND b.fecha = p_dia
             AND b.estado <> 'ANULADA'),
      'vales_ya_anotados', (
          SELECT round(coalesce(sum(v.monto), 0), 2)
            FROM public.caja_vales_portal v
           WHERE v.branch_id = p_branch_id
             AND v.fecha = p_dia
             AND v.estado IN ('ANOTADO', 'CERRADO'))
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.caja_efectivo_piezas(integer, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_efectivo_piezas(integer, date) TO service_role;

COMMENT ON FUNCTION public.caja_efectivo_piezas(integer, date) IS
    'Las piezas con las que se corrige el «Monto Registrado» del origen hasta dejar los BILLETES que hay en el cajón. La usa operar-caja para decidir si una salida de efectivo sale del cajón o de una bolsa. No se expone a authenticated: ese número es la respuesta del conteo a ciegas del corte.';
