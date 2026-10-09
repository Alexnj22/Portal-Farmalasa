import { describe, expect, it, vi, beforeEach } from 'vitest';

// La reimpresión de una sala ya finalizada dice lo que SALIÓ, y el renglón que
// no salió se queda en la hoja con 0 para no correr a los de abajo de hoja
// (2026-10-08). Se mira el documento que se le entrega a pdfmake.
let documento = null;
vi.mock('pdfmake/build/pdfmake', () => ({
    default: {
        addVirtualFileSystem: () => {},
        createPdf: (doc) => { documento = doc; return { download: () => {} }; },
    },
}));
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: {} }));
vi.mock('@nucleo/data/pedidos', () => ({
    fetchErpSucursalAddressMap: async () => ({ data: [], error: null }),
}));

const { printFromPedidoItems } = await import('@nucleo/utils/pedidoPrint');

const renglon = (id, nombre, asignada, enviada) => ({
    id, factor: 1, dispatch_factor: 1, dispatch_tipo: 'unidad',
    cantidad_asignada: asignada, cantidad_enviada: enviada,
    lotes_asignados: [], products: { nombre, laboratorios: { nombre: 'LAB' } },
});
// Las celdas de cantidad de la tabla, en orden, con el producto de su fila.
const cantidades = () => {
    const out = [];
    const recorrer = (n) => {
        if (Array.isArray(n)) { n.forEach(recorrer); return; }
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n.body)) {
            n.body.forEach(fila => {
                if (!Array.isArray(fila)) return;
                const textos = fila.map(c => (typeof c === 'object' ? (c?.text ?? c?.stack?.[0]?.text) : c)).map(t => (typeof t === 'string' ? t : Array.isArray(t) ? t.map(x => x?.text ?? x).join('') : ''));
                const prod = textos.find(t => /^PROD /.test(t));
                if (prod) out.push([prod, textos.find(t => /^\d+$/.test(t))]);
            });
        }
        Object.values(n).forEach(recorrer);
    };
    recorrer(documento.content);
    return out;
};

describe('printFromPedidoItems — reimpresión por lo enviado', () => {
    beforeEach(() => { documento = null; globalThis.fetch = async () => { throw new Error('sin red'); }; });
    const filas = [renglon(1, 'PROD A', 5, 3), renglon(2, 'PROD B', 4, 0), renglon(3, 'PROD C', 2, null)];

    it('por omisión imprime lo asignado (como siempre)', async () => {
        await printFromPedidoItems(1, [[1, filas]], {}, 'X');
        expect(cantidades()).toEqual([['PROD A', '5'], ['PROD B', '4'], ['PROD C', '2']]);
    });
    it('con `cantidad: enviada` dice lo que salió y deja en 0 lo que no salió', async () => {
        await printFromPedidoItems(1, [[1, filas]], { cantidad: 'enviada' }, 'X');
        expect(cantidades()).toEqual([['PROD A', '3'], ['PROD B', '0'], ['PROD C', '2']]);
    });
});
