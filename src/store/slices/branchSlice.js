import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS, makeId } from '../utils';

const persistBranches = (branches) => {
    localStorage.setItem(CACHE_KEYS.BRANCHES, JSON.stringify(branches));
    return branches;
};

// Función helper profunda para limpiar objetos antes de mandarlos al JSONB de Supabase
const sanitizeForJsonb = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        if (value instanceof File || value instanceof Blob || typeof value === 'function') {
            return undefined;
        }
        return value;
    }));
};

// 🚨 HELPER PARA VERSIONADO
const handleDocumentVersioning = async (branchId, categoryFolder, fileType, newFile, oldUrl) => {
    const timestamp = Date.now();
    const extension = newFile.name.split('.').pop() || 'pdf';
    const newFileName = `${fileType}_${timestamp}.${extension}`;
    const newPath = `branches/${branchId}/${categoryFolder}/${newFileName}`;

    if (oldUrl) {
        try {
            const urlParts = oldUrl.split('/public/documents/');
            if (urlParts.length > 1) {
                const oldPath = urlParts[1];
                const pathParts = oldPath.split('/');
                const fileName = pathParts.pop();
                const archivePath = `${pathParts.join('/')}/old/${fileName}`;
                await supabase.storage.from('documents').move(oldPath, archivePath);
            }
        } catch (e) {
            console.warn("No se pudo archivar el documento anterior en Storage:", e);
        }
    }

    const { error } = await supabase.storage.from('documents').upload(newPath, newFile, { upsert: true });
    if (error) throw error;
    const { data: publicUrlData } = supabase.storage.from('documents').getPublicUrl(newPath);
    return publicUrlData.publicUrl;
};

export const createBranchSlice = (set, get) => ({
    branches: safeJsonParse(localStorage.getItem(CACHE_KEYS.BRANCHES), []) || [],
    
    // 🔴 NUEVO: ESTADO GLOBAL PARA EL HISTORIAL (Vital para que no requiera F5)
    branchHistory: {}, 

    setBranches: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.branches) : updater;
        return { branches: persistBranches(next) };
    }),

    addBranch: async (data) => {
        try {
            const payload = { ...data };
            if (typeof payload.settings === 'string') { try { payload.settings = JSON.parse(payload.settings); } catch (e) { payload.settings = {}; } }
            if (typeof payload.weeklyHours === 'string') { try { payload.weeklyHours = JSON.parse(payload.weeklyHours); } catch (e) { payload.weeklyHours = {}; } }
            if (typeof payload.weekly_hours === 'string') { try { payload.weekly_hours = JSON.parse(payload.weekly_hours); } catch (e) { payload.weekly_hours = {}; } }

            let pendingRentFile = null;
            if (payload.settings?.rent?.contract?.documentFile instanceof File) {
                pendingRentFile = payload.settings.rent.contract.documentFile;
            }

            const cleanSettings = sanitizeForJsonb(payload.settings || {});

            const dbPayload = {
                name: payload.name || payload.branchName || "Sin Nombre",
                address: payload.address || null,
                phone: payload.phone || null,
                cell: payload.cell || null,
                opening_date: payload.opening_date || payload.openingDate || null,
                weekly_hours: payload.weekly_hours || payload.weeklyHours || {},
                settings: cleanSettings
            };

            const { data: newBranch, error } = await supabase.from("branches").insert([dbPayload]).select().single();
            if (error) throw error;

            let finalSettings = typeof newBranch.settings === 'string' ? JSON.parse(newBranch.settings) : (newBranch.settings || {});

            if (pendingRentFile) {
                const documentUrl = await handleDocumentVersioning(newBranch.id, 'inmueble', 'contrato_alquiler', pendingRentFile, null);
                if (documentUrl) {
                    if (!finalSettings.rent) finalSettings.rent = {};
                    if (!finalSettings.rent.contract) finalSettings.rent.contract = {};
                    finalSettings.rent.contract.documentUrl = documentUrl;
                    await supabase.from("branches").update({ settings: finalSettings }).eq("id", newBranch.id);
                }
            }

            await get().appendAuditLog('APERTURA_OFICIAL', newBranch.id, {
                timeline_title: `Apertura: ${newBranch.name}`,
                dimension: 'OPERATIVE',
                branch_id: newBranch.id,
                new_value: 'Registrada en el sistema'
            });

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
            console.error("Fallo al crear sucursal:", err);
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

            const mergedSettings = {
                ...oldSettings,
                ...newSettings,
                legal: { ...oldLegal, ...(newSettings.legal || {}) },
                rent: { ...(oldSettings.rent || {}), ...(newSettings.rent || {}) },
                services: { ...(oldSettings.services || {}), ...(newSettings.services || {}) },
                location: { ...(oldSettings.location || {}), ...(newSettings.location || {}) }
            };

            const archiveOldDoc = async (docType, docName, oldUrl, metadata = {}) => {
                if (!oldUrl) return;
                await supabase.from('branch_documents').insert([{
                    branch_id: id,
                    document_type: docType,
                    name: docName,
                    file_url: oldUrl,
                    status: 'HISTÓRICO',
                    metadata: metadata
                }]);
            };

            // 1. GESTIÓN DE ARCHIVOS DE RENTA
            if (payload.settings?.rent?.contract?.documentFile instanceof File) {
                const oldRentUrl = oldSettings?.rent?.contract?.documentUrl;
                if (oldRentUrl) await archiveOldDoc('CONTRATO_ALQUILER', 'Contrato de Arrendamiento Anterior', oldRentUrl);

                mergedSettings.rent.contract.documentUrl = await handleDocumentVersioning(
                    id, 'inmueble', 'contrato_alquiler',
                    payload.settings.rent.contract.documentFile, oldRentUrl
                );
            }

            // 2. GESTIÓN DE ARCHIVOS LEGALES
            if (payload.settings?.legal) {
                const fileFields = [
                    { file: 'srsPermitFile', url: 'srsPermitUrl', type: 'PERMISO_SRS', label: 'Licencia CSSP/DNM', dbType: 'permiso_srs' },
                    { file: 'regentCredentialFile', url: 'regentCredentialUrl', type: 'CREDENCIAL_JVQF', label: 'Credencial Regencia JVQF', dbType: 'credencial_jvqf' },
                    { file: 'regentInscriptionFile', url: 'regentInscriptionUrl', type: 'INSCRIPCION_REGENCIA', label: 'Inscripción de Regencia', dbType: 'inscripcion_regencia' },
                    { file: 'farmacovigilanciaAuthFile', url: 'farmacovigilanciaAuthUrl', type: 'AUTORIZACION_FARMACOVIGILANCIA', label: 'Designación Farmacovigilancia', dbType: 'farmacovigilancia' },
                    { file: 'nursingServicePermitFile', url: 'nursingServicePermitUrl', type: 'PERMISO_INYECCIONES', label: 'Permiso Área Inyecciones', dbType: 'area_inyecciones' },
                    { file: 'municipalFile', url: 'municipalUrl', type: 'SOLVENCIA_MUNICIPAL', label: 'Solvencia Municipal', dbType: 'solvencia_municipal' },
                    { file: 'wasteFile', url: 'wasteUrl', type: 'CONTRATO_DESECHOS', label: 'Contrato de Desechos', dbType: 'contrato_desechos' },
                    { file: 'fumigationFile', url: 'fumigationUrl', type: 'CERTIFICADO_FUMIGACION', label: 'Certificado de Fumigación', dbType: 'certificado_fumigacion' },
                    { file: 'controlledBooksFile', url: 'controlledBooksUrl', type: 'LIBROS_CONTROLADOS', label: 'Resolución Libros Controlados', dbType: 'libros_controlados' },
                ];

                for (const f of fileFields) {
                    const newUploadedFile = payload.settings.legal[f.file];

                    if (newUploadedFile instanceof File) {
                        const oldUrl = oldLegal[f.url];
                        if (oldUrl) await archiveOldDoc(f.type, `${f.label} (Histórico)`, oldUrl);

                        mergedSettings.legal[f.url] = await handleDocumentVersioning(
                            id, 'legal', f.dbType, newUploadedFile, oldUrl
                        );
                    } else if (payload.settings.legal[f.url] === null) {
                        const oldUrl = oldLegal[f.url];
                        if (oldUrl) await archiveOldDoc(f.type, `${f.label} (Histórico - Eliminado)`, oldUrl);
                        mergedSettings.legal[f.url] = null;
                    } else if (payload.settings.legal[f.url]) {
                        mergedSettings.legal[f.url] = payload.settings.legal[f.url];
                    }
                }
            }

            // Limpiamos todo el objeto de basura binaria antes de enviar a JSONB
            const cleanSettingsForDB = sanitizeForJsonb(mergedSettings);

            const dbPayload = {
                name: payload.name || payload.branchName || "Sin Nombre",
                address: payload.address || null,
                phone: payload.phone || null,
                cell: payload.cell || null,
                opening_date: payload.opening_date || payload.openingDate || null,
                weekly_hours: payload.weekly_hours || payload.weeklyHours || {},
                settings: cleanSettingsForDB
            };

            const { data: updated, error } = await supabase.from("branches").update(dbPayload).eq("id", id).select().single();
            if (error) throw error;

            // 🚨 LÓGICA DE SINCRONIZACIÓN EN CASCADA Y AUDITORÍA INTELIGENTE
            const legalNow = updated.settings?.legal || {};

            const requiredStaffIds = [];
            if (legalNow.regentEmployeeId) requiredStaffIds.push(legalNow.regentEmployeeId);
            if (legalNow.farmacovigilanciaId) requiredStaffIds.push(legalNow.farmacovigilanciaId);
            if (legalNow.nursingRegents && Array.isArray(legalNow.nursingRegents)) {
                legalNow.nursingRegents.forEach(n => {
                    if (n.employeeId) requiredStaffIds.push(n.employeeId);
                });
            }

            if (requiredStaffIds.length > 0) {
                const { updateEmployee } = get();
                if (updateEmployee) {
                    for (const empId of requiredStaffIds) {
                        try {
                            await updateEmployee(empId, { branchId: id });
                        } catch (e) {
                            console.warn("Fallo al sincronizar empleado con sucursal:", empId, e);
                        }
                    }
                }
            }

            // Auditoría Inteligente: Detectamos exactamente qué cambió
            let auditLogFired = false;

            if (oldLegal.regentEmployeeId !== legalNow.regentEmployeeId) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de Regente Farmacéutico',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: legalNow.regentEmployeeId ? 'Regente Actualizado' : 'Regente Removido'
                });
                auditLogFired = true;
            }

            if (oldLegal.farmacovigilanciaId !== legalNow.farmacovigilanciaId) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de Farmacovigilancia',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: legalNow.farmacovigilanciaId ? 'Referente Actualizado' : 'Referente Removido'
                });
                auditLogFired = true;
            }

            const oldNurses = Array.isArray(oldLegal.nursingRegents) ? oldLegal.nursingRegents.length : 0;
            const newNurses = Array.isArray(legalNow.nursingRegents) ? legalNow.nursingRegents.length : 0;

            if (oldNurses !== newNurses) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Actualización de Equipo de Enfermería',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: `${newNurses} Profesional(es) Asignado(s)`
                });
                auditLogFired = true;
            }

            if (!auditLogFired && oldBranch.name !== (payload.name || payload.branchName)) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: `Actualización de Datos: ${payload.name || payload.branchName || 'Sucursal'}`,
                    dimension: 'OPERATIVE',
                    branch_id: id,
                    new_value: 'Se modificaron datos generales'
                });
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
            console.error("Fallo al actualizar sucursal:", err);
            throw err;
        }
    },

    deleteBranch: async (id) => {
        if (get().employees.some((e) => String(e.branchId) === String(id))) {
            throw new Error("No se puede eliminar: Hay colaboradores asignados a esta farmacia.");
        }
        try {
            const { error } = await supabase.from("branches").delete().eq("id", id);
            if (error) throw error;
            
            await get().appendAuditLog('ELIMINAR_SUCURSAL', id, {
                timeline_title: `Cierre Definitivo de Sucursal`,
                dimension: 'OPERATIVE',
                branch_id: id,
                old_value: 'Activa',
                new_value: 'Cerrada / Eliminada'
            });
            set((state) => {
                const next = state.branches.filter((b) => String(b.id) !== String(id));
                return { branches: persistBranches(next) };
            });
            return true;
        } catch (err) { 
            console.error("Error eliminando sucursal:", err);
            return false; 
        }
    },

    registerKioskDevice: async (branchId, deviceName) => {
        try {
            const { count } = await supabase.from('kiosk_devices')
                .select('*', { count: 'exact', head: true })
                .eq('branch_id', branchId)
                .eq('status', 'ACTIVE');

            if (count >= 3) throw new Error("Límite alcanzado: Ya existen 3 dispositivos activos.");

            const { data: newDevice, error } = await supabase.from('kiosk_devices')
                .insert([{ branch_id: branchId, device_name: deviceName, status: 'ACTIVE' }])
                .select()
                .single();

            if (error) throw error;

            await get().appendAuditLog('VINCULAR_KIOSCO', newDevice.id, {
                timeline_title: `Nuevo Kiosco Vinculado`,
                dimension: 'OPERATIVE',
                branch_id: branchId,
                new_value: `Dispositivo: ${deviceName}`
            });
            return {
                deviceId: newDevice.id,
                deviceToken: newDevice.device_token,
                branchId: newDevice.branch_id,
                deviceName: newDevice.device_name
            };

        } catch (err) {
            console.error("Fallo al registrar Kiosco:", err);
            throw err;
        }
    },

    revokeKioskDevice: async (deviceId, deviceName) => {
        try {
            const { error } = await supabase
                .from('kiosk_devices')
                .update({ status: 'REVOKED', revoked_at: new Date().toISOString() })
                .eq('id', deviceId);

            if (error) throw error;
            
            await get().appendAuditLog('REVOCAR_KIOSCO', deviceId, {
                timeline_title: `Kiosco Desvinculado`,
                dimension: 'OPERATIVE',
                old_value: deviceName,
                new_value: 'Acceso Revocado'
            }); 
            return true;
        } catch (err) {
            console.error("Fallo al revocar Kiosco:", err);
            return false;
        }
    },

    getBranchKiosks: async (branchId) => {
        try {
            const { data, error } = await supabase.from('kiosk_devices').select('*').eq('branch_id', branchId);
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error("Error obteniendo Kioscos:", error);
            return [];
        }
    },

    validateKioskToken: async (deviceId, token) => {
        const { data, error } = await supabase.from('kiosk_devices')
            .select('id, branch_id')
            .eq('id', deviceId)
            .eq('device_token', token)
            .eq('status', 'ACTIVE')
            .single();

        return !(error || !data);
    },

    getBranchHistory: async (branchId) => {
        try {
            const { data: docs } = await supabase.from('branch_documents').select('*').eq('branch_id', branchId).order('created_at', { ascending: false });
            const { data: logs } = await supabase.from('audit_logs').select('*').eq('target_id', branchId).order('created_at', { ascending: false });

            const combined = [
                ...(docs || []).map(d => ({ ...d, isDoc: true, sortDate: new Date(d.created_at) })),
                ...(logs || []).map(l => ({ ...l, isLog: true, sortDate: new Date(l.created_at) }))
            ].sort((a, b) => b.sortDate - a.sortDate);

            // 🔴 NUEVO: ACTUALIZAMOS LA MEMORIA DE ZUSTAND
            // Esto permite a React reaccionar y mostrar el historial sin dar F5
            set((state) => ({
                branchHistory: { ...state.branchHistory, [branchId]: combined }
            }));

            return combined;
        } catch (err) { 
            console.error("Fallo al obtener historial de sucursal:", err);
            return []; 
        }
    },

    registerBranchExpense: async (branchId, expenseData) => {
        try {
            let receiptUrl = null;

            if (expenseData.receiptFile instanceof File) {
                receiptUrl = await handleDocumentVersioning(
                    branchId,
                    'expenses',
                    `${expenseData.expense_type}_${expenseData.billing_month}`,
                    expenseData.receiptFile,
                    null
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

            // 1. Verificamos si ya existe un registro en BD para este mes y servicio
            const { data: existingRecord } = await supabase.from('branch_expenses')
                .select('id')
                .eq('branch_id', branchId)
                .eq('expense_type', expenseData.expense_type)
                .eq('billing_month', expenseData.billing_month)
                .single();

            if (existingRecord) {
                const { error: updError } = await supabase.from('branch_expenses').update(dbExpense).eq('id', existingRecord.id);
                if (updError) throw updError;
            } else {
                const { error: insError } = await supabase.from('branch_expenses').insert([dbExpense]);
                if (insError) throw insError;
            }

            const branch = get().branches.find(b => String(b.id) === String(branchId));
            if (branch) {
                const newSettings = JSON.parse(JSON.stringify(branch.settings || {}));
                const isPending = !(expenseData.receiptFile instanceof File);

                if (expenseData.expense_type === 'rent') {
                    if (!newSettings.rent) newSettings.rent = {};
                    newSettings.rent.paidThrough = expenseData.billing_month;
                    newSettings.rent.isReceiptPending = isPending;
                    newSettings.rent.amount = expenseData.amount; 
                } else {
                    if (!newSettings.services) newSettings.services = {};
                    if (!newSettings.services[expenseData.expense_type]) newSettings.services[expenseData.expense_type] = {};
                    newSettings.services[expenseData.expense_type].paidThrough = expenseData.billing_month;
                    newSettings.services[expenseData.expense_type].isReceiptPending = isPending;
                    newSettings.services[expenseData.expense_type].amount = expenseData.amount; 
                }

                const cleanSettingsForDB = sanitizeForJsonb(newSettings);
                await supabase.from('branches').update({ settings: cleanSettingsForDB }).eq('id', branchId);

                set((state) => {
                    const next = state.branches.map(b =>
                        String(b.id) === String(branchId)
                            ? { ...b, settings: newSettings }
                            : b
                    );
                    return { branches: persistBranches(next) };
                });

                const serviceMap = { rent: 'Alquiler', light: 'Energía Eléctrica', water: 'Agua Potable', internet: 'Internet', phone: 'Plan Celular', taxes: 'Impuestos' };
                const srvName = serviceMap[expenseData.expense_type] || expenseData.expense_type;

                // 🔴 LÓGICA DE AUDITORÍA INTELIGENTE
                let timelineTitle = `Pago de ${srvName}`;
                let oldVal = `Mes: ${expenseData.billing_month}`;
                let newVal = `Monto: $${expenseData.amount}`;
                let actionType = 'PAGO_REGISTRADO';

                // Si ya existía, significa que entraron a adjuntar el comprobante o actualizar el monto
                if (existingRecord) {
                    timelineTitle = receiptUrl ? `Comprobante Adjuntado: ${srvName}` : `Actualización de Pago: ${srvName}`;
                    oldVal = `Mes: ${expenseData.billing_month}`;
                    newVal = receiptUrl ? `Recibo guardado en expediente` : `Monto actualizado a $${expenseData.amount}`;
                    actionType = 'EDITAR_SUCURSAL'; // Cambiamos el tipo para que no salga el icono de pago duplicado
                }

                await get().appendAuditLog(actionType, branchId, {
                    timeline_title: timelineTitle,
                    dimension: 'FINANCE',
                    branch_id: branchId,
                    old_value: oldVal,
                    new_value: newVal,
                    servicio: expenseData.expense_type,
                    monto: expenseData.amount,
                    file_url: receiptUrl // 🔴 MÁGIA: Si subieron el archivo, aparecerá el botón "Ver Doc" en la línea de tiempo
                });
            }
            return true;
        } catch (err) { 
            console.error("Error registrando pago o adjuntando recibo:", err);
            throw err; 
        }
    }
});