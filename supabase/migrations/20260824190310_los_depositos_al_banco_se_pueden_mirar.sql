SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Los depósitos al banco se pueden mirar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El depósito quedaba guardado entero —folio, fecha, lo contado, lo que entró de
-- afuera, lo que fue al banco, el remanente y las tres personas— y no había
-- ninguna pantalla que lo mostrara. Para saber cuánto se depositó el lunes había
-- que acordarse de una bolsa de ese día, abrirla, leer su bitácora, encontrar
-- «Depositada en el banco · DEP-260819-1»… y aun así no ver el monto. La cuenta
-- completa sólo estaba en la base.
--
-- Un registro que no se puede mirar no sirve para lo que se hizo: cuadrar contra
-- el estado de cuenta del banco, seguirle la pista al remanente, y darse cuenta
-- de que un día se depositó de menos.
--
-- ── Una sola llamada, con las bolsas adentro ───────────────────────────────
-- Cada depósito trae SUS bolsas anidadas. Podrían pedirse al abrir el detalle,
-- pero son ~10 por depósito y ~30 depósitos al mes: 300 filas que caben de sobra
-- en un `json`, contra una consulta por cada fila que alguien toca.
--
-- `RETURNS json` y no `jsonb`: es el patrón del proyecto para no volver a caer
-- bajo el techo de las 1000 filas de PostgREST.
--
-- ── DEFINER con guarda, y no INVOKER ───────────────────────────────────────
-- Necesita resolver NOMBRES de empleados, y el maestro de personal esconde a los
-- cargos `is_su` a propósito — con INVOKER, un depósito cerrado por alguien de
-- esos saldría sin nombre. Es la misma razón por la que existe
-- `get_bolsas_personas`. La guarda es explícita y va primero: sin
-- `bolsas_conteo` devuelve NULL, no una lista vacía, para que el navegador
-- distinga «no tenés permiso» de «no hay depósitos».
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_depositos(p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.fecha DESC, t.folio DESC)
      FROM (
        SELECT d.id, d.folio, d.fecha,
               d.total_contado, d.aporte, d.aporte_nota,
               d.monto_deposito, d.remanente, d.nota,
               d.cerrado_at,
               (SELECT e.name FROM public.employees e WHERE e.id = d.cerrado_por)              AS cerrado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_entregado_por)  AS entregado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_recibido_por)   AS recibido_por,
               (SELECT count(*) FROM public.bolsas b WHERE b.deposito_id = d.id)               AS cuantas,
               coalesce((
                 SELECT json_agg(json_build_object(
                          'id', b.id, 'folio', b.folio, 'branch_id', b.branch_id,
                          'fecha', b.fecha, 'hora', b.hora, 'contado', b.contado)
                        ORDER BY b.branch_id, b.fecha, b.folio)
                   FROM public.bolsas b WHERE b.deposito_id = d.id
               ), '[]'::json) AS bolsas
          FROM public.depositos_bancarios d
         WHERE (p_desde IS NULL OR d.fecha >= p_desde)
           AND (p_hasta IS NULL OR d.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_depositos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_depositos(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_depositos(date, date) IS
  'Los depósitos al banco de un período, con sus bolsas anidadas. NULL sin permiso bolsas_conteo — distinto de la lista vacía.';
