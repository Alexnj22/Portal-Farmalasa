// La concentración de un principio activo, escrita SIEMPRE igual (2026-10-30).
//
// Medido ese día sobre las 1,138 filas de `product_active_principles`: la
// unidad venía escrita de quince formas — «mg.» 838, «g.» 127, «mg» 57,
// «mcg.» 35, «gr» 3, «mg/5 ml», «mg/2ml»… — y los nombres de 509 formas para
// 491 principios distintos. Con eso no se puede filtrar por molécula ni
// comparar dosis, y el texto del producto dice «500 mg.» con punto colgado.
//
// La regla: la concentración se separa en CANTIDAD (número, punto decimal) y
// UNIDAD (de una lista corta), y se guarda como «500 mg». El nombre va en
// mayúsculas con sus tildes, que es como ya está escrita la gran mayoría.
// Lo que no se entiende se deja como vino: normalizar no puede borrar un dato.

/** Las unidades que se ofrecen, en el orden en que se usan más. */
export const UNIDADES = ['mg', 'g', 'mcg', 'UI', '%', 'mL', 'mg/mL', 'mg/5 mL', 'mcg/mL', 'UI/mL', 'mg/g', 'g/100 g'];

// Cómo se escribe cada pedazo de unidad, en minúsculas → canónico.
const PIEZA = { mg: 'mg', g: 'g', gr: 'g', grs: 'g', mcg: 'mcg', ug: 'mcg', 'µg': 'mcg', 'μg': 'mcg', ml: 'mL', ui: 'UI', iu: 'UI', 'u.i': 'UI', '%': '%' };

function unaPieza(p) {
    // «5 ml», «5ml» o «ml» → «5 mL» / «mL»
    const m = /^(\d+(?:[.,]\d+)?)?\s*([^\d\s]+)$/.exec(p.trim());
    if (!m) return null;
    const u = PIEZA[m[2].toLowerCase().replace(/\.+$/, '')];
    if (!u) return null;
    return m[1] ? `${m[1].replace(',', '.')} ${u}` : u;
}

/** La unidad en su forma canónica, o `null` si no se reconoce. */
export function normalizarUnidad(texto) {
    const t = String(texto ?? '').trim().replace(/\.+$/, '');
    if (!t) return null;
    const partes = t.split('/');
    if (partes.length > 2) return null;
    const hechas = partes.map(unaPieza);
    return hechas.every(Boolean) ? hechas.join('/') : null;
}

/**
 * «500 mg.» → `{ cantidad: '500', unidad: 'mg' }`. Lo que no empieza con un
 * número, o tiene una unidad que no se reconoce, vuelve con `crudo` y nada más:
 * la pantalla lo muestra como está para que una persona decida.
 */
export function leerConcentracion(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return { cantidad: '', unidad: '', crudo: null };
    const m = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(t);
    if (!m) return { cantidad: '', unidad: '', crudo: t };
    const cantidad = m[1].replace(',', '.');
    if (!m[2].trim()) return { cantidad, unidad: '', crudo: null };
    const unidad = normalizarUnidad(m[2]);
    return unidad ? { cantidad, unidad, crudo: null } : { cantidad: '', unidad: '', crudo: t };
}

/** `{ cantidad, unidad }` → «500 mg». Sin cantidad no hay concentración. */
export function escribirConcentracion(cantidad, unidad) {
    const c = String(cantidad ?? '').trim().replace(',', '.');
    if (!c) return null;
    const u = String(unidad ?? '').trim();
    return u ? `${c} ${u}` : c;
}

/** Cualquier concentración escrita → su forma canónica (o como vino, si no se entiende). */
export function normalizarConcentracion(texto) {
    const t = String(texto ?? '').trim();
    if (!t) return null;
    const l = leerConcentracion(t);
    return l.crudo ?? escribirConcentracion(l.cantidad, l.unidad);
}

/** «  acetaminofén » → «ACETAMINOFÉN». Conserva las tildes. */
export function normalizarPrincipio(nombre) {
    return String(nombre ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

/** Clave para comparar dos nombres sin que una tilde los separe. */
export const claveDePrincipio = (nombre) =>
    normalizarPrincipio(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Las concentraciones que dice el NOMBRE del producto: «OMEPRAZOL 20 MG X 100
 * CAPS» → `['20 mg']`. Sirve para comparar contra el registro sanitario, que a
 * veces trae otro número (medido el 2026-10-30: F064815112006 se llama
 * «OMEPRAZOL SAIMED 20MG CAPSULAS» y su concentración dice «21 mg.»).
 */
export function concentracionesDelNombre(nombre) {
    const vistas = new Set();
    const re = /(\d+(?:[.,]\d+)?)\s*(mcg|mg|g|gr|ui|ml|%)(?![a-z])/gi;
    for (const m of String(nombre ?? '').matchAll(re)) {
        const c = normalizarConcentracion(`${m[1]} ${m[2]}`);
        if (c) vistas.add(c);
    }
    return [...vistas];
}

/**
 * Si el registro trae UN principio con un número que el nombre contradice
 * (y el nombre dice uno solo, de la misma unidad), la del nombre — que es lo
 * que dice el empaque. Si no, `null`: no hay contradicción que resolver.
 */
export function corregirConElNombre(concentracionSrs, nombre) {
    const srs = leerConcentracion(concentracionSrs);
    if (!srs.cantidad || !srs.unidad) return null;
    const delNombre = concentracionesDelNombre(nombre)
        .map(leerConcentracion).filter((c) => c.unidad === srs.unidad);
    if (delNombre.length !== 1 || delNombre[0].cantidad === srs.cantidad) return null;
    return escribirConcentracion(delNombre[0].cantidad, delNombre[0].unidad);
}
