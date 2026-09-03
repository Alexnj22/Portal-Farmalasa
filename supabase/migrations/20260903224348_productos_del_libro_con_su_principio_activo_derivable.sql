SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El principio activo, SÓLO donde el nombre lo dice.
--
-- `products.principio_activo` es lo único que deja comprobar por molécula que un
-- producto está en el libro que le toca. Sin él, la única defensa es acertarle
-- al nombre comercial — y acertarle al nombre ya falló: la primera corrida de
-- `gate:receta` acusó a BACTIVANZ 300 de ser claritromicina, y su principio
-- activo dice CEFDINIR.
--
-- Por eso acá se llena **sólo lo que el propio nombre declara**: o el genérico
-- está escrito en el nombre, o viene entre paréntesis. Las marcas que no lo
-- dicen —AXTAR, DENVAR, KOPTIN, ELEQUINE, UNICIL…— NO se completan a ojo:
-- quedan como deuda declarada en `scripts/receta-baseline.json`, que sólo baja.
-- Un principio activo inventado es peor que uno ausente: el ausente se ve.
--
-- No toca ninguna fila que ya tenga el dato, y `sync-products` no escribe esta
-- columna, así que no se pisa con el ERP.
--
-- Medido: 62 → 47 productos del libro sin principio activo.
-- ═══════════════════════════════════════════════════════════════════════════

WITH reglas(patron, activo) AS (VALUES
    ('azitromicin',  'AZITROMICINA'),
    ('claritromicin','CLARITROMICINA'),
    ('levofloxacin', 'LEVOFLOXACINA'),
    ('levofloxacino','LEVOFLOXACINA'),
    ('moxifloxacin', 'MOXIFLOXACINA'),
    ('norfloxacin',  'NORFLOXACINA'),
    ('cefixima',     'CEFIXIMA'),
    ('ceftriaxona',  'CEFTRIAXONA'),
    ('gentamicina',  'GENTAMICINA'),
    ('amikacina',    'AMIKACINA'),
    ('clindamicina', 'CLINDAMICINA'),
    ('ranitidina',   'RANITIDINA')
)
UPDATE public.products p
   SET principio_activo = r.activo
  FROM reglas r
 WHERE coalesce(btrim(p.principio_activo), '') = ''
   AND p.nombre ~* r.patron
   AND EXISTS (
       SELECT 1 FROM public.dispensacion_clases dc WHERE dc.erp_product_id = p.id
       UNION ALL
       SELECT 1 WHERE p.es_antibiotico
   );
