SET lock_timeout = '5s';
-- Oro también recibe cupón raspable (2026-10-07): premios más chicos que
-- Platino. Valor esperado: 100×50% + 200×35% + 500×15% = 195 puntos ($1.95).
UPDATE public.puntos_niveles
   SET cupon_mensual = 200,
       cupon_premios = '[{"puntos":100,"peso":50},{"puntos":200,"peso":35},{"puntos":500,"peso":15}]'::jsonb
 WHERE clave = 'oro';
