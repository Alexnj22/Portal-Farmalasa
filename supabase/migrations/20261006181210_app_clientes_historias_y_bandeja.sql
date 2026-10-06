-- App de clientes (2026-10-06, pedido del usuario):
--   · HISTORIAS: imágenes tipo «estados» (promociones, información) que el
--     portal publica y la app muestra en un carrusel arriba de Mis puntos.
--   · BANDEJA de notificaciones: los avisos que ya se le mandaron quedan para
--     verlos en la app (`app_cliente_avisos` + a dónde llevan + si se leyeron).
SET lock_timeout = '5s';

CREATE TABLE public.app_historias (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo       text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 60),
    texto        text CHECK (length(texto) <= 240),
    imagen_path  text NOT NULL,
    enlace       text CHECK (enlace IS NULL OR enlace ~ '^/'),
    boton        text CHECK (length(boton) <= 30),
    inicio       date NOT NULL DEFAULT current_date,
    fin          date NOT NULL,
    publicada    boolean NOT NULL DEFAULT false,
    orden        integer NOT NULL DEFAULT 0,
    creada_por   uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (fin >= inicio)
);
CREATE INDEX app_historias_vigentes_idx ON public.app_historias (publicada, fin);

ALTER TABLE public.app_historias ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_historias_select ON public.app_historias
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
CREATE POLICY app_historias_insert ON public.app_historias
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_historias_update ON public.app_historias
    FOR UPDATE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_historias_delete ON public.app_historias
    FOR DELETE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
REVOKE ALL ON public.app_historias FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_historias TO authenticated;
GRANT ALL ON public.app_historias TO service_role;

-- La bandeja: a dónde lleva cada aviso y cuándo se leyó.
ALTER TABLE public.app_cliente_avisos ADD COLUMN url text, ADD COLUMN leido_at timestamptz;
CREATE INDEX app_cliente_avisos_cliente_idx ON public.app_cliente_avisos (customer_id, created_at DESC);

-- Muestras de historias (sólo para la ficha de prueba, como las demás).
ALTER TABLE public.app_cliente_muestras DROP CONSTRAINT app_cliente_muestras_tipo_check;
ALTER TABLE public.app_cliente_muestras ADD CONSTRAINT app_cliente_muestras_tipo_check
  CHECK (tipo IN ('oferta', 'inyeccion', 'vencimiento', 'cumpleanos', 'historia'));
