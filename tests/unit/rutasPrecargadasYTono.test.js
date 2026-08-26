// La precarga de una vista al pasar el mouse, y el tono del kiosco.
//
// **La precarga.** Los `import()` viven en un objeto y no sueltos en cada
// `lazy()` para que el menú pueda reusar exactamente la misma función: al pasar
// el mouse por un ítem se dispara su `import()`, así el chunk ya está resuelto y
// evaluado cuando se hace clic. Medido antes de esto: la primera entrada a un
// módulo tardaba entre **350 y 850 ms** y la segunda 60 — la diferencia es
// justamente resolver y evaluar el módulo.
//
// Lo que hay que anclar es que las dos listas apunten a lo mismo: si el mapa por
// ruta señalara un importador que no existe, `prefetchRuta` no precargaría nada
// y nadie lo notaría — la vista igual abre, sólo que lento, que es exactamente
// el defecto que esto vino a resolver.
//
// **El tono** es lo único que le dice a alguien de espaldas al kiosco que su
// marcaje entró. Y `playSafely` existe porque **el audio nunca debe romper el
// flujo de marcaje**: un WebView de Capacitor que bloquea el audio hasta el
// primer gesto no puede impedir que la persona fiche.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IMPORTADORES, IMPORTADOR_POR_RUTA, prefetchRuta } from '../../src/constants/routeImporters';
import { playFeedbackTone, playSuccessTone, playWarningTone, playErrorTone }
    from '../../src/utils/kioskSound';

describe('cada ruta sabe qué vista precargar', () => {
    it('todo importador es una función que se puede llamar dos veces', () => {
        // El navegador cachea la promesa, así que pasar el mouse veinte veces
        // por el mismo ítem no descarga nada dos veces.
        for (const [nombre, fn] of Object.entries(IMPORTADORES))
            expect(typeof fn, nombre).toBe('function');
    });

    it('ninguna ruta apunta a un importador que no existe', () => {
        // Un `undefined` acá no rompe nada: `prefetchRuta` simplemente no
        // precarga, y la vista abre lenta sin que nadie sepa por qué.
        const conocidos = new Set(Object.values(IMPORTADORES));
        for (const [ruta, fn] of Object.entries(IMPORTADOR_POR_RUTA)) {
            expect(fn, ruta).toBeTruthy();
            expect(conocidos.has(fn), `${ruta} apunta a un importador que no está en IMPORTADORES`).toBe(true);
        }
    });

    it('la ruta comodín tiene su propia vista', () => {
        expect(IMPORTADOR_POR_RUTA['*']).toBe(IMPORTADORES.NotFoundView);
    });

    it('ninguna ruta se declara dos veces con destinos distintos', () => {
        // Las claves de un objeto ya son únicas; lo que se comprueba es que no
        // haya dos NOMBRES de importador distintos para la misma vista, que es
        // como se cuelan dos chunks del mismo archivo.
        const rutas = Object.keys(IMPORTADOR_POR_RUTA);
        expect(new Set(rutas).size).toBe(rutas.length);
    });
});

describe('precargar al pasar el mouse', () => {
    it('toma el PRIMER segmento de la dirección, no la dirección entera', async () => {
        // El menú pasa `/pedidos`, pero un enlace profundo pasa
        // `/inventario/conteo/7`: sin quedarse con el primer segmento, ninguno
        // de los dos encontraría su importador.
        const espia = vi.fn(() => Promise.resolve({}));
        IMPORTADOR_POR_RUTA['ruta-de-prueba'] = espia;
        try {
            prefetchRuta('/ruta-de-prueba');
            prefetchRuta('/ruta-de-prueba/detalle/7');
            expect(espia).toHaveBeenCalledTimes(2);
            prefetchRuta('ruta-de-prueba');          // sin la barra inicial: NO es el primer segmento
            expect(espia).toHaveBeenCalledTimes(2);
        } finally {
            delete IMPORTADOR_POR_RUTA['ruta-de-prueba'];
        }
    });

    it('una ruta desconocida no revienta', () => {
        expect(() => prefetchRuta('/no-existe-esta-ruta')).not.toThrow();
        expect(() => prefetchRuta('')).not.toThrow();
        expect(() => prefetchRuta(null)).not.toThrow();
        expect(() => prefetchRuta('/')).not.toThrow();
    });

    it('si la descarga falla, no propaga: el `lazy()` lo reintenta al navegar', async () => {
        // Un rechazo sin capturar acá sería un error no manejado por pasar el
        // mouse sobre un menú.
        expect(() => prefetchRuta('/avisos')).not.toThrow();
        await new Promise(r => setTimeout(r, 0));
    });
});

describe('el tono que avisa que el marcaje entró', () => {
    let creados;

    beforeEach(() => {
        creados = [];
        const nodo = () => ({
            type: '', frequency: { value: 0 },
            gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
        });
        window.AudioContext = vi.fn(function AudioCtx() {
            this.state = 'running';
            this.currentTime = 0;
            this.destination = {};
            this.createOscillator = () => { const n = nodo(); creados.push(n); return n; };
            this.createGain = nodo;
            this.resume = () => Promise.resolve();
        });
    });

    it('el color VERDE suena a éxito', () => {
        playFeedbackTone('green');
        expect(creados.length).toBeGreaterThan(0);
    });

    it('los tres tonos existen y suenan distinto', () => {
        playSuccessTone();
        const exito = creados.map(n => n.frequency.value);
        creados = [];
        playErrorTone();
        const error = creados.map(n => n.frequency.value);
        expect(exito).not.toEqual(error);
        creados = [];
        playWarningTone();
        expect(creados.length).toBeGreaterThan(0);
    });

    it('un color que no está en el mapa NO suena, en vez de sonar cualquier cosa', () => {
        // Un tono equivocado le dice a quien está de espaldas que pasó otra cosa.
        playFeedbackTone('turquesa');
        playFeedbackTone(undefined);
        expect(creados).toHaveLength(0);
    });

    it('sin soporte de audio el marcaje NO se rompe', () => {
        // Pasa en un WebView de Capacitor que bloquea el audio hasta el primer
        // gesto real del usuario.
        delete window.AudioContext;
        delete window.webkitAudioContext;
        expect(() => playFeedbackTone('green')).not.toThrow();
        expect(() => playSuccessTone()).not.toThrow();
    });
});
