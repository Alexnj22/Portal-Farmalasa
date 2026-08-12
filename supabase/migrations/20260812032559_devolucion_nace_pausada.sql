SET lock_timeout = '5s';

-- La devolución nace PAUSADA, y se despausa a mano.
--
-- Es una escritura contra inventario real que nunca se ejercitó: hasta hoy el
-- único viaje sala → Bodega probado de verdad fue el guion de rollback del
-- 2026-08-11, a mano y sobre 3 productos elegidos. Estrenar eso con el primer
-- pedido que aparezca es exactamente lo que no se hace.
--
-- El freno va acá y no en una constante del navegador a propósito: una pantalla
-- vieja en la pestaña de alguien seguiría llamando igual, y este interruptor lo
-- lee la propia función antes de tocar nada. Se levanta desde Mantenimiento
-- cuando la prueba controlada esté hecha.
UPDATE public.traslado_interruptor
   SET pausado = true,
       motivo  = 'Sin estrenar: falta la prueba controlada contra existencias reales.',
       cambiado_at = now()
 WHERE accion IN ('devolver_enviar', 'devolver_recibir');
