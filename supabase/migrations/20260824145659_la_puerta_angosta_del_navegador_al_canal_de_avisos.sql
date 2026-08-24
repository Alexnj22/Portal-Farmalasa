SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El navegador SÍ llamaba a las dos funciones que se cerraron esta madrugada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `20260824035829_el_revoke_que_se_olvidaba_de_authenticated` le quitó EXECUTE
-- a `authenticated` sobre siete funciones, y de dos de ellas escribió
-- «verificado que el navegador no las llama ni una vez». De `notify_employees`
-- y `notify_branch` eso NO era cierto: las llama `src/utils/notify.js` por
-- `supabase.rpc(...)`, con 18 llamadas repartidas en 8 archivos —solicitudes,
-- Min/Max, pedidos, rutas, vacaciones—.
--
-- Desde las 03:58 UTC del 2026-08-24 toda esa rama devuelve 403 «permission
-- denied for function notify_employees». Medido a las 15:30 UTC: **9 avisos
-- perdidos** en menos de doce horas, de cuatro equipos distintos. El primero
-- que se notó fue un ajuste de Min/Max aprobado a las 14:49 — la aprobación se
-- aplicó y a quien lo propuso no se le avisó nunca.
--
-- Que se haya notado el mismo día es mérito del `enviar()` de `notify.js`: al
-- agotar los reintentos le dice a quien hizo la acción que el aviso no salió.
-- El `catch` que sólo escribía en la consola habría dejado esto vivo semanas,
-- que es exactamente lo que documenta
-- `docs/AVISOS-Y-PUSH-CUANDO-EL-CANAL-SE-ROMPE-2026-08-24.md`.
--
-- ── Por qué NO se revierte el revoke ───────────────────────────────────────
-- El agujero que cerró era real y está bien descrito: `notify_employees` acepta
-- título, cuerpo, enlace y `push` ARBITRARIOS contra cualquier lista de
-- empleados, con el único freno de no podérselo mandar a uno mismo. Devolverle
-- el permiso a `authenticated` tal cual reabre eso.
--
-- ── Por qué tampoco se le pone la guarda ADENTRO ───────────────────────────
-- Era la salida obvia y rompe el circuito por otro lado. `notify_employees`
-- tiene DOS clases de llamadores:
--
--   · el navegador, por RPC;
--   · disparadores y otras funciones DEFINER —el aviso `MINMAX_PENDING` de las
--     14:46 lo escribió un trigger— que corren DENTRO de la misma petición del
--     navegador, con el mismo JWT y el mismo `auth.uid()`.
--
-- O sea que desde adentro de la función las dos son indistinguibles: cualquier
-- guarda que mire el rol del llamador o el empleado resuelto trataría al
-- trigger como si fuera el navegador y le aplicaría la lista blanca del portal.
-- El trigger emite tipos que el navegador no emite, así que la guarda apagaría
-- avisos que hoy funcionan — en silencio, porque nadie mira el `RAISE` de un
-- trigger.
--
-- La puerta angosta va AFUERA: el primitivo se queda cerrado y se le agrega una
-- entrada propia para el navegador, que es el único llamador al que hay que
-- ponerle condiciones.
--
-- ── Qué frena, y qué no ────────────────────────────────────────────────────
-- Frena: emitir un tipo de aviso que el portal no emite; emitirlo sin ser un
-- empleado; y mandárselo a media empresa (el portal manda a UNA persona por
-- aviso; el tope es 10 para que un segundo destinatario no lo rompa).
--
-- No frena —y hay que decirlo— que un empleado escriba el texto de un aviso de
-- un tipo permitido a una persona o a una sala. Eso queda TRAZABLE y no
-- anónimo: `notify_employees` graba `created_by` con el empleado resuelto del
-- JWT, y el anidamiento no lo pierde porque `auth.uid()` es el mismo. Cerrarlo
-- del todo exige que el texto se arme en la base, que es otro trabajo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.avisar_a_empleados(
    p_recipients uuid[],
    p_type       text,
    p_title      text,
    p_body       text    DEFAULT ''::text,
    p_link       text    DEFAULT NULL::text,
    p_metadata   jsonb   DEFAULT '{}'::jsonb,
    p_push       boolean DEFAULT false,
    p_branch_id  integer DEFAULT NULL::integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  -- Los tipos que `src/utils/notify.js` emite hoy vía `notifyEmployees`. Si
  -- aparece uno nuevo en el navegador, va acá — y que haya que agregarlo es el
  -- punto: un tipo nuevo pasa por una decisión y no por descuido.
  TIPOS constant text[] := ARRAY['REQUEST_DECIDED','REQUEST_PENDING','MINMAX_DECIDED','SYSTEM'];
  v_actor uuid := public.auth_employee_id();
  v_n     integer := coalesce(array_length(p_recipients, 1), 0);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un empleado puede emitir un aviso desde el portal';
  END IF;

  IF p_type IS NULL OR NOT (p_type = ANY (TIPOS)) THEN
    RAISE EXCEPTION 'FORBIDDEN: el portal no emite avisos de tipo %', coalesce(p_type, '(vacio)');
  END IF;

  IF v_n > 10 THEN
    RAISE EXCEPTION 'FORBIDDEN: un aviso del portal va a lo sumo a 10 personas (llegaron %)', v_n;
  END IF;

  RETURN public.notify_employees(
    p_recipients, p_type, p_title, p_body, p_link, p_metadata, p_push, p_branch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_a_sucursal(
    p_branch_id integer,
    p_type      text,
    p_title     text,
    p_body      text    DEFAULT ''::text,
    p_link      text    DEFAULT NULL::text,
    p_metadata  jsonb   DEFAULT '{}'::jsonb,
    p_push      boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  -- `notifyBranch` sólo se usa para el camino de un pedido: preparación, salida,
  -- reenvío, llegada y problema.
  TIPOS constant text[] := ARRAY['PEDIDO_TRACKING','PEDIDO_PROBLEMA','PEDIDO_REENVIO','PEDIDO_LLEGADA'];
  v_actor uuid := public.auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un empleado puede emitir un aviso desde el portal';
  END IF;

  IF p_type IS NULL OR NOT (p_type = ANY (TIPOS)) THEN
    RAISE EXCEPTION 'FORBIDDEN: el portal no emite avisos de sucursal de tipo %', coalesce(p_type, '(vacio)');
  END IF;

  RETURN public.notify_branch(
    p_branch_id, p_type, p_title, p_body, p_link, p_metadata, p_push);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_a_empleados(uuid[], text, text, text, text, jsonb, boolean, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.avisar_a_empleados(uuid[], text, text, text, text, jsonb, boolean, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.avisar_a_sucursal(integer, text, text, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.avisar_a_sucursal(integer, text, text, text, text, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.avisar_a_empleados(uuid[], text, text, text, text, jsonb, boolean, integer) IS
  'Puerta del navegador al canal de avisos. Exige empleado, tipo de la lista del portal y a lo sumo 10 destinatarios; delega en notify_employees, que sigue cerrado a authenticated.';
COMMENT ON FUNCTION public.avisar_a_sucursal(integer, text, text, text, text, jsonb, boolean) IS
  'Puerta del navegador al aviso por sucursal. Exige empleado y un tipo del camino de un pedido; delega en notify_branch, que sigue cerrado a authenticated.';
