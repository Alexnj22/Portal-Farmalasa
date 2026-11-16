import { describe, it, expect } from 'vitest';
import { revisarCorreccion } from '../../supabase/functions/_shared/erp-corregir-lote.ts';
import { lotesDelDescargo } from '../../supabase/functions/_shared/erp-descarte.ts';

// El caso que dio origen (2026-11-16): ZALDIAR en Salud 2, el mismo lote con
// dos fechas — 20 unidades con 2026-10 (mal) y 35 con 2028-09 (bien).
const malo  = { id: '1', numero: 'LJ2506901', vence: '2026-10-01', stock: 20 };
const bueno = { id: '2', numero: 'LJ2506901', vence: '2028-09-01', stock: 35 };

describe('revisarCorreccion', () => {
    it('acepta corregir sólo la fecha de un lote completo', () => {
        expect(revisarCorreccion({ origen: malo, unidades: 20, loteNuevo: 'LJ2506901', venceNuevo: '2028-09-01' }).ok).toBe(true);
    });
    it('si el número se queda, exige el lote completo', () => {
        const r = revisarCorreccion({ origen: malo, unidades: 5, loteNuevo: 'lj2506901 ', venceNuevo: '2028-09-01' });
        expect(r).toMatchObject({ ok: false, codigo: 'LOTE_PARTIDO' });
    });
    it('con otro número se puede corregir una parte', () => {
        expect(revisarCorreccion({ origen: malo, unidades: 5, loteNuevo: 'X1', venceNuevo: '2028-09-01' }).ok).toBe(true);
    });
    it('frena lo que no cambia nada y lo que no alcanza', () => {
        expect(revisarCorreccion({ origen: malo, unidades: 20, loteNuevo: 'LJ2506901', venceNuevo: '2026-10-01' }))
            .toMatchObject({ codigo: 'SIN_CAMBIO' });
        expect(revisarCorreccion({ origen: malo, unidades: 21, loteNuevo: 'X1', venceNuevo: '2028-09-01' }))
            .toMatchObject({ codigo: 'NO_ALCANZA' });
        expect(revisarCorreccion({ origen: malo, unidades: 0, loteNuevo: 'X1', venceNuevo: '2028-09-01' }))
            .toMatchObject({ codigo: 'SIN_UNIDADES' });
    });
});

describe('lotesDelDescargo con fecha', () => {
    it('sale del renglón de ESA fecha aunque el otro venza antes o alcance', () => {
        const r = lotesDelDescargo([malo, bueno], 20, 1, 'LJ2506901', '2026-10-01');
        expect(r).toEqual({ renglones: [{ idLote: '1', numero: 'LJ2506901', vence: '2026-10-01', cantidad: 20 }], faltan: 0 });
        const r2 = lotesDelDescargo([malo, bueno], 20, 1, 'LJ2506901', '2028-09-01');
        expect(r2.renglones[0].idLote).toBe('2');
    });
    it('sin fecha se comporta como antes', () => {
        expect(lotesDelDescargo([malo, bueno], 30, 1, 'LJ2506901').renglones[0].idLote).toBe('2');
    });
});
