SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Grupo A: se retira la llave maestra — paso 3 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Seis funciones tenían una rama `system_role = 'SUPERADMIN'` que se saltaba el
-- permiso por módulo. La única ficha que la portaba —«Administrador del
-- Sistema», código 71015— se borró hoy a pedido del usuario («lo puedes
-- eliminar, no tiene uso»): nunca inició sesión, 0 solicitudes, 0 dispositivos.
--
-- O sea que estas ramas ya son **código muerto medido, no supuesto**:
-- `select count(*) from employees where system_role='SUPERADMIN'` da 0.
-- Quitarlas no le cambia el resultado a nadie, y por eso este paso no necesita
-- reemplazo: lo que queda es el permiso por módulo, que es como decide el resto
-- del portal.
--
-- El día que haga falta una puerta de emergencia se agrega `roles.llave_maestra`
-- con quien la vaya a tener. Agregarla hoy sería una columna en `false` para los
-- 24 cargos que no leería nadie.
--
-- ⚠️ **El chequeo de que no quedó ninguna mención va con `strpos`, no con
-- `ILIKE`.** El primer intento de esta migración abortó sola con «el reemplazo
-- fue parcial» sobre una función que estaba perfecta: en un patrón `LIKE` el
-- guion bajo es un COMODÍN de un carácter, así que `'%system_role%'` casa con
-- el `SYSTEM-ROLE` del nombre de este mismo plan, escrito dentro del comentario
-- que inserta el reemplazo. La guarda se acusaba a sí misma.

DO $mig$
DECLARE
  r      record;
  nuevo  text;
  n      integer := 0;
  marca  constant text := 'false /* llave maestra retirada 2026-08-28: ya no hay quien la porte — ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md */';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('cancelar_envio', 'validar_envio_producto',
                         'puede_confirmar_traslado', 'puede_enviar_producto',
                         'recordar_linea_base_de_egreso')
  LOOP
    nuevo := replace(r.def, 'coalesce(e.system_role,'''') = ''SUPERADMIN''',  marca);
    nuevo := replace(nuevo, 'coalesce(e.system_role, '''') = ''SUPERADMIN''', marca);
    nuevo := replace(nuevo, 'e.system_role = ''SUPERADMIN''',                 marca);

    IF nuevo = r.def THEN
      RAISE EXCEPTION 'No se encontró la rama de llave maestra en %(): la función cambió y hay que revisarla a mano.', r.proname;
    END IF;
    -- Literal, no LIKE. Ver la nota de arriba.
    IF strpos(nuevo, 'system_role') > 0 THEN
      RAISE EXCEPTION 'Quedó una mención de system_role en %(): el reemplazo fue parcial.', r.proname;
    END IF;

    EXECUTE nuevo;
    n := n + 1;
  END LOOP;

  IF n <> 5 THEN
    RAISE EXCEPTION 'Se esperaban 5 funciones y se tocaron %.', n;
  END IF;
END
$mig$;

-- ── Y la del login, escrita a mano ──────────────────────────────────────────
-- Ésta se reescribe entera en vez de parchearse porque la llama
-- `custom_access_token_hook`: corre en CADA inicio de sesión. Dejarle adentro un
-- `CASE WHEN EXISTS (… WHERE false) THEN 720` sería código muerto en el camino
-- más caliente del portal, y el próximo que lo lea va a perder tiempo
-- averiguando a quién le daba 720 minutos.
--
-- Se conserva el piso de 5 minutos del `greatest`: no es redundante. Si algún
-- día un cargo queda con `idle_limit_min` en 0 o en NULL, el piso evita que a
-- esa gente la sesión se le cierre al instante.
CREATE OR REPLACE FUNCTION public.session_idle_limit_minutes(p_user_id uuid, p_device_class text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH emp AS (
    SELECT e.id, e.role_id, e.secondary_role_id
    FROM public.employees e
    WHERE e.id = p_user_id
       OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                   WHERE l.auth_user_id = p_user_id)
    ORDER BY (e.id = p_user_id) DESC
    LIMIT 1
  )
  SELECT CASE
    -- 30 días: PWA instalada o build nativo. Es el teléfono de una persona y
    -- recibir avisos con la app cerrada es lo único para lo que existe.
    WHEN p_device_class = 'app' THEN 43200
    -- Manda el cargo. Con dos cargos gana el más largo, que es la misma
    -- semántica de siempre: cualquiera de los dos lo concedía.
    ELSE greatest(
      coalesce((SELECT max(r.idle_limit_min) FROM public.roles r, emp
                 WHERE r.id IN (emp.role_id, emp.secondary_role_id)), 5),
      5)
  END;
$function$;
