-- La cola de impresión de cada sala (2026-08-16).
--
-- El problema que resuelve: `imprimirDocumento` manda el ticket a
-- `http://localhost` — la computadora que tiene el navegador abierto. No hay
-- ningún parámetro de sucursal en ese camino y **no puede haberlo**: apuntar a
-- la IP de la caja es contenido mixto y el navegador lo corta; la exención vale
-- sólo para `localhost` y no se hereda a una IP.
--
-- Consecuencias que se veían en el uso real: la sala confirma un corte desde el
-- teléfono (que es donde llega el aviso) y no hay `localhost` que conteste;
-- gerencia resuelve una diferencia desde la oficina y el comprobante que debía
-- firmarse en la sala sale impreso en la oficina.
--
-- El diseño es cola + agente: el portal deja el papel acá con su sucursal, y un
-- programa que corre en la caja pregunta cada dos segundos y lo tubea a
-- `lp -d pos-80 -o raw` — el único camino que ya sacó papel en esa impresora.
--
-- Gana cuatro cosas de una vez:
--   · funciona desde el teléfono y desde cualquier computadora,
--   · **cierra el lazo del acuse**: hoy `ok` significa «recibido», nunca «salió
--     papel»; el agente contesta si el comando funcionó,
--   · no expone la impresora a la red,
--   · sobrevive a un formateo de la caja, porque el agente es nuestro (los
--     `print*.php` del sistema de facturación no están en ningún servidor: viven
--     sólo en el disco de cada computadora de sala).
--
-- El agente NUNCA ve la llave de servicio: se identifica con dispositivo +
-- token, el mismo patrón que `kiosk_devices`.
--
-- NOTA: `encolar_impresion` y `reclamar_impresion` se corrigieron enseguida en
-- 20260816022059 (tope de pendientes) y 20260816022420 (el `id` ambiguo que
-- destapó la prueba del circuito). Los cuerpos vivos son los de allá.
SET lock_timeout = '5s';

-- ── El dispositivo: una caja concreta de una sala concreta ─────────────────
CREATE TABLE IF NOT EXISTS public.impresion_dispositivos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token        uuid NOT NULL DEFAULT gen_random_uuid(),
    branch_id    bigint NOT NULL REFERENCES public.branches(id),
    nombre       text NOT NULL,
    impresora    text NOT NULL DEFAULT 'pos-80',
    activo       boolean NOT NULL DEFAULT true,
    ultimo_latido timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid REFERENCES public.employees(id)
);

CREATE INDEX IF NOT EXISTS idx_impresion_dispositivos_sala ON public.impresion_dispositivos(branch_id) WHERE activo;

ALTER TABLE public.impresion_dispositivos ENABLE ROW LEVEL SECURITY;

-- El token NO se publica: la lista sirve para saber qué cajas hay y si dan
-- señales de vida, no para copiar credenciales. Se ve una sola vez, al crearla.
DROP POLICY IF EXISTS impresion_dispositivos_select ON public.impresion_dispositivos;
CREATE POLICY impresion_dispositivos_select ON public.impresion_dispositivos
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('impresion','can_view')));

REVOKE ALL ON public.impresion_dispositivos FROM anon, authenticated;
GRANT SELECT (id, branch_id, nombre, impresora, activo, ultimo_latido, created_at, created_by)
    ON public.impresion_dispositivos TO authenticated;

-- ── La cola ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cola_impresion (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id    bigint NOT NULL REFERENCES public.branches(id),
    titulo       text NOT NULL,
    -- El texto YA maquetado, con sus códigos de impresora adentro. La
    -- maquetación vive en `ticketPrint.js` y el agente es un caño: si supiera
    -- de columnas habría dos maquetadores que mantener parecidos.
    contenido    text NOT NULL,
    estado       text NOT NULL DEFAULT 'PENDIENTE'
                 CHECK (estado IN ('PENDIENTE','IMPRIMIENDO','IMPRESO','ERROR')),
    intentos     integer NOT NULL DEFAULT 0,
    error        text,
    dispositivo  uuid REFERENCES public.impresion_dispositivos(id),
    creado_por   uuid REFERENCES public.employees(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    reclamado_at timestamptz,
    impreso_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cola_impresion_pendiente
    ON public.cola_impresion(branch_id, id) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_cola_impresion_reciente
    ON public.cola_impresion(branch_id, created_at DESC);

ALTER TABLE public.cola_impresion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cola_impresion_select ON public.cola_impresion;
CREATE POLICY cola_impresion_select ON public.cola_impresion
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('impresion','can_view'))
           AND (((SELECT auth_module_scope('impresion')) = 'ALL')
                OR branch_id = (SELECT auth_employee_branch_id())));

DROP POLICY IF EXISTS bloqueo_global ON public.cola_impresion;
CREATE POLICY bloqueo_global ON public.cola_impresion
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));

REVOKE ALL ON public.cola_impresion FROM anon, authenticated;
GRANT SELECT ON public.cola_impresion TO authenticated;

-- ── El agente reclama UN trabajo ───────────────────────────────────────────
-- (cuerpo vivo en 20260816022420)
CREATE OR REPLACE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid)
 RETURNS TABLE(id bigint, titulo text, contenido text, impresora text)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_sala bigint; v_impresora text;
BEGIN
    SELECT d.branch_id, d.impresora INTO v_sala, v_impresora
      FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;
    UPDATE public.impresion_dispositivos d SET ultimo_latido = now() WHERE d.id = p_device;
    RETURN QUERY
    UPDATE public.cola_impresion c
       SET estado = 'IMPRIMIENDO', reclamado_at = now(),
           intentos = c.intentos + 1, dispositivo = p_device
     WHERE c.id = (SELECT x.id FROM public.cola_impresion x
                    WHERE x.branch_id = v_sala AND x.estado = 'PENDIENTE'
                    ORDER BY x.id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING c.id, c.titulo, c.contenido, v_impresora;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) TO anon, authenticated, service_role;

-- ── Y contesta si salió papel ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_impresion(
    p_device uuid, p_token uuid, p_id bigint, p_ok boolean, p_error text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_sala bigint;
BEGIN
    SELECT d.branch_id INTO v_sala FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    UPDATE public.cola_impresion
       SET estado = CASE WHEN p_ok THEN 'IMPRESO' ELSE 'PENDIENTE' END,
           impreso_at = CASE WHEN p_ok THEN now() END,
           error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 400) END,
           reclamado_at = NULL
     WHERE id = p_id AND branch_id = v_sala;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_impresion(uuid, uuid, bigint, boolean, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.confirmar_impresion(uuid, uuid, bigint, boolean, text) TO anon, authenticated, service_role;

-- ── Registrar una caja ─────────────────────────────────────────────────────
--
-- Devuelve el token UNA sola vez: la policy de la tabla no lo publica, así que
-- si se pierde hay que registrar la caja de nuevo. Es a propósito — un token
-- que se puede volver a leer desde cualquier pantalla es un token que viaja.
CREATE OR REPLACE FUNCTION public.registrar_caja_de_impresion(
    p_branch_id bigint, p_nombre text, p_impresora text DEFAULT 'pos-80')
 RETURNS TABLE(id uuid, token uuid)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sala o el nombre de la caja.';
    END IF;

    RETURN QUERY
    INSERT INTO public.impresion_dispositivos (branch_id, nombre, impresora, created_by)
    VALUES (p_branch_id, btrim(p_nombre), coalesce(nullif(btrim(p_impresora),''), 'pos-80'),
            (SELECT auth_employee_id()))
    RETURNING impresion_dispositivos.id, impresion_dispositivos.token;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_caja_de_impresion(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_caja_de_impresion(bigint, text, text) TO authenticated, service_role;

-- ── Retención: la cola no es un archivo ────────────────────────────────────
-- Regla 7 del proyecto: toda tabla de log define su purga desde el día 1.
CREATE OR REPLACE FUNCTION public.purgar_cola_impresion()
 RETURNS integer
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_n integer;
BEGIN
    DELETE FROM public.cola_impresion
     WHERE created_at < now() - interval '14 days' AND estado IN ('IMPRESO','ERROR');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purgar_cola_impresion() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purgar_cola_impresion() TO service_role;

SELECT cron.schedule('purgar-cola-impresion-diario', '25 9 * * *',
                     $cron$SELECT public.purgar_cola_impresion()$cron$);

COMMENT ON TABLE public.cola_impresion IS
 'Papel esperando salir en la caja de una sala. Lo deja el portal desde cualquier dispositivo; lo reclama el agente que corre en esa caja. El contenido ya viene maquetado: el agente es un cano.';
COMMENT ON TABLE public.impresion_dispositivos IS
 'Una caja con ticketera. El token es su credencial y NO se publica por la policy: se ve una sola vez, al registrarla.';
