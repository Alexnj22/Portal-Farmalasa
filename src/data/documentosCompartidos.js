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
    for (const e of empleados || []) {
        const completo = [e.first_names, e.last_names].filter(Boolean).join(' ').trim();
        for (const candidato of [completo, e.name]) {
            const clave = normalizarNombre(candidato);
            // El primero gana: si dos fichas normalizan igual, quedarse con la
            // segunda sería elegir por orden de carga. Se informa como duda.
            if (clave && !porClave.has(clave)) porClave.set(clave, e);
            else if (clave && porClave.get(clave)?.id !== e.id) porClave.set(clave, { ...porClave.get(clave), ambiguo: true });
        }
    }

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
            const ficha = porClave.get(normalizarNombre(nombre)) || null;
            return {
                nombre,
                empleado: ficha,
                // La ficha que está abierta ya lo tiene: mostrarla como
                // «pendiente de asignar» haría dudar de lo que se acaba de hacer.
                esLaAbierta: !!(ficha && excluir && ficha.id === excluir),
                ambiguo: !!ficha?.ambiguo,
            };
        });
}

/** Le escribe el documento a fichas que YA existen. */
export async function asignarDocumentoA(employeeIds, documento) {
    const { data, error } = await supabase.rpc('asignar_documento_a_empleados', {
        p_employee_ids: employeeIds,
        p_documento: documento,
    });
    if (error) return { ok: false, motivo: error.message };
    return data;
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
