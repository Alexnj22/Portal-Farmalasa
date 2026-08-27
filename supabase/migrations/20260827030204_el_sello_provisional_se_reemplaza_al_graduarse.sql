SET lock_timeout = '5s';

-- Qué sello tiene hoy cada acreditación profesional: el provisional que la
-- junta da al egresado, o el definitivo que llega con el título.
--
-- El NÚMERO sigue viviendo en su propia columna (`nursing_license_number` y
-- compañía). Acá va sólo cuál de los dos es, más el número provisional cuando
-- se reemplaza: si mañana hay que explicar con qué sello se trabajó durante la
-- práctica, ese dato tiene que existir en algún lado.
--
-- Va en jsonb y no en cuatro columnas porque la lista de juntas la manda el
-- código (`src/utils/acreditaciones.js`): con columnas, agregar una junta sería
-- una migración sobre una tabla con permisos por columna, o sea el trámite más
-- caro del repo para el cambio más chico.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS acreditaciones jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.employees.acreditaciones IS
  'Por junta: {"ENFERMERIA":{"tipo":"PROVISIONAL|DEFINITIVA","provisional_numero":"…","definitiva_desde":"YYYY-MM-DD"}}. El número vigente vive en su propia columna.';

-- La vista se rearma a partir de la que está VIVA, nunca de una lista de
-- columnas leída antes: otra sesión puede haberle agregado una en el medio y
-- una lista vieja la borraría sin dar error. Ya pasó en esta misma tabla.
DO $$
DECLARE d text; d2 text;
BEGIN
  d := pg_get_viewdef('public.employees_safe'::regclass, true);

  IF d ~ '(^|[^_a-zA-Z])acreditaciones([^_a-zA-Z]|$)' THEN
    RAISE NOTICE 'employees_safe ya publica acreditaciones';
    RETURN;
  END IF;

  d2 := replace(d, E'\n   FROM employees;', E',\n    acreditaciones\n   FROM employees;');

  -- Si el reemplazo no encontró dónde entrar, la vista quedaría igual y la
  -- columna nunca se publicaría — sin error y sin que nadie lo note hasta que
  -- el formulario guarde en un campo que no puede leer de vuelta.
  IF d2 = d THEN
    RAISE EXCEPTION 'no se encontró el cierre «FROM employees;» en employees_safe: revisar a mano';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.employees_safe AS ' || d2;
END $$;
