-- La sala de RESPALDO: quién despacha un traslado cuando la sala que tiene el
-- producto está cerrada.
--
-- Reportado por el usuario el 2026-08-17: «las sucursales solicitan traslado a
-- bodega, pero bodega trabaja de 8 a 5; si es a las 5 de la tarde, sábado por
-- la tarde o domingo todo el día, no hay nadie que lo confirme. Salud 3 está en
-- el mismo lugar que bodega, así que ellos lo hacían con un usuario especial
-- para realizarlo en el ERP».
--
-- ── Lo medido en prod el 2026-08-17 ────────────────────────────────────────
-- · Bodega (id 30) abre L-V 08:00–17:00, sábado 08:00–12:00, y el domingo NO
--   abre. Salud 3 (id 27) abre 07:00–21:00 y el domingo hasta las 18:00. La
--   ventana descubierta es real: de lunes a viernes después de las 17:00, el
--   sábado desde el mediodía y el domingo entero.
-- · Las dos comparten predio. Bodega está en (14.041176, -88.963111) y Salud 3
--   en (14.041184, -88.963146): cuatro metros, y la misma dirección escrita
--   («Crio. Totolco»). Por eso Salud 3 puede sacar el producto y Salud 1 no —
--   la regla NO es «otra sala cualquiera», es la de al lado.
-- · El traslado desde Bodega no es un caso raro: 6 de los 10 de toda la
--   historia salen de ahí.
--
-- ── La regla ───────────────────────────────────────────────────────────────
-- Una sala puede tener una sala de respaldo. Mientras la primera está cerrada
-- —según su propio horario— la de respaldo puede despachar sus traslados; en
-- cuanto abre, vuelve a decidir ella. Decisión del usuario, 2026-08-17: SÓLO
-- despachar. Lo que le llega a Bodega lo recibe Bodega cuando abre.
--
-- Y la escritura queda firmada con el nombre de quien apretó el botón, que es
-- justamente lo que un usuario compartido no puede dar.
--
-- ── Dónde vive la regla ────────────────────────────────────────────────────
-- En UNA función (`salas_que_cubre_ahora`), llamada por la policy y por la
-- Edge Function. El propio archivo de `aplicar-traslado-inventario` explica por
-- qué: si las dos reglas se separan, la pantalla ofrece el botón y el despacho
-- lo rebota con 403.
--
-- Nota de rendimiento (regla del incidente 2026-07-08): en la policy la llamada
-- va envuelta en `(SELECT …)` y comparada con `= ANY (COALESCE(…))`. Así es un
-- initplan —UNA evaluación por consulta, no por fila—, que es la diferencia
-- entre 19 ms y 25 segundos medida en `sales_invoices`. El `COALESCE` no es
-- decorativo: `= ANY ((SELECT f()))` a secas lo leería Postgres como sublink de
-- subconsulta y compararía integer contra integer[].
--
-- ── Verificado ─────────────────────────────────────────────────────────────
-- Primero en el branch de staging (cbnjplmnfmfsambavjce), con el horario de
-- Bodega alterado dentro de una transacción revertida:
--   · día marcado cerrado     → `sala_abierta_ahora(30)` = false, Salud 3 cubre [30]
--   · el horario ya pasó      → false, Salud 3 cubre [30]
--   · horario ilegible/vacío  → **true** (falla segura), no cubre nadie
--   · Salud 1 no cubre nunca; `salas_que_cubre_ahora(NULL)` = {}
-- Y después en prod, simulando sesiones reales (`request.jwt.claims`, también
-- en transacción revertida):
--   · A · Bodega abierta, Maribel Alberto (Salud 3): cubre {}, ve 0 traslados
--         de Bodega hacia otras salas (5 traslados suyos en total).
--   · B · Bodega cerrada, la misma persona: cubre {30}, ve los 7 (12 en total).
--   · C · Bodega cerrada, Adriana Ramírez (Salud 1): cubre {}, ve 0.

SET lock_timeout = '5s';

-- ── 1 · El dato: quién cubre a quién ────────────────────────────────────────
-- Una columna y no un `if` con el 27 adentro: el día que abra otra sala pegada
-- a otra bodega, esto se configura y no se programa.
ALTER TABLE public.branches
    ADD COLUMN IF NOT EXISTS sala_respaldo_id bigint REFERENCES public.branches(id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_respaldo_no_es_ella_misma') THEN
        ALTER TABLE public.branches
            ADD CONSTRAINT branches_respaldo_no_es_ella_misma
            CHECK (sala_respaldo_id IS DISTINCT FROM id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_branches_sala_respaldo
    ON public.branches(sala_respaldo_id);

COMMENT ON COLUMN public.branches.sala_respaldo_id IS
  'La sala que cubre a esta mientras esta cerrada. Hoy la usa SOLO el despacho de traslados (salas_que_cubre_ahora), y existe porque Bodega cierra a las 17:00 y Salud 3 esta en el mismo predio. No es una asignacion de personal: no da acceso a nada mas.';

UPDATE public.branches SET sala_respaldo_id = 27 WHERE id = 30 AND sala_respaldo_id IS NULL;

-- ── 2 · La hora, tolerando lo que el horario tiene escrito ──────────────────
-- `weekly_hours` se escribe a mano desde el maestro de sucursales y tiene
-- basura real: Salud 2 guarda «19:00 PM». Un `::time` a secas revienta y se
-- lleva puesta la policy, así que se extrae la primera hora con forma y lo
-- demás se descarta.
CREATE OR REPLACE FUNCTION public.hora_del_horario(p_texto text)
RETURNS time
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN nullif(substring(btrim(coalesce(p_texto, '')) from '^\d{1,2}:\d{2}'), '')::time;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.hora_del_horario(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hora_del_horario(text) TO authenticated, service_role;

-- ¿Está abierta esa sala AHORA?
--
-- La falla segura es «abierta»: sin horario legible, la sala de respaldo NO
-- entra y todo queda como estaba. Al revés —dar por cerrada la que no se pudo
-- leer— le regalaría a una sala el poder de despachar por otra en pleno
-- horario, que es justo lo que nadie decidió.
CREATE OR REPLACE FUNCTION public.sala_abierta_ahora(p_branch_id integer)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hoy   jsonb;
    v_ini   time;
    v_fin   time;
    v_ahora time := (now() AT TIME ZONE 'America/El_Salvador')::time;
    v_dow   text := extract(dow from (now() AT TIME ZONE 'America/El_Salvador'))::integer::text;
BEGIN
    IF p_branch_id IS NULL THEN RETURN true; END IF;

    SELECT b.weekly_hours -> v_dow INTO v_hoy
      FROM public.branches b WHERE b.id = p_branch_id;

    IF v_hoy IS NULL OR jsonb_typeof(v_hoy) <> 'object' THEN RETURN true; END IF;
    -- El día marcado como cerrado es el único «cerrado» que no depende de la
    -- hora: el domingo de Bodega entra por acá.
    IF coalesce((v_hoy->>'isOpen')::boolean, true) = false THEN RETURN false; END IF;

    v_ini := public.hora_del_horario(v_hoy->>'start');
    v_fin := public.hora_del_horario(v_hoy->>'end');
    -- Sin horas legibles, o con un tramo que cruza la medianoche (que ninguna
    -- sala tiene hoy y este código no sabría interpretar): se da por abierta.
    IF v_ini IS NULL OR v_fin IS NULL OR v_fin <= v_ini THEN RETURN true; END IF;

    RETURN v_ahora >= v_ini AND v_ahora < v_fin;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sala_abierta_ahora(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_abierta_ahora(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.sala_abierta_ahora(integer) IS
  'Si esa sala esta abierta en este momento, segun su propio weekly_hours y la hora de El Salvador. Un horario ilegible se da por ABIERTO a proposito: la duda no le abre la puerta a la sala de respaldo.';

-- ── 3 · Qué salas cubre AHORA la sala de alguien ────────────────────────────
CREATE OR REPLACE FUNCTION public.salas_que_cubre_ahora(p_branch_id integer)
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT coalesce(array_agg(b.id::integer), ARRAY[]::integer[])
      FROM public.branches b
     WHERE p_branch_id IS NOT NULL
       AND b.sala_respaldo_id = p_branch_id
       AND NOT public.sala_abierta_ahora(b.id::integer);
$function$;

REVOKE EXECUTE ON FUNCTION public.salas_que_cubre_ahora(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salas_que_cubre_ahora(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.salas_que_cubre_ahora(integer) IS
  'Las salas que esta sala esta cubriendo EN ESTE MOMENTO: las que la tienen como sala_respaldo_id y estan cerradas. La misma funcion la usan la policy de approval_requests y la Edge Function aplicar-traslado-inventario, para que la pantalla y el despacho no puedan decir cosas distintas.';

-- La versión de sesión, para la policy. Existe aparte porque la Edge Function
-- corre con la llave de servicio y ahí no hay `auth.uid()` que valga.
CREATE OR REPLACE FUNCTION public.salas_que_cubro_ahora()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
    SELECT public.salas_que_cubre_ahora(public.auth_employee_branch_id());
$function$;

REVOKE EXECUTE ON FUNCTION public.salas_que_cubro_ahora() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salas_que_cubro_ahora() TO authenticated, service_role;

-- ── 4 · Las policies ────────────────────────────────────────────────────────
-- `ALTER POLICY`, no `DROP` + `CREATE`: la tabla no queda ni un instante sin su
-- regla. Sólo cambia la rama del traslado, con UNA condición más; las otras
-- tres familias quedan letra por letra como estaban.
ALTER POLICY approval_requests_select ON public.approval_requests
USING (
    (employee_id = (SELECT auth_employee_id()))
    OR (es_solicitud_operativa(type)
        AND (SELECT auth_has_module_permission('requests', 'can_view'))
        AND CASE (SELECT auth_module_scope('requests'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_view'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))
             -- La sala de respaldo, mientras la de origen esté cerrada.
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer
                   = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[])))))
);

ALTER POLICY approval_requests_update ON public.approval_requests
USING (
    ((modulo_de_aprobacion(type) = 'requests_facturacion')
        AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_facturacion'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((modulo_de_aprobacion(type) = 'requests_inventario')
        AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_inventario'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer
                   = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[])))))
    OR ((employee_id = (SELECT auth_employee_id())) AND (status = 'PENDING'))
    OR ((type = 'SHIFT_CHANGE') AND (status = 'PENDING')
        AND (approver_id = (SELECT auth_employee_id()))
        AND (employee_id <> (SELECT auth_employee_id())))
)
WITH CHECK (
    ((modulo_de_aprobacion(type) = 'requests_facturacion')
        AND (SELECT auth_has_module_permission('requests_facturacion', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_facturacion'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((modulo_de_aprobacion(type) = 'requests_inventario')
        AND (SELECT auth_has_module_permission('requests_inventario', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_inventario'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((NOT es_solicitud_operativa(type))
        AND (SELECT auth_has_module_permission('requests_personales', 'can_approve'))
        AND CASE (SELECT auth_module_scope('requests_personales'))
              WHEN 'ALL'  THEN true
              WHEN 'MINE' THEN false
              ELSE (EXISTS (SELECT 1 FROM employees e
                             WHERE e.id = approval_requests.employee_id
                               AND e.branch_id = (SELECT auth_employee_branch_id())))
            END)
    OR ((type = 'INVENTORY_TRANSFER_REQUEST')
        AND (SELECT auth_has_module_permission('traslados', 'can_approve'))
        AND (((SELECT auth_module_scope('traslados')) = 'ALL')
             OR ((metadata -> 'destinatarios') ? ((SELECT auth_employee_id()))::text)
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'branch_id'),        ''))::integer = (SELECT auth_employee_branch_id()))
             OR ((NULLIF((metadata ->> 'origen_branch_id'), ''))::integer
                   = ANY (COALESCE((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[])))))
    OR ((employee_id = (SELECT auth_employee_id())) AND (status = 'CANCELLED'))
    OR ((type = 'SHIFT_CHANGE') AND (employee_id <> (SELECT auth_employee_id())))
);

-- ── 5 · El aviso ────────────────────────────────────────────────────────────
-- Sin esto la solicitud se le vuelve VISIBLE a la sala de respaldo pero la
-- campana no le suena, y nadie se entera de que hay algo que contestar. Es
-- exactamente el medio arreglo que ya se corrigió el 2026-08-17 para la sala de
-- origen.
--
-- La cascada se evalúa al CREAR la solicitud, así que decide con la hora de ese
-- momento. La policy se evalúa al mirar, así que si la sala cierra más tarde la
-- solicitud igual le aparece a la de respaldo — sólo que sin campanazo.
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_traslado(p_branch_id integer)
RETURNS TABLE(destinatarios uuid[], escalon text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v         uuid[];
    v_resp    integer;
    v_cubre   boolean := false;
BEGIN
    SELECT b.sala_respaldo_id::integer INTO v_resp
      FROM public.branches b WHERE b.id = p_branch_id;
    IF v_resp IS NOT NULL AND NOT public.sala_abierta_ahora(p_branch_id) THEN
        v_cubre := true;
    END IF;

    SELECT array_agg(e.id ORDER BY e.name)
      INTO v
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.branch_id = p_branch_id OR (v_cubre AND e.branch_id = v_resp))
       AND public.puede_confirmar_traslado(e.id);
    IF coalesce(array_length(v, 1), 0) > 0 THEN
        RETURN QUERY SELECT v, CASE WHEN v_cubre THEN 'SALA_Y_RESPALDO' ELSE 'SALA' END;
        RETURN;
    END IF;

    SELECT array_agg(e.id ORDER BY e.name)
      INTO v
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND e.system_role IN ('SUPERVISOR', 'ADMIN', 'SUPERADMIN')
       AND public.puede_confirmar_traslado(e.id);
    RETURN QUERY SELECT v, CASE WHEN coalesce(array_length(v, 1), 0) > 0
                                THEN 'SUPERVISION' ELSE 'NADIE' END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_destinatarios_traslado(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolver_destinatarios_traslado(integer) IS
  'A quien avisarle de un traslado que sale de esa sala: la sala entera que puede confirmarlo, mas su sala de respaldo si en ese momento la esta cubriendo, y Supervision si no hay nadie. Lo confirma la sala, no una persona.';

-- ── 6 · La pantalla dice POR QUÉ le aparece ─────────────────────────────────
-- Se agrega `respaldo` a lo que la decisión ya consulta al abrirse. Sale del
-- servidor y no de una cuenta del navegador: es la MISMA función que autoriza,
-- así que el aviso no puede prometer algo que después el despacho rebote.
CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               nullif(a.metadata->>'origen_branch_id','')::integer       AS origen_bid,
               a.metadata->>'origen_branch_name'                         AS origen_nombre,
               (a.metadata->'items'->0->>'erp_product_id')::integer      AS prod,
               coalesce((a.metadata->'items'->0->>'cantidad')::numeric, 0)
                 * coalesce((a.metadata->'items'->0->>'factor')::numeric, 1) AS pedido
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    stock AS (
        SELECT d.erp_sucursal_id, d.unidades, d.en_vuelo
        FROM public.v_inventario_disponible d CROSS JOIN sol
        WHERE d.erp_product_id = sol.prod
    ),
    minimos AS (
        SELECT sp.erp_sucursal_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) AS minimo
        FROM public.product_stock_params sp CROSS JOIN sol
        WHERE sp.erp_product_id = sol.prod
    )
    SELECT json_build_object(
        'pedido', sol.pedido,
        'origen', json_build_object(
            'erp_sucursal_id', sol.origen,
            'unidades', coalesce(so.unidades, 0),
            'en_vuelo', coalesce(so.en_vuelo, 0),
            'minimo',   coalesce(mo.minimo, 0),
            'puede',    coalesce(so.unidades, 0) >= sol.pedido
        ),
        'respaldo', CASE
            WHEN sol.origen_bid IS NOT NULL
             AND sol.origen_bid = ANY (COALESCE(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))
            THEN json_build_object('sala', coalesce(nullif(sol.origen_nombre, ''), 'La otra sala'))
            ELSE NULL
        END,
        'alternativas', coalesce((
            SELECT json_agg(json_build_object(
                       'erp_sucursal_id', s.erp_sucursal_id,
                       'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                       'unidades',        s.unidades,
                       'minimo',          coalesce(mi.minimo, 0))
                     ORDER BY s.unidades DESC)
            FROM stock s
            LEFT JOIN minimos mi ON mi.erp_sucursal_id = s.erp_sucursal_id
            LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
            WHERE s.erp_sucursal_id <> sol.origen
              AND s.erp_sucursal_id <> sol.destino
              AND s.unidades >= sol.pedido
        ), '[]'::json)
    )
    FROM sol
    LEFT JOIN stock   so ON so.erp_sucursal_id = sol.origen
    LEFT JOIN minimos mo ON mo.erp_sucursal_id = sol.origen;
$function$;
