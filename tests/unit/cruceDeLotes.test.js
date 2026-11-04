import { describe, it, expect } from 'vitest';
import { deshacerCruce } from '../../supabase/functions/_shared/cruceDeLotes.ts';

// Renglón como lo devuelve `descargar_compras_json.php`.
const r = (producto_id, cantidad, subtotal_linea, lote, fecha_vencimiento) => ({
    producto_id, cantidad, precios: { subtotal_linea }, trazabilidad: { lote, fecha_vencimiento },
});
const resumen = (out) => out.map(({ p, aproximado }) =>
    [p.producto_id, p.cantidad, p.trazabilidad.lote, aproximado]);

describe('deshacerCruce — la lista cruza cantidades con lotes', () => {
    it('compra 150 (real): dos cantidades × dos lotes → dos renglones, lote aproximado', () => {
        const out = deshacerCruce([
            r(2143, 1, 4.81, 'M41855', '2026-06-01'), r(2143, 19, 91.30, 'M43046', '2026-08-01'),
            r(2143, 19, 91.30, 'M41855', '2026-06-01'), r(2143, 1, 4.81, 'M43046', '2026-08-01'),
        ]);
        expect(out).toHaveLength(2);
        expect(out.map(x => x.p.cantidad).sort((a, b) => a - b)).toEqual([1, 19]);
        expect(new Set(out.map(x => x.p.trazabilidad.lote))).toEqual(new Set(['M41855', 'M43046']));
        expect(out.every(x => x.aproximado)).toBe(true);
    });

    it('compra 6483 (real): mismo lote en los dos renglones → exacto, sin aproximar', () => {
        const out = deshacerCruce([
            r(2738, 110, 178.51, '6E047', '2030-05-01'), r(2738, 110, 178.51, '6E047', '2030-05-01'),
            r(2738, 140, 227.20, '6E047', '2030-05-01'), r(2738, 140, 227.20, '6E047', '2030-05-01'),
            r(1114, 28, 53.12, 'GENERICO', '2028-03-01'),
        ]);
        expect(resumen(out)).toEqual([
            [2738, 110, '6E047', false], [2738, 140, '6E047', false], [1114, 28, 'GENERICO', false],
        ]);
    });

    it('dos renglones idénticos (3 + 3 del mismo lote) vienen 4 veces → quedan 2', () => {
        const out = deshacerCruce(Array(4).fill(0).map(() => r(5, 3, 9, 'L1', '2028-01-01')));
        expect(out).toHaveLength(2);
        expect(out.every(x => !x.aproximado)).toBe(true);
    });

    it('tres renglones (9 filas) → tres', () => {
        const filas = [];
        for (const [c, t] of [[1, 1], [2, 2], [3, 3]]) for (const l of ['A', 'B', 'C']) filas.push(r(7, c, t, l, '2029-01-01'));
        const out = deshacerCruce(filas);
        expect(out.map(x => x.p.cantidad)).toEqual([1, 2, 3]);
        expect(out.map(x => x.p.trazabilidad.lote)).toEqual(['A', 'B', 'C']);
    });

    it('lo que no encaja en el cruce se deja tal cual', () => {
        // 4 lotes distintos de una cantidad cada uno: no es un cruce.
        const filas = ['A', 'B', 'C', 'D'].map((l, i) => r(9, i + 1, i + 1, l, '2029-01-01'));
        expect(deshacerCruce(filas)).toHaveLength(4);
        // 2 filas (no es un cuadrado): tal cual.
        expect(deshacerCruce([r(9, 1, 1, 'A', 'x'), r(9, 1, 1, 'A', 'x')])).toHaveLength(2);
        // Un renglón suelto no se toca.
        expect(deshacerCruce([r(9, 1, 1, 'A', 'x')])).toHaveLength(1);
    });
});
