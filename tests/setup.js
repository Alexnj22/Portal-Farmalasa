import '@testing-library/jest-dom/vitest';

// Node 25 trae su propio `localStorage` global, y **tapa al de jsdom**: existe,
// pero lanza `getItem is not a function` a menos que se arranque el proceso con
// `--localstorage-file`. Cualquier test que importe una vista revienta al
// cargar, porque `staffStore` lee la caché en el momento de crearse — no en un
// efecto, sino en la línea del `create()`.
//
// Se descubrió el 2026-08-11 escribiendo `anexoColumnas.test.js`, que necesita
// importar `LibrosIvaView` para probar la función real que arma los anexos.
//
// Se define uno en memoria y se hace ANTES de cualquier import de la app.
const memoria = new Map();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
        getItem: (k) => (memoria.has(String(k)) ? memoria.get(String(k)) : null),
        setItem: (k, v) => { memoria.set(String(k), String(v)); },
        removeItem: (k) => { memoria.delete(String(k)); },
        clear: () => memoria.clear(),
        key: (i) => [...memoria.keys()][i] ?? null,
        get length() { return memoria.size; },
    },
});

// jsdom no implementa `ResizeObserver`, y varios canónicos del portal lo usan
// para medir su propio ancho —`FilterBar` decide con él si la píldora flota—.
// Sin esto, cualquier prueba que renderice una vista real muere en el efecto de
// montaje con `ResizeObserver is not defined`, y el error apunta al canónico en
// vez de al entorno: se lee como si el componente estuviera roto.
//
// El doble no observa nada a propósito. Fingir un tamaño sería peor que no
// tenerlo: la prueba pasaría afirmando un layout que jsdom no calcula (todo
// mide 0), y eso es una medición inventada. Lo que se mide de verdad son los
// anchos, y eso lo hace el barrido en WebKit — acá sólo hace falta que monte.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}
