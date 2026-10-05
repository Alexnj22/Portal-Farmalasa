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
