// ── Qué ES una ficha de `employees` ─────────────────────────────────────────
//
// No toda fila de `employees` es una persona en planilla. Hay tres cosas ahí
// adentro y hasta el 2026-08-26 la tabla no las distinguía:
//
//   empleado          persona contratada. La única que cuenta para nómina,
//                     vacaciones, horarios, conteo de cabezas y el directorio.
//   servicio_externo  presta un servicio y necesita entrar al portal, pero no
//                     es personal contratado (hoy: «Contador Externo»).
//   tecnica           una cuenta del sistema, no una persona (hoy: «QA Testing»
//                     y el «Administrador del Sistema»).
//
// ── Por qué existe este archivo y no un `.filter()` por vista ───────────────
//
// Porque eso es exactamente lo que había, y protegía UNA pantalla. El único
// freno era `system_role !== 'SUPERADMIN'` dentro de `StaffManagementView`.
// Verificado el 2026-08-26: `SchedulesView` y `VacationPlanView` leen
// `employees` en crudo, así que el **Plan Anual de Vacaciones** —documento con
// peso legal, Art. 177 CT— listaba a «QA Testing» y al «Contador Externo» como
// personal con derecho a vacaciones. El conteo de Personal decía 47 cuando las
// personas en planilla son **46**, y el `Directorio_Personal.csv` los bajaba
// también.
//
// Y las cuatro fichas estaban `ACTIVO` con `contract_type = 'INDEFINIDO'`: el
// registro afirmaba que una cuenta de pruebas era personal permanente de Salud
// 1, y que un contador externo tenía contrato indefinido. La segunda es la que
// hace daño de verdad — un proveedor externo anotado como personal indefinido
// argumenta EN CONTRA de la empresa en una inspección, no a favor.
//
// La verdad vive en la columna `employees.tipo_ficha` (migración
// 20260826215803) y este archivo es la única forma de preguntarla. Un `filter`
// escrito a mano en la vista número seis es cómo volvimos acá.
//
// ── La falla segura apunta a 'empleado' ─────────────────────────────────────
//
// Una ficha sin `tipo_ficha` cuenta como empleado, y no es simetría: marcar de
// menos deja a una persona REAL fuera de la planilla, del ISSS y del plan de
// vacaciones —y eso no da error, sólo una ausencia que nadie ve—. Marcar de más
// pone una cuenta técnica en una lista donde se ve y se corrige. El primero es
// el error caro, así que el default lo evita.
//
// Eso además cubre el momento en que el navegador todavía trae el snapshot
// viejo de `localStorage` (sin la columna) o una versión anterior de
// `employees_safe`: la lista sale completa, no vacía.

export const TIPO_EMPLEADO = 'empleado';
export const TIPO_SERVICIO_EXTERNO = 'servicio_externo';
export const TIPO_TECNICA = 'tecnica';

/**
 * ¿Esta ficha es una persona en planilla?
 *
 * Es la pregunta que tienen que hacerse Nómina, Horarios, el Plan de
 * Vacaciones, el conteo de cabezas y el directorio que se exporta.
 */
export function esPersonalEnPlanilla(emp) {
    if (!emp) return false;
    // `!= null` y no `!== undefined`: `null` también significa «nadie lo
    // decidió», y el default seguro es el mismo.
    const tipo = emp.tipo_ficha ?? emp.tipoFicha;
    return tipo == null || tipo === TIPO_EMPLEADO;
}

/** Lo contrario: cuentas externas y del sistema. */
export function esFichaQueNoEsEmpleado(emp) {
    return !esPersonalEnPlanilla(emp);
}

/** Filtra una lista dejando sólo a las personas en planilla. */
export function soloPersonalEnPlanilla(lista) {
    return (lista || []).filter(esPersonalEnPlanilla);
}

/** Filtra al revés: las fichas que NO son personal contratado. */
export function soloNoEmpleados(lista) {
    return (lista || []).filter(esFichaQueNoEsEmpleado);
}

// El rótulo se escribe en términos del portal, no de la columna. «tecnica» es
// el valor guardado; lo que la pantalla dice es de qué se trata.
const ROTULOS = {
    [TIPO_SERVICIO_EXTERNO]: 'Servicio externo',
    [TIPO_TECNICA]: 'Cuenta del sistema',
    [TIPO_EMPLEADO]: 'En planilla',
};

export function rotuloTipoFicha(emp) {
    const tipo = emp?.tipo_ficha ?? emp?.tipoFicha ?? TIPO_EMPLEADO;
    return ROTULOS[tipo] || ROTULOS[TIPO_EMPLEADO];
}
