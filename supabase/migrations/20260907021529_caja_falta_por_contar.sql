SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- CUÁNTO ENTRÓ AL CAJÓN DESDE EL ÚLTIMO CONTEO FIRMADO
--
-- Regla del usuario (6-sep): «no permitas hacer cierre del día si han habido
-- ventas después del último corte y no se ha hecho otro».
--
-- El freno que ya existía preguntaba otra cosa: ¿hay AL MENOS UN corte
-- confirmado hoy? Salud 2 cerró el 6-sep con esa respuesta en verde — su corte
-- de las 11:59 estaba confirmado— y **seis horas y $159.39 después**: 25 ventas
-- en efectivo por $152.65, el pago de CAESS de $5.74 y una inyección de $1.00
-- se quedaron en el cajón sin contar, sin firma y sin bolsa. El cierre no se
-- deshace y la caja no se vuelve a abrir, así que ese dinero ya no lo puede
-- contar nadie desde el portal.
--
-- ── POR QUÉ ESTA RESTA Y NO OTRA (dos diseños medidos, uno descartado) ───────
-- Se comparan DOS ESPERADOS, nunca un esperado contra un conteo:
--
--     espera     = lo que el sistema espera en el cajón HOY
--     ya_medido  = el esperado que el último corte confirmado dio por medido
--
-- Que sean los dos esperados es la parte que importa: un faltante o un sobrante
-- del conteo no mueve la resta. Restando contra lo CONTADO, un faltante firmado
-- de $2.54 se leería como «$2.54 sin contar» y trabaría un cierre correcto.
--
-- El otro diseño —restarle a las entradas del día las del tiquete
-- (`entradas − tk_ingresos`)— parecía más directo y **es ruido**: medido sobre
-- los 138 cierres de 45 días disparó 60 veces, y en 59 de ellas no hubo NI UNA
-- venta después del corte. El tiquete no pone los cobros de crédito en
-- INGRESOS sino en su propia línea, así que esa resta deja un residuo
-- sistemático que no es dinero. `tk_total_caja` sí los incluye, y por eso
-- cierra.
--
-- ── LO QUE YA MIDIÓ EL CORTE SALE DEL CANÓNICO, NO DE UNA COPIA ─────────────
-- `esperado = declarado − corte_diferencia(...)`. Se despeja del canónico en vez
-- de repetir su fórmula: la corrección de los cobros del portal que el
-- comprobante no cuenta vive ahí y en un solo sitio. Escrita otra vez acá, el
-- día que esa regla cambie habría dos respuestas y sólo una se actualizaría.
--
-- ── MEDIDO SOBRE 138 CIERRES DE 45 DÍAS: DISPARA 2 VECES, LAS 2 REALES ──────
--   · Salud 2, 6-sep   +$159.39  — el caso que lo originó
--   · Salud 1, 17-ago  +$11.55   — anotaron un ingreso de $11.55 después del
--     corte confirmado, rehicieron el corte (que ya daba exacto) y **descartaron
--     ese** dejando confirmado el del sobrante. El freno los habría mandado a
--     confirmar el bueno.
-- Los otros 136 dan 0.00 salvo tres NEGATIVOS (−4.00, −4.30, −242.10), que no
-- frenan y tienen causa conocida: facturas en efectivo que el tiquete del corte
-- contó y Hacienda invalidó después, así que hoy `sales_invoices` ya no las
-- tiene. Ese mecanismo sólo puede restar — nunca inventar dinero de más.
--
-- ── QUÉ NO VE ──────────────────────────────────────────────────────────────
-- Una factura que todavía no llegó al portal cuando se cierra no está en
-- `espera`, así que no frena. Falla hacia el lado que no traba a nadie, y el
-- hueco dura lo que tarda la captura.
--
-- `medido: false` es «no se pudo medir», y NO es cero: sin el tiquete del último
-- corte no hay `ya_medido`, y quien llama tiene que frenar igual. Sobre los 295
-- cortes confirmados que existen, ninguno está sin tiquete.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_falta_por_contar(
    p_branch_id integer, p_dia date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     numeric;
  v_pz     json;
  v_espera numeric;
  v_c      public.cortes_caja%ROWTYPE;
  v_medido numeric;
BEGIN
  SELECT round(coalesce(a.monto_apertura, 0), 2) INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.abierta_el = p_dia
   ORDER BY a.turno DESC, a.id DESC
   LIMIT 1;
  v_ap := coalesce(v_ap, 0);

  -- Las mismas piezas que la pantalla usa para «cuánto hay en el cajón», pero
  -- SIN restar las bolsas: acá se pregunta cuánto entró en total, no cuánto
  -- quedó suelto. Un solo sitio arma la suma.
  v_pz := public.caja_efectivo_piezas(p_branch_id, p_dia, v_ap);
  v_espera := round( (v_pz->>'apertura')::numeric
                   + (v_pz->>'ventas_efectivo')::numeric
                   + (v_pz->>'entradas')::numeric
                   - (v_pz->>'vales')::numeric, 2);

  -- El último que CUENTA es el último CONFIRMADO. Un descartado no midió nada
  -- —su conteo se tiró— así que el tramo que abarcaba sigue abierto. Mismo
  -- criterio que `corte_tramo` y que `repartirPorCorte` en la pantalla.
  SELECT * INTO v_c
    FROM public.cortes_caja c
   WHERE c.branch_id = p_branch_id AND c.fecha = p_dia
     AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
   ORDER BY c.hora DESC, c.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'medido', true, 'hay_corte', false, 'desde', NULL,
      'espera', v_espera, 'ya_medido', 0,
      'falta', greatest(0, v_espera));
  END IF;

  IF v_c.tk_total_caja IS NULL THEN
    RETURN json_build_object(
      'medido', false, 'hay_corte', true,
      'desde', to_char(v_c.hora, 'HH24:MI'),
      'espera', v_espera, 'ya_medido', NULL, 'falta', NULL);
  END IF;

  v_medido := round(v_c.total_declarado - public.corte_diferencia(
      v_c.total_declarado, v_c.diferencia_erp, v_c.tk_total_caja,
      v_c.tk_subtotal, v_c.tk_vales, v_c.tk_cobros_credito,
      v_c.cobros_portal_efectivo), 2);

  RETURN json_build_object(
    'medido', true, 'hay_corte', true,
    'desde', to_char(v_c.hora, 'HH24:MI'),
    'espera', v_espera, 'ya_medido', v_medido,
    'falta', round(v_espera - v_medido, 2));
END;
$function$;

-- Nadie la llama desde el navegador: la pantalla la recibe dentro de
-- `caja_estado`, que ya cobra el permiso de mirar la caja y el alcance de sala.
-- Abierta a `authenticated` a secas dejaría leer el efectivo esperado de
-- cualquier sala.
REVOKE EXECUTE ON FUNCTION public.caja_falta_por_contar(integer, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_falta_por_contar(integer, date) TO service_role;

