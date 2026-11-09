SET lock_timeout = '5s';

-- El buscador de la Tienda no miraba el laboratorio: «MENARINI» daba 0 de 114
-- productos. Se parte de la definición viva y sólo cambia ese argumento.
DO $$
DECLARE v_def text := pg_get_functiondef('public.app_catalogo(text,integer,integer)'::regprocedure);
BEGIN
  IF position('buscar_productos_ids(v_q, 200, true, false, true)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'app_catalogo cambió: no se encontró la llamada esperada';
  END IF;
  EXECUTE replace(v_def, 'buscar_productos_ids(v_q, 200, true, false, true)', 'buscar_productos_ids(v_q, 200, true, true, true)');
END $$;
