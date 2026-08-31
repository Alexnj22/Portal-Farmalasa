-- El agujero del disparador de ayer, encontrado usándolo.
--
-- `dar_todo_a_las_cuentas_de_pruebas` propaga un módulo nuevo DESDE otro cargo
-- HACIA la cuenta de pruebas, y para no reentrar salta las filas que ya son de
-- una cuenta de pruebas (`RETURN NULL`). Eso deja un caso afuera: una fila
-- escrita **directamente** para la cuenta de pruebas, que entra tal cual venga.
--
-- No es teórico. Pasó hoy, en la migración de al lado: `requests_caja` se
-- sembró con `SELECT ... FROM role_permissions WHERE module_key='caja_vales'`,
-- y la cuenta de pruebas estaba en ese SELECT — así que se dio a sí misma un
-- permiso **a medias** (`can_edit: false`). La regla del usuario es «QA siempre
-- debe tener todo activo», y el disparador de ayer no la sostenía por este lado.
--
-- Lo mismo pasaría si alguien le apagara un interruptor desde la pantalla de
-- permisos: se apagaría, y el próximo barrido volvería a medir la pantalla de
-- sin-acceso y a reportar un cero que habla de otra cosa.
--
-- La corrección es un disparador BEFORE, que es lo que faltaba: normaliza la
-- fila **antes** de escribirla. No puede reentrar —no hace un UPDATE, cambia
-- `NEW`— y cubre las dos puertas, INSERT y UPDATE.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.una_cuenta_de_pruebas_lo_tiene_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles r
              WHERE r.id = NEW.role_id AND r.es_cuenta_de_pruebas) THEN
    NEW.can_view    := true;
    NEW.can_edit    := true;
    NEW.can_approve := true;
    NEW.scope       := 'ALL';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.una_cuenta_de_pruebas_lo_tiene_todo() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_una_cuenta_de_pruebas_lo_tiene_todo ON public.role_permissions;
CREATE TRIGGER trg_una_cuenta_de_pruebas_lo_tiene_todo
BEFORE INSERT OR UPDATE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.una_cuenta_de_pruebas_lo_tiene_todo();

-- Y la fila que ya quedó a medias.
UPDATE public.role_permissions rp
   SET can_view = true, can_edit = true, can_approve = true, scope = 'ALL',
       updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id AND r.es_cuenta_de_pruebas
   AND (rp.can_view, rp.can_edit, rp.can_approve, rp.scope)
       IS DISTINCT FROM (true, true, true, 'ALL');
