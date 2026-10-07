import { describe, expect, it } from 'vitest';
import { corteZHtml } from '@nucleo/utils/corteZPrint';

const fila = (suc) => ({
    sucursal: suc, periodo: '2026-09-01', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30',
    detalle: { secciones: { tiquete: { total: 10 }, factura: { gravadas: 100, total: 100 }, ccf: {} } },
    declaracion: { factura: { gravadas: 88.5, debito: 11.5, total: 100 } },
    z_total: 110, portal_total: 110, dif_total: 0, z_factura: 100, portal_factura: 100, dif_factura: 0,
});

describe('corteZHtml', () => {
    it('traduce el papel del portal: textos, tablas y una hoja por sucursal', () => {
        const html = corteZHtml([fila('Salud 1'), fila('Salud <2>')]);
        expect(html).toContain('Corte Z mensual');
        expect(html).toContain('Para la declaración');
        expect(html).toContain('Sin diferencia contra el libro.');
        expect(html.match(/page-break-before/g)).toHaveLength(1);
        expect(html).toContain('Salud &lt;2&gt;');
    });
    it('sin filas no arma nada', () => {
        expect(() => corteZHtml([])).toThrow();
    });
});
