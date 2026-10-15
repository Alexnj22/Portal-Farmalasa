import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════
// Fase 4 de `docs/PLAN-PERSONAL-AUDITORIA-2026-10-14.md` — el listado de
// personal (`/personal`, EquiposView) y las piezas del núcleo que lo alimentan.
//
// Cada `describe` ancla un hallazgo (L1…L8) con el caso que lo delataba: en
// todos, la pantalla no fallaba — decía algo bien formado y falso.
// ═══════════════════════════════════════════════════════════════════════════

const rpc = vi.fn();
vi.mock('@nucleo/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const practicantesData = { fetchPracticantes: vi.fn() };
vi.mock('@nucleo/data/practicantes', () => ({
    upsertInstitucionCatalogEntry: vi.fn(() => Promise.resolve({})),
    fetchPracticantes: (...a) => practicantesData.fetchPracticantes(...a),
    insertPracticante: vi.fn(), updatePracticante: vi.fn(), deletePracticante: vi.fn(),
}));

let estado = {};
vi.mock('@nucleo/store/staffStore', () => ({
    useStaffStore: (selector) => selector(estado),
}));
vi.mock('@nucleo/context/AuthContext', () => ({
    useAuth: () => ({ user: { branchId: 44 }, getScope: () => 'ALL', hasPermission: () => true }),
}));
vi.mock('../../src/components/practicantes/PracticanteModal', () => ({ default: () => null }));
vi.mock('../../src/components/GlassViewLayout', () => ({
    default: ({ children }) => <div>{children}</div>,
}));
vi.mock('../../src/components/common/ViewTabBar', () => ({ default: () => null }));

import EquiposView from '../../src/views/personal/EquiposView';
import { _limpiarCache, leerEstado, pedirEstado } from '@nucleo/data/estadosDePersonas';
import { estadoDePersona } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona } from '@nucleo/utils/alertasDePersona';
import { calcAge } from '@nucleo/utils/ageUtils';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { createPracticantesSlice } from '@nucleo/store/slices/practicantesSlice';

const ROLES = [
    { id: 13, name: 'Supervisor/a de Ventas', parent_role_id: null },
    { id: 19, name: 'Jefe/a de Sala',         parent_role_id: 13 },
    { id: 30, name: 'Dependiente de Farmacia', parent_role_id: 19 },
];

const persona = (id, name, role_id, role, branch_id, extra = {}) => ({
    id, name, role_id, role, branch_id, branchId: branch_id,
    status: 'ACTIVO', history: [], employee_documents: [],
    dui: '00000000-0', birth_date: '1990-03-04', isss_number: '123456',
    ...extra,
});

const base = (parches = {}) => ({
    employees: [],
    branches: [{ id: 44, name: 'Salud 4' }, { id: 43, name: 'Salud 3' }],
    roles: ROLES,
    employeesStatus: 'ready',
    historialCompleto: true,
    practicantes: [],
    practicantesLoading: false,
    practicantesError: null,
    fetchPracticantes: () => {},
    deletePracticante: () => {},
    ...parches,
});

const montar = (props = {}) => render(
    <MemoryRouter initialEntries={[props.ruta || '/personal']}>
        <EquiposView searchTerm="" setSearchTerm={() => {}} {...props} />
    </MemoryRouter>,
).container;

// `:not([data-franja])`: la franja del seguro también es una tarjeta, pero no es una persona.
const nombres = (c) => [...c.querySelectorAll('[data-surface="card"]:not([data-franja])')]
    .map(t => t.querySelector('p')?.textContent?.trim()).filter(Boolean);

beforeEach(() => { cleanup(); _limpiarCache(); rpc.mockReset(); estado = base(); });
afterEach(() => cleanup());

describe('L1 — sin historial completo, la lista usa la MISMA fuente que el aro', () => {
    it('la pestaña «Ausentes» encuentra a quien sólo la base sabe ausente', async () => {
        // El arranque sin `staff_detail` trae historial vacío de los demás: lo
        // local dice «está». La base dice VACATION.
        rpc.mockResolvedValue({ data: [{ id: 'e-2', clave: 'VACATION', hasta: null, faltan: 0 }], error: null });
        estado = base({
            historialCompleto: false,
            employees: [
                persona('e-1', 'Jefa Presente', 19, 'Jefe/a de Sala', 44),
                persona('e-2', 'Dependiente De Vacaciones', 30, 'Dependiente de Farmacia', 44),
            ],
        });
        const c = montar({ ruta: '/personal?tab=ausentes' });
        await waitFor(() => expect(nombres(c)).toEqual(['Dependiente De Vacaciones']));
        // Una sola tanda para toda la lista, no una por cara.
        expect(rpc).toHaveBeenCalledTimes(1);
        // Y la píldora de la tarjeta dice lo mismo que el aro.
        expect(c.textContent).toContain('En vacaciones');
    });

    it('con el historial completo no sale ninguna petición', () => {
        estado = base({ employees: [persona('e-1', 'Jefa Presente', 19, 'Jefe/a de Sala', 44)] });
        montar();
        expect(rpc).not.toHaveBeenCalled();
    });
});

describe('L2 — el caché guarda `faltan`', () => {
    it('la cuenta regresiva de la base llega al lector', async () => {
        rpc.mockResolvedValue({ data: [{ id: 'e-9', clave: 'VACATION', hasta: null, faltan: 3 }], error: null });
        pedirEstado('e-9');
        await waitFor(() => expect(leerEstado('e-9')).toEqual({ clave: 'VACATION', hasta: null, faltan: 3 }));
    });
});

describe('L3 — una suspensión revocada no pinta estado', () => {
    it('igual que el gemelo SQL, `reclamo.estado = REVOCADA` se descarta', () => {
        const hoy = hoySV();
        const ev = { type: 'SUSPENSION', date: hoy, metadata: { endDate: sumarDias(hoy, 2) } };
        expect(estadoDePersona({ history: [ev] })?.clave).toBe('SUSPENSION');
        const revocada = { ...ev, metadata: { ...ev.metadata, reclamo: { estado: 'REVOCADA' } } };
        expect(estadoDePersona({ history: [revocada] })).toBeNull();
    });
});

describe('L4 — el DUI en un solo archivo cuenta', () => {
    const pendiente = (docs) => alertasDePersona({ birth_date: '1990-03-04', employee_documents: docs })
        .find(a => a.key === 'pendiente');
    it('DUI_COMPLETO basta, como en `faltantesDelExpediente`', () => {
        expect(pendiente([{ category: 'DUI_COMPLETO', url: 'x' }])).toBeUndefined();
    });
    it('las dos caras sueltas siguen valiendo, y una sola no', () => {
        expect(pendiente([{ category: 'DUI_FRENTE', url: 'x' }, { category: 'DUI_REVERSO', url: 'y' }])).toBeUndefined();
        expect(pendiente([{ category: 'DUI_FRENTE', url: 'x' }])?.title).toContain('documento de identidad');
    });
});

describe('L5 — un fallo al traer practicantes no es «Sin practicantes»', () => {
    it('el slice guarda el error', async () => {
        let s = {};
        const set = (p) => { s = { ...s, ...(typeof p === 'function' ? p(s) : p) }; };
        s = createPracticantesSlice(set, () => s);
        practicantesData.fetchPracticantes.mockResolvedValue({ data: null, error: new Error('red caída') });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await s.fetchPracticantes();
        spy.mockRestore();
        expect(s.practicantesError?.message).toBe('red caída');
        expect(s.practicantesLoading).toBe(false);
    });

    it('la vista lo dice como error y no pinta el vacío', () => {
        estado = base({ practicantesError: new Error('red caída') });
        const c = montar({ ruta: '/personal?tab=practicantes' });
        expect(c.textContent).toContain('No se pudo cargar la lista de practicantes');
        expect(c.textContent).not.toContain('Sin practicantes');
    });
});

describe('L6 — el filtro de sucursal ve las salas que la persona cubre', () => {
    it('quien cubre Salud 3 aparece al filtrar por Salud 3', () => {
        estado = base({ employees: [
            persona('e-1', 'Jefe De Salud 3', 19, 'Jefe/a de Sala', 43),
            persona('e-2', 'Recorre Salas', 30, 'Dependiente de Farmacia', 44, { assigned_branch_ids: [44, 43] }),
            persona('e-3', 'Sólo Salud 4', 30, 'Dependiente de Farmacia', 44),
        ] });
        const c = montar({ selectedBranch: '43' });
        expect(nombres(c).sort()).toEqual(['Jefe De Salud 3', 'Recorre Salas']);
    });
});

describe('L7 — quien está de baja no es jefatura ni cuenta en la sala', () => {
    it('la jefa liquidada sale aparte y el pulso no la cuenta', () => {
        estado = base({ employees: [
            persona('e-1', 'Jefa Liquidada', 19, 'Jefe/a de Sala', 44, { status: 'LIQUIDADO' }),
            persona('e-2', 'Dependiente Uno', 30, 'Dependiente de Farmacia', 44),
        ] });
        const c = montar();
        const lugar = (l) => [...c.querySelectorAll(`[data-lugar="${l}"]`)].map(t => t.querySelector('p').textContent);
        expect(lugar('jefatura')).not.toContain('Jefa Liquidada');
        expect(lugar('baja')).toEqual(['Jefa Liquidada']);
        expect(c.textContent).toContain('1 persona');
        expect(c.textContent).toContain('1 de baja');
    });
});

describe('L8 — «hoy» es el de la sala', () => {
    it('calcAge cuenta contra el día que se le da, no el reloj del equipo', () => {
        expect(calcAge('2008-10-15', '2026-10-14')).toBe(17);
        expect(calcAge('2008-10-14', '2026-10-14')).toBe(18);
    });
    it('el cumpleaños se anuncia sobre el día de El Salvador', () => {
        const a = alertasDePersona({ birth_date: '1990-10-15' }, '2026-10-14').find(x => x.key === 'cumple');
        expect(a?.texto).toBe('Cumple mañana');
        const hoy = alertasDePersona({ birth_date: '1990-10-14' }, '2026-10-14').find(x => x.key === 'cumple');
        expect(hoy?.texto).toBe('¡Hoy cumple 36!');
    });
});

describe('Practicante con un estado que la tabla no conoce', () => {
    it('se muestra tal cual y no como «Activo»', () => {
        estado = base({ practicantes: [{ id: 'p1', first_names: 'Ana', last_names: 'Pérez', estado: 'SUSPENDIDO', branch_id: 44 }] });
        const c = montar({ ruta: '/personal?tab=practicantes' });
        expect(c.textContent).toContain('SUSPENDIDO');
        expect(c.textContent).not.toContain('Activo');
    });
});
