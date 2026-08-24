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
END $$;

SELECT count(*) FILTER (WHERE can_view) AS ve_ahora, count(*) AS total
FROM public.role_permissions
WHERE role_id = (SELECT role_id FROM public.employees WHERE username = 'pruebas');
