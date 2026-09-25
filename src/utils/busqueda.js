/**
 * La regla de búsqueda del portal — una sola, para toda lista que se filtra
 * escribiendo. Plan y mediciones: docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md.
 *
 * Existía repartida en cinco mecanismos con reglas distintas, y los defectos
 * que el usuario reportaba («deja cosas sueltas y muestra resultados
 * incorrectos») no venían del reparto sino de la regla vieja (`normSearch`):
 *
 *   · BORRABA la puntuación en vez de separar: `2.5MG` quedaba `25mg`, así que
 *     «25» traía 33 productos de 2.5, y `80/12.5MG` quedaba `80125mg`.
 *   · Los números se buscaban como pedazo de texto: «5» coincidía con 1,487 de
 *     4,397 productos; como número completo son 252.
 *   · Nada ordenaba por parecido: los primeros de «sal» eran NASAL y BETASALIC.
 *   · El respaldo aproximado promediaba palabras, y «ibuprofeno 400» mostraba
 *     el de 600 porque «400»/«600» difieren en un dígito.
 *
 * ⚠️ `normSearch` (searchUtils.js) NO se reemplaza todavía: es el gemelo exacto
 * de `norm_search` en la base y arma los patrones que viajan a las columnas
 * `*_norm`. Cambiarlo antes que esas columnas haría que el servidor dejara de
 * encontrar. Este módulo compara en memoria, con la regla aplicada a los dos
 * lados, así que no depende de la base.
 *
 * Los casos viven en `tests/casos-busqueda.json` y valen para el gemelo SQL
 * cuando exista: cambiar uno exige cambiar el otro y volver a compararlos.
 */

// ── Normalizar ──────────────────────────────────────────────────────────────

const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Separador de miles: `25,000` y `2.500` son veinticinco mil y dos mil
 * quinientos, no decimales. La marca es un grupo de EXACTAMENTE tres dígitos
 * detrás de la coma o el punto, con 1–3 dígitos delante que no sean un «0»
 * solo (`0.125 mg` sí es decimal). Medido: 29 productos del catálogo escriben
 * así sus unidades internacionales (`NEUROBION 25,000`, `BADYKET 2,500 UI`).
 */
function sinMiles(s) {
    // El separador de miles es el MISMO en todos los grupos, y puede seguirle
    // un decimal de 1–2 cifras con el otro separador: `$1,234.50`.
    return s.replace(
        /(?<![\d.,])[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*(?=[.,]\d{1,2}(?!\d)|(?![.,]?\d))/g,
        (m, sep) => m.split(sep).join(''),
    );
}

/**
 * Texto → palabras separadas por un espacio, sin tildes y en minúsculas.
 *
 *   «TEMISAR PLUS 80/12.5MG»  → «temisar plus 80 12.5 mg»
 *   «Ácido S.S.N»             → «acido ssn»
 *   «CO-TRIMOXAZOL x30»       → «co trimoxazol x 30»
 *   «2,5 mg»                  → «2.5 mg»   (la coma decimal es un punto)
 *
 * El orden de los pasos importa: el decimal se protege ANTES de que la
 * puntuación se vuelva espacio, y las siglas se juntan antes también.
 */
export function normalizar(texto = '') {
    let s = String(texto ?? '')
        .normalize('NFD').replace(DIACRITICOS, '')
        .toLowerCase();
    s = sinMiles(s);
    // Decimal entre dígitos: «2,5» y «2.5» son el mismo número.
    s = s.replace(/(\d)[.,](?=\d)/g, '$1\uE000');
    // Siglas: puntos entre letras SUELTAS («s.s.n», «s.a.»). Una palabra de
    // dos o más letras antes del punto no es sigla («tab.ecomed» se separa).
    s = s.replace(/(^|[^a-z0-9])((?:[a-z]\.){2,})/g, (_, pre, sigla) => pre + sigla.replace(/\./g, ''));
    // Toda otra puntuación separa.
    s = s.replace(/[^a-z0-9\uE000]+/g, ' ');
    // Número pegado a letras: «500mg» → «500 mg», «x30» → «x 30».
    s = s.replace(/(\d)(?=[a-z])/g, '$1 ').replace(/([a-z])(?=\d)/g, '$1 ');
    return s.replace(/\uE000/g, '.').replace(/\s+/g, ' ').trim();
}

/**
 * La forma de rescate: la puntuación se BORRA (como hacía la regla vieja) en
 * vez de separar, y los espacios se conservan. Rescata «cotrimoxazol» contra
 * `CO-TRIMOXAZOL` sin juntar palabras que ya venían separadas: juntarlas todas
 * hacía que «sal» encontrara `4 PUNTOS ALUMINIO` (puntoSALuminio). Medido.
 */
export function compactar(texto = '') {
    return String(texto ?? '')
        .normalize('NFD').replace(DIACRITICOS, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── La consulta ─────────────────────────────────────────────────────────────

const ES_NUMERO = /^\d+(?:\.\d+)?$/;
const SOLO_DIGITOS = /^\d+$/;
/** Un número de 6+ dígitos es un identificador (correlativo, NIT, código),
 *  no una cantidad: ahí «80360» sí debe encontrar «0000080360». Y lo que se
 *  busca adentro tiene que tener 4+ dígitos, igual que `es_busqueda_de_codigo`:
 *  con menos, «500» encontraba 124 códigos de barras que lo contienen. */
const LARGO_IDENTIFICADOR = 6;
const MIN_DIGITOS_DENTRO = 4;

/**
 * Palabras de la consulta con su tipo, que decide cómo coinciden:
 *   numero  → el número completo («500» no encuentra «1500»)
 *   mixto   → letras y dígitos juntos («b12», «500mg»): las dos partes
 *             SEGUIDAS, así «b12» no es «una palabra con b» + «un 12»
 *   corta   → 1–2 letras, al inicio de una palabra («mk» no es la mitad de otra)
 *   palabra → 3+ letras, en cualquier parte de una palabra
 */
export function palabrasDeConsulta(consulta = '') {
    const grupos = compactarGrupos(consulta);
    return grupos.map(g => {
        if (ES_NUMERO.test(g)) return { t: g, tipo: 'numero' };
        const t = normalizar(g);
        if (/\d/.test(g) && /[a-z]/.test(g)) return { t, tipo: 'mixto', junto: t.replace(/ /g, '') };
        return { t, tipo: t.length <= 2 ? 'corta' : 'palabra' };
    }).filter(p => p.t);
}

/** La consulta partida por espacios y puntuación, SIN separar número de letras. */
function compactarGrupos(consulta) {
    let s = sinMiles(String(consulta ?? '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase());
    s = s.replace(/(\d)[.,](?=\d)/g, '$1\uE000');
    s = s.replace(/(^|[^a-z0-9])((?:[a-z]\.){2,})/g, (_, pre, sigla) => pre + sigla.replace(/\./g, ''));
    s = s.replace(/[^a-z0-9\uE000]+/g, ' ').replace(/\uE000/g, '.').trim();
    return s ? s.split(' ') : [];
}

// ── Coincidir ───────────────────────────────────────────────────────────────

function prepararCampos(campos) {
    const crudos = campos.filter(c => c != null && c !== '');
    const textos = crudos.map(c => normalizar(c)).filter(Boolean);
    const texto = textos.join(' ');
    return {
        textos,
        texto,
        conBordes: ` ${texto} `,
        palabras: texto ? texto.split(' ') : [],
        compactas: crudos.map(c => compactar(c)).join(' ').split(' ').filter(Boolean),
    };
}

/** ¿La palabra `p` de la consulta coincide? Devuelve 0 (no), 1 (dentro de una
 *  palabra) o 2 (al inicio de una palabra) — el 2 sube el puntaje. */
function coincidePalabra({ t, tipo, junto }, h) {
    if (tipo === 'numero') {
        if (h.palabras.includes(t)) return 2;
        // Un entero encuentra un monto con decimales: «138» → «138.97».
        if (!t.includes('.') && h.palabras.some(w => w.startsWith(t + '.'))) return 1;
        if (t.length >= MIN_DIGITOS_DENTRO && !t.includes('.') && h.palabras.some(w => w.length >= LARGO_IDENTIFICADOR && SOLO_DIGITOS.test(w) && w.includes(t))) return 1;
        return 0;
    }
    if (tipo === 'mixto') {
        if (h.conBordes.includes(` ${t} `)) return 2;
        if (h.compactas.some(w => w.startsWith(junto))) return 1;
        return 0;
    }
    if (h.palabras.some(w => w.startsWith(t))) return 2;
    if (tipo === 'corta') return 0;
    if (h.palabras.some(w => w.includes(t))) return 1;
    if (h.compactas.some(w => w.includes(t))) return 1;
    return 0;
}

/**
 * ¿Todas las palabras de la consulta coinciden, en cualquier orden?
 * Consulta vacía = coincide todo (la lista sin filtrar).
 */
export function coincide(consulta, ...campos) {
    const ps = palabrasDeConsulta(consulta);
    if (!ps.length) return true;
    const h = prepararCampos(campos);
    return ps.every(p => coincidePalabra(p, h) > 0);
}

/**
 * Puntaje de relevancia, 0 si no coincide:
 *   100  un campo ES lo escrito (un código de barras exacto, un nombre entero)
 *    90  el PRIMER campo (el nombre) empieza con lo escrito
 *    80  todas las palabras coinciden al inicio de una palabra
 *    70  lo escrito aparece seguido y en el mismo orden
 *    60  todas coinciden, en cualquier parte
 */
export function puntaje(consulta, ...campos) {
    const ps = palabrasDeConsulta(consulta);
    if (!ps.length) return 0;
    const h = prepararCampos(campos);
    const niveles = ps.map(p => coincidePalabra(p, h));
    if (niveles.some(n => n === 0)) return 0;
    const q = ps.map(p => p.t).join(' ');
    if (h.textos.some(t => t === q)) return 100;
    // Si lo escrito termina en número, el campo tiene que empezar con ese
    // número COMPLETO: «500» no es el comienzo de un código `5001234…`.
    const terminaEnNumero = /\d$/.test(q);
    // «Empieza con» cuenta sólo en el PRIMER campo, el que nombra la cosa. Si
    // valiera en cualquiera, un producto cuyo LABORATORIO empieza con «sal»
    // empataba con SAL ANDREWS y ganaba por abecedario (medido en Mín·Máx).
    const principal = normalizar(campos[0] ?? '');
    if (principal.startsWith(terminaEnNumero ? q + ' ' : q)) return 90;
    if (niveles.every(n => n === 2)) return 80;
    // Con una sola palabra «seguido y en orden» es lo mismo que «contenida».
    if (ps.length > 1 && h.texto.includes(q)) return 70;
    return 60;
}

// ── Aproximada (sólo cuando lo exacto no encontró nada) ─────────────────────

/**
 * Forma fonética del español: lo que suena igual se escribe igual.
 * Caza «amoxisilina» y «omeprasol», que la distancia entre letras sola no
 * alcanza con un umbral sano (medido: los trigramas del servidor daban 0.60).
 */
export function fonetica(palabra = '') {
    return palabra
        .replace(/ch/g, '\uE001')
        .replace(/h/g, '')
        .replace(/\uE001/g, 'ch')
        .replace(/qu(?=[ei])/g, 'k')
        .replace(/c(?=[ei])/g, 's')
        .replace(/g(?=[ei])/g, 'j')
        .replace(/z/g, 's')
        .replace(/c/g, 'k')
        .replace(/v/g, 'b')
        .replace(/ll/g, 'y')
        .replace(/y$/g, 'i')
        .replace(/(.)\1+/g, '$1');
}

/** Distancia de edición con transposición (optimal string alignment):
 *  «dicloefnac» → «diclofenac» es UN cambio, no dos. */
function distancia(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev2 = null;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            const costo = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                v = Math.min(v, prev2[j - 2] + 1);
            }
            cur.push(v);
        }
        prev2 = prev;
        prev = cur;
    }
    return prev[n];
}

/** Qué tanto se parece la palabra `t` a alguna palabra de `h`, 0–1.
 *  Compara contra el COMIENZO de cada palabra (se escribe el principio de un
 *  nombre, no el final), con uno de holgura por si falta o sobra una letra. */
function parecidoPalabra(t, h) {
    const ft = fonetica(t);
    let mejor = 0;
    for (const w of h.palabras) {
        if (ES_NUMERO.test(w)) continue;
        if (fonetica(w).startsWith(ft)) return 0.95;
        for (let largo = t.length - 1; largo <= t.length + 1; largo++) {
            if (largo < 1 || largo > w.length) continue;
            const s = 1 - distancia(t, w.slice(0, largo)) / t.length;
            if (s > mejor) mejor = s;
        }
    }
    return mejor;
}

export const UMBRAL_APROXIMADA = 0.75;
export const MIN_LETRAS_APROXIMADA = 4;

/**
 * Parecido 0–1 para el respaldo aproximado. Reglas, todas medidas:
 *   · Cada número tiene que coincidir EXACTO: «ibuprofeno 400» nunca muestra
 *     el de 600 como si fuera lo buscado.
 *   · Palabras de menos de 4 letras también tienen que coincidir tal cual:
 *     con tres letras un error de dedo ya es otra palabra.
 *   · El parecido es el de la PEOR palabra, no el promedio: una palabra buena
 *     no puede cargar con una que no se parece a nada.
 */
export function parecido(consulta, ...campos) {
    const ps = palabrasDeConsulta(consulta);
    const largas = ps.filter(p => p.tipo === 'palabra' && p.t.length >= MIN_LETRAS_APROXIMADA);
    if (!largas.length) return 0;
    const h = prepararCampos(campos);
    let peor = 1;
    for (const p of ps) {
        const exacto = coincidePalabra(p, h) > 0;
        if (p.tipo !== 'palabra' || p.t.length < MIN_LETRAS_APROXIMADA) {
            if (!exacto) return 0;
            continue;
        }
        const s = exacto ? 1 : parecidoPalabra(p.t, h);
        if (s < peor) peor = s;
    }
    return peor;
}

// ── Filtrar una lista ───────────────────────────────────────────────────────

/**
 * Filtra una lista con la regla del portal.
 *
 * `orden` decide qué pasa con lo que coincide (plan §8.1):
 *   'relevancia' — CATÁLOGOS (productos, personas, proveedores, cargos…): se
 *                  busca UNA cosa y tiene que salir arriba.
 *   'original'   — HISTORIALES (facturas, cortes, movimientos…): se busca
 *                  qué pasó, y lo reciente primero sigue mandando.
 * Si la pantalla deja elegir una columna, pasa 'original' y ordena después.
 *
 * El respaldo aproximado ordena SIEMPRE por parecido: ahí el orden dice qué
 * tan seguro es el resultado, y la pantalla tiene que avisar con
 * «Resultados similares para X» (`aproximado: true`).
 *
 * A igual puntaje se conserva el orden en que venía la lista.
 */
export function filtrar(consulta, items, getCampos, { orden = 'relevancia' } = {}) {
    const lista = items || [];
    if (!palabrasDeConsulta(consulta).length) return { resultados: lista, aproximado: false };

    if (orden === 'original') {
        const exactos = lista.filter(it => coincide(consulta, ...getCampos(it)));
        if (exactos.length) return { resultados: exactos, aproximado: false };
    } else {
        const conPuntaje = [];
        lista.forEach((it, i) => {
            const s = puntaje(consulta, ...getCampos(it));
            if (s > 0) conPuntaje.push({ it, s, i });
        });
        if (conPuntaje.length) {
            conPuntaje.sort((a, b) => b.s - a.s || a.i - b.i);
            return { resultados: conPuntaje.map(x => x.it), aproximado: false };
        }
    }

    const similares = [];
    lista.forEach((it, i) => {
        const s = parecido(consulta, ...getCampos(it));
        if (s >= UMBRAL_APROXIMADA) similares.push({ it, s, i });
    });
    similares.sort((a, b) => b.s - a.s || a.i - b.i);
    return { resultados: similares.map(x => x.it), aproximado: similares.length > 0 };
}
