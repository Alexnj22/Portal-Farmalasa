import { useSyncExternalStore } from 'react';

/**
 * ¿Hay algún diálogo abierto ahora mismo?
 *
 * Existe para que el clúster flotante se APAGUE mientras hay una hoja encima.
 * Reportado con el panel lateral acostado: el clúster quedaba debajo del vidrio
 * y se transparentaba a través del panel. Pasa igual de pie —la hoja inferior
 * también lo tapa— pero acostado se nota más porque el panel cae justo encima.
 *
 * ── Por qué un contador y no un booleano ──────────────────────────────────
 * Los diálogos se anidan: una hoja de filtros abre un `SelectorTactil`, una
 * confirmación se abre sobre un formulario. Con un booleano, cerrar el de
 * adentro encendería la barra estando el de afuera todavía abierto. Contando,
 * la barra vuelve cuando se fue el último.
 *
 * ── Por qué no lo escribe `ModalShell` directo ────────────────────────────
 * Porque `--barra-flotante-display` ya tiene un escritor —`AppLayout`, que la
 * apaga con el menú abierto— y dos efectos escribiendo la misma variable se
 * pisan: el que corra segundo gana, y cuál es depende del orden de render. Acá
 * `ModalShell` solo CUENTA; la variable la sigue escribiendo `AppLayout`, que
 * ahora mira las dos señales.
 */

let abiertos = 0;
const oyentes = new Set();

const avisar = () => { for (const o of oyentes) o(); };

export function marcarDialogoAbierto() {
    abiertos += 1;
    if (abiertos === 1) avisar();
    return () => {
        abiertos = Math.max(0, abiertos - 1);
        if (abiertos === 0) avisar();
    };
}

const suscribir = (o) => { oyentes.add(o); return () => oyentes.delete(o); };
const leer = () => abiertos > 0;
const leerEnServidor = () => false;

export function useHayDialogo() {
    return useSyncExternalStore(suscribir, leer, leerEnServidor);
}
