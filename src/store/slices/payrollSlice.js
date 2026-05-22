import { supabase } from '../../supabaseClient';

// ─── El Salvador ISR (Renta) biweekly table ─────────────────────────────────
// Base: net quincena after ISSS & AFP deductions
function calcRenta(netQuincena) {
    // Annualize → apply table → de-annualize
    const annual = netQuincena * 24;
    let annualTax = 0;
    if (annual <= 4064)            annualTax = 0;
    else if (annual <= 9142.86)    annualTax = (annual - 4064) * 0.10;
    else if (annual <= 22857.14)   annualTax = 507.83 + (annual - 9142.87) * 0.20;
    else                           annualTax = 3462.47 + (annual - 22857.14) * 0.30;
    return parseFloat((annualTax / 24).toFixed(2));
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
        const { data, error } = await supabase
            .from('payroll_periods')
            .select('*')
            .order('start_date', { ascending: false });
        if (error) { console.error(error); return []; }
        set({ payrollPeriods: data || [] });
        return data || [];
    },

    createPayrollPeriod: async (periodData) => {
        const user = get().user;
        const { data, error } = await supabase
            .from('payroll_periods')
            .insert([{
                name:        periodData.name,
                period_type: periodData.period_type || 'QUINCENA',
                start_date:  periodData.start_date,
                end_date:    periodData.end_date,
                pay_date:    periodData.pay_date || null,
                branch_id:   periodData.branch_id || null,
                status:      'DRAFT',
                created_by:  user?.id || null,
            }])
            .select()
            .single();
        if (error) throw error;
        set(s => ({ payrollPeriods: [data, ...s.payrollPeriods] }));
        return data;
    },

    updatePayrollPeriodStatus: async (periodId, status, _meta = {}) => {
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
        const { error } = await supabase
            .from('payroll_periods')
            .update(updatePayload)
            .eq('id', periodId);
        if (error) throw error;
        set(s => ({
            payrollPeriods: s.payrollPeriods.map(p =>
                p.id === periodId ? { ...p, ...updatePayload } : p
            ),
            activePayrollPeriod: s.activePayrollPeriod?.id === periodId
                ? { ...s.activePayrollPeriod, ...updatePayload }
                : s.activePayrollPeriod,
        }));
    },

    // ── Entries ───────────────────────────────────────────────────────────────

    fetchPayrollEntries: async (periodId) => {
        set({ isLoadingPayroll: true });
        const { data, error } = await supabase
            .from('payroll_entries')
            .select('*')
            .eq('period_id', periodId)
            .order('created_at', { ascending: true });
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
            const { data: sheets } = await supabase
                .from('timesheets')
                .select('employee_id, is_absent, work_date, nocturnal_hours, nocturnal_overtime_hours, overtime_hours')
                .gte('work_date', period.start_date)
                .lte('work_date', period.end_date);

            const daysMap   = new Map();
            const noctMap   = new Map();
            const noctOTMap = new Map();
            const diurnalOTMap = new Map();
            for (const s of sheets || []) {
                const key = String(s.employee_id);
                if (!daysMap.has(key)) { daysMap.set(key, 0); noctMap.set(key, 0); noctOTMap.set(key, 0); diurnalOTMap.set(key, 0); }
                if (!s.is_absent) daysMap.set(key, daysMap.get(key) + 1);
                noctMap.set(key,      (noctMap.get(key)      || 0) + (s.nocturnal_hours          || 0));
                noctOTMap.set(key,    (noctOTMap.get(key)    || 0) + (s.nocturnal_overtime_hours || 0));
                diurnalOTMap.set(key, (diurnalOTMap.get(key) || 0) + (s.overtime_hours           || 0));
            }

            // #1 — Fix: request type is 'ADVANCE' in DB (was incorrectly querying 'ADELANTO')
            const { data: advances } = await supabase
                .from('approval_requests')
                .select('employee_id, metadata')
                .eq('type', 'ADVANCE')
                .eq('status', 'APPROVED')
                .gte('created_at', period.start_date)
                .lte('created_at', period.end_date + 'T23:59:59');

            const advanceMap = new Map();
            for (const adv of advances || []) {
                const key = String(adv.employee_id);
                advanceMap.set(key, (advanceMap.get(key) || 0) + parseFloat(adv.metadata?.amount || 0));
            }

            // #7 — Vacation plans overlapping period: those days are paid (not absent)
            const { data: vacPlans } = await supabase
                .from('vacation_plans')
                .select('employee_id, start_date, end_date')
                .in('status', ['CONFIRMED', 'APPROVED', 'TAKEN'])
                .lte('start_date', period.end_date)
                .gte('end_date', period.start_date);

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
            await supabase
                .from('payroll_entries')
                .delete()
                .eq('period_id', periodId)
                .eq('status', 'PENDING');

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
                const { error } = await supabase.from('payroll_entries').insert(rows);
                if (error) throw error;
            }

            // OT Bank — seed EARNED entries for both diurnal and nocturnal OT.
            // Idempotent: delete prior EARNED entries for this period before re-inserting.
            await supabase.from('overtime_bank').delete().eq('period_id', periodId).eq('type', 'EARNED');
            const bankRows = [];
            for (const emp of employees) {
                const empId    = String(emp.id);
                const diurnal  = parseFloat((diurnalOTMap.get(empId) || 0).toFixed(2));
                const nocturnal = parseFloat((noctOTMap.get(empId)   || 0).toFixed(2));
                if (diurnal  > 0) bankRows.push({ employee_id: emp.id, hours: diurnal,   type: 'EARNED', subtype: 'DIURNAL',   period_id: periodId });
                if (nocturnal > 0) bankRows.push({ employee_id: emp.id, hours: nocturnal, type: 'EARNED', subtype: 'NOCTURNAL', period_id: periodId });
            }
            if (bankRows.length > 0) {
                await supabase.from('overtime_bank').insert(bankRows);
            }

            await get().fetchPayrollEntries(periodId);
            return { warnings: noSalary };
        } catch (err) {
            console.error('Error generating payroll:', err);
            set({ isLoadingPayroll: false });
            throw err;
        }
    },

    // ── OT Bank ───────────────────────────────────────────────────────────────

    fetchOvertimeBankBalance: async (employeeId) => {
        const { data } = await supabase
            .from('overtime_bank')
            .select('hours, type')
            .eq('employee_id', employeeId);
        let pending = 0;
        for (const row of data || []) {
            if (row.type === 'EARNED') pending += row.hours;
            else                       pending -= row.hours;
        }
        return parseFloat(Math.max(0, pending).toFixed(2));
    },

    redeemOvertimeBank: async (employeeId, hours, type, subtype, periodId, notes, createdBy) => {
        const { error } = await supabase.from('overtime_bank').insert({
            employee_id: employeeId,
            hours:       parseFloat(hours.toFixed(2)),
            type,
            subtype:     subtype || 'DIURNAL',
            period_id:   periodId || null,
            notes:       notes || null,
            created_by:  createdBy || null,
        });
        if (error) throw error;
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

        const { error } = await supabase
            .from('payroll_entries')
            .update(payload)
            .eq('id', entryId);
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
