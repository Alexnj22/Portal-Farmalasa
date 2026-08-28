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
import { aplicarDuiLeido, avisoDeCaras } from '../../src/utils/duiLeido';

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

/* ── Qué era cada archivo ────────────────────────────────────────────────────
 *
 * Estas pruebas existen por el defecto que las trajo: `es_dui` viajaba desde el
 * lector y NADIE lo leía, así que quien subía una licencia de conducir veía el
 * mismo «no se pudo leer» que quien subió un DUI movido. Y el error más caro —
 * subir dos veces la misma cara— ni siquiera tenía cómo detectarse.
 */
describe('avisoDeCaras', () => {
    it('«no es un DUI» gana sobre todo lo demás', () => {
        const a = avisoDeCaras({ esDui: false, caras: ['ANVERSO', 'REVERSO'] });
        expect(a.grave).toBe(true);
        expect(a.texto).toMatch(/no parece un DUI/i);
    });

    it('sin clasificación no inventa nada', () => {
        expect(avisoDeCaras({ esDui: true })).toBeNull();
        expect(avisoDeCaras({ esDui: true, caras: [] })).toBeNull();
        expect(avisoDeCaras(null)).toBeNull();
    });

    it('las dos caras bien puestas no dicen nada', () => {
        expect(avisoDeCaras({ esDui: true, caras: ['ANVERSO', 'REVERSO'] })).toBeNull();
    });

    it('dos veces el frente es GRAVE: falta media ficha', () => {
        const a = avisoDeCaras({ esDui: true, caras: ['ANVERSO', 'ANVERSO'] });
        expect(a.grave).toBe(true);
        expect(a.texto).toMatch(/dos veces el frente/i);
    });

    it('dos veces el reverso también', () => {
        const a = avisoDeCaras({ esDui: true, caras: ['REVERSO', 'REVERSO'] });
        expect(a.grave).toBe(true);
        expect(a.texto).toMatch(/dos veces el reverso/i);
    });

    it('cambiadas de lugar NO es grave — los datos salieron bien', () => {
        const a = avisoDeCaras({ esDui: true, caras: ['REVERSO', 'ANVERSO'] });
        expect(a.grave).toBe(false);
        expect(a.texto).toMatch(/cambiadas de lugar/i);
    });

    it('dice CUÁL de las dos imágenes no es un DUI', () => {
        expect(avisoDeCaras({ esDui: true, caras: ['OTRO', 'REVERSO'] }).texto).toMatch(/del frente/i);
        expect(avisoDeCaras({ esDui: true, caras: ['ANVERSO', 'OTRO'] }).texto).toMatch(/del reverso/i);
        expect(avisoDeCaras({ esDui: true, caras: ['OTRO', 'OTRO'] }).texto).toMatch(/ninguna de las dos/i);
    });

    describe('un solo archivo con las dos caras', () => {
        it('AMBAS es lo esperado y no dice nada', () => {
            expect(avisoDeCaras({ esDui: true, caras: ['AMBAS'] }, true)).toBeNull();
        });

        it('media tarjeta avisa, sin ser grave: el archivo sirve, le falta la otra cara', () => {
            const a = avisoDeCaras({ esDui: true, caras: ['ANVERSO'] }, true);
            expect(a.grave).toBe(false);
            expect(a.texto).toMatch(/sólo el frente/i);
        });

        it('otro documento, en cambio, es grave', () => {
            expect(avisoDeCaras({ esDui: true, caras: ['OTRO'] }, true).grave).toBe(true);
        });
    });
});

/* ── Lo que el documento dice DISTINTO ───────────────────────────────────────
 *
 * `poner` nunca pisa lo que un humano escribió, y eso está bien. Lo que estaba
 * mal es que además lo TIRABA: el dato del documento no llegaba a ninguna
 * pantalla.
 *
 * No se notaba mientras el formulario arrancaba vacío. Al enlazar con una ficha
 * que ya existe llega LLENO, así que el documento choca con casi todo — y el
 * usuario lo vio con su propio DUI: decía `NUNEZ<JOYA<<EDWIN<ALEXANDER` y la
 * ficha tenía «EDWIN» y «NUÑEZ». El nombre completo estaba en la foto y se
 * perdía.
 */
describe('diferencias', () => {
    it('EL CASO REAL: el nombre completo del documento no se pierde', () => {
        const { parche, diferencias } = aplicarDuiLeido(
            { nombres: 'EDWIN ALEXANDER', apellidos: 'NUÑEZ JOYA' },
            { first_names: 'EDWIN', last_names: 'NUÑEZ' });
        // No se pisa nada solo.
        expect(parche.first_names).toBeUndefined();
        // Pero se ofrece.
        expect(diferencias.map(d => d.campo).sort()).toEqual(['first_names', 'last_names']);
        expect(diferencias.find(d => d.campo === 'first_names')).toMatchObject({
            actual: 'EDWIN', documento: 'EDWIN ALEXANDER', rotulo: 'Nombres',
        });
    });

    it('un acento o una mayúscula NO son una diferencia', () => {
        // Ofrecer ruido entrena a ignorar la lista.
        const { diferencias } = aplicarDuiLeido(
            { nombres: 'JOSÉ', apellidos: 'peréz' },
            { first_names: 'jose', last_names: 'PEREZ' });
        expect(diferencias).toEqual([]);
    });

    it('un campo VACÍO se llena y no cuenta como diferencia', () => {
        const { parche, diferencias } = aplicarDuiLeido(
            { nombres: 'ANA' }, { first_names: '' });
        expect(parche.first_names).toBe('ANA');
        expect(diferencias).toEqual([]);
    });

    it('lo que el documento no trae no inventa diferencias', () => {
        const { diferencias } = aplicarDuiLeido({}, { first_names: 'ANA', last_names: 'LOPEZ' });
        expect(diferencias).toEqual([]);
    });

    it('cada diferencia trae su rótulo legible', () => {
        const { diferencias } = aplicarDuiLeido(
            { numero: '01234567-8' }, { dui: '09876543-2' });
        expect(diferencias[0]).toMatchObject({ campo: 'dui', rotulo: 'DUI' });
    });
});
