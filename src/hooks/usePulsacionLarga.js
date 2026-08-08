import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * usePulsacionLarga — mantener presionada una fila para abrir sus opciones.
 *
 * Creado el 2026-08-08 para la lista de conteos: en el teléfono no había
 * ninguna forma de borrar un conteo sin entrar a él, porque la papelera vive en
 * la columna de acciones de la tabla y la tabla no se pinta debajo de `md`.
 *
 * ── Por qué mantener presionado y no deslizar ────────────────────────────
 * Las dos se evaluaron. El desempate no es de gusto, sale de tres hechos de
 * ESTA lista:
 *
 * 1. **El borrado es irreversible y lleva confirmación obligatoria** (se lleva
 *    los renglones y el historial de quién contó cada uno). O sea que deslizar
 *    nunca puede ser "deslizo y listo": queda deslizar → tocar → confirmar, los
 *    mismos toques que mantener → tocar → confirmar. La única ventaja del
 *    deslizamiento —que el gesto ES la acción— no se puede cobrar acá.
 * 2. **No toda fila se puede borrar** (`puedeBorrar`: depende del permiso y del
 *    estado del conteo). Un deslizamiento sobre una fila que no se puede borrar
 *    solo puede no hacer nada, que se lee como que la pantalla se colgó. Una
 *    hoja puede decir qué hay y qué no.
 * 3. **La lista scrollea en vertical.** Deslizar obliga a arbitrar el eje en
 *    cada fila —y es justo donde viven los bugs de estas listas, que además
 *    acaban de recibir `content-visibility` por el techo de memoria de la
 *    pestaña—. Mantener presionado se mide en TIEMPO: al primer movimiento se
 *    cancela y el scroll gana sin competir.
 *
 * Y una cuarta, del lado de lo que pidió el usuario: "opciones", en plural. Una
 * hoja crece a la siguiente acción; el deslizamiento solo sostiene una.
 *
 * ── El toque y la mantenida las resuelve el MISMO hook ───────────────────
 * Es la ambigüedad que este hook existe para cerrar. Al soltar después de una
 * mantenida el navegador dispara `click` igual, así que sin esto la fila
 * navegaba ADEMÁS de abrir la hoja. Por eso `onClick` sale de acá y no del
 * llamador: separarlos era garantizar que alguien se olvide de la mitad.
 */

// 500ms es el umbral del sistema en iOS y Android para el menú contextual.
// Menos lo dispara el que apoya el dedo antes de decidir; más se siente trabado.
const RETARDO_MS = 500;
// Cuánto puede moverse el dedo sin que deje de ser una mantenida. El pulgar
// nunca está quieto: a 0 no dispara nunca, y por arriba de ~12px ya es un
// arrastre de scroll.
const TOLERANCIA_PX = 10;

export function usePulsacionLarga({ alMantener, alTocar, activo = true, retardo = RETARDO_MS }) {
    const temporizador = useRef(null);
    const origen = useRef(null);
    // Si la mantenida ya disparó, el `click` que viene después es su cola: se
    // consume acá, no navega.
    const yaDisparo = useRef(false);
    // El acuse visible mientras el dedo sostiene. Es estado de React —y no una
    // clase puesta a mano sobre el nodo— para que salga por los props junto con
    // el resto del gesto: quien use el hook no tiene que acordarse de nada.
    const [manteniendo, setManteniendo] = useState(false);

    const cancelar = useCallback(() => {
        if (temporizador.current) {
            clearTimeout(temporizador.current);
            temporizador.current = null;
        }
        origen.current = null;
        setManteniendo(false);
    }, []);

    // Desmontar con el temporizador vivo dispararía la hoja de una fila que ya
    // no existe. Pasa de verdad: la lista se re-filtra mientras el dedo apoya.
    useEffect(() => () => {
        if (temporizador.current) clearTimeout(temporizador.current);
    }, []);

    const onPointerDown = useCallback((e) => {
        if (!activo) return;
        // Solo el botón principal: con el secundario ya existe el menú del
        // sistema, y en táctil `button` siempre llega en 0.
        if (e.button != null && e.button !== 0) return;
        yaDisparo.current = false;
        origen.current = { x: e.clientX, y: e.clientY };
        setManteniendo(true);
        // No se guarda el evento de React para el timeout: aunque desde la 17 ya
        // no se reciclan, lo que la hoja necesita es dónde se tocó, y eso son dos
        // números.
        const punto = { x: e.clientX, y: e.clientY };
        temporizador.current = setTimeout(() => {
            temporizador.current = null;
            yaDisparo.current = true;
            // La tarjeta vuelve JUSTO cuando la hoja sale de ella. Dejarla
            // encogida mientras la hoja está abierta la deja "trabada" atrás.
            setManteniendo(false);
            alMantener(punto);
        }, retardo);
    }, [activo, alMantener, retardo]);

    const onPointerMove = useCallback((e) => {
        if (!temporizador.current || !origen.current) return;
        const dx = Math.abs(e.clientX - origen.current.x);
        const dy = Math.abs(e.clientY - origen.current.y);
        if (dx > TOLERANCIA_PX || dy > TOLERANCIA_PX) cancelar();
    }, [cancelar]);

    // `pointercancel` es lo que manda el navegador cuando SE QUEDA él con el
    // gesto — que es exactamente lo que pasa al empezar a scrollear. Es la señal
    // buena: llega antes de que el movimiento acumulado cruce la tolerancia.
    const onPointerCancel = useCallback(() => cancelar(), [cancelar]);
    const onPointerUp = useCallback(() => cancelar(), [cancelar]);

    const onClick = useCallback((e) => {
        if (yaDisparo.current) {
            // La cola de la mantenida. Se consume y se apaga la bandera para que
            // el toque siguiente sí navegue.
            yaDisparo.current = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        alTocar?.(e);
    }, [alTocar]);

    // El menú contextual del navegador sobre la misma mantenida: sin esto, en
    // Android y en escritorio salen los dos a la vez.
    const onContextMenu = useCallback((e) => { if (activo) e.preventDefault(); }, [activo]);

    return {
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick, onContextMenu,
        // El acuse sale por acá y no por una clase que el llamador escriba: es
        // el mismo contrato de `data-surface` (el material) y `data-interactive`
        // (el gel) — el atributo lo pone quien sabe, y `index.css` lo dibuja
        // para todos. Ver «La mantenida» en index.css §1.6.
        //
        // El atributo va SIEMPRE, en `"true"`/`"false"`: un atributo que
        // aparece y desaparece hace que el selector no exista en reposo, y
        // entonces no hay desde dónde volver.
        'data-manteniendo': activo ? String(manteniendo) : undefined,
        // La duración de la animación sale de la constante que ya gobierna el
        // `setTimeout`. Una sola fuente de verdad, empujada de JS a CSS —al
        // revés (leer de CSS un número para un timer) es lo que este proyecto
        // ya pagó en `ModalShell`.
        style: activo ? { '--pulsacion-retardo': `${retardo}ms` } : undefined,
    };
}

export default usePulsacionLarga;
