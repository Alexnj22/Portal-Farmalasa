import { describe, expect, it } from 'vitest';
import { codigoParaEscanear, leerCodigoDePremio } from '@nucleo/utils/codigoDePremio';

describe('código de premio', () => {
    it('acepta con guion, sin guion y con lo que el teclado puso', () => {
        for (const t of ['PS-000123', 'PS000123', "PS'000123", 'ps?000123', '  PS 000123 ']) {
            expect(leerCodigoDePremio(t)).toBe('PS-000123');
        }
    });
    it('rechaza lo que no es un premio', () => {
        for (const t of ['K7MP4XN', '04512345-6', 'PS-00012', 'R-000004', '', null]) {
            expect(leerCodigoDePremio(t)).toBeNull();
        }
    });
    it('las barras van sin guion', () => {
        expect(codigoParaEscanear('PS-000123')).toBe('PS000123');
    });
});
