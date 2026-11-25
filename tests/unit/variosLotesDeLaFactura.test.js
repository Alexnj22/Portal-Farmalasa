// Un producto en varios lotes, con la cantidad de cada uno escrita en la
// factura (2026-11-25): VIJOSA y COFARSAL. Textos tomados de facturas reales.
import { describe, it, expect } from 'vitest';
import { variosLotesEnTexto, deTextoLibre } from '../../supabase/functions/_shared/loteVencimiento.ts';
import { ajusteInicial, conCarga, cambiarOtroLote, lotesDelRenglon, puedeLlevarVariosLotes, decisionDeRenglon } from '@nucleo/utils/cargaDeCompra';

const VIJOSA = 'FENALER 2mg/5mL JARABE\rLOTE: 2602054A (V-08-29) CANT: 24 LOTE: 2509184A (V-03-29) CANT: 6';
const COFARSAL = 'PAILL|ANAFLAT X 40 TAB. MASTICABLES \rLote: 0045895 Cant.: 11. Fecha Exp.: 01/11/2029\rLote: 0045897 Cant.: 31. Fecha Exp.: 01/11/2029';

describe('variosLotesEnTexto', () => {
    it('VIJOSA: cada lote con su vencimiento y su cantidad', () => {
        expect(variosLotesEnTexto(VIJOSA, 2026)).toEqual([
            { lote: '2602054A', vence: '2029-08-01', cantidad: 24 },
            { lote: '2509184A', vence: '2029-03-01', cantidad: 6 },
        ]);
    });
    it('COFARSAL: Lote / Cant. / Fecha Exp.', () => {
        expect(variosLotesEnTexto(COFARSAL, 2026)).toEqual([
            { lote: '0045895', vence: '2029-11-01', cantidad: 11 },
            { lote: '0045897', vence: '2029-11-01', cantidad: 31 },
        ]);
    });
    it('un solo lote, o un desglose a medias, no es «varios»', () => {
        expect(variosLotesEnTexto('SANTA ELENA|AGUA FLORIDA 750ml \rLote: 116/25 Cant.: 12. Fecha Exp.: 01/02/2028', 2026)).toBeNull();
        expect(variosLotesEnTexto('X\rLote: A123 Cant.: 2\rLote: B456', 2026)).toBeNull();
        expect(variosLotesEnTexto('false|1.00|00249|31/05/2028|18.00| | | |Lotesoft 0.5%mg', 2026)).toBeNull();
    });
    it('el primer lote es el mismo que ya se leía', () => {
        expect(deTextoLibre(VIJOSA, 2026).lote).toBe('2602054A');
    });
});

describe('la pantalla arranca con los lotes de la factura', () => {
    const r = {
        cantidad: 30, factor_proveedor: 1, lote: '2602054A', vence: '2029-08-01',
        lotes_factura: [{ lote: '2602054A', vence: '2029-08-01', cantidad: 24 }, { lote: '2509184A', vence: '2029-03-01', cantidad: 6 }],
    };
    it('el primero en Lote/Vence, los demás escritos, y cuadra con la factura', () => {
        const aj = ajusteInicial(r);
        expect(aj.otrosLotes).toEqual([{ lote: '2509184A', vence: '2029-03', unidades: '6', de_factura: 6 }]);
        expect(puedeLlevarVariosLotes(r)).toBe(true);
        expect(lotesDelRenglon(r, aj).map(l => l.unidades)).toEqual([24, 6]);
        expect(decisionDeRenglon(aj, 1, r).lotes).toEqual([
            { lote: '2602054A', vence: '2029-08', unidades: 24 }, { lote: '2509184A', vence: '2029-03', unidades: 6 },
        ]);
    });
    it('si cambia el factor, los lotes de la factura se recalculan', () => {
        const aj = conCarga(ajusteInicial(r), r, '300');
        expect(aj.otrosLotes[0].unidades).toBe('60');
        expect(lotesDelRenglon(r, aj).map(l => l.unidades)).toEqual([240, 60]);
    });
    it('lo que se escribe a mano manda', () => {
        const aj0 = ajusteInicial(r);
        const aj = { ...aj0, otrosLotes: cambiarOtroLote(aj0.otrosLotes, 0, { unidades: '5' }) };
        expect(aj.otrosLotes[0].de_factura).toBeUndefined();
        expect(conCarga(aj, r, '300').otrosLotes[0].unidades).toBe('5');
    });
    it('sin lotes en la factura, nada cambia', () => {
        expect(ajusteInicial({ cantidad: 3, lote: 'A1', vence: '2028-01-01' }).otrosLotes).toBeUndefined();
        expect(puedeLlevarVariosLotes({ lote: 'A1', vence: '2028-01-01' })).toBe(false);
    });
});
