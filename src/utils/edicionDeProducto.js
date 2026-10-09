// Editar la ficha de un producto del catálogo: sus principios activos y sus
// ubicaciones por sala. Vivía dentro de `TabCatalogo` (portal); sale al núcleo
// para que el teléfono escriba EXACTAMENTE las mismas filas.

/** Los dos valores que no son un principio activo sino una respuesta. */
export const PRINCIPIO_PRESETS = ['Insumo', 'No aplica'];

/** De lo guardado al editor: `{ preset, items }`. */
export function editorDePrincipios(guardados = []) {
    if (guardados.length === 1 && PRINCIPIO_PRESETS.includes(guardados[0]?.nombre) && !guardados[0]?.concentracion) {
        return { preset: guardados[0].nombre, items: [] };
    }
    if (guardados.length) return { preset: null, items: guardados.map((p, i) => ({ ...p, _key: p.id ?? i })) };
    return { preset: null, items: [{ nombre: '', concentracion: '', orden: 0, _key: 0 }] };
}

/**
 * Lo que se guarda: las filas de `product_active_principles` y el texto de
 * `products.principio_activo` («Amoxicilina 500mg, Ácido clavulánico 125mg»).
 */
export function principiosParaGuardar(productId, { preset = null, items = [] } = {}) {
    if (preset) return { rows: [{ product_id: productId, nombre: preset, concentracion: null, orden: 0 }], text: preset, saved: [{ nombre: preset }] };
    const toSave = items.filter(p => (p.nombre ?? '').trim());
    const rows = toSave.map((p, i) => ({
        product_id: productId, nombre: p.nombre.trim(), concentracion: p.concentracion?.trim() || null, orden: i,
    }));
    const text = toSave.length
        ? toSave.map(p => [p.nombre.trim(), p.concentracion?.trim()].filter(Boolean).join(' ')).join(', ')
        : null;
    return { rows, text, saved: toSave };
}

/** Las salas que llevan ubicación: farmacias y bodega. */
export const salasConUbicacion = (branches = []) => branches.filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));

/** La grilla editable: una fila por sala, con lo guardado (vitrina o estante, peldaño, bodega interna). */
export function ubicacionesEditables(branches = [], guardadas = []) {
    return salasConUbicacion(branches).map(b => {
        const s = guardadas.find(l => l.branch_id === b.id);
        return {
            branch_id: b.id, branch_name: b.name, branch_type: b.type,
            tipo: s?.estante ? 'estante' : 'vitrina',
            numero: s?.estante || s?.vitrina || '',
            peldano: s?.peldano || '',
            bodega_numero: s?.bodega_numero || '',
            bodega_peldano: s?.bodega_peldano || '',
            view: 'sala',
        };
    });
}

const conDatos = (l) => String(l.numero).trim() || String(l.peldano).trim() || String(l.bodega_numero).trim() || String(l.bodega_peldano).trim();

/** Las filas a escribir y las salas a borrar (las que quedaron vacías). */
export function ubicacionesParaGuardar(productId, locs = []) {
    return {
        toUpsert: locs.filter(conDatos).map(l => ({
            product_id: productId, branch_id: l.branch_id,
            vitrina: l.tipo === 'vitrina' ? (String(l.numero).trim() || null) : null,
            estante: l.tipo === 'estante' ? (String(l.numero).trim() || null) : null,
            peldano: String(l.peldano).trim() || null,
            bodega_numero: String(l.bodega_numero).trim() || null,
            bodega_peldano: String(l.bodega_peldano).trim() || null,
            updated_at: new Date().toISOString(),
        })),
        toDelete: locs.filter(l => !conDatos(l)).map(l => l.branch_id),
    };
}
