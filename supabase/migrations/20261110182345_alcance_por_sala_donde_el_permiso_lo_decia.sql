-- El alcance por sala, aplicado donde el permiso ya lo decía y la base no lo
-- miraba (2026-11-10). Auditoría pedida por el usuario: «que nadie (menos
-- admin) vea lo de otras sucursales… verificar que los permisos estén
-- aplicados en todos lados y bien aplicados».
--
-- Ninguna asignación de Acceso cambia salvo la del punto 4, que eligió el
-- usuario. Lo que cambia es que la base respete la que ya había:
--
-- 1. Ocho tablas con sala cuya policy de lectura pedía el permiso pero no su
--    alcance: un cargo con el módulo «de su sala» leía todas las salas
--    consultando la tabla directo. Ahora siguen el patrón de
--    `creditos_de_clientes`: ALL ve todas; el resto, la suya. Las funciones
--    del servidor que las usan van con la llave de servicio (no les afecta), y
--    las tres lecturas del navegador ya pedían la sala propia o pasan por
--    `sales_invoices`, que filtra igual.
-- 2. Tres funciones de Bolsas que devolvían una bolsa u operación por su
--    número a cualquiera con `bolsas`: ahora exigen que sea de su sala.
-- 3. `set_traslado_interruptor` pausa los traslados de TODA la red y sólo
--    pedía `pedidos can_edit`, que tienen los cargos de sala con alcance de su
--    sala. Ahora exige alcance ALL (la única pantalla que lo usa es
--    Mantenimiento, de administración).
-- 4. Médico Consultante, Auxiliar de Servicios Generales y Técnico de
--    Mantenimiento: se les quitan las pestañas de Facturación y de Ventas, que
--    tenían con alcance de toda la red (decisión del usuario). El Inicio pasa a
--    su sala. El Técnico conserva Traslados de toda la red: se mueve entre salas.
SET lock_timeout = '5s';

-- ── 1. Tablas ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS creditos_cobros_por_aprobar_select ON public.creditos_cobros_por_aprobar;
CREATE POLICY creditos_cobros_por_aprobar_select ON public.creditos_cobros_por_aprobar
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cuentas_por_cobrar', 'can_view'))
         AND ((SELECT public.auth_module_scope('cuentas_por_cobrar')) = 'ALL'
              OR branch_id = (SELECT public.auth_employee_branch_id())));

DROP POLICY IF EXISTS creditos_lectura_sala_select ON public.creditos_lectura_sala;
CREATE POLICY creditos_lectura_sala_select ON public.creditos_lectura_sala
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('cuentas_por_cobrar', 'can_view'))
         AND ((SELECT public.auth_module_scope('cuentas_por_cobrar')) = 'ALL'
              OR branch_id = (SELECT public.auth_employee_branch_id())));

DROP POLICY IF EXISTS apartado_aplicaciones_select ON public.apartado_aplicaciones;
CREATE POLICY apartado_aplicaciones_select ON public.apartado_aplicaciones
  FOR SELECT TO authenticated
  USING (((SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
          AND ((SELECT public.auth_module_scope('cortes_caja')) = 'ALL'
               OR branch_id = (SELECT public.auth_employee_branch_id())))
      OR ((SELECT public.auth_has_module_permission('caja_vales', 'can_view'))
          AND ((SELECT public.auth_module_scope('caja_vales')) = 'ALL'
               OR branch_id = (SELECT public.auth_employee_branch_id()))));

DROP POLICY IF EXISTS caja_cierres_con_diferencia_select ON public.caja_cierres_con_diferencia;
CREATE POLICY caja_cierres_con_diferencia_select ON public.caja_cierres_con_diferencia
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('caja_vales', 'can_view'))
         AND ((SELECT public.auth_module_scope('caja_vales')) = 'ALL'
              OR branch_id = (SELECT public.auth_employee_branch_id())));

-- El saldo a favor lo maneja también quien hoy cubre esa sala, como el resto
-- de Reservas (`reserva_puede_manejar`).
DROP POLICY IF EXISTS saldo_favor_movimientos_select ON public.saldo_favor_movimientos;
CREATE POLICY saldo_favor_movimientos_select ON public.saldo_favor_movimientos
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('dash_reservas', 'can_view'))
         AND ((SELECT public.auth_module_scope('dash_reservas')) = 'ALL'
              OR public.reserva_puede_manejar(branch_id)));

DROP POLICY IF EXISTS pedido_devolucion_select ON public.pedido_devolucion;
CREATE POLICY pedido_devolucion_select ON public.pedido_devolucion
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('pedidos', 'can_view'))
         AND ((SELECT public.auth_module_scope('pedidos')) = 'ALL'
              OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())));

DROP POLICY IF EXISTS antibioticos_lote_diario_select ON public.antibioticos_lote_diario;
CREATE POLICY antibioticos_lote_diario_select ON public.antibioticos_lote_diario
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view'))
         AND ((SELECT public.auth_module_scope('bitacoras_tab_antibioticos')) = 'ALL'
              OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())));

-- `sucursal` es el código de puntos de la sala (FLS1…).
DROP POLICY IF EXISTS puntos_enviados_select ON public.puntos_enviados;
CREATE POLICY puntos_enviados_select ON public.puntos_enviados
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('ventas', 'can_view'))
         AND ((SELECT public.auth_module_scope('ventas')) = 'ALL'
              OR sucursal = (SELECT b.codigo_puntos FROM public.branches b
                              WHERE b.id = (SELECT public.auth_employee_branch_id()))));

-- ── 2. Bolsas por número ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bolsa_eventos(p_bolsa_id bigint)
 RETURNS TABLE(id bigint, accion text, estado_antes text, estado_despues text, motivo text, nota text, monto numeric, created_at timestamp with time zone, employee_id uuid, nombre text, photo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT ev.id, ev.accion, ev.estado_antes, ev.estado_despues,
           ev.motivo, ev.nota, ev.monto, ev.created_at,
           ev.employee_id, e.name, e.photo_url
      FROM public.bolsas_eventos ev
      LEFT JOIN public.employees e ON e.id = ev.employee_id
     WHERE ev.bolsa_id = p_bolsa_id
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
       -- Alcance (2026-11-10): sin ALL, sólo una bolsa de su sala.
       AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
            OR EXISTS (SELECT 1 FROM public.bolsas b
                        WHERE b.id = p_bolsa_id AND b.branch_id = (SELECT auth_employee_branch_id())))
     ORDER BY ev.created_at DESC, ev.id DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_salidas_de_bolsa(p_bolsa_id bigint)
 RETURNS TABLE(movimiento_id bigint, vale_folio text, monto numeric, registrado_at timestamp with time zone, impreso_at timestamp with time zone, anulado_at timestamp with time zone, operacion_id bigint, operacion_folio text, tipo text, etiqueta text, etiqueta_entidad text, monto_operacion numeric, entidad text, numero_boleta text, foto_url text, nota text, recibido_nombre text, recibido_metodo text, registrado_nombre text, leyenda text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT m.id, m.vale_folio, m.monto, m.registrado_at, m.impreso_at, m.anulado_at,
           o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, o.monto, o.entidad,
           o.numero_boleta, o.foto_url, o.nota, er.name, o.recibido_metodo, eq.name,
           t.leyenda
      FROM public.bolsas_movimientos m
      JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
      JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
      LEFT JOIN public.employees er ON er.id = o.recibido_por
      LEFT JOIN public.employees eq ON eq.id = m.registrado_por
     WHERE m.bolsa_id = p_bolsa_id
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
       -- Alcance (2026-11-10): sin ALL, sólo una bolsa de su sala.
       AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
            OR EXISTS (SELECT 1 FROM public.bolsas b
                        WHERE b.id = p_bolsa_id AND b.branch_id = (SELECT auth_employee_branch_id())))
     ORDER BY m.registrado_at;
$function$;

CREATE OR REPLACE FUNCTION public.get_operacion_de_bolsa(p_operacion_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT to_json(x) FROM (
        SELECT o.id, o.folio, o.tipo, t.etiqueta, t.etiqueta_entidad, t.leyenda,
               o.monto, o.entidad, o.numero_boleta, o.nota,
               o.registrado_at, o.recibido_metodo, o.branch_id, o.anulada_at,
               eq.name  AS registrado_nombre,
               er.name  AS recibido_nombre,
               br.name  AS sala,
               (SELECT coalesce(json_agg(to_json(l)
                                ORDER BY l.bolsa_fecha, l.bolsa_hora, l.bolsa_id), '[]'::json)
                  FROM (
                    SELECT m.id AS movimiento_id, m.vale_folio, m.monto,
                           m.anulado_at, m.impreso_at,
                           b.id AS bolsa_id, b.folio AS bolsa_folio,
                           b.fecha AS bolsa_fecha, b.hora AS bolsa_hora,
                           round(b.monto_inicial + coalesce((
                               SELECT sum(m2.monto)
                                 FROM public.bolsas_movimientos m2
                                WHERE m2.bolsa_id = b.id
                                  AND m2.anulado_at IS NULL
                                  AND m2.registrado_at <= m.registrado_at
                           ), 0), 2) AS saldo_despues
                      FROM public.bolsas_movimientos m
                      JOIN public.bolsas b ON b.id = m.bolsa_id
                     WHERE m.operacion_id = o.id
                  ) l) AS lineas,
               (SELECT to_json(c) FROM (
                    SELECT cm.id AS movimiento_id, cm.monto, cm.erp_movimiento_id,
                           cm.anulado_at, cm.branch_id
                      FROM public.caja_movimientos_portal cm
                     WHERE cm.bolsa_operacion_id = o.id
                     ORDER BY (cm.anulado_at IS NULL) DESC, cm.id DESC
                     LIMIT 1) c) AS caja
          FROM public.bolsas_operaciones o
          JOIN public.bolsas_tipos_salida t ON t.codigo = o.tipo
          LEFT JOIN public.branches  br ON br.id = o.branch_id
          LEFT JOIN public.employees er ON er.id = o.recibido_por
          LEFT JOIN public.employees eq ON eq.id = o.registrado_por
         WHERE o.id = p_operacion_id
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           -- Alcance (2026-11-10): sin ALL, sólo una operación de su sala.
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR o.branch_id = (SELECT auth_employee_branch_id()))
    ) x;
$function$;

-- ── 3. El interruptor de toda la red ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_traslado_interruptor(p_accion text, p_pausado boolean, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT auth_has_module_permission('pedidos', 'can_edit')) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;
    -- Pausa los traslados de TODA la red (2026-11-10): editar pedidos de una
    -- sola sala no alcanza.
    IF (SELECT auth_module_scope('pedidos')) IS DISTINCT FROM 'ALL' THEN
        RAISE EXCEPTION 'PERMISSION_DENIED';
    END IF;

    UPDATE public.traslado_interruptor
       SET pausado      = p_pausado,
           motivo       = nullif(btrim(coalesce(p_motivo, '')), ''),
           cambiado_por = (SELECT auth_employee_id()),
           cambiado_at  = now()
     WHERE accion = p_accion;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    RETURN jsonb_build_object('accion', p_accion, 'pausado', p_pausado);
END;
$function$;

-- ── 4. Facturación y Ventas fuera de tres cargos (decisión del usuario) ────
-- 24 Médico Consultante, 26 Auxiliar de Servicios Generales,
-- 27 Técnico de Mantenimiento y Servicios Generales.
DELETE FROM public.role_permissions
 WHERE role_id IN (24, 26, 27)
   AND (module_key LIKE 'facturacion_tab_%' OR module_key LIKE 'ventas_tab_%');

UPDATE public.role_permissions SET scope = 'BRANCH', updated_at = now()
 WHERE role_id IN (26, 27) AND module_key = 'overview' AND scope = 'ALL';
