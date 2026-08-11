SET lock_timeout = '5s';

-- «Mis Solicitudes» se fusiona con «Solicitudes Personales» (2026-08-11).
--
-- Eran dos pantallas para el mismo expediente, con dos módulos de permiso: en
-- una se mandaba la solicitud (`emp_requests`) y en la otra se resolvía
-- (`requests_personales`). Lo que las junta es el alcance que se estrenó ayer:
-- con «todos» se ve la sala entera y se decide, con «sólo míos» se ve lo de uno
-- y se manda. Pedido del usuario: «que mejor adentro haya un filtro para ver
-- todos o sólo yo, pero con alcance global si tiene el permiso».
--
-- Esta migración hace CINCO cosas, y cuatro son arreglos que la fusión
-- descubrió. Van juntas a propósito: sin ellas la pantalla nueva ofrece botones
-- que la base rechaza, que es peor que no ofrecerlos.

-- ─────────────────────────────────────────────────────────────────────────
-- 0 · «Sólo míos» no cabía en la columna
-- ─────────────────────────────────────────────────────────────────────────
-- La migración de ayer dice, con todas las letras: «`role_permissions.scope`
-- no tiene CHECK (verificado)». **Sí lo tiene**, y sólo admite ALL y BRANCH:
--
--     CHECK (scope = ANY (ARRAY['ALL'::text, 'BRANCH'::text]))
--
-- O sea que el alcance nuevo salió a producción con su opción visible en la
-- pantalla de Permisos y sin poder guardarse: elegir «Sólo míos» y guardar
-- devolvía 23514. Nadie lo notó porque nadie lo eligió todavía —las policies se
-- escribieron bien, la UI también, y lo único que faltaba estaba en la columna.
--
-- Lo delató esta misma migración al intentar el UPDATE de más abajo. Vale
-- anotarlo: la afirmación era verificable con una consulta de una línea y se
-- escribió «verificado» sin correrla.
ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_scope_check;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_scope_check
    CHECK (scope = ANY (ARRAY['ALL'::text, 'BRANCH'::text, 'MINE'::text]));

-- ─────────────────────────────────────────────────────────────────────────
-- 1 · Quién conserva el autoservicio
-- ─────────────────────────────────────────────────────────────────────────
-- Tres cargos tenían `emp_requests`. Dos de ellos —Supervisión y la cuenta de
-- pruebas— ya tienen `requests_personales` en alcance «todos», así que no
-- pierden nada. El tercero, Jefe/a de Compras y Logística, sólo tenía el de
-- autoservicio: pasa a `requests_personales` con alcance «sólo míos», que es
-- exactamente lo que tenía — mandar las suyas y seguirlas, sin ver ni decidir
-- las de nadie más.
UPDATE public.role_permissions
SET can_view = true, can_edit = true, can_approve = false, scope = 'MINE'
WHERE module_key = 'requests_personales'
  AND role_id IN (SELECT id FROM public.roles WHERE name = 'Jefe/a de Compras y Logistica');

-- Y la llave vieja se va. Dejarla apagada la habría dejado en la pantalla de
-- Permisos como un interruptor que ya no enciende nada.
DELETE FROM public.role_permissions WHERE module_key = 'emp_requests';

-- ─────────────────────────────────────────────────────────────────────────
-- 2 · La policy de UPDATE no dejaba cancelar la solicitud PROPIA
-- ─────────────────────────────────────────────────────────────────────────
-- Descubierto al fusionar: `approval_requests_update` tiene tres ramas —módulo
-- operativo, módulo personal y traslado— y NINGUNA menciona a quien mandó la
-- solicitud. O sea que «Cancelar solicitud», que existe en la pantalla desde
-- siempre, fallaba en silencio para cualquiera sin permiso de aprobar: el
-- UPDATE afecta cero filas y PostgREST no lo considera un error.
--
-- Y falta una segunda: **el cambio de turno lo contesta el compañero**, no una
-- jefatura. Sin esa rama, encender el alcance «sólo míos» —que es lo que hace
-- posible la fusión— deja a la persona mirando una solicitud dirigida a ella y
-- sin poder contestarla.
--
-- Las dos van con su `WITH CHECK` apretado, porque `WITH CHECK` es un OR entre
-- ramas y una rama floja se le presta a las otras:
--   · lo propio sólo puede terminar en CANCELLED — si no, uno se aprobaría su
--     propia solicitud;
--   · la del compañero exige `employee_id <> yo`, porque si no, la solicitud
--     PROPIA entraría por la rama de arriba (USING) y saldría por ésta (CHECK),
--     que es la misma autoaprobación por la puerta de al lado.
DROP POLICY IF EXISTS approval_requests_update ON public.approval_requests;

CREATE POLICY approval_requests_update ON public.approval_requests
FOR UPDATE TO authenticated
USING (
    (es_solicitud_operativa(type)
     AND (SELECT auth_has_module_permission('requests', 'can_approve'))
     AND CASE (SELECT auth_module_scope('requests'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                      WHERE e.id = approval_requests.employee_id
                        AND e.branch_id = (SELECT auth_employee_branch_id()))
         END)
 OR (NOT es_solicitud_operativa(type)
     AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
     AND CASE (SELECT auth_module_scope('requests_personales'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                      WHERE e.id = approval_requests.employee_id
                        AND e.branch_id = (SELECT auth_employee_branch_id()))
         END)
 OR (type = 'INVENTORY_TRANSFER_REQUEST'
     AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
     AND ((SELECT auth_module_scope('traslados')) = 'ALL'
       OR (metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text
       OR ((NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT auth_employee_branch_id())
           AND (SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE']))
       OR ((NULLIF(metadata ->> 'branch_id', ''))::integer = (SELECT auth_employee_branch_id())
           AND ((SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
             OR (SELECT estoy_en_turno())))))
 -- NUEVO · cancelar la propia, mientras sigue pendiente
 OR (employee_id = (SELECT auth_employee_id()) AND status = 'PENDING')
 -- NUEVO · contestar el cambio de turno donde uno es el compañero
 OR (type = 'SHIFT_CHANGE' AND status = 'PENDING'
     AND approver_id = (SELECT auth_employee_id())
     AND employee_id <> (SELECT auth_employee_id()))
)
WITH CHECK (
    (es_solicitud_operativa(type)
     AND (SELECT auth_has_module_permission('requests', 'can_approve'))
     AND CASE (SELECT auth_module_scope('requests'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                      WHERE e.id = approval_requests.employee_id
                        AND e.branch_id = (SELECT auth_employee_branch_id()))
         END)
 OR (NOT es_solicitud_operativa(type)
     AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
     AND CASE (SELECT auth_module_scope('requests_personales'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE EXISTS (SELECT 1 FROM employees e
                      WHERE e.id = approval_requests.employee_id
                        AND e.branch_id = (SELECT auth_employee_branch_id()))
         END)
 OR (type = 'INVENTORY_TRANSFER_REQUEST'
     AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
     AND ((SELECT auth_module_scope('traslados')) = 'ALL'
       OR (metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text
       OR ((NULLIF(metadata ->> 'origen_branch_id', ''))::integer = (SELECT auth_employee_branch_id())
           AND (SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE']))
       OR ((NULLIF(metadata ->> 'branch_id', ''))::integer = (SELECT auth_employee_branch_id())
           AND ((SELECT auth_employee_system_role()) = ANY (ARRAY['JEFE', 'SUBJEFE'])
             OR (SELECT estoy_en_turno())))))
 -- La propia SOLO puede quedar cancelada.
 OR (employee_id = (SELECT auth_employee_id()) AND status = 'CANCELLED')
 -- La del compañero sigue siendo un cambio de turno y sigue sin ser mía. El
 -- aprobador SÍ cambia —al aceptar, el trámite sube al segundo nivel con otro
 -- aprobador— así que no se puede exigir acá.
 OR (type = 'SHIFT_CHANGE' AND employee_id <> (SELECT auth_employee_id()))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3 · Min/Max leía «sólo míos» como «mi sucursal»
-- ─────────────────────────────────────────────────────────────────────────
-- Es EXACTAMENTE el error que la migración de ayer se escribió para evitar, en
-- la tabla de al lado: una policy que pregunta `scope = 'ALL'` y trata todo lo
-- demás como sucursal lee MINE como BRANCH — el valor nuevo haciendo lo
-- contrario de lo que promete su nombre. Ayer se arreglaron las dos policies de
-- `approval_requests`; `minmax_change_requests` quedó afuera porque todavía
-- nadie tenía el alcance nuevo. Hoy ya hay quien lo tiene.
--
-- La primera rama del SELECT —`requested_by_id = yo`— ya da lo propio, así que
-- MINE cae a false igual que allá.
DROP POLICY IF EXISTS mmcr_select ON public.minmax_change_requests;

CREATE POLICY mmcr_select ON public.minmax_change_requests
FOR SELECT TO authenticated
USING (
    requested_by_id = (SELECT auth_employee_id())
 OR ((SELECT auth_has_module_permission('minmax', 'can_approve'))
     AND CASE (SELECT auth_module_scope('minmax'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
         END)
 OR ((SELECT auth_has_module_permission('requests', 'can_view'))
     AND CASE (SELECT auth_module_scope('requests'))
         WHEN 'ALL'  THEN true
         WHEN 'MINE' THEN false
         ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
         END)
);

DROP POLICY IF EXISTS mmcr_update ON public.minmax_change_requests;

CREATE POLICY mmcr_update ON public.minmax_change_requests
FOR UPDATE TO authenticated
USING (
    (SELECT auth_has_module_permission('minmax', 'can_approve'))
    AND CASE (SELECT auth_module_scope('minmax'))
        WHEN 'ALL'  THEN true
        WHEN 'MINE' THEN false
        ELSE erp_sucursal_id = (SELECT auth_employee_erp_sucursal_id())
        END
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4 · El aviso del cambio de turno apuntaba a la ruta que se fue
-- ─────────────────────────────────────────────────────────────────────────
-- `notificar_solicitud_creada` arma el enlace del aviso, y para el cambio de
-- turno de primer nivel usaba `/my-requests`. Esa ruta hoy sólo redirige, así
-- que el aviso seguiría funcionando — pero por un rebote, y el rebote es lo que
-- se olvida de quitar. Se cambia la línea y nada más; el resto de la función
-- queda igual.
CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m            jsonb := coalesce(NEW.metadata, '{}'::jsonb);
    v_quien      text;
    v_etiqueta   text;
    v_titulo     text;
    v_cuerpo     text;
    v_base       text := '/requests';
    v_link       text;
    v_monto      text;
    v_motivo     text;
    v_lineas     integer;
    v_unidades   numeric;
    v_donde      text;
    v_que        text;
    v_dest       uuid[];
BEGIN
    IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL OR NEW.approver_id = NEW.employee_id THEN
        RETURN NEW;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.employee_id;
    v_quien := coalesce(v_quien, 'Un empleado');

    v_etiqueta := CASE NEW.type
        WHEN 'ANNULMENT_REQUEST'          THEN 'Anulación de Factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'     THEN 'Cambio de Forma de Pago'
        WHEN 'VENDOR_CHANGE_REQUEST'      THEN 'Cambio de Vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'      THEN 'Cambio de Cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'     THEN 'Carga de Inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST'  THEN 'Descarte de Inventario'
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'Traslado entre Salas'
        WHEN 'PERMIT'                     THEN 'Permiso / Licencia'
        WHEN 'VACATION'                   THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'            THEN 'Cambio de Vacaciones'
        WHEN 'SHIFT_CHANGE'               THEN 'Cambio de Turno'
        WHEN 'SHIFT_EXCEPTION'            THEN 'Excepción de Turno'
        WHEN 'OVERTIME'                   THEN 'Horas Extra'
        WHEN 'ADVANCE'                    THEN 'Anticipo Salarial'
        WHEN 'CERTIFICATE'                THEN 'Constancia Laboral'
        WHEN 'DISABILITY'                 THEN 'Incapacidad'
        ELSE NEW.type
    END;

    v_monto := CASE
        WHEN m ? 'total' AND (m->>'total') ~ '^-?[0-9.]+$'
        THEN '$' || to_char((m->>'total')::numeric, 'FM999,999,990.00')
        ELSE NULL
    END;

    v_motivo := nullif(btrim(coalesce(m->>'reason', NEW.note, '')), '');

    IF NEW.type = 'ANNULMENT_REQUEST' THEN
        v_titulo := '⚠️ Anulación de Factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := '💳 Cambio de Forma de Pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := '👤 Cambio de Vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := '🧾 Cambio de Cliente';
        v_cuerpo := v_quien || ' solicita cambiar el cliente de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(nullif(m->>'current_cliente', ''), 'Sin nombre')
                 || ' → ' || coalesce(m->>'new_client_name', '—');

    -- ── El traslado ─────────────────────────────────────────────────────────
    -- Va PRIMERO que la rama de carga/descarte porque quien lo recibe está del
    -- otro lado del pedido: acá el cuerpo tiene que decir QUIÉN pide y DESDE
    -- QUÉ SALA, que en las otras dos es implícito.
    ELSIF NEW.type = 'INVENTORY_TRANSFER_REQUEST' THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'otra sala');
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        v_titulo := '🔄 Te piden un traslado';
        v_cuerpo := v_quien || ' (' || v_donde || ') pide '
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' de ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || ' de tu sala.';

    ELSIF NEW.type IN ('INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST') THEN
        v_lineas   := coalesce(jsonb_array_length(m->'items'), 0);
        v_unidades := coalesce((m->>'total_unidades')::numeric, 0);
        v_donde    := coalesce(nullif(m->>'branch_name', ''), 'una sucursal');
        -- Con un solo producto entra el nombre, igual que en el traslado: es el
        -- caso normal y es la diferencia entre saber qué se está por mover y
        -- tener que abrir la solicitud para averiguarlo.
        v_que := CASE WHEN v_lineas = 1
                      THEN nullif(btrim(coalesce(m->'items'->0->>'descripcion', '')), '')
                      ELSE NULL END;

        IF NEW.type = 'INVENTORY_LOAD_REQUEST' THEN
            v_titulo := '📦 Carga de Inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := '🗑️ Descarte de Inventario';
            v_cuerpo := v_quien || ' solicita descartar ';
        END IF;

        v_cuerpo := v_cuerpo
                 || trim(to_char(v_unidades, 'FM999,999,990.####'))
                 || CASE WHEN v_unidades = 1 THEN ' unidad' ELSE ' unidades' END
                 || coalesce(' de ' || v_que,
                             ' en ' || v_lineas || CASE WHEN v_lineas = 1 THEN ' producto' ELSE ' productos' END)
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' por ' || nullif(m->>'subtipo', ''), '')
                 || ' en ' || v_donde;

    ELSIF NEW.type = 'SHIFT_CHANGE' AND NEW.current_level = 1 THEN
        v_titulo := 'Cambio de turno propuesto';
        -- Era `/my-requests`, que se fusionó con Personales el 2026-08-11.
        v_base   := '/requests-personales';
        v_cuerpo := v_quien || ' te propone un cambio de turno'
                 || coalesce(' para el ' || (m->>'date'), '') || '. Requiere tu aprobación.';

    ELSE
        v_titulo := 'Nueva solicitud pendiente';
        v_cuerpo := 'Solicitud de ' || v_etiqueta || ' de ' || v_quien || ' espera tu decisión.';
    END IF;

    IF v_motivo IS NOT NULL THEN
        v_cuerpo := v_cuerpo || ' — ' || left(v_motivo, 140);
    END IF;

    v_link := v_base || '?solicitud=' || NEW.id;

    -- Los destinatarios. Para todo lo anterior es el aprobador y nada más;
    -- `destinatarios` solo lo escribe el traslado.
    SELECT coalesce(
             (SELECT array_agg((d)::uuid) FROM jsonb_array_elements_text(m->'destinatarios') d),
             ARRAY[NEW.approver_id])
      INTO v_dest;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'correlativo', m->>'correlativo'),
           nullif(m->>'branch_id', '')::integer,
           NEW.employee_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object(
            'title', v_titulo, 'message', v_cuerpo, 'url', v_link,
            'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)
        )
    );

    RETURN NEW;
END;
$function$;

-- Y los enlaces ya guardados. Son avisos que la persona todavía puede tener sin
-- leer, y el rebote los cubriría — pero el enlace correcto es más barato que
-- acordarse del rebote.
UPDATE public.notifications
SET link = replace(link, '/my-requests', '/requests-personales')
WHERE link LIKE '/my-requests%';
