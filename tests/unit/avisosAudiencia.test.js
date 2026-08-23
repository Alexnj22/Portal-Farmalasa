// ¿A quién le llega un aviso?
//
// `announcementAppliesToUser` es el único punto de verdad de esa pregunta, y la
// contestan CUATRO lugares distintos: el menú, la campana, «Mis avisos» y el
// arranque de la sesión. Antes estaba duplicada entre dos de ellos y habían
// divergido — por eso se centralizó, y por eso conviene que tenga pruebas: si
// vuelve a torcerse, el defecto es silencioso en las dos direcciones. Un aviso
// que no llega no se nota (nadie extraña lo que no vio), y uno que llega de más
// se nota tarde y mal.

import { describe, it, expect } from 'vitest';
import { announcementAppliesToUser } from '../../src/utils/announcementAudience';

// `user.role` es el ID del cargo (AuthContext lo arma como `emp.role_id`), y la
// función lo cruza contra `roles` para sacar el NOMBRE. Ese rodeo es a propósito:
// AnnouncementsView guarda el nombre del cargo en `target_value`, no su id.
const ROLES = [
    { id: 3,  name: 'Dependiente de Farmacia' },
    { id: 9,  name: 'Jefe/a de Sala' },
    { id: 23, name: 'Regente de Enfermeria' },
];
const ana  = { id: 'u1', branchId: 25, role: 3 };
const beto = { id: 'u2', branchId: 27, role: 9 };

describe('a quién le llega un aviso', () => {
    it('el aviso GLOBAL le llega a todos', () => {
        expect(announcementAppliesToUser({ target_type: 'GLOBAL' }, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser({ target_type: 'GLOBAL' }, beto, ROLES)).toBe(true);
    });

    it('el de una SALA le llega sólo a los de esa sala', () => {
        const a = { target_type: 'BRANCH', target_value: 25 };
        expect(announcementAppliesToUser(a, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser(a, beto, ROLES)).toBe(false);
    });

    it('la sala compara por valor y no por tipo: 25 y "25" son la misma sala', () => {
        // El id de sala viaja como número desde el store y como texto desde la
        // base según el camino. Un `===` crudo dejaría a media sala sin avisos.
        expect(announcementAppliesToUser({ target_type: 'BRANCH', target_value: '25' }, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser({ target_type: 'BRANCH', target_value: 25 }, { ...ana, branchId: '25' }, ROLES)).toBe(true);
    });

    it('el de un CARGO se resuelve por nombre, que es como se guarda', () => {
        const a = { target_type: 'ROLE', target_value: 'Dependiente de Farmacia' };
        expect(announcementAppliesToUser(a, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser(a, beto, ROLES)).toBe(false);
    });

    it('si el cargo se renombró, el aviso viejo NO le llega a nadie', () => {
        // Queda anclado porque es una consecuencia REAL de guardar el rótulo en
        // vez de la clave, y no se ve venir: el aviso sigue existiendo, la
        // pantalla lo muestra en la lista de enviados, y no lo recibe nadie.
        // Es la familia de «un rótulo no es una clave» — acá con el agravante de
        // que la tabla `roles` tiene un cargo SIN tilde («Regente de
        // Enfermeria») y cualquiera lo escribiría con ella.
        const a = { target_type: 'ROLE', target_value: 'Regente de Enfermería' };  // con tilde
        const regente = { id: 'u3', branchId: 25, role: 23 };
        expect(announcementAppliesToUser(a, regente, ROLES)).toBe(false);
        // El nombre exacto de la tabla sí llega.
        expect(announcementAppliesToUser({ ...a, target_value: 'Regente de Enfermeria' }, regente, ROLES)).toBe(true);
    });

    it('el CARGO SECUNDARIO no recibe avisos — hoy son 3 personas', () => {
        // Comportamiento actual, anclado a propósito para que el día que se
        // decida cambiarlo esta prueba obligue a decirlo. Hoy no le pasa a
        // nadie: los 23 avisos del portal son todos de tipo EMPLOYEE y nunca se
        // mandó uno por cargo. Pero hay 3 empleados con cargo secundario, y el
        // día que se use ROLE no van a recibir el de su segundo cargo.
        const conDos = { id: 'u4', branchId: 25, role: 3, secondaryRoleId: 9 };
        expect(announcementAppliesToUser({ target_type: 'ROLE', target_value: 'Jefe/a de Sala' }, conDos, ROLES)).toBe(false);
    });

    it('el dirigido a PERSONAS le llega sólo a las de la lista', () => {
        const a = { target_type: 'EMPLOYEE', target_value: ['u1', 'u9'] };
        expect(announcementAppliesToUser(a, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser(a, beto, ROLES)).toBe(false);
    });

    it('una lista de personas que no es lista no le llega a nadie', () => {
        // Falla CERRADO: ante un dato que no se entiende, no llega. Al revés
        // —tratarlo como global— un aviso mal guardado se le mostraría a los 49.
        for (const v of ['u1', null, undefined, 42, {}]) {
            expect(announcementAppliesToUser({ target_type: 'EMPLOYEE', target_value: v }, ana, ROLES)).toBe(false);
        }
    });

    it('acepta las dos formas del campo: camelCase y snake_case', () => {
        // La misma fila llega con nombres distintos según venga del store o de
        // la base. Si sólo leyera una, media aplicación no vería los avisos.
        expect(announcementAppliesToUser({ targetType: 'BRANCH', targetValue: 25 }, ana, ROLES)).toBe(true);
        expect(announcementAppliesToUser({ target_type: 'BRANCH', target_value: 25 }, ana, ROLES)).toBe(true);
    });

    it('sin usuario, sin tipo o con un tipo desconocido: no le llega a nadie', () => {
        expect(announcementAppliesToUser({ target_type: 'GLOBAL' }, null, ROLES)).toBe(false);
        expect(announcementAppliesToUser({}, ana, ROLES)).toBe(false);
        expect(announcementAppliesToUser({ target_type: 'SALA_NUEVA' }, ana, ROLES)).toBe(false);
    });

    it('sin catálogo de cargos, el aviso por cargo no le llega a nadie', () => {
        // Pasa de verdad: los avisos se filtran en el arranque y `roles` puede
        // no haber llegado todavía. Falla cerrado, que es lo correcto — pero
        // conviene saber que el aviso reaparece cuando el catálogo carga.
        const a = { target_type: 'ROLE', target_value: 'Dependiente de Farmacia' };
        expect(announcementAppliesToUser(a, ana, [])).toBe(false);
        expect(announcementAppliesToUser(a, ana, null)).toBe(false);
    });
});
