import React, { memo, useEffect, useRef, useState } from 'react';

/**
 * ChartContainer — el contenedor responsivo de TODO gráfico del portal.
 *
 * Creado el 2026-07-27 a partir de un bug medido, no de una idea de diseño.
 *
 * ── El bug ────────────────────────────────────────────────────────────────
 * En Safari (WebKit), el Inicio reventaba con "ALGO SALIÓ MAL" apenas
 * cargaba en un teléfono. El error real:
 *
 *   Maximum update depth exceeded
 *     commitHookPassiveMountEffects → recharts dispatch ×5 →
 *     notifyNestedSubs → forceStoreRerender → …
 *
 * O sea: un bucle infinito DENTRO de recharts. Medido en los cuatro entornos
 * antes de tocar nada, para no adivinar la causa:
 *
 *   | WebKit móvil    | bucle ✗ |
 *   | Chromium móvil  | ok ✓, contenedor 308×142 |
 *   | WebKit  1500px  | ok ✓ |
 *   | Chromium 1500px | ok ✓ |
 *
 * No era "el móvil" ni "recharts": era **WebKit midiendo un contenedor con un
 * ancestro en movimiento**. `useReportScale` de recharts hace
 * `getBoundingClientRect().width / offsetWidth` —una medida fraccionaria
 * dividida por una entera— y despacha al store si el cociente cambió. Las
 * tarjetas del Inicio entran con `staggerEnter`, así que durante esos 220ms
 * WebKit devuelve un rect distinto en cada frame y el cociente no converge.
 *
 * ── Tres intentos, y por qué los dos primeros no bastaron ────────────────
 * Vale más que el arreglo:
 *
 *   1. `<ResponsiveContainer debounce={80}>` — lo que el propio recharts
 *      documenta para esto. Bajó la frecuencia pero dejó el bug
 *      **intermitente**.
 *   2. Medir nosotros y pasar píxeles enteros. Dejó de romper la pantalla
 *      (0/5 ErrorBoundary) pero el bucle seguía en 3/5 corridas: redondear el
 *      resultado no sirve si el ancestro se sigue moviendo.
 *   3. **Esperar a que no haya animación en curso.** 6/6 sin bucle, con el
 *      gráfico montado en las seis.
 *
 * Lo importante del segundo: **intermitente es peor que reproducible**. Dos
 * corridas seguidas daban resultados distintos y una parecía la confirmación
 * del arreglo. Por eso esto se verifica con 5-6 corridas, no con una.
 *
 * Como el tamaño llega ya resuelto, `ResponsiveContainer` deja de hacer
 * falta: no hay observador interno que pueda entrar en bucle. Y es más
 * honesto sobre lo que pasa — el gráfico no se dibuja hasta saber cuánto
 * mide, en vez de dibujarse a 0×0 y corregirse.
 */

// ¿Algún ancestro está animando ahora mismo? Se sube hasta `body` en vez de
// usar `getAnimations({ subtree: true })` porque esa opción mira hacia ABAJO
// (descendientes), y lo que nos importa está arriba: la tarjeta que entra.
function ancestrosAnimando(el) {
    let p = el.parentElement;
    while (p && p !== document.body) {
        if (typeof p.getAnimations === 'function' && p.getAnimations().length > 0) return true;
        p = p.parentElement;
    }
    return false;
}

const ChartContainer = memo(({
    children,
    // `minHeight` existe porque un gráfico dentro de un flex sin alto resuelto
    // mide 0 y no se ve nada. Con un piso, el peor caso es que se vea chico.
    minHeight = 120,
    className = '',
    ...rest
}) => {
    const ref = useRef(null);
    const [caja, setCaja] = useState(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // Un solo rAF pendiente y un tope de reintentos. La primera versión
        // de esto encolaba un `requestAnimationFrame` por llamada sin
        // cancelar el anterior — y como el `ResizeObserver` también llama a
        // medir, los frames se multiplicaban en vez de sustituirse. Un
        // arreglo que se apoya en rAF tiene que traer su propio cancel; si no,
        // es otro bucle con distinto nombre.
        let rafId = 0;
        let intentos = 0;

        const medir = () => {
            rafId = 0;
            const r = el.getBoundingClientRect();

            // Mientras un ancestro esté animando (las tarjetas del Inicio
            // entran con `staggerEnter` y se reacomodan con `widgetSettle`),
            // `getBoundingClientRect()` devuelve la caja YA transformada y
            // `offsetWidth` la de layout. Recharts divide una por otra para
            // deducir la escala del contenedor (`useReportScale`), así que en
            // pleno vuelo obtiene un número distinto en cada frame.
            //
            // Medir la diferencia de anchos NO alcanza: `staggerEnter` solo
            // mueve en Y, así que los anchos coinciden y el guard pasaba —
            // pero el ancestro transformado igual hace que WebKit devuelva un
            // rect fraccionario. Lo que hay que esperar es que no haya
            // ANIMACIÓN en curso, que es la pregunta real. `getAnimations()`
            // la responde directo.
            //
            // Con tope: más vale un gráfico medido en un frame movido que
            // ningún gráfico. 20 frames ≈ 330ms, más que los 220ms de
            // `staggerEnter`.
            const animando = ancestrosAnimando(el);

            if ((animando || Math.abs(r.width - el.offsetWidth) > 0.5) && intentos < 20) {
                intentos += 1;
                rafId = requestAnimationFrame(medir);
                return;
            }
            intentos = 0;

            // Enteros, no fracciones — ver la nota de arriba.
            const w = Math.round(r.width);
            const h = Math.max(Math.round(r.height), minHeight);
            setCaja(prev => (prev && prev.w === w && prev.h === h) ? prev : { w, h });
        };

        const pedirMedicion = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(medir);
        };

        medir();
        const ro = new ResizeObserver(pedirMedicion);
        ro.observe(el);
        return () => { ro.disconnect(); if (rafId) cancelAnimationFrame(rafId); };
    }, [minHeight]);

    // El hijo es un chart de recharts (`<AreaChart>`, `<BarChart>`…). Se le
    // pasan las medidas ya resueltas.
    const grafico = caja && caja.w > 0
        ? React.cloneElement(children, { width: caja.w, height: caja.h })
        : null;

    return (
        <div ref={ref} className={`w-full h-full ${className}`} style={{ minHeight }} {...rest}>
            {grafico}
        </div>
    );
});

ChartContainer.displayName = 'ChartContainer';

export default ChartContainer;
