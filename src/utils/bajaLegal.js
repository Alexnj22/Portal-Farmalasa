// ── La baja de un empleado, en lo legal (2026-11-11) ────────────────────────
//
// Lo que el formulario de baja exige según el MOTIVO, y la liquidación que
// corresponde. Hasta hoy la baja pedía sólo el motivo y un «¿firmó finiquito?»:
// no quedaba la hoja de renuncia, ni la causal del despido, ni las fechas de un
// abandono, ni cuánto se debía pagar. Ante un reclamo en el Ministerio de
// Trabajo, el portal no tenía con qué responder.
//
// Fuentes: Código de Trabajo (CT, `docs/legal/normativa/laboral/codigo_de_trabajo_2025-08.txt`),
// la Ley Reguladora de la Prestación Económica por Renuncia Voluntaria
// (LRPERV, `docs/legal/normativa/laboral/ley_renuncia_voluntaria_2013.txt`), la
// Quincena 25 (D. L. 499 e instructivo MTPS 01/2026, leído en prensa: sin el
// texto oficial, va `revisar`), y el Reglamento Interno de la
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

/** El salario mínimo de comercio y servicios vigente desde el 1 de junio de
 *  2025 (Decreto Ejecutivo de ese año, +12%). Valor inicial EDITABLE: se guarda
 *  con la baja el número que se usó. */
export const SALARIO_MINIMO_INICIAL = 408.8;

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
    ABANDONO: 'el acta de inasistencias y la carta de terminación firmadas por el patrono (el portal las arma: «Imprimir acta y carta»). Si todavía no están firmadas, la baja se registra igual y queda pendiente en el cierre',
};

/** Días de la semana, para el día de descanso (0 = domingo, como `Date.getUTCDay`). */
export const DIAS_DE_LA_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Lo que queda por hacer después de la baja. No frena el registro: se anota. */
export const PENDIENTES_DE_BAJA = [
    { clave: 'hasFiniquito', texto: 'Finiquito pagado y firmado' },
    // La devolución de lo que se le entregó va APARTE, artículo por artículo
    // (`ACTIVOS_DE_BAJA`): una sola casilla «carné, uniforme, llaves y equipo»
    // no tenía respuesta cuando devolvía todo menos el uniforme (2026-11-14).
    { clave: 'avisoIsssAfp', texto: 'Aviso de retiro presentado al ISSS y a la AFP' },
    { clave: 'constanciaEntregada', texto: 'Constancia de trabajo entregada' },
    // Art. 55 CT: el despido comunicado por otra persona y sin escrito firmado
    // por el patrono no termina el contrato. Quien no vuelve no firma nada: lo
    // que vale es la carta del patrono, entregada o enviada a su domicilio.
    { clave: 'cartaEntregada', texto: 'Carta de terminación firmada por el patrono, entregada o enviada a su domicilio (Art. 55 CT)',
        motivos: ['DESPIDO_SIN_RESPONSABILIDAD', 'ABANDONO'] },
];

/** Los pendientes que aplican a ese motivo. */
export const pendientesDeBaja = (motivo) => PENDIENTES_DE_BAJA.filter((p) => !p.motivos || p.motivos.includes(motivo));

/**
 * Lo que se le entregó y tiene que devolver, uno por uno. Cada artículo tiene
 * tres respuestas: `SI` (lo devolvió), `NO` (queda pendiente) o `NA` (nunca se
 * le entregó). Se guarda en `activosDevueltos: { carne: 'SI', … }`.
 */
export const ACTIVOS_DE_BAJA = [
    { clave: 'carne', texto: 'Carné' },
    { clave: 'uniforme', texto: 'Uniforme' },
    { clave: 'llaves', texto: 'Llaves' },
    { clave: 'equipo', texto: 'Equipo', detalle: 'computadora, teléfono, herramientas' },
];

/**
 * El estado de la devolución. `entregoActivos` (la casilla vieja) sigue
 * existiendo en `metadata`: queda en true sólo si no falta nada. Una baja vieja
 * con `entregoActivos: true` y sin el detalle se lee como todo devuelto.
 */
export function estadoDeActivos(d = {}) {
    const guardado = d?.activosDevueltos || {};
    const viejo = d?.entregoActivos === true && !d?.activosDevueltos;
    const items = ACTIVOS_DE_BAJA.map((a) => ({ ...a, estado: viejo ? 'SI' : (guardado[a.clave] || null) }));
    const respondidos = items.filter((i) => i.estado).length;
    const pendientes = items.filter((i) => i.estado === 'NO');
    const sinResponder = items.filter((i) => !i.estado);
    return { items, respondidos, pendientes, sinResponder, completo: sinResponder.length === 0 && pendientes.length === 0 };
}

/** El cambio de UN artículo, con `entregoActivos` recalculado. Lo usan la web y la app. */
export function conActivo(d = {}, clave, estado) {
    const activosDevueltos = { ...(d?.activosDevueltos || estadoDeActivos(d).items.reduce((o, i) => (i.estado ? { ...o, [i.clave]: i.estado } : o), {})), [clave]: estado };
    return { activosDevueltos, entregoActivos: estadoDeActivos({ activosDevueltos }).completo };
}

/**
 * ¿El respaldo es obligatorio para registrar la baja? En el abandono NO: quien
 * no vuelve no firma nada, y el acta y la carta las firma el patrono después
 * (queda pendiente en el cierre). Exigirlo antes dejaba a la persona activa
 * —con acceso al sistema— hasta que alguien escaneara un papel (2026-11-14:
 * Talento Humano no pudo dar de baja a dos personas).
 */
export const respaldoDeBajaObligatorio = (motivo) => motivo !== 'ABANDONO';

/**
 * ¿Los días de ausencia configuran la causal 12 (o el abandono)? La ley dice
 * «dos días LABORALES completos y consecutivos»: si entre dos faltas sólo
 * queda su día de descanso semanal (sábado y lunes con el domingo libre), son
 * consecutivas. Sin día de descanso dicho, sólo cuentan días seguidos.
 */
export function ausenciasConfiguranCausal(fechas = [], diaDeDescanso = null) {
    const lista = [...new Set((fechas || []).filter((f) => fecha(f)))].sort();
    const descanso = diaDeDescanso === null || diaDeDescanso === undefined || diaDeDescanso === '' ? null : Number(diaDeDescanso);
    for (let i = 1; i < lista.length; i++) {
        const n = dias(lista[i - 1], lista[i]);
        if (n === 1) return true;
        if (n === 2 && descanso !== null && new Date(fecha(lista[i - 1]).getTime() + DIA).getUTCDay() === descanso) return true;
    }
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

/** El nombre corto de cada campo, para la lista de lo que falta. */
export const ROTULOS_DE_BAJA = {
    terminationReason: 'Motivo legal',
    ultimoDiaLaborado: 'Último día que trabajó',
    fueroDeclarado: '¿Tiene fuero?',
    hojaRenunciaExpedida: 'Fecha de la hoja oficial',
    renunciaPresentada: 'Fecha en que la presentó',
    causalArt50: 'Causal del Art. 50',
    fechaDeLosHechos: 'Fecha de los hechos',
    pruebas: 'Pruebas de la causal',
    diasDeAusencia: 'Días que faltó',
    intentoDeContacto: 'Intento de contacto',
};

/**
 * Cada comprobación de la baja, EN ORDEN, con el campo al que pertenece y el
 * problema (o null). El orden es el de la pantalla: el primer problema es el
 * que se dice en el pie, y su `campo` es a donde lleva el clic (2026-11-14).
 */
function comprobacionesDeBaja(d = {}, empleado = {}) {
    const lista = [];
    const exigir = (campo, problema) => lista.push({ campo, problema: problema || null });
    const motivo = d.terminationReason;
    exigir('terminationReason', motivo ? null : 'Elige el motivo legal de la baja.');
    if (!motivo) return lista;

    exigir('ultimoDiaLaborado', !fecha(d.ultimoDiaLaborado) ? 'Falta el último día que trabajó.'
        : (d.date && d.ultimoDiaLaborado > d.date) ? 'El último día trabajado no puede ser después de la fecha de baja.' : null);

    const esDespido = motivo === 'DESPIDO_SIN_RESPONSABILIDAD' || motivo === 'DESPIDO_CON_RESPONSABILIDAD' || motivo === 'ABANDONO';
    if (esDespido) {
        exigir('fueroDeclarado', (d.fueroDeclarado !== 'NO' && d.fueroDeclarado !== 'SI')
            ? 'Responde si tiene fuero: embarazada o en los 6 meses después del postnatal, incapacitada o directiva sindical.'
            : d.fueroDeclarado === 'SI'
                ? 'Con fuero (embarazo y los 6 meses después del postnatal, incapacidad vigente o directiva sindical) el despido no termina el contrato (Arts. 113 y 248 CT). Consúltalo con el abogado antes de registrarlo.'
                : null);
    }

    if (motivo === 'RENUNCIA') {
        exigir('hojaRenunciaExpedida', fecha(d.hojaRenunciaExpedida) ? null : 'Falta la fecha de expedición de la hoja oficial de renuncia.');
        let p = null;
        if (!fecha(d.renunciaPresentada)) p = 'Falta la fecha en que presentó la renuncia.';
        else if (fecha(d.hojaRenunciaExpedida)) {
            const n = dias(d.hojaRenunciaExpedida, d.renunciaPresentada);
            if (n < 0) p = 'La renuncia no se puede presentar antes de que se expida la hoja.';
            else if (n > 10) p = `La hoja se presentó ${n} días después de expedida: sólo vale dentro de los 10 días (Art. 402 CT). Hay que pedir una hoja nueva.`;
        }
        exigir('renunciaPresentada', p);
    }

    if (motivo === 'DESPIDO_SIN_RESPONSABILIDAD') {
        const causal = Number(d.causalArt50);
        exigir('causalArt50', CAUSALES_ART_50.some((c) => c.n === causal) ? null : 'Elige la causal del Art. 50 CT.');
        exigir('fechaDeLosHechos', fecha(d.fechaDeLosHechos) ? null : 'Falta la fecha de los hechos.');
        exigir('pruebas', String(d.pruebas || '').trim().length < 15 ? 'Describe las pruebas de la causal (actas, testigos, sanciones previas, cámaras).' : null);
        const ingreso = empleado?.hire_date || empleado?.hireDate;
        exigir('causalArt50', (causal === 1 && ingreso && d.date && dias(ingreso, d.date) > 30)
            ? 'La causal 1 sólo vale dentro de los primeros 30 días de trabajo.' : null);
        if (causal === 12) {
            exigir('diasDeAusencia', ausenciasConfiguranCausal(d.diasDeAusencia, d.diaDeDescanso) ? null
                : 'Para la causal 12 marca las ausencias: 2 días laborales seguidos (si en medio está su día de descanso, dilo arriba), o 3 en un mismo mes.');
        }
    }

    if (motivo === 'ABANDONO') {
        exigir('diasDeAusencia', ausenciasConfiguranCausal(d.diasDeAusencia, d.diaDeDescanso) ? null
            : 'Marca los días que faltó: 2 días laborales seguidos (si en medio está su día de descanso, dilo arriba), o 3 en un mismo mes.');
        exigir('intentoDeContacto', String(d.intentoDeContacto || '').trim().length < 10 ? 'Anota cómo se le intentó contactar (llamadas, mensajes, visita) y cuándo.' : null);
    }
    return lista;
}

/**
 * Lo que la baja exige, un renglón por campo y en el orden de la pantalla:
 * `{ campo, rotulo, problema }` (`problema` null = listo). Es la lista de
 * «lo que falta» que se ve arriba del formulario.
 */
export function requisitosDeBaja(d = {}, empleado = {}) {
    const porCampo = new Map();
    for (const c of comprobacionesDeBaja(d, empleado)) {
        const previo = porCampo.get(c.campo);
        if (!previo) porCampo.set(c.campo, { campo: c.campo, rotulo: ROTULOS_DE_BAJA[c.campo] || c.campo, problema: c.problema });
        else if (!previo.problema && c.problema) previo.problema = c.problema;
    }
    return [...porCampo.values()];
}

/** El primer problema de la baja con su campo, o null. */
export function primerProblemaDeBaja(d = {}, empleado = {}) {
    const c = comprobacionesDeBaja(d, empleado).find((x) => x.problema);
    return c ? { campo: c.campo, problema: c.problema } : null;
}

/**
 * Lo que impide guardar la baja, o null. Los campos vacíos devuelven un motivo
 * corto: en una baja conviene decir QUÉ falta, no sólo apagar el botón.
 *
 * @param {object} d  los datos del formulario
 * @param {object} [empleado]
 */
export function problemaDeBaja(d = {}, empleado = {}) {
    return primerProblemaDeBaja(d, empleado)?.problema ?? null;
}

/** Días entre la renuncia presentada y la fecha de baja, o null si falta una. */
export function diasDePreaviso(d = {}) {
    if (d?.terminationReason !== 'RENUNCIA' || !fecha(d.renunciaPresentada) || !fecha(d.date)) return null;
    return dias(d.renunciaPresentada, d.date);
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
 * @param {{ motivo: string, salarioMensual: number, ingreso: string, baja: string, salarioMinimoMensual: number, preavisoDias?: number|null }} p
 * @returns {{ rubros: Array<{ clave: string, texto: string, monto: number, aplica: true|false|'revisar', base: string }>, total: number, aniosDeServicio: number } | null}
 */
export function liquidacionEstimada({ motivo, salarioMensual, ingreso, baja, salarioMinimoMensual, preavisoDias = null }) {
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
    // Con responsabilidad del patrono (Arts. 187 y 202 CT) o por renuncia
    // (Art. 9 LRPERV) los proporcionales se pagan. Con causa justa o abandono,
    // NO: sólo la vacación de un año ya cumplido que no se gozó (Art. 187, parte
    // final) y el aguinaldo de un 12 de diciembre ya pasado que no se pagó.
    const conProporcionales = despidoInjusto || renuncia;

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
        { clave: 'vacaciones', texto: 'Vacaciones proporcionales', monto: conProporcionales ? redondear(vacaciones) : 0, aplica: conProporcionales,
            base: conProporcionales
                ? `15 días + 30% × ${diasDelAnioEnCurso} de 365 días del año de servicio en curso`
                : 'Con causa justa no se pagan (Art. 187 CT). Si tiene un año cumplido y no gozó esa vacación, ésa sí se paga.' },
        { clave: 'aguinaldo', texto: 'Aguinaldo proporcional', monto: conProporcionales ? redondear(aguinaldo) : 0, aplica: conProporcionales,
            base: conProporcionales
                ? `${diasDeAguinaldo(anios)} días × ${diasAguinaldo} de 365 días desde el 12 de diciembre`
                : 'Con causa justa no se paga (Art. 202 CT). El de un 12 de diciembre ya pasado, si no se pagó, sí.' },
    ];

    // Quincena 25: 50% del salario nominal (sólo hasta $1,500), proporcional a
    // los días desde el último 15 de enero (o desde el ingreso). En el sector
    // privado es obligatoria desde enero de 2027; la prensa dice que lo
    // acumulado va en la liquidación. Sin el instructivo oficial: `revisar`.
    if (sm <= 1500) {
        let inicioQ = `${b.getUTCFullYear()}-01-15`;
        if (baja < inicioQ) inicioQ = `${b.getUTCFullYear() - 1}-01-15`;
        const desdeQ = ingreso > inicioQ ? ingreso : inicioQ;
        const diasQ = Math.min(365, Math.max(0, dias(desdeQ, baja) + 1));
        rubros.push({ clave: 'quincena25', texto: 'Quincena 25 proporcional', monto: redondear(sm * 0.5 * (diasQ / 365)), aplica: 'revisar',
            base: `50% del salario × ${diasQ} de 365 días desde el 15 de enero. Obligatoria desde 2027: confirmar con el contador si va en esta liquidación.` });
    }

    if (despidoInjusto) {
        // Art. 58 CT: 30 días por año (y la fracción), con el salario diario
        // topado en 4 mínimos diarios; nunca menos de 15 días de salario.
        // En los 30 días de prueba (Art. 28 CT, si el contrato lo estipula)
        // cualquiera de las partes termina sin causa y sin indemnización.
        const tope = Math.min(diario, 4 * minDiario);
        const monto = Math.max(30 * tope * anios, 15 * diario);
        const enPrueba = diasServicio <= 30;
        rubros.push({ clave: 'indemnizacion', texto: 'Indemnización por despido (Art. 58 CT)', monto: redondear(monto), aplica: enPrueba ? 'revisar' : true,
            base: enPrueba
                ? 'Está en sus primeros 30 días: si el contrato estipula período de prueba, no hay indemnización (Art. 28 CT).'
                : `30 días × ${anios.toFixed(2)} años, salario diario topado en 4 mínimos; mínimo 15 días` });
    }
    if (renuncia) {
        // LRPERV Art. 5 y 8: desde 2 años de servicio continuo, 15 días por año
        // de servicio, salario diario topado en 2 mínimos diarios. Art. 2: sin
        // el preaviso por escrito (15 días; 30 en jefaturas) no hay derecho.
        const tope = Math.min(diario, 2 * minDiario);
        const conAnios = aniosCompletos >= 2;
        const sinPreaviso = preavisoDias != null && preavisoDias < 15;
        rubros.push({ clave: 'prestacionRenuncia', texto: 'Prestación por renuncia voluntaria', monto: conAnios ? redondear(15 * tope * aniosCompletos) : 0,
            aplica: !conAnios ? false : sinPreaviso ? 'revisar' : true,
            base: !conAnios ? 'Requiere 2 años de servicio continuo (Art. 5 LRPERV)'
                : sinPreaviso ? `Preaviso de ${preavisoDias} días: la ley pide 15 (30 en jefaturas) para tener derecho (Art. 2 LRPERV).`
                    : `15 días × ${aniosCompletos} años completos, salario diario topado en 2 mínimos (Art. 8 LRPERV)` });
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
