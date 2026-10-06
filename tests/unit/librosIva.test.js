import { describe, expect, it } from 'vitest';
import { calcularTotales, debitoDeConsumidor } from '@nucleo/utils/librosIva';

const vacio = { consumidor: [], contribuyente: [], anulados: [], compras: [], percepcion: [], retencion: [], notas: [], renta: [], retencionVentas: [] };

describe('librosIva', () => {
    it('el débito de consumidor sale del precio con IVA adentro', () => {
        expect(debitoDeConsumidor(113)).toBeCloseTo(13, 10);
    });
    it('los totales de cada libro', () => {
        const t = calcularTotales({ ...vacio,
            consumidor: [{ documentos: 3, ventas_gravadas: 113, total_diario: 113 }],
            contribuyente: [{ ventas_gravadas: 100, debito_fiscal: 13, retencion_iva: 1, total: 112 }],
            compras: [{ compras_gravadas: 50, credito_fiscal: 6.5, total: 56.5 }],
            notas: [{ tipo_dte: '05', monto: 10, iva: 1.3 }, { tipo_dte: '06', monto: 4, iva: 0.52 }],
            retencionVentas: [{ monto_sujeto: 100, retencion_iva: 1 }, { monto_sujeto: 50, retencion_iva: 0.5, anulada: true }],
        });
        expect(t.consumidor).toMatchObject({ docs: 3, gravadas: 113, total: 113 });
        expect(t.consumidor.debito).toBeCloseTo(13, 10);
        expect(t.contribuyente).toMatchObject({ docs: 1, debito: 13, retencion: 1 });
        expect(t.compras.debito).toBe(6.5);
        expect(t.notas.gravadas).toBe(6);
        expect(t.notas.debito).toBeCloseTo(0.78, 10);
        expect(t.retencionVentas.debito).toBe(1);
    });
});
