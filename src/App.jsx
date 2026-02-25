import React, { useEffect, useState } from "react";

// Contextos
import { useAuth } from "./context/AuthContext";
import { useStaff } from "./context/StaffContext";

// Layouts y Vistas
import AdminLayout from "./components/layout/AdminLayout";
import UserHeader from "./components/layout/UserHeader";
import UnifiedModal from "./components/common/UnifiedModal";
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

export default function App() {
  const { user, logout, isAuthenticated, isAdmin, loading } = useAuth();

  const {
    addEmployee,
    updateEmployee,
    registerEmployeeEvent,
    addDocumentToEvent,

    // branches
    addBranch,
    updateBranch,
  } = useStaff();

  // Estados de UI
  const [view, setView] = useState("login");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("ALL");

  // Estados de Modales
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState("");
  const [activeEmployee, setActiveEmployee] = useState(null);
  const [activeTab, setActiveTab] = useState("history");
  const [formData, setFormData] = useState({});
  const [targetEventId, setTargetEventId] = useState(null);
  const [isAuditOverlayActive, setIsAuditOverlayActive] = useState(false);

  // Estado para la sucursal activa
  const [activeBranch, setActiveBranch] = useState(null);

  // ✅ Sync de view con auth (evita que se quede en "login" al recargar)
  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      setView("login");
      return;
    }

    // Si ya está autenticado pero view quedó en login por default
    setView((v) => (v === "login" ? "dashboard" : v));
  }, [loading, isAuthenticated]);

  // ✅ Helper: schedule vacío (NO inventa horas)
  const emptyWeekSchedule = () => ({
    1: { start: "", end: "", isOpen: true },
    2: { start: "", end: "", isOpen: true },
    3: { start: "", end: "", isOpen: true },
    4: { start: "", end: "", isOpen: true },
    5: { start: "", end: "", isOpen: true },
    6: { start: "", end: "", isOpen: true },
    0: { start: "", end: "", isOpen: true },
  });

  // ✅ Normaliza Branch -> formData (para que FormSucursal cargue TODO)
  const normalizeBranchToForm = (branch) => {
    if (!branch) return null;

    const weekly = branch.weeklyHours || branch.branchSchedule || {};
    const schedule = emptyWeekSchedule();

    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const src = weekly?.[d];
      if (src) {
        const isOpen = typeof src.isOpen === "boolean" ? src.isOpen : true;
        const start = src.start ?? "";
        const end = src.end ?? "";

        schedule[d] = {
          isOpen,
          start: isOpen ? start : "",
          end: isOpen ? end : "",
        };

        if (schedule[d].isOpen === false) {
          schedule[d].start = "";
          schedule[d].end = "";
        }
      }
    });

    return {
      branchId: branch.id ?? branch.branchId ?? null,

      branchName: branch.branchName ?? branch.name ?? "",
      address: branch.address ?? "",
      phone: branch.phone ?? "",
      cell: branch.cell ?? "",
      branchSchedule: schedule,

      openingDate: branch.openingDate ?? "",
      propertyType: branch.propertyType ?? "OWNED",
      rent: branch.rent ?? null,
    };
  };

  // ✅ Form default nueva sucursal
  const defaultNewBranchForm = () => ({
    branchName: "",
    address: "",
    phone: "",
    cell: "",
    openingDate: new Date().toISOString().split("T")[0],
    propertyType: "OWNED",
    rent: null,
    branchSchedule: emptyWeekSchedule(),
  });

  // ✅ FormData -> payload para StaffContext
  const branchFormToPayload = (fd) => ({
    id: fd.branchId ?? undefined,

    name: fd.branchName ?? "",
    address: fd.address ?? "",
    phone: fd.phone ?? "",
    cell: fd.cell ?? "",

    openingDate: fd.openingDate ?? "",
    propertyType: fd.propertyType ?? "OWNED",
    rent: fd.rent ?? null,

    weeklyHours: fd.branchSchedule ?? emptyWeekSchedule(),
  });

  // Logout consistente
  const handleLogout = async () => {
    await logout?.();
    setView("login");
    setActiveEmployee(null);
    setActiveBranch(null);
    setActiveTab("history");
    setModalOpen(false);
    setModalType("");
    setFormData({});
    setTargetEventId(null);
    setSearchTerm("");
    setSelectedBranch("ALL");
  };

  // --- MANEJADOR DE MODAL ---
  const openModal = (type, data = null, eventId = null) => {
    setModalType(type);

    if (type === "newBranch") {
      setFormData(defaultNewBranchForm());
    } else if (type === "editBranch") {
      setFormData(normalizeBranchToForm(data) || defaultNewBranchForm());
    } else {
      setFormData(
        data || { branchId: 1, hireDate: new Date().toISOString().split("T")[0] }
      );
    }

    setTargetEventId(eventId);
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const targetId = activeEmployee?.id || user?.id;

    switch (modalType) {
      case "newEmployee":
        await addEmployee(formData);
        break;

      case "editEmployee":
        if (targetId) await updateEmployee(targetId, formData);
        break;

      case "newEvent":
        if (targetId) await registerEmployeeEvent(targetId, formData, formData.file);
        break;

      case "uploadDocument":
        if (targetId && targetEventId && formData.file) {
          await addDocumentToEvent(targetId, targetEventId, formData.file);
        }
        break;

      case "uploadConstancia":
        if (formData.file) alert("Constancia médica adjuntada con éxito.");
        break;

      case "newBranch": {
        const payload = branchFormToPayload(formData);
        await addBranch?.(payload);
        break;
      }

      case "editBranch": {
        const id = formData.branchId;
        if (id == null) break;
        const payload = branchFormToPayload(formData);
        await updateBranch?.(id, payload);
        break;
      }

      default:
        console.log("Acción no definida");
    }

    setModalOpen(false);
    setFormData({});
    setTargetEventId(null);
  };

  // --- ENRUTADOR PRINCIPAL ---

  // 1) Kiosco
  if (view === "timeclock") {
    return <TimeClockView setView={setView} />;
  }

  // 2) Splash mientras Auth restaura sesión
  if (loading) {
    return (
      <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden">
        <GlobalBackground />
        <div className="relative z-10 w-full h-full grid place-items-center">
          <div className="text-slate-500 font-semibold">Cargando sesión...</div>
        </div>
      </div>
    );
  }

  // 3) Login SOLO si no autenticado (✅ ya no depende de view === "login")
  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden">
        <GlobalBackground />
        <div className="relative z-10 w-full h-full overflow-y-auto">
          <LoginView setView={setView} setActiveEmployee={setActiveEmployee} />
        </div>
      </div>
    );
  }

  // 4) Vistas con sesión iniciada
  return (
    <div className="fixed inset-0 w-full h-full bg-[#F2F2F7] overflow-hidden">
      <GlobalBackground />

      <div className="relative z-10 w-full h-full">
        {isAdmin ? (
          <AdminLayout
            view={view}
            setView={setView}
            isOverlayActive={modalOpen || isAuditOverlayActive}
          >
            {view === "monitor" && (
              <AttendanceMonitorView
                setView={setView}
                setActiveEmployee={setActiveEmployee}
              />
            )}

            {view === "audit" && (
              <AttendanceAuditView
                setOverlayActive={setIsAuditOverlayActive}
                setView={setView}
                setActiveEmployee={setActiveEmployee}
              />
            )}

            {view === "dashboard" && (
              <DashboardView
                setView={setView}
                setActiveEmployee={setActiveEmployee}
                openModal={openModal}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                selectedBranch={selectedBranch}
                setSelectedBranch={setSelectedBranch}
              />
            )}

            {view === "schedules" && <SchedulesView />}

            {view === "branches" && (
              <BranchesView
                openModal={openModal}
                setView={setView}
                setActiveBranch={setActiveBranch}
              />
            )}

            {view === "branch-detail" && activeBranch && (
              <BranchDetailView
                branch={activeBranch}
                onBack={() => setView("branches")}
                setActiveEmployee={setActiveEmployee}
                setView={setView}
              />
            )}

            {view === "roles" && <RolesView />}

            {(view === "employee-detail" || view === "profile") && (
              <EmployeeDetailView
                activeEmployee={view === "profile" ? user : activeEmployee}
                setView={setView}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                openModal={openModal}
              />
            )}

            {view === "announcements" && <AnnouncementsView />}
          </AdminLayout>
        ) : (
          <div className="min-h-screen bg-transparent">
            <UserHeader user={user} handleLogout={handleLogout} />
            <EmployeeDetailView
              activeEmployee={user}
              setView={setView}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              openModal={openModal}
            />
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
    </div>
  );
}

// --- COMPONENTE DEL FONDO GLOBAL ANIMADO ---
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