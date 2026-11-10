SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Un solo cron por minuto para los que sólo ENCOLAN una llamada HTTP
-- (docs/PLAN-MEMORIA-DE-LA-BASE-2026-11-10.md, fase 2a)
--
-- Cada corrida de pg_cron abre un proceso nuevo de la base, que carga el
-- catálogo (1.580 funciones, 490 tablas) antes de hacer nada: medido, el vigía
-- del chat tarda 1 ms en la función y ~170 ms en el cron. Con ~14 corridas por
-- minuto en el segundo :00, ése era el pico de memoria de cada minuto en un
-- servidor de 2 GB que vivía en swap.
--
-- `cron_tick_minuto()` corre, en UN proceso, el comando de cada trabajo de la
-- lista LEYÉNDOLO DE SU PROPIA FILA de cron.job, con el horario de esa fila. No
-- se copia ningún comando (ni el URL, ni el cuerpo, ni de qué secreto de la
-- bóveda sale el encabezado): la fila sigue siendo la única fuente de verdad.
--
-- El freno contra la doble corrida: si la fila de un trabajo está ACTIVA, el
-- despachador NO la corre — la corre pg_cron como siempre. Por eso el cambio es
-- seguro en cualquier orden y deshacerlo es reactivar las filas
-- (`UPDATE cron.job SET active = true WHERE jobname IN (...)`).
--
-- Sólo entran trabajos que únicamente encolan con net.http_post (asíncrono:
-- el HTTP lo hace después el worker de pg_net). Los que hacen trabajo en la
-- base (chat, bitácora) siguen con su propio cron y su propio registro.
-- ─────────────────────────────────────────────────────────────────────────────

-- ¿El momento `p_t` cae dentro del horario cron `p_horario`? Cinco campos
-- (minuto hora día mes día-de-semana) con `*`, `*/n`, `a`, `a-b`, `a-b/n` y
-- listas con coma: lo que usa pg_cron. Lo que no entiende devuelve NULL, y el
-- despachador lo trata como «no corre» y lo reporta.
CREATE OR REPLACE FUNCTION public.cron_horario_coincide(p_horario text, p_t timestamptz)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public, extensions
AS $function$
DECLARE
  v_campos text[] := regexp_split_to_array(btrim(p_horario), '\s+');
  v_valores int[];
  v_lim int[][] := ARRAY[[0,59],[0,23],[1,31],[1,12],[0,6]];
  i int; v_parte text; v_ok boolean; v_rango text; v_paso int; v_a int; v_b int; m text[];
BEGIN
  IF array_length(v_campos, 1) IS DISTINCT FROM 5 THEN RETURN NULL; END IF;
  -- Con día del mes Y día de la semana restringidos, cron los combina con O;
  -- acá se combinarían con Y. Antes que equivocarse, no lo entiende.
  IF v_campos[3] <> '*' AND v_campos[5] <> '*' THEN RETURN NULL; END IF;
  v_valores := ARRAY[extract(minute FROM p_t AT TIME ZONE 'UTC')::int,
                     extract(hour   FROM p_t AT TIME ZONE 'UTC')::int,
                     extract(day    FROM p_t AT TIME ZONE 'UTC')::int,
                     extract(month  FROM p_t AT TIME ZONE 'UTC')::int,
                     extract(dow    FROM p_t AT TIME ZONE 'UTC')::int];
  FOR i IN 1..5 LOOP
    v_ok := false;
    FOREACH v_parte IN ARRAY string_to_array(v_campos[i], ',') LOOP
      m := regexp_match(v_parte, '^(\*|\d+|\d+-\d+)(?:/(\d+))?$');
      IF m IS NULL THEN RETURN NULL; END IF;
      v_rango := m[1]; v_paso := coalesce(m[2]::int, 1);
      IF v_paso < 1 THEN RETURN NULL; END IF;
      IF v_rango = '*' THEN
        v_a := v_lim[i][1]; v_b := v_lim[i][2];
      ELSIF position('-' IN v_rango) > 0 THEN
        v_a := split_part(v_rango, '-', 1)::int; v_b := split_part(v_rango, '-', 2)::int;
      ELSE
        v_a := v_rango::int;
        -- `5/10` (sin rango) en cron significa «desde 5, cada 10».
        v_b := CASE WHEN m[2] IS NULL THEN v_a ELSE v_lim[i][2] END;
      END IF;
      IF v_valores[i] BETWEEN v_a AND v_b AND (v_valores[i] - v_a) % v_paso = 0 THEN
        v_ok := true; EXIT;
      END IF;
    END LOOP;
    IF NOT v_ok THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cron_horario_coincide(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_horario_coincide(text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.cron_tick_minuto()
 RETURNS json
 LANGUAGE plpgsql
 SET search_path = public, extensions
AS $function$
DECLARE
  -- El orden es el de ejecución. Agregar uno: que sólo encole con net.http_post,
  -- sumarlo acá, apagar su fila y marcarlo `via: 'tick-minuto'` en el manifiesto
  -- de gate:eficiencia.
  c_trabajos CONSTANT text[] := ARRAY[
    'sync-dte-inv-all-1min', 'puntos-motor-1min', 'refresh-inv-mv-2min',
    'conteo-caja-cada-minuto', 'continuar-traslados-pedido',
    'avisos-clientes-minuto', 'wallet-pases-minuto'];
  -- now() es el arranque de la transacción: el minuto en que pg_cron disparó.
  v_t timestamptz := now();
  r record;
  v_res jsonb := '{}'::jsonb;
  v_coincide boolean;
BEGIN
  -- Falla segura en el entorno de pruebas: allá las siete filas están APAGADAS
  -- (las apaga la semilla 20260903185033 y mantener_al_dia.mjs porque llaman a
  -- producción), así que el freno de «activa = corre aparte» no las protege. Se
  -- despacha sólo en una base con la llave para llamar afuera — el mismo
  -- criterio que usa esa semilla.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'admin_invoke_secret'
                    AND coalesce(length(decrypted_secret), 0) > 20) THEN
    RETURN json_build_object('sin_llave', true);
  END IF;

  -- Ningún trabajo puede quedarse esperando un lock y atrasar a los demás.
  PERFORM set_config('lock_timeout', '5s', true);

  FOR r IN
    SELECT t.nombre, j.schedule, j.command, j.active
      FROM unnest(c_trabajos) WITH ORDINALITY AS t(nombre, orden)
      LEFT JOIN cron.job j ON j.jobname = t.nombre
     ORDER BY t.orden
  LOOP
    IF r.command IS NULL THEN
      v_res := v_res || jsonb_build_object(r.nombre, 'no_existe');
      RAISE WARNING 'tick-minuto: el trabajo % no existe en cron.job', r.nombre;
      CONTINUE;
    END IF;
    IF r.active THEN
      -- Lo corre pg_cron por su cuenta: correrlo acá sería la doble corrida.
      v_res := v_res || jsonb_build_object(r.nombre, 'corre_aparte');
      CONTINUE;
    END IF;
    v_coincide := public.cron_horario_coincide(r.schedule, v_t);
    IF v_coincide IS NULL THEN
      v_res := v_res || jsonb_build_object(r.nombre, 'horario_no_entendido');
      RAISE WARNING 'tick-minuto: no entiendo el horario «%» de %', r.schedule, r.nombre;
      CONTINUE;
    END IF;
    IF NOT v_coincide THEN
      v_res := v_res || jsonb_build_object(r.nombre, 'fuera_de_horario');
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE r.command;
      v_res := v_res || jsonb_build_object(r.nombre, 'ok');
    EXCEPTION WHEN OTHERS THEN
      -- Se deshace SÓLO este trabajo; los demás corren igual.
      v_res := v_res || jsonb_build_object(r.nombre, 'error: ' || left(SQLERRM, 200));
      RAISE WARNING 'tick-minuto: % falló: %', r.nombre, SQLERRM;
    END;
  END LOOP;
  RETURN v_res::json;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cron_tick_minuto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_tick_minuto() TO service_role;

-- El despachador. Mientras las siete filas sigan activas, no hace nada.
-- El comentario del comando NO es decoración: nombra `net.http_post` y el
-- proyecto de producción para que las dos herramientas del entorno de pruebas
-- que apagan «los crons que llaman a producción» (la semilla 20260903185033 y
-- mantener_al_dia.mjs) también apaguen éste.
SELECT cron.schedule('tick-minuto', '* * * * *',
  'SELECT public.cron_tick_minuto() -- despacha net.http_post hacia https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1 (ver cron_tick_minuto)')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tick-minuto');
