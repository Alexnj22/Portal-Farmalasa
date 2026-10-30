// Nombre corto del portal: UN nombre + UN apellido, aunque el empleado tenga
// 2-3 nombres o 2-3 apellidos. Cuál de ellos lo elige la persona al entrar al
// portal (2026-10-30, `employees.nombre_preferido`/`apellido_preferido`); si no
// eligió, el primero de cada uno.
//
// Es el nombre que va en TODA la interfaz —sidebar, solicitudes, tarjetas,
// calendarios, chips, avatares, modales—. Las dos excepciones son el módulo de
// Personal (el listado y la ficha del empleado, donde el nombre completo ES el
// dato) y todo lo que SALE del portal: CSV, planilla, contratos y PDFs llevan el
// nombre legal completo. Motivo del corto: un nombre de 4 palabras desborda los
// contenedores angostos —en el sidebar empujaba el botón de cerrar sesión fuera
// de su fila— y ningún truncado lo arregla sin dejar el nombre a medias.
//
// Fuente confiable: `first_names`/`last_names`, columnas SEPARADAS en employees
// (obligatorias desde el alta). `employees.name` es una columna GENERADA
// (`first_names || ' ' || last_names`), así que partir ese texto es adivinar
// dónde estaba la frontera: con 3 palabras es ambiguo —"ANA PEREZ LOPEZ" puede
// ser 1 nombre + 2 apellidos o 2 nombres + 1 apellido— y hoy en prod hay
// empleados de las dos formas. Por eso el heurístico es SOLO el último recurso:
// si la fila que estás pintando no trae first_names/last_names, agregalos al
// `select` en vez de confiar en el corte.
const primerToken = (str) => String(str || '').trim().split(/\s+/)[0] || '';

// Las partículas no son un nombre por sí solas: «DE LA CRUZ» es UN apellido y
// «MARIA DE LOS ANGELES» son dos nombres, no cuatro. Se pegan a la palabra que
// sigue.
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'Y', 'VDA', 'VDA.']);

const normalizar = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Los nombres (o apellidos) de una persona, uno por elemento, con las
 * partículas pegadas a la palabra que sigue. Es la lista de la que la persona
 * elige cuál usar en el portal.
 * @param {string} str `first_names` o `last_names` de la ficha.
 * @returns {string[]}
 */
export function gruposDeNombre(str) {
    const grupos = [];
    let pendiente = [];
    for (const palabra of String(str || '').trim().split(/\s+/).filter(Boolean)) {
        pendiente.push(palabra);
        if (!PARTICULAS.has(normalizar(palabra))) { grupos.push(pendiente.join(' ')); pendiente = []; }
    }
    if (pendiente.length) {
        // Partículas al final («LOPEZ DE»): van con el grupo anterior.
        if (grupos.length) grupos[grupos.length - 1] += ' ' + pendiente.join(' ');
        else grupos.push(pendiente.join(' '));
    }
    return grupos;
}


// Lo elegido, escrito COMO EN LA FICHA: si eligió «NUNEZ» y después la ficha
// se corrigió a «NÚÑEZ», se muestra «NÚÑEZ». Por palabras enteras y sin tildes,
// igual que `es_parte_del_nombre` en la base. `null` si Personal corrigió la
// ficha y lo elegido ya no está: el portal vuelve solo al primero en vez de
// mostrar un nombre que la persona ya no tiene.
function comoEnLaFicha(parte, completo) {
    const p = normalizar(parte);
    if (!p) return null;
    const palabras = String(completo || '').trim().split(/\s+/).filter(Boolean);
    const n = p.split(' ').length;
    for (let i = 0; i + n <= palabras.length; i++) {
        const ventana = palabras.slice(i, i + n).join(' ');
        if (normalizar(ventana) === p) return ventana;
    }
    return null;
}

// ¿Tiene algo que elegir? Con un solo nombre y un solo apellido no hay pregunta.
export const tieneNombreQueElegir = (emp) =>
    !!emp && (gruposDeNombre(emp.first_names).length > 1 || gruposDeNombre(emp.last_names).length > 1);

// El nombre corto a partir de las columnas de la ficha.
function cortoDesdeFicha(emp) {
    const nombres = gruposDeNombre(emp.first_names);
    const apellidos = gruposDeNombre(emp.last_names);
    const first = comoEnLaFicha(emp.nombre_preferido, emp.first_names) || nombres[0] || '';
    const last = comoEnLaFicha(emp.apellido_preferido, emp.last_names) || apellidos[0] || '';
    return `${first} ${last}`.trim();
}

// ── El nombre ELEGIDO viaja por un registro, no por cada `select` ──────────
// Son ~555 llamadas a `shortEmployeeName` y muchas pintan filas de otras tablas
// que traen sólo `id` + `name` (o el nombre guardado como texto). Agregar las
// columnas nuevas a cada consulta sería imposible de mantener, así que el store
// registra acá el nombre corto de cada ficha que carga (`staffStore`), y
// cualquier objeto que traiga el `id` de la persona —o su nombre completo— sale
// con el elegido.
const cortoPorId = new Map();
const cortoPorNombre = new Map();

/** Lo llama el store cada vez que cambia la lista de empleados. */
export function registrarNombresElegidos(employees) {
    cortoPorId.clear();
    cortoPorNombre.clear();
    for (const e of employees || []) {
        if (!e?.id || (!e.first_names && !e.last_names)) continue;
        const corto = cortoDesdeFicha(e);
        if (!corto) continue;
        cortoPorId.set(String(e.id), corto);
        cortoPorNombre.set(normalizar(`${e.first_names || ''} ${e.last_names || ''}`), corto);
    }
}

/**
 * @param {object|string|null} emp Empleado (`{ first_names, last_names, name }`)
 *   o directamente su nombre completo ya concatenado.
 * @returns {string} El nombre y el apellido que la persona eligió (por defecto
 *   el primero de cada uno), o 'Personal' si no hay dato.
 */
export function shortEmployeeName(emp) {
    if (!emp) return 'Personal';

    if (typeof emp === 'string') return shortEmployeeName({ name: emp });

    // La fila trae la elección: manda ella (es la más fresca, p. ej. justo
    // después de guardarla).
    if ((emp.first_names || emp.last_names) && (emp.nombre_preferido || emp.apellido_preferido)) {
        return cortoDesdeFicha(emp);
    }

    // La base lo guarda ya resuelto (`employees.nombre_corto`, lo mantiene un
    // trigger con `nombre_corto_con_eleccion`, el gemelo de esta regla): las
    // filas que llegan de una RPC lo traen hecho.
    if (emp.nombre_corto) return String(emp.nombre_corto);

    const porId = emp.id != null ? cortoPorId.get(String(emp.id)) : undefined;
    if (porId) return porId;

    const completo = emp.first_names || emp.last_names
        ? `${emp.first_names || ''} ${emp.last_names || ''}` : emp.name;
    const porNombre = completo ? cortoPorNombre.get(normalizar(completo)) : undefined;
    if (porNombre) return porNombre;

    if (emp.first_names || emp.last_names) return cortoDesdeFicha(emp);

    // Fallback: sólo hay el nombre concatenado (filas legadas, nombres guardados
    // como texto en otra tabla, o un `select` al que le faltan las dos columnas).
    const fullName = String(emp.name || '').trim();
    if (!fullName) return 'Personal';
    const parts = fullName.split(/\s+/);
    if (parts.length <= 2) return parts.join(' ');
    return `${parts[0]} ${parts[2]}`;
}

/**
 * Iniciales para avatares sin foto. Mismo criterio que el nombre corto: la
 * inicial del primer nombre y la del primer apellido.
 */
export function employeeInitials(emp) {
    const short = shortEmployeeName(emp);
    if (short === 'Personal') return '?';
    // La primera palabra y la última que no sea partícula: «ANA DE LA CRUZ» es
    // «AC», no «AD».
    const palabras = short.split(/\s+/).filter(p => !PARTICULAS.has(normalizar(p)));
    const usadas = palabras.length > 1 ? [palabras[0], palabras[palabras.length - 1]] : palabras;
    return usadas.map(t => t.charAt(0).toUpperCase()).join('');
}

/**
 * El usuario con el que la persona entra al portal: primer nombre, punto,
 * primer apellido — sin tildes y sin nada que no sea letra, dígito o punto.
 *
 * Vive acá, y no adentro del formulario, porque la misma cuenta hace falta en
 * dos momentos distintos: al dar de alta (donde se ESCRIBE) y al editar el
 * nombre (donde hay que saber si el que ya está guardado dejó de
 * corresponder). Escrita dos veces, daría dos usuarios distintos para la misma
 * persona el día que una de las dos copias cambie.
 *
 * ⚠️ Y este texto NO es un rótulo: es la CREDENCIAL. La cuenta de Auth se llama
 * `<usuario>@farmalasa.app` —así la crea `set-employee-password` y así entra
 * `loginWithUsername`—, así que cambiarlo es cambiar con qué entra la persona.
 * Por eso al editar una ficha el formulario lo PROPONE y avisa, en vez de
 * reescribirlo solo, y el renombre pasa por `renombrar-usuario-empleado`, que
 * mueve la columna y la cuenta juntas.
 *
 * @param {string} firstNames Nombres tal como están en la ficha.
 * @param {string} lastNames  Apellidos tal como están en la ficha.
 * @returns {string} El usuario derivado, o '' si no hay ni nombre ni apellido.
 */
export function usuarioDesdeNombre(firstNames, lastNames) {
    const f = primerToken(firstNames).toLowerCase();
    const l = primerToken(lastNames).toLowerCase();
    const bruto = f && l ? `${f}.${l}` : f || l;
    return bruto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9.]/g, '');
}
