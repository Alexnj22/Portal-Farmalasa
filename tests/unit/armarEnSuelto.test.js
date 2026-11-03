import { describe, it, expect, vi, afterEach } from 'vitest';
import { armarEnSuelto, repartirEnLotes, disponibleEnBodega } from '../../supabase/functions/_shared/erp-traslado.ts';

// Pedido 11-311026-3-S2, 2026-10-31: LISITRAM RELAX «CAJA X 20» es factor 2 y
// en bodega había 1 unidad en cada uno de dos lotes. Bodega mandó la caja con
// una de cada uno y el traslado no se registró («alcanzan para 0»). Tiene que
// salir como 2 unidades de 1, una por lote.

const LISITRAM = {
    encontrado: true,
    presentaciones: [{ id: '6', tipo: 'CAJA X 20' }, { id: '9', tipo: 'UNIDAD' }],
    existencia: 1, vence: '', regulado: true,
    lotes: [
        { id: '501', numero: 'A1', vence: '2027-01-01', stock: 1 },
        { id: '502', numero: 'B2', vence: '2027-06-01', stock: 1 },
    ],
};

/** El sistema contesta el factor de cada presentación por id. */
function sistema(factores) {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const id = new URLSearchParams(String(init?.body ?? '')).get('id_presentacion');
        return new Response(JSON.stringify({ unidad: factores[id], costo: '1', precio: '2' }), { status: 200 });
    }));
}

afterEach(() => vi.unstubAllGlobals());

describe('armarEnSuelto', () => {
    it('el caso real: el tope dice 0 cajas, pero sale como 2 unidades, una por lote', async () => {
        expect(disponibleEnBodega(LISITRAM, 2).paquetes).toBe(0);
        sistema({ 6: 2, 9: 1 });
        const r = await armarEnSuelto('c', LISITRAM, 2, 1);
        expect(r?.pres.id).toBe('9');
        expect(r?.cantidad).toBe(2);
        const reparto = repartirEnLotes(LISITRAM.lotes, r.cantidad, Number(r.pres.unidad));
        expect(reparto.faltan).toBe(0);
        expect(reparto.renglones.map((x) => [x.idLote, x.cantidad])).toEqual([['501', 1], ['502', 1]]);
    });

    it('si ni en unidades alcanza, no inventa: null', async () => {
        sistema({ 6: 2, 9: 1 });
        expect(await armarEnSuelto('c', LISITRAM, 2, 2)).toBeNull();
    });

    it('sin presentación de 1, null (y sale el mensaje de siempre)', async () => {
        sistema({ 6: 2, 9: 2 });
        expect(await armarEnSuelto('c', LISITRAM, 2, 1)).toBeNull();
    });

    it('sin control de lote o con factor 1 no aplica', async () => {
        sistema({ 6: 2, 9: 1 });
        expect(await armarEnSuelto('c', { ...LISITRAM, regulado: false }, 2, 1)).toBeNull();
        expect(await armarEnSuelto('c', LISITRAM, 1, 3)).toBeNull();
    });
});
