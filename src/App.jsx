import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";

// Contextos
import { useAuth } from "./context/AuthContext";
import { useStaffStore as useStaff } from "./store/staffStore";
import AlertModal from "./components/common/AlertModal";

// Layouts y Vistas
import AdminLayout from "./components/layout/AdminLayout";
import UserHeader from "./components/layout/UserHeader";
import UnifiedModal from "./components/UnifiedModal";
import AttendanceMonitorView from "./views/AttendanceMonitorView";
import DashboardView from "./views/DashboardView";
import BranchesView from "./views/BranchesView";
import BranchDetailView from "./views/BranchDetailView";
import RolesView from "./views/RolesView";
import SchedulesView from "./views/SchedulesView";
import EmployeeDetailView from "./views/EmployeeDetailView";
import TimeClockView from "./views/TimeClockView";
import AnnouncementsView from "./views/AnnouncementsView";
import AttendanceAuditView from "./views/AttendanceAuditView";
import LoginView from "./views/LoginView";
import AuditView from "./views/AuditView";
import LiquidToast from './components/common/LiquidToast';

// ✅ COMPONENTE DE SINCRONIZACIÓN SILENCIOSA (Sin recargas de página)
const AuthSyncHelper = () => {
    const { user } = useAuth();
    const employees = useStaff((state) => state.employees);

    useEffect(() => {
        if (!user || !employees || employees.length === 0) return;

        const freshUser = employees.find((e) => String(e.id) === String(user.id));

        if (freshUser && freshUser.photo !== user.photo) {
            // Actualizamos la caché de forma silenciosa.
            // Zustand ya tiene los datos frescos para la UI, no necesitamos recargar la página.
            const updatedUser = { ...user, photo: freshUser.photo };
            localStorage.setItem("sb_user", JSON.stringify(updatedUser));
        }
    }, [employees, user]);

    return null;
};

// ============================================================================
// 🚀 APLICACIÓN PRINCIPAL (NUEVO MODO ENRUTADOR REACTIVO)
// ============================================================================
function MainApp() {
    const { user, logout, isAuthenticated, isAdmin, loading } = useAuth();

    // Zustand Actions
    const addEmployee = useStaff((state) => state.addEmployee);
    const updateEmployee = useStaff((state) => state.updateEmployee);
    const registerEmployeeEvent = useStaff((state) => state.registerEmployeeEvent);
    const addDocumentToEvent = useStaff((state) => state.addDocumentToEvent);
    const addBranch = useStaff((state) => state.addBranch);
    const updateBranch = useStaff((state) => state.updateBranch);
    const fetchBoot = useStaff((state) => state.fetchBoot);
    const fetchKioskBoot = useStaff((state) => state.fetchKioskBoot);

    const navigate = useNavigate();
    const location = useLocation();

    // 🌟 DISPARADOR DE CARGA INTELIGENTE (Se ejecuta en segundo plano)
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

    // 🌟 FACHADA DE RUTAS: Convertimos los setView antiguos en cambios de URL reales
    const currentPath = location.pathname.substring(1);
    const view = currentPath || (isAdmin ? "dashboard" : "profile");

    const setView = (targetView) => {
        if (targetView === "timeclock") navigate("/kiosk");
        else if (targetView === "login") navigate("/login");
        else navigate(`/${targetView}`);
    };

    // Estados de UI
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedBranch, setSelectedBranch] = useState("ALL");
    const [modalOpen, setModalOpen] = useState(false);
    const [modalType, setModalType] = useState("");
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

    // 🚨 LOGOUT FLUIDO: Ya no usamos navigate("/login") aquí.
    // Al llamar a logout(), el estado isAuthenticated pasa a false y React Router hace el resto al instante.
    const handleLogout = async () => {
        try {
            if (logout) await logout();
        } catch (error) {
            console.error(error);
        }
    };

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
                case "newEvent": if (targetId) await registerEmployeeEvent(targetId, dataToSave, dataToSave.file); break;
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
            throw error;
        }
    };

    // --- 🚨 PANTALLA DE CARGA LIQUIDGLASS (Sin parpadeos blancos) ---
    if (loading) {
        return (
            <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden flex items-center justify-center">
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

    // --- ENRUTADOR REACT ROUTER (Reglas estrictas e instantáneas) ---
    return (
        <Routes>
            {/* 1) KIOSKO (Ruta pública/independiente) */}
            <Route path="/kiosk" element={<TimeClockView setView={setView} />} />

            {/* 2) LOGIN */}
            <Route path="/login" element={
                !isAuthenticated ? (
                    <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden">
                        <GlobalBackground />
                        <div className="relative z-10 w-full h-full overflow-y-auto">
                            <LoginView setView={setView} setActiveEmployee={setActiveEmployee} />
                        </div>
                    </div>
                ) : <Navigate to={isAdmin ? "/dashboard" : "/profile"} replace />
            } />

            {/* 3) RUTAS PROTEGIDAS */}
            <Route path="/*" element={
                isAuthenticated ? (
                    <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden">
                        <GlobalBackground />
                        <AuthSyncHelper />

                        <div className="relative z-10 w-full h-full">
                            {isAdmin ? (
                                <AdminLayout
                                    view={view}
                                    setView={setView}
                                    isOverlayActive={modalOpen || isAuditOverlayActive}
                                    handleLogout={handleLogout}
                                >
                                    <Routes>
                                        <Route path="monitor" element={<AttendanceMonitorView setView={setView} setActiveEmployee={setActiveEmployee} />} />
                                        <Route path="audit" element={<AttendanceAuditView setOverlayActive={setIsAuditOverlayActive} setView={setView} setActiveEmployee={setActiveEmployee} />} />
                                        <Route path="dashboard" element={<DashboardView setView={setView} setActiveEmployee={setActiveEmployee} openModal={openModal} searchTerm={searchTerm} setSearchTerm={setSearchTerm} selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch} />} />
                                        <Route path="schedules" element={<SchedulesView openModal={openModal} />} />
                                        <Route path="auditview" element={<AuditView openModal={openModal} />} />
                                        <Route path="branches" element={<BranchesView openModal={openModal} setView={setView} setActiveBranch={setActiveBranch} />} />
                                        <Route path="branch-detail" element={activeBranch ? <BranchDetailView openModal={openModal} branch={activeBranch} onBack={() => setView("branches")} setActiveEmployee={setActiveEmployee} setView={setView} /> : <Navigate to="/branches" replace />} />
                                        <Route path="roles" element={<RolesView openModal={openModal} />} />
                                        <Route path="employee-detail" element={activeEmployee ? <EmployeeDetailView activeEmployee={activeEmployee} setView={setView} activeTab={activeTab} setActiveTab={setActiveTab} openModal={openModal} /> : <Navigate to="/dashboard" replace />} />
                                        <Route path="profile" element={<EmployeeDetailView activeEmployee={user} setView={setView} activeTab={activeTab} setActiveTab={setActiveTab} openModal={openModal} />} />
                                        <Route path="announcements" element={<AnnouncementsView openModal={openModal} />} />
                                        
                                        {/* Fallback de rutas Admin */}
                                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                                    </Routes>
                                </AdminLayout>
                            ) : (
                                <div className="min-h-screen bg-transparent">
                                    <UserHeader user={user} handleLogout={handleLogout} />
                                    <Routes>
                                        <Route path="profile" element={<EmployeeDetailView activeEmployee={user} setView={setView} activeTab={activeTab} setActiveTab={setActiveTab} openModal={openModal} />} />
                                        
                                        {/* Fallback de rutas Usuario */}
                                        <Route path="*" element={<Navigate to="/profile" replace />} />
                                    </Routes>
                                </div>
                            )}
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
    );
}

// ============================================================================
// ENVOLTORIO BASE CON INYECCIÓN DE TOAST DINÁMICA
// ============================================================================
export default function App() {
    return (
        <BrowserRouter>
            <AppWithToast />
        </BrowserRouter>
    );
}

// Sub-componente para poder usar useLocation y determinar el tema del Toast
const AppWithToast = () => {
    const location = useLocation();
    const isKioskMode = location.pathname.startsWith('/kiosk');

    return (
        <>
            <MainApp />
            <LiquidToast theme={isKioskMode ? 'dark' : 'light'} />
        </>
    );
};

const GlobalBackground = () => (
    <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#007AFF]/25 rounded-full filter blur-[100px] animate-ambient-drift" />
        <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-[#5856D6]/25 rounded-full filter blur-[100px] animate-ambient-drift-reverse" />
        <div
            className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-[#34C759]/15 rounded-full filter blur-[120px] animate-ambient-drift"
            style={{ animationDelay: "3s" }}
        />
    </div>
);