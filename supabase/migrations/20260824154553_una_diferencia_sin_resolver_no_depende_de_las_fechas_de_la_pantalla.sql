SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Una diferencia sin resolver no puede depender de las fechas que alguien dejó
-- ═══════════════════════════════════════════════════════════════════════════
--
-- «Sin resolver» —una bolsa contada que no cuadró y que nadie repuso, retiró ni
-- justificó— se calculaba sobre `contadas`, y `contadas` viene recortada por el
-- período de la pantalla. O sea que la tarjeta decía CERO en cuanto el rango no
-- alcanzaba el día en que se contó, que es exactamente al revés de lo que hace
-- falta: cuanto más vieja es una diferencia sin resolver, más hay que verla.
--
-- Y desde el 2026-08-24 hace falta para algo más. La sala dejó de ver las tres
-- etapas de administración —«al entregarlos ya no es responsabilidad de la
-- sala»—, con una excepción que pidió el usuario: **si aparece una diferencia
-- en una de sus bolsas, la sala tiene que verla para buscar la solución**. Eso
-- no puede llegar por el archivo de contadas, que ya no se le dibuja.
--
-- ── Por qué una función y no un filtro más ─────────────────────────────────
-- El predicado es `contado - bolsa_saldo(id) <> 0`, y `bolsa_saldo` es una
-- función: no hay forma de escribirlo en PostgREST. Bajarlo todo y filtrar en
-- el navegador sería traer cada bolsa contada de la historia para descartar
-- casi todas — y encima el tope de las 1000 filas cortaría por antigüedad, o
-- sea que se perdería justo la diferencia más vieja.
--
-- ── INVOKER a propósito ────────────────────────────────────────────────────
-- La policy `bolsas_select` ya dice quién ve qué: con alcance `ALL` las seis
-- salas, y si no, sólo la propia. Corriendo como quien llama, esta función
-- hereda esa regla exacta y no hay una segunda definición de «tu sala» que se
-- pueda desincronizar. Con DEFINER habría que reescribirla acá adentro.
--
-- `RETURNS json` (no jsonb) y sin parámetros: son unas pocas filas, pero es el
-- patrón del proyecto para no volver a caer bajo el techo de las 1000.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_bolsas_con_diferencia()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
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
      CROSS JOIN LATERAL (SELECT public.bolsa_saldo(b.id) AS saldo) s
     WHERE b.estado = 'CONTADA'
       AND b.dif_at IS NULL
       AND b.contado IS NOT NULL
       AND abs(round(b.contado - s.saldo, 2)) >= 0.01
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_bolsas_con_diferencia() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bolsas_con_diferencia() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bolsas_con_diferencia() IS
  'Bolsas contadas que no cuadraron y que nadie resolvió, sin recorte de fechas. INVOKER: la policy bolsas_select decide si son las seis salas o sólo la propia.';
