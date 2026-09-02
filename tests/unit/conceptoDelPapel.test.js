import { describe, it, expect } from 'vitest';
import { conceptoDelPapel } from '../../src/utils/conceptoDelPapel';

// ═══════════════════════════════════════════════════════════════════════════
// Qué operación fue, dicho por el papel.
//
// Es la frase que llena sola el concepto en los DOS lados del POS Promerica —la
// entrada (`MiCajaView`) y la salida (`SalidaDeBolsa`)— desde el 2026-09-02.
// Lo que estas pruebas anclan es la trampa que costó una remesa trabada el
// 2026-08-21 y que acá vuelve por la puerta de atrás: la boleta de una remesa
// la imprime el POS y ARRIBA lleva el banco que procesa el cobro, no la red que
// entrega el dinero.
// ═══════════════════════════════════════════════════════════════════════════

describe('conceptoDelPapel', () => {
    it('la remesa se nombra con la RED, nunca con el banco de la cabecera', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA',
            entidad: 'BANCO PROMERICA',
            red_remesas: 'MONEY GRAM WS',
        })).toBe('Remesa MONEY GRAM WS');
    });

    it('sin red impresa dice «Remesa» a secas: no toma el banco del POS', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'REMESA', entidad: 'BANCO PROMERICA', red_remesas: null,
        })).toBe('Remesa');
    });

    // Lo que la sala venía escribiendo a mano en «Otro»: «retiro con targeta»,
    // «retiro con token». El nombre impreso ahí es el banco del aparato, así que
    // el concepto no lleva a nadie.
    it('el retiro de efectivo no nombra a nadie', () => {
        expect(conceptoDelPapel({
            tipo_operacion: 'RETIRO', entidad: 'AB FARMACIA LA SALUD 3',
        })).toBe('Retiro de efectivo');
    });

    it('el pago de un servicio sí lleva a quién se le paga', () => {
        expect(conceptoDelPapel({ tipo_operacion: 'PAGO_SERVICIO', entidad: 'CAESS' }))
            .toBe('Pago de CAESS');
    });

    it('sin operación legible queda el nombre impreso, y sin nada, vacío', () => {
        expect(conceptoDelPapel({ entidad: 'FERRETERIA DON GENARO' }))
            .toBe('FERRETERIA DON GENARO');
        expect(conceptoDelPapel({ tipo_operacion: 'OTRO' })).toBe('');
        expect(conceptoDelPapel(null)).toBe('');
    });
});
