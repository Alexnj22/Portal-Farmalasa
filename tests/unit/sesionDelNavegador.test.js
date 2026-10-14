// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    debeCambiarClave, esCarneDePapel, mismoPerfil, mismosPermisos, esFalloDeCredencial,
} from '@nucleo/utils/sesionDelNavegador.js';
import { saveDraft, loadDraft, borrarTodosLosBorradores } from '@nucleo/utils/draftUtils.js';

describe('debeCambiarClave — sólo app_metadata decide', () => {
    it('primer_acceso obliga', () => {
        expect(debeCambiarClave({ app_metadata: { cambio_de_clave: 'primer_acceso' } })).toBe(true);
    });

    it('user_metadata NO decide: es lo que el navegador puede reescribir', () => {
        expect(debeCambiarClave({ user_metadata: { must_change_password: true }, app_metadata: {} })).toBe(false);
        // …y al revés: marcarse «ya la cambié» no salta el cambio.
        expect(debeCambiarClave({
            user_metadata: { must_change_password: false },
            app_metadata: { cambio_de_clave: 'primer_acceso' },
        })).toBe(true);
    });

    it('temporal / definitiva / ausente no obligan', () => {
        expect(debeCambiarClave({ app_metadata: { cambio_de_clave: 'temporal' } })).toBe(false);
        expect(debeCambiarClave({ app_metadata: { cambio_de_clave: 'definitiva' } })).toBe(false);
        expect(debeCambiarClave({ app_metadata: {} })).toBe(false);
        expect(debeCambiarClave(null)).toBe(false);
    });
});

describe('esCarneDePapel', () => {
    it('sólo carne-…@staff.local', () => {
        expect(esCarneDePapel('carne-8b1c@staff.local')).toBe(true);
        expect(esCarneDePapel('CARNE-8B1C@STAFF.LOCAL')).toBe(true);
        expect(esCarneDePapel('ab12cd34@staff.local')).toBe(false);
        expect(esCarneDePapel('carne-x@farmalasa.app')).toBe(false);
        expect(esCarneDePapel(undefined)).toBe(false);
    });
});

describe('mismoPerfil', () => {
    const base = { id: 7, name: 'ANA', roleId: 3, photo: 'https://x/firmada?t=1', photoRaw: 'https://x/cruda' };

    it('datos idénticos → mismo perfil (aunque cambie la firma de la foto)', () => {
        expect(mismoPerfil(base, { ...base, photo: 'https://x/firmada?t=2' })).toBe(true);
    });

    it('lo que sólo agregó el navegador (isSU) no cuenta', () => {
        expect(mismoPerfil({ ...base, isSU: true }, { ...base })).toBe(true);
    });

    it('un dato distinto → otro perfil', () => {
        expect(mismoPerfil(base, { ...base, roleId: 4 })).toBe(false);
        expect(mismoPerfil(base, { ...base, photoRaw: 'https://x/otra', photo: 'https://x/otra' })).toBe(false);
        expect(mismoPerfil(null, base)).toBe(false);
    });
});

describe('mismosPermisos', () => {
    const a = { ventas: { can_view: true, can_edit: false, can_approve: false, scope: 'MINE' }, pedidos: { can_view: true, can_edit: true, can_approve: false, scope: 'ALL' } };

    it('mismo contenido en otro orden → iguales', () => {
        const b = { pedidos: { ...a.pedidos }, ventas: { ...a.ventas } };
        expect(mismosPermisos(a, b)).toBe(true);
    });

    it('un permiso, un alcance o un módulo distinto → distintos', () => {
        expect(mismosPermisos(a, { ...a, ventas: { ...a.ventas, can_edit: true } })).toBe(false);
        expect(mismosPermisos(a, { ...a, ventas: { ...a.ventas, scope: 'ALL' } })).toBe(false);
        expect(mismosPermisos(a, { ventas: a.ventas })).toBe(false);
        expect(mismosPermisos(null, a)).toBe(false);
    });
});

describe('esFalloDeCredencial — cuándo se olvida la biometría', () => {
    it('sólo credenciales o cuenta bloqueada', () => {
        expect(esFalloDeCredencial({ ok: false, motivo: 'credenciales' })).toBe(true);
        expect(esFalloDeCredencial({ ok: false, motivo: 'bloqueado' })).toBe(true);
        expect(esFalloDeCredencial({ ok: false, motivo: 'red' })).toBe(false);
        expect(esFalloDeCredencial({ ok: false, motivo: 'limite' })).toBe(false);
        expect(esFalloDeCredencial({ ok: false, motivo: 'otro' })).toBe(false);
        expect(esFalloDeCredencial({ ok: false })).toBe(false);
    });
});

describe('borrarTodosLosBorradores — el cierre de sesión se los lleva', () => {
    beforeEach(() => localStorage.clear());

    it('borra todos los borradores y deja las preferencias', () => {
        saveDraft('pedido_1', { a: 1 });
        saveDraft('traslado', { b: 2 });
        localStorage.setItem('pedido_draft_roto', 'no es json');
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('sb_device_class', 'navegador');
        localStorage.setItem('mis_pedido_draft_no', 'x');   // el prefijo va al PRINCIPIO

        borrarTodosLosBorradores();

        expect(loadDraft('pedido_1')).toBeNull();
        expect(loadDraft('traslado')).toBeNull();
        expect(localStorage.getItem('pedido_draft_roto')).toBeNull();
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(localStorage.getItem('sb_device_class')).toBe('navegador');
        expect(localStorage.getItem('mis_pedido_draft_no')).toBe('x');
    });
});
