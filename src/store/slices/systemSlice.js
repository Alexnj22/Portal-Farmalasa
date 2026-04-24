import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, SENSITIVE_FIELDS, persistEmployees } from '../utils';

export const createSystemSlice = (set, get) => ({
    // 🚨 1. INICIALIZAMOS HOLIDAYS Y EL RESTO (Desde LocalStorage si existe)
    shifts: safeJsonParse(localStorage.getItem(CACHE_KEYS.SHIFTS), []) || [],
    roles: safeJsonParse(localStorage.getItem(CACHE_KEYS.ROLES), []) || [],
    announcements: safeJsonParse(localStorage.getItem(CACHE_KEYS.ANNOUNCEMENTS), []) || [],
    holidays: safeJsonParse(localStorage.getItem(CACHE_KEYS.HOLIDAYS), []) || [],
    isBootSyncing: false,
    bootStatus: 'idle',
    bootPromise: null,
    lastBootAt: null,
    _announcementsChannel: null,

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
    setHolidays: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.holidays) : updater;
        return { holidays: next };
    }),

    resetBootState: () => {
        const ch = get()._announcementsChannel;
        if (ch) supabase.removeChannel(ch);
        set({
            isBootSyncing: false,
            bootStatus: 'idle',
            bootPromise: null,
            lastBootAt: null,
            _announcementsChannel: null,
        });
    },

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
            set({ isBootSyncing: true, bootStatus: 'loading' });

            try {
                // Calcular lunes local sin mutar Date y sin problemas de DST
                const now = new Date();
                const dow = now.getDay();
                const monday = new Date(now);
                monday.setDate(now.getDate() - dow + (dow === 0 ? -6 : 1));
                monday.setHours(0, 0, 0, 0);
                const weekStartDate = monday.toLocaleDateString('en-CA'); // YYYY-MM-DD local

                // Todas las queries en paralelo — de ~3-4s secuencial a ~600ms
                const [
                    { data: holidaysData },
                    { data: branchData },
                    { data: rolesData },
                    { data: shiftsData },
                    { data: rostersData },
                    { data: empData },
                    { data: eventsData },
                    { data: docsData },
                    { data: annData },
                ] = await Promise.all([
                    supabase.from('holidays').select('*').order('holiday_date', { ascending: true }),
                    supabase.from('branches').select('*').order('id', { ascending: true }),
                    supabase.from('roles').select('*').order('name', { ascending: true }),
                    supabase.from('shifts').select('*'),
                    supabase.from('employee_rosters').select('*').eq('week_start_date', weekStartDate),
                    supabase.from('employees_safe').select(`*, main_role:roles!employees_role_id_fkey(id, name), sec_role:roles!employees_secondary_role_id_fkey(id, name)`),
                    supabase.from('employee_events').select('*'),
                    supabase.from('employee_documents').select('*'),
                    supabase.from('announcements').select('*').order('created_at', { ascending: false }),
                ]);

                // Holidays
                if (holidaysData) {
                    set({ holidays: holidaysData });
                    localStorage.setItem(CACHE_KEYS.HOLIDAYS, JSON.stringify(holidaysData));
                }

                // Branches
                if (branchData) {
                    const mappedBranches = branchData.map((b) => ({
                        ...b,
                        weeklyHours: b.weekly_hours,
                        propertyType: b.settings?.propertyType || 'OWNED',
                        rent: b.settings?.rent || null,
                        type: b.type || 'FARMACIA',
                    }));
                    set({ branches: mappedBranches });
                    localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(mappedBranches));
                }

                // Roles
                if (rolesData) {
                    set({ roles: rolesData });
                    localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(rolesData));
                }

                // Shifts
                if (shiftsData) {
                    const mappedShifts = shiftsData.map((s) => ({
                        id: s.id,
                        branchId: s.branch_id,
                        name: s.name,
                        start: s.start_time.substring(0, 5),
                        end: s.end_time.substring(0, 5),
                        is_active: s.is_active,
                    }));
                    set({ shifts: mappedShifts });
                    localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(mappedShifts));
                }

                // Announcements
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
                        prevReadBy: a.prev_read_by || [],
                        isArchived: a.is_archived,
                        editedAt: a.edited_at,
                        scheduledFor: a.scheduled_for,
                        metadata: a.metadata || null,
                    }));
                    set({ announcements: mappedAnns });
                    localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(mappedAnns));
                }

                // Employees + events + docs (merged)
                const rosterMap = {};
                (rostersData || []).forEach((r) => { rosterMap[r.employee_id] = r.schedule_data; });

                if (empData) {
                    const mappedEmployees = empData.map((e) => {
                        const myHistory = eventsData ? eventsData.filter((ev) => String(ev.employee_id) === String(e.id)) : [];
                        const myDocs = docsData ? docsData.filter((d) => String(d.employee_id) === String(e.id)) : [];
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

                    set({ employees: mappedEmployees });
                    persistEmployees(mappedEmployees);
                }

                const bootedAt = new Date().toISOString();
                localStorage.setItem(CACHE_KEYS.AT, bootedAt);

                set({
                    bootStatus: 'ready',
                    lastBootAt: bootedAt,
                });

                // ── Real-time: escuchar inserts/updates en announcements ──────────
                // Solo suscribir una vez — si ya hay canal activo, no crear otro
                if (!get()._announcementsChannel) {
                    const mapAnn = (a) => ({
                        id: a.id,
                        title: a.title,
                        message: a.message,
                        targetType: a.target_type,
                        targetValue: a.target_value,
                        priority: a.priority || 'NORMAL',
                        date: a.created_at,
                        readBy: a.read_by || [],
                        prevReadBy: a.prev_read_by || [],
                        isArchived: a.is_archived,
                        editedAt: a.edited_at,
                        scheduledFor: a.scheduled_for,
                        metadata: a.metadata || null,
                    });

                    const channel = supabase
                        .channel('announcements-live')
                        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (payload) => {
                            const a = payload.new;
                            if (a.is_archived) return;
                            if (a.scheduled_for && new Date(a.scheduled_for) > new Date()) return;
                            set(state => {
                                if (state.announcements.some(ann => String(ann.id) === String(a.id))) return state;
                                return { announcements: [mapAnn(a), ...state.announcements] };
                            });
                        })
                        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'announcements' }, (payload) => {
                            const a = payload.new;
                            set(state => ({
                                announcements: state.announcements.map(existing =>
                                    existing.id === a.id ? { ...existing, ...mapAnn(a) } : existing
                                ),
                            }));
                        })
                        .subscribe();

                    set({ _announcementsChannel: channel });
                }

                return true;
            } catch (e) {
                console.error("🔥 Error crítico en fetchBoot:", e.message || e);
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

    // ============================================================================
    // 🚨 CREAR NOVEDAD / EVENTO RRHH (El motor detrás del FormNovedad)
    // ============================================================================
    registerEmployeeEvent: async (employeeId, eventData, file = null, options = {}) => {
        try {
            // 1. Extraemos la fecha de los permisos si es múltiple
            const isPermission = eventData.type === 'PERMIT';
            const primaryDate = isPermission && eventData.permissionDates?.length > 0
                ? eventData.permissionDates[0] // Primer día como fecha principal del registro
                : (eventData.date || new Date().toISOString().split('T')[0]);

            // 2. Resolver nombre de sucursal destino (SUPPORT / TRANSFER)
            const needsBranchName = eventData.type === 'SUPPORT' || eventData.type === 'TRANSFER';
            let targetBranchName = null;
            if (needsBranchName && eventData.targetBranchId) {
                const state = get();
                const targetBranch = (state.branches || []).find(
                    b => String(b.id) === String(eventData.targetBranchId)
                );
                targetBranchName = targetBranch?.name || null;
            }

            // 2.5 Validar solapamiento de eventos del mismo tipo (antes de insertar)
            if (['VACATION', 'DISABILITY', 'SUPPORT'].includes(eventData.type)) {
                let query = supabase
                    .from('employee_events')
                    .select('date, metadata')
                    .eq('employee_id', employeeId)
                    .eq('type', eventData.type);
                if (options.excludeEventId) query = query.neq('id', options.excludeEventId);
                const { data: existing } = await query;

                if (existing && existing.length > 0) {
                    const parseMeta = (ev) => {
                        try { return typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : (ev.metadata || {}); }
                        catch { return {}; }
                    };

                    if (eventData.type === 'SUPPORT') {
                        const newRanges = eventData.supportRanges || [];
                        for (const ev of existing) {
                            const meta = parseMeta(ev);
                            const existingRanges = meta.supportRanges || [];
                            for (const nr of newRanges) {
                                const conflictingRanges = existingRanges.filter(
                                    er => nr.start <= er.end && nr.end >= er.start
                                );
                                if (conflictingRanges.length > 0) {
                                    const branchName = meta.targetBranchName ||
                                        (meta.targetBranchId ? `Sucursal ID ${meta.targetBranchId}` : 'otra sucursal');
                                    const conflictDates = conflictingRanges
                                        .map(r => `${r.start} al ${r.end}`)
                                        .join(', ');
                                    throw new Error(
                                        `OVERLAP_ERROR: Ya existe un Apoyo Temporal en ${branchName} del ${conflictDates}. No se puede registrar un período solapado.`
                                    );
                                }
                            }
                        }
                    } else {
                        // VACATION / DISABILITY — fecha + endDate en metadata
                        const newStart = eventData.date;
                        const newEnd = eventData.endDate || eventData.date;
                        for (const ev of existing) {
                            const meta = parseMeta(ev);
                            const exStart = ev.date;
                            const exEnd = meta.endDate || ev.date;
                            if (newStart <= exEnd && newEnd >= exStart) {
                                if (eventData.type === 'VACATION') {
                                    throw new Error(
                                        `OVERLAP_ERROR: Ya existe un período de Vacaciones del ${exStart} al ${exEnd}. No se puede registrar un nuevo período solapado.`
                                    );
                                } else {
                                    throw new Error(
                                        `OVERLAP_ERROR: Ya existe una Incapacidad activa del ${exStart} al ${exEnd}. No se puede registrar otra incapacidad en esas fechas.`
                                    );
                                }
                            }
                        }
                    }
                }
            }

            // 3. Armamos el payload seguro para Supabase
            const dbPayload = {
                employee_id: employeeId,
                type: eventData.type,
                date: primaryDate,
                note: eventData.note || '',
                metadata: {
                    ...eventData,
                    permissionDates: isPermission ? (eventData.permissionDates || []) : null,
                    ...(needsBranchName && { targetBranchName })
                }
            };

            const { data: newEvent, error } = await supabase.from('employee_events').insert([dbPayload]).select().single();
            if (error) throw error;
            
            const empEvento = get().employees.find(e => String(e.id) === String(employeeId));
            
            // 3. Auditoría Global
            await get().appendAuditLog('ACCION_RRHH', employeeId, {
                timeline_title: `Evento RRHH: ${eventData.type.replace(/_/g, ' ')}`,
                dimension: 'HR',
                branch_id: empEvento?.branchId,
                new_value: eventData.note || 'Evento registrado'
            });

            // 4. Si hay documento adjunto (Boleta ISSS, Finiquito, etc), lo subimos a Storage
            let docObject = null;
            if (file) {
                const url = await get().uploadFileToStorage(file, 'documents');
                if (url) {
                    const { data: newDoc } = await supabase.from('employee_documents').insert([{ 
                        employee_id: employeeId, 
                        event_id: newEvent.id, 
                        name: file.name, 
                        type: 'DOCUMENT', 
                        url: url 
                    }]).select().single();
                    docObject = newDoc;
                }
            }

            // Refrescamos vistas globalmente (skip si se llama desde editEmployeeEvent)
            if (!options.skipRefresh) {
                window.dispatchEvent(new CustomEvent('force-history-refresh'));
            }

            // 5. Actualizamos el estado en Zustand (Memoria RAM)
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
            console.error("Error registrando evento de empleado:", err);
            if (err?.message?.startsWith('OVERLAP_ERROR:')) throw err;
            return null;
        }
    },

    cancelEmployeeEvent: async (eventId, reason) => {
        try {
            const { data: existing, error: fetchErr } = await supabase
                .from('employee_events')
                .select('metadata, employee_id')
                .eq('id', eventId)
                .single();
            if (fetchErr) throw fetchErr;

            const currentMeta = typeof existing.metadata === 'string'
                ? JSON.parse(existing.metadata)
                : (existing.metadata || {});

            const { error: updateErr } = await supabase
                .from('employee_events')
                .update({
                    metadata: {
                        ...currentMeta,
                        status: 'CANCELLED',
                        cancelledAt: new Date().toISOString(),
                        cancelReason: reason
                    }
                })
                .eq('id', eventId);
            if (updateErr) throw updateErr;

            // Actualizar estado local sin refetch completo
            set((state) => ({
                employees: state.employees.map(emp =>
                    String(emp.id) !== String(existing.employee_id) ? emp : {
                        ...emp,
                        history: (emp.history || []).map(ev =>
                            String(ev.id) !== String(eventId) ? ev : {
                                ...ev,
                                metadata: {
                                    ...(typeof ev.metadata === 'object' ? ev.metadata : {}),
                                    status: 'CANCELLED',
                                    cancelledAt: new Date().toISOString(),
                                    cancelReason: reason
                                }
                            }
                        )
                    }
                )
            }));

            window.dispatchEvent(new CustomEvent('employee-event-updated', { detail: { employeeId: existing.employee_id } }));
            return true;
        } catch (err) {
            console.error('Error cancelando evento:', err);
            return false;
        }
    },

    editEmployeeEvent: async (eventId, newEventData, employeeId) => {
        try {
            const { data: existing } = await supabase
                .from('employee_events')
                .select('metadata')
                .eq('id', eventId)
                .single();

            const currentMeta = typeof existing.metadata === 'string'
                ? JSON.parse(existing.metadata)
                : (existing.metadata || {});

            await supabase
                .from('employee_events')
                .update({
                    metadata: {
                        ...currentMeta,
                        status: 'SUPERSEDED',
                        editedAt: new Date().toISOString()
                    }
                })
                .eq('id', eventId);

            const cleanData = { ...newEventData };
            delete cleanData._editingEventId;

            const newId = await get().registerEmployeeEvent(
                employeeId,
                { ...cleanData, originalEventId: eventId, isEdit: true },
                null,
                { excludeEventId: eventId, skipRefresh: true }
            );

            set((state) => ({
                employees: state.employees.map(emp =>
                    String(emp.id) !== String(employeeId) ? emp : {
                        ...emp,
                        history: (emp.history || []).map(ev =>
                            String(ev.id) !== String(eventId) ? ev : {
                                ...ev,
                                metadata: {
                                    ...(typeof ev.metadata === 'object' ? ev.metadata : {}),
                                    status: 'SUPERSEDED',
                                    editedAt: new Date().toISOString()
                                }
                            }
                        )
                    }
                )
            }));

            window.dispatchEvent(new CustomEvent('employee-event-updated', { detail: { employeeId } }));
            return newId;
        } catch (err) {
            console.error('Error editando evento:', err);
            return null;
        }
    },

    // ============================================================================
    // RESTO DE FUNCIONES DEL SLICE 
    // ============================================================================
    addRole: async (name, parentRoleId = null, secondaryParentRoleId = null, scope = 'BRANCH', maxLimit = 99) => {
        const { data, error } = await supabase
            .from('roles')
            .insert([{ name, parent_role_id: parentRoleId, secondary_parent_role_id: secondaryParentRoleId, scope, max_limit: maxLimit }])
            .select()
            .single();
        if (error) throw error;
        window.dispatchEvent(new CustomEvent('force-history-refresh'));
        set((state) => {
            const next = [...state.roles, data];
            localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(next));
            return { roles: next };
        });
        return data;
    },

    updateRole: async (roleId, name, parentRoleId = null, secondaryParentRoleId = null, scope = 'BRANCH', maxLimit = 99) => {
        const { data, error } = await supabase
            .from('roles')
            .update({ name, parent_role_id: parentRoleId, secondary_parent_role_id: secondaryParentRoleId, scope, max_limit: maxLimit })
            .eq('id', roleId)
            .select()
            .single();
        if (error) throw error;
        await get().appendAuditLog('EDITAR_CARGO', roleId, {
            timeline_title: `Actualización de Cargo: ${name}`,
            dimension: 'HR',
            new_value: 'Configuración actualizada',
        });
        window.dispatchEvent(new CustomEvent('force-history-refresh'));
        set((state) => {
            const next = state.roles.map(r => String(r.id) === String(roleId) ? data : r);
            localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(next));
            return { roles: next };
        });
        return data;
    },


    deleteRole: async (roleId, roleName) => {
        const state = get();
        if (state.employees.some(e => String(e.role_id) === String(roleId) || String(e.secondary_role_id) === String(roleId))) {
            throw new Error("No se puede eliminar: Existen colaboradores asignados a este cargo.");
        }
        if (state.roles.some(r => r.parent_role_id === roleId || r.secondary_parent_role_id === roleId)) {
            throw new Error("No se puede eliminar: Este cargo es superior (o reporte matricial) de otros niveles.");
        }
        try {
            const { error } = await supabase.from('roles').delete().eq('id', roleId);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_CARGO', roleId, {
                timeline_title: `Eliminación de Cargo: ${roleName}`,
                dimension: 'HR',
                old_value: 'Cargo Activo',
                new_value: 'Eliminado del Sistema'
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.roles.filter(r => r.id !== roleId);
                localStorage.setItem(CACHE_KEYS.ROLES, JSON.stringify(next));
                return { roles: next };
            });
            return true;
        } catch (err) {
            console.error("Error eliminando rol:", err);
            return false;
        }
    },

    createAnnouncement: async (announcementData) => {
        try {
            const storedUser = safeJsonParse(localStorage.getItem("sb_user"));
            const payload = {
                title: announcementData.title,
                message: announcementData.message,
                target_type: announcementData.targetType,
                target_value: announcementData.targetValue,
                priority: announcementData.priority,
                is_archived: false,
                read_by: [],
                created_by: storedUser?.id || null,
                scheduled_for: announcementData.scheduledFor || null
            };
            const { data, error } = await supabase.from('announcements').insert([payload]).select().single();
            if (error) throw error;
            await get().appendAuditLog('CREAR_AVISO', data.id, {
                timeline_title: `Nuevo Aviso: ${data.title}`,
                dimension: 'OPERATIVE',
                new_value: `Prioridad: ${data.priority}`
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const newAnn = {
                id: data.id,
                title: data.title,
                message: data.message,
                targetType: data.target_type,
                targetValue: data.target_value,
                priority: data.priority || 'NORMAL',
                date: data.created_at,
                readBy: data.read_by || [],
                isArchived: data.is_archived,
                scheduledFor: data.scheduled_for
            };

            set((state) => {
                const next = [newAnn, ...state.announcements];
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return newAnn;
        } catch (err) {
            console.error("Error creando aviso:", err);
            throw err;
        }
    },

    updateAnnouncement: async (id, updateData, auditDetails) => {
        const { title, message, targetType, targetValue, priority, scheduledFor } = updateData;

        try {
            // Capture current readers before resetting — stored in prev_read_by for transparency
            const currentAnn = get().announcements.find(a => a.id === id);
            const previousReaders = currentAnn?.readBy || [];

            const { data, error } = await supabase
                .from('announcements')
                .update({
                    title,
                    message,
                    target_type: targetType,
                    target_value: targetValue,
                    priority,
                    scheduled_for: scheduledFor || null,
                    edited_at: new Date().toISOString(),
                    prev_read_by: previousReaders,
                    read_by: [],
                })
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            await get().appendAuditLog('EDITAR_AVISO', id, {
                timeline_title: `Aviso Editado: ${title}`,
                dimension: 'OPERATIVE',
                ...auditDetails
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

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
                            scheduledFor: data.scheduled_for,
                            readBy: [],
                            prevReadBy: previousReaders,
                            editedAt: data.edited_at
                        }
                        : ann
                );
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });

            return data;
        } catch (err) {
            console.error("Error editando aviso:", err);
            throw err;
        }
    },

    deleteAnnouncement: async (id) => {
        try {
            const { error } = await supabase.from('announcements').delete().eq('id', id);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_AVISO', id, {
                timeline_title: `Eliminación de Aviso ID: ${id}`,
                dimension: 'OPERATIVE',
                new_value: 'Eliminado Permanentemente'
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.announcements.filter(a => String(a.id) !== String(id));
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return true;
        } catch (err) {
            console.error("Error eliminando aviso:", err);
            return false;
        }
    },

    archiveAnnouncement: async (id) => {
        try {
            const { error } = await supabase.from('announcements').update({ is_archived: true }).eq('id', id);
            if (error) throw error;
            await get().appendAuditLog('ARCHIVAR_AVISO', id, {
                timeline_title: `Aviso Archivado ID: ${id}`,
                dimension: 'OPERATIVE',
                new_value: 'Movido al archivo'
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.announcements.map(a => String(a.id) === String(id) ? { ...a, isArchived: true } : a);
                localStorage.setItem(CACHE_KEYS.ANNOUNCEMENTS, JSON.stringify(next));
                return { announcements: next };
            });
            return true;
        } catch (err) {
            console.error("Error archivando aviso:", err);
            return false;
        }
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
        } catch (error) {
            console.error("Error marcando aviso como leído:", error);
            return false;
        }
    },

    addShift: async (shiftData) => {
        try {
            const payload = { branch_id: shiftData.branchId, name: shiftData.name, start_time: `${shiftData.start}:00`, end_time: `${shiftData.end}:00` };
            const { data, error } = await supabase.from("shifts").insert([payload]).select().single();
            if (error) throw error;
            await get().appendAuditLog('CREAR_TURNO_CATALOGO', data.id, {
                timeline_title: `Nuevo Turno Creado: ${data.name}`,
                dimension: 'OPERATIVE',
                branch_id: data.branch_id,
                new_value: `${data.start_time.substring(0, 5)} a ${data.end_time.substring(0, 5)}`
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const newShift = { id: data.id, branchId: data.branch_id, name: data.name, start: data.start_time.substring(0, 5), end: data.end_time.substring(0, 5) };
            set((state) => {
                const next = [...state.shifts, newShift];
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return newShift;
        } catch (err) {
            console.error("Error creando turno:", err);
            throw new Error("Error creando turno");
        }
    },

    deleteShift: async (id) => {
        try {
            const { error } = await supabase.from("shifts").delete().eq("id", id);
            if (error) throw error;
            await get().appendAuditLog('ELIMINAR_TURNO', id, {
                timeline_title: `Turno Eliminado ID: ${id}`,
                dimension: 'OPERATIVE',
                new_value: 'Eliminado Permanentemente'
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.shifts.filter(s => String(s.id) !== String(id));
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return true;
        } catch (err) {
            console.error("Error eliminando turno:", err);
            return false;
        }
    },

    updateShift: async (id, shiftData) => {
        try {
            const { data, error } = await supabase.from("shifts").update(shiftData).eq("id", id).select().single();
            if (error) throw error;

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.shifts.map(s => String(s.id) === String(id) ? {
                    ...s,
                    branchId: data.branch_id,
                    name: data.name,
                    start: data.start_time.substring(0, 5),
                    end: data.end_time.substring(0, 5),
                    is_active: data.is_active
                } : s);
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return data;
        } catch (err) {
            throw new Error(err.message);
        }
    },

    archiveShift: async (id) => {
        try {
            const { error } = await supabase.from("shifts").update({ is_active: false }).eq("id", id);
            if (error) throw error;

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.shifts.map(s => String(s.id) === String(id) ? { ...s, is_active: false } : s);
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return true;
        } catch (err) {
            throw new Error("Error al archivar el turno");
        }
    },

    unarchiveShift: async (id) => {
        try {
            const { error } = await supabase.from("shifts").update({ is_active: true }).eq("id", id);
            if (error) throw error;

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.shifts.map(s => String(s.id) === String(id) ? { ...s, is_active: true } : s);
                localStorage.setItem(CACHE_KEYS.SHIFTS, JSON.stringify(next));
                return { shifts: next };
            });
            return true;
        } catch (err) {
            throw new Error("Error al reactivar el turno");
        }
    },

    fetchWeekRosters: async (weekStartDate) => {
        try {
            const { data, error } = await supabase.from('employee_rosters').select('*').eq('week_start_date', weekStartDate);
            if (error) throw error;

            const rosterMap = {};
            (data || []).forEach(r => {
                let parsedSchedule = r.schedule_data;
                if (typeof parsedSchedule === 'string') {
                    try { parsedSchedule = JSON.parse(parsedSchedule); } catch (e) { parsedSchedule = {}; }
                }
                rosterMap[r.employee_id] = parsedSchedule;
            });

            return rosterMap;
        } catch (err) {
            console.error("Error cargando el roster semanal:", err);
            return {};
        }
    },

    saveWeeklyRoster: async (employeeId, weekStartDate, scheduleData) => {
        try {
            const payload = { employee_id: employeeId, week_start_date: weekStartDate, schedule_data: scheduleData };
            const { error } = await supabase.from('employee_rosters').upsert(payload, { onConflict: 'employee_id, week_start_date' });
            if (error) throw error;
            await get().appendAuditLog('ASIGNAR_TURNO_SEMANAL', employeeId, {
                timeline_title: `Asignación de Horario Semanal`,
                dimension: 'HR',
                new_value: `Semana: ${weekStartDate}`
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            return true;
        } catch (err) {
            console.error("Error guardando el roster:", err);
            throw new Error("Error guardando el roster.");
        }
    },

    saveBulkWeeklyRosters: async (weekStartDate, schedulesMap) => {
        try {
            const inserts = Object.keys(schedulesMap).map(empId => ({
                employee_id: empId,
                week_start_date: weekStartDate,
                schedule_data: schedulesMap[empId],
                status: 'DRAFT',
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase
                .from('employee_rosters')
                .upsert(inserts, { onConflict: 'employee_id,week_start_date' });

            if (error) throw error;

            await get().fetchWeekRosters(weekStartDate);
            return true;
        } catch (err) {
            console.error("Error guardando roster masivo de IA:", err);
            throw new Error("No se pudo guardar la sugerencia de la IA.");
        }
    },

    publishWeekRosters: async (weekStartDate, branchId = 'ALL') => {
        try {
            let query = supabase
                .from('employee_rosters')
                .update({ status: 'PUBLISHED' })
                .eq('week_start_date', weekStartDate);

            if (branchId !== 'ALL') {
                const state = get();
                const branchEmployees = state.employees
                    .filter(e => String(e.branchId || e.branch_id) === String(branchId))
                    .map(e => e.id);

                if (branchEmployees.length === 0) return true;
                query = query.in('employee_id', branchEmployees);
            }

            const { error } = await query;
            if (error) throw error;

            await get().appendAuditLog('PUBLICAR_HORARIOS', branchId === 'ALL' ? 'GLOBAL' : branchId, {
                timeline_title: `Publicación de Horarios`,
                dimension: 'HR',
                new_value: `Semana del ${weekStartDate}`
            });

            return true;
        } catch (err) {
            console.error("Error publicando horarios:", err);
            throw new Error("No se pudieron publicar los horarios.");
        }
    },
    fetchKioskBoot: async () => {
        try {
            const { data: bData } = await supabase.from("branches").select("id, name").order("name");
            if (bData) {
                set({ branches: bData });
                localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(bData));
            }

            const kioskConfigStr = localStorage.getItem('kiosk_config');
            if (!kioskConfigStr) return false;

            const config = JSON.parse(kioskConfigStr);
            const now = new Date();
            const dow = now.getDay();
            const monday = new Date(now);
            monday.setDate(now.getDate() - dow + (dow === 0 ? -6 : 1));
            monday.setHours(0, 0, 0, 0);
            const weekStartDate = monday.toLocaleDateString('en-CA');

            const { data, error } = await supabase.rpc('get_kiosk_boot_payload', {
                p_device_id: config.deviceId,
                p_device_token: config.deviceToken,
                p_week_start: weekStartDate
            });

            if (error) throw error;

            if (data) {
                if (!data.branches) {
                    const { data: bData } = await supabase.from("branches").select("*").order("name");
                    if (bData) set({ branches: bData });
                }

                // 🚨 CARGAMOS LOS ASUETOS PARA EL KIOSCO TAMBIÉN
                if (data.holidays) {
                    set({ holidays: data.holidays });
                    localStorage.setItem(CACHE_KEYS.HOLIDAYS, JSON.stringify(data.holidays));
                }

                const mappedShifts = (data.shifts || []).map(s => ({
                    id: s.id,
                    branchId: s.branch_id,
                    name: s.name,
                    start: s.start_time.substring(0, 5),
                    end: s.end_time.substring(0, 5)
                }));

                const nowISO = new Date().toISOString();

                const mappedAnnouncements = (data.announcements || [])
                    .filter(a => !a.is_archived && (!a.scheduled_for || a.scheduled_for <= nowISO))
                    .map(a => ({
                        id: a.id,
                        title: a.title,
                        message: a.message,
                        targetType: a.target_type,
                        targetValue: a.target_value,
                        priority: a.priority || 'NORMAL',
                        readBy: a.read_by || [],
                        prevReadBy: a.prev_read_by || [],
                        editedAt: a.edited_at,
                        scheduledFor: a.scheduled_for,
                        metadata: a.metadata || null,
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
                const safeKioskEmployees = mappedEmployees.map(emp => {
                    const safeEmp = { ...emp };
                    SENSITIVE_FIELDS.forEach(f => delete safeEmp[f]);
                    return safeEmp;
                });
                localStorage.setItem(CACHE_KEYS.EMPLOYEES, JSON.stringify(safeKioskEmployees));
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
    addDocumentToEvent: async (employeeId, eventId, file) => {
        if (!file) return;
        try {
            const url = await get().uploadFileToStorage(file, 'documents');
            if (!url) throw new Error("Fallo al subir el archivo al storage");

            const { data: newDoc, error } = await supabase.from('employee_documents').insert([{ employee_id: employeeId, event_id: eventId || null, name: file.name, type: 'UPLOAD', url: url }]).select().single();
            if (error) throw error;

            const empDoc = get().employees.find(e => String(e.id) === String(employeeId));
            await get().appendAuditLog('DOCUMENTO_HISTORICO', employeeId, {
                timeline_title: `Documento RRHH Subido: ${empDoc?.name || ''}`,
                dimension: 'HR',
                branch_id: empDoc?.branchId,
                new_value: file.name,
                file_url: url 
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            set((state) => {
                const next = state.employees.map(emp => String(emp.id) !== String(employeeId) ? emp : {
                    ...emp,
                    documents: [...(emp.documents || []), newDoc]
                });
                persistEmployees(next);
                return { employees: next };
            });
        } catch (e) {
            console.error("Error subiendo documento al evento:", e);
        }
    },
});