import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, persistEmployees } from '../utils';

// 🚨 COMPRESOR DE IMÁGENES NATIVO (Actualizado para mantener fondos transparentes)
const compressImage = (file, maxWidth = 400) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                
                // Solo reducimos si la imagen es muy grande, no la estiramos
                const scaleSize = maxWidth > img.width ? 1 : maxWidth / img.width;
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                
                // Dibujamos la imagen respetando la transparencia
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // 🚨 Usamos formato WebP que SÍ soporta transparencia y además comprime
                canvas.toBlob((blob) => {
                    if (!blob) { resolve(file); return; }
                    // Si un navegador muy viejo no soporta WebP, usamos PNG de respaldo
                    const finalType = blob.type || 'image/png';
                    const ext = finalType.includes('webp') ? '.webp' : '.png';
                    
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ext, { 
                        type: finalType, 
                        lastModified: Date.now() 
                    }));
                }, 'image/webp', 0.85); // 85% de calidad
            };
        };
    });
};

// Valida el límite de headcount (max_limit) del cargo antes de asignarlo.
// Lanza HEADCOUNT_LIMIT si la plaza ya está ocupada. Se usa en alta, edición,
// recontratación y acciones RRHH (PROMOTION/TRANSFER) para cerrar las vías
// laterales que antes solo validaban en UI.
export const assertHeadcountAvailable = (state, roleId, branchId, excludeEmployeeId = null) => {
    if (!roleId) return;
    const roleConfig = state.roles.find(r => String(r.id) === String(roleId));
    if (!roleConfig || roleConfig.max_limit >= 99) return;

    const occupants = state.employees.filter(e => {
        if (e.status !== 'ACTIVO') return false;
        if (excludeEmployeeId != null && String(e.id) === String(excludeEmployeeId)) return false;
        if (String(e.role_id) !== String(roleId)) return false;
        if (roleConfig.scope === 'BRANCH') {
            return String(e.branch_id ?? e.branchId) === String(branchId);
        }
        return true; // GLOBAL
    });

    if (occupants.length >= roleConfig.max_limit) {
        const names = occupants.map(o => o.name).join(', ');
        throw new Error(
            `HEADCOUNT_LIMIT: El cargo "${roleConfig.name}" ` +
            `ya tiene ${roleConfig.max_limit} ocupante(s): ${names}. ` +
            `No se puede asignar este cargo.`
        );
    }
};

export const createEmployeeSlice = (set, get) => ({
    employees: safeJsonParse(localStorage.getItem(CACHE_KEYS.EMPLOYEES), []) || [],
    attendanceLoaded: false,

    setEmployees: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.employees) : updater;
        persistEmployees(next);
        return { employees: next };
    }),

    // 🚨 FUNCIÓN MAESTRA DE ARCHIVOS POR EMPLEADO
    uploadEmployeeFile: async (file, employeeId, folderPath = 'foto_perfil') => {
        if (!file || !employeeId) return null;
        try {
            const bucket = 'empleados'; 
            const fileExt = file.name.split(".").pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            
            const path = `${employeeId}/${folderPath}/${fileName}`;

            const { error } = await supabase.storage.from(bucket).upload(path, file, {
                cacheControl: '3600',
                upsert: true
            });
            
            if (error) throw error;

            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            console.error(`Error subiendo archivo al expediente:`, error.message);
            return null;
        }
    },

    uploadFileToStorage: async (file, bucket = 'documents', folder = '') => {
        if (!file) return null;
        try {
            const fileExt = file.name.split(".").pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const path = folder ? `${String(folder).replace(/\/+$/, '')}/${fileName}` : fileName;
            const { error } = await supabase.storage.from(bucket).upload(path, file);
            if (error) throw error;
            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
            return data.publicUrl;
        } catch (error) {
            console.error(`Error genérico de subida:`, error.message);
            return null;
        }
    },

    addEmployee: async (formData) => {
        try {
            const fNames = (formData.first_names || '').trim();
            const lNames = (formData.last_names || '').trim();

            // El código es la credencial del carné: SOLO números (regla de negocio,
            // también validada por trigger en BD) y único entre empleados.
            const cleanCode = String(formData.code ?? '').trim() || null;
            if (cleanCode) {
                if (!/^\d+$/.test(cleanCode)) {
                    throw new Error('El código de empleado debe contener solo números.');
                }
                const dup = get().employees.find(e =>
                    (e.code || '').trim().toUpperCase() === cleanCode.toUpperCase()
                );
                if (dup) throw new Error(`El código "${cleanCode}" ya está asignado a ${dup.name}.`);
            }

            const dbPayload = {
                first_names: fNames,
                last_names: lNames,
                username: formData.username ? formData.username.trim().toLowerCase() : null,
                code: cleanCode,
                
                role_id: formData.role_id ? parseInt(formData.role_id, 10) : null,
                secondary_role_id: formData.secondary_role_id ? parseInt(formData.secondary_role_id, 10) : null,
                branch_id: formData.branch_id ? parseInt(formData.branch_id, 10) : null,
                
                gender: formData.gender || null,
                blood_type: formData.blood_type || null,
                marital_status: formData.marital_status || null,
                birth_date: formData.birth_date || null,
                dui: formData.dui || null,
                phone: formData.phone || null,
                address: formData.address || null,
                
                department: formData.department || null,
                municipality: formData.municipality || null,
                education_level: formData.education_level || null,
                profession: formData.profession || null,

                email: formData.email || null,
                emergency_contact_name: formData.emergency_contact_name || null,
                emergency_contact_phone: formData.emergency_contact_phone || null,
                
                contract_type: formData.contract_type || 'INDEFINIDO',
                contract_end_date: formData.contract_type === 'TEMPORAL' ? (formData.contract_end_date || null) : null,
                weekly_contracted_hours: formData.weekly_contracted_hours ? parseInt(formData.weekly_contracted_hours, 10) : 44,
                base_salary: formData.base_salary ? parseFloat(formData.base_salary) : null,
                hire_date: formData.hire_date || null,
                afp_number: formData.afp_number || null,
                isss_number: formData.isss_number || null,
                afp_institution: formData.afp_institution || null,
                bank_name: formData.bank_name || null,
                account_number: formData.account_number || null,
                account_type: formData.account_type || 'AHORRO',
                
                kiosk_pin: formData.kiosk_pin || null,
                status: 'ACTIVO',
                photo_url: null,
            };

            // Validar headcount del cargo seleccionado
            assertHeadcountAvailable(get(), dbPayload.role_id, dbPayload.branch_id);

            const { data: newEmp, error } = await supabase.from("employees").insert([dbPayload]).select().single();
            if (error) {
                console.error('Supabase INSERT error:', error.message, error.details, error.hint);
                throw error;
            }

            const uploadedFile = formData.file || formData.photo;
            if (uploadedFile && uploadedFile instanceof File) {
                // Comprimimos antes de subir
                const compressedPhoto = await compressImage(uploadedFile);
                const publicPhotoUrl = await get().uploadEmployeeFile(compressedPhoto, newEmp.id, 'foto_perfil');
                if (publicPhotoUrl) {
                    await supabase.from("employees").update({ photo_url: publicPhotoUrl }).eq("id", newEmp.id);
                    newEmp.photo_url = publicPhotoUrl;
                }
            }

            // Asignar sucursales adicionales si aplica (empleados externos)
            const assignedBranches = Array.isArray(formData.assigned_branch_ids) ? formData.assigned_branch_ids.map(Number).filter(Boolean) : [];
            if (assignedBranches.length > 0) {
                await supabase.from('employee_branches').insert(
                    assignedBranches.map(branch_id => ({ employee_id: newEmp.id, branch_id }))
                );
            }

            // Crear usuario Auth automáticamente (no bloquea la creación si falla).
            // La edge function genera una temporal aleatoria y la devuelve — hay que
            // capturarla aquí para mostrársela al admin (antes se descartaba y el
            // primer login era imposible sin un reset manual).
            let tempPassword = null;
            if (dbPayload.username) {
                try {
                    const { data: authResult, error: authError } =
                        await supabase.functions.invoke('set-employee-password', {
                            body: { username: dbPayload.username, password: '1234' }
                        });
                    if (authError) {
                        console.warn('Auth creation error:', authError);
                    } else if (!authResult?.ok) {
                        console.warn('Auth creation failed:', authResult);
                    } else {
                        tempPassword = authResult.tempPassword || null;
                    }
                } catch (authErr) {
                    console.warn('No se pudo crear usuario Auth:', authErr);
                }
            }

            await get().appendAuditLog('PERSONAL_ASIGNADO', newEmp.id, {
                timeline_title: `Nuevo Ingreso: ${newEmp.name}`,
                dimension: 'HR',
                branch_id: newEmp.branch_id,
                new_value: `Expediente creado`
            });
            
            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const roles = get().roles;
            const mainRoleName = roles.find(r => String(r.id) === String(newEmp.role_id))?.name || null;
            const secRoleName = roles.find(r => String(r.id) === String(newEmp.secondary_role_id))?.name || null;

            const appEmp = {
                ...newEmp,
                branchId: newEmp.branch_id,
                hireDate: newEmp.hire_date,
                birthDate: newEmp.birth_date,
                photo: newEmp.photo_url,
                role: mainRoleName,
                secondary_role: secRoleName,
                assigned_branch_ids: assignedBranches,
                attendance: [],
                history: [],
                documents: []
            };

            set((state) => {
                const next = [...state.employees, appEmp];
                persistEmployees(next);
                return { employees: next };
            });
            return { id: appEmp.id, username: dbPayload.username, tempPassword };
        } catch (err) {
            console.error("Fallo al crear empleado:", err);
            throw err; // Re-lanzar el error original sin modificarlo
        }
    },

    updateEmployee: async (id, updatedData) => {
        try {
            const dbPayload = { ...updatedData };

            // Mismas reglas del código que en addEmployee: trim, único, y SOLO números.
            // Los códigos legacy no numéricos (SUPERADMIN, edwin, etc.) se toleran
            // mientras NO cambien — igual que el trigger de BD.
            if (dbPayload.code !== undefined) {
                dbPayload.code = String(dbPayload.code ?? '').trim() || null;
                if (dbPayload.code) {
                    const prevCode = (get().employees.find(e => String(e.id) === String(id))?.code || '').trim();
                    if (dbPayload.code !== prevCode && !/^\d+$/.test(dbPayload.code)) {
                        throw new Error('El código de empleado debe contener solo números.');
                    }
                    const dup = get().employees.find(e =>
                        String(e.id) !== String(id) &&
                        (e.code || '').trim().toUpperCase() === dbPayload.code.toUpperCase()
                    );
                    if (dup) throw new Error(`El código "${dbPayload.code}" ya está asignado a ${dup.name}.`);
                }
            }

            // branch_id: null/'' significa "quitar de la sucursal" (bolsa flotante) —
            // el mapeo anterior solo aceptaba valores truthy y el desasignar no se guardaba.
            if (updatedData.branch_id !== undefined || updatedData.branchId !== undefined) {
                const rawBranch = updatedData.branch_id !== undefined ? updatedData.branch_id : updatedData.branchId;
                dbPayload.branch_id = (rawBranch === null || rawBranch === '') ? null : parseInt(rawBranch, 10);
            }
            
            const uploadedFile = updatedData.file || updatedData.photo;
            if (uploadedFile instanceof File) {
                // Comprimimos antes de subir
                const compressedPhoto = await compressImage(uploadedFile);
                dbPayload.photo_url = await get().uploadEmployeeFile(compressedPhoto, id, 'foto_perfil');
            }

            if (updatedData.role_id !== undefined) dbPayload.role_id = updatedData.role_id ? parseInt(updatedData.role_id, 10) : null;
            if (updatedData.secondary_role_id !== undefined) dbPayload.secondary_role_id = updatedData.secondary_role_id ? parseInt(updatedData.secondary_role_id, 10) : null;
            
            if (updatedData.username) dbPayload.username = updatedData.username.trim().toLowerCase();
            if (updatedData.weekly_contracted_hours) dbPayload.weekly_contracted_hours = parseInt(updatedData.weekly_contracted_hours, 10);
            if (updatedData.base_salary) dbPayload.base_salary = parseFloat(updatedData.base_salary);
            if (updatedData.afp_institution !== undefined) dbPayload.afp_institution = updatedData.afp_institution || null;
            if (updatedData.account_type !== undefined) dbPayload.account_type = updatedData.account_type || 'AHORRO';
            
            if (updatedData.contract_type && updatedData.contract_type !== 'TEMPORAL') {
                dbPayload.contract_end_date = null;
            }

            delete dbPayload.id;
            delete dbPayload.branchId;
            delete dbPayload.photo;
            delete dbPayload.file;
            delete dbPayload.history;
            delete dbPayload.documents;
            delete dbPayload.attendance;
            delete dbPayload.role;
            delete dbPayload.main_role;
            delete dbPayload.secondary_role;
            delete dbPayload.sec_role;
            delete dbPayload.effectiveStatus;
            delete dbPayload.created_at;
            delete dbPayload.photoPreview;
            delete dbPayload.birthDate;
            delete dbPayload.hireDate;
            delete dbPayload.weeklySchedule;

            const newAssignedBranches = Array.isArray(dbPayload.assigned_branch_ids)
                ? dbPayload.assigned_branch_ids.map(Number).filter(Boolean)
                : null;
            delete dbPayload.assigned_branch_ids;

            // Validar headcount si se asigna un cargo (misma regla que en el alta)
            if (dbPayload.role_id) {
                const currentEmp = get().employees.find(e => String(e.id) === String(id));
                const targetBranch = dbPayload.branch_id !== undefined
                    ? dbPayload.branch_id
                    : (currentEmp?.branch_id ?? currentEmp?.branchId);
                assertHeadcountAvailable(get(), dbPayload.role_id, targetBranch, id);
            }

            const { data: updated, error } = await supabase.from("employees").update(dbPayload).eq("id", id).select().single();
            if (error) throw error;

            // Sync branch assignments to junction table if provided
            if (newAssignedBranches !== null) {
                await supabase.from('employee_branches').delete().eq('employee_id', id);
                if (newAssignedBranches.length > 0) {
                    await supabase.from('employee_branches').insert(
                        newAssignedBranches.map(branch_id => ({ employee_id: id, branch_id }))
                    );
                }
            }

            await get().appendAuditLog('EDITAR_EMPLEADO', id, {
                timeline_title: `Actualización de Personal: ${updated.name}`,
                dimension: 'HR',
                branch_id: updated.branch_id,
                new_value: 'Expediente modificado'
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            const roles = get().roles;
            const mainRoleName = roles.find(r => String(r.id) === String(updated.role_id))?.name || null;
            const secRoleName = roles.find(r => String(r.id) === String(updated.secondary_role_id))?.name || null;

            set((state) => {
                const next = state.employees.map((emp) => {
                    if (String(emp.id) !== String(id)) return emp;

                    return {
                        ...emp,
                        ...updated,
                        // `updated` es la fila completa post-UPDATE: branch_id null es real
                        // (desasignación), no un dato faltante — sin fallback al valor previo.
                        branchId: updated.branch_id,
                        photo: updated.photo_url ?? emp.photo,
                        birthDate: updated.birth_date ?? emp.birthDate,
                        hireDate: updated.hire_date ?? emp.hireDate,
                        role: updated.role_id ? (mainRoleName || emp.role) : 'Sin Asignar',
                        secondary_role: updated.secondary_role_id ? (secRoleName !== null ? secRoleName : emp.secondary_role) : null
                    };
                });
                persistEmployees(next);
                return { employees: next };
            });
            return true;
        } catch (err) {
            console.error("Error actualizando empleado:", err);
            throw err; 
        }
    },

    rehireEmployee: async (id, rehireData) => {
        const emp = get().employees.find(e => String(e.id) === String(id));
        if (!emp) throw new Error("Empleado no encontrado");

        assertHeadcountAvailable(get(), parseInt(rehireData.role_id, 10), parseInt(rehireData.branch_id, 10), id);

        // Regenerar PIN desde su código
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(emp.code));
        const base64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
        const newPin = base64.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 8);

        const dbPayload = {
            status: 'ACTIVO',
            branch_id: parseInt(rehireData.branch_id, 10),
            role_id: parseInt(rehireData.role_id, 10),
            secondary_role_id: rehireData.secondary_role_id ? parseInt(rehireData.secondary_role_id, 10) : null,
            hire_date: rehireData.hire_date,
            contract_type: rehireData.contract_type || 'INDEFINIDO',
            weekly_contracted_hours: parseInt(rehireData.weekly_contracted_hours, 10) || 44,
            base_salary: rehireData.base_salary ? parseFloat(rehireData.base_salary) : null,
            contract_end_date: null,
            kiosk_pin: newPin,
        };

        const { error } = await supabase.from('employees').update(dbPayload).eq('id', id);
        if (error) throw error;

        // Levantar el ban de la cuenta Auth aplicado en la baja (best-effort)
        supabase.functions.invoke('disable-employee-auth', {
            body: { employeeId: id, action: 'enable' }
        }).catch(err => console.warn('No se pudo reactivar la cuenta Auth:', err));

        const roles = get().roles;
        const mainRoleName = roles.find(r => String(r.id) === String(dbPayload.role_id))?.name || null;

        await supabase.from('employee_events').insert([{
            employee_id: id,
            type: 'REHIRE',
            date: rehireData.hire_date,
            note: rehireData.notes || 'Recontratación',
            metadata: {
                previous_status: 'INACTIVO',
                new_role: mainRoleName,
                target_branch_id: dbPayload.branch_id,
            }
        }]);

        await get().appendAuditLog('RECONTRATACION', id, {
            timeline_title: `Recontratación: ${emp.name}`,
            dimension: 'HR',
            branch_id: dbPayload.branch_id,
            new_value: 'Recontratado',
            notas: rehireData.notes || ''
        });

        window.dispatchEvent(new CustomEvent('force-history-refresh'));

        set((state) => {
            const next = state.employees.map(e => {
                if (String(e.id) !== String(id)) return e;
                return { ...e, ...dbPayload, branchId: dbPayload.branch_id, hireDate: rehireData.hire_date, role: mainRoleName };
            });
            persistEmployees(next);
            return { employees: next };
        });

        return true;
    },

    vacationRecallEmployee: async (id, recallData) => {
        const emp = get().employees.find(e => String(e.id) === String(id));
        if (!emp) throw new Error("Empleado no encontrado");

        const { date, shift_id, reason, approved_by } = recallData;

        // 1. Reactivar ese día en employee_rosters (quitar LIBRE, asignar turno)
        const getMondayISO = (dateStr) => {
            const d = new Date(dateStr + 'T00:00:00');
            const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
            d.setDate(d.getDate() + diff);
            return d.toISOString().split('T')[0];
        };
        const weekStart = getMondayISO(date);
        const _rawDay = new Date(date + 'T00:00:00').getDay();
        const dayId   = _rawDay === 0 ? 7 : _rawDay;

        const { data: roster } = await supabase
            .from('employee_rosters').select('schedule_data')
            .eq('employee_id', id).eq('week_start_date', weekStart).maybeSingle();
        const raw = roster?.schedule_data || {};
        const sched = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...raw };
        sched[dayId] = { shiftId: shift_id, note: 'Ingreso en vacaciones' };
        await supabase.from('employee_rosters').upsert(
            { employee_id: id, week_start_date: weekStart, schedule_data: sched },
            { onConflict: 'employee_id, week_start_date' }
        );

        // 2. Calcular horas del turno para sumar a hours_owed
        const shifts = get().shifts || [];
        const shift = shifts.find(s => String(s.id) === String(shift_id));
        let hoursWorked = 0;
        if (shift?.start && shift?.end) {
            const [sh, sm] = shift.start.split(':').map(Number);
            const [eh, em] = shift.end.split(':').map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins < 0) mins += 24 * 60;
            hoursWorked = Math.round((mins / 60) * 10) / 10;
        }

        // 3. Incrementar hours_owed en employees
        const currentOwed = parseFloat(emp.hours_owed || 0);
        const newOwed = currentOwed + hoursWorked;
        await supabase.from('employees').update({ hours_owed: newOwed }).eq('id', id);

        // 4. Registrar en employee_events
        await supabase.from('employee_events').insert([{
            employee_id: id,
            type: 'VACATION_RECALL',
            date,
            note: reason || 'Ingreso durante período de vacaciones',
            metadata: {
                shift_id,
                hours_worked: hoursWorked,
                hours_owed_total: newOwed,
                approved_by,
                reason,
            }
        }]);

        await get().appendAuditLog('INGRESO_EN_VACACIONES', id, {
            timeline_title: `Ingreso en Vacaciones: ${emp.name}`,
            dimension: 'HR',
            branch_id: emp.branchId,
            new_value: `${hoursWorked}h — Horas debidas acumuladas: ${newOwed}h`,
            notas: reason
        });

        window.dispatchEvent(new CustomEvent('force-history-refresh'));

        set((state) => {
            const next = state.employees.map(e =>
                String(e.id) !== String(id) ? e : { ...e, hours_owed: newOwed }
            );
            persistEmployees(next);
            return { employees: next };
        });

        return { hoursWorked, newOwed };
    },

    // 🚨 SOFT DELETE: delega en registerEmployeeEvent(TERMINATION) para que exista
    // una sola vía de baja (evento + update de expediente + revocación de accesos).
    deleteEmployee: async (id, reason = 'Baja general', exitDate = null) => {
        const fechaBaja = exitDate || new Date().toISOString().split('T')[0];
        const eventId = await get().registerEmployeeEvent(id, {
            type: 'TERMINATION',
            date: fechaBaja,
            terminationReason: reason,
            note: `Motivo de salida: ${reason}`,
        });
        return !!eventId;
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
        } catch { return false; }
    },

    getAllAttendance: () => {
        return (get().employees || []).flatMap((emp) =>
            (emp.attendance || []).map((att) => ({ ...att, employeeId: emp.id, id: `${emp.id}-${att.timestamp}` }))
        );
    },

    registerAttendance: async (employeeId, type, metadata = null) => {
        const timestamp = new Date().toISOString();

        const dbType = type;

        try {
            const { data: newPunch, error } = await supabase
                .from("attendance")
                .insert([{ employee_id: employeeId, timestamp, type: dbType, details: metadata || {} }])
                .select()
                .single();

            if (error) throw error;

            const state = get();
            const employee = state.employees.find(e => String(e.id) === String(employeeId));
            const employeeName = employee ? employee.name : 'Empleado Desconocido';
            const isKiosk = !!metadata?.audit_info;

            const kioskAuditInfo = metadata?.audit_info || null;
            const cleanDetails = { ...metadata };
            delete cleanDetails.audit_info;

            const PUNCH_LABELS = {
                IN: 'Entrada', OUT: 'Salida',
                OUT_LUNCH: 'Inicio Almuerzo', IN_LUNCH: 'Fin Almuerzo',
                OUT_LACTATION: 'Inicio Lactancia', IN_LACTATION: 'Fin Lactancia',
                OUT_EARLY: 'Salida Anticipada', OUT_BUSINESS: 'Gestión Externa',
                IN_RETURN: 'Regreso de Gestión', IN_EXTRA: 'Entrada Extra',
                OUT_EXTRA: 'Salida Extra',
            };
            const tipoMarcaje = PUNCH_LABELS[dbType] || dbType;

            state.appendAuditLog(
                `REGISTRO_ASISTENCIA`,
                employeeId,
                {
                    timeline_title: `Marcaje de ${tipoMarcaje}`,
                    dimension: 'OPERATIVE',
                    branch_id: employee?.branchId,
                    new_value: employeeName,
                    ...cleanDetails,
                    isKiosk,
                    kioskAuditInfo: isKiosk ? {
                        ...kioskAuditInfo,
                        employee_name: employeeName
                    } : null
                }
            ).catch(console.error);

            set((state) => {
                const next = state.employees.map(emp => {
                    if (String(emp.id) !== String(employeeId)) return emp;

                    const actualPunch = newPunch || { id: `local-${Date.now()}`, timestamp, type: dbType, details: metadata };

                    const exists = (emp.attendance || []).some(p => String(p.id) === String(actualPunch.id));
                    if (exists) return emp;

                    return {
                        ...emp,
                        attendance: [...(emp.attendance || []), actualPunch]
                    };
                });

                persistEmployees(next);
                return { employees: next };
            });

            window.dispatchEvent(new CustomEvent('force-history-refresh'));

            return newPunch || { timestamp, type: dbType, details: metadata };

        } catch (err) {
            console.error("❌ Error al registrar asistencia:", err);
            throw new Error(err.message || "Fallo al registrar asistencia en la base de datos");
        }
    },

    insertAttendancePunchAt: async (employeeId, timestamp, type, details = {}) => {
        const { data: newPunch, error } = await supabase
            .from('attendance')
            .insert([{ employee_id: employeeId, timestamp, type, details }])
            .select()
            .single();
        if (error) throw error;

        set(state => ({
            employees: state.employees.map(emp => {
                if (String(emp.id) !== String(employeeId)) return emp;
                const exists = (emp.attendance || []).some(p => String(p.id) === String(newPunch.id));
                if (exists) return emp;
                const updated = [...(emp.attendance || []), newPunch]
                    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                return { ...emp, attendance: updated };
            })
        }));

        return newPunch;
    },

    // action: 'CONFIRM' | 'REJECT' | 'ADJUST'
    // options: { confirmedBy, confirmedByName, adjustedTimestamp }
    confirmAttendancePunch: async (punchId, employeeId, action, options = {}) => {
        const { confirmedBy, confirmedByName, adjustedTimestamp } = options;

        try {
            if (action === 'REJECT') {
                const { error } = await supabase.from('attendance').delete().eq('id', punchId);
                if (error) throw error;

                set(state => ({
                    employees: state.employees.map(emp => {
                        if (String(emp.id) !== String(employeeId)) return emp;
                        return { ...emp, attendance: (emp.attendance || []).filter(p => String(p.id) !== String(punchId)) };
                    })
                }));

            } else {
                // CONFIRM or ADJUST — read current details first
                const { data: row, error: fetchErr } = await supabase
                    .from('attendance').select('details').eq('id', punchId).single();
                if (fetchErr) throw fetchErr;

                const newDetails = {
                    ...(row?.details || {}),
                    pendingHRReview: false,
                    confirmedBy: confirmedBy || null,
                    confirmedByName: confirmedByName || null,
                    confirmedAt: new Date().toISOString(),
                };

                const updatePayload = { details: newDetails };
                if (action === 'ADJUST' && adjustedTimestamp) {
                    updatePayload.timestamp = adjustedTimestamp;
                }

                const { error: updateErr } = await supabase
                    .from('attendance').update(updatePayload).eq('id', punchId);
                if (updateErr) throw updateErr;

                set(state => ({
                    employees: state.employees.map(emp => {
                        if (String(emp.id) !== String(employeeId)) return emp;
                        return {
                            ...emp,
                            attendance: (emp.attendance || []).map(p => {
                                if (String(p.id) !== String(punchId)) return p;
                                return {
                                    ...p,
                                    details: newDetails,
                                    ...(action === 'ADJUST' && adjustedTimestamp ? { timestamp: adjustedTimestamp } : {}),
                                };
                            })
                        };
                    })
                }));
            }

            get().appendAuditLog(
                action === 'REJECT' ? 'ATTENDANCE_PUNCH_REJECTED' : action === 'ADJUST' ? 'ATTENDANCE_PUNCH_ADJUSTED' : 'ATTENDANCE_PUNCH_CONFIRMED',
                employeeId,
                { punchId, action, confirmedBy, confirmedByName, adjustedTimestamp: adjustedTimestamp || null }
            ).catch(console.error);

        } catch (err) {
            console.error('❌ Error al confirmar marcaje:', err);
            throw err;
        }
    },
});