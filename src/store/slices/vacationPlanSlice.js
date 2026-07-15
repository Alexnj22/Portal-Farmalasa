import { supabase } from '../../supabaseClient';
import { notifyEmployees } from '../../utils/notify';
import {
    fetchVacationHeaders as fetchVacationHeadersData, updateVacationHeaderStatus,
    updateVacationPlansBulkPreApprove, fetchVacationChangeRequests as fetchVacationChangeRequestsData,
    updateVacationPlan, fetchVacationPlans as fetchVacationPlansData, fetchOverlappingVacationPlans,
    insertVacationPlan,
} from '../../data/vacationPlans';
import { updateApprovalRequest } from '../../data/requests';

export const createVacationPlanSlice = (set, get) => ({
    vacationPlans: [],
    isLoadingVacationPlans: false,
    vacationHeaders: [],         // { id, year, status, ai_generated }
    isGeneratingPlan: false,
    vacationChangeRequests: [],  // pending approval_requests type=VACATION_CHANGE

    fetchVacationHeaders: async () => {
        const { data, error } = await fetchVacationHeadersData();
        if (error) { console.error('fetchVacationHeaders:', error); return []; }
        set({ vacationHeaders: data || [] });
        return data || [];
    },

    updateHeaderStatus: async (headerId, status) => {
        const { error } = await updateVacationHeaderStatus(headerId, status);
        if (error) { console.error('updateHeaderStatus:', error); return false; }
        set(state => ({
            vacationHeaders: state.vacationHeaders.map(h =>
                h.id === headerId ? { ...h, status } : h
            ),
        }));
        return true;
    },

    // Bulk-promote all DRAFT plans for a year → PRE_APPROVED + header → PRE_APPROVED
    preApprovePlan: async (headerId) => {
        const { error: plansErr } = await updateVacationPlansBulkPreApprove(headerId);
        if (plansErr) { console.error('preApprovePlan plans:', plansErr); return false; }

        const { error: headerErr } = await updateVacationHeaderStatus(headerId, 'PRE_APPROVED');
        if (headerErr) { console.error('preApprovePlan header:', headerErr); return false; }

        set(state => ({
            vacationHeaders: state.vacationHeaders.map(h =>
                h.id === headerId ? { ...h, status: 'PRE_APPROVED' } : h
            ),
            vacationPlans: state.vacationPlans.map(vp =>
                vp.plan_header_id === headerId && vp.status === 'DRAFT'
                    ? { ...vp, status: 'PRE_APPROVED' }
                    : vp
            ),
        }));
        return true;
    },

    generateAIPlan: async (year) => {
        set({ isGeneratingPlan: true });
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
            const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-vacation-plan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ year }),
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            // Reload headers + plans for this year
            await get().fetchVacationHeaders();
            await get().fetchVacationPlans(year, null);
            return { success: true, count: json.count };
        } catch (err) {
            console.error('generateAIPlan:', err);
            return { success: false, error: err.message };
        } finally {
            set({ isGeneratingPlan: false });
        }
    },

    fetchVacationChangeRequests: async (year) => {
        const { data, error } = await fetchVacationChangeRequestsData();
        if (error) { console.error('fetchVacationChangeRequests:', error); return []; }
        const employees = get().employees || [];
        const enriched = (data || [])
            .filter(r => r.metadata?.year === year)
            .map(r => ({
                ...r,
                employee: employees.find(e => String(e.id) === String(r.employee_id)) || null,
            }));
        set({ vacationChangeRequests: enriched });
        return enriched;
    },

    processChangeRequest: async (requestId, action, vacationPlanId, newStart, newEnd) => {
        // action: 'APPROVED' | 'REJECTED'
        if (action === 'APPROVED' && vacationPlanId && newStart && newEnd) {
            const days = Math.round((new Date(newEnd + 'T12:00:00') - new Date(newStart + 'T12:00:00')) / 86400000) + 1;
            const { error: planErr } = await updateVacationPlan(vacationPlanId, {
                start_date: newStart,
                end_date: newEnd,
                days,
                status: 'APPROVED',
                change_requested_start: null,
                change_requested_end: null,
                updated_at: new Date().toISOString(),
            });
            if (planErr) { console.error('processChangeRequest plan:', planErr); return false; }
            set(state => ({
                vacationPlans: state.vacationPlans.map(vp =>
                    vp.id === vacationPlanId
                        ? { ...vp, start_date: newStart, end_date: newEnd, days, status: 'APPROVED', change_requested_start: null, change_requested_end: null }
                        : vp
                ),
            }));
        } else if (action === 'REJECTED' && vacationPlanId) {
            // Revert plan status to PRE_APPROVED, clear requested dates
            await updateVacationPlan(vacationPlanId, { status: 'PRE_APPROVED', change_requested_start: null, change_requested_end: null, updated_at: new Date().toISOString() });
            set(state => ({
                vacationPlans: state.vacationPlans.map(vp =>
                    vp.id === vacationPlanId
                        ? { ...vp, status: 'PRE_APPROVED', change_requested_start: null, change_requested_end: null }
                        : vp
                ),
            }));
        }
        // Update approval_request status
        const { error } = await updateApprovalRequest(requestId, { status: action, updated_at: new Date().toISOString() });
        if (error) { console.error('processChangeRequest request:', error); return false; }
        set(state => ({
            vacationChangeRequests: state.vacationChangeRequests.filter(r => r.id !== requestId),
        }));
        return true;
    },

    fetchVacationPlans: async (year, branchId = null) => {
        set({ isLoadingVacationPlans: true });
        try {
            const { data, error } = await fetchVacationPlansData(year, branchId);
            if (error) throw error;
            const employees = get().employees || [];
            const branches  = get().branches  || [];
            const enriched = (data || []).map(vp => ({
                ...vp,
                employee: employees.find(e => String(e.id) === String(vp.employee_id)) || null,
                branch:   branches.find(b  => String(b.id) === String(vp.branch_id))  || null,
            }));
            set({ vacationPlans: enriched, isLoadingVacationPlans: false });
            return enriched;
        } catch (err) {
            console.error('Error fetching vacation plans:', err);
            set({ isLoadingVacationPlans: false });
            return [];
        }
    },

    createVacationPlan: async (planData) => {
        try {
            const employees = get().employees || [];
            const emp = employees.find(e => String(e.id) === String(planData.employee_id));

            let metadata = planData.metadata || {};

            // Registrar antigüedad al momento de la asignación
            if (emp?.hire_date) {
                const hireDate  = new Date(emp.hire_date      + 'T12:00:00');
                const startDate = new Date(planData.start_date + 'T12:00:00');
                const yearsWorked = (startDate - hireDate) / (1000 * 60 * 60 * 24 * 365.25);

                if (yearsWorked < 1) {
                    // Asignación anticipada — se guarda como advertencia en metadata
                    metadata = { ...metadata, earlyAssignment: true, yearsWorkedAtAssignment: Math.round(yearsWorked * 100) / 100 };
                } else {
                    metadata = { ...metadata, earlyAssignment: false, yearsWorkedAtAssignment: Math.round(yearsWorked * 100) / 100 };
                }
            }

            // Validar ventana tras el aniversario (Art. 182 Código de Trabajo): 4 meses
            // si la plantilla tiene 100 trabajadores o menos, 6 meses si supera los 100.
            // (Antes hardcodeado a 3 meses — más restrictivo de lo que la ley permite,
            // bloqueaba asignaciones válidas.)
            if (emp?.hire_date) {
                const activeHeadcount = employees.filter(e => e.status === 'ACTIVO' || e.status === 'ACTIVE').length;
                const windowMonths = activeHeadcount > 100 ? 6 : 4;
                const hireDate    = new Date(emp.hire_date      + 'T12:00:00');
                const startDate   = new Date(planData.start_date + 'T12:00:00');
                const anniversary = new Date(startDate.getFullYear(), hireDate.getMonth(), hireDate.getDate());
                const windowEnd   = new Date(anniversary);
                windowEnd.setMonth(windowEnd.getMonth() + windowMonths);
                if (startDate < anniversary || startDate > windowEnd) {
                    throw new Error(`WINDOW_ERROR: Las vacaciones deben asignarse dentro de los ${windowMonths} meses posteriores al aniversario (${anniversary.toLocaleDateString('es-VE')} — ${windowEnd.toLocaleDateString('es-VE')}).`);
                }
            }

            // Validar solapamiento en misma sucursal
            const { data: existing } = await fetchOverlappingVacationPlans(planData.branch_id, planData.year);

            const hasOverlap = (existing || []).some(vp => {
                if (String(vp.employee_id) === String(planData.employee_id)) return false;
                return planData.start_date <= vp.end_date && planData.end_date >= vp.start_date;
            });

            if (hasOverlap) {
                throw new Error('OVERLAP_ERROR: Ya existe un plan de vacaciones en esas fechas para esta sucursal. No pueden solaparse.');
            }

            const { data, error } = await insertVacationPlan({
                year:        planData.year,
                employee_id: planData.employee_id,
                branch_id:   planData.branch_id,
                start_date:  planData.start_date,
                end_date:    planData.end_date,
                days:        planData.days || 15,
                status:      'PLANNED',
                notes:       planData.notes || null,
                metadata:    metadata,
                created_by:  planData.created_by,
            });

            if (error) throw error;

            const employees2 = get().employees || [];
            const branches2  = get().branches  || [];
            const enriched = {
                ...data,
                employee: employees2.find(e => String(e.id) === String(data.employee_id)) || null,
                branch:   branches2.find(b  => String(b.id) === String(data.branch_id))  || null,
            };

            set(state => ({ vacationPlans: [...state.vacationPlans, enriched] }));
            return enriched;
        } catch (err) {
            console.error('Error creating vacation plan:', err);
            throw err;
        }
    },

    updateVacationPlan: async (planId, updates) => {
        try {
            const currentPlan = get().vacationPlans.find(vp => vp.id === planId);
            const existingMeta = currentPlan?.metadata || {};

            // First edit: snapshot original dates into metadata
            const metadata = existingMeta.original_start_date
                ? existingMeta
                : {
                    ...existingMeta,
                    original_start_date: currentPlan?.start_date,
                    original_end_date:   currentPlan?.end_date,
                    original_days:       currentPlan?.days,
                    edited_at:           new Date().toISOString(),
                  };

            const { data, error } = await updateVacationPlan(planId, {
                start_date:  updates.start_date,
                end_date:    updates.end_date,
                days:        updates.days,
                notes:       updates.notes ?? null,
                metadata,
                updated_at:  new Date().toISOString(),
            }, true);
            if (error) throw error;
            set(state => ({
                vacationPlans: state.vacationPlans.map(vp =>
                    vp.id === planId ? { ...vp, ...data, employee: vp.employee, branch: vp.branch } : vp
                ),
            }));
            return true;
        } catch (err) {
            console.error('Error updating vacation plan:', err);
            return false;
        }
    },

    updateVacationPlanStatus: async (planId, status) => {
        try {
            const { error } = await updateVacationPlan(planId, { status, updated_at: new Date().toISOString() });
            if (error) throw error;

            if (status === 'CONFIRMED') {
                const plan = get().vacationPlans.find(vp => vp.id === planId);
                if (plan?.employee_id) {
                    const fmtDate = (d) => d
                        ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' })
                        : '—';
                    await notifyEmployees([String(plan.employee_id)], {
                        type: 'REQUEST_DECIDED',
                        title: '🌴 Vacaciones confirmadas',
                        body: `Tus vacaciones han sido confirmadas del ${fmtDate(plan.start_date)} al ${fmtDate(plan.end_date)} (${plan.days} días). ¡Disfrútalas!`,
                        link: '/my-requests',
                        push: true,
                        metadata: { status: 'APPROVED', startDate: plan.start_date, endDate: plan.end_date, days: plan.days },
                    });
                }
            }

            set(state => ({
                vacationPlans: state.vacationPlans.map(vp =>
                    vp.id === planId ? { ...vp, status } : vp
                ),
            }));
            return true;
        } catch (err) {
            console.error('Error updating vacation plan:', err);
            return false;
        }
    },

    deleteVacationPlan: async (planId) => {
        try {
            const { error } = await updateVacationPlan(planId, { status: 'CANCELLED', updated_at: new Date().toISOString() });
            if (error) throw error;
            set(state => ({
                vacationPlans: state.vacationPlans.map(vp =>
                    vp.id === planId ? { ...vp, status: 'CANCELLED' } : vp
                ),
            }));
            return true;
        } catch (err) {
            console.error('Error deleting vacation plan:', err);
            return false;
        }
    },
});
