import React, { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

// Contextos
import { useAuth } from "./context/AuthContext";
import { useStaffStore as useStaff } from "./store/staffStore";
import { useToastStore } from "./store/toastStore";
import { isMobileOrApp } from './utils/helpers';
import AlertModal from "./components/common/AlertModal";
import ErrorBoundary from "./components/common/ErrorBoundary";

// Layouts (shell — necesarios en toda ruta, se quedan eager)
import AppLayout from "./components/layout/AppLayout";
import UnifiedModal from "./components/UnifiedModal";
import LiquidToast from './components/common/LiquidToast';

// Vistas — code-split por ruta (React.lazy). Antes 51 imports estáticos
// empaquetaban las 40+ vistas en un solo chunk eager de 5.24MB/1.74MB gzip.
const EmployeeAnnouncementsView = lazy(() => import("./views/employee/EmployeeAnnouncementsView"));
const EmployeeRequestsView = lazy(() => import("./views/employee/EmployeeRequestsView"));
const EmployeeProfileView = lazy(() => import("./views/employee/EmployeeProfileView"));
const EmployeeDocumentsView = lazy(() => import("./views/employee/EmployeeDocumentsView"));
const AttendanceMonitorView = lazy(() => import("./views/AttendanceMonitorView"));
const StaffManagementView = lazy(() => import("./views/StaffManagementView"));
const BranchesView = lazy(() => import("./views/BranchesView"));
const BranchDetailView = lazy(() => import("./views/BranchDetailView"));
const RolesView = lazy(() => import("./views/RolesView"));
const PermissionsView = lazy(() => import("./views/PermissionsView"));
const SchedulesView = lazy(() => import("./views/SchedulesView"));
const EmployeeDetailView = lazy(() => import("./views/EmployeeDetailView"));
const TimeClockView = lazy(() => import("./views/TimeClockView"));
const AnnouncementsView = lazy(() => import("./views/AnnouncementsView"));
const AttendanceAuditView = lazy(() => import("./views/AttendanceAuditView"));
const LoginView = lazy(() => import("./views/LoginView"));
const AuditView = lazy(() => import("./views/AuditView"));
const IOSTestView = lazy(() => import("./views/IOSTestView"));
const SyncHealthView = lazy(() => import("./views/SyncHealthView"));
const OrphanObjectsView = lazy(() => import("./views/OrphanObjectsView"));
const RawTestView = lazy(() => import("./views/RawTestView"));
const RequestsView = lazy(() => import("./views/RequestsView"));
const VacationPlanView = lazy(() => import("./views/VacationPlanView"));
const PayrollView = lazy(() => import("./views/PayrollView"));
const VentasView = lazy(() => import("./views/VentasView"));
const MetasView = lazy(() => import("./views/MetasView"));
const ProductosView = lazy(() => import("./views/ProductosView"));
const LaboratoriosView = lazy(() => import("./views/LaboratoriosView"));
const PedidosView = lazy(() => import("./views/PedidosView"));
const MinMaxView = lazy(() => import("./views/MinMaxView"));
const VentasPperdidasView = lazy(() => import("./views/VentasPperdidasView"));
const ComprasView = lazy(() => import("./views/ComprasView"));
const FacturasCompraView = lazy(() => import("./views/purchases/FacturasCompraView"));
const ProveedoresView = lazy(() => import("./views/purchases/ProveedoresView"));
const ConteoInventarioView = lazy(() => import("./views/ConteoInventarioView"));
const ConteoDetailView = lazy(() => import("./views/inventario/ConteoDetailView"));
const PromocionesView = lazy(() => import("./views/PromocionesView"));
const FacturacionView = lazy(() => import("./views/FacturacionView"));
const CotizacionesView = lazy(() => import("./views/CotizacionesView"));
const EncuestaView = lazy(() => import("./views/EncuestaView"));
const EncuestaAdminView = lazy(() => import("./views/EncuestaAdminView"));
const NoAccessView = lazy(() => import("./views/NoAccessView"));
const AccessDeniedView = lazy(() => import("./views/AccessDeniedView"));
const DashboardView = lazy(() => import("./views/DashboardView"));

// ✅ COMPONENTE DE SINCRONIZACIÓN SILENCIOSA
const AuthSyncHelper = () => {
    const { user } = useAuth();
    const employees = useStaff((state) => state.employees);

    useEffect(() => {
        if (!user || !employees || employees.length === 0) return;

        const freshUser = employees.find((e) => String(e.id) === String(user.id));

        if (freshUser && freshUser.photo !== user.photo) {
            const updatedUser = { ...user, photo: freshUser.photo };
            localStorage.setItem("sb_user", JSON.stringify(updatedUser));
        }
    }, [employees, user]);

    return null;
};

// 🚨 ENVOLTORIO INTELIGENTE PARA LA SUCURSAL
const BranchProfileWrapper = ({ openModal }) => {
    const { id } = useParams();
    const branches = useStaff((state) => state.branches);

    const branch = branches.find(b => String(b.id) === String(id));

    if (!branch) {
        return <Navigate to="/branches" replace />;
    }

    return (
        <BranchDetailView
            branch={branch}
            openModal={openModal}
        />
    );
};

// 🚨 ENVOLTORIO INTELIGENTE PARA EL PERFIL DEL EMPLEADO (Arquitectura Segura de Hooks)
const EmployeeProfileWrapper = ({ activeTab, setActiveTab, openModal, setView, setActiveEmployeeGlobal }) => {
    // Aquí es SEGURO usar useParams porque es el Top-Level del componente
    const { id } = useParams(); 
    const navigate = useNavigate();
    const employees = useStaff((state) => state.employees);

    const emp = employees.find(e => String(e.id) === String(id));

    // Mantenemos el estado global sincronizado (Por si un modal lo ocupa)
    useEffect(() => {
        if (emp && setActiveEmployeeGlobal) {
            setActiveEmployeeGlobal(emp);
        }
    }, [emp, setActiveEmployeeGlobal]);

    if (!emp) {
        return <Navigate to="/dashboard" replace />;
    }

    // Interceptamos openModal para asegurar que pasa el evento correcto
    const handleOpenModal = (type, data = null, eventId = null) => {
        // Forzamos que data tenga el ID del empleado si no lo trae
        const safeData = data || { id: emp.id, branchId: emp.branchId || emp.branch_id };
        openModal(type, safeData, eventId);
    };

    return (
        <EmployeeDetailView
            key={id}
            activeEmployee={emp}
            setView={(viewName) => {
                if (viewName === 'dashboard') navigate('/dashboard');
                else setView(viewName);
            }}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            openModal={handleOpenModal}
        />
    );
};

// ============================================================================
// 🔒 PERMISSION GUARD — Protege rutas individuales
// ============================================================================
const PermissionGuard = ({ moduleKey, children }) => {
    const { hasPermission } = useAuth();
    if (!hasPermission(moduleKey, 'can_view')) return <AccessDeniedView />;
    return children;
};

// ============================================================================
// ⏳ FALLBACK DE SUSPENSE — mismo lenguaje glass del loader de sesión, para
// la carga diferida (React.lazy) de cada vista por ruta.
// ============================================================================
const RouteLoadingFallback = () => (
    <div className="fixed inset-0 w-full h-[100dvh] flex items-center justify-center z-40">
        <div className="relative bg-white/35 backdrop-blur-3xl border border-white/70 rounded-[2rem] px-10 py-8 shadow-[0_32px_80px_rgba(0,82,204,0.10),0_8px_32px_rgba(0,0,0,0.04),inset_0_2px_24px_rgba(255,255,255,0.85)] flex flex-col items-center gap-3">
            <Loader2 className="text-[#0052CC] animate-spin" size={28} strokeWidth={2.5} />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Cargando…</span>
        </div>
    </div>
);

// Fallback SOLO para el área de contenido dentro de AppLayout — un Suspense
// separado del de nivel raíz evita que cambiar de ruta ya autenticado
// desmonte el sidebar entero (React reemplaza TODO el subárbol del Suspense
// más cercano al suspender, no solo el componente lazy).
const ContentLoadingFallback = () => (
    <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="text-[#0052CC] animate-spin" size={28} strokeWidth={2.5} />
    </div>
);

// ============================================================================
// 🚀 APLICACIÓN PRINCIPAL
// ============================================================================
// Scroll to top on every route change (needed for native mobile scroll)
function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        const el = document.getElementById('main-scroll');
        if (el) el.scrollTop = 0;
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
}

function MainApp() {
    const { user, logout, isAuthenticated, hasPermission, loading, permsLoading } = useAuth();

    // Zustand Actions
    const addEmployee = useStaff((state) => state.addEmployee);
    const updateEmployee = useStaff((state) => state.updateEmployee);
    const registerEmployeeEvent = useStaff((state) => state.registerEmployeeEvent);
    const editEmployeeEvent = useStaff((state) => state.editEmployeeEvent);
    const addDocumentToEvent = useStaff((state) => state.addDocumentToEvent);
    const addBranch = useStaff((state) => state.addBranch);
    const updateBranch = useStaff((state) => state.updateBranch);
    const fetchBoot = useStaff((state) => state.fetchBoot);
    const fetchKioskBoot = useStaff((state) => state.fetchKioskBoot);
    const createPayrollPeriod      = useStaff((state) => state.createPayrollPeriod);
    const updatePayrollEntry       = useStaff((state) => state.updatePayrollEntry);
    const redeemOvertimeBank       = useStaff((state) => state.redeemOvertimeBank);

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const loadData = async () => {
            if (isAuthenticated) {
                await fetchBoot();
            } else if (location.pathname === '/kiosk') {
                await fetchKioskBoot();
            }
        };

        loadData();
    }, [isAuthenticated, location.pathname, fetchBoot, fetchKioskBoot]);

    const setView = (targetView) => {
        if (targetView === "timeclock") navigate("/kiosk");
        else if (targetView === "login") navigate("/login");
        else navigate(`/${targetView}`);
    };

    // First permitted landing page
    const defaultRedirect = (() => {
        if (hasPermission('overview',           'can_view')) return '/overview';
        if (hasPermission('staff_list',        'can_view')) return '/dashboard';
        if (hasPermission('monitor',           'can_view')) return '/monitor';
        if (hasPermission('requests',          'can_view')) return '/requests';
        if (hasPermission('schedules',         'can_view')) return '/schedules';
        if (hasPermission('announcements',     'can_view')) return '/announcements';
        if (hasPermission('branches',          'can_view')) return '/branches';
        if (hasPermission('emp_requests',      'can_view')) return '/my-requests';
        if (hasPermission('emp_announcements', 'can_view')) return '/my-announcements';
        if (hasPermission('emp_documents',     'can_view')) return '/my-documents';
        if (hasPermission('emp_profile',       'can_view')) return '/profile';
        return '/no-access';
    })();

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedBranch, setSelectedBranch] = useState("ALL");
    const [modalOpen, setModalOpen] = useState(false);
    const [modalType, setModalType] = useState("");

    // Estado global de Empleado (Para modales)
    const [activeEmployee, setActiveEmployee] = useState(null);

    const [activeTab, setActiveTab] = useState("history");
    const [formData, setFormData] = useState({});
    const [targetEventId, setTargetEventId] = useState(null);
    const [isAuditOverlayActive, setIsAuditOverlayActive] = useState(false);
    const [alertConfig, setAlertConfig] = useState({ isOpen: false, title: '', message: '', type: 'info' });

    const showAlert = (title, message, type = 'info') => {
        setAlertConfig({ isOpen: true, title, message, type });
    };

    const emptyWeekSchedule = () => ({
        1: { start: "", end: "", isOpen: false }, 2: { start: "", end: "", isOpen: false },
        3: { start: "", end: "", isOpen: false }, 4: { start: "", end: "", isOpen: false },
        5: { start: "", end: "", isOpen: false }, 6: { start: "", end: "", isOpen: false },
        0: { start: "", end: "", isOpen: false },
    });

    const defaultNewBranchForm = () => ({
        branchName: "", address: "", phone: "", cell: "",
        openingDate: new Date().toISOString().split("T")[0],
        propertyType: "OWNED", rent: null, branchSchedule: emptyWeekSchedule(),
    });

    const handleLogout = async () => {
        try {
            if (logout) await logout();
        } catch (error) {
            console.error(error);
        }
    };

    // 🚨 FUNCIÓN PURA: No llamar hooks de React aquí
    const openModal = (type, data = null, eventId = null) => {
        setModalType(type);

        if (type === "newBranch") {
            setFormData(defaultNewBranchForm());
        } else if (type === "editBranch") {
            setFormData({
                ...data,
                branchId: data?.id ?? data?.branchId ?? null,
                branchName: data?.name ?? data?.branchName ?? "",
            });
        } else if (type === "editEmployee") {
            // Pre-populate first_names/last_names from composite name for legacy employees
            const ed = { ...data };
            if (!ed.first_names?.trim() && ed.name?.trim()) {
                const parts = ed.name.trim().split(' ');
                const mid = Math.max(1, Math.ceil(parts.length / 2));
                ed.first_names = parts.slice(0, mid).join(' ');
                ed.last_names = parts.slice(mid).join(' ');
            }
            setFormData(ed);
        } else if (type === "newEmployee") {
            setFormData({
                hire_date: new Date().toISOString().split("T")[0],
                // Código del carné: SOLO números (regla de negocio + trigger de BD) —
                // el prefijo "EMP" que traía antes garantizaba que el código por
                // defecto SIEMPRE fallara la validación al guardar. El botón de
                // regenerar en el modal (generateUniqueCode) ya produce uno numérico
                // único; este es solo el valor inicial visible al abrir el formulario.
                code: String(Math.floor(1000 + Math.random() * 9000)),
                contract_type: 'INDEFINIDO',
                weekly_contracted_hours: '44',
                ...(data || {}),
            });
        } else if (type === "rehireEmployee") {
            setFormData({
                ...(data || {}),
                rehire_hire_date: new Date().toISOString().split("T")[0],
                rehire_contract_type: 'INDEFINIDO',
                rehire_weekly_hours: '44',
            });
        } else if (type === "vacationRecall") {
            setFormData({ employee: data?.employee || data || {} });
        } else if (type === "newPayrollPeriod") {
            const today = new Date();
            const day = today.getDate(), year = today.getFullYear(), month = today.getMonth();
            const start_date = day <= 15
                ? `${year}-${String(month+1).padStart(2,'0')}-01`
                : `${year}-${String(month+1).padStart(2,'0')}-16`;
            const end_date = day <= 15
                ? `${year}-${String(month+1).padStart(2,'0')}-15`
                : new Date(year, month+1, 0).toISOString().split('T')[0];
            setFormData({ start_date, end_date, pay_date: '', ...(data || {}) });
        } else if (type === "editPayrollEntry") {
            const entry = data || {};
            setFormData({
                _entry: entry,
                days_worked:           entry.days_worked,
                night_hours_ordinary:  entry.night_hours_ordinary,
                night_hours_extra:     entry.night_hours_extra,
                extra_hours_diurnal:   entry.extra_hours_diurnal,
                extra_hours_nocturnal: entry.extra_hours_nocturnal,
                holiday_surcharge:     entry.holiday_surcharge,
                bonifications:         entry.bonifications,
                vacation_bonus:        entry.vacation_bonus,
                viaticos:              entry.viaticos,
                viaticos_detail:       entry.viaticos_detail || '',
                order_discount:        entry.order_discount,
                other_discounts:       entry.other_discounts,
                salary_advance:        entry.salary_advance,
                _reason:               '',
            });
        } else {
            setFormData(data || { branchId: 1, hireDate: new Date().toISOString().split("T")[0] });
        }

        setTargetEventId(eventId);
        setModalOpen(true);
    };

    const handleSubmit = async (payload) => {
        if (payload?.preventDefault) payload.preventDefault();

        const dataToSave = (payload && !payload.nativeEvent) ? payload : formData;
        const targetId = activeEmployee?.id || dataToSave?.id || dataToSave?.branchId || user?.id;

        try {
            switch (modalType) {
                case "newEmployee": await addEmployee(dataToSave); break;
                case "editEmployee": if (targetId) await updateEmployee(targetId, dataToSave); break;
                case "newEvent": {
                    if (targetId) {
                        const editingId = dataToSave._editingEventId;
                        if (editingId) {
                            const cleanData = { ...dataToSave };
                            delete cleanData._editingEventId;
                            await editEmployeeEvent(editingId, cleanData, cleanData.employeeId || targetId);
                        } else {
                            await registerEmployeeEvent(targetId, dataToSave, dataToSave.file);
                        }
                    }
                    break;
                }
                case "uploadDocument": if (targetId && targetEventId && dataToSave.file) await addDocumentToEvent(targetId, targetEventId, dataToSave.file); break;
                case "newBranch": await addBranch(dataToSave); break;
                case "editBranch": { const bId = dataToSave.branchId || dataToSave.id; if (bId) await updateBranch(bId, dataToSave); break; }
                case "uploadConstancia":
                    if (dataToSave.file) {
                        showAlert("¡Documento Subido!", "Constancia médica adjuntada con éxito.", "success");
                    }
                    break;
                case "newPayrollPeriod": {
                    const { showToast } = useToastStore.getState();
                    await createPayrollPeriod({ ...dataToSave, period_type: 'QUINCENA' });
                    showToast('Período creado', 'La nueva quincena fue creada.', 'success');
                    break;
                }
                case "editPayrollEntry": {
                    const { showToast } = useToastStore.getState();
                    if (!dataToSave._reason?.trim()) {
                        showToast('Error', 'Escribe el motivo de la edición.', 'error');
                        return;
                    }
                    const entryId  = dataToSave._entry?.id;
                    const empId    = dataToSave._entry?.employee_id;
                    const periodId = dataToSave._entry?.period_id;
                    const by       = user?.name || user?.email || 'Admin';
                    const ok = await updatePayrollEntry(entryId, dataToSave, by, dataToSave._reason);
                    if (ok) {
                        // Persist OT bank redemptions — diurnal and nocturnal, pay and/or time-off
                        if (redeemOvertimeBank && dataToSave._otBank) {
                            const { dPay, dComp, nPay, nComp } = dataToSave._otBank;
                            const note = dataToSave._reason;
                            if (dPay  > 0) await redeemOvertimeBank(empId, dPay,  'PAID',     'DIURNAL',   periodId, note, user?.id).catch(console.error);
                            if (dComp > 0) await redeemOvertimeBank(empId, dComp, 'TIME_OFF', 'DIURNAL',   periodId, note, user?.id).catch(console.error);
                            if (nPay  > 0) await redeemOvertimeBank(empId, nPay,  'PAID',     'NOCTURNAL', periodId, note, user?.id).catch(console.error);
                            if (nComp > 0) await redeemOvertimeBank(empId, nComp, 'TIME_OFF', 'NOCTURNAL', periodId, note, user?.id).catch(console.error);
                        }
                        showToast('Guardado', 'Entrada actualizada.', 'success');
                    } else {
                        showToast('Error', 'No se pudo guardar.', 'error');
                    }
                    break;
                }
            }
            setModalOpen(false);
            setFormData({});
            setTargetEventId(null);
        } catch (error) {
            if (error?.message?.startsWith('OVERLAP_ERROR:')) {
                showAlert('Conflicto de Fechas', error.message.replace('OVERLAP_ERROR: ', ''), 'error');
            } else if (error?.message?.startsWith('HEADCOUNT_LIMIT:')) {
                showAlert('Límite de Organigrama', error.message.replace('HEADCOUNT_LIMIT: ', ''), 'error');
            } else {
                throw error;
            }
        }
    };

    if (loading || (isAuthenticated && permsLoading)) {
        return (
            <div className="fixed inset-0 w-full h-[100dvh] bg-gradient-to-br from-[#ddeeff] via-[#f0f6ff] to-[#e8eeff] overflow-hidden flex items-center justify-center">
                <GlobalBackground />

                {/* Card */}
                <div className="relative z-10 animate-in fade-in zoom-in-95 duration-700 ease-out">
                    <div className="relative bg-white/35 backdrop-blur-3xl border border-white/70 rounded-[2.5rem] px-14 py-12 shadow-[0_32px_80px_rgba(0,82,204,0.10),0_8px_32px_rgba(0,0,0,0.04),inset_0_2px_24px_rgba(255,255,255,0.85)] flex flex-col items-center gap-7 min-w-[280px]">

                        {/* Shimmer line top */}
                        <div className="absolute top-0 left-10 right-10 h-px bg-gradient-to-r from-transparent via-white to-transparent" />

                        {/* Logo + animated rings */}
                        <div className="relative flex items-center justify-center w-28 h-28">
                            {/* Slow outer ring */}
                            <svg className="absolute inset-0 w-full h-full animate-spin" style={{ animationDuration: '4s' }} viewBox="0 0 100 100" fill="none">
                                <defs>
                                    <linearGradient id="rg1" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" stopColor="#0052CC" stopOpacity="0.7" />
                                        <stop offset="60%" stopColor="#0052CC" stopOpacity="0.15" />
                                        <stop offset="100%" stopColor="#0052CC" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <circle cx="50" cy="50" r="46" stroke="url(#rg1)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="160 130" />
                            </svg>
                            {/* Fast inner ring */}
                            <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] animate-spin" style={{ animationDuration: '1.8s', animationDirection: 'reverse' }} viewBox="0 0 100 100" fill="none">
                                <defs>
                                    <linearGradient id="rg2" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#6929C4" stopOpacity="0.5" />
                                        <stop offset="100%" stopColor="#6929C4" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <circle cx="50" cy="50" r="44" stroke="url(#rg2)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="80 200" />
                            </svg>
                            {/* Logo pill */}
                            <div className="w-16 h-16 rounded-2xl bg-white/[0.60] backdrop-blur-xl border border-white/85 flex items-center justify-center shadow-[0_8px_28px_rgba(110,70,220,0.14),0_2px_8px_rgba(0,0,0,0.04),inset_0_2px_6px_rgba(255,255,255,1)]">
                                <img src="/Logo192.png" alt="Farmalasa" className="w-10 h-10 object-contain" />
                            </div>
                        </div>

                        {/* Brand text */}
                        <div className="flex flex-col items-center gap-1.5">
                            <span className="text-[21px] font-black text-slate-800 tracking-tight leading-none">Portal Farmalasa</span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#0052CC]/60">Sistema de Gestión</span>
                        </div>

                        {/* Animated dots */}
                        <div className="flex items-center gap-2">
                            {[0, 1, 2, 3].map(i => (
                                <div key={i}
                                    className="w-1.5 h-1.5 rounded-full bg-[#0052CC]/40 animate-bounce"
                                    style={{ animationDelay: `${i * 0.14}s`, animationDuration: '0.9s' }}
                                />
                            ))}
                        </div>

                        {/* Status */}
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 -mt-2">
                            Verificando sesión...
                        </span>

                        {/* Shimmer line bottom */}
                        <div className="absolute bottom-0 left-10 right-10 h-px bg-gradient-to-r from-transparent via-[#0052CC]/25 to-transparent" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
        <ScrollToTop />
        <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
            <Route path="/raw-test" element={<RawTestView />} />
            <Route path="/kiosk" element={
                !isMobileOrApp() ? (
                    <TimeClockView setView={setView} />
                ) : (
                    <Navigate to="/login" replace />
                )
            } />
            <Route path="/login" element={
                !isAuthenticated ? (
                    <div className="relative min-h-[100dvh] w-full bg-[#E6F0FF]">
                        <GlobalBackground />
                        <div className="relative z-10 w-full min-h-[100dvh] flex flex-col">
                            <LoginView setView={setView} setActiveEmployee={setActiveEmployee} />
                        </div>
                    </div>
                ) : <Navigate to={defaultRedirect} replace />
            } />

            {/* Sin acceso — fuera del layout para no mostrar el menú */}
            <Route path="/no-access" element={
                isAuthenticated ? <NoAccessView /> : <Navigate to="/login" replace />
            } />

            <Route path="/*" element={
                isAuthenticated ? (
                    <div className="relative min-h-[100dvh] lg:min-h-0 lg:fixed lg:inset-0 w-full bg-[#E6F0FF] lg:overflow-hidden flex flex-col">
                        <GlobalBackground />
                        <AuthSyncHelper />

                        <div className="relative z-10 w-full flex-1 flex flex-col">
                            <AppLayout
                                isOverlayActive={modalOpen || isAuditOverlayActive}
                                handleLogout={handleLogout}
                            >
                                <ErrorBoundary>
                                <Suspense fallback={<ContentLoadingFallback />}>
                                <Routes>
                                    {/* ── Self-service ── */}
                                    <Route path="my-requests" element={<PermissionGuard moduleKey="emp_requests"><EmployeeRequestsView /></PermissionGuard>} />
                                    <Route path="my-announcements" element={<PermissionGuard moduleKey="emp_announcements"><EmployeeAnnouncementsView /></PermissionGuard>} />
                                    <Route path="my-documents" element={<PermissionGuard moduleKey="emp_documents"><EmployeeDocumentsView /></PermissionGuard>} />
                                    <Route path="profile" element={<PermissionGuard moduleKey="emp_profile"><EmployeeProfileView openModal={openModal} /></PermissionGuard>} />

                                    {/* ── Gestión de personal ── */}
                                    <Route path="dashboard">
                                        <Route index element={
                                            <PermissionGuard moduleKey="staff_list">
                                                <StaffManagementView
                                                    setView={setView}
                                                    setActiveEmployee={(emp) => {
                                                        setActiveEmployee(emp);
                                                        navigate(`/dashboard/empleado/${emp.id}`);
                                                    }}
                                                    openModal={openModal}
                                                    searchTerm={searchTerm}
                                                    setSearchTerm={setSearchTerm}
                                                    selectedBranch={selectedBranch}
                                                    setSelectedBranch={setSelectedBranch}
                                                />
                                            </PermissionGuard>
                                        } />
                                        <Route path="empleado/:id" element={
                                            <PermissionGuard moduleKey="staff_detail">
                                                <EmployeeProfileWrapper
                                                    activeTab={activeTab}
                                                    setActiveTab={setActiveTab}
                                                    setView={setView}
                                                    openModal={openModal}
                                                    setActiveEmployeeGlobal={setActiveEmployee}
                                                />
                                            </PermissionGuard>
                                        } />
                                    </Route>

                                    {/* ── Operaciones ── */}
                                    <Route path="overview" element={<PermissionGuard moduleKey="overview"><DashboardView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="monitor" element={<PermissionGuard moduleKey="monitor"><AttendanceMonitorView setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="audit" element={<PermissionGuard moduleKey="time_audit"><AttendanceAuditView setOverlayActive={setIsAuditOverlayActive} setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="schedules" element={<PermissionGuard moduleKey="schedules"><SchedulesView openModal={openModal} setView={setView} /></PermissionGuard>} />
                                    <Route path="requests" element={<PermissionGuard moduleKey="requests"><RequestsView /></PermissionGuard>} />
                                    <Route path="vacation-plan" element={<PermissionGuard moduleKey="vacation_plan"><VacationPlanView /></PermissionGuard>} />
                                    <Route path="payroll" element={<PermissionGuard moduleKey="payroll"><PayrollView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="announcements" element={<PermissionGuard moduleKey="announcements"><AnnouncementsView openModal={openModal} /></PermissionGuard>} />

                                    <Route path="ventas" element={<PermissionGuard moduleKey="ventas"><VentasView /></PermissionGuard>} />
                                    <Route path="metas" element={<PermissionGuard moduleKey="metas"><MetasView /></PermissionGuard>} />
                                    <Route path="facturacion" element={<PermissionGuard moduleKey="facturacion"><FacturacionView /></PermissionGuard>} />
                                    <Route path="cotizaciones" element={<PermissionGuard moduleKey="cotizaciones"><CotizacionesView /></PermissionGuard>} />
                                    <Route path="productos" element={<PermissionGuard moduleKey="productos"><ProductosView /></PermissionGuard>} />
                                    <Route path="laboratorios" element={<PermissionGuard moduleKey="laboratorios"><LaboratoriosView /></PermissionGuard>} />
                                    <Route path="pedidos" element={<PermissionGuard moduleKey="pedidos"><PedidosView /></PermissionGuard>} />
                                    <Route path="minmax" element={<PermissionGuard moduleKey="minmax"><MinMaxView /></PermissionGuard>} />
                                    <Route path="ventas-perdidas" element={<PermissionGuard moduleKey="ventas_perdidas"><VentasPperdidasView /></PermissionGuard>} />
                                    <Route path="compras" element={<PermissionGuard moduleKey="compras"><ComprasView /></PermissionGuard>} />
                                    <Route path="facturas-compra" element={<PermissionGuard moduleKey="facturas_compra"><FacturasCompraView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="proveedores" element={<PermissionGuard moduleKey="proveedores"><ProveedoresView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="conteo-inventario" element={<PermissionGuard moduleKey="conteo_inventario"><ConteoInventarioView /></PermissionGuard>} />
                                    <Route path="conteo-inventario/:id" element={<PermissionGuard moduleKey="conteo_inventario"><ConteoDetailView /></PermissionGuard>} />
                                    <Route path="promociones" element={<PermissionGuard moduleKey="promociones"><PromocionesView /></PermissionGuard>} />
                                    <Route path="encuesta" element={<PermissionGuard moduleKey="encuesta"><EncuestaView /></PermissionGuard>} />
                                    <Route path="encuesta-admin" element={<PermissionGuard moduleKey="encuesta_admin"><EncuestaAdminView /></PermissionGuard>} />

                                    {/* ── Estructura ── */}
                                    <Route path="branches">
                                        <Route index element={
                                            <PermissionGuard moduleKey="branches">
                                                <BranchesView
                                                    setView={setView}
                                                    setActiveBranch={(b) => navigate(`/branches/${b.id}`)}
                                                    openModal={openModal}
                                                />
                                            </PermissionGuard>
                                        } />
                                        <Route path=":id" element={<PermissionGuard moduleKey="branches"><BranchProfileWrapper openModal={openModal} /></PermissionGuard>} />
                                    </Route>
                                    <Route path="roles" element={<PermissionGuard moduleKey="roles"><RolesView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="permissions" element={<PermissionGuard moduleKey="permissions"><PermissionsView /></PermissionGuard>} />
                                    <Route path="auditview" element={<PermissionGuard moduleKey="auditview"><AuditView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="ios-test" element={<PermissionGuard moduleKey="ios_test"><IOSTestView /></PermissionGuard>} />
                                    <Route path="sync-health" element={<PermissionGuard moduleKey="sync_health"><SyncHealthView /></PermissionGuard>} />
                                    <Route path="orphan-objects" element={<PermissionGuard moduleKey="orphan_objects"><OrphanObjectsView /></PermissionGuard>} />

                                    {/* ── Fallbacks ── */}
                                    <Route path="employee-detail" element={<Navigate to="/dashboard" replace />} />
                                    <Route path="staff" element={<Navigate to="/dashboard" replace />} />
                                    <Route path="*" element={<Navigate to={defaultRedirect} replace />} />
                                </Routes>
                                </Suspense>
                                </ErrorBoundary>
                            </AppLayout>
                        </div>

                        <UnifiedModal
                            isOpen={modalOpen}
                            onClose={() => setModalOpen(false)}
                            type={modalType}
                            formData={formData}
                            setFormData={setFormData}
                            handleSubmit={handleSubmit}
                            activeEmployee={activeEmployee || user}
                        />
                        <AlertModal
                            isOpen={alertConfig.isOpen}
                            title={alertConfig.title}
                            message={alertConfig.message}
                            type={alertConfig.type}
                            onClose={() => setAlertConfig({ ...alertConfig, isOpen: false })}
                        />
                    </div>
                ) : <Navigate to="/login" replace />
            } />
        </Routes>
        </Suspense>
        </>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppWithToast />
        </BrowserRouter>
    );
}

const ROUTE_TITLES = {
    '/overview':          'Inicio',
    '/dashboard':         'Dashboard',
    '/monitor':           'Asistencia',
    '/audit':             'Auditoría de Tiempo',
    '/schedules':         'Horarios',
    '/requests':          'Solicitudes',
    '/vacation-plan':     'Plan de Vacaciones',
    '/payroll':           'Planilla',
    '/announcements':     'Comunicados',
    '/ventas':            'Ventas',
    '/metas':             'Metas',
    '/facturacion':       'Facturación',
    '/cotizaciones':      'Cotizaciones',
    '/productos':         'Productos',
    '/pedidos':           'Pedidos a Sucursales',
    '/encuesta':          'Encuesta',
    '/encuesta-admin':    'Encuesta',
    '/compras':           'Compras',
    '/facturas-compra':   'Facturas de Compra',
    '/conteo-inventario': 'Conteo de Inventario',
    '/promociones':       'Promociones',
    '/branches':          'Sucursales',
    '/roles':             'Roles',
    '/permissions':       'Permisos',
    '/auditview':         'Auditoría',
    '/my-requests':       'Mis Solicitudes',
    '/my-announcements':  'Mis Avisos',
    '/my-documents':      'Mis Documentos',
    '/profile':           'Mi Perfil',
    '/kiosk':             'Reloj',
    '/login':             'Portal FarmaSalud',
};

const AppWithToast = () => {
    const location = useLocation();
    const isKioskMode = location.pathname.startsWith('/kiosk');

    useEffect(() => {
        const path = location.pathname;
        const base = '/' + path.split('/')[1];
        const isDashboardEmployee = path.startsWith('/dashboard/empleado/');
        const label = isDashboardEmployee
            ? 'Perfil de Empleado'
            : (ROUTE_TITLES[base] ?? null);
        document.title = label ? `${label} — FarmaSalud` : 'Portal FarmaSalud';
    }, [location.pathname]);

    // Deshabilitar corrección ortográfica y autocorrección en todos los campos
    useEffect(() => {
        const disable = (e) => {
            const el = e.target;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.spellcheck = false;
                el.setAttribute('autocorrect', 'off');
                el.setAttribute('autocapitalize', 'off');
            }
        };
        document.addEventListener('focusin', disable, true);
        return () => document.removeEventListener('focusin', disable, true);
    }, []);

    return (
        <>
            <div className="w-full h-full">
                <MainApp />
                <LiquidToast theme={isKioskMode ? 'dark' : 'light'} />
            </div>
        </>
    );
};

const GlobalBackground = () => (
    // h-[100vh] fallback + 100lvh inline: en Safari iOS el fondo se extiende por
    // DEBAJO de la barra inferior del navegador (translúcida) para que esa zona
    // se vea como continuación del app y no un recuadro blanco cortado. En
    // standalone/desktop 100lvh == viewport, sin cambio.
    <div className="fixed top-0 left-0 right-0 w-full h-[100vh] z-0 pointer-events-none overflow-hidden" style={{ height: '100lvh' }}>
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#0052CC]/25 rounded-full filter blur-[100px] animate-ambient-drift" />
        <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-[#6929C4]/25 rounded-full filter blur-[100px] animate-ambient-drift-reverse" />
        <div
            className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-[#12B76A]/15 rounded-full filter blur-[120px] animate-ambient-drift"
            style={{ animationDelay: "3s" }}
        />
    </div>
);