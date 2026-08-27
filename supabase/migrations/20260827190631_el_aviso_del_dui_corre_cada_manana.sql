SET lock_timeout = '5s';

-- 13:00 UTC = 07:00 en El Salvador: el aviso esta antes de que la gente abra el
-- portal, no a media tarde cuando ya se fue a hacer otra cosa.
--
-- Diario y no semanal a proposito: la ventana es de 30 dias y el freno de
-- `metadata` impide que el mismo aviso salga dos veces, asi que correr todos los
-- dias no cuesta un aviso de mas — cuesta que alguien espere una semana para
-- enterarse de que su documento ya vencio.
--
-- No sale a la red: es SQL puro contra la propia base, asi que su costo por
-- corrida es CERO peticiones al sistema de origen. Declarado asi en la constante
-- `CRONS` de `scripts/eficiencia-gate.mjs`.
SELECT cron.schedule(
    'avisar-dui-por-vencer-diario',
    '0 13 * * *',
    $$ SELECT public.avisar_dui_por_vencer() $$
);
