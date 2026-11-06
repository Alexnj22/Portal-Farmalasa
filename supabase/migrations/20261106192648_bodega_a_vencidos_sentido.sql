SET lock_timeout = '5s';

-- El mismo registro sirve para el camino inverso: lo que está en vencidos y
-- se puede vender vuelve al estante (usuario, 2026-11-06: «si hay algún
-- producto enviado por error, y debe volver para venderla»). `sentido` dice
-- cuál de los dos fue; los motivos de la vuelta son otros.
ALTER TABLE public.bodega_a_vencidos
  ADD COLUMN sentido text NOT NULL DEFAULT 'a_vencidos' CHECK (sentido IN ('a_vencidos', 'al_estante')),
  DROP CONSTRAINT bodega_a_vencidos_motivo_check,
  ADD CONSTRAINT bodega_a_vencidos_motivo_check CHECK (
    (sentido = 'a_vencidos' AND motivo IN ('proximo_a_vencer', 'vencido', 'danado', 'devolucion', 'retiro', 'otro'))
    OR (sentido = 'al_estante' AND motivo IN ('error', 'buen_estado', 'otro'))
  );
