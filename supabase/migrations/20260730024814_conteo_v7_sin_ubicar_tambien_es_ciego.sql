-- Conteo ciego: "No ubicados" filtra tanto como "Con diferencia".
--
-- v2.231.0 neutralizó el filtro DIFERENCIA para quien no tiene
-- `conteo_ver_sistema`, con el razonamiento de que filtrar por diferencia
-- SEÑALA exactamente las líneas que descuadran aunque no muestre un número. El
-- mismo argumento vale para SIN_UBICAR y se pasó por alto: un renglón marcado
-- "no ubicado" es físico 0 sobre una línea que el ERP dice que tiene stock, o
-- sea un faltante confirmado. Filtrar por él es pedirle a la base la lista de
-- faltantes sin la cifra — que es justo lo que el ciego evita.
--
-- Las cuatro RPCs que aceptan `p_filtro` se parchean con una transformación
-- sobre `pg_get_functiondef` en vez de retranscribir cuatro cuerpos largos: el
-- riesgo de una migración de 300 líneas copiadas a mano es equivocarse en una
-- que no es la que se quería cambiar. El ancla se verifica y **la migración
-- revienta** si no aparece o si no son exactamente 4 funciones — un replace que
-- no encuentra nada y sigue en silencio es peor que un error.
--
-- `CREATE OR REPLACE` preserva los GRANT, así que no hay que reaplicarlos.
SET lock_timeout = '5s';

DO $do$
DECLARE
  f record;
  nueva text;
  n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.proname IN ('get_conteo_products_page', 'get_conteo_products_count',
                        'get_conteo_items_search',  'get_conteo_items_count')
  LOOP
    nueva := replace(f.def,
      'p_filtro = ''DIFERENCIA'' AND NOT',
      'p_filtro IN (''DIFERENCIA'', ''SIN_UBICAR'') AND NOT');

    IF nueva = f.def THEN
      RAISE EXCEPTION 'No encontré el predicado del ciego en %(): el cuerpo cambió y este parche ya no aplica', f.proname;
    END IF;

    EXECUTE nueva;
    n := n + 1;
  END LOOP;

  IF n <> 4 THEN
    RAISE EXCEPTION 'Esperaba parchear 4 funciones y parcheé %', n;
  END IF;
END
$do$;
