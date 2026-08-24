SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El depósito arranca desde que existe, no desde el principio de los tiempos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `get_por_depositar()` salió devolviendo TODA bolsa contada sin `deposito_id`,
-- y como esa columna nace en NULL, eso es toda la historia. Medido en producción
-- a los minutos de publicarla: **54 bolsas por $32,006.16**, las 54 con el mismo
-- sello de conteo (`2026-08-21 20:51:29.721+00`) porque fueron una carga masiva.
--
-- O sea que la franja nueva le habría ofrecido a administración llevar al banco
-- treinta y dos mil dólares que no están sobre ninguna mesa — y el botón habría
-- cerrado un depósito por ese monto sin que nada fallara.
--
-- Es el MISMO defecto que ya tuvo este módulo y que quedó escrito: la lista
-- «Sin bolsa» ofrecía 16 cortes por $10,778 —los confirmados antes de que
-- existiera el disparador— y apretarlos habría inventado bolsas por dinero que
-- ya no estaba. La respuesta fue la misma que acá: `get_cortes_por_embolsar`
-- arranca desde el instante en que el disparador entró.
--
-- La lección, para que no haga falta una tercera vez: **una columna nueva que
-- marca «ya se hizo» nace en NULL para todo el pasado, y una consulta que
-- pregunta por su ausencia devuelve el pasado entero.** No hay error, no hay
-- fila de menos, y el número que sale es grande y creíble.
--
-- El corte es el instante en que la tabla `depositos_bancarios` existió
-- (migración `20260824181552`). Nada contado antes pasó por este circuito, así
-- que su efectivo se manejó como se manejaba, fuera del portal.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_por_depositar()
RETURNS json
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.fecha, t.folio), '[]'::json)
  FROM (
    SELECT b.id, b.folio, b.branch_id, b.fecha, b.hora, b.contado
      FROM public.bolsas b
     WHERE b.estado = 'CONTADA'
       AND b.deposito_id IS NULL
       AND b.contado IS NOT NULL
       -- Desde que el depósito existe. Ver el encabezado: sin esto son 54
       -- bolsas por $32,006.16 de dinero que ya no está.
       AND b.contado_at >= timestamptz '2026-08-24 18:15:52+00'
  ) t;
$function$;

COMMENT ON FUNCTION public.get_por_depositar() IS
  'Lo contado y sin llevar al banco, DESDE que el depósito existe (2026-08-24 18:15:52+00). Lo anterior nunca pasó por este circuito.';
