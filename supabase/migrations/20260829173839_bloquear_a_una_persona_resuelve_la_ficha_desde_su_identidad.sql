SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Bloquear a una persona funciona otra vez: la persona se RESUELVE, no se
-- supone.
--
-- Reportado el 2026-08-29: bloquear a alguien desde /sesiones devolvía «no
-- existe esa persona». No era un caso raro — fallaba para TODO el mundo, y ese
-- «todo el mundo» es lo que lo hace medible: en producción, de las 45 fichas
-- con cuenta, `employees.id = auth_user_id` en **cero**. La acción estaba
-- muerta desde el 2026-08-17.
--
-- El choque es entre dos verdades que cada una por su lado es correcta:
--
--   · `list_sessions` devuelve `persona_id` = `auth.users.id` (la IDENTIDAD de
--     acceso). Se cambió a propósito el 17-ago, porque «Cerrar todas» borra
--     `auth.sessions WHERE user_id = …` y con la ficha no encontraba nada.
--   · `block_employee` escribe `employees WHERE id = …`, o sea la FICHA.
--
-- La pantalla le pasa a la segunda lo que le dio la primera. Y como una persona
-- puede tener DOS identidades —la del correo y la del carné `@staff.local`, y las
-- tienen 21 de las 45, la del reporte incluida—, no alcanza con elegir una de las dos verdades:
-- hay que traducir. Es [[feedback_nombre_de_columna_no_es_su_tipo]] con dos
-- columnas que se llaman parecido y significan cosas distintas.
--
-- El bloqueo se escribe en la FICHA a propósito, y eso no cambia: `auth_no_
-- bloqueado()` resuelve al empleado por las dos vías, así que bloquear la ficha
-- deja afuera a las dos identidades de una sola vez. Bloquear «una identidad»
-- dejaría a la persona entrando por la otra puerta.
--
-- Tres consecuencias que se arreglan con esto y no eran visibles:
--
--   1. Desbloquear NO daba error: `unblock_employee` devuelve un booleano y la
--      pantalla sólo mira `error`. O sea que decía «Ya puede volver a entrar»
--      sin haber tocado una fila. Es la familia de
--      [[feedback_sin_policy_de_update_el_write_devuelve_cero]].
--   2. El freno de bloquearse a uno mismo comparaba `auth_employee_id()` (ficha)
--      contra el parámetro (identidad): nunca disparó. La pantalla apaga el
--      botón cuando la tarjeta tiene la conexión actual, pero con dos
--      identidades la OTRA tarjeta no la tiene — y ahí el botón estaba vivo con
--      el freno de la base muerto detrás.
--   3. Cerrar las sesiones al bloquear alcanzaba sólo a la identidad recibida.
--      Ahora se cierran las de TODAS las identidades de esa persona: bloquear y
--      dejarle una sesión viva por la otra puerta es no bloquear.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Quién es esta persona, venga dicha como venga ───────────────────────────
-- Acepta el id de la ficha o el de cualquiera de sus identidades de acceso, y
-- siempre devuelve la ficha. Misma resolución que `auth_employee_id()` y
-- `auth_no_bloqueado()`, escrita una vez para que no vuelvan a divergir.
CREATE OR REPLACE FUNCTION public.ficha_de_persona(p_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT e.id
  FROM public.employees e
  WHERE p_id IS NOT NULL
    AND (e.id = p_id
      OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                  WHERE l.auth_user_id = p_id))
  LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.ficha_de_persona(uuid) IS
  'Traduce el id de una identidad de acceso (auth.users.id) al de su ficha (employees.id). Devuelve el mismo id si ya es una ficha, y NULL si no reconoce a nadie.';

REVOKE EXECUTE ON FUNCTION public.ficha_de_persona(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ficha_de_persona(uuid) TO authenticated, service_role;

-- ── Bloquear ────────────────────────────────────────────────────────────────
-- El parámetro sigue llamándose `p_employee_id` a propósito: cambiarle el
-- nombre exige DROP + CREATE, y entre la migración y el despliegue del frontend
-- habría una ventana en que la pantalla vieja manda un argumento que ya no
-- existe. Recibe la persona dicha como sea; lo que hace la función es
-- resolverla.
CREATE OR REPLACE FUNCTION public.block_employee(
  p_employee_id uuid,
  p_until       timestamptz DEFAULT NULL,
  p_reason      text        DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_yo       uuid;
  v_ficha    uuid;
  v_hasta    timestamptz;
  v_sesiones integer := 0;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bloqueos', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para bloquear' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'falta la persona' USING ERRCODE = '22023';
  END IF;

  v_ficha := (SELECT public.ficha_de_persona(p_employee_id));
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'no existe esa persona' USING ERRCODE = '22023';
  END IF;

  -- Quién soy sale del JWT, nunca de un parámetro.
  v_yo := (SELECT public.auth_employee_id());

  -- Bloquearse a uno mismo es un autogol sin vuelta: quedarías fuera y sin
  -- poder desbloquearte, porque desbloquear exige el permiso que acabás de
  -- perder. Se impide en la base y no sólo en la pantalla — y se compara ficha
  -- contra ficha, que es lo que faltaba: con dos identidades, la tarjeta de la
  -- otra no muestra la conexión actual y la pantalla deja apretar.
  IF v_yo IS NOT NULL AND v_yo = v_ficha THEN
    RAISE EXCEPTION 'no podés bloquearte a vos mismo' USING ERRCODE = '22023';
  END IF;

  v_hasta := coalesce(p_until, 'infinity'::timestamptz);

  UPDATE public.employees
     SET blocked_until  = v_hasta,
         blocked_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         blocked_at     = now(),
         blocked_by     = v_yo
   WHERE id = v_ficha;

  -- Todas las puertas de esa persona, no sólo por la que se la nombró.
  WITH suyas AS (
    SELECT v_ficha AS user_id
    UNION
    SELECT l.auth_user_id FROM public.employee_auth_accounts l
     WHERE l.employee_id = v_ficha
  ),
  cerradas AS (
    DELETE FROM auth.sessions s
     WHERE s.user_id IN (SELECT user_id FROM suyas)
    RETURNING 1
  )
  SELECT count(*) INTO v_sesiones FROM cerradas;

  DELETE FROM public.session_activity sa
   WHERE sa.user_id = v_ficha
      OR sa.user_id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                         WHERE l.employee_id = v_ficha);

  RETURN v_sesiones;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.block_employee(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.block_employee(uuid, timestamptz, text) TO authenticated, service_role;

-- ── Desbloquear ─────────────────────────────────────────────────────────────
-- Ahora LANZA cuando no reconoce a la persona, en vez de devolver `false`. Un
-- booleano que nadie mira es un fracaso silencioso: la pantalla decía «Ya puede
-- volver a entrar» sin haber tocado una fila.
CREATE OR REPLACE FUNCTION public.unblock_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_ficha uuid;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bloqueos', 'can_edit')) THEN
    RAISE EXCEPTION 'sin permiso para desbloquear' USING ERRCODE = '42501';
  END IF;
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'falta la persona' USING ERRCODE = '22023';
  END IF;

  v_ficha := (SELECT public.ficha_de_persona(p_employee_id));
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'no existe esa persona' USING ERRCODE = '22023';
  END IF;

  UPDATE public.employees
     SET blocked_until = NULL, blocked_reason = NULL, blocked_at = NULL, blocked_by = NULL
   WHERE id = v_ficha AND blocked_until IS NOT NULL;

  -- `false` acá significa «no estaba bloqueada», que no es un error.
  RETURN FOUND;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.unblock_employee(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unblock_employee(uuid) TO authenticated, service_role;
