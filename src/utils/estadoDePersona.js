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

// `SUSPENSION` es el sexto, y su gemelo es la lista de `get_estados_de_personas`
// en la base: las dos se mueven juntas. Una suspensión del RIT Art. 83 tiene
// fechas igual que una vacación, así que se deriva por este camino y NO
// poniendo `employees.status = 'SUSPENDIDO'` — ese interruptor lo filtran 65
// funciones de Postgres a la vez (`nombre_de_vendedor` entre ellas: las ventas
// ya hechas perderían el nombre) y además no tiene fecha, así que una
// suspensión de un día no volvería sola.
const TEMPORALES = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION', 'SUSPENSION'];

const ROTULO_TEMPORAL = {
    DISABILITY: { texto: 'Incapacitado',  variante: 'danger'  },
    VACATION:   { texto: 'En vacaciones', variante: 'warning' },
    SUPPORT:    { texto: 'En apoyo',      variante: 'chart-9' },
    INDUCTION:  { texto: 'En inducción',  variante: 'chart-6' },
    PERMIT:     { texto: 'Con permiso',   variante: 'chart-3' },
    // Rojo como incapacidad y no ámbar como vacaciones: las dos primeras son
    // ausencias previstas y ésta es una sanción. Que se distingan importa —
    // quien mira la sala tiene que poder ver la diferencia sin abrir la ficha.
    SUSPENSION: { texto: 'Suspendido',    variante: 'danger'  },
};

// «No está» y nada más. Es lo que recibe quien no tiene permiso para leer los
// eventos de los demás: sabe que esa persona no está —que es lo que necesita
// para no confundirla con alguien presente— y no se entera de si es una
// vacación o una incapacidad. Su color es propio y no se repite en los otros
// cinco: si reusara el ámbar de vacaciones, dos cosas distintas se verían igual.
const ROTULO_AUSENTE = { texto: 'No está hoy', variante: 'chart-1' };

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
 * El mismo estado, armado desde una CLAVE — lo que devuelve
 * `get_estados_de_personas`. La base manda `{clave, hasta}` y nada más; el
 * rótulo y el color se ponen acá para que la foto y el texto de al lado no
 * puedan decir cosas distintas.
 */
export function estadoDesdeClave(clave, hasta = null) {
    if (!clave) return null;
    if (clave === 'AUSENTE') return { clave, ...ROTULO_AUSENTE, hasta: null };
    const cfg = ROTULO_TEMPORAL[clave] || ROTULO_FIJO[clave];
    if (!cfg) return null;
    return { clave, ...cfg, hasta: fechaDeVuelta(hasta) };
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

// ── Una persona, venga como venga ──────────────────────────────────────────
//
// El portal muestra a la misma gente con al menos SEIS formas distintas de
// objeto, según de qué consulta salga: `{name, photo, photo_url}` del store,
// `{nombre, foto}` de las bolsas, `{empleado, foto, persona_id}` de un RPC de
// conexiones, `{created_by_name, created_by_photo}` de cotizaciones,
// `{first_names, last_names}` de ventas, `{nombre, photo_url}` de un evento.
//
// Mientras cada pantalla armaba su `<LiquidAvatar>` a mano eso no molestaba:
// cada una sabía su forma. Al volver la foto un canónico —decisión del usuario
// el 2026-08-26, «todo lugar que muestre quién lo hizo debe llevar foto, y por
// lo tanto aro»— el canónico tiene que aceptar las seis, o migrar veintiún
// archivos sería reescribir veintiún objetos a mano y garantizar que el
// veintidós se olvide.
//
// El `id` es lo que más importa: con él, el aro se resuelve contra el store
// aunque el objeto no traiga historial. Sin él no hay aro, y eso es correcto —
// no se puede afirmar el estado de alguien que no se sabe quién es.
export function normalizarPersona(p) {
    if (!p) return null;
    const nombreCompuesto = [p.first_names, p.last_names].filter(Boolean).join(' ').trim();
    return {
        id: p.id ?? p.employee_id ?? p.persona_id ?? p.empleado_id ?? null,
        name: p.name ?? p.nombre ?? p.empleado ?? p.created_by_name ?? nombreCompuesto ?? null,
        photo: p.photo ?? p.foto ?? p.created_by_photo ?? p.photo_url ?? null,
        photo_url: p.photo_url ?? null,
        first_names: p.first_names,
        last_names: p.last_names,
        status: p.status,
        // `undefined` y no `[]` a propósito: `[]` significa «esta persona no
        // tiene eventos» y apagaría la búsqueda contra el store, que es
        // justamente lo que salva a los objetos que no traen historial.
        history: Array.isArray(p.history) ? p.history : undefined,
    };
}
