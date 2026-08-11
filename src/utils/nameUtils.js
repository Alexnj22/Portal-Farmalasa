// Nombre corto del portal: SIEMPRE primer nombre + primer apellido, aunque el
// empleado tenga 2-3 nombres o 2-3 apellidos.
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

/**
 * @param {object|string|null} emp Empleado (`{ first_names, last_names, name }`)
 *   o directamente su nombre completo ya concatenado.
 * @returns {string} "Primer Nombre Primer Apellido", o 'Personal' si no hay dato.
 */
export function shortEmployeeName(emp) {
    if (!emp) return 'Personal';

    if (typeof emp === 'string') return shortEmployeeName({ name: emp });

    const first = primerToken(emp.first_names);
    const last = primerToken(emp.last_names);
    if (first || last) return `${first} ${last}`.trim();

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
    return short.split(/\s+/).slice(0, 2).map(t => t.charAt(0).toUpperCase()).join('');
}
