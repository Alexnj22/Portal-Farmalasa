import {
    upsertInstitucionCatalogEntry, fetchPracticantes as fetchPracticantesData,
    insertPracticante, updatePracticante as updatePracticanteData, deletePracticante as deletePracticanteData,
    aplicarHorarioDePractica,
} from '../../data/practicantes';
import { useToastStore } from '../toastStore';
import { updateEmployee as updateEmployeeRow, cuentaDeAcceso } from '../../data/employees';
import { subirArchivo } from '../../utils/storageFiles';
import { filaDePracticanteDesdeFicha, PASANTIA_VACIA } from '../../utils/practicanteFormulario';

// Institución educativa vive en education_catalog_entries (misma tabla que
// especialidades/profesiones de Empleados) — cada vez que se guarda un
// practicante, la institución tecleada queda disponible como opción real
// para el siguiente registro. onConflict ignora duplicados.
const registerInstitucionCatalogEntry = (institucion) => {
    if (!institucion) return;
    upsertInstitucionCatalogEntry(institucion)
        .then(({ error }) => { if (error) console.warn('No se pudo registrar institución en catálogo:', error.message); });
};

// El horario de la práctica se escribe en Horarios y turnos DESPUÉS de guardar
// la fila (2026-11-03). Si falla, la práctica ya quedó guardada: se avisa y no
// se tumba lo que sí salió — «guardar de nuevo» lo vuelve a intentar.
const aplicarHorario = async (fila) => {
    if (!fila?.id || !fila.employee_id) return;
    const { error } = await aplicarHorarioDePractica(fila.id);
    if (error) {
        console.error('aplicar_horario_de_practica:', error.message);
        useToastStore.getState().showToast('El horario no llegó a Horarios y turnos',
            'La práctica se guardó. Ábrela y guarda de nuevo para reintentar.', 'warning', 10000);
    }
};

export const createPracticantesSlice = (set, get) => ({
    practicantes: [],
    practicantesLoading: false,
    // El error se GUARDA, no sólo se imprime. Con un `console.error` a secas la
    // pantalla recibía la lista vacía de siempre y decía «Sin practicantes»: un
    // fallo de red se leía igual que una sala sin nadie haciendo horas sociales.
    practicantesError: null,

    fetchPracticantes: async () => {
        set({ practicantesLoading: true, practicantesError: null });
        try {
            const { data, error } = await fetchPracticantesData();
            if (error) throw error;
            set({ practicantes: data || [] });
            return data || [];
        } catch (err) {
            console.error('Error obteniendo practicantes:', err);
            set({ practicantesError: err });
            return [];
        } finally {
            set({ practicantesLoading: false });
        }
    },

    createPracticante: async (payload) => {
        const { data: newRow, error } = await insertPracticante(payload);
        if (error) throw error;
        registerInstitucionCatalogEntry(newRow.institucion_educativa);

        await get().appendAuditLog('PRACTICANTE_CREADO', newRow.id, {
            timeline_title: `Practicante registrado: ${newRow.first_names} ${newRow.last_names}`,
            dimension: 'OPERATIVE',
            branch_id: newRow.branch_id,
            new_value: `${newRow.institucion_educativa} · ${newRow.fecha_inicio} a ${newRow.fecha_fin}`,
        });

        set((state) => ({ practicantes: [newRow, ...state.practicantes] }));
        await aplicarHorario(newRow);
        return newRow;
    },

    updatePracticante: async (id, payload) => {
        const antes = get().practicantes.find((p) => p.id === id);
        const { data: updated, error } = await updatePracticanteData(id, payload);
        if (error) throw error;
        set((state) => ({ practicantes: state.practicantes.map((p) => (p.id === id ? updated : p)) }));

        // ── El estado de la práctica abre o cierra el portal (2026-11-03) ──
        // Pedido: el practicante entra al portal mientras hace sus horas. Al
        // pasar a Finalizado o Cancelado se le cierra la ficha y la cuenta
        // (la misma `disable-employee-auth` de una baja); si vuelve a Activo,
        // se reabre. Se lanza al final, con la fila ya guardada: el error dice
        // qué faltó, no que no se guardó.
        let avisoDeCuenta = null;
        const estabaActivo = (antes?.estado || 'ACTIVO') === 'ACTIVO';
        const quedaActivo = updated.estado === 'ACTIVO';
        // También la primera vez que se enlaza a una práctica ya terminada: la
        // ficha nace ACTIVA y la práctica dice que no.
        const recienEnlazada = !antes?.employee_id && !!updated.employee_id;
        if (updated.employee_id && (estabaActivo !== quedaActivo || (recienEnlazada && !quedaActivo))) {
            const status = quedaActivo ? 'ACTIVO' : 'INACTIVO';
            const { error: errFicha } = await updateEmployeeRow(updated.employee_id, { status });
            if (errFicha) {
                avisoDeCuenta = new Error(`La práctica se guardó, pero su ficha no cambió de estado (${errFicha.message}).`);
            } else {
                set((state) => ({
                    employees: (state.employees || []).map((e) => (String(e.id) === String(updated.employee_id) ? { ...e, status } : e)),
                }));
                try { await cuentaDeAcceso(updated.employee_id, quedaActivo ? 'enable' : 'disable'); } catch (e) { avisoDeCuenta = e; }
            }
        }
        registerInstitucionCatalogEntry(updated.institucion_educativa);

        await get().appendAuditLog('PRACTICANTE_EDITADO', id, {
            timeline_title: `Practicante actualizado: ${updated.first_names} ${updated.last_names}`,
            dimension: 'OPERATIVE',
            branch_id: updated.branch_id,
            new_value: `Estado: ${updated.estado}`,
        });

        // Finalizar o cancelar también le quita las semanas futuras.
        await aplicarHorario(updated);
        if (avisoDeCuenta) throw avisoDeCuenta;
        return updated;
    },

    /**
     * Guarda la pasantía de una ficha de practicante (2026-11-03). La llama el
     * formulario de empleado DESPUÉS de crear o actualizar la ficha: la persona
     * ya está en `employees` y esto escribe su fila de `practicantes`, con la
     * identidad copiada de la ficha y el convenio subido.
     *
     * `formData.pasantia_id` dice si ya tenía fila (enlazar a un practicante
     * registrado antes, o editar uno): entonces se actualiza, no se duplica.
     */
    guardarPasantiaDeFicha: async (employeeId, formData) => {
        const pasantia = { ...PASANTIA_VACIA, ...(formData.pasantia || {}) };
        const filaId = formData.pasantia_id || null;
        let convenioUrl = formData.pasantia_convenio_url || null;
        const archivo = formData.pasantia_convenio_file;
        if (archivo instanceof File) {
            const ext = archivo.name.split('.').pop() || 'pdf';
            const path = `practicantes/${filaId || employeeId}/convenio_${Date.now()}.${ext}`;
            convenioUrl = (await subirArchivo('documents', path, archivo)) || convenioUrl;
        }
        if (!convenioUrl) throw new Error('No se pudo subir el convenio. Ábrelo de nuevo y adjúntalo.');
        const persona = {
            ...formData,
            first_names: String(formData.first_names || '').trim().toUpperCase(),
            last_names: String(formData.last_names || '').trim().toUpperCase(),
        };
        const fila = filaDePracticanteDesdeFicha(persona, pasantia, convenioUrl, employeeId);
        return filaId ? get().updatePracticante(filaId, fila) : get().createPracticante(fila);
    },

    deletePracticante: async (id) => {
        const target = get().practicantes.find((p) => p.id === id);
        const { error } = await deletePracticanteData(id);
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
