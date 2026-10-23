-- segunda-a2-02 · promociones: el bono se paga por diferencia (H15, H19, H20)
-- H15 pago por tramo (lo pagado se lee de promocion_pago, pendiente = vivo - pagado)
-- H19 la persona se resuelve por código sin filtrar por estado
-- H20 pago 'enviado' sin respuesta frena con SIN_CONFIRMAR (resolver_pago_bono_sin_confirmar)
-- Partido de las definiciones VIVAS de producción (2026-10-23).
SET lock_timeout = '5s';

-- Un excedente ya decidido no se pisa: lo vendido después es otro tramo.
ALTER TABLE public.promocion_excedente ADD COLUMN IF NOT EXISTS tramo integer NOT NULL DEFAULT 1;
ALTER TABLE public.promocion_excedente DROP CONSTRAINT IF EXISTS promocion_excedente_renglon_id_employee_id_key;
ALTER TABLE public.promocion_excedente
    ADD CONSTRAINT promocion_excedente_renglon_empleado_tramo_key UNIQUE (renglon_id, employee_id, tramo);

CREATE OR REPLACE FUNCTION public.promocion_corte_del_lote(p_promocion_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(renglon_id bigint, promocion_id bigint, cod_vendedor text, employee_id uuid, branch_id bigint, u_dentro numeric, u_excedente numeric, monto_dentro numeric, monto_excedente numeric, fondo_adm numeric, fondo_bodega numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
    v_ini   date;
    v_fin   date;
    v_prods integer[];
BEGIN
    SELECT min(r.inicio), max(r.fin), array_agg(DISTINCT r.erp_product_id)
      INTO v_ini, v_fin, v_prods
      FROM public.promocion_renglon r
     WHERE p_promocion_id IS NULL OR r.promocion_id = p_promocion_id;

    IF v_ini IS NULL THEN RETURN; END IF;

    RETURN QUERY
    -- `items` PRIMERO: el producto filtra fuerte y tiene índice. `facturas`
    -- sólo mira las que algún renglón referencia.
    WITH items AS MATERIALIZED (
        SELECT ii.id, ii.invoice_id, ii.erp_product_id, ii.factor_unidades, ii.cantidad
          FROM public.sales_invoice_items ii
         WHERE ii.erp_product_id = ANY (v_prods)
    ),
    facturas AS MATERIALIZED (
        SELECT si.id, si.branch_id, si.cod_vendedor, si.fecha
          FROM public.sales_invoices si
         WHERE si.fecha >= v_ini AND si.fecha <= v_fin
           AND public.venta_valida(si.estado)
           AND si.id IN (SELECT i2.invoice_id FROM items i2)
    ),
    lineas AS (
        SELECT r.id AS renglon_id, r.promocion_id, r.lote_total,
               f.id AS invoice_id, i.id AS item_id,
               f.branch_id, f.cod_vendedor, f.fecha,
               (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric AS u_base,
               CASE WHEN r.factor_unidades IS NULL
                    THEN (i.cantidad * greatest(coalesce(i.factor_unidades,1),1))::numeric
                    ELSE i.cantidad::numeric
               END AS u_pago
          FROM items i
          JOIN facturas f ON f.id = i.invoice_id
          JOIN public.promocion_renglon r
            ON r.erp_product_id = i.erp_product_id
           AND f.fecha BETWEEN r.inicio AND r.fin
           AND (r.factor_unidades IS NULL OR i.factor_unidades = r.factor_unidades)
           AND (p_promocion_id IS NULL OR r.promocion_id = p_promocion_id)
         WHERE NOT EXISTS (SELECT 1 FROM public.ventas_sin_producto v
                            WHERE v.invoice_id = f.id)
           -- ── Las salas donde APLICA ────────────────────────────────────
           -- Sin ninguna fila de reparto cuenta todas —el caso más común y el
           -- comportamiento de siempre—. Con salas marcadas, una venta hecha
           -- fuera de ellas no genera bono.
           AND (NOT EXISTS (SELECT 1 FROM public.promocion_reparto pr0
                             WHERE pr0.renglon_id = r.id)
                OR EXISTS (SELECT 1 FROM public.promocion_reparto pr
                            WHERE pr.renglon_id = r.id AND pr.branch_id = f.branch_id))
    ),
    -- La tarifa VIGENTE a la fecha de cada venta. Acá vive «sin retroactividad».
    con_tarifa AS (
        SELECT l.*, t.id AS tarifa_id, t.bono_vendedor, t.bono_adm, t.bono_bodega,
               greatest(coalesce(t.unidades_por_bono, 1), 1) AS upb
          FROM lineas l
          JOIN LATERAL (
              SELECT tt.id, tt.bono_vendedor, tt.bono_adm, tt.bono_bodega,
                     tt.unidades_por_bono
                FROM public.promocion_renglon_tarifa tt
               WHERE tt.renglon_id = l.renglon_id AND tt.desde <= l.fecha
               ORDER BY tt.desde DESC LIMIT 1
          ) t ON true
    ),
    ordenadas AS (
        SELECT c.*,
               sum(c.u_base) OVER (PARTITION BY c.renglon_id
                                   ORDER BY c.fecha, c.invoice_id, c.item_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
          FROM con_tarifa c
    ),
    partidas AS (
        SELECT o.*,
               greatest(least(o.u_base, o.lote_total - (o.acum - o.u_base)), 0) AS cabe
          FROM ordenadas o
    ),
    por_tramo AS (
        SELECT p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id,
               max(p.upb)           AS upb,
               max(p.bono_vendedor) AS monto,
               max(p.bono_adm)      AS monto_adm,
               max(p.bono_bodega)   AS monto_bod,
               sum(p.cabe)                                              AS u_base_dentro,
               sum(p.u_base - p.cabe)                                   AS u_base_fuera,
               sum(p.cabe              * (p.u_pago / nullif(p.u_base,0))) AS u_pago_dentro,
               sum((p.u_base - p.cabe) * (p.u_pago / nullif(p.u_base,0))) AS u_pago_fuera
          FROM partidas p
         GROUP BY p.renglon_id, p.promocion_id, p.cod_vendedor, p.branch_id, p.tarifa_id
    )
    SELECT t.renglon_id, t.promocion_id, t.cod_vendedor,
           e.id, t.branch_id,
           sum(t.u_base_dentro),
           sum(t.u_base_fuera),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_fuera  / t.upb) * t.monto), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_adm), 2),
           round(sum(floor(t.u_pago_dentro / t.upb) * t.monto_bod), 2)
      FROM por_tramo t
      -- H19: el código identifica a la ficha (único). Filtrar por ACTIVO de
      -- HOY borraba el bono ya ganado de quien renunció antes de cobrarlo.
      LEFT JOIN public.employees e
             ON e.code = t.cod_vendedor
     GROUP BY t.renglon_id, t.promocion_id, t.cod_vendedor, e.id, t.branch_id
    HAVING sum(t.u_base_dentro + t.u_base_fuera) > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bonos_producto_items()
 RETURNS TABLE(item text, tipo text, promocion_id bigint, promocion text, excedente_id bigint, branch_id bigint, employee_id uuid, monto numeric, unidades numeric)
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
    ),
    -- Lo ganado, recalculado en vivo, por clave BASE.
    vivos AS (
        SELECT 'v:' || c.pid || ':' || c.branch_id || ':' || c.employee_id AS base, 'vendedor'::text AS tipo,
               c.pid, c.pnombre, NULL::bigint AS exc, c.branch_id AS sala, c.employee_id AS emp,
               round(sum(c.monto_dentro), 2) AS monto, round(sum(c.u_dentro), 2) AS unidades
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
         WHERE ex.estado = 'aprobado' AND ex.monto > 0 AND ex.employee_id IS NOT NULL
    ),
    -- H15: lo que ya SALIÓ por cada clave base, sumando todos sus tramos.
    pagado AS (
        SELECT split_part(pg.item, '#', 1) AS base, sum(pg.monto) AS monto, count(*) AS tramos
          FROM public.promocion_pago pg
         WHERE pg.estado IN ('pagado', 'fuera_del_portal')
         GROUP BY 1
    )
    -- Lo pagado, con el monto que salió de verdad (no el recalculado).
    SELECT pg.item, pg.tipo, pg.promocion_id, pm.nombre, pg.excedente_id, pg.branch_id,
           pg.employee_id, pg.monto, NULL::numeric
      FROM public.promocion_pago pg
      JOIN public.promociones pm ON pm.id = pg.promocion_id
     WHERE pg.estado IN ('pagado', 'fuera_del_portal')
    UNION ALL
    -- Lo pendiente: lo ganado menos lo pagado. Sin pagos, la clave de siempre;
    -- con pagos, una clave nueva por tramo, así la ya pagada no la traba.
    SELECT CASE WHEN p.base IS NULL THEN v.base ELSE v.base || '#' || (p.tramos + 1) END,
           v.tipo, v.pid, v.pnombre, v.exc, v.sala, v.emp,
           round(v.monto - coalesce(p.monto, 0), 2), v.unidades
      FROM vivos v
      LEFT JOIN pagado p ON p.base = v.base
     WHERE round(v.monto - coalesce(p.monto, 0), 2) > 0;
END;
$function$;

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
                -- H20: la caja no contestó, pero pudo haberlo anotado. Repetir
                -- con otra clave escribiría una segunda salida. Primero alguien
                -- mira la caja y lo resuelve (resolver_pago_bono_sin_confirmar).
                IF v_mov.id IS NOT NULL AND v_mov.anulado_at IS NULL THEN
                    RAISE EXCEPTION 'SIN_CONFIRMAR: la caja no confirmó la salida de $% de este bono. Revisa en la caja si salió antes de repetirla', v_pago.monto;
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

CREATE OR REPLACE FUNCTION public.resolver_pago_bono_sin_confirmar(p_item text, p_salio boolean, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- H20: un pago de bono quedó 'enviado' y la caja nunca confirmó. Quien paga
-- mira la caja y dice si la salida está o no. Si salió, el bono queda pagado;
-- si no, el movimiento del portal se anula y el bono vuelve a quedar por pagar.
DECLARE
    v_actor uuid := public.auth_employee_id();
    v_pago  public.promocion_pago%ROWTYPE;
    v_mov   public.caja_movimientos_portal%ROWTYPE;
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
    IF p_salio IS NULL THEN RAISE EXCEPTION 'FALTA_RESPUESTA: ¿salió o no salió de la caja?'; END IF;
    IF v_nota IS NULL THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO: anota qué viste en la caja'; END IF;

    SELECT * INTO v_pago FROM public.promocion_pago WHERE item = p_item FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE: ese bono no tiene un pago en curso'; END IF;
    IF NOT (public.es_jefe_de_sala(v_actor, v_pago.branch_id)
            OR (SELECT public.auth_can_edit_any(ARRAY['promociones']))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: lo resuelve la jefatura de la sala' USING ERRCODE = '42501';
    END IF;
    IF v_pago.estado <> 'enviado' THEN
        RAISE EXCEPTION 'NO_PENDIENTE: ese pago ya no espera respuesta de la caja (%)', v_pago.estado;
    END IF;
    SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = v_pago.movimiento_id FOR UPDATE;
    IF FOUND AND v_mov.created_at > now() - interval '3 minutes' THEN
        RAISE EXCEPTION 'EN_CURSO: ese pago se está registrando en la caja';
    END IF;

    IF p_salio THEN
        UPDATE public.promocion_pago
           SET estado = 'pagado', updated_at = now(),
               nota = left('Confirmado a mano: ' || v_nota, 500)
         WHERE id = v_pago.id;
    ELSE
        IF FOUND AND v_mov.anulado_at IS NULL THEN
            -- El trigger caja_movimiento_sigue_bono lo pasa a 'anulado'.
            UPDATE public.caja_movimientos_portal
               SET anulado_at = now(), anulado_por = v_actor,
                   anulado_motivo = left('La caja no confirmó la salida: ' || v_nota, 500),
                   updated_at = now()
             WHERE id = v_mov.id;
        END IF;
        UPDATE public.promocion_pago
           SET estado = 'anulado', updated_at = now(),
               nota = left('No salió de la caja: ' || v_nota, 500)
         WHERE id = v_pago.id;
    END IF;

    RETURN json_build_object('item', p_item, 'estado', CASE WHEN p_salio THEN 'pagado' ELSE 'anulado' END);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolver_pago_bono_sin_confirmar(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_pago_bono_sin_confirmar(text, boolean, text) TO authenticated, service_role;

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
               'estado', coalesce(pg.estado, 'pendiente'),
               -- H19: el bono de quien ya no trabaja sigue acá, dicho.
               'activo', coalesce(e.status = 'ACTIVO', true),
               -- H20: la caja no contestó y ya pasó el rato: hay que resolverlo.
               'sin_confirmar', pg.estado = 'enviado'
                    AND EXISTS (SELECT 1 FROM public.caja_movimientos_portal m
                                 WHERE m.id = pg.movimiento_id AND m.anulado_at IS NULL
                                   AND m.created_at <= now() - interval '3 minutes'))
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
                                 count(DISTINCT x.employee_id) AS personas,
                                 count(*) FILTER (WHERE x.estado NOT IN ('pagado', 'fuera_del_portal')) AS pendientes
                            FROM items x
                           WHERE x.promocion_id = it.promocion_id AND x.tipo <> 'bodega'
                           GROUP BY x.branch_id) s
                    JOIN public.branches b ON b.id = s.branch_id) AS salas,
                 -- Con tramos (H15) la bodega puede tener lo pagado y un resto.
                 (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
                             'monto', sum(x.monto),
                             'pagado', coalesce(sum(x.monto) FILTER (WHERE x.estado IN ('pagado', 'fuera_del_portal')), 0),
                             'estado', coalesce((array_agg(x.estado) FILTER (WHERE x.estado NOT IN ('pagado', 'fuera_del_portal')))[1],
                                                max(x.estado))) END
                    FROM items x WHERE x.promocion_id = it.promocion_id AND x.tipo = 'bodega') AS bodega
            FROM items it
           GROUP BY it.promocion_id, it.promocion
      ) p
      LEFT JOIN adm a ON a.promocion_id = p.promocion_id;

    RETURN coalesce(v, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.promociones_registrar_excedentes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- H15: antes, `ON CONFLICT … DO UPDATE … WHERE estado = 'por_decidir'`: lo
-- vendido DESPUÉS de una decisión no se sumaba nunca. Ahora lo ya decidido se
-- resta y lo que sobra es otro tramo por decidir; mientras nadie decide, el
-- tramo abierto se actualiza como antes.
DECLARE
    v_n   integer := 0;
    v     record;
    v_u_dec integer; v_m_dec numeric; v_tr integer;
    v_u   integer; v_m numeric;
    v_k   integer;
BEGIN
    FOR v IN
        SELECT c.renglon_id, c.employee_id,
               (array_agg(c.branch_id ORDER BY c.u_excedente DESC))[1] AS branch_id,
               floor(sum(c.u_excedente))::integer AS u, sum(c.monto_excedente) AS m
          FROM public.promocion_corte_del_lote(NULL) c
          JOIN public.promocion_renglon r ON r.id = c.renglon_id
          JOIN public.promociones pm      ON pm.id = r.promocion_id
         WHERE c.employee_id IS NOT NULL
           AND pm.estado <> 'borrador'
         GROUP BY c.renglon_id, c.employee_id
        HAVING sum(c.u_excedente) >= 1
    LOOP
        SELECT coalesce(sum(x.unidades), 0), coalesce(sum(x.monto), 0)
          INTO v_u_dec, v_m_dec
          FROM public.promocion_excedente x
         WHERE x.renglon_id = v.renglon_id AND x.employee_id = v.employee_id
           AND x.estado <> 'por_decidir';
        SELECT coalesce(max(x.tramo), 0) INTO v_tr
          FROM public.promocion_excedente x
         WHERE x.renglon_id = v.renglon_id AND x.employee_id = v.employee_id;

        v_u := v.u - v_u_dec;
        v_m := greatest(round(v.m - v_m_dec, 2), 0);
        CONTINUE WHEN v_u < 1;

        UPDATE public.promocion_excedente x
           SET unidades = v_u, monto = v_m
         WHERE x.renglon_id = v.renglon_id AND x.employee_id = v.employee_id
           AND x.estado = 'por_decidir'
           AND (x.unidades, x.monto) IS DISTINCT FROM (v_u, v_m);
        GET DIAGNOSTICS v_k = ROW_COUNT;
        IF v_k > 0 THEN
            v_n := v_n + v_k;
        ELSIF NOT EXISTS (SELECT 1 FROM public.promocion_excedente x
                           WHERE x.renglon_id = v.renglon_id AND x.employee_id = v.employee_id
                             AND x.estado = 'por_decidir') THEN
            INSERT INTO public.promocion_excedente
                (renglon_id, employee_id, branch_id, unidades, monto, tramo)
            VALUES (v.renglon_id, v.employee_id, v.branch_id, v_u, v_m, v_tr + 1);
            v_n := v_n + 1;
        END IF;
    END LOOP;
    RETURN v_n;
END;
$function$;
