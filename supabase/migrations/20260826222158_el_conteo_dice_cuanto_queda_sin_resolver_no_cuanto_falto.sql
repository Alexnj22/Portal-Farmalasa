SET lock_timeout = '5s';

-- ── Una diferencia resuelta ya no es una diferencia pendiente ───────────────
--
-- «si las diferencias son justificadas debe de decir 0 no?» (usuario,
-- 2026-08-26), y tenía dos números de la MISMA pantalla dándole la razón: la
-- baldosa decía «0 · Sin resolver · todo cuadrado» y la tabla de conteos, dos
-- centímetros más abajo, «−$4,592.24». Los dos ciertos y contestando preguntas
-- distintas sin decir cuál — que es exactamente cómo se aprende a no creerle a
-- ninguno.
--
-- `diferencia` es lo que se firmó y NO se toca: es el hecho, y congelarlo es
-- por lo que existe la tabla. Lo que se agrega es lo que la fila tiene que
-- contestar de un vistazo — **cuánto sigue sin explicación** —, y eso se calcula
-- vivo porque cambia cada vez que alguien anota una causa.
--
-- Medido hoy sobre las tres tandas: 15 bolsas descuadradas, las 15 resueltas,
-- pendiente $0.00 en las tres.
CREATE OR REPLACE FUNCTION public.get_conteos(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.cerrado_at DESC, t.folio DESC)
      FROM (
        SELECT c.id, c.folio, c.fecha, c.cuantas,
               c.total_esperado, c.total_contado, c.diferencia, c.descuadradas,
               c.cerrado_at,
               -- Cuántas de las que no cuadraron ya tienen su causa anotada, y
               -- cuánto suma lo que NO la tiene. `dif_at` es la marca de que
               -- alguien la resolvió; `bolsa_saldo` está congelado desde que la
               -- bolsa salió de la sala, así que la resta no se mueve sola.
               (SELECT count(*) FROM public.bolsas b
                 WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL)          AS resueltas,
               coalesce((SELECT sum(round(b.contado - public.bolsa_saldo(b.id), 2))
                           FROM public.bolsas b
                          WHERE b.conteo_id = c.id AND b.dif_at IS NULL), 0) AS pendiente,
               (SELECT e.name FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_hasta,
               -- Quiénes contaron, sin repetir. Es la respuesta a «¿lo conté
               -- yo?» y la razón de que la tanda sea una fila: una tanda la
               -- pueden contar entre varios y firmarla uno solo.
               coalesce((
                 SELECT json_agg(x.name ORDER BY x.name)
                   FROM (SELECT DISTINCT e.name
                           FROM public.bolsas b
                           JOIN public.employees e ON e.id = b.contado_por
                          WHERE b.conteo_id = c.id) x
               ), '[]'::json) AS contaron,
               coalesce((
                 SELECT json_agg(json_build_object('fecha', x.fecha, 'cuantas', x.cuantas, 'contado', x.contado)
                                 ORDER BY x.fecha)
                   FROM (SELECT b.fecha, count(*) AS cuantas, sum(b.contado) AS contado
                           FROM public.bolsas b WHERE b.conteo_id = c.id
                          GROUP BY b.fecha) x
               ), '[]'::json) AS por_dia,
               coalesce((
                 SELECT json_agg(json_build_object(
                          'id', b.id, 'folio', b.folio, 'branch_id', b.branch_id,
                          'fecha', b.fecha, 'hora', b.hora,
                          'contado', b.contado,
                          'esperado', public.bolsa_saldo(b.id),
                          'contado_por', (SELECT e.name FROM public.employees e WHERE e.id = b.contado_por),
                          'dif_via', b.dif_via, 'dif_causa', b.dif_causa, 'dif_at', b.dif_at,
                          'dif_por', (SELECT e.name FROM public.employees e WHERE e.id = b.dif_por))
                        ORDER BY b.branch_id, b.fecha, b.folio)
                   FROM public.bolsas b WHERE b.conteo_id = c.id
               ), '[]'::json) AS bolsas
          FROM public.bolsas_conteos c
         WHERE (p_desde IS NULL OR c.fecha >= p_desde)
           AND (p_hasta IS NULL OR c.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteos(date, date) TO authenticated, service_role;
