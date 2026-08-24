// Resolver un cargo contra la tabla `roles`.
//
// Tiene un bug real detrás, medido el 2026-08-12 sobre las 24 filas reales: la
// tabla dice **«Regente de Enfermeria»**, sin tilde, y la lista escrita a mano
// del formulario la escribía **con** tilde. El `find` por igualdad exacta
// devolvía `undefined`, el `? :` lo convertía en `null`, y el empleado se
// guardaba con **`role_id: null` sin lanzar, sin avisar y sin quedar en el
// log**. Fallaba UNO DE CUATRO cargos, que es exactamente por qué sobrevivió.
//
// Estas pruebas fijan las tres decisiones que lo cierran, y las tres se pueden
// deshacer sin que nada falle:
//
//   1. la normalización quita tildes, colapsa espacios y baja a minúsculas —
//      la tabla real tiene «Referente de Farmacovigilancia » con espacio al
//      final;
//   2. **el exacto se prueba PRIMERO**: con dos cargos que sólo se distinguen
//      por un acento, gana el que se escribió;
//   3. un nombre que no existe **no se ofrece**, en vez de ofrecerse y guardar
//      nulo.

import { describe, it, expect } from 'vitest';
import { normalizarCargo, buscarCargo, opcionesDeCargo } from '../../src/utils/roles';

// Las filas de la tabla real, con sus rarezas incluidas a propósito.
// El espacio al final de la id 9 ya NO existe en producción (medido el
// 2026-08-24: 0 de 25 cargos tienen espacio sobrante, contra lo que dice el
// comentario del archivo). Se deja acá igual porque la función tiene que seguir
// tolerándolo: el dato se limpió, la defensa no sobra.
const ROLES = [
    { id: 23, name: 'Regente de Enfermeria' },          // sin tilde, así está en la base
    { id: 9,  name: 'Referente de Farmacovigilancia ' }, // con espacio al final
    { id: 4,  name: 'Jefe de Sucursal' },
    { id: 13, name: 'Supervisor/a de Ventas' },
];

describe('normalizar', () => {
    it('quita tildes, colapsa espacios y baja a minúsculas', () => {
        expect(normalizarCargo('Regente de Enfermería')).toBe('regente de enfermeria');
        expect(normalizarCargo('  Jefe   de  Sucursal  ')).toBe('jefe de sucursal');
        expect(normalizarCargo('REFERENTE DE FARMACOVIGILANCIA ')).toBe('referente de farmacovigilancia');
    });

    it('la ñ TAMBIÉN se pierde, y hoy es inofensivo — medido', () => {
        // `NFD` descompone la ñ en `n` + tilde combinante (U+0303), que cae
        // dentro del rango de marcas diacríticas que se borra. O sea que
        // «Diseñador» y «Disenador» son el mismo cargo para esta función.
        //
        // No es un defecto hoy y no se cambió por eso: medido contra la tabla
        // real el 2026-08-24, **de los 25 cargos ninguno lleva ñ**. Queda
        // anclado para que el día que alguien cree dos cargos que sólo se
        // distingan por una ñ, esta prueba diga que van a colisionar — y no se
        // descubra guardando un `role_id` equivocado.
        expect(normalizarCargo('Diseñador')).toBe('disenador');
    });

    it('lo vacío y lo nulo dan cadena vacía, no «null»', () => {
        for (const v of [null, undefined, '', '   ']) expect(normalizarCargo(v)).toBe('');
    });
});

describe('buscar el cargo', () => {
    it('encuentra el de la tilde — el bug original', () => {
        // Esto es lo que devolvía `undefined` y guardaba role_id: null.
        expect(buscarCargo(ROLES, 'Regente de Enfermería')?.id).toBe(23);
        expect(buscarCargo(ROLES, 'Regente de Enfermeria')?.id).toBe(23);
    });

    it('encuentra el que tiene espacio al final en la tabla', () => {
        expect(buscarCargo(ROLES, 'Referente de Farmacovigilancia')?.id).toBe(9);
    });

    it('el EXACTO gana sobre el normalizado', () => {
        // La prueba que justifica el orden. Con dos cargos que sólo se
        // distinguen por un acento, buscar «Analista» tiene que dar el 1 y no el
        // 2 — si el orden se invirtiera, `find` devolvería el primero que
        // normalice igual y eso es una moneda al aire.
        const conAmbos = [{ id: 1, name: 'Analista' }, { id: 2, name: 'Analísta' }];
        expect(buscarCargo(conAmbos, 'Analista').id).toBe(1);
        expect(buscarCargo(conAmbos, 'Analísta').id).toBe(2);
    });

    it('un cargo que no existe devuelve null, no undefined', () => {
        // `undefined` y `null` se comportan distinto al escribirse: uno pasa el
        // `?? valor` y el otro no.
        expect(buscarCargo(ROLES, 'Cargo Inventado')).toBe(null);
        expect(buscarCargo(ROLES, 'Cargo Inventado')).not.toBe(undefined);
    });

    it('no rompe con entradas rotas', () => {
        expect(buscarCargo(null, 'Jefe de Sucursal')).toBe(null);
        expect(buscarCargo(ROLES, null)).toBe(null);
        expect(buscarCargo(ROLES, '')).toBe(null);
        expect(buscarCargo([null, undefined, { id: 4, name: 'Jefe de Sucursal' }], 'Jefe de Sucursal')?.id).toBe(4);
    });
});

describe('las opciones del desplegable salen de la TABLA', () => {
    it('el texto que se muestra es el de la fila, no el que se pidió', () => {
        // Es lo que hace que el valor elegido coincida con la base POR
        // CONSTRUCCIÓN y no por suerte: se pide con tilde y se ofrece sin ella,
        // que es como está guardado.
        const op = opcionesDeCargo(ROLES, ['Regente de Enfermería']);
        expect(op).toEqual([{ value: 'Regente de Enfermeria', label: 'Regente de Enfermeria' }]);
    });

    it('un nombre que no existe simplemente NO se ofrece', () => {
        // Es preferible una opción de menos que una que al guardarse deja el
        // cargo en nulo.
        const op = opcionesDeCargo(ROLES, ['Jefe de Sucursal', 'Cargo Inventado']);
        expect(op.map(o => o.value)).toEqual(['Jefe de Sucursal']);
    });

    it('no repite un cargo pedido dos veces con escrituras distintas', () => {
        const op = opcionesDeCargo(ROLES, ['Regente de Enfermería', 'Regente de Enfermeria']);
        expect(op).toHaveLength(1);
    });

    it('respeta el orden en que se pidieron', () => {
        const op = opcionesDeCargo(ROLES, ['Supervisor/a de Ventas', 'Jefe de Sucursal']);
        expect(op.map(o => o.value)).toEqual(['Supervisor/a de Ventas', 'Jefe de Sucursal']);
    });

    it('una lista vacía da una lista vacía', () => {
        expect(opcionesDeCargo(ROLES, [])).toEqual([]);
    });
});
