-- ============================================================
-- Pedidos — Auto-pausa/reanudación por kiosko de marcación
-- v2.2.171
--
-- Trigger en attendance:
--   OUT_LUNCH → auto-pausa pedidos activos iniciados por ese empleado
--   IN_LUNCH  → auto-reanuda pedidos pausados iniciados por ese empleado
--
-- Condición: solo afecta pedidos donde iniciado_por = NEW.employee_id,
-- así cada empleado pausa/reanuda solo los suyos.
-- ============================================================

CREATE OR REPLACE FUNCTION attendance_kiosko_pedido_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row RECORD;
BEGIN
    -- ── Salida a almuerzo → auto-pausar pedidos activos ─────────
    IF NEW.type = 'OUT_LUNCH' THEN
        FOR v_row IN
            SELECT pss.pedido_id, pss.erp_sucursal_id
            FROM   pedido_sucursal_status pss
            WHERE  pss.iniciado_por   = NEW.employee_id
              AND  pss.iniciado_at    IS NOT NULL
              AND  pss.finalizado_at  IS NULL
              -- No pausado actualmente
              AND  NOT EXISTS (
                  SELECT 1 FROM pedido_pausa_historial pph
                  WHERE  pph.pedido_id       = pss.pedido_id
                    AND  pph.erp_sucursal_id = pss.erp_sucursal_id
                    AND  pph.reanudado_at    IS NULL
              )
        LOOP
            PERFORM update_pedido_sucursal_lifecycle(
                v_row.pedido_id,
                v_row.erp_sucursal_id,
                'pausar',
                NEW.employee_id,
                'Almuerzo (kiosko)'
            );
        END LOOP;

    -- ── Regreso de almuerzo → auto-reanudar pedidos pausados ─────
    ELSIF NEW.type = 'IN_LUNCH' THEN
        FOR v_row IN
            SELECT pss.pedido_id, pss.erp_sucursal_id
            FROM   pedido_sucursal_status pss
            WHERE  pss.iniciado_por  = NEW.employee_id
              AND  pss.pausado_at    IS NOT NULL
              AND  pss.reanudado_at  IS NULL
              AND  pss.finalizado_at IS NULL
        LOOP
            PERFORM update_pedido_sucursal_lifecycle(
                v_row.pedido_id,
                v_row.erp_sucursal_id,
                'reanudar',
                NEW.employee_id,
                NULL
            );
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

-- Crear trigger (DROP IF EXISTS para evitar duplicados en re-runs)
DROP TRIGGER IF EXISTS attendance_kiosko_pedido_auto_lifecycle ON attendance;

CREATE TRIGGER attendance_kiosko_pedido_auto_lifecycle
    AFTER INSERT ON attendance
    FOR EACH ROW
    EXECUTE FUNCTION attendance_kiosko_pedido_lifecycle();
