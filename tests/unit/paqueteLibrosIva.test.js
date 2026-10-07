import { describe, it, expect, vi } from 'vitest';

vi.mock('@nucleo/data/librosIva', () => ({
    fetchAnexoRetencionRenta: vi.fn(), fetchLibroConsumidor: vi.fn(), fetchLibroContribuyente: vi.fn(), fetchLibroAnulados: vi.fn(),
    fetchLibroCompras: vi.fn(), fetchLibroPercepcion: vi.fn(), fetchLibroRetencion: vi.fn(), fetchNotasCreditoCompras: vi.fn(), fetchRetencionVentas: vi.fn(),
}));
const { archivosDeLibrosIva } = await import('@nucleo/data/paqueteLibrosIva');

const vacio = { consumidor: [], contribuyente: [], anulados: [], compras: [], percepcion: [], retencion: [], notas: [], renta: [], retencionVentas: [] };

describe('paquete del mes de los libros de IVA', () => {
    it('sin filas no hay archivos', () => {
        expect(archivosDeLibrosIva(vacio, { mes: '2026-09', nombreSucursal: () => 'X' })).toEqual([]);
    });
    it('una carpeta por libro y un archivo por cada sucursal que aparece', () => {
        const fila = (branch_id) => ({ branch_id, fecha: '2026-09-02', total: 1 });
        const e = archivosDeLibrosIva({ ...vacio, compras: [fila(2), fila(1)] }, { mes: '2026-09', nombreSucursal: (id) => `Salud ${id}` });
        expect(e.map(x => x.name)).toHaveLength(2);
        expect(e[0].name).toMatch(/\/Salud-1\.csv$/);
        expect(e[1].name).toMatch(/\/Salud-2\.csv$/);
    });
});
