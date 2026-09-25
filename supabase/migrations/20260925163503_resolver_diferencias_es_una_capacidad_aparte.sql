SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Resolver una diferencia de caja deja de viajar con «editar cortes».
--
-- Decidido por el usuario el 2026-09-25: la pestaña Diferencias la VE quien ya
-- ve Cortes de caja, pero resolver, asignar responsables y abonar lo hacen sólo
-- los cargos con alcance de todas las salas y, en la sala, Jefe/a y Subjefe/a.
-- Fuera quedan Dependiente de Farmacia y Regente de Enfermería. «Así se lleva
-- mejor control.»
--
-- El motivo de fondo: con `can_edit` de `cortes_caja`, una Dependiente podía
-- asignar los responsables de un faltante de SU propia sala — elegir quién
-- paga, incluida ella misma o nadie de su turno.
--
-- Confirmar y descartar cortes (`resolver_corte_caja`, `reabrir_corte_caja`)
-- NO cambia: la sala sigue firmando sus conteos.
--
-- Capacidad y no pestaña (canon de docs/planes-cerrados/AUDITORIA-PERMISOS-
-- 2026-08-03.md §7-bis): no gatea una vista, gatea una ACCIÓN. El alcance sigue
-- siendo el de `cortes_caja` — las funciones ya lo cobran con
-- `auth_module_scope('cortes_caja')`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Quién la tiene ───────────────────────────────────────────────────────
-- Por NOMBRE y no por id: el branch de pruebas se siembra con otros ids.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'cortes_caja_resolver', true, true, false, coalesce(rp.scope, 'BRANCH')
  FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.module_key = 'cortes_caja' AND rp.can_edit
 WHERE r.name IN ('Administrador', 'Gerente General', 'Jefe/a de Talento Humano',
                  'Supervisor/a de Ventas', 'QA / Testing (CI)',
                  'Jefe/a de Sala', 'Subjefe/a de Sala')
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                    WHERE x.role_id = r.id AND x.module_key = 'cortes_caja_resolver');

-- ── 2. Las ocho funciones de diferencias piden la capacidad ─────────────────
-- Se reescribe SÓLO la línea del candado, sobre la definición viva: las ocho se
-- rehicieron hoy mismo (20260925152434) y copiarlas enteras otra vez sería
-- abrir la puerta a que una copia pise un arreglo. Si alguna ya no tiene el
-- candado viejo, la migración ABORTA — mejor que dejarla con el permiso que no
-- corresponde sin enterarse.
DO $$
DECLARE
    f     text;
    def   text;
    viejo constant text := 'auth_can_edit_any(ARRAY[''cortes_caja''])';
    nuevo constant text := 'auth_has_module_permission(''cortes_caja_resolver'', ''can_view'')';
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text)',
        'public.justificar_diferencia_corte(bigint, text, text, text, text)',
        'public.anular_diferencia_corte(bigint, text)',
        'public.abonar_diferencia_corte(bigint, jsonb)',
        'public.anular_abono_diferencia(bigint, text)',
        'public.marcar_abonos_impresos(bigint[])',
        'public.marcar_comprobante_impreso(bigint)',
        'public.asentar_diferencias_corte(bigint[], text, bigint[])'
    ] LOOP
        def := pg_get_functiondef(f::regprocedure);
        IF position(viejo IN def) = 0 THEN
            RAISE EXCEPTION 'No encontré el candado de cortes_caja en %', f;
        END IF;
        EXECUTE replace(def, viejo, nuevo);
    END LOOP;
END $$;

-- ── 3. Quién hizo cada movimiento de un abono ───────────────────────────────
-- «Todo movimiento debe decir quién lo hizo» (usuario). El abono ya guardaba
-- quién lo recibió, quién lo anotó y quién lo anuló, pero sólo el primero
-- llegaba a la pantalla. Mismo cuerpo que 20260925152434 + dos nombres.
CREATE OR REPLACE FUNCTION public.get_cortes_diferencias(p_desde date, p_hasta date)
 RETURNS TABLE(id bigint, corte_id bigint, branch_id bigint, fecha date, hora time without time zone,
               monto numeric, via text, causa text, registrado_at timestamp with time zone,
               registrado_nombre text, impreso_at timestamp with time zone,
               asentado_at timestamp with time zone, asentado_ref text, asentado_nombre text,
               anulada_at timestamp with time zone, anulada_motivo text, personas jsonb,
               evidencia_ref text, evidencia_foto_url text, abonos jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.id, d.corte_id, d.branch_id, d.fecha, c.hora,
           d.monto, d.via, d.causa,
           d.registrado_at, r.name, d.impreso_at,
           d.asentado_at, d.asentado_ref, a.name,
           d.anulada_at, d.anulada_motivo,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'persona_id', p.id,
                          'employee_id', p.employee_id, 'nombre', e.name,
                          'monto', p.monto, 'del_turno', p.del_turno,
                          'abonado', coalesce(ya.abonado, 0),
                          'saldo', p.monto - coalesce(ya.abonado, 0))
                      ORDER BY e.name)
                 FROM public.cortes_caja_diferencia_personas p
                 JOIN public.employees e ON e.id = p.employee_id
                 LEFT JOIN LATERAL (
                     SELECT sum(ab.monto) AS abonado FROM public.cortes_caja_diferencia_abonos ab
                      WHERE ab.persona_id = p.id AND ab.anulada_at IS NULL) ya ON true
                WHERE p.diferencia_id = d.id), '[]'::jsonb),
           d.evidencia_ref, d.evidencia_foto_url,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'id', ab.id, 'persona_id', ab.persona_id,
                          'employee_id', ab.employee_id, 'nombre', e.name,
                          'monto', ab.monto, 'registrado_at', ab.registrado_at,
                          'registrado_nombre', rr.name, 'impreso_at', ab.impreso_at,
                          'asentado_at', ab.asentado_at, 'asentado_ref', ab.asentado_ref,
                          'asentado_nombre', aa.name,
                          'anulada_at', ab.anulada_at, 'anulada_motivo', ab.anulada_motivo,
                          'anulada_nombre', an.name)
                      ORDER BY ab.registrado_at)
                 FROM public.cortes_caja_diferencia_abonos ab
                 JOIN public.employees e ON e.id = ab.employee_id
                 LEFT JOIN public.employees rr ON rr.id = ab.registrado_por
                 LEFT JOIN public.employees aa ON aa.id = ab.asentado_por
                 LEFT JOIN public.employees an ON an.id = ab.anulada_por
                WHERE ab.diferencia_id = d.id), '[]'::jsonb)
      FROM public.cortes_caja_diferencias d
      JOIN public.cortes_caja c ON c.id = d.corte_id
      LEFT JOIN public.employees r ON r.id = d.registrado_por
      LEFT JOIN public.employees a ON a.id = d.asentado_por
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR d.branch_id = (SELECT auth_employee_branch_id()))
       AND d.fecha BETWEEN p_desde AND p_hasta
     ORDER BY d.fecha DESC, d.registrado_at DESC;
$function$;
