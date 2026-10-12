-- Mis tratamientos sólo con MEDICAMENTOS (2026-10-12). Pedido del usuario: «no
-- me vaya a recordar con electrolit, recargas, etc, si no medicamentos reales».
-- La detección miraba sólo la frecuencia de compra; el catálogo no tiene una
-- categoría confiable (tipo_medicamento está vacío en 5,243 de 5,249), así que
-- se decide por el NOMBRE y el principio activo:
--   · sí, si tiene principio activo o una forma farmacéutica / dosis en el
--     nombre (mg, mcg, UI, tabletas, cápsulas, jarabe, gotas, ampollas…);
--   · no, si el nombre es de algo que no es medicamento (recargas, bebidas,
--     sueros orales, higiene, cosmética, material de curación, fórmulas…).
-- Medido contra los 4,386 productos activos: 2,559 pasan. Si duda, NO pasa:
-- perder un recordatorio es mejor que recordarle a alguien una recarga.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.es_medicamento_de_tratamiento(p_nombre text, p_principio_activo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT upper(coalesce(p_nombre, '')) !~ '(RECARGA|PAQUETE|ELECTROLIT|PEDIALYTE|SUERO|BEBIDA|LATA|PA[ÑN]AL|TOALLA|SHAMPOO|JAB[OÓ]N|DESODORANTE|CEPILLO|PASTA DENTAL|CONDON|PRESERVATIVO|ALGOD[OÓ]N|GASA|MICROPORE|JERINGA|LECHE|F[OÓ]RMULA|ENSURE|GLUCERNA|SALUTARIS|AGUA |GALLETA|DULCE|CHICLE|BLOQUEADOR|PROTECTOR SOLAR|TINTE|PRUEBA|BOLSA|TERMOMETRO|CURITA|VENDA|MASCARILLA|GUANTE|BIBER[OÓ]N|PACHA|TETERO|LUBRICANTE|ENJUAGUE|HILO DENTAL|CREMA (CORPORAL|HIDRATANTE|PARA MANOS)|LOCI[OÓ]N|PERFUME|COLONIA|MAQUILLAJE|LABIAL|ESMALTE|TOALLITAS|PROTECTORES)'
     AND (coalesce(p_principio_activo, '') <> ''
          OR upper(coalesce(p_nombre, '')) ~ '([0-9]\s*(MG|MCG|UI)\M|\m(TAB|TABS|TABLETA|TABLETAS|CAP|CAPS|CAPSULA|CAPSULAS|C[AÁ]PSULAS|COMP|COMPRIMIDOS|GRAGEAS|AMP|AMPOLLA|AMPOLLAS|INY|INYECTABLE|JARABE|JBE|SUSP|SUSPENSION|SUSPENSI[OÓ]N|GOTAS|SUPOSITORIOS|OVULOS|[OÓ]VULOS|INHALADOR|PARCHES)\M)');
$function$;
REVOKE EXECUTE ON FUNCTION public.es_medicamento_de_tratamiento(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_medicamento_de_tratamiento(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_tratamientos_detectar(p_clientes bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH compras AS (
    SELECT si.customer_id, ii.erp_product_id AS product_id, si.fecha, max(ii.descripcion) AS descripcion
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.customer_id = ANY (p_clientes) AND si.fecha >= current_date - 240
       AND public.venta_valida(si.estado) AND ii.erp_product_id IS NOT NULL
     GROUP BY 1, 2, 3),
  gaps AS (
    SELECT *, fecha - lag(fecha) OVER (PARTITION BY customer_id, product_id ORDER BY fecha) AS g FROM compras),
  t AS (
    SELECT customer_id, product_id, count(*)::int AS veces, max(fecha) AS ultima,
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY g))::int AS mediana, max(g) AS maxg,
           (array_agg(descripcion ORDER BY fecha DESC))[1] AS descripcion
      FROM gaps GROUP BY 1, 2),
  buenos AS (
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre FROM t
      LEFT JOIN public.products p ON p.id = t.product_id
     WHERE t.veces >= 3 AND t.mediana BETWEEN 14 AND 60 AND t.maxg <= t.mediana * 2
       AND t.ultima >= current_date - t.mediana * 2
       -- (2026-10-12) Sólo medicamentos: nada de recargas, bebidas ni higiene.
       AND public.es_medicamento_de_tratamiento(coalesce(p.nombre, t.descripcion), p.principio_activo))
  INSERT INTO public.app_tratamientos AS a (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces)
  SELECT customer_id, product_id, nombre, mediana, ultima, veces FROM buenos
  ON CONFLICT (customer_id, product_id) DO UPDATE
     SET intervalo_dias = EXCLUDED.intervalo_dias, ultima_compra = EXCLUDED.ultima_compra, veces = EXCLUDED.veces,
         nombre = EXCLUDED.nombre, updated_at = now(),
         -- Volvió a comprarlo después de decir «ya no lo tomo»: se reactiva.
         estado = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN 'activo' ELSE a.estado END,
         motivo = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN NULL ELSE a.motivo END
   WHERE (a.intervalo_dias, a.ultima_compra, a.veces, a.nombre) IS DISTINCT FROM
         (EXCLUDED.intervalo_dias, EXCLUDED.ultima_compra, EXCLUDED.veces, EXCLUDED.nombre);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- Los ya detectados que no son medicamentos se quitan (se derivan solos de las
-- compras; no hay nada que conservar).
DELETE FROM public.app_tratamientos a
 USING public.products p
 WHERE p.id = a.product_id
   AND NOT public.es_medicamento_de_tratamiento(p.nombre, p.principio_activo);
