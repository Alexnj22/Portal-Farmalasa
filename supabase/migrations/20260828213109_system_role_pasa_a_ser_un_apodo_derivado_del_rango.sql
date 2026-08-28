SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- `system_role` pasa a ser un APODO derivado del rango — paso 8 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- El plan decía que la vista tenía que esperar a que todo el mundo tuviera el
-- portal nuevo, porque el paquete viejo lee `emp.system_role` y sin la columna
-- recibiría `undefined` —no un error— y `undefined || 'EMPLEADO'` degradaría a
-- todos a colaborador en silencio.
--
-- **Y no se puede apurar esa espera**, comprobado: el vigía de versión del
-- portal AVISA pero nunca recarga (la recarga es un botón, decisión del usuario
-- del 2026-08-25), y el service worker se registra en `load` sin que nadie llame
-- a `registration.update()`. O sea que una pestaña abierta no se entera de nada
-- hasta que alguien navega. Cualquier mecanismo de «recarga forzada» que se
-- agregue hoy sólo lo entiende el paquete que esa gente todavía no tiene: es
-- circular.
--
-- La salida que no depende de nadie: la vista deja de LEER la columna y pasa a
-- CALCULAR el mismo campo desde el rango del cargo. El paquete viejo sigue
-- funcionando —y mejor que antes, porque este valor ya no puede contradecir al
-- organigrama— y la columna de `employees` queda libre para borrarse.
--
-- El apodo se retira cuando ya nadie corra el paquete de hoy. No corre prisa:
-- es una expresión de la vista, no un dato, así que no puede envejecer mal.
--
-- ── El mapeo reproduce lo que el paquete viejo espera ──────────────────────
--   rango 4   → 'ADMIN'       los dos widgets buscan ADMIN/SUPERADMIN para el
--                             aviso de respaldo, y la comprobación de
--                             supervisión incluye ADMIN
--   rango 3   → 'SUPERVISOR'  supervisión
--   rango 1-2 → 'JEFE'        jefatura y subjefatura de sala
--   resto     → 'EMPLEADO'

DO $mig$
DECLARE
  cols text;
  n    integer;
  apodo constant text :=
    '(CASE WHEN public.rango_de_empleado(id) >= 4 THEN ''ADMIN'''
    || ' WHEN public.rango_de_empleado(id) = 3 THEN ''SUPERVISOR'''
    || ' WHEN public.rango_de_empleado(id) >= 1 THEN ''JEFE'''
    || ' ELSE ''EMPLEADO'' END) AS system_role';
BEGIN
  -- Se toma la lista viva y se sustituyen SÓLO las dos columnas que no salen de
  -- la tabla. El resto queda idéntico por construcción, que es lo que evita
  -- perder una de las 98 al transcribirlas.
  SELECT string_agg(
           CASE a.attname
             WHEN 'system_role' THEN apodo
             WHEN 'rango'       THEN 'public.rango_de_empleado(id) AS rango'
             ELSE quote_ident(a.attname)
           END,
           ', ' ORDER BY a.attnum),
         count(*)
    INTO cols, n
    FROM pg_attribute a
   WHERE a.attrelid = 'public.employees_safe'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF n < 90 THEN
    RAISE EXCEPTION 'Se leyeron sólo % columnas de employees_safe: no se recrea con una lista incompleta.', n;
  END IF;
  IF position('AS system_role' in cols) = 0 OR position('AS rango' in cols) = 0 THEN
    RAISE EXCEPTION 'La vista no trae system_role y rango como se esperaba: no se toca.';
  END IF;

  EXECUTE format('CREATE OR REPLACE VIEW public.employees_safe AS SELECT %s FROM public.employees', cols);
END
$mig$;

ALTER VIEW public.employees_safe SET (security_invoker = true);

COMMENT ON VIEW public.employees_safe IS
  'La ficha de personal sin los campos sensibles. `rango` sale del CARGO. `system_role` ya NO es una columna: es un apodo calculado desde el rango, y existe sólo para que los paquetes del portal publicados antes del 2026-08-28 sigan funcionando. Se retira cuando ya nadie los corra.';
