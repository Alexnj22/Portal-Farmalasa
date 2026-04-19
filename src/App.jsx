import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { Loader2, Settings, Monitor } from "lucide-react";

// Contextos
import { useAuth } from "./context/AuthContext";
import { useStaffStore as useStaff } from "./store/staffStore";
import { isMobileOrApp } from './utils/helpers';
import AlertModal from "./components/common/AlertModal";

// Layouts y Vistas
import AppLayout from "./components/layout/AppLayout";
import EmployeeHomeView from "./views/employee/EmployeeHomeView";
import EmployeeAnnouncementsView from "./views/employee/EmployeeAnnouncementsView";
import EmployeeRequestsView from "./views/employee/EmployeeRequestsView";
import EmployeeProfileView from "./views/employee/EmployeeProfileView";
import EmployeeDocumentsView from "./views/employee/EmployeeDocumentsView";
import UnifiedModal from "./components/UnifiedModal";
import AttendanceMonitorView from "./views/AttendanceMonitorView";
import StaffManagementView from "./views/StaffManagementView";
import BranchesView from "./views/BranchesView";
import BranchDetailView from "./views/BranchDetailView";
import RolesView from "./views/RolesView";
import PermissionsView from "./views/PermissionsView";
import SchedulesView from "./views/SchedulesView";
import EmployeeDetailView from "./views/EmployeeDetailView";
import TimeClockView from "./views/TimeClockView";
import AnnouncementsView from "./views/AnnouncementsView";
import AttendanceAuditView from "./views/AttendanceAuditView";
import LoginView from "./views/LoginView";
import AuditView from "./views/AuditView";
import RequestsView from "./views/RequestsView";
import VacationPlanView from "./views/VacationPlanView";
import NoAccessView from "./views/NoAccessView";
import AccessDeniedView from "./views/AccessDeniedView";
import DashboardView from "./views/DashboardView";
import LiquidToast from './components/common/LiquidToast';
import SalyChatOverlay from "./components/SalyChatOverlay";

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
            activeEmployee={emp}
            setView={(viewName) => {
                if (viewName === 'dashboard') navigate('/dashboard');
                else setView(viewName);
            }}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            openModal={handleOpenModal} // Pasamos la función limpiamente
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
// 🚀 APLICACIÓN PRINCIPAL
// ============================================================================
function MainApp() {
    const { user, logout, isAuthenticated, isAdmin, isJefe, isSupervisor, hasPermission, loading, permsLoading } = useAuth();

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

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        let isSubscribed = true;

        const loadData = async () => {
            if (isAuthenticated) {
                await fetchBoot();
            } else if (location.pathname === '/kiosk') {
                await fetchKioskBoot();
            }
        };

        loadData();
        return () => { isSubscribed = false; };
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
        if (hasPermission('emp_home',          'can_view')) return '/home';
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
    const [activeBranch, setActiveBranch] = useState(null);
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
                case "editBranch": const bId = dataToSave.branchId || dataToSave.id; if (bId) await updateBranch(bId, dataToSave); break;
                case "uploadConstancia":
                    if (dataToSave.file) {
                        showAlert("¡Documento Subido!", "Constancia médica adjuntada con éxito.", "success");
                    }
                    break;
            }
            setModalOpen(false);
            setFormData({});
            setTargetEventId(null);
        } catch (error) {
            if (error?.message?.startsWith('OVERLAP_ERROR:')) {
                showAlert('Conflicto de Fechas', error.message.replace('OVERLAP_ERROR: ', ''), 'error');
            } else {
                throw error;
            }
        }
    };

    if (loading || (isAuthenticated && permsLoading)) {
        return (
            <div className="fixed inset-0 w-full h-[100dvh] bg-[#F2F2F7] overflow-hidden flex items-center justify-center">
                <GlobalBackground />
                <div className="relative z-10 flex flex-col items-center justify-center gap-4 bg-white/40 backdrop-blur-xl border border-white/80 p-8 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05),inset_0_2px_15px_rgba(255,255,255,0.9)] animate-in fade-in zoom-in-95 duration-500">
                    <Loader2 size={32} className="text-[#007AFF] animate-spin" strokeWidth={2.5} />
                    <span className="text-slate-500 font-bold uppercase tracking-widest text-xs animate-pulse">
                        Verificando sesión...
                    </span>
                </div>
            </div>
        );
    }

    return (
        <Routes>
            <Route path="/kiosk" element={
                !isMobileOrApp() ? (
                    <TimeClockView setView={setView} />
                ) : (
                    <Navigate to="/login" replace />
                )
            } />
            <Route path="/login" element={
                !isAuthenticated ? (
                    <div className="relative min-h-[100dvh] w-full bg-[#F2F2F7]">
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
                    <div className="fixed inset-0 w-full h-[100dvh] bg-[#F2F2F7] overflow-hidden flex flex-col">
                        <GlobalBackground />
                        <AuthSyncHelper />

                        <div className="relative z-10 w-full h-full flex flex-col">
                            <AppLayout
                                isOverlayActive={modalOpen || isAuditOverlayActive}
                                handleLogout={handleLogout}
                            >
                                <Routes>
                                    {/* ── Self-service ── */}
                                    <Route path="home" element={<PermissionGuard moduleKey="emp_home"><EmployeeHomeView /></PermissionGuard>} />
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
                                    <Route path="overview" element={<PermissionGuard moduleKey="overview"><DashboardView /></PermissionGuard>} />
                                    <Route path="monitor" element={<PermissionGuard moduleKey="monitor"><AttendanceMonitorView setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="audit" element={<PermissionGuard moduleKey="time_audit"><AttendanceAuditView setOverlayActive={setIsAuditOverlayActive} setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="schedules" element={<PermissionGuard moduleKey="schedules"><SchedulesView openModal={openModal} setView={setView} /></PermissionGuard>} />
                                    <Route path="requests" element={<PermissionGuard moduleKey="requests"><RequestsView /></PermissionGuard>} />
                                    <Route path="vacation-plan" element={<PermissionGuard moduleKey="vacation_plan"><VacationPlanView /></PermissionGuard>} />
                                    <Route path="announcements" element={<PermissionGuard moduleKey="announcements"><AnnouncementsView openModal={openModal} /></PermissionGuard>} />

                                    {/* ── Estructura ── */}
                                    <Route path="branches">
                                        <Route index element={
                                            <PermissionGuard moduleKey="branches">
                                                <BranchesView
                                                    setView={setView}
                                                    setActiveBranch={(b) => { setActiveBranch(b); navigate(`/branches/${b.id}`); }}
                                                    openModal={openModal}
                                                />
                                            </PermissionGuard>
                                        } />
                                        <Route path=":id" element={<PermissionGuard moduleKey="branches"><BranchProfileWrapper openModal={openModal} /></PermissionGuard>} />
                                    </Route>
                                    <Route path="roles" element={<PermissionGuard moduleKey="roles"><RolesView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="permissions" element={<PermissionGuard moduleKey="permissions"><PermissionsView /></PermissionGuard>} />
                                    <Route path="auditview" element={<PermissionGuard moduleKey="auditview"><AuditView openModal={openModal} /></PermissionGuard>} />

                                    {/* ── Fallbacks ── */}
                                    <Route path="employee-detail" element={<Navigate to="/dashboard" replace />} />
                                    <Route path="staff" element={<Navigate to="/dashboard" replace />} />
                                    <Route path="*" element={<Navigate to={defaultRedirect} replace />} />
                                </Routes>
                            </AppLayout>
                        </div>

                        <SalyChatOverlay />

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
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppWithToast />
        </BrowserRouter>
    );
}

const MobileConstructionScreen = () => (
    <div className="sm:hidden fixed inset-0 z-[99999] bg-[#F2F2F7] flex flex-col items-center justify-center p-6 text-center overflow-hidden">
        <GlobalBackground />

        <div className="relative z-10 flex flex-col items-center max-w-sm bg-white/60 backdrop-blur-xl border border-white/80 p-8 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.05),inset_0_2px_15px_rgba(255,255,255,0.9)] animate-in fade-in zoom-in duration-700">

            <div className="relative flex items-center justify-center w-24 h-24 bg-gradient-to-tr from-[#007AFF]/10 to-[#5856D6]/10 rounded-full mb-6 border border-white">
                <Settings className="text-[#007AFF] animate-spin" size={40} strokeWidth={1.5} style={{ animationDuration: '4s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                    <Monitor className="text-[#5856D6] bg-[#F2F2F7] rounded-md p-1 scale-75" size={28} strokeWidth={2} />
                </div>
            </div>

            <h2 className="text-[22px] font-black text-slate-800 tracking-tight mb-3 leading-none">
                Versión Móvil<br /><span className="text-[#007AFF]">en Desarrollo</span>
            </h2>

            <p className="text-[13px] font-medium text-slate-500 leading-relaxed">
                Estamos construyendo una experiencia increíble para tu teléfono.
                <br /><br />
                Por favor, accede desde una <b>computadora</b> para utilizar todas las funciones del portal.
            </p>

            <div className="mt-8 flex gap-1.5 justify-center">
                <span className="w-1.5 h-1.5 bg-[#007AFF] rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
                <span className="w-1.5 h-1.5 bg-[#007AFF] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-1.5 h-1.5 bg-[#007AFF] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
            </div>
        </div>
    </div>
);

const AppWithToast = () => {
    const location = useLocation();
    const isKioskMode = location.pathname.startsWith('/kiosk');

    return (
        <>
            <MobileConstructionScreen />
            <div className="hidden sm:block w-full h-full">
                <MainApp />
                <LiquidToast theme={isKioskMode ? 'dark' : 'light'} />
            </div>
        </>
    );
};

const GlobalBackground = () => (
    <div className="fixed inset-0 w-full h-[100dvh] z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#007AFF]/25 rounded-full filter blur-[100px] animate-ambient-drift" />
        <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-[#5856D6]/25 rounded-full filter blur-[100px] animate-ambient-drift-reverse" />
        <div
            className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-[#34C759]/15 rounded-full filter blur-[120px] animate-ambient-drift"
            style={{ animationDelay: "3s" }}
        />
    </div>
);