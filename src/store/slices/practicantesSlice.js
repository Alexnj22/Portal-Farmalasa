import { supabase } from '../../supabaseClient';

export const createPracticantesSlice = (set, get) => ({
    practicantes: [],
    practicantesLoading: false,

    fetchPracticantes: async () => {
        set({ practicantesLoading: true });
        try {
            const { data, error } = await supabase
                .from('practicantes')
                .select('*, branches(name), supervisor:supervisor_employee_id(id, first_names, last_names)')
                .order('created_at', { ascending: false });
            if (error) throw error;
            set({ practicantes: data || [] });
            return data || [];
        } catch (err) {
            console.error('Error obteniendo practicantes:', err);
            return [];
        } finally {
            set({ practicantesLoading: false });
        }
    },

    createPracticante: async (payload) => {
        const { data: newRow, error } = await supabase.from('practicantes').insert([payload]).select('*, branches(name), supervisor:supervisor_employee_id(id, first_names, last_names)').single();
        if (error) throw error;

        await get().appendAuditLog('PRACTICANTE_CREADO', newRow.id, {
            timeline_title: `Practicante registrado: ${newRow.first_names} ${newRow.last_names}`,
            dimension: 'OPERATIVE',
            branch_id: newRow.branch_id,
            new_value: `${newRow.institucion_educativa} · ${newRow.fecha_inicio} a ${newRow.fecha_fin}`,
        });

        set((state) => ({ practicantes: [newRow, ...state.practicantes] }));
        return newRow;
    },

    updatePracticante: async (id, payload) => {
        const { data: updated, error } = await supabase.from('practicantes').update(payload).eq('id', id).select('*, branches(name), supervisor:supervisor_employee_id(id, first_names, last_names)').single();
        if (error) throw error;

        await get().appendAuditLog('PRACTICANTE_EDITADO', id, {
            timeline_title: `Practicante actualizado: ${updated.first_names} ${updated.last_names}`,
            dimension: 'OPERATIVE',
            branch_id: updated.branch_id,
            new_value: `Estado: ${updated.estado}`,
        });

        set((state) => ({ practicantes: state.practicantes.map((p) => (p.id === id ? updated : p)) }));
        return updated;
    },

    deletePracticante: async (id) => {
        const target = get().practicantes.find((p) => p.id === id);
        const { error } = await supabase.from('practicantes').delete().eq('id', id);
        if (error) throw error;

        await get().appendAuditLog('PRACTICANTE_ELIMINADO', id, {
            timeline_title: `Practicante eliminado: ${target ? `${target.first_names} ${target.last_names}` : id}`,
            dimension: 'OPERATIVE',
            branch_id: target?.branch_id,
            old_value: target ? `${target.institucion_educativa}` : null,
        });

        set((state) => ({ practicantes: state.practicantes.filter((p) => p.id !== id) }));
        return true;
    },
});
