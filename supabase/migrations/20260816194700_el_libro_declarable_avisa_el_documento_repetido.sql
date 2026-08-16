-- El libro declarable avisa cuando un mismo documento entró dos veces.
--
-- Encontrado el 2026-08-16 revisando qué pasa cuando un DTE trae productos de
-- dos salas. La respuesta legal es que no se parte —Art. 141 lit. b) CT manda
-- anotar cada comprobante «en forma separada e individualizada», o sea un
-- documento un renglón, y el Art. 65 LIVA deduce el crédito con el comprobante
-- original entero—, así que la factura se registra COMPLETA en una sala y lo que
-- es de la otra se traslada por inventario (Art. 142: el registro debe reflejar
-- «clara y verazmente su real movimiento»).
--
-- El riesgo es lo que pasa si alguien no lo hace así: registrar el mismo
-- documento dos veces, una por sala. `get_libro_compras_declarable` arma **un
-- renglón por compra registrada** y no deduplicaba, así que ese documento
-- aparecía dos veces y su crédito fiscal se contaba dos veces. Nada lo avisaba.
--
-- Y no es hipotético: en julio 2026 el DTE 1749 de COFARSAL ($73.52) está
-- registrado dos veces —06/07 y 08/07, misma sucursal—, así que julio declaró
-- ese crédito por duplicado.
--
-- ── Cómo se identifica «el mismo documento» ────────────────────────────────
-- Por el documento YA RESUELTO (`dte_id`), y sólo si no hay, por el sello de
-- Hacienda. Ese orden importa y está medido: hay dos compras del 21/07
-- —$663.94 y $125.82— que comparten el sello porque el sistema de origen lo
-- copió mal, pero son DOS documentos distintos (DTE 1617 y 1545). Agrupar por
-- el sello primero las habría marcado como duplicado sin serlo.
--
-- **Lo que NO detecta, y hay que saberlo**: las compras cuyo documento no se
-- pudo identificar quedan fuera del chequeo. Su único identificador es el
-- número cortado a 20 caracteres que llega del origen, y ahí 104 compras
-- distintas comparten la cadena «DTE-03-M001P001-0000»: agruparlas daría un
-- falso positivo por cada una. Tampoco ve el duplicado repartido entre dos
-- meses — el libro se arma por período y sólo mira adentro del que se declara.
--
-- DDL sobre funciones únicamente: no toma lock sobre ninguna tabla caliente.
-- Va DROP + CREATE y no CREATE OR REPLACE porque cambia el tipo de retorno
-- (columna nueva), y Postgres no deja reemplazarlo en su sitio.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_libro_compras_declarable(date, date);

CREATE FUNCTION public.get_libro_compras_declarable(
  p_desde date,
  p_hasta date
)
RETURNS TABLE(
  origen              text,
  fecha               date,
  documento_tipo      text,
  documento_numero    text,
  documento_completo  text,
  proveedor           text,
  nrc                 text,
  nit                 text,
  compras_gravadas    numeric,
  credito_fiscal      numeric,
  total               numeric,
  percepcion_iva      numeric,
  retencion_iva       numeric,
  computa_credito     boolean,
  motivo              text,
  clasificacion       text,
  dte_id              bigint,
  tipo_dte            text,
  numero_control      text,
  json_path           text,
  pdf_path            text,
  veces_en_el_libro   integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH permitido AS (
    SELECT (SELECT auth_has_module_permission('libro_compras_completo', 'can_view')) AS ok
  ),
  -- Mismo normalizado y misma ventana de ±5 días que `get_libro_compras_completo`.
  compras_norm AS (
    SELECT pr.id, pr.supplier_id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
      FROM public.purchase_receipts pr
     WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
       AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  -- El signo y el derecho a crédito los fija el TIPO de documento, antes de
  -- mirar al proveedor. Art. 62 LIVA: la nota de crédito resta y la de débito
  -- suma, en el período en que se reciben.
  tipos AS (
    SELECT * FROM (VALUES
      ('03', 'CCF',              1, true ),
      ('05', 'NOTA DE CRÉDITO', -1, true ),
      ('06', 'NOTA DE DÉBITO',   1, true ),
      ('01', 'FACTURA',          1, false),
      ('09', 'LIQUIDACIÓN',      1, false),
      ('07', 'COMPROBANTE DE RETENCIÓN', 1, false)
    ) AS t(tipo_dte, etiqueta, signo, da_credito)
  ),
  del_erp AS (
    SELECT 'registrada'::text AS origen,
           pr.fecha,
           coalesce(pr.documento_tipo, 'CCF') AS documento_tipo,
           pr.documento_numero,
           coalesce(upper(d.codigo_generacion::text), pr.documento_numero) AS documento_completo,
           pr.proveedor,
           nullif(btrim(coalesce(s.nrc, pm.nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(pm.nit, d.emisor_nit, '')), '') AS nit,
           coalesce(pr.subtotal, 0) - coalesce(pr.percepcion_iva, 0) AS gravadas,
           coalesce(pr.iva, 0) AS iva,
           coalesce(pr.total, 0) AS total,
           pr.percepcion_iva, pr.retencion_iva,
           1 AS signo,
           true AS da_credito,
           pm.clasificacion_estado, pm.iva_deducible,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path,
           -- La identidad fiscal del renglón, para contar repeticiones. NULL
           -- cuando no se sabe cuál documento es: preferimos no contar antes que
           -- contar mal (ver el encabezado).
           CASE WHEN d.id IS NOT NULL              THEN 'dte:'   || d.id::text
                WHEN pr.sello_recibido IS NOT NULL THEN 'sello:' || pr.sello_recibido
                ELSE NULL END AS clave_doc
      FROM public.purchase_receipts pr
      LEFT JOIN public.suppliers           s  ON s.id  = pr.supplier_id
      LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
      LEFT JOIN LATERAL (
        SELECT d.* FROM public.purchase_dte_documents d
         WHERE ( (pr.sello_recibido IS NOT NULL AND d.sello_recibido = pr.sello_recibido)
              OR upper(replace(replace(replace(btrim(pr.documento_numero),' ',''),'.',''),'O','0'))
                 IN (left(upper(d.codigo_generacion::text), 20),
                     left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                     upper(d.codigo_generacion::text)) )
           AND (pm.nit IS NULL OR d.emisor_nit = pm.nit)
           AND coalesce(d.invalidado, false) = false
         ORDER BY (d.sello_recibido = pr.sello_recibido) DESC NULLS LAST, d.id
         LIMIT 1
      ) d ON true
     WHERE pr.fecha BETWEEN p_desde AND p_hasta
       -- `estado` es NULL en 855 de 856 filas: `<> 'anulada'` las eliminaría a
       -- todas. Se pregunta por lo que SÍ se sabe.
       AND coalesce(pr.estado, '') <> 'anulada'
  ),
  solo_documento AS (
    SELECT 'solo_documento'::text AS origen,
           d.fecha_emision AS fecha,
           t.etiqueta AS documento_tipo,
           left(upper(d.codigo_generacion::text), 20) AS documento_numero,
           upper(d.codigo_generacion::text) AS documento_completo,
           d.emisor_nombre AS proveedor,
           nullif(btrim(coalesce(d.emisor_nrc, '')), '') AS nrc,
           nullif(btrim(coalesce(d.emisor_nit, '')), '') AS nit,
           coalesce(d.monto_total, 0) - coalesce(d.total_iva, 0) AS gravadas,
           coalesce(d.total_iva, 0) AS iva,
           coalesce(d.monto_total, 0) AS total,
           NULL::numeric AS percepcion_iva, NULL::numeric AS retencion_iva,
           t.signo, t.da_credito,
           pm.clasificacion_estado, pm.iva_deducible,
           d.id AS dte_id, d.tipo_dte, d.numero_control, d.json_path, d.pdf_path,
           -- Misma clave que del lado del ERP: si un documento se colara por los
           -- dos caminos, el aviso lo diría en vez de sumarlo dos veces callado.
           'dte:' || d.id::text AS clave_doc
      FROM public.purchase_dte_documents d
      JOIN tipos t ON t.tipo_dte = d.tipo_dte
      LEFT JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
     WHERE coalesce(d.invalidado, false) = false
       AND d.fecha_emision BETWEEN p_desde AND p_hasta
       -- Los tres caminos del «completo», idénticos, para que las dos pantallas
       -- no puedan discrepar sobre qué documento ya estaba registrado.
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc IN (left(upper(d.codigo_generacion::text), 20),
                                        left(replace(upper(d.codigo_generacion::text), '-', ''), 20),
                                        upper(d.codigo_generacion::text)))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                         JOIN public.proveedores_maestro pm2 ON pm2.supplier_id = pr.supplier_id
                        WHERE pm2.nit = d.emisor_nit
                          AND abs(pr.total - coalesce(d.monto_total, 0)) < 0.01
                          AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
  ),
  todo AS (SELECT * FROM del_erp UNION ALL SELECT * FROM solo_documento),
  -- El derecho a crédito, en un solo lugar y con su motivo. El orden de las
  -- ramas importa: primero el tipo de documento (la ley), después el proveedor.
  juzgado AS (
    SELECT t.*,
           CASE
             WHEN NOT t.da_credito                            THEN false
             WHEN t.clasificacion_estado IS DISTINCT FROM 'confirmada' THEN false
             WHEN t.iva_deducible IS NOT TRUE                 THEN false
             ELSE true
           END AS computa,
           CASE
             WHEN NOT t.da_credito
               THEN 'Este tipo de documento no da crédito fiscal (Art. 65 LIVA exige comprobante de crédito fiscal)'
             WHEN t.clasificacion_estado IS DISTINCT FROM 'confirmada'
               THEN 'Falta confirmar la deducibilidad de este proveedor'
             WHEN t.iva_deducible IS NOT TRUE
               THEN 'El proveedor está clasificado como no deducible'
           END AS motivo_txt
      FROM todo t
  )
  SELECT j.origen, j.fecha, j.documento_tipo, j.documento_numero, j.documento_completo,
         j.proveedor, j.nrc, j.nit,
         round((j.gravadas * j.signo)::numeric, 2),
         round((CASE WHEN j.computa THEN j.iva ELSE 0 END * j.signo)::numeric, 2),
         round((j.total * j.signo)::numeric, 2),
         j.percepcion_iva, j.retencion_iva,
         j.computa, j.motivo_txt,
         coalesce(j.clasificacion_estado, 'sin ficha'),
         j.dte_id, j.tipo_dte, j.numero_control, j.json_path, j.pdf_path,
         -- Cuántos renglones del libro son ESTE mismo documento. 1 es lo normal;
         -- 2 significa que el crédito fiscal se está contando dos veces.
         -- `PARTITION BY` sobre una clave nula juntaría a TODOS los sin
         -- identificar en un solo grupo gigante, así que esos se declaran 1.
         (CASE WHEN j.clave_doc IS NULL THEN 1
               ELSE count(*) OVER (PARTITION BY j.clave_doc) END)::integer
    FROM juzgado j, permitido p
   WHERE p.ok
   ORDER BY j.fecha, j.origen, j.documento_completo;
$function$;

COMMENT ON FUNCTION public.get_libro_compras_declarable(date, date) IS
  'Libro de compras con las reglas que deciden lo DECLARABLE: notas de crédito restan y de débito suman (Art. 62 LIVA), sólo el CCF de un proveedor con clasificación confirmada y deducible computa crédito fiscal (Art. 65), y nada se descarta en silencio — lo que no computa sale con su motivo. `veces_en_el_libro` > 1 avisa que el MISMO documento entró más de una vez y su crédito se está contando repetido (Art. 141 lit. b CT: un comprobante, un renglón). Sin parámetro de sucursal a propósito: el libro es por NRC y los documentos que sólo llegan por correo no tienen sucursal.';

REVOKE EXECUTE ON FUNCTION public.get_libro_compras_declarable(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_libro_compras_declarable(date, date) TO authenticated, service_role;
