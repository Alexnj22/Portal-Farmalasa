-- Prueba de conexión (2026-10-21): el primer `apply_migration` de las
-- preventas falló en la herramienta («Invalid or expired requestState») sin
-- llegar a la base, y el reintento se hizo con un cuerpo vacío para comprobar
-- el canal. Quedó registrada con este nombre; el esquema real es
-- `preventas_de_reservas_esquema`, la siguiente.
SET lock_timeout = '5s';
SELECT 1;
