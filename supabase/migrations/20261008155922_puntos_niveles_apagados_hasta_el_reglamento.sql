SET lock_timeout = '5s';
-- Los niveles se apagan hasta que el Reglamento v2 esté firmado y publicado
-- (decisión del usuario, 2026-10-08). Desde el 2026-10-07 la acumulación ya
-- multiplicaba por nivel y el cron entregaba la raspable: eso no estaba
-- anunciado a los clientes.
--
-- UN interruptor: `puntos_config.niveles_activos`. Apagado, `puntos_nivel_de`
-- devuelve siempre el nivel de entrada, y con él acumular (×1), cumpleaños
-- (el monto base), cupones (ninguno) y reservas (24 h) vuelven a lo de antes.
-- Encenderlo es una fila, no una migración.
ALTER TABLE public.puntos_config ADD COLUMN IF NOT EXISTS niveles_activos boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.puntos_nivel_de(p_compra numeric)
 RETURNS puntos_niveles
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT n.* FROM public.puntos_niveles n
   WHERE n.desde <= CASE WHEN coalesce((SELECT c.niveles_activos FROM public.puntos_config c LIMIT 1), false)
                         THEN coalesce(p_compra, 0) ELSE 0 END
   ORDER BY n.desde DESC LIMIT 1;
$function$;

-- Los puntos de más que dio el multiplicador vuelven a lo normal (1 por $1).
-- Sólo lotes intactos (nada gastado): 23 lotes, 109 puntos, medidos antes de
-- aplicar. Sin `puntos_salida`: no es un canje ni un ajuste que avisar, es
-- deshacer un cálculo que no debía correr.
WITH extra AS (
  SELECT id, customer_id, puntos - puntos_base AS x FROM public.puntos_lote
   WHERE origen = 'venta' AND puntos_base IS NOT NULL AND puntos > puntos_base AND restantes = puntos
), lotes AS (
  UPDATE public.puntos_lote l SET puntos = l.puntos - e.x, restantes = l.restantes - e.x, nivel = 'vip'
    FROM extra e WHERE l.id = e.id RETURNING l.id
), por_cliente AS (
  SELECT customer_id, sum(x) AS x FROM extra GROUP BY 1
)
UPDATE public.puntos_cuenta c SET saldo = c.saldo - p.x, ganados = c.ganados - p.x, updated_at = now()
  FROM por_cliente p WHERE c.customer_id = p.customer_id;

INSERT INTO public.audit_logs (action, target_id, details, source)
VALUES ('PUNTOS_NIVELES_REVERTIDOS', 'puntos_lote',
        jsonb_build_object('motivo', 'Multiplicador por nivel apagado hasta el Reglamento v2', 'lotes', 23, 'puntos', 109), 'SYSTEM');
