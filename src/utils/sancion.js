// Las reglas del formulario de una sanción (Art. 83 del Reglamento Interno),
// escritas una vez para el portal (`SancionModal`) y la app
// (`app/empleado/sancion.js`). La escalera y el registro los decide la base
// (`escalera_disciplinaria`, `registrar_sancion`).

/** Peldaños 3 y 4: suspensión sin goce de salario. */
export const esSuspension = (peldano) => peldano === 3 || peldano === 4;

/** Los días que pide cada peldaño cuando se elige: el 3 es un día; el 4, dos o más. */
export function diasAlElegir(peldano, diasActuales) {
    if (peldano === 3) return '1';
    if (peldano === 4 && (diasActuales === '1' || diasActuales === '' || diasActuales == null)) return '2';
    return diasActuales;
}

/** El último día de la suspensión (AAAA-MM-DD), o null si no es suspensión. */
export function hastaDeLaSuspension(peldano, fecha, dias) {
    if (!esSuspension(peldano) || !fecha) return null;
    const n = Math.max(1, Number(dias) || 1);
    const d = new Date(`${fecha}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + n - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ¿Se puede guardar? El peldaño 4 exige 2 a 30 días y la autorización de Inspección de Trabajo. */
export function sancionCompleta({ falta, peldano, fecha, dias, autorizacion }) {
    if (!falta || !peldano || !fecha) return false;
    if (peldano === 4) {
        const n = Number(dias);
        if (!Number.isFinite(n) || n < 2 || n > 30) return false;
        if (!String(autorizacion || '').trim()) return false;
    }
    return true;
}

/** El código que va impreso en la constancia: `S-AAAA-XXXXXX`. */
export const codigoDeSancion = (eventoId, fecha) => (eventoId
    ? `S-${String(fecha).slice(0, 4)}-${String(eventoId).replace(/-/g, '').slice(0, 6).toUpperCase()}`
    : null);

/** Lo que dice el aviso de antecedentes, antes de elegir el peldaño. */
export function motivoDeLaPropuesta(escalera, fechaLarga = (x) => x) {
    if (!escalera) return null;
    let t = escalera.faltas_en_60_dias > 0
        ? `${escalera.faltas_en_60_dias} falta(s) en los últimos 60 días. El Art. 83 permite subir de peldaño por reincidencia.`
        : escalera.verbales_misma_causa > 0
            ? `${escalera.verbales_misma_causa} amonestación(es) verbal(es) por esta misma causa. El num. 2 permite pasar a la escrita.`
            : 'Sin antecedentes que habiliten subir de peldaño.';
    if (escalera.rectificado_el) t += ` Se cuenta desde el memorando del Art. 86 del ${fechaLarga(escalera.rectificado_el)}.`;
    return t;
}
