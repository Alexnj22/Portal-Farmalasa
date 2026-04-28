import React, { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import {
    X, ClipboardList, Building2, BookOpen, Save, AlertCircle, ShieldCheck, Loader2, Scale, Zap, Clock, Star, FilePlus, Settings, Sparkles, UserPlus,
    User, Briefcase, CreditCard, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Palmtree, DollarSign, Edit2
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import ModalShell from "./common/ModalShell";
import { useToastStore } from '../store/toastStore';
import { supabase } from '../supabaseClient'; 

// -------------------------
// CARGA DIFERIDA
// -------------------------
const FormAuditDetail = React.lazy(() => import('./forms/FormAuditDetail'));
const FormNovedad = React.lazy(() => import('./forms/FormNovedad'));
const FormUploadOnly = React.lazy(() => import('./forms/FormUploadOnly'));
const FormDispositivos = React.lazy(() => import('./forms/FormDispositivos'));
const FormSucursal = React.lazy(() => import('./forms/FormSucursal'));

// 🚨 FORMULARIOS DE EMPLEADO
const FormEmpleadoNuevo = React.lazy(() => import('./forms/EmployeeFormModal'));
const FormRehireEmployee = React.lazy(() => import('./forms/FormRehireEmployee'));
const FormVacationRecall = React.lazy(() => import('./forms/FormVacationRecall'));

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
const FormWfmAnalytics = React.lazy(() => import('./forms/FormWfmAnalytics'));
const FormAiSchedulerPreview = React.lazy(() => import('./forms/FormAiSchedulerPreview'));
const FormSetPassword = React.lazy(() => import('./forms/FormSetPassword'));
const FormChangeOwnPassword = React.lazy(() => import('./forms/FormChangeOwnPassword'));
const FormEditContact = React.lazy(() => import('./forms/FormEditContact'));
const FormNewPayrollPeriod = React.lazy(() => import('./forms/FormNewPayrollPeriod'));
const FormEditPayrollEntry = React.lazy(() => import('./forms/FormEditPayrollEntry'));

const HIDES_HEADER = new Set(["viewRoleEmployees", "viewAnnouncementReaders", "viewDocument"]);
const HIDES_FOOTER = new Set(["viewWfmAnalytics", "aiSchedulerPreview", "viewRoleEmployees", "viewAnnouncementReaders", "viewBranchEmployees", "viewDocument", "viewAuditDetail", "manageKiosks", "setEmployeePassword", "changeOwnPassword", "editContact"]);
const BRANCH_ACTIONS = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);
const SHIELD_ICONS = new Set(["editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);

const BRANCH_SUBTITLES = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService", "editBranchLeadership", "addCustomDocument", "editCustomDocument"]);

const UnifiedModal = ({ isOpen, onClose, type, formData, setFormData, handleSubmit, activeEmployee, setView, setActiveEmployee: setGlobalActiveEmployee }) => {

    const { branches, roles, shifts, saveWeeklyRoster, addShift, deleteShift, updateBranch, addBranch } = useStaff();

    const [validationError, setValidationError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isFormValid, setIsFormValid] = useState(true);
    const [empActiveTab, setEmpActiveTab] = useState('personal');
    const scrollRef = useRef(null);

    useEffect(() => {
        setValidationError(null);
        setIsSaving(false);
        setIsFormValid(true);
        setEmpActiveTab('personal');
    }, [type, isOpen]);

    const EMP_STEPS = [
        { key: 'personal', label: 'Personal', icon: User },
        { key: 'laboral',  label: 'Contrato', icon: Briefcase },
        { key: 'nomina',   label: 'Nómina',   icon: CreditCard },
    ];
    const empStepCompletion = useMemo(() => ({
        personal: !!(formData?.first_names?.trim() && formData?.last_names?.trim()),
        laboral:  !!(formData?.branch_id && formData?.role_id),
        nomina:   !!(formData?.isss_number || formData?.afp_number || formData?.bank_name),
    }), [formData?.first_names, formData?.last_names, formData?.branch_id, formData?.role_id, formData?.isss_number, formData?.afp_number, formData?.bank_name]);

    useEffect(() => {
        if (validationError && scrollRef.current) {
            scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [validationError]);

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
            case "editEmployee": return "max-w-4xl";
            case "rehireEmployee": return "max-w-2xl";
            case "vacationRecall": return "max-w-lg";
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
            case "viewWfmAnalytics": return "max-w-4xl";
            case "aiSchedulerPreview": return "max-w-5xl";
            case "setEmployeePassword": return "max-w-sm";
            case "changeOwnPassword": return "max-w-sm";
            case "editContact": return "max-w-sm";
            case "newPayrollPeriod": return "max-w-md";
            case "editPayrollEntry": return "max-w-2xl";
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
            case "editEmployee": return "Actualizar Información";
            case "rehireEmployee": return "Recontratación";
            case "vacationRecall": return "Ingreso en Vacaciones";
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
            case "viewWfmAnalytics": return "Monitor de ventas";
            case "aiSchedulerPreview": return "Planificación con IA";
            case "setEmployeePassword": return "Establecer Contraseña";
            case "changeOwnPassword": return "Cambiar Contraseña";
            case "editContact": return "Editar Perfil";
            case "newPayrollPeriod": return "Nueva Quincena";
            case "editPayrollEntry": return "Editar Entrada";
            default: return "Gestión Administrativa";
        }
    };

    const getModalSubtitle = () => {
        if (type === "manageKiosks") return formData?.name;
        if (type === "planSchedule") return `${formData?.employee?.name} • ${formData?.employee?.role}`;
        if (type === "newEmployee") return "Nueva ficha de colaborador";
        if (type === "editEmployee") return formData?.name?.toUpperCase() || "COLABORADOR";
        if (type === "rehireEmployee") return formData?.name?.toUpperCase() || "COLABORADOR";
        if (type === "vacationRecall") return formData?.employee?.name?.toUpperCase() || "COLABORADOR";
        if (type === "viewBranchEmployees") return `SUCURSAL: ${formData?.name || formData?.branchName || 'DESCONOCIDA'}`;
        if (type === "editBranchLeadership") return `SUCURSAL: ${formData?.branch?.name || 'DESCONOCIDA'}`;
        if (type === "setEmployeePassword") return formData?.name?.toUpperCase() || "COLABORADOR";
        if (type === "changeOwnPassword") return "TU CUENTA";
        if (type === "editContact") return formData?.name?.toUpperCase() || "TU PERFIL";
        if (type === "newPayrollPeriod") return "PERÍODO DE NÓMINA";
        if (type === "editPayrollEntry") return (formData?._entry?.employee?.name || 'COLABORADOR').toUpperCase();
        if (BRANCH_SUBTITLES.has(type)) return `SUCURSAL: ${formData?.branch?.name || formData?.name || formData?.branchName || 'NUEVA'}`;
        if (type === "viewDocument") return "Vista Previa de Archivo";
        return "Panel de configuración";
    };

    const handleLocalSubmit = async (e) => {
        e.preventDefault();
        setValidationError(null);

        // ==========================================
        // 🚨 LÓGICA: GUARDAR EMPLEADOS
        // ==========================================
        if (type === "newEmployee" || type === "editEmployee") {
            
            if (type === "newEmployee") {
                if (!formData.first_names?.trim() || !formData.last_names?.trim() || !formData.code?.trim() || !formData.branch_id || !formData.role_id) {
                    setValidationError("Faltan campos obligatorios: Nombres, Apellidos, Código, Sucursal Base o Cargo.");
                    return;
                }
            } else {
                if (!formData.first_names?.trim() || !formData.last_names?.trim()) {
                    setValidationError("Los Nombres y Apellidos son obligatorios.");
                    return;
                }
            }

            setIsSaving(true);
            try {
                const { addEmployee, updateEmployee } = useStaff.getState();
                const finalData = { ...formData, username: formData.username?.trim().toLowerCase() };
                
                delete finalData.photoPreview; 
                delete finalData.effectiveStatus; 
                delete finalData.history; 
                delete finalData.weeklySchedule; 
                delete finalData.birthDate; 
                delete finalData.hireDate;
                delete finalData.branchId;
                delete finalData.roleId;
                delete finalData.secondaryRole;
                delete finalData.created_at; 
                delete finalData.name; 

                if (finalData.branch_id === "") finalData.branch_id = null;
                if (finalData.role_id === "") finalData.role_id = null;
                if (finalData.secondary_role_id === "") finalData.secondary_role_id = null;
                if (finalData.birth_date === "") finalData.birth_date = null;
                if (finalData.contract_end_date === "") finalData.contract_end_date = null;
                if (finalData.base_salary === "") finalData.base_salary = null;
                if (finalData.weekly_contracted_hours === "") finalData.weekly_contracted_hours = null;

                if (type === "editEmployee" || (formData.id)) {
                    await updateEmployee(formData.id, finalData);
                } else {
                    await addEmployee(finalData);
                }

                const { showToast } = useToastStore.getState();
                if (showToast) showToast("Personal Actualizado", "La ficha del empleado se guardó exitosamente.", "success");
                
                localStorage.removeItem('wfm_employee_draft');
                onClose();
            } catch (err) {
                console.error("Error guardando empleado:", err);
                if (err?.message?.startsWith('HEADCOUNT_LIMIT:')) {
                    const { showToast } = useToastStore.getState();
                    showToast('Límite de Organigrama', err.message.replace('HEADCOUNT_LIMIT: ', ''), 'error');
                } else {
                    setValidationError(err?.message || "Error interno al procesar y guardar la ficha del empleado. Verifica que no falten datos.");
                }
            } finally {
                setIsSaving(false);
            }
            return;
        }

        // ==========================================
        // LÓGICA: DOCUMENTO DEL EXPEDIENTE
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

                if (docData.file) {
                    try {
                        const NOMBRE_DEL_BUCKET = 'documents';
                        const fileExt = docData.file.name.split('.').pop();
                        const filePath = `branches/${targetBranchId}/customDocs/${docId}_${Date.now()}.${fileExt}`;

                        const { error: uploadError } = await supabase.storage
                            .from(NOMBRE_DEL_BUCKET)
                            .upload(filePath, docData.file, { upsert: true });

                        if (uploadError) throw new Error(uploadError.message || "Supabase rechazó la subida del archivo.");

                        const { data: publicUrlData } = supabase.storage
                            .from(NOMBRE_DEL_BUCKET)
                            .getPublicUrl(filePath);

                        fileUrl = publicUrlData.publicUrl;

                        try {
                            const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-document', {
                                body: { filePath: filePath, bucketName: NOMBRE_DEL_BUCKET }
                            });

                            if (!aiError && aiResponse?.success && aiResponse.aiData) {
                                aiSummary = aiResponse.aiData.aiSummary;
                                if (aiResponse.aiData.issueDate && !docData.issueDate) docData.issueDate = aiResponse.aiData.issueDate;
                                if (aiResponse.aiData.expDate && !docData.expDate) docData.expDate = aiResponse.aiData.expDate;
                            }
                        } catch (aiCatchedError) {
                            console.error("Error AI:", aiCatchedError);
                        }

                    } catch (uploadFail) {
                        setValidationError(`Error al subir: ${uploadFail.message}.`);
                        setIsSaving(false);
                        return;
                    }
                }

                const documentObject = {
                    id: docId,
                    title: docData.title.trim(),
                    category: docData.category,
                    hasIssueDate: docData.hasIssueDate,
                    issueDate: docData.hasIssueDate ? docData.issueDate : null,
                    hasExpiration: docData.hasExpiration,
                    expDate: docData.hasExpiration ? docData.expDate : null,
                    url: fileUrl, 
                    aiSummary: aiSummary
                };

                const currentSettings = originalBranch.settings || {};
                let currentCustomDocs = currentSettings.customDocs || [];

                if (type === "editCustomDocument") {
                    currentCustomDocs = currentCustomDocs.map(doc => doc.id === docId ? documentObject : doc);
                } else {
                    currentCustomDocs = [...currentCustomDocs, documentObject];
                }

                const updatedSettings = { ...currentSettings, customDocs: currentCustomDocs };
                const payloadToSave = { ...originalBranch, settings: updatedSettings };

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
                console.error("Error guardando db:", err);
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

                const actualBranchId = formData.branch?.id || formData.branchId || formData.id;
                const actualBranchName = formData.branch?.name || formData.name || 'Sucursal';

                const targetRoleObj = roles.find(r => r.name === formData.targetRole);
                const targetRoleId = targetRoleObj ? targetRoleObj.id : null;

                if (formData.currentAssignee && formData.currentAssignee !== formData.selectedEmpId) {
                    if (formData.outgoingAction === 'REASSIGN') {
                        const newBranchName = branches.find(b => String(b.id) === String(formData.outgoingBranch))?.name || 'otra sucursal';
                        const outRoleObj = roles.find(r => r.name === formData.outgoingRole);

                        await updateEmployee(formData.currentAssignee, {
                            branchId: formData.outgoingBranch,
                            role_id: outRoleObj ? outRoleObj.id : null,
                            role: formData.outgoingRole 
                        });

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

                    } else {
                        await updateEmployee(formData.currentAssignee, {
                            branchId: null, 
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
                    }
                }

                await updateEmployee(formData.selectedEmpId, {
                    branchId: actualBranchId,    
                    role_id: targetRoleId,       
                    role: formData.targetRole    
                });

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

                const { fetchEmployees, fetchBranchHistory } = useStaff.getState();
                if (fetchEmployees) await fetchEmployees();
                if (fetchBranchHistory && actualBranchId) await fetchBranchHistory(actualBranchId);

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

        if (type === "registerPayment") {
            const { _currentService, _paymentData, _auditPayload, id, settings } = formData;

            if (!_paymentData || !_paymentData.amount || !_paymentData.billing_month) {
                setValidationError("El monto exacto y el mes que cubre son obligatorios.");
                return;
            }

            setIsSaving(true);
            try {
                const { uploadDocument, registerBranchExpense } = useStaff.getState();
                let fileUrl = null;

                if (_paymentData.receiptFile) {
                    const path = `expenses/${id}/${_currentService}/${_paymentData.billing_month}_${Date.now()}`;
                    if (uploadDocument) fileUrl = await uploadDocument(path, _paymentData.receiptFile);
                }

                const serviceData = _currentService === 'rent' ? (settings?.rent || {}) : ((settings?.services || {})[_currentService] || {});
                const dueDay = serviceData.dueDay || 1; 
                const formattedDueDate = `${_paymentData.billing_month}-${String(dueDay).padStart(2, '0')}`;

                const expenseRecord = {
                    expense_type: _currentService,
                    billing_month: _paymentData.billing_month,
                    amount: Number(_paymentData.amount),
                    due_date: formattedDueDate,
                    receiptFile: _paymentData.receiptFile, 
                    notes: _paymentData.notes || null
                };

                if (registerBranchExpense) await registerBranchExpense(id, expenseRecord);

                const { showToast } = useToastStore.getState();
                if (showToast) showToast("Pago Registrado", `El pago de ${_paymentData.billing_month} se guardó con éxito.`, "success");

                window.dispatchEvent(new CustomEvent('force-history-refresh'));
                onClose();
            } catch (err) {
                setValidationError("No se pudo procesar el pago.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (type === "rehireEmployee") {
            if (!formData.rehire_hire_date || !formData.rehire_branch_id || !formData.rehire_role_id) {
                setValidationError("Fecha de ingreso, sucursal y cargo son obligatorios.");
                return;
            }
            setIsSaving(true);
            try {
                const { rehireEmployee } = useStaff.getState();
                await rehireEmployee(formData.id, {
                    hire_date:              formData.rehire_hire_date,
                    branch_id:              formData.rehire_branch_id,
                    role_id:                formData.rehire_role_id,
                    secondary_role_id:      formData.rehire_secondary_role_id || null,
                    contract_type:          formData.rehire_contract_type || 'INDEFINIDO',
                    weekly_contracted_hours: formData.rehire_weekly_hours || 44,
                    base_salary:            formData.rehire_base_salary || null,
                    notes:                  formData.rehire_notes || '',
                });
                const { showToast } = useToastStore.getState();
                if (showToast) showToast("Recontratación Registrada", `${formData.name} ha sido recontratado/a exitosamente.`, "success");
                onClose();
            } catch (err) {
                setValidationError(err?.message || "Error al procesar la recontratación.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (type === "vacationRecall") {
            if (!formData.recall_date || !formData.recall_shift_id || !formData.recall_reason?.trim()) {
                setValidationError("Fecha, turno y motivo son obligatorios.");
                return;
            }
            setIsSaving(true);
            try {
                const { vacationRecallEmployee } = useStaff.getState();
                const { user } = useAuth.getState ? useAuth.getState() : {};
                const result = await vacationRecallEmployee(formData.employee.id, {
                    date: formData.recall_date,
                    shift_id: formData.recall_shift_id,
                    reason: formData.recall_reason,
                    approved_by: user?.id || null,
                });
                const { showToast } = useToastStore.getState();
                showToast(
                    "Ingreso Autorizado",
                    `${formData.employee.name} — ${result.hoursWorked}h trabajadas. Total debidas: ${result.newOwed}h`,
                    "success"
                );
                onClose();
            } catch (err) {
                setValidationError(err?.message || "Error al registrar el ingreso.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (type === "planSchedule") {
            const { employee, weekStartDate, schedule } = formData;

            if (!employee?.id || !weekStartDate || !schedule) {
                setValidationError("Datos de planificación incompletos o corruptos.");
                return;
            }

            setIsSaving(true);
            try {
                const { saveWeeklyRoster, fetchEmployees } = useStaff.getState();
                await saveWeeklyRoster(employee.id, weekStartDate, schedule);
                if (fetchEmployees) await fetchEmployees();

                window.dispatchEvent(new CustomEvent('force-history-refresh'));

                const { showToast } = useToastStore.getState();
                if (showToast) showToast("Turnos Asignados", `Horario de ${employee.name} actualizado con éxito.`, "success");

                onClose();
            } catch (err) {
                setValidationError("Ocurrió un error al intentar guardar la programación.");
            } finally {
                setIsSaving(false);
            }
            return;
        }

        if (handleSubmit) {
            setIsSaving(true);
            try {
                await handleSubmit(e);
                window.dispatchEvent(new CustomEvent('force-history-refresh'));
            } catch (err) {
                setValidationError(err?.message || "Ocurrió un error inesperado.");
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

                <div
                    className="absolute inset-0 bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%] -z-10 pointer-events-none"
                    style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                />

                {!hidesHeader && (
                    <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-white/40 flex flex-col gap-4 relative z-10 shrink-0">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">

                                {(() => {
                                    if (type === 'planSchedule') return <div className={`${squircleClass} text-[#007AFF]`}><ClipboardList size={22} strokeWidth={2.5} /></div>;
                                    if (type === 'manageShifts') return <div className={`${squircleClass} text-[#007AFF]`}><BookOpen size={22} strokeWidth={2.5} /></div>;
                                    if (SHIELD_ICONS.has(type)) return <div className={`${squircleClass} text-emerald-600`}><ShieldCheck size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newBranch" || type === "editBranch" || type === "editBranchInmueble" || type === "viewBranchEmployees") return <div className={`${squircleClass} text-[#007AFF]`}><Building2 size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newEmployee" || type === "editEmployee") return <div className={`${squircleClass} text-[#007AFF]`}><UserPlus size={22} strokeWidth={2.5} /></div>;
                                    if (type === "rehireEmployee") return <div className={`${squircleClass} text-emerald-600`}><RefreshCw size={22} strokeWidth={2.5} /></div>;
                                    if (type === "vacationRecall") return <div className={`${squircleClass} text-amber-500`}><Palmtree size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchLegal") return <div className={`${squircleClass} text-emerald-600`}><Scale size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchServicios") return <div className={`${squircleClass} text-amber-500`}><Zap size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchHorarios") return <div className={`${squircleClass} text-[#007AFF]`}><Clock size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchLeadership") return <div className={`${squircleClass} text-amber-500`}><Star size={22} strokeWidth={2.5} /></div>;
                                    if (type === "addCustomDocument" || type === "editCustomDocument") return <div className={`${squircleClass} text-[#007AFF]`}><FilePlus size={22} strokeWidth={2.5} /></div>;
                                    if (type === "aiSchedulerPreview") return <div className={`${squircleClass} text-purple-600`}><Sparkles size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newPayrollPeriod") return <div className={`${squircleClass} text-[#007AFF]`}><DollarSign size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editPayrollEntry") return <div className={`${squircleClass} text-amber-500`}><Edit2 size={22} strokeWidth={2.5} /></div>;

                                    return <div className={`${squircleClass} text-slate-400`}><Settings size={22} strokeWidth={2.5} /></div>;
                                })()}

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

                        {(type === 'newEmployee' || type === 'editEmployee') && (
                            <div className="flex items-center justify-center">
                                {EMP_STEPS.map((step, idx) => {
                                    const isComplete = empStepCompletion[step.key];
                                    const isActive = empActiveTab === step.key;
                                    const StepIcon = step.icon;
                                    return (
                                        <React.Fragment key={step.key}>
                                            {idx > 0 && (
                                                <div className={`h-[2px] w-10 md:w-16 mx-1 rounded-full transition-all duration-500 ${empStepCompletion[EMP_STEPS[idx - 1].key] ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setEmpActiveTab(step.key)}
                                                className="flex flex-col items-center gap-1.5 group"
                                            >
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 border-2 shadow-sm ${isComplete ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-200' : isActive ? 'bg-[#007AFF] border-[#007AFF] text-white scale-110 shadow-[0_4px_14px_rgba(0,122,255,0.35)]' : 'bg-white border-slate-200 text-slate-400 group-hover:border-[#007AFF]/40 group-hover:text-[#007AFF]'}`}>
                                                    {isComplete ? <CheckCircle2 size={18} strokeWidth={2.5} /> : <StepIcon size={15} strokeWidth={2} />}
                                                </div>
                                                <span className={`text-[9px] font-black uppercase tracking-widest transition-colors whitespace-nowrap ${isActive ? 'text-[#007AFF]' : isComplete ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'}`}>
                                                    {step.label}
                                                </span>
                                            </button>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                <div
                    ref={scrollRef}
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
                                
                                {type === "newEmployee" && <FormEmpleadoNuevo formData={formData || {}} setFormData={setFormData} branches={branches} roles={roles} activeTab={empActiveTab} setActiveTab={setEmpActiveTab} />}
                                {type === "editEmployee" && <FormEmpleadoNuevo formData={formData || {}} setFormData={setFormData} branches={branches} roles={roles} isEditMode={true} activeTab={empActiveTab} setActiveTab={setEmpActiveTab} />}
                                
                                {(type === "newBranch" || type === "editBranch") && <FormSucursal formData={formData} setFormData={setFormData} section="general" />}
                                {type === "editBranchHorarios" && <FormSucursal formData={formData} setFormData={setFormData} section="horarios" />}
                                {type === "editBranchLegal" && <FormSucursal formData={formData} setFormData={setFormData} section="legal" />}
                                {type === "editBranchInmueble" && <FormSucursal formData={formData} setFormData={setFormData} section="inmueble" />}
                                {type === "editBranchServicios" && <FormSucursal formData={formData} setFormData={setFormData} section="servicios" />}

                                {type === "newEvent" && <FormNovedad formData={formData} setFormData={setFormData} branches={branches} activeEmployee={activeEmployee} onValidationChange={setIsFormValid} />}
                                
                                {type === "uploadDocument" && <FormUploadOnly formData={formData} setFormData={setFormData} />}
                                {type === "planSchedule" && <FormPlanificador formData={formData} setFormData={setFormData} shifts={shifts} saveWeeklyRoster={saveWeeklyRoster} onClose={onClose} />}
                                {type === "manageShifts" && <FormTurnos branches={branches} />}
                                {type === "viewRoleEmployees" && <FormRoleEmployees formData={formData} />}
                                {type === "viewAnnouncementReaders" && <FormAnnouncements data={formData} onClose={onClose} />}
                                {type === "editSrsPermit" && <FormSrsPermit formData={formData} setFormData={setFormData} />}
                                {type === "editPharmacyRegent" && <FormPharmacyRegent formData={formData} setFormData={setFormData} onClose={onClose} />}
                                {type === "editPharmacovigilance" && <FormPharmacovigilance formData={formData} setFormData={setFormData} onClose={onClose} />}
                                {type === "editNursingRegents" && <FormNursingRegents formData={formData} setFormData={setFormData} />}

                                {type === "viewBranchEmployees" && <FormBranchEmployees formData={formData} setView={setView} setActiveEmployee={setGlobalActiveEmployee} onClose={onClose} />}
                                {type === "viewWfmAnalytics" && <FormWfmAnalytics branches={branches} />}
                                {type === "viewDocument" && <FormDocumentViewer formData={formData} onClose={onClose} />}
                                {type === "manageService" && <FormServicePayment formData={formData} setFormData={setFormData} />}
                                {type === "registerPayment" && <FormRegisterPayment formData={formData} setFormData={setFormData} />}
                                {type === "editBranchLeadership" && <FormLeadership formData={formData} setFormData={setFormData} />}
                                {type === "aiSchedulerPreview" && <FormAiSchedulerPreview formData={formData} onClose={onClose} />}
                                {(type === "addCustomDocument" || type === "editCustomDocument") && <FormAddCustomDocument formData={formData} setFormData={setFormData} type={type} />}

                                {type === "setEmployeePassword" && <FormSetPassword formData={formData} onClose={onClose} />}
                                {type === "changeOwnPassword" && <FormChangeOwnPassword onClose={onClose} />}
                                {type === "editContact" && <FormEditContact formData={formData} onClose={onClose} />}
                                {type === "rehireEmployee" && <FormRehireEmployee formData={formData} setFormData={setFormData} branches={branches} roles={roles} />}
                                {type === "vacationRecall" && <FormVacationRecall formData={formData} setFormData={setFormData} />}
                                {type === "newPayrollPeriod" && <FormNewPayrollPeriod formData={formData} setFormData={setFormData} />}
                                {type === "editPayrollEntry" && <FormEditPayrollEntry formData={formData} setFormData={setFormData} />}
                            </Suspense>
                        </form>
                    </div>
                </div>

                {!hidesFooter && (() => {
                    const isEmpForm = type === 'newEmployee' || type === 'editEmployee';
                    const EMP_STEP_KEYS = ['personal', 'laboral', 'nomina'];
                    const EMP_STEP_LABELS = { personal: 'Personal', laboral: 'Contrato', nomina: 'Nómina' };
                    const empIdx = EMP_STEP_KEYS.indexOf(empActiveTab);
                    const prevStep = isEmpForm && empIdx > 0 ? EMP_STEP_KEYS[empIdx - 1] : null;
                    const nextStep = isEmpForm && empIdx < EMP_STEP_KEYS.length - 1 ? EMP_STEP_KEYS[empIdx + 1] : null;
                    const isLastStep = isEmpForm && empIdx === EMP_STEP_KEYS.length - 1;

                    if (isEmpForm) {
                        return (
                            <div className="flex-none px-6 md:px-10 py-5 bg-transparent border-t border-white/40 flex justify-between items-center relative z-10 shrink-0">
                                {/* LEFT: Anterior */}
                                {prevStep ? (
                                    <button type="button" onClick={() => setEmpActiveTab(prevStep)} disabled={isSaving}
                                        className="flex items-center gap-2 px-5 h-11 rounded-full bg-white/50 border border-white/80 text-slate-500 font-bold text-[11px] uppercase tracking-widest hover:bg-white hover:text-slate-800 transition-all disabled:opacity-50 active:scale-95">
                                        <ChevronLeft size={15} strokeWidth={2.5} />
                                        {EMP_STEP_LABELS[prevStep]}
                                    </button>
                                ) : <div />}

                                {/* CENTER: Cancelar */}
                                <button type="button" onClick={onClose} disabled={isSaving}
                                    className="px-5 h-11 rounded-full bg-white/50 border border-white/80 text-slate-400 font-bold text-[11px] uppercase tracking-widest hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all disabled:opacity-50 active:scale-95">
                                    Cancelar
                                </button>

                                {/* RIGHT: Siguiente o Guardar */}
                                {nextStep ? (
                                    <button type="button" onClick={() => setEmpActiveTab(nextStep)} disabled={isSaving}
                                        className="flex items-center gap-2 px-6 h-11 rounded-full bg-[#007AFF] text-white font-black text-[11px] uppercase tracking-widest shadow-[0_6px_18px_rgba(0,122,255,0.3)] hover:bg-[#0066CC] hover:shadow-[0_8px_22px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 active:scale-95">
                                        {EMP_STEP_LABELS[nextStep]}
                                        <ChevronRight size={15} strokeWidth={2.5} />
                                    </button>
                                ) : (
                                    <button type="submit" form="unified-modal-form" disabled={isSaving || !isFormValid}
                                        className={`flex items-center gap-2 px-6 h-11 font-black text-[11px] uppercase tracking-[0.2em] rounded-full transition-all duration-300 ${!isFormValid ? 'bg-slate-300 text-white cursor-not-allowed' : 'bg-emerald-500 text-white shadow-[0_6px_18px_rgba(16,185,129,0.35)] hover:bg-emerald-600 hover:shadow-[0_8px_22px_rgba(16,185,129,0.45)] hover:-translate-y-0.5 active:scale-95'}`}>
                                        {isSaving ? <><Loader2 size={15} className="animate-spin" /> Guardando</> : <><Save size={15} strokeWidth={3} /> Guardar</>}
                                    </button>
                                )}
                            </div>
                        );
                    }

                    return (
                        <div className="flex-none px-6 md:px-10 py-5 bg-transparent border-t border-white/40 flex justify-between items-center relative z-10 shrink-0">
                            <button type="button" onClick={onClose} disabled={isSaving} className="px-6 py-3 h-12 rounded-full bg-white/50 border border-white/80 text-slate-500 font-bold text-[11px] uppercase tracking-widest hover:bg-white hover:text-slate-800 transition-colors disabled:opacity-50">
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                form="unified-modal-form"
                                disabled={isSaving || !isFormValid}
                                className={`px-8 py-3 h-12 font-black text-[11px] uppercase tracking-[0.2em] rounded-full flex items-center gap-2 transition-all duration-300 ${!isFormValid ? 'bg-slate-300 text-white shadow-none cursor-not-allowed' : 'bg-[#007AFF] text-white shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:bg-[#0066CC] hover:shadow-[0_12px_25px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95'}`}
                            >
                                {isSaving ? <><Loader2 size={16} className="animate-spin" /> Procesando</> : <><Save size={16} strokeWidth={3} /> Guardar Cambios</>}
                            </button>
                        </div>
                    );
                })()}
            </div>
        </ModalShell>
    );
};

export default UnifiedModal;