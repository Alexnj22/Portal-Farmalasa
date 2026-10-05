import { describe, expect, it } from 'vitest';
import { avisoDePuntos, claveDeMovimiento, detalleDeMovimiento, dolaresDePuntos, motorQuieto, rotuloDeMovimiento } from '@nucleo/utils/puntosTexto';

describe('puntosTexto', () => {
    it('100 puntos son un dólar', () => {
        expect(dolaresDePuntos(420)).toBe('$4.20');
        expect(dolaresDePuntos(null)).toBe('$0.00');
    });
    it('la clave del detalle es <tipo>-<id>, y el canje devuelto usa la del canje', () => {
        expect(claveDeMovimiento({ tipo: 'ajuste', id: 4 })).toBe('ajuste-4');
        expect(claveDeMovimiento({ tipo: 'canje_devuelto', id: 7 })).toBe('canje-7');
    });
    it('rótulo y detalle no repiten la palabra', () => {
        expect(rotuloDeMovimiento({ tipo: 'ajuste', puntos: 150 })).toBe('Puntos dados');
        expect(rotuloDeMovimiento({ tipo: 'ajuste', puntos: -5 })).toBe('Puntos quitados');
        expect(rotuloDeMovimiento({ tipo: 'raro' })).toBe('Ajuste');
        expect(detalleDeMovimiento({ motivo: 'canje · ticket DTE-0099' })).toBe('ticket DTE-0099');
        expect(detalleDeMovimiento({ motivo: 'compra · ticket 104233' }, { documento: 'DTE-1' })).toBe('DTE-1');
    });
    it('un aviso desconocido se muestra igual', () => {
        expect(avisoDePuntos({ tipo: 'canje_sin_saldo', faltaron: 30 })).toMatchObject({ severidad: 'danger' });
        expect(avisoDePuntos({ tipo: 'canje_sin_saldo', faltaron: 30 }).puntos({ faltaron: 30 })).toMatch(/30/);
        expect(avisoDePuntos({ tipo: 'nuevo', puntos: 5 }).rotulo).toBe('Movimiento para revisar');
    });
    it('el motor quieto sólo cuenta con salas abiertas', () => {
        const mediodiaSV = Date.parse('2026-10-05T18:00:00Z');
        expect(motorQuieto('2026-10-05T16:00:00Z', true, mediodiaSV)).toBe(120);
        expect(motorQuieto('2026-10-05T17:30:00Z', true, mediodiaSV)).toBeNull();
        expect(motorQuieto('2026-10-05T16:00:00Z', false, mediodiaSV)).toBeNull();
        expect(motorQuieto('2026-10-05T01:00:00Z', true, Date.parse('2026-10-05T05:00:00Z'))).toBeNull();
    });
});
