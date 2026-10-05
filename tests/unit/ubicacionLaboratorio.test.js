import { describe, expect, it } from 'vitest';
import { filaDeUbicacion, rotuloDeUbicacion, seccionDeLaboratorio, tieneUbicacion } from '@nucleo/utils/ubicacionLaboratorio';

describe('ubicacionLaboratorio', () => {
    it('clasifica por cómo se nombran en el catálogo', () => {
        expect(seccionDeLaboratorio('4-3M')).toBe('insumos');
        expect(seccionDeLaboratorio('ZONA COSMETICA')).toBe('cosmeticos');
        expect(seccionDeLaboratorio('ABBOTT')).toBe('principales');
    });
    it('dice la ubicación en palabras', () => {
        expect(rotuloDeUbicacion({ estante: '7', peldano: '2', bodega_numero: '3' })).toEqual({ sala: 'Estante 7 · peldaño 2', bodega: 'Estante 3' });
        expect(rotuloDeUbicacion({ vitrina: '1' }).sala).toBe('Vitrina 1');
        expect(rotuloDeUbicacion({})).toEqual({ sala: null, bodega: null });
        expect(tieneUbicacion({ peldano: ' ' })).toBe(false);
    });
    it('lo vacío se guarda como null', () => {
        expect(filaDeUbicacion(2, 32, { estante: ' 7 ', vitrina: '' }, new Date('2026-10-05T00:00:00Z'))).toEqual({
            lab_id: 2, branch_id: 32, vitrina: null, estante: '7', peldano: null, bodega_numero: null, bodega_peldano: null, updated_at: '2026-10-05T00:00:00.000Z',
        });
    });
});
