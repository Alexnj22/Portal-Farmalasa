SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Dos libros bajo receta, no uno.
--
-- Hasta hoy el libro se armaba con `WHERE p.es_antibiotico`, la casilla que el
-- ERP sincroniza. Esa casilla significa «bajo receta» y NO «antibiótico»: la
-- RANITIDINA 50MG AMPOLLA la tiene, y por eso el libro de antibióticos llevaba
-- 21 renglones (el 5%) de un antiácido.
--
-- Eso rompe por construcción el ítem 3.4 de la Guía de Verificación de BPAD
-- —CRÍTICO—: «¿Las existencias físicas de ANTIBIÓTICOS concuerdan con las
-- detalladas en el registro?». Con algo que no es antibiótico adentro, ese
-- cuadre no puede cerrar, y no porque falte un dato.
--
-- ── Por qué una tabla y no una columna en `products` ───────────────────────
-- `products` la reescribe `sync-products` desde el ERP en cada corrida
-- (`es_antibiotico: p.es_antibiotico ?? false`), así que cualquier corrección
-- local se pierde en la siguiente pasada, sin error. Y `products` es tabla
-- caliente: un ALTER pide ACCESS EXCLUSIVE con los crons de inventario y ventas
-- escribiendo cada minuto — que es exactamente el outage del 2026-07-08.
--
-- Una tabla aparte resuelve las dos cosas y agrega la que más falta: el MOTIVO
-- escrito. Un inspector que pregunte «¿por qué esta ranitidina no está en el
-- libro de antibióticos?» tiene la respuesta en la fila, no en la memoria de
-- quien la marcó.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dispensacion_clases (
    erp_product_id integer PRIMARY KEY
        REFERENCES public.products(id) ON DELETE CASCADE,
    clase          text NOT NULL CHECK (clase IN ('antibiotico', 'bajo_receta')),
    motivo         text NOT NULL CHECK (btrim(motivo) <> ''),
    definido_por   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dispensacion_clases IS
    'De qué libro es cada producto. Manda sobre products.es_antibiotico, que lo '
    'reescribe el ERP. NULL (fila ausente) = decide es_antibiotico.';

CREATE INDEX IF NOT EXISTS dispensacion_clases_definido_por_idx
    ON public.dispensacion_clases (definido_por);

ALTER TABLE public.dispensacion_clases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispensacion_clases_select ON public.dispensacion_clases;
CREATE POLICY dispensacion_clases_select ON public.dispensacion_clases
    FOR SELECT TO authenticated USING (true);

-- Escritura: quien configura las bitácoras. `(SELECT …)` obligatorio — sin el
-- initplan, Postgres evalúa la función POR FILA (incidente 2026-07-08).
DROP POLICY IF EXISTS dispensacion_clases_write ON public.dispensacion_clases;
CREATE POLICY dispensacion_clases_write ON public.dispensacion_clases
    FOR ALL TO authenticated
    USING      ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['bitacoras_configurar'])));

REVOKE ALL ON public.dispensacion_clases FROM PUBLIC, anon;
GRANT SELECT ON public.dispensacion_clases TO authenticated;
GRANT ALL    ON public.dispensacion_clases TO service_role;

-- ── El resolvedor: una sola respuesta a «¿de qué libro es este producto?» ──
CREATE OR REPLACE FUNCTION public.clase_de_dispensacion(p_erp_product_id integer)
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT coalesce(
        (SELECT dc.clase FROM public.dispensacion_clases dc
          WHERE dc.erp_product_id = p_erp_product_id),
        (SELECT CASE WHEN p.es_antibiotico THEN 'antibiotico' END
           FROM public.products p WHERE p.id = p_erp_product_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.clase_de_dispensacion(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clase_de_dispensacion(integer) TO authenticated, service_role;

-- ── Semilla ────────────────────────────────────────────────────────────────
-- Sólo lo medido. La lista larga de productos con «(R)» en el nombre NO entra
-- acá a propósito: sumarlos duplica el trabajo de la sala y es una decisión de
-- la empresa, no una exigencia de la norma. Se agregan con un INSERT cuando se
-- decida.

INSERT INTO public.dispensacion_clases (erp_product_id, clase, motivo)
SELECT p.id, 'bajo_receta',
       'Inyectable bajo receta pero NO es antibiotico: el ERP lo marca es_antibiotico '
    || 'y eso metia 21 renglones en el libro del capitulo 3, donde el item 3.4 exige '
    || 'que las existencias fisicas DE ANTIBIOTICOS cuadren contra el registro.'
  FROM public.products p
 WHERE p.nombre ILIKE 'RANITIDINA%AMPOLLA%'
ON CONFLICT (erp_product_id) DO NOTHING;

INSERT INTO public.dispensacion_clases (erp_product_id, clase, motivo)
SELECT p.id, 'antibiotico',
       'Gentamicina inyectable. Todo antibiotico INYECTABLE exige receta (DNM, jul-2015) '
    || 'y sus tres hermanas de marca ya estaban marcadas: esta se quedo afuera con 30 ventas.'
  FROM public.products p
 WHERE p.nombre ILIKE 'GENTAMICINA%2 ML%VIJOSA%'
ON CONFLICT (erp_product_id) DO NOTHING;

INSERT INTO public.dispensacion_clases (erp_product_id, clase, motivo)
SELECT p.id, 'antibiotico',
       'Una de las seis moleculas que exigen receta cualquiera sea la via (DNM, 2018). '
    || 'Hoy esta inactiva en el catalogo: sin esta fila, el dia que se reactive entra al '
    || 'mostrador invisible para el libro.'
  FROM public.products p
 WHERE p.nombre IN ('AVELOX 400MG X 20 COMP.',
                    'AZITROMICINA 200MG X 30 ML SM',
                    'CLARITROMICINA 125 MG X 60 ML MK')
ON CONFLICT (erp_product_id) DO NOTHING;
