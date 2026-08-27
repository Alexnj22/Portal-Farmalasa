/**
 * Lo que dice el DUI → los campos del expediente.
 *
 * ── Dos reglas, y las dos existen por el mismo motivo ───────────────────────
 *
 * 1. **Sólo llena lo que está VACÍO.** Nunca pisa lo que alguien escribió. Si
 *    Talento Humano ya tecleó el nombre y el documento dice otro, el que manda
 *    es el humano: puede estar corrigiendo una lectura anterior, o el documento
 *    puede estar desactualizado. Pisar lo tecleado convierte «te ayudo» en «te
 *    contradigo sin avisar».
 *
 * 2. **Lo que no encaja en un catálogo, no entra.** El estado familiar, el
 *    género y el tipo de sangre son listas cerradas del formulario; el
 *    departamento, el municipio y el distrito son los del catálogo territorial.
 *    Un valor leído que no está en la lista se descarta en vez de guardarse:
 *    `role_id: null` sobre un cargo mal escrito ya enseñó cómo se ve eso —una
 *    escritura que «funciona» y no hace lo que dice.
 *    Ver [[feedback_un_rotulo_no_es_una_clave]].
 *
 * Devuelve el parche y ADEMÁS la lista de lo que se descartó, para que la
 * pantalla pueda decirlo. Un dato que el documento traía y el portal tiró en
 * silencio es peor que uno que no leyó.
 */
import {
    canonDepartamento, canonMunicipio, canonDistrito,
    municipiosDe, distritosDe,
} from '../data/elSalvadorGeo';
import { leerProfesion } from './profesionDelDui';

const sinTildes = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const GENEROS = ['F', 'M'];
const ESTADOS_FAMILIARES = ['SOLTERO', 'CASADO', 'DIVORCIADO', 'VIUDO', 'ACOMPAÑADO'];
const TIPOS_SANGRE = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

// El DUI dice «ACOMPAÑADO» y el prompt lo pide sin Ñ para que el modelo no
// tenga que acertar un carácter que muchas fuentes de OCR confunden. Acá vuelve
// a su forma canónica, que es la del catálogo del formulario.
const estadoFamiliar = (v) => {
    const n = sinTildes(v).replace(/\/A$/, '');
    return ESTADOS_FAMILIARES.find(e => sinTildes(e) === n) || null;
};

const deCatalogo = (v, lista) => {
    const n = sinTildes(v);
    return lista.find(o => sinTildes(o) === n) || null;
};

const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * @param {object} leido    lo que devolvió `leer-dui` (`datos`)
 * @param {object} actual   el `formData` de ahora
 * @returns {{ parche: object, descartados: string[] }}
 */
export function aplicarDuiLeido(leido, actual = {}) {
    const parche = {};
    const descartados = [];

    // Sólo si está vacío. `poner` es la única puerta: ninguna asignación
    // esquiva esta comprobación.
    const poner = (campo, valor) => {
        if (valor === null || valor === undefined || valor === '') return;
        if (!vacio(actual[campo])) return;
        parche[campo] = valor;
    };

    poner('dui', leido?.numero);
    poner('first_names', leido?.nombres);
    poner('last_names', leido?.apellidos);
    poner('birth_date', leido?.fecha_nacimiento);
    poner('lugar_nacimiento', leido?.lugar_nacimiento);
    poner('dui_lugar_expedicion', leido?.lugar_expedicion);
    poner('dui_fecha_expedicion', leido?.fecha_expedicion);
    poner('dui_fecha_vencimiento', leido?.fecha_vencimiento);
    // ── Profesión: se expande, y de ahí sale el nivel académico ────────────
    //
    // El DUI la escribe abreviada (`ING. EN SISTEMAS Y COMPUTACION`). Guardarla
    // así deja el expediente con una abreviatura en el campo que después decide
    // si a esa persona le corresponde una acreditación profesional — y «ING.» no
    // coincide con nada. `leerProfesion` la expande SIN recortar el resto.
    //
    // El nivel sale de la misma lectura, y sale `null` cuando el texto no lo
    // permite: «COMERCIANTE» es un oficio, no un título. Un `null` acá deja el
    // campo para que alguien lo elija, que es lo correcto — inventarle un nivel
    // universitario a quien no lo tiene le abre una acreditación que no le toca.
    //
    // Y el texto va al campo que ESE nivel muestra, no siempre a `profession`:
    // el formulario esconde «Profesión / Título» salvo en Universitario, así que
    // un «TEC. EN ENFERMERIA» guardado ahí quedaría escrito y **invisible** —
    // que es la forma de error que este archivo existe para evitar.
    const prof = leerProfesion(leido?.profesion);
    poner('education_level', prof.nivel);
    if (prof.nivel === 'UNIVERSITARIO') poner('profession', prof.profesion);
    else if (prof.nivel === 'TECNICO_SUPERIOR') poner('education_specialty', prof.profesion);
    else if (!prof.nivel) poner('profession', prof.profesion);
    // Bachillerato no lleva ninguno de los dos: su «profesión» es el nivel.
    poner('address', leido?.domicilio);

    // El DUI sólo se emite a salvadoreños: si esto es un DUI, la nacionalidad
    // se deduce. No se lee del documento porque el documento no la dice.
    poner('nationality', leido?.nacionalidad || 'Salvadoreña');

    const genero = deCatalogo(leido?.sexo, GENEROS);
    if (leido?.sexo && !genero) descartados.push(`sexo «${leido.sexo}»`);
    poner('gender', genero);

    const civil = estadoFamiliar(leido?.estado_familiar);
    if (leido?.estado_familiar && !civil) descartados.push(`estado familiar «${leido.estado_familiar}»`);
    poner('marital_status', civil);

    const sangre = deCatalogo(leido?.tipo_sangre, TIPOS_SANGRE);
    if (leido?.tipo_sangre && !sangre) descartados.push(`tipo de sangre «${leido.tipo_sangre}»`);
    poner('blood_type', sangre);

    // ── Territorio: en cascada, y ninguno entra suelto ──────────────────────
    //
    // Un municipio sin su departamento no se puede resolver —hay municipios con
    // el mismo nombre en departamentos distintos— y un distrito sin municipio,
    // tampoco. Así que si el departamento no se reconoce, los tres se caen
    // juntos: media dirección es peor que ninguna, porque parece completa.
    const depto = canonDepartamento(leido?.departamento);
    const deptoOk = depto && municipiosDe(depto).length > 0;
    if (leido?.departamento && !deptoOk) descartados.push(`departamento «${leido.departamento}»`);

    if (deptoOk) {
        poner('department', depto);
        const muni = canonMunicipio(leido?.municipio);
        const muniOk = muni && municipiosDe(depto).includes(muni);
        if (leido?.municipio && !muniOk) descartados.push(`municipio «${leido.municipio}»`);
        if (muniOk) {
            poner('municipality', muni);
            const dist = canonDistrito(muni, leido?.distrito);
            const distOk = dist && distritosDe(muni).includes(dist);
            if (leido?.distrito && !distOk) descartados.push(`distrito «${leido.distrito}»`);
            if (distOk) poner('distrito', dist);
        }
    }

    return { parche, descartados };
}

/** Rótulo legible de cada campo, para decir qué se va a llenar. */
export const ROTULO_DUI = {
    dui: 'DUI',
    first_names: 'Nombres',
    last_names: 'Apellidos',
    gender: 'Género',
    marital_status: 'Estado familiar',
    birth_date: 'Fecha de nacimiento',
    lugar_nacimiento: 'Lugar de nacimiento',
    nationality: 'Nacionalidad',
    dui_lugar_expedicion: 'Lugar de expedición',
    dui_fecha_expedicion: 'Fecha de expedición',
    dui_fecha_vencimiento: 'Vence el',
    profession: 'Profesión u oficio',
    education_level: 'Nivel académico',
    education_specialty: 'Especialidad',
    address: 'Dirección',
    department: 'Departamento',
    municipality: 'Municipio',
    distrito: 'Distrito',
    blood_type: 'Tipo de sangre',
};
