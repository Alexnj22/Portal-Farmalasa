import { describe, expect, it } from 'vitest';
import { esDeGaleria, mediosDe, textoParaPublicar } from '@nucleo/utils/marketing';

describe('galería de marketing', () => {
    it('sólo lo liberado y aprobado', () => {
        expect(esDeGaleria({ liberada: true, estado: 'aprobado' })).toBe(true);
        expect(esDeGaleria({ liberada: true, estado: 'publicado' })).toBe(true);
        expect(esDeGaleria({ liberada: true, estado: 'finalizado' })).toBe(false);
        expect(esDeGaleria({ liberada: false, estado: 'aprobado' })).toBe(false);
    });
    it('el texto y los archivos vigentes', () => {
        expect(textoParaPublicar({ copy: 'Hola', hashtags: '#x' })).toBe('Hola\n\n#x');
        expect(textoParaPublicar({ hashtags: '#x' })).toBe('#x');
        expect(mediosDe({ archivos: [{ url: 'a' }, { url: 'b', reemplazado: true }, { enlace: 'c' }] })).toEqual([{ url: 'a' }]);
    });
});
