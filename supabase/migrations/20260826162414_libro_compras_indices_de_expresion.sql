SET lock_timeout = '5s';

-- Los dos libros de compras cruzan cada compra contra los documentos por TRES
-- formas normalizadas del código de generación, dentro de un `LEFT JOIN LATERAL`.
-- El índice único que ya existe sobre `codigo_generacion` no sirve para eso: la
-- consulta lo envuelve en `left(upper(...), 20)`, o sea una función sobre la
-- columna indexada. Resultado medido el 2026-08-26 sobre julio: un
-- `Seq Scan on purchase_dte_documents` ejecutado **467 veces** —una por compra—
-- que se lleva **142,815 de los 148,530 buffers**, el 96% del trabajo. La tabla
-- tiene 1,920 filas: son ~900,000 visitas de fila para resolver 467 renglones.
--
-- Estos cuatro índices son exactamente las cuatro expresiones que la consulta
-- compara. Medido con los índices puestos dentro de una transacción revertida,
-- mediana de 4 corridas:
--
--   get_libro_compras_completo     1,599 ms → 679 ms    (2.4x)
--   get_libro_compras_declarable   3,108 ms → 1,024 ms  (3.0x)
--
-- Pesan 376 kB entre los cuatro, sobre una tabla de 3.4 MB que recibió 13
-- inserciones en 17 horas — el costo de mantenerlos es despreciable.
--
-- **Un índice no puede cambiar el resultado de una consulta**, así que este
-- cambio no necesita la verificación columna por columna que sí necesitaría
-- reescribir el cuerpo. Esa reescritura sigue pendiente y es la que daría el
-- resto: el `OR` entre la rama del sello y la de los tres códigos impide un plan
-- estable por índice, y normalizar los documentos UNA vez para cruzarlos por
-- hash midió 671 → 457 ms sobre el paso de emparejado.
-- Detalle: docs/PLAN-PLANES-GENERICOS-2026-08-25.md

CREATE INDEX IF NOT EXISTS idx_pdd_sello_recibido
  ON public.purchase_dte_documents (sello_recibido)
  WHERE sello_recibido IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdd_cg_left20
  ON public.purchase_dte_documents (left(upper(codigo_generacion::text), 20));

CREATE INDEX IF NOT EXISTS idx_pdd_cg_left20_sin_guiones
  ON public.purchase_dte_documents (left(replace(upper(codigo_generacion::text), '-', ''), 20));

CREATE INDEX IF NOT EXISTS idx_pdd_cg_upper
  ON public.purchase_dte_documents (upper(codigo_generacion::text));

ANALYZE public.purchase_dte_documents;
