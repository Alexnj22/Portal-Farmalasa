import { describe, expect, it } from 'vitest';
import { esCargoExterno, nombreDelSuperior, ocupantesDelCargo, ordenarPorJerarquia, profundidadDeCargo } from '@nucleo/utils/jerarquiaDeCargos';

const roles = [
    { id: 3, name: 'Regente', parent_role_id: 2 },
    { id: 1, name: 'Gerente General', parent_role_id: null },
    { id: 2, name: 'Administrador', parent_role_id: 1 },
    { id: 4, name: 'Auditor', parent_role_id: 1 },
];

describe('jerarquiaDeCargos', () => {
    it('la profundidad, y no se cuelga con un ciclo', () => {
        expect(profundidadDeCargo(roles, 3)).toBe(2);
        expect(profundidadDeCargo(roles, 1)).toBe(0);
        expect(profundidadDeCargo([{ id: 1, parent_role_id: 2 }, { id: 2, parent_role_id: 1 }], 1)).toBeLessThan(5);
    });
    it('de la cima hacia abajo y por nombre', () => {
        expect(ordenarPorJerarquia(roles).map((r) => r.id)).toEqual([1, 2, 4, 3]);
    });
    it('superior, ocupantes y externo', () => {
        expect(nombreDelSuperior(roles, null)).toBe('Nivel Máximo');
        expect(nombreDelSuperior(roles, 2)).toBe('Administrador');
        expect(ocupantesDelCargo([{ role_id: 2 }, { role_id: 5, secondary_role_id: 2 }, { role_id: 3 }], 2)).toHaveLength(2);
        expect(esCargoExterno('Regente de Farmacia')).toBe(true);
        expect(esCargoExterno('Regente de Enfermeria')).toBe(false);
        expect(esCargoExterno('Cajero')).toBe(false);
    });
});
