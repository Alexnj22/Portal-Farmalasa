SET lock_timeout = '5s';

-- Si el traspaso de puntos de un cambio de cliente falla, se reintenta y, si no
-- entra, avisa (pedido del usuario, 2026-10-01: «¿no podríamos tener el error
-- al momento que se descuenta y suma al otro? así lo reintenta y si no, me
-- avisa para hacerlo manualmente»).
--
--   1. La aprobación lo intenta 3 veces seguidas (aplicar-solicitud-facturacion).
--   2. Si no entra, queda en `puntos_cambio_pendiente` y el aviso de cada 5
--      minutos lo reintenta solo.
--   3. A los 15 minutos sin entrar, avisa al teléfono (regla 11) y en Avisos se
--      puede reintentar o marcar como hecho a mano.
--   4. La red: el aviso también busca solicitudes aprobadas cuyos puntos no
--      siguieron al cliente aunque no haya un error anotado.
-- El traspaso es UNA transacción: o entra entero o no entra nada, así que
-- reintentarlo nunca lo hace dos veces (la segunda vez contesta «ya es suyo»).

CREATE TABLE IF NOT EXISTS public.puntos_cambio_pendiente (
  solicitud_id      uuid PRIMARY KEY REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  invoice_id        bigint NOT NULL,
  customer_nuevo    bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  por               uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  intentos          integer NOT NULL DEFAULT 0,
  ultimo_error      text,
  ultimo_intento_at timestamptz,
  resuelto_at       timestamptz,
  resuelto_como     text CHECK (resuelto_como IN ('automatico', 'reintento', 'a_mano')),
  resuelto_por      uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  nota              text,
  CHECK (resuelto_como <> 'a_mano' OR nota IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS puntos_cambio_pendiente_abiertos ON public.puntos_cambio_pendiente (created_at) WHERE resuelto_at IS NULL;
CREATE INDEX IF NOT EXISTS puntos_cambio_pendiente_customer ON public.puntos_cambio_pendiente (customer_nuevo);
ALTER TABLE public.puntos_cambio_pendiente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_cambio_pendiente_select ON public.puntos_cambio_pendiente;
CREATE POLICY puntos_cambio_pendiente_select ON public.puntos_cambio_pendiente
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')));
REVOKE ALL ON public.puntos_cambio_pendiente FROM anon;
-- Sin purga: historial de control, muy pocas filas.

-- El traspaso, sin guarda de rol. Lo llaman el envoltorio del navegador, el
-- reintento y el aviso; el navegador no lo alcanza directo.
CREATE OR REPLACE FUNCTION public.puntos_cambio_de_cliente_nucleo(
  p_invoice_id bigint, p_customer_nuevo bigint, p_aplicar boolean DEFAULT false,
  p_solicitud uuid DEFAULT NULL, p_por uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  l record;
  v_doc text;
  v_de_nombre text;
  v_a_nombre text;
  v_acumula boolean;
  v_saldo integer;
  v_propios integer;
  v_otros integer;
  v_falta integer;
  v_recibe integer;
  v_salida bigint;
BEGIN
  -- Sin guarda de rol: la ponen quienes la llaman (`puntos_cambio_de_cliente`
  -- para el navegador, el reintento, el aviso). El navegador no la alcanza.
  SELECT correlativo INTO v_doc FROM public.sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la venta %.', p_invoice_id; END IF;
  SELECT name, coalesce(acumula_puntos, true) AND acepta_programa_puntos IS DISTINCT FROM false
    INTO v_a_nombre, v_acumula
    FROM public.customers WHERE id = p_customer_nuevo;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_customer_nuevo; END IF;

  IF p_aplicar THEN
    SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id AND origen = 'venta' FOR UPDATE;
  ELSE
    SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id AND origen = 'venta';
  END IF;

  IF NOT FOUND THEN
    -- Sin puntos que mover. Al aplicar, la venta queda a nombre del nuevo YA:
    -- si el programa todavía no la había contado, la cuenta para él.
    IF p_aplicar THEN
      UPDATE public.sales_invoices SET customer_id = p_customer_nuevo
       WHERE id = p_invoice_id AND customer_id IS DISTINCT FROM p_customer_nuevo;
    END IF;
    RETURN json_build_object('ok', true, 'hay_puntos', false, 'documento', v_doc,
      'motivo', 'esta venta no sumó puntos', 'a_nombre', v_a_nombre);
  END IF;

  IF l.customer_id = p_customer_nuevo THEN
    RETURN json_build_object('ok', true, 'hay_puntos', true, 'ya_es_suyo', true,
      'puntos', l.puntos, 'documento', v_doc, 'a_nombre', v_a_nombre);
  END IF;

  SELECT name INTO v_de_nombre FROM public.customers WHERE id = l.customer_id;
  IF p_aplicar THEN
    SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = l.customer_id FOR UPDATE;
  ELSE
    SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = l.customer_id;
  END IF;
  v_saldo := coalesce(v_saldo, 0);
  -- La misma cuenta que una anulación (`puntos_anular_venta`).
  v_propios := l.restantes;
  v_otros := least(l.puntos - v_propios, greatest(v_saldo - v_propios, 0));
  v_falta := l.puntos - v_propios - v_otros;
  v_recibe := CASE WHEN v_acumula THEN l.puntos ELSE 0 END;

  IF NOT p_aplicar THEN
    RETURN json_build_object('ok', true, 'hay_puntos', true, 'documento', v_doc,
      'puntos', l.puntos,
      'de_id', l.customer_id, 'de_nombre', v_de_nombre, 'de_saldo', v_saldo,
      'a_id', p_customer_nuevo, 'a_nombre', v_a_nombre, 'a_acumula', v_acumula,
      'se_quitan', v_propios + v_otros, 'de_otras_compras', v_otros,
      'ya_gastados', v_falta, 'recibe', v_recibe);
  END IF;

  -- 1 · Al cliente viejo se le quita.
  IF v_propios + v_otros > 0 THEN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo, autorizado_por)
    VALUES (l.customer_id, 'cambio_cliente', v_propios + v_otros, p_invoice_id, l.sucursal,
            format('compra %s pasada a %s', coalesce(v_doc, '#' || p_invoice_id), v_a_nombre)
            || CASE WHEN v_otros > 0 THEN ' · ya los había usado; se tomaron de sus otros puntos' ELSE '' END
            || CASE WHEN v_falta > 0 THEN format(' · faltaron %s', v_falta) ELSE '' END,
            p_por)
    RETURNING id INTO v_salida;
    IF v_propios > 0 THEN
      UPDATE public.puntos_lote SET restantes = 0 WHERE id = l.id;
      INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, l.id, v_propios);
    END IF;
    IF v_otros > 0 AND public.puntos_consumir(l.customer_id, v_otros, v_salida) <> v_otros THEN
      RAISE EXCEPTION 'El libro no cuadra al pasar la venta %', p_invoice_id;
    END IF;
    UPDATE public.puntos_cuenta
       SET saldo = saldo - (v_propios + v_otros), usados = usados + (v_propios + v_otros), updated_at = now()
     WHERE customer_id = l.customer_id;
  END IF;

  -- 2 · Su lote deja de ser «la venta» (antes de crear el del nuevo: una venta
  -- tiene un solo lote `venta`, y el índice único lo exige).
  UPDATE public.puntos_lote
     SET origen = 'venta_pasada', invoice_id = NULL,
         motivo = format('compra %s · pasada a %s', coalesce(v_doc, '#' || p_invoice_id), v_a_nombre)
   WHERE id = l.id;

  -- 3 · El nuevo recibe la compra entera, con la fecha y el vencimiento de la
  -- compra original. Si no acumula (una ficha genérica, o salió del programa),
  -- no recibe nada.
  IF v_recibe > 0 THEN
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (p_customer_nuevo) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (p_customer_nuevo, 'venta', p_invoice_id, l.sucursal, l.puntos, l.puntos, l.ganado_el, l.vence_el,
            format('pasada de %s', v_de_nombre));
    UPDATE public.puntos_cuenta
       SET saldo = saldo + l.puntos, ganados = ganados + l.puntos, updated_at = now()
     WHERE customer_id = p_customer_nuevo;
  END IF;

  UPDATE public.sales_invoices SET customer_id = p_customer_nuevo
   WHERE id = p_invoice_id AND customer_id IS DISTINCT FROM p_customer_nuevo;

  INSERT INTO public.puntos_cambio_cliente
    (invoice_id, solicitud_id, de_customer, a_customer, puntos, quitados, de_otras, no_recuperados, recibio, por)
  VALUES (p_invoice_id, p_solicitud, l.customer_id, p_customer_nuevo, l.puntos,
          v_propios + v_otros, v_otros, v_falta, v_recibe, p_por);

  RETURN json_build_object('ok', true, 'hay_puntos', true, 'aplicado', true, 'documento', v_doc,
    'puntos', l.puntos, 'de_id', l.customer_id, 'de_nombre', v_de_nombre,
    'a_id', p_customer_nuevo, 'a_nombre', v_a_nombre,
    'se_quitaron', v_propios + v_otros, 'de_otras_compras', v_otros,
    'no_recuperados', v_falta, 'recibio', v_recibe);
END;
$function$;


REVOKE EXECUTE ON FUNCTION public.puntos_cambio_de_cliente_nucleo(bigint, bigint, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_cambio_de_cliente_nucleo(bigint, bigint, boolean, uuid, uuid) TO service_role;

-- Lo que llaman el navegador (para ver) y la aprobación (para hacer). Misma
-- firma y misma respuesta que antes: la guarda quedó acá y el cuerpo en el núcleo.
CREATE OR REPLACE FUNCTION public.puntos_cambio_de_cliente(
  p_invoice_id bigint, p_customer_nuevo bigint, p_aplicar boolean DEFAULT false,
  p_solicitud uuid DEFAULT NULL, p_por uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Ver lo puede cualquier empleado con sesión; HACERLO, sólo el servidor.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF p_aplicar THEN
      RAISE EXCEPTION 'El traspaso de puntos sólo lo hace la aprobación de la solicitud.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_employee_id() IS NULL THEN
      RAISE EXCEPTION 'Sin sesión de empleado.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN public.puntos_cambio_de_cliente_nucleo(p_invoice_id, p_customer_nuevo, p_aplicar, p_solicitud, p_por);
END;
$function$;

-- Reintentar un traspaso pendiente. Lo llama el aviso cada 5 minutos y, desde
-- Avisos, quien puede dar y quitar puntos. Si entra, la solicitud pasa a
-- mostrar lo que pasó con los puntos, igual que si hubiera entrado al aprobar.
CREATE OR REPLACE FUNCTION public.puntos_cambio_reintentar(p_solicitud uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p record;
  v json;
  v_manual boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
  v_quien uuid;
BEGIN
  IF v_manual THEN
    IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
      RAISE EXCEPTION 'No tienes permiso para dar ni quitar puntos.' USING ERRCODE = '42501';
    END IF;
    v_quien := public.auth_employee_id();
  END IF;

  SELECT * INTO p FROM public.puntos_cambio_pendiente WHERE solicitud_id = p_solicitud FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay un traspaso de puntos pendiente para esa solicitud.'; END IF;
  IF p.resuelto_at IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'ya_resuelto', true, 'como', p.resuelto_como);
  END IF;

  BEGIN
    v := public.puntos_cambio_de_cliente_nucleo(p.invoice_id, p.customer_nuevo, true, p.solicitud_id,
                                                coalesce(v_quien, p.por));
  EXCEPTION WHEN OTHERS THEN
    -- El bloque deshizo lo que el traspaso alcanzó a hacer; queda anotado.
    UPDATE public.puntos_cambio_pendiente
       SET intentos = intentos + 1, ultimo_error = SQLERRM, ultimo_intento_at = now()
     WHERE solicitud_id = p_solicitud;
    RETURN json_build_object('ok', false, 'error', SQLERRM);
  END;

  UPDATE public.puntos_cambio_pendiente
     SET intentos = intentos + 1, ultimo_intento_at = now(), resuelto_at = now(),
         resuelto_como = CASE WHEN v_manual THEN 'reintento' ELSE 'automatico' END,
         resuelto_por = v_quien
   WHERE solicitud_id = p_solicitud;
  UPDATE public.approval_requests
     SET metadata = jsonb_set(metadata, '{erp_aplicado,puntos}', v::jsonb)
   WHERE id = p_solicitud AND metadata ? 'erp_aplicado';

  RETURN json_build_object('ok', true, 'resultado', v);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_cambio_reintentar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_cambio_reintentar(uuid) TO authenticated, service_role;

-- Ya se hizo a mano (con un ajuste de puntos): se cierra con el motivo y deja
-- de reintentarse. No mueve puntos: sólo deja constancia.
CREATE OR REPLACE FUNCTION public.puntos_cambio_resuelto_a_mano(p_solicitud uuid, p_nota text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para dar ni quitar puntos.' USING ERRCODE = '42501';
  END IF;
  IF v_nota IS NULL THEN RAISE EXCEPTION 'Falta escribir qué se hizo.'; END IF;
  UPDATE public.puntos_cambio_pendiente
     SET resuelto_at = now(), resuelto_como = 'a_mano', resuelto_por = public.auth_employee_id(), nota = v_nota
   WHERE solicitud_id = p_solicitud AND resuelto_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese traspaso ya estaba resuelto o no existe.'; END IF;
  RETURN json_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_cambio_resuelto_a_mano(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_cambio_resuelto_a_mano(uuid, text) TO authenticated, service_role;

-- Los traspasos sin terminar, más los resueltos de la última semana, para la
-- pestaña Avisos.
CREATE OR REPLACE FUNCTION public.puntos_cambios_pendientes()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(json_agg(x ORDER BY x.resuelto_at IS NOT NULL, x.created_at DESC), '[]'::json) INTO v FROM (
    SELECT pc.solicitud_id, pc.created_at, pc.invoice_id, si.correlativo AS documento,
           l.puntos, cd.id AS de_id, cd.name AS de_nombre, ca.id AS a_id, ca.name AS a_nombre,
           pc.intentos, pc.ultimo_error, pc.ultimo_intento_at,
           pc.resuelto_at, pc.resuelto_como, pc.nota, pc.resuelto_por, er.name AS resuelto_por_nombre
      FROM public.puntos_cambio_pendiente pc
      LEFT JOIN public.sales_invoices si ON si.id = pc.invoice_id
      LEFT JOIN public.puntos_lote l ON l.invoice_id = pc.invoice_id AND l.origen = 'venta'
      LEFT JOIN public.customers cd ON cd.id = l.customer_id AND l.customer_id <> pc.customer_nuevo
      LEFT JOIN public.customers ca ON ca.id = pc.customer_nuevo
      LEFT JOIN public.employees er ON er.id = pc.resuelto_por
     WHERE pc.resuelto_at IS NULL OR pc.resuelto_at >= now() - interval '7 days'
  ) x;
  RETURN v;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_cambios_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_cambios_pendientes() TO authenticated, service_role;

-- El aviso: red, reintentos y la regla 11.
CREATE OR REPLACE FUNCTION public.puntos_vigilar_irregularidades(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde date;
  v_hallazgos jsonb;
  v_dest uuid[];
  v_nuevos int := 0;
  r record;
  rp record;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;
  -- Ayer también: lo que entró al filo de la medianoche se juzga completo.
  v_desde := greatest(v_hoy - 1, (SELECT inicio FROM public.puntos_config WHERE id));

  -- Los traspasos de puntos de un cambio de cliente que no terminaron
  -- (2026-10-01). Primero la red: toda solicitud aprobada cuya venta todavía le
  -- da los puntos a otro que el cliente nuevo, aunque nadie haya anotado un
  -- error (la aprobación pudo cortarse entre el sistema y los puntos). Sólo la
  -- ÚLTIMA solicitud de cada venta: una segunda que la devuelve al original
  -- deja a la primera «desalineada» a propósito. Después, reintentar cada
  -- pendiente; el traspaso es una sola transacción, así que reintentar es
  -- seguro.
  IF NOT p_simular THEN
    WITH q AS (
      SELECT ar.id, (ar.metadata->>'invoice_id')::bigint AS inv, (ar.metadata->>'new_client_id')::bigint AS nuevo,
             ar.approver_id, ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'CLIENT_CHANGE_REQUEST' AND ar.status = 'APPROVED'
         AND ar.updated_at >= (SELECT inicio FROM public.puntos_config WHERE id)::timestamp AT TIME ZONE 'America/El_Salvador'
         AND ar.metadata->>'invoice_id' ~ '^[0-9]+$' AND ar.metadata->>'new_client_id' ~ '^[0-9]+$'
    ), ult AS (
      SELECT DISTINCT ON (inv) * FROM q ORDER BY inv, updated_at DESC
    )
    INSERT INTO public.puntos_cambio_pendiente (solicitud_id, invoice_id, customer_nuevo, por, ultimo_error)
    SELECT u.id, u.inv, u.nuevo, u.approver_id, 'la aprobación no movió los puntos'
      FROM ult u
      JOIN public.puntos_lote l ON l.invoice_id = u.inv AND l.origen = 'venta'
     WHERE l.customer_id <> u.nuevo
       AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = u.nuevo)
    ON CONFLICT (solicitud_id) DO NOTHING;

    FOR rp IN SELECT solicitud_id FROM public.puntos_cambio_pendiente
               WHERE resuelto_at IS NULL AND created_at >= now() - interval '7 days'
    LOOP
      PERFORM public.puntos_cambio_reintentar(rp.solicitud_id);
    END LOOP;
  END IF;

  WITH v AS (
    SELECT l.customer_id, l.ganado_el AS dia, l.puntos, l.sucursal, l.invoice_id,
           coalesce(b.name, l.sucursal) AS sala, si.cod_vendedor, si.correlativo, si.created_at,
           -- Una visita nueva del mismo vendedor si pasó más de media hora: una
           -- compra partida en tres facturas seguidas es UNA visita.
           CASE WHEN si.created_at - lag(si.created_at) OVER (PARTITION BY l.customer_id, l.ganado_el, si.cod_vendedor
                                                               ORDER BY si.created_at) <= interval '30 minutes'
                THEN 0 ELSE 1 END AS visita_nueva
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = l.sucursal
     WHERE l.origen = 'venta' AND l.ganado_el >= v_desde
  ),
  dia AS (
    SELECT customer_id, dia, count(*) AS n, sum(puntos) AS p,
           count(DISTINCT sucursal) AS salas, count(DISTINCT cod_vendedor) AS vendedores,
           string_agg(DISTINCT sala, ', ') AS lista_salas,
           min(created_at) AS primera, max(created_at) AS ultima
      FROM v GROUP BY 1, 2
  ),
  h AS (
    -- 1 · Muchas ventas a la misma ficha en un día. La señal es la cantidad de
    -- VENDEDORES, no de facturas. OJO con de dónde salió el umbral: en el
    -- archivo del sistema anterior esos días parecían 321 al año, pero el 95%
    -- eran facturas reales del MISMO cliente registradas con meses de atraso,
    -- todas juntas (medido cruzando ticket con factura el 2026-10-01). Con la
    -- fecha real de la venta, que es la que mira esto, es mucho más raro.
    SELECT 'muchas_ventas' AS tipo, 'muchas:' || customer_id || ':' || dia AS clave, dia, customer_id,
           NULL::text AS sucursal, NULL::bigint AS invoice_id, NULL::uuid AS employee_id, p::int AS puntos,
           format('%s ventas en un día, de %s vendedores, entre %s y %s', n, vendedores,
                  to_char(primera AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM'),
                  to_char(ultima AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')) AS nota,
           jsonb_build_object('ventas', n, 'vendedores', vendedores, 'salas', lista_salas) AS detalle
      FROM dia WHERE vendedores >= 4 OR n >= 8
    UNION ALL
    -- 2 · Muchos puntos en un día (si no es ya por muchas ventas).
    SELECT 'acumulacion_alta', 'alta:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('%s puntos en un día, en %s %s', p, n, CASE WHEN n = 1 THEN 'venta' ELSE 'ventas' END),
           jsonb_build_object('ventas', n)
      FROM dia WHERE p >= 500 AND NOT (vendedores >= 4 OR n >= 8)
    UNION ALL
    -- 3 · Compras en 3 o más salas el mismo día.
    SELECT 'varias_salas', 'salas:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('Compró en %s salas el mismo día (%s)', salas, lista_salas),
           jsonb_build_object('ventas', n, 'salas', lista_salas)
      FROM dia WHERE salas >= 3
    UNION ALL
    -- 4 · Un vendedor atiende a la misma ficha en 3+ visitas separadas (3 al año
    -- en el sistema anterior; contando facturas daba 502 y casi todas eran una
    -- compra partida).
    SELECT 'mismo_vendedor', 'vendedor:' || x.customer_id || ':' || x.cod_vendedor || ':' || x.dia, x.dia,
           x.customer_id, x.salas, NULL, e.id, x.p::int,
           format('%s le cargó ventas en %s momentos distintos del día (%s facturas)', coalesce(public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name), 'El vendedor ' || x.cod_vendedor), x.visitas, x.n),
           jsonb_build_object('ventas', x.n, 'visitas', x.visitas, 'cod_vendedor', x.cod_vendedor)
      FROM (SELECT customer_id, dia, cod_vendedor, count(*) n, sum(visita_nueva) visitas, sum(puntos) p,
                   string_agg(DISTINCT sala, ', ') salas
              FROM v WHERE cod_vendedor IS NOT NULL GROUP BY 1, 2, 3 HAVING sum(visita_nueva) >= 3) x
      LEFT JOIN public.employees e ON e.code = x.cod_vendedor
    UNION ALL
    -- 5 · Un empleado se factura a su propia ficha. Por DUI cuando lo tiene; si
    -- no, por nombre: su nombre del portal (primer nombre + apellido) completo
    -- dentro del de la ficha y con el mismo primer nombre. Hacía falta porque
    -- ningún empleado tiene el DUI cargado. Medido jul–sep 2026: 25 empleados,
    -- los 25 son la misma persona, pero son ~450 ventas — casi todas compras
    -- propias normales. Por eso se avisa por empleado y día, y sólo con 3+
    -- facturas o 50+ puntos (47 días en 92, ~1 cada 2 días).
    SELECT 'venta_a_si_mismo', 'propia:' || x.emp_id || ':' || x.dia, x.dia, x.customer_id,
           x.salas, NULL, x.emp_id, x.p::int,
           format('%s se facturó a su propia ficha %s %s en el día%s', x.corto, x.n,
                  CASE WHEN x.n = 1 THEN 'vez' ELSE 'veces' END,
                  CASE WHEN x.por_dui THEN '' ELSE ' (coincide por nombre; no tiene DUI cargado)' END),
           jsonb_build_object('ventas', x.n, 'documentos', x.docs, 'por_dui', x.por_dui)
      FROM (SELECT e.id AS emp_id, v.customer_id, v.dia, count(*) n, sum(v.puntos) p,
                   string_agg(DISTINCT v.sala, ', ') salas, bool_or(k.por_dui) por_dui,
                   jsonb_agg(v.correlativo) docs,
                   public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name) corto
              FROM v
              JOIN public.employees e ON e.code = v.cod_vendedor
              JOIN public.customers c ON c.id = v.customer_id
              CROSS JOIN LATERAL (SELECT
                  string_to_array(trim(regexp_replace(upper(translate(e.name, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUNNUU')), '[^A-Z]+', ' ', 'g')), ' ') AS te,
                  string_to_array(trim(regexp_replace(upper(translate(c.name, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUNNUU')), '[^A-Z]+', ' ', 'g')), ' ') AS tc,
                  length(regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')) = 9
                    AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') AS por_dui) k
             WHERE k.por_dui OR (array_length(k.te, 1) >= 2 AND k.tc[1] = k.te[1] AND k.tc @> k.te)
             GROUP BY e.id, e.first_names, e.last_names, e.name, v.customer_id, v.dia) x
     WHERE x.n >= 3 OR x.p >= 50
    UNION ALL
    -- 6 · Puntos dados a mano. Los del cuadre del arranque no llevan autor.
    SELECT 'ajuste_suma', 'ajuste_lote:' || l.id, l.ganado_el, l.customer_id,
           NULL, NULL, l.creado_por, l.puntos,
           'Puntos dados a mano: ' || coalesce(l.motivo, 'sin motivo'), NULL
      FROM public.puntos_lote l
     WHERE l.origen = 'ajuste' AND l.ganado_el >= v_desde AND l.creado_por IS NOT NULL
    UNION ALL
    -- 7 · Puntos quitados a mano.
    SELECT 'ajuste_resta', 'ajuste_salida:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, NULL, NULL, s.autorizado_por, -s.puntos,
           'Puntos quitados a mano: ' || coalesce(s.motivo, 'sin motivo'), NULL
      FROM public.puntos_salida s
     WHERE s.tipo = 'ajuste' AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND s.autorizado_por IS NOT NULL
    UNION ALL
    -- 8 · Canje grande, o canje hecho con puntos recién ganados.
    SELECT CASE WHEN s.puntos >= 2000 THEN 'canje_grande' ELSE 'canje_recien_ganado' END,
           'canje:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, s.sucursal, s.invoice_id, NULL, s.puntos,
           CASE WHEN s.puntos >= 2000 THEN format('Canje de %s puntos', s.puntos)
                ELSE format('Canjeó %s puntos y %s los ganó en los 3 días anteriores', s.puntos, rec.p) END,
           jsonb_build_object('ganados_3_dias', rec.p)
      FROM public.puntos_salida s
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(l.puntos), 0) AS p FROM public.puntos_lote l
         WHERE l.customer_id = s.customer_id AND l.origen IN ('venta', 'ajuste')
           AND l.ganado_el BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 3
                               AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date) rec
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL
       AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND (s.puntos >= 2000 OR (rec.p >= 300 AND rec.p * 2 >= s.puntos))
    UNION ALL
    -- 9 · Factura anulada cuando sus puntos ya se habían canjeado. Ya figura en
    -- Avisos por su cuenta; acá sólo se agrega para que llegue el aviso.
    SELECT 'anulada_gastada', 'anulada:' || g.invoice_id, (g.created_at AT TIME ZONE 'America/El_Salvador')::date,
           g.customer_id, g.sucursal, g.invoice_id, NULL, g.no_recuperados,
           format('Se anuló una factura cuyos puntos ya se habían canjeado: %s puntos no se recuperaron', g.no_recuperados),
           NULL
      FROM public.puntos_anulacion_gastada g
     WHERE g.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
    UNION ALL
    -- 10 · Una venta pasada a otro cliente con sus puntos (2026-10-01). Siempre:
    -- es justo el movimiento que se querría esconder, y es raro.
    SELECT 'cambio_cliente', 'cambio:' || k.id, (k.created_at AT TIME ZONE 'America/El_Salvador')::date,
           k.a_customer, NULL, k.invoice_id, k.por, k.puntos,
           format('Recibió la compra de %s con sus %s puntos', coalesce(cd.name, 'otro cliente'), k.puntos)
           || CASE WHEN k.no_recuperados > 0
                   THEN format('; %s ya los había gastado y no se recuperaron', k.no_recuperados) ELSE '' END,
           jsonb_build_object('de_customer', k.de_customer, 'quitados', k.quitados, 'no_recuperados', k.no_recuperados)
      FROM public.puntos_cambio_cliente k
      LEFT JOIN public.customers cd ON cd.id = k.de_customer
     WHERE k.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
    UNION ALL
    -- 11 · Un traspaso de puntos que ni reintentando entró. Se avisa cuando
    -- lleva 15 minutos pendiente: los 3 intentos de la aprobación y al menos 3
    -- del aviso. Se sigue reintentando solo; desde Avisos se reintenta o se
    -- marca como hecho a mano.
    SELECT 'cambio_cliente_fallido', 'cambio_fallido:' || pc.solicitud_id,
           (pc.created_at AT TIME ZONE 'America/El_Salvador')::date,
           pc.customer_nuevo, NULL, pc.invoice_id, pc.por, l.puntos,
           format('La venta %s se pasó a este cliente pero sus puntos no se movieron, ni reintentando. Último error: %s',
                  coalesce(si.correlativo, '#' || pc.invoice_id), left(coalesce(pc.ultimo_error, '—'), 200)),
           jsonb_build_object('solicitud_id', pc.solicitud_id)
      FROM public.puntos_cambio_pendiente pc
      LEFT JOIN public.sales_invoices si ON si.id = pc.invoice_id
      LEFT JOIN public.puntos_lote l ON l.invoice_id = pc.invoice_id AND l.origen = 'venta'
     WHERE pc.resuelto_at IS NULL AND pc.created_at < now() - interval '15 minutes'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) INTO v_hallazgos FROM h;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'desde', v_desde, 'hallazgos', v_hallazgos);
  END IF;

  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;

  FOR r IN
    WITH ins AS (
      INSERT INTO public.puntos_irregularidad
        (clave, tipo, dia, customer_id, sucursal, invoice_id, employee_id, puntos, nota, detalle)
      SELECT x.clave, x.tipo, x.dia, x.customer_id, x.sucursal, x.invoice_id, x.employee_id, x.puntos, x.nota, x.detalle
        FROM jsonb_to_recordset(v_hallazgos) AS x(clave text, tipo text, dia date, customer_id bigint, sucursal text,
             invoice_id bigint, employee_id uuid, puntos int, nota text, detalle jsonb)
      ON CONFLICT (clave) DO UPDATE
        SET puntos = EXCLUDED.puntos, nota = EXCLUDED.nota, detalle = EXCLUDED.detalle,
            sucursal = EXCLUDED.sucursal, updated_at = now()
        WHERE (puntos_irregularidad.puntos, puntos_irregularidad.nota)
              IS DISTINCT FROM (EXCLUDED.puntos, EXCLUDED.nota)
      RETURNING id, nota, customer_id, avisado_at
    )
    -- Desde la salida del INSERT y no releyendo la tabla: dentro del mismo
    -- comando la consulta de afuera no ve las filas recién insertadas.
    SELECT ins.id, ins.nota, ins.customer_id, c.name AS cliente
      FROM ins LEFT JOIN public.customers c ON c.id = ins.customer_id
     WHERE ins.avisado_at IS NULL
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'PUNTOS_IRREGULAR',
        'Puntos: movimiento fuera de lo normal',
        coalesce(r.cliente, 'Cliente ' || r.customer_id) || ' — ' || r.nota,
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'puntos_irregular:' || r.id), true, NULL);
    END IF;
    UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE id = r.id;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'hallazgos', jsonb_array_length(v_hallazgos), 'avisados', v_nuevos);
END;
$function$;
