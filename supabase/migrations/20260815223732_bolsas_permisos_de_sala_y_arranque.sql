-- Dos correcciones de la auditoria previa a probar en sala.
--
-- ── 1. Las salas no podian ver nada ─────────────────────────────────────────
--
-- Los cuatro cargos que trabajan la caja —Dependiente de Farmacia, Jefe/a y
-- Subjefe/a de Sala, Regente de Enfermeria— tenian `bolsas` y `dash_bolsas_sala`
-- en `can_view = false`. La semilla original los habia puesto en true copiandolos
-- de `cortes_caja`; se apagaron despues, a mano, desde la pantalla de Permisos
-- (los `updated_at` caen en 18:01:09, :13, :17 y :23 — cuatro segundos
-- seguidos, media hora despues de la migracion).
--
-- Tal como estaba, una sala no veia la baldosa, no veia la pestaña y no podia
-- guardar ni entregar nada. Es el mismo modo de falla que rompio la recepcion de
-- pedidos: un `can_edit` apagado y una pantalla que no dice por que.
--
-- Se alinea con `cortes_caja` y SOLO donde hoy esta en false: quien maneja el
-- corte de una sala maneja su efectivo. Un cargo que hoy no ve los cortes
-- tampoco pasa a ver las bolsas.
UPDATE public.role_permissions rp
   SET can_view = cc.can_view, can_edit = cc.can_edit, scope = cc.scope, updated_at = now()
  FROM public.role_permissions cc
 WHERE cc.role_id = rp.role_id
   AND cc.module_key = 'cortes_caja'
   AND rp.module_key IN ('bolsas', 'dash_bolsas_sala')
   AND cc.can_view
   AND NOT rp.can_view;

-- ── 2. El arranque no puede empezar con 16 bolsas inventadas ────────────────
--
-- La bolsa nace sola sólo en las confirmaciones NUEVAS, asi que los cortes ya
-- confirmados antes del disparador no tienen bolsa y esta lista los ofrecia con
-- un boton «Guardar ahora». Medido antes de corregirlo: **16 cortes por
-- $10,778.41** repartidos en las seis salas. Apretarlos habria hecho que el
-- portal afirmara que hay diez mil dolares guardados en bolsas que no existen —
-- dinero que ya se entregó o se mezcló — y el sistema arrancaria con una mentira
-- que despues hay que perseguir bolsa por bolsa.
--
-- El corte es la fecha en que el disparador entro a produccion (migracion
-- `20260815214327`). Desde ese instante, todo corte confirmado obtiene su bolsa
-- automatica, asi que **no deberia aparecer nunca aca**: si aparece uno, es un
-- problema de verdad y por eso la lista sigue existiendo. Lo de antes es
-- historia, y la historia no se embolsa hoy.
CREATE OR REPLACE FUNCTION public.get_cortes_por_embolsar(p_desde date, p_hasta date)
RETURNS TABLE (
    corte_id        bigint,
    branch_id       bigint,
    fecha           date,
    hora            time,
    caja            text,
    total_declarado numeric,
    sugerida        numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT c.id, c.branch_id, c.fecha, c.hora, c.empleado_texto, c.total_declarado,
           public.bolsa_sugerida(c.id)
      FROM public.cortes_caja c
     WHERE (SELECT auth_has_module_permission('bolsas','can_view'))
       AND c.tipo   = 'C'
       AND c.estado = 'CONFIRMADO'
       AND c.fecha BETWEEN p_desde AND p_hasta
       -- Desde que la bolsa nace sola. Ver el encabezado.
       AND c.resuelto_at >= timestamptz '2026-08-15 21:43:27+00'
       AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
            OR c.branch_id = (SELECT auth_employee_branch_id()))
       AND NOT EXISTS (
           SELECT 1 FROM public.bolsas b
            WHERE b.corte_id = c.id AND b.estado <> 'ANULADA')
       AND public.bolsa_sugerida(c.id) > 0
     ORDER BY c.fecha DESC, c.branch_id, c.hora;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_por_embolsar(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cortes_por_embolsar(date, date) TO authenticated, service_role;
