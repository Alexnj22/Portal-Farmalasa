-- 20260729_kiosk_boot_payload_drop_pin
--
-- Fase 2 del rediseño de credenciales del kiosco (AUDITORIA-SUPABASE-2026-07-29.md,
-- S1-ter): get_kiosk_boot_payload deja de repartir los PIN.
--
-- La función devolvía, dentro del array `employees`:
--
--     'kiosk_pin', e.kiosk_pin,
--
-- a un rol `anon` que solo necesita presentar device_id + device_token. Es decir
-- que cada tablet de kiosco recibía los PIN en claro de todos los empleados de
-- su sucursal, los tenía en memoria mientras la app corría, y systemSlice.js
-- guardaba además los de los supervisores en `localStorage` bajo la clave
-- `kiosk_supervisor_pins` para que la autorización siguiera funcionando tras un
-- reload. Una tablet perdida o un navegador inspeccionado entregaba las
-- credenciales de marcaje de toda la sucursal.
--
-- Ya no hace falta: la verificación es server-side (verify_kiosk_pin /
-- verify_kiosk_authorization) y el caso offline lo cubre la ventana de gracia de
-- src/utils/kioskGrace.js, que solo persiste ids y fechas.
--
-- Se aplica como transformación sobre la definición viva en lugar de reescribir
-- los ~4,100 caracteres de la función a mano: el único cambio buscado es quitar
-- esa línea, y transcribir el resto solo agrega riesgo de introducir una
-- diferencia silenciosa. El bloque falla ruidosamente si el patrón no aparece o
-- si queda alguna referencia, así que no puede dejar la función a medias.
--
-- Verificado tras aplicar: 0 referencias a kiosk_pin, la función pasó de 4,169 a
-- 4,127 caracteres.

SET lock_timeout = '5s';

DO $mig$
DECLARE v_def text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_kiosk_boot_payload';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'get_kiosk_boot_payload no existe';
    END IF;

    v_def := regexp_replace(v_def, '\s*''kiosk_pin'',\s*e\.kiosk_pin,', '', 'g');

    IF position('kiosk_pin' in v_def) > 0 THEN
        RAISE EXCEPTION 'quedaron referencias a kiosk_pin en la definicion';
    END IF;

    EXECUTE v_def;
END $mig$;
