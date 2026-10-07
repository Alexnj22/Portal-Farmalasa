import { describe, expect, it } from 'vitest';
import { datosDePieza, faltaEnPieza, PIEZA_VACIA } from '@nucleo/utils/marketing';

describe('formulario de pieza', () => {
    const lista = { ...PIEZA_VACIA, titulo: 'Día del padre', fecha: '2026-10-10', marcas: [3], formato: 'post' };
    it('falta título, fecha, marca o formato', () => {
        expect(faltaEnPieza(PIEZA_VACIA)).toBe(true);
        expect(faltaEnPieza(lista)).toBe(false);
    });
    it('no deja pasar el tope de pauta del mes', () => {
        expect(faltaEnPieza({ ...lista, pautar: true, monto: '60' }, { limite: 100, otros: 50 })).toBe(true);
        expect(faltaEnPieza({ ...lista, pautar: true, monto: '50' }, { limite: 100, otros: 50 })).toBe(false);
    });
    it('la fila: sin monto, vacíos en null y la primera marca', () => {
        const d = datosDePieza({ ...lista, monto: '20', hora: '' });
        expect(d).not.toHaveProperty('monto');
        expect(d).toMatchObject({ hora: null, pilar: null, marca_id: 3 });
        expect(datosDePieza({ ...lista, estado: 'publicado' }).publicado_en).toBeTruthy();
        expect(datosDePieza({ ...lista, estado: 'publicado' }, { publicado_en: 'x' }).publicado_en).toBeUndefined();
    });
});
