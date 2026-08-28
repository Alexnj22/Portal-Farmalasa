// ─────────────────────────────────────────────────────────────────────────────
// La profesión del DUI → título completo y nivel académico
// ─────────────────────────────────────────────────────────────────────────────
//
// Dos cosas se prueban acá, y la segunda importa más que la primera:
//
//  0. Que NO invente tildes. El DUI escribe `COMPUTACION` sin acento y el
//     portal lo conserva así: un diccionario de acentos «corrige» mal el día
//     que le toca un nombre propio, y el expediente terminaría diciendo algo
//     que el documento no dice. Las tildes de «Ingeniería» y «Técnico» sí son
//     nuestras: son el título que agregamos, no texto del documento.
//  1. Que expanda sin RECORTAR. Pedido textual del usuario: «si dice ing. en
//     xxxx es ingenieria, no acortes». El caso real de su captura es
//     `ING. EN SISTEMAS Y COMPUTACION`.
//  2. Que NO adivine un nivel cuando el texto no lo permite. «COMERCIANTE» es
//     un oficio, no un título: ponerle «Universitario» sería inventarle una
//     carrera a alguien, y ese dato después decide si le corresponde una
//     acreditación profesional.

import { describe, it, expect } from 'vitest';
import { leerProfesion } from '../../src/utils/profesionDelDui';

describe('leerProfesion', () => {
    it('expande el prefijo y conserva el resto ENTERO', () => {
        const r = leerProfesion('ING. EN SISTEMAS Y COMPUTACION');
        expect(r.profesion).toBe('Ingeniería en Sistemas y Computacion');
        expect(r.nivel).toBe('UNIVERSITARIO');
    });

    it('no recorta a la primera palabra', () => {
        expect(leerProfesion('LIC. EN ADMINISTRACION DE EMPRESAS').profesion)
            .toBe('Licenciatura en Administracion de Empresas');
    });

    it('«LICDA» le gana a «LIC»: el prefijo más largo primero', () => {
        // Con el orden al revés saldría «Licenciatura da en Enfermería».
        expect(leerProfesion('LICDA. EN ENFERMERIA').profesion).toBe('Licenciatura en Enfermeria');
    });

    it('funciona sin punto', () => {
        expect(leerProfesion('ING EN INDUSTRIAS').profesion).toBe('Ingeniería en Industrias');
    });

    it('deja las palabras menores en minúscula', () => {
        expect(leerProfesion('LIC. EN CIENCIAS DE LA EDUCACION').profesion)
            .toBe('Licenciatura en Ciencias de la Educacion');
    });

    it('el técnico va a su propio nivel, no a universitario', () => {
        const r = leerProfesion('TEC. EN ENFERMERIA');
        expect(r.profesion).toBe('Técnico en Enfermeria');
        expect(r.nivel).toBe('TECNICO_SUPERIOR');
    });

    it('bachiller es bachillerato', () => {
        expect(leerProfesion('BACHILLER').nivel).toBe('BACHILLERATO_GENERAL');
    });

    it('reconoce la profesión escrita completa', () => {
        expect(leerProfesion('INGENIERO INDUSTRIAL').nivel).toBe('UNIVERSITARIO');
        expect(leerProfesion('Doctora en Medicina').nivel).toBe('UNIVERSITARIO');
    });

    // ── Lo que NO debe hacer ─────────────────────────────────────────────────

    it('un oficio NO recibe nivel académico', () => {
        // Es lo que impide inventarle una carrera a alguien.
        const r = leerProfesion('COMERCIANTE');
        expect(r.profesion).toBe('Comerciante');
        expect(r.nivel).toBe(null);
        expect(leerProfesion('AGRICULTOR').nivel).toBe(null);
        expect(leerProfesion('AMA DE CASA').nivel).toBe(null);
    });

    it('vacío devuelve vacío, no un texto capitalizado', () => {
        expect(leerProfesion('')).toEqual({ profesion: null, nivel: null });
        expect(leerProfesion(null)).toEqual({ profesion: null, nivel: null });
    });

    it('un prefijo solo no arrastra basura', () => {
        expect(leerProfesion('ING.').profesion).toBe('Ingeniería');
    });
});

/* ── El «(A)» del femenino ───────────────────────────────────────────────────
 *
 * El RNPN imprime `LIC.(A)` cuando el título vale para los dos géneros, y esa
 * forma no coincidía con nada: `LIC.` sí y `LICDA.` también. El resultado no era
 * un error visible — la profesión se guardaba y el NIVEL quedaba vacío, o sea
 * que la ficha decía «Lic.(a) en Ciencias de la Computación» y «nivel
 * académico: —» a la vez. Lo reportó el usuario: «el nivel académico, ¿por qué
 * no se agrega? el DUI sí lo tiene».
 */
describe('la forma femenina que imprime el DUI', () => {
    it('«LIC.(A) EN …» es una licenciatura, y es universitaria', () => {
        expect(leerProfesion('LIC.(A) EN CIENCIAS DE LA COMPUTACION')).toEqual({
            profesion: 'Licenciatura en Ciencias de la Computacion', nivel: 'UNIVERSITARIO',
        });
    });

    it('vale para las demás abreviaturas', () => {
        expect(leerProfesion('ING.(A) EN SISTEMAS').nivel).toBe('UNIVERSITARIO');
        expect(leerProfesion('TEC.(A) EN ENFERMERIA').nivel).toBe('TECNICO_SUPERIOR');
    });

    it('y sola, sin nada detrás', () => {
        expect(leerProfesion('LIC.(A)')).toEqual({ profesion: 'Licenciatura', nivel: 'UNIVERSITARIO' });
    });

    it('lo que ya funcionaba sigue igual', () => {
        expect(leerProfesion('LICDA. EN ENFERMERIA').nivel).toBe('UNIVERSITARIO');
        expect(leerProfesion('ING. EN SISTEMAS Y COMPUTACION').nivel).toBe('UNIVERSITARIO');
        // Y un oficio sigue sin nivel: no se inventa uno universitario.
        expect(leerProfesion('COMERCIANTE').nivel).toBeNull();
    });
});
