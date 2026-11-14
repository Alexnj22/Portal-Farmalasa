// Emparejador de Datos de Mercado de la SRS (2026-11-14) — la lógica pura.
//
// Para cada producto del portal elige su presentación en el catálogo de la
// SRS (`crp`) y dice con qué confianza. El primer emparejador (el de la noche
// del 13, que no quedó en el repositorio) puntuaba sobre todo por parecido de
// nombre, y por eso ~16 % de sus «alta» tenían mal el empaque (RINOKEM PLUS
// X 100 → la caja de 30) o la variante (COLBER AMLO → COLBER a secas,
// EXFORGE 10/320 → 5/320). Acá cada pareja se juzga por CUATRO cosas que
// tienen que coincidir, no parecerse:
//
//   1. el nombre de marca (las palabras antes de la concentración), sin
//      palabras de variante que sobren de un lado o del otro (H, HCT, AMLO,
//      PLUS, FORTE, D…);
//   2. la concentración: todo número con unidad del portal tiene que estar en
//      el nombre de la SRS;
//   3. el empaque: las unidades (X 30 TAB) contra el producto de los «X n» de
//      la presentación (CAJA X 3 BLISTER X 10 → 30), o el volumen (X 120 ML);
//   4. la forma (tableta, cápsula, jarabe, crema…).
//
// «alta» exige las cuatro sin choque y una sola opción ganadora; un choque de
// variante, concentración o empaque baja la pareja a «baja», que es la que una
// persona tiene que mirar. Una muestra médica nunca gana.
//
// Lo usa scripts/srs/emparejar-datos-mercado.mjs; pruebas en
// tests/unit/emparejarMercado.test.js.

export const TOPE_CATALOGO = 25;   // la SRS no devuelve más de 25 filas por búsqueda

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normalizar = (s) => sinTildes(s).toUpperCase()
    .replace(/[®©™]/g, ' ')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')   // 10,000 = diez mil
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^A-Z0-9./%+ ]/g, ' ')
    .replace(/\s+/g, ' ').trim();

const FORMAS = {
    tab: ['TAB', 'TABS', 'TABLETA', 'TABLETAS', 'COMP', 'COMPRIMIDO', 'COMPRIMIDOS', 'GRAG', 'GRAGEA', 'GRAGEAS', 'CAPLET', 'CAPLETS', 'TABL'],
    cap: ['CAP', 'CAPS', 'CAPSULA', 'CAPSULAS', 'CAPSULE', 'SOFTGEL', 'SOFTGELS', 'PERLAS'],
    liq: ['JBE', 'JARABE', 'SUSP', 'SUSPENSION', 'SOL', 'SOLUCION', 'GOTAS', 'GTS', 'ELIXIR', 'EMULSION', 'ORAL'],
    top: ['CREMA', 'CRM', 'UNG', 'UNGUENTO', 'GEL', 'LOCION', 'POMADA'],
    iny: ['AMP', 'AMPOLLA', 'AMPOLLAS', 'INY', 'INYECTABLE', 'VIAL', 'VIALES', 'JERINGA', 'JERINGAS'],
    sob: ['SOB', 'SOBRE', 'SOBRES'],
    ov: ['OV', 'OVULO', 'OVULOS'],
    sup: ['SUP', 'SUPOSITORIO', 'SUPOSITORIOS'],
    spray: ['SPRAY', 'AEROSOL', 'INHALADOR', 'NEBULIZADOR'],
    parche: ['PARCHE', 'PARCHES'],
};
const FORMA_DE = new Map(Object.entries(FORMAS).flatMap(([k, ws]) => ws.map(w => [w, k])));

// Palabras que no son marca: envases, unidades, conectores, descriptores.
const NO_MARCA = new Set([
    'X', 'CX', 'C', 'DE', 'LA', 'EL', 'LOS', 'LAS', 'CON', 'Y', 'PARA', 'EN', 'POR', 'SIN',
    'MG', 'MCG', 'G', 'GR', 'GRS', 'ML', 'L', 'UI', 'OZ', 'ONZ', 'KG', 'MEQ',
    'TUBO', 'FCO', 'FRASCO', 'CAJA', 'BLISTER', 'BOLSA', 'POTE', 'BOTELLA', 'UNIDAD', 'UNIDADES', 'UND', 'UDS',
    'RECUBIERTA', 'RECUBIERTAS', 'RECUBIERTO', 'RECUBIERTOS', 'CUBIERTA', 'PELICULAR', 'PELICULA',
    'DURA', 'DURAS', 'BLANDA', 'BLANDAS', 'LIBERACION', 'PROLONGADA', 'GASTRORRESISTENTE', 'GASTRORRESISTENTES',
    'EFERVESCENTE', 'EFERVESCENTES', 'EFERV', 'MASTICABLE', 'MASTICABLES', 'DISPERSABLE', 'DISPERSABLES',
    'USO', 'TOPICO', 'TOPICA', 'OFTALMICA', 'OFTALMICO', 'OFT', 'NASAL', 'VAGINAL', 'RECTAL', 'ORAL',
    'POLVO', 'RECONSTITUIR', 'GRANULADO', 'MICROGRANULOS', 'COLIRIO', 'CUTANEA',
]);
// Palabras que distinguen una variante de la misma marca: si sobran de un
// lado, no es el mismo producto.
const VARIANTES = new Set([
    'H', 'HCT', 'AMLO', 'PLUS', 'FORTE', 'D', 'DUO', 'XR', 'XL', 'LP', 'SR', 'CR', 'MR', 'OD', 'RETARD',
    'COMPUESTO', 'COMPUESTA', 'MAX', 'MAXI', 'ULTRA', 'EXTRA', 'PED', 'PEDIATRICO', 'PEDIATRICA', 'INFANTIL', 'NINOS',
    'ADULTO', 'ADULTOS', 'MET', 'DM', 'NF', 'F', 'AP', 'LA', 'DIA', 'NOCHE', 'NOCTURNO', 'JUNIOR', 'BABY', 'MINI',
    'FLASH', 'RAPID', 'RAPIDO', 'TRIO', 'TRI', 'BI', 'COMPLEX', 'COMPLEJO', 'ACTIVE', 'ADVANCE', 'CAFEINA',
]);
const UNIDAD_FUERZA = '(MG|MCG|G|GR|UI|%|MEQ)';
const VARIANTE_EN_SRS = /^(PEDIATRIC\w*|INFANTIL\w*|NINOS|ADULTOS?|FORTE|PLUS|DUO|HCT|XR|XL|RETARD|MAX|EXTRA|JUNIOR)$/;

function fuerzasDe(texto) {
    // «5/6.25 MG», «400MG», «120 MG/5 ML», «850/2» (grupo con barra sin unidad).
    const t = normalizar(texto);
    const out = new Set();
    const re = new RegExp(`(?<![X\\d.])(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)*)\\s*${UNIDAD_FUERZA}(?![A-Z])`, 'g');
    let m;
    while ((m = re.exec(t))) {
        const antes = t.slice(Math.max(0, m.index - 3), m.index);
        if (/X\s*$/.test(antes)) continue;              // «X 30 G» es empaque, no fuerza
        for (const n of m[1].split('/')) {
            const v = Number(n.trim());
            if (v > 0) { out.add(v); if ((m[2] === 'G' || m[2] === 'GR') && v < 10) out.add(v * 1000); }
        }
    }
    for (const g of t.matchAll(/(?<![X\d.])(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)(?![\d.]*\s*(?:ML|MG|MCG|G|GR|UI|%))/g)) {
        for (const n of g[1].split('/')) { const v = Number(n); if (v > 0) out.add(v); }
    }
    return out;
}

const numerosDe = (texto) => new Set([...normalizar(texto).matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0])).filter(v => v > 0));

// «SOLUCION INYECTABLE» es inyectable, no líquido oral: la forma más
// específica gana, y «liq» sólo si no hay otra.
function formaDe(texto) {
    let liq = null;
    for (const w of normalizar(texto).split(' ')) {
        const f = FORMA_DE.get(w.replace(/\.$/, ''));
        if (f === 'liq') liq = liq ?? f;
        else if (f) return f;
    }
    return liq;
}
const CONECTORES = new Set(['DE', 'LA', 'EL', 'Y', 'CON', 'DEL']);

/** Lo que importa del nombre del portal. */
export function analizarPortal(producto) {
    const nombre = normalizar(producto?.nombre);
    const palabras = nombre.split(' ');
    const marca = [];
    for (const w of palabras) {
        const p = w.replace(/\.$/, '');
        if (CONECTORES.has(p)) continue;   // «HOJA DE BISTURI» sigue siendo una sola marca
        if (!p || /\d/.test(p) || p === 'X' || p === 'CX' || FORMA_DE.has(p) || NO_MARCA.has(p) && marca.length) break;
        if (NO_MARCA.has(p)) continue;
        marca.push(p);
    }
    const resto = palabras.slice(marca.length).map(w => w.replace(/\.$/, '')).filter(w => /^[A-Z]{2,}$/.test(w) && !FORMA_DE.has(w) && !NO_MARCA.has(w));

    let unidades = null; let volumen = null;
    const reEmpaque = /(?:\bC?X|\bC\/)\s*(\d+(?:\.\d+)?)\s*([A-Z]+)?/g;
    let m;
    while ((m = reEmpaque.exec(nombre))) {
        const n = Number(m[1]); const u = m[2] ?? '';
        if (/^(ML|L|G|GR|GRS|OZ|ONZ)$/.test(u)) volumen = { n: u === 'L' ? n * 1000 : n, u: /^(ML|L)$/.test(u) ? 'ML' : 'G' };
        else if (Number.isInteger(n) && unidades == null && !/^(YDAS|YD|CM|M|MTS|PIES)$/.test(u)) unidades = n;
    }
    if (!volumen) {
        const v = nombre.match(/(?<![\d/])(\d+(?:\.\d+)?)\s*(ML|GR|G)\b(?!\s*\/)/);
        if (v && !fuerzasDe(nombre).has(Number(v[1]))) volumen = { n: Number(v[1]), u: v[2] === 'ML' ? 'ML' : 'G' };
    }
    const lab = normalizar(String(producto?.laboratorio ?? '').replace(/^\d+-/, ''))
        .split(' ').filter(w => w.length >= 2 && !NO_MARCA.has(w));
    // Números sueltos que no son empaque ni fuerza con unidad: «TRILIPIX 135», «INTRAFER F 800».
    const fuerzas = fuerzasDe(nombre);
    const sueltos = new Set([...nombre.replace(/\bC?X\s*\d+(\.\d+)?/g, ' ').matchAll(/(?<![\d./])(\d+(?:\.\d+)?)(?![\d./]|\s*(?:ML|GR|G|OZ|ONZ|YDS|YDAS)\b)/g)]
        .map(m => Number(m[1])).filter(v => v > 0 && !fuerzas.has(v)));
    return {
        nombre, marca, resto, lab, sueltos,
        fuerzas,
        unidades, volumen,
        forma: formaDe(nombre),
    };
}

/** Lo que importa de una fila del catálogo de la SRS. */
export function analizarSrs(fila) {
    const nombre = normalizar(fila?.nombre_comercial);
    const pres = normalizar(fila?.presentacion);
    const palabras = nombre.split(' ');
    const marca = [];
    for (const w of palabras) {
        if (CONECTORES.has(w)) continue;
        if (!w || /\d/.test(w) || FORMA_DE.has(w) || NO_MARCA.has(w) && marca.length) break;
        if (NO_MARCA.has(w)) continue;
        marca.push(w);
    }
    // Empaque: «CAJA X 3 BLISTER X 10 TABLETAS» → 30; «FRASCO X 120 ML» → volumen.
    let unidades = 1; let hayUnidades = false; let volumen = null;
    // «SOBRE X 15 G» es UN sobre de 15 g, no un empaque sin dato.
    const unaSola = /^(SOBRE|FRASCO|TUBO|AMPOLLA|VIAL|BOLSA|POTE|LATA|ENVASE|BOTELLA|1 )/.test(pres);
    for (const m of pres.matchAll(/X\s*(\d+(?:\.\d+)?)\s*([A-Z]+)?/g)) {
        const n = Number(m[1]); const u = m[2] ?? '';
        if (/^(ML|L|G|GR|MG|OZ)$/.test(u)) { volumen = { n: u === 'L' ? n * 1000 : n, u: /^(ML|L)$/.test(u) ? 'ML' : 'G' }; continue; }
        if (n > 0) { unidades *= n; hayUnidades = true; }
    }
    return {
        nombre, pres, marca,
        palabrasNombre: new Set(palabras),
        lab: new Set(normalizar(fila?.laboratorio).split(' ')),
        fuerzas: numerosDe(nombre),
        unidades: hayUnidades ? unidades : (unaSola ? 1 : null),
        unidadesSueltas: new Set([...pres.matchAll(/X\s*(\d+)/g)].map(m => Number(m[1]))),
        volumen,
        forma: formaDe(nombre) ?? formaDe(pres),
        muestra: /MUESTRA/.test(pres),
        hospitalaria: /HOSPITALARI/.test(pres),
    };
}

function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
}
export function mismaPalabra(a, b) {
    if (a === b) return true;
    const x = a.replace(/[^A-Z0-9]/g, ''); const y = b.replace(/[^A-Z0-9]/g, '');
    if (x === y) return true;
    if (x.length >= 6 && y.length >= 6 && lev(x, y) <= 1) return true;
    return false;
}
const contiene = (lista, w) => [...lista].some(v => mismaPalabra(v, w));

/** Juzga una fila del catálogo contra un producto. */
export function juzgar(portal, fila) {
    const s = analizarSrs(fila);
    const choques = [];
    let puntos = 0;

    // 1. Marca. La primera palabra es obligatoria.
    if (!portal.marca.length || !s.marca.length || !mismaPalabra(portal.marca[0], s.marca[0])
        && !(portal.marca.length > 1 && mismaPalabra(portal.marca.join(''), s.marca.join('')))) {
        return { fila, s, puntos: -999, choques: ['marca'], marca: false };
    }
    const unidaPortal = portal.marca.join(''); const unidaSrs = s.marca.join('');
    const juntas = unidaPortal === unidaSrs;   // «CO DIOVAN» = «CO-DIOVAN»
    const faltanEnSrs = juntas ? [] : portal.marca.filter(w => !contiene(s.marca, w) && !contiene(s.palabrasNombre, w));
    const sobranEnSrs = juntas ? [] : s.marca.filter(w => !contiene(portal.marca, w));
    // Lo que sobra en la SRS puede ser el laboratorio («ALOPURINOL SAIMED»).
    const sobranVariante = sobranEnSrs.filter(w => !contiene(portal.resto, w) && !contiene(portal.lab, w) && !contiene(s.lab, w));
    // Lo que sobra y es el laboratorio de la fila de la SRS («ACETAMINOFEN MEDIKEM»
    // contra un portal que dice MK) no es una variante, pero tampoco una
    // coincidencia: impide «alta».
    const avisos = [];
    if (sobranEnSrs.some(w => !contiene(portal.resto, w) && !contiene(portal.lab, w) && contiene(s.lab, w))) { puntos -= 5; avisos.push('laboratorio'); }
    puntos += 40;
    if (faltanEnSrs.length) { puntos -= 20 * faltanEnSrs.length; choques.push('variante'); }
    if (sobranVariante.length) { puntos -= 20 * sobranVariante.length; choques.push('variante'); }
    // Una palabra de variante del portal fuera de la marca (FORTE al final) que la SRS no tiene.
    const varPortal = portal.resto.filter(w => VARIANTES.has(w) && !contiene(s.palabrasNombre, w));
    if (varPortal.length) { puntos -= 15; choques.push('variante'); }

    // 2. Concentración.
    let fuerza = 'sin_dato';
    if (portal.fuerzas.size && s.fuerzas.size) {
        const todas = [...portal.fuerzas].every(v => s.fuerzas.has(v) || (v >= 1000 && s.fuerzas.has(v / 1000)));
        if (todas) { fuerza = 'igual'; puntos += 25; }
        else {
            const algunas = [...portal.fuerzas].some(v => s.fuerzas.has(v));
            fuerza = 'distinta'; puntos -= algunas ? 20 : 30; choques.push('concentracion');
        }
    } else if (!portal.fuerzas.size && s.fuerzas.size) {
        fuerza = 'srs_tiene';
        if (portal.sueltos.size) {
            if ([...portal.sueltos].every(v => s.fuerzas.has(v))) { fuerza = 'igual'; puntos += 15; }
            else puntos -= 5;
        }
    }

    // 3. Empaque.
    let empaque = 'sin_dato';
    if (portal.unidades != null && s.unidades != null && !(portal.volumen && s.volumen)) {
        if (portal.unidades === s.unidades) { empaque = 'igual'; puntos += 20; }
        else { empaque = 'distinto'; puntos -= 15; choques.push('empaque'); }
    } else if (portal.volumen && s.volumen) {
        if (portal.volumen.u === s.volumen.u && Math.abs(portal.volumen.n - s.volumen.n) < 0.01) { empaque = 'igual'; puntos += 20; }
        else { empaque = 'distinto'; puntos -= 15; choques.push('empaque'); }
    } else if (portal.volumen && !s.volumen && s.unidadesSueltas.has(portal.volumen.n)) {
        empaque = 'igual'; puntos += 10;
    }

    // 4. Forma.
    if (portal.forma && s.forma) {
        if (portal.forma === s.forma) puntos += 5;
        else if (new Set([portal.forma, s.forma]).size === 2 && [portal.forma, s.forma].every(f => f === 'tab' || f === 'cap')) puntos -= 3;
        else { puntos -= 12; choques.push('forma'); }
    }

    // Laboratorio, muestra médica, hospitalaria.
    if (portal.lab.some(w => w.length >= 3 && contiene(s.lab, w))) puntos += 5;
    if (s.muestra) { puntos -= 60; choques.push('muestra'); }
    if (s.hospitalaria) puntos -= 5;

    return { fila, s, puntos, choques: [...new Set(choques)], avisos, marca: true, fuerza, empaque };
}

// La palabra con que la SRS escribe cada forma (su buscador ignora tildes).
const PALABRA_DE_FORMA = { tab: ['TABLETA', 'COMPRIMIDO'], cap: ['CAPSULA'], liq: ['JARABE', 'SUSPENSION', 'SOLUCION'],
    top: ['CREMA', 'GEL', 'UNGUENTO'], iny: ['INYECTABLE'], sob: ['SOBRE'], ov: ['OVULO'], sup: ['SUPOSITORIO'],
    spray: ['SPRAY', 'AEROSOL'], parche: ['PARCHE'] };

/**
 * Búsquedas finas para cuando la amplia llegó al tope de 25: el buscador de
 * la SRS busca por pedazo de texto («ODICA» trae todas las «SÓDICA» antes
 * que ODICA EXELTIS), así que se le suman palabras que sólo tiene el bueno.
 */
export function busquedasFinasDe(portal) {
    if (!portal.marca.length) return [];
    const marca = portal.marca.slice(0, 3).join(' ');
    const f = [...portal.fuerzas][0] ?? [...(portal.sueltos ?? [])][0];
    const formas = PALABRA_DE_FORMA[portal.forma] ?? [];
    const qs = [];
    if (f != null) qs.push(`${marca} ${f}`);
    for (const w of formas) qs.push(f != null ? `${marca} ${f} ${w}` : `${marca} ${w}`);
    if (portal.unidades) qs.push(`${marca} ${portal.unidades}`);
    if (f != null && portal.unidades) qs.push(`${marca} ${f} ${portal.unidades}`);
    if (portal.volumen) qs.push(`${marca} ${portal.volumen.n}`);
    return [...new Set(qs)];
}

/** Las búsquedas a hacer en el catálogo, de la más amplia a la más fina. */
export function busquedasDe(portal) {
    if (!portal.marca.length) return [];
    const marca = portal.marca.slice(0, 3).join(' ');
    const qs = [marca];
    const f = [...portal.fuerzas][0];
    if (f != null) qs.push(`${marca} ${f}`);
    if (portal.marca.length > 1) qs.push(portal.marca[0]);
    return qs.filter(q => q.length >= 3);
}

const alternativa = (j) => ({
    crp: j.fila.crp, n_registro: j.fila.n_registro, nombre_comercial: j.fila.nombre_comercial,
    presentacion: j.fila.presentacion, laboratorio: j.fila.laboratorio,
});

/**
 * Decide la pareja de un producto entre las filas del catálogo encontradas.
 * Devuelve la fila para `srs_mercado_cargar_propuestas`.
 */
export function decidir(producto, filasCatalogo) {
    const portal = analizarPortal(producto);
    const vistos = new Set();
    const juicios = [];
    for (const f of filasCatalogo ?? []) {
        if (!f?.crp || vistos.has(f.crp)) continue;
        vistos.add(f.crp);
        const j = juzgar(portal, f);
        if (j.marca) juicios.push(j);
    }
    juicios.sort((a, b) => b.puntos - a.puntos || String(a.fila.crp).localeCompare(String(b.fila.crp)));
    const base = { product_id: producto.product_id };
    if (!juicios.length) {
        return { ...base, crp: null, n_registro: null, nombre_srs: null, presentacion_srs: null, laboratorio_srs: null,
                 confianza: 'sin_pareja', alternativas: [] };
    }
    const [mejor, segundo] = juicios;
    let confianza;
    if (mejor.choques.length) confianza = 'baja';
    else {
        const fuerzaOk = mejor.fuerza === 'igual' || (mejor.fuerza === 'sin_dato');
        const empaqueOk = mejor.empaque === 'igual';
        // Otra opción sin choques con el mismo puntaje = no se puede distinguir.
        const empate = segundo && !segundo.choques.length && segundo.puntos >= mejor.puntos - 2;
        // Sin dato de empaque en el portal: sólo es «alta» si la marca tiene una sola presentación posible.
        const unica = juicios.filter(j => !j.choques.length).length === 1;
        // Tres dudas que impiden «alta» aunque no haya choque (revisión del
        // 2026-11-14: HELIOCARE protector solar → HELIOCARE cápsulas; FARCOLIT
        // 40 MG → «FARCOLIT COMPRIMIDOS» sin concentración):
        //   · el portal no dice el empaque (ni unidades ni volumen);
        //   · el portal dice la concentración y la SRS no la escribe;
        //   · la SRS tiene una palabra de variante que el portal no dice.
        const sinEmpaque = portal.unidades == null && !portal.volumen;
        const sinConcentracionSrs = portal.fuerzas.size > 0 && mejor.s.fuerzas.size === 0;
        const varianteSoloSrs = [...mejor.s.palabrasNombre].some(w => VARIANTE_EN_SRS.test(w) && !portal.nombre.includes(w.slice(0, 6)));
        const dudosa = sinEmpaque || sinConcentracionSrs || varianteSoloSrs;
        if ((fuerzaOk || unica) && (empaqueOk || unica) && !empate && !mejor.avisos.length && !dudosa) confianza = 'alta';
        else confianza = 'media';
    }
    return {
        ...base,
        crp: mejor.fila.crp, n_registro: mejor.fila.n_registro,
        nombre_srs: mejor.fila.nombre_comercial, presentacion_srs: mejor.fila.presentacion,
        laboratorio_srs: mejor.fila.laboratorio,
        confianza,
        alternativas: juicios.slice(1, 6).filter(j => !j.s.muestra).map(alternativa),
    };
}
