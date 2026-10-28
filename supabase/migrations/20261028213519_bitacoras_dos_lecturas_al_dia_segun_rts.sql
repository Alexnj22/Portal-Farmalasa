SET lock_timeout = '5s';
-- Temperatura y humedad: DOS lecturas al día, como pide la norma (RTS
-- 11.02.04:24 §6.2.16 y Guía BPAD 2.27: «al menos dos veces al día, a media
-- mañana y a media tarde»). Decisión del usuario, 2026-10-28: «aplícalo según
-- lo que necesita la SRS». Se quita la franja de mediodía (clave `d`), que la
-- norma no pide. Las lecturas de mediodía de octubre (mes de prueba) quedan en
-- la tabla; la hoja impresa ya no las muestra.
UPDATE public.bitacora_areas
   SET franjas = (SELECT coalesce(jsonb_agg(f ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(franjas) WITH ORDINALITY AS x(f, ord)
                   WHERE f->>'clave' <> 'd')
 WHERE franjas @> '[{"clave":"d"}]'::jsonb;
