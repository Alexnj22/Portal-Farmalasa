import { describe, expect, it } from 'vitest';
import { afinidadDeForma, decidirSrs } from '@nucleo/utils/enriquecerSrs';

const caps = { nombre_comercial: 'ORFENAFLEX- D 50MG/35 MG CAPSULAS', NOMBRE_FORMA_FARMACEUTICA: 'CAPSULA', principio_activo: 'CITRATO DE ORFENADRINA + DICLOFENAC SODICO', concentracion: '35 mg. + 50 mg.' };
const iny = { nombre_comercial: 'ORFENAFLEX 30 MG/ML SOLUCION INYECTABLE', NOMBRE_FORMA_FARMACEUTICA: 'SOLUCION INYECTABLE', principio_activo: 'CITRATO DE ORFENADRINA', concentracion: '30 mg.' };

describe('la forma farmacéutica ordena las sugerencias', () => {
    it('ORFENAFLEX -D DISPENSADOR: las cápsulas van antes que el inyectable', () => {
        const { entrada } = decidirSrs({ nombre: 'ORFENAFLEX -D DISPENSADOR' }, [iny, caps]);
        expect(entrada.srs).toBe(caps);
    });
    it('si el catálogo dice inyectable, gana el inyectable', () => {
        const { entrada } = decidirSrs({ nombre: 'ORFENAFLEX 30 MG AMPOLLA' }, [caps, iny]);
        expect(entrada.srs).toBe(iny);
    });
    it('misma forma premia y distinta castiga', () => {
        expect(afinidadDeForma('X TAB', caps)).toBeGreaterThan(1);
        expect(afinidadDeForma('X JARABE', caps)).toBeLessThan(1);
        expect(afinidadDeForma('X', { nombre_comercial: 'X' })).toBe(1);
    });
    it('el umbral de auto mira el parecido, no el orden', () => {
        const { tipo } = decidirSrs({ nombre: 'ORFENAFLEX -D DISPENSADOR' }, [iny, caps]);
        expect(tipo).toBe('revisar');
    });
});
