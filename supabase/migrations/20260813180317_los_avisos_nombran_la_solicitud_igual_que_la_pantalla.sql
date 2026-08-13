-- Grupo 2 de docs/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md: los rótulos de
-- solicitud que Postgres arma para los avisos.
--
-- El plan decía «hoy las dos mitades coinciden, así que no hay defecto — sólo
-- queda el sentence case». Medido contra el catálogo vivo y contra
-- `REQUEST_TYPES` de `requestsSlice.js`: ya NO coinciden. El barrido de §26.4
-- (v2.571.8/.10) pasó por el frontend y dejó a la base atrás, así que nueve
-- tipos de solicitud se llaman distinto según quién los escriba — la Bandeja
-- dice «Cambio de forma de pago» y la notificación «Cambio de Forma de Pago».
-- O sea que esto no es cosmético pendiente: es la deriva que el plan quería
-- evitar, ya ocurrida.
--
-- Este cambio alinea la base con el frontend. Lo que NO se toca:
--   · 'Constancia Laboral' — nombre oficial del documento (lista de «no entra
--     en ningún grupo» del plan).
--   · 'Vacaciones' e 'Incapacidad' — una sola palabra, ya coinciden.
--
-- SHIFT_EXCEPTION era el único caso donde las dos mitades decían cosas
-- distintas de verdad y no sólo con otras mayúsculas: la base 'Excepción de
-- Turno' y la pantalla 'Excepción turno (kiosk)'. Decisión del usuario
-- (2026-08-13): gana la base, y el frontend suelta el «(kiosk)» —que además es
-- jerga del sistema, no del negocio— en el mismo commit.
--
-- Los cuerpos salen de `pg_get_functiondef` sobre producción, no de los
-- archivos del repo — el cuerpo vivo de una función lo tiene el catálogo.
-- Verificado antes de aplicar: partidos en renglones, apartados los 33 que
-- contienen rótulos, el md5 del resto es idéntico al de producción en las dos
-- funciones y con la misma cantidad de líneas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
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
        WHEN 'ANNULMENT_REQUEST'          THEN 'Anulación de factura'
        WHEN 'PAYMENT_CHANGE_REQUEST'     THEN 'Cambio de forma de pago'
        WHEN 'VENDOR_CHANGE_REQUEST'      THEN 'Cambio de vendedor'
        WHEN 'CLIENT_CHANGE_REQUEST'      THEN 'Cambio de cliente'
        WHEN 'INVENTORY_LOAD_REQUEST'     THEN 'Carga de inventario'
        WHEN 'INVENTORY_DISCARD_REQUEST'  THEN 'Descarte de inventario'
        WHEN 'INVENTORY_TRANSFER_REQUEST' THEN 'Traslado entre salas'
        WHEN 'PERMIT'                     THEN 'Permiso / licencia'
        WHEN 'VACATION'                   THEN 'Vacaciones'
        WHEN 'VACATION_CHANGE'            THEN 'Cambio de vacaciones'
        WHEN 'SHIFT_CHANGE'               THEN 'Cambio de turno'
        WHEN 'SHIFT_EXCEPTION'            THEN 'Excepción de turno'
        WHEN 'OVERTIME'                   THEN 'Horas extra'
        WHEN 'ADVANCE'                    THEN 'Anticipo salarial'
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
        v_titulo := '⚠️ Anulación de factura';
        v_cuerpo := v_quien || ' solicita anular ' || coalesce(m->>'correlativo', 'una factura')
                 || coalesce(' (' || v_monto || ')', '')
                 || coalesce(' · ' || (m->>'branch_name'), '');

    ELSIF NEW.type = 'PAYMENT_CHANGE_REQUEST' THEN
        v_titulo := '💳 Cambio de forma de pago';
        v_cuerpo := v_quien || ' solicita cambiar el pago de ' || coalesce(m->>'correlativo', 'una factura')
                 || ': ' || coalesce(m->>'current_pago', '—') || ' → ' || coalesce(m->>'new_pago', '—')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'VENDOR_CHANGE_REQUEST' THEN
        v_titulo := '👤 Cambio de vendedor';
        v_cuerpo := v_quien || ' solicita reasignar ' || coalesce(m->>'correlativo', 'una factura')
                 || ' a ' || coalesce(m->>'new_vendor_name', 'otro vendedor')
                 || coalesce(' (' || v_monto || ')', '');

    ELSIF NEW.type = 'CLIENT_CHANGE_REQUEST' THEN
        v_titulo := '🧾 Cambio de cliente';
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
            v_titulo := '📦 Carga de inventario';
            v_cuerpo := v_quien || ' solicita cargar ';
        ELSE
            v_titulo := '🗑️ Descarte de inventario';
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
             (SELECT array_agg(DISTINCT s.x) FROM (SELECT NEW.approver_id AS x UNION SELECT e.id FROM public.employees e WHERE e.status = 'ACTIVO' AND public.puede_aprobar_modulo(e.id, public.modulo_de_notificacion(NEW.type))) s WHERE s.x IS NOT NULL AND s.x <> NEW.employee_id), ARRAY[NEW.approver_id])
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
$fn$;

CREATE OR REPLACE FUNCTION public.avisar_facturas_de_sala()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_sala     record;
  v_destinos uuid[];
  v_n        integer;
  v_titulo   text;
  v_cuerpo   text;
  v_total    integer := 0;
BEGIN
  FOR v_sala IN
    WITH nuevas AS (
      -- `DISTINCT ON (d.id)`: si dos reglas por línea llegaran a casar con el
      -- mismo documento, avisarlo dos veces sería avisar de más — y la marca
      -- es por documento, no por regla.
      SELECT DISTINCT ON (d.id)
             d.id, d.monto_total, d.fecha_emision, r.etiqueta, l.branch_id
        FROM public.purchase_dte_documents d
        JOIN public.purchase_claim_rules r
          ON r.activo AND r.asignacion = 'linea'
         AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
        JOIN public.purchase_claim_lines l
          ON l.rule_id = r.id
         AND l.linea   = public.linea_telefonica_de(d.items_text)
       WHERE NOT d.invalidado
         -- Ventana corta: la marca evita repetir, pero sin ventana el PRIMER
         -- barrido avisaría toda la historia de una vez.
         AND d.created_at >= now() - interval '7 days'
         -- Si alguien ya la tomó, no hay nada que avisar.
         AND NOT EXISTS (SELECT 1 FROM public.purchase_dte_claims c
                          WHERE c.document_id = d.id AND c.released_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.purchase_claim_avisos a
                          WHERE a.document_id = d.id)
       ORDER BY d.id, r.orden, r.id
    )
    -- Agrupado por sala: dos facturas el mismo día son UN aviso, no dos pings.
    SELECT branch_id,
           count(*)            AS cuantas,
           array_agg(id)       AS ids,
           string_agg(etiqueta || ' · $' || to_char(monto_total, 'FM999999990.00'),
                      '  ·  ' ORDER BY fecha_emision DESC) AS detalle
      FROM nuevas
     GROUP BY branch_id
  LOOP
    SELECT array_agg(t.employee_id) INTO v_destinos
      FROM public.empleados_en_turno(v_sala.branch_id::integer) t;

    v_titulo := CASE WHEN v_sala.cuantas = 1
                     THEN 'Llegó una factura para cargar'
                     ELSE v_sala.cuantas || ' facturas llegaron para cargar' END;
    v_cuerpo := v_sala.detalle || ' — tomala desde Facturas de mi sala.';

    IF v_destinos IS NULL THEN
      -- Nadie en turno (feriado, antes de abrir, roster sin publicar). Va a la
      -- sala entera: un aviso que no le llega a nadie es peor que no mandarlo.
      v_n := public.notify_branch(
        v_sala.branch_id::integer, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', false), true);
    ELSE
      v_n := public.notify_employees(
        v_destinos, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', true), true,
        v_sala.branch_id::integer);
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no,
    -- una sala sin personal activo haría reintentar el mismo aviso cada día
    -- para siempre. Cuántos lo recibieron queda guardado, que es lo que permite
    -- notar el caso en vez de suponerlo.
    INSERT INTO public.purchase_claim_avisos (document_id, branch_id, destinatarios)
    SELECT t.id, v_sala.branch_id, COALESCE(v_n, 0)
      FROM unnest(v_sala.ids) AS t(id)
    ON CONFLICT (document_id) DO NOTHING;

    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$fn$;
