// Ventas SIN SEÑAL de Torogoz — la COLA, sin pantalla (2026-10-07: se mudó de
// `views/distribucion/sinSenal.js` para que la app nativa use la misma).
//
// En ruta el teléfono se queda sin datos. La venta se hace igual: se guarda en
// el propio teléfono, con la hora en que ocurrió y un código de generación que
// ya sale en el comprobante provisional. Cuando vuelve la señal la cola se
// vacía: crea el pedido (idempotente por `client_uuid`), lo factura EN
// CONTINGENCIA (modelo diferido, con la hora de la venta) y manda el aviso de
// contingencia a Hacienda, que es lo que permite transmitirlo después.
//
// Hacienda da 72 horas desde la venta; pasado eso la entrada queda marcada con
// el error y se factura de nuevo a mano.
//
// Vive en el teléfono y no en la base A PROPÓSITO: sin señal no hay base.
// `almacen` y `eventos` son los adaptadores de cada plataforma (localStorage y
// `window` en el navegador; SQLite y un emisor en memoria en la app). La misma
// clave de siempre: lo que un navegador ya tenía en cola se sigue leyendo.
import * as almacen from '@plataforma/almacen';
import { emitir } from '@plataforma/eventos';
import {
    crearPedido, guardarPagos, facturarPedido, enviarContingencia, fetchPedidoPorUuid, mensajeDeDistribucion,
} from './distribucion';

export const CLAVE_SIN_SENAL = 'torogoz_ventas_sin_senal';
/** El aviso de «cambió la cola» (en el navegador, un evento de `window`). */
export const EVENTO_SIN_SENAL = 'torogoz:ventas-sin-senal';

function leer() {
    try { return JSON.parse(almacen.leer(CLAVE_SIN_SENAL) || '[]'); } catch { return []; }
}
function escribir(lista) {
    try { almacen.guardar(CLAVE_SIN_SENAL, JSON.stringify(lista)); } catch { /* sin almacenamiento: no hay cola */ }
    try { emitir(EVENTO_SIN_SENAL); } catch { /* sin quien escuche */ }
}

export const ventasSinSenal = () => leer();

/**
 * Un UUID v4. `crypto.randomUUID` no existe en todos los teléfonos; sin él se
 * arma con la misma forma (Hacienda exige el formato del código de generación).
 */
export function uuidV4() {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c?.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * ¿Este error es «no hay señal» (no llegó al servidor) y no uno de la venta?
 * Sólo mira el error; si la plataforma además sabe que está sin red, lo suma
 * quien llama. «Network request failed» es como lo dice el teléfono.
 */
export function esErrorDeRed(e) {
    const m = `${e?.name ?? ''} ${e?.message ?? ''}`;
    return /Failed to fetch|NetworkError|Load failed|network|FunctionsFetchError|TypeError: fetch/i.test(m);
}

/**
 * Guarda una venta hecha sin señal. `venta`: lo que necesita `crearPedido` y
 * `guardarPagos`, más `resumen` (cliente, renglones y total) para mostrarla.
 */
export function guardarVentaSinSenal(venta) {
    const entrada = {
        ...venta,
        emitido_at: new Date().toISOString(),
        codigo_generacion: uuidV4().toUpperCase(),
        error: null,
    };
    escribir([...leer().filter(v => v.clientUuid !== venta.clientUuid), entrada]);
    return entrada;
}

/**
 * Manda la cola. Devuelve cuántas se facturaron y cuántas quedaron con error.
 * Al final pide el aviso de contingencia (si faltan credenciales, se dice y la
 * venta ya quedó facturada en contingencia: el aviso sale desde Facturación).
 * `esFallaDeRed`: el juez de «sigue sin señal» de la plataforma.
 */
export async function enviarVentasSinSenal({ esFallaDeRed = esErrorDeRed } = {}) {
    const lista = leer();
    const resultado = { facturadas: 0, errores: 0, aviso: null };
    for (const v of lista) {
        try {
            // Si la respuesta de un intento anterior se perdió, el pedido ya puede estar facturado.
            const previo = await fetchPedidoPorUuid(v.clientUuid);
            let pedidoId = previo?.id;
            if (!previo || previo.estado === 'confirmado') {
                pedidoId = await crearPedido({
                    emisorId: v.emisorId, clienteId: v.clienteId, tipoDocumento: v.tipoDocumento, condicion: v.condicion,
                    plazoDias: v.plazoDias, formaPago: v.formaPago, observaciones: v.observaciones, clientUuid: v.clientUuid,
                    renglones: v.renglones,
                });
                await guardarPagos(pedidoId, v.pagos);
                await facturarPedido(pedidoId, {
                    contingencia: { tipo: 3, emitido_at: v.emitido_at, codigo_generacion: v.codigo_generacion },
                });
            }
            escribir(leer().filter(x => x.clientUuid !== v.clientUuid));
            resultado.facturadas += 1;
        } catch (e) {
            if (esFallaDeRed(e)) break; // sigue sin señal: se reintenta después
            const msg = mensajeDeDistribucion(e);
            escribir(leer().map(x => (x.clientUuid === v.clientUuid ? { ...x, error: msg } : x)));
            resultado.errores += 1;
        }
    }
    if (resultado.facturadas > 0) {
        try {
            await enviarContingencia();
        } catch (e) {
            resultado.aviso = mensajeDeDistribucion(e);
        }
    }
    return resultado;
}
