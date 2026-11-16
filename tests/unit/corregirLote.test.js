import { describe, it, expect } from 'vitest';
import { revisarCorreccion, choqueEnLaSala, par } from '../../supabase/functions/_shared/erp-corregir-lote.ts';
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

describe('tres fechas o más para el mismo número', () => {
    // A y B mal, C la buena y todavía sin existencia: antes se trababan entre sí.
    const A = { id: 'a', numero: 'L1', vence: '2026-01-01', stock: 5 };
    const B = { id: 'b', numero: 'L1', vence: '2026-06-01', stock: 7 };
    const otro = { id: 'x', numero: 'X9', vence: '2027-01-01', stock: 3 };
    it('con el mismo número no bloquea: avisa la fecha que queda', () => {
        const r = choqueEnLaSala([A, B, otro], A, 'L1', '2028-01-01');
        expect(r.bloquea).toBeNull();
        expect(r.avisos[0]).toContain('2026-06-01');
        // Después de A→C, B→C ya no avisa nada (A quedó en 0).
        const r2 = choqueEnLaSala([{ ...A, stock: 0 }, B, { id: 'c', numero: 'L1', vence: '2028-01-01', stock: 5 }], B, 'L1', '2028-01-01');
        expect(r2).toEqual({ bloquea: null, avisos: [] });
    });
    it('con OTRO número que ya existe con otra fecha, bloquea (tecleo)', () => {
        expect(choqueEnLaSala([A, B, otro], otro, 'L1', '2028-01-01').bloquea).toBe('2026-01-01');
    });
    it('con otro número hacia un par que ya existe, no bloquea', () => {
        expect(choqueEnLaSala([A, B, otro], otro, 'L1', '2026-06-01').bloquea).toBeNull();
    });
});

describe('par: un lote en varios renglones', () => {
    it('suma los renglones del mismo número y fecha', () => {
        const r = par([{ id: '1', numero: 'L1', vence: '2027-01-01', stock: 4 }, { id: '2', numero: 'l1 ', vence: '2027-01-01', stock: 6 },
                       { id: '3', numero: 'L1', vence: '2028-01-01', stock: 9 }], 'L1', '2027-01-01');
        expect(r).toEqual({ numero: 'L1', vence: '2027-01-01', stock: 10 });
    });
    it('el descargo completa de los dos renglones del par', () => {
        const lotes = [{ id: '1', numero: 'L1', vence: '2027-01-01', stock: 4 }, { id: '2', numero: 'L1', vence: '2027-01-01', stock: 6 },
                       { id: '3', numero: 'L1', vence: '2028-01-01', stock: 9 }];
        const r = lotesDelDescargo(lotes, 10, 1, 'L1', '2027-01-01');
        expect(r.faltan).toBe(0);
        expect(r.renglones.map(x => x.idLote).sort()).toEqual(['1', '2']);
    });
});
