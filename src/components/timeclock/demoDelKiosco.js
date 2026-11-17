// Modo de muestra del kiosco de caja (`?demo`), sólo para comparar diseños en
// local (2026-11-17). Pinta una cola de ejemplo y deja abrir la sesión con un
// botón en vez del carné, usando la cuenta con la que ya se entró. No escribe
// nada: la cola es inventada y la sesión es la del navegador.

export const esDemo = () => {
    try { return new URLSearchParams(window.location.search).has('demo'); } catch { return false; }
};

export const EVENTO_CARNE_DEMO = 'kiosco-demo-carne';

const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();

// Productos y clientes que SÍ existen en el entorno de pruebas: al abrir un
// ticket, la venta se carga y se cotiza de verdad contra esa base.
const R = (producto_id, nombre, cantidad, extra = {}) => ({ producto_id, nombre, cantidad, factor: 1, ...extra });

const MUESTRA = [
    { id: 'd1', referencia: '29', minutos: 13, total: 47.5, documento: 'consumidor_final', pago: 'contado', puntos: 0,
        customer_id: 2, cliente: 'MARÍA LUCÍA PÉREZ MARTÍNEZ', vendedor: 'Ana Sofía Martínez Ruiz',
        renglones: [R(313, 'NEXIUM 10MG X 28 SOBRES', 1), R(63, 'ENSURE ADVANCE LIQ FRESA X 220ML', 2), R(4, 'MICROPORE  2X10 YDAS 3M/CUREBAND', 1)] },
    { id: 'd2', referencia: '30', minutos: 7, total: 12.3, documento: 'credito_fiscal', pago: 'tarjeta', puntos: 0,
        customer_id: 1, cliente: 'CARLOS MARÍA PÉREZ ROMERO', vendedor: 'Carlos Ernesto Pineda',
        renglones: [R(18, 'CONTROLIP 160MG X 15 CAPS. | (R)', 1), R(21, 'DAYAMINERAL JBE X 240 ML', 1)] },
    { id: 'd3', referencia: '31', minutos: 4, total: 28.9, documento: 'consumidor_final', pago: 'contado', puntos: 0,
        customer_id: 3, cliente: 'JOSÉ LUIS PÉREZ GUZMÁN', vendedor: 'Ana Sofía Martínez Ruiz',
        renglones: [R(76, 'GLUCERNA LIQUIDO FRESA X 237ML', 3), R(77, 'GLUCERNA LIQUIDO VAINILLA X 237ML', 3)] },
    { id: 'd4', referencia: '32', minutos: 2, total: 6.25, documento: 'consumidor_final', pago: 'transferencia', puntos: 0,
        customer_id: null, cliente: null, vendedor: 'Karla Beatriz Romero',
        renglones: [R(82, 'PEDIASURE LIQUIDO FRESA X 220ML', 1)] },
    { id: 'd5', referencia: '33', minutos: 0.3, total: 18.4, documento: 'consumidor_final', pago: 'contado', puntos: 0, estado: 'enviando',
        customer_id: 4, cliente: 'LUCÍA MIGUEL PÉREZ GARCÍA', vendedor: 'Carlos Ernesto Pineda',
        renglones: [R(66, 'ENSURE ADVANCE LIQ VAINILLA X 220ML', 2), R(73, 'ENSURE LIQUIDO VAINILLA X 220ML', 1)] },
];

// Lo cobrado en la muestra sale de la cola (hasta recargar la página).
const cobradas = new Set();
export const marcarCobradaEnMuestra = (id) => { cobradas.add(id); };

export function colaDeMuestra() {
    return MUESTRA.filter((p) => !cobradas.has(p.id)).map(({ minutos, renglones, ...p }) => ({
        ...p, estado: p.estado ?? 'viva', enviada_at: hace(minutos),
        renglones,
        // La forma de `preventas.venta`: lo que la pantalla de venta carga.
        venta: { documento: p.documento, pago: p.pago, puntos: p.puntos, renglones },
    }));
}
