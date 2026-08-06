-- Traslado entre salas: el tipo, la validación, y el aprobador que sale del DATO.
--
-- Es la cuarta operación de la familia (solicitud → aprobación → aplicación) y
-- la primera donde quien aprueba NO es un rol fijo. En una carga o un descarte,
-- quien pide es quien tiene el problema y Supervisión decide. Acá quien pide es
-- la sala que NO tiene, y la única que puede decir «sí, me sobra» es la sala
-- que SÍ tiene. Entonces el aprobador se resuelve por el dato de la solicitud.
--
-- ── La cascada, y por qué existe ────────────────────────────────────────────
-- Decidido con el usuario el 2026-08-06: el aviso va a quien está EN TURNO en
-- la sala de origen. Pero Horarios y Turnos todavía no está cargado con todos
-- los empleados, y medido hoy son **8 de 50 activos** con roster publicado esta
-- semana: solo Salud 3 tiene su sala completa, y La Popular, Salud 2, Salud 4 y
-- Salud 5 no tienen a NADIE. Sin respaldo, una solicitud a esas cuatro salas
-- muere en silencio.
--
-- Por eso son tres escalones y no uno: turno → jefatura de la sala →
-- Supervisión. Y el escalón que resolvió queda escrito en la solicitud: cuando
-- todo esté cargado, `escalon_aviso <> 'TURNO'` es exactamente la lista de
-- salas a las que les falta el horario.

SET lock_timeout = '5s';

-- ── 0 · El tipo ─────────────────────────────────────────────────────────────
-- Sin ampliar el CHECK la solicitud rebota con un error de constraint. Lo
-- destapó la prueba con inserts reales de los dos tipos anteriores, no la
-- lectura del código.
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check
    CHECK (type = ANY (ARRAY[
        'PERMIT','VACATION','SHIFT_CHANGE','OVERTIME','ADVANCE','CERTIFICATE',
        'DISABILITY','VACATION_CHANGE','SHIFT_EXCEPTION',
        'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST',
        'CLIENT_CHANGE_REQUEST',
        'INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
        'INVENTORY_TRANSFER_REQUEST'
    ]));

-- ── 1 · Quién está en turno AHORA en una sala ───────────────────────────────
-- Dos convenciones del roster que no se adivinan y que hay que respetar:
--
--   · `week_start_date` es el LUNES de esa semana, que es justo lo que devuelve
--     `date_trunc('week', ...)` en Postgres.
--   · el día se indexa **0=domingo … 6=sábado** (el `getDay()` de JS). Medido
--     sobre los rosters desde junio: las claves que existen son 0..6 y ninguna
--     es 7. Ojo, `requestsSlice.js` escribe "7" para el domingo en el flujo de
--     cambio de turno — eso lee una clave que no existe, pero es otro problema.
--
-- La hora se compara como texto 'HH24:MI' a propósito: `customStart` y
-- `customEnd` son cadenas y están cero-rellenadas, así que el orden
-- lexicográfico ES el orden del reloj. Castear a `time` fallaría con la primera
-- celda vacía de un roster a medio llenar.
CREATE OR REPLACE FUNCTION public.empleados_en_turno(p_branch_id integer)
RETURNS TABLE (employee_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    WITH h AS (
        SELECT (date_trunc('week', ts))::date            AS semana,
               extract(dow from ts)::integer::text       AS dia,
               to_char(ts, 'HH24:MI')                    AS hora
        FROM (SELECT (now() AT TIME ZONE 'America/El_Salvador') AS ts) t
    ),
    d AS (
        SELECT e.id,
               nullif(r.schedule_data -> h.dia ->> 'customStart', '') AS entra,
               nullif(r.schedule_data -> h.dia ->> 'customEnd',   '') AS sale,
               h.hora
        FROM public.employees e
        JOIN public.employee_rosters r ON r.employee_id = e.id
        CROSS JOIN h
        WHERE e.branch_id = p_branch_id
          AND e.status = 'ACTIVO'
          AND r.week_start_date = h.semana
          AND r.status = 'PUBLISHED'
          AND coalesce((r.schedule_data -> h.dia ->> 'isOff')::boolean, true) = false
    )
    SELECT d.id
    FROM d
    WHERE d.entra IS NOT NULL AND d.sale IS NOT NULL
      AND CASE
            WHEN d.entra <= d.sale                       -- turno normal
                THEN d.hora >= d.entra AND d.hora < d.sale
            ELSE d.hora >= d.entra OR  d.hora < d.sale   -- cruza la medianoche
          END;
$$;

REVOKE EXECUTE ON FUNCTION public.empleados_en_turno(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.empleados_en_turno(integer) TO authenticated, service_role;

-- ── 2 · La cascada ──────────────────────────────────────────────────────────
-- Devuelve a TODOS los del escalón que resolvió, no a uno: la solicitud es de
-- la sala, no de una persona, y quien esté primero la atiende. Nunca queda sin
-- destinatario mientras haya jefatura activa — verificado hoy: las 7 salas
-- tienen al menos una.
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_traslado(p_branch_id integer)
RETURNS TABLE (destinatarios uuid[], escalon text)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE v uuid[];
BEGIN
    SELECT array_agg(t.employee_id ORDER BY t.employee_id)
      INTO v FROM public.empleados_en_turno(p_branch_id) t;
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, 'TURNO'::text;
        RETURN;
    END IF;

    SELECT array_agg(e.id ORDER BY e.name)
      INTO v FROM public.employees e
     WHERE e.branch_id = p_branch_id AND e.status = 'ACTIVO'
       AND e.system_role IN ('JEFE', 'SUBJEFE');
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, 'JEFATURA'::text;
        RETURN;
    END IF;

    SELECT array_agg(e.id ORDER BY e.name)
      INTO v FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.system_role IN ('SUPERVISOR', 'ADMIN', 'SUPERADMIN');
    RETURN QUERY SELECT v, CASE WHEN coalesce(array_length(v, 1), 0) > 0
                                THEN 'SUPERVISION' ELSE 'NADIE' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) TO authenticated, service_role;

-- ── 3 · La validación, y el aprobador escrito acá ───────────────────────────
-- El `approver_id` que mande el navegador se DESCARTA. En las tres operaciones
-- anteriores lo elegía el cliente (`findTargetEmployee`) y se podía sostener
-- porque el destino era un rol fijo; acá depende del dato y de la hora, así que
-- dejarlo del lado del navegador sería dejar elegir quién aprueba.
CREATE OR REPLACE FUNCTION public.validar_solicitud_traslado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m           jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_items     jsonb   := m->'items';
    it          jsonb;
    v_org_erp   integer := nullif(m->>'origen_erp_sucursal_id', '')::integer;
    v_dst_erp   integer := nullif(m->>'erp_sucursal_id', '')::integer;
    v_org_bid   integer;
    v_prod      integer;
    v_unid      numeric;
    v_tiene     numeric;
    v_min       numeric;
    v_dest      uuid[];
    v_esc       text;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;

    -- La causa va al `concepto` del movimiento y es lo único que queda escrito
    -- en el kardex de las dos salas.
    IF nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'La solicitud necesita decir para qué se pide.';
    END IF;

    IF v_org_erp IS NULL OR v_dst_erp IS NULL THEN
        RAISE EXCEPTION 'Falta la sala de origen o la de destino.';
    END IF;
    IF v_org_erp = v_dst_erp THEN
        RAISE EXCEPTION 'El origen y el destino son la misma sala.';
    END IF;

    SELECT branch_id INTO v_org_bid FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = v_org_erp;
    IF v_org_bid IS NULL THEN
        RAISE EXCEPTION 'La sala de origen % no existe en el mapa.', v_org_erp;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_dst_erp) THEN
        RAISE EXCEPTION 'La sala de destino % no existe en el mapa.', v_dst_erp;
    END IF;

    IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION 'La solicitud no pide ni un producto.';
    END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        v_prod := coalesce(nullif(it->>'erp_product_id', '')::integer, 0);
        IF v_prod <= 0 THEN
            RAISE EXCEPTION 'Hay una línea sin producto.';
        END IF;

        -- La presentación por SIGNIFICADO —«UNIDAD» + factor—, nunca por id:
        -- el portal y el otro sistema las numeran distinto y la etiqueta es lo
        -- único estable entre los dos.
        IF nullif(btrim(coalesce(it->>'presentacion_tipo', '')), '') IS NULL THEN
            RAISE EXCEPTION 'La línea del producto % no dice qué presentación es.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'factor', '')::integer, 0) <= 0 THEN
            RAISE EXCEPTION 'La presentación del producto % no trae su factor.', v_prod;
        END IF;
        IF coalesce(nullif(it->>'cantidad', '')::numeric, 0) <= 0 THEN
            RAISE EXCEPTION 'La línea del producto % no tiene cantidad.', v_prod;
        END IF;

        -- Lo pedido, en UNIDADES: `inventory` guarda una fila por presentación,
        -- así que comparar una cantidad de cajas contra una existencia en
        -- unidades deja pasar imposibles.
        v_unid := (it->>'cantidad')::numeric * (it->>'factor')::integer;

        SELECT coalesce(sum(i.cantidad * coalesce(pp.factor, 1)), 0)
          INTO v_tiene
          FROM public.inventory i
          LEFT JOIN public.presentaciones pr ON upper(pr.tipo) = upper(i.presentacion)
          LEFT JOIN public.product_precios pp
                 ON pp.product_id = i.erp_product_id
                AND pp.id_presentacion = pr.id
                AND pp.activo
         WHERE i.erp_product_id = v_prod
           AND i.erp_sucursal_id = v_org_erp
           AND i.is_vencidos = false
           AND i.cantidad > 0;

        SELECT coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0)
          INTO v_min
          FROM public.product_stock_params sp
         WHERE sp.erp_product_id = v_prod AND sp.erp_sucursal_id = v_org_erp;

        IF v_tiene < v_unid THEN
            RAISE EXCEPTION 'La sala de origen no tiene % unidades del producto % (tiene %).',
                v_unid, v_prod, v_tiene;
        END IF;

        -- La regla del usuario: no se le saca a una sala lo que la deja por
        -- debajo de su propio mínimo. Eso mueve el problema, no lo resuelve.
        IF v_tiene - v_unid < coalesce(v_min, 0) THEN
            RAISE EXCEPTION 'Ceder % unidades del producto % dejaría a la sala de origen debajo de su mínimo (% quedarían, mínimo %).',
                v_unid, v_prod, v_tiene - v_unid, v_min;
        END IF;
    END LOOP;

    -- ── El aprobador sale de acá, no del navegador ──────────────────────────
    SELECT r.destinatarios, r.escalon INTO v_dest, v_esc
      FROM public.resolver_destinatarios_traslado(v_org_bid) r;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RAISE EXCEPTION 'No hay a quién pedirle el traslado en esa sala.';
    END IF;

    NEW.approver_id := v_dest[1];
    NEW.metadata := m
        || jsonb_build_object(
             'origen_branch_id', v_org_bid,
             'destinatarios',    to_jsonb(v_dest),
             'escalon_aviso',    v_esc);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_solicitud_traslado ON public.approval_requests;
CREATE TRIGGER trg_validar_solicitud_traslado
    BEFORE INSERT ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.validar_solicitud_traslado();

REVOKE EXECUTE ON FUNCTION public.validar_solicitud_traslado() FROM PUBLIC, anon;

-- ── 4 · El rechazo lleva motivo ─────────────────────────────────────────────
-- Decidido con el usuario el 2026-08-06, con la lista que él dictó. Va en la BD
-- y no en la pantalla por lo mismo de siempre: una validación que vive en el
-- navegador no es una validación, es una sugerencia.
CREATE OR REPLACE FUNCTION public.validar_rechazo_traslado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    m         jsonb  := coalesce(NEW.metadata, '{}'::jsonb);
    v_motivo  text   := nullif(btrim(coalesce(m->>'rejection_reason', '')), '');
    v_motivos text[] := ARRAY['Producto ya encargado','Sin existencia en físico','Producto dañado','Otro'];
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status <> 'REJECTED' OR OLD.status = 'REJECTED' THEN RETURN NEW; END IF;

    IF v_motivo IS NULL THEN
        RAISE EXCEPTION 'Un traslado se rechaza con motivo. Los aceptados son %.',
            array_to_string(v_motivos, ', ');
    END IF;
    IF NOT (v_motivo = ANY (v_motivos)) THEN
        RAISE EXCEPTION 'Motivo de rechazo no válido: "%". Los aceptados son %.',
            v_motivo, array_to_string(v_motivos, ', ');
    END IF;
    -- «Otro» sin texto no explica nada: es el motivo vacío con otro nombre.
    IF v_motivo = 'Otro' AND nullif(btrim(coalesce(NEW.approver_note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El motivo «Otro» necesita que se escriba cuál.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_rechazo_traslado ON public.approval_requests;
CREATE TRIGGER trg_validar_rechazo_traslado
    BEFORE UPDATE OF status ON public.approval_requests
    FOR EACH ROW EXECUTE FUNCTION public.validar_rechazo_traslado();

REVOKE EXECUTE ON FUNCTION public.validar_rechazo_traslado() FROM PUBLIC, anon;
