import { describe, it, expect, vi } from 'vitest';

vi.mock('@nucleo/data/distribucionCompras', () => ({
    fetchLibrosVentas: vi.fn(), fetchLibroCompras: vi.fn(), fetchRelacionadas: vi.fn(),
}));

const { archivosDelPaquete } = await import('@nucleo/data/distribucionPaquete');

describe('paquete del mes de la distribuidora', () => {
    it('un mes vacío lleva sólo el resumen', () => {
        const e = archivosDelPaquete({ ventas: {}, compras: [], relacionadas: {} });
        expect(e.map(x => x.name)).toEqual(['resumen-del-mes.csv']);
        expect(e[0].texto).toContain('Documentos sin sello de Hacienda');
    });
    it('las compras a relacionadas entran con su costo a 4 decimales', () => {
        const e = archivosDelPaquete({ ventas: {}, compras: [], relacionadas: { productos: [{ nombre: 'X', unidades: 2, pagado: 10, pagado_u: 4.4248 }] } });
        const rel = e.find(x => x.name === 'compras-a-relacionadas.csv');
        expect(rel.texto).toContain('4.4248');
    });
});
