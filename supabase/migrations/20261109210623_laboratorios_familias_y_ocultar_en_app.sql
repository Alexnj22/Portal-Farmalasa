SET lock_timeout = '5s';

ALTER TABLE public.laboratorios ADD COLUMN IF NOT EXISTS ocultar_en_app boolean NOT NULL DEFAULT false;

-- Familias y categorías: en la app queda sólo la marca (pedido del usuario, 2026-11-09).
UPDATE public.laboratorios t SET nombre_app = m.nombre
  FROM (VALUES
    (96,'GSK'),(97,'GSK'),(95,'GSK'),(25,'BAYER'),(146,'MERCK'),(346,'MERCK'),(205,'SANOFI'),
    (239,'VIJOSA'),(240,'VIJOSA'),(379,'VIJOSA'),(227,'TERAMED'),(301,'TERAMED'),(253,'OLIMPO'),
    (295,'BK'),(50,'CUSCATLAN'),(310,'SALUFARMA'),(218,'STEIN'),(299,'SUIZOS'),(315,'ZEPOL'),
    (296,'LILLY'),(251,'NOVO NORDISK'),(289,'PISA'),(303,'SANOFI'),
    (302,'DUREX'),(342,'MEDITECH'),(5,'PASMO'),(60,'DUREX'),(167,'PASMO'),(176,'PIEL'),(229,'UNIDUS'),
    (269,'AINSA'),(9,'AINSA'),(267,'ARSAL'),(258,'FRYCIA'),(313,'GENOMMA LAB'),(309,'HESSEL ANCALMO'),(179,'PISA'),
    (127,'DIST LOPEZ'),(58,'DIST LOPEZ'),(308,'SANTA ELENA'),(292,'MEDITECH'),(348,'PHARMATOR'),(59,'DSL'),
    (263,'B. BRAUN'),(276,'FERSON'),(307,'HESSEL ANCALMO'),(268,'BIOGALENIC'),(32,'BONIN'),(246,'WELLPRO'),(26,'BD')
  ) AS m(id, nombre)
 WHERE t.id = m.id;

-- No son laboratorios: fuera de las listas; sus productos siguen a la venta.
UPDATE public.laboratorios SET ocultar_en_app = true
 WHERE id IN (279, 280, 110, 336, 333, 234, 281, 228, 191, 340, 30, 180, 249);

DO $do$
DECLARE
  v text := pg_get_functiondef('public.app_catalogo(text,integer,integer)'::regprocedure);
  v_p text := pg_get_functiondef('public.app_catalogo_producto(integer)'::regprocedure);
  v_l text := pg_get_functiondef('public.app_catalogo_laboratorios()'::regprocedure);
  a1 text := E'JOIN public.laboratorios l ON l.id = p.laboratorio_id\n         GROUP BY 2';
  a2 text := $t$WHERE position(' ' || upper(public.f_unaccent(v_q))$t$;
  a3 text := $t$'laboratorio', l.nombre_tienda,$t$;
BEGIN
  IF position(a1 IN v) = 0 OR position(a2 IN v) = 0 OR position(a3 IN v_p) = 0 OR position('WHERE EXISTS (' IN v_l) = 0 THEN
    RAISE EXCEPTION 'las funciones cambiaron: no se encontraron los puntos esperados';
  END IF;
  v := replace(v, a1, E'JOIN public.laboratorios l ON l.id = p.laboratorio_id\n         WHERE NOT l.ocultar_en_app\n         GROUP BY 2');
  v := replace(v, a2, $t$WHERE NOT l.ocultar_en_app AND position(' ' || upper(public.f_unaccent(v_q))$t$);
  EXECUTE v;
  EXECUTE replace(v_p, a3, $t$'laboratorio', CASE WHEN l.ocultar_en_app THEN NULL ELSE l.nombre_tienda END,$t$);
  EXECUTE replace(v_l, 'WHERE EXISTS (', 'WHERE NOT l.ocultar_en_app AND EXISTS (');
END $do$;
