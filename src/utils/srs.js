/**
 * Un resultado del registro sanitario (SRS) leído igual en el portal
 * (`SrsBuscadorWidget`) y en la app (principios activos). El intermediario
 * devuelve campos con nombres que cambian de un registro a otro y, a veces,
 * basura binaria de lectores de código de barras: se limpia acá, una vez.
 *
 * Mudado del widget del portal el 2026-10-15.
 */

/** Texto limpio: sin caracteres de control, del área privada ni «especiales». */
export function limpiarDeSrs(v) {
    if (v == null) return '';
    const s = typeof v === 'object'
        ? String(v.nombre ?? v.name ?? v.value ?? '')
        : String(v);
    // `new RegExp()` para que el compilador no intente leer los caracteres suplementarios.
    return s
        // eslint-disable-next-line no-control-regex -- intencional: limpia basura binaria/PUA de lectores de código de barras
        .replace(new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF\uFFF0-\uFFFF]', 'g'), '')
        .replace(/\u00A0/g, ' ')
        .trim();
}

/**
 * `{ activo, estatus, nombre, lab, forma, principio, conc, noregistro, inscripcion }`
 * de un resultado crudo. `inscripcion` es la fecha tal cual (o `null`).
 */
export function resultadoDeSrs(p) {
    const estatus = limpiarDeSrs(p?.estatus ?? p?.Activo ?? '');
    return {
        estatus,
        activo: estatus === 'A',
        nombre: limpiarDeSrs(p?.nombre_comercial ?? p?.nombreComercial ?? ''),
        lab: limpiarDeSrs(p?.laboratorio ?? ''),
        forma: limpiarDeSrs(p?.NOMBRE_FORMA_FARMACEUTICA ?? ''),
        principio: limpiarDeSrs(p?.principio_activo ?? p?.formula ?? ''),
        conc: limpiarDeSrs(p?.concentracion ?? ''),
        noregistro: limpiarDeSrs(p?.noregistro ?? ''),
        inscripcion: p?.FECHA_INSCRIPCION ?? null,
    };
}
