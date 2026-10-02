import { describe, expect, it } from 'vitest';
import { planDeGuardadoMinMax } from '@nucleo/utils/minmaxGuardar';

const base = { productId: 10, sucursalId: 5, hayPublicado: true };
describe('planDeGuardadoMinMax', () => {
    it('en vivo con datos publicados y sin borrador', () => {
        const p = planDeGuardadoMinMax({ ...base, row: { effective_min: 2, effective_max: 5, draft_status: 'none' }, min: '3', max: '6' });
        expect(p.tipo).toBe('vivo');
        expect(p.payload).toMatchObject({ min_units: 3, max_units: 6, draft_status: 'none' });
        expect(p.accion).toBe('MINMAX_LIVE_EDIT');
    });
    it('al borrador si la fila tiene borrador pendiente', () => {
        const p = planDeGuardadoMinMax({ ...base, row: { draft_status: 'pending', draft_min: 1, draft_max: 2 }, min: '3', max: '6' });
        expect(p.tipo).toBe('borrador');
        expect(p.payload).toMatchObject({ draft_min: 3, draft_max: 6, draft_status: 'pending' });
    });
    it('MAX tiene que ser mayor que MIN', () => {
        expect(planDeGuardadoMinMax({ ...base, row: {}, min: '6', max: '6' }).error).toMatch(/MAX/);
    });
    it('poner A en 0 pide confirmación', () => {
        expect(planDeGuardadoMinMax({ ...base, row: { abc_class: 'A', effective_min: 2 }, min: '0', max: '0' }).confirmarCero).toBe(true);
        expect(planDeGuardadoMinMax({ ...base, row: { abc_class: 'A', effective_min: 2 }, min: '0', max: '0', confirmado: true }).tipo).toBe('vivo');
    });
    it('Bodega guarda el delta sobre la suma de las salas', () => {
        const p = planDeGuardadoMinMax({ ...base, sucursalId: 6, row: { pub_min: 10, pub_max: 20, effective_min: 10, effective_max: 20 }, min: '12', max: '25' });
        expect(p.payload).toMatchObject({ manual_min: 2, manual_max: 5 });
        expect(planDeGuardadoMinMax({ ...base, sucursalId: 6, row: { pub_min: 10, pub_max: 20 }, min: '5', max: '25' }).error).toMatch(/Bodega/);
    });
});
