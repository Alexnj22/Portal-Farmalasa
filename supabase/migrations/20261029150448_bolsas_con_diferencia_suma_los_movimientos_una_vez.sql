-- get_bolsas_con_diferencia tardaba 3.7 s de promedio y hasta 10 s (medido
-- 2026-10-29, 4,591 ms con sesión real y 71,376 bloques). Llamaba a
-- bolsa_saldo() por CADA bolsa contada (855): esa función es `LANGUAGE sql`
-- con SET, o sea opaca, y cada llamada volvía a leer `bolsas` con su RLS
-- entero. Y la pantalla de bolsas espera esta lectura en cada recarga, así
-- que confirmar una recepción o un conteo tardaba segundos en verse.
--
-- Se suma los movimientos UNA vez con un join. Misma aritmética que
-- bolsa_saldo (monto_inicial + Σ movimientos no anulados, redondeado a 2):
-- comparado sobre las 899 bolsas, 0 distintas. 18 ms.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_bolsas_con_diferencia()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.contado_at DESC), '[]'::json)
  FROM (
    SELECT b.id, b.folio, b.branch_id, b.corte_id, b.origen, b.motivo_origen,
           b.monto_inicial, b.fecha, b.hora, b.caja,
           b.cerrada_por, b.cerrada_at, b.estado,
           b.etiqueta_version, b.etiqueta_impresa_at,
           b.entregada_por, b.entregada_at, b.recibida_por, b.recibida_at,
           b.contado, b.contado_por, b.contado_at,
           b.dif_via, b.dif_causa, b.dif_por, b.dif_at,
           s.saldo,
           round(b.contado - s.saldo, 2) AS diferencia
      FROM public.bolsas b
      LEFT JOIN (SELECT m.bolsa_id, sum(m.monto) AS movido
                   FROM public.bolsas_movimientos m
                  WHERE m.anulado_at IS NULL
                  GROUP BY m.bolsa_id) mv ON mv.bolsa_id = b.id
      CROSS JOIN LATERAL (SELECT round(b.monto_inicial + coalesce(mv.movido, 0), 2) AS saldo) s
     WHERE b.estado = 'CONTADA'
       AND b.dif_at IS NULL
       AND b.contado IS NOT NULL
       AND abs(round(b.contado - s.saldo, 2)) >= 0.01
  ) t;
$function$;
