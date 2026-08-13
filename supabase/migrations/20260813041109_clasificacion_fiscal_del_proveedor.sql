SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Clasificación fiscal del proveedor — Art. 65 LIVA + catálogos del anexo F-07 v14
--
-- POR QUÉ. El libro de compras hoy manda `1;1;2;5` fijo en TODAS las filas
-- (gravada, costo, comercio, costo de artículos comprados). Es correcto para la
-- mercadería y falso para el teléfono, el banco y el alquiler, que son GASTO y no
-- costo. Y la deducibilidad del Art. 65 tampoco se puede decidir documento por
-- documento: se decide una vez por proveedor.
--
-- Medido el 2026-08-12: 1,291 CCF desde junio de 99 proveedores distintos. Son
-- 99 decisiones que cubren 1,291 documentos, y todos los que vengan después.
--
-- EL ESTADO NO TIENE DEFAULT «SÍ». `iva_deducible` nace NULL y
-- `clasificacion_estado` nace 'pendiente' a propósito: un proveedor sin clasificar
-- NO entra al libro como deducible ni como no deducible — entra a la lista de
-- pendientes, visible. Es la regla de CLAUDE.md sobre el `? :` que convierte «no
-- encontré» en un default silencioso.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.proveedores_maestro
  ADD COLUMN IF NOT EXISTS iva_deducible            boolean,
  ADD COLUMN IF NOT EXISTS f07_clasificacion        smallint,
  ADD COLUMN IF NOT EXISTS f07_sector               smallint,
  ADD COLUMN IF NOT EXISTS f07_tipo_costo_gasto     smallint,
  ADD COLUMN IF NOT EXISTS f07_tipo_operacion       smallint,
  ADD COLUMN IF NOT EXISTS clasificacion_base_legal text,
  ADD COLUMN IF NOT EXISTS clasificacion_nota       text,
  ADD COLUMN IF NOT EXISTS clasificacion_estado     text NOT NULL DEFAULT 'pendiente',
  -- uuid, no bigint: `employees.id` es uuid y es la convención de todas las
  -- columnas `*_por` del proyecto (conteos_inventario.aprobado_por,
  -- pedidos.revisado_por, metas_gasto.creado_por). Lo atrapó el ROLLBACK.
  ADD COLUMN IF NOT EXISTS clasificado_por          uuid,
  ADD COLUMN IF NOT EXISTS clasificado_at           timestamptz;

-- Los tres estados, y el único que el libro puede usar es 'confirmada'.
ALTER TABLE public.proveedores_maestro
  DROP CONSTRAINT IF EXISTS proveedores_maestro_clasificacion_estado_chk;
ALTER TABLE public.proveedores_maestro
  ADD CONSTRAINT proveedores_maestro_clasificacion_estado_chk
  CHECK (clasificacion_estado IN ('pendiente','propuesta','confirmada'));

-- Catálogos del manual del F-07 v14 §3.
ALTER TABLE public.proveedores_maestro
  DROP CONSTRAINT IF EXISTS proveedores_maestro_f07_catalogos_chk;
ALTER TABLE public.proveedores_maestro
  ADD CONSTRAINT proveedores_maestro_f07_catalogos_chk
  CHECK (
        (f07_clasificacion    IS NULL OR f07_clasificacion    IN (1,2))
    AND (f07_sector           IS NULL OR f07_sector           IN (1,2,3,4))
    AND (f07_tipo_operacion   IS NULL OR f07_tipo_operacion   IN (1,2,3,4))
    AND (f07_tipo_costo_gasto IS NULL OR f07_tipo_costo_gasto IN (1,2,3,4,5,6,7,8,9))
  );

-- La matriz de la página 21 del manual: con Costo sólo se admiten 4-7, con Gasto
-- sólo 1-3. Vivía en prosa; acá la hace cumplir la base.
ALTER TABLE public.proveedores_maestro
  DROP CONSTRAINT IF EXISTS proveedores_maestro_f07_matriz_chk;
ALTER TABLE public.proveedores_maestro
  ADD CONSTRAINT proveedores_maestro_f07_matriz_chk
  CHECK (
    f07_clasificacion IS NULL OR f07_tipo_costo_gasto IS NULL
    OR f07_tipo_costo_gasto IN (8,9)                                  -- comodines
    OR (f07_clasificacion = 1 AND f07_tipo_costo_gasto BETWEEN 4 AND 7)
    OR (f07_clasificacion = 2 AND f07_tipo_costo_gasto BETWEEN 1 AND 3)
  );

-- Una fila confirmada tiene que tener decidida la deducibilidad. Sin esto,
-- 'confirmada' con `iva_deducible` NULL sería una confirmación vacía.
ALTER TABLE public.proveedores_maestro
  DROP CONSTRAINT IF EXISTS proveedores_maestro_confirmada_decide_chk;
ALTER TABLE public.proveedores_maestro
  ADD CONSTRAINT proveedores_maestro_confirmada_decide_chk
  CHECK (clasificacion_estado <> 'confirmada' OR iva_deducible IS NOT NULL);

ALTER TABLE public.proveedores_maestro
  DROP CONSTRAINT IF EXISTS proveedores_maestro_clasificado_por_fkey;
ALTER TABLE public.proveedores_maestro
  ADD CONSTRAINT proveedores_maestro_clasificado_por_fkey
  FOREIGN KEY (clasificado_por) REFERENCES public.employees(id) ON DELETE SET NULL;
-- Sin índice a propósito: es columna de puro audit sobre una tabla de 162 filas
-- (regla 2 de «Estructura BD» en CLAUDE.md).

COMMENT ON COLUMN public.proveedores_maestro.iva_deducible IS
  'Art. 65 LIVA. NULL = todavía no se decidió. NUNCA leer NULL como false.';
COMMENT ON COLUMN public.proveedores_maestro.clasificacion_estado IS
  'pendiente = nadie la miró · propuesta = la derivó el sistema del CIIU · confirmada = la firmó el contador. El libro sólo usa confirmada.';

-- ─────────────────────────────────────────────────────────────────────────────
-- La PROPUESTA, derivada del código de actividad CIIU que ya trae cada ficha.
--
-- No es una lista escrita a mano: sale de `cod_actividad`, que está poblado en
-- los 104 proveedores con documentos. Cada regla lleva el artículo que la
-- respalda, y las que la ley excluye o condiciona quedan en 'pendiente' CON EL
-- MOTIVO ESCRITO — no se proponen como deducibles.
--
-- Idempotente: sólo toca filas en 'pendiente', así que nunca pisa una confirmación.
-- ─────────────────────────────────────────────────────────────────────────────

WITH regla(cods, deducible, clasif, sector, tipo, base, nota) AS (VALUES
  -- Art. 65 nº1 — bienes destinados al activo realizable (la mercadería)
  (ARRAY['46484','46491','46482','46595','46900','47739','47190','21001'],
   true, 1::smallint, 2::smallint, 5::smallint,
   'Art. 65 nº1 LIVA — adquisición de bienes muebles destinados al activo realizable', NULL),

  -- Art. 65 nº4 — gastos generales que la ley EJEMPLIFICA por nombre
  (ARRAY['61101','61201','61900'],
   true, 2::smallint, 4::smallint, 2::smallint,
   'Art. 65 nº4 LIVA — gastos generales del giro; la ley nombra «teléfono»', NULL),
  (ARRAY['35103'],
   true, 2::smallint, 4::smallint, 2::smallint,
   'Art. 65 nº4 LIVA — la ley nombra «energía eléctrica»', NULL),
  (ARRAY['36000'],
   true, 2::smallint, 4::smallint, 2::smallint,
   'Art. 65 nº4 LIVA — la ley nombra «agua» (suministro público)', NULL),

  -- Art. 65 nº3 — servicios utilizados en el giro
  (ARRAY['64190','64199','66190'],
   true, 2::smallint, 4::smallint, 3::smallint,
   'Art. 65 nº3 LIVA — servicios utilizados en el giro (comisiones y servicios financieros)', NULL),
  (ARRAY['68109','68200'],
   true, 2::smallint, 4::smallint, 1::smallint,
   'Art. 65 nº3 LIVA — arrendamiento del local donde se realiza el giro', NULL),
  (ARRAY['01612','62090'],
   true, 2::smallint, 4::smallint, 2::smallint,
   'Art. 65 nº3 LIVA — servicios utilizados en el giro', NULL),

  -- ── Lo que la ley EXCLUYE o CONDICIONA: queda pendiente, con el motivo ──
  (ARRAY['47300','45301','45402'],
   NULL, NULL::smallint, NULL::smallint, NULL::smallint,
   'Art. 65-A c) LIVA',
   'Combustible y repuestos de vehículos: sólo deducible si el vehículo es ESTRICTAMENTE INDISPENSABLE para el giro. Lo decide el contador.'),
  (ARRAY['47522','46632','47523','23990'],
   NULL, NULL::smallint, NULL::smallint, NULL::smallint,
   'Art. 65 nº3 LIVA (exclusión)',
   'Ferretería y pinturas: el nº3 EXCLUYE expresamente construcción, remodelación o modificación de inmuebles. Deducible sólo si es mantenimiento que no sea obra sobre el inmueble.'),
  (ARRAY['46301','46375','10799','47223','47224','56101','47111','11042'],
   NULL, NULL::smallint, NULL::smallint, NULL::smallint,
   'Art. 65-A a) LIVA',
   'Alimentos y bebidas: NO deducible si el giro no es la venta de víveres. Deducible sólo si se revenden y generan débito fiscal.'),
  (ARRAY['47411'],
   NULL, NULL::smallint, NULL::smallint, NULL::smallint,
   'Art. 65 nº2 LIVA',
   'Equipo de cómputo: deducible como activo fijo sólo si conserva su individualidad y no se incorpora a un inmueble.'),
  (ARRAY['96092','86100','60299'],
   NULL, NULL::smallint, NULL::smallint, NULL::smallint,
   'Art. 65 nº3 LIVA',
   'Actividad demasiado genérica en el CIIU para derivar la deducibilidad. Hay que mirar qué servicio presta.')
)
UPDATE public.proveedores_maestro pm
   SET iva_deducible            = r.deducible,
       f07_clasificacion        = r.clasif,
       f07_sector               = r.sector,
       f07_tipo_costo_gasto     = r.tipo,
       f07_tipo_operacion       = CASE WHEN r.deducible THEN 1::smallint ELSE NULL END,
       clasificacion_base_legal = r.base,
       clasificacion_nota       = r.nota,
       clasificacion_estado     = CASE WHEN r.deducible THEN 'propuesta' ELSE 'pendiente' END
  FROM regla r
 WHERE pm.cod_actividad = ANY (r.cods)
   AND pm.clasificacion_estado = 'pendiente';
