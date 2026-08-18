import { describe, it, expect } from 'vitest';
import { fmtFechaLarga, lotesPedidos } from '../../src/views/traslados/trasladoTexto';

// `fmtFechaLarga` tiene tres usos y los tres son vencimientos de lote, que
// llegan como fecha SIN hora ('2027-11-01'). Leída como UTC y pintada en hora
// local retrocedía un día, y con el día 01 —que es casi siempre— retrocedía un
// MES entero: la tarjeta del traslado decía «31 oct 27» de un lote que vence el
// 1 de noviembre. Es el mismo defecto que tenía `fmtVence` de `pedidoPrint.js`,
// sobre el mismo dato, así que se ancla igual.
describe('fmtFechaLarga — el vencimiento del lote', () => {
    it('no retrocede al mes anterior en el día 01', () => {
        expect(fmtFechaLarga('2027-11-01')).toMatch(/01.*nov.*27/i);
        expect(fmtFechaLarga('2028-03-01')).toMatch(/01.*mar.*28/i);
    });

    it('respeta un día cualquiera', () => {
        expect(fmtFechaLarga('2029-06-15')).toMatch(/15.*jun.*29/i);
    });

    it('sin fecha devuelve vacío, no una fecha inventada', () => {
        expect(fmtFechaLarga(null)).toBe('');
        expect(fmtFechaLarga('')).toBe('');
    });
});

describe('lotesPedidos — sólo lo que tiene algo que decir', () => {
    it('junta los lotes de todos los renglones', () => {
        const meta = { items: [
            { lotes: [{ lote: 'A1', vence: '2027-11-01', unidades: 2 }] },
            { lotes: [{ lote: 'B2', vence: '2028-03-01', unidades: 1 }] },
        ] };
        expect(lotesPedidos(meta).map(l => l.lote)).toEqual(['A1', 'B2']);
    });

    it('un pedido viejo sin lotes no deja un hueco', () => {
        expect(lotesPedidos({ items: [{ descripcion: 'X' }] })).toEqual([]);
        expect(lotesPedidos(null)).toEqual([]);
    });

    it('descarta el lote que no trae ni número ni vencimiento', () => {
        const meta = { items: [{ lotes: [{ unidades: 3 }, { lote: 'C3', unidades: 1 }] }] };
        expect(lotesPedidos(meta).map(l => l.lote)).toEqual(['C3']);
    });
});
