// ─────────────────────────────────────────────────────────────────────────────
// Enlazar con la ficha de alguien que ya trabajaba acá
// ─────────────────────────────────────────────────────────────────────────────
//
// El defecto que estas pruebas anclan no era «incómodo», era DESTRUCTIVO.
//
// Al elegir a la persona se copiaban tres campos —sala, cargo y foto— y nada
// más. Pero el aviso de esa misma tarjeta dice, con razón, que al guardar «lo
// que esa ficha tenía escrito antes se reemplaza». Con el formulario en blanco,
// eso significa reemplazar el DUI, la dirección, el salario y el banco de esa
// persona POR VACÍO.
//
// O sea: el camino natural —elegir a quien vuelve y apretar Guardar— le borraba
// el expediente, sin ningún error y sin que nada en la pantalla lo dijera. Lo
// reportó el usuario como una molestia: «si agrego a un empleado que ya está,
// ¿por qué no se ponen los datos que ya están guardados?».

import { describe, it, expect } from 'vitest';
import { aplicarFichaEnlazada, hayHomonimo } from '../../src/components/forms/EmployeeFormModal';

const FICHA = {
    id: 'uuid-adriana',
    created_at: '2024-01-01T00:00:00Z',
    name: 'Adriana Vanessa Ramirez Pascacio',
    first_names: 'Adriana Vanessa',
    last_names: 'Ramirez Pascacio',
    dui: '01234567-8',
    address: 'Col. Escalón, San Salvador',
    department: 'San Salvador',
    base_salary: 400,
    bank_name: 'Banco Agrícola',
    account_number: '1234567890',
    branch_id: 3,
    role_id: 7,
    secondary_role_id: null,
    status: 'INACTIVO',
    hours_owed: 12,
    photo: 'https://firmada.example/adriana.jpg?token=abc',
    has_car: true,
    tiene_acreditacion_dependiente: true,
};

const VACIO = { first_names: '', last_names: '', dui: '', branch_id: '', role_id: '', has_car: false };

describe('lo que se trae', () => {
    it('trae el expediente ENTERO, no tres campos', () => {
        const r = aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA);
        expect(r.dui).toBe('01234567-8');
        expect(r.address).toBe('Col. Escalón, San Salvador');
        expect(r.base_salary).toBe(400);
        expect(r.bank_name).toBe('Banco Agrícola');
        expect(r.account_number).toBe('1234567890');
        expect(r.first_names).toBe('Adriana Vanessa');
    });

    it('los booleanos también — si no, «tiene carro» volvería a NO', () => {
        // El formulario en blanco los inicializa en `false`, así que una regla
        // de «sólo si está vacío» los dejaría en false y perdería el dato real.
        const r = aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA);
        expect(r.has_car).toBe(true);
        expect(r.tiene_acreditacion_dependiente).toBe(true);
    });

    it('guarda el enlace', () => {
        expect(aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA).enlazar_con_id).toBe('uuid-adriana');
    });

    it('la foto entra como vista previa, no como archivo', () => {
        const r = aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA);
        expect(r.photoPreview).toBe('https://firmada.example/adriana.jpg?token=abc');
        expect(r.file).toBeUndefined();
    });
});

describe('lo que NO se hereda, y por qué', () => {
    it('el `id` — con él puesto, el modal deja de ser un alta', () => {
        // Se iría por el camino de EDITAR, que es otro guardado. El enlace viaja
        // aparte, en `enlazar_con_id`.
        expect(aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA).id).toBeUndefined();
    });

    it('el estado: quien vuelve entra ACTIVO, no como se fue', () => {
        expect(aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA).status).toBeUndefined();
    });

    it('ni el nombre armado, ni la URL firmada, ni las horas debidas', () => {
        const r = aplicarFichaEnlazada(VACIO, 'uuid-adriana', FICHA);
        expect(r.name).toBeUndefined();
        expect(r.photo).toBeUndefined();
        expect(r.hours_owed).toBeUndefined();
        expect(r.created_at).toBeUndefined();
    });
});

describe('lo que el humano ya eligió', () => {
    it('sala y cargo tecleados GANAN — se puede reincorporar en otra sala', () => {
        const r = aplicarFichaEnlazada({ ...VACIO, branch_id: 99, role_id: 42 }, 'uuid-adriana', FICHA);
        expect(r.branch_id).toBe(99);
        expect(r.role_id).toBe(42);
        // Y el resto igual viene de la ficha.
        expect(r.dui).toBe('01234567-8');
    });

    it('una foto recién tomada no se pisa', () => {
        // Con `file`, que es como llega de verdad: verificado en el código —los
        // DOS sitios que ponen una vista previa real (elegir un archivo y la
        // foto del teléfono) ponen también el archivo. Esta prueba nació con un
        // caso imposible —vista previa sin archivo— y por eso pasaba mientras el
        // portal se quedaba con la foto de la persona anterior.
        const r = aplicarFichaEnlazada({ ...VACIO, file: {}, photoPreview: 'blob:nueva' }, 'uuid-adriana', FICHA);
        expect(r.photoPreview).toBe('blob:nueva');
    });
});

describe('casos de borde', () => {
    it('sin ficha encontrada, sólo guarda el id y no toca nada', () => {
        const r = aplicarFichaEnlazada({ ...VACIO, dui: '99999999-9' }, 'raro', null);
        expect(r.enlazar_con_id).toBe('raro');
        expect(r.dui).toBe('99999999-9');
    });

    it('quitar el enlace no revienta', () => {
        expect(aplicarFichaEnlazada(VACIO, '', undefined).enlazar_con_id).toBe('');
    });

    it('un `null` de la ficha no pisa lo que hay escrito', () => {
        const r = aplicarFichaEnlazada({ ...VACIO, secondary_role_id: 5 }, 'uuid-adriana', FICHA);
        expect(r.secondary_role_id).toBe(5);
    });
});

/* ── Los dos defectos que trajo traer la ficha entera ─────────────────────────
 *
 * Los dos aparecieron el mismo día y por el mismo cambio, y los dos los vio el
 * usuario en pantalla. Van juntos porque la lección es una sola: al llenar el
 * formulario con datos reales, dos guardas que nunca se habían ejercitado —el
 * detector de homónimos y el de «ya hay foto»— empezaron a recibir justo el
 * caso que no sabían distinguir.
 */

const OTRA = { id: 'uuid-adriana', name: 'Adriana Vanessa Ramirez Pascacio' };
const TERCERA = { id: 'uuid-tercera', name: 'Adriana Vanessa Ramirez Pascacio' };
const NOMBRE = { first_names: 'Adriana Vanessa', last_names: 'Ramirez Pascacio' };

describe('el aviso de posible duplicado', () => {
    it('NO acusa a la ficha que se acaba de enlazar', () => {
        // Decía «si es la misma persona, enlázala abajo» sobre alguien a quien
        // ya se había enlazado dos centímetros más abajo en la misma pantalla.
        expect(hayHomonimo({ ...NOMBRE, enlazar_con_id: 'uuid-adriana' }, [OTRA])).toBe(false);
    });

    it('pero SÍ avisa si hay un tercero con ese nombre', () => {
        // Acá el aviso es correcto y sigue haciendo falta: enlazaste con una y
        // existe otra igual.
        expect(hayHomonimo({ ...NOMBRE, enlazar_con_id: 'uuid-adriana' }, [OTRA, TERCERA])).toBe(true);
    });

    it('sin enlazar, avisa — que es para lo que existe', () => {
        expect(hayHomonimo(NOMBRE, [OTRA])).toBe(true);
    });

    it('no se acusa a sí misma al editar', () => {
        expect(hayHomonimo({ ...NOMBRE, id: 'uuid-adriana' }, [OTRA])).toBe(false);
    });

    it('ignora acentos y mayúsculas, y calla sin nombre', () => {
        expect(hayHomonimo({ first_names: 'ADRIÁNA VANESSA', last_names: 'Ramírez Pascacio' }, [OTRA])).toBe(true);
        expect(hayHomonimo({ first_names: '', last_names: '' }, [OTRA])).toBe(false);
    });
});

describe('cambiar de persona enlazada', () => {
    const A = { id: 'a', name: 'Ana', photo: 'https://x/ana.jpg' };
    const B = { id: 'b', name: 'Bea', photo: 'https://x/bea.jpg' };

    it('la foto SIGUE a la persona', () => {
        // Se quedaba en la del primero: después del primer enlace ya había vista
        // previa y la guarda la daba por puesta a mano. O sea la cara de alguien
        // sobre el expediente de otro.
        const uno = aplicarFichaEnlazada({}, 'a', A);
        expect(uno.photoPreview).toBe('https://x/ana.jpg');
        const dos = aplicarFichaEnlazada(uno, 'b', B);
        expect(dos.photoPreview).toBe('https://x/bea.jpg');
    });

    it('pero una foto que alguien TOMÓ no se pisa', () => {
        // `file` es el discriminador: sólo se llena cuando alguien eligió una
        // imagen o la tomó con el teléfono.
        const conFoto = { file: {}, photoPreview: 'blob:recien-tomada' };
        expect(aplicarFichaEnlazada(conFoto, 'b', B).photoPreview).toBe('blob:recien-tomada');
    });

    it('y si la nueva ficha no tiene foto, no queda la vieja', () => {
        const uno = aplicarFichaEnlazada({}, 'a', A);
        const dos = aplicarFichaEnlazada(uno, 'c', { id: 'c', name: 'Caro' });
        expect(dos.photoPreview).toBeNull();
    });
});
