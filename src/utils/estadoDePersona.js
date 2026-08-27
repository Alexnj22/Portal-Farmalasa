// ── ¿Esta persona está, y si no, hasta cuándo? ──────────────────────────────
//
// `getEffectiveStatus` (utils/helpers.js) devuelve el RÓTULO y nada más, y ese
// es justo el dato que le falta a quien mira: «En vacaciones» sin fecha no dice
// si la persona vuelve mañana o en dos semanas. El evento que lo causa ya está
// en `emp.history` con su `endDate` — sólo hay que devolverlo junto al rótulo.
//
// Vive acá y no dentro de una vista porque desde el 2026-08-26 lo consultan dos
// piezas que tienen que coincidir siempre: el aro de la foto
// (`AvatarConEstado`) y el chip de la tarjeta. Si divergieran, habría una foto
// con aro ámbar al lado de un texto que dice otra cosa — y nadie podría decir
// cuál de las dos miente.
//
// Devuelve `null` cuando la persona está activa, y eso NO es un descuido: la
// franja de estado sólo se pinta cuando hay algo que decir. Medido el
// 2026-08-26, `employee_events` tenía CUATRO filas en toda la tabla —3
// traslados y 1 ascenso—, así que un rótulo «Activo» se habría repetido 46
// veces. Una píldora que dice lo mismo en todas las tarjetas enseña a no
// mirarla, y el día que aparezca la primera vacación pasaría desapercibida
// entre las otras 45.

const TEMPORALES = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION'];

const ROTULO_TEMPORAL = {
    DISABILITY: { texto: 'Incapacitado',  variante: 'danger'  },
    VACATION:   { texto: 'En vacaciones', variante: 'warning' },
    SUPPORT:    { texto: 'En apoyo',      variante: 'chart-9' },
    INDUCTION:  { texto: 'En inducción',  variante: 'chart-6' },
    PERMIT:     { texto: 'Con permiso',   variante: 'chart-3' },
};

const ROTULO_FIJO = {
    INACTIVO:   { texto: 'Inactivo',   variante: 'neutral' },
    BAJA:       { texto: 'Inactivo',   variante: 'neutral' },
    LIQUIDADO:  { texto: 'Liquidado',  variante: 'danger'  },
    SUSPENDIDO: { texto: 'Suspendido', variante: 'danger'  },
};

const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// «Vuelve el 2 de septiembre», no «2026-09-02». La fecha cruda obliga a contar
// días con los dedos; lo que se necesita saber es si la persona está mañana.
//
// Sin el día de la semana a propósito: `es-SV` lo abrevia con coma —«mié, 2
// sept»— y dentro de la píldora eso se lee «vuelve el mié, 2 sept», con una
// coma que parte la frase justo donde no va. El mes largo entra igual y se lee
// como una fecha dicha en voz alta.
export function fechaDeVuelta(iso) {
    if (!iso) return null;
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long' });
}

/**
 * `null` si la persona está activa. Si no:
 * `{ clave, texto, variante, hasta }` — `hasta` ya viene formateado, o `null`
 * cuando el evento no tiene fecha de fin (un permiso abierto, por ejemplo).
 */
export function estadoDePersona(emp) {
    const fijo = ROTULO_FIJO[String(emp?.status || '').toUpperCase()];
    if (fijo) return { clave: String(emp.status).toUpperCase(), ...fijo, hasta: null };

    const t = hoyISO();
    const ev = (emp?.history || []).find(h =>
        TEMPORALES.includes(h.type) &&
        h.date <= t &&
        ((h.metadata?.endDate ?? h.endDate) >= t || !(h.metadata?.endDate ?? h.endDate))
    );
    if (!ev) return null;

    const cfg = ROTULO_TEMPORAL[ev.type];
    if (!cfg) return null;
    return { clave: ev.type, ...cfg, hasta: fechaDeVuelta(ev.metadata?.endDate ?? ev.endDate) };
}
