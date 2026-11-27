import { describe, expect, it } from 'vitest';
import {
    claveDeDocumento, filtrarDocumentos, repartirEnDocumentos, rotuloDeDocumento,
} from '@nucleo/utils/documentosDeDiferencia';
import { contraste, diferenciaDelCorte, notaDeCifra } from '@nucleo/utils/cortesDiagnostico';

const venta = (id, monto, extra = {}) => ({ tipo: 'VENTA', id, numero: String(3500 + id), monto, fecha: '2026-11-27', hora: '09:23:25', detalle: 'CLIENTES VARIOS', ...extra });

describe('repartirEnDocumentos', () => {
    it('una venta exacta explica todo el sobrante', () => {
        const r = repartirEnDocumentos([venta(1, 11.85)], 11.85);
        expect(r.explica).toBe(11.85);
        expect(r.queda).toBe(0);
        expect(r.sobran).toEqual([]);
    });

    it('una venta más grande explica sólo lo que queda (el resto sí está en la caja de hoy)', () => {
        const r = repartirEnDocumentos([venta(1, 32.58)], 6.93);
        expect(r.partes).toEqual([{ doc: venta(1, 32.58), explica: 6.93 }]);
        expect(r.queda).toBe(0);
    });

    it('varias se suman en el orden elegido, al centavo', () => {
        const r = repartirEnDocumentos([venta(1, 0.1), venta(2, 0.2), venta(3, 5)], 0.35);
        expect(r.partes.map((p) => p.explica)).toEqual([0.1, 0.2, 0.05]);
        expect(r.explica).toBe(0.35);
    });

    it('la que llega cuando ya no queda nada sobra (la base la rechaza)', () => {
        const r = repartirEnDocumentos([venta(1, 20), venta(2, 3)], 11.85);
        expect(r.sobran.map(claveDeDocumento)).toEqual(['VENTA:2']);
    });

    it('si no alcanzan, queda lo que falta', () => {
        const r = repartirEnDocumentos([venta(1, 5)], 11.85);
        expect(r.queda).toBe(6.85);
    });
});

describe('rótulos y búsqueda', () => {
    it('el comprobante se nombra por tipo', () => {
        expect(rotuloDeDocumento(venta(1, 1))).toBe('Fac 3501');
        expect(rotuloDeDocumento({ tipo: 'INGRESO', id: 9, numero: '812' })).toBe('Ingreso 812');
        expect(rotuloDeDocumento({ tipo: 'VALE', id: 9, numero: '77' })).toBe('Vale 77');
    });

    it('se busca por número y por monto', () => {
        const docs = [venta(1, 11.85), venta(2, 3.1)];
        expect(filtrarDocumentos(docs, '3502').resultados.map((d) => d.id)).toEqual([2]);
        expect(filtrarDocumentos(docs, '11.85').resultados.map((d) => d.id)).toEqual([1]);
        expect(filtrarDocumentos(docs, '3.1').resultados.map((d) => d.id)).toEqual([2]);
        expect(filtrarDocumentos(docs, '3.10').resultados.map((d) => d.id)).toEqual([2]);
    });
});

describe('contraste con lo cobrado en otro corte', () => {
    // El corte de HOY: el comprobante cuenta la venta de $11.85, pero su
    // efectivo está en la bolsa de ayer, así que se contó $11.85 menos.
    const hoy = {
        tipo: 'C', total_declarado: 988.15, diferencia_erp: -11.85,
        tk_total_caja: 1000, tk_subtotal: 1000, tk_vales: 0, tk_cobros_credito: 0,
        cobros_portal_efectivo: 0,
    };

    it('sin ligar, hoy sale un faltante', () => {
        expect(diferenciaDelCorte({ ...hoy, efectivo_otro_corte: 0 }).valor).toBe(-11.85);
    });

    it('ligada, hoy cuadra y la brecha no acusa nada', () => {
        const c = contraste({ ...hoy, efectivo_otro_corte: 11.85 });
        expect(c.esperado).toBe(988.15);
        expect(c.difTicket).toBe(0);
        expect(c.enDisputa).toBe(false);
        expect(diferenciaDelCorte({ ...hoy, efectivo_otro_corte: 11.85 }).valor).toBe(0);
    });

    it('un vale va al revés: suma a lo esperado', () => {
        const conVale = { ...hoy, total_declarado: 1011.85, diferencia_erp: 11.85, efectivo_otro_corte: -11.85 };
        expect(diferenciaDelCorte(conVale).valor).toBe(0);
    });

    it('la nota dice por qué el esperado no es el del comprobante', () => {
        const n = notaDeCifra({ ...hoy, efectivo_otro_corte: 11.85 });
        expect(n.alerta).toBe(false);
        expect(n.titulo).toBe('Hay dinero que está en otro corte');
    });

    it('sin la columna, el corte se lee como siempre', () => {
        expect(diferenciaDelCorte(hoy).valor).toBe(-11.85);
    });
});
