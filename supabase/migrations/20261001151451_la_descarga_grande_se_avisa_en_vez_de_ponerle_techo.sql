-- Fase 3.3 de docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md, decidida el
-- 2026-10-01: NO va techo con confirmacion. Va un aviso.
--
-- Con un mes de linea base (78 descargas, la mayor 3,972 filas de Min-Max) el
-- usuario pregunto que agregaba un techo sobre roles y RLS. La respuesta: poco.
-- La confirmacion no frena a quien se quiere llevar los datos (aprieta "si"), y
-- lo unico util —que quede anotado— ya pasa con export_log. Lo que faltaba es
-- que alguien MIRE ese registro. Por eso: cada descarga de mas de 5,000 filas
-- le avisa a quien puede editar "sesiones", con quien, que y cuantas.
--
-- El aviso NUNCA puede tumbar el registro: si fallara el INSERT del aviso, el
-- de export_log se perderia con el, y perder la fila es peor que perder el
-- aviso. Por eso el bloque EXCEPTION.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.avisar_descarga_grande()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  c_umbral constant integer := 5000;   -- 5,000: ~25% sobre la mayor descarga normal del mes medido
  v_quien text;
BEGIN
  IF coalesce(NEW.filas, 0) <= c_umbral THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, e.name)
      INTO v_quien FROM employees e WHERE e.id = NEW.employee_id;

    INSERT INTO notifications (recipient_id, type, title, body, link, metadata)
    SELECT e.id, 'DESCARGA_GRANDE',
           'Descarga grande de datos',
           format('%s descargó %s filas de %s%s.',
                  coalesce(v_quien, 'Alguien'),
                  to_char(NEW.filas, 'FM999,999,999'),
                  NEW.modulo,
                  CASE WHEN NEW.formato IS NOT NULL THEN ' (' || NEW.formato || ')' ELSE '' END),
           '/auditoria-del-sistema',
           jsonb_build_object('export_id', NEW.id, 'employee_id', NEW.employee_id,
                              'modulo', NEW.modulo, 'formato', NEW.formato,
                              'filas', NEW.filas, 'umbral', c_umbral)
    FROM employees e
    WHERE coalesce(e.status,'') = 'ACTIVO'
      AND EXISTS (SELECT 1 FROM role_permissions rp
                  WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
                    AND rp.module_key = 'sesiones' AND rp.can_edit);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'avisar_descarga_grande: % (export %)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.avisar_descarga_grande() IS
  'Trigger de export_log: una descarga de mas de 5,000 filas avisa a quien edita "sesiones". Reemplaza al techo con confirmacion de la Fase 3.3 (decidido 2026-10-01). Nunca hace fallar el registro.';

REVOKE EXECUTE ON FUNCTION public.avisar_descarga_grande() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_descarga_grande() TO service_role;

DROP TRIGGER IF EXISTS export_log_avisar_descarga_grande ON public.export_log;
CREATE TRIGGER export_log_avisar_descarga_grande
  AFTER INSERT ON public.export_log
  FOR EACH ROW EXECUTE FUNCTION public.avisar_descarga_grande();

-- La decision queda firmada: el recordatorio mensual se apaga con updated_by.
UPDATE public.security_config
   SET updated_by = (SELECT id FROM public.employees WHERE id = 'bbc796d7-7435-495b-9306-a2115f44a18f'),  -- sólo si existe: el branch de pruebas no tiene esa ficha
       updated_at = now(),
       nota = 'Fase 3.3 — DECIDIDO 2026-10-01: no va techo con confirmacion. En su lugar, el trigger export_log_avisar_descarga_grande avisa toda descarga de mas de 5,000 filas.'
 WHERE key = 'techo_exportacion';
