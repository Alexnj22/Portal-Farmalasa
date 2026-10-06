import { describe, expect, it } from 'vitest';
import { tarjetasDeDocumentosDeCompra } from '@nucleo/utils/tarjetasDeCompras';

describe('tarjetasDeDocumentosDeCompra', () => {
    it('la nota de crédito resta y el invalidado va aparte', () => {
        const t = tarjetasDeDocumentosDeCompra([
            { tipo_dte: '03', monto_total: '113', total_iva: '13', proveedor_id: 1 },
            { tipo_dte: '05', monto_total: '11.3', total_iva: '1.3', proveedor_id: 1 },
            { tipo_dte: '03', monto_total: '50', total_iva: '5', invalidado: true, proveedor_id: null },
        ]);
        expect(t.totalCompras).toBeCloseTo(124.3);
        expect(t.comprasNetas).toBeCloseTo(101.7);
        expect(t.creditoFiscal).toBeCloseTo(11.7);
        expect(t.invalidadosCount).toBe(1);
        expect(t.invalidadosMonto).toBe(50);
        expect(t.sinProveedorCount).toBe(1);
    });
});
