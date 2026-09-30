import { describe, it, expect } from 'vitest';
import { margen, mesesRecientes, comprasParaLibro, totalesDelLibro, totalesContribuyente, totalesConsumidor, retencionesDeClientes, percepcionesAClientes, csvPercepcionClientes, anexoDeCompras, resumenFiscal } from '../../src/views/distribucion/reportes.js';
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

describe('libros de ventas de la distribuidora', () => {
    const ccf = { fecha: '2026-09-01', tipo_dte: '03', numero_control: 'DTE-03-B001P001-000000000000001', sello_recepcion: 'S'.repeat(40),
        codigo_generacion: 'a16d673e-f7ac-4d4a-a8cd-04cb9d37970f', nrc: '1000006', nit: '06140000047514', cliente: 'SUPER',
        ventas_exentas: 0, ventas_gravadas: 100, debito_fiscal: 13, percibido: 1, retenido: 0 };
    const nc = { ...ccf, tipo_dte: '05', numero_control: 'DTE-05-B001P001-000000000000001', ventas_gravadas: 10, debito_fiscal: 1.3, percibido: 0.1 };
    it('la nota de crédito va con tipo 05 en la columna C; sin tipo sigue siendo 03 (farmacias)', () => {
        const rows = construirLibro('contribuyente', { contribuyente: [ccf, nc, { ...ccf, tipo_dte: undefined }] }).rows;
        expect(rows.map(r => r[2])).toEqual(['03', '05', '03']);
        expect(rows[1]).toHaveLength(20);
        expect(rows[1][3]).toBe('DTE05B001P001000000000000001');
    });
    it('los totales del contribuyente restan las notas', () => {
        expect(totalesContribuyente([ccf, nc])).toMatchObject({ gravadas: 90, debito: 11.7, percibido: 0.9, documentos: 1, notas: 1 });
    });
    it('consumidor final: débito contenido en la gravada', () => {
        expect(totalesConsumidor([{ ventas_gravadas: 113, ventas_exentas: 0, total_diario: 113, documentos: 3 }]))
            .toMatchObject({ gravadas: 113, debito: 13, documentos: 3, dias: 1 });
    });
    it('anulados: una nota invalidada sale con su tipo', () => {
        const r = construirLibro('anulados', { anulados: [{ numero_control: 'DTE-05-X', tipo_dte: '05', sello_recepcion: 'S', codigo_generacion: 'a-b' }] }).rows[0];
        expect(r[4]).toBe('05');
    });
});

describe('retenciones y percepciones de la distribuidora', () => {
    const ccf = { fecha: '2026-09-01', tipo_dte: '03', numero_control: 'DTE-03-X-1', sello_recepcion: 'S', codigo_generacion: 'c', nrc: '1', nit: '2',
        cliente: 'SUPER', ventas_exentas: 0, ventas_gravadas: 200, debito_fiscal: 26, percibido: 2, retenido: 2 };
    const nc = { ...ccf, tipo_dte: '05', ventas_gravadas: 20, debito_fiscal: 2.6, percibido: 0.2, retenido: 0.2 };
    it('lo retenido por clientes, con el formato de las farmacias y la nota en negativo', () => {
        const filas = retencionesDeClientes([ccf, nc, { ...ccf, retenido: 0 }]);
        expect(filas.map(f => f.retencion_iva)).toEqual([2, -0.2]);
        const l = construirLibro('retencionVentas', { retencionVentas: filas });
        expect(l.headers).toHaveLength(14);
        expect(l.rows.at(-1)[11]).toBe('1.80'); // TOTALES del IVA retenido
    });
    it('lo percibido a clientes', () => {
        const filas = percepcionesAClientes([ccf, nc]);
        expect(csvPercepcionClientes(filas).at(-1)).toEqual(['TOTALES', '', '', '', '', '', '180.00', '1.80']);
    });
    it('anexo de percepción de compras con 9 columnas', () => {
        const filas = anexoDeCompras([{ fecha: '2026-09-02', proveedor: 'DROG', nit: '0614', tipo_doc: '03', numero: 'DTE-03-A', gravada: 100, percepcion: 1, retencion: 0 }], 'percepcion');
        const r = construirLibro('percepcion', { percepcion: filas }).rows[0];
        expect(r).toHaveLength(9);
        expect(r.slice(4, 9)).toEqual(['03', 'DTE03A', '', '100.0000', '1.0000']);
    });
    it('el resumen fiscal: débito − crédito, y los anticipos aparte', () => {
        const r = resumenFiscal({ tc: { debito: 23.4, retenido: 1.8, percibido: 1.8 }, tf: { debito: 13 }, compras: [{ en_libro: true, iva: 10, percepcion: 1 }] });
        expect(r).toMatchObject({ debito: 36.4, credito: 10, impuesto: 26.4, retenidoNos: 1.8, percibidoNos: 1, percibidoAClientes: 1.8 });
    });
});
