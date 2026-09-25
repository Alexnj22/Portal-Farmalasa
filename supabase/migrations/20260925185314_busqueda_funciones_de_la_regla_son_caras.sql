-- Las funciones de la regla que corren POR FILA se declaran caras, para que el
-- planificador las evalúe DESPUÉS del prefiltro barato y no antes.
--
-- Medido en el conteo (3,407 renglones): con el costo por defecto (100),
-- `busqueda_coincide` empataba con la expresión del prefiltro —que también
-- llama a una función (`f_unaccent`)— y el planificador la ponía PRIMERO: se
-- evaluaba sobre los 3,407 renglones en vez de sobre los 13 que pasan el
-- `LIKE`. 230 ms contra ~35.
SET lock_timeout = '5s';

ALTER FUNCTION public.busqueda_coincide(jsonb, text) COST 10000;
ALTER FUNCTION public.busqueda_puntaje(jsonb, text[], text[]) COST 5000;
ALTER FUNCTION public.busqueda_parecido(jsonb, text[], text[]) COST 20000;
