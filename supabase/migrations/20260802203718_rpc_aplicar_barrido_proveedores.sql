SET lock_timeout = '5s';

-- E4 del PLAN-CONTABILIDAD-2026-08-02: primera version del RPC que aplica el
-- maestro de proveedores del ERP.
--
-- LA REGLA, y es la que hace que esto sea seguro: **el ERP solo llena lo que el
-- portal no tiene.** Nunca pisa un dato existente. El motivo no es prudencia
-- generica — esta medido: la Parte 4 probo que el maestro del ERP tiene 6 NIT
-- equivocados, y esta sesion lo confirmo desde una segunda fuente (la ficha de
-- `editar_proveedor.php` trae los mismos 6 errores que su libro de compras, 52
-- de 52 coincidencias entre ambos).
--
-- SUPERSEDIDA en la misma sesion por 20260802204227, que agrega ligar-en-vez-de-
-- duplicar y la validacion de forma del NIT. El cuerpo completo y vigente esta
-- alli; este archivo queda por fidelidad con el registro de prod.
