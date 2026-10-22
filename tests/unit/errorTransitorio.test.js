// Qué error del servidor merece reintento y cuál es un «no» definitivo.
//
// El kiosco descartaba un marcaje ante cualquier error con `code`, y los
// fallos de una saturación (`PGRST003`, `57014`) también lo traen.

import { describe, it, expect } from 'vitest';
import { esFalloTransitorio } from '@nucleo/utils/errorTransitorio';

describe('esFalloTransitorio', () => {
    it('sin error no hay nada que reintentar', () => {
        expect(esFalloTransitorio(null)).toBe(false);
        expect(esFalloTransitorio(undefined)).toBe(false);
    });

    it('sin código es la red: la petición no llegó o no volvió', () => {
        expect(esFalloTransitorio({ message: 'TypeError: Failed to fetch' })).toBe(true);
        expect(esFalloTransitorio({ code: '', message: '' })).toBe(true);
    });

    it('el pool saturado y el timeout traen código y SIGUEN siendo transitorios', () => {
        expect(esFalloTransitorio({ code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' })).toBe(true);
        expect(esFalloTransitorio({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
        expect(esFalloTransitorio({ code: '08006', message: 'connection failure' })).toBe(true);
        expect(esFalloTransitorio({ code: '504', message: 'Gateway Timeout' })).toBe(true);
    });

    it('un rechazo de la función, de permisos o de datos es definitivo', () => {
        expect(esFalloTransitorio({ code: 'P0001', message: 'EMPLEADO_FUERA_DE_SUCURSAL' })).toBe(false);
        expect(esFalloTransitorio({ code: '42501', message: 'permission denied for function x' })).toBe(false);
        expect(esFalloTransitorio({ code: '23505', message: 'duplicate key value' })).toBe(false);
        expect(esFalloTransitorio({ code: 'PGRST202', message: 'Could not find the function' })).toBe(false);
    });
});
