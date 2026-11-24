// Varios lotes en un renglón de compra (2026-11-24): VIROGRIP de Vijosa vino
// en dos lotes y la factura dice uno. La cantidad total siempre cuadra.
import { describe, it, expect } from 'vitest';
import { lineaDelSobre, partirEnLotes, totalesDelSobre } from '../../supabase/functions/_shared/compraSobre.ts';
import { lotesDelRenglon, problemaDeLotes, decisionDeRenglon, faltaDelRenglon, vencesDeDecision } from '@nucleo/utils/cargaDeCompra.js';

const VIROGRIP = {
    id: 9999, nombre: 'VIROGRIP X 10 SOBRES', perecedero: true, regulado: false,
    presentaciones: [{ id: '1', unidad: 1, costo: 0.5, precio: 0.85 }, { id: '2', unidad: 10, costo: 5, precio: 8 }],
};
const RENGLON = { descripcion: 'VIROGRIP CAJA X 10', cantidad: 6, precio: 5.2, descuento: 0, exento: false, subtotal: 31.2 };
const dec = (lote, vence) => ({ tipo: 'producto', producto: VIROGRIP, factor: 10, lote, vence });

describe('partirEnLotes', () => {
    const { linea } = lineaDelSobre(0, RENGLON, dec('A1', '2027-05'));

    it('una línea por lote, mismo costo, cantidades que suman lo facturado', () => {
        const r = partirEnLotes(0, RENGLON, dec('A1', '2027-05'), linea, [
            { lote: 'A1', vence: '2027-05', unidades: 40 }, { lote: 'B2', vence: '2028-01', unidades: 20 },
        ]);
        expect(r.problemas).toEqual([]);
        expect(r.lineas.map(l => [l.cant, l.vence, l.compra, l.id_presentacion])).toEqual([
            ['4', '2027-05-01', linea.compra, '2'], ['2', '2028-01-01', linea.compra, '2'],
        ]);
        expect(totalesDelSobre(r.lineas, 'CCF', 0).total).toBe(totalesDelSobre([linea], 'CCF', 0).total);
    });

    it('frena si no cuadra, si no es paquete completo o si dos lotes son iguales', () => {
        expect(partirEnLotes(0, RENGLON, dec('A1', '2027-05'), linea, [{ lote: 'A1', vence: '2027-05', unidades: 40 }, { lote: 'B', vence: '2028-01', unidades: 10 }]).lineas).toBeNull();
        expect(partirEnLotes(0, RENGLON, dec('A1', '2027-05'), linea, [{ lote: 'A1', vence: '2027-05', unidades: 45 }, { lote: 'B', vence: '2028-01', unidades: 15 }]).lineas).toBeNull();
        expect(partirEnLotes(0, RENGLON, dec('A1', '2027-05'), linea, [{ lote: 'A1', vence: '2027-05', unidades: 30 }, { lote: 'a1', vence: '2027-05', unidades: 30 }]).lineas).toBeNull();
    });
});

describe('lotes en pantalla', () => {
    const r = { cantidad: 6 };
    const aj = { factor: '10', lote: 'A1', vence: '2027-05', otrosLotes: [{ lote: 'B2', vence: '2026-12', unidades: '20' }] };

    it('el primer lote se queda con el resto', () => {
        expect(lotesDelRenglon(r, aj).map(l => l.unidades)).toEqual([40, 20]);
        expect(problemaDeLotes(r, aj)).toBeNull();
        expect(problemaDeLotes(r, { ...aj, otrosLotes: [{ lote: 'B2', vence: '2026-12', unidades: '60' }] })).toMatch(/no le queda nada/);
        expect(problemaDeLotes(r, { ...aj, otrosLotes: [{ lote: 'B2', vence: '2026-12', unidades: '' }] })).toMatch(/lote 2/);
    });

    it('viaja con la lista de lotes sólo si hay más de uno', () => {
        const d = decisionDeRenglon(aj, 1, r);
        expect(d.lotes).toEqual([{ lote: 'A1', vence: '2027-05', unidades: 40 }, { lote: 'B2', vence: '2026-12', unidades: 20 }]);
        expect(vencesDeDecision(d).sort()[0]).toBe('2026-12');
        expect('lotes' in decisionDeRenglon({ ...aj, otrosLotes: undefined }, 1, r)).toBe(false);
        expect('lotes' in decisionDeRenglon({ ...aj, erroneo: true }, 1, r)).toBe(false);
    });

    it('un lote sin número o sin vencimiento cuenta como falta', () => {
        const f = faltaDelRenglon({ producto_id: 1, seguro: true, cantidad: 6 }, { ...aj, otrosLotes: [{ lote: '', vence: '', unidades: '20' }] }, true);
        expect(f).toMatchObject({ sin_lote: true, sin_vencimiento: true, lotes_sin_cuadrar: false });
    });
});
