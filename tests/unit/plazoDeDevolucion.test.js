import { describe, it, expect } from 'vitest';
import { limiteDeEnvioABodega, avisoDeLote } from '@nucleo/utils/plazoDeDevolucion';

// El 98% de los lotes vence un día 1. Leída con `new Date('YYYY-MM-DD')`, esa
// fecha es medianoche UTC = las 18:00 del día anterior en la sala, y el límite
// salía un mes antes. Estas pruebas corren igual en UTC (CI) y en la sala.
describe('plazoDeDevolucion', () => {
    it('vence el 1-dic con política de 2 meses → límite el 25-sep', () => {
        expect(limiteDeEnvioABodega('2026-12-01', 2)).toBe('2026-09-25');
    });

    it('cruza el año hacia atrás', () => {
        expect(limiteDeEnvioABodega('2027-02-01', 3)).toBe('2026-10-25');
    });

    it('cuenta los días de calendario y decide el plazo por día de la sala', () => {
        const politica = { es_devolutivo: true, meses_devolucion: 2 };
        const a = avisoDeLote({ fecha_vencimiento: '2026-12-01' }, politica, '2026-09-25');
        expect(a).toMatchObject({ dias: 67, limite: '2026-09-25', fueraDePlazo: false, urgente: false });
        expect(avisoDeLote({ fecha_vencimiento: '2026-12-01' }, politica, '2026-09-26').fueraDePlazo).toBe(true);
    });

    it('no devolutivo: avisa a partir de 210 días', () => {
        const nd = { es_devolutivo: false };
        expect(avisoDeLote({ fecha_vencimiento: '2027-05-01' }, nd, '2026-10-03').reportarND).toBe(true);
        expect(avisoDeLote({ fecha_vencimiento: '2027-05-01' }, nd, '2026-10-01').reportarND).toBe(false);
    });
});
