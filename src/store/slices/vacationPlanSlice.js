import { supabase } from '../../supabaseClient';

export const createVacationPlanSlice = (set, get) => ({
    vacationPlans: [],
    isLoadingVacationPlans: false,

    fetchVacationPlans: async (year, branchId = null) => {
        set({ isLoadingVacationPlans: true });
        try {
            let query = supabase
                .from('vacation_plans')
                .select('id, year, employee_id, branch_id, start_date, end_date, days, status, notes, created_at')
                .eq('year', year)
                .order('start_date', { ascending: true });
            if (branchId) query = query.eq('branch_id', branchId);
            const { data, error } = await query;
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

            // Validar antigüedad mínima de 1 año
            if (emp?.hire_date) {
                const hireDate  = new Date(emp.hire_date      + 'T12:00:00');
                const startDate = new Date(planData.start_date + 'T12:00:00');
                const yearsWorked = (startDate - hireDate) / (1000 * 60 * 60 * 24 * 365.25);
                if (yearsWorked < 1) {
                    throw new Error('ELIGIBILITY_ERROR: El empleado no cumple 1 año de antigüedad en la fecha de inicio de vacaciones.');
                }
            }

            // Validar ventana de 3 meses después del aniversario
            if (emp?.hire_date) {
                const hireDate    = new Date(emp.hire_date      + 'T12:00:00');
                const startDate   = new Date(planData.start_date + 'T12:00:00');
                const anniversary = new Date(startDate.getFullYear(), hireDate.getMonth(), hireDate.getDate());
                const windowEnd   = new Date(anniversary);
                windowEnd.setMonth(windowEnd.getMonth() + 3);
                if (startDate < anniversary || startDate > windowEnd) {
                    throw new Error(`WINDOW_ERROR: Las vacaciones deben asignarse dentro de los 3 meses posteriores al aniversario (${anniversary.toLocaleDateString('es-VE')} — ${windowEnd.toLocaleDateString('es-VE')}).`);
                }
            }

            // Validar solapamiento en misma sucursal
            const { data: existing } = await supabase
                .from('vacation_plans')
                .select('id, employee_id, start_date, end_date')
                .eq('branch_id', planData.branch_id)
                .eq('year', planData.year)
                .neq('status', 'CANCELLED');

            const hasOverlap = (existing || []).some(vp => {
                if (String(vp.employee_id) === String(planData.employee_id)) return false;
                return planData.start_date <= vp.end_date && planData.end_date >= vp.start_date;
            });

            if (hasOverlap) {
                throw new Error('OVERLAP_ERROR: Ya existe un plan de vacaciones en esas fechas para esta sucursal. No pueden solaparse.');
            }

            const { data, error } = await supabase
                .from('vacation_plans')
                .insert([{
                    year:        planData.year,
                    employee_id: planData.employee_id,
                    branch_id:   planData.branch_id,
                    start_date:  planData.start_date,
                    end_date:    planData.end_date,
                    days:        planData.days || 15,
                    status:      'PLANNED',
                    notes:       planData.notes || null,
                    created_by:  planData.created_by,
                }])
                .select()
                .single();

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

    updateVacationPlanStatus: async (planId, status) => {
        try {
            const { error } = await supabase
                .from('vacation_plans')
                .update({ status, updated_at: new Date().toISOString() })
                .eq('id', planId);
            if (error) throw error;
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
            const { error } = await supabase
                .from('vacation_plans')
                .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
                .eq('id', planId);
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
