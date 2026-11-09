SET lock_timeout = '5s';
-- La foto de cada laboratorio para la fila de la Tienda (app de clientes).
-- Se guarda la URL pública del bucket product-photos, ruta laboratorios/<id>.jpg.
ALTER TABLE public.laboratorios ADD COLUMN IF NOT EXISTS foto text;
-- Se parte de la definición VIVA de app_catalogo: sólo cambia la lista de laboratorios.
DO $do$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef('public.app_catalogo(text,integer,integer)'::regprocedure) INTO d;
  n := replace(replace(replace(d,
    $a$json_build_object('id', id, 'nombre', nombre)$a$, $a$json_build_object('id', id, 'nombre', nombre, 'foto', foto)$a$),
    $a$AS nombre, count(*) AS n$a$, $a$AS nombre, l.foto, count(*) AS n$a$),
    $a$GROUP BY 1, 2$a$, $a$GROUP BY 1, 2, 3$a$);
  IF n = d OR n NOT LIKE '%l.foto%' OR n NOT LIKE '%GROUP BY 1, 2, 3%' OR n NOT LIKE $a$%'foto', foto)%$a$ THEN
    RAISE EXCEPTION 'app_catalogo no tiene la forma esperada';
  END IF;
  EXECUTE n;
END $do$;
