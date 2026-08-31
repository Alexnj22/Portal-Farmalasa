SET lock_timeout = '5s';

-- ── Qué NO es una compra de farmacia ─────────────────────────────────────────
-- El saldo telefónico, las bebidas y las paletas se facturan como cualquier
-- artículo: el sistema de origen les da su id igual que a una caja de ibuprofeno
-- y ninguna columna los delata. Lo que sí los separa es el «laboratorio», que
-- para estas cinco filas no es un laboratorio sino el proveedor de la nevera o
-- de las recargas.
--
-- La bandera va en `laboratorios` y NO en una lista dentro de la función: el día
-- que entre otro proveedor de bebidas, apagarlo tiene que ser marcar una fila,
-- no escribir una migración. Es la misma razón por la que ya existe
-- `ocultar_en_minmax` acá.
--
-- El default es `true` —acumula— a propósito: un producto nuevo, o uno cuyo
-- laboratorio nadie clasificó, tiene que dar puntos. Al revés, un catálogo sin
-- revisar le quitaría puntos a gente que compró un medicamento, y eso no daría
-- ningún error: sólo saldos más bajos que nadie puede explicar.
ALTER TABLE public.laboratorios
  ADD COLUMN IF NOT EXISTS acumula_puntos boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.laboratorios.acumula_puntos IS
  'false = lo que vende este proveedor no acumula puntos (saldo, bebidas, helados). Una venta que SÓLO lleve estas cosas no gana puntos; si además lleva un producto de farmacia, sí.';

UPDATE public.laboratorios SET acumula_puntos = false
WHERE id IN (
  191,  -- RECARGA: saldo Tigo/Claro/Movistar/Digicel, tarjetas. Y «PUNTOS SALUD»,
        -- que es el renglón con el que se cobra el descuento de puntos: dejarlo
        -- acumulando sería dar puntos por canjear puntos.
  249,  -- NEVERIA: paletas, conos, sándwiches de helado
  366,  -- SARITA: paletas, helados
  47,   -- CONSTANCIA: Coca-Cola, agua Cristal, jugos del Valle
  333   -- BEBIDAS: Gatorade, Pepsi, Powerade, tés
);
