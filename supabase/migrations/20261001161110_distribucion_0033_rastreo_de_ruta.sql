-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0033 — rastreo de la ruta en segundo plano
-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido del usuario (2026-10-01): «aunque esté en segundo plano, ¿siempre se
-- actualizará si está en ruta? — sí, así lo quiero». La app (Capacitor) sigue
-- la posición desde «Iniciar ruta» hasta «Terminar ruta», con la pantalla
-- apagada, usando la misma pieza que el conductor de pedidos
-- (`seguirPosicion`, plugin BackgroundGeolocation). En el navegador no se
-- rastrea nada.
--
-- Un punto por minuto como máximo (la función descarta lo que llega antes):
-- una jornada de 9 horas son ~540 filas por vendedor. Es historial OPERATIVO,
-- no de negocio: se purga a los 90 días, y la purga va dentro de la misma
-- escritura —acotada al vendedor y con índice— en vez de un cron más que
-- declarar y vigilar.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_rastreo (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendedor_id uuid NOT NULL REFERENCES public.employees(id),
    lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
    precision_m real,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_rastreo_vendedor ON public.dist_rastreo (vendedor_id, created_at DESC);

ALTER TABLE public.dist_rastreo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_rastreo_select ON public.dist_rastreo;
-- El propio recorrido, o el de todos para quien administra.
CREATE POLICY dist_rastreo_select ON public.dist_rastreo FOR SELECT TO authenticated
    USING (vendedor_id = (SELECT public.auth_employee_id())
           OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_rastreo FROM anon, authenticated;
GRANT SELECT ON public.dist_rastreo TO authenticated;
GRANT ALL ON public.dist_rastreo TO service_role;

-- Anota un punto de quien llama. Nadie anota por otro: la firma sale de
-- auth_employee_id(), no de un parámetro.
CREATE OR REPLACE FUNCTION public.dist_registrar_posicion(p_lat double precision, p_lng double precision, p_precision real DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_yo uuid := public.auth_employee_id();
BEGIN
    IF v_yo IS NULL OR NOT public.auth_can_edit_any(ARRAY['distribucion']) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no puedes registrar ruta en Distribución';
    END IF;
    -- Un punto por minuto: lo que llega antes no aporta y llena la tabla.
    IF EXISTS (SELECT 1 FROM public.dist_rastreo
                WHERE vendedor_id = v_yo AND created_at > now() - interval '50 seconds') THEN
        RETURN false;
    END IF;
    INSERT INTO public.dist_rastreo (vendedor_id, lat, lng, precision_m) VALUES (v_yo, p_lat, p_lng, p_precision);
    -- Retención de 90 días, de a poco y sólo de este vendedor.
    DELETE FROM public.dist_rastreo
     WHERE id IN (SELECT id FROM public.dist_rastreo
                   WHERE vendedor_id = v_yo AND created_at < now() - interval '90 days'
                   ORDER BY created_at LIMIT 500);
    RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_registrar_posicion(double precision, double precision, real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_registrar_posicion(double precision, double precision, real) TO authenticated, service_role;

-- El recorrido de un día (hora de El Salvador): la última posición y los
-- puntos en orden. INVOKER: el RLS decide (el propio, o todos si administra).
CREATE OR REPLACE FUNCTION public.dist_recorrido(p_vendedor uuid, p_fecha date)
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
    SELECT json_build_object(
        'ultima', (SELECT json_build_object('lat', r.lat, 'lng', r.lng, 'at', r.created_at)
                     FROM public.dist_rastreo r
                    WHERE r.vendedor_id = p_vendedor
                      AND (r.created_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
                    ORDER BY r.created_at DESC LIMIT 1),
        'puntos', (SELECT coalesce(json_agg(json_build_array(r.lat, r.lng) ORDER BY r.created_at), '[]'::json)
                     FROM public.dist_rastreo r
                    WHERE r.vendedor_id = p_vendedor
                      AND r.created_at >= (p_fecha::timestamp AT TIME ZONE 'America/El_Salvador')
                      AND r.created_at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/El_Salvador')));
$$;
REVOKE EXECUTE ON FUNCTION public.dist_recorrido(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_recorrido(uuid, date) TO authenticated, service_role;
