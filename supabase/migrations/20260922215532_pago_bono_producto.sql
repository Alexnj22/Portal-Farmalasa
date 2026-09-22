-- El bono de PRODUCTO se paga en la sala, con salida de efectivo —
-- docs/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md, Fase 3.
--
-- Reglas del usuario (2026-09-22):
--   · vendedor       → en su sala, con salida de la caja de esa sala;
--   · bodega         → sale de la caja de SALUD 3;
--   · administración → a la planilla; por ahora el portal sólo muestra el monto;
--   · quien paga es la JEFATURA de la sala.
--
-- El dinero se mueve por el camino que ya existe (`operar-caja`, acción
-- `salida`): su freno de doble envío (`clave_envio`), la identidad de quien se
-- lleva el efectivo y el orden «fila del portal → caja». Lo nuevo es el
-- candado del BONO, y vive en la base y no en la pantalla:
--   1. `reservar_pago_bono` calcula el monto en el servidor y entrega una clave;
--   2. la fila de la salida trae esa clave, y un trigger BEFORE INSERT la
--      rechaza si no cuadra — monto, sala, jefatura, quien cobra — ANTES de
--      que `operar-caja` toque la caja;
--   3. el mismo trigger, AFTER, deja el pago en `pagado` cuando la caja acepta.
--
-- Los bonos de la promoción 35 («AD», 25-jul → 31-ago) se marcan pagados fuera
-- del portal, por decisión del usuario el 2026-09-22.

SET lock_timeout = '5s';

-- ── La tabla ────────────────────────────────────────────────────────────────
CREATE TABLE public.promocion_pago (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 'v:<promoción>:<sala>:<persona>' · 'e:<excedente>' · 'b:<promoción>'.
    -- Una fila por cosa pagable: el UNIQUE es el que impide pagar dos veces.
    item          text   NOT NULL UNIQUE,
    tipo          text   NOT NULL CHECK (tipo IN ('vendedor', 'excedente', 'bodega')),
    promocion_id  bigint NOT NULL REFERENCES public.promociones(id),
    excedente_id  bigint REFERENCES public.promocion_excedente(id),
    branch_id     bigint NOT NULL REFERENCES public.branches(id),   -- la caja que paga
    employee_id   uuid   REFERENCES public.employees(id),           -- NULL en bodega
    monto         numeric(12,2) NOT NULL CHECK (monto > 0),
    estado        text   NOT NULL CHECK (estado IN
                      ('reservado', 'enviado', 'pagado', 'anulado', 'fuera_del_portal')),
    clave_envio   text   UNIQUE,
    movimiento_id bigint REFERENCES public.caja_movimientos_portal(id),
    reservado_por uuid   REFERENCES public.employees(id),
    nota          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_promocion_pago_promocion  ON public.promocion_pago (promocion_id);
CREATE INDEX idx_promocion_pago_excedente  ON public.promocion_pago (excedente_id);
CREATE INDEX idx_promocion_pago_branch     ON public.promocion_pago (branch_id);
CREATE INDEX idx_promocion_pago_employee   ON public.promocion_pago (employee_id);
CREATE INDEX idx_promocion_pago_movimiento ON public.promocion_pago (movimiento_id);

ALTER TABLE public.promocion_pago ENABLE ROW LEVEL SECURITY;
CREATE POLICY promocion_pago_select ON public.promocion_pago
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones', 'can_view')));

-- ── Quién es la jefatura de una sala ────────────────────────────────────────
-- El mismo criterio que usa el reparto del bono de meta (`get_bono_meta_sala`):
-- el cargo «Jefe/a de Sala» y la sala asignada en la ficha.
CREATE OR REPLACE FUNCTION public.es_jefe_de_sala(p_employee_id uuid, p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.employees e JOIN public.roles r ON r.id = e.role_id
         WHERE e.id = p_employee_id AND e.branch_id = p_branch_id
           AND e.status = 'ACTIVO' AND r.name = 'Jefe/a de Sala');
$function$;
REVOKE EXECUTE ON FUNCTION public.es_jefe_de_sala(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.es_jefe_de_sala(uuid, bigint) TO service_role;

-- ── Qué se debe pagar ───────────────────────────────────────────────────────
-- Las promociones de producto TERMINADAS con bono. El monto sale del mismo
-- corte del lote que usa el resto del módulo; el excedente, cuando Supervisión
-- lo aprueba. Bodega cobra en Salud 3 (id 27).
CREATE OR REPLACE FUNCTION public.bonos_producto_items()
 RETURNS TABLE(item text, tipo text, promocion_id bigint, promocion text,
               excedente_id bigint, branch_id bigint, employee_id uuid,
               monto numeric, unidades numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN QUERY
    WITH promos AS (
        SELECT p.id, p.nombre FROM public.promociones p
         WHERE p.tipo = 'producto' AND p.estado = 'finalizada'
           AND EXISTS (SELECT 1 FROM public.promocion_renglon r
                        WHERE r.promocion_id = p.id AND r.tiene_bono)
    ),
    corte AS (
        SELECT pr.id AS pid, pr.nombre AS pnombre, c.*
          FROM promos pr CROSS JOIN LATERAL public.promocion_corte_del_lote(pr.id) c
    )
    SELECT 'v:' || c.pid || ':' || c.branch_id || ':' || c.employee_id, 'vendedor'::text,
           c.pid, c.pnombre, NULL::bigint, c.branch_id, c.employee_id,
           round(sum(c.monto_dentro), 2), round(sum(c.u_dentro), 2)
      FROM corte c WHERE c.employee_id IS NOT NULL
     GROUP BY c.pid, c.pnombre, c.branch_id, c.employee_id
    HAVING round(sum(c.monto_dentro), 2) > 0
    UNION ALL
    SELECT 'b:' || c.pid, 'bodega', c.pid, c.pnombre, NULL, 27::bigint, NULL::uuid,
           round(sum(c.fondo_bodega), 2), NULL::numeric
      FROM corte c GROUP BY c.pid, c.pnombre
    HAVING round(sum(c.fondo_bodega), 2) > 0
    UNION ALL
    SELECT 'e:' || ex.id, 'excedente', pm.id, pm.nombre, ex.id, ex.branch_id, ex.employee_id,
           round(ex.monto, 2), ex.unidades::numeric
      FROM public.promocion_excedente ex
      JOIN public.promocion_renglon r ON r.id = ex.renglon_id
      JOIN public.promociones pm ON pm.id = r.promocion_id
     WHERE ex.estado = 'aprobado' AND ex.monto > 0 AND ex.employee_id IS NOT NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.bonos_producto_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonos_producto_items() TO service_role;

-- ── Lo que ve la sala ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bonos_producto_sala(p_branch_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_items json;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: hace falta ver la caja' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('caja_vales') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sólo tu sala' USING ERRCODE = '42501';
    END IF;

    SELECT json_agg(json_build_object(
               'item', i.item, 'tipo', i.tipo, 'promocion', i.promocion,
               'employee_id', i.employee_id, 'nombre', e.name,
               'first_names', e.first_names, 'last_names', e.last_names,
               'monto', i.monto, 'unidades', i.unidades,
               'estado', coalesce(pg.estado, 'pendiente'))
           ORDER BY i.promocion, i.tipo DESC, e.name)
      INTO v_items
      FROM public.bonos_producto_items() i
      LEFT JOIN public.employees e ON e.id = i.employee_id
      LEFT JOIN public.promocion_pago pg ON pg.item = i.item
     WHERE i.branch_id = p_branch_id
       AND coalesce(pg.estado, 'pendiente') NOT IN ('pagado', 'fuera_del_portal');

    RETURN json_build_object(
        'branch_id',   p_branch_id,
        'puedo_pagar', public.es_jefe_de_sala(v_actor, p_branch_id),
        'items',       coalesce(v_items, '[]'::json));
END;
$function$;

-- ── Reservar: el monto lo pone el servidor, y la clave ata la salida ────────
CREATE OR REPLACE FUNCTION public.reservar_pago_bono(p_item text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_it    record;
    v_pago  public.promocion_pago%ROWTYPE;
    v_mov   public.caja_movimientos_portal%ROWTYPE;
    v_clave text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

    SELECT * INTO v_it FROM public.bonos_producto_items() i WHERE i.item = p_item;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: ese bono no está por pagar'; END IF;
    IF NOT public.es_jefe_de_sala(v_actor, v_it.branch_id) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: el bono lo paga la jefatura de la sala'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_pago FROM public.promocion_pago WHERE item = p_item FOR UPDATE;

    IF FOUND THEN
        IF v_pago.estado IN ('pagado', 'fuera_del_portal') THEN
            RAISE EXCEPTION 'YA_PAGADO: ese bono ya se pagó';
        END IF;
        IF v_pago.estado = 'reservado' THEN
            -- El mismo intento que no llegó a la caja: la misma clave, para que
            -- un reintento no pueda escribir dos salidas.
            UPDATE public.promocion_pago SET monto = v_it.monto, updated_at = now()
             WHERE id = v_pago.id;
            v_clave := v_pago.clave_envio;
        ELSE
            -- 'enviado' con la caja sin contestar hace menos de 3 minutos: está
            -- en curso. Más viejo, o 'anulado', se puede volver a intentar con
            -- una clave nueva — la vieja ya no paga nada.
            IF v_pago.estado = 'enviado' THEN
                SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = v_pago.movimiento_id;
                IF v_mov.created_at > now() - interval '3 minutes' THEN
                    RAISE EXCEPTION 'EN_CURSO: ese pago se está registrando en la caja';
                END IF;
            END IF;
            v_clave := 'bono-' || gen_random_uuid();
            UPDATE public.promocion_pago
               SET estado = 'reservado', clave_envio = v_clave, monto = v_it.monto,
                   movimiento_id = NULL, reservado_por = v_actor, updated_at = now()
             WHERE id = v_pago.id;
        END IF;
    ELSE
        v_clave := 'bono-' || gen_random_uuid();
        INSERT INTO public.promocion_pago
            (item, tipo, promocion_id, excedente_id, branch_id, employee_id, monto,
             estado, clave_envio, reservado_por)
        VALUES (v_it.item, v_it.tipo, v_it.promocion_id, v_it.excedente_id, v_it.branch_id,
                v_it.employee_id, v_it.monto, 'reservado', v_clave, v_actor);
    END IF;

    RETURN json_build_object(
        'clave', v_clave, 'monto', v_it.monto, 'tipo', v_it.tipo,
        'branch_id', v_it.branch_id, 'employee_id', v_it.employee_id,
        'concepto', CASE v_it.tipo WHEN 'bodega' THEN 'Bono bodega '
                                   WHEN 'excedente' THEN 'Bono excedente '
                                   ELSE 'Bono ' END || v_it.promocion);
END;
$function$;

-- ── El candado sobre la salida ──────────────────────────────────────────────
-- BEFORE INSERT: si la salida dice pagar un bono, tiene que ser ESE bono. Si no
-- cuadra, se rechaza la fila, y como `operar-caja` escribe la fila ANTES de
-- tocar la caja, no se mueve un centavo.
CREATE OR REPLACE FUNCTION public.caja_movimiento_valida_bono()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.promocion_pago%ROWTYPE;
BEGIN
    SELECT * INTO v FROM public.promocion_pago WHERE clave_envio = NEW.clave_envio FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BONO_SIN_RESERVA: esa salida no corresponde a ningún bono reservado'; END IF;
    IF v.estado <> 'reservado' THEN RAISE EXCEPTION 'BONO_NO_RESERVADO: ese bono ya no está por pagar'; END IF;
    IF NEW.tipo <> 'SALIDA' OR NEW.branch_id::bigint <> v.branch_id THEN
        RAISE EXCEPTION 'BONO_OTRA_CAJA: el bono se paga desde la caja de su sala';
    END IF;
    IF NEW.monto <> v.monto THEN
        RAISE EXCEPTION 'BONO_OTRO_MONTO: el bono es de % y la salida dice %', v.monto, NEW.monto;
    END IF;
    IF NOT public.es_jefe_de_sala(NEW.registrado_por, v.branch_id) THEN
        RAISE EXCEPTION 'BONO_SIN_JEFATURA: el bono lo paga la jefatura de la sala';
    END IF;
    IF v.employee_id IS NOT NULL AND NEW.recibido_por IS DISTINCT FROM v.employee_id THEN
        RAISE EXCEPTION 'BONO_OTRA_PERSONA: el efectivo lo tiene que recibir la persona que ganó el bono';
    END IF;
    IF v.employee_id IS NULL AND NEW.recibido_por IS NULL THEN
        RAISE EXCEPTION 'BONO_SIN_RECEPTOR: hay que identificar a quien recibe el efectivo';
    END IF;
    RETURN NEW;
END;
$function$;

-- AFTER: el estado del pago sigue a la fila — enviada, aceptada por la caja
-- (`erp_movimiento_id`) o anulada después.
CREATE OR REPLACE FUNCTION public.caja_movimiento_sigue_bono()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    UPDATE public.promocion_pago
       SET movimiento_id = NEW.id,
           estado = CASE WHEN NEW.anulado_at IS NOT NULL THEN 'anulado'
                         WHEN NEW.erp_movimiento_id IS NOT NULL THEN 'pagado'
                         ELSE 'enviado' END,
           updated_at = now()
     WHERE clave_envio = NEW.clave_envio
       AND estado NOT IN ('fuera_del_portal');
    RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.caja_movimiento_valida_bono() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.caja_movimiento_sigue_bono() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER caja_movimiento_valida_bono
    BEFORE INSERT ON public.caja_movimientos_portal
    FOR EACH ROW WHEN (NEW.clave_envio LIKE 'bono-%')
    EXECUTE FUNCTION public.caja_movimiento_valida_bono();

CREATE TRIGGER caja_movimiento_sigue_bono
    AFTER INSERT OR UPDATE OF erp_movimiento_id, anulado_at ON public.caja_movimientos_portal
    FOR EACH ROW WHEN (NEW.clave_envio LIKE 'bono-%')
    EXECUTE FUNCTION public.caja_movimiento_sigue_bono();

-- ── Lo que ve Promociones: cuánto se pagó y lo de administración ────────────
CREATE OR REPLACE FUNCTION public.get_pagos_bono_producto()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones', 'can_view') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: hace falta ver Promociones' USING ERRCODE = '42501';
    END IF;

    WITH items AS (
        SELECT i.*, coalesce(pg.estado, 'pendiente') AS estado
          FROM public.bonos_producto_items() i
          LEFT JOIN public.promocion_pago pg ON pg.item = i.item
    ),
    adm AS (
        SELECT pm.id AS promocion_id, round(sum(c.fondo_adm), 2) AS monto
          FROM public.promociones pm
         CROSS JOIN LATERAL public.promocion_corte_del_lote(pm.id) c
         WHERE pm.tipo = 'producto' AND pm.estado = 'finalizada'
           AND pm.id IN (SELECT DISTINCT promocion_id FROM items)
         GROUP BY pm.id
    )
    SELECT json_agg(json_build_object(
               'promocion_id', p.promocion_id, 'promocion', p.promocion,
               'salas', p.salas, 'bodega', p.bodega,
               'administracion', coalesce(a.monto, 0))
           ORDER BY p.promocion)
      INTO v
      FROM (
          SELECT it.promocion_id, it.promocion,
                 (SELECT json_agg(json_build_object(
                             'branch_id', s.branch_id, 'sala', b.name,
                             'total', s.total, 'pagado', s.pagado, 'personas', s.personas,
                             'pendientes', s.pendientes) ORDER BY b.name)
                    FROM (SELECT x.branch_id, sum(x.monto) AS total,
                                 sum(x.monto) FILTER (WHERE x.estado IN ('pagado', 'fuera_del_portal')) AS pagado,
                                 count(*) AS personas,
                                 count(*) FILTER (WHERE x.estado NOT IN ('pagado', 'fuera_del_portal')) AS pendientes
                            FROM items x
                           WHERE x.promocion_id = it.promocion_id AND x.tipo <> 'bodega'
                           GROUP BY x.branch_id) s
                    JOIN public.branches b ON b.id = s.branch_id) AS salas,
                 (SELECT json_build_object('monto', x.monto, 'estado', x.estado)
                    FROM items x WHERE x.promocion_id = it.promocion_id AND x.tipo = 'bodega') AS bodega
            FROM items it
           GROUP BY it.promocion_id, it.promocion
      ) p
      LEFT JOIN adm a ON a.promocion_id = p.promocion_id;

    RETURN coalesce(v, '[]'::json);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bonos_producto_sala(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reservar_pago_bono(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_pagos_bono_producto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bonos_producto_sala(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reservar_pago_bono(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pagos_bono_producto() TO authenticated, service_role;

-- ── «AD» (id 35): pagada fuera del portal ───────────────────────────────────
INSERT INTO public.promocion_pago
    (item, tipo, promocion_id, excedente_id, branch_id, employee_id, monto, estado, nota)
SELECT i.item, i.tipo, i.promocion_id, i.excedente_id, i.branch_id, i.employee_id, i.monto,
       'fuera_del_portal', 'Pagada fuera del portal — decisión del usuario, 2026-09-22'
  FROM public.bonos_producto_items() i
 WHERE i.promocion_id = 35;
