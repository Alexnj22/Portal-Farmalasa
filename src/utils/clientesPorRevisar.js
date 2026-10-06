// Las fichas «Por revisar» de Clientes: el rótulo de cada motivo y su tono.
// Vivía dentro de `views/clientes/TabPorRevisar.jsx`; se mudó para que la app
// del teléfono nombre los motivos igual.
//
// Los rótulos hablan del PORTAL, nunca del sistema de origen ni de la tubería:
// "congelado" y "repetido" son términos del negocio; "SALTADO (categoría
// Contribuyente)" es jerga del script que llenó la tabla y no sale a pantalla.
export const MOTIVO_POR_REVISAR = {
    fiscal_congelado: { label: 'Fiscal congelado', variant: 'info'    },
    nombre_repetido:  { label: 'Nombre repetido',  variant: 'warning' },
    dui_repetido:     { label: 'DUI repetido',     variant: 'warning' },
    nit_repetido:     { label: 'NIT repetido',     variant: 'warning' },
};

export const motivoPorRevisar = (m) => MOTIVO_POR_REVISAR[m] || { label: m, variant: 'neutral' };

/** El orden de la lista de clientes: las columnas que el servidor sabe ordenar. */
export const ORDEN_CLIENTES = [
    { value: 'nombre', label: 'Nombre', dir: 'asc' },
    { value: 'ficha', label: 'Ficha', dir: 'asc' },
    { value: 'facturas', label: 'Más facturas', dir: 'desc' },
    { value: 'total', label: 'Más facturado', dir: 'desc' },
    { value: 'ultima', label: 'Compra más reciente', dir: 'desc' },
];
