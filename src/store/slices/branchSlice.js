import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS } from '../utils';
import {
    insertBranch, updateBranch, deleteBranch, insertBranchDocument, fetchBranchRow, editarSucursal,
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
import {
    cambiosDeSucursal, resumenDeCambios, parchesDeAjustes, columnasCambiadas,
    documentosDeEnfermeriaQueSalen, idsDeEnfermeria,
} from '../../utils/edicionDeSucursal';
import { shortEmployeeName } from '../../utils/nameUtils';

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
    // Sólo `[a-z0-9]`: un archivo sin punto (posible desde la app) usaba el
    // nombre entero —con espacios o tildes— y el almacén rechazaba la clave.
    const partes = String(newFile.name || '').split('.');
    const extension = (partes.length > 1 ? partes.pop() : '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
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

            // Dos copias y no una (auditoría 2026-10-29). `base` es de la que
            // partió el formulario —la de memoria— y sirve para saber QUÉ
            // cambió quien guarda. `viva` es la fila de la base ahora mismo y
            // sirve para saber qué documento se archiva: lo que se aplica es la
            // diferencia, sobre la viva, así que lo que otra persona guardó en
            // el medio se queda.
            const { data: viva, error: vivaErr } = await fetchBranchRow(id);
            if (vivaErr || !viva) {
                console.error('No se pudo leer la sucursal antes de guardar:', vivaErr);
                throw new Error('No se pudo leer la sucursal antes de guardar. Intenta de nuevo.');
            }
            const base = get().branches.find(b => String(b.id) === String(id)) || viva;
            const baseSettings = base.settings || {};
            const baseLegal = baseSettings.legal || {};
            const vivaSettings = (typeof viva.settings === 'string' ? safeJsonParse(viva.settings, {}) : viva.settings) || {};
            const vivaLegal = vivaSettings.legal || {};

            // Copia de lo que llega, con los sub-objetos que se van a tocar
            // copiados también: no se muta el `formData` de la pantalla.
            const ajustes = { ...(payload.settings || {}) };
            if (ajustes.legal) ajustes.legal = { ...ajustes.legal };
            if (ajustes.rent) ajustes.rent = { ...ajustes.rent, ...(ajustes.rent.contract ? { contract: { ...ajustes.rent.contract } } : {}) };

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
            const archiveOldDoc = (docType, docName, oldUrl, metadata = {}) => {
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

            // 1. CONTRATO DE ALQUILER: se sube, o se quita. Quitarlo también
            // deja el anterior en el histórico: antes sólo la subida lo hacía.
            const contrato = ajustes.rent?.contract;
            const contratoVivo = vivaSettings.rent?.contract?.documentUrl;
            if (esArchivoPorSubir(contrato?.documentFile)) {
                archiveOldDoc('CONTRATO_ALQUILER', 'Contrato de Arrendamiento Anterior', contratoVivo);
                contrato.documentUrl = await handleDocumentVersioning(id, 'inmueble', 'contrato_alquiler', contrato.documentFile);
            } else if (contrato && contrato.documentUrl === null && baseSettings.rent?.contract?.documentUrl) {
                archiveOldDoc('CONTRATO_ALQUILER', 'Contrato de Arrendamiento (Histórico - Eliminado)', contratoVivo);
            }

            // 2. GESTIÓN DE ARCHIVOS LEGALES
            if (ajustes.legal) {
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
                    if (esArchivoPorSubir(ajustes.legal[f.file])) {
                        archiveOldDoc(f.type, `${f.label} (Histórico)`, vivaLegal[f.url]);
                        ajustes.legal[f.url] = await handleDocumentVersioning(id, 'legal', f.dbType, ajustes.legal[f.file]);
                    } else if (ajustes.legal[f.url] === null && baseLegal[f.url]) {
                        // Quien guarda lo vio y lo quitó: se archiva el que hay
                        // HOY en la base, que es el que se va.
                        archiveOldDoc(f.type, `${f.label} (Histórico - Eliminado)`, vivaLegal[f.url]);
                    }
                }
            }

            // 3. ARCHIVOS DE CADA ENFERMERA (carné, licencia y recibo de anualidad).
            // El formulario los ponía en `<campo>File` y nadie los subía: la
            // limpieza de abajo los borraba y el renglón seguía en «falta
            // documento» sin error (2026-10-09). Se versionan igual que los
            // legales, y los de una enfermera que se quita van al histórico.
            const enfermeras = ajustes.legal?.nursingRegents;
            if (Array.isArray(enfermeras)) {
                const viejas = Array.isArray(vivaLegal.nursingRegents) ? vivaLegal.nursingRegents : [];
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
                            archiveOldDoc(f.type, `${f.label} (Histórico)`, vieja[f.url], { enfermera: n.employeeId || null });
                            fila[f.url] = await handleDocumentVersioning(id, 'legal', `${f.dbType}_${n.id}`, n[f.file]);
                        }
                        delete fila[f.file];
                    }
                    resultado.push(fila);
                }
                for (const sale of documentosDeEnfermeriaQueSalen(viejas, resultado)) {
                    const f = ARCHIVOS_DE_ENFERMERA.find(a => a.url === sale.campo);
                    // Si se reemplazó por uno nuevo, ya se archivó arriba.
                    if (historialPendiente.some(h => h.file_url === sale.url)) continue;
                    archiveOldDoc(f.type, `${f.label} (Histórico - Eliminado)`, sale.url, { enfermera: sale.employeeId });
                }
                ajustes.legal.nursingRegents = resultado;
            }

            // Lo que cambió, y nada más. Sin binarios: un `File` dentro del
            // `jsonb` lo vuelve inserializable.
            const parches = parchesDeAjustes(sanitizeForJsonb(baseSettings), sanitizeForJsonb(ajustes));
            const columnas = columnasCambiadas(base, payload);
            if (parches.length === 0 && Object.keys(columnas).length === 0 && historialPendiente.length === 0) {
                return true;
            }

            if (historialPendiente.length > 0) {
                const { error: histErr } = await insertBranchDocument(historialPendiente);
                if (histErr) {
                    console.error('No se pudo guardar el documento anterior en el historial:', histErr);
                    throw new Error('No se pudo guardar el documento anterior en el historial, así que no se cambió nada. Intenta de nuevo.');
                }
            }

            const { data: resultadoRpc, error } = await editarSucursal(id, columnas, parches);
            if (error) throw error;
            const antes = resultadoRpc?.antes || viva;
            const updated = resultadoRpc?.despues;
            if (!updated) throw new Error('La sucursal no devolvió su estado después de guardar. Recarga la página.');

            const antesLegal = antes.settings?.legal || {};
            const legalNow = updated.settings?.legal || {};

            // 🚨 CASCADA DE PERSONAL — sólo a quien ENTRÓ en este guardado.
            // Antes, cualquier guardado (aunque fuera el horario) volvía a
            // mover a la regente y a cada enfermera a esta sala: si RRHH la
            // había trasladado, editar otra cosa la traía de vuelta, sin
            // bitácora y con el error tragado. El referente de
            // farmacovigilancia no se mueve: es uno para toda la red.
            const entraron = [];
            if (legalNow.regentEmployeeId && legalNow.regentEmployeeId !== antesLegal.regentEmployeeId) entraron.push(legalNow.regentEmployeeId);
            const enfermeriaAntes = new Set(idsDeEnfermeria(antesLegal).map(String));
            for (const empId of idsDeEnfermeria(legalNow)) if (!enfermeriaAntes.has(String(empId))) entraron.push(empId);

            const { updateEmployee, employees } = get();
            const noMovidos = [];
            for (const empId of entraron) {
                const persona = (employees || []).find(e => String(e.id) === String(empId));
                if (!persona || String(persona.branchId) === String(id) || !updateEmployee) continue;
                try {
                    await updateEmployee(empId, { branchId: id });
                    await get().appendAuditLog('EMPLEADO_ASIGNADO', empId, {
                        type: 'REASSIGNMENT', previous_branch_id: persona.branchId ?? null, target_branch_id: id,
                        branch_id: id, target_branch_name: updated.name,
                        note: `Asignado a ${updated.name} al cargarlo en el expediente de la sucursal`,
                    });
                } catch (e) {
                    console.error("No se pudo mover al empleado a la sucursal:", empId, e);
                    noMovidos.push(persona);
                }
            }
            if (noMovidos.length > 0) {
                useToastStore.getState().showToast(
                    'Falta mover personal',
                    `La sucursal se guardó, pero no se pudo asignar a ${noMovidos.map(p => shortEmployeeName(p)).join(', ')} a esta sala. Hazlo desde Personal.`,
                    'error'
                );
            }

            // Auditoría: lo que cambió en ESTE guardado (antes → después de la
            // misma sentencia), no la copia de memoria contra la fila nueva.
            if (antesLegal.regentEmployeeId !== legalNow.regentEmployeeId) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de regente farmacéutico',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: legalNow.regentEmployeeId ? 'Regente Actualizado' : 'Regente Removido'
                });
            }

            // Las dos claves del mismo referente (la vieja la escribía un solo
            // formulario): se compara el que resulta, no la clave.
            const referenteAntes = antesLegal.pharmacovigilanceEmployeeId || antesLegal.farmacovigilanciaId;
            const referenteNow = legalNow.pharmacovigilanceEmployeeId || legalNow.farmacovigilanciaId;
            if (referenteAntes !== referenteNow) {
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: 'Asignación de farmacovigilancia',
                    dimension: 'LEGAL',
                    branch_id: id,
                    new_value: referenteNow ? 'Referente Actualizado' : 'Referente Removido'
                });
            }

            // Todo lo demás —general, legal (SRS, libros, enfermería…), horario,
            // inmueble y servicios— en UNA entrada por guardado con las
            // secciones y los campos que cambiaron. (El equipo de enfermería
            // tenía además una entrada propia por tamaño: quedaban dos por el
            // mismo cambio.)
            const cambios = cambiosDeSucursal(antes, updated);
            if (cambios.length > 0) {
                const soloLegal = cambios.every(c => c.seccion === 'legal');
                await get().appendAuditLog('EDITAR_SUCURSAL', id, {
                    timeline_title: `Actualización de datos: ${updated.name || 'Sucursal'}`,
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
            // El tope también lo pone la base (`trg_kiosk_devices_tope`): esto
            // es para avisar antes. Si el conteo falla, NO se registra —antes
            // `undefined >= 3` daba falso y pasaba igual—.
            const { count, error: countErr } = await fetchActiveKioskDeviceCount(branchId);
            if (countErr) throw new Error('No se pudo comprobar cuántos kioscos tiene la sucursal. Intenta de nuevo.');

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

    // `branchId` va a la bitácora para que el historial de la sala lo muestre
    // (lo busca `audit_log_de_sucursal` en `details.branch_id`).
    revokeKioskDevice: async (deviceId, deviceName, branchId = null) => {
        try {
            const { error } = await updateKioskDevice(deviceId, { status: 'REVOKED', revoked_at: new Date().toISOString() });

            if (error) throw error;
            
            await get().appendAuditLog('REVOCAR_KIOSCO', deviceId, {
                timeline_title: `Kiosco Desvinculado`,
                dimension: 'OPERATIVE',
                ...(branchId ? { branch_id: branchId } : {}),
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

            const serviceMap = { rent: 'Alquiler', light: 'Energía eléctrica', water: 'Agua potable', internet: 'Internet', phone: 'Plan celular', taxes: 'Impuestos' };
            const srvName = serviceMap[expenseData.expense_type] || expenseData.expense_type;

            // 🔴 LÓGICA DE AUDITORÍA INTELIGENTE — va apenas el pago quedó
            // escrito: si lo que sigue falla, el pago igual existe y tiene que
            // estar en la bitácora.
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

            // «Pagado hasta» del servicio: se decide contra la fila VIVA y se
            // escriben sólo esas tres claves. Antes se reescribía el `settings`
            // ENTERO desde la copia en memoria, y anotar un pago con la
            // pantalla abierta desde la mañana borraba lo que otro guardó en
            // el medio (auditoría 2026-10-29).
            const parcial = 'El pago quedó registrado, pero no se pudo actualizar «pagado hasta». Vuelve a abrir la sucursal y revisa el servicio.';
            const { data: viva, error: vivaErr } = await fetchBranchRow(branchId);
            if (vivaErr || !viva) { console.error(vivaErr); throw new Error(parcial); }
            const ruta = expenseData.expense_type === 'rent' ? ['rent'] : ['services', expenseData.expense_type];
            const destino = ruta.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), viva.settings || {}) || {};

            // «Pagado hasta» sólo AVANZA. Registrar un mes ya cubierto (un
            // pago atrasado que se anota tarde) lo hacía retroceder: con el
            // alquiler pagado hasta octubre, anotar agosto dejaba a la
            // sucursal debiendo septiembre y octubre (2026-10-21).
            if (expenseData.billing_month === destino.paidThrough || !yaEstabaPagado(destino.paidThrough, expenseData.billing_month)) {
                // Pendiente = no hay comprobante NI nuevo NI el que ya tenía
                // el registro: corregir el monto sin adjuntar no lo borra.
                const isPending = !receiptUrl && !existingRecord?.receipt_url;
                const { data: res, error: setErr } = await editarSucursal(branchId, {}, [
                    { ruta: [...ruta, 'paidThrough'], valor: expenseData.billing_month },
                    { ruta: [...ruta, 'isReceiptPending'], valor: isPending },
                    { ruta: [...ruta, 'amount'], valor: expenseData.amount },
                ]);
                if (setErr || !res?.despues) { console.error(setErr); throw new Error(parcial); }

                set((state) => {
                    const next = state.branches.map(b =>
                        String(b.id) === String(branchId)
                            ? { ...b, settings: res.despues.settings || {}, rent: res.despues.settings?.rent || null }
                            : b
                    );
                    return { branches: persistBranches(next) };
                });
            }
            return true;
        } catch (err) { 
            console.error("Error registrando pago o adjuntando recibo:", err);
            throw err; 
        }
    }
});