import { describe, it, expect } from 'vitest';
import { lotesDelRegistro, lotesDelRegistroParaCsv } from '@nucleo/utils/cargaDeCompra';

// La compra 6729 (carga 595): un renglón en dos lotes.
const partida = {
    lote: '2602219', vence: '2028-04-01', unidades: 240,
    lotes: [
        { lote: '2602219', vence: '2028-04-01', unidades: 96 },
        { lote: '2605034', vence: '2028-05-01', unidades: 144 },
    ],
};

describe('lotes del registro de compras', () => {
    it('un renglón en varios lotes devuelve el desglose', () => {
        expect(lotesDelRegistro(partida).map(l => l.unidades)).toEqual([96, 144]);
        expect(lotesDelRegistroParaCsv(partida)).toEqual(['2602219 (96 u.) / 2605034 (144 u.)', '2028-04-01 / 2028-05-01']);
    });
    it('un solo lote usa el de la fila', () => {
        const f = { lote: 'M12398', vence: '2028-10-01', lotes: null };
        expect(lotesDelRegistro(f)).toEqual([{ lote: 'M12398', vence: '2028-10-01', unidades: null }]);
        expect(lotesDelRegistroParaCsv(f)).toEqual(['M12398', '2028-10-01']);
    });
    it('sin lote no inventa uno', () => {
        expect(lotesDelRegistroParaCsv({ lote: null, vence: null })).toEqual(['', '']);
    });
});
