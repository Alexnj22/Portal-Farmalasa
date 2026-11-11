import { describe, it, expect } from 'vitest';
import { repartirSala } from '@nucleo/utils/mandoDeSala';

// Forma real del catálogo (ids de producción, 2026-11-10).
const roles = [
    { id: 2, parent_role_id: null },  // Gerente General
    { id: 3, parent_role_id: 2 },     // Administrador (tiene cargos debajo)
    { id: 38, parent_role_id: 2 },    // Diseñador/a Gráfico/a (sin cargos debajo)
    { id: 11, parent_role_id: 3 },    // Jefe/a de Talento Humano
    { id: 13, parent_role_id: 3 },    // Supervisor/a de Ventas
    { id: 19, parent_role_id: 13 },   // Jefe/a de Sala
    { id: 20, parent_role_id: 19 },   // Subjefe/a de Sala
    { id: 30, parent_role_id: 20 },   // Dependiente de Farmacia
];
const p = (id, name, role_id) => ({ id, name, role_id, branchId: 1 });
const repartir = (personas) => repartirSala({ personas, todos: personas, roles, sucursalId: 1 });

describe('repartirSala — quién es segundo al mando', () => {
    it('responder directo al jefe sin mandar a nadie no es ser segundo', () => {
        const r = repartir([p(1, 'Jose', 2), p(2, 'Carlos', 3), p(3, 'Julio', 38), p(4, 'Celina', 11)]);
        expect(r.jefe.name).toBe('Jose');
        expect(r.segundos.map(x => x.name)).toEqual(['Carlos']);
        expect(r.equipo.map(x => x.name)).toContain('Julio');
    });

    it('el subjefe sigue siendo segundo, y su hueco sigue apareciendo', () => {
        const conSub = repartir([p(5, 'Jefa', 19), p(6, 'Sub', 20), p(7, 'Dep', 30)]);
        expect(conSub.segundos.map(x => x.name)).toEqual(['Sub']);

        const sinSub = repartir([p(5, 'Jefa', 19), p(7, 'Dep', 30)]);
        expect(sinSub.vacantesDeSegundo.map(c => c.id)).toEqual([20]);
    });
});
