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

/** Los cargos que la base reconoce como supervisión (`auth_es_supervision`). */
export const CARGOS_DE_SUPERVISION = ['SUPERVISOR', 'ADMIN', 'SUPERADMIN'];

export const esCargoDeSupervision = (systemRole) =>
    CARGOS_DE_SUPERVISION.includes(systemRole);

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
