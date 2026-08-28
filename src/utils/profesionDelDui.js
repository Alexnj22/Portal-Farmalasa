/**
 * La profesión que dice el DUI → nivel académico y título escrito completo.
 *
 * ── Por qué expandir y no acortar ───────────────────────────────────────────
 *
 * El DUI escribe la profesión abreviada y en mayúsculas:
 * `ING. EN SISTEMAS Y COMPUTACION`. Guardar eso tal cual deja el expediente con
 * una abreviatura en un campo que después se usa para decidir si a esa persona
 * le corresponde una acreditación profesional — y «ING.» no coincide con nada.
 *
 * Pedido del usuario, textual: *«solo verifica que si dice ing. en xxxx es
 * ingenieria, no acortes»*. Así que se expande el prefijo y **se conserva
 * entero el resto**: `Ingeniería en Sistemas y Computación`, no «Ingeniería» a
 * secas ni «Ing. Sistemas».
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * Si el prefijo no está en la tabla, devuelve el texto con mayúsculas y
 * minúsculas normales y **nivel `null`**. No adivina: un oficio como
 * «COMERCIANTE» o «AGRICULTOR» no es un nivel académico, y ponerle
 * «Universitario» sería inventarle un título a alguien.
 */

const PALABRAS_MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'con', 'para']);

/**
 * «SISTEMAS Y COMPUTACION» → «Sistemas y Computacion».
 *
 * `esResto` marca el texto que va DETRÁS del título («en Sistemas…»): ahí la
 * primera palabra puede ser menor y tiene que quedar en minúscula, porque no
 * empieza la frase — la empieza «Ingeniería».
 *
 * ── No se inventan tildes ───────────────────────────────────────────────────
 * El DUI escribe sin acentos (`COMPUTACION`) y acá se conserva así. Un
 * diccionario de acentos parece una mejora hasta que le toca un apellido o una
 * carrera con nombre propio y lo «corrige» mal: el portal escribiría en el
 * expediente algo que el documento no dice. Las tildes que sí aparecen son las
 * de los títulos de esta tabla —«Ingeniería», «Técnico»— que son texto nuestro,
 * no del documento.
 */
function capitalizar(texto, esResto = false) {
    return String(texto || '').toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => {
        if ((i > 0 || esResto) && PALABRAS_MINUSCULAS.has(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
}

/**
 * Prefijos que el DUI usa, con lo que significan y el nivel que implican.
 *
 * El orden importa: se prueba el más largo primero. `LICDA` tiene que ganarle a
 * `LIC` o quedaría «Licenciatura da en …».
 */
const PREFIJOS = [
    { abrev: ['ARQ'],                 titulo: 'Arquitectura',   nivel: 'UNIVERSITARIO' },
    { abrev: ['LICDA', 'LICDO', 'LIC'], titulo: 'Licenciatura', nivel: 'UNIVERSITARIO' },
    { abrev: ['ING', 'INGA'],         titulo: 'Ingeniería',     nivel: 'UNIVERSITARIO' },
    { abrev: ['DRA', 'DR'],           titulo: 'Doctorado',      nivel: 'UNIVERSITARIO' },
    { abrev: ['PROFA', 'PROF'],       titulo: 'Profesorado',    nivel: 'UNIVERSITARIO' },
    { abrev: ['TECA', 'TEC'],         titulo: 'Técnico',        nivel: 'TECNICO_SUPERIOR' },
    { abrev: ['BR', 'BACH'],          titulo: 'Bachillerato',   nivel: 'BACHILLERATO_GENERAL' },
];

// Un DUI puede traer la profesión escrita entera en vez de abreviada. Se
// reconoce igual: lo que decide el nivel es la palabra, no el punto.
const PALABRAS_COMPLETAS = [
    { re: /^arquitect[oa]?\b/,                 titulo: 'Arquitectura',   nivel: 'UNIVERSITARIO' },
    { re: /^licenciad[oa]?\b|^licenciatura\b/, titulo: 'Licenciatura',   nivel: 'UNIVERSITARIO' },
    { re: /^ingenier[oaí]a?\b/,                titulo: 'Ingeniería',     nivel: 'UNIVERSITARIO' },
    { re: /^doctor[a]?\b|^doctorado\b/,        titulo: 'Doctorado',      nivel: 'UNIVERSITARIO' },
    { re: /^profesor[a]?\b|^profesorado\b/,    titulo: 'Profesorado',    nivel: 'UNIVERSITARIO' },
    { re: /^t[eé]cnic[oa]\b/,                  titulo: 'Técnico',        nivel: 'TECNICO_SUPERIOR' },
    { re: /^bachiller\b|^bachillerato\b/,      titulo: 'Bachillerato',   nivel: 'BACHILLERATO_GENERAL' },
];

const sinTildes = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * @param {string} crudo lo que dice el DUI, p. ej. `ING. EN SISTEMAS Y COMPUTACION`
 * @returns {{ profesion: string|null, nivel: string|null }}
 *   `nivel` es `null` cuando el texto no permite deducirlo — un oficio no es un
 *   título, y ponerle uno sería inventarlo.
 */
export function leerProfesion(crudo) {
    const limpio = String(crudo || '').trim().replace(/\s+/g, ' ');
    if (!limpio) return { profesion: null, nivel: null };

    const norm = sinTildes(limpio).toUpperCase();

    // 1 · Prefijo abreviado, con o sin punto.
    for (const p of PREFIJOS) {
        for (const a of p.abrev) {
            /* El `(A)` del femenino, que el DUI escribe pegado a la abreviatura.
             *
             * `LIC.(A) EN CIENCIAS DE LA COMPUTACION` no coincidía con nada:
             * `LIC.` sí y `LICDA.` también, pero esta forma —que es la que el
             * RNPN imprime cuando el título vale para los dos géneros— quedaba
             * afuera. El resultado no era un error: la profesión se guardaba y
             * el NIVEL quedaba vacío, o sea que la ficha decía «Lic.(a) en
             * Ciencias de la Computación» y «nivel académico: —» a la vez.
             *
             * Se acepta como parte de la abreviatura: `\.?` para el punto,
             * `(\([AO]\))?` para el paréntesis, y otra vez el punto porque
             * aparece escrito de las dos formas. */
            const m = norm.match(new RegExp(`^${a}\\.?\\s*(?:\\([AO]\\))?\\.?\\s+(.*)$`));
            if (m) {
                const resto = limpio.slice(limpio.length - m[1].length);
                // El resto se conserva ENTERO: «en Sistemas y Computación» no se
                // recorta a «Sistemas», que es lo que el usuario pidió evitar.
                return { profesion: `${p.titulo} ${capitalizar(resto, true)}`.trim(), nivel: p.nivel };
            }
            // El prefijo solo, sin nada detrás: «ING.» a secas.
            if (new RegExp(`^${a}\\.?\\s*(?:\\([AO]\\))?\\.?$`).test(norm)) {
                return { profesion: p.titulo, nivel: p.nivel };
            }
        }
    }

    // 2 · Escrita completa.
    const bajo = sinTildes(limpio).toLowerCase();
    for (const p of PALABRAS_COMPLETAS) {
        if (p.re.test(bajo)) return { profesion: capitalizar(limpio), nivel: p.nivel };
    }

    // 3 · No se puede deducir: se guarda el texto legible y el nivel queda vacío
    //     para que alguien lo elija.
    return { profesion: capitalizar(limpio), nivel: null };
}
