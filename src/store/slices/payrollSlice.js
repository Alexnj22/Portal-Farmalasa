import {
    fetchPayrollPeriods as fetchPayrollPeriodsData, insertPayrollPeriod, updatePayrollPeriod,
    fetchPayrollEntriesByPeriod, deletePendingPayrollEntries, insertPayrollEntries, updatePayrollEntry as updatePayrollEntryData,
    fetchTimesheetsForPeriod, fetchApprovedAdvances, fetchVacationPlansOverlapping,
    fetchOvertimeBankRows, deleteEarnedOvertimeBank, insertOvertimeBank,
} from '../../data/payroll';

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
        const { data, error } = await insertPayrollPeriod({
            name:        periodData.name,
            period_type: periodData.period_type || 'QUINCENA',
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

            const employees = (get().employees || []).filter(e => {
                if ((e.status || '').toUpperCase() === 'INACTIVO') return false;
                if (branchId && String(e.branchId || e.branch_id) !== String(branchId)) return false;
                return true;
            });

            // #5 — employees without base_salary generate $0 entries; collect for warning
            const noSalary = employees
                .filter(e => !parseFloat(e.base_salary || 0))
                .map(e => e.name || String(e.id));

            // #2 — Load timesheets including nocturnal + diurnal OT columns
            const { data: sheets, error: sheetsErr } = await fetchTimesheetsForPeriod(period.start_date, period.end_date);
            if (sheetsErr) throw new Error(`No se pudieron cargar los timesheets del período: ${sheetsErr.message}`);

            const daysMap      = new Map();
            const noctMap      = new Map();
            const noctOTMap    = new Map();
            const diurnalOTMap = new Map();
            for (const s of sheets || []) {
                const key = String(s.employee_id);
                if (!daysMap.has(key)) { daysMap.set(key, 0); noctMap.set(key, 0); noctOTMap.set(key, 0); diurnalOTMap.set(key, 0); }
                if (!s.is_absent) daysMap.set(key, daysMap.get(key) + 1);
                noctMap.set(key,   (noctMap.get(key)   || 0) + (s.nocturnal_hours          || 0));
                noctOTMap.set(key, (noctOTMap.get(key) || 0) + (s.nocturnal_overtime_hours  || 0));
                // Diurnal OT = total OT minus the nocturnal portion (they overlap in the timesheet)
                const diurnalOT = Math.max(0, (s.overtime_hours || 0) - (s.nocturnal_overtime_hours || 0));
                diurnalOTMap.set(key, (diurnalOTMap.get(key) || 0) + diurnalOT);
            }

            // #1 — Fix: request type is 'ADVANCE' in DB (was incorrectly querying 'ADELANTO')
            const { data: advances, error: advancesErr } = await fetchApprovedAdvances(period.start_date, period.end_date + 'T23:59:59');
            if (advancesErr) throw new Error(`No se pudieron cargar los anticipos aprobados del período: ${advancesErr.message}`);

            const advanceMap = new Map();
            for (const adv of advances || []) {
                const key = String(adv.employee_id);
                advanceMap.set(key, (advanceMap.get(key) || 0) + parseFloat(adv.metadata?.amount || 0));
            }

            // #7 — Vacation plans overlapping period: those days are paid (not absent)
            const { data: vacPlans, error: vacPlansErr } = await fetchVacationPlansOverlapping(period.end_date, period.start_date);
            if (vacPlansErr) throw new Error(`No se pudieron cargar los planes de vacaciones del período: ${vacPlansErr.message}`);

            const vacDaysMap  = new Map();
            const vacBonusMap = new Map();
            for (const vp of vacPlans || []) {
                const empId = String(vp.employee_id);
                if (!daysMap.has(empId)) continue; // skip if no timesheet data
                const emp = employees.find(e => String(e.id) === empId);
                if (!emp) continue;
                // Days of this plan that fall inside the payroll period
                const planStart = vp.start_date > period.start_date ? vp.start_date : period.start_date;
                const planEnd   = vp.end_date   < period.end_date   ? vp.end_date   : period.end_date;
                const vacDays   = Math.round((new Date(planEnd + 'T12:00:00') - new Date(planStart + 'T12:00:00')) / 86400000) + 1;
                if (vacDays <= 0) continue;
                vacDaysMap.set(empId, (vacDaysMap.get(empId) || 0) + vacDays);
                const dailyRate = parseFloat((parseFloat(emp.base_salary || 0) / 30).toFixed(4));
                vacBonusMap.set(empId, (vacBonusMap.get(empId) || 0) + parseFloat((vacDays * dailyRate * 0.30).toFixed(2)));
            }

            // Period working days (fallback when no timesheets)
            const start    = new Date(period.start_date + 'T12:00:00');
            const end      = new Date(period.end_date   + 'T12:00:00');
            const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

            // Delete existing PENDING entries for this period
            await deletePendingPayrollEntries(periodId);

            const rows = employees.map(emp => {
                const empId      = String(emp.id);
                const hasTS      = daysMap.has(empId);
                const workedDays = hasTS ? daysMap.get(empId) : diffDays;
                const vacDays    = hasTS ? (vacDaysMap.get(empId) || 0) : 0;
                const advance    = advanceMap.get(empId) || 0;
                const noctOrd    = parseFloat((noctMap.get(empId) || 0).toFixed(2));
                const vacBonus   = vacBonusMap.get(empId) || 0;

                // Nocturnal OT goes to the bank — HR decides pay vs compensate
                const calc = calcPayrollEntry(emp, workedDays + vacDays, {
                    salary_advance:       advance,
                    night_hours_ordinary: noctOrd,
                    vacation_bonus:       vacBonus,
                });
                return {
                    period_id:   periodId,
                    employee_id: emp.id,
                    branch_id:   emp.branchId || emp.branch_id || null,
                    status:      'PENDING',
                    ...calc,
                };
            });

            if (rows.length > 0) {
                const { error } = await insertPayrollEntries(rows);
                if (error) throw error;
            }

            // OT Bank — seed EARNED entries for both diurnal and nocturnal OT.
            // Idempotent: delete prior EARNED entries for this period before re-inserting.
            await deleteEarnedOvertimeBank(periodId);
            const bankRows = [];
            for (const emp of employees) {
                const empId    = String(emp.id);
                const diurnal  = parseFloat((diurnalOTMap.get(empId) || 0).toFixed(2));
                const nocturnal = parseFloat((noctOTMap.get(empId)   || 0).toFixed(2));
                if (diurnal  > 0) bankRows.push({ employee_id: emp.id, hours: diurnal,   type: 'EARNED', subtype: 'DIURNAL',   period_id: periodId });
                if (nocturnal > 0) bankRows.push({ employee_id: emp.id, hours: nocturnal, type: 'EARNED', subtype: 'NOCTURNAL', period_id: periodId });
            }
            if (bankRows.length > 0) {
                await insertOvertimeBank(bankRows);
            }

            await get().fetchPayrollEntries(periodId);
            // El recálculo BORRA los renglones pendientes y los vuelve a
            // escribir. Sin registro, un monto que cambió entre dos miradas no
            // tiene explicación posible.
            await get().appendAuditLog('CALCULAR_PLANILLA', periodId, {
                renglones: rows.length, banco_de_horas: bankRows.length,
                sin_salario: noSalary.length,
            });
            return { warnings: noSalary };
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
        const newCalc  = calcPayrollEntry(emp, updates.days_worked ?? existing.days_worked, updates);
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
