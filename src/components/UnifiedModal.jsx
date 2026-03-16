import React, { Suspense, useState, useEffect } from 'react';
import {
    X, ClipboardList, Building2, BookOpen, Save, AlertCircle, ShieldCheck, Loader2, Scale, Zap, Clock, Star, FilePlus
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import ModalShell from "./common/ModalShell";
import { useToastStore } from '../store/toastStore';
import { supabase } from '../supabaseClient'; // 🚨 Usaremos esta conexión directa

// -------------------------
// CARGA DIFERIDA
// -------------------------
const FormAuditDetail = React.lazy(() => import('./forms/FormAuditDetail'));
const FormNovedad = React.lazy(() => import('./forms/FormNovedad'));
const FormUploadOnly = React.lazy(() => import('./forms/FormUploadOnly'));
const FormDispositivos = React.lazy(() => import('./forms/FormDispositivos'));
const FormSucursal = React.lazy(() => import('./forms/FormSucursal'));
const FormEmpleado = React.lazy(() => import('./forms/FormEmpleado'));
const FormPlanificador = React.lazy(() => import('./forms/FormPlanificador'));
const FormTurnos = React.lazy(() => import('./forms/FormTurnos'));
const FormRoleEmployees = React.lazy(() => import('./forms/FormRoleEmployees'));
const FormAnnouncements = React.lazy(() => import('./forms/FormAnnouncements'));

const FormSrsPermit = React.lazy(() => import('./forms/FormSrsPermit'));
const FormPharmacyRegent = React.lazy(() => import('./forms/FormPharmacyRegent'));
const FormPharmacovigilance = React.lazy(() => import('./forms/FormPharmacovigilance'));
const FormNursingRegents = React.lazy(() => import('./forms/FormNursingRegents'));
const FormBranchEmployees = React.lazy(() => import('./forms/FormBranchEmployees'));
const FormDocumentViewer = React.lazy(() => import('./forms/FormDocumentViewer'));
const FormServicePayment = React.lazy(() => import('./forms/FormServicePayment'));
const FormRegisterPayment = React.lazy(() => import('./forms/FormRegisterPayment'));
const FormLeadership = React.lazy(() => import('./forms/FormLeadership'));

const FormAddCustomDocument = React.lazy(() => import('./forms/FormAddCustomDocument'));

const HIDES_HEADER = new Set(["viewRoleEmployees", "viewAnnouncementReaders", "viewDocument"]);
const HIDES_FOOTER = new Set(["viewRoleEmployees", "viewAnnouncementReaders", "viewBranchEmployees", "viewDocument", "viewAuditDetail", "manageKiosks"]);
const BRANCH_ACTIONS = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);
const SHIELD_ICONS = new Set(["editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);

const BRANCH_SUBTITLES = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService", "editBranchLeadership", "addCustomDocument", "editCustomDocument"]);

const UnifiedModal = ({ isOpen, onClose, type, formData, setFormData, handleSubmit, activeEmployee, setView, setActiveEmployee: setGlobalActiveEmployee }) => {

    const { branches, roles, shifts, saveWeeklyRoster, addShift, deleteShift, updateBranch, addBranch } = useStaff();

    const [validationError, setValidationError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setValidationError(null);
        setIsSaving(false);
    }, [type, isOpen]);

    const getModalSize = () => {
        switch (type) {
            case "planSchedule": return "max-w-6xl";
            case "manageShifts": return "max-w-5xl";
            case "uploadDocument": return "max-w-md";
            case "manageKiosks": return "max-w-lg";
            case "viewAuditDetail": return "max-w-4xl";
            case "viewRoleEmployees":
            case "viewBranchEmployees": return "max-w-2xl";
            case "viewDocument": return "max-w-5xl";
            case "newEmployee":
            case "editEmployee": return "max-w-5xl";
            case "newBranch":
            case "editBranch":
            case "editBranchLegal":
            case "editBranchInmueble":
            case "editBranchServicios": return "max-w-3xl";
            case "editBranchHorarios": return "max-w-4xl";
            case "editSrsPermit":
            case "editPharmacyRegent":
            case "editPharmacovigilance":
            case "editNursingRegents": return "max-w-xl";
            case "manageService": return "max-w-xl";
            case "registerPayment": return "max-w-lg";
            case "editBranchLeadership": return "max-w-4xl";
            case "addCustomDocument":
            case "editCustomDocument": return "max-w-md";
            default: return "max-w-lg";
        }
    };

    const getModalTitle = () => {
        switch (type) {
            case "viewAuditDetail": return "Detalle de Auditoría";
            case "manageKiosks": return "Dispositivos Kiosco";
            case "planSchedule": return "Planificación Semanal";
            case "manageShifts": return "Catálogo de Turnos";
            case "newEmployee": return "Nuevo Colaborador";
            case "editEmployee": return "Editar Colaborador";
            case "newBranch": return "Nueva Sucursal";
            case "editBranch": return "Configuración General";
            case "editBranchHorarios": return "Horarios de Atención";
            case "editBranchLegal": return "Configuración Legal";
            case "editBranchInmueble": return "Gestión de Inmueble";
            case "editBranchServicios": return "Servicios Básicos";
            case "editSrsPermit": return "Permiso SRS";
            case "editPharmacyRegent": return "Regencia Farmacéutica";
            case "editPharmacovigilance": return "Farmacovigilancia";
            case "editNursingRegents": return "Regencia de Enfermería";
            case "editBranchLeadership": return `Asignar ${formData?.targetRole || 'Jefatura'}`;
            case "viewBranchEmployees": return "Personal Asignado";
            case "viewDocument": return formData?.title || "Documento";
            case "manageService": return "Configurar Servicio / Gasto";
            case "registerPayment": return "Registrar Pago Real";
            case "addCustomDocument": return "Nuevo Documento";
            case "editCustomDocument": return "Actualizar Documento";
            default: return "Gestión Administrativa";
        }
    };

    const getModalSubtitle = () => {
        if (type === "manageKiosks") return formData?.name;
        if (type === "planSchedule") return `${formData?.employee?.name} • ${formData?.employee?.role}`;
        if (type === "viewBranchEmployees") return `SUCURSAL: ${formData?.name || formData?.branchName || 'DESCONOCIDA'}`;
        if (type === "editBranchLeadership") return `SUCURSAL: ${formData?.branch?.name || 'DESCONOCIDA'}`;
        if (BRANCH_SUBTITLES.has(type)) return `SUCURSAL: ${formData?.branch?.name || formData?.name || formData?.branchName || 'NUEVA'}`;
        if (type === "viewDocument") return "Vista Previa de Archivo";
        return "Panel de configuración";
    };

    const handleLocalSubmit = async (e) => {
        e.preventDefault();
        setValidationError(null);

        // ==========================================
        // 🚨 LÓGICA: DOCUMENTO DEL EXPEDIENTE (DIRECTO A SUPABASE)
        // ==========================================
        if (type === "addCustomDocument" || type === "editCustomDocument") {
            const docData = formData.newDocData;

            if (!docData || !docData.title?.trim()) {
                setValidationError("El nombre del documento es obligatorio.");
                return;
            }

            setIsSaving(true);
            try {
                const docId = formData.docId || crypto.randomUUID();
                let fileUrl = docData.url || null;
                let aiSummary = docData.aiSummary || null;

                const originalBranch = formData.branch?.id ? formData.branch : formData;
                const targetBranchId = originalBranch.id;

// 🚨 1. SUBIDA DIRECTA A SUPABASE (Sin pasar por Zustand) 🚨
                if (docData.file) {
                    try {
                        // 🎯 ¡AQUÍ ESTÁ LA MAGIA! Tu bucket real se llama 'documents'
                        const NOMBRE_DEL_BUCKET = 'documents'; 

                        const fileExt = docData.file.name.split('.').pop();
                        // Y lo guardamos dentro de la carpeta 'branches'
                        const filePath = `branches/${targetBranchId}/customDocs/${docId}_${Date.now()}.${fileExt}`;
                        
                        console.log(`Subiendo archivo a Storage [${NOMBRE_DEL_BUCKET}/${filePath}]...`);

                        const { error: uploadError } = await supabase.storage
                            .from(NOMBRE_DEL_BUCKET) 
                            .upload(filePath, docData.file, { upsert: true });

                        if (uploadError) {
                            console.error("Supabase Storage Error:", uploadError);
                            throw new Error(uploadError.message || "Supabase rechazó la subida del archivo.");
                        }

                        const { data: publicUrlData } = supabase.storage
                            .from(NOMBRE_DEL_BUCKET)
                            .getPublicUrl(filePath);
                            
                        fileUrl = publicUrlData.publicUrl;
                        console.log("¡Archivo subido con éxito! URL:", fileUrl);

// ✨ MAGIA DE LA IA (GEMINI) ✨
                        try {
                            console.log("🤖 Activando Gemini AI... Enviando a Supabase Edge Function.");
                            
                            const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-document', {
                                body: { filePath: filePath, bucketName: NOMBRE_DEL_BUCKET } 
                            });

                            // 👇 ESTOS DOS LOGS NOS DIRÁN LA VERDAD ABSOLUTA 👇
                            console.log("📥 Respuesta cruda de la IA (Data):", aiResponse);
                            console.log("🚨 Posible error de la IA (Error):", aiError);

                            if (!aiError && aiResponse?.success && aiResponse.aiData) {
                                aiSummary = aiResponse.aiData.aiSummary;
                                if (aiResponse.aiData.issueDate && !docData.issueDate) docData.issueDate = aiResponse.aiData.issueDate;
                                if (aiResponse.aiData.expDate && !docData.expDate) docData.expDate = aiResponse.aiData.expDate;
                                console.log("✅ Resumen de IA guardado con éxito en memoria.");
                            } else {
                                console.warn("⚠️ La llamada a la función terminó, pero no trajo un resumen válido.");
                            }
                        } catch (aiCatchedError) {
                            console.error("🔥 Error catastrófico al llamar a la función analyze-document:", aiCatchedError);
                        }

                    } catch (uploadFail) {
                        console.error("🔥 ERROR EXACTO DE SUBIDA:", uploadFail);
                        setValidationError(`Error al subir: ${uploadFail.message}.`);
                        setIsSaving(false);
                        return; 
                    }
                }

                // 2. Construimos el documento
                const documentObject = {
                    id: docId,
                    title: docData.title.trim(),
                    category: docData.category,
                    hasIssueDate: docData.hasIssueDate,
                    issueDate: docData.hasIssueDate ? docData.issueDate : null,
                    hasExpiration: docData.hasExpiration,
                    expDate: docData.hasExpiration ? docData.expDate : null,
                    url: fileUrl, // Ahora sí estará lleno
                    aiSummary: aiSummary
                };

                const currentSettings = originalBranch.settings || {};
                let currentCustomDocs = currentSettings.customDocs || [];

                if (type === "editCustomDocument") {
                    currentCustomDocs = currentCustomDocs.map(doc => doc.id === docId ? documentObject : doc);
                } else {
                    currentCustomDocs = [...currentCustomDocs, documentObject];
                }

                const updatedSettings = {
                    ...currentSettings,
                    customDocs: currentCustomDocs
                };

                const payloadToSave = {
                    ...originalBranch,
                    settings: updatedSettings
                };

                // 3. Actualizamos la sucursal
                const { updateBranch, appendAuditLog } = useStaff.getState();
                await updateBranch(targetBranchId, payloadToSave);

                if (appendAuditLog) {
                    await appendAuditLog('DOC_AGREGADO', targetBranchId, {
                        timeline_title: type === "addCustomDocument" ? `Nuevo Documento: ${documentObject.title}` : `Documento Actualizado: ${documentObject.title}`,
                        dimension: 'LEGAL',
                        new_value: documentObject.category
                    });
                }

                window.dispatchEvent(new CustomEvent('force-history-refresh'));
                onClose();
            } catch (err) {
                console.error("Error guardando la base de datos:", err);
                setValidationError("No se pudo guardar el documento en la base de datos.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (BRANCH_ACTIONS.has(type)) {
            setIsSaving(true);
            try {
                const payloadToSave = { ...formData };

                if (type === "newBranch" || type === "editBranch") {
                    const nameToValidate = payloadToSave.name || payloadToSave.branchName || "";
                    if (!nameToValidate.trim()) {
                        setValidationError("Falta el Nombre Comercial.");
                        setIsSaving(false);
                        return;
                    }
                    payloadToSave.name = nameToValidate;
                }

                if (type === "editBranchHorarios") {
                    const extractedHours = typeof (payloadToSave.weeklyHours || payloadToSave.weekly_hours) === 'string'
                        ? JSON.parse((payloadToSave.weeklyHours || payloadToSave.weekly_hours) || '{}')
                        : (payloadToSave.weeklyHours || payloadToSave.weekly_hours || {});

                    let hasInvalidHours = false;
                    Object.values(extractedHours).forEach(day => {
                        if (day.isOpen && (!day.start || !day.end)) hasInvalidHours = true;
                    });

                    if (hasInvalidHours) {
                        setValidationError("Existen días marcados como 'Abiertos' que no tienen hora asignada.");
                        setIsSaving(false);
                        return;
                    }
                }

                if (type === 'newBranch') {
                    if (addBranch) await addBranch(payloadToSave);
                    else if (handleSubmit) { setFormData(payloadToSave); await handleSubmit(e); }
                } else {
                    const branchIdToUpdate = payloadToSave.id || payloadToSave.branchId;
                    await updateBranch(branchIdToUpdate, payloadToSave);
                    window.dispatchEvent(new CustomEvent('force-history-refresh'));
                }

                onClose();
            } catch (err) {
                console.error("Error al guardar la sucursal:", err);
                const errorMsg = err?.message || err?.error_description || (typeof err === 'string' ? err : "Error interno al guardar los datos en el servidor.");
                setValidationError(errorMsg);
            } finally {
                setIsSaving(false);
            }
            return;
        }

        // 🚨 Lógica Especial para Liderazgo Dual (Relevo y Asignación)
        if (type === "editBranchLeadership") {
            if (!formData.selectedEmpId) {
                setValidationError("Debes seleccionar a un colaborador de la lista.");
                return;
            }
            if (formData.isPermanent === false && !formData.interimEndDate) {
                setValidationError("Para un interinato, la fecha de finalización es obligatoria.");
                return;
            }

            setIsSaving(true);
            try {
                const { updateEmployee, appendAuditLog, employees, branches, roles } = useStaff.getState();
                const selectedEmp = employees.find(e => e.id === formData.selectedEmpId);
                const currentEmpObj = employees.find(e => e.id === formData.currentAssignee);

                // 🔴 1. RESOLVER IDs SEGUROS PARA BD RELACIONAL
                const actualBranchId = formData.branch?.id || formData.branchId || formData.id;
                const actualBranchName = formData.branch?.name || formData.name || 'Sucursal';

                // Buscar el role_id destino exacto en el catálogo
                const targetRoleObj = roles.find(r => r.name === formData.targetRole);
                const targetRoleId = targetRoleObj ? targetRoleObj.id : null;

                // ==========================================
                // 2. RELEVAR AL EMPLEADO ANTERIOR (Si existe)
                // ==========================================
                if (formData.currentAssignee && formData.currentAssignee !== formData.selectedEmpId) {
                    if (formData.outgoingAction === 'REASSIGN') {
                        const newBranchName = branches.find(b => String(b.id) === String(formData.outgoingBranch))?.name || 'otra sucursal';
                        const outRoleObj = roles.find(r => r.name === formData.outgoingRole);

                        // Actualiza empleado
                        await updateEmployee(formData.currentAssignee, {
                            branchId: formData.outgoingBranch,
                            role_id: outRoleObj ? outRoleObj.id : null,
                            role: formData.outgoingRole // Feedback UI
                        });

                        // 🔴 Registra en la tabla employee_history
                        await supabase.from('employee_history').insert([{
                            employee_id: formData.currentAssignee,
                            type: 'REASSIGNMENT',
                            date: new Date().toISOString().split('T')[0],
                            previous_branch_id: actualBranchId,
                            target_branch_id: formData.outgoingBranch,
                            previous_role: formData.targetRole,
                            new_role: formData.outgoingRole,
                            details: { note: `Relevado de jefatura en ${actualBranchName}` }
                        }]);

                        await appendAuditLog('CAMBIO_PUESTO', formData.currentAssignee, {
                            timeline_title: 'Reasignación Operativa',
                            dimension: 'HR',
                            old_value: `${formData.targetRole} (${actualBranchName})`,
                            new_value: `${formData.outgoingRole} (${newBranchName})`
                        });
                    } else {
                        // Lo manda a la banca (Sin Asignar)
                        await updateEmployee(formData.currentAssignee, {
                            branchId: null, // Queda NULL en DB real
                            role_id: null,
                            role: 'Sin Asignar'
                        });

                        await supabase.from('employee_history').insert([{
                            employee_id: formData.currentAssignee,
                            type: 'UNASSIGNED',
                            date: new Date().toISOString().split('T')[0],
                            previous_branch_id: actualBranchId,
                            previous_role: formData.targetRole,
                            new_role: 'Sin Asignar',
                            details: { note: `Removido de la sucursal ${actualBranchName} a la bolsa de trabajo flotante.` }
                        }]);

                        await appendAuditLog('REMOVIDO_SUCURSAL', formData.currentAssignee, {
                            timeline_title: 'Desvinculación de Sucursal',
                            dimension: 'HR',
                            old_value: `${formData.targetRole} (${actualBranchName})`,
                            new_value: 'Sin Asignar (Flotante)'
                        });
                    }
                }

                // ==========================================
                // 3. ACTUALIZAR AL NUEVO TITULAR
                // ==========================================
                await updateEmployee(formData.selectedEmpId, {
                    branchId: actualBranchId,    // 🔴 GUARDA LA SUCURSAL REAL EN BD
                    role_id: targetRoleId,       // 🔴 GUARDA EL ID DEL ROL REAL EN BD
                    role: formData.targetRole    // Actualiza la vista en memoria
                });

                // 🔴 Registrar en la tabla employee_history
                await supabase.from('employee_history').insert([{
                    employee_id: formData.selectedEmpId,
                    type: formData.moveType || 'PROMOTION',
                    date: new Date().toISOString().split('T')[0],
                    previous_branch_id: selectedEmp?.branchId || null,
                    target_branch_id: actualBranchId,
                    previous_role: selectedEmp?.role || null,
                    new_role: formData.targetRole,
                    details: {
                        note: formData.notes || 'Asignación realizada desde el Panel de Sucursales',
                        isInterim: formData.isPermanent === false,
                        interimEndDate: formData.interimEndDate || null
                    }
                }]);

                // 4. AUDITORÍA INTELIGENTE PARA LA SUCURSAL
                let logText = 'Asignación de puesto';
                if (formData.moveType === 'PROMOTION') logText = 'Ascenso interno';
                if (formData.moveType === 'TRANSFER') logText = 'Traslado operativo';
                if (formData.moveType === 'TRANSFER_PROMOTION') logText = 'Traslado y Ascenso';
                if (formData.isPermanent === false) logText += ` (Interinato)`;

                let notaHistorial = formData.notes || 'Movimiento estándar';
                if (currentEmpObj && currentEmpObj.id !== selectedEmp.id) {
                    notaHistorial += ` | Releva a: ${currentEmpObj.name}`;
                }

                await appendAuditLog('PERSONAL_ASIGNADO', actualBranchId, {
                    timeline_title: `Nueva Jefatura: ${selectedEmp?.name || 'Asignado'}`,
                    dimension: 'HR',
                    branch_id: actualBranchId,
                    old_value: selectedEmp?.role || 'N/A',
                    new_value: `${formData.targetRole} - ${logText}`,
                    notas: notaHistorial
                });

                // ==========================================
                // 5. SINCRONIZACIÓN DE UI (Sin recargar navegador)
                // ==========================================
                const { fetchEmployees, fetchBranchHistory } = useStaff.getState();

                // Forzar bajada fresca de base de datos
                if (fetchEmployees) await fetchEmployees();
                if (fetchBranchHistory && actualBranchId) await fetchBranchHistory(actualBranchId);

                // 🔴 BENGALA: Disparar evento para actualizar historial globalmente
                window.dispatchEvent(new CustomEvent('force-history-refresh'));

                onClose();
            } catch (err) {
                console.error("Error guardando jefatura:", err);
                setValidationError("Error al procesar el relevo de personal.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        // 🚨 Lógica Especial para Registrar Pagos de Servicios
        if (type === "registerPayment") {
            const { _currentService, _paymentData, _auditPayload, id, settings } = formData;

            if (!_paymentData || !_paymentData.amount || !_paymentData.billing_month) {
                setValidationError("El monto exacto y el mes que cubre son obligatorios.");
                return;
            }

            setIsSaving(true);
            try {
                // Traemos las acciones del store de Zustand
                const { uploadDocument, addBranchExpense, updateBranch, appendAuditLog } = useStaff.getState();

                let fileUrl = null;

                // 1. Subir recibo a Storage (Supabase) si existe
                if (_paymentData.receiptFile) {
                    const path = `expenses/${id}/${_currentService}/${_paymentData.billing_month}_${Date.now()}`;
                    if (uploadDocument) {
                        fileUrl = await uploadDocument(path, _paymentData.receiptFile);
                    }
                }

                // 2. Armar el due_date (YYYY-MM-DD) usando el dueDay configurado en la sucursal
                const serviceData = _currentService === 'rent' ? (settings?.rent || {}) : ((settings?.services || {})[_currentService] || {});
                const dueDay = serviceData.dueDay || 1; // Por defecto día 1 si no hay configurado
                const formattedDueDate = `${_paymentData.billing_month}-${String(dueDay).padStart(2, '0')}`;

                // Preparamos el objeto para el slice (incluyendo el File si existe)
                const expenseRecord = {
                    expense_type: _currentService,
                    billing_month: _paymentData.billing_month,
                    amount: Number(_paymentData.amount),
                    due_date: formattedDueDate,
                    receiptFile: _paymentData.receiptFile, // Lo pasamos al slice
                    notes: _paymentData.notes || null
                };

                // Ejecutamos la función completa del slice que ya hace TODO el trabajo
                const { registerBranchExpense } = useStaff.getState();
                if (registerBranchExpense) {
                    await registerBranchExpense(id, expenseRecord);
                }

                // 🔴 NUEVO: Lanzamos tu LiquidToast de éxito
                const { showToast } = useToastStore.getState();
                if (showToast) {
                    showToast(
                        "Pago Registrado",
                        `El pago de ${_paymentData.billing_month} se guardó con éxito.`,
                        "success"
                    );
                }

                // 🔴 BENGALA PARA ACTUALIZAR HISTORIAL DE PAGOS
                window.dispatchEvent(new CustomEvent('force-history-refresh'));

                // Cerramos el modal
                onClose();

            } catch (err) {
                console.error("Error registrando el pago:", err);
                setValidationError("No se pudo procesar el pago. Revisa la consola para más detalles.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        // ============================================================================
        // FORMULARIO GENÉRICO DEFAULT
        // ============================================================================
        if (handleSubmit) {
            setIsSaving(true);
            try {
                await handleSubmit(e);
                window.dispatchEvent(new CustomEvent('force-history-refresh'));

            } catch (err) {
                console.error("Error en Submit general:", err);
                const errorMsg = err?.message || err?.error_description || (typeof err === 'string' ? err : "Ocurrió un error inesperado.");
                setValidationError(errorMsg);
            } finally {
                setIsSaving(false);
            }
        }
    };

    if (!isOpen) return null;

    const FallbackLoader = () => (
        <div className="w-full h-64 flex flex-col items-center justify-center text-slate-500 gap-3">
            <div className="w-8 h-8 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin"></div>
            <p className="font-bold text-[10px] uppercase tracking-widest animate-pulse">Cargando Módulo...</p>
        </div>
    );

    const getModalHeightClass = () => type === 'viewDocument' ? 'h-[85vh]' : 'max-h-[90vh] h-fit';
    const hidesHeader = HIDES_HEADER.has(type);
    const hidesFooter = HIDES_FOOTER.has(type);
    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/80 shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-white/70 backdrop-blur-md";

    return (
        <ModalShell open={isOpen} onClose={onClose} maxWidthClass={getModalSize()} zClass="z-[100]">
            <div className={`flex flex-col rounded-[2.5rem] overflow-hidden border border-white/90 relative shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)] animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-500 ease-out ${getModalHeightClass()}`}>

                {/* 🚨 FIX DE PERFORMANCE 1: Forzamos a la GPU a mantener el blur en su propia capa y que no recalcule. */}
                <div
                    className="absolute inset-0 bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%] -z-10 pointer-events-none"
                    style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                />

                {!hidesHeader && (
                    <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-white/40 flex justify-between items-center relative z-10 shrink-0">
                        <div className="flex items-center gap-4">
                            {type === 'planSchedule' && <div className={`${squircleClass} text-[#007AFF]`}><ClipboardList size={22} strokeWidth={2.5} /></div>}
                            {type === 'manageShifts' && <div className={`${squircleClass} text-[#007AFF]`}><BookOpen size={22} strokeWidth={2.5} /></div>}
                            {SHIELD_ICONS.has(type) && <div className={`${squircleClass} text-emerald-600`}><ShieldCheck size={22} strokeWidth={2.5} /></div>}
                            {(type === "newBranch" || type === "editBranch" || type === "editBranchInmueble") && <div className={`${squircleClass} text-[#007AFF]`}><Building2 size={22} strokeWidth={2.5} /></div>}
                            {type === "editBranchLegal" && <div className={`${squircleClass} text-emerald-600`}><Scale size={22} strokeWidth={2.5} /></div>}
                            {type === "editBranchServicios" && <div className={`${squircleClass} text-amber-500`}><Zap size={22} strokeWidth={2.5} /></div>}
                            {type === "editBranchHorarios" && <div className={`${squircleClass} text-[#007AFF]`}><Clock size={22} strokeWidth={2.5} /></div>}
                            {type === "viewBranchEmployees" && <div className={`${squircleClass} text-[#007AFF]`}><Building2 size={22} strokeWidth={2.5} /></div>}
                            {type === "editBranchLeadership" && <div className={`${squircleClass} text-amber-500`}><Star size={22} strokeWidth={2.5} /></div>}
                            {(type === "addCustomDocument" || type === "editCustomDocument") && <div className={`${squircleClass} text-[#007AFF]`}><FilePlus size={22} strokeWidth={2.5} /></div>}

                            <div>
                                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg md:text-xl leading-none mb-1">
                                    {getModalTitle()}
                                </h3>
                                <p className="text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">{getModalSubtitle()}</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm active:scale-95 shrink-0 hover:scale-105">
                            <X size={18} strokeWidth={2.5} />
                        </button>
                    </div>
                )}

                {/* 🚨 FIX DE PERFORMANCE 2: overscroll-contain y aceleración de scroll por hardware */}
                <div
                    className={`flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-10 w-full`}
                    style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}
                >
                    <div className={`flex flex-col min-h-full w-full ${hidesHeader ? 'p-0' : 'px-6 md:px-10 py-6'}`}>
                        {validationError && (
                            <div className="mb-6 p-4 bg-red-500/10 backdrop-blur-md border border-red-500/20 rounded-[1.25rem] flex items-center gap-3 text-red-600 shadow-sm shrink-0 animate-in fade-in slide-in-from-top-4">
                                <AlertCircle size={20} strokeWidth={2.5} className="shrink-0" />
                                <p className="text-[11px] font-bold uppercase tracking-wide leading-tight">{validationError}</p>
                            </div>
                        )}

                        <form id="unified-modal-form" onSubmit={handleLocalSubmit} className="flex-1 flex flex-col relative w-full pb-4">
                            <Suspense fallback={<FallbackLoader />}>
                                {type === "viewAuditDetail" && <FormAuditDetail data={formData} />}
                                {type === "manageKiosks" && <FormDispositivos formData={formData} />}
                                {(type === "newEmployee" || type === "editEmployee") && <FormEmpleado formData={formData} setFormData={setFormData} branches={branches} roles={roles} />}

                                {(type === "newBranch" || type === "editBranch") && <FormSucursal formData={formData} setFormData={setFormData} section="general" />}
                                {type === "editBranchHorarios" && <FormSucursal formData={formData} setFormData={setFormData} section="horarios" />}
                                {type === "editBranchLegal" && <FormSucursal formData={formData} setFormData={setFormData} section="legal" />}
                                {type === "editBranchInmueble" && <FormSucursal formData={formData} setFormData={setFormData} section="inmueble" />}
                                {type === "editBranchServicios" && <FormSucursal formData={formData} setFormData={setFormData} section="servicios" />}

                                {type === "newEvent" && <FormNovedad formData={formData} setFormData={setFormData} branches={branches} activeEmployee={activeEmployee} />}
                                {type === "uploadDocument" && <FormUploadOnly formData={formData} setFormData={setFormData} />}
                                {type === "planSchedule" && <FormPlanificador formData={formData} setFormData={setFormData} shifts={shifts} saveWeeklyRoster={saveWeeklyRoster} onClose={onClose} />}
                                {type === "manageShifts" && <FormTurnos formData={formData} setFormData={setFormData} branches={branches} shifts={shifts} addShift={addShift} deleteShift={deleteShift} />}
                                {type === "viewRoleEmployees" && <FormRoleEmployees formData={formData} />}
                                {type === "viewAnnouncementReaders" && <FormAnnouncements data={formData} onClose={onClose} />}
                                {type === "editSrsPermit" && <FormSrsPermit formData={formData} setFormData={setFormData} />}
                                {type === "editPharmacyRegent" && <FormPharmacyRegent formData={formData} setFormData={setFormData} onClose={onClose} />}
                                {type === "editPharmacovigilance" && <FormPharmacovigilance formData={formData} setFormData={setFormData} onClose={onClose} />}
                                {type === "editNursingRegents" && <FormNursingRegents formData={formData} setFormData={setFormData} />}

                                {type === "viewBranchEmployees" && <FormBranchEmployees formData={formData} setView={setView} setActiveEmployee={setGlobalActiveEmployee} onClose={onClose} />}

                                {type === "viewDocument" && <FormDocumentViewer formData={formData} onClose={onClose} />}
                                {type === "manageService" && <FormServicePayment formData={formData} setFormData={setFormData} />}
                                {type === "registerPayment" && <FormRegisterPayment formData={formData} setFormData={setFormData} />}
                                {type === "editBranchLeadership" && <FormLeadership formData={formData} setFormData={setFormData} />}
                                {(type === "addCustomDocument" || type === "editCustomDocument") && <FormAddCustomDocument formData={formData} setFormData={setFormData} type={type} />}
                            </Suspense>
                        </form>
                    </div>
                </div>

                {!hidesFooter && (
                    <div className="flex-none px-6 md:px-10 py-5 bg-transparent border-t border-white/40 flex justify-between items-center relative z-10 shrink-0">
                        <button type="button" onClick={onClose} disabled={isSaving} className="px-6 py-3 h-12 rounded-full bg-white/50 border border-white/80 text-slate-500 font-bold text-[11px] uppercase tracking-widest hover:bg-white hover:text-slate-800 transition-colors disabled:opacity-50">
                            Cancelar
                        </button>
                        <button type="submit" form="unified-modal-form" disabled={isSaving} className="px-8 py-3 h-12 bg-[#007AFF] text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-full shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:bg-[#0066CC] hover:shadow-[0_12px_25px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95 flex items-center gap-2">
                            {isSaving ? <><Loader2 size={16} className="animate-spin" /> Procesando</> : <><Save size={16} strokeWidth={3} /> Guardar Cambios</>}
                        </button>
                    </div>
                )}
            </div>
        </ModalShell>
    );
};

export default UnifiedModal;