import { useEffect } from 'react';

/**
 * Capa flotante: mientras hay un menú/popover abierto, el contenido de ATRÁS
 * deja de reaccionar al puntero.
 *
 * ── El problema ───────────────────────────────────────────────────────────
 * Un desplegable se dibuja por portal sobre el contenido, pero el contenido
 * sigue vivo: mover el mouse sobre el menú hace que la tarjeta que quedó
 * debajo entre y salga de `:hover`. Y como `[data-surface="card"]` se levanta
 * 2px, media pantalla salta mientras uno está eligiendo una opción. Medido el
 * 2026-08-01 cruzando el borde del menú de a 2px en el tablero: la tarjeta de
 * 532×256 de atrás pasaba de `dy=-2` a `dy=0`.
 *
 * ── Por qué NO un velo `fixed inset-0` ────────────────────────────────────
 * Es lo que hace `ModalShell` y fue lo primero que se probó: un catcher
 * transparente resuelve el hover de un saque, sin enumerar efectos. Pero
 * **rompe el scroll**. Esta app no scrollea el `body` sino un contenedor
 * interno, y el velo cuelga de `body`: la rueda busca un ancestro scrolleable
 * del velo, encuentra `body`/`html` —que no scrollean— y no pasa nada.
 * Verificado con el menú abierto: el scroller interno se quedó clavado en 400
 * mientras que con el menú cerrado sí se movía. En `ModalShell` no se nota
 * porque ahí bloquear el scroll de fondo es justamente lo que se quiere.
 *
 * Así que se apagan los EFECTOS, no el puntero: el hit-testing queda intacto y
 * el scroll sigue funcionando igual que siempre.
 *
 * ── Dónde vive el atributo ────────────────────────────────────────────────
 * En `#root`, no en `<html>`. Los portales cuelgan de `document.body`, o sea
 * que son HERMANOS de `#root` — un selector `#root[data-capa-flotante] …` no
 * los alcanza. Es lo que hace que el menú abierto conserve sus propios hovers
 * mientras el resto de la app queda quieto, sin una sola excepción escrita a
 * mano.
 *
 * ── Contador, no booleano ─────────────────────────────────────────────────
 * Puede haber dos capas abiertas a la vez (un select dentro de un modal). Con
 * un booleano, cerrar la de adentro apagaría el atributo con la de afuera
 * todavía abierta.
 */
let abiertas = 0;

const raiz = () => document.getElementById('root');

export function abrirCapaFlotante() {
    abiertas += 1;
    if (abiertas === 1) raiz()?.setAttribute('data-capa-flotante', '');
}

export function cerrarCapaFlotante() {
    abiertas = Math.max(0, abiertas - 1);
    if (abiertas === 0) raiz()?.removeAttribute('data-capa-flotante');
}

/**
 * Declara que este componente tiene una capa flotante abierta.
 * El cleanup corre también al desmontar, así que un componente que se va
 * mientras su menú está abierto no deja el atributo pegado.
 */
export default function useCapaFlotante(abierta) {
    useEffect(() => {
        if (!abierta) return;
        abrirCapaFlotante();
        return cerrarCapaFlotante;
    }, [abierta]);
}
