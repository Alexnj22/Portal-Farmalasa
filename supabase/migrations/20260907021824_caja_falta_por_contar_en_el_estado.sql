SET lock_timeout = '5s';

-- La de DOS argumentos se va: agregarle el tercero con DEFAULT crea una firma
-- NUEVA y deja la vieja viva con sus permisos, que es como se acumulan las
-- sobrecargas que nadie llama y que una corrección futura puede aplicar sobre
-- la equivocada con «success». Se creó hace minutos y nadie la llama todavía.
DROP FUNCTION IF EXISTS public.caja_falta_por_contar(integer, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- CUÁNTO ENTRÓ AL CAJÓN DESDE EL ÚLTIMO CONTEO FIRMADO
--
-- Regla del usuario (6-sep): «no permitas hacer cierre del día si han habido
-- ventas después del último corte y no se ha hecho otro».
--
-- El freno que ya existía preguntaba otra cosa: ¿hay AL MENOS UN corte
-- confirmado hoy? Salud 2 cerró el 6-sep con esa respuesta en verde —su corte
-- de las 11:59 estaba confirmado— y **seis horas y $159.39 después**: 25 ventas
-- en efectivo por $152.65, el pago de CAESS de $5.74 y una inyección de $1.00
-- se quedaron en el cajón sin contar, sin firma y sin bolsa. El cierre no se
-- deshace y la caja no se vuelve a abrir, así que ese dinero ya no lo puede
-- contar nadie desde el portal.
--
-- ── NO ES UN CRONÓMETRO: mide DINERO, no tiempo ─────────────────────────────
-- Medido esta semana: Salud 4 el 5-sep cerró **hora y media** después de su
-- corte (21:00 → Z 22:37) y Salud 3 el 4-sep igual (21:06 → 22:37). Los dos dan
-- $0.00 y pasan. Lo que frena es que haya entrado plata, no que haya pasado el
-- rato.
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
-- los 143 cierres de 45 días disparó 60 veces, y en 59 de ellas no hubo NI UNA
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
-- ── MEDIDO SOBRE 143 CIERRES DE 45 DÍAS: DISPARA 2 VECES, LAS 2 REALES ──────
--   · Salud 2, 6-sep   +$159.39  — el caso que lo originó
--   · Salud 1, 17-ago  +$11.55   — anotaron un ingreso de $11.55 después del
--     corte confirmado, rehicieron el corte (que ya daba exacto) y **descartaron
--     ese** dejando confirmado el del sobrante. El freno los habría mandado a
--     confirmar el bueno.
-- Los 41 cierres de la última semana dan $0.00 EXACTO salvo el de Salud 2. En
-- los 45 días hay además tres NEGATIVOS (−4.00, −4.30, −242.10), que no frenan
-- y tienen causa conocida: facturas en efectivo que el tiquete del corte contó
-- y Hacienda invalidó después, así que hoy `sales_invoices` ya no las tiene. Ese
-- mecanismo sólo puede restar — nunca inventar dinero de más.
--
-- ── QUÉ NO VE ──────────────────────────────────────────────────────────────
-- Una factura que todavía no llegó al portal cuando se cierra no está en
-- `espera`, así que no frena. Falla hacia el lado que no traba a nadie, y el
-- hueco dura lo que tarda la captura.
--
-- `medido: false` es «no se pudo medir», y NO es cero: sin el tiquete del último
-- corte no hay `ya_medido`, y quien llama tiene que frenar igual. Sobre los 295
-- cortes confirmados que existen, ninguno está sin tiquete.
--
-- `hay_corte: false` con `falta: 0` es una sala que no vendió nada y no contó
-- nada. NO alcanza para dejarla cerrar: el freno de «sin corte confirmado» es
-- otro y sigue siendo suyo. Éste se SUMA, no lo reemplaza.
--
-- `p_piezas` es la salida de `caja_efectivo_piezas` ya calculada. La pasa
-- `caja_estado`, que la arma igual para el resto de la pantalla: sin eso la
-- misma suma se haría dos veces por carga de Mi caja (medido: 3.4 ms y 457
-- bloques por sala).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_falta_por_contar(
    p_branch_id integer, p_dia date, p_piezas json DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     numeric;
  v_pz     json := p_piezas;
  v_espera numeric;
  v_c      public.cortes_caja%ROWTYPE;
  v_medido numeric;
BEGIN
  IF v_pz IS NULL THEN
    SELECT round(coalesce(a.monto_apertura, 0), 2) INTO v_ap
      FROM public.cortes_caja_aperturas a
     WHERE a.branch_id = p_branch_id AND a.abierta_el = p_dia
     ORDER BY a.turno DESC, a.id DESC
     LIMIT 1;
    -- Las mismas piezas que la pantalla usa para «cuánto hay en el cajón», pero
    -- SIN restar las bolsas: acá se pregunta cuánto ENTRÓ en total, no cuánto
    -- quedó suelto. Un solo sitio arma la suma.
    v_pz := public.caja_efectivo_piezas(p_branch_id, p_dia, coalesce(v_ap, 0));
  END IF;

  v_espera := round( (v_pz->>'apertura')::numeric
                   + (v_pz->>'ventas_efectivo')::numeric
                   + (v_pz->>'entradas')::numeric
                   - (v_pz->>'vales')::numeric, 2);

  -- El último que CUENTA es el último CONFIRMADO. Un descartado no midió nada
  -- —su conteo se tiró— así que el tramo que abarcaba sigue abierto. Mismo
  -- criterio que `corte_tramo` y que `repartirPorCorte` en la pantalla.
  -- Verificado con Salud 1 el 17-ago, que tiene un descartado DESPUÉS del
  -- confirmado: elige el de las 22:01 y no el de las 22:03.
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
REVOKE EXECUTE ON FUNCTION public.caja_falta_por_contar(integer, date, json) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.caja_falta_por_contar(integer, date, json) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y la pantalla lo recibe con el resto del estado.
--
-- Va dentro de `caja_estado` y no en una llamada aparte porque el aviso tiene
-- que estar ANTES de apretar: quien va a cerrar ya tiene el estado pintado, y
-- una segunda consulta al abrir el diálogo llega tarde y puede fallar sola.
-- Es además lo que hace que la pantalla y el servidor no puedan contestar
-- distinto — el mismo juez para el aviso y para el candado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_estado(p_branch_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap     public.cortes_caja_aperturas%ROWTYPE;
  v_dia    date;
  v_reg    numeric;
  v_quien  text;
  v_cortes json;
  v_pz     json;
BEGIN
  -- Los MISMOS dos frenos que `operar-caja` aplica a la acción `estado`:
  -- mirar la caja es `caja_vales can_view`, y sin alcance ALL sólo la propia.
  IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
    RETURN json_build_object('ok', false,
      'error', 'No tienes permiso para mirar la caja desde el portal.');
  END IF;
  IF public.auth_module_scope('caja_vales') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RETURN json_build_object('ok', false,
      'error', 'Solo puedes mirar la caja de tu propia sala.');
  END IF;

  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  SELECT coalesce(json_agg(to_json(c) ORDER BY c.hora), '[]'::json) INTO v_cortes
    FROM (SELECT id, tipo, hora, total_declarado, esperado, diferencia_erp, estado
            FROM public.cortes_caja
           WHERE branch_id = p_branch_id AND fecha = v_dia) c;

  IF v_ap.branch_id IS NULL THEN
    RETURN json_build_object(
      'ok', true, 'abierta', false, 'caja', NULL, 'turno', NULL,
      'turno_corriendo', false, 'registrado', NULL, 'apertura', NULL,
      'quien', NULL, 'desde', NULL, 'dia', v_dia, 'cortes', v_cortes,
      'efectivo', NULL, 'efectivo_piezas', NULL, 'frescura_seg', NULL,
      -- Sin apertura viva no hay día que cerrar, y la pantalla no ofrece el
      -- botón. `null` es «no aplica», que no es lo mismo que «no falta nada».
      'falta_por_contar', NULL);
  END IF;

  SELECT e.name INTO v_quien
    FROM public.caja_aperturas_del_portal p
    JOIN public.employees e ON e.id = p.abierta_por
   WHERE p.branch_id = p_branch_id AND p.erp_apertura_id = v_ap.erp_apertura_id;

  -- El «Monto Registrado» del panel, derivado: apertura más las ventas
  -- FINALIZADAS de la fecha, sin entradas ni salidas — así lo arma el origen.
  SELECT round(coalesce(v_ap.monto_apertura, 0)
              + coalesce(sum(s.total), 0), 2) INTO v_reg
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id AND s.fecha = v_dia AND s.estado = 'FINALIZADA';

  -- Cuánto de eso son BILLETES, y con qué piezas. La cuenta vive en UNA sola
  -- función: `operar-caja` llama a la misma, así que las dos pantallas que
  -- preguntan por el cajón no pueden contestar distinto.
  v_pz := public.caja_efectivo_piezas(p_branch_id, v_dia, coalesce(v_ap.monto_apertura, 0));

  RETURN json_build_object(
    'ok', true,
    'abierta', true,
    'caja', v_ap.caja_erp,
    'turno', v_ap.turno,
    'turno_corriendo', coalesce(v_ap.turno_corriendo, true),
    'registrado', v_reg,
    'apertura', v_ap.monto_apertura,
    'quien', v_quien,
    'desde', v_ap.abierta_a,
    'dia', v_dia,
    'cortes', v_cortes,
    'efectivo', (v_pz->>'efectivo')::numeric,
    'efectivo_piezas', v_pz,
    'frescura_seg', round(extract(epoch FROM now() - v_ap.vista_at)),
    -- Las piezas van ARMADAS: la suma ya se hizo dos líneas arriba y volver a
    -- pedirla duplicaría el trabajo de cada carga de Mi caja.
    'falta_por_contar', public.caja_falta_por_contar(p_branch_id, v_dia, v_pz));
END;
$function$;
