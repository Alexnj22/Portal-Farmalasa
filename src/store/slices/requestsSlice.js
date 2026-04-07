import { supabase } from '../../supabaseClient';
import { useToastStore } from '../toastStore';

// ============================================================================
// 📋 SOLICITUDES — Employee-initiated requests requiring admin approval
// ============================================================================

export const REQUEST_TYPES = {
    VACATION:     { label: 'Vacaciones',         color: 'bg-amber-100 text-amber-800',    border: 'border-amber-200' },
    PERMIT:       { label: 'Permiso / Licencia', color: 'bg-purple-100 text-purple-800',  border: 'border-purple-200' },
    SHIFT_CHANGE: { label: 'Cambio de Turno',    color: 'bg-cyan-100 text-cyan-800',      border: 'border-cyan-200' },
    OVERTIME:     { label: 'Horas Extra',        color: 'bg-orange-100 text-orange-800',  border: 'border-orange-200' },
    ADVANCE:      { label: 'Anticipo Salarial',  color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200' },
    CERTIFICATE:  { label: 'Constancia Laboral', color: 'bg-blue-100 text-blue-800',      border: 'border-blue-200' },
};

export const REQUEST_STATUS = {
    PENDING:   { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700',  border: 'border-yellow-200',  dot: 'bg-yellow-400' },
    APPROVED:  { label: 'Aprobada',   color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
    REJECTED:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700',        border: 'border-red-200',     dot: 'bg-red-500' },
    CANCELLED: { label: 'Cancelada',  color: 'bg-slate-100 text-slate-500',    border: 'border-slate-200',   dot: 'bg-slate-400' },
};

// ── Helpers internos ────────────────────────────────────────────────────────

const parseMeta = (raw) =>
    typeof raw === 'object' && raw !== null
        ? raw
        : (() => { try { return JSON.parse(raw); } catch { return {}; } })();

/**
 * Verifica si un empleado está actualmente en vacaciones o incapacidad.
 * Consulta employee_events tipo VACATION o DISABILITY cuya fecha de inicio ≤ hoy
 * y cuya endDate ≥ hoy (o sin endDate = vigente indefinidamente).
 */
const isUnavailable = async (employeeId) => {
    const today = new Date().toISOString().split('T')[0];
    try {
        const { data: events } = await supabase
            .from('employee_events')
            .select('date, metadata')
            .eq('employee_id', employeeId)
            .in('type', ['VACATION', 'DISABILITY'])
            .lte('date', today);

        if (!events?.length) return false;

        return events.some(ev => {
            const meta = parseMeta(ev.metadata);
            if (meta?.status === 'CANCELLED' || meta?.status === 'SUPERSEDED') return false;
            return !meta?.endDate || meta.endDate >= today;
        });
    } catch {
        return false; // En caso de error, asumimos disponible
    }
};

/**
 * Resuelve el aprobador designado subiendo recursivamente por la jerarquía de roles
 * hasta encontrar un empleado disponible, con fallback a admin de sucursal y global.
 */
const resolveApprover = async (employeeId, branchId, roleId) => {
    try {
        // Cargar todos los roles de una vez para recorrer el árbol sin N queries
        const { data: allRoles } = await supabase
            .from('roles')
            .select('id, name, parent_role_id, secondary_parent_role_id');

        if (!allRoles) return null;
        const roleMap = Object.fromEntries(allRoles.map(r => [r.id, r]));

        const findAvailableInRole = async (targetRoleId) => {
            const { data } = await supabase
                .from('employees')
                .select('id')
                .eq('role_id', targetRoleId)
                .eq('branch_id', branchId)
                .eq('status', 'ACTIVO')
                .neq('id', employeeId);

            for (const c of (data || [])) {
                if (!(await isUnavailable(c.id))) return c.id;
            }
            return null;
        };

        // Subir por la jerarquía hasta encontrar aprobador
        let currentRoleId = roleId;
        const visited = new Set();

        while (currentRoleId && !visited.has(currentRoleId)) {
            visited.add(currentRoleId);
            const role = roleMap[currentRoleId];
            if (!role) break;

            if (role.parent_role_id) {
                const found = await findAvailableInRole(role.parent_role_id);
                if (found) return found;

                if (role.secondary_parent_role_id) {
                    const found2 = await findAvailableInRole(role.secondary_parent_role_id);
                    if (found2) return found2;
                }

                currentRoleId = role.parent_role_id;
            } else {
                break; // Llegamos a la raíz
            }
        }

        // Fallback: cualquier admin activo en la sucursal
        const { data: admins } = await supabase
            .from('employees')
            .select('id')
            .eq('branch_id', branchId)
            .eq('is_admin', true)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId);

        if (admins?.[0]?.id) return admins[0].id;

        // Último fallback: cualquier admin global
        const { data: globalAdmins } = await supabase
            .from('employees')
            .select('id')
            .eq('is_admin', true)
            .eq('status', 'ACTIVO')
            .neq('id', employeeId)
            .limit(1);

        return globalAdmins?.[0]?.id || null;
    } catch (err) {
        console.error('Error resolviendo aprobador:', err);
        return null;
    }
};

const resolveNextApprover = async (level, branchId, excludeId = null) => {
    try {
        const findBySystemRole = async (roles) => {
            for (const role of roles) {
                let q = supabase.from('employees')
                    .select('id')
                    .eq('system_role', role)
                    .eq('status', 'ACTIVO');
                if (excludeId) q = q.neq('id', excludeId);
                const { data } = await q;
                for (const c of (data || [])) {
                    if (!(await isUnavailable(c.id))) return c.id;
                }
            }
            return null;
        };

        const findByRoleId = async (roleIds, sameBranch = false) => {
            for (const roleId of roleIds) {
                let q = supabase.from('employees')
                    .select('id')
                    .eq('role_id', roleId)
                    .eq('status', 'ACTIVO');
                if (sameBranch && branchId) q = q.eq('branch_id', branchId);
                if (excludeId) q = q.neq('id', excludeId);
                const { data } = await q;
                for (const c of (data || [])) {
                    if (!(await isUnavailable(c.id))) return c.id;
                }
            }
            return null;
        };

        if (level === 2) {
            // Supervisor de Ventas (role_id=13) o system_role=SUPERVISOR
            return await findBySystemRole(['SUPERVISOR'])
                || await findByRoleId([13])
                || await findBySystemRole(['ADMIN', 'SUPERADMIN']);
        }

        if (level === 3) {
            // Talento Humano (role_id=11) o system_role=ADMIN
            return await findByRoleId([11])
                || await findBySystemRole(['ADMIN'])
                || await findBySystemRole(['SUPERADMIN'])
                || (await supabase.from('employees')
                    .select('id')
                    .eq('is_admin', true)
                    .eq('status', 'ACTIVO')
                    .limit(1)).data?.[0]?.id
                || null;
        }

        return null;
    } catch { return null; }
};

/**
 * Crea un anuncio interno dirigido al empleado notificándole el resultado
 * de su solicitud. No lanza error si falla — la notificación es no-bloqueante.
 */
const notifyEmployee = async (employeeId, approverId, requestType, status, approverNote) => {
    try {
        const typeLabel = REQUEST_TYPES[requestType]?.label || requestType;
        const isApproved = status === 'APPROVED';

        await supabase.from('announcements').insert([{
            title: isApproved ? 'Solicitud Aprobada' : 'Solicitud Rechazada',
            message: isApproved
                ? `Tu solicitud de ${typeLabel} fue aprobada.${approverNote ? ` Nota del aprobador: "${approverNote}"` : ''}`
                : `Tu solicitud de ${typeLabel} fue rechazada.${approverNote ? ` Motivo: "${approverNote}"` : ''}`,
            target_type: 'EMPLOYEE',
            target_value: [String(employeeId)],
            read_by: [],
            is_archived: false,
            created_by: approverId,
            priority: isApproved ? 'NORMAL' : 'HIGH',
        }]);
    } catch (err) {
        console.error('Error enviando notificación al empleado:', err);
        // No-fatal: no interrumpir el flujo principal
    }
};

// ── Slice ───────────────────────────────────────────────────────────────────

const SIMPLE_SELECT = 'id, type, status, note, metadata, approver_note, created_at, updated_at, employee_id, approver_id, current_level, approvals';

export const createRequestsSlice = (set, get) => ({
    // ── State ──────────────────────────────────────────────────────────────
    requests: [],
    isLoadingRequests: false,

    // ── Fetch ──────────────────────────────────────────────────────────────
    fetchRequests: async (employeeId = null, branchId = null, approverId = null) => {
        set({ isLoadingRequests: true });
        try {
            // Si se pide filtro por sucursal, obtener IDs de empleados de esa sucursal
            let branchEmpIds = null;
            if (branchId) {
                const { data: branchEmps } = await supabase
                    .from('employees')
                    .select('id')
                    .eq('branch_id', branchId)
                    .eq('status', 'ACTIVO');
                branchEmpIds = (branchEmps || []).map(e => e.id);
            }

            // 1. Fetch solicitudes sin joins
            let query = supabase
                .from('approval_requests')
                .select(SIMPLE_SELECT)
                .order('created_at', { ascending: false });

            if (employeeId) query = query.eq('employee_id', employeeId);
            if (branchEmpIds && branchEmpIds.length > 0) query = query.in('employee_id', branchEmpIds);
            if (approverId) query = query.eq('approver_id', approverId);

            const { data: requests, error } = await query;
            if (error) throw error;

            // 2. IDs únicos de empleados y aprobadores
            const empIds = [...new Set([
                ...(requests || []).map(r => r.employee_id),
                ...(requests || []).map(r => r.approver_id).filter(Boolean),
            ])];

            // 3. Fetch empleados por IDs
            let empRows = [];
            if (empIds.length > 0) {
                const { data } = await supabase
                    .from('employees')
                    .select('id, name, code, role_id, branch_id, system_role')
                    .in('id', empIds);
                empRows = data || [];
            }

            // 4. Combinar en memoria
            const empMap = Object.fromEntries(empRows.map(e => [e.id, e]));

            // 4b. Fetch adicional para aprobadores que no estén en empMap
            const missingIds = [...new Set(
                (requests || []).map(r => r.approver_id).filter(id => id && !empMap[id])
            )];
            if (missingIds.length > 0) {
                const { data: extra } = await supabase
                    .from('employees')
                    .select('id, name, code, role_id, branch_id, system_role')
                    .in('id', missingIds);
                (extra || []).forEach(e => { empMap[e.id] = e; });
            }

            const enriched = (requests || []).map(r => ({
                ...r,
                employee: empMap[r.employee_id] || null,
                approver: empMap[r.approver_id] || null,
            }));

            set({ requests: enriched, isLoadingRequests: false });
            return enriched;
        } catch (err) {
            console.error('Error cargando solicitudes:', err);
            set({ isLoadingRequests: false });
            return [];
        }
    },

    // ── Create ─────────────────────────────────────────────────────────────
    // payload: datos estructurados de la solicitud (fechas, turno destino, etc.)
    // note:    descripción/motivo libre del empleado
    createRequest: async (employeeId, type, payload = {}, note = '') => {
        try {
            // Obtener datos del empleado para resolver el aprobador
            const { data: emp } = await supabase
                .from('employees')
                .select('role_id, branch_id')
                .eq('id', employeeId)
                .single();

            // SHIFT_CHANGE: enrutar directamente al compañero para aprobación de par
            if (type === 'SHIFT_CHANGE' && payload.targetEmployeeId) {
                const { data: peerEmp } = await supabase
                    .from('employees').select('name').eq('id', payload.targetEmployeeId).single();

                const myDayOfWeek = payload.date ? new Date(payload.date + 'T12:00:00').getDay() : null;
                const allEmps = get().employees || [];
                const myEmpStore     = allEmps.find(e => String(e.id) === String(employeeId));
                const targetEmpStore = allEmps.find(e => String(e.id) === String(payload.targetEmployeeId));
                const fmtShift = (s) => s?.start && s?.end ? `${s.start} → ${s.end}` : null;
                const myShift     = myDayOfWeek !== null ? fmtShift(myEmpStore?.weeklySchedule?.[myDayOfWeek])     : null;
                const targetShift = myDayOfWeek !== null ? fmtShift(targetEmpStore?.weeklySchedule?.[myDayOfWeek]) : null;

                const enrichedPayload = {
                    ...payload,
                    peerApprovalRequired: true,
                    targetEmployeeName: peerEmp?.name || '',
                    myShift:     myShift     || 'No especificado',
                    targetShift: targetShift || 'No especificado',
                };
                const { data: peerData, error: peerError } = await supabase
                    .from('approval_requests')
                    .insert([{
                        employee_id: employeeId,
                        approver_id: payload.targetEmployeeId,
                        type,
                        status: 'PENDING',
                        note,
                        metadata: enrichedPayload,
                        current_level: 1,
                    }])
                    .select(SIMPLE_SELECT)
                    .single();
                if (peerError) throw peerError;
                const allEmps = get().employees || [];
                const enrichedPeer = {
                    ...peerData,
                    employee: allEmps.find(e => String(e.id) === String(peerData.employee_id)) || null,
                    approver: allEmps.find(e => String(e.id) === String(peerData.approver_id)) || null,
                };
                set((state) => ({ requests: [enrichedPeer, ...state.requests] }));
                await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                    dimension: 'HR',
                    new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type} (cambio de par)`,
                });
                return enrichedPeer;
            }

            const approverId = emp
                ? await resolveApprover(employeeId, emp.branch_id, emp.role_id)
                : null;

            const { data, error } = await supabase
                .from('approval_requests')
                .insert([{
                    employee_id: employeeId,
                    approver_id: approverId,
                    type,
                    status: 'PENDING',
                    note,
                    metadata: payload,
                }])
                .select(SIMPLE_SELECT)
                .single();

            if (error) throw error;

            // Enriquecer con employee/approver desde el store
            const allEmps = get().employees || [];
            const enriched = {
                ...data,
                employee: allEmps.find(e => String(e.id) === String(data.employee_id)) || null,
                approver: allEmps.find(e => String(e.id) === String(data.approver_id)) || null,
            };

            set((state) => ({ requests: [enriched, ...state.requests] }));

            await get().appendAuditLog('SOLICITUD_CREADA', employeeId, {
                dimension: 'HR',
                new_value: `Solicitud de ${REQUEST_TYPES[type]?.label || type}`,
            });

            return enriched;
        } catch (err) {
            console.error('createRequest error:', err);
            return null;
        }
    },

    // ── Approve ────────────────────────────────────────────────────────────
    approveRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const req = get().requests.find(r => r.id === requestId);
            if (!req) return false;

            const currentLevel = req.current_level || 1;
            const nextLevel = currentLevel + 1;

            const existingApprovals = Array.isArray(req.approvals) ? req.approvals : [];
            const newApprovals = [...existingApprovals, {
                level: currentLevel,
                approverId,
                approverNote,
                approvedAt: new Date().toISOString(),
            }];

            const maxLevels = req.type === 'SHIFT_CHANGE' ? 2 : 3;

            if (nextLevel <= maxLevels) {
                // Avanzar al siguiente nivel
                const nextApprover = await resolveNextApprover(nextLevel, req.employee?.branch_id, approverId);

                if (!nextApprover) {
                    // No hay siguiente aprobador disponible → aprobación final directa
                    const { error: finalErr } = await supabase
                        .from('approval_requests')
                        .update({
                            status: 'APPROVED',
                            approver_id: approverId,
                            approver_note: approverNote,
                            approvals: newApprovals,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', requestId);
                    if (finalErr) throw finalErr;

                    set(state => ({
                        requests: state.requests.map(r =>
                            r.id === requestId
                                ? { ...r, status: 'APPROVED', approver_note: approverNote, approvals: newApprovals }
                                : r
                        ),
                    }));

                    if (req.employee?.id) {
                        await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED', approverNote);
                        const registerEmployeeEvent = get().registerEmployeeEvent;
                        if (registerEmployeeEvent) {
                            const meta = parseMeta(req.metadata);
                            await registerEmployeeEvent(req.employee.id, {
                                type: req.type,
                                date: meta.startDate || meta.date || new Date().toISOString().split('T')[0],
                                endDate: meta.endDate,
                                note: req.note,
                                approvedBy: approverId,
                                fromRequest: req.id,
                                ...meta,
                            }).catch(() => {});
                            if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeId) {
                                const today = new Date().toISOString().split('T')[0];
                                await registerEmployeeEvent(meta.targetEmployeeId, {
                                    type: 'SHIFT_CHANGE',
                                    date: meta.date || today,
                                    note: `Cambio de turno aprobado con ${req.employee?.name || ''}`,
                                    approvedBy: approverId,
                                    fromRequest: req.id,
                                }).catch(() => {});
                                await notifyEmployee(meta.targetEmployeeId, approverId, 'SHIFT_CHANGE', 'APPROVED', approverNote);
                            }
                        }
                    }

                    useToastStore.getState().showToast('Aprobado', 'Solicitud aprobada (sin aprobador disponible en nivel siguiente).', 'success');
                    window.dispatchEvent(new CustomEvent('requests-updated'));
                    return true;
                }

                const { error } = await supabase
                    .from('approval_requests')
                    .update({
                        current_level: nextLevel,
                        approver_id: nextApprover,
                        approvals: newApprovals,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', requestId);

                if (error) throw error;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId
                            ? { ...r, current_level: nextLevel, approver_id: nextApprover, approvals: newApprovals }
                            : r
                    ),
                }));

                if (nextApprover) {
                    await supabase.from('announcements').insert([{
                        title: 'Nueva Solicitud Pendiente',
                        message: `Solicitud de ${REQUEST_TYPES[req.type]?.label} de ${req.employee?.name} — Nivel ${nextLevel} de ${maxLevels}`,
                        target_type: 'EMPLOYEE',
                        target_value: [String(nextApprover)],
                        read_by: [],
                        is_archived: false,
                        created_by: approverId,
                        priority: 'HIGH',
                    }]);
                }

                useToastStore.getState().showToast(
                    'Aprobado — Nivel ' + currentLevel,
                    `Solicitud avanzada al nivel ${nextLevel}. ${nextApprover ? 'Notificado el siguiente aprobador.' : 'Sin aprobador disponible en el siguiente nivel.'}`,
                    'success'
                );

                window.dispatchEvent(new CustomEvent('requests-updated'));
                return true;
            } else {
                // APROBACIÓN FINAL
                const { error } = await supabase
                    .from('approval_requests')
                    .update({
                        status: 'APPROVED',
                        approver_id: approverId,
                        approver_note: approverNote,
                        approvals: newApprovals,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', requestId);

                if (error) throw error;

                set(state => ({
                    requests: state.requests.map(r =>
                        r.id === requestId
                            ? { ...r, status: 'APPROVED', approver_note: approverNote, approvals: newApprovals }
                            : r
                    ),
                }));

                if (req.employee?.id) {
                    await notifyEmployee(req.employee.id, approverId, req.type, 'APPROVED', approverNote);

                    const registerEmployeeEvent = get().registerEmployeeEvent;
                    if (registerEmployeeEvent) {
                        const meta = parseMeta(req.metadata);
                        await registerEmployeeEvent(req.employee.id, {
                            type: req.type,
                            date: meta.startDate || meta.date || new Date().toISOString().split('T')[0],
                            endDate: meta.endDate,
                            note: req.note,
                            approvedBy: approverId,
                            fromRequest: req.id,
                            ...meta,
                        }).catch(() => {});

                        // Para SHIFT_CHANGE: registrar evento y notificar también al compañero
                        if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeId) {
                            const today = new Date().toISOString().split('T')[0];
                            await registerEmployeeEvent(meta.targetEmployeeId, {
                                type: 'SHIFT_CHANGE',
                                date: meta.date || today,
                                note: `Cambio de turno aprobado con ${req.employee?.name || ''}`,
                                approvedBy: approverId,
                                fromRequest: req.id,
                            }).catch(() => {});
                            await notifyEmployee(meta.targetEmployeeId, approverId, 'SHIFT_CHANGE', 'APPROVED', approverNote);
                        }
                    }
                }

                window.dispatchEvent(new CustomEvent('requests-updated'));
                return true;
            }
        } catch (err) {
            console.error('Error aprobando solicitud:', err);
            return false;
        }
    },

    // ── Reject ─────────────────────────────────────────────────────────────
    rejectRequest: async (requestId, approverId, approverNote = '') => {
        try {
            const req = get().requests.find(r => r.id === requestId);

            const { error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'REJECTED',
                    approver_id: approverId,
                    approver_note: approverNote,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId);

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId
                        ? { ...r, status: 'REJECTED', approver_note: approverNote }
                        : r
                ),
            }));

            // Notificar al empleado via anuncio interno
            if (req?.employee?.id) {
                await notifyEmployee(req.employee.id, approverId, req.type, 'REJECTED', approverNote);
            }

            return true;
        } catch (err) {
            console.error('Error rechazando solicitud:', err);
            return false;
        }
    },

    // ── Cancel (by employee) ───────────────────────────────────────────────
    cancelRequest: async (requestId) => {
        try {
            const { error } = await supabase
                .from('approval_requests')
                .update({
                    status: 'CANCELLED',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', requestId);

            if (error) throw error;

            set((state) => ({
                requests: state.requests.map(r =>
                    r.id === requestId ? { ...r, status: 'CANCELLED' } : r
                ),
            }));

            return true;
        } catch (err) {
            console.error('Error cancelando solicitud:', err);
            return false;
        }
    },
});
