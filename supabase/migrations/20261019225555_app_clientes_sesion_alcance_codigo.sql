-- App de clientes: la sesión abierta con el CÓDIGO de 7 letras es LIMITADA
-- (2026-10-19, decisión del dueño tras la auditoría del mismo día).
--
-- El código viene impreso en cada ticket: lo tiene cualquiera que haya visto
-- el papel. Con DUI + teléfono se ve todo; con el código, sólo los puntos, el
-- saldo, la tarjeta, el nivel y las ofertas. El servidor (`app-clientes`)
-- decide qué acciones permite con una LISTA BLANCA leyendo esta columna.
--
-- Default 'completo' a propósito, sólo por la transición: la función vieja
-- (todavía desplegada al aplicar esto) inserta sin la columna, y casi todas
-- sus entradas son con DUI + teléfono. La función nueva escribe el valor
-- SIEMPRE. Las sesiones abiertas con código antes de hoy se reconocen por el
-- registro de intentos (`puntos_consulta_intentos` guarda la huella del
-- documento escrito: sha256('puntos:'+código)), cruzado por ficha y minuto.
SET lock_timeout = '5s';

ALTER TABLE public.app_cliente_sesiones
  ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'completo';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_cliente_sesiones_alcance_check') THEN
    ALTER TABLE public.app_cliente_sesiones
      ADD CONSTRAINT app_cliente_sesiones_alcance_check CHECK (alcance IN ('completo', 'codigo'));
  END IF;
END $$;

COMMENT ON COLUMN public.app_cliente_sesiones.alcance IS
  'completo = entró con DUI y teléfono (o se registró); codigo = entró con el código de 7 letras del ticket: sólo puntos, saldo, tarjeta, nivel y ofertas. Lo hace cumplir app-clientes (lista blanca).';

UPDATE public.app_cliente_sesiones s
   SET alcance = 'codigo'
 WHERE s.alcance <> 'codigo'
   AND s.customer_id IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM public.puntos_codigo_acceso pca
       JOIN public.puntos_consulta_intentos i
         ON i.huella_dui = left(encode(extensions.digest('puntos:' || pca.codigo, 'sha256'), 'hex'), 32)
      WHERE pca.customer_id = s.customer_id
        AND i.acerto
        AND i.created_at BETWEEN s.created_at - interval '3 minutes' AND s.created_at + interval '1 minute');
