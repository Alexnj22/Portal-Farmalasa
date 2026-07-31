SET lock_timeout = '5s';

-- La ficha del cliente, como la guarda el ERP.
--
-- `customers` era un catálogo de NOMBRES: 24,482 filas y cero datos en las
-- pocas columnas que existían (`nit`, `dui`, `email`, `phone`, `erp_id`, todas
-- vacías — medido el 2026-07-31). El sync sólo escribe `venta.cliente`.
--
-- El ERP guarda por cliente: nombre, DUI, NIT, NRC, pasaporte, giro (actividad
-- económica), categoría, dos teléfonos, correo, dirección, municipio, distrito
-- y porcentaje de retención. Se agregan las que faltan para poder reflejarlo
-- entero, no sólo lo que hoy pide el libro de IVA.
--
-- Los catálogos van como TEXTO y no como ids del ERP a propósito: replicar
-- cuatro catálogos ajenos garantiza que se desincronicen, y lo que se lee y se
-- declara es el texto.
--
-- `distrito` importa aparte: **DTE 2.0 exige departamento, municipio y distrito**
-- en la dirección del receptor, y el ERP no lo tiene validado — de los 87
-- clientes con CCF medidos, 76 están sin distrito.
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS telefono2     text,
    ADD COLUMN IF NOT EXISTS direccion     text,
    ADD COLUMN IF NOT EXISTS departamento  text,
    ADD COLUMN IF NOT EXISTS municipio     text,
    ADD COLUMN IF NOT EXISTS distrito      text,
    ADD COLUMN IF NOT EXISTS categoria     text,
    ADD COLUMN IF NOT EXISTS giro          text,
    ADD COLUMN IF NOT EXISTS pasaporte     text,
    ADD COLUMN IF NOT EXISTS retencion_pct smallint;

COMMENT ON COLUMN public.customers.distrito IS
  'Distrito (esquema territorial 2023). Obligatorio en el receptor de DTE 2.0 junto con departamento y municipio.';
COMMENT ON COLUMN public.customers.categoria IS
  'Categoría fiscal del ERP: Consumidor / Contribuyente / Gran Contribuyente / Contribuyente Exento / Extranjero / Menor de edad.';
COMMENT ON COLUMN public.customers.giro IS
  'Actividad económica del cliente, como la clasifica el ERP. Viaja en el DTE.';

-- `erp_id` es la llave que hoy no existe: sin ella, todo cruce con el ERP es
-- por nombre. Un índice único parcial —sólo sobre las filas que lo tengan—
-- deja que las 24 mil sin id sigan conviviendo mientras se completan.
CREATE UNIQUE INDEX IF NOT EXISTS customers_erp_id_uniq
    ON public.customers (erp_id) WHERE erp_id IS NOT NULL;
