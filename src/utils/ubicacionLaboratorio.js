/**
 * Dónde está un laboratorio en una sala: en la sala (vitrina o estante, y su
 * peldaño) y en la bodega de la sala (estante y peldaño). Vivía en
 * `TabLaboratorios`; se mudó el 2026-10-05 para que la app lea y guarde igual.
 */

export const ubicacionVacia = () => ({ vitrina: '', estante: '', peldano: '', bodega_numero: '', bodega_peldano: '' });

export const tieneSala   = (d) => !!(d?.vitrina?.trim() || d?.estante?.trim() || d?.peldano?.trim());
export const tieneBodega = (d) => !!(d?.bodega_numero?.trim() || d?.bodega_peldano?.trim());
export const tieneUbicacion = (d) => tieneSala(d) || tieneBodega(d);

/** Los insumos empiezan con un número y lo cosmético con «Z»: así se nombran en el catálogo. */
export function seccionDeLaboratorio(nombre) {
    if (/^\d/.test(nombre || '')) return 'insumos';
    if (/^z/i.test(nombre || '')) return 'cosmeticos';
    return 'principales';
}

export const SECCIONES_DE_LABORATORIO = [
    { key: 'principales', label: 'Laboratorios principales' },
    { key: 'insumos',     label: 'Insumos' },
    { key: 'cosmeticos',  label: 'Cosméticos / Conveniencia' },
];

/** `{ sala, bodega }` en palabras, o `null` donde no hay nada. */
export function rotuloDeUbicacion(d) {
    const sala = tieneSala(d)
        ? [d.vitrina?.trim() ? `Vitrina ${d.vitrina.trim()}` : d.estante?.trim() ? `Estante ${d.estante.trim()}` : null, d.peldano?.trim() ? `peldaño ${d.peldano.trim()}` : null].filter(Boolean).join(' · ')
        : null;
    const bodega = tieneBodega(d)
        ? [d.bodega_numero?.trim() ? `Estante ${d.bodega_numero.trim()}` : null, d.bodega_peldano?.trim() ? `peldaño ${d.bodega_peldano.trim()}` : null].filter(Boolean).join(' · ')
        : null;
    return { sala, bodega };
}

/** La fila de `lab_locations` que se guarda: lo vacío viaja como `null`. */
export function filaDeUbicacion(labId, branchId, campos, ahora = new Date()) {
    const v = (x) => x?.trim() || null;
    return {
        lab_id: labId, branch_id: branchId,
        vitrina: v(campos.vitrina), estante: v(campos.estante), peldano: v(campos.peldano),
        bodega_numero: v(campos.bodega_numero), bodega_peldano: v(campos.bodega_peldano),
        updated_at: ahora.toISOString(),
    };
}
