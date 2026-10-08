SET lock_timeout = '5s';
-- Reglamento v2, cláusula 4 (vigente 15-oct-2026): el nivel de entrada se
-- llama Bronce (antes «Cliente VIP»). Sólo el nombre: la clave sigue 'vip'
-- para no tocar lotes ni avisos, y los niveles siguen apagados
-- (`puntos_config.niveles_activos`) hasta que el reglamento se publique.
UPDATE public.puntos_niveles SET nombre = 'Bronce', updated_at = now() WHERE clave = 'vip';
