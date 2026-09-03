-- Las acciones sobre las bitácoras llegan a la bitácora de auditoría.
--
-- Medido el 2026-09-03: sobre 619 lecturas, 3 correcciones, 701 limpiezas y 1
-- cierre, `audit_logs` tenía **cero** filas de bitácoras. Lo único que había era
-- `PERMISOS_CAMBIO` (216) y `CONFIGURAR_AREA_BITACORA` (2).
--
-- La atribución existía —cada fila lleva su autor y su hora— pero no existía la
-- pista INDEPENDIENTE que pide el 21 CFR Part 11 §11.10(e): «pista de auditoría
-- segura, generada por el sistema y con sello de tiempo, que registre las
-- acciones que **crean, modifican o borran** registros electrónicos». Y el
-- Anexo 11 §9 de las BPM de la UE pide lo mismo para cambios y borrados.
--
-- El borrador del `[FLS-PRO-02]` punto 4 afirmaba que esto ya pasaba.
--
-- ── Por qué un trigger y no siete RPC ──────────────────────────────────────
-- Escribirlo dentro de cada función obliga a tocar `registrar_lectura`,
-- `corregir_lectura`, `registrar_limpieza`, `registrar_ronda`,
-- `corregir_limpieza`, `anular_limpieza`, `cerrar_mes` y `reabrir_mes`. Ocho
-- cuerpos, y la que se olvide no da error: da una acción que no queda anotada,
-- que es el defecto que se está corrigiendo. El trigger ve la escritura venga
-- de donde venga — incluida la de una sesión que escriba la tabla directamente.
--
-- SECURITY DEFINER a propósito: un trigger de auditoría INVOKER hace fallar la
-- escritura que audita (ya pasó en este repo con la ficha del empleado).
--
-- `bitacora_dispensaciones` queda FUERA: la escribe un cron cada minuto, y
-- anotar cada upsert llenaría `audit_logs` de ruido hasta enterrar justo lo que
-- se quiere poder encontrar. Esa tabla ya lleva `anulada_por`/`anulada_at`/
-- `motivo_anulacion` en la propia fila.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bitacora_auditar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_fila      record;
    v_branch    bigint;
    v_branch_nm text;
    v_actor     uuid;
    v_nombre    text;
    v_accion    text;
    v_detalles  jsonb;
BEGIN
    v_fila := coalesce(NEW, OLD);

    -- La sala sale del área cuando la fila no la trae (lecturas y limpiezas
    -- guardan `area_id`; cierres e historial ya traen la suya).
    BEGIN
        v_branch := (to_jsonb(v_fila) ->> 'branch_id')::bigint;
    EXCEPTION WHEN others THEN v_branch := NULL;
    END;
    IF v_branch IS NULL AND (to_jsonb(v_fila) ? 'area_id') THEN
        SELECT a.branch_id INTO v_branch
          FROM public.bitacora_areas a
         WHERE a.id = (to_jsonb(v_fila) ->> 'area_id')::bigint;
    END IF;
    SELECT b.name INTO v_branch_nm FROM public.branches b WHERE b.id = v_branch;

    v_actor := public.auth_employee_id();
    SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_actor;

    v_accion := 'BITACORA_'
             || upper(replace(TG_TABLE_NAME, 'bitacora_', ''))
             || CASE TG_OP WHEN 'INSERT' THEN '_ALTA'
                           WHEN 'UPDATE' THEN '_CAMBIO'
                           ELSE '_BAJA' END;

    -- Se guarda la fila entera: son tablas chicas y lo que importa en una
    -- inspección es poder reconstruir qué decía el registro, no un resumen.
    v_detalles := jsonb_build_object('fila', to_jsonb(v_fila));
    IF TG_OP = 'UPDATE' THEN
        v_detalles := v_detalles || jsonb_build_object('antes', to_jsonb(OLD));
    END IF;

    INSERT INTO public.audit_logs
        (user_id, user_name, action, target_id, details, source, severity,
         branch_id, branch_name)
    VALUES (
        v_actor,
        coalesce(v_nombre, 'Sistema'),
        v_accion,
        (to_jsonb(v_fila) ->> 'id'),
        v_detalles,
        -- `source` tiene CHECK: sólo ADMIN_PANEL, KIOSK o SYSTEM. Un valor nuevo
        -- lo habría rechazado la tabla y el trigger no habría escrito NI UNA
        -- fila — sin error visible, porque nadie mira el log de Postgres. Las
        -- bitácoras se anotan desde el portal, así que ADMIN_PANEL es el
        -- verdadero; quien las busca filtra por el prefijo `BITACORA_`.
        'ADMIN_PANEL',
        -- Un borrado es lo que hay que poder encontrar rápido.
        CASE WHEN TG_OP = 'DELETE' THEN 'WARNING' ELSE 'INFO' END,
        v_branch, v_branch_nm);

    RETURN NULL;   -- AFTER trigger: el valor devuelto no se usa.
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bitacora_auditar() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS bitacora_lecturas_auditar        ON public.bitacora_lecturas;
DROP TRIGGER IF EXISTS bitacora_limpiezas_auditar       ON public.bitacora_limpiezas;
DROP TRIGGER IF EXISTS bitacora_correcciones_auditar    ON public.bitacora_correcciones;
DROP TRIGGER IF EXISTS bitacora_cierres_auditar         ON public.bitacora_cierres;
DROP TRIGGER IF EXISTS bitacora_limp_historial_auditar  ON public.bitacora_limpiezas_historial;

CREATE TRIGGER bitacora_lecturas_auditar
    AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_lecturas
    FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

CREATE TRIGGER bitacora_limpiezas_auditar
    AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_limpiezas
    FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

CREATE TRIGGER bitacora_correcciones_auditar
    AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_correcciones
    FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

CREATE TRIGGER bitacora_cierres_auditar
    AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_cierres
    FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

CREATE TRIGGER bitacora_limp_historial_auditar
    AFTER INSERT OR UPDATE OR DELETE ON public.bitacora_limpiezas_historial
    FOR EACH ROW EXECUTE FUNCTION public.bitacora_auditar();

COMMENT ON FUNCTION public.bitacora_auditar() IS
  'Pista de auditoría independiente de las bitácoras (21 CFR Part 11 11.10(e), Anexo 11 §9). Escribe en audit_logs con action BITACORA_*. No cubre bitacora_dispensaciones: la escribe un cron cada minuto.';
