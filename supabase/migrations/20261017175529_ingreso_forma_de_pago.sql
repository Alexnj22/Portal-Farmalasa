SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Un ingreso de caja dice CÓMO se pagó (2026-10-17).
--
-- Hasta hoy todo ingreso del portal iba al cajón de la caja (45 días medidos:
-- ninguno sin `erp_movimiento_id`), y la caja trata cada ingreso como
-- efectivo. Una inyección cobrada con tarjeta y anotada igual nacía como un
-- faltante que no existe. Preguntar la forma de pago no alcanzaba: lo que no
-- es efectivo NO puede sumarse al esperado del cajón.
--
--   EFECTIVO       → a la caja, como siempre.
--   TARJETA        → foto del voucher; no va a la caja.
--   TRANSFERENCIA  → foto del comprobante; no va a la caja.
--   sin foto       → se anota igual, pendiente de autorización (`requests_caja`:
--                    hoy Supervisión de Ventas, Talento Humano y Administración).
--                    Rechazada NO se anula: se avisa y se puede reenviar con más
--                    pruebas (decisión del usuario).
--
-- Plan: docs/PLAN-INGRESOS-Y-RESERVAS-2026-10-17.md
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS forma_pago text NOT NULL DEFAULT 'EFECTIVO',
  -- El total del voucher o del comprobante. Puede ser MAYOR que el monto: un
  -- voucher de $16 cubre $15 de una venta con tarjeta y $1 de una inyección.
  ADD COLUMN IF NOT EXISTS comprobante_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS autorizacion text,
  ADD COLUMN IF NOT EXISTS autorizacion_solicitud uuid,
  ADD COLUMN IF NOT EXISTS autorizacion_por uuid,
  ADD COLUMN IF NOT EXISTS autorizacion_at timestamptz,
  ADD COLUMN IF NOT EXISTS autorizacion_nota text;

ALTER TABLE public.caja_movimientos_portal
  DROP CONSTRAINT IF EXISTS caja_movimientos_portal_forma_pago_check,
  ADD CONSTRAINT caja_movimientos_portal_forma_pago_check
      CHECK (forma_pago IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')),
  DROP CONSTRAINT IF EXISTS caja_movimientos_portal_autorizacion_check,
  ADD CONSTRAINT caja_movimientos_portal_autorizacion_check
      CHECK (autorizacion IS NULL OR autorizacion IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  -- Una salida se paga siempre del cajón; sólo una ENTRADA puede no ser efectivo.
  DROP CONSTRAINT IF EXISTS caja_movimientos_portal_salida_en_efectivo,
  ADD CONSTRAINT caja_movimientos_portal_salida_en_efectivo
      CHECK (tipo = 'ENTRADA' OR forma_pago = 'EFECTIVO'),
  DROP CONSTRAINT IF EXISTS caja_movimientos_portal_comprobante_cubre,
  ADD CONSTRAINT caja_movimientos_portal_comprobante_cubre
      CHECK (comprobante_total IS NULL OR comprobante_total >= monto - 0.005);

CREATE INDEX IF NOT EXISTS caja_movimientos_portal_no_efectivo
  ON public.caja_movimientos_portal (branch_id, fecha)
  WHERE forma_pago <> 'EFECTIVO';
CREATE INDEX IF NOT EXISTS caja_movimientos_portal_autorizacion_solicitud
  ON public.caja_movimientos_portal (autorizacion_solicitud)
  WHERE autorizacion_solicitud IS NOT NULL;

-- ── La solicitud nueva ─────────────────────────────────────────────────────
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check
  CHECK (type = ANY (ARRAY['PERMISSION','VACATION','SICK_LEAVE','SCHEDULE_CHANGE','SHIFT_CHANGE',
    'OTHER','PERMIT','DISABILITY','OVERTIME','ADVANCE','CERTIFICATE','ANNULMENT_REQUEST',
    'PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST',
    'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH','INVENTORY_DISCARD_REQUEST',
    'INVENTORY_LOAD_REQUEST','MINMAX_CHANGE_REQUEST','CAJA_MOVIMIENTO_CHANGE',
    'ABONO_CREDITO_CHANGE','ABONO_APROBACION','DIST_DESCUENTO',
    'CAJA_INGRESO_AUTORIZACION']::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_un_ingreso_por_autorizar
  ON public.approval_requests ((metadata ->> 'movimiento_portal'))
  WHERE status = 'PENDING' AND type = 'CAJA_INGRESO_AUTORIZACION';

CREATE OR REPLACE FUNCTION public.modulo_de_aprobacion(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                             'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
      THEN 'requests_facturacion'
    WHEN p_type = ANY (ARRAY['INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST'])
      THEN 'requests_inventario'
    WHEN p_type = ANY (ARRAY['CAJA_MOVIMIENTO_CHANGE', 'CAJA_INGRESO_AUTORIZACION'])
      THEN 'requests_caja'
    WHEN p_type = ANY (ARRAY['ABONO_CREDITO_CHANGE', 'ABONO_APROBACION'])
      THEN 'requests_cuentas_por_cobrar'
    WHEN p_type = 'DIST_DESCUENTO'
      THEN 'requests_distribucion'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.asignar_aprobador_solicitud()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap    uuid;
  v_nom   text;
  v_mod   text;
  v_n     integer;
  -- Los tipos que crean los dos widgets que eligen al aprobador del lado del
  -- navegador. El resto de las solicitudes ya llega con el suyo.
  v_tipos text[] := ARRAY['INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                          'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                          'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST'];
  -- Las del dinero. Van por su PERMISO y no por el nombre de un cargo.
  v_del_dinero text[] := ARRAY['CAJA_MOVIMIENTO_CHANGE','ABONO_CREDITO_CHANGE',
                               'ABONO_APROBACION','CAJA_INGRESO_AUTORIZACION'];
BEGIN
  v_mod := public.modulo_de_aprobacion(NEW.type);

  /* ── Cuántos pueden resolverla ────────────────────────────────────────
   * Antes que nada, porque la respuesta no depende de si el destinatario ya
   * viene elegido. Sin esto, las seis que lo traen del navegador nunca
   * llegaban a contarse y la pantalla nombraba a una persona sobre algo que
   * podían resolver cuatro. */
  IF v_mod IS NOT NULL THEN
    SELECT count(*)::integer INTO v_n
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod);

    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                    || jsonb_build_object('aprobadores_n', v_n);
  END IF;

  IF NEW.approver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = ANY (v_del_dinero) THEN
    /* Se elige de la MISMA lista que se acaba de contar: dos consultas sobre
     * la misma pregunta es cómo el número y el nombre terminan diciendo cosas
     * distintas. */
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod)
    ORDER BY e.name
    LIMIT 1;

    IF v_ap IS NULL THEN
      RETURN NEW;   -- nadie con ese permiso; queda como estaba
    END IF;

    NEW.approver_id := v_ap;
    NEW.metadata := NEW.metadata
                    || jsonb_build_object('notified_employee_id', v_ap,
                                          'notified_employee',    v_nom);
    RETURN NEW;
  END IF;

  IF NOT (NEW.type = ANY (v_tipos)) THEN
    RETURN NEW;
  END IF;

  -- 1 · Supervisión de Ventas, **si además puede resolverla**. Es la preferida
  --     —es quien lo resuelve todos los días— pero avisarle a quien no tiene el
  --     permiso es dejar la solicitud esperando a alguien que no puede tocarla.
  SELECT e.id, e.name INTO v_ap, v_nom
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.status = 'ACTIVO'
    AND r.name ILIKE 'Supervisor%Ventas%'
    AND e.id <> NEW.employee_id
    AND public.puede_aprobar_modulo(e.id, v_mod)
  ORDER BY e.name
  LIMIT 1;

  -- 2 · Si no, cualquiera de los que SÍ tienen el permiso.
  IF v_ap IS NULL THEN
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod)
    ORDER BY e.name
    LIMIT 1;
  END IF;

  -- 3 · Nadie con el módulo: la administración del sistema, como último
  --     recurso. Acá `aprobadores_n` vale 0 y la pantalla nombra a esta
  --     persona, que es lo único accionable que queda.
  IF v_ap IS NULL THEN
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND public.rango_de_empleado(e.id) >= 4
      AND e.id <> NEW.employee_id
    ORDER BY e.name
    LIMIT 1;
  END IF;

  IF v_ap IS NULL THEN
    RETURN NEW;   -- de verdad no hay a quién; queda como estaba
  END IF;

  NEW.approver_id := v_ap;
  -- La nota que lee la pantalla decía «Sin supervisión asignada»: si el
  -- servidor sí encontró a alguien, tiene que decir quién.
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                  || jsonb_build_object('notified_employee_id', v_ap,
                                        'notified_employee',    v_nom);
  RETURN NEW;
END;
$function$;

-- Espejo de `TIPOS_OPERATIVOS` (requestsSlice.js): las policies de
-- `approval_requests` deciden con esta función quién ve la solicitud.
CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH',
    'CAJA_MOVIMIENTO_CHANGE', 'CAJA_INGRESO_AUTORIZACION',
    'ABONO_CREDITO_CHANGE', 'ABONO_APROBACION',
    'DIST_DESCUENTO'
  ]);
$function$;

-- ── Pedir la autorización: UNA función para el primer envío y los reenvíos ──
--
-- La llama `operar-caja` al anotar un ingreso sin comprobante (con llave de
-- servicio, por eso recibe quién pide) y `caja_ingreso_reenviar` cuando la
-- sala vuelve a mandarlo con más pruebas. Escrita dos veces, el reenvío se
-- olvidaría de algo que el primer envío sí hace.
CREATE OR REPLACE FUNCTION public.caja_ingreso_pedir_autorizacion(
    p_movimiento bigint, p_pide uuid, p_nota text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mov public.caja_movimientos_portal%ROWTYPE;
  v_sol uuid;
BEGIN
  SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese ingreso no existe.'; END IF;
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese ingreso está anulado.'; END IF;
  IF v_mov.forma_pago = 'EFECTIVO' THEN
    RAISE EXCEPTION 'Un ingreso en efectivo no necesita autorización: entra a la caja.';
  END IF;
  IF v_mov.autorizacion IN ('PENDIENTE', 'APROBADA') THEN
    RAISE EXCEPTION 'Ese ingreso ya está %.', CASE v_mov.autorizacion WHEN 'PENDIENTE' THEN 'esperando autorización' ELSE 'autorizado' END;
  END IF;

  INSERT INTO public.approval_requests (type, employee_id, status, note, metadata)
  VALUES ('CAJA_INGRESO_AUTORIZACION', p_pide, 'PENDING',
          nullif(btrim(coalesce(p_nota, '')), ''),
          jsonb_build_object(
            'movimiento_portal', v_mov.id, 'branch_id', v_mov.branch_id,
            'fecha', v_mov.fecha, 'monto', v_mov.monto, 'forma_pago', v_mov.forma_pago,
            'concepto', v_mov.concepto, 'detalle', v_mov.detalle,
            'tipo_codigo', v_mov.tipo_codigo, 'foto_url', v_mov.foto_url,
            'numero_boleta', v_mov.numero_boleta,
            'comprobante_total', v_mov.comprobante_total,
            'reenvio', v_mov.autorizacion = 'RECHAZADA',
            'rechazo_anterior', CASE WHEN v_mov.autorizacion = 'RECHAZADA' THEN v_mov.autorizacion_nota END))
  RETURNING id INTO v_sol;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = 'PENDIENTE', autorizacion_solicitud = v_sol,
         autorizacion_por = NULL, autorizacion_at = NULL, updated_at = now()
   WHERE id = v_mov.id;
  RETURN v_sol;
END $function$;

REVOKE ALL ON FUNCTION public.caja_ingreso_pedir_autorizacion(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_pedir_autorizacion(bigint, uuid, text) TO service_role;

-- ── Reenviar con más pruebas ───────────────────────────────────────────────
-- Una autorización rechazada NO anula el ingreso (decisión del usuario): queda
-- a la espera de que la sala traiga más pruebas. La foto nueva, si la hay, se
-- guarda en el movimiento —es lo que mira quien decide—.
CREATE OR REPLACE FUNCTION public.caja_ingreso_reenviar(
    p_movimiento bigint, p_nota text, p_foto_url text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo  uuid := public.auth_employee_id();
  v_mov public.caja_movimientos_portal%ROWTYPE;
BEGIN
  SELECT * INTO v_mov FROM public.caja_movimientos_portal WHERE id = p_movimiento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese ingreso no existe.'; END IF;
  IF v_yo IS NULL OR NOT (
       v_mov.registrado_por = v_yo
       OR ((SELECT auth_has_module_permission('caja_vales', 'can_edit'))
           AND (coalesce((SELECT auth_module_scope('caja_vales')), '') = 'ALL'
                OR v_mov.branch_id = (SELECT auth_employee_branch_id())))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_mov.autorizacion IS DISTINCT FROM 'RECHAZADA' THEN
    RAISE EXCEPTION 'Sólo se reenvía un ingreso cuya autorización se rechazó.';
  END IF;
  IF nullif(btrim(coalesce(p_nota, '')), '') IS NULL AND nullif(btrim(coalesce(p_foto_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Para reenviarlo agrega una foto o explica qué cambió.';
  END IF;
  IF nullif(btrim(coalesce(p_foto_url, '')), '') IS NOT NULL THEN
    UPDATE public.caja_movimientos_portal SET foto_url = btrim(p_foto_url), updated_at = now()
     WHERE id = v_mov.id;
  END IF;
  RETURN public.caja_ingreso_pedir_autorizacion(v_mov.id, v_yo, p_nota);
END $function$;

REVOKE ALL ON FUNCTION public.caja_ingreso_reenviar(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_reenviar(bigint, text, text) TO authenticated, service_role;

-- ── Decidir ────────────────────────────────────────────────────────────────
-- Todo en la base, como `dist_resolver_descuento`: firma, impide autoaprobar,
-- deja el movimiento en su estado y avisa a quien lo anotó.
CREATE OR REPLACE FUNCTION public.caja_ingreso_resolver(
    p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_sol    public.approval_requests%ROWTYPE;
  v_mov    public.caja_movimientos_portal%ROWTYPE;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_titulo text;
  v_cuerpo text;
  v_forma  text;
BEGIN
  IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_caja') THEN
    RAISE EXCEPTION 'No tienes permiso para autorizar ingresos de caja.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.type <> 'CAJA_INGRESO_AUTORIZACION' THEN
    RAISE EXCEPTION 'No existe esa solicitud de autorización.';
  END IF;
  IF v_sol.status <> 'PENDING' THEN RAISE EXCEPTION 'Esa solicitud ya está resuelta.'; END IF;
  IF v_sol.employee_id = v_yo THEN
    RAISE EXCEPTION 'No puedes autorizar un ingreso que anotaste tú.';
  END IF;
  IF NOT p_aprobar AND v_nota IS NULL THEN
    RAISE EXCEPTION 'Para rechazarlo escribe qué prueba hace falta.';
  END IF;

  SELECT * INTO v_mov FROM public.caja_movimientos_portal
   WHERE id = (v_sol.metadata ->> 'movimiento_portal')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El ingreso de esa solicitud ya no existe.'; END IF;
  -- Anulado (o pasado a efectivo con una corrección) ya no hay nada que autorizar.
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese ingreso ya se anuló: no hay nada que autorizar.'; END IF;

  UPDATE public.approval_requests
     SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
         approver_id = v_yo, approver_note = v_nota, updated_at = now()
   WHERE id = p_solicitud;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
         autorizacion_por = v_yo, autorizacion_at = now(), autorizacion_nota = v_nota,
         updated_at = now()
   WHERE id = v_mov.id;

  v_forma := CASE v_mov.forma_pago WHEN 'TARJETA' THEN 'con tarjeta' ELSE 'por transferencia' END;
  v_titulo := CASE WHEN p_aprobar THEN 'Ingreso autorizado' ELSE 'Ingreso sin autorizar' END;
  v_cuerpo := 'El ingreso de ' || to_char(v_mov.monto, 'FM$999,990.00') || ' ' || v_forma
           || ' (' || coalesce(v_mov.concepto, 'sin concepto') || ')'
           || CASE WHEN p_aprobar THEN ' quedó autorizado.'
                   ELSE ' no se autorizó: ' || v_nota || '. Puedes reenviarlo con más pruebas.' END;
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
  VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/mi-caja',
          jsonb_build_object('request_id', p_solicitud, 'request_type', 'CAJA_INGRESO_AUTORIZACION',
                             'movimiento_portal', v_mov.id), v_yo);
  -- El push es un aviso: si falla, la decisión ya quedó escrita.
  BEGIN
    PERFORM net.http_post(
      url := public.push_function_url(), headers := public.push_function_headers(),
      body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/mi-caja',
                                 'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'caja_ingreso_resolver: push no enviado: %', SQLERRM;
  END;

  RETURN json_build_object('movimiento', v_mov.id, 'aprobado', p_aprobar);
END $function$;

REVOKE ALL ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_ingreso_resolver(uuid, boolean, text) TO authenticated, service_role;

-- ── El efectivo del cajón no cuenta lo que no es efectivo ──────────────────
-- Definición VIVA de `caja_efectivo_piezas` (post-U2) con UN cambio: la mitad
-- del portal sólo suma lo que fue EFECTIVO. Lo demás se devuelve aparte para
-- que el panel lo muestre sin mezclarlo con los billetes.
CREATE OR REPLACE FUNCTION public.caja_efectivo_piezas(p_branch_id integer, p_dia date, p_apertura numeric DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ef  numeric; v_ne  numeric;
  v_ent numeric; v_sal numeric;
  v_emb numeric; v_val numeric; v_bol numeric;
  v_ent_ne numeric;
  v_ap  numeric := round(coalesce(p_apertura, 0), 2);
BEGIN
  SELECT round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') =  'efectivo'), 0), 2),
         round(coalesce(sum(si.total) FILTER (WHERE coalesce(si.tipo_pago,'') <> 'efectivo'), 0), 2)
    INTO v_ef, v_ne
    FROM public.sales_invoices si
   WHERE si.branch_id = p_branch_id AND si.fecha = p_dia
     AND public.venta_valida(si.estado);

  -- El espejo del origen MÁS lo que el portal escribió y el espejo todavía no
  -- vio. Sin la segunda mitad, un ingreso anotado hace treinta segundos no
  -- está; sin comparar por `erp_movimiento_id`, estaría dos veces.
  -- Y de la mitad del portal, sólo el EFECTIVO: un ingreso con tarjeta o
  -- transferencia nunca va a la caja ni al cajón (2026-10-17).
  WITH mov AS (
      SELECT m.tipo, m.monto
        FROM public.cortes_caja_movimientos m
       WHERE m.branch_id = p_branch_id AND m.fecha = p_dia
         AND m.desaparecido_at IS NULL
      UNION ALL
      SELECT p.tipo, p.monto
        FROM public.caja_movimientos_portal p
       WHERE p.branch_id = p_branch_id AND p.fecha = p_dia
         AND p.anulado_at IS NULL
         AND p.forma_pago = 'EFECTIVO'
         AND (p.erp_movimiento_id IS NULL
              OR NOT EXISTS (SELECT 1 FROM public.cortes_caja_movimientos m2
                              WHERE m2.branch_id = p.branch_id
                                AND m2.erp_movimiento_id = p.erp_movimiento_id))
  )
  SELECT round(coalesce(sum(monto) FILTER (WHERE tipo = 'ENTRADA'), 0), 2),
         round(coalesce(sum(monto) FILTER (WHERE tipo = 'SALIDA'),  0), 2)
    INTO v_ent, v_sal
    FROM mov;

  SELECT round(coalesce(sum(p.monto), 0), 2) INTO v_ent_ne
    FROM public.caja_movimientos_portal p
   WHERE p.branch_id = p_branch_id AND p.fecha = p_dia
     AND p.anulado_at IS NULL AND p.forma_pago <> 'EFECTIVO';

  SELECT round(coalesce(sum(b.monto_inicial), 0), 2) INTO v_emb
    FROM public.bolsas b
   WHERE b.branch_id = p_branch_id AND b.fecha = p_dia AND b.estado <> 'ANULADA';

  SELECT round(coalesce(sum(v.monto), 0), 2) INTO v_val
    FROM public.caja_vales_portal v
   WHERE v.branch_id = p_branch_id AND v.fecha = p_dia
     AND v.estado IN ('ANOTADO', 'CERRADO');

  -- Lo que queda DENTRO de las bolsas de hoy. Con piso en cero por el hueco de
  -- unos segundos entre que el vale se escribe en el origen y su fila existe
  -- acá: sin él, ese instante inventaría dinero en el cajón.
  v_bol := greatest(0, round(v_emb - v_val, 2));

  RETURN json_build_object(
      'apertura',           v_ap,
      'ventas_efectivo',    v_ef,
      'ventas_no_efectivo', v_ne,
      'entradas',           v_ent,
      -- Ingresos con tarjeta o transferencia: se informan, no están en el cajón.
      'entradas_no_efectivo', v_ent_ne,
      'vales',              v_sal,
      'en_bolsas',          v_bol,
      -- Las dos piezas de las que sale `en_bolsas`, para poder auditar la
      -- resta sin volver a correrla.
      'embolsado_hoy',      v_emb,
      'vales_ya_anotados',  v_val,
      'efectivo', greatest(0, round(v_ap + v_ef + v_ent - v_sal - v_bol, 2))
  );
END;
$function$;

-- ── El cuadre de los vouchers ──────────────────────────────────────────────
--
-- Un voucher puede cubrir una venta Y un ingreso: $16 = $15 de una venta con
-- tarjeta + $1 de una inyección (ejemplo del usuario). El ingreso anota su
-- parte y el total del voucher; el RESTO tiene que ser una venta con tarjeta
-- de esa sala, ese día, por ese monto. Se busca la más cercana en hora, y una
-- venta se usa una sola vez (dos vouchers con el mismo resto no se adjudican
-- la misma venta).
--
-- Agrupa por número de voucher: dos ingresos sobre el mismo voucher (una
-- inyección y una glucosa) se suman.
CREATE OR REPLACE FUNCTION public.caja_vouchers_del_dia(p_branch_id integer, p_dia date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_out   json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  WITH v AS (
    SELECT coalesce(nullif(ltrim(regexp_replace(coalesce(p.numero_boleta, ''), '\D', '', 'g'), '0'), ''),
                    'mov-' || p.id) AS voucher,
           p.id, p.monto, p.comprobante_total, p.concepto, p.registrado_at, p.autorizacion
      FROM public.caja_movimientos_portal p
     WHERE p.branch_id = p_branch_id AND p.fecha = p_dia
       AND p.anulado_at IS NULL AND p.forma_pago = 'TARJETA' AND p.tipo = 'ENTRADA'
  ), g AS (
    SELECT voucher,
           round(sum(monto), 2) AS ingresos,
           max(comprobante_total) AS total,
           min(registrado_at) AS hora,
           json_agg(json_build_object('id', id, 'monto', monto, 'concepto', concepto,
                                      'autorizacion', autorizacion) ORDER BY id) AS movimientos
      FROM v GROUP BY voucher
  ), r AS (
    SELECT g.*, round(coalesce(g.total, g.ingresos) - g.ingresos, 2) AS resto FROM g
  ), cand AS (
    SELECT r.voucher, si.id AS invoice_id, si.correlativo, si.total, si.hora,
           row_number() OVER (PARTITION BY r.voucher
                              ORDER BY abs(extract(epoch FROM (si.fecha + si.hora)
                                         - (r.hora AT TIME ZONE 'America/El_Salvador')))) AS orden
      FROM r
      JOIN public.sales_invoices si
        ON si.branch_id = p_branch_id AND si.fecha = p_dia
       AND si.tipo_pago = 'tarjeta' AND public.venta_valida(si.estado)
       AND abs(si.total - r.resto) < 0.01
     WHERE r.resto > 0.004
  ), elegida AS (
    -- Una venta, un voucher: la venta va al voucher más cercano en hora.
    SELECT DISTINCT ON (invoice_id) voucher, invoice_id, correlativo, total, hora
      FROM cand ORDER BY invoice_id, orden
  )
  SELECT coalesce(json_agg(json_build_object(
           'voucher', r.voucher, 'total', r.total, 'ingresos', r.ingresos, 'resto', r.resto,
           'movimientos', r.movimientos,
           'venta', CASE WHEN e.invoice_id IS NULL THEN NULL
                         ELSE json_build_object('id', e.invoice_id, 'correlativo', e.correlativo,
                                                'total', e.total, 'hora', e.hora) END,
           'estado', CASE WHEN r.total IS NULL THEN 'SIN_TOTAL'
                          WHEN r.resto < -0.004 THEN 'EXCEDE'
                          WHEN r.resto <= 0.004 THEN 'CUADRA'
                          WHEN e.invoice_id IS NOT NULL THEN 'CUADRA'
                          ELSE 'SIN_VENTA' END)
         ORDER BY r.hora), '[]'::json)
    INTO v_out
    FROM r
    LEFT JOIN LATERAL (SELECT * FROM elegida e WHERE e.voucher = r.voucher LIMIT 1) e ON true;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.caja_vouchers_del_dia(integer, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caja_vouchers_del_dia(integer, date) TO authenticated, service_role;

-- ── Las correcciones dicen también si cambió la forma de pago ──────────────
-- Definición VIVA con dos columnas más: `forma_antes` y `forma_despues`, para
-- que el movimiento muestre «se pasó de efectivo a tarjeta» y no un cambio de
-- monto que no existió.
CREATE OR REPLACE FUNCTION public.get_correcciones_de_caja(p_movimientos bigint[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_salida json;
    v_alcance text;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('cortes_caja', 'can_view')) THEN
        RETURN NULL;
    END IF;
    v_alcance := (SELECT public.auth_module_scope('cortes_caja'));

    SELECT coalesce(json_agg(to_json(t) ORDER BY t.pedida_at DESC), '[]'::json)
      INTO v_salida
      FROM (
        SELECT
            m.id                                              AS movimiento,
            s.id                                              AS solicitud,
            s.status                                          AS estado,
            s.metadata ->> 'que'                              AS que,
            nullif(s.metadata ->> 'monto_actual', '')::numeric AS monto_antes,
            nullif(s.metadata ->> 'monto_nuevo',  '')::numeric AS monto_despues,
            s.metadata ->> 'forma_actual'                     AS forma_antes,
            s.metadata ->> 'forma_nueva'                      AS forma_despues,
            s.note                                            AS motivo,
            s.approver_note                                   AS nota_de_quien_decidio,
            s.created_at                                      AS pedida_at,
            -- La firma sólo cuando YA se decidió: mientras está pendiente,
            -- `approver_id` puede ser el primer destinatario del aviso y no
            -- quien decide. Nombrarlo ahí sería atribuir una decisión que
            -- todavía no existe.
            CASE WHEN s.status <> 'PENDING' THEN s.updated_at END AS decidida_at,
            json_build_object('id', pide.id, 'name', pide.name,
                              'photo_url', pide.photo_url)    AS pidio,
            CASE WHEN s.status <> 'PENDING' AND dec.id IS NOT NULL
                 THEN json_build_object('id', dec.id, 'name', dec.name,
                                        'photo_url', dec.photo_url) END AS decidio
        FROM public.approval_requests s
        JOIN public.caja_movimientos_portal m
          ON m.id = nullif(s.metadata ->> 'movimiento_portal', '')::bigint
        LEFT JOIN public.employees pide ON pide.id = s.employee_id
        LEFT JOIN public.employees dec  ON dec.id  = s.approver_id
       WHERE s.type = 'CAJA_MOVIMIENTO_CHANGE'
         -- Por TEXTO para que entre por el índice parcial de arriba; el join de
         -- abajo ya lo vuelve al número del movimiento.
         AND s.metadata ->> 'movimiento_portal' = ANY (
                SELECT x::text FROM unnest(p_movimientos) AS x)
         AND (v_alcance = 'ALL'
              OR m.branch_id = (SELECT public.auth_employee_branch_id()))
      ) t;

    RETURN v_salida;
END;
$function$;
