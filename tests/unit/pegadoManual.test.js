import { describe, it, expect } from 'vitest';
import { esAtajoDePegar, esPegadoDeUnaPersona, VENTANA_ATAJO_MS } from '../../src/utils/pegadoManual.js';

// Esta regla decide si el login deja pasar un pegado. Se equivocó dos veces en
// producción el 2026-08-16 y las dos veces el síntoma fue el mismo: el usuario
// no podía iniciar sesión. Los casos de abajo son esos, escritos.
describe('esPegadoDeUnaPersona', () => {
    it('el Ctrl+V de una persona se reconoce', () => {
        const ahora = 1_000_000;
        expect(esPegadoDeUnaPersona({ confiable: true, ahora, ultimoAtajo: ahora - 30 })).toBe(true);
    });

    it('el gestor que rellena con execCommand NO se confunde con una persona', () => {
        // Su evento es de confianza igual que el de un Ctrl+V —lo genera el
        // navegador—, pero no viene precedido de ningún atajo. Éste es el caso
        // que la primera corrección (mirar sólo `isTrusted`) daba por humano, y
        // por eso el campo de contraseña quedaba vacío.
        const ahora = 1_000_000;
        expect(esPegadoDeUnaPersona({ confiable: true, ahora, ultimoAtajo: 0 })).toBe(false);
    });

    it('un atajo viejo ya no cuenta', () => {
        const ahora = 1_000_000;
        expect(esPegadoDeUnaPersona({ confiable: true, ahora, ultimoAtajo: ahora - VENTANA_ATAJO_MS })).toBe(false);
        expect(esPegadoDeUnaPersona({ confiable: true, ahora, ultimoAtajo: ahora - 5_000 })).toBe(false);
    });

    it('un evento sintético nunca es de una persona, aunque haya atajo cerca', () => {
        const ahora = 1_000_000;
        expect(esPegadoDeUnaPersona({ confiable: false, ahora, ultimoAtajo: ahora - 10 })).toBe(false);
    });
});

describe('esAtajoDePegar', () => {
    it('reconoce Ctrl+V y Cmd+V, en mayúscula o minúscula', () => {
        expect(esAtajoDePegar({ ctrlKey: true, key: 'v' })).toBe(true);
        expect(esAtajoDePegar({ metaKey: true, key: 'V' })).toBe(true);
    });

    it('no confunde otras teclas ni la V sola', () => {
        expect(esAtajoDePegar({ ctrlKey: true, key: 'c' })).toBe(false);
        expect(esAtajoDePegar({ key: 'v' })).toBe(false);
        expect(esAtajoDePegar(null)).toBe(false);
    });
});
