SET lock_timeout = '5s';

-- El nombre que ve el cliente: el escrito en el portal o, sin él, el del
-- catálogo sin códigos internos (1.1-, Z-T-, 3-*) ni abreviaturas de línea.
-- Laboratorios con el mismo nombre_tienda salen como uno solo en la app.
-- OJO: la columna de abajo se calcula con esto; si cambia la regla, hay que
-- recalcularla (UPDATE laboratorios SET nombre = nombre no alcanza: rehacerla).
CREATE OR REPLACE FUNCTION public.lab_nombre_tienda(p_nombre_app text, p_nombre text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(
    nullif(trim(p_nombre_app), ''),
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(trim(p_nombre), '^(Z[0-9]?-(T-)?|[0-9]+(\.[0-9]+)?\.?-)\s*', '', 'i'),
          '^\*+\s*', ''),
        '[\s.]+$', ''),
      '\s+(COSMETICOS|COSM|DIV|HIG)$', '', 'i'),
    '\s+', ' ', 'g')));
$function$;
REVOKE EXECUTE ON FUNCTION public.lab_nombre_tienda(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lab_nombre_tienda(text, text) TO authenticated, service_role;

ALTER TABLE public.laboratorios
  ADD COLUMN IF NOT EXISTS nombre_app text,
  ADD COLUMN IF NOT EXISTS nombre_tienda text GENERATED ALWAYS AS (public.lab_nombre_tienda(nombre_app, nombre)) STORED;

-- Pedido del usuario (Abbott) y el que difiere sólo en un espacio.
UPDATE public.laboratorios SET nombre_app = 'ABBOTT' WHERE id IN (3, 4, 335);
UPDATE public.laboratorios SET nombre_app = 'ASTA MEDICA - EXELTIS' WHERE id = 19;

DO $do$
DECLARE
  v text := pg_get_functiondef('public.app_catalogo(text,integer,integer)'::regprocedure);
  v_lab text := 'WHERE p.laboratorio_id = substr(v_q, 5)::integer';
  v_sel text := $t$SELECT l.id, trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', '')) AS nombre, l.foto, count(*) AS n$t$;
  v_pos text := $t$upper(public.f_unaccent(trim(regexp_replace(l.nombre, '^[0-9]+\s*-\s*', ''))))$t$;
  v_p text := pg_get_functiondef('public.app_catalogo_producto(integer)'::regprocedure);
BEGIN
  IF position(v_lab IN v) = 0 OR position(v_sel IN v) = 0 OR position(v_pos IN v) = 0 OR position('GROUP BY 1, 2, 3' IN v) = 0
     OR position($t$'laboratorio', l.nombre,$t$ IN v_p) = 0 THEN
    RAISE EXCEPTION 'las funciones cambiaron: no se encontraron los puntos esperados';
  END IF;
  v := replace(v, v_lab, 'WHERE p.laboratorio_id IN (SELECT l2.id FROM public.laboratorios l2 WHERE l2.nombre_tienda = (SELECT l3.nombre_tienda FROM public.laboratorios l3 WHERE l3.id = substr(v_q, 5)::integer))');
  v := replace(v, v_sel, 'SELECT min(l.id) AS id, l.nombre_tienda AS nombre, max(l.foto) AS foto, count(*) AS n');
  v := replace(v, v_pos, 'upper(public.f_unaccent(l.nombre_tienda))');
  v := replace(v, 'GROUP BY 1, 2, 3', 'GROUP BY 2');
  EXECUTE v;
  EXECUTE replace(v_p, $t$'laboratorio', l.nombre,$t$, $t$'laboratorio', l.nombre_tienda,$t$);
END $do$;

CREATE OR REPLACE FUNCTION public.app_catalogo_laboratorios()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('id', t.id, 'nombre', t.nombre, 'foto', t.foto) ORDER BY t.nombre), '[]'::json)
    FROM (
      SELECT min(l.id) AS id, l.nombre_tienda AS nombre, max(l.foto) AS foto
        FROM public.laboratorios l
       WHERE EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.laboratorio_id = l.id
            AND p.activo IS DISTINCT FROM false AND NOT coalesce(p.oculto_en_ventas, false)
            AND NOT EXISTS (SELECT 1 FROM public.app_catalogo_ocultos o WHERE o.product_id = p.id)
            AND EXISTS (SELECT 1 FROM public.product_precios pp WHERE pp.product_id = p.id AND pp.activo AND pp.vineta > 0))
       GROUP BY l.nombre_tienda
    ) t;
$function$;
