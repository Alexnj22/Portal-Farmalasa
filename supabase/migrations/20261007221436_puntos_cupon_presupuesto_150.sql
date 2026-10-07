SET lock_timeout = '5s';
-- Con Oro dentro, el valor esperado es ~10,430 puntos al mes (34 Oro × 195 +
-- 8 Platino × 475) y el tope de 10,000 dejaba a 4 fuera. Tope: 15,000 ($150).
UPDATE public.puntos_config SET cupon_presupuesto_mensual = 15000 WHERE id;
