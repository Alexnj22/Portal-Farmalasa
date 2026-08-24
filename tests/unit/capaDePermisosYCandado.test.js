// La capa de datos de Permisos y del candado de mantenimiento.
//
// Acá no hay matemática: hay consultas, y lo que se rompe en una consulta no da
// error — da filas de menos o de más. Dos reglas concretas que sólo viven en la
// forma del query y que nada más vigila:
//
//   · un candado VENCIDO no es un candado, y eso lo decide un `.gt('expires_at')`
//     en la consulta. Sin ese filtro, un candado de hace un mes seguiría
//     apagando botones y nadie sabría por qué;
//   · `role_permissions` tiene una fila por cargo y módulo, o sea que crece
//     rápido y **tiene que paginar**: PostgREST corta en 1000 sin avisar, y un
//     permiso que no llegó se ve exactamente igual que un permiso apagado.
//
// Y el motivo por el que la mitad de UX del candado existe: un UPDATE cuya
// policy `USING` no pasa afecta **0 filas SIN lanzar error**, así que
// supabase-js devuelve `error: null` y un guardado optimista mostraría un valor
// que nunca se persistió.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crearEspia } from './_espiaSupabase';

const espia = crearEspia();
vi.mock('../../src/supabaseClient', () => ({ supabase: espia.supabase }));

const { fetchModuleLocks, lockModule, unlockModule, fetchLockableModules } =
    await import('../../src/data/moduleLocks');
const { fetchRolePermissions, upsertRolePermission, updateRoleIdleLimit, fetchRolePermissionsForRoles } =
    await import('../../src/data/permissions');

beforeEach(() => espia.limpiar());

describe('el candado de mantenimiento', () => {
    it('un candado vencido NO se trae', async () => {
        await fetchModuleLocks();
        const [columna, instante] = espia.primero('gt');
        expect(espia.tabla()).toBe('module_locks');
        expect(columna).toBe('expires_at');
        // Se compara contra AHORA, no contra una fecha fija.
        expect(Date.parse(instante)).toBeGreaterThan(Date.now() - 5000);
        expect(Date.parse(instante)).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('trae quién lo puso y por qué: un candado sin dueño no se puede levantar', async () => {
        await fetchModuleLocks();
        const columnas = espia.primero('select')[0];
        for (const c of ['module_key', 'locked_by_id', 'locked_by_name', 'reason', 'expires_at'])
            expect(columnas).toContain(c);
    });

    it('poner y levantar el candado van por RPC, no por UPDATE', () => {
        // El candado real vive en la base —`auth_can_edit_any()` consulta
        // `auth_module_locked()`— y cubre 59 policies y 23 RPCs, incluido quien
        // llame a PostgREST directo. Escribir la tabla desde acá lo saltearía.
        lockModule('minmax', 'inventario general', 6);
        expect(espia.rpc[0]).toEqual({ nombre: 'lock_module',
            args: { p_module_key: 'minmax', p_reason: 'inventario general', p_hours: 6 } });

        espia.limpiar();
        unlockModule('minmax');
        expect(espia.rpc[0]).toEqual({ nombre: 'unlock_module', args: { p_module_key: 'minmax' } });
    });

    it('sin motivo escrito manda null, no una cadena vacía', () => {
        // Una cadena vacía se guarda y después se pinta como un motivo en
        // blanco; un `null` la pantalla lo sabe leer.
        lockModule('minmax', '');
        expect(espia.rpc[0].args.p_reason).toBeNull();
    });

    it('el candado dura cuatro horas si nadie dice otra cosa', () => {
        lockModule('minmax', 'x');
        expect(espia.rpc[0].args.p_hours).toBe(4);
    });

    it('qué módulos se pueden candar lo DERIVA la base, no una lista de acá', () => {
        // Los deriva de las policies y de los cuerpos de las funciones: hoy son
        // 27 de 93, y candar uno de los otros 66 no frenaría nada. Un
        // diccionario acá se desactualizaría con la primera policy nueva, en
        // silencio.
        fetchLockableModules();
        expect(espia.rpc[0].nombre).toBe('get_lockable_modules');
        expect(espia.uso('from')).toBe(false);
    });
});

describe('los permisos por cargo', () => {
    it('la tabla de permisos PAGINA', async () => {
        // Una fila por cargo y módulo: 25 cargos × 93 módulos ya cruza las 1000,
        // y lo que falte se ve igual que un permiso apagado.
        await fetchRolePermissions();
        expect(espia.tabla()).toBe('role_permissions');
        expect(espia.uso('range')).toBe(true);
    });

    it('guardar un permiso es un upsert por (cargo, módulo)', () => {
        // Sin `onConflict` cada cambio insertaría una fila nueva y el cargo
        // terminaría con dos verdades sobre el mismo módulo.
        upsertRolePermission({ role_id: 3, module_key: 'ventas', can_view: true });
        const [, opciones] = espia.primero('upsert');
        expect(opciones.onConflict).toBe('role_id,module_key');
        expect(opciones.ignoreDuplicates).toBe(false);
    });

    it('pedir los permisos de varios cargos filtra por los ids dados', () => {
        fetchRolePermissionsForRoles([3, 7, 11]);
        expect(espia.primero('in')).toEqual(['role_id', [3, 7, 11]]);
    });

    it('el plazo de inactividad se guarda en el CARGO, no en la persona', () => {
        // Es una política del puesto: los de sala están en 5 minutos.
        updateRoleIdleLimit(3, 5);
        expect(espia.tabla()).toBe('roles');
        expect(espia.primero('update')[0]).toEqual({ idle_limit_min: 5 });
        expect(espia.primero('eq')).toEqual(['id', 3]);
    });
});
