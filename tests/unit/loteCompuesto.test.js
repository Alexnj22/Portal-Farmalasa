// Un empaque con dos lotes (2026-11-25): Sertal forte C de LETERAGO trae dos
// componentes, cada uno con su lote, en el mismo campo de la factura.
import { describe, it, expect } from 'vitest';
import { loteCompuesto, deTextoLibre } from '../../supabase/functions/_shared/loteVencimiento.ts';
import { lineaDelSobre } from '../../supabase/functions/_shared/compraSobre.ts';

describe('loteCompuesto', () => {
    it('dos lotes en un campo son un lote compuesto', () => {
        expect(loteCompuesto('251077K 251100K')).toBe('251077K/251100K');
        expect(loteCompuesto('259471 / 259472')).toBe('259471/259472');
        expect(loteCompuesto('0115025,0115125')).toBe('0115025/0115125');
    });
    it('una pieza repetida cuenta una vez', () => {
        expect(loteCompuesto('4002A/4002A')).toBe('4002A');
    });
    it('un nombre o un gramaje no es un lote compuesto', () => {
        expect(loteCompuesto('Sertal compuesto 15mg / 2ml')).toBeNull();
        expect(loteCompuesto('100mg / 2ml')).toBeNull();
        expect(loteCompuesto('L 5099S1')).toBeNull();
        expect(loteCompuesto('M12398')).toBeNull();
        expect(loteCompuesto('')).toBeNull();
    });
});

describe('la factura con dos lotes en el renglón', () => {
    it('LETERAGO: Sertal forte C se lee con los dos lotes', () => {
        expect(deTextoLibre('false|1.00|251077K 251100K|30/11/2028|18.00| | | |Sertal forte C 100mg / 2ml x 3 amp sol iny', 2026))
            .toEqual({ lote: '251077K/251100K', vence: '2028-11-01' });
    });
    it('los renglones de un solo lote no cambian', () => {
        expect(deTextoLibre('false|8.00|M12398|01/10/2028|0.00| | | |Sertal compuesto 15mg / 2ml x 3 amp sol iny', 2026))
            .toEqual({ lote: 'M12398', vence: '2028-10-01' });
    });
});

describe('dos lotes tecleados', () => {
    const SERTAL = {
        id: 4946, nombre: 'SERTAL COMPUESTO FORTE X 3 AMPOLLAS', perecedero: true, regulado: true,
        presentaciones: [{ id: '7989', unidad: 3, costo: 9.12, precio: 15.71 }],
    };
    const RENGLON = { descripcion: 'Sertal forte C', cantidad: 1, precio: 11.12, descuento: 2, exento: false, subtotal: 9.12 };
    const dec = (lote) => ({ tipo: 'producto', producto: SERTAL, factor: 3, lote, vence: '2028-11' });

    it('se mandan como lote compuesto y no frenan', () => {
        const r = lineaDelSobre(9, RENGLON, dec('251077K 251100K'));
        expect(r.linea.numero_lote).toBe('251077K/251100K');
        expect(r.problemas.filter(p => /lote/.test(p.texto))).toEqual([]);
    });
    it('un lote tecleado queda como está', () => {
        expect(lineaDelSobre(9, RENGLON, dec('M12398')).linea.numero_lote).toBe('M12398');
    });
});
