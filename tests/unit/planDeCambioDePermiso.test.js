import { describe, expect, it } from 'vitest';
import { HIJOS_DE_APROBAR, filasCopiadasDe, filasParaActivarTodo, planDeCambioDePermiso } from '@nucleo/utils/permisosDeCargo';
import { MODULE_GROUPS } from '@nucleo/constants/permissionModules';

const G = [
    { group: 'A', modules: [
        { key: 'overview' }, { key: 'dash_ventas' }, { key: 'dash_caja' },
        { key: 'inventario', sub: [{ key: 'inv_tab_a' }, { key: 'inv_ver_costos' }] },
        { key: 'requests' },
    ] },
];

describe('una capacidad tiene un solo interruptor y da «Gestionar»', () => {
    const C = [{ group: 'A', modules: [{ key: 'bolsas', sub: [
        { key: 'bolsas_conteo', tipo: 'cap' }, { key: 'bolsas_tab', tipo: 'tab' },
    ] }] }];
    const cambio = (permisos, moduleKey, value) => planDeCambioDePermiso({ permisos, roleId: 1, moduleKey, permType: 'can_view', value, moduleGroups: C });

    it('encender una capacidad guarda ver y gestionar; apagarla, ninguno', () => {
        expect(cambio({}, 'bolsas_conteo', true).principal).toMatchObject({ can_view: true, can_edit: true });
        expect(cambio({ '1:bolsas_conteo': { can_view: true, can_edit: true } }, 'bolsas_conteo', false).principal)
            .toMatchObject({ can_view: false, can_edit: false });
    });
    it('una pestaña sigue sin gestionar', () => {
        expect(cambio({}, 'bolsas_tab', true).principal).toMatchObject({ can_view: true, can_edit: false });
    });
    it('«Activar todo» da gestionar a las capacidades y no a las pestañas', () => {
        const filas = Object.fromEntries(filasParaActivarTodo({}, 1, C).map((f) => [f.module_key, f]));
        expect(filas.bolsas.can_edit).toBe(true);
        expect(filas.bolsas_conteo).toMatchObject({ can_view: true, can_edit: true });
        expect(filas.bolsas_tab).toMatchObject({ can_view: true, can_edit: false });
    });
    it('el registro real declara «Recibir y contar» como capacidad', () => {
        const fila = planDeCambioDePermiso({ permisos: {}, roleId: 1, moduleKey: 'bolsas_conteo', permType: 'can_view', value: true, moduleGroups: MODULE_GROUPS }).principal;
        expect(fila.can_edit).toBe(true);
    });
});

describe('planDeCambioDePermiso', () => {
    it('apagar «Ver» apaga gestionar, aprobar y los sub-permisos', () => {
        const permisos = { '1:inventario': { can_view: true, can_edit: true, can_approve: true }, '1:inv_tab_a': { can_view: true } };
        const p = planDeCambioDePermiso({ permisos, roleId: 1, moduleKey: 'inventario', permType: 'can_view', value: false, moduleGroups: G });
        expect(p.principal).toMatchObject({ can_view: false, can_edit: false, can_approve: false });
        expect(p.apagadas.map((r) => r.module_key)).toEqual(['inv_tab_a', 'inv_ver_costos']);
        expect(p.estado['1:inv_tab_a'].can_view).toBe(false);
    });
    it('encender un widget enciende Inicio; apagar el último lo apaga', () => {
        const on = planDeCambioDePermiso({ permisos: {}, roleId: 1, moduleKey: 'dash_ventas', permType: 'can_view', value: true, moduleGroups: G });
        expect(on.inicio).toMatchObject({ module_key: 'overview', can_view: true });
        const permisos = { '1:dash_ventas': { can_view: true }, '1:overview': { can_view: true } };
        const off = planDeCambioDePermiso({ permisos, roleId: 1, moduleKey: 'dash_ventas', permType: 'can_view', value: false, moduleGroups: G });
        expect(off.inicio).toMatchObject({ can_view: false });
        const conOtro = planDeCambioDePermiso({ permisos: { ...permisos, '1:dash_caja': { can_view: true } }, roleId: 1, moduleKey: 'dash_ventas', permType: 'can_view', value: false, moduleGroups: G });
        expect(conOtro.inicio).toBeNull();
    });
    it('el maestro de aprobar mueve a las familias y una familia al maestro', () => {
        const m = planDeCambioDePermiso({ permisos: {}, roleId: 1, moduleKey: 'requests', permType: 'can_approve', value: true, moduleGroups: G });
        expect(m.cascada.map((r) => r.module_key)).toEqual(HIJOS_DE_APROBAR);
        expect(m.cascada.every((r) => r.can_approve)).toBe(true);
        const f = planDeCambioDePermiso({ permisos: {}, roleId: 1, moduleKey: 'requests_caja', permType: 'can_approve', value: true, moduleGroups: G });
        expect(f.cascada).toEqual([expect.objectContaining({ module_key: 'requests', can_approve: true })]);
    });
});

describe('filasCopiadasDe', () => {
    it('copia módulos y sub-permisos; lo que no tiene el origen queda apagado', () => {
        const G = [{ group: 'A', modules: [{ key: 'a', sub: [{ key: 'a_tab' }] }, { key: 'b' }] }];
        const filas = filasCopiadasDe({ '7:a': { can_view: true, scope: 'BRANCH' } }, 7, 9, G);
        expect(filas.map((f) => f.module_key)).toEqual(['a', 'a_tab', 'b']);
        expect(filas[0]).toMatchObject({ role_id: 9, can_view: true, scope: 'BRANCH' });
        expect(filas[2]).toMatchObject({ can_view: false, scope: 'ALL' });
    });
});
