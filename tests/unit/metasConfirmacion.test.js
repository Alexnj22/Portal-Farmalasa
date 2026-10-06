import { describe, expect, it } from 'vitest';
import { baseDeMeta, montoAjustadoDeMeta, situacionDeMetaManual } from '@nucleo/utils/metasUtils';

describe('metas: agregar y confirmar (núcleo)', () => {
    it('la situación al guardar a mano', () => {
        expect(situacionDeMetaManual(undefined, '2026-10', '2026-10').puede).toBe(true);
        expect(situacionDeMetaManual('confirmada_supervisor', '2026-10', '2026-10').puede).toBe(false);
        expect(situacionDeMetaManual('oficial', '2026-11', '2026-10').puede).toBe(false);
        const cerrado = situacionDeMetaManual('oficial', '2026-08', '2026-10');
        expect(cerrado).toMatchObject({ puede: true, pideNota: true });
        expect(situacionDeMetaManual('propuesta', '2026-11', '2026-10').puede).toBe(true);
    });
    it('el ajuste corre en pasos de 1% sobre la base', () => {
        const r = { monto_base: 10000 };
        expect(baseDeMeta({ monto_propuesto: 5 })).toBe(5);
        expect(montoAjustadoDeMeta(r, 0)).toBe(10000);
        expect(montoAjustadoDeMeta(r, 3)).toBe(10300);
        expect(montoAjustadoDeMeta(r, -10)).toBe(9000);
        expect(montoAjustadoDeMeta({}, 2)).toBe(0);
    });
});
