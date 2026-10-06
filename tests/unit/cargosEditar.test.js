import { describe, expect, it } from 'vitest';
import { bloqueoParaEliminarCargo, disposicionDelOrganigrama, errorDeCargo } from '@nucleo/utils/jerarquiaDeCargos';

const roles = [
    { id: 1, name: 'Gerente', parent_role_id: null },
    { id: 2, name: 'Supervisor', parent_role_id: 1 },
    { id: 3, name: 'Auxiliar', parent_role_id: 2, secondary_parent_role_id: 1 },
    { id: 4, name: 'Bodega', parent_role_id: 1 },
];

describe('errorDeCargo', () => {
    it('pide nombre, superior (si ya hay raíz), superiores distintos y límite ≥ 1', () => {
        expect(errorDeCargo({ nombre: ' ', parentId: '1', maxLimit: 5 }, roles)).toMatch(/nombre/);
        expect(errorDeCargo({ nombre: 'X', parentId: '', maxLimit: 5 }, roles)).toMatch(/Raíz/);
        expect(errorDeCargo({ nombre: 'X', parentId: '', maxLimit: 5, editandoId: 1 }, roles)).toBeNull();
        expect(errorDeCargo({ nombre: 'X', parentId: '2', secundarioId: '2', maxLimit: 5 }, roles)).toMatch(/matricial/);
        expect(errorDeCargo({ nombre: 'X', parentId: '2', maxLimit: 0 }, roles)).toMatch(/plazas/);
        expect(errorDeCargo({ nombre: 'X', parentId: '2', maxLimit: '3' }, roles)).toBeNull();
    });
});

describe('bloqueoParaEliminarCargo', () => {
    it('frena con gente asignada o con cargos que dependen de él', () => {
        expect(bloqueoParaEliminarCargo(roles[3], roles, [{ secondary_role_id: 4 }])?.titulo).toBe('Operación prohibida');
        expect(bloqueoParaEliminarCargo(roles[1], roles, [])?.titulo).toBe('Operación bloqueada');
        expect(bloqueoParaEliminarCargo(roles[3], roles, [])).toBeNull();
    });
});

describe('disposicionDelOrganigrama', () => {
    it('centra al padre sobre sus hijos y dibuja la línea matricial', () => {
        const d = disposicionDelOrganigrama(roles);
        const x = Object.fromEntries(d.nodos.map((n) => [n.id, n]));
        expect(d.nodos).toHaveLength(4);
        expect(x[3]).toMatchObject({ y: 2 });
        expect(x[1].x).toBe((x[4].x + x[2].x) / 2);
        expect(d.lineas).toContainEqual({ desde: 1, hasta: 3, tipo: 'matricial' });
    });
    it('un ciclo no pierde cargos', () => {
        const d = disposicionDelOrganigrama([{ id: 1, name: 'A', parent_role_id: 2 }, { id: 2, name: 'B', parent_role_id: 1 }]);
        expect(d.nodos.map((n) => n.id).sort()).toEqual([1, 2]);
    });
});
