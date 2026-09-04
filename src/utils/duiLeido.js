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

/* El DUI no escribe «O+»: escribe «O RH +», con la palabra RH en medio y
 * espacios alrededor del signo. Cruzarlo tal cual contra el catálogo no
 * coincidía nunca, y el dato se descartaba con su aviso —«no coincide con
 * ninguna opción del portal»— en todas las fichas.
 *
 * Se le quita lo que sobra y se queda el grupo y el signo, que es lo que el
 * catálogo guarda. Un `POSITIVO`/`NEGATIVO` escrito con letra también entra:
 * aparece en documentos viejos. */
const normalizarSangre = (v) => {
    let t = sinTildes(v).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    t = t.replace(/\bRH\b/g, ' ');
    t = t.replace(/\bPOSITIVO\b|\bPOSITIVA\b/g, '+').replace(/\bNEGATIVO\b|\bNEGATIVA\b/g, '-');
    return t.replace(/[^ABO+-]/g, '');
};

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


/**
 * @param {object} leido    lo que devolvió `leer-dui` (`datos`)
 * @param {object} actual   el `formData` de ahora
 * @returns {{ parche: object, descartados: string[], diferencias: object[] }}
 */
export function aplicarDuiLeido(leido, actual = {}) {
    const parche = {};
    const descartados = [];
    const diferencias = [];

    /* Sólo si está vacío. `poner` es la única puerta: ninguna asignación
     * esquiva esta comprobación.
     *
     * ── Y lo que NO entra por estar ocupado, se OFRECE ─────────────────────
     *
     * Callarse era el defecto. Este archivo ya decía en su encabezado que «un
     * dato que el documento traía y el portal tiró en silencio es peor que uno
     * que no leyó», pero eso sólo estaba implementado para lo que no encaja en
     * un catálogo. Lo que se descartaba por estar el campo ocupado no se
     * contaba en ninguna parte.
     *
     * No se notaba mientras el formulario arrancaba vacío. Al enlazar con una
     * ficha que ya existe llega LLENO, así que el documento pasó a chocar con
     * casi todo — y el usuario lo vio: «¿no actualizó el nombre, ni los demás
     * datos?». El DUI decía `NUNEZ<JOYA<<EDWIN<ALEXANDER` y la ficha tenía
     * «EDWIN» y «NUÑEZ»: el nombre completo estaba en la foto y se tiró.
     *
     * Sigue sin pisarse nada solo —el humano manda— pero la diferencia se
     * muestra y se puede aplicar. Las dos reglas se cumplen: no contradecir en
     * silencio, y no descartar en silencio. */
    const poner = (campo, valor) => {
        if (valor === null || valor === undefined || valor === '') return;
        if (!vacio(actual[campo])) {
            // Sólo cuenta como diferencia si de verdad dice OTRA cosa. Un
            // acento, una mayúscula o un espacio de más no son un cambio, y
            // ofrecerlos como si lo fueran entrena a ignorar la lista.
            if (sinTildes(actual[campo]) !== sinTildes(valor)) {
                diferencias.push({ campo, rotulo: ROTULO_DUI[campo] || campo,
                                   actual: String(actual[campo]), documento: String(valor) });
            }
            return;
        }
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

    const sangre = deCatalogo(normalizarSangre(leido?.tipo_sangre), TIPOS_SANGRE);
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
        let elMunicipio = muni && municipiosDe(depto).includes(muni) ? muni : null;
        /* El municipio del DUI puede ser un DISTRITO de hoy.
         *
         * La reforma municipal de 2023 fusionó los municipios: el que el
         * documento nombra —«CHALATENANGO», emitido en 2020— hoy es un DISTRITO
         * dentro de «Chalatenango Sur». Cruzarlo contra la lista de municipios
         * no coincide con nada, y el dato se descartaba con su aviso en toda
         * ficha cuyo DUI sea anterior a la reforma, que son casi todas.
         *
         * No es adivinar: se busca qué municipio del MISMO departamento tiene un
         * distrito con ese nombre. Y sólo se usa si hay UNO — con dos, elegir
         * sería inventar, y el aviso de descartado dice la verdad. */
        let distritoHeredado = null;
        if (!elMunicipio && leido?.municipio) {
            const candidatos = municipiosDe(depto).filter(m => {
                const d = canonDistrito(m, leido.municipio);
                return d && distritosDe(m).includes(d);
            });
            if (candidatos.length === 1) {
                elMunicipio = candidatos[0];
                distritoHeredado = canonDistrito(elMunicipio, leido.municipio);
            }
        }
        if (leido?.municipio && !elMunicipio) descartados.push(`municipio «${leido.municipio}»`);
        if (elMunicipio) {
            poner('municipality', elMunicipio);
            // El distrito que trae el documento manda; si no trae, sirve el que
            // se dedujo del municipio viejo — es el MISMO lugar con otro nombre.
            const dist = canonDistrito(elMunicipio, leido?.distrito) || distritoHeredado;
            const distOk = dist && distritosDe(elMunicipio).includes(dist);
            if (leido?.distrito && !canonDistrito(elMunicipio, leido.distrito)) {
                descartados.push(`distrito «${leido.distrito}»`);
            }
            if (distOk) poner('distrito', dist);
        }
    }

    return { parche, descartados, diferencias };
}


/* Campos que SÓLO trae esa cara. Sirven para saber si la cara se leyó de
 * verdad. `tipo_sangre` y `distrito` no entran: son opcionales en el DUI, así
 * que su ausencia no prueba nada. */
const DEL_ANVERSO = ['numero', 'nombres', 'apellidos', 'sexo', 'fecha_nacimiento',
                     'lugar_nacimiento', 'lugar_expedicion', 'fecha_expedicion', 'fecha_vencimiento'];
const DEL_REVERSO = ['domicilio', 'departamento', 'municipio', 'profesion', 'estado_familiar'];

const trajo = (datos, campos) => campos.some(c => !vacio(datos?.[c]));

/**
 * Qué era cada archivo que se subió, dicho para quien lo subió.
 *
 * ── Por qué hacía falta ─────────────────────────────────────────────────────
 *
 * «Eso no es un DUI» ya estaba resuelto: el lector corta con `NO_ES_DUI` y la
 * pantalla lo dice. Lo que no tenía forma de detectarse es el error más común y
 * el más caro: **subir dos veces la misma cara**.
 *
 * Ése PASA la comprobación —las dos imágenes son un DUI de verdad— y se
 * manifiesta como «faltó la mitad de los datos». Nadie lo relaciona con el
 * archivo: el número está en el anverso y el domicilio en el reverso, así que
 * con dos anversos falta la dirección entera y se lee como que el lector falló.
 *
 * La rama de `esDui` se queda igual. Hoy no se alcanza —el corte pasa antes—
 * pero este archivo describe la respuesta del lector, no el orden en que la
 * función decide; el día que ese corte se mueva, acá no hay nada que arreglar.
 *
 * ── Y el rótulo se comprueba contra el DATO ────────────────────────────────
 *
 * El aviso existe para explicar por qué falta media ficha. Así que antes de
 * decirlo se mira si de verdad falta: cada cara tiene campos que sólo ella
 * lleva —el número y las fechas están en el anverso, el domicilio y el estado
 * familiar en el reverso—, y si los del reverso llegaron, el reverso se leyó,
 * diga lo que diga la clasificación.
 *
 * Medido el 2026-09-03 con un DUI real en un PDF de dos páginas: el modelo
 * clasificó una entrada POR PÁGINA (`["ANVERSO","REVERSO"]`), esto miraba la
 * primera y anunciaba «el archivo trae sólo el frente» sobre una lectura
 * COMPLETA. `leer-dui` ya colapsa las páginas de un mismo archivo; esto es la
 * mitad que no depende de un despliegue ni de que el modelo acierte el rótulo.
 *
 * Un aviso falso sobre trabajo bien hecho no es un aviso de menos: manda a
 * re-escanear un documento que estaba bien y enseña a ignorar los demás. Es
 * [[feedback_el_instrumento_miente_antes_que_el_efecto]].
 *
 * @param {{esDui?: boolean, caras?: string[], datos?: object}} r  lo que devolvió `leer-dui`
 * @param {boolean} unArchivo  true si se subió un solo archivo con las dos caras
 * @returns {{grave: boolean, texto: string}|null} `null` cuando no hay nada que decir
 */
export function avisoDeCaras(r, unArchivo = false) {
    const caras = Array.isArray(r?.caras) ? r.caras : [];

    // Lo más grave primero: si no es un DUI, lo demás no importa.
    if (r?.esDui === false) {
        return { grave: true, texto: 'Eso no parece un DUI. Revisa que sea el documento correcto.' };
    }

    if (!caras.length) return null;   // el lector no clasificó: no se inventa nada

    const hayAnverso = trajo(r?.datos, DEL_ANVERSO);
    const hayReverso = trajo(r?.datos, DEL_REVERSO);

    if (unArchivo) {
        // Varias entradas para un solo archivo son PÁGINAS: vale la unión.
        const vistas = new Set(caras);
        if (vistas.size === 1 && vistas.has('OTRO')) {
            return { grave: true, texto: 'El archivo no parece un DUI.' };
        }
        if (vistas.has('AMBAS') || (vistas.has('ANVERSO') && vistas.has('REVERSO'))) return null;

        const sola = vistas.has('ANVERSO') ? 'ANVERSO' : (vistas.has('REVERSO') ? 'REVERSO' : null);
        if (!sola) return null;
        // Si los datos de la otra cara llegaron, la otra cara estaba: el
        // rótulo se equivocó y no hay nada que avisar.
        if (sola === 'ANVERSO' && hayReverso) return null;
        if (sola === 'REVERSO' && hayAnverso) return null;
        const cual = sola === 'ANVERSO' ? 'el frente' : 'el reverso';
        return {
            grave: false,
            texto: `El archivo trae sólo ${cual}. Faltan los datos de la otra cara — súbelo completo o usa las dos imágenes.`,
        };
    }

    // Dos archivos: el primero es el que se subió como frente.
    const [f, rev] = caras;
    if (f === 'OTRO' && rev === 'OTRO') {
        return { grave: true, texto: 'Ninguna de las dos imágenes parece un DUI.' };
    }
    if (f === 'OTRO') return { grave: true, texto: 'La imagen del frente no parece un DUI.' };
    if (rev === 'OTRO') return { grave: true, texto: 'La imagen del reverso no parece un DUI.' };

    if (f === rev && (f === 'ANVERSO' || f === 'REVERSO')) {
        const falta = f === 'ANVERSO' ? !hayReverso : !hayAnverso;
        const cual = f === 'ANVERSO' ? 'el frente' : 'el reverso';
        if (falta) {
            return {
                grave: true,
                texto: `Subiste dos veces ${cual}. Falta la otra cara, y con ella la mitad de los datos.`,
            };
        }
        return null;   // los datos de las dos caras llegaron: el rótulo se equivocó
    }

    // Cambiadas de lugar. NO es grave: el lector ve las dos juntas y los datos
    // salen bien igual. Se dice para que el archivo quede donde dice su rótulo.
    if (f === 'REVERSO' && rev === 'ANVERSO') {
        return { grave: false, texto: 'Las dos caras están cambiadas de lugar. Los datos se leyeron bien igual.' };
    }

    return null;
}
