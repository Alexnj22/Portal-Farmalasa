// El rastreo de la ruta de Torogoz (borrador 0033), escrito UNA vez para el
// portal (Capacitor) y para la app nativa. Vivía dentro de
// `views/distribucion/rastreo.js`, pegado a `window` y `localStorage`.
//
// «En ruta» es un estado del TELÉFONO: se guarda con la fecha del día, así que
// sobrevive a cerrar la app y se apaga solo al día siguiente. Mientras está en
// ruta, se anota la primera posición en cuanto llega y después UNA por minuto
// (la última conocida), aunque el GPS mande más seguido: el recorrido no
// necesita más y cada punto es una fila.
//
// Lo que depende del aparato llega por los adaptadores: dónde se guarda
// (`almacen`), cómo se avisa a las pantallas (`eventos`) y cómo se mide
// (`ubicacion`). En la web, `seguirPosicion` es el plugin de segundo plano; en
// la app, `expo-location` en primer plano.
import * as almacen from '@plataforma/almacen';
import * as eventos from '@plataforma/eventos';
import { seguirPosicion } from '@plataforma/ubicacion';
import { hoySV } from '../utils/fecha';
import { registrarPosicion } from './distribucion';

/** Cada cuánto se anota la última posición conocida. */
export const INTERVALO_RASTREO_MS = 60_000;
/** El aviso que avisa a las pantallas que el estado cambió. */
export const EVENTO_EN_RUTA = 'torogoz-en-ruta';

export const claveEnRuta = (yo) => `torogoz-en-ruta:${yo}`;

/** ¿Lo guardado dice «en ruta» HOY? Una marca de ayer ya no cuenta. */
export const enRutaHoy = (guardado, hoy = hoySV()) => !!guardado && guardado === hoy;

/** ¿Este teléfono está en ruta hoy? */
export function estaEnRuta(yo) {
    if (!yo) return false;
    try { return enRutaHoy(almacen.leer(claveEnRuta(yo))); } catch { return false; }
}

/** Marca o desmarca «en ruta» y avisa a las pantallas. */
export function marcarEnRuta(yo, activa) {
    if (!yo) return;
    try {
        if (activa) almacen.guardar(claveEnRuta(yo), hoySV());
        else almacen.borrar(claveEnRuta(yo));
    } catch { /* sin almacenamiento: dura lo que dure la pantalla */ }
    eventos.emitir(EVENTO_EN_RUTA);
}

/** Escucha los cambios de «en ruta»; devuelve la función que deja de escuchar. */
export const escucharEnRuta = (alCambiar) => eventos.escuchar(EVENTO_EN_RUTA, alCambiar);

/**
 * La regla de cuándo se anota: la primera posición al llegar, y después la
 * última conocida en cada vuelta del reloj. Sin aparato ni base: se prueba sola.
 */
export function crearAnotador(registrar) {
    let ultima = null;
    return {
        /** Llega una posición del GPS. */
        recibir(pos) {
            const primera = !ultima;
            ultima = pos;
            if (primera) registrar(pos);
        },
        /** Vuelta del reloj: anota la última, si hay. */
        tick() { if (ultima) registrar(ultima); },
        get ultima() { return ultima; },
    };
}

/**
 * Empieza a medir y anotar. Devuelve una función que detiene todo.
 * `alProblema(motivo|null)` avisa si el GPS falla ('denegado'|'sin-senal'|'sin-gps')
 * y lo limpia en cuanto vuelve a llegar una posición.
 */
export function arrancarRastreo({ mensaje = 'Ruta de Torogoz activa.', alProblema } = {}) {
    const anotador = crearAnotador((p) => {
        Promise.resolve(registrarPosicion(p.lat, p.lng))
            .catch(e => console.warn('[ruta] no se anotó la posición', e?.message ?? e));
    });
    let detener = null;
    let cerrado = false;
    seguirPosicion((pos) => { anotador.recibir(pos); alProblema?.(null); }, { mensaje, alFallar: (m) => alProblema?.(m) })
        .then((d) => { if (cerrado) d(); else detener = d; })
        .catch((e) => { console.warn('[ruta] no arrancó el GPS', e); alProblema?.('sin-gps'); });
    const reloj = setInterval(() => anotador.tick(), INTERVALO_RASTREO_MS);
    return () => { cerrado = true; detener?.(); clearInterval(reloj); };
}
