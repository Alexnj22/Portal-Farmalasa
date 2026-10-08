SET lock_timeout = '5s';
-- Decisión del usuario (2026-10-08): se retiran las raspables entregadas antes
-- de que el Reglamento v2 se publique (41 lotes, 8,300 puntos, ninguno usado)
-- y se apaga la entrega a domicilio («por ahora sólo retiro en tienda»).
WITH cup AS (
  SELECT id, customer_id, puntos FROM public.puntos_lote
   WHERE origen = 'cupon' AND restantes = puntos
     AND NOT EXISTS (SELECT 1 FROM public.puntos_salida_lote sl WHERE sl.lote_id = puntos_lote.id)
), por_cliente AS (
  SELECT customer_id, sum(puntos) AS p FROM cup GROUP BY 1
), cuentas AS (
  UPDATE public.puntos_cuenta c SET saldo = c.saldo - pc.p, ganados = c.ganados - pc.p, updated_at = now()
    FROM por_cliente pc WHERE c.customer_id = pc.customer_id RETURNING c.customer_id
)
DELETE FROM public.puntos_lote l USING cup WHERE l.id = cup.id;

INSERT INTO public.audit_logs (action, target_id, details, source)
VALUES ('PUNTOS_RASPABLES_RETIRADAS', 'puntos_lote',
        jsonb_build_object('motivo', 'Reglamento v2 sin publicar', 'lotes', 41, 'puntos', 8300), 'SYSTEM');

UPDATE public.app_ajustes SET envio_activo = false, updated_at = now() WHERE id;
