import React from 'react';

/**
 * Un diálogo que se BAJA al abrirse, no al cargar la pantalla que lo contiene.
 *
 * Misma regla que ya vale para las librerías pesadas (§«librerías pesadas SOLO
 * por `await import()`» de CLAUDE.md): lo que sólo hace falta al apretar un
 * botón no puede viajar en el trozo de la vista. Medido el 2026-08-19 en la
 * pestaña Pedidos: once diálogos —RecepcionModal (1,959 líneas), CrearRutaModal
 * (812), RutaMapModal (565), FinalizarCajasModal (516), entre otros— viajaban
 * con la lista. Pasarlos por acá la bajó de 123 a 78 kB gzip.
 *
 * ── El latch de montado es lo que hace que esto sirva ─────────────────────
 * Un diálogo que se queda montado con `open` en false —seis de los once lo
 * hacen, para poder animar su salida— renderizaría el `lazy()` apenas carga la
 * pantalla, y no ahorraría un byte. Acá se monta la primera vez que se abre y
 * ya no se desmonta, que es el patrón que `WidgetCortesSala` estrenó con
 * `CorteDetalleModal` (v2.615.1).
 *
 * `open === undefined` significa que quien lo usa ya decide con un `&&`: se
 * monta apenas se lo renderiza.
 *
 * ── `fallback={null}` ─────────────────────────────────────────────────────
 * Entre el clic y el diálogo no se dibuja nada. Es lo que hace el precedente y
 * los trozos son chicos; si alguna vez se siente el hueco, se arregla acá y en
 * un solo sitio.
 *
 * El sitio donde se usa NO cambia: `const X = dialogoDiferido(() =>
 * import('./X'))` y el JSX queda igual.
 */
export function dialogoDiferido(carga) {
    const Lazy = React.lazy(carga);
    return function Diferido(props) {
        const [montado, setMontado] = React.useState(props.open !== false);
        React.useEffect(() => { if (props.open) setMontado(true); }, [props.open]);
        if (!montado) return null;
        return <React.Suspense fallback={null}><Lazy {...props} /></React.Suspense>;
    };
}
