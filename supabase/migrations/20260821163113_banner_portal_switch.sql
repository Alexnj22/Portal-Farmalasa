SET lock_timeout = '5s';

-- Aviso global del portal — la franja del tope de todas las pantallas.
--
-- Hasta hoy el texto vivía escrito en `ThemeMigrationRibbon.jsx` y era
-- PERMANENTE: para quitarlo o cambiarlo había que editar, commitear y
-- desplegar. Un aviso que se pone «cuando hace falta» no puede depender de un
-- despliegue: cuando hace falta ya es tarde.
--
-- Una sola fila (id = 1, con CHECK): no es una lista de avisos —para eso están
-- los Anuncios, que tienen audiencia y caducan—. Es LA franja, y sólo puede
-- haber una.
CREATE TABLE IF NOT EXISTS public.banner_portal (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    activo       boolean     NOT NULL DEFAULT false,
    texto        text        NOT NULL DEFAULT '',
    -- Opcional: lo que se lee en el teléfono. En 390px la frase larga se
    -- cortaba a media palabra («algunas pantallas se ven v…»), y un aviso
    -- interrumpido erosiona más confianza que el defecto que anuncia.
    texto_corto  text,
    variante     text        NOT NULL DEFAULT 'obra',
    cambiado_por uuid,
    cambiado_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT banner_portal_variante_chk
        CHECK (variante IN ('obra', 'aviso', 'problema', 'info', 'bien')),
    -- Un banner encendido y vacío es una franja de color sin explicación.
    CONSTRAINT banner_portal_texto_chk
        CHECK (NOT activo OR btrim(texto) <> '')
);

ALTER TABLE public.banner_portal ENABLE ROW LEVEL SECURITY;

-- Lo VE todo el mundo: es un aviso para todo el portal, no un dato de un
-- módulo. Escribirlo, en cambio, va sólo por la RPC de abajo.
DROP POLICY IF EXISTS banner_portal_select ON public.banner_portal;
CREATE POLICY banner_portal_select ON public.banner_portal
    FOR SELECT TO authenticated USING (true);

-- La fila nace APAGADA y con el texto que la franja venía mostrando fijo, para
-- que volver a encenderla reproduzca exactamente lo de antes sin escribir nada.
INSERT INTO public.banner_portal (id, activo, texto, texto_corto, variante)
VALUES (
    1, false,
    'Portal en construcción visual — algunas pantallas se ven distintas mientras avanza la migración de tema. Tus datos están correctos.',
    'En construcción visual · tus datos están correctos',
    'obra'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_banner_portal(
    p_activo      boolean,
    p_texto       text DEFAULT NULL,
    p_texto_corto text DEFAULT NULL,
    p_variante    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_texto    text;
    v_variante text;
    v_fila     public.banner_portal;
BEGIN
    IF NOT (SELECT auth_has_module_permission('maintenance', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    SELECT * INTO v_fila FROM public.banner_portal WHERE id = 1;

    -- NULL significa «no lo toques»: la pantalla puede mandar sólo el switch.
    v_texto    := coalesce(p_texto,    v_fila.texto);
    v_variante := coalesce(p_variante, v_fila.variante);

    IF v_variante NOT IN ('obra', 'aviso', 'problema', 'info', 'bien') THEN
        RAISE EXCEPTION 'VARIANTE_INVALIDA';
    END IF;

    IF p_activo AND btrim(coalesce(v_texto, '')) = '' THEN
        RAISE EXCEPTION 'TEXTO_VACIO';
    END IF;

    UPDATE public.banner_portal
       SET activo       = p_activo,
           texto        = btrim(v_texto),
           texto_corto  = CASE WHEN p_texto_corto IS NULL THEN texto_corto
                               ELSE nullif(btrim(p_texto_corto), '') END,
           variante     = v_variante,
           cambiado_por = (SELECT auth_employee_id()),
           cambiado_at  = now()
     WHERE id = 1
    RETURNING * INTO v_fila;

    RETURN to_jsonb(v_fila);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_banner_portal(boolean, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_banner_portal(boolean, text, text, text) TO authenticated, service_role;

-- Para que encenderlo aparezca en las pantallas ya abiertas, sin recargar. Es
-- una tabla de una fila que cambia casi nunca: el costo del canal es nulo y sin
-- él «cuando hace falta» significa «cuando cada uno vuelva a entrar».
ALTER PUBLICATION supabase_realtime ADD TABLE public.banner_portal;
