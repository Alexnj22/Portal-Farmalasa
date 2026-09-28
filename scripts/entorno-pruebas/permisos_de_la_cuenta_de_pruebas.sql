-- ─────────────────────────────────────────────────────────────────────────────
-- La cuenta de pruebas tiene que poder VER todo
-- ─────────────────────────────────────────────────────────────────────────────
--
--   supabase db query --linked -f scripts/entorno-pruebas/permisos_de_la_cuenta_de_pruebas.sql
--
-- ── Por qué hace falta ─────────────────────────────────────────────────────
-- El barrido móvil recorre 54 rutas con la cuenta `pruebas`. Medido el
-- 2026-08-24, **19 de esas 54 devolvían «sin acceso»**: staff, monitor,
-- schedules, payroll, branches, sesiones, auditview y once más. En esas rutas el
-- barrido no medía la pantalla — medía el cartel de acceso denegado, y lo
-- contaba como «sin hallazgos».
--
-- Ése es el peor resultado posible de un barrido: un cero que se lee como «está
-- bien» y significa «no llegué a mirar». El detector ahora las separa y las
-- nombra (ver `barrido-total-movil.spec.js`), pero separarlas no las mide: hay
-- que darle la llave.
--
-- ── Ver sí, editar no ──────────────────────────────────────────────────────
-- Se prende `can_view` y **`can_edit` se deja como está**. El barrido necesita
-- que la pantalla PINTE, y sólo eso. Un `can_edit` de más convierte una prueba
-- que mira en una que puede escribir — y el barrido abre diálogos cuando se le
-- pasa `MODALES=1`.
--
-- ── La guarda ──────────────────────────────────────────────────────────────
-- La cuenta `pruebas` la crea la semilla del branch sólo si la base no tiene ni
-- un empleado, así que en producción no existe (comprobado el 2026-08-24: cero
-- filas con ese usuario contra 49 empleados reales). Es la misma llave que usa
-- `correr_fechas.sql`, y se reusa a propósito: una bandera nueva es una bandera
-- que alguien se olvida de poner.
DO $$
DECLARE
  v_rol    integer;
  v_nuevos integer;
BEGIN
  SELECT role_id INTO v_rol FROM public.employees WHERE username = 'pruebas';
  IF v_rol IS NULL THEN
    RAISE EXCEPTION 'Sólo en el branch de pruebas: no se encontró la cuenta `pruebas`.';
  END IF;

  -- ── Entrar sin que pida cambiar la contraseña (2026-09-26) ───────────────
  -- La semilla del branch pone `must_change_password: false`, pero el branch
  -- se arma con la versión de esa migración REGISTRADA en producción, que es
  -- anterior a ese arreglo: la cuenta nació sin la marca y el portal se quedaba
  -- en «Cambia tu contraseña». Los recorridos del navegador daban verde mirando
  -- la pantalla de entrada. Como este archivo corre todos los días, acá no se
  -- pierde al rehacer el branch.
  UPDATE auth.users
     SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || '{"must_change_password": false}'::jsonb
   WHERE id = (SELECT id FROM public.employees WHERE username = 'pruebas')
     AND coalesce((raw_user_meta_data->>'must_change_password')::boolean, true);

  UPDATE public.role_permissions SET can_view = true WHERE role_id = v_rol;

  -- Las que ni siquiera tenían fila. Se listan a mano y no se copian de
  -- `permissionModules.js` porque este archivo corre en la base, sin acceso al
  -- repo — si aparece un módulo nuevo que el barrido no puede abrir, se agrega
  -- acá y el propio informe del barrido dice cuál es.
  INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
  SELECT v_rol, k, true, false, 'ALL'
  FROM unnest(ARRAY['staff_list','staff_detail','monitor','time_audit','schedules','payroll',
                    'vacation_plan','branches','sync_health','emp_documents','emp_announcements',
                    'emp_profile','cierre_periodo','facturas_sala','impresion','orphan_objects',
                    'sesiones','auditview','ventas_perdidas','maintenance','carne_temporal',
                    'encuesta','encuesta_admin','laboratorios','corte_z','resumen_fiscal']) AS k
  ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true;
  GET DIAGNOSTICS v_nuevos = ROW_COUNT;

  RAISE NOTICE 'módulos tocados: %', v_nuevos;

  -- ── La prueba de humo de CI corre acá, no en producción (2026-09-28) ─────
  -- Hasta ese día `Playwright smoke` entraba a PRODUCCIÓN en cada push, con
  -- credenciales que ya no servían: ~90 logins fallidos al día en el registro
  -- de Auth y ni una corrida verde desde el 22-sep. Una de sus pruebas —el
  -- freno de arranque de Editar Empleado— necesita dos cosas que el branch no
  -- tenía, y las dos son la EXCEPCIÓN a «ver sí, editar no» de arriba:
  --
  -- 1. `staff_list.can_edit`, porque sin él el lápiz «Edición rápida» está
  --    deshabilitado y la prueba no llega a abrir el modal. Sólo este módulo.
  -- 2. Un DUI en cada ficha. Lo que la prueba verifica es que el DUI llegue
  --    POBLADO al abrir el modal; con todas las fichas en NULL no tiene qué
  --    mirar. Son ficticios (prefijo 99, único por el índice `employees_dui_
  --    unique`) y sólo se ponen donde falta: el branch no lleva datos reales.
  UPDATE public.role_permissions SET can_edit = true
   WHERE role_id = v_rol AND module_key = 'staff_list' AND NOT can_edit;

  UPDATE public.employees e
     SET dui = '99' || lpad(n.rn::text, 6, '0') || '-0'
    -- Numerados DESPUÉS de los que ya se pusieron: esto corre todos los días y
    -- una ficha nueva no puede repetir el número de una de ayer.
    FROM (SELECT id, row_number() OVER (ORDER BY id)
                     + (SELECT count(*) FROM public.employees WHERE dui LIKE '99%') AS rn
            FROM public.employees WHERE coalesce(dui, '') = '') n
   WHERE e.id = n.id;
END $$;

SELECT count(*) FILTER (WHERE can_view) AS ve_ahora, count(*) AS total
FROM public.role_permissions
WHERE role_id = (SELECT role_id FROM public.employees WHERE username = 'pruebas');
