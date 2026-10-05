import { describe, expect, it } from 'vitest';
import { mapaDePermisos, permisoEnPalabras } from '@nucleo/utils/permisosDeCargo';
import { cargosNivelANivel } from '@nucleo/utils/jerarquiaDeCargos';

describe('permisosDeCargo', () => {
    it('lo que no tiene fila va apagado con alcance Todos', () => {
        const m = mapaDePermisos([{ role_id: 1, module_key: 'a', can_view: true, can_edit: true, can_approve: false, scope: null }], [{ id: 1 }, { id: 2 }], ['a', 'b']);
        expect(m['1:a']).toMatchObject({ can_view: true, scope: 'ALL', delega_en_ausencia: false });
        expect(m['2:b']).toEqual({ can_view: false, can_edit: false, can_approve: false, scope: 'ALL', delega_en_ausencia: false });
        expect(Object.keys(m)).toHaveLength(4);
    });
    it('el permiso en palabras', () => {
        expect(permisoEnPalabras({ can_view: false })).toBeNull();
        expect(permisoEnPalabras({ can_view: true, can_edit: true, scope: 'BRANCH' }, { conAlcance: true })).toBe('Ver · Gestionar · Mi sucursal');
        expect(permisoEnPalabras({ can_view: true, can_approve: true })).toBe('Ver · Aprobar');
    });
    it('los cargos nivel a nivel', () => {
        const r = [{ id: 3, parent_role_id: 2 }, { id: 2, parent_role_id: 1 }, { id: 1, parent_role_id: null }, { id: 4, parent_role_id: 1 }];
        expect(cargosNivelANivel(r).map((x) => x.id)).toEqual([1, 2, 4, 3]);
    });
});
