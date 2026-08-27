-- La cuenta de pruebas ve los montos de bolsas, o la pestaña no se puede probar.
--
-- Descubierto abriendo `/bolsas?tab=finalizadas` en produccion el 2026-08-26: el
-- cargo «QA / Testing (CI)» tiene `bolsas` y `bolsas_conteo`, y NO tiene
-- `bolsas_ver_montos`. Tres de los cuatro bloques de esa pestaña van detras de
-- ese permiso —Conteos, Depositos al banco y la tarjeta de «contado y sin
-- cerrar»—, asi que la cuenta con la que corre todo el barrido automatico ve
-- **una sola linea plegada** donde hay una pantalla entera.
--
-- O sea que ningun test ha visto nunca esta vista. No es que fallara: es que la
-- medicion se hacia sobre una pantalla vacia y salia en verde, que es el mismo
-- modo de falla que dejo al barrido de escritorio midiendo el login 37 veces.
-- Ver [[feedback_un_gate_que_no_pudo_medir_no_puede_dar_verde]].
--
-- El cargo lo usa UNA sola ficha —la de QA, `tipo_ficha` de prueba, que ya esta
-- fuera de planilla, vacaciones, horarios y del conteo de personal— y ninguna
-- persona. Darle este permiso no le abre nada a nadie: le abre la pantalla al
-- instrumento que tiene que mirarla.
--
-- `can_view` y NO `can_edit`: el barrido MIRA. Escribir el efectivo de la
-- empresa desde una corrida automatica es exactamente lo que la lista de freno
-- de `dialogos-movil` existe para impedir — abrir no puede escribir.

SET lock_timeout = '5s';

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r.id, 'bolsas_ver_montos', true, false, 'ALL'
  FROM public.roles r
 WHERE r.name = 'QA / Testing (CI)'
   -- Idempotente y acotado: si alguien ya se lo dio a mano, no lo pisa.
   AND NOT EXISTS (
       SELECT 1 FROM public.role_permissions rp
        WHERE rp.role_id = r.id AND rp.module_key = 'bolsas_ver_montos');
