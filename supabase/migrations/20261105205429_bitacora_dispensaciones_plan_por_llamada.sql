SET lock_timeout = '5s';
-- Desde la sexta llamada de cada conexión, el plan genérico recorría todas las
-- líneas de factura del rango (24K bloques, 47 ms) para hallar ~23; con los
-- valores entra por los ~86 productos que van al libro (5.5K bloques, 13 ms).
-- Corre cada minuto. El cuerpo no cambia.
ALTER FUNCTION public.sincronizar_bitacora_dispensaciones(date, date, bigint)
  SET plan_cache_mode = 'force_custom_plan';
