import { useState, useEffect, useCallback, useRef } from 'react';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import {
    ventasSinSenal, guardarVentaSinSenal, enviarVentasSinSenal as enviarCola, esErrorDeRed, EVENTO_SIN_SENAL,
} from '@nucleo/data/distribucionSinSenal';

// Ventas SIN SEÑAL (2026-09-30). Pedido del usuario: «termina el aviso de
// contingencia para cuando no hay señal».
//
// La cola —guardar, mandar, facturar en contingencia— vive en el núcleo
// (`data/distribucionSinSenal.js`) desde 2026-10-07, para que la app nativa
// use la misma. Acá queda lo del NAVEGADOR: saber si está sin red y el hook
// que vacía la cola al volver la señal (evento `online`).

const EVENTO = EVENTO_SIN_SENAL;
const leer = ventasSinSenal;

export { ventasSinSenal, guardarVentaSinSenal };

/** ¿Este error es «no hay señal» (no llegó al servidor) y no uno de la venta? */
export function esFallaDeRed(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return esErrorDeRed(e);
}

/** Manda la cola (ver el núcleo), con el juez de red del navegador. */
export const enviarVentasSinSenal = () => enviarCola({ esFallaDeRed });

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
