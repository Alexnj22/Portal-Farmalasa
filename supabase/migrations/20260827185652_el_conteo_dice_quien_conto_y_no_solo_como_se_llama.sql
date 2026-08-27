SET lock_timeout = '5s';

-- ── El id de quien contó, para que su foto pueda llevar aro ─────────────────
--
-- `get_conteos` resolvía el nombre y la foto en SQL y devolvía eso ya armado.
-- Era razonable cuando el avatar sólo necesitaba una imagen: una consulta menos
-- y el navegador ni precisa la lista de empleados. Dejó de servir el día que la
-- foto tiene que decir algo DE la persona —si está o no, DESIGN.md §5.4—,
-- porque el estado se pregunta por id y acá el id no viajaba.
--
-- La columna cruda siempre fue el id: `bolsas.contado_por` y
-- `bolsas_conteos.cerrado_por` son referencias a `employees`. Lo único que
-- faltaba era devolverlas. Tres claves nuevas, ninguna fila menos, ningún
-- cambio de firma —esta función devuelve `json`, así que agregar una clave no
-- rompe a quien no la lea—.
--
-- El `DISTINCT` de «quiénes contaron» ahora incluye el id: sin eso `x.id` no
-- existe en el subselect y la lista salía vacía.
CREATE OR REPLACE FUNCTION public.get_conteos(p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
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
               -- cuánto suma lo que NO la tiene.
               (SELECT count(*) FROM public.bolsas b
                 WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL)          AS resueltas,
               coalesce((SELECT sum(round(b.contado - public.bolsa_saldo(b.id), 2))
                           FROM public.bolsas b
                          WHERE b.conteo_id = c.id AND b.dif_at IS NULL), 0) AS pendiente,
               -- Lo que YA se explicó. Ver el punto 1 del encabezado: explicada
               -- no es recuperada, y hasta hoy no había dónde leerlo.
               coalesce((SELECT sum(round(b.contado - public.bolsa_saldo(b.id), 2))
                           FROM public.bolsas b
                          WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL), 0) AS justificado,
               -- De lo explicado, lo que no tiene con qué probarse.
               (SELECT count(*) FROM public.bolsas b
                 WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL
                   AND b.dif_foto_url IS NULL)                               AS sin_respaldo,
               coalesce((SELECT sum(round(b.contado - public.bolsa_saldo(b.id), 2))
                           FROM public.bolsas b
                          WHERE b.conteo_id = c.id AND b.dif_at IS NOT NULL
                            AND b.dif_foto_url IS NULL), 0)                  AS sin_respaldo_monto,
               -- ── Cobertura ─────────────────────────────────────────────
               (SELECT count(DISTINCT b.branch_id) FROM public.bolsas b
                 WHERE b.conteo_id = c.id)                                   AS salas,
               -- Las salas que TENÍAN bolsas dentro del rango de esta tanda y
               -- no entraron en ella. Ver el punto 2 del encabezado.
               coalesce((
                 SELECT json_agg(DISTINCT br.name)
                   FROM public.bolsas x
                   JOIN public.branches br ON br.id = x.branch_id
                  WHERE x.estado <> 'ANULADA'
                    AND x.fecha >= (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id)
                    AND x.fecha <= (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id)
                    AND x.conteo_id IS DISTINCT FROM c.id
                    AND NOT EXISTS (SELECT 1 FROM public.bolsas y
                                     WHERE y.conteo_id = c.id AND y.branch_id = x.branch_id)
                    -- Y que ESPERARON: sin contar todavía, o contadas en una
                    -- tanda posterior. Sin esto la del 26 con una sola bolsa
                    -- acusaba a las otras cinco salas de ese día, que ya se
                    -- habían contado seis horas antes en otra tanda. Verificado
                    -- contra las cuatro tandas: pasa de 5 falsos positivos a 0,
                    -- y el único hallazgo real —Salud 4 en la tanda del 21—
                    -- sigue ahí.
                    AND (x.conteo_id IS NULL
                         OR (SELECT c2.cerrado_at FROM public.bolsas_conteos c2
                              WHERE c2.id = x.conteo_id) > c.cerrado_at)
               ), '[]'::json)                                                AS salas_fuera,
               (SELECT e.name      FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por,
               c.cerrado_por AS cerrado_por_id,
               (SELECT e.photo_url FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por_foto,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_hasta,
               -- Quiénes contaron, sin repetir y CON su cara.
               coalesce((
                 SELECT json_agg(json_build_object('id', x.id, 'name', x.name, 'photo_url', x.photo_url)
                                 ORDER BY x.name)
                   FROM (SELECT DISTINCT e.id, e.name, e.photo_url
                           FROM public.bolsas b
                           JOIN public.employees e ON e.id = b.contado_por
                          WHERE b.conteo_id = c.id) x
               ), '[]'::json) AS contaron,
               -- ── Sucursal por sucursal: su total, sus días y sus bolsas ──
               coalesce((
                 SELECT json_agg(json_build_object(
                          'branch_id', s.branch_id, 'sala', s.sala,
                          'cuantas', s.cuantas, 'esperado', s.esperado,
                          'contado', s.contado, 'descuadradas', s.descuadradas,
                          'dias', s.dias, 'bolsas', s.bolsas)
                        ORDER BY s.sala)
                   FROM (
                     SELECT b.branch_id,
                            (SELECT br.name FROM public.branches br WHERE br.id = b.branch_id) AS sala,
                            count(*)                                AS cuantas,
                            sum(public.bolsa_saldo(b.id))           AS esperado,
                            sum(b.contado)                          AS contado,
                            count(*) FILTER (
                              WHERE abs(round(b.contado - public.bolsa_saldo(b.id), 2)) >= 0.01
                            )                                       AS descuadradas,
                            (SELECT json_agg(json_build_object(
                                       'fecha', d.fecha, 'cuantas', d.cuantas,
                                       'esperado', d.esperado, 'contado', d.contado)
                                     ORDER BY d.fecha)
                               FROM (SELECT b2.fecha, count(*) AS cuantas,
                                            sum(public.bolsa_saldo(b2.id)) AS esperado,
                                            sum(b2.contado) AS contado
                                       FROM public.bolsas b2
                                      WHERE b2.conteo_id = c.id
                                        AND b2.branch_id = b.branch_id
                                      GROUP BY b2.fecha) d)         AS dias,
                            (SELECT json_agg(json_build_object(
                                       'id', b3.id, 'folio', b3.folio,
                                       'fecha', b3.fecha, 'hora', b3.hora,
                                       'contado', b3.contado,
                                       'esperado', public.bolsa_saldo(b3.id),
                                       'contado_por', (SELECT e.name FROM public.employees e WHERE e.id = b3.contado_por),
                                       'contado_por_id', b3.contado_por,
                                       'contado_por_foto', (SELECT e.photo_url FROM public.employees e WHERE e.id = b3.contado_por),
                                       'dif_via', b3.dif_via, 'dif_causa', b3.dif_causa, 'dif_at', b3.dif_at,
                                       -- Con qué se prueba esa causa. Booleano y
                                       -- no la URL: el detalle sólo necesita
                                       -- marcar cuál no tiene, y la foto vive en
                                       -- un bucket privado que se firma aparte.
                                       'con_respaldo', (b3.dif_foto_url IS NOT NULL),
                                       'dif_por', (SELECT e.name FROM public.employees e WHERE e.id = b3.dif_por))
                                     ORDER BY b3.fecha, b3.hora, b3.folio)
                               FROM public.bolsas b3
                              WHERE b3.conteo_id = c.id
                                AND b3.branch_id = b.branch_id)     AS bolsas
                       FROM public.bolsas b
                      WHERE b.conteo_id = c.id
                      GROUP BY b.branch_id
                   ) s
               ), '[]'::json) AS por_sala
          FROM public.bolsas_conteos c
         WHERE (p_desde IS NULL OR c.fecha >= p_desde)
           AND (p_hasta IS NULL OR c.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_conteos(date, date) TO authenticated, service_role;
