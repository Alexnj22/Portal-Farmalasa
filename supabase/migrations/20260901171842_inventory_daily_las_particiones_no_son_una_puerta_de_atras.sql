-- Las particiones de `inventory_daily` quedaron abiertas a `anon`. Se cierran.
--
-- LO QUE PASO. `20260901171601` le puso RLS y sus GRANT al padre, que es lo que
-- manda la regla 1 de CLAUDE.md. Pero una particion es una TABLA propia en
-- `public`, y el ACL por defecto de este proyecto le da `arwdDxtm` —todo,
-- incluido escribir— a `anon` y `authenticated` sobre cada tabla nueva del
-- esquema. El RLS del padre no la cubre cuando se la consulta directo, y
-- PostgREST expone cada particion como su propio endpoint.
--
-- Medido: las 16 particiones con `relrowsecurity = false` y
-- `has_table_privilege('anon', ..., 'SELECT') = true`. El advisor de seguridad
-- paso de 0 a 16 ERRORES, todos `rls_disabled_in_public`, todos mios.
--
-- LA PARTE QUE IMPORTA no es cerrar estas 16: es que el mantenedor mensual
-- creaba particiones nuevas con el mismo agujero. Una tabla que se cierra a
-- mano y se vuelve a abrir sola cada primero de mes es peor que una abierta,
-- porque el arreglo hace creer que el problema esta resuelto. La funcion ahora
-- cierra cada particion en el mismo acto de crearla.
--
-- Se hacen las dos cosas y no una: REVOKE quita el permiso —que es lo que de
-- verdad cierra la puerta, con o sin RLS— y ENABLE RLS es la segunda linea, la
-- que sigue en pie si alguien vuelve a otorgar el permiso sin pensarlo. Leer
-- por el padre no se ve afectado: Postgres chequea el privilegio de la tabla
-- que se NOMBRA en la consulta, no el de sus particiones. Verificado con
-- `SET ROLE authenticated`: lee 13,544 filas por el padre, y con `SET ROLE anon`
-- da «permission denied» tanto por el padre como por una particion directa.

SET lock_timeout = '5s';

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.inventory_daily'::regclass
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.relname);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $do$;

-- El mantenedor, ahora cerrando lo que crea.
CREATE OR REPLACE FUNCTION public.inventory_daily_mantener_particiones()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  m date; nombre text; v_creadas int := 0; v_soltadas int := 0; v_cerradas int := 0; r record;
  v_corte date := (date_trunc('month', CURRENT_DATE) - interval '24 months')::date;
BEGIN
  -- Crear las particiones de los proximos 3 meses si faltan. Se adelanta mas de
  -- un mes a proposito: si el cron falla una vez, la escritura del dia siguiente
  -- no revienta por no tener donde ir.
  FOR m IN SELECT generate_series(date_trunc('month', CURRENT_DATE)::date,
                                  (date_trunc('month', CURRENT_DATE) + interval '3 months')::date,
                                  '1 month')::date
  LOOP
    nombre := 'inventory_daily_' || to_char(m, 'YYYYMM');
    IF to_regclass('public.' || nombre) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.inventory_daily FOR VALUES FROM (%L) TO (%L)',
        nombre, m, (m + interval '1 month')::date);
      v_creadas := v_creadas + 1;
    END IF;
  END LOOP;

  -- Cerrar TODA particion que no lo este. Va fuera del IF de arriba a proposito:
  -- asi tambien repara una que se haya creado a mano o quedado abierta por
  -- cualquier via, en vez de confiar en que el unico camino es este.
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.inventory_daily'::regclass
      AND (c.relrowsecurity = false
        OR has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT'))
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.relname);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    v_cerradas := v_cerradas + 1;
  END LOOP;

  -- Soltar lo que pasa los 24 meses. Un DROP de particion es instantaneo y no
  -- deja tuplas muertas; borrar filas de una tabla de 800 MB, si.
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'public.inventory_daily'::regclass
      AND c.relname ~ '^inventory_daily_[0-9]{6}$'
      AND to_date(right(c.relname, 6), 'YYYYMM') < v_corte
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
    v_soltadas := v_soltadas + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'creadas', v_creadas, 'cerradas', v_cerradas,
                            'soltadas', v_soltadas, 'corte', v_corte);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.inventory_daily_mantener_particiones() TO service_role;
