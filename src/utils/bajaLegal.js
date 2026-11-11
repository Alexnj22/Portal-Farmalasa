// ── La baja de un empleado, en lo legal (2026-11-11) ────────────────────────
//
// Lo que el formulario de baja exige según el MOTIVO, y la liquidación que
// corresponde. Hasta hoy la baja pedía sólo el motivo y un «¿firmó finiquito?»:
// no quedaba la hoja de renuncia, ni la causal del despido, ni las fechas de un
// abandono, ni cuánto se debía pagar. Ante un reclamo en el Ministerio de
// Trabajo, el portal no tenía con qué responder.
//
// Fuentes: Código de Trabajo (CT) y la Ley Reguladora de la Prestación
// Económica por Renuncia Voluntaria (LRPERV), y el Reglamento Interno de la
// empresa (`docs/legal/empresa/reglamento_interno_de_trabajo.txt`), cuyo
// Art. 84 repite las 20 causales del Art. 50 CT y cuyo Art. 58 repite el fuero
// de maternidad del Art. 113 CT.
//
// ⚠️ La liquidación es una ESTIMACIÓN para revisar con el abogado o el
// contador antes de pagar: los rubros que dependen de una interpretación van
// marcados `revisar` y no se suman al total. La pantalla lo dice.
//
// Lógica pura: la usan la web (FormNovedad) y las pruebas.

const DIA = 86400000;

/** 'AAAA-MM-DD' → fecha UTC a mediodía, o null. */
function fecha(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
}
const dias = (a, b) => Math.round((fecha(b) - fecha(a)) / DIA);
const redondear = (n) => Math.round(n * 100) / 100;

/** Las 20 causales del Art. 50 CT (Art. 84 del Reglamento Interno), resumidas. */
export const CAUSALES_ART_50 = [
    { n: 1, texto: 'Engañó al contratar con recomendaciones o certificados falsos (sólo dentro de sus primeros 30 días)' },
    { n: 2, texto: 'Negligencia reiterada' },
    { n: 3, texto: 'Pérdida de confianza en un cargo de dirección, vigilancia o fiscalización' },
    { n: 4, texto: 'Reveló secretos de la empresa o asuntos que le causen perjuicio' },
    { n: 5, texto: 'Actos graves de inmoralidad en el trabajo' },
    { n: 6, texto: 'Irrespeto al patrono o a un jefe, sin provocación' },
    { n: 7, texto: 'Irrespeto grave a familiares del patrono, sin provocación' },
    { n: 8, texto: 'Perturbó gravemente el orden en la empresa' },
    { n: 9, texto: 'Daños materiales maliciosos o por negligencia grave' },
    { n: 10, texto: 'Puso en grave peligro la seguridad de personas' },
    { n: 11, texto: 'Puso en grave peligro instalaciones o bienes' },
    { n: 12, texto: 'Faltó sin permiso 2 días completos seguidos, o 3 días (o medios días) en un mismo mes' },
    { n: 13, texto: 'No se presentó a iniciar o reanudar labores sin causa justa' },
    { n: 14, texto: 'Falta contra el patrono o compañeros tras cumplir arresto' },
    { n: 15, texto: 'Procesado por delito contra el patrono, compañeros, la propiedad o la Hacienda Pública' },
    { n: 16, texto: 'Desobediencia manifiesta en asuntos de su trabajo' },
    { n: 17, texto: 'Incumplió de forma manifiesta y reiterada las medidas de prevención de riesgos' },
    { n: 18, texto: 'Bebidas embriagantes o drogas en el trabajo' },
    { n: 19, texto: 'Prohibición del Art. 32 CT ya amonestada por Inspección en los últimos 6 meses' },
    { n: 20, texto: 'Incumplimiento grave de obligaciones o prohibiciones (Art. 24 CT)' },
];

/** Qué papel respalda cada motivo (el archivo obligatorio del formulario). */
export const DOCUMENTO_DE_BAJA = {
    RENUNCIA: 'la hoja oficial de renuncia firmada (formulario del Ministerio de Trabajo o del juzgado)',
    DESPIDO_SIN_RESPONSABILIDAD: 'la carta de despido con la causal y los hechos, firmada',
    DESPIDO_CON_RESPONSABILIDAD: 'la carta de despido firmada o el finiquito',
    ABANDONO: 'el acta o constancia de las inasistencias',
};

/** Lo que queda por hacer después de la baja. No frena el registro: se anota. */
export const PENDIENTES_DE_BAJA = [
    { clave: 'hasFiniquito', texto: 'Finiquito pagado y firmado' },
    { clave: 'entregoActivos', texto: 'Devolvió carné, uniforme, llaves y equipo' },
    { clave: 'avisoIsssAfp', texto: 'Aviso de retiro presentado al ISSS y a la AFP' },
    { clave: 'constanciaEntregada', texto: 'Constancia de trabajo entregada' },
];

/** ¿Los días de ausencia configuran la causal 12 (o el abandono)? */
export function ausenciasConfiguranCausal(fechas = []) {
    const lista = [...new Set((fechas || []).filter((f) => fecha(f)))].sort();
    for (let i = 1; i < lista.length; i++) if (dias(lista[i - 1], lista[i]) === 1) return true;
    const porMes = {};
    for (const f of lista) porMes[f.slice(0, 7)] = (porMes[f.slice(0, 7)] || 0) + 1;
    return Object.values(porMes).some((n) => n >= 3);
}

/** ¿Hay una incapacidad vigente ese día en el historial? */
export function incapacidadVigente(historial = [], dia) {
    return (historial || []).find((ev) => {
        if (ev?.type !== 'DISABILITY') return false;
        const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata || '{}') : (ev.metadata || {});
        if (meta.annulled || meta.applyStatus === 'CANCELLED') return false;
        const ini = ev.date;
        const fin = ev.endDate || meta.endDate || ev.date;
        return ini && dia >= ini && dia <= fin;
    }) || null;
}

/**
 * Lo que impide guardar la baja, o null. Los campos vacíos devuelven un motivo
 * corto: en una baja conviene decir QUÉ falta, no sólo apagar el botón.
 *
 * @param {object} d  los datos del formulario
 * @param {object} [empleado]
 */
export function problemaDeBaja(d = {}, empleado = {}) {
    const motivo = d.terminationReason;
    if (!motivo) return 'Elige el motivo legal de la baja.';
    if (!fecha(d.ultimoDiaLaborado)) return 'Falta el último día que trabajó.';
    if (d.date && d.ultimoDiaLaborado > d.date) return 'El último día trabajado no puede ser después de la fecha de baja.';

    const esDespido = motivo === 'DESPIDO_SIN_RESPONSABILIDAD' || motivo === 'DESPIDO_CON_RESPONSABILIDAD' || motivo === 'ABANDONO';
    if (esDespido) {
        if (d.fueroDeclarado !== 'NO' && d.fueroDeclarado !== 'SI') {
            return 'Responde si la persona está embarazada, en descanso postnatal, incapacitada o es directiva sindical.';
        }
        if (d.fueroDeclarado === 'SI') {
            return 'Con fuero (embarazo, postnatal, incapacidad o directiva sindical) el despido no termina el contrato (Art. 113 CT). Consúltalo con el abogado antes de registrarlo.';
        }
    }

    if (motivo === 'RENUNCIA') {
        if (!fecha(d.hojaRenunciaExpedida)) return 'Falta la fecha de expedición de la hoja oficial de renuncia.';
        if (!fecha(d.renunciaPresentada)) return 'Falta la fecha en que presentó la renuncia.';
        const n = dias(d.hojaRenunciaExpedida, d.renunciaPresentada);
        if (n < 0) return 'La renuncia no se puede presentar antes de que se expida la hoja.';
        if (n > 10) return `La hoja se presentó ${n} días después de expedida: sólo vale dentro de los 10 días (Art. 402 CT). Hay que pedir una hoja nueva.`;
    }

    if (motivo === 'DESPIDO_SIN_RESPONSABILIDAD') {
        const causal = Number(d.causalArt50);
        if (!CAUSALES_ART_50.some((c) => c.n === causal)) return 'Elige la causal del Art. 50 CT.';
        if (!fecha(d.fechaDeLosHechos)) return 'Falta la fecha de los hechos.';
        if (String(d.pruebas || '').trim().length < 15) return 'Describe las pruebas de la causal (actas, testigos, sanciones previas, cámaras).';
        const ingreso = empleado?.hire_date || empleado?.hireDate;
        if (causal === 1 && ingreso && d.date && dias(ingreso, d.date) > 30) {
            return 'La causal 1 sólo vale dentro de los primeros 30 días de trabajo.';
        }
        if (causal === 12 && !ausenciasConfiguranCausal(d.diasDeAusencia)) {
            return 'Para la causal 12 marca las ausencias: 2 días seguidos, o 3 en un mismo mes.';
        }
    }

    if (motivo === 'ABANDONO') {
        if (!ausenciasConfiguranCausal(d.diasDeAusencia)) return 'Marca los días que faltó: 2 días seguidos, o 3 en un mismo mes.';
        if (String(d.intentoDeContacto || '').trim().length < 10) return 'Anota cómo se le intentó contactar (llamadas, mensajes, visita) y cuándo.';
    }
    return null;
}

/** Avisos que no frenan, pero que quien registra tiene que ver. */
export function avisosDeBaja(d = {}, empleado = {}) {
    const avisos = [];
    if (d.terminationReason === 'RENUNCIA' && fecha(d.renunciaPresentada) && fecha(d.date)) {
        const preaviso = dias(d.renunciaPresentada, d.date);
        if (preaviso < 15) {
            avisos.push(`Preaviso de ${preaviso} días: la ley pide 15 (30 en cargos de dirección) para la prestación por renuncia. Revisa con el abogado si se paga.`);
        }
    }
    const incap = d.date ? incapacidadVigente(empleado?.history, d.date) : null;
    if (incap && d.terminationReason !== 'RENUNCIA') {
        avisos.push('Tiene una incapacidad vigente en la fecha de baja: durante la incapacidad el contrato está suspendido.');
    }
    return avisos;
}

/** Días de aguinaldo según la antigüedad (Art. 198 CT). */
export function diasDeAguinaldo(anios) {
    if (anios >= 10) return 21;
    if (anios >= 3) return 19;
    return 15;
}

/**
 * La liquidación estimada.
 *
 * @param {{ motivo: string, salarioMensual: number, ingreso: string, baja: string, salarioMinimoMensual: number }} p
 * @returns {{ rubros: Array<{ clave: string, texto: string, monto: number, aplica: true|false|'revisar', base: string }>, total: number, aniosDeServicio: number } | null}
 */
export function liquidacionEstimada({ motivo, salarioMensual, ingreso, baja, salarioMinimoMensual }) {
    const sm = Number(salarioMensual);
    const min = Number(salarioMinimoMensual);
    if (!(sm > 0) || !fecha(ingreso) || !fecha(baja) || !(min > 0) || dias(ingreso, baja) < 0) return null;

    const diario = sm / 30;
    const minDiario = min / 30;
    const diasServicio = dias(ingreso, baja) + 1;
    const anios = diasServicio / 365;
    const aniosCompletos = Math.floor(anios);

    const despidoInjusto = motivo === 'DESPIDO_CON_RESPONSABILIDAD';
    const renuncia = motivo === 'RENUNCIA';
    const proporcionales = despidoInjusto || renuncia ? true : 'revisar';

    // Vacaciones: 15 días + 30% (Art. 177), proporcionales al año de servicio en curso.
    const diasDelAnioEnCurso = diasServicio - aniosCompletos * 365;
    const vacaciones = 15 * diario * 1.3 * (diasDelAnioEnCurso / 365);

    // Aguinaldo: proporcional desde el 12 de diciembre anterior (Art. 196-202).
    const b = fecha(baja);
    let corte = `${b.getUTCFullYear()}-12-12`;
    if (baja < corte || baja === corte) corte = `${b.getUTCFullYear() - 1}-12-12`;
    const desde = ingreso > corte ? ingreso : corte;
    const diasAguinaldo = Math.max(0, dias(desde, baja));
    const aguinaldo = diasDeAguinaldo(anios) * diario * (Math.min(diasAguinaldo, 365) / 365);

    const rubros = [
        { clave: 'vacaciones', texto: 'Vacaciones proporcionales', monto: redondear(vacaciones), aplica: proporcionales,
            base: `15 días + 30% × ${diasDelAnioEnCurso} de 365 días del año de servicio en curso` },
        { clave: 'aguinaldo', texto: 'Aguinaldo proporcional', monto: redondear(aguinaldo), aplica: proporcionales,
            base: `${diasDeAguinaldo(anios)} días × ${diasAguinaldo} de 365 días desde el 12 de diciembre` },
    ];

    if (despidoInjusto) {
        // Art. 58 CT: 30 días por año (y la fracción), con el salario diario
        // topado en 4 mínimos diarios; nunca menos de 15 días de salario.
        const tope = Math.min(diario, 4 * minDiario);
        const monto = Math.max(30 * tope * anios, 15 * diario);
        rubros.push({ clave: 'indemnizacion', texto: 'Indemnización por despido (Art. 58 CT)', monto: redondear(monto), aplica: true,
            base: `30 días × ${anios.toFixed(2)} años, salario diario topado en 4 mínimos; mínimo 15 días` });
    }
    if (renuncia) {
        // LRPERV: desde 2 años, 15 días por año de servicio, salario diario
        // topado en 2 mínimos diarios.
        const tope = Math.min(diario, 2 * minDiario);
        const aplica = aniosCompletos >= 2;
        rubros.push({ clave: 'prestacionRenuncia', texto: 'Prestación por renuncia voluntaria', monto: aplica ? redondear(15 * tope * aniosCompletos) : 0,
            aplica: aplica ? true : false,
            base: aplica ? `15 días × ${aniosCompletos} años completos, salario diario topado en 2 mínimos` : 'Requiere 2 años de servicio' });
    }

    const total = redondear(rubros.filter((r) => r.aplica === true).reduce((s, r) => s + r.monto, 0));
    return { rubros, total, aniosDeServicio: Math.round(anios * 100) / 100 };
}

/**
 * `Map(employee_id → { motivo, fecha, sucursalId, cargoId })` con la baja
 * vigente de cada persona: la más reciente que no se canceló ni se reemplazó.
 * Las filas vienen de `fetchUltimasBajas`.
 */
export function ultimaBajaPorPersona(filas) {
    const porPersona = new Map();
    for (const f of filas || []) {
        if (f?.estado === 'CANCELLED' || f?.estado === 'SUPERSEDED') continue;
        const previa = porPersona.get(String(f.employee_id));
        if (previa && (previa.fecha > f.date || (previa.fecha === f.date && previa.id > f.id))) continue;
        porPersona.set(String(f.employee_id), {
            id: f.id,
            motivo: f.motivo || null,
            fecha: f.date,
            sucursalId: f.sucursal ? Number(f.sucursal) : null,
            cargoId: f.cargo ? Number(f.cargo) : null,
        });
    }
    return porPersona;
}
