SET lock_timeout = '5s';

-- Los banners de la app de clientes (2026-10-07): imágenes horizontales que
-- se pasan con el dedo arriba del catálogo. Se suben desde el portal (Ofertas
-- para clientes → Banners), igual que las historias pero sin el plazo de 24 h:
-- tienen fechas. Formato: 1200 × 500 px (2.4 : 1). Sin banners vigentes, la app
-- muestra las ofertas publicadas.
CREATE TABLE public.app_banners (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo         text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 60),
    titulo_visible boolean NOT NULL DEFAULT false,
    imagen_path    text NOT NULL,
    oferta_id      uuid REFERENCES public.ofertas_clientes(id) ON DELETE SET NULL,
    enlace         text CHECK (enlace IS NULL OR enlace ~ '^/'),
    inicio         date NOT NULL DEFAULT current_date,
    fin            date NOT NULL,
    publicada      boolean NOT NULL DEFAULT false,
    orden          integer NOT NULL DEFAULT 0,
    creada_por     uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (fin >= inicio)
);
CREATE INDEX app_banners_vigentes_idx ON public.app_banners (publicada, fin);
CREATE INDEX app_banners_oferta_idx ON public.app_banners (oferta_id);

ALTER TABLE public.app_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_banners_select ON public.app_banners
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
CREATE POLICY app_banners_insert ON public.app_banners
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_banners_update ON public.app_banners
    FOR UPDATE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_banners_delete ON public.app_banners
    FOR DELETE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
