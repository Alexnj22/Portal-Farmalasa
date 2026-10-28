SET lock_timeout = '5s';
-- Bitácoras: las lecturas de temperatura de las salas a MEDIA MAÑANA y MEDIA
-- TARDE (RTS 6.2.16, Guía 2.27). Eran 07–09 / 12–14 / 17–19: la de las 7 es la
-- más fresca del día y la de 17–19 cae al final de la tarde. Ahora
-- 09:30–11:00 / 12:00–14:00 / 14:30–16:00. Visto bueno del usuario 2026-10-28.
-- Las CLAVES (m, d, t) no cambian: atan cada lectura a su franja. Sólo las
-- áreas que tenían el horario viejo; la Bodega central (08–10 / 15–17) queda.
UPDATE public.bitacora_areas a
   SET franjas = (
     SELECT jsonb_agg(CASE f->>'clave'
                        WHEN 'm' THEN f || '{"desde":"09:30","hasta":"11:00"}'
                        WHEN 't' THEN f || '{"desde":"14:30","hasta":"16:00"}'
                        ELSE f END ORDER BY o)
       FROM jsonb_array_elements(a.franjas) WITH ORDINALITY x(f, o))
 WHERE a.activa
   AND a.franjas @> '[{"clave":"m","desde":"07:00","hasta":"09:00"},{"clave":"t","desde":"17:00","hasta":"19:00"}]';
