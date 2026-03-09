// src/store/slices/systemSlice.js
import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS } from '../utils';

export const createSystemSlice = (set, get) => ({
    shifts: safeJsonParse(localStorage.getItem(CACHE_KEYS.SHIFTS), []) || [],
    roles: safeJsonParse(localStorage.getItem(CACHE_KEYS.ROLES), []) || [],
    announcements: safeJsonParse(localStorage.getItem(CACHE_KEYS.ANNOUNCEMENTS), []) || [],
    isBootSyncing: false,
    bootStatus: 'idle',
    bootPromise: null,
    lastBootAt: null,

    setShifts: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.shifts) : updater;
        return { shifts: next };
    }),
    setRoles: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.roles) : updater;
        return { roles: next };
    }),
    setAnnouncements: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.announcements) : updater;
        return { announcements: next };
    }),

    resetBootState: () => set({
        isBootSyncing: false,
        bootStatus: 'idle',
        bootPromise: null,
        lastBootAt: null,
    }),

    invalidateBoot: () => set({
        bootStatus: 'idle',
        bootPromise: null,
    }),

    ensureBootReady: async (force = false) => {
        const state = get();

        if (!force && state.bootStatus === 'ready') return true;
        if (!force && state.bootPromise) return await state.bootPromise;

        return await state.fetchBoot({ force });
    },

    fetchBoot: async ({ force = false } = {}) => {
        const current = get();

        if (!force && current.bootStatus === 'ready') return true;
        if (!force && current.bootPromise) return await current.bootPromise;

        const bootPromise = (async () => {
            set({
                isBootSyncing: true,
                bootStatus: 'loading',
            });

            try {
                const { data: branchData } = await supabase.from("branches").select("*").order("id", { ascending: true });
                if (branchData) {
                    const mappedBranches = branchData.map((b) => ({
                        ...b,
                        weeklyHours: b.weekly_hours,
                        propertyType: b.settings?.propertyType || 'OWNED',
                        rent: b.settings?.rent || null,
                    }));
                    set({ branches: mappedBranches });
                    localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(mappedBranches));
                }

                const { data: rolesData } = await supabase.from("roles").select("*").order("name", { ascending: true });
                if (rolesData) {
                    set({ roles: rolesData });
                    localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(rolesData));
                }

                const { data: shiftsData } = await supabase.from("shifts").select("*");
                if (shiftsData) {
                    const mappedShifts = shiftsData.map((s) => ({
                        id: s.id,
                        branchId: s.branch_id,
                        name: s.name,
                        start: s.start_time.substring(0, 5),
                        end: s.end_time.substring(0, 5),
                    }));
                    set({ shifts: mappedShifts });
                    localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(mappedShifts));
                }

                const today = new Date();
                const dayOfWeek = today.getDay();
                const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
                const monday = new Date(today.setDate(diff));
                const offset = monday.getTimezoneOffset() * 60000;
                const weekStartDate = new Date(monday.getTime() - offset).toISOString().split('T')[0];

                const { data: rostersData } = await supabase
                    .from('employee_rosters')
                    .select('*')
                    .eq('week_start_date', weekStartDate);

                const rosterMap = {};
                (rostersData || []).forEach((r) => {
                    rosterMap[r.employee_id] = r.schedule_data;
                });

                const { data: empData } = await supabase.from("employees").select(`
                    *,
                    main_role:roles!employees_role_id_fkey(id, name),
                    sec_role:roles!employees_secondary_role_id_fkey(id, name)
                `);

                const { data: eventsData } = await supabase.from('employee_events').select('*');
                const { data: docsData } = await supabase.from('employee_documents').select('*');

                if (empData) {
                    const mappedEmployees = empData.map((e) => {
                        const myHistory = eventsData ? eventsData.filter((ev) => ev.employee_id === e.id) : [];
                        const myDocs = docsData ? docsData.filter((d) => d.employee_id === e.id) : [];
                        const mySchedule = rosterMap[e.id] || {};

                        return {
                            ...e,
                            branchId: e.branch_id,
                            hireDate: e.hire_date,
                            birthDate: e.birth_date,
                            photo: e.photo_url,
                            attendance: Array.isArray(e.attendance) ? e.attendance : [],
                            history: myHistory,
                            documents: myDocs,
                            weeklySchedule: mySchedule,
                            role_id: e.role_id,
                            secondary_role_id: e.secondary_role_id,
                            role: e.main_role?.name || null,
                            secondary_role: e.sec_role?.name || null,
                        };
                    });

                    // 1. Guardamos en memoria (Zustand) CON TODO el peso para que RRHH vea los datos al instante
                    set({ employees: mappedEmployees });

                    // 2. 🚨 SALVAVIDAS DE MEMORIA: Filtramos antes de tocar el LocalStorage
                    try {
                        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                        const lightCache = mappedEmployees.map(emp => ({
                            ...emp,
                            history: [], // Vaciamos para no saturar el navegador
                            documents: [], // Vaciamos para no saturar el navegador
                            attendance: (emp.attendance || []).filter(a => a.timestamp >= yesterday)
                        }));
                        localStorage.setItem(CACHE_KEYS.EMPLOYEES, JSON.stringify(lightCache));
                    } catch (cacheError) {
                        console.warn("⚠️ Advertencia de Caché:", cacheError);
                    }
                }

                const { data: annData } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
                if (annData) {
                    const mappedAnns = annData.map((a) => ({
                        id: a.id,
                        title: a.title,
                        message: a.message,
                        targetType: a.target_type,
                        targetValue: a.target_value,
                        priority: a.priority || 'NORMAL',
                        date: a.created_at,
                        readBy: a.read_by || [],
                        isArchived: a.is_archived,
                        editedAt: a.edited_at // 🚨 Nueva columna para avisos editados
                    }));
                    set({ announcements: mappedAnns });
                    localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(mappedAnns));
                }

                const bootedAt = new Date().toISOString();
                localStorage.setItem(CACHE_KEYS.AT, bootedAt);

                set({
                    bootStatus: 'ready',
                    lastBootAt: bootedAt,
                });

                return true;
            } catch (e) {
                set({ bootStatus: 'error' });
                return false;
            } finally {
                set({
                    isBootSyncing: false,
                    bootPromise: null,
                });
            }
        })();

        set({ bootPromise });
        return await bootPromise;
    },

    addRole: async (name, parentRoleId = null, secondaryParentRoleId = null) => {
        set({ isLoading: true, error: null });
        try {
            const { data, error } = await supabase
                .from('roles')
                .insert([{
                    name,
                    parent_role_id: parentRoleId,
                    secondary_parent_role_id: secondaryParentRoleId
                }])
                .select()
                .single();

            if (error) throw error;

            set((state) => ({ roles: [...state.roles, data] }));
            return data;
        } catch (error) {
            set({ error: error.message });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    deleteRole: async (roleId, roleName) => {
        const state = get();
        if (state.employees.some(e => e.role_id === roleId || e.secondary_role_id === roleId)) {
            throw new Error("No se puede eliminar: Existen colaboradores asignados a este cargo.");
        }
        if (state.roles.some(r => r.parent_role_id === roleId || r.secondary_parent_role_id === roleId)) {
            throw new Error("No se puede eliminar: Este cargo es superior (o reporte matricial) de otros niveles.");
        }
        try {
            const { error } = await supabase.from('roles').delete().eq('id', roleId);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_CARGO', roleId, { nombre: roleName });
            set((state) => {
                const next = state.roles.filter(r => r.id !== roleId);
                localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(next));
                return { roles: next };
            });
            return true;
        } catch (err) {
            return false;
        }
    },
    updateRole: async (roleId, name, parentRoleId = null, secondaryParentRoleId = null) => {
        set({ isLoading: true, error: null });
        try {
            const { data, error } = await supabase
                .from('roles')
                .update({
                    name,
                    parent_role_id: parentRoleId,
                    secondary_parent_role_id: secondaryParentRoleId
                })
                .eq('id', roleId)
                .select()
                .single();

            if (error) throw error;
            await get().appendAuditLog('EDITAR_CARGO', roleId, { nombre: name });

            set((state) => {
                const next = state.roles.map(r => String(r.id) === String(roleId) ? data : r);
                localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(next));
                return { roles: next };
            });
            return data;
        } catch (error) {
            set({ error: error.message });
            throw error;
        } finally {
            set({ isLoading: false });
        }
    },

    createAnnouncement: async (announcementData) => {
        try {
            const storedUser = safeJsonParse(localStorage.getItem("sb_user"));
            const payload = {
                title: announcementData.title, message: announcementData.message,
                target_type: announcementData.targetType, target_value: announcementData.targetValue,
                priority: announcementData.priority, is_archived: false, read_by: [], created_by: storedUser?.id || null
            };
            const { data, error } = await supabase.from('announcements').insert([payload]).select().single();
            if (error) throw error;
            await get().appendAuditLog('CREAR_AVISO', data.id, { titulo: data.title });

            const newAnn = {
                id: data.id, title: data.title, message: data.message, targetType: data.target_type, targetValue: data.target_value,
                priority: data.priority || 'NORMAL', date: data.created_at, readBy: data.read_by || [], isArchived: data.is_archived
            };

            set((state) => {
                const next = [newAnn, ...state.announcements];
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return newAnn;
        } catch (err) {
            throw err;
        }
    },

    // 🚨 NUEVO: Lógica de Edición de Avisos (Fuerza Re-lectura)
    updateAnnouncement: async (id, updateData, auditDetails) => {
        const { title, message, targetType, targetValue, priority } = updateData;

        try {
            // 1. Actualizamos en Supabase y VACIAR read_by para forzar re-lectura
            const { data, error } = await supabase
                .from('announcements')
                .update({
                    title,
                    message,
                    target_type: targetType,
                    target_value: targetValue,
                    priority,
                    read_by: [], // 🚨 MAGIA: Borramos el historial de lectores
                    edited_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            // 2. Registrar en Auditoría el "Antes y Después"
            await get().appendAuditLog('EDITAR_AVISO', id, auditDetails);

            // 3. Actualizar el estado local (Zustand)
            set((state) => {
                const next = state.announcements.map((ann) =>
                    ann.id === id
                        ? {
                            ...ann,
                            title: data.title,
                            message: data.message,
                            targetType: data.target_type,
                            targetValue: data.target_value,
                            priority: data.priority,
                            readBy: [], // Reset local inmediato
                            editedAt: data.edited_at
                        }
                        : ann
                );
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });

            return data;
        } catch (err) {
            throw err;
        }
    },

    deleteAnnouncement: async (id) => {
        try {
            const { error } = await supabase.from('announcements').delete().eq('id', id);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_AVISO', id, {});
            set((state) => {
                const next = state.announcements.filter(a => String(a.id) !== String(id));
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return true;
        } catch (err) { return false; }
    },

    archiveAnnouncement: async (id) => {
        try {
            const { error } = await supabase.from('announcements').update({ is_archived: true }).eq('id', id);
            if (error) throw error;
            await get().appendAuditLog('ARCHIVAR_AVISO', id, {});
            set((state) => {
                const next = state.announcements.map(a => String(a.id) === String(id) ? { ...a, isArchived: true } : a);
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return true;
        } catch (err) { return false; }
    },

    markAnnouncementAsRead: async (announcementId, employeeId) => {
        try {
            const state = get();
            const ann = state.announcements.find(a => String(a.id) === String(announcementId));
            if (!ann) return false;
            if (ann.readBy.some(r => String(typeof r === 'object' ? r.employeeId : r) === String(employeeId))) return true;

            const updatedReadBy = [...(ann.readBy || []), { employeeId: String(employeeId), readAt: new Date().toISOString() }];
            const { error } = await supabase.from('announcements').update({ read_by: updatedReadBy }).eq('id', announcementId);
            if (error) throw error;

            set((state) => {
                const next = state.announcements.map(a => String(a.id) === String(announcementId) ? { ...a, readBy: updatedReadBy } : a);
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return true;
        } catch (error) { return false; }
    },

    addShift: async (shiftData) => {
        try {
            const payload = { branch_id: shiftData.branchId, name: shiftData.name, start_time: `${shiftData.start}:00`, end_time: `${shiftData.end}:00` };
            const { data, error } = await supabase.from("shifts").insert([payload]).select().single();
            if (error) throw error;
            await get().appendAuditLog('CREAR_TURNO_CATALOGO', data.id, { detalles: payload });

            const newShift = { id: data.id, branchId: data.branch_id, name: data.name, start: data.start_time.substring(0, 5), end: data.end_time.substring(0, 5) };
            set((state) => {
                const next = [...state.shifts, newShift];
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return newShift;
        } catch (err) {
            throw new Error("Error creando turno");
        }
    },

    deleteShift: async (id) => {
        try {
            const { error } = await supabase.from("shifts").delete().eq("id", id);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_TURNO', id, {});
            set((state) => {
                const next = state.shifts.filter(s => String(s.id) !== String(id));
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return true;
        } catch (err) {
            return false;
        }
    },

    fetchWeekRosters: async (weekStartDate) => {
        try {
            const { data, error } = await supabase.from('employee_rosters').select('*').eq('week_start_date', weekStartDate);
            if (error) throw error;
            const rosterMap = {};
            (data || []).forEach(r => { rosterMap[r.employee_id] = r.schedule_data; });
            return rosterMap;
        } catch (err) { return {}; }
    },

    saveWeeklyRoster: async (employeeId, weekStartDate, scheduleData) => {
        try {
            const payload = { employee_id: employeeId, week_start_date: weekStartDate, schedule_data: scheduleData };
            const { error } = await supabase.from('employee_rosters').upsert(payload, { onConflict: 'employee_id, week_start_date' });
            if (error) throw error;
            await get().appendAuditLog('ASIGNAR_TURNO_SEMANAL', employeeId, { semana: weekStartDate, horario: scheduleData });
            return true;
        } catch (err) {
            throw new Error("Error guardando el roster.");
        }
    },
    // ✅ NUEVO: DESCARGA BLINDADA EXCLUSIVA PARA KIOSCOS (Con Caché Offline)
    fetchKioskBoot: async () => {
        try {
            // 🚨 PASO CRUCIAL: Descargar sucursales antes de validar la config local
            const { data: bData } = await supabase.from("branches").select("id, name").order("name");
            if (bData) {
                set({ branches: bData });
                localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(bData));
            }

            const kioskConfigStr = localStorage.getItem('kiosk_config');
            if (!kioskConfigStr) return false; // Salimos, pero las sucursales ya están en el Store

            const config = JSON.parse(kioskConfigStr);
            const today = new Date();
            const dayOfWeek = today.getDay();
            const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
            const monday = new Date(today.setDate(diff));
            const offset = monday.getTimezoneOffset() * 60000;
            const weekStartDate = new Date(monday.getTime() - offset).toISOString().split('T')[0];

            const { data, error } = await supabase.rpc('get_kiosk_boot_payload', {
                p_device_id: config.deviceId,
                p_device_token: config.deviceToken,
                p_week_start: weekStartDate
            });

            if (error) throw error;

            if (data) {
                // 🚨 CAMBIO 2: Si el RPC no trae sucursales, las pedimos por aparte para que el modal siempre tenga data
                if (!data.branches) {
                    const { data: bData } = await supabase.from("branches").select("*").order("name");
                    if (bData) set({ branches: bData });
                }

                const mappedShifts = (data.shifts || []).map(s => ({
                    id: s.id,
                    branchId: s.branch_id,
                    name: s.name,
                    start: s.start_time.substring(0, 5),
                    end: s.end_time.substring(0, 5)
                }));

                const mappedAnnouncements = (data.announcements || []).map(a => ({
                    id: a.id,
                    title: a.title,
                    message: a.message,
                    targetType: a.target_type,
                    targetValue: a.target_value,
                    priority: a.priority || 'NORMAL',
                    readBy: a.read_by || [],
                    editedAt: a.edited_at
                }));

                const mappedEmployees = (data.employees || []).map(e => ({
                    ...e,
                    weeklySchedule: e.weekly_roster
                }));

                set({
                    shifts: mappedShifts,
                    announcements: mappedAnnouncements,
                    employees: mappedEmployees,
                    branches: data.branches || []
                });

                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(mappedShifts));
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(mappedAnnouncements));
                localStorage.setItem(CACHE_KEYS.EMPLOYEES, JSON.stringify(mappedEmployees));
                if (data.branches) {
                    localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(data.branches));
                }
            }

            return true;
        } catch (error) {
            console.error("Error en Kiosk Boot:", error);
            return false;
        }
    },
});