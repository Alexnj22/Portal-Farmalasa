// ─────────────────────────────────────────────────────────────────────────────
// Lo que dice el DUI → los campos del expediente
// ─────────────────────────────────────────────────────────────────────────────
//
// Las pruebas que importan acá no son las de «llena el nombre» sino las tres
// que impiden que ayudar se convierta en estorbar: no pisa lo tecleado, no
// guarda un valor que no está en su catálogo, y no deja media dirección.
//
// La tercera es la menos obvia y la más cara: un municipio sin departamento no
// se puede resolver —hay nombres repetidos en departamentos distintos— así que
// media dirección es PEOR que ninguna, porque se ve completa.

import { describe, it, expect } from 'vitest';
import { aplicarDuiLeido } from '../../src/utils/duiLeido';

const LEIDO = {
    numero: '01234567-8',
    nombres: 'MARIA JOSE',
    apellidos: 'RIVAS LOPEZ',
    sexo: 'F',
    fecha_nacimiento: '1995-03-12',
    lugar_nacimiento: 'CHALATENANGO',
    lugar_expedicion: 'CHALATENANGO',
    fecha_expedicion: '2020-05-04',
    fecha_vencimiento: '2030-05-04',
    estado_familiar: 'SOLTERO',
    profesion: 'DEPENDIENTE',
    domicilio: 'COL. ESCALON',
    departamento: 'Chalatenango',
    municipio: null,
    distrito: null,
    tipo_sangre: 'O+',
    nacionalidad: 'Salvadoreña',
};

describe('aplicarDuiLeido', () => {
    it('llena los campos vacíos', () => {
        const { parche } = aplicarDuiLeido(LEIDO, {});
        expect(parche.dui).toBe('01234567-8');
        expect(parche.first_names).toBe('MARIA JOSE');
        expect(parche.gender).toBe('F');
        expect(parche.marital_status).toBe('SOLTERO');
        expect(parche.blood_type).toBe('O+');
        expect(parche.birth_date).toBe('1995-03-12');
        expect(parche.dui_fecha_vencimiento).toBe('2030-05-04');
        expect(parche.nationality).toBe('Salvadoreña');
    });

    it('NO pisa lo que ya está escrito', () => {
        // Quien tecleó puede estar corrigiendo una lectura anterior, o el
        // documento puede estar desactualizado. Manda el humano.
        const actual = { first_names: 'MARIA DE JESUS', gender: 'M' };
        const { parche } = aplicarDuiLeido(LEIDO, actual);
        expect(parche.first_names).toBeUndefined();
        expect(parche.gender).toBeUndefined();
        expect(parche.last_names).toBe('RIVAS LOPEZ');   // ése sí estaba vacío
    });

    it('normaliza «ACOMPANADO» sin Ñ al valor del catálogo', () => {
        // El prompt lo pide sin Ñ a propósito: es el carácter que más confunde
        // al OCR. Acá vuelve a la grafía que usa el formulario.
        const { parche } = aplicarDuiLeido({ ...LEIDO, estado_familiar: 'ACOMPANADO' }, {});
        expect(parche.marital_status).toBe('ACOMPAÑADO');
    });

    it('descarta lo que no está en su catálogo, y lo DICE', () => {
        const { parche, descartados } = aplicarDuiLeido(
            { ...LEIDO, sexo: 'X', tipo_sangre: 'Z+', estado_familiar: 'CONVIVIENTE' }, {});
        expect(parche.gender).toBeUndefined();
        expect(parche.blood_type).toBeUndefined();
        expect(parche.marital_status).toBeUndefined();
        expect(descartados.join(' ')).toContain('sexo');
        expect(descartados.join(' ')).toContain('tipo de sangre');
        expect(descartados.join(' ')).toContain('estado familiar');
    });

    it('un departamento que no existe se cae con su municipio y su distrito', () => {
        // Media dirección es peor que ninguna: se ve completa.
        const { parche, descartados } = aplicarDuiLeido(
            { ...LEIDO, departamento: 'ATLANTIDA', municipio: 'Chalatenango', distrito: 'La Palma' }, {});
        expect(parche.department).toBeUndefined();
        expect(parche.municipality).toBeUndefined();
        expect(parche.distrito).toBeUndefined();
        expect(descartados.join(' ')).toContain('departamento');
    });

    it('un municipio que no pertenece al departamento leído no entra', () => {
        const { parche, descartados } = aplicarDuiLeido(
            { ...LEIDO, departamento: 'Chalatenango', municipio: 'Mejicanos' }, {});
        expect(parche.department).toBe('Chalatenango');
        expect(parche.municipality).toBeUndefined();
        expect(descartados.join(' ')).toContain('municipio');
    });

    it('un null no borra nada', () => {
        // El modelo devuelve null cuando no lee: eso es «no sé», no «vacío».
        const { parche } = aplicarDuiLeido(
            { numero: null, nombres: null, sexo: null }, { first_names: 'PEDRO' });
        expect(parche.first_names).toBeUndefined();
        expect(parche.dui).toBeUndefined();
    });

    it('sin tipo de sangre no pasa nada: es opcional en el DUI', () => {
        const { parche, descartados } = aplicarDuiLeido({ ...LEIDO, tipo_sangre: null }, {});
        expect(parche.blood_type).toBeUndefined();
        expect(descartados.join(' ')).not.toContain('sangre');
    });
});

describe('el nivel académico sale del DUI', () => {
    it('la profesión se expande y el nivel se deduce', () => {
        const { parche } = aplicarDuiLeido({ profesion: 'ING. EN SISTEMAS Y COMPUTACION' }, {});
        expect(parche.profession).toBe('Ingeniería en Sistemas y Computacion');
        expect(parche.education_level).toBe('UNIVERSITARIO');
    });

    it('un técnico va a Especialidad, no a Profesión', () => {
        // El formulario esconde «Profesión / Título» salvo en Universitario:
        // escribirlo ahí lo dejaría guardado y invisible.
        const { parche } = aplicarDuiLeido({ profesion: 'TEC. EN ENFERMERIA' }, {});
        expect(parche.education_level).toBe('TECNICO_SUPERIOR');
        expect(parche.education_specialty).toBe('Técnico en Enfermeria');
        expect(parche.profession).toBeUndefined();
    });

    it('un oficio no inventa nivel académico', () => {
        const { parche } = aplicarDuiLeido({ profesion: 'COMERCIANTE' }, {});
        expect(parche.education_level).toBeUndefined();
        expect(parche.profession).toBe('Comerciante');
    });

    it('no pisa el nivel que alguien ya eligió', () => {
        const { parche } = aplicarDuiLeido(
            { profesion: 'ING. EN SISTEMAS' },
            { education_level: 'BACHILLERATO_GENERAL', profession: 'Bachiller' });
        expect(parche.education_level).toBeUndefined();
        expect(parche.profession).toBeUndefined();
    });
});
