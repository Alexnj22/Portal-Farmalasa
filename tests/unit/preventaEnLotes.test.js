// La preventa de una reserva reparte entre lotes (2026-11-05): desde que todo
// medicamento es «regulado», su existencia vieja vive en GENERICO y la nueva
// en lotes reales, y una reserva puede necesitar de los dos.
import { describe, it, expect } from 'vitest';
import { repartirEnLotesDeVenta } from '../../supabase/functions/_shared/preventaCaja.ts';

describe('repartirEnLotesDeVenta', () => {
    it('un solo lote que alcanza: un renglón', () => {
        expect(repartirEnLotesDeVenta([{ id: '7', stock: 10 }], 4, 1))
            .toEqual({ partes: [{ id: '7', cantidad: 4 }], faltan: 0 });
    });
    it('GENERICO 2 + lote real 3, piden 4: sale de los dos, en el orden de la caja', () => {
        expect(repartirEnLotesDeVenta([{ id: 'G', stock: 2 }, { id: 'R', stock: 3 }], 4, 1))
            .toEqual({ partes: [{ id: 'G', cantidad: 2 }, { id: 'R', cantidad: 2 }], faltan: 0 });
    });
    it('no parte una presentación: cajas de 10 con 15 + 15 sueltas dan 2, no 3', () => {
        expect(repartirEnLotesDeVenta([{ id: 'A', stock: 15 }, { id: 'B', stock: 15 }], 3, 10))
            .toEqual({ partes: [{ id: 'A', cantidad: 1 }, { id: 'B', cantidad: 1 }], faltan: 1 });
    });
    it('salta los lotes sin existencia', () => {
        expect(repartirEnLotesDeVenta([{ id: 'A', stock: 0 }, { id: 'B', stock: 5 }], 2, 1))
            .toEqual({ partes: [{ id: 'B', cantidad: 2 }], faltan: 0 });
    });
});
