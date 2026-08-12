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
