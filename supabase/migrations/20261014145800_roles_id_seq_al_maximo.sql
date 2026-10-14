SET lock_timeout = '5s';
-- 20261001165249_marketing_planificador insertó el cargo 38 con id explícito
-- sin mover la secuencia: el siguiente cargo del portal chocaba con roles_pkey.
-- Sólo sube, nunca baja.
SELECT setval('public.roles_id_seq', greatest((SELECT max(id) FROM public.roles), (SELECT last_value FROM public.roles_id_seq)));
