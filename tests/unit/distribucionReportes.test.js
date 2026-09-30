import { describe, it, expect } from 'vitest';
import { margen, mesesRecientes, comprasParaLibro, totalesDelLibro } from '../../src/views/distribucion/reportes.js';
import { construirLibro } from '@nucleo/utils/libroIva.js';

describe('reportes de la distribuidora', () => {
    it('margen sobre la venta; sin venta no hay margen (no es 0 %)', () => {
        expect(margen(100, 72.5)).toBe(27.5);
        expect(margen(0, 10)).toBeNull();
    });
    it('meses: el actual primero y cruza de año', () => {
        const m = mesesRecientes(3, '2026-02');
        expect(m.map(x => x.key)).toEqual(['2026-02', '2026-01', '2025-12']);
        expect(m[0].label).toBe('Febrero 2026');
    });
    const filas = [
        { fecha: '2026-09-20', tipo_doc: '03', numero: 'DTE-03-M001P001-000000000001234', proveedor: 'DROGUERIA X', nit: '06140101011010',
          exenta: 0, gravada: 25, iva: 3.25, percepcion: 0.25, retencion: 0, total: 28.5, en_libro: true },
        { fecha: '2026-09-21', tipo_doc: '01', numero: 'F-9', proveedor: 'FERRETERIA', exenta: 0, gravada: 11.3, iva: 0, percepcion: 0, retencion: 0, total: 11.3, en_libro: false },
    ];
    it('al libro sólo va el Crédito Fiscal, y con el generador de 23 columnas de las farmacias', () => {
        const libro = construirLibro('compras', { compras: comprasParaLibro(filas) });
        expect(libro.headers).toBeNull();
        expect(libro.rows).toHaveLength(1);
        const r = libro.rows[0];
        expect(r).toHaveLength(23);
        expect(r.slice(0, 6)).toEqual(['20/09/2026', '4', '', 'DTE03M001P001000000000001234', '06140101011010', 'DROGUERIA X']);
        expect(r[9]).toBe('25.00');   // gravadas
        expect(r[13]).toBe('3.25');   // crédito fiscal
        expect(r[14]).toBe('28.50');  // total
        expect(r[21]).toBe('0.2500'); // percepción, cuatro decimales
    });
    it('los totales cuentan sólo lo que entra al libro', () => {
        expect(totalesDelLibro(filas)).toMatchObject({ gravada: 25, iva: 3.25, percepcion: 0.25, total: 28.5, documentos: 1 });
    });
});
