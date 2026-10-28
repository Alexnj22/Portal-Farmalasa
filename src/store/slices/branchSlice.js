import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS } from '../utils';
import {
    insertBranch, updateBranch, updateBranchReturning, deleteBranch, insertBranchDocument,
    fetchBranchDocuments, fetchAuditLogsForBranch, fetchActiveKioskDeviceCount, insertKioskDevice,
    updateKioskDevice, fetchBranchKiosks, fetchBranchExpenseRecord, updateBranchExpense, insertBranchExpense,
} from '../../data/branches';
import * as almacen from '@plataforma/almacen';
import { formatMoney } from '../../utils/formatNumber';
import { LIMITE_KIOSCOS } from '../../utils/kioscos';
import { buscarCargo } from '../../utils/roles';
import { yaEstabaPagado } from '../../utils/pagoDeSucursal';
import { SIN_ASIGNAR } from '../../data/constants';
import { useToastStore } from '../toastStore';
import { cambiosDeSucursal, resumenDeCambios } from '../../utils/edicionDeSucursal';

const persistBranches = (branches) => {
    almacen.guardar(CACHE_KEYS.BRANCHES, JSON.stringify(branches));
    return branches;
};

// Un archivo por subir: el `File` del navegador, o el de la app — que no
// tiene `File` del navegador y manda `{ name, body: ArrayBuffer, contentType }`
// (lo arma `archivoDeApp`). Los dos se versionan igual.
export const esArchivoPorSubir = (v) => (typeof File !== 'undefined' && v instanceof File)
    || (!!v && typeof v === 'object' && v.body instanceof ArrayBuffer && typeof v.name === 'string');

// Función helper profunda para limpiar objetos antes de mandarlos al JSONB de Supabase
const sanitizeForJsonb = (obj) => {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        if (esArchivoPorSubir(value) || value instanceof Blob || value instanceof ArrayBuffer || typeof value === 'function') {
            return undefined;
        }
        return value;
    }));
};

// 🚨 HELPER PARA VERSIONADO
const handleDocumentVersioning = async (branchId, categoryFolder, fileType, newFile) => {
    const timestamp = Date.now();
    const extension = newFile.name.split('.').pop() || 'pdf';
    const newFileName = `${fileType}_${timestamp}.${extension}`;
    const newPath = `branches/${branchId}/${categoryFolder}/${newFileName}`;

    // El anterior NO se mueve. Antes se pasaba a `…/old/`, pero `archiveOldDoc`
    // ya había guardado la fila «Histórico» con la ruta VIEJA: el historial
    // quedaba apuntando a un archivo que ya no estaba ahí (404). El nuevo lleva
    // su propia marca de tiempo, así que no pisa al anterior.
    const cuerpo = newFile.body instanceof ArrayBuffer ? newFile.body : newFile;
    const tipo = newFile.body instanceof ArrayBuffer && newFile.contentType ? { contentType: newFile.contentType } : {};
    const { error } = await supabase.storage.from('documents').upload(newPath, cuerpo, { upsert: true, ...tipo });
    if (error) throw error;
    const { data: publicUrlData } = supabase.storage.from('documents').getPublicUrl(newPath);
    return publicUrlData.publicUrl;
};

export const createBranchSlice = (set, get) => ({
    branches: safeJsonParse(almacen.leer(CACHE_KEYS.BRANCHES), []) || [],
    
    // 🔴 NUEVO: ESTADO GLOBAL PARA EL HISTORIAL (Vital para que no requiera F5)
    branchHistory: {}, 

    setBranches: (updater) => set((state) => {
        const next = typeof updater === 'function' ? updater(state.branches) : updater;
        return { branches: persistBranches(next) };
    }),

    addBranch: async (data) => {
        try {
            const payload = { ...data };
            if (typeof payload.settings === 'string') { try { payload.settings = JSON.parse(payload.settings); } catch { payload.settings = {}; } }
            if (typeof payload.weeklyHours === 'string') { try { payload.weeklyHours = JSON.parse(payload.weeklyHours); } catch { payload.weeklyHours = {}; } }
            if (typeof payload.weekly_hours === 'string') { try { payload.weekly_hours = JSON.parse(payload.weekly_hours); } catch { payload.weekly_hours = {}; } }

            let pendingRentFile = null;
            if (esArchivoPorSubir(payload.settings?.rent?.contract?.documentFile)) {
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

            const { data: newBranch, error } = await insertBranch(dbPayload);
            if (error) throw error;

            let finalSettings = typeof newBranch.settings === 'string' ? JSON.parse(newBranch.settings) : (newBranch.settings || {});
            let contratoSinEnlazar = false;

            if (pendingRentFile) {
                const documentUrl = await handleDocumentVersioning(newBranch.id, 'inmueble', 'contrato_alquiler', pendingRentFile);
                if (documentUrl) {
                    if (!finalSettings.rent) finalSettings.rent = {};
                    if (!finalSettings.rent.contract) finalSettings.rent.contract = {};
                    finalSettings.rent.contract.documentUrl = documentUrl;
                    // El error se mira: sin él la sala quedaba creada con el
                    // contrato subido al almacén pero sin enlazar, y la pantalla
                    // la daba por completa (auditoría 2026-10, H3). La sala YA
                    // existe, así que no se lanza —el formulario quedaría
                    // abierto y reintentar crearía otra igual—: se termina de
                    // registrar sin el enlace y se avisa qué faltó.
                    const { error: contratoErr } = await updateBranch(newBranch.id, { settings: finalSettings });
                    if (contratoErr) {
                        console.error('La sucursal se creó, pero no se pudo enlazar el contrato:', contratoErr);
                        delete finalSettings.rent.contract.documentUrl;
                        contratoSinEnlazar = true;
                    }
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
            if (contratoSinEnlazar) {
                useToastStore.getState().showToast(
                    'Falta el contrato',
                    `La sucursal «${newBranch.name}» se creó, pero no se pudo guardar el contrato de alquiler. Ábrela y vuelve a adjuntarlo.`,
                    'error'
                );
            }
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

            if (typeof payload.settings === 'string') { try { payload.settings = JSON.parse(payload.settings); } catch { payload.settings = {}; } }
            if (typeof payload.weeklyHours === 'string') { try { payload.weeklyHours = JSON.parse(payload.weeklyHours); } catch { payload.weeklyHours = {}; } }
            if (typeof payload.weekly_hours === 'string') { try { payload.weekly_hours = JSON.parse(payload.weekly_hours); } catch { payload.weekly_hours = {}; } }

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

            // Las filas «Histórico» se juntan acá y se escriben TODAS en un solo
            // INSERT, antes de la ficha. Antes se escribían una por una sin mirar
            // el error: si fallaba, la ficha quedaba con el documento nuevo y el
            // anterior sin rastro en el historial, sin aviso (auditoría 2026-10,
            // H3). Un solo INSERT entra entero o no entra, y si no entra se
            // corta antes de tocar la ficha: queda exactamente como estaba (lo
            // ya subido al almacén queda huérfano con nombre propio, no pisa
            // nada). `branch_documents` no tiene DELETE —es append-only—, así
            // que escribirla una por una no se podría deshacer.
            const historialPendiente = [];
            const archiveOldDoc = async (docType, docName, oldUrl, metadata = {}) => {
                if (!oldUrl) return;
                historialPendiente.push({
                    branch_id: id,
                    document_type: docType,
                    name: docName,
                    file_url: oldUrl,
                    status: 'HISTÓRICO',
                    metadata: metadata
                });
            };

            // 1. GESTIÓN DE ARCHIVOS DE RENTA
            if (esArchivoPorSubir(payload.settings?.rent?.contract?.documentFile)) {
                const oldRentUrl = oldSettings?.rent?.contract?.documentUrl;
                if (oldRentUrl) await archiveOldDoc('CONTRATO_ALQUILER', 'Contrato de Arrendamiento Anterior', oldRentUrl);

                mergedSettings.rent.contract.documentUrl = await handleDocumentVersioning(
                    id, 'inmueble', 'contrato_alquiler',
                    payload.settings.rent.contract.documentFile
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

                    if (esArchivoPorSubir(newUploadedFile)) {
                        const oldUrl = oldLegal[f.url];
                        if (oldUrl) await archiveOldDoc(f.type, `${f.label} (Histórico)`, oldUrl);

                        mergedSettings.legal[f.url] = await handleDocumentVersioning(
                            id, 'legal', f.dbType, newUploadedFile
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

            // 3. ARCHIVOS DE CADA ENFERMERA (carné, licencia y recibo de anualidad).
            // El formulario los ponía en `<campo>File` y nadie los subía: la
            // limpieza de abajo los borraba y el renglón seguía en «falta
            // documento» sin error (2026-10-09: ninguna ruta escribía `carneUrl`;
            // no mordió todavía porque ninguna sala tiene enfermeras cargadas).
            // Se versionan igual que los legales.
            const enfermeras = payload.settings?.legal?.nursingRegents;
            if (Array.isArray(enfermeras)) {
                const viejas = Array.isArray(oldLegal.nursingRegents) ? oldLegal.nursingRegents : [];
                const ARCHIVOS_DE_ENFERMERA = [
                    { file: 'carneFile', url: 'carneUrl', type: 'CARNE_JVQE', label: 'Carné JVQE', dbType: 'carne_jvqe' },
                    { file: 'licenciaFile', url: 'licenciaUrl', type: 'LICENCIA_ENFERMERIA', label: 'Licencia de Regencia de Enfermería', dbType: 'licencia_enfermeria' },
                    { file: 'anualidadFile', url: 'anualidadUrl', type: 'ANUALIDAD_ENFERMERIA', label: 'Recibo de Anualidad de Enfermería', dbType: 'anualidad_enfermeria' },
                ];
                const resultado = [];
                for (const n of enfermeras) {
                    const vieja = viejas.find(v => String(v.id) === String(n.id)) || {};
                    const fila = { ...n };
                    for (const f of ARCHIVOS_DE_ENFERMERA) {
                        if (esArchivoPorSubir(n[f.file])) {
                            const oldUrl = vieja[f.url];
                            if (oldUrl) await archiveOldDoc(f.type, `${f.label} (Histórico)`, oldUrl, { enfermera: n.employeeId || null });
                            fila[f.url] = await handleDocumentVersioning(id, 'legal', `${f.dbType}_${n.id}`, n[f.file]);
                        }
                        delete fila[f.file];
                    }
                    resultado.push(fila);
                }
                mergedSettings.legal.nursingRegents = resultado;
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

            if (historialPendiente.length > 0) {
                const { error: histErr } = await insertBranchDocument(historialPendiente);
                if (histErr) {
                    console.error('No se pudo guardar el documento anterior en el historial:', histErr);
                    throw new Error('No se pudo guardar el documento anterior en el historial, así que no se cambió nada. Intenta de nuevo.');
                }
            }

            const { data: updated, error } = await updateBranchReturning(id, dbPayload);
            if (error) throw error;

            // 🚨 LÓGICA DE SINCRONIZACIÓN EN CASCADA Y AUDITORÍA INTELIGENTE
            const legalNow = updated.settings?.legal || {};

            const requiredStaffIds = [];
            if (legalNow.regentEmployeeId) requiredStaffIds.push(legalNow.regentEmployeeId);
            const referenteNow = legalNow.pharmacovigilanceEmployeeId || legalNow.farmacovigilanciaId;
            if (referenteNow) requiredStaffIds.push(referenteNow);
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

            if (oldLegal.regentEmployeeId !== legalNow.regentEmployeeId) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de regente farmacéutico',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: legalNow.regentEmployeeId ? 'Regente Actualizado' : 'Regente Removido'
                });
            }

            // Las dos claves del mismo referente (la vieja la escribía un solo
            // formulario): se compara el que resulta, no la clave.
            if ((oldLegal.pharmacovigilanceEmployeeId || oldLegal.farmacovigilanciaId) !== referenteNow) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de farmacovigilancia',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: referenteNow ? 'Referente Actualizado' : 'Referente Removido'
                });
            }

            const oldNurses = Array.isArray(oldLegal.nursingRegents) ? oldLegal.nursingRegents.length : 0;
            const newNurses = Array.isArray(legalNow.nursingRegents) ? legalNow.nursingRegents.length : 0;

            if (oldNurses !== newNurses) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Actualización de equipo de enfermería',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: `${newNurses} Profesional(es) Asignado(s)`
                });
            }

            // Todo lo demás —general, legal (SRS, libros, enfermería…), horario,
            // inmueble y servicios— en UNA entrada por guardado con las
            // secciones y los campos que cambiaron. Antes sólo quedaba rastro de
            // un cambio de nombre, y sólo si no había cambiado el regente.
            const cambios = cambiosDeSucursal(oldBranch, updated);
            if (cambios.length > 0) {
                const soloLegal = cambios.every(c => c.seccion === 'legal');
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: `Actualización de datos: ${updated.name || payload.name || payload.branchName || 'Sucursal'}`,
                    dimension: soloLegal ? 'LEGAL' : 'OPERATIVE',
                    branch_id: id,
                    secciones: cambios.map(c => c.seccion),
                    campos: cambios,
                    new_value: resumenDeCambios(cambios)
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

    /**
     * Asignar la jefatura (o la subjefatura) de una sala — lo que guardaba
     * `UnifiedModal` (editBranchLeadership), mudado acá para que el portal y la
     * app hagan lo mismo. El cargo se resuelve contra la TABLA y, si no
     * resuelve, NO se escribe (regla «un rótulo no es una clave»). Si había
     * alguien en el puesto, se lo reasigna o se lo deja sin sala, según
     * `outgoingAction`. Lanza con un mensaje para la pantalla.
     */
    asignarJefaturaDeSucursal: async (datos) => {
        const { updateEmployee, employees, roles, appendAuditLog, fetchEmployees, fetchBranchHistory } = get();
        if (!datos.selectedEmpId) throw new Error('Debes seleccionar a un empleado de la lista.');
        if (datos.isPermanent === false && !datos.interimEndDate) throw new Error('Para un interinato, la fecha de finalización es obligatoria.');
        const elegido = (employees || []).find(e => e.id === datos.selectedEmpId);
        const branchId = datos.branch?.id || datos.branchId || datos.id;
        const branchName = datos.branch?.name || datos.name || 'Sucursal';
        const cargo = buscarCargo(roles, datos.targetRole);
        if (datos.targetRole && !cargo) throw new Error(`El cargo «${datos.targetRole}» ya no existe en el catálogo. Actualiza la página e intenta de nuevo.`);

        if (datos.currentAssignee && datos.currentAssignee !== datos.selectedEmpId) {
            if (datos.outgoingAction === 'REASSIGN') {
                const salida = buscarCargo(roles, datos.outgoingRole);
                if (!salida) throw new Error(`El cargo de salida «${datos.outgoingRole || '—'}» no existe en el catálogo. Elige otro para continuar.`);
                await updateEmployee(datos.currentAssignee, { branchId: datos.outgoingBranch, role_id: salida.id });
                await appendAuditLog('EMPLEADO_RELEVADO', datos.currentAssignee, {
                    type: 'REASSIGNMENT', previous_branch_id: branchId, previous_branch_name: branchName,
                    target_branch_id: datos.outgoingBranch, previous_role: datos.targetRole, new_role: salida.name,
                    note: `Relevado de jefatura en ${branchName}`,
                });
            } else {
                await updateEmployee(datos.currentAssignee, { branchId: null, role_id: null });
                await appendAuditLog('EMPLEADO_DESVINCULADO_SUCURSAL', datos.currentAssignee, {
                    type: 'UNASSIGNED', previous_branch_id: branchId, previous_branch_name: branchName,
                    previous_role: datos.targetRole, new_role: SIN_ASIGNAR,
                    note: `Removido de la sucursal ${branchName} a la bolsa de trabajo flotante.`,
                });
            }
        }

        await updateEmployee(datos.selectedEmpId, { branchId, role_id: cargo ? cargo.id : null });
        await appendAuditLog(datos.moveType || 'EMPLEADO_ASIGNADO', datos.selectedEmpId, {
            type: datos.moveType || 'PROMOTION',
            previous_branch_id: elegido?.branchId || null, target_branch_id: branchId, target_branch_name: branchName,
            previous_role: elegido?.role || null, new_role: cargo?.name ?? SIN_ASIGNAR,
            note: datos.notes || 'Asignación realizada desde el Panel de Sucursales',
            isInterim: datos.isPermanent === false, interimEndDate: datos.interimEndDate || null,
            ...(datos.desde ? { desde: datos.desde } : {}),
        });
        if (fetchEmployees) await fetchEmployees();
        if (fetchBranchHistory && branchId) await fetchBranchHistory(branchId);
        return true;
    },

    deleteBranch: async (id) => {
        if (get().employees.some((e) => String(e.branchId) === String(id))) {
            throw new Error("No se puede eliminar: Hay empleados asignados a esta farmacia.");
        }
        try {
            const { error } = await deleteBranch(id);
            if (error) throw error;
            
            await get().appendAuditLog('ELIMINAR_SUCURSAL', id, {
                timeline_title: `Cierre Definitivo de Sucursal`,
                dimension: 'OPERATIVE',
                branch_id: id,
                old_value: 'Activa',
                new_value: 'Cerrada / eliminada'
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
            const { count } = await fetchActiveKioskDeviceCount(branchId);

            if (count >= LIMITE_KIOSCOS) throw new Error(`Límite alcanzado: Ya existen ${LIMITE_KIOSCOS} dispositivos activos.`);

            const { data: newDevice, error } = await insertKioskDevice({ branch_id: branchId, device_name: deviceName, status: 'ACTIVE' });

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
            const { error } = await updateKioskDevice(deviceId, { status: 'REVOKED', revoked_at: new Date().toISOString() });

            if (error) throw error;
            
            await get().appendAuditLog('REVOCAR_KIOSCO', deviceId, {
                timeline_title: `Kiosco Desvinculado`,
                dimension: 'OPERATIVE',
                old_value: deviceName,
                new_value: 'Acceso revocado'
            }); 
            return true;
        } catch (err) {
            console.error("Fallo al revocar Kiosco:", err);
            return false;
        }
    },

    getBranchKiosks: async (branchId) => {
        try {
            const { data, error } = await fetchBranchKiosks(branchId);
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error("Error obteniendo Kioscos:", error);
            return [];
        }
    },

    validateKioskToken: async (deviceId, token) => {
        // Auditoría 2026-07 (0B.8): antes hacía SELECT directo sobre kiosk_devices,
        // que requería una policy anon SELECT true (cualquiera sin sesión leía toda
        // la tabla). Ahora valida server-side vía RPC SECURITY DEFINER.
        //
        // 7B.8: distinguir "la RPC respondió que NO" (dispositivo revocado/token
        // inválido — negativo real) de "la RPC no pudo ejecutarse" (sin conexión,
        // timeout, etc.). useKioskDevice.js depende de esta distinción para no
        // desvincular un kiosco solo porque se quedó sin internet un momento.
        const { data, error } = await supabase.rpc('verify_kiosk_device', {
            p_device_id: deviceId,
            p_device_token: token,
        });

        if (error) {
            return { authorized: false, networkError: true, message: error.message };
        }
        return { authorized: Array.isArray(data) && data.length > 0, networkError: false };
    },

    // Lanza si alguna de las dos lecturas falla. Antes se tragaba el error y
    // devolvía `[]`, que la pantalla pintaba «Sin registros en esta sucursal»:
    // un historial que no se pudo leer se veía igual que uno vacío (auditoría
    // 2026-10, H3). Quien llama distingue: lista (puede ser vacía) o error.
    getBranchHistory: async (branchId) => {
        const [{ data: docs, error: docsErr }, { data: logs, error: logsErr }] = await Promise.all([
            fetchBranchDocuments(branchId),
            fetchAuditLogsForBranch(branchId),
        ]);
        if (docsErr || logsErr) {
            console.error('Fallo al obtener historial de sucursal:', docsErr || logsErr);
            throw new Error('No se pudo cargar el historial de la sucursal. Intenta de nuevo.');
        }

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
    },

    registerBranchExpense: async (branchId, expenseData) => {
        try {
            let receiptUrl = null;

            if (esArchivoPorSubir(expenseData.receiptFile)) {
                receiptUrl = await handleDocumentVersioning(
                    branchId,
                    'expenses',
                    `${expenseData.expense_type}_${expenseData.billing_month}`,
                    expenseData.receiptFile
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
            const { data: existingRecord, error: checkError } = await fetchBranchExpenseRecord(branchId, expenseData.expense_type, expenseData.billing_month);
            if (checkError) throw checkError;

            if (existingRecord) {
                // Sin archivo nuevo, el comprobante que ya tenía se queda: el
                // UPDATE escribía `receipt_url: null` y lo borraba (2026-10-21).
                const cambios = { ...dbExpense };
                if (!receiptUrl) delete cambios.receipt_url;
                const { error: updError } = await updateBranchExpense(existingRecord.id, cambios);
                if (updError) throw updError;
            } else {
                const { error: insError } = await insertBranchExpense(dbExpense);
                if (insError) throw insError;
            }

            const branch = get().branches.find(b => String(b.id) === String(branchId));
            if (branch) {
                const newSettings = JSON.parse(JSON.stringify(branch.settings || {}));
                const isPending = !esArchivoPorSubir(expenseData.receiptFile);

                // «Pagado hasta» sólo AVANZA. Registrar un mes ya cubierto (un
                // pago atrasado que se anota tarde) lo hacía retroceder: con el
                // alquiler pagado hasta octubre, anotar agosto dejaba a la
                // sucursal debiendo septiembre y octubre (2026-10-21).
                let destino;
                if (expenseData.expense_type === 'rent') {
                    if (!newSettings.rent) newSettings.rent = {};
                    destino = newSettings.rent;
                } else {
                    if (!newSettings.services) newSettings.services = {};
                    if (!newSettings.services[expenseData.expense_type]) newSettings.services[expenseData.expense_type] = {};
                    destino = newSettings.services[expenseData.expense_type];
                }
                if (expenseData.billing_month === destino.paidThrough || !yaEstabaPagado(destino.paidThrough, expenseData.billing_month)) {
                    destino.paidThrough = expenseData.billing_month;
                    destino.isReceiptPending = isPending;
                    destino.amount = expenseData.amount;
                }

                const cleanSettingsForDB = sanitizeForJsonb(newSettings);
                const { error: setErr } = await updateBranch(branchId, { settings: cleanSettingsForDB });
                if (setErr) throw setErr;

                set((state) => {
                    const next = state.branches.map(b =>
                        String(b.id) === String(branchId)
                            ? { ...b, settings: newSettings }
                            : b
                    );
                    return { branches: persistBranches(next) };
                });

                const serviceMap = { rent: 'Alquiler', light: 'Energía eléctrica', water: 'Agua potable', internet: 'Internet', phone: 'Plan celular', taxes: 'Impuestos' };
                const srvName = serviceMap[expenseData.expense_type] || expenseData.expense_type;

                // 🔴 LÓGICA DE AUDITORÍA INTELIGENTE
                let timelineTitle = `Pago de ${srvName}`;
                let oldVal = `Mes: ${expenseData.billing_month}`;
                let newVal = `Monto: ${formatMoney(expenseData.amount)}`;
                let actionType = 'PAGO_REGISTRADO';

                // Si ya existía, significa que entraron a adjuntar el comprobante o actualizar el monto
                if (existingRecord) {
                    timelineTitle = receiptUrl ? `Comprobante Adjuntado: ${srvName}` : `Actualización de Pago: ${srvName}`;
                    oldVal = `Mes: ${expenseData.billing_month}`;
                    newVal = receiptUrl ? `Recibo guardado en expediente` : `Monto actualizado a ${formatMoney(expenseData.amount)}`;
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