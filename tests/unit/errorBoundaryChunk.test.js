// «El chunk no cargó» no es lo mismo que «el código falló».
//
// Medido en los registros de producción del portal el 2026-08-24: **92 errores
// de render en 45 días, de SIETE personas**, y los recientes son todos de la
// misma familia — un archivo con hash viejo que dejó de existir tras publicar
// una versión. Le pasó a una persona de sala el 21 de agosto.
//
// `main.jsx` ya escucha `vite:preloadError` y recarga. Esto es la SEGUNDA red, y
// hace falta porque los dos mensajes más frecuentes de los registros
// —«Importing a module script failed» y «undefined is not an object (evaluating
// 'k._result.default')»— son de WebKit, donde ese evento no siempre llega.
//
// Lo que se prueba es la DECISIÓN, no el componente: qué mensajes cuentan como
// «el chunk no cargó» y cuáles no. Un falso positivo acá recarga la página en
// bucle sobre un error de código real, que es peor que la pantalla de error.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// La lista vive dentro del componente (no se exporta para no ampliar su
// superficie), así que se lee del fuente. Es frágil a propósito: si alguien la
// renombra, esta prueba falla y obliga a mirar — que es mejor que seguir
// probando una lista que ya no existe.
const fuente = fs.readFileSync(
    path.join(import.meta.dirname, '../../src/components/common/ErrorBoundary.jsx'), 'utf8');

function patrones() {
    const bloque = fuente.match(/const ES_CHUNK_QUE_NO_CARGO = \[([\s\S]*?)\];/);
    expect(bloque, 'no se encontró ES_CHUNK_QUE_NO_CARGO en ErrorBoundary.jsx').toBeTruthy();
    return [...bloque[1].matchAll(/\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)/g)]
        .map(m => new RegExp(m[1], m[2]));
}
const esDeCarga = (msg) => patrones().some(r => r.test(msg));

describe('reconoce el chunk que no cargó', () => {
    // Los cuatro mensajes REALES sacados de `audit_logs` de producción.
    it.each([
        ['Importing a module script failed.',                                    'WebKit'],
        ["undefined is not an object (evaluating 'k._result.default')",          'WebKit · interno de React.lazy'],
        ["Cannot read properties of undefined (reading 'default')",              'Chrome · interno de React.lazy'],
        ['Failed to fetch dynamically imported module: https://portal.farmasalud.lat/assets/DashboardView-C2-ismpz.js', 'Chrome'],
    ])('reconoce «%s» (%s)', (mensaje) => {
        expect(esDeCarga(mensaje)).toBe(true);
    });

    it('reconoce el SPA fallback devolviendo index.html', () => {
        // El servidor responde la página en vez del script: el navegador se
        // queja del MIME type. Es el mismo problema con otra cara.
        expect(esDeCarga("Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. 'text/html' is not a valid JavaScript MIME type")).toBe(true);
    });

    it('reconoce el ChunkLoadError de otros empaquetadores', () => {
        expect(esDeCarga('ChunkLoadError: Loading chunk 42 failed.')).toBe(true);
    });
});

describe('NO confunde un error de código con un chunk que falta', () => {
    // Éste es el lado que importa de verdad. Un falso positivo recarga la página
    // sobre un error real: la pantalla parpadea, vuelve a fallar, y a los 30
    // segundos vuelve a recargar. El usuario ve un portal que no arranca y el
    // defecto original queda escondido detrás del bucle.
    it.each([
        "Cannot read properties of undefined (reading 'nombre')",
        "Cannot read properties of null (reading 'map')",
        "undefined is not an object (evaluating 'pedido.items')",
        'x is not a function',
        'Maximum update depth exceeded',
        'Objects are not valid as a React child',
        'Network request failed',
        'Error desconocido',
        'TypeError: Failed to fetch',                 // red caída, NO un chunk
    ])('deja pasar «%s»', (mensaje) => {
        expect(esDeCarga(mensaje)).toBe(false);
    });

    it('distingue leer «default» de leer cualquier otra propiedad', () => {
        // La diferencia entre los dos es una sola palabra, y de esa palabra
        // depende si el portal recarga o muestra el error. `default` es el
        // interno de `React.lazy`; cualquier otra es código de la aplicación.
        expect(esDeCarga("Cannot read properties of undefined (reading 'default')")).toBe(true);
        expect(esDeCarga("Cannot read properties of undefined (reading 'defaultValue')")).toBe(false);
    });
});

describe('el guard de recarga', () => {
    it('comparte la clave de sessionStorage con main.jsx', () => {
        // Son dos caminos hacia la MISMA recarga. Con dos claves distintas se
        // turnarían para recargar y el portal entraría en bucle.
        const enMain = fs.readFileSync(path.join(import.meta.dirname, '../../src/main.jsx'), 'utf8');
        const clave = fuente.match(/const CLAVE_RECARGA = '([^']+)'/)?.[1];
        expect(clave, 'ErrorBoundary no declara CLAVE_RECARGA').toBeTruthy();
        expect(enMain, `main.jsx no usa la clave «${clave}»`).toContain(clave);
    });

    it('la ventana es de al menos 30 segundos', () => {
        // Sin ventana, un chunk que falta de verdad recarga sin parar.
        const ms = fuente.match(/const VENTANA_MS = ([\d_]+)/)?.[1]?.replace(/_/g, '');
        expect(Number(ms)).toBeGreaterThanOrEqual(30_000);
    });

    it('sin sessionStorage NO recarga', () => {
        // Modo privado de Safari. Ante la duda, la pantalla de error: es fea
        // pero es estable, y un bucle de recargas no deja ni leerla.
        expect(fuente).toMatch(/catch \{ recargando = false;/);
    });
});
