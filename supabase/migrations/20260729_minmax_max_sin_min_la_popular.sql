-- F1.2 (secuela) — Las 3 filas con MAX y sin MIN.
--
-- Salen a la luz por el CHECK de F1.2: son las unicas 3 filas de todo el
-- sistema con min_units NULL y max_units > 1 (las tres en La Popular,
-- erp_sucursal_id = 5): ACIDO BORICO SOBRE 28G (MAX 3), LEVUSOL SUERO
-- DIABETICO (MAX 2), TEGADERM TRANSPARENTE X8 (MAX 3). Nunca publicadas,
-- sin calc, sin velocidad, 0 ventas en 6 meses, tocadas a mano el 2026-06-18.
--
-- Origen: la UI guarda celda por celda, asi que alguien abrio la celda de MAX
-- de un producto sin nada publicado, escribio el numero, y el MIN quedo vacio.
-- chk_min_lt_max lo tolera porque cualquier NULL la satisface.
--
-- Por que hay que arreglarlas: "descartar borrador" copia el par publicado a
-- las columnas de borrador (useMinMaxData.discardDraft), y en estas filas ese
-- par se lee (0, 3) — el 0 es "no hay MIN". Con psp_draft_pair_valid vivo,
-- (0,3) es invalido: el boton fallaria sobre estos 3 productos.
--
-- Decision (Alex, 2026-07-29): MIN = 1, la misma regla de min-lift que ya usan
-- publish_stock_params y el trigger de Bodega cuando el MAX supera 1. Conserva
-- el MAX que alguien tecleo y los deja gestionados. Sin ventas, el costo maximo
-- es que el pedido sugiera 2-3 unidades una sola vez.
--
-- No se tocan las filas con min_units NULL y max_units <= 1: su par efectivo
-- es (0,0) o (0,1), que ya es valido.

SET lock_timeout = '5s';

UPDATE public.product_stock_params
SET min_units  = 1,
    updated_at = NOW()
WHERE min_units IS NULL
  AND COALESCE(max_units, 0) > 1;
