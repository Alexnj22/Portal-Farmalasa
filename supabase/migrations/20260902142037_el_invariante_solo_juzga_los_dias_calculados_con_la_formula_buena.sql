SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El invariante arranca cuando arrancó la fórmula que puede cumplirlo.
--
-- Los ocho días-sala que quedaron marcados no son un descuido de la sala: son
-- días en que la bolsa del segundo corte se calculó restando la ETIQUETA de la
-- bolsa de la mañana en vez de lo que de verdad le quedaba adentro. Esa fórmula
-- se corrigió el 2026-09-02 a las 03:23:30 UTC (migración 20260902032330), así
-- que juzgar con la vara nueva los días anteriores mide un defecto que ya no
-- existe y que nadie puede ir a arreglar — y una alarma siempre roja se ignora,
-- que es el mismo motivo por el que existe `bolsas_circuito_desde`.
--
-- Los dos del 31-ago quedaron explicados y son el mismo caso, con su vale, su
-- boleta y su hora: Salud 3 $300 (remesa MoneyGram de $100 a las 14:50 y $200
-- de «retira don ruti» a las 15:47, las dos sobre S3-1206) y Salud 2 $100
-- (remesa TransNetwork, boleta 000435, a las 17:20 sobre S2-1203). Los seis
-- anteriores tienen la misma firma. El detalle vive en el changelog de v2.937.1.
--
-- Se separa de `bolsas_circuito_desde` A PROPÓSITO: ése marca cuándo empezó a
-- existir el circuito y lo usa además `get_cortes_por_embolsar`, así que moverlo
-- dejaría de mostrar cortes que TODAVÍA hay que embolsar. Son dos fechas
-- distintas porque responden dos preguntas distintas.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bolsas_invariante_desde()
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT timestamptz '2026-09-02 03:23:30+00' $function$;

REVOKE EXECUTE ON FUNCTION public.bolsas_invariante_desde() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bolsas_invariante_desde() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_bolsas_invariante(p_desde date, p_hasta date)
 RETURNS TABLE(branch_id bigint, fecha date, suma_bolsas numeric, declarado numeric, descuadre numeric, bolsas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH dias AS (
        SELECT c.branch_id, c.fecha
          FROM public.cortes_caja c
         WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           AND c.fecha BETWEEN p_desde AND p_hasta
           AND (SELECT auth_has_module_permission('bolsas','can_view'))
           AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
                OR c.branch_id = (SELECT auth_employee_branch_id()))
         GROUP BY c.branch_id, c.fecha
        HAVING min(c.resuelto_at) >= public.bolsas_invariante_desde()
    )
    SELECT d.branch_id, d.fecha,
           round(coalesce(b.etiquetas, 0) + coalesce(v.vales, 0), 2),
           coalesce(u.declarado, 0),
           round(coalesce(b.etiquetas, 0) + coalesce(v.vales, 0) - coalesce(u.declarado, 0), 2),
           coalesce(b.cuantas, 0)::integer
      FROM dias d
      LEFT JOIN LATERAL (
          SELECT sum(x.monto_inicial) AS etiquetas,
                 count(*)             AS cuantas,
                 -- El momento de referencia: cuando se creó la última bolsa del
                 -- día. No la hora del corte, porque un vale registrado entre el
                 -- conteo y la confirmación SÍ lo vio `bolsa_sugerida`.
                 max(x.created_at)    AS ref
            FROM public.bolsas x
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
      ) b ON true
      LEFT JOIN LATERAL (
          -- `monto` ya viene con signo: negativo la salida, positivo el reintegro.
          SELECT sum(m.monto) AS vales
            FROM public.bolsas_movimientos m
            JOIN public.bolsas x ON x.id = m.bolsa_id
           WHERE x.branch_id = d.branch_id AND x.fecha = d.fecha AND x.estado <> 'ANULADA'
             AND m.anulado_at IS NULL
             AND m.registrado_at < b.ref
      ) v ON true
      LEFT JOIN LATERAL (
          SELECT c.total_declarado AS declarado
            FROM public.cortes_caja c
           WHERE c.branch_id = d.branch_id AND c.fecha = d.fecha
             AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           ORDER BY c.hora DESC, c.id DESC
           LIMIT 1
      ) u ON true
     ORDER BY d.fecha DESC, d.branch_id;
$function$;
