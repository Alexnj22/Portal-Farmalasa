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

// ── El aro avisa CINCO DÍAS ANTES, con la cuenta regresiva ────────────────
//
// Pedido del usuario: «para todos los últimos 5 días diga eso, un conteo,
// -5 -4 …». Su gemelo es `get_estados_de_personas`, que devuelve `faltan`; acá
// se arma la frase.
//
// Es un sustantivo aparte y no el rótulo de arriba porque «En vacaciones» sobre
// alguien que HOY está trabajando es sencillamente falso: la persona está, y lo
// que hay que decir es cuándo deja de estar. El color sí es el mismo — el aro
// ámbar significa «vacaciones», empezadas o no, y cambiarle el tono a la
// espera daría dos colores para una sola cosa.
const SUSTANTIVO = {
    VACATION:   'Vacaciones',
    DISABILITY: 'Incapacidad',
    SUPPORT:    'Apoyo',
    INDUCTION:  'Inducción',
    PERMIT:     'Permiso',
    SUSPENSION: 'Suspensión',
    AUSENTE:    'Ausencia',
};

// «Vacaciones en 3 días» · «Vacaciones mañana». El singular tiene su frase
// propia porque «en 1 día» se lee como un error de plantilla, no como mañana.
export function textoDeEspera(clave, faltan) {
    const nombre = SUSTANTIVO[clave] || 'Ausencia';
    return faltan === 1 ? `${nombre} mañana` : `${nombre} en ${faltan} días`;
}

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

// Cinco, igual que `v_aviso` en `get_estados_de_personas`. Los dos números son
// el mismo y por eso los dos llevan nombre.
const AVISO_DIAS = 5;

// Mediodía a propósito en las dos: restar fechas ISO a medianoche se corre un
// día con el cambio de horario, y este número decide si el chip dice «−3».
const sumarDias = (iso, n) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const diasHasta = (desde, hasta) => Math.max(0, Math.round(
    (new Date(`${hasta}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86400000));

// «Vuelve el 2 de septiembre», no «2026-09-02». La fecha cruda obliga a contar
// días con los dedos; lo que se necesita saber es si la persona está mañana.
//
// Sin el día de la semana a propósito: `es-SV` lo abrevia con coma —«mié, 2
// sept»— y dentro de la píldora eso se lee «vuelve el mié, 2 sept», con una
// coma que parte la frase justo donde no va. El mes largo entra igual y se lee
// como una fecha dicha en voz alta.
//
// ── Y la vuelta es el día SIGUIENTE al `endDate`, no el `endDate` ─────────
//
// `endDate` es el ÚLTIMO día de la ausencia, no el día que la persona vuelve.
// Lo dicen las tres piezas que lo escriben y lo leen, y todas coinciden entre
// sí: `FormNovedad` calcula `date + 14` para los 15 días continuos de una
// vacación y `date + días − 1` para una incapacidad —donde ya rotula «Regresa
// el endDate + 1»—, y el filtro de acá arriba (`fin(h) >= t`, igual que
// `get_estados_de_personas`) cuenta a la persona como ausente TODAVÍA el día
// del `endDate`.
//
// O sea que la única que leía `endDate` como fecha de regreso era esta función,
// y su rótulo —«vuelve el»— lo decía en voz alta un día antes: con la vacación
// terminando el 21, el aro anunciaba «vuelve el 21 de septiembre» sobre alguien
// que se reincorpora el 22. No falla nada y no hay fila de menos: sale una
// fecha bien formada, sólo que la equivocada.
export function fechaDeVuelta(iso) {
    if (!iso) return null;
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long' });
}

/**
 * El mismo estado, armado desde una CLAVE — lo que devuelve
 * `get_estados_de_personas`. La base manda `{clave, hasta}` y nada más; el
 * rótulo y el color se ponen acá para que la foto y el texto de al lado no
 * puedan decir cosas distintas.
 */
export function estadoDesdeClave(clave, hasta = null, faltan = 0) {
    if (!clave) return null;
    const n = Number(faltan) > 0 ? Number(faltan) : 0;
    if (clave === 'AUSENTE') {
        return { clave, ...ROTULO_AUSENTE, hasta: null, faltan: n,
                 ...(n ? { texto: textoDeEspera(clave, n) } : {}) };
    }
    const cfg = ROTULO_TEMPORAL[clave] || ROTULO_FIJO[clave];
    if (!cfg) return null;
    // Un estado FIJO (inactivo, liquidado) no tiene cuenta regresiva: ya es.
    const espera = n && ROTULO_TEMPORAL[clave];
    return { clave, ...cfg, hasta: fechaDeVuelta(hasta), faltan: espera ? n : 0,
             ...(espera ? { texto: textoDeEspera(clave, n) } : {}) };
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
    const tope = sumarDias(t, AVISO_DIAS);
    const fin = (h) => h.metadata?.endDate ?? h.endDate;
    // Misma ventana y mismo orden que `get_estados_de_personas`: lo que ya
    // empezó manda sobre lo que está por empezar. Los dos gemelos se mueven
    // juntos — si divergen, la foto y el texto de al lado dicen cosas
    // distintas y nadie puede decir cuál miente.
    const candidatos = (emp?.history || []).filter(h =>
        TEMPORALES.includes(h.type) &&
        h.date <= tope &&
        (fin(h) >= t || !fin(h))
    );
    const ev = candidatos.sort((a, b) =>
        (a.date > t) - (b.date > t) || b.date.localeCompare(a.date))[0];
    if (!ev) return null;

    const cfg = ROTULO_TEMPORAL[ev.type];
    if (!cfg) return null;
    return estadoDesdeClave(ev.type, fin(ev), diasHasta(t, ev.date));
}

/**
 * ¿Esta persona NO está hoy?
 *
 * Existe por culpa de la cuenta regresiva: desde que el aro avisa cinco días
 * antes, `estadoDePersona` devuelve algo para gente que SÍ está trabajando, y
 * los tres sitios que preguntaban `!!estadoDePersona(e)` empezarían a contar a
 * quien está presente como ausente — la lista «Activos» de Personal perdería a
 * alguien que está en la sala, y sin un error a la vista.
 *
 * Así que la pregunta «¿hay algo que decir?» y la pregunta «¿no está?» dejan de
 * ser la misma, y ésta lleva nombre propio.
 */
export function estaAusenteHoy(emp) {
    const e = estadoDePersona(emp);
    return !!e && !e.faltan;
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
