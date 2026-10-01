-- El aviso de 20261001151451 enlazaba a /auditoria-del-sistema, pero esa
-- pantalla no lee export_log: "VER" llevaba a un lugar donde la descarga no
-- aparece. El cuerpo del aviso ya dice quien, que y cuantas, asi que va sin
-- enlace hasta que exista una vista del registro de egresos.
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
           NULL,
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
