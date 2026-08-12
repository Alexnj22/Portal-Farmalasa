-- El aviso de una solicitud nueva deja de ir a una sola persona.
--
-- Hasta ahora `notificar_solicitud_creada` mandaba la notificación y el push a
-- `approver_id` y a nadie más. Pero la facultad NUNCA estuvo limitada a esa
-- persona: quien tiene `can_approve` ve la bandeja completa —la policy de
-- lectura se la da entera, el filtro por aprobador designado es sólo de
-- pantalla— y la policy de escritura pide el permiso, no ser el designado. O
-- sea que el aviso era dirigido y la facultad compartida, y quien podía
-- ayudar no se enteraba.
--
-- Decisión del usuario (2026-08-12): que le llegue a todos los que pueden
-- aprobar.
--
-- ── Y eso obliga a evaluar la herencia sobre OTRA persona ─────────────────
-- `auth_hereda_por_ausencia` contesta «¿hereda QUIEN CONSULTA?», que sirve
-- para las policies pero no para armar una lista de destinatarios. Sin
-- resolverlo, el suplente que hereda por la ausencia del titular no recibiría
-- el aviso — justo la persona a la que el mecanismo existe para alcanzar.
--
-- La regla se muda a `hereda_por_ausencia_rol(cargo, …)` y la vieja pasa a
-- llamarla con el cargo de quien consulta. UNA definición, dos usos: copiarla
-- sería garantizar que dentro de un mes digan cosas distintas.
--
-- ── Los tipos no coinciden, y hay que mirarlos ────────────────────────────
-- `roles.id`, `roles.parent_role_id` y `employees.role_id` son `bigint`, pero
-- `role_permissions.role_id` es `integer`. La primera versión de esta función
-- se declaró con `integer` y falló al compilar la que la llama: «function
-- hereda_por_ausencia_rol(bigint, text, unknown) does not exist». Va con
-- `bigint`, que acepta los dos.

SET lock_timeout = '5s';

-- Por si quedó viva la firma con integer: un overload no es deuda inerte, es
-- una segunda firma que alguien llama sin querer.
DROP FUNCTION IF EXISTS public.hereda_por_ausencia_rol(integer, text, text);

-- ── 1 · La regla, ahora sobre un cargo cualquiera ─────────────────────────
CREATE OR REPLACE FUNCTION public.hereda_por_ausencia_rol(
  p_role_id bigint, p_module_key text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_role_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.roles hijo
    JOIN public.role_permissions rp
      ON rp.role_id = hijo.id AND rp.module_key = p_module_key
    WHERE rp.delega_en_ausencia
      AND hijo.parent_role_id = p_role_id
      AND CASE p_action
            WHEN 'can_view'    THEN rp.can_view
            WHEN 'can_edit'    THEN rp.can_edit
            WHEN 'can_approve' THEN rp.can_approve
            ELSE false
          END
      -- El cargo tiene gente…
      AND EXISTS (SELECT 1 FROM public.employees e
                   WHERE e.role_id = hijo.id AND e.status = 'ACTIVO')
      -- …y no queda ni una disponible. Las dos condiciones hacen falta: sin la
      -- primera, un cargo VACÍO delegaría para siempre, porque «no queda
      -- ninguna disponible» es trivialmente cierto sobre el conjunto vacío.
      AND NOT EXISTS (SELECT 1 FROM public.employees e
                       WHERE e.role_id = hijo.id AND e.status = 'ACTIVO'
                         AND NOT public.empleado_no_disponible(e.id))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.hereda_por_ausencia_rol(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hereda_por_ausencia_rol(bigint, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.hereda_por_ausencia_rol(bigint, text, text) IS
  'La regla de delegacion por ausencia, evaluada sobre un cargo cualquiera. auth_hereda_por_ausencia() la llama con el cargo de quien consulta.';

-- La de siempre, ahora sin cuerpo propio.
CREATE OR REPLACE FUNCTION public.auth_hereda_por_ausencia(p_module_key text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.hereda_por_ausencia_rol(
           (SELECT public.auth_employee_role_id())::bigint, p_module_key, p_action);
$$;

-- ── 2 · Quién puede aprobar un módulo, sea quien sea ──────────────────────
-- Las mismas tres vías que `auth_has_module_permission`, menos el atajo de
-- superusuario: ese lo tiene la cuenta técnica del sistema, y sumarla a cada
-- aviso es ruido, no ayuda. Puede aprobar igual si entra a la bandeja.
CREATE OR REPLACE FUNCTION public.puede_aprobar_modulo(p_employee_id uuid, p_module_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_module_key IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.status = 'ACTIVO'
      AND (
        EXISTS (SELECT 1 FROM public.role_permissions rp
                 WHERE rp.role_id = e.role_id
                   AND rp.module_key = p_module_key AND rp.can_approve)
        OR EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = e.secondary_role_id
                      AND rp.module_key = p_module_key AND rp.can_approve)
        OR public.hereda_por_ausencia_rol(e.role_id::bigint, p_module_key, 'can_approve')
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.puede_aprobar_modulo(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puede_aprobar_modulo(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.puede_aprobar_modulo(uuid, text) IS
  'Si ese empleado puede aprobar ese modulo hoy: por su cargo, por el secundario o por delegacion de un cargo ausente. Sin el atajo de superusuario, a proposito.';

-- ── 3 · Qué módulo gobierna avisar de este tipo ───────────────────────────
-- Hermana de `modulo_de_aprobacion`, pero ésta NO devuelve NULL para lo
-- desconocido: acá un NULL sería no avisarle a nadie. Lo que no es de las dos
-- familias operativas cae en personales, que es donde vive el resto.
--
-- (La migración siguiente le agrega la excepción del traslado. Se dejó así
-- para que se lea el orden en que se descubrió.)
CREATE OR REPLACE FUNCTION public.modulo_de_notificacion(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(public.modulo_de_aprobacion(p_type),
                  CASE WHEN p_type = 'INVENTORY_TRANSFER_REQUEST'
                       THEN 'traslados' ELSE 'requests_personales' END);
$$;

REVOKE EXECUTE ON FUNCTION public.modulo_de_notificacion(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.modulo_de_notificacion(text) TO authenticated, service_role;

-- ── 4 · El bloque de destinatarios, reemplazado SOBRE EL CATÁLOGO ─────────
-- El cuerpo sale de `pg_proc.prosrc` y no de una transcripción a mano: la
-- función tiene 150 líneas de texto de notificación y volver a escribirlas es
-- pedir un error de copia en algo que nadie releería.
--
-- No es sólo comodidad. Mientras se escribía esto, OTRA sesión aplicó
-- `20260812224217_personas_de_solicitudes_tambien_por_correo`. Leer del
-- catálogo significa que lo que se reemplaza es la versión VIVA, con lo que esa
-- sesión haya dejado; transcribir habría revertido su trabajo sin avisar.
--
-- Y el `RAISE` si no encuentra el bloque tampoco es decorativo: un `replace()`
-- que no encuentra nada devuelve el texto intacto, y la migración diría
-- «listo» sin haber hecho nada.
DO $mig$
DECLARE
  v_src   text;
  v_viejo text := 'ARRAY[NEW.approver_id])';
  v_nuevo text := '(SELECT array_agg(DISTINCT s.x) FROM ('
                || 'SELECT NEW.approver_id AS x '
                || 'UNION SELECT e.id FROM public.employees e '
                || 'WHERE e.status = ''ACTIVO'' '
                || 'AND public.puede_aprobar_modulo(e.id, public.modulo_de_notificacion(NEW.type))'
                || ') s WHERE s.x IS NOT NULL AND s.x <> NEW.employee_id), '
                || 'ARRAY[NEW.approver_id])';
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notificar_solicitud_creada';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'No existe notificar_solicitud_creada().';
  END IF;

  IF (length(v_src) - length(replace(v_src, v_viejo, ''))) / length(v_viejo) <> 1 THEN
    RAISE EXCEPTION 'Esperaba UNA aparicion de "%" y no la encontre asi. Alguien toco el bloque de destinatarios: revisar antes de reemplazar a ciegas.', v_viejo;
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.notificar_solicitud_creada() '
    'RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER '
    'SET search_path TO ''public'', ''extensions'' AS %L',
    replace(v_src, v_viejo, v_nuevo));
END
$mig$;
