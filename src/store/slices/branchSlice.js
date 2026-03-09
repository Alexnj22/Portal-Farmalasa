import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, makeId } from '../utils';

const persistBranches = (branches) => {
    localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(branches));
    return branches;
};

export const createBranchSlice = (set, get) => ({
    branches: safeJsonParse(localStorage.getItem(CACHE_KEYS.BRANCHES), []) || [],

    setBranches: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.branches) : updater;
        return { branches: persistBranches(next) };
    }),

    addBranch: async (data) => {
        try {
            const payload = { ...data };

            // 1. Filtro de seguridad para JSONs
            if (typeof payload.settings === 'string') { try { payload.settings = JSON.parse(payload.settings); } catch (e) { payload.settings = {}; } }
            if (typeof payload.weeklyHours === 'string') { try { payload.weeklyHours = JSON.parse(payload.weeklyHours); } catch (e) { payload.weeklyHours = {}; } }
            if (typeof payload.weekly_hours === 'string') { try { payload.weekly_hours = JSON.parse(payload.weekly_hours); } catch (e) { payload.weekly_hours = {}; } }

            // 🚨 2. Extraemos el archivo temporalmente para no mandarlo a la BD todavía
            let pendingRentFile = null;
            if (payload.settings?.rent?.contract?.documentFile instanceof File) {
                pendingRentFile = payload.settings.rent.contract.documentFile;
                delete payload.settings.rent.contract.documentFile;
            }

            // 3. Mapeado Estricto a la BD (Creamos la sucursal PRIMERO para obtener el ID)
            const dbPayload = {
                name: payload.name || payload.branchName || "Sin Nombre",
                address: payload.address || null,
                phone: payload.phone || null,
                cell: payload.cell || null,
                opening_date: payload.opening_date || payload.openingDate || null,
                weekly_hours: payload.weekly_hours || payload.weeklyHours || {},
                settings: payload.settings || {}
            };

            const { data: newBranch, error } = await supabase.from("branches").insert([dbPayload]).select().single();
            if (error) throw error;

            // 🚨 4. AHORA SÍ tenemos el ID, podemos subir el archivo si lo hay
            let requiresUpdate = false;
            let finalSettings = typeof newBranch.settings === 'string' ? JSON.parse(newBranch.settings) : (newBranch.settings || {});

            if (pendingRentFile) {
                const documentUrl = await get().uploadFileToStorage(
                    pendingRentFile,
                    'documents',
                    `branches/${newBranch.id}/rent`
                );
                
                if (documentUrl) {
                    if (!finalSettings.rent) finalSettings.rent = {};
                    if (!finalSettings.rent.contract) finalSettings.rent.contract = {};
                    finalSettings.rent.contract.documentUrl = documentUrl;
                    requiresUpdate = true;
                }
            }

            // 5. Si subimos un archivo, actualizamos la base de datos con la URL
            if (requiresUpdate) {
                await supabase.from("branches").update({ settings: finalSettings }).eq("id", newBranch.id);
            }

            await get().appendAuditLog('CREAR_SUCURSAL', newBranch.id, { nombre: newBranch.name });

            const retHours = typeof newBranch.weekly_hours === 'string' ? JSON.parse(newBranch.weekly_hours) : (newBranch.weekly_hours || {});

            const appBranch = {
                ...newBranch,
                weeklyHours: retHours,
                openingDate: newBranch.opening_date,
                settings: finalSettings,
                propertyType: finalSettings.propertyType || 'OWNED',
                rent: finalSettings.rent || null
            };

            set((state) => {
                const next = [...state.branches, appBranch];
                return { branches: persistBranches(next) };
            });
            return appBranch.id;
        } catch (err) {
            throw new Error("Fallo al crear sucursal.");
        }
    },

    updateBranch: async (id, data) => {
        try {
            if (!id) throw new Error("ID de sucursal no proporcionado.");

            const payload = { ...data };

            if (typeof payload.settings === 'string') { try { payload.settings = JSON.parse(payload.settings); } catch (e) { payload.settings = {}; } }
            if (typeof payload.weeklyHours === 'string') { try { payload.weeklyHours = JSON.parse(payload.weeklyHours); } catch (e) { payload.weeklyHours = {}; } }
            if (typeof payload.weekly_hours === 'string') { try { payload.weekly_hours = JSON.parse(payload.weekly_hours); } catch (e) { payload.weekly_hours = {}; } }

            const oldBranch = get().branches.find(b => String(b.id) === String(id));
            if (!oldBranch) throw new Error("Sucursal no encontrada en la memoria para editar.");

            const oldSettings = oldBranch?.settings || {};
            const oldLegal = oldSettings.legal || {};
            const newSettings = (payload.settings || {});

            payload.settings = {
                ...oldSettings,
                ...newSettings,
                legal: {
                    ...(oldSettings.legal || {}),
                    ...(newSettings.legal || {}),
                },
            };

            const archiveOldDoc = async (docType, docName, oldUrl, metadata = {}) => {
                if (!oldUrl && !docType.startsWith('HISTORIAL_')) return;
                await supabase.from('branch_documents').insert([{
                    branch_id: id,
                    document_type: docType,
                    name: docName,
                    file_url: oldUrl || null,
                    status: 'HISTÓRICO',
                    metadata: metadata
                }]);
            };

            // Archivos de renta
            if (payload.settings?.rent?.contract?.documentFile instanceof File) {
                const oldRentUrl = oldBranch?.settings?.rent?.contract?.documentUrl;
                await archiveOldDoc('CONTRATO_ALQUILER', 'Contrato de Arrendamiento Anterior', oldRentUrl);
                payload.settings.rent.contract.documentUrl = await get().uploadFileToStorage(
                    payload.settings.rent.contract.documentFile,
                    'documents',
                    `branches/${id}/rent_contracts` // Usamos el ID de forma limpia
                );
            }
            delete payload.settings?.rent?.contract?.documentFile;

            // Archivos legales
            if (payload.settings.legal) {
                const legal = payload.settings.legal;
                const fileFields = [
                    { file: 'srsPermitFile', url: 'srsPermitUrl', type: 'PERMISO_SRS', label: 'Permiso SRS Anterior' },
                    { file: 'regentCredentialFile', url: 'regentCredentialUrl', type: 'CREDENCIAL_JVQF', label: 'Credencial JVQF Anterior' },
                    { file: 'regentInscriptionFile', url: 'regentInscriptionUrl', type: 'INSCRIPCION_REGENCIA', label: 'Inscripción de Regencia Anterior' },
                    { file: 'farmacovigilanciaAuthFile', url: 'farmacovigilanciaAuthUrl', type: 'AUTORIZACION_FARMACOVIGILANCIA', label: 'Autorización Farmacovigilancia Anterior' },
                    { file: 'nursingServicePermitFile', url: 'nursingServicePermitUrl', type: 'PERMISO_INYECCIONES', label: 'Permiso Área Inyecciones Anterior' }
                ];

                for (const f of fileFields) {
                    if (legal[f.file] instanceof File) {
                        await archiveOldDoc(f.type, f.label, oldLegal[f.url]);
                        legal[f.url] = await get().uploadFileToStorage(
                            legal[f.file],
                            'documents',
                            `branches/${id}/legal`
                        ); 
                    }
                    // Siempre limpiamos la propiedad del archivo temporal para que no intente subirlo a DB
                    delete legal[f.file];
                }

                // 🚨 CORRECCIÓN: Evitar que URLs existentes se borren con `null` si no hay archivo nuevo
                if (Array.isArray(legal.nursingRegents)) {
                    for (let nurse of legal.nursingRegents) {
                        if (nurse.carneFile instanceof File) {
                            nurse.carneUrl = await get().uploadFileToStorage(nurse.carneFile, 'documents', `branches/${id}/legal/nursing_regents`);
                        }
                        if (nurse.anualidadFile instanceof File) {
                            nurse.anualidadUrl = await get().uploadFileToStorage(nurse.anualidadFile, 'documents', `branches/${id}/legal/nursing_regents`);
                        }
                        if (nurse.licenciaFile instanceof File) {
                            nurse.licenciaUrl = await get().uploadFileToStorage(nurse.licenciaFile, 'documents', `branches/${id}/legal/nursing_regents`);
                        }
                        // Limpieza
                        delete nurse.carneFile;
                        delete nurse.anualidadFile;
                        delete nurse.licenciaFile;
                    }
                }
            }

            const changes = {};
            if (oldBranch.name !== (payload.name || payload.branchName)) {
                changes.nombre = { anterior: oldBranch.name, nuevo: payload.name || payload.branchName };
            }

            const dbPayload = {
                name: payload.name || payload.branchName || "Sin Nombre",
                address: payload.address || null,
                phone: payload.phone || null,
                cell: payload.cell || null,
                opening_date: payload.opening_date || payload.openingDate || null,
                weekly_hours: payload.weekly_hours || payload.weeklyHours || {},
                settings: payload.settings || {}
            };

            const { data: updated, error } = await supabase.from("branches").update(dbPayload).eq("id", id).select().single();
            if (error) throw error;

            if (Object.keys(changes).length > 0) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, { cambios_detectados: changes });
            }

            const retSettings = typeof updated.settings === 'string' ? JSON.parse(updated.settings) : (updated.settings || {});
            const retHours = typeof updated.weekly_hours === 'string' ? JSON.parse(updated.weekly_hours) : (updated.weekly_hours || {});

            const appBranch = {
                ...updated,
                weeklyHours: retHours,
                openingDate: updated.opening_date,
                settings: retSettings,
                propertyType: retSettings.propertyType || 'OWNED',
                rent: retSettings.rent || null
            };

            set((state) => {
                const next = state.branches.map((b) => (String(b.id) === String(id) ? appBranch : b));
                return { branches: persistBranches(next) };
            });

            return true;
        } catch (err) {
            throw err;
        }
    },

    deleteBranch: async (id) => {
        if (get().employees.some((e) => String(e.branchId) === String(id))) {
            throw new Error("No se puede eliminar: Hay colaboradores asignados a esta farmacia.");
        }
        try {
            await supabase.from("branches").delete().eq("id", id);
            await get().appendAuditLog('ELIMINAR_SUCURSAL', id, {});
            set((state) => {
                const next = state.branches.filter((b) => String(b.id) !== String(id));
                return { branches: persistBranches(next) };
            });
            return true;
        } catch (err) { return false; }
    },

registerKioskDevice: async (branchId, deviceName) => {
        try {
            // 🚨 AHORA SOLO CONTAMOS LOS ACTIVOS
            const { count } = await supabase.from('kiosk_devices')
                .select('*', { count: 'exact', head: true })
                .eq('branch_id', branchId)
                .eq('status', 'ACTIVE'); 
                
            if (count >= 3) throw new Error("Límite alcanzado: Ya existen 3 dispositivos activos.");

            // Insertar el nuevo dispositivo
            const { data: newDevice, error } = await supabase.from('kiosk_devices')
                .insert([{ branch_id: branchId, device_name: deviceName }])
                .select()
                .single();
                
            if (error) throw error;

            await get().appendAuditLog('VINCULAR_KIOSCO', newDevice.id, { branchId, deviceName }, 'CONTROL_PANEL');
            
            // 🚨 SOLUCIÓN: Mapeamos los campos de la BD (snake_case) al formato que espera el Kiosco (camelCase)
            return {
                deviceId: newDevice.id,
                deviceToken: newDevice.device_token,
                branchId: newDevice.branch_id,
                deviceName: newDevice.device_name
            };
            
        } catch (err) { 
            throw err; 
        }
    },

revokeKioskDevice: async (deviceId, deviceName) => {
        try {
            // 🚨 BEST PRACTICE: Soft Delete (Inactivación) en lugar de .delete()
            const { error } = await supabase
                .from('kiosk_devices')
                .update({ 
                    status: 'REVOKED', 
                    revoked_at: new Date().toISOString() 
                })
                .eq('id', deviceId);
                
            if (error) throw error;
            
            await get().appendAuditLog('REVOCAR_KIOSCO', deviceId, { dispositivo: deviceName });
            return true;
        } catch (err) { 
            return false; 
        }
    },

    getBranchKiosks: async (branchId) => {
        const { data } = await supabase.from('kiosk_devices').select('*').eq('branch_id', branchId);
        return data || [];
    },

validateKioskToken: async (deviceId, token) => {
        // 🚨 BLOQUEO DE SEGURIDAD: El token solo es válido si el estado es ACTIVE
        const { data, error } = await supabase.from('kiosk_devices')
            .select('id, branch_id')
            .eq('id', deviceId)
            .eq('device_token', token)
            .eq('status', 'ACTIVE') 
            .single();
            
        return !(error || !data);
    },

    addBranchDocument: () => makeId(),
    registerBranchEvent: () => makeId(),

    getBranchHistory: async (branchId) => {
        try {
            const { data: docs } = await supabase.from('branch_documents').select('*').eq('branch_id', branchId).order('created_at', { ascending: false });
            const { data: logs } = await supabase.from('audit_logs').select('*').eq('target_id', branchId).order('created_at', { ascending: false });

            return [
                ...(docs || []).map(d => ({ ...d, isDoc: true, sortDate: new Date(d.created_at) })),
                ...(logs || []).map(l => ({ ...l, isLog: true, sortDate: new Date(l.created_at) }))
            ].sort((a, b) => b.sortDate - a.sortDate);
        } catch (err) { return []; }
    },

    registerBranchExpense: async (branchId, expenseData) => {
        try {
            let receiptUrl = null;
            if (expenseData.receiptFile instanceof File) {
                receiptUrl = await get().uploadFileToStorage(
                    expenseData.receiptFile,
                    'documents',
                    `branches/${branchId}/expenses/${expenseData.expense_type}`
                );
            }

            const dbExpense = {
                branch_id: branchId,
                expense_type: expenseData.expense_type,
                billing_month: expenseData.billing_month,
                amount: expenseData.amount,
                due_date: expenseData.due_date,
                status: 'PAGADO',
                paid_at: new Date().toISOString(),
                receipt_url: receiptUrl,
                notes: expenseData.notes || null
            };

            const { error: expError } = await supabase.from('branch_expenses').insert([dbExpense]);
            if (expError) throw expError;

            const branch = get().branches.find(b => String(b.id) === String(branchId));
            if (branch) {
                const newSettings = JSON.parse(JSON.stringify(branch.settings || {}));
                if (expenseData.expense_type === 'rent') {
                    if (!newSettings.rent) newSettings.rent = {};
                    newSettings.rent.paidThrough = expenseData.billing_month;
                } else {
                    if (!newSettings.services) newSettings.services = {};
                    if (!newSettings.services[expenseData.expense_type]) newSettings.services[expenseData.expense_type] = {};
                    newSettings.services[expenseData.expense_type].paidThrough = expenseData.billing_month;
                }

                await supabase.from('branches').update({ settings: newSettings }).eq('id', branchId);

                set((state) => {
                    const next = state.branches.map(b =>
                        String(b.id) === String(branchId)
                            ? { ...b, settings: newSettings }
                            : b
                    );
                    return { branches: persistBranches(next) };
                });

                await get().appendAuditLog('PAGO_REGISTRADO', branchId, {
                    servicio: expenseData.expense_type, monto: expenseData.amount, mes: expenseData.billing_month
                });
            }
            return true;
        } catch (err) { throw err; }
    }
});