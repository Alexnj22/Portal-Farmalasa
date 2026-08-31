// Quién necesita el código SU para que le autoricen una marcación.
//
// Esta regla vive en el servidor, dentro de `verify_kiosk_authorization`:
//
//     upper(rl1.name) LIKE '%JEFE%' OR upper(rl2.name) LIKE '%JEFE%'
//
// El servidor es el que manda —es el que compara el código— así que acá se
// reproduce esa forma exacta y no una parecida. Dos detalles que se rompen
// solos si no se conocen:
//
// 1. Es «CONTIENE», no «ES IGUAL». El cargo se llama «Jefe/a de Sala», no
//    «JEFE». Hasta el 2026-08-31 `AuthPromptPanel` preguntaba
//    `['JEFE','SUBJEFE'].includes('JEFE/A DE SALA')`, que no puede dar
//    verdadero para NINGÚN cargo real: el cartel «Requiere código SU» no se
//    mostró nunca. La persona tecleaba el código de 4 dígitos, el servidor
//    esperaba 6, y el rebote decía «código incorrecto» — que manda a buscar el
//    problema donde no está. El motor (`useTimeClockEngine`) sí usaba
//    `.includes()`: eran dos respuestas distintas a la misma pregunta.
//
// 2. El CARGO SECUNDARIO cuenta. El servidor mira los dos y los dos lados del
//    portal miraban sólo el principal. Medido: Alexander Melgar e Idalia
//    Serrano son «Regente de Enfermeria» con «Subjefe/a de Sala» de secundario
//    — el servidor les exige los 6 dígitos y el portal ni lo evaluaba.
//
// Basta con buscar 'JEFE': «SUBJEFE» lo contiene. La lista vieja nombraba los
// dos y eso escondía que la comparación era el problema, no la lista.
const MARCA_DE_JEFATURA = 'JEFE';

/** Los dos cargos de una persona, en mayúsculas y sin huecos. */
const cargosDe = (employee) => [
    employee?.role,
    // Las dos grafías existen de verdad en el árbol (el payload del kiosco trae
    // `secondary_role`; algunas vistas arman `secondaryRole`), y ya se aceptan
    // así en EquiposView y ScheduleCalendar. Mirar una sola devolvería `false`
    // en silencio para la mitad de los llamadores.
    employee?.secondary_role ?? employee?.secondaryRole,
].filter(Boolean).map(c => String(c).toUpperCase());

/**
 * ¿Al autorizar a esta persona hay que pedir el código SU (6 dígitos) en vez
 * del código de la hora (4)?
 *
 * Es una pregunta sobre QUIEN MARCA, no sobre quien autoriza.
 */
export function requiereCodigoSu(employee) {
    return cargosDe(employee).some(cargo => cargo.includes(MARCA_DE_JEFATURA));
}
