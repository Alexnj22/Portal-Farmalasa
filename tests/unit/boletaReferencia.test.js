import { describe, it, expect } from 'vitest';
import { boletaSinReferencia, pareceReferenciaDelPos } from '../../supabase/functions/_shared/boletaReferencia.ts';

// Lecturas reales de producción (caja_movimientos_portal, 20/21-oct-2026).
describe('boletaSinReferencia', () => {
    it('cambia la referencia por la boleta que le sigue en el papel', () => {
        const nums = ['181125', '60348001', '202610210743', '085033', '005060348', '60348001', '102107425217', '000088', '79612959'];
        expect(boletaSinReferencia('102107425217', nums)).toBe('000088');
        expect(boletaSinReferencia('102018031461', ['60344001', '005060344', '60344001', '102018031461', '000963', '77890334'])).toBe('000963');
    });

    it('deja intacta una boleta bien leída', () => {
        expect(boletaSinReferencia('001005', ['05060346', '102107215629', '001005'])).toBe('001005');
        expect(boletaSinReferencia('01729', [])).toBe('01729');
    });

    it('sin boleta a continuación devuelve null, no la referencia', () => {
        expect(boletaSinReferencia('102107425217', ['102107425217'])).toBeNull();
        expect(boletaSinReferencia('102107425217', ['102107425217', '200000263799'])).toBeNull();
        expect(boletaSinReferencia('102107425217', null)).toBeNull();
    });

    it('null sigue siendo null', () => {
        expect(boletaSinReferencia(null, ['000968'])).toBeNull();
    });

    it('la forma de la referencia es MMDD HHMMSS + 2', () => {
        expect(pareceReferenciaDelPos('082915195407')).toBe(true);
        expect(pareceReferenciaDelPos('200000263799')).toBe(false); // NIC, mes 20
        expect(pareceReferenciaDelPos('202610210743')).toBe(false); // fecha AAAAMMDD…
        expect(pareceReferenciaDelPos('000088')).toBe(false);
    });
});
