SET lock_timeout = '5s';

-- El NRC del cliente es una columna OBLIGATORIA del libro de ventas a
-- contribuyentes (Art. 85 literal e del Reglamento del Código Tributario:
-- "número de registro de contribuyente del cliente").
--
-- Hoy no existe en ninguna tabla: `customers` tiene `nit` y `dui`, y las dos
-- están vacías — medido el 2026-07-31, de los 49 CCF de junio 2026 hay 0 con
-- NIT y 0 con DUI. `sync-dte-sales` sólo lee `venta.cliente`, que es el nombre.
--
-- La columna se crea ahora, antes de tener con qué llenarla, para que el libro
-- nazca con su forma definitiva: cuando el dato llegue —del receptor del DTE o
-- cargado a mano para los pocos clientes recurrentes de CCF— sólo se rellena,
-- sin tocar ni el RPC ni la vista.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS nrc text;

COMMENT ON COLUMN public.customers.nrc IS
  'Número de Registro de Contribuyente del cliente. Obligatorio en el libro de ventas a contribuyentes (Art. 85 lit. e RCT). Se llena desde el receptor del DTE del ERP.';
