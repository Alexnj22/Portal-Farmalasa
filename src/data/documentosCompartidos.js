/**
 * Un documento que nombra a VARIAS personas.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * El acuse sellado del Ministerio de Trabajo por una recontratación no es un
 * papel por persona: el Ministerio devuelve UNO con la lista de todos. El
 * portal sólo sabía adjuntar un documento a la ficha abierta, así que ese mismo
 * papel había que subirlo una vez por cada quien —buscando la ficha a mano— y
 * nada decía a quiénes cubre.
 *
 * Pedido del usuario (2026-08-28): «ese documento no es personal… que al
 * subirse detecte el listado de nombres, y al crearlos lo asigne de un solo, o
 * lo asigne si ya fue creado el empleado».
 *
 * ── Dos casos, dos caminos ──────────────────────────────────────────────────
 *
 *  · La persona YA tiene ficha  → se le escribe ahora (`asignarDocumentoA`).
 *  · Todavía NO                 → el documento espera por su nombre
 *    (`dejarPendiente`) y se aplica solo cuando la ficha nace
 *    (`aplicarPendientes`, que llama el alta).
 *
 * ── Por qué el archivo NO se copia ──────────────────────────────────────────
 *
 * Se sube UNA vez y las fichas comparten su dirección. Copiarlo daría N
 * archivos que después divergen —uno se reemplaza y los otros no— y ninguno
 * sería «el acuse»: serían copias parecidas.
 */
import { supabase } from '../supabaseClient';

/* ── El nombre, comparable ──────────────────────────────────────────────────
 *
 * ⚠️ ESTA FUNCIÓN TIENE UNA GEMELA EN LA BASE: `public.nombre_normalizado`.
 * Las dos deciden lo mismo —si el nombre leído de un papel es el de una ficha—
 * y una sola que cambie parte el circuito en silencio: el navegador diría «ya
 * tiene ficha» y la base guardaría el pendiente igual, o al revés. Es
 * exactamente lo que enseñó `turno_del_dia`, y por eso las dos se enfrentan en
 * `tests/unit/documentosCompartidos.test.js` sobre los mismos casos.
 *
 * Lo que hace: quita tildes, deja sólo letras, pasa a mayúsculas y colapsa los
 * espacios. Un nombre leído de un papel nunca coincide carácter por carácter
 * con el de la ficha — sobra un espacio, falta una tilde, viene con un punto. */
export function normalizarNombre(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z]+/g, ' ')
        .trim();
}

/* La misma clave con las palabras ordenadas. GEMELA de `public.nombre_ordenado`.
 *
 * El acuse del Ministerio lista a la gente con los APELLIDOS primero
 * («GARCIA ZELAYA JENNIFER LISSETH») y la ficha guarda nombres + apellidos: con
 * la clave exacta no cruzaba nadie. Se usa sólo cuando la exacta no encontró —
 * con dos fichas que se distinguen por el orden, gana la exacta—. Orden por
 * código de carácter, igual que `COLLATE "C"` en la base. */
export function ordenarNombre(texto) {
    const clave = normalizarNombre(texto);
    return clave ? clave.split(' ').sort().join(' ') : '';
}

/**
 * Cruza los nombres leídos del documento contra el padrón que ya está cargado.
 *
 * Devuelve una fila por nombre leído, con la ficha si la encontró. NO decide
 * nada: quien decide es la persona que está mirando la pantalla — un documento
 * asignado a quien no corresponde es una prueba en el expediente equivocado, y
 * eso no se arregla con un `undo`.
 *
 * @param {string[]} nombres    lo que dijo el documento
 * @param {Array}    empleados  el padrón (con `id`, `name`, `first_names`, `last_names`)
 * @param {string}   [excluir]  id de la ficha que ya tiene el documento (la abierta)
 */
export function cruzarConElPadron(nombres, empleados, excluir = null) {
    const porClave = new Map();
    const porOrden = new Map();
    // El primero gana: si dos fichas normalizan igual, quedarse con la segunda
    // sería elegir por orden de carga. Se informa como duda.
    const anotar = (mapa, clave, e) => {
        if (!clave) return;
        if (!mapa.has(clave)) mapa.set(clave, e);
        else if (mapa.get(clave)?.id !== e.id) mapa.set(clave, { ...mapa.get(clave), ambiguo: true });
    };
    for (const e of empleados || []) {
        const completo = [e.first_names, e.last_names].filter(Boolean).join(' ').trim();
        for (const candidato of [completo, e.name]) {
            anotar(porClave, normalizarNombre(candidato), e);
            anotar(porOrden, ordenarNombre(candidato), e);
        }
    }

    /* Lo que no cruzó exacto puede ser la misma persona con MENOS nombres en la
     * ficha: el acuse dice «RONALDO JAVIER RECINOS LOPEZ» y la ficha «RONALDO
     * RECINOS» (2026-10-14 — el acuse quedó en espera de una ficha que ya
     * existía). Se propone la ficha cuyas palabras están TODAS en el papel, con
     * al menos dos, y sólo si es una: con dos candidatas no hay propuesta, hay
     * que elegir. Nunca se asigna sola — es `posible`, no `empleado`. */
    const palabrasDe = new Map();
    for (const e of empleados || []) {
        const completo = [e.first_names, e.last_names].filter(Boolean).join(' ').trim();
        const juegos = [completo, e.name]
            .map(c => normalizarNombre(c).split(' ').filter(Boolean))
            .filter(ws => ws.length >= 2);
        if (juegos.length) palabrasDe.set(e.id, { e, juegos });
    }
    const posibleDe = (nombre) => {
        const delPapel = new Set(normalizarNombre(nombre).split(' '));
        const hallados = [];
        for (const { e, juegos } of palabrasDe.values()) {
            if (juegos.some(ws => ws.every(w => delPapel.has(w)))) hallados.push(e);
        }
        return hallados.length === 1 ? hallados[0] : null;
    };

    const vistos = new Set();
    return (nombres || [])
        .map(n => String(n || '').trim())
        .filter(n => {
            const clave = normalizarNombre(n);
            if (!clave || vistos.has(clave)) return false;   // el mismo nombre dos veces
            vistos.add(clave);
            return true;
        })
        .map(nombre => {
            const ficha = porClave.get(normalizarNombre(nombre))
                || porOrden.get(ordenarNombre(nombre)) || null;
            const posible = ficha ? null : posibleDe(nombre);
            return {
                nombre,
                empleado: ficha,
                posible: posible && !(excluir && posible.id === excluir) ? posible : null,
                // La ficha que está abierta ya lo tiene: mostrarla como
                // «pendiente de asignar» haría dudar de lo que se acaba de hacer.
                esLaAbierta: !!(ficha && excluir && ficha.id === excluir),
                ambiguo: !!ficha?.ambiguo,
            };
        });
}

/**
 * Las fichas activas a las que les falta un documento de esa categoría.
 *
 * Es el selector del diálogo para el nombre que no cruzó: si el papel nombra a
 * alguien que sí tiene ficha pero con otro nombre, su ficha está en esta lista
 * —y quien ya tiene el documento no, porque el reparto no lo pisaría—. Son ~50
 * fichas: no necesita paginar.
 */
export async function fichasSinDocumento(categoria) {
    const { data, error } = await supabase.from('employees')
        .select('id, name, first_names, last_names, employee_documents')
        .eq('status', 'ACTIVO')
        .order('name');
    if (error) throw error;
    return (data || [])
        .filter(e => {
            /** @type {Array<{ category?: string, url?: string }>} */
            const docs = Array.isArray(e.employee_documents) ? /** @type {any} */ (e.employee_documents) : [];
            return !docs.some(d => d?.category === categoria && d?.url);
        })
        .map(e => ({ id: e.id, name: e.name, first_names: e.first_names, last_names: e.last_names }));
}

/** Le escribe el documento a fichas que YA existen. */
export async function asignarDocumentoA(employeeIds, documento) {
    const { data, error } = await supabase.rpc('asignar_documento_a_empleados', {
        p_employee_ids: employeeIds,
        p_documento: documento,
    });
    if (error) return { ok: false, motivo: error.message };
    return /** @type {{ ok?: boolean, motivo?: string, asignados?: any[], omitidos?: any[] } | null} */ (data);
}

/** Deja el documento esperando a una ficha que todavía no existe. */
export async function dejarPendiente(nombre, documento) {
    const { data, error } = await supabase.rpc('dejar_documento_pendiente', {
        p_nombre: nombre,
        p_documento: documento,
    });
    if (error) return { ok: false, motivo: error.message };
    return { ok: true, id: data };
}

/**
 * El reparto que confirmó quien mira: a las fichas que existen se les escribe
 * ahora y los nombres sin ficha quedan en espera. Lo usan el diálogo del
 * portal (`AsignarDocumentoAVarios`) y la app del personal.
 *
 * Lanza si algo no se pudo: quien decidió tiene que poder reintentar sin volver
 * a subir el documento, y reintentar es seguro (asignar no pisa y el pendiente
 * no se duplica). Un pendiente que no se pudo dejar se DICE: antes se
 * descartaba y el diálogo cerraba con «Sin cambios» en verde (2026-10-13).
 *
 * @param {Array<string|number>} employeeIds  fichas que ya existen (sin repetir)
 * @param {string[]} nombresEnEspera           los del papel que no tienen ficha
 * @param {object} documento                   la entrada de `employee_documents`
 * @returns {Promise<{ asignados: number, pendientes: number, omitidos: Array }>}
 */
export async function repartirDocumento(employeeIds, nombresEnEspera, documento) {
    let asignados = 0;
    let omitidos = [];
    const ids = [...new Set(employeeIds || [])];
    if (ids.length) {
        const r = await asignarDocumentoA(ids, documento);
        if (r?.ok === false) throw new Error(r.motivo || 'No se pudo asignar.');
        asignados = (r?.asignados || []).length;
        omitidos = r?.omitidos || [];
    }
    let pendientes = 0;
    const sinDejar = [];
    for (const nombre of nombresEnEspera || []) {
        const r = await dejarPendiente(nombre, documento);
        if (r?.ok) pendientes += 1; else sinDejar.push({ nombre, motivo: r?.motivo });
    }
    if (sinDejar.length) {
        throw new Error(`No se pudo dejar en espera a ${sinDejar.map(x => x.nombre).join(', ')}`
            + ` (${sinDejar[0].motivo || 'sin motivo'}).`);
    }
    return { asignados, pendientes, omitidos };
}

/** El aviso de un fallo del reparto, en palabras de quien lo usa. */
export const mensajeDelReparto = (e) => {
    const msg = e?.message || 'No se pudo asignar el documento.';
    return /FORBIDDEN/.test(msg) ? 'Hace falta permiso de edición en Personal para repartir el documento.' : msg;
};

/**
 * Los que estaban esperando a esta persona.
 *
 * Lo llama el alta DESPUÉS de guardar los documentos del formulario, y no un
 * trigger: el alta inserta la fila y enseguida reescribe `employee_documents`
 * con la lista del formulario, así que lo que hubiera puesto un trigger se
 * perdería en ese segundo paso.
 *
 * Nunca lanza: que un pendiente no se pudo aplicar no puede tumbar un alta que
 * ya terminó bien — es la lección del PDF de bienvenida, donde una función que
 * faltaba hacía decir «no se pudo guardar la ficha» con el empleado ya creado.
 */
export async function aplicarPendientes(employeeId) {
    try {
        const { data, error } = await supabase.rpc('aplicar_documentos_pendientes', {
            p_employee_id: employeeId,
        });
        if (error) { console.warn('aplicarPendientes:', error.message); return { ok: false, puestos: [] }; }
        return data || { ok: true, puestos: [] };
    } catch (e) {
        console.warn('aplicarPendientes:', e?.message || e);
        return { ok: false, puestos: [] };
    }
}
