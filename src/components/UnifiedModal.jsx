import React, { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Button from './common/Button';
import {
    X, ClipboardList, Building2, BookOpen, Save, AlertCircle, ShieldCheck, Scale, Zap, Clock, Star, FilePlus, Settings, Sparkles, UserPlus,
    User, Briefcase, CreditCard, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Palmtree, DollarSign, Pencil, Truck, Contact
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import LiquidModal from "./common/LiquidModal";
import { useToastStore } from '../store/toastStore';
import { LoadingState } from './common/StateViews';
import { supabase } from '../supabaseClient';
import useMontadoParaSalida from '../hooks/useMontadoParaSalida';
import { mensajeAmigable, mensajeConPrefijo } from '../utils/errorMessages';
import { shortEmployeeName } from '../utils/nameUtils';
import { buscarCargo } from '../utils/roles';
import { CATEGORIAS_DOCUMENTO, categoriaDeDocumento, SIN_ASIGNAR } from '../data/constants';
import { clearDraft } from '../utils/draftUtils';
import useBorrador from '../hooks/useBorrador';
import AvisoDeBorrador from './common/AvisoDeBorrador';
import { SENSITIVE_FIELDS } from '../store/utils';

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
const FormPurchaseDteViewer = React.lazy(() => import('./forms/FormPurchaseDteViewer'));
const FormSalesDteViewer = React.lazy(() => import('./forms/FormSalesDteViewer'));
const FormServicePayment = React.lazy(() => import('./forms/FormServicePayment'));
const FormRegisterPayment = React.lazy(() => import('./forms/FormRegisterPayment'));
const FormLeadership = React.lazy(() => import('./forms/FormLeadership'));
const FormAddCustomDocument = React.lazy(() => import('./forms/FormAddCustomDocument'));
const FormWfmAnalytics = React.lazy(() => import('./forms/FormWfmAnalytics'));
const FormAiSchedulerPreview = React.lazy(() => import('./forms/FormAiSchedulerPreview'));
const FormSetPassword = React.lazy(() => import('./forms/FormSetPassword'));
const FormChangeOwnPassword = React.lazy(() => import('./forms/FormChangeOwnPassword'));
const FormEditContact = React.lazy(() => import('./forms/FormEditContact'));
const FormProveedorDetail = React.lazy(() => import('./forms/FormProveedorDetail'));
const FormClienteDetail = React.lazy(() => import('./forms/FormClienteDetail'));
const FormNewPayrollPeriod = React.lazy(() => import('./forms/FormNewPayrollPeriod'));
const FormEditPayrollEntry = React.lazy(() => import('./forms/FormEditPayrollEntry'));

const HIDES_HEADER = new Set(["viewRoleEmployees", "viewAnnouncementReaders", "viewDocument", "viewPurchaseDte", "viewSalesDte"]);
const HIDES_FOOTER = new Set(["viewWfmAnalytics", "aiSchedulerPreview", "viewRoleEmployees", "viewAnnouncementReaders", "viewBranchEmployees", "viewDocument", "viewAuditDetail", "manageKiosks", "setEmployeePassword", "changeOwnPassword", "editContact", "viewPurchaseDte", "viewSalesDte", "editProveedor", "editCliente"]);
const BRANCH_ACTIONS = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);
const SHIELD_ICONS = new Set(["editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService"]);

const BRANCH_SUBTITLES = new Set(["newBranch", "editBranch", "editBranchHorarios", "editBranchLegal", "editBranchInmueble", "editBranchServicios", "editSrsPermit", "editPharmacyRegent", "editPharmacovigilance", "editNursingRegents", "manageService", "editBranchLeadership", "addCustomDocument", "editCustomDocument"]);

// Únicos campos que BLOQUEAN el guardado del empleado (a diferencia de los
// "pendientes" — DUI/documento alterno en imagen, ISSS/AFP — que se pueden
// completar después, ver getPendingItems en StaffManagementView). Misma
// función para validar en el submit (handleLocalSubmit) y para deshabilitar
// el botón Guardar antes de intentar guardar, para que el estado visual del
// botón refleje si falta algo obligatorio.
const getEmployeeValidationError = (formData, type) => {
    if (type === 'newEmployee') {
        if (!formData?.first_names?.trim() || !formData?.last_names?.trim() || !formData?.code?.trim() || !formData?.branch_id || !formData?.role_id) {
            return "Faltan campos obligatorios: Nombres, Apellidos, Código, Sucursal Base o Cargo.";
        }
        // Art. 23.2 Código de Trabajo: DUI obligatorio en el contrato — salvo
        // menores de edad (no se tramita antes de los 18 en El Salvador), a
        // quienes se les acepta un documento alterno (partida de nacimiento,
        // carné de minoridad) en su lugar.
        let isMinor = false;
        if (formData?.birth_date) {
            const bd = new Date(`${formData.birth_date}T00:00:00`);
            if (!isNaN(bd.getTime())) {
                const today = new Date();
                let age = today.getFullYear() - bd.getFullYear();
                const m = today.getMonth() - bd.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
                isMinor = age < 18;
            }
        }
        if (isMinor ? !formData?.alt_identity_document?.trim() : !formData?.dui?.trim()) {
            return isMinor
                ? "Falta el Documento de Identidad Alternativo (el empleado es menor de edad)."
                : "El DUI es obligatorio (Art. 23.2 Código de Trabajo).";
        }
        if (formData?.contract_type === 'TEMPORAL' && (!formData?.contract_temporal_legal_basis || !formData?.contract_temporal_reason?.trim())) {
            return "Falta la Base Legal y/o el Motivo Concreto del contrato Temporal (Art. 25).";
        }
        return null;
    }
    if (type === 'editEmployee') {
        if (!formData?.first_names?.trim() || !formData?.last_names?.trim()) {
            return "Los Nombres y Apellidos son obligatorios.";
        }
        if (!formData?.code?.trim()) {
            return "El Código es obligatorio — es la credencial del carné para iniciar sesión.";
        }
        return null;
    }
    return null;
};

const UnifiedModal = ({ isOpen, onClose, type, formData, setFormData, handleSubmit, activeEmployee, setView, setActiveEmployee: setGlobalActiveEmployee }) => {

    /* ── Los dos ALTAS de este modal se guardan solas ────────────────────────
     *
     * `formData` vive en `App.jsx` y lo comparten los doce tipos de este modal,
     * así que el borrador se enciende ACÁ, que es donde se sabe cuál es el tipo.
     *
     * Sólo dos lo llevan, y los dos son un ALTA:
     *   · `newEvent` — una novedad del empleado (traslado, ascenso, incapacidad,
     *     permiso, salida…). NO cuando se está EDITANDO una ya registrada
     *     (`_editingEventId`): ahí la fila de la base es la verdad.
     *   · `rehireEmployee` — la recontratación.
     *
     * **La clave lleva el id de la persona.** Los dos modales abren con la ficha
     * de alguien: una clave única repoblaría la novedad de Ana sobre el
     * expediente de Luis, y eso escribe un evento en el legajo equivocado.
     *
     * Lo que NO se guarda: el archivo adjunto (`file`) —un `File` no se
     * serializa— y los campos de `SENSITIVE_FIELDS`, porque una novedad de
     * salario lleva el monto y `localStorage` sobrevive al cierre de sesión.
     * Es la misma regla que el alta de empleado. */
    const idSujeto = formData?.employeeId ?? formData?.id ?? null;
    /* La ficha de sucursal es larga y se EDITA, así que va por el otro camino:
     * guarda igual, pero al reabrir OFRECE recuperar en vez de reponer sola
     * (`AvisoDeBorrador`). El razonamiento de arriba —«la fila de la base es la
     * verdad»— sigue siendo correcto y por eso no se toca: reponer sobre un
     * registro vivo puede escribir datos viejos encima de lo que otra persona
     * cambió en el medio. Lo que no hacía falta era, además, PERDER lo escrito
     * cuando la sesión se cierra sola a los 5 minutos.
     *
     * Las seis pestañas comparten un `formData` que vive en `App.jsx`, así que
     * la clave es una sola por sucursal y no una por pestaña: quien empezó por
     * «Inmueble» y siguió por «Legal» escribió UN formulario. */
    const claveBorrador =
        (type === 'newEvent' && !formData?._editingEventId && idSujeto) ? `novedad_${idSujeto}`
      : (type === 'rehireEmployee' && idSujeto)                        ? `recontratacion_${idSujeto}`
      : (BRANCH_ACTIONS.has(type) && idSujeto)                         ? `sucursal_${idSujeto}`
      : (type === 'editPayrollEntry' && idSujeto)                      ? `planilla_${idSujeto}`
      : null;

    // Editar OFRECE; dar de alta REPONE. Es la única diferencia entre los dos
    // caminos, y es la que decide si se puede pisar algo.
    //
    // La entrada de planilla va por el mismo camino que la sucursal, y con más
    // motivo: es un renglón de dinero que alguien ya calculó, así que reponerlo
    // solo con lo que quedó a medias sería escribir un monto viejo sobre uno
    // corregido.
    const borradorSeOfrece = BRANCH_ACTIONS.has(type) || type === 'editPayrollEntry';

    const borradorSeguro = useMemo(() => {
        if (!claveBorrador || !formData) return null;
        const limpio = { ...formData };
        delete limpio.file;
        delete limpio.photoPreview;
        for (const campo of SENSITIVE_FIELDS) delete limpio[campo];
        return limpio;
    }, [claveBorrador, formData]);

    const { recuperado: borrador, cuando: borradorCuando, descartar: descartarBorrador } =
        useBorrador(claveBorrador, borradorSeguro, { activo: isOpen && !!claveBorrador });
    const [ofrecido, setOfrecido] = useState(null);

    const repuesto = useRef(null);
    useEffect(() => {
        if (!isOpen || !claveBorrador) { repuesto.current = null; return; }
        if (repuesto.current === claveBorrador || !borrador) return;
        repuesto.current = claveBorrador;
        // El que se OFRECE no se aplica acá: espera a que alguien lo acepte.
        if (borradorSeOfrece) return;
        // Lo abierto MANDA sobre lo guardado: quien abrió el modal eligió a la
        // persona y, en una novedad, a veces también el tipo. El borrador sólo
        // rellena lo que la apertura no trajo.
        setFormData(prev => ({ ...borrador, ...prev }));
    }, [isOpen, claveBorrador, borrador, borradorSeOfrece, setFormData]);

    // Al cerrar el modal —o al abrir el de OTRA sucursal— el ofrecimiento
    // vuelve a estar en pie: si no, tomar una decisión en una ficha la daría por
    // tomada en la siguiente.
    useEffect(() => { setOfrecido(null); }, [claveBorrador, isOpen]);

    /* Aceptar el ofrecimiento. Se aplica con la MISMA regla que la reposición
     * automática —lo abierto manda sobre lo guardado— para que las dos hagan lo
     * mismo con los campos que la apertura ya trajo (el id de la sucursal, por
     * ejemplo, que no puede venir de un borrador). */
    const recuperarBorrador = useCallback(() => {
        if (borrador) setFormData(prev => ({ ...borrador, ...prev }));
        setOfrecido('recuperado');
    }, [borrador, setFormData]);

    const descartarOfrecimiento = useCallback(() => {
        descartarBorrador();
        setOfrecido('descartado');
    }, [descartarBorrador]);

    // Se ofrece una vez por apertura, y sólo si hay algo que ofrecer.
    const hayQueOfrecer = borradorSeOfrece && !!borrador && !ofrecido;
    // Quién está dando de alta: su sucursal decide por qué ticketera sale el
    // carné de papel (se entrega en mano, así que sale donde está esa persona).
    const { user: quienEmite } = useAuth();
    const montadoParaSalida = useMontadoParaSalida(isOpen);

    const { branches, roles, shifts, saveWeeklyRoster, updateBranch, addBranch } = useStaff();

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
        { key: 'personal',    label: 'Personal',    icon: User },
        { key: 'laboral',     label: 'Contrato',    icon: Briefcase },
        { key: 'nomina',      label: 'Nómina',      icon: CreditCard },
        { key: 'documentos',  label: 'Documentos',  icon: FilePlus },
    ];
    const empStepCompletion = useMemo(() => ({
        personal: !!(formData?.first_names?.trim() && formData?.last_names?.trim()),
        laboral:  !!(formData?.branch_id && formData?.role_id),
        nomina:   !!(formData?.isss_number || formData?.afp_number || formData?.bank_name),
        documentos: !!(formData?.employee_documents?.length > 0),
    }), [formData?.first_names, formData?.last_names, formData?.branch_id, formData?.role_id, formData?.isss_number, formData?.afp_number, formData?.bank_name, formData?.employee_documents]);

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
            case "viewPurchaseDte": return "max-w-5xl";
            case "viewSalesDte": return "max-w-5xl";
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
            case "editProveedor": return "max-w-3xl";
            case "editCliente": return "max-w-3xl";
            default: return "max-w-lg";
        }
    };

    const getModalTitle = () => {
        switch (type) {
            case "viewAuditDetail": return "Detalle de Auditoría";
            case "manageKiosks": return "Dispositivos Kiosco";
            case "planSchedule": return "Planificación Semanal";
            case "manageShifts": return "Catálogo de turnos";
            case "newEmployee": return "Nuevo empleado";
            case "editEmployee": return "Actualizar Información";
            case "rehireEmployee": return "Recontratación";
            case "vacationRecall": return "Ingreso en Vacaciones";
            case "newBranch": return "Nueva sucursal";
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
            case "editProveedor": return formData?.nombre || "Detalle de Proveedor";
            case "editCliente": return formData?.nombre || "Ficha del Cliente";
            default: return "Gestión Administrativa";
        }
    };

    const getModalSubtitle = () => {
        if (type === "manageKiosks") return formData?.name;
        if (type === "planSchedule") return `${shortEmployeeName(formData?.employee)} • ${formData?.employee?.role}`;
        if (type === "newEmployee") return null;
        if (type === "editEmployee") return formData?.name?.toUpperCase() || "EMPLEADO";
        if (type === "rehireEmployee") return formData?.name?.toUpperCase() || "EMPLEADO";
        if (type === "vacationRecall") return shortEmployeeName(formData?.employee).toUpperCase();
        if (type === "viewBranchEmployees") return `SUCURSAL: ${formData?.name || formData?.branchName || 'DESCONOCIDA'}`;
        if (type === "editBranchLeadership") return `SUCURSAL: ${formData?.branch?.name || 'DESCONOCIDA'}`;
        if (type === "setEmployeePassword") return formData?.name?.toUpperCase() || "EMPLEADO";
        if (type === "changeOwnPassword") return "TU CUENTA";
        if (type === "editContact") return formData?.name?.toUpperCase() || "TU PERFIL";
        if (type === "newPayrollPeriod") return "PERÍODO DE NÓMINA";
        if (type === "editPayrollEntry") return shortEmployeeName(formData?._entry?.employee).toUpperCase();
        if (type === "editProveedor") return formData?.nit || formData?.dui || 'PROVEEDOR';
        if (type === "editCliente") return "FICHA FISCAL";
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

            const empError = getEmployeeValidationError(formData, type);
            if (empError) {
                setValidationError(empError);
                return;
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
                if (finalData.suplente_id === "") finalData.suplente_id = null;
                if (finalData.birth_date === "") finalData.birth_date = null;
                if (finalData.contract_end_date === "") finalData.contract_end_date = null;
                if (finalData.base_salary === "") finalData.base_salary = null;
                if (finalData.weekly_contracted_hours === "") finalData.weekly_contracted_hours = null;

                const { showToast } = useToastStore.getState();
                if (type === "editEmployee" || (formData.id)) {
                    await updateEmployee(formData.id, finalData);
                    if (showToast) showToast("Personal Actualizado", "La ficha del empleado se guardó exitosamente.", "success");
                } else {
                    const created = await addEmployee(finalData);
                    // La temporal solo existe en esta respuesta — mostrarla al admin
                    // (antes se descartaba y el primer login era imposible sin reset).
                    // El aviso dice cuál de las dos cosas pasó, y lo dice
                    // también cuando además hubo contraseña temporal: «Personal
                    // Registrado» después de enlazar sonaría a que se creó una
                    // segunda ficha, que es justo la duda que enlazar resuelve.
                    const enlazado = created?.enlazadoCon
                        ? `Quedó sobre la ficha de ${created.enlazadoCon}, que conserva su historial.`
                        : null;
                    if (created?.tempPassword) {
                        try { await navigator.clipboard.writeText(created.tempPassword); } catch { /* sin permiso de clipboard */ }
                        if (showToast) showToast(
                            enlazado ? "Expediente Enlazado — Contraseña Temporal" : "Empleado Creado — Contraseña Temporal",
                            `${enlazado ? enlazado + ' ' : ''}Usuario: ${created.username} · Contraseña: ${created.tempPassword} (copiada al portapapeles). Deberá cambiarla en su primer ingreso.`,
                            "success",
                            20000
                        );
                    } else if (showToast) {
                        showToast(
                            enlazado ? "Expediente Enlazado" : "Personal Registrado",
                            enlazado || "La ficha del empleado se guardó exitosamente.",
                            "success",
                            enlazado ? 12000 : undefined
                        );
                    }

                    // Marcado como que todavía no tiene carné: se le imprime uno
                    // de papel en el acto. Es el pedido tal cual —«desde la
                    // creación de un nuevo personal marcado con que aún no tiene
                    // carné»—, y va DESPUÉS del alta porque el carné cuelga de un
                    // empleado que ya existe. Si no sale papel, el aviso lo dice y
                    // el botón del perfil lo reintenta: la ficha ya está guardada
                    // y no se pierde nada.
                    if (created?.id && finalData.carne_pendiente) {
                        const { entregarCarneDePapel } = await import('../utils/entregarCarneDePapel');
                        await entregarCarneDePapel({
                            employeeId: created.id,
                            nombre: `${finalData.first_names ?? ''} ${finalData.last_names ?? ''}`.trim(),
                            salaId: quienEmite?.branchId ?? null,
                            emitidoPor: quienEmite?.name || '',
                            motivo: 'Alta de personal',
                        });
                    }
                }

                // El borrador del alta se limpia por el canónico: escrito a
                // mano quedaría apuntando a una clave que ya nadie escribe, y
                // el borrador sobreviviría al alta ofreciéndose de nuevo.
                clearDraft('alta_empleado');
                onClose();
            } catch (err) {
                console.error("Error guardando empleado:", err);
                if (err?.message?.startsWith('HEADCOUNT_LIMIT:')) {
                    const { showToast } = useToastStore.getState();
                    showToast('Límite de Organigrama', mensajeConPrefijo(err, 'HEADCOUNT_LIMIT:'), 'error');
                } else {
                    // `err.message` pelado acá mostraba el error de Postgres dentro
                    // del formulario, donde el guardia del toast no llega.
                    setValidationError(mensajeAmigable(err, "No se pudo guardar la ficha. Verifica que no falten datos."));
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

                        if (uploadError) throw new Error(uploadError.message || "No se pudo subir el archivo.");

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
                    // Se guarda la CLAVE, siempre resuelta: si algún día llega
                    // un rótulo viejo por otra vía, entra normalizado y no como
                    // una séptima categoría que ninguna sección pinta.
                    category: categoriaDeDocumento(docData.category),
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
                        // La bitácora la lee una persona: va el rótulo, no la
                        // clave con la que se guarda.
                        new_value: CATEGORIAS_DOCUMENTO[documentObject.category].label
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

                // La ficha quedó guardada, así que el borrador ya no sirve.
                // DESPUÉS del `await` y dentro del `try`, igual que en el
                // guardado de una novedad: si el guardado falla, lo escrito
                // tiene que seguir ahí — que es justamente para lo que existe.
                descartarBorrador();
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
                setValidationError("Debes seleccionar a un empleado de la lista.");
                return;
            }
            if (formData.isPermanent === false && !formData.interimEndDate) {
                setValidationError("Para un interinato, la fecha de finalización es obligatoria.");
                return;
            }

            setIsSaving(true);
            try {
                const { updateEmployee, employees, roles } = useStaff.getState();
                const selectedEmp = employees.find(e => e.id === formData.selectedEmpId);

                const actualBranchId = formData.branch?.id || formData.branchId || formData.id;
                const actualBranchName = formData.branch?.name || formData.name || 'Sucursal';

                // ── El cargo se resuelve contra la tabla, y si no resuelve NO se
                // escribe ────────────────────────────────────────────────────
                // Acá había dos `roles.find(r => r.name === …)` por igualdad
                // exacta de cadena contra listas escritas a mano, y el `? :` de
                // abajo convertía «no encontré el cargo» en `role_id: null`.
                // Medido el 2026-08-12: la tabla dice «Regente de Enfermeria» y
                // el formulario ofrecía «Regente de Enfermería», así que relevar
                // a un regente de enfermería dejaba a la persona sin cargo, sin
                // error y sin log. Un fallo que no falla es el que sobrevive.
                const targetRoleObj = buscarCargo(roles, formData.targetRole);
                if (formData.targetRole && !targetRoleObj) {
                    setValidationError(`El cargo «${formData.targetRole}» ya no existe en el catálogo. Actualiza la página e intenta de nuevo.`);
                    setIsSaving(false);
                    return;
                }
                const targetRoleId = targetRoleObj ? targetRoleObj.id : null;

                const { updateEmployee: _ue, appendAuditLog } = useStaff.getState();

                if (formData.currentAssignee && formData.currentAssignee !== formData.selectedEmpId) {
                    if (formData.outgoingAction === 'REASSIGN') {
                        const outRoleObj = buscarCargo(roles, formData.outgoingRole);
                        if (!outRoleObj) {
                            setValidationError(`El cargo de salida «${formData.outgoingRole || '—'}» no existe en el catálogo. Elige otro para continuar.`);
                            setIsSaving(false);
                            return;
                        }

                        await updateEmployee(formData.currentAssignee, {
                            branchId: formData.outgoingBranch,
                            role_id: outRoleObj.id,
                        });

                        await appendAuditLog('EMPLEADO_RELEVADO', formData.currentAssignee, {
                            type: 'REASSIGNMENT',
                            previous_branch_id: actualBranchId,
                            previous_branch_name: actualBranchName,
                            target_branch_id: formData.outgoingBranch,
                            previous_role: formData.targetRole,
                            // Igual que arriba: lo que queda en la bitácora es
                            // el nombre que de verdad se guardó.
                            new_role: outRoleObj.name,
                            note: `Relevado de jefatura en ${actualBranchName}`,
                        });

                    } else {
                        // Sin `role:` en el payload. `employees` NO tiene esa
                        // columna —`updateEmployee` la borra antes de escribir y
                        // el store la deriva de `role_id` después— así que
                        // mandarla sólo hacía creer que se guardaba un rótulo.
                        await updateEmployee(formData.currentAssignee, {
                            branchId: null,
                            role_id: null,
                        });

                        await appendAuditLog('EMPLEADO_DESVINCULADO_SUCURSAL', formData.currentAssignee, {
                            type: 'UNASSIGNED',
                            previous_branch_id: actualBranchId,
                            previous_branch_name: actualBranchName,
                            previous_role: formData.targetRole,
                            new_role: SIN_ASIGNAR,
                            note: `Removido de la sucursal ${actualBranchName} a la bolsa de trabajo flotante.`,
                        });
                    }
                }

                await updateEmployee(formData.selectedEmpId, {
                    branchId: actualBranchId,
                    role_id: targetRoleId,
                });

                await appendAuditLog(formData.moveType || 'EMPLEADO_ASIGNADO', formData.selectedEmpId, {
                    type: formData.moveType || 'PROMOTION',
                    previous_branch_id: selectedEmp?.branchId || null,
                    target_branch_id: actualBranchId,
                    target_branch_name: actualBranchName,
                    previous_role: selectedEmp?.role || null,
                    // El nombre de la FILA, no el texto del formulario: lo que
                    // queda en la bitácora es el cargo que de verdad se guardó.
                    new_role: targetRoleObj?.name ?? SIN_ASIGNAR,
                    note: formData.notes || 'Asignación realizada desde el Panel de Sucursales',
                    isInterim: formData.isPermanent === false,
                    interimEndDate: formData.interimEndDate || null,
                });

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

                if (_paymentData.receiptFile) {
                    const path = `expenses/${id}/${_currentService}/${_paymentData.billing_month}_${Date.now()}`;
                    if (uploadDocument) await uploadDocument(path, _paymentData.receiptFile);
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
            } catch {
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
                descartarBorrador();   // la recontratación existe: el borrador ya no sirve
                onClose();
            } catch (err) {
                setValidationError(mensajeAmigable(err, "Error al procesar la recontratación."));
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
                const user = JSON.parse(localStorage.getItem('sb_user') || 'null');
                const result = await vacationRecallEmployee(formData.employee.id, {
                    date: formData.recall_date,
                    shift_id: formData.recall_shift_id,
                    reason: formData.recall_reason,
                    approved_by: user?.id || null,
                });
                const { showToast } = useToastStore.getState();
                showToast(
                    "Ingreso Autorizado",
                    `${shortEmployeeName(formData.employee)} — ${result.hoursWorked}h trabajadas. Total debidas: ${result.newOwed}h`,
                    "success"
                );
                onClose();
            } catch (err) {
                setValidationError(mensajeAmigable(err, "Error al registrar el ingreso."));
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
                if (showToast) showToast("Turnos Asignados", `Horario de ${shortEmployeeName(employee)} actualizado con éxito.`, "success");

                onClose();
            } catch {
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
                // El evento quedó registrado. Se descarta DESPUÉS del `await` y
                // no antes: si el guardado falla, lo escrito tiene que seguir ahí.
                descartarBorrador();
                window.dispatchEvent(new CustomEvent('force-history-refresh'));
            } catch (err) {
                const msg = (err?.message || "Ocurrió un error inesperado.")
                    .replace(/^(OVERLAP_ERROR|HEADCOUNT_LIMIT):\s*/, '');
                setValidationError(msg);
            } finally {
                setIsSaving(false);
            }
        }
    };

    // El gate mira el montaje-para-SALIDA y no `isOpen` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

    const FallbackLoader = () => <LoadingState variant="content" label="Cargando Módulo…" />;

    // Tipos que necesitan que su contenido llene el modal (visor de PDF/documento con
    // scroll interno propio) en vez de altura natural por contenido. `min-h-full`/`h-full`
    // (porcentaje) no resuelve de forma confiable como "definite" a través de este árbol
    // (scrollRef es overflow-y-auto) — confirmado con Playwright: el contenido colapsaba a
    // ~430px de los ~850px disponibles. Encadenar flex-1/min-h-0 en cada nivel es robusto.
    const fillHeight = type === 'viewDocument' || type === 'viewPurchaseDte' || type === 'viewSalesDte';
    // Sin `max-h` propio: el tope lo pone `LiquidModal` (2026-08-15). `h-[85vh]`
    // se queda porque no es un tope sino lo contrario —los visores de documento
    // tienen que OCUPAR el alto, si no el PDF colapsa—, y convive con el tope
    // del canónico sin pelearse: 85vh es menor que su 88dvh.
    const getModalHeightClass = () => fillHeight ? 'h-[85vh]' : 'h-fit';
    const hidesHeader = HIDES_HEADER.has(type);
    const hidesFooter = HIDES_FOOTER.has(type);
    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border border-border-card shadow-sm bg-surface-card-hover";

    return (
        <LiquidModal open={isOpen} onClose={onClose} maxWidth={getModalSize()} zClass="z-modal" className={getModalHeightClass()} ariaLabel={getModalTitle()}>

                {!hidesHeader && (
                    <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-divider flex flex-col gap-4 relative z-base shrink-0">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">

                                {(() => {
                                    if (type === 'planSchedule') return <div className={`${squircleClass} text-brand-text`}><ClipboardList size={22} strokeWidth={2.5} /></div>;
                                    if (type === 'manageShifts') return <div className={`${squircleClass} text-brand-text`}><BookOpen size={22} strokeWidth={2.5} /></div>;
                                    if (SHIELD_ICONS.has(type)) return <div className={`${squircleClass} text-success`}><ShieldCheck size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newBranch" || type === "editBranch" || type === "editBranchInmueble" || type === "viewBranchEmployees") return <div className={`${squircleClass} text-brand-text`}><Building2 size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newEmployee" || type === "editEmployee") return <div className={`${squircleClass} text-brand-text`}><UserPlus size={22} strokeWidth={2.5} /></div>;
                                    if (type === "rehireEmployee") return <div className={`${squircleClass} text-success`}><RefreshCw size={22} strokeWidth={2.5} /></div>;
                                    if (type === "vacationRecall") return <div className={`${squircleClass} text-warning`}><Palmtree size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchLegal") return <div className={`${squircleClass} text-success`}><Scale size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchServicios") return <div className={`${squircleClass} text-warning`}><Zap size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchHorarios") return <div className={`${squircleClass} text-brand-text`}><Clock size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editBranchLeadership") return <div className={`${squircleClass} text-warning`}><Star size={22} strokeWidth={2.5} /></div>;
                                    if (type === "addCustomDocument" || type === "editCustomDocument") return <div className={`${squircleClass} text-brand-text`}><FilePlus size={22} strokeWidth={2.5} /></div>;
                                    if (type === "aiSchedulerPreview") return <div className={`${squircleClass} text-chart-3-text`}><Sparkles size={22} strokeWidth={2.5} /></div>;
                                    if (type === "newPayrollPeriod") return <div className={`${squircleClass} text-brand-text`}><DollarSign size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editPayrollEntry") return <div className={`${squircleClass} text-warning`}><Pencil size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editProveedor") return <div className={`${squircleClass} text-brand-text`}><Truck size={22} strokeWidth={2.5} /></div>;
                                    if (type === "editCliente") return <div className={`${squircleClass} text-brand-text`}><Contact size={22} strokeWidth={2.5} /></div>;

                                    return <div className={`${squircleClass} text-content-3`}><Settings size={22} strokeWidth={2.5} /></div>;
                                })()}

                                <div>
                                    <h3 className="font-black text-content uppercase tracking-tighter text-lg md:text-xl leading-snug mb-1">
                                        {getModalTitle()}
                                    </h3>
                                    {getModalSubtitle() && (
                                        <p className="text-caption md:text-label font-bold text-content-3 uppercase tracking-[0.2em]">{getModalSubtitle()}</p>
                                    )}
                                </div>
                            </div>
                            <Button variant="ghost" icon={X} iconOnly onClick={onClose} />
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
                                                <div className={`h-[2px] w-10 md:w-16 mx-1 rounded-full transition-all duration-[var(--dur-lento)] ${empStepCompletion[EMP_STEPS[idx - 1].key] ? 'bg-success' : 'bg-divider'}`} />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setEmpActiveTab(step.key)}
                                                // El acuse: son los pasos del expediente de
                                                // empleado y en el teléfono se tocan para
                                                // saltar de sección. El círculo ya reacciona
                                                // al puntero (`group-hover:`), que ahí no
                                                // existe. `min-h` de paso: el rótulo es micro.
                                                className="flex flex-col items-center gap-1.5 group min-h-[var(--tap-min)] transition-transform duration-[var(--dur-fast)] active:scale-[0.97]"
                                            >
                                                <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-[var(--dur-slow)] border-2 shadow-sm ${isComplete ? 'bg-success-solid border-transparent text-white' : isActive ? 'bg-brand border-transparent text-white scale-110 shadow-[var(--shadow-glow-brand)]' : 'bg-surface-card border-border-card text-content-3 group-hover:border-brand/40 group-hover:text-brand-text'}`}>
                                                    {isComplete ? <CheckCircle2 size={18} strokeWidth={2.5} /> : <StepIcon size={15} strokeWidth={2} />}
                                                </div>
                                                <span className={`text-micro font-black uppercase tracking-widest transition-colors whitespace-nowrap ${isActive ? 'text-brand-text' : isComplete ? 'text-success' : 'text-content-2'}`}>
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
                    className={`flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-base w-full ${fillHeight ? 'flex flex-col' : ''}`}
                    style={{ WebkitOverflowScrolling: 'touch', willChange: 'scroll-position' }}
                >
                    <div className={`flex flex-col w-full ${fillHeight ? 'flex-1 min-h-0' : 'min-h-full'} ${hidesHeader ? 'p-0' : 'px-6 md:px-10 py-6'}`}>
                        {validationError && (
                            <div className="mb-6 p-4 bg-danger/10 border border-danger/20 rounded-2xl flex items-center gap-3 text-danger shadow-sm shrink-0 animate-in fade-in slide-in-from-top-4">
                                <AlertCircle size={20} strokeWidth={2.5} className="shrink-0" />
                                <p className="text-label font-bold uppercase tracking-wide leading-tight">{validationError}</p>
                            </div>
                        )}

                        {hayQueOfrecer && (
                            <AvisoDeBorrador
                                className="mb-4"
                                cuando={borradorCuando}
                                onRecuperar={recuperarBorrador}
                                onDescartar={descartarOfrecimiento}
                            />
                        )}

                        <form id="unified-modal-form" onSubmit={handleLocalSubmit} className={`flex-1 flex flex-col relative w-full pb-4 ${fillHeight ? 'min-h-0' : ''}`}>
                            <Suspense fallback={<FallbackLoader />}>
                                {type === "viewAuditDetail" && <FormAuditDetail data={formData} />}
                                {type === "manageKiosks" && <FormDispositivos formData={formData} />}
                                
                                {type === "newEmployee" && <FormEmpleadoNuevo formData={formData || {}} setFormData={setFormData} branches={branches} roles={roles} activeTab={empActiveTab} setActiveTab={setEmpActiveTab} onValidationChange={setIsFormValid} />}
                                {type === "editEmployee" && <FormEmpleadoNuevo formData={formData || {}} setFormData={setFormData} branches={branches} roles={roles} isEditMode={true} activeTab={empActiveTab} setActiveTab={setEmpActiveTab} onValidationChange={setIsFormValid} />}
                                
                                {(type === "newBranch" || type === "editBranch") && <FormSucursal formData={formData} setFormData={setFormData} section="general" />}
                                {type === "editBranchHorarios" && <FormSucursal formData={formData} setFormData={setFormData} section="horarios" />}
                                {type === "editBranchLegal" && <FormSucursal formData={formData} setFormData={setFormData} section="legal" />}
                                {type === "editBranchInmueble" && <FormSucursal formData={formData} setFormData={setFormData} section="inmueble" />}
                                {type === "editBranchServicios" && <FormSucursal formData={formData} setFormData={setFormData} section="servicios" />}

                                {type === "newEvent" && <FormNovedad formData={formData} setFormData={setFormData} branches={branches} activeEmployee={activeEmployee} onValidationChange={setIsFormValid} />}
                                
                                {type === "uploadDocument" && <FormUploadOnly formData={formData} setFormData={setFormData} />}
                                {type === "planSchedule" && <FormPlanificador formData={formData} setFormData={setFormData} shifts={shifts} saveWeeklyRoster={saveWeeklyRoster} onClose={onClose} />}
                                {/* ⚠️ INALCANZABLE — `manageShifts` no lo abre NADA.
                                    Verificado el 2026-07-28 con un grep de todo el
                                    repo: este `type` solo aparece en este archivo
                                    (acá, en el título, en el ancho y en el ícono).
                                    Ningún `openModal('manageShifts')` en `src/`.

                                    Lo reemplazó la pestaña "Catálogo" de Horarios
                                    (`views/schedule-tabs/TabShifts.jsx`), que está
                                    viva, es más completa y hace lo mismo.

                                    NO se borra porque `updateShiftFlags` solo existe
                                    en `FormTurnos`: sacarlo se lleva la única UI de
                                    esas banderas. Si se decide que esas banderas ya
                                    no se usan, se pueden borrar los dos juntos —
                                    `forms/FormTurnos.jsx` (365 líneas) y las cuatro
                                    menciones de `manageShifts` de este archivo.

                                    Anotado en el CHANGELOG desde v2.17.28 sin que
                                    nadie actuara; queda acá para que se vea al
                                    tocar el modal, no solo al buscar en el historial. */}
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
                                {type === "viewPurchaseDte" && <FormPurchaseDteViewer formData={formData} onClose={onClose} />}
                                {type === "viewSalesDte" && <FormSalesDteViewer formData={formData} onClose={onClose} />}
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
                                {type === "editProveedor" && <FormProveedorDetail formData={formData} onClose={onClose} />}
                                {type === "editCliente" && <FormClienteDetail formData={formData} />}
                            </Suspense>
                        </form>
                    </div>
                </div>

                {!hidesFooter && (() => {
                    const isEmpForm = type === 'newEmployee' || type === 'editEmployee';
                    const isEditingEmp = type === 'editEmployee';
                    const EMP_STEP_KEYS = ['personal', 'laboral', 'nomina', 'documentos'];
                    const EMP_STEP_LABELS = { personal: 'Personal', laboral: 'Contrato', nomina: 'Nómina', documentos: 'Documentos' };
                    const empIdx = EMP_STEP_KEYS.indexOf(empActiveTab);
                    const prevStep = isEmpForm && empIdx > 0 ? EMP_STEP_KEYS[empIdx - 1] : null;
                    const nextStep = isEmpForm && empIdx < EMP_STEP_KEYS.length - 1 ? EMP_STEP_KEYS[empIdx + 1] : null;
                    // Al editar, faltan campos obligatorios en CUALQUIER pestaña deben
                    // deshabilitar Guardar — no solo los de la pestaña visible — para que
                    // el botón refleje de verdad si se puede guardar o no.
                    const empError = isEmpForm ? getEmployeeValidationError(formData, type) : null;
                    const empSaveDisabled = isSaving || !isFormValid || !!empError;
                    const empSaveTitle = empError || (!isFormValid ? 'Completa los campos marcados como "Requerido" en cualquier pestaña antes de guardar.' : undefined);
                    if (isEmpForm) {
                        return (
                            <LiquidModal.Footer>
                                {/* LEFT: Anterior */}
                                {prevStep ? (
                                    <Button variant="secondary" icon={ChevronLeft} disabled={isSaving} onClick={() => setEmpActiveTab(prevStep)}>{EMP_STEP_LABELS[prevStep]}</Button>
                                ) : <div />}

                                {/* CENTER: Cancelar */}
                                <Button variant="secondary" disabled={isSaving} onClick={onClose}>Cancelar</Button>

                                {/* RIGHT: Siguiente y/o Guardar — en edición, Guardar siempre está
                                    presente (no hace falta llegar a Documentos para guardar) */}
                                <div className="flex items-center gap-2">
                                    {nextStep && (
                                        <Button disabled={isSaving} onClick={() => setEmpActiveTab(nextStep)}>{EMP_STEP_LABELS[nextStep]}
                                            <ChevronRight size={15} strokeWidth={2.5} /></Button>
                                    )}
                                    {(isEditingEmp || !nextStep) && (
                                        <Button type="submit" form="unified-modal-form" size="lg"
                                    disabled={empSaveDisabled} loading={isSaving} icon={Save} title={empSaveTitle}>
                                    {isSaving ? 'Guardando' : 'Guardar'}
                                </Button>
                                    )}
                                </div>
                            </LiquidModal.Footer>
                        );
                    }

                    return (
                        <LiquidModal.Footer>
                            <Button variant="secondary" size="lg" disabled={isSaving} onClick={onClose}>Cancelar</Button>
                            <Button type="submit" form="unified-modal-form" size="lg"
                        disabled={isSaving || !isFormValid} loading={isSaving} icon={Save}>
                        {isSaving ? 'Procesando' : 'Guardar Cambios'}
                    </Button>
                        </LiquidModal.Footer>
                    );
                })()}
        </LiquidModal>
    );
};

export default UnifiedModal;