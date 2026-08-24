-- El tipo de documento SÍ sale del número de control. El correlativo NO.
--
-- Una venta del 07-nov-2025 (Salud 1, MAPFRE, $15.87) figuraba en el portal con
-- `tipo_documento = 'UNKNOWN'` y `correlativo = ''`. **Ante Hacienda está
-- cerrada**: tiene sello de 40 caracteres, código de generación y estado «DTE
-- INVALIDADO EN MH». Lo roto es la copia del portal, y era lo único que mantenía
-- un hallazgo abierto en Observaciones desde hacía nueve meses.
--
-- ── Lo que sí se puede derivar ────────────────────────────────────────────
-- Su `numero_control` es `DTE-01-S003P001-000000000034660`. El segundo tramo es
-- el tipo de documento del catálogo de Hacienda: `01` es factura de consumidor
-- final y `03` el crédito fiscal. Comprobado sobre las 1,482 filas de esa sala
-- donde el número de control y el tipo conviven: **1,482 de 1,482 coinciden**,
-- sin una sola excepción. Así que el tipo se deriva, no se adivina — y la
-- migración lo escribe DESDE la columna, no con un literal.
--
-- ── Lo que NO se puede, y por qué no se toca ──────────────────────────────
-- El correlativo parecía salir del último tramo (34660). **No sale.** El mismo
-- cruce da 112 de 1,482: el número de control lleva su propia serie. Y en este
-- caso concreto se puede ver el daño que habría hecho — `0000034660_COF` YA
-- EXISTE en esa sala, es la factura 141900 de las 17:00:36 por $2.00. Escribirlo
-- acá habría puesto dos documentos fiscales con el mismo correlativo, que es
-- peor que el hueco que venía a tapar.
--
-- Así que el correlativo se queda vacío y la observación `SIN_CORRELATIVO` sigue
-- abierta, a propósito: ese número sólo lo tiene el sistema donde se emitió, y un
-- dato fiscal no se completa por parecido.

SET lock_timeout = '5s';

WITH arreglo AS (
  UPDATE public.sales_invoices si
     SET tipo_documento = CASE split_part(si.numero_control, '-', 2)
                            WHEN '01' THEN 'COF'
                            WHEN '03' THEN 'CCF'
                          END
   WHERE si.tipo_documento = 'UNKNOWN'
     AND si.numero_control IS NOT NULL
     AND split_part(si.numero_control, '-', 2) IN ('01','03')
  RETURNING si.id, si.branch_id, si.erp_invoice_id, si.numero_control, si.tipo_documento
)
INSERT INTO public.audit_logs
  (action, target_id, user_id, user_name, source, severity, branch_id, details)
SELECT 'DTE_TIPO_DERIVADO', a.id::text, NULL, 'Sistema', 'SYSTEM', 'INFO', a.branch_id,
       json_build_object(
         'erp_invoice_id', a.erp_invoice_id,
         'numero_control', a.numero_control,
         'antes', 'UNKNOWN',
         'despues', a.tipo_documento,
         'regla', 'segundo tramo del numero de control: 01=COF, 03=CCF (1482/1482 en Salud 1)',
         'correlativo', 'NO se derivo: el ultimo tramo es otra serie (112/1482) y 0000034660_COF ya existe')
FROM arreglo a;
