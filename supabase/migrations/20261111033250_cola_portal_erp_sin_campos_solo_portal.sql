-- La cola portal→ERP deja afuera los campos que sólo existen en el portal
-- (2026-11-10). `notes` no tiene equivalente en la ficha del ERP: el push lo
-- anota como «solo existe en el portal» y no salda la entrada, así que la
-- ficha 20434 (dos entradas del 2026-10-02) volvía a la cola en cada pasada
-- del cron `drain-cliente-erp-queue` y costaba un login + una lectura de la
-- ficha cada 10 minutos — 288 peticiones al día durante 40 días, para nada.
--
-- No se descartan ni se marcan como enviadas: no viajaron y no perdieron una
-- carrera. Salen de la cola y quedan en `excluidos` con su motivo, igual que
-- las fichas sin emparejar. La lista es la gemela de `SOLO_PORTAL` en
-- `supabase/functions/push-cliente-erp/index.ts`: se mueven juntas.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cola_espejo_portal_erp(p_limite integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- Pendiente = no viajó al ERP y no fue descartada. Lo segundo lo escribe el
-- espejo cuando el campo pierde una carrera (`aplicar_espejo_erp`), y antes se
-- recalculaba acá cruzando contra `espejo_conflictos`. El cruce tenía dos
-- defectos: dejaba la entrada "pendiente" para siempre —así que el espejo la
-- volvía a descartar en cada corrida y el badge de la bitácora no se apagaba
-- nunca— y bloqueaba el campo de por vida, incluso para una edición hecha
-- DESPUÉS de la carrera perdida, que es intención nueva y sí tiene que viajar.
--
-- Los campos que sólo existen en el portal (`notes`, gemelo de `SOLO_PORTAL`
-- en push-cliente-erp) no entran a la cola: el ERP no los puede recibir y la
-- entrada volvía en cada pasada. Van a `excluidos` con su motivo.
WITH pend AS (
    SELECT cl.id, cl.customer_id, cl.campo, cl.valor_nuevo, cl.changed_at
    FROM public.customers_changelog cl
    WHERE cl.erp_synced_at IS NULL AND cl.descartado_at IS NULL
), listos AS (
    SELECT p.* FROM pend p
    JOIN public.customers c ON c.id = p.customer_id
    WHERE c.erp_id IS NOT NULL
      AND p.campo NOT IN ('notes')
), ultimo AS (
    SELECT DISTINCT ON (customer_id, campo) customer_id, campo, valor_nuevo
    FROM listos ORDER BY customer_id, campo, changed_at DESC, id DESC
), agrupado AS (
    SELECT u.customer_id, u.campo, u.valor_nuevo,
           (SELECT array_agg(l.id ORDER BY l.id) FROM listos l
            WHERE l.customer_id = u.customer_id AND l.campo = u.campo) AS changelog_ids
    FROM ultimo u
), por_cliente AS (
    SELECT a.customer_id, c.erp_id, c.name,
           json_agg(json_build_object(
               'campo', a.campo, 'valor', a.valor_nuevo,
               'changelog_ids', a.changelog_ids) ORDER BY a.campo) AS cambios
    FROM agrupado a JOIN public.customers c ON c.id = a.customer_id
    GROUP BY a.customer_id, c.erp_id, c.name
    ORDER BY a.customer_id
    LIMIT p_limite
)
SELECT json_build_object(
  'cola', coalesce((SELECT json_agg(to_json(t)) FROM por_cliente t), '[]'::json),
  -- Nada desaparece en silencio: lo que no se puede empujar se dice y por qué.
  -- Son tres motivos distintos y conviene no confundirlos: una ficha sin
  -- emparejar (se arregla emparejándola), un campo que el ERP no tiene, y una
  -- decisión ya tomada.
  'excluidos', coalesce((
     SELECT json_agg(to_json(x)) FROM (
        SELECT p.customer_id, c.name, p.campo, count(*) AS entradas,
               'sin erp_id: la ficha del portal no está emparejada con el ERP' AS motivo
        FROM pend p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE c.erp_id IS NULL
        GROUP BY p.customer_id, c.name, p.campo
        UNION ALL
        SELECT p.customer_id, c.name, p.campo, count(*),
               'solo existe en el portal: el ERP no tiene ese campo'
        FROM pend p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE c.erp_id IS NOT NULL AND p.campo IN ('notes')
        GROUP BY p.customer_id, c.name, p.campo
        UNION ALL
        SELECT d.customer_id, c.name, d.campo, count(*),
               'descartado: el ERP ya se movió más allá de este campo'
        FROM public.customers_changelog d
        JOIN public.customers c ON c.id = d.customer_id
        WHERE d.erp_synced_at IS NULL AND d.descartado_at IS NOT NULL
        GROUP BY d.customer_id, c.name, d.campo
     ) x), '[]'::json)
);
$function$;
