SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- `employees_safe` publica el rango — paso 5 de
-- docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Paso ADITIVO: agrega `rango` y NO quita `system_role`. Las dos conviven
-- mientras el código se pasa de una a la otra, y por eso este paso no puede
-- romper nada — nadie lee la columna nueva todavía.
--
-- El orden importa y es al revés del de siempre. Con una columna que se AGREGA,
-- la base va primero. Con una que se BORRA, va última: el login lee esta vista
-- con `select('*')`, así que quitarle `system_role` **no daría error** — le
-- devolvería un campo menos, `emp.system_role` quedaría `undefined`, y
-- `undefined || 'EMPLEADO'` degradaría a TODO el mundo a EMPLEADO en silencio.
-- Un cambio que no falla y empieza a decir otra cosa es peor que uno que falla.
--
-- ── Por qué el rango sale de la función y no de un JOIN a `roles` ───────────
-- La vista es `security_invoker`, así que un JOIN a `roles` quedaría sujeto al
-- RLS de quien lee: si algún día una policy le escondiera filas de `roles` a
-- alguien, su rango llegaría en NULL y el portal lo trataría como colaborador
-- —otra vez una degradación silenciosa—. `rango_de_empleado()` es DEFINER y
-- contesta lo mismo para todos.
--
-- ── Y por qué la lista de columnas se genera sola ──────────────────────────
-- `CREATE OR REPLACE VIEW` exige repetir las 97 columnas existentes en el mismo
-- orden. Transcribirlas a mano para agregar una es la forma barata de perder
-- una en el camino, y la vista se recrearía sin ella sin que nada avise. Se
-- toman de la vista viva, en su propio orden.

DO $mig$
DECLARE
  cols text;
  n    integer;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum), count(*)
    INTO cols, n
    FROM pg_attribute a
   WHERE a.attrelid = 'public.employees_safe'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF n < 90 THEN
    RAISE EXCEPTION 'Se leyeron sólo % columnas de employees_safe: no se recrea con una lista incompleta.', n;
  END IF;
  IF position('rango' in cols) > 0 AND cols ~ '\mrango\M' THEN
    RAISE EXCEPTION 'employees_safe ya tiene una columna rango.';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.employees_safe AS SELECT %s, public.rango_de_empleado(id) AS rango FROM public.employees',
    cols);
END
$mig$;

-- `CREATE OR REPLACE VIEW` conserva las opciones, pero se vuelve a declarar a
-- propósito: una vista de personal que pierda `security_invoker` deja de
-- respetar el RLS de quien la lee, y eso no puede depender de un detalle de
-- implementación de Postgres.
ALTER VIEW public.employees_safe SET (security_invoker = true);

COMMENT ON VIEW public.employees_safe IS
  'La ficha de personal sin los campos sensibles. `rango` sale del CARGO (rango_de_empleado): el escalón para escalar una decisión. `system_role` sigue publicada mientras el código se pasa al rango — se quita al final, ver docs/PLAN-ROLES-SIN-SYSTEM-ROLE-2026-08-28.md.';
