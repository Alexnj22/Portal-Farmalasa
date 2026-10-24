import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, loadDraft, loadDraftTime, fijarDuenoDeBorradores, borrarTodosLosBorradores } from '@nucleo/utils/draftUtils';

// El cierre por inactividad ya no borra los borradores: lo que protege a quien
// se sienta después es el dueño. Estas son las tres cosas que tienen que valer.
describe('borrador con dueño', () => {
    beforeEach(() => { localStorage.clear(); fijarDuenoDeBorradores(null); });

    it('sobrevive a que la sesión se cierre y vuelva a entrar la MISMA persona', () => {
        fijarDuenoDeBorradores('celina');
        saveDraft('alta_empleado', { phone: '77777777' });
        fijarDuenoDeBorradores(null);          // la sesión venció
        fijarDuenoDeBorradores('celina');      // vuelve a entrar
        expect(loadDraft('alta_empleado')).toEqual({ phone: '77777777' });
        expect(loadDraftTime('alta_empleado')).toBeTypeOf('number');
    });

    it('otra persona que entra en esa computadora no lo encuentra, y queda borrado', () => {
        fijarDuenoDeBorradores('celina');
        saveDraft('alta_empleado', { dui: '01234567-8' });
        fijarDuenoDeBorradores('otra');
        expect(loadDraft('alta_empleado')).toBeNull();
        fijarDuenoDeBorradores('celina');
        expect(loadDraft('alta_empleado')).toBeNull();
    });

    it('el botón «salir» los borra todos', () => {
        fijarDuenoDeBorradores('celina');
        saveDraft('alta_empleado', { email: 'x@y.z' });
        borrarTodosLosBorradores();
        fijarDuenoDeBorradores('celina');
        expect(loadDraft('alta_empleado')).toBeNull();
    });
});
