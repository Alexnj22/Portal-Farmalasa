import {
    fetchPayrollPeriods as fetchPayrollPeriodsData, insertPayrollPeriod, updatePayrollPeriod,
    fetchPayrollEntriesByPeriod, deletePendingPayrollEntries, insertPayrollEntries, updatePayrollEntry as updatePayrollEntryData,
    fetchTimesheetsForPeriod, fetchApprovedAdvances, fetchVacationPlansOverlapping,
    fetchOvertimeBankRows, deleteEarnedOvertimeBank, insertOvertimeBank, fetchPayrollEntriesNoRegenerables,
    fetchAnticiposYaDescontados, deleteAnticiposDelPeriodo, insertAnticiposEnPlanilla,
    fetchNovedadesParaPlanilla, fetchSolicitudesDeIncapacidad, fetchRenglonesPendientesDeTH,
    updatePendientesDeTH,
} from '../../data/payroll';
import { esPersonalEnPlanilla } from '../../utils/tipoDeFicha';
import { diasEntre } from '../../utils/fecha';
// Las reglas de la quincena (`utils/planilla`) llegan por `import()` dentro de
// cada acción: sólo hacen falta al crear, aprobar o generar una planilla, y
// como import estático viajaban en el ARRANQUE que baja todo el mundo tras cada
// despliegue (2.6 kB gzip, medido el 2026-10-24 con sourcemaps).
const reglasDePlanilla = () => import('../../utils/planilla');

// Lo escrito sobre este módulo:
// `docs/NOMINA-COMO-SE-ARMA-UNA-QUINCENA-2026-08-24.md` — por qué las secciones
// A y B no se pueden mezclar, los factores de los arts. 168/169, el tope del
// ISSS, y el defecto de dinero LATENTE que tenía la tabla de renta anualizada.

// ─── El Salvador ISR (Renta) biweekly table ─────────────────────────────────
// Base: net quincena after ISSS & AFP deductions
// ── La tabla de retención de renta, QUINCENAL ───────────────────────────────
//
// Decreto Ejecutivo No. 10 de 2025, vigente desde la PRIMERA QUINCENA DE MAYO DE
// 2025. Reformó el art. 37 de la Ley de Impuesto sobre la Renta y subió el
// mínimo exento a $550 mensuales ($275 quincenales).
//
// ── Por qué está escrita así, y no anualizando ─────────────────────────────
// Hasta el 2026-08-23 esto anualizaba la base (×24), aplicaba una tabla ANUAL y
// volvía a dividir. Dos problemas:
//
//   1. La tabla anual era la ANTERIOR a la reforma —exento $4.064 al año, o sea
//      $169,33 por quincena— y llevaba desactualizada desde mayo de 2025.
//   2. Le faltaban las CUOTAS FIJAS. El tramo II sumaba sólo el 10% del exceso,
//      sin los $8,83; el III arrancaba en $507,83 en vez de $720,00 anuales. Ni
//      siquiera era internamente consistente: con sus propios números, el tramo
//      IV debía arrancar en $3.250,68 y decía $3.462,47.
//
// La tabla oficial es quincenal, así que se escribe quincenal. Anualizar y
// desanualizar sólo agrega dos redondeos y una oportunidad de que los tramos
// dejen de empalmar.
//
// ── Cuánto costaba ─────────────────────────────────────────────────────────
// Con base gravada de $275,00 el portal retenía $10,57 a alguien que por ley no
// debe pagar nada. Con $500,00 retenía $44,97 contra los $40,48 que
// corresponden. No le pasó a nadie: al descubrirlo no había ni un período de
// planilla generado ni un solo empleado con sueldo cargado. Era un defecto
// latente, y de dinero.
//
// ⚠️ Al cambiar la ley se cambia ESTA constante, y `payroll.test.js` la vigila
// tramo por tramo, incluidos los bordes exactos.
export const TRAMOS_RENTA_QUINCENAL = [
    { hasta: 275.00,     cuotaFija: 0,      tasa: 0,    sobreExceso: 0 },
    { hasta: 447.62,     cuotaFija: 8.83,   tasa: 0.10, sobreExceso: 275.00 },
    { hasta: 1019.05,    cuotaFija: 30.00,  tasa: 0.20, sobreExceso: 447.62 },
    { hasta: Infinity,   cuotaFija: 144.28, tasa: 0.30, sobreExceso: 1019.05 },
];

export function calcRenta(netQuincena) {
    const base = Number(netQuincena) || 0;
    if (base <= 0) return 0;
    const t = TRAMOS_RENTA_QUINCENAL.find(x => base <= x.hasta);
    return parseFloat((t.cuotaFija + (base - t.sobreExceso) * t.tasa).toFixed(2));
}

// ─── Core payroll calculator for one employee ────────────────────────────────
export function calcPayrollEntry(emp, daysWorked, overrides = {}) {
    const monthlySalary = parseFloat(emp.base_salary || 0);
    const dailyRate     = parseFloat((monthlySalary / 30).toFixed(4));
    const hourlyRate    = parseFloat((dailyRate / 8).toFixed(4));

    const nightOrdinaryHrs  = parseFloat(overrides.night_hours_ordinary  || 0);
    const nightExtraHrs     = parseFloat(overrides.night_hours_extra      || 0);
    const extraDiurnalHrs   = parseFloat(overrides.extra_hours_diurnal    || 0);
    const extraNocturnalHrs = parseFloat(overrides.extra_hours_nocturnal  || 0);
    const holidaySurcharge  = parseFloat(overrides.holiday_surcharge      || 0);
    const bonifications     = parseFloat(overrides.bonifications          || 0);
    const vacationBonus     = parseFloat(overrides.vacation_bonus         || 0);
    const viaticos          = parseFloat(overrides.viaticos               || 0);
    const orderDiscount     = parseFloat(overrides.order_discount         || 0);
    const otherDiscounts    = parseFloat(overrides.other_discounts        || 0);
    const salaryAdvance     = parseFloat(overrides.salary_advance         || 0);

    // Section A — subject to retention
    const ordinarySalary = parseFloat((daysWorked * dailyRate).toFixed(2));

    // Section B — not subject to retention (Labor Code art. 169, 190)
    const nightOrdinaryAmt  = parseFloat((nightOrdinaryHrs  * hourlyRate * 0.25).toFixed(2)); // Art.168: solo el 25% de recargo sobre tarifa diurna
    const nightExtraAmt     = parseFloat((nightExtraHrs     * hourlyRate * 0.50).toFixed(2)); // campo legacy — no usado por consolidación automática
    const extraDiurnalAmt   = parseFloat((extraDiurnalHrs   * hourlyRate * 2.00).toFixed(2)); // Art.169: 100% OT diurna = doble
    const extraNocturnalAmt = parseFloat((extraNocturnalHrs * hourlyRate * 2.25).toFixed(2)); // Art.169: 100% OT + 25% nocturnal = ×2.25

    const subtotalA = ordinarySalary;
    const subtotalB = parseFloat((
        nightOrdinaryAmt + nightExtraAmt + extraDiurnalAmt + extraNocturnalAmt +
        holidaySurcharge + bonifications + vacationBonus + viaticos
    ).toFixed(2));

    // Retenciones
    const isssBase    = Math.min(ordinarySalary, 500);  // ISSS cap: $1,000/mo → $500/quincena
    const isssDeduct  = parseFloat((isssBase * 0.03).toFixed(2));
    const afpDeduct   = parseFloat((ordinarySalary * 0.0725).toFixed(2));
    const rentaBase   = parseFloat((ordinarySalary - isssDeduct - afpDeduct).toFixed(2));
    const rentaDeduct = calcRenta(rentaBase);

    const totalDeductions = parseFloat((
        isssDeduct + afpDeduct + rentaDeduct +
        orderDiscount + otherDiscounts + salaryAdvance
    ).toFixed(2));

    const netPay = parseFloat((subtotalA - totalDeductions + subtotalB).toFixed(2));

    return {
        days_worked:           daysWorked,
        ordinary_salary:       ordinarySalary,
        night_hours_ordinary:  nightOrdinaryHrs,
        night_hours_extra:     nightExtraHrs,
        extra_hours_diurnal:   extraDiurnalHrs,
        extra_hours_nocturnal: extraNocturnalHrs,
        holiday_surcharge:     holidaySurcharge,
        bonifications,
        vacation_bonus:        vacationBonus,
        viaticos,
        viaticos_detail:       overrides.viaticos_detail || null,
        isss_deduction:        isssDeduct,
        afp_deduction:         afpDeduct,
        renta_deduction:       rentaDeduct,
        order_discount:        orderDiscount,
        other_discounts:       otherDiscounts,
        salary_advance:        salaryAdvance,
        subtotal_a:            subtotalA,
        subtotal_b:            subtotalB,
        total_deductions:      totalDeductions,
        net_pay:               netPay,
    };
}

// ─── Slice ───────────────────────────────────────────────────────────────────
export const createPayrollSlice = (set, get) => ({
    payrollPeriods: [],
    activePayrollPeriod: null,
    payrollEntries: [],
    isLoadingPayroll: false,

    // ── Periods ──────────────────────────────────────────────────────────────

    fetchPayrollPeriods: async () => {
        const { data, error } = await fetchPayrollPeriodsData();
        if (error) { console.error(error); return []; }
        set({ payrollPeriods: data || [] });
        return data || [];
    },

    createPayrollPeriod: async (periodData) => {
        const user = get().user;
        // Una quincena es 1–15 o 16–fin de mes (decisión del dueño, 2026-10-22).
        // La base tiene el mismo CHECK; esto es para decirlo en palabras.
        const tipo = periodData.period_type || 'QUINCENA';
        const { problemaDeQuincena, rotuloDePeriodo } = await reglasDePlanilla();
        const problema = tipo === 'QUINCENA' ? problemaDeQuincena(periodData.start_date, periodData.end_date) : null;
        if (problema) {
            const e = new Error(problema);
            Object.assign(e, { userFacing: true });
            throw e;
        }
        // `name` es NOT NULL y el formulario del portal no lo mandaba: el
        // rótulo se calcula acá («Primera Quincena de octubre 2026»), el mismo
        // que se pinta en pantalla.
        const { data, error } = await insertPayrollPeriod({
            name:        periodData.name || rotuloDePeriodo(periodData.start_date, periodData.end_date),
            period_type: tipo,
            start_date:  periodData.start_date,
            end_date:    periodData.end_date,
            pay_date:    periodData.pay_date || null,
            branch_id:   periodData.branch_id || null,
            status:      'DRAFT',
            created_by:  user?.id || null,
        });
        if (error) throw error;
        set(s => ({ payrollPeriods: [data, ...s.payrollPeriods] }));
        // La planilla mueve dinero y no dejaba rastro de nada: ni de quién abrió
        // el período, ni de quién lo aprobó, ni de quién lo dio por pagado.
        await get().appendAuditLog('CREAR_PERIODO_PLANILLA', data?.id ?? null, {
            nombre: data?.name, tipo: data?.period_type,
            desde: data?.start_date, hasta: data?.end_date, sucursal_id: data?.branch_id ?? null,
        });
        return data;
    },

    updatePayrollPeriodStatus: async (periodId, status) => {
        const user = get().user;
        // Talento Humano tiene la última palabra sobre incapacidades y
        // suspensiones (decisiones del dueño, 2026-10-22): con días sin
        // decisión, la planilla no se aprueba — ni se pagan ni se descuentan
        // en silencio.
        if (status === 'APPROVED') {
            const { data: conPendiente, error: pendErr } = await fetchRenglonesPendientesDeTH(periodId);
            if (pendErr) throw new Error(`No se pudo revisar si quedan decisiones de Talento Humano: ${pendErr.message}`);
            const { mensajeDePendientesDeTH } = await reglasDePlanilla();
            const msg = mensajeDePendientesDeTH(conPendiente);
            if (msg) {
                const e = new Error(msg);
                Object.assign(e, { userFacing: true });
                throw e;
            }
        }
        const updatePayload = { status, updated_at: new Date().toISOString() };
        if (status === 'APPROVED') {
            updatePayload.approved_by = user?.id;
            updatePayload.approved_at = new Date().toISOString();
        }
        if (status === 'PAID') {
            updatePayload.paid_by = user?.id;
            updatePayload.paid_at = new Date().toISOString();
        }
        const { error } = await updatePayrollPeriod(periodId, updatePayload);
        if (error) throw error;
        set(s => ({
            payrollPeriods: s.payrollPeriods.map(p =>
                p.id === periodId ? { ...p, ...updatePayload } : p
            ),
            activePayrollPeriod: s.activePayrollPeriod?.id === periodId
                ? { ...s.activePayrollPeriod, ...updatePayload }
                : s.activePayrollPeriod,
        }));
        // Aprobar y dar por pagado son las dos decisiones que autorizan una
        // salida de dinero. La columna `approved_by` guarda QUIÉN, pero se pisa
        // en el siguiente cambio de estado: la bitácora es lo único que conserva
        // la secuencia.
        await get().appendAuditLog('CAMBIAR_ESTADO_PLANILLA', periodId, {
            estado: status,
            severity: (status === 'APPROVED' || status === 'PAID') ? 'CRITICAL' : undefined,
        });
    },

    // ── Entries ───────────────────────────────────────────────────────────────

    fetchPayrollEntries: async (periodId) => {
        set({ isLoadingPayroll: true });
        const { data, error } = await fetchPayrollEntriesByPeriod(periodId);
        if (error) { console.error(error); set({ isLoadingPayroll: false }); return []; }

        const employees = get().employees || [];
        const enriched = (data || []).map(e => ({
            ...e,
            employee: employees.find(emp => String(emp.id) === String(e.employee_id)) || null,
        }));
        set({ payrollEntries: enriched, isLoadingPayroll: false });
        return enriched;
    },

    generatePayrollEntries: async (periodId, branchId = null) => {
        set({ isLoadingPayroll: true });
        try {
            const period = get().payrollPeriods.find(p => p.id === periodId);
            if (!period) throw new Error('Período no encontrado');
            const {
                anticiposDeLaQuincena, bajasEnQuincena, contratoEnQuincena, diasPagadosDeQuincena,
                incapacidadesPorPersona, problemaDeQuincena, suspensionesPorPersona,
            } = await reglasDePlanilla();

            // Sólo se genera sobre un BORRADOR. La pantalla ofrecía «Regenerar»
            // también con el período aprobado, y esto no miraba el estado: los
            // montos de una planilla ya autorizada cambiaban y el período seguía
            // diciendo «Aprobada» (auditoría 2026-10-21). Una corrección sobre
            // una aprobada se hace renglón por renglón (queda EDITED, con motivo).
            if ((period.status || 'DRAFT') !== 'DRAFT') {
                const e = new Error('Esta planilla ya fue aprobada y no se vuelve a calcular entera. Si hay que corregir a alguien, edita su renglón.');
                Object.assign(e, { userFacing: true });
                throw e;
            }

            // Los días que se pagan suponen una quincena 1–15 o 16–fin de mes:
            // 15 días de sueldo diario = la mitad del mensual.
            if ((period.period_type || 'QUINCENA') === 'QUINCENA') {
                const problema = problemaDeQuincena(period.start_date, period.end_date);
                if (problema) {
                    const e = new Error(`Este período no es una quincena: ${problema}`);
                    Object.assign(e, { userFacing: true });
                    throw e;
                }
            }

            // `esPersonalEnPlanilla` primero, y no es cosmético: acá se GENERA la
            // planilla. Sin ese filtro, «QA Testing» y el «Contador Externo»
            // recibían su renglón de nómina —en $0, porque no tienen salario
            // base, y de paso entraban al aviso de «sin salario base»—. Una
            // cuenta de pruebas con renglón en la planilla es justo el registro
            // que no puede existir. Ver `utils/tipoDeFicha.js`.
            //
            // Ingreso o salida a mitad de quincena (decisión del dueño,
            // 2026-10-22: «según días trabajados»): se paga sólo lo contratado.
            // Quien se dio de baja DENTRO de la quincena ya figura INACTIVO pero
            // trabajó días de ella: entra igual, con sus días.
            const rango = { start: period.start_date, end: period.end_date };
            const { data: novedades, error: novedadesErr } = await fetchNovedadesParaPlanilla(period.start_date, period.end_date);
            if (novedadesErr) throw new Error(`No se pudieron cargar las incapacidades y bajas del período: ${novedadesErr.message}`);
            const { data: solicitudesInc, error: solicitudesIncErr } = await fetchSolicitudesDeIncapacidad(period.start_date, period.end_date);
            if (solicitudesIncErr) throw new Error(`No se pudieron cargar las solicitudes de incapacidad: ${solicitudesIncErr.message}`);
            const bajas = bajasEnQuincena(novedades, rango);
            const incapacidades = incapacidadesPorPersona(novedades, solicitudesInc);
            const suspensiones = suspensionesPorPersona(novedades);
            const contratoDe = new Map();
            const employees = (get().employees || []).filter(e => {
                if (!esPersonalEnPlanilla(e)) return false;
                const baja = bajas.get(String(e.id)) || null;
                if ((e.status || '').toUpperCase() === 'INACTIVO' && !baja) return false;
                if (branchId && String(e.branchId || e.branch_id) !== String(branchId)) return false;
                const contrato = contratoEnQuincena(rango, e.hireDate || e.hire_date || null, baja);
                if (contrato.dias <= 0) return false;
                contratoDe.set(String(e.id), contrato);
                return true;
            });

            // ── Antes de borrar nada: ¿este navegador puede VER los sueldos? ──
            //
            // `base_salary` no viene con la fila: lo trae `get_employee_salarios`,
            // cuya llave es `staff_salary`. La de esta pantalla es `payroll`. Son
            // DOS llaves distintas, así que la combinación «puede generar la
            // planilla y no puede ver un sueldo» existe y la pantalla de Permisos
            // la arma con dos clics.
            //
            // Y el daño no sería un renglón mal calculado: unas líneas más abajo
            // esto BORRA los `PENDING` del período y los reinserta, así que
            // generar sin la llave cambia un borrador correcto por 46 renglones
            // en $0.00 — con la advertencia de «sin salario base» encendida, que
            // se lee como un problema de datos y no como uno de permisos.
            //
            // `salario_conocido` lo pone el store desde la RESPUESTA del servidor
            // y no desde el permiso: la función devuelve la fila aunque el sueldo
            // esté vacío, así que la marca distingue «no me dejaron mirar» de
            // «miré y no hay». Sin ella, las dos se ven igual.
            //
            // El mensaje NO afirma cuál de las dos causas fue. La marca dice
            // «no llegaron los sueldos» y eso pasa por falta de permiso o
            // porque la consulta falló —`fetchBoot` la envuelve en un `catch`
            // para que un hipo de red no deje al portal sin empleados—. Nombrar
            // la primera cuando fue la segunda manda a pedir un permiso que ya
            // se tiene, que es el modo de falla que este trabajo viene cerrando.
            if (employees.length && !employees.some(e => e.salario_conocido)) {
                const e = new Error('No llegaron los sueldos, así que la quincena saldría en cero y no se generó. Suele ser el permiso de «Salarios e ingresos»; si ya lo tienes, vuelve a entrar al portal e intenta de nuevo.');
                Object.assign(e, { userFacing: true });
                throw e;
            }

            // #5 — employees without base_salary generate $0 entries; collect for warning
            const noSalary = employees
                .filter(e => !parseFloat(e.base_salary || 0))
                .map(e => e.name || String(e.id));

            // #2 — Load timesheets including nocturnal + diurnal OT columns
            const { data: sheets, error: sheetsErr } = await fetchTimesheetsForPeriod(period.start_date, period.end_date);
            if (sheetsErr) throw new Error(`No se pudieron cargar los timesheets del período: ${sheetsErr.message}`);

            // Los días que se pagan NO salen de contar marcaciones: la quincena
            // paga 15 días (la mitad del mensual) menos las ausencias que se
            // descuentan — `diasPagadosDeQuincena`, núcleo. Contar filas
            // trabajadas dejaba sin pagar el descanso semanal y los asuetos, y
            // sin marcaciones pagaba los días de calendario (H3, 2026-10-21).
            const tsPorPersona = new Map();
            const noctMap      = new Map();
            const noctOTMap    = new Map();
            const diurnalOTMap = new Map();
            for (const s of sheets || []) {
                const key = String(s.employee_id);
                if (!tsPorPersona.has(key)) { tsPorPersona.set(key, []); noctMap.set(key, 0); noctOTMap.set(key, 0); diurnalOTMap.set(key, 0); }
                tsPorPersona.get(key).push(s);
                noctMap.set(key,   (noctMap.get(key)   || 0) + (s.nocturnal_hours          || 0));
                noctOTMap.set(key, (noctOTMap.get(key) || 0) + (s.nocturnal_overtime_hours  || 0));
                // Diurnal OT = total OT minus the nocturnal portion (they overlap in the timesheet)
                const diurnalOT = Math.max(0, (s.overtime_hours || 0) - (s.nocturnal_overtime_hours || 0));
                diurnalOTMap.set(key, (diurnalOTMap.get(key) || 0) + diurnalOT);
            }

            // Anticipos: los aprobados en un día de ESTA quincena (hora de El
            // Salvador) y que no se descontaron ya en otra. Antes se elegían por
            // cuándo se pidieron: uno pedido el 14 y aprobado el 17 no se
            // descontaba nunca (H5, 2026-10-21).
            const { data: advances, error: advancesErr } = await fetchApprovedAdvances(period.start_date, period.end_date);
            if (advancesErr) throw new Error(`No se pudieron cargar los anticipos aprobados del período: ${advancesErr.message}`);
            const { data: ligados, error: ligadosErr } = await fetchAnticiposYaDescontados((advances || []).map(a => a.id));
            if (ligadosErr) throw new Error(`No se pudo saber qué anticipos ya se descontaron: ${ligadosErr.message}`);
            const advanceMap = anticiposDeLaQuincena(advances,
                { periodId, start: period.start_date, end: period.end_date },
                new Map((ligados || []).map(l => [String(l.request_id), String(l.period_id)])),
                get().payrollPeriods);

            // #7 — Vacaciones dentro del período: los días ya van dentro de los
            // 15 pagados; acá sólo sale el recargo del 30% (Art. 177).
            const { data: vacPlans, error: vacPlansErr } = await fetchVacationPlansOverlapping(period.end_date, period.start_date);
            if (vacPlansErr) throw new Error(`No se pudieron cargar los planes de vacaciones del período: ${vacPlansErr.message}`);

            const vacBonusMap = new Map();
            for (const vp of vacPlans || []) {
                const empId = String(vp.employee_id);
                if (!tsPorPersona.has(empId)) continue; // skip if no timesheet data
                const emp = employees.find(e => String(e.id) === empId);
                if (!emp) continue;
                // Days of this plan that fall inside the payroll period
                const planStart = vp.start_date > period.start_date ? vp.start_date : period.start_date;
                const planEnd   = vp.end_date   < period.end_date   ? vp.end_date   : period.end_date;
                const vacDays   = diasEntre(planStart, planEnd) + 1;
                if (vacDays <= 0) continue;
                const dailyRate = parseFloat((parseFloat(emp.base_salary || 0) / 30).toFixed(4));
                vacBonusMap.set(empId, (vacBonusMap.get(empId) || 0) + parseFloat((vacDays * dailyRate * 0.30).toFixed(2)));
            }

            // ── Órdenes de descuento (2026-10-17) ─────────────────────────────
            // Se leían a mano renglón por renglón: una orden vigente en la ficha
            // no llegaba a la planilla. Antes de BORRAR los pendientes, igual que
            // lo demás de arriba: si la lectura falla, se para acá y el borrador
            // que había queda intacto. La regla del monto vive en
            // `cuotaDeLaQuincena` y sólo ahí.
            // Por `import()`: sólo hacen falta al generar la planilla, y como
            // import estático viajaban en el entry que baja todo el mundo
            // (~7 kB con `bancos`, medido el 2026-10-21 con gate:bundle).
            const [{ fetchOrdenesVigentes }, { descuentosPorOrdenes }] = await Promise.all([
                import('../../data/ordenesDeDescuento'),
                import('../../utils/ordenDeDescuento'),
            ]);
            const ordenesVigentes = await fetchOrdenesVigentes();
            const ordenMap = descuentosPorOrdenes(ordenesVigentes, period.start_date);

            // Quién ya tiene un renglón editado (u otro no-PENDING): ése se
            // respeta y NO se reinserta. Antes se borraban sólo los PENDING y se
            // reinsertaba a TODOS: el editado chocaba con UNIQUE (period_id,
            // employee_id), el insert fallaba entero y la planilla quedaba con
            // un solo renglón (auditoría 2026-10-21).
            const { data: fijos, error: fijosErr } = await fetchPayrollEntriesNoRegenerables(periodId);
            if (fijosErr) throw new Error(`No se pudieron leer los renglones ya editados: ${fijosErr.message}`);
            const yaFijados = new Set((fijos || []).map(f => String(f.employee_id)));

            // Con filtro de sucursal se borra SÓLO lo de esas personas: antes
            // `deletePendingPayrollEntries(periodId)` vaciaba los PENDING de la
            // red entera y se reinsertaban los de una sola sucursal.
            const idsDelAlcance = branchId ? employees.map(e => e.id) : null;
            if (idsDelAlcance && idsDelAlcance.length === 0) {
                const e = new Error('Esa sucursal no tiene personal en planilla: no hay nada que generar.');
                Object.assign(e, { userFacing: true });
                throw e;
            }
            const { error: delErr } = await deletePendingPayrollEntries(periodId, idsDelAlcance);
            if (delErr) throw new Error(`No se pudieron quitar los renglones pendientes: ${delErr.message}`);

            // Los días que Talento Humano todavía tiene que decidir, con la
            // misma regla para renglones nuevos y editados.
            const diasDe = (empId) => {
                const contrato = contratoDe.get(empId);
                const inc = incapacidades.get(empId);
                return diasPagadosDeQuincena(tsPorPersona.get(empId), {
                    contratados: contrato.dias, desde: contrato.desde, hasta: contrato.hasta,
                    incapacidadesValidadas: inc?.validadas, incapacidadesPendientes: inc?.pendientes,
                    suspensiones: suspensiones.get(empId),
                });
            };

            const aRegenerar = employees.filter(emp => !yaFijados.has(String(emp.id)));

            // Los anticipos que este período había ligado a quienes se
            // regeneran se sueltan y se vuelven a ligar abajo; los de renglones
            // editados se quedan, igual que su renglón.
            if (aRegenerar.length) {
                const { error: soltarErr } = await deleteAnticiposDelPeriodo(periodId, aRegenerar.map(e => e.id));
                if (soltarErr) throw new Error(`No se pudieron rehacer los anticipos del período: ${soltarErr.message}`);
            }

            const rows = aRegenerar.map(emp => {
                const empId      = String(emp.id);
                // Las vacaciones ya están dentro de los 15 días: son ausencias
                // con tipo y no se descuentan. Sumarlas aparte las pagaría dos veces.
                const { dias, pendientes, suspensionPendiente } = diasDe(empId);
                const advance    = advanceMap.get(empId)?.monto || 0;
                const noctOrd    = parseFloat((noctMap.get(empId) || 0).toFixed(2));
                const vacBonus   = vacBonusMap.get(empId) || 0;

                // Nocturnal OT goes to the bank — HR decides pay vs compensate
                const calc = calcPayrollEntry(emp, dias, {
                    salary_advance:       advance,
                    night_hours_ordinary: noctOrd,
                    vacation_bonus:       vacBonus,
                    order_discount:       ordenMap.get(empId) || 0,
                });
                return {
                    period_id:   periodId,
                    employee_id: emp.id,
                    branch_id:   emp.branchId || emp.branch_id || null,
                    status:      'PENDING',
                    ...calc,
                    // Días que Talento Humano todavía no decidió —incapacidad
                    // sin validar, suspensión sin decir si lleva descuento—: no
                    // se descuentan, pero el renglón lo muestra y la planilla
                    // no se aprueba.
                    incapacidad_pendiente_dias: pendientes,
                    suspension_pendiente_dias:  suspensionPendiente,
                };
            });

            // Los renglones editados no se recalculan, pero las marcas de
            // «pendiente de Talento Humano» sí se refrescan: si no, una decisión
            // posterior nunca destrabaría la aprobación.
            for (const emp of employees.filter(e => yaFijados.has(String(e.id)))) {
                const { pendientes, suspensionPendiente } = diasDe(String(emp.id));
                const { error: marcaErr } = await updatePendientesDeTH(periodId, emp.id, { incapacidad: pendientes, suspension: suspensionPendiente });
                if (marcaErr) throw new Error(`No se pudo actualizar lo pendiente de Talento Humano en un renglón editado: ${marcaErr.message}`);
            }

            // Antes que los renglones: el UNIQUE (request_id) es lo que impide
            // que dos quincenas generadas a la vez descuenten el mismo anticipo.
            const ligar = aRegenerar.flatMap(emp => (advanceMap.get(String(emp.id))?.solicitudes || [])
                .map(s => ({ request_id: s.id, period_id: periodId, employee_id: emp.id, monto: s.monto })));
            if (ligar.length) {
                const { error: ligarErr } = await insertAnticiposEnPlanilla(ligar);
                if (ligarErr) {
                    if (ligarErr.code === '23505') {
                        const e = new Error('Un anticipo ya se descontó en otra quincena mientras se generaba esta. Vuelve a generar la planilla.');
                        Object.assign(e, { userFacing: true });
                        throw e;
                    }
                    throw new Error(`No se pudieron registrar los anticipos descontados: ${ligarErr.message}`);
                }
            }

            if (rows.length > 0) {
                const { error } = await insertPayrollEntries(rows);
                if (error) throw error;
            }

            // OT Bank — seed EARNED entries for both diurnal and nocturnal OT.
            // Idempotent: delete prior EARNED entries for this period before re-inserting.
            // Los dos con su `error`: si el insert fallaba, las horas EARNED de la
            // quincena desaparecían y la pantalla decía «generada» igual.
            const { error: delBankErr } = await deleteEarnedOvertimeBank(periodId, idsDelAlcance);
            if (delBankErr) throw new Error(`No se pudo rehacer el banco de horas: ${delBankErr.message}`);
            const bankRows = [];
            for (const emp of employees) {
                const empId    = String(emp.id);
                const diurnal  = parseFloat((diurnalOTMap.get(empId) || 0).toFixed(2));
                const nocturnal = parseFloat((noctOTMap.get(empId)   || 0).toFixed(2));
                if (diurnal  > 0) bankRows.push({ employee_id: emp.id, hours: diurnal,   type: 'EARNED', subtype: 'DIURNAL',   period_id: periodId });
                if (nocturnal > 0) bankRows.push({ employee_id: emp.id, hours: nocturnal, type: 'EARNED', subtype: 'NOCTURNAL', period_id: periodId });
            }
            if (bankRows.length > 0) {
                const { error: bankErr } = await insertOvertimeBank(bankRows);
                if (bankErr) throw new Error(`Los renglones se generaron, pero no se pudo guardar el banco de horas: ${bankErr.message}. Vuelve a generar la planilla.`);
            }

            await get().fetchPayrollEntries(periodId);
            // El recálculo BORRA los renglones pendientes y los vuelve a
            // escribir. Sin registro, un monto que cambió entre dos miradas no
            // tiene explicación posible.
            await get().appendAuditLog('CALCULAR_PLANILLA', periodId, {
                renglones: rows.length, banco_de_horas: bankRows.length,
                sucursal: branchId || null, editados_respetados: yaFijados.size,
                sin_salario: noSalary.length,
                con_orden_de_descuento: rows.filter(r => r.order_discount > 0).length,
                anticipos_descontados: ligar.length,
                anticipos_rezagados: aRegenerar.reduce((n, e) => n + (advanceMap.get(String(e.id))?.solicitudes || []).filter(x => x.rezagado).length, 0),
                con_incapacidad_pendiente: rows.filter(r => r.incapacidad_pendiente_dias > 0).length,
                con_suspension_sin_decidir: rows.filter(r => r.suspension_pendiente_dias > 0).length,
                ingreso_o_baja_en_quincena: [...contratoDe.values()].filter(c => c.dias < 15).length,
            });
            return {
                warnings: noSalary,
                incapacidadesPendientes: rows.filter(r => r.incapacidad_pendiente_dias > 0).length,
                suspensionesSinDecidir: rows.filter(r => r.suspension_pendiente_dias > 0).length,
            };
        } catch (err) {
            console.error('Error generating payroll:', err);
            set({ isLoadingPayroll: false });
            throw err;
        }
    },

    // ── OT Bank ───────────────────────────────────────────────────────────────

    fetchOvertimeBankBalance: async (employeeId) => {
        const { data, error } = await fetchOvertimeBankRows(employeeId);
        if (error) console.error('fetchOvertimeBankBalance failed:', error.message);
        let pending = 0;
        for (const row of data || []) {
            if (row.type === 'EARNED') pending += row.hours;
            else                       pending -= row.hours;
        }
        return parseFloat(Math.max(0, pending).toFixed(2));
    },

    redeemOvertimeBank: async (employeeId, hours, type, subtype, periodId, notes, createdBy) => {
        const { error } = await insertOvertimeBank({
            employee_id: employeeId,
            hours:       parseFloat(hours.toFixed(2)),
            type,
            subtype:     subtype || 'DIURNAL',
            period_id:   periodId || null,
            notes:       notes || null,
            created_by:  createdBy || null,
        });
        if (error) throw error;
        // Canjear horas es convertir tiempo trabajado en tiempo libre o en pago.
        await get().appendAuditLog('MOVER_BANCO_DE_HORAS', employeeId, {
            horas: parseFloat(hours.toFixed(2)), tipo: type, subtipo: subtype || 'DIURNAL',
            periodo_id: periodId || null, nota: notes || null,
        });
    },

    updatePayrollEntry: async (entryId, updates, editedBy, editReason) => {
        const existing = get().payrollEntries.find(e => e.id === entryId);
        if (!existing) return false;

        const emp      = existing.employee;
        // Mismo freno que al generar: sin la llave de «Salarios e ingresos» el
        // sueldo llega vacío y el recálculo guardaba `ordinary_salary = 0`, con
        // ISSS, AFP y renta en cero (auditoría 2026-10-21).
        if (!emp?.salario_conocido) {
            const e = new Error('No llegó el sueldo de esta persona, así que el renglón se recalcularía en cero y no se guardó. Suele ser el permiso de «Salarios e ingresos»; si ya lo tienes, vuelve a entrar al portal e intenta de nuevo.');
            Object.assign(e, { userFacing: true });
            throw e;
        }
        const newCalc  = calcPayrollEntry(emp, updates.days_worked ?? existing.days_worked, updates);
        // «Otros descuentos» lleva su motivo (la base lo exige igual; acá se
        // dice en palabras antes de que el CHECK lo rechace).
        const conDescuento = newCalc.other_discounts > 0;
        const concepto = conDescuento ? (updates.other_discounts_concepto ?? existing.other_discounts_concepto ?? null) : null;
        const detalle  = conDescuento ? (String(updates.other_discounts_detalle ?? existing.other_discounts_detalle ?? '').trim() || null) : null;
        const { problemaDeOtrosDescuentos } = await reglasDePlanilla();
        const problema = problemaDeOtrosDescuentos(newCalc.other_discounts, concepto, detalle);
        if (problema) throw Object.assign(new Error(problema), { userFacing: true });
        const editSnap = {
            at:     new Date().toISOString(),
            by:     editedBy,
            reason: editReason,
            before: {
                days_worked:    existing.days_worked,
                ordinary_salary: existing.ordinary_salary,
                net_pay:        existing.net_pay,
                viaticos:       existing.viaticos,
            },
        };
        const editHistory = [...(existing.edit_history || []), editSnap];

        const payload = {
            ...newCalc,
            viaticos_detail: updates.viaticos_detail ?? existing.viaticos_detail,
            other_discounts_concepto: concepto,
            other_discounts_detalle:  concepto === 'otro' ? detalle : null,
            status:       'EDITED',
            edit_history: editHistory,
            updated_at:   new Date().toISOString(),
        };

        const { error } = await updatePayrollEntryData(entryId, payload);
        if (error) { console.error(error); return false; }

        set(s => ({
            payrollEntries: s.payrollEntries.map(e =>
                e.id === entryId
                    ? { ...e, ...payload, employee: e.employee }
                    : e
            ),
        }));
        return true;
    },
});
