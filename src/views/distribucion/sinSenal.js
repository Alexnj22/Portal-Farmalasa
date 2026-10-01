import { useState, useEffect, useCallback, useRef } from 'react';
import * as almacen from '@plataforma/almacen';
import {
    crearPedido, guardarPagos, facturarPedido, enviarContingencia, fetchPedidoPorUuid, mensajeDeDistribucion,
} from '@nucleo/data/distribucion';

// Ventas SIN SEÑAL (2026-09-30). Pedido del usuario: «termina el aviso de
// contingencia para cuando no hay señal».
//
// En ruta el teléfono se queda sin datos. La venta se hace igual: se guarda
// AQUÍ, en el propio teléfono, con la hora en que ocurrió y un código de
// generación que ya sale en el comprobante provisional. Cuando vuelve la señal
// la cola se vacía sola: crea el pedido (idempotente por `client_uuid`), lo
// factura EN CONTINGENCIA (modelo diferido, con la hora de la venta) y manda el
// aviso de contingencia a Hacienda, que es lo que permite transmitirlo después.
//
// Hacienda da 72 horas desde la venta; pasado eso la entrada queda marcada con
// el error y se factura de nuevo a mano.
//
// Vive en el teléfono y no en la base A PROPÓSITO: sin señal no hay base.
// `almacen` es el adaptador de la plataforma (localStorage en el navegador).

const CLAVE = 'torogoz_ventas_sin_senal';
const EVENTO = 'torogoz:ventas-sin-senal';

function leer() {
    try { return JSON.parse(almacen.leer(CLAVE) || '[]'); } catch { return []; }
}
function escribir(lista) {
    try { almacen.guardar(CLAVE, JSON.stringify(lista)); } catch { /* sin almacenamiento: no hay cola */ }
    try { window.dispatchEvent(new Event(EVENTO)); } catch { /* sin ventana */ }
}

export const ventasSinSenal = () => leer();

/** ¿Este error es «no hay señal» (no llegó al servidor) y no uno de la venta? */
export function esFallaDeRed(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
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
        codigo_generacion: crypto.randomUUID().toUpperCase(),
        error: null,
    };
    escribir([...leer().filter(v => v.clientUuid !== venta.clientUuid), entrada]);
    return entrada;
}

/**
 * Manda la cola. Devuelve cuántas se facturaron y cuántas quedaron con error.
 * Al final pide el aviso de contingencia (si faltan credenciales, se dice y la
 * venta ya quedó facturada en contingencia: el aviso sale desde Facturación).
 */
export async function enviarVentasSinSenal() {
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

/**
 * La cola en pantalla: cuántas hay y el botón para mandarlas. Se vacía sola
 * al volver la señal (evento `online`) y al abrir la app con señal.
 */
export function useVentasSinSenal({ automatico = false, alTerminar } = {}) {
    const [lista, setLista] = useState(leer);
    const [enviando, setEnviando] = useState(false);
    const ocupado = useRef(false);
    const terminar = useRef(alTerminar);
    useEffect(() => { terminar.current = alTerminar; });

    const enviar = useCallback(async () => {
        if (ocupado.current || !leer().length) return null;
        ocupado.current = true;
        setEnviando(true);
        try {
            const r = await enviarVentasSinSenal();
            terminar.current?.(r);
            return r;
        } catch (e) {
            // Lo que no es «sin señal» se dice: la cola queda y se reintenta.
            console.error('ventas sin señal', e);
            const r = { facturadas: 0, errores: 1, aviso: mensajeDeDistribucion(e) };
            terminar.current?.(r);
            return r;
        } finally {
            ocupado.current = false;
            setEnviando(false);
            setLista(leer());
        }
    }, []);

    useEffect(() => {
        const refrescar = () => setLista(leer());
        const alVolver = () => { if (automatico) enviar(); };
        window.addEventListener(EVENTO, refrescar);
        window.addEventListener('storage', refrescar);
        window.addEventListener('online', alVolver);
        if (automatico && navigator.onLine && leer().length) enviar();
        return () => {
            window.removeEventListener(EVENTO, refrescar);
            window.removeEventListener('storage', refrescar);
            window.removeEventListener('online', alVolver);
        };
    }, [automatico, enviar]);

    return { lista, enviando, enviar };
}
