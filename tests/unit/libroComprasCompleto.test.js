import { describe, expect, it } from 'vitest';
import { filasDeLaPestana, totalesDeclarable, totalesDelLibro } from '@nucleo/utils/libroComprasCompleto';

describe('libroComprasCompleto', () => {
    const filas = [
        { origen: 'registrada', credito_fiscal: 13, total: 113 },
        { origen: 'solo_documento', credito_fiscal: 6.5, total: 56.5 },
    ];
    it('la pestaña y los totales del libro', () => {
        expect(filasDeLaPestana(filas, 'sin_compra')).toHaveLength(1);
        expect(filasDeLaPestana(filas, 'todos')).toHaveLength(2);
        expect(totalesDelLibro(filas)).toEqual({ docs: 2, credito: 19.5, total: 169.5, sinCompra: 1, creditoSinCompra: 6.5 });
    });
    it('el declarable: repetidos, motivos y crédito trabado', () => {
        const t = totalesDeclarable([
            { credito_fiscal: 10, computa_credito: true, veces_en_el_libro: 2 },
            { credito_fiscal: 10, computa_credito: true, veces_en_el_libro: 2 },
            { credito_fiscal: 0, computa_credito: false, motivo: 'Falta confirmar la deducibilidad', total: 113 },
        ]);
        expect(t.docs).toBe(3);
        expect(t.repRenglones).toBe(2);
        expect(t.repDocs).toBe(1);
        expect(t.repCredito).toBe(10);
        expect(t.sinCuenta).toBe(1);
        expect(t.trabado).toBeCloseTo(13, 6);
    });
});

describe('el CSV del libro completo y del declarable', () => {
    it('vacío no es cero en percepción, y lleva la fila de totales', async () => {
        const { csvDelLibroCompleto, csvDelDeclarable } = await import('@nucleo/utils/libroComprasCompleto');
        const c = csvDelLibroCompleto([{ fecha: '2026-09-03', origen: 'registrada', branch_id: 4, compras_gravadas: 10, credito_fiscal: 1.3, total: 11.3, percepcion_iva: null }], { credito: 1.3, total: 11.3 }, () => 'Salud 1', '2026-09');
        expect(c.headers).toHaveLength(15);
        expect(c.rows[0][12]).toBe('');
        expect(c.rows[0][2]).toBe('Salud 1');
        expect(c.rows.at(-1)[0]).toBe('TOTALES');
        const d = csvDelDeclarable([{ computa_credito: false, veces_en_el_libro: 2, motivo: 'Sin sello' }], { credito: 0 }, '2026-09');
        expect(d.rows[0][9]).toBe('NO');
        expect(d.rows[0][10]).toBe('SI x2');
        expect(d.archivo).toBe('libro-compras-declarable_2026-09');
    });
});
