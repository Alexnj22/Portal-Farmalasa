SET lock_timeout = '5s';

-- ═══ Los CHECK viejos hacían imposible cerrar en efectivo ═══════════════════
--
-- Se descubrió intentando escribir el primer cierre en mano, una hora después
-- de entregar la función que lo permite. Los dos CHECK de la tabla se
-- escribieron cuando el único destino era el banco, y ninguno de los dos se
-- revisó al partir el monto en dos:
--
--   · `deposito_monto_positivo`  →  monto_deposito > 0
--       Un cierre que va ENTERO en mano lleva $0 al banco, así que ningún
--       cierre en efectivo podía guardarse. La función lo aceptaba y la tabla
--       lo rechazaba.
--
--   · `deposito_cuadra`  →  (total_contado + aporte) − monto_deposito = remanente
--       No resta la parte en mano. Un reparto de $10,000 al banco y $6,000 en
--       mano exige remanente = $6,000 para pasar el CHECK, cuando el remanente
--       real es $0. O sea que TAMPOCO se podía guardar un cierre repartido.
--
-- Entre las dos, lo único que entraba era un depósito bancario puro — que es
-- justo lo que había antes. **La función nueva no podía escribir ni una fila y
-- nada lo dijo**, porque yo nunca corrí el camino que acababa de abrir: es
-- `feedback_un_gate_que_no_pudo_medir_no_puede_dar_verde` en su versión más
-- barata de evitar.
--
-- El cero se permite a propósito: es la bolsa cuyo efectivo se retiró en la
-- sala antes de llegar a administración. Lo que la tabla sigue impidiendo es
-- repartir MÁS de lo que hay — eso lo dice `deposito_cuadra` junto con
-- `deposito_remanente_no_negativo`.
ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS deposito_monto_positivo;
ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS deposito_partes_no_negativas;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT deposito_partes_no_negativas
    CHECK (monto_deposito >= 0 AND monto_efectivo >= 0);

ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS deposito_cuadra;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT deposito_cuadra
    CHECK (round((total_contado + aporte) - monto_deposito - monto_efectivo, 2)
           = round(remanente, 2));

-- Cada parte con su contraparte, en la TABLA y no sólo en la función: una fila
-- que dice «$6,000 en mano» sin decir a quién es efectivo que cambió de manos
-- sin dueño, y ése es justo el agujero que este circuito existe para tapar.
ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS deposito_en_mano_con_dueno;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT deposito_en_mano_con_dueno
    CHECK (monto_efectivo = 0 OR entregado_a IS NOT NULL);

ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS deposito_al_banco_con_banco;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT deposito_al_banco_con_banco
    CHECK (monto_deposito = 0 OR banco_id IS NOT NULL);
