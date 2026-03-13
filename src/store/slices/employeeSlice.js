// src/store/slices/employeeSlice.js
import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS } from '../utils';

// 🚨 CORRECCIÓN CRÍTICA: Prevenir "QuotaExceededError" en el LocalStorage
const persistEmployees = (employees) => {
    try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const lightEmployees = employees.map(emp => {
            return {
                ...emp,
                history: [], // Vaciamos para no saturar caché (se carga bajo demanda)
                documents: [], // Vaciamos para no saturar caché (se carga bajo demanda)
                // Solo guardamos asistencia de las últimas 24h para que el Kiosco sobreviva a un F5
                attendance: (emp.attendance || []).filter(a => a.timestamp >= yesterday)
            };
        });
        localStorage.setItem(CACHE_KEYS.EMPLOYEES, JSON.stringify(lightEmployees));
    } catch (error) {
        console.warn("⚠️ Alerta de Memoria LocalStorage:", error);
    }

    // Devolvemos el array original INTACTO para que el estado de Zustand siga teniendo todo
    return employees;
};

export const createEmployeeSlice = (set, get) => ({
    employees: safeJsonParse(localStorage.getItem(CACHE_KEYS.EMPLOYEES), []) || [],
    attendanceLoaded: false,

    setEmployees: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.employees) : updater;
        persistEmployees(next);
        return { employees: next };
    }),

    uploadFileToStorage: async (file, bucket = 'photos', folder = '') => {
        if (!file) return null;
        try {
            const fileExt = file.name.split(".").pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const path = folder
                ? `${String(folder).replace(/\/+$/, '')}/${fileName}`
                : fileName;

            const { error } = await supabase.storage.from(bucket).upload(path, file);
            if (error) throw error;

            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            return null;
        }
    },

    uploadPhotoToStorage: (file) => get().uploadFileToStorage(file, 'photos'),

    addEmployee: async (formData) => {
        try {
            let publicPhotoUrl = null;
            if (formData.photo && formData.photo instanceof File) {
                publicPhotoUrl = await get().uploadPhotoToStorage(formData.photo);
            }

            const dbPayload = {
                name: formData.name,
                code: formData.code,
                role_id: formData.role_id ? parseInt(formData.role_id, 10) : null,
                secondary_role_id: formData.secondary_role_id ? parseInt(formData.secondary_role_id, 10) : null,
                branch_id: formData.branchId ? parseInt(formData.branchId, 10) : null,
                phone: formData.phone,
                dui: formData.dui,
                is_admin: formData.isAdmin || false,
                birth_date: formData.birthDate || null,
                hire_date: formData.hireDate || null,
                photo_url: publicPhotoUrl || null
            };

            const { data: newEmp, error } = await supabase.from("employees").insert([dbPayload]).select().single();
            if (error) throw error;

            await get().appendAuditLog('PERSONAL_ASIGNADO', newEmp.id, {
                timeline_title: `Nuevo Ingreso: ${newEmp.name}`,
                dimension: 'HR',
                branch_id: newEmp.branch_id,
                new_value: `Cargo asignado`
            });
            const roles = get().roles;
            const mainRoleName = roles.find(r => r.id === newEmp.role_id)?.name || null;
            const secRoleName = roles.find(r => r.id === newEmp.secondary_role_id)?.name || null;

            const appEmp = {
                ...newEmp,
                branchId: newEmp.branch_id,
                hireDate: newEmp.hire_date,
                birthDate: newEmp.birth_date,
                photo: newEmp.photo_url,
                role: mainRoleName,
                secondary_role: secRoleName,
                attendance: [],
                history: [],
                documents: []
            };

            set((state) => {
                const next = [...state.employees, appEmp];
                persistEmployees(next);
                return { employees: next };
            });
            return appEmp.id;
        } catch (err) {
            throw new Error("Fallo al crear empleado.");
        }
    },

    updateEmployee: async (id, updatedData) => {
        try {
            const dbPayload = { ...updatedData };

            if (updatedData.branchId) dbPayload.branch_id = parseInt(updatedData.branchId, 10);
            if (updatedData.photo instanceof File) dbPayload.photo_url = await get().uploadPhotoToStorage(updatedData.photo);

            if (updatedData.role_id !== undefined) dbPayload.role_id = updatedData.role_id ? parseInt(updatedData.role_id, 10) : null;
            if (updatedData.secondary_role_id !== undefined) dbPayload.secondary_role_id = updatedData.secondary_role_id ? parseInt(updatedData.secondary_role_id, 10) : null;

            // Limpieza estricta de UI antes de enviar a BD
            delete dbPayload.branchId;
            delete dbPayload.photo;
            delete dbPayload.history;
            delete dbPayload.documents;
            delete dbPayload.attendance;
            delete dbPayload.role;
            delete dbPayload.secondary_role;

            const { data: updated, error } = await supabase.from("employees").update(dbPayload).eq("id", id).select().single();
            if (error) throw error;

            const empEditado = get().employees.find(e => String(e.id) === String(id));
            await get().appendAuditLog('EDITAR_EMPLEADO', id, {
                timeline_title: `Actualización de Personal: ${updatedData.name || empEditado?.name}`,
                dimension: 'HR',
                branch_id: updatedData.branchId || empEditado?.branchId,
                new_value: 'Expediente modificado',
                ...dbPayload
            });
            const roles = get().roles;
            const mainRoleName = roles.find(r => r.id === updated.role_id)?.name || null;
            const secRoleName = roles.find(r => r.id === updated.secondary_role_id)?.name || null;

            set((state) => {
                const next = state.employees.map((emp) => String(emp.id) !== String(id) ? emp : {
                    ...emp,
                    ...updated,
                    branchId: updated.branch_id,
                    photo: updated.photo_url,
                    birthDate: updated.birth_date,
                    hireDate: updated.hire_date,
                    role: mainRoleName || emp.role,
                    secondary_role: secRoleName !== null ? secRoleName : emp.secondary_role
                });
                persistEmployees(next);
                return { employees: next };
            });
            return true;
        } catch (err) {
            return false;
        }
    },

    deleteEmployee: async (id) => {
        try {
            const { error } = await supabase.from("employees").delete().eq("id", id);
            if (error) throw error;
            const empEliminar = get().employees.find(e => String(e.id) === String(id));
            await get().appendAuditLog('ELIMINAR_EMPLEADO', id, {
                timeline_title: `Baja de Personal: ${empEliminar?.name || 'Desconocido'}`,
                dimension: 'HR',
                branch_id: empEliminar?.branchId,
                old_value: 'Activo',
                new_value: 'Dado de baja en el sistema'
            });
            set((state) => {
                const next = state.employees.filter((emp) => String(emp.id) !== String(id));
                persistEmployees(next);
                return { employees: next };
            });
            return true;
        } catch (err) {
            return false;
        }
    },

    registerEmployeeEvent: async (employeeId, eventData, file = null) => {
        try {
            const dbPayload = { employee_id: employeeId, type: eventData.type, date: eventData.date || new Date().toISOString().split('T')[0], note: eventData.note || '', metadata: eventData };
            const { data: newEvent, error } = await supabase.from('employee_events').insert([dbPayload]).select().single();
            if (error) throw error;
            const empEvento = get().employees.find(e => String(e.id) === String(employeeId));
            await get().appendAuditLog('ACCION_RRHH', employeeId, {
                timeline_title: `Evento RRHH: ${eventData.type.replace(/_/g, ' ')}`,
                dimension: 'HR',
                branch_id: empEvento?.branchId,
                new_value: eventData.note || 'Evento registrado'
            });
            let docObject = null;
            if (file) {
                const url = await get().uploadFileToStorage(file, 'documents');
                if (url) {
                    const { data: newDoc } = await supabase.from('employee_documents').insert([{ employee_id: employeeId, event_id: newEvent.id, name: file.name, type: 'DOCUMENT', url: url }]).select().single();
                    docObject = newDoc;
                }
            }

            set((state) => {
                const next = state.employees.map(emp => String(emp.id) !== String(employeeId) ? emp : {
                    ...emp,
                    history: [...(emp.history || []), newEvent],
                    documents: docObject ? [...(emp.documents || []), docObject] : emp.documents
                });
                persistEmployees(next);
                return { employees: next };
            });
            return newEvent.id;
        } catch (err) {
            return null;
        }
    },

    addDocumentToEvent: async (employeeId, eventId, file) => {
        if (!file) return;
        try {
            const url = await get().uploadFileToStorage(file, 'documents');
            const { data: newDoc, error } = await supabase.from('employee_documents').insert([{ employee_id: employeeId, event_id: eventId || null, name: file.name, type: 'UPLOAD', url: url }]).select().single();
            if (error) throw error;

            const empDoc = get().employees.find(e => String(e.id) === String(employeeId));
            await get().appendAuditLog('DOCUMENTO_HISTORICO', employeeId, {
                timeline_title: `Documento RRHH Subido: ${empDoc?.name || ''}`,
                dimension: 'HR',
                branch_id: empDoc?.branchId,
                new_value: file.name,
                file_url: url // 🚨 Para que el botón de "Ver Archivo" en TabHistory se active
            });
            set((state) => {
                const next = state.employees.map(emp => String(emp.id) !== String(employeeId) ? emp : {
                    ...emp,
                    documents: [...(emp.documents || []), newDoc]
                });
                persistEmployees(next);
                return { employees: next };
            });
        } catch (e) {
        }
    },

    loadAttendanceLastDays: async (days = 15) => {
        const state = get();
        if (state.attendanceLoaded) return true;
        try {
            const sinceISO = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const { data: attData, error } = await supabase.from("attendance").select("*").gte("timestamp", sinceISO);
            if (error) return false;

            const byEmp = new Map();
            (attData || []).forEach((a) => {
                const k = String(a.employee_id);
                if (!byEmp.has(k)) byEmp.set(k, []);
                byEmp.get(k).push(a);
            });

            set((state) => {
                const next = state.employees.map((e) => ({
                    ...e,
                    attendance: byEmp.get(String(e.id))?.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) || e.attendance || [],
                }));
                persistEmployees(next);
                return { employees: next, attendanceLoaded: true };
            });
            return true;
        } catch (e) { return false; }
    },

    getAllAttendance: () => {
        return (get().employees || []).flatMap((emp) =>
            (emp.attendance || []).map((att) => ({ ...att, employeeId: emp.id, id: `${emp.id}-${att.timestamp}` }))
        );
    },

    registerAttendance: async (employeeId, type, metadata = null) => {
        const timestamp = new Date().toISOString();

        try {
            // 1. Insertamos en Supabase y esperamos respuesta real
            const { data: newPunch, error } = await supabase
                .from("attendance")
                .insert([{ employee_id: employeeId, timestamp, type, details: metadata || {} }])
                .select()
                .single();

            if (error) throw error;

            const state = get();
            const employee = state.employees.find(e => String(e.id) === String(employeeId));
            const employeeName = employee ? employee.name : 'Empleado Desconocido';
            const isKiosk = !!metadata?.audit_info;

            // 2. Auditoría limpia sin duplicar info
            const kioskAuditInfo = metadata?.audit_info || null;
            const cleanDetails = { ...metadata };
            delete cleanDetails.audit_info;

            const tipoMarcaje = type === 'ENTRY' ? 'Entrada' : type === 'EXIT' ? 'Salida' : type === 'BREAK_START' ? 'Inicio Descanso' : type === 'BREAK_END' ? 'Fin Descanso' : type;

            state.appendAuditLog(
                `REGISTRO_ASISTENCIA`,
                employeeId,
                {
                    timeline_title: `Marcaje de ${tipoMarcaje}`,
                    dimension: 'OPERATIVE',
                    branch_id: employee?.branchId,
                    new_value: employeeName,
                    ...cleanDetails
                },
                null,
                {
                    isKiosk,
                    kioskAuditInfo: isKiosk ? {
                        ...kioskAuditInfo,
                        employee_name: employeeName
                    } : null
                }
            ).catch(console.error);

            // 3. Actualizamos estado de UI garantizando evitar duplicados
            set((state) => {
                const next = state.employees.map(emp => {
                    if (String(emp.id) !== String(employeeId)) return emp;

                    const actualPunch = newPunch || { id: `local-${Date.now()}`, timestamp, type, details: metadata };

                    const exists = (emp.attendance || []).some(p => p.id === actualPunch.id);
                    if (exists) return emp;

                    return {
                        ...emp,
                        attendance: [...(emp.attendance || []), actualPunch]
                    };
                });

                persistEmployees(next);
                return { employees: next };
            });

            return newPunch || { timestamp, type, details: metadata };

        } catch (err) {
            console.error("❌ Error al registrar asistencia:", err);
            throw new Error(err.message || "Fallo al registrar asistencia en la base de datos");
        }
    },
});