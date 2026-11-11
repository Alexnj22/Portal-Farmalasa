// La regencia y la farmacovigilancia de cada sala (2026-11-10).
//
// Lo que dice la norma (SRS, Guía del Regente C02-RS-01-UREP.GUI03 v04;
// Norma Técnica de Farmacovigilancia, Acuerdo 1690, Art. 18):
//   · Toda farmacia tiene regente químico farmacéutico. Un mismo regente puede
//     tener VARIAS farmacias mientras sus horarios no choquen.
//   · Horas mínimas de presencia del regente según la categoría de la farmacia:
//     tercera 20 h al mes, segunda 30 h al mes, primera 40 h por SEMANA.
//   · El referente de farmacovigilancia de una farmacia privada es un químico
//     farmacéutico; la norma no le prohíbe cubrir varias farmacias ni ser el
//     mismo regente.
//
// Por eso los candidatos para las dos funciones salen del CARGO (id), no del
// texto del cargo: el formulario filtraba con `role.includes('REGENTE')`, que
// dejaba afuera a quien tiene Regente como cargo secundario. Un rótulo no es
// una clave (CLAUDE.md).

/** Cargos de químico farmacéutico: Regente (8) y Referente de Farmacovigilancia (9). */
export const CARGOS_QUIMICO_FARMACEUTICO = Object.freeze([8, 9]);

/** ¿El empleado tiene, como cargo principal o secundario, uno de químico farmacéutico? */
export function esQuimicoFarmaceutico(emp) {
    if (!emp) return false;
    return [emp.role_id, emp.secondary_role_id]
        .some((id) => id !== null && id !== undefined && CARGOS_QUIMICO_FARMACEUTICO.includes(Number(id)));
}

/**
 * Horas mínimas AL MES que el regente debe estar en una farmacia de esa
 * categoría SRS. Primera categoría pide 40 h por semana: se traduce a mes con
 * 52 semanas / 12 meses. Sin categoría reconocida, null (no se juzga).
 */
export function horasMinimasDeRegencia(categoriaSrs) {
    switch (String(categoriaSrs ?? '')) {
        case '1': return Math.ceil(40 * 52 / 12);
        case '2': return 30;
        case '3': return 20;
        default: return null;
    }
}

/**
 * Las salas que tiene asignadas cada químico farmacéutico, con las horas que
 * declara en cada una. `branches` es la lista de sucursales con `settings.legal`
 * (la forma del store). Devuelve un Map employeeId → { regente: [...], farmacovigilancia: [...], horasMes }.
 */
export function asignacionesDeRegencia(branches) {
    const porEmpleado = new Map();
    const fila = (id) => {
        const k = String(id);
        if (!porEmpleado.has(k)) porEmpleado.set(k, { regente: [], farmacovigilancia: [], horasMes: 0 });
        return porEmpleado.get(k);
    };
    for (const b of branches || []) {
        const legal = b?.settings?.legal || {};
        if (legal.regentEmployeeId) {
            const horas = Number(legal.regentHorasMes) || 0;
            const f = fila(legal.regentEmployeeId);
            f.regente.push({ branchId: b.id, nombre: b.name, horasMes: horas, minimo: horasMinimasDeRegencia(legal.srsCategoria) });
            f.horasMes += horas;
        }
        if (legal.pharmacovigilanceEmployeeId) {
            fila(legal.pharmacovigilanceEmployeeId).farmacovigilancia.push({ branchId: b.id, nombre: b.name });
        }
    }
    return porEmpleado;
}

/**
 * Lo que le falta a la regencia de UNA sala, en palabras de la pantalla.
 * Devuelve una lista (vacía si está completa).
 */
export function faltantesDeRegencia(branch) {
    const legal = branch?.settings?.legal || {};
    const faltan = [];
    if (!legal.regentEmployeeId) faltan.push('Sin regente asignado');
    else {
        const minimo = horasMinimasDeRegencia(legal.srsCategoria);
        const horas = Number(legal.regentHorasMes) || 0;
        if (!horas) faltan.push('Faltan las horas al mes del regente');
        else if (minimo !== null && horas < minimo) faltan.push(`El regente cubre ${horas} h al mes; la categoría pide ${minimo}`);
    }
    if (!legal.pharmacovigilanceEmployeeId) faltan.push('Sin referente de farmacovigilancia');
    return faltan;
}
