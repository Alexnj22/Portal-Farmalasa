// `imprimirDocumento` sin cargar la ticketera hasta que alguien imprime.
//
// `ticketPrint.js` pesa ~8 kB gzip (maquetador, códigos de barras, envío a la
// caja) y varias pantallas lo importaban de forma estática sólo para llamarlo
// desde un botón: Cortes lo bajaba entero aunque nadie imprimiera (medido el
// 2026-09-26 con `npm run gate:bundle`). Es la regla de CLAUDE.md «librerías
// pesadas SOLO por `await import()`» aplicada a código propio.
//
// Misma firma y misma respuesta que el canónico: esto sólo difiere la carga.
let modulo = null;
function cargar() {
    if (!modulo) {
        modulo = import('./ticketPrint').catch((err) => { modulo = null; throw err; });
    }
    return modulo;
}

export async function imprimirDocumento(...args) {
    const { imprimirDocumento: imprimir } = await cargar();
    return imprimir(...args);
}
