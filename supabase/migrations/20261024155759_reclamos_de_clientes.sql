-- ═══════════════════════════════════════════════════════════════════════════
-- 60 · Registro de reclamos de clientes en sala (Reglamento de Puntos Salud v2
--      §12, Reglamento de Reservas §10, Condiciones del Cliente Mayorista §7)
--
-- Los tres documentos dicen lo mismo: «Todo reclamo se presenta en cualquier
-- sala de ventas, donde queda registrado. La Empresa responde en un máximo de
-- diez (10) días hábiles». No existía dónde registrarlo (lo de facturas de
-- compra y el reclamo de sanciones son otra cosa).
--
-- DEPENDE DE: 10 (`sumar_dias_habiles`).
--
-- DESDE CUÁNDO RIGE: el registro está disponible desde que se aplique; los
--   reglamentos que lo exigen rigen el 15-nov-2026. No cambia nada existente.
--
-- QUÉ CAMBIA:
--   · tabla `reclamos_clientes` (programa, cliente, tema, sala, quién recibe,
--     cuándo, vence = +10 días hábiles, respuesta, cuándo, quién, por qué vía);
--   · módulo `reclamos_clientes` en `role_permissions`: quien aprueba
--     mayoristas (cargos de toda la red) responde, con alcance ALL; quien
--     edita mayoristas o reservas en sala registra y ve los de SU sala (BRANCH);
--   · `reclamo_registrar(...)` compara la sala contra la de quien llama
--     (gate:alcance «alcance»); `reclamo_responder(...)` exige can_approve;
--   · aviso a quien responde al registrarse, y cron diario
--     `avisar-reclamos-clientes` (08:15 SV) un día hábil antes y al vencer.
--
-- AL APLICAR EN PRODUCCIÓN, en el mismo commit: declarar en
--   `scripts/alcance-manifest.json` → "rpc" la entrada
--     "reclamo_registrar": { "guarda": "alcance", "motivo": "Quien no tiene alcance
--       ALL de `reclamos_clientes` sólo registra en su propia sala." }
--   (antes de aplicarla, `gate:alcance` la rechaza por «ya no existe»), y
--   correr `npm run tipos:base` para que `gate:tipos` vea la tabla y las RPC.
--   Y declarar el cron en `scripts/eficiencia-gate.mjs` (CRONS):
--     { job: 'avisar-reclamos-clientes', slug: null, cadencia: '15 14 * * *',
--       corridasDia: 1, sistema: 0, motivo: 'Los diez días hábiles de un reclamo de
--       cliente: avisa un día hábil antes y al vencer. SQL puro.' },
--
-- POLICIES: sólo SELECT (can_view + su sala o alcance ALL); las escrituras
--   van por las dos funciones. Sin DELETE: un reclamo registrado no se borra.
--
-- VERIFICADO en staging: registrar en otra sala con alcance BRANCH → FORBIDDEN;
--   vence = +10 hábiles; responder sin can_approve → FORBIDDEN; vigilante con
--   uno a punto de vencer y uno vencido → dos avisos, una sola vez.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.reclamos_clientes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  programa         text NOT NULL CHECK (programa IN ('puntos', 'reservas', 'mayorista')),
  customer_id      bigint REFERENCES public.customers(id),
  cliente_nombre   text NOT NULL CHECK (btrim(cliente_nombre) <> ''),
  cliente_telefono text,
  tema             text NOT NULL CHECK (btrim(tema) <> ''),
  branch_id        bigint NOT NULL REFERENCES public.branches(id),
  recibido_por     uuid NOT NULL REFERENCES public.employees(id),
  recibido_at      timestamptz NOT NULL DEFAULT now(),
  vence            date NOT NULL,
  respuesta        text,
  respuesta_via    text CHECK (respuesta_via IN ('SALA', 'TELEFONO', 'CORREO', 'APP')),
  respondido_at    timestamptz,
  respondido_por   uuid REFERENCES public.employees(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((respondido_at IS NULL) = (respuesta IS NULL))
);
CREATE INDEX IF NOT EXISTS reclamos_clientes_customer_idx ON public.reclamos_clientes (customer_id);
CREATE INDEX IF NOT EXISTS reclamos_clientes_branch_idx ON public.reclamos_clientes (branch_id);
CREATE INDEX IF NOT EXISTS reclamos_clientes_recibido_por_idx ON public.reclamos_clientes (recibido_por);
CREATE INDEX IF NOT EXISTS reclamos_clientes_abiertos_idx ON public.reclamos_clientes (vence) WHERE respondido_at IS NULL;
COMMENT ON TABLE public.reclamos_clientes IS
  'Reclamos de clientes en sala sobre el programa de puntos, las reservas o la condición de mayorista. Respuesta en 10 días hábiles (los tres reglamentos). Sólo se escribe por reclamo_registrar/reclamo_responder.';

ALTER TABLE public.reclamos_clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reclamos_clientes_select ON public.reclamos_clientes;
CREATE POLICY reclamos_clientes_select ON public.reclamos_clientes FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('reclamos_clientes', 'can_view'))
         AND ((SELECT public.auth_module_scope('reclamos_clientes')) = 'ALL'
              OR branch_id = (SELECT public.auth_employee_branch_id())));
REVOKE ALL ON public.reclamos_clientes FROM anon;
GRANT SELECT ON public.reclamos_clientes TO authenticated;

-- ── Permisos: derivados de `mayoristas` y `reservas` ───────────────────────
-- Registra quien ya atiende esos programas en sala (edita mayoristas o
-- reservas: Jefe/a y Subjefe/a de Sala, Regente, Dependiente, Canales
-- Digitales); responde quien APRUEBA mayoristas (cargos de toda la red).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'reclamos_clientes', true, true,
       bool_or(rp.module_key = 'mayoristas' AND rp.can_approve),
       CASE WHEN bool_or(rp.module_key = 'mayoristas' AND rp.can_approve) THEN 'ALL' ELSE 'BRANCH' END
  FROM public.role_permissions rp
 WHERE rp.module_key IN ('mayoristas', 'reservas') AND rp.can_edit
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = rp.role_id AND x.module_key = 'reclamos_clientes')
 GROUP BY rp.role_id;

-- ── Quién responde ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reclamos_destinatarios()
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT e.id) FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND EXISTS (SELECT 1 FROM public.role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'reclamos_clientes' AND rp.can_approve);
$function$;
REVOKE EXECUTE ON FUNCTION public.reclamos_destinatarios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclamos_destinatarios() TO service_role;

CREATE OR REPLACE FUNCTION public.reclamo_registrar(p_programa text, p_branch_id bigint, p_tema text,
                                                    p_customer_id bigint DEFAULT NULL, p_nombre text DEFAULT NULL,
                                                    p_telefono text DEFAULT NULL)
 RETURNS public.reclamos_clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_r public.reclamos_clientes;
  v_dest uuid[];
  v_sala text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('reclamos_clientes', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Se registra en la sala donde se presenta; quien es de una sala sólo en la suya.
  IF public.auth_module_scope('reclamos_clientes') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id) THEN
    RAISE EXCEPTION 'Elige la sala donde se presenta el reclamo';
  END IF;
  IF coalesce(p_programa, '') NOT IN ('puntos', 'reservas', 'mayorista') THEN RAISE EXCEPTION 'Elige sobre qué es el reclamo'; END IF;
  IF nullif(btrim(coalesce(p_tema, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribe de qué se trata el reclamo'; END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT coalesce(v_nombre, c.name), coalesce(v_tel, nullif(btrim(c.phone), '')) INTO v_nombre, v_tel
      FROM public.customers c WHERE c.id = p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese cliente no existe'; END IF;
  END IF;
  IF v_nombre IS NULL THEN RAISE EXCEPTION 'Escribe el nombre de quien reclama'; END IF;

  INSERT INTO public.reclamos_clientes (programa, customer_id, cliente_nombre, cliente_telefono, tema, branch_id, recibido_por, vence)
  VALUES (p_programa, p_customer_id, v_nombre, v_tel, btrim(p_tema), p_branch_id, v_emp, public.sumar_dias_habiles(v_hoy, 10))
  RETURNING * INTO v_r;

  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details, branch_id)
  VALUES ('REGISTRAR_RECLAMO_CLIENTE', v_r.id::text, v_emp, (SELECT name FROM public.employees WHERE id = v_emp),
          'ADMIN_PANEL', 'INFO', jsonb_build_object('folio', v_r.folio, 'programa', v_r.programa, 'vence', v_r.vence), p_branch_id);

  v_dest := public.reclamos_destinatarios();
  SELECT name INTO v_sala FROM public.branches WHERE id = p_branch_id;
  IF v_dest IS NOT NULL THEN
    PERFORM public.notify_employees(v_dest, 'RECLAMO_CLIENTE', 'Reclamo de un cliente en ' || coalesce(v_sala, 'sala'),
      v_nombre || ': ' || left(btrim(p_tema), 140) || ' · Hay que responder a más tardar el ' || to_char(v_r.vence, 'DD/MM/YYYY') || '.',
      '/reclamos-clientes', jsonb_build_object('reclamo_id', v_r.id, 'check_key', 'reclamo:' || v_r.id || ':nuevo'), true, NULL);
  END IF;
  RETURN v_r;
END $function$;
REVOKE EXECUTE ON FUNCTION public.reclamo_registrar(text, bigint, text, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamo_registrar(text, bigint, text, bigint, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reclamo_responder(p_id uuid, p_respuesta text, p_via text)
 RETURNS public.reclamos_clientes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_emp uuid := public.auth_employee_id(); v_r public.reclamos_clientes;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('reclamos_clientes', 'can_approve')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_respuesta, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribe la respuesta'; END IF;
  IF coalesce(p_via, '') NOT IN ('SALA', 'TELEFONO', 'CORREO', 'APP') THEN RAISE EXCEPTION 'Elige por dónde se le respondió'; END IF;
  UPDATE public.reclamos_clientes SET respuesta = btrim(p_respuesta), respuesta_via = p_via, respondido_at = now(),
         respondido_por = v_emp, updated_at = now()
   WHERE id = p_id AND respondido_at IS NULL
  RETURNING * INTO v_r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese reclamo no existe o ya tiene respuesta'; END IF;
  INSERT INTO public.audit_logs (action, target_id, user_id, user_name, source, severity, details, branch_id)
  VALUES ('RESPONDER_RECLAMO_CLIENTE', v_r.id::text, v_emp, (SELECT name FROM public.employees WHERE id = v_emp),
          'ADMIN_PANEL', 'INFO', jsonb_build_object('folio', v_r.folio, 'via', p_via,
            'a_tiempo', (v_r.respondido_at AT TIME ZONE 'America/El_Salvador')::date <= v_r.vence), v_r.branch_id);
  RETURN v_r;
END $function$;
REVOKE EXECUTE ON FUNCTION public.reclamo_responder(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclamo_responder(uuid, text, text) TO authenticated, service_role;

-- ── El vigilante diario de los diez días hábiles ───────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_reclamos_por_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_dest uuid[] := public.reclamos_destinatarios();
  v_f record; v_ins integer; v_clave text; v_n integer := 0;
BEGIN
  FOR v_f IN
    SELECT r.id, r.folio, r.cliente_nombre, r.tema, r.vence, b.name AS sala,
           CASE WHEN r.vence < v_hoy THEN 'vencido' ELSE 'apremia' END AS etapa
      FROM public.reclamos_clientes r LEFT JOIN public.branches b ON b.id = r.branch_id
     WHERE r.respondido_at IS NULL AND r.vence <= public.sumar_dias_habiles(v_hoy, 1)
  LOOP
    v_clave := 'reclamo:' || v_f.id || ':' || v_f.etapa;
    INSERT INTO public.avisos_emitidos (clave, recipient_id) VALUES (v_clave, NULL) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    CONTINUE WHEN v_ins = 0 OR v_dest IS NULL;
    v_n := v_n + public.notify_employees(v_dest, 'RECLAMO_CLIENTE',
      CASE WHEN v_f.etapa = 'vencido' THEN 'Se pasó el plazo de un reclamo sin responder'
           ELSE 'Un reclamo vence el ' || to_char(v_f.vence, 'DD/MM/YYYY') END,
      'Reclamo ' || v_f.folio || ' de ' || v_f.cliente_nombre || ' en ' || coalesce(v_f.sala, 'sala') || ': '
        || left(v_f.tema, 120) || '. Los reglamentos dan diez días hábiles para responder.',
      '/reclamos-clientes', jsonb_build_object('reclamo_id', v_f.id, 'check_key', v_clave), true, NULL);
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.avisar_reclamos_por_vencer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_reclamos_por_vencer() TO service_role;

SELECT cron.schedule('avisar-reclamos-clientes', '15 14 * * *', 'SELECT public.avisar_reclamos_por_vencer()')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-reclamos-clientes');
