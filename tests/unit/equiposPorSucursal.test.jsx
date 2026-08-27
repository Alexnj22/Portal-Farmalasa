import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════
// «Equipos por sucursal» — el boceto que agrupa el personal por sala.
//
// Lo que ancla NO es cómo se ve, sino la única decisión que la vista toma sola:
// **quién es referente de una sala y quién es equipo**. Esa respuesta sale del
// árbol de `roles.parent_role_id` y no de leer el texto del cargo, que es la
// diferencia entre un dato y una coincidencia de palabras — el mismo defecto
// que costó los `role_id: null` de 2026-08-12 («un rótulo no es una clave»).
//
// El caso que se reproduce es real y es el que hace falta que no se pierda:
// en **Salud 4** conviven un Jefe/a de Sala, una Regente de Enfermería y un
// Técnico de Mantenimiento, y los tres responden FUERA de la sala —a Supervisor
// de Ventas, a Supervisor Médico y a Administrador—. O sea que la sala tiene
// TRES referentes y ninguno manda sobre los otros dos. Un criterio por «nivel
// más alto del árbol» coronaría al técnico (nivel 2) y dejaría al jefe de sala
// (nivel 3) en el montón: exactamente al revés de lo que la sala entiende.
//
// La segunda prueba mira el otro lado: los Dependientes SÍ tienen a su jefe
// dentro de la sala (por la cadena Dependiente → Subjefe → Jefe/a de Sala), así
// que caen en equipo. Sin esa cadena, cada dependiente sería su propio
// referente y la sección entera perdería sentido.
// ═══════════════════════════════════════════════════════════════════════════

// Las 6 filas de `roles` que participan, con los ids y padres REALES de
// producción (consultados el 2026-08-26). Copiarlos importa: si el árbol de la
// base cambia, esta prueba deja de describir la empresa y hay que volver a
// mirarla, que es justo lo que se quiere que pase.
const ROLES = [
    { id: 2,  name: 'Gerente General',                              parent_role_id: null },
    { id: 3,  name: 'Administrador',                                parent_role_id: 2 },
    { id: 13, name: 'Supervisor/a de Ventas',                       parent_role_id: 3 },
    { id: 22, name: 'Supervisor del Departamento Medico y Enfermería', parent_role_id: 3 },
    { id: 27, name: 'Tecnico de Mantenimiento y Servicios Generales', parent_role_id: 3 },
    { id: 19, name: 'Jefe/a de Sala',                               parent_role_id: 13 },
    { id: 23, name: 'Regente de Enfermeria',                        parent_role_id: 22 },
    { id: 20, name: 'Subjefe/a de Sala',                            parent_role_id: 19 },
    { id: 30, name: 'Dependiente de Farmacia',                      parent_role_id: 20 },
];

const persona = (id, name, role_id, role, branch_id) => ({
    id, name, role_id, role, branch_id, branchId: branch_id,
    status: 'ACTIVO', history: [], documents: [], employee_documents: [],
    // Con estos tres puestos, `alertasDe` no encuentra nada que decir: la
    // prueba habla del reparto, no de las insignias.
    dui: '00000000-0', birth_date: '1990-03-04', isss_number: '123456',
});

const EMPLEADOS = [
    persona(1, 'Jefa de Salud 4',       19, 'Jefe/a de Sala',                                 44),
    persona(2, 'Regente de Salud 4',    23, 'Regente de Enfermeria',                          44),
    persona(3, 'Tecnico de Servicios',  27, 'Tecnico de Mantenimiento y Servicios Generales', 44),
    persona(4, 'Dependiente Uno',       30, 'Dependiente de Farmacia',                        44),
    persona(5, 'Dependiente Dos',       30, 'Dependiente de Farmacia',                        44),
];

const BRANCHES = [{ id: 44, name: 'Salud 4' }];

const estado = {
    employees: EMPLEADOS,
    branches: BRANCHES,
    roles: ROLES,
    employeesStatus: 'ready',
};

vi.mock('../../src/store/staffStore', () => ({
    useStaffStore: (selector) => selector(estado),
}));

vi.mock('../../src/context/AuthContext', () => ({
    useAuth: () => ({ user: { branchId: 44 }, getScope: () => 'ALL', hasPermission: () => true }),
}));

// El layout trae `framer-motion`, observadores de tamaño y el canal de vista:
// nada de eso participa del reparto, y montarlo convertiría un fallo de
// agrupación en un fallo de entorno. Se reemplaza por su hueco.
vi.mock('../../src/components/GlassViewLayout', () => ({
    default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../src/components/common/ViewTabBar', () => ({
    default: () => null,
}));

import EquiposView from '../../src/views/personal/EquiposView';

const montar = () => render(
    <MemoryRouter>
        <EquiposView searchTerm="" setSearchTerm={() => {}} />
    </MemoryRouter>,
);

// Las tarjetas destacadas son las que llevan la línea «Responde a …»: es la
// marca que sólo pinta un referente, así que sirve de sonda sin depender de una
// clase de CSS —que cambiaría con cualquier retoque visual—.
const referentes = (container) =>
    [...container.querySelectorAll('[data-surface="card"]')]
        .filter(c => c.textContent.includes('Responde a'))
        .map(c => c.querySelector('p')?.textContent?.trim());

describe('Equipos por sucursal — el reparto entre referentes y equipo', () => {
    beforeEach(() => cleanup());

    it('los tres que responden fuera de la sala son referentes', () => {
        const { container } = montar();
        const nombres = referentes(container);
        expect(nombres).toContain('Jefa de Salud 4');
        expect(nombres).toContain('Regente de Salud 4');
        expect(nombres).toContain('Tecnico de Servicios');
        expect(nombres).toHaveLength(3);
    });

    it('los dependientes tienen jefe DENTRO de la sala y caen en el equipo', () => {
        const { container } = montar();
        const nombres = referentes(container);
        expect(nombres).not.toContain('Dependiente Uno');
        expect(nombres).not.toContain('Dependiente Dos');
        // Y siguen estando: caer en equipo no es desaparecer.
        expect(container.textContent).toContain('Dependiente Uno');
        expect(container.textContent).toContain('Dependiente Dos');
    });

    it('el encabezado de la sala cuenta las cinco personas', () => {
        const { container } = montar();
        expect(container.textContent).toContain('Salud 4');
        expect(container.textContent).toContain('5 personas');
    });

    // Con `employee_events` vacía —4 filas en toda la tabla el 2026-08-26,
    // ninguna de ausencia— la franja de estado no debe pintar nada. Una píldora
    // «Activo» repetida en cada tarjeta enseña a no mirarla, y el día que
    // aparezca la primera vacación va a pasar desapercibida entre las otras.
    it('sin eventos de ausencia no pinta ninguna franja de estado', () => {
        const { container } = montar();
        expect(container.textContent).not.toContain('En vacaciones');
        expect(container.textContent).not.toContain('Con permiso');
        expect(container.textContent).not.toContain('Activo');
    });

    it('una ausencia vigente se anuncia con la fecha de vuelta', () => {
        const conVacacion = {
            ...estado,
            employees: EMPLEADOS.map(e => e.id !== 4 ? e : {
                ...e,
                history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-02' } }],
            }),
        };
        const previo = estado.employees;
        estado.employees = conVacacion.employees;
        try {
            const { container } = montar();
            expect(container.textContent).toContain('En vacaciones');
            expect(container.textContent).toContain('vuelve el');
        } finally {
            estado.employees = previo;
        }
    });
});
