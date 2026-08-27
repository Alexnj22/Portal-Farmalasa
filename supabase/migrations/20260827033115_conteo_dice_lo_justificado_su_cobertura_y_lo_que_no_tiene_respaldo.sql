-- La tanda dice cuanto se JUSTIFICO, que salas cubrio y que quedo sin respaldo.
--
-- Para el arranque completo del lunes 31-ago. Auditoria de la pestaña
-- «Finalizadas» del 2026-08-26: los numeros de la pantalla son correctos y aun
-- asi la pantalla no permite controlar el efectivo. Tres huecos, los tres
-- medidos contra produccion, y los tres se cierran con datos que la funcion ya
-- podia devolver.
--
-- ── 1. «Sin resolver: $0.00» sobre $5,786.80 que salieron ───────────────────
--
-- Una diferencia se salda de tres formas: Repone, Retira o Justifica. Las dos
-- primeras mueven dinero; la tercera escribe un texto. De las 16 diferencias
-- que existen, LAS 16 se saldaron con Justificar.
--
-- La columna «Sin resolver» dice —con razon— $0.00: no queda nada por explicar.
-- Pero explicada no es recuperada, y hoy NINGUNA cifra de la pantalla suma lo
-- justificado. Para enterarse hay que abrir tanda por tanda, sala por sala,
-- bolsa por bolsa. `justificado` es esa suma, y va al lado de `pendiente` en vez
-- de reemplazarla: son dos preguntas distintas —lo que falta explicar y lo que
-- ya se explico pero igual no volvio— y una sola cifra no puede contestar las
-- dos. Es la misma leccion que dejo `SinResolver` cuando la baldosa decia «0» y
-- la columna «−$4,592.24»: los dos ciertos, y sin decir cual contestaba que.
--
-- ── 2. Una sala se puede quedar fuera de una tanda y nada lo dice ───────────
--
-- Medido: la tanda del 21-ago cubrio CINCO salas de seis. Salud 4 quedo afuera y
-- sus bolsas del 17 al 20 se contaron el 26 — nueve dias despues de cerradas,
-- contra tres de promedio en las otras cinco. La columna «Dias» de esa tanda
-- dice «14 → 20 ago», que es cierto y no dice nada de la sala que falta: es el
-- MAXIMO de las bolsas que entraron, no lo que la tanda cubre.
--
-- `salas` y `salas_fuera` contestan la pregunta que de verdad importa el lunes:
-- ¿esta todo contado? `salas_fuera` NO es «salas que no aparecen»: son las que
-- TENIAN bolsas dentro del rango de esta tanda y no entraron en ella. Una sala
-- sin bolsas ese dia no falta, y contarla como faltante volveria el aviso ruido
-- permanente — que es como se desactiva una alarma.
--
-- Dos condiciones hacen que se señale a la tanda CORRECTA, y las dos salieron de
-- probarlo contra las cuatro tandas reales:
--
--   · `NOT EXISTS` — la sala no aparece en ESTA tanda ni con una bolsa. Con las
--     dos tandas que se pisan entre el 17 y el 21: la del 21 no tiene ni una
--     bolsa de Salud 4 y se la señala; la del 26 si tiene La Popular —aunque
--     parte de La Popular de ese rango este en la otra— y no se la señala. La
--     que dejo el hueco avisa, no la que despues lo levanto.
--
--   · y esas bolsas ESPERARON: siguen sin contar, o se contaron en una tanda
--     posterior. Sin esta segunda condicion, la tanda del 26 de UNA sola bolsa
--     acusaba a las otras cinco salas de ese dia — que ya se habian contado seis
--     horas antes. Medido: 5 falsos positivos contra 0, y el unico hallazgo real
--     sobrevive.
--
-- ── 3. La foto de respaldo es opcional y su ausencia es invisible ───────────
--
-- Seis de las dieciseis justificaciones se guardaron sin foto, por $1,644.56 —
-- incluida la mayor de todas, una bolsa entera contada en cero. La fila con foto
-- muestra un clip; la fila sin foto no muestra nada, y «nada» se lee igual que
-- «todavia no mire esa fila». Es `feedback_cero_hallazgos_y_cero_datos_se_ven_
-- igual` en una celda: lo que falta hay que decirlo, no dejar de decir lo que
-- hay.
--
-- `sin_respaldo` / `sin_respaldo_monto` lo dicen por tanda, y `con_respaldo` lo
-- dice por bolsa para que el detalle pueda marcar cual.
--
-- ── Sobre el rendimiento ────────────────────────────────────────────────────
--
-- Sigue siendo `LANGUAGE sql` y no entra en la trampa de la regla 4 de
-- CLAUDE.md: no tiene CTEs y su filtro corre sobre `bolsas_conteos`, que tiene
-- cuatro filas. El plan bueno no depende de los argumentos, asi que el generico
-- es tan bueno como el personalizado y forzar `plan_cache_mode` solo agregaria
-- el costo de replanificar.

SET lock_timeout = '5s';

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
               (SELECT e.photo_url FROM public.employees e WHERE e.id = c.cerrado_por) AS cerrado_por_foto,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.conteo_id = c.id) AS dia_hasta,
               -- Quiénes contaron, sin repetir y CON su cara.
               coalesce((
                 SELECT json_agg(json_build_object('name', x.name, 'photo_url', x.photo_url)
                                 ORDER BY x.name)
                   FROM (SELECT DISTINCT e.name, e.photo_url
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
