-- Corrección: tipo_dte '09' es "Documento Contable de Liquidación" (catálogo
-- CAT-002 oficial, src/utils/dteTypes.js), no "Nota de Remisión" — misma
-- familia que 08, que el plan ya excluye de auto-crear proveedor (el emisor
-- suele ser un intermediario/cliente reportando, no un proveedor real).
-- Se había incluido por error en el backfill/sync inicial. Afecta 2
-- proveedores (BANCO PROMERICA, Servicios Financieros) que también tienen
-- documentos legítimos (01/03/05/06) — no se borran, solo se recalculan sus
-- contadores excluyendo los docs tipo 09, y se desvinculan esos 115 documentos.
SET lock_timeout = '5s';

WITH affected AS (
  SELECT DISTINCT proveedor_id
  FROM public.purchase_dte_documents
  WHERE tipo_dte = '09' AND proveedor_id IS NOT NULL
),
recalced AS (
  SELECT d.proveedor_id,
         count(*) AS docs_count,
         min(d.fecha_emision) AS primera_vez_visto,
         max(d.fecha_emision) AS ultima_vez_visto
  FROM public.purchase_dte_documents d
  JOIN affected a ON a.proveedor_id = d.proveedor_id
  WHERE d.tipo_dte <> '09'
  GROUP BY d.proveedor_id
)
UPDATE public.proveedores_maestro p
SET docs_count = r.docs_count,
    primera_vez_visto = r.primera_vez_visto,
    ultima_vez_visto = r.ultima_vez_visto,
    updated_at = now()
FROM recalced r
WHERE p.id = r.proveedor_id;

UPDATE public.purchase_dte_documents SET proveedor_id = NULL WHERE tipo_dte = '09';
