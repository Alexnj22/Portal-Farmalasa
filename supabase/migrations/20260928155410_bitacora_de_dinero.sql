-- La base anota sola lo que pasa con el dinero y lo fiscal.
--
-- Decisión del usuario (2026-09-28, D3 del plan del núcleo portable): la
-- bitácora la escribía cada pantalla en un paso aparte (`appendAuditLog`), y una
-- app del teléfono que se olvidara de ese paso dejaba una acción sin rastro y
-- sin error. La decisión fue una mezcla: las funciones de `src/data` anotan lo
-- legible («Carlos confirmó el pago»), y en dinero y lo fiscal la BASE anota
-- además, por su cuenta, para que ningún camino —otra app, un script, una edge
-- function— pueda saltarse el rastro.
--
-- ── Qué tablas, y por qué éstas ────────────────────────────────────────────
-- Cortes y bolsas NO están: sus funciones ya escriben su propio historial
-- (`cortes_caja_eventos`, `bolsas_eventos`) dentro de la misma transacción.
-- Quedan fuera también las que escribe un cron cada minuto o cada 30 s
-- (`sales_invoices`, `cortes_caja_movimientos`, el espejo de créditos): anotar
-- cada fila ahí sería llenar la bitácora de lo que nadie decidió.
--
-- Entran las que nacen de una DECISIÓN de alguien y hasta hoy no dejaban rastro
-- en la base:
--
--   facturación   sales_payment_confirmations y las cuatro *_resolutions
--                 (el autor lo mandaba el navegador como TEXTO; acá sale de la
--                 sesión, que es lo único que no se puede escribir a mano)
--   caja          caja_aperturas_del_portal, caja_movimientos_portal,
--                 caja_cortes_del_portal, caja_vales_portal
--   créditos      creditos_abonos_portal, creditos_pagos
--   proveedores   compra_pagos
--   planilla      payroll_periods
--
-- ── Quién ──────────────────────────────────────────────────────────────────
-- Varias las escriben edge functions con la llave de servicio: ahí no hay
-- sesión, y el autor sale de la propia fila (`registrado_por`, `abonado_por`…,
-- pasadas como argumentos del disparador: la primera firma al crear, las demás
-- firman lo que se decide después —quien aprobó, quien anuló—). Si ninguna,
-- quien tenga la sesión. Todo pasa por `ficha_de_persona`: una persona tiene
-- dos ids y estas columnas los mezclan.
--
-- ── Qué se guarda ──────────────────────────────────────────────────────────
-- Al crear, la fila; al cambiar, SÓLO lo que cambió (antes → después); al
-- borrar, la fila que había. Sin las columnas voluminosas (`lectura`,
-- `foto_lectura`, `metadata`) ni las de mecánica (`updated_at`, `intentos`,
-- `ultimo_error`): un reintento del trabajador de vales no es una decisión.
-- Anular o borrar va como WARNING; lo demás, INFO. `source = SYSTEM`.
--
-- ── Si la anotación falla, el dinero NO se traba ───────────────────────────
-- El bloque tiene su EXCEPTION: la operación de caja se guarda igual y el fallo
-- queda como WARNING en el log de Postgres. Trabar un cobro con el cliente
-- enfrente porque no se pudo escribir una línea de bitácora es peor que el
-- hueco — y el hueco se ve, porque el registro de la fila sigue en su tabla.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bitacora_de_dinero()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  SIN_RASTRO constant text[] := ARRAY['lectura', 'foto_lectura', 'metadata',
                                      'updated_at', 'intentos', 'ultimo_error'];
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_fila    jsonb := coalesce(v_new, v_old);
  v_cambios jsonb := '{}'::jsonb;
  v_autor   uuid;
  v_col     text;
  v_accion  text;
  v_sev     text := 'INFO';
  v_branch  bigint;
  v_nombre  text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('antes', v_old -> k, 'despues', v_new -> k)), '{}'::jsonb)
        INTO v_cambios
        FROM jsonb_object_keys(v_new) k
       WHERE NOT (k = ANY (SIN_RASTRO))
         AND (v_new -> k) IS DISTINCT FROM (v_old -> k);
      IF v_cambios = '{}'::jsonb THEN
        RETURN NULL;   -- sólo cambió mecánica: no es una decisión
      END IF;
    END IF;

    -- El autor. Convención de los argumentos: el PRIMERO es quien crea la fila;
    -- los siguientes, quienes deciden después (anula, aprueba, recibe). Al crear
    -- o borrar firma el primero; al cambiar, el primero de los siguientes que
    -- pasó a tener un valor. Si no hay, quien tenga la sesión.
    IF TG_NARGS > 0 THEN
      IF TG_OP = 'UPDATE' THEN
        FOR i IN 1 .. TG_NARGS - 1 LOOP
          v_col := TG_ARGV[i];
          IF (v_new ->> v_col) IS NOT NULL AND (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
            v_autor := public.ficha_de_persona((v_new ->> v_col)::uuid);
            EXIT;
          END IF;
        END LOOP;
      ELSIF (v_fila ->> TG_ARGV[0]) IS NOT NULL THEN
        v_autor := public.ficha_de_persona((v_fila ->> TG_ARGV[0])::uuid);
      END IF;
    END IF;
    v_autor := coalesce(v_autor, public.auth_employee_id());

    v_accion := 'BASE_' || upper(TG_TABLE_NAME) || '_' ||
      CASE TG_OP
        WHEN 'INSERT' THEN 'CREADO'
        WHEN 'DELETE' THEN 'BORRADO'
        ELSE CASE WHEN v_cambios ? 'anulado_at' AND (v_new ->> 'anulado_at') IS NOT NULL
                  THEN 'ANULADO' ELSE 'CAMBIADO' END
      END;
    IF v_accion LIKE '%\_ANULADO' OR TG_OP = 'DELETE' THEN
      v_sev := 'WARNING';
    END IF;

    v_branch := nullif(v_fila ->> 'branch_id', '')::bigint;
    IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = v_branch) THEN
      v_branch := NULL;
    END IF;
    SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_autor;

    INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details, source, severity, branch_id)
    VALUES (v_autor, coalesce(v_nombre, 'Sistema'), v_accion, v_fila ->> 'id',
            jsonb_build_object('tabla', TG_TABLE_NAME, 'operacion', TG_OP) ||
              CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('cambios', v_cambios)
                   ELSE jsonb_build_object('fila', v_fila - SIN_RASTRO) END,
            'SYSTEM', v_sev, v_branch);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'bitacora_de_dinero: no se pudo anotar % en % (%): %',
      TG_OP, TG_TABLE_NAME, v_fila ->> 'id', SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bitacora_de_dinero() FROM PUBLIC, anon, authenticated;

-- Facturación: el autor sale de la sesión (no hay columna de autor confiable).
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.sales_payment_confirmations;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.sales_payment_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero();
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.sales_invoice_resolutions;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.sales_invoice_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero();
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.sales_null_resolutions;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.sales_null_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero();
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.sales_gap_resolutions;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.sales_gap_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero();
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.sales_observation_resolutions;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.sales_observation_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero();

-- Caja del portal.
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.caja_aperturas_del_portal;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.caja_aperturas_del_portal
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('abierta_por');
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.caja_movimientos_portal;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.caja_movimientos_portal
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('registrado_por', 'anulado_por', 'recibido_por');
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.caja_cortes_del_portal;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.caja_cortes_del_portal
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('hecho_por');
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.caja_vales_portal;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.caja_vales_portal
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('anotado_por');

-- Créditos.
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.creditos_abonos_portal;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.creditos_abonos_portal
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('abonado_por', 'anulado_por');
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.creditos_pagos;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.creditos_pagos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('registrado_por');

-- Proveedores.
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.compra_pagos;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.compra_pagos
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('registrado_por', 'anulado_por', 'aprobado_por');

-- Planilla.
DROP TRIGGER IF EXISTS trg_bitacora_de_dinero ON public.payroll_periods;
CREATE TRIGGER trg_bitacora_de_dinero AFTER INSERT OR UPDATE OR DELETE ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.bitacora_de_dinero('created_by', 'paid_by', 'approved_by');
