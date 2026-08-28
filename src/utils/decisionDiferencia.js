// De quién es el turno en la decisión de una diferencia del pedido.
//
// Vive aparte del componente y probada porque es la regla que decide QUÉ BOTÓN
// se pinta de cada lado, y equivocarla es la forma barata de que alguien vea
// «Aceptar» sobre algo que la base le va a rechazar — o peor, que las dos
// partes vean el mismo botón y el acuerdo lo firme uno solo.
//
// La conversación, tal como la fijó el usuario (2026-08-17):
//
//   (nadie)          → propone la SALA
//   propuesta        → contesta BODEGA (acepta o contrapropone la otra)
//   contrapropuesta  → contesta la SALA (acepta o no está de acuerdo)
//   escalada         → decide SUPERVISIÓN
//
// Supervisión puede actuar en cualquier turno: es la que desempata, y también
// la que cubre a una sala que no está. Lo que NO puede —y eso lo garantiza la
// base, no esta función— es aceptar lo que ella misma propuso.

/**
 * El escalón desde el que la base reconoce supervisión (`auth_es_supervision`).
 *
 * Era una lista de valores de `employees.system_role` —'SUPERVISOR', 'ADMIN',
 * 'SUPERADMIN'—, o sea la misma regla escrita dos veces: acá y en la base. Y
 * escrita mal, porque ese campo decía `SUPERVISOR` del Gerente General y `ADMIN`
 * de la jefatura de Talento Humano. Ahora las dos leen el rango del cargo.
 */
export const RANGO_DE_SUPERVISION = 3;

export const esCargoDeSupervision = (rango) =>
    Number(rango ?? 0) >= RANGO_DE_SUPERVISION;

/**
 * @returns 'yo' | 'sala' | 'bodega' | 'supervision' | 'nadie'
 *   'yo'     → me toca contestar
 *   el resto → de quién se está esperando
 *   'nadie'  → ya se acordó; lo que falta no es una respuesta
 */
export function turnoDe(estado, { esSala = false, esSupervision = false } = {}) {
    if (estado === 'escalada')        return esSupervision ? 'yo' : 'supervision';
    if (estado == null)               return (esSala || esSupervision) ? 'yo' : 'sala';
    if (estado === 'propuesta')       return (!esSala || esSupervision) ? 'yo' : 'bodega';
    if (estado === 'contrapropuesta') return (esSala || esSupervision) ? 'yo' : 'sala';
    return 'nadie';
}

/**
 * ¿Tengo algo que apretar en este renglón, ahora?
 *
 * Es el corte que ordena la lista. La primera versión agrupaba por ESTADO —«lo
 * acordado va aparte»— y ese corte es peor de un lado: una propuesta que espera
 * a bodega no le pide nada a la sala, y le seguía ocupando el lugar de lo que sí.
 * Lo que la persona necesita separado no es «en qué estado está» sino **qué me
 * toca a mí**.
 *
 * Supervisión puede actuar en cualquier turno, así que para ella casi todo es
 * accionable — y está bien: es la que destraba.
 *
 * @param op   la salida acordada, del catálogo (`mueve`, `cierra_con`)
 * @param dev  el movimiento, si la salida acordada tiene uno
 */
export function tengoAlgoQueHacer({ estado, op = null, dev = null, esSala = false, esSupervision = false } = {}) {
    if (estado === 'confirmada') return false;
    if (estado == null || estado === 'propuesta' || estado === 'contrapropuesta' || estado === 'escalada') {
        return turnoDe(estado, { esSala, esSupervision }) === 'yo';
    }
    if (estado !== 'acordada') return false;

    // Acordado y sin movimiento: falta que alguien vea el producto, y lo firma
    // quien lo recibe.
    if (op?.mueve === 'ninguno') {
        const laFirmaLaSala = op.cierra_con === 'llegada_sala';
        return esSupervision || (laFirmaLaSala ? esSala : !esSala);
    }

    // Hay un movimiento en vuelo. Sacarlo y confirmar su entrada las hace
    // BODEGA — es la que tiene el producto de un lado o del otro.
    if (dev && ['aceptada', 'enviada', 'error'].includes(dev.estado)) {
        return esSupervision || !esSala;
    }
    return false;
}
