import { describe, it, expect } from 'vitest';
import { repartirEnLotes } from '../../supabase/functions/_shared/erp-traslado.ts';
import { validarLoteEscrito } from '../../supabase/functions/_shared/erp-asignar-lote.ts';
import { lotesEnUnidades, repartirPedido, esLoteGenerico, rotuloDeLote } from '@nucleo/utils/unidadesInventario';

// «GENERICO» no es un lote: es la existencia que todavía no tiene lote asignado
// (2026-11-05). Su fecha en el sistema es «0000-00-00», o sea la PRIMERA del
// orden por vencimiento, y el reparto la tomaba antes que un lote real: de la
// sala salía una caja con lote impreso mientras el sistema descontaba GENERICO.

describe('el reparto deja GENERICO para el final', () => {
    // IVERMECTINA 6MG en Salud 1, 5-nov: GENERICO 10 y el lote 1020325 con 1.
    const LOTES = [
        { id: '25700', numero: 'GENERICO', vence: '0000-00-00', stock: 10 },
        { id: '23769', numero: '1020325',  vence: '2028-03-01', stock: 1 },
    ];

    it('sin reserva, sale primero el lote real', () => {
        const r = repartirEnLotes(LOTES, 1, 1);
        expect(r.renglones).toEqual([{ cantidad: 1, idLote: '23769', lote: '1020325' }]);
    });

    it('lo que el real no cubre sale de GENERICO, y sólo eso', () => {
        const r = repartirEnLotes(LOTES, 3, 1);
        expect(r.faltan).toBe(0);
        expect(r.renglones).toEqual([
            { cantidad: 1, idLote: '23769', lote: '1020325' },
            { cantidad: 2, idLote: '25700', lote: 'GENERICO' },
        ]);
    });

    it('una reserva de GENERICO se sigue respetando', () => {
        const r = repartirEnLotes(LOTES, 2, 1, [{ numero: 'GENERICO', paquetes: 2 }]);
        expect(r.renglones).toEqual([{ cantidad: 2, idLote: '25700', lote: 'GENERICO' }]);
    });
});

describe('en la pantalla, GENERICO también va al final', () => {
    it('aunque traiga una fecha anterior a todas', () => {
        const lotes = lotesEnUnidades([
            { lote: 'GENERICO', fecha_vencimiento: '0005-01-01', cantidad: 5, presentacion: 'UNIDAD', factor: 1 },
            { lote: 'L1', fecha_vencimiento: '2027-01-01', cantidad: 2, presentacion: 'UNIDAD', factor: 1 },
        ]);
        expect(lotes.map(l => l.lote)).toEqual(['L1', 'GENERICO']);
        const { reparto } = repartirPedido(lotes, 3);
        expect(reparto.map(l => [l.lote, l.toma])).toEqual([['L1', 2], ['GENERICO', 1]]);
    });

    it('se lee «Sin lote asignado»', () => {
        expect(esLoteGenerico(' generico ')).toBe(true);
        expect(rotuloDeLote('GENERICO')).toBe('Sin lote asignado');
        expect(rotuloDeLote('ABC123')).toBe('ABC123');
        expect(rotuloDeLote('')).toBe('sin lote');
    });
});

describe('el lote que se escribe desde la caja', () => {
    it('se normaliza a mayúsculas sin tildes', () => {
        expect(validarLoteEscrito('  abc-123 ', '2030-05-01')).toEqual({ ok: true, lote: 'ABC-123', vence: '2030-05-01' });
    });
    it('no acepta GENERICO, vacío, sin fecha ni una fecha pasada', () => {
        expect(validarLoteEscrito('generico', '2030-05-01').ok).toBe(false);
        expect(validarLoteEscrito('', '2030-05-01').ok).toBe(false);
        expect(validarLoteEscrito('L1', '').ok).toBe(false);
        expect(validarLoteEscrito('L1', '2020-01-01').ok).toBe(false);
    });
});
