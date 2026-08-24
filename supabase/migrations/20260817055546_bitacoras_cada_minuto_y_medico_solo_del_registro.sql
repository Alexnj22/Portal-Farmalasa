SET lock_timeout = '5s';

-- ── 1 · El libro se actualiza cada minuto ──────────────────────────────────
-- La venta llega al portal en menos de un minuto; que el renglon tarde cinco
-- mas rompe el «lo completo ahora que me acuerdo». El barrido es barato: sobre
-- 3 dias es un indice y un NOT EXISTS, y cuando no hay nada nuevo no escribe.
-- ── Con guarda, porque `cron.unschedule` LANZA si el trabajo no existe ──────
-- Descubierto el 2026-08-24 al rehacer el entorno de pruebas: la creación del
-- branch replica la historia completa sobre una base vacía y se detuvo acá. El
-- trabajo `bitacora-dispensaciones-5min` no existe en una base nueva, así que esta línea aborta y
-- **toda la historia posterior deja de poder reproducirse** — 212 migraciones
-- que ya no llegan. No es sólo el branch: es que el historial no es replicable,
-- que es lo que uno necesita el día que hay que reconstruir.
--
-- El patrón correcto ya se usaba en cinco migraciones de este mismo repo; a
-- ésta le faltaba. Hoy lo vigila `gate:migrations`.
SELECT cron.unschedule('bitacora-dispensaciones-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bitacora-dispensaciones-5min');

SELECT cron.schedule(
    'bitacora-dispensaciones-1min',
    '* 12-23,0-5 * * *',
    $cron$ SELECT public.sincronizar_bitacora_dispensaciones(
        (now() AT TIME ZONE 'America/El_Salvador')::date - 3,
        (now() AT TIME ZONE 'America/El_Salvador')::date
    ) $cron$
);

-- ── 2 · Un medico solo entra si el Consejo lo confirma ─────────────────────
--
-- Decision del usuario (2026-08-17): «si agregamos un dato irreal seria falso;
-- si no esta ahi, no existe». Un prescriptor inventado en el libro es peor que
-- un renglon incompleto: el incompleto se ve y se corrige, el inventado se lee
-- como un dato bueno y sostiene una dispensacion que quiza nadie receto.
--
-- La guarda vive aca y no solo en la pantalla: si el unico freno fuera el
-- formulario, alcanzaria con abrir la consola. Los medicos ya cargados a mano
-- antes de esta regla siguen sirviendo — se reusan, no se vuelven a crear.
CREATE OR REPLACE FUNCTION public.buscar_o_crear_medico(
    p_numero_junta text,
    p_nombre       text,
    p_junta        text DEFAULT 'P01',
    p_carrera      text DEFAULT NULL,
    p_origen       text DEFAULT 'manual',
    p_verificado   boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_id  bigint;
    v_num text := btrim(coalesce(p_numero_junta, ''));
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo no puede completar el libro.' USING ERRCODE = '42501';
    END IF;
    IF v_num = '' THEN
        RAISE EXCEPTION 'Falta el numero de junta del medico.' USING ERRCODE = 'P0001';
    END IF;

    IF p_junta NOT IN ('P01', 'P02', 'P07') THEN
        RAISE EXCEPTION 'Esa junta no corresponde a un profesional que pueda prescribir.' USING ERRCODE = 'P0001';
    END IF;

    SELECT id INTO v_id FROM public.medicos
     WHERE junta = p_junta AND numero_junta = v_num;

    IF v_id IS NOT NULL THEN
        IF p_verificado THEN
            UPDATE public.medicos
               SET verificado_at = now(), origen = 'cssp',
                   carrera = coalesce(carrera, p_carrera)
             WHERE id = v_id;
        END IF;
        RETURN v_id;
    END IF;

    IF NOT p_verificado THEN
        RAISE EXCEPTION
            'Ese profesional no esta en el registro del Consejo Superior de Salud Publica. No se puede agregar a mano.'
            USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(btrim(p_nombre), '') = '' THEN
        RAISE EXCEPTION 'Falta el nombre del medico.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.medicos (numero_junta, junta, nombre, carrera, origen, verificado_at, agregado_por)
    VALUES (v_num, p_junta, btrim(p_nombre), nullif(btrim(p_carrera), ''),
            'cssp', now(), public.auth_employee_id())
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$fn$;

-- ── 3 · Si el registro del Consejo falla, avisa ────────────────────────────
--
-- Es un sitio de gobierno: cuando se cae, la sala no puede completar NINGUN
-- renglon nuevo, y eso hay que saberlo antes de que se acumulen tres dias.
-- Un aviso por hora como mucho — un fallo de red produce diez intentos en un
-- minuto, y diez avisos iguales ensenan a ignorar la campana.
--
-- El destinatario se resuelve por `username`, no por un uuid escrito a mano: un
-- id fijo en el codigo sobrevive a que la persona cambie de cuenta y entonces
-- el aviso se va a nadie. Y la columna de actividad es `status = 'ACTIVO'`,
-- verificada en el catalogo: no existe ninguna `activo`.
CREATE OR REPLACE FUNCTION public.avisar_falla_del_consejo(p_detalle text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $fn$
DECLARE
    v_dest uuid[];
    v_yo   uuid := public.auth_employee_id();
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras', 'can_edit') THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.type = 'CSSP_CAIDO'
           AND n.created_at >= now() - interval '1 hour'
    ) THEN
        RETURN false;
    END IF;

    SELECT array_agg(id) INTO v_dest
      FROM public.employees
     WHERE username = 'edwin.nunez' AND status = 'ACTIVO';

    IF v_dest IS NULL THEN RETURN false; END IF;

    PERFORM public.notify_employees(
        v_dest,
        'CSSP_CAIDO',
        'El registro del Consejo no responde',
        coalesce(nullif(btrim(p_detalle), ''),
                 'La consulta de profesionales del CSSP fallo. Mientras no responda, la sala no puede '
                 || 'completar renglones del libro bajo receta: el medico solo se puede tomar del registro.'),
        '/bitacoras',
        jsonb_build_object('reportado_por', v_yo),
        true,
        NULL
    );
    RETURN true;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.avisar_falla_del_consejo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_falla_del_consejo(text) TO authenticated, service_role;
