import { describe, it, expect } from 'vitest';
import { selloEnTextoDelPdf } from '../../supabase/functions/_shared/selloDeCompra.ts';

const S1 = '20264DFC62D728EC47DAB76411CBB58492BLNMF0';
const S2 = '2026A0FC62D728EC47DAB76411CBB58492BLNMFX';

describe('el sello impreso en el PDF', () => {
    it('Guardado: etiquetas en una columna, valores en otra — un solo token con forma de sello', () => {
        const t = 'CÓDIGO GENERACIÓN SELLO DE RECEPCIÓN NÚMERO DE CONTROL 65887AF3-0F53-49B2-B385-CF62BA9CD170 '
            + `${S1} DTE-03-M001P001-000000000023882 PREVIO NORMAL 12/11/2026`;
        expect(selloEnTextoDelPdf(t, 2026)).toEqual({ sello: S1, motivo: 'uno' });
    });

    it('pegado al rótulo con dos puntos también vale', () => {
        expect(selloEnTextoDelPdf(`Sello de recepción:${S1}`, 2026).sello).toBe(S1);
    });

    it('un pedazo de una cadena más larga (firma, QR) no es sello', () => {
        expect(selloEnTextoDelPdf(`firma eyJ${S1}abc`, 2026).sello).toBeNull();
        expect(selloEnTextoDelPdf(`X${S1}`, 2026).sello).toBeNull();
    });

    it('sin texto (PDF escaneado) no inventa nada', () => {
        expect(selloEnTextoDelPdf('', 2026)).toEqual({ sello: null, motivo: 'sin-sello' });
        expect(selloEnTextoDelPdf(null, 2026).sello).toBeNull();
    });

    it('un año lejano al de emisión no pasa', () => {
        expect(selloEnTextoDelPdf(`Sello ${S1.replace('2026', '2019')}`, 2026).sello).toBeNull();
        expect(selloEnTextoDelPdf(`Sello ${S1.replace('2026', '2027')}`, 2026).sello).not.toBeNull();
    });

    it('dos sellos: gana el que está junto a la etiqueta', () => {
        const t = `Documento relacionado ${S2} ............................................ Sello de recepción ${S1}`;
        expect(selloEnTextoDelPdf(t, 2026)).toEqual({ sello: S1, motivo: 'junto-a-la-etiqueta' });
    });

    it('dos sellos sin etiqueta: ninguno', () => {
        expect(selloEnTextoDelPdf(`${S1} ${S2}`, 2026)).toEqual({ sello: null, motivo: 'varios-sin-etiqueta' });
    });

    it('el mismo sello repetido cuenta como uno', () => {
        expect(selloEnTextoDelPdf(`${S1} pie ${S1}`, 2026).motivo).toBe('uno');
    });
});
