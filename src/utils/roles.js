// ── Resolver un cargo contra la tabla `roles` ────────────────────────────────
//
// Existe porque el portal venía cruzando cargos por comparación exacta de
// cadena —`roles.find(r => r.name === 'Regente de Enfermería')`— contra listas
// escritas a mano en los formularios. Medido el 2026-08-12 sobre las 24 filas
// reales: la tabla dice **«Regente de Enfermeria»**, sin tilde, y la lista del
// formulario la escribía **con** tilde. O sea que ese `find` devolvía
// `undefined` y el empleado se guardaba con `role_id: null` **sin lanzar, sin
// avisar y sin quedar en el log** — la misma familia que
// `feedback_sin_policy_de_update_el_write_devuelve_cero`: la escritura
// "funciona" y no hace lo que dice.
//
// Dos piezas, y las dos importan:
//
//   · `normalizarCargo` quita tildes, colapsa espacios y baja a minúsculas.
//     No es cosmética: la tabla tiene nombres con espacio al final
//     («Referente de Farmacovigilancia », id 9) y con tildes inconsistentes.
//     Comparar crudo es apostar a que nadie escribió el nombre dos veces.
//
//   · `buscarCargo` intenta la coincidencia EXACTA primero y sólo después la
//     normalizada. Ese orden importa: si algún día existieran dos cargos que
//     sólo se distinguen por un acento, el exacto gana y no se elige al otro
//     por accidente.
//
// La tolerancia es una red, no una excusa: lo correcto sigue siendo que la
// lista salga de la tabla. Ver `docs/PLAN-CATALOGOS-QUE-SON-SU-PROPIO-ROTULO.md`.

export function normalizarCargo(nombre) {
    return String(nombre ?? '')
        .normalize('NFD')
        // El rango de marcas diacríticas, con escapes: escrito con los
        // caracteres crudos es invisible en el editor y cualquiera lo borra sin
        // saber que lo borró.
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** Devuelve la fila de `roles` que corresponde al nombre, o `null`. */
export function buscarCargo(roles, nombre) {
    if (!nombre || !Array.isArray(roles)) return null;
    const exacto = roles.find(r => r?.name === nombre);
    if (exacto) return exacto;
    const norm = normalizarCargo(nombre);
    if (!norm) return null;
    return roles.find(r => normalizarCargo(r?.name) === norm) ?? null;
}

/**
 * Las opciones de un desplegable de cargo, tomadas de la TABLA.
 *
 * `nombresDeseados` describe la intención —qué cargos tiene sentido ofrecer
 * acá— y el texto que se muestra sale siempre de la fila real, así que el
 * valor elegido coincide con la base por construcción. Un nombre que no exista
 * en la tabla simplemente no se ofrece: es preferible una opción de menos que
 * una que al guardarse deja el cargo en nulo.
 */
export function opcionesDeCargo(roles, nombresDeseados) {
    const vistos = new Set();
    return nombresDeseados
        .map(n => buscarCargo(roles, n))
        .filter(fila => {
            if (!fila || vistos.has(fila.id)) return false;
            vistos.add(fila.id);
            return true;
        })
        .map(fila => ({ value: fila.name, label: fila.name }));
}
