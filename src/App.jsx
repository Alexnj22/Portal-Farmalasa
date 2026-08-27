import React, { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { usePestanaEnUrl } from './hooks/usePestanaEnUrl';
import { Loader2 } from "lucide-react";
import { IMPORTADORES } from "./constants/routeImporters";

// Contextos
import { useAuth } from "./context/AuthContext";
import { useStaffStore as useStaff } from "./store/staffStore";
import { useToastStore } from "./store/toastStore";
import { isMobileOrApp } from './utils/helpers';
import { MODULE_MAP } from './constants/moduleMap';
import { pantallaDeArranque, PANTALLA } from './utils/arranqueSesion';
import AlertModal from "./components/common/AlertModal";
import ErrorBoundary from "./components/common/ErrorBoundary";
import AvisoEntornoPruebas from "./components/common/AvisoEntornoPruebas";
import AvisoVersionNueva from "./components/common/AvisoVersionNueva";

// Layouts (shell — necesarios en toda ruta, se quedan eager)
import AppLayout from "./components/layout/AppLayout";
// ── Diferido, como las vistas (2026-08-27) ──────────────────────────────────
// Son 72 kB de fuente que viajaban en el ARRANQUE para todo el mundo, y el
// modal de fichas no lo abre nadie hasta que decide abrirlo: la gente de sala
// entra al portal a vender, no a dar de alta a alguien. Medido con el gate:
// el entry estaba en 306 kB contra un techo de 303.
//
// Se monta en el PRIMER `modalOpen` y ya no se desmonta. No se gatea con
// `modalOpen` a secas a propósito: `useMontadoParaSalida` lo mantiene montado un
// instante después de cerrar para su animación de salida, y desmontarlo con el
// interruptor se la comería.
const UnifiedModal = lazy(() => import("./components/UnifiedModal"));
import LiquidToast from './components/common/LiquidToast';
import { LoadingState } from './components/common/StateViews';

// Vistas — code-split por ruta (React.lazy). Antes 51 imports estáticos
// empaquetaban las 40+ vistas en un solo chunk eager de 5.24MB/1.74MB gzip.
const EmployeeAnnouncementsView = lazy(IMPORTADORES.EmployeeAnnouncementsView);
const EmployeeProfileView = lazy(IMPORTADORES.EmployeeProfileView);
const EmployeeDocumentsView = lazy(IMPORTADORES.EmployeeDocumentsView);
const AttendanceMonitorView = lazy(IMPORTADORES.AttendanceMonitorView);
const EquiposView = lazy(IMPORTADORES.EquiposView);
const BranchesView = lazy(IMPORTADORES.BranchesView);
const BranchDetailView = lazy(IMPORTADORES.BranchDetailView);
const RolesView = lazy(IMPORTADORES.RolesView);
const PermissionsView = lazy(IMPORTADORES.PermissionsView);
const SchedulesView = lazy(IMPORTADORES.SchedulesView);
const EmployeeDetailView = lazy(IMPORTADORES.EmployeeDetailView);
const TimeClockView = lazy(IMPORTADORES.TimeClockView);
const AnnouncementsView = lazy(IMPORTADORES.AnnouncementsView);
const AttendanceAuditView = lazy(IMPORTADORES.AttendanceAuditView);
const LoginView = lazy(IMPORTADORES.LoginView);
const AuditView = lazy(IMPORTADORES.AuditView);
const IOSTestView = lazy(IMPORTADORES.IOSTestView);
const ImpresionView = lazy(IMPORTADORES.ImpresionView);
const CarnesDelDiaView = lazy(IMPORTADORES.CarnesDelDiaView);
const SyncHealthView = lazy(IMPORTADORES.SyncHealthView);
const SesionesView = lazy(IMPORTADORES.SesionesView);
const OrphanObjectsView = lazy(IMPORTADORES.OrphanObjectsView);
const MaintenanceView = lazy(IMPORTADORES.MaintenanceView);
const RawTestView = lazy(IMPORTADORES.RawTestView);
const RequestsView = lazy(IMPORTADORES.RequestsView);
const VacationPlanView = lazy(IMPORTADORES.VacationPlanView);
const PayrollView = lazy(IMPORTADORES.PayrollView);
const VentasView = lazy(IMPORTADORES.VentasView);
const CortesView = lazy(IMPORTADORES.CortesView);
const BolsasView = lazy(IMPORTADORES.BolsasView);
const ProductosView = lazy(IMPORTADORES.ProductosView);
const LaboratoriosView = lazy(IMPORTADORES.LaboratoriosView);
const PedidosView = lazy(IMPORTADORES.PedidosView);
const GestionStockView = lazy(IMPORTADORES.GestionStockView);
const InventarioView = lazy(IMPORTADORES.InventarioView);
const MinMaxView = lazy(IMPORTADORES.MinMaxView);
const TrasladosView = lazy(IMPORTADORES.TrasladosView);
const VentasPperdidasView = lazy(IMPORTADORES.VentasPperdidasView);
const ComprasView = lazy(IMPORTADORES.ComprasView);
const FacturasSalaView = lazy(IMPORTADORES.FacturasSalaView);
const CuentasPorPagarView = lazy(IMPORTADORES.CuentasPorPagarView);
const CargarCompraView = lazy(IMPORTADORES.CargarCompraView);
const FacturasCompraView = lazy(IMPORTADORES.FacturasCompraView);
const LibrosIvaView = lazy(IMPORTADORES.LibrosIvaView);
const LibroComprasCompletoView = lazy(IMPORTADORES.LibroComprasCompletoView);
const CierrePeriodoView = lazy(IMPORTADORES.CierrePeriodoView);
const ResumenFiscalView = lazy(IMPORTADORES.ResumenFiscalView);
const CorteZView = lazy(IMPORTADORES.CorteZView);
const MetasView = lazy(IMPORTADORES.MetasView);
const ProveedoresView = lazy(IMPORTADORES.ProveedoresView);
const ClientesView = lazy(IMPORTADORES.ClientesView);
const ConteoInventarioView = lazy(IMPORTADORES.ConteoInventarioView);
const BitacorasView = lazy(IMPORTADORES.BitacorasView);
const ConteoDetailView = lazy(IMPORTADORES.ConteoDetailView);
const FacturacionView = lazy(IMPORTADORES.FacturacionView);
const CotizacionesView = lazy(IMPORTADORES.CotizacionesView);
const EncuestaView = lazy(IMPORTADORES.EncuestaView);
const EncuestaAdminView = lazy(IMPORTADORES.EncuestaAdminView);
const NoAccessView = lazy(IMPORTADORES.NoAccessView);
const AccessDeniedView = lazy(IMPORTADORES.AccessDeniedView);
const DashboardView = lazy(IMPORTADORES.DashboardView);
const NotFoundView = lazy(IMPORTADORES.NotFoundView);

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
        return <Navigate to="/sucursales" replace />;
    }

    return (
        <BranchDetailView
            branch={branch}
            openModal={openModal}
        />
    );
};

// Las secciones de la ficha del empleado, para que `usePestanaEnUrl` pueda
// validar el `?tab=` que llegue por la dirección. El rótulo y el ícono de cada
// una siguen viviendo en `EmployeeDetailView` — acá sólo hacen falta las claves.
const EMPLEADO_TABS = ['history', 'documents', 'permissions', 'payroll', 'requests'];

// 🚨 ENVOLTORIO INTELIGENTE PARA EL PERFIL DEL EMPLEADO (Arquitectura Segura de Hooks)
const EmployeeProfileWrapper = ({ openModal, setView, setActiveEmployeeGlobal }) => {
    // Aquí es SEGURO usar useParams porque es el Top-Level del componente
    const { id } = useParams(); 
    // La sección abierta vive en la DIRECCIÓN y no en un `useState` de la raíz
    // de la app. Eran dos problemas en el mismo estado: recargar la ficha
    // devolvía a «Historial» sin decir nada, y el estado colgaba del componente
    // que envuelve TODAS las rutas aunque su único consumidor sea ésta —o sea
    // que cambiar de sección repintaba el árbol entero.
    const [activeTab, setActiveTab] = usePestanaEnUrl(EMPLEADO_TABS, 'history');
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
        return <Navigate to="/personal" replace />;
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
                if (viewName === 'dashboard') navigate('/personal');
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

/**
 * `/my-requests` → `/requests-personales`.
 *
 * La ruta vieja se conserva porque la nombran avisos ya enviados y los
 * favoritos de quien la usaba. **Se lleva la consulta**: el enlace de una
 * notificación puede traer `?solicitud=<id>`, y un `<Navigate>` a secas la
 * descarta — la persona llegaría a la lista general en vez de a su solicitud,
 * que es la mitad de lo que el aviso prometía.
 */
const IrAPersonales = () => {
    const { search, hash } = useLocation();
    return <Navigate to={`/requests-personales${search}${hash}`} replace />;
};

// Igual que `IrAFichaDePersonal`, para la ficha de una sucursal: vivía bajo
// `/branches/:id` y sin conservar el id el favorito de una sala abre el listado
// de las ocho.
const IrAFichaDeSucursal = () => {
    const { id } = useParams();
    const { search, hash } = useLocation();
    return <Navigate to={`/sucursales/${id}${search}${hash}`} replace />;
};

// La ficha de una persona vivía bajo `/dashboard/empleado/:id`. Un `<Navigate>`
// suelto a `/personal` perdería el `:id` y dejaría a quien tenía guardado el
// expediente de alguien mirando el listado completo, sin entender por qué —
// que es peor que un 404, porque parece que funcionó. Esto conserva el id, la
// consulta y el ancla.
const IrAFichaDePersonal = () => {
    const { id } = useParams();
    const { search, hash } = useLocation();
    return <Navigate to={`/personal/empleado/${id}${search}${hash}`} replace />;
};

// ============================================================================
// ⏳ FALLBACK DE SUSPENSE — mismo lenguaje glass del loader de sesión, para
// la carga diferida (React.lazy) de cada vista por ruta.
// ============================================================================
const RouteLoadingFallback = () => <LoadingState variant="route" />;

// Fallback SOLO para el área de contenido dentro de AppLayout — un Suspense
// separado del de nivel raíz evita que cambiar de ruta ya autenticado
// desmonte el sidebar entero (React reemplaza TODO el subárbol del Suspense
// más cercano al suspender, no solo el componente lazy).
const ContentLoadingFallback = () => <LoadingState variant="content" />;
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

// Orden de PREFERENCIA para la pantalla de aterrizaje: las vistas que sirven
// de "inicio", de la más general a la más personal. No es la lista completa de
// destinos posibles — el resto sale del MODULE_MAP.
//
// Hasta el 2026-07-30 sí era la lista completa y terminaba en '/no-access':
// como estos 11 son un subconjunto de los 35 módulos ruteables, cualquier rol
// cuyos módulos cayeran todos fuera aterrizaba en "Sin acceso" — que vive
// FUERA del AppLayout, o sea sin menú y sin salida. Le pasaba a "Contador
// Externo" (único módulo: facturas_compra) y a "Sistema — Alertas Técnicas"
// (sync_health). El módulo funcionaba perfecto escribiendo la URL a mano: lo
// único que faltaba era la forma de llegar. Ahora '/no-access' queda para
// quien de verdad no tiene ningún módulo navegable, que es lo que la pantalla
// dice ("Tu cuenta no tiene módulos habilitados").
//
// Los `comingSoon` del MODULE_MAP se excluyen porque no tienen <Route>:
// aterrizar ahí sería el 404.
const LANDING_PREFERIDO = [
    'overview', 'staff_list', 'monitor', 'requests', 'schedules',
    'announcements', 'branches', 'requests_personales', 'emp_announcements',
    'emp_documents', 'emp_profile',
];

function MainApp() {
    const { user, logout, isAuthenticated, hasPermission, loading, permsLoading, rolePerms, permsError, refreshPermissions } = useAuth();

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

    // Primera pantalla con permiso: la preferencia primero, y si ninguna
    // aplica, el primer módulo navegable que el usuario sí tenga.
    const defaultRedirect = (() => {
        const puedeAterrizar = (key) =>
            MODULE_MAP[key] && !MODULE_MAP[key].comingSoon && hasPermission(key, 'can_view');

        const preferido = LANDING_PREFERIDO.find(puedeAterrizar);
        if (preferido) return MODULE_MAP[preferido].path;

        const primero = Object.keys(MODULE_MAP).find(puedeAterrizar);
        return primero ? MODULE_MAP[primero].path : '/no-access';
    })();

    const [searchTerm, setSearchTerm] = useState("");
    const [selectedBranch, setSelectedBranch] = useState("ALL");
    const [modalOpen, setModalOpen] = useState(false);
    // Una vez abierto, el modal se queda montado: bajar su trozo una sola vez y
    // no cortarle la animación de salida.
    const [modalYaUsado, setModalYaUsado] = useState(false);
    useEffect(() => { if (modalOpen) setModalYaUsado(true); }, [modalOpen]);
    const [modalType, setModalType] = useState("");

    // Estado global de Empleado (Para modales)
    const [activeEmployee, setActiveEmployee] = useState(null);

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

    // Qué pantalla toca mientras la sesión se arma: la decisión vive en
    // `utils/arranqueSesion.js` con sus casos escritos, porque confundir
    // «todavía no sé tus permisos» con «no tenés ninguno» es lo que hacía
    // aparecer «Sin acceso» al cerrar sesión (2026-08-16).
    const pantalla = pantallaDeArranque({
        cargando: loading,
        autenticado: isAuthenticated,
        permisos: rolePerms,
        leyendoPermisos: permsLoading,
        falloDePermisos: permsError,
    });

    if (pantalla === PANTALLA.ERROR_PERMISOS) {
        // `NoAccessView` es lazy y este `return` está ANTES del <Suspense> de
        // las rutas: sin uno propio, la promesa del chunk no tiene quién la
        // espere y revienta la pantalla entera.
        return (
            <Suspense fallback={<RouteLoadingFallback />}>
                <NoAccessView porFalloDeLectura onReintentar={() => refreshPermissions()} />
            </Suspense>
        );
    }

    if (pantalla === PANTALLA.SPLASH) {
        return (
            /* Splash de arranque. ThemeProvider ya puso [data-theme] en <html>
               cuando esto pinta, pero el fondo, la tarjeta y el pill del logo
               estaban hardcodeados en azul claro / blanco (mientras el texto sí
               usaba text-content) — un usuario en dark veía un flash claro a
               pantalla completa con el título casi invisible encima, en CADA
               recarga. Tokenizado en v2.62.4 junto al resto del barrido. */
            <div className="fixed inset-0 w-full h-[100dvh] overflow-hidden flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
                <GlobalBackground />

                {/* Card */}
                <div className="relative z-base animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-out">
                    <div data-surface="card" className="relative px-14 py-12 flex flex-col items-center gap-7 min-w-[280px]">

                        {/* Shimmer line top */}
                        <div className="absolute top-0 left-10 right-10 h-px bg-gradient-to-r from-transparent via-[var(--shimmer-sweep-strong)] to-transparent" />

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
                            <div className="w-16 h-16 rounded-2xl bg-surface-card-hover border border-border-card flex items-center justify-center shadow-[var(--shadow-elevation-md)]">
                                <img src="/Logo192.png" alt="Farmalasa" className="w-10 h-10 object-contain" />
                            </div>
                        </div>

                        {/* Brand text */}
                        <div className="flex flex-col items-center gap-1.5">
                            <span className="text-title-lg font-black text-content tracking-tight leading-none">Portal Farmalasa</span>
                            <span className="text-caption font-bold uppercase tracking-[0.22em] text-brand-text/60">Sistema de Gestión</span>
                        </div>

                        {/* Animated dots */}
                        <div className="flex items-center gap-2">
                            {[0, 1, 2, 3].map(i => (
                                <div key={i}
                                    className="w-1.5 h-1.5 rounded-full bg-brand/40 animate-bounce"
                                    style={{ animationDelay: `${i * 0.14}s`, animationDuration: '0.9s' }}
                                />
                            ))}
                        </div>

                        {/* Status */}
                        <span className="text-caption font-bold uppercase tracking-[0.2em] text-content-3 -mt-2">
                            Verificando sesión...
                        </span>

                        {/* Shimmer line bottom */}
                        <div className="absolute bottom-0 left-10 right-10 h-px bg-gradient-to-r from-transparent via-brand/25 to-transparent" />
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
                    <div className="relative min-h-[100dvh] w-full bg-surface-page">
                        <GlobalBackground />
                        <div className="relative z-base w-full min-h-[100dvh] flex flex-col">
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
                    <div className="relative min-h-[100dvh] lg:min-h-0 lg:fixed lg:inset-0 w-full bg-surface-page lg:overflow-hidden flex flex-col">
                        <GlobalBackground />
                        <AuthSyncHelper />

                        <div className="relative z-base w-full flex-1 flex flex-col">
                            <AppLayout
                                isOverlayActive={modalOpen || isAuditOverlayActive}
                                handleLogout={handleLogout}
                            >
                                <ErrorBoundary>
                                <Suspense fallback={<ContentLoadingFallback />}>
                                <Routes>
                                    {/* La raíz no tenía ruta (2026-07-27): `/` caía en el
                                        catch-all y mostraba el 404. Por eso el botón "Volver
                                        al inicio" de NotFoundView parecía no responder — sí
                                        navegaba, pero a otro 404. Ahora `/` manda a la
                                        primera vista con permiso de cada usuario. */}
                                    <Route index element={<Navigate to={defaultRedirect} replace />} />

                                    {/* ── Self-service ── */}
                                    {/* «Mis Solicitudes» se fusionó con Personales el 2026-08-11.
                                        La ruta queda porque la nombran notificaciones ya enviadas
                                        y los favoritos de quien la usaba: sin ella, el aviso de
                                        una solicitud aprobada llevaría al 404. */}
                                    <Route path="my-requests" element={<IrAPersonales />} />
                                    <Route path="mis-avisos" element={<PermissionGuard moduleKey="emp_announcements"><EmployeeAnnouncementsView /></PermissionGuard>} />
                                    <Route path="mis-documentos" element={<PermissionGuard moduleKey="emp_documents"><EmployeeDocumentsView /></PermissionGuard>} />
                                    <Route path="mi-perfil" element={<PermissionGuard moduleKey="emp_profile"><EmployeeProfileView openModal={openModal} /></PermissionGuard>} />

                                    {/* ── Gestión de personal ── */}
                                    <Route path="personal">
                                        {/* Desde el 2026-08-26 `/personal` ES el equipo agrupado
                                            por sucursal, y la tabla ya no existe: el usuario la
                                            mandó quitar el mismo día, con una condición —«asegurate
                                            que los filter pills estén completos»—. Lo que vivía
                                            SÓLO en la tabla viajó a la píldora y a la tarjeta:
                                            practicantes, cuentas externas, la edición rápida (con
                                            su freno de arranque) y la reincorporación. Lo único
                                            que se perdió es ordenar por columna, que en una vista
                                            agrupada no significa nada. */}
                                        <Route index element={
                                            <PermissionGuard moduleKey="staff_list">
                                                <EquiposView
                                                    openModal={openModal}
                                                    searchTerm={searchTerm}
                                                    setSearchTerm={setSearchTerm}
                                                    selectedBranch={selectedBranch}
                                                    setSelectedBranch={setSelectedBranch}
                                                />
                                            </PermissionGuard>
                                        } />
                                        {/* `/personal/equipos` (el boceto) y `/personal/listado`
                                            (la tabla) vivieron un día cada una y se compartieron
                                            por chat. Un favorito no está en ninguna tabla y no
                                            hay forma de medirlo, así que las dos redirigen. */}
                                        <Route path="equipos" element={<Navigate to="/personal" replace />} />
                                        <Route path="listado" element={<Navigate to="/personal" replace />} />
                                        <Route path="empleado/:id" element={
                                            <PermissionGuard moduleKey="staff_detail">
                                                <EmployeeProfileWrapper
                                                    setView={setView}
                                                    openModal={openModal}
                                                    setActiveEmployeeGlobal={setActiveEmployee}
                                                />
                                            </PermissionGuard>
                                        } />
                                    </Route>

                                    {/* ── Operaciones ── */}
                                    <Route path="inicio" element={<PermissionGuard moduleKey="overview"><DashboardView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="monitor" element={<PermissionGuard moduleKey="monitor"><AttendanceMonitorView setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="auditoria-de-tiempos" element={<PermissionGuard moduleKey="time_audit"><AttendanceAuditView setOverlayActive={setIsAuditOverlayActive} setView={setView} setActiveEmployee={setActiveEmployee} /></PermissionGuard>} />
                                    <Route path="horarios" element={<PermissionGuard moduleKey="schedules"><SchedulesView openModal={openModal} setView={setView} /></PermissionGuard>} />
                                    {/* Dos ámbitos, un componente. Cada ruta con SU módulo:
                                        `requests` es el centro de la sala, `requests_personales`
                                        son las que hablan de una persona. Que sean rutas
                                        distintas con guardianes distintos es lo que impide que
                                        abrirle una a alguien le abra la otra. */}
                                    <Route path="solicitudes" element={<PermissionGuard moduleKey="requests"><RequestsView ambito="sucursal" /></PermissionGuard>} />
                                    <Route path="solicitudes-personales" element={<PermissionGuard moduleKey="requests_personales"><RequestsView ambito="personales" /></PermissionGuard>} />
                                    <Route path="vacaciones" element={<PermissionGuard moduleKey="vacation_plan"><VacationPlanView /></PermissionGuard>} />
                                    <Route path="nomina" element={<PermissionGuard moduleKey="payroll"><PayrollView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="avisos" element={<PermissionGuard moduleKey="announcements"><AnnouncementsView openModal={openModal} /></PermissionGuard>} />

                                    <Route path="ventas" element={<PermissionGuard moduleKey="ventas"><VentasView /></PermissionGuard>} />
                                    <Route path="cortes" element={<PermissionGuard moduleKey="cortes_caja"><CortesView /></PermissionGuard>} />
                                    <Route path="bolsas" element={<PermissionGuard moduleKey="bolsas"><BolsasView /></PermissionGuard>} />
                                    <Route path="facturacion" element={<PermissionGuard moduleKey="facturacion"><FacturacionView /></PermissionGuard>} />
                                    <Route path="cotizaciones" element={<PermissionGuard moduleKey="cotizaciones"><CotizacionesView /></PermissionGuard>} />
                                    <Route path="clientes" element={<PermissionGuard moduleKey="clientes"><ClientesView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="productos" element={<PermissionGuard moduleKey="productos"><ProductosView /></PermissionGuard>} />
                                    <Route path="laboratorios" element={<PermissionGuard moduleKey="laboratorios"><LaboratoriosView /></PermissionGuard>} />
                                    <Route path="pedidos" element={<PermissionGuard moduleKey="pedidos"><PedidosView /></PermissionGuard>} />
                                    <Route path="gestion-stock" element={<PermissionGuard moduleKey="gestion_stock"><GestionStockView /></PermissionGuard>} />
                                    <Route path="inventario" element={<PermissionGuard moduleKey="inventario"><InventarioView /></PermissionGuard>} />
                                    <Route path="minmax" element={<PermissionGuard moduleKey="minmax"><MinMaxView /></PermissionGuard>} />
                                    <Route path="traslados" element={<PermissionGuard moduleKey="traslados"><TrasladosView /></PermissionGuard>} />
                                    <Route path="ventas-perdidas" element={<PermissionGuard moduleKey="ventas_perdidas"><VentasPperdidasView /></PermissionGuard>} />
                                    <Route path="compras" element={<PermissionGuard moduleKey="compras"><ComprasView /></PermissionGuard>} />
                                    <Route path="facturas-sala" element={<PermissionGuard moduleKey="facturas_sala"><FacturasSalaView /></PermissionGuard>} />
                                    <Route path="cuentas-por-pagar" element={<PermissionGuard moduleKey="cuentas_por_pagar"><CuentasPorPagarView /></PermissionGuard>} />
                                    <Route path="cargar-compra" element={<PermissionGuard moduleKey="cargar_compra"><CargarCompraView /></PermissionGuard>} />
                                    <Route path="facturas-compra" element={<PermissionGuard moduleKey="facturas_compra"><FacturasCompraView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="libros-iva" element={<PermissionGuard moduleKey="libros_iva"><LibrosIvaView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="libro-compras-completo" element={<PermissionGuard moduleKey="libro_compras_completo"><LibroComprasCompletoView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="cierre-periodo" element={<PermissionGuard moduleKey="cierre_periodo"><CierrePeriodoView /></PermissionGuard>} />
                                    <Route path="resumen-fiscal" element={<PermissionGuard moduleKey="resumen_fiscal"><ResumenFiscalView /></PermissionGuard>} />
                                    <Route path="corte-z" element={<PermissionGuard moduleKey="corte_z"><CorteZView /></PermissionGuard>} />
                                    <Route path="metas" element={<PermissionGuard moduleKey="metas"><MetasView /></PermissionGuard>} />
                                    <Route path="proveedores" element={<PermissionGuard moduleKey="proveedores"><ProveedoresView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="conteo-inventario" element={<PermissionGuard moduleKey="conteo_inventario"><ConteoInventarioView /></PermissionGuard>} />
                                    <Route path="bitacoras" element={<PermissionGuard moduleKey="bitacoras"><BitacorasView /></PermissionGuard>} />
                                    <Route path="conteo-inventario/:id" element={<PermissionGuard moduleKey="conteo_inventario"><ConteoDetailView /></PermissionGuard>} />
                                    <Route path="encuesta" element={<PermissionGuard moduleKey="encuesta"><EncuestaView /></PermissionGuard>} />
                                    <Route path="encuesta-admin" element={<PermissionGuard moduleKey="encuesta_admin"><EncuestaAdminView /></PermissionGuard>} />

                                    {/* ── Estructura ── */}
                                    <Route path="sucursales">
                                        <Route index element={
                                            <PermissionGuard moduleKey="branches">
                                                <BranchesView
                                                    setView={setView}
                                                    setActiveBranch={(b) => navigate(`/sucursales/${b.id}`)}
                                                    openModal={openModal}
                                                />
                                            </PermissionGuard>
                                        } />
                                        <Route path=":id" element={<PermissionGuard moduleKey="branches"><BranchProfileWrapper openModal={openModal} /></PermissionGuard>} />
                                    </Route>
                                    <Route path="cargos" element={<PermissionGuard moduleKey="roles"><RolesView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="permisos" element={<PermissionGuard moduleKey="permissions"><PermissionsView /></PermissionGuard>} />
                                    <Route path="auditoria-del-sistema" element={<PermissionGuard moduleKey="auditview"><AuditView openModal={openModal} /></PermissionGuard>} />
                                    <Route path="prueba-ios" element={<PermissionGuard moduleKey="ios_test"><IOSTestView /></PermissionGuard>} />
                                    <Route path="impresion" element={<PermissionGuard moduleKey="impresion"><ImpresionView /></PermissionGuard>} />
                                    <Route path="carnes-del-dia" element={<PermissionGuard moduleKey="carne_temporal"><CarnesDelDiaView /></PermissionGuard>} />
                                    <Route path="actualizacion-de-datos" element={<PermissionGuard moduleKey="sync_health"><SyncHealthView /></PermissionGuard>} />
                                    <Route path="sesiones" element={<PermissionGuard moduleKey="sesiones"><SesionesView /></PermissionGuard>} />
                                    <Route path="objetos-huerfanos" element={<PermissionGuard moduleKey="orphan_objects"><OrphanObjectsView /></PermissionGuard>} />
                                    <Route path="mantenimiento" element={<PermissionGuard moduleKey="maintenance"><MaintenanceView /></PermissionGuard>} />

                                    {/* ── Fallbacks ── */}
                                    {/* `/dashboard` era el LISTADO DE PERSONAL y `/overview` el
                                        tablero: los dos nombres decían lo contrario de lo que
                                        abrían, y el comentario de ROUTE_TITLES lo admitía desde
                                        que se escribió («el path es legado»). Se renombraron el
                                        2026-08-26 a `/personal` e `/inicio`, que es como los
                                        llama el menú.

                                        Las viejas se quedan como redirección y no se borran:
                                        ninguna notificación guardada las nombra (medido: 0 de
                                        4,428), pero un favorito del navegador no está en ninguna
                                        tabla y no hay forma de medirlo. Sin esto, el que tenía
                                        guardada la pantalla de personal caía en el 404. */}
                                    {/* Las 17 que quedaban en inglés, renombradas el 2026-08-26 a
                                        pedido del usuario («corrige los que ya están mal»). Mismo
                                        motivo que arriba: el favorito de alguien no vive en ninguna
                                        tabla. `/branches/:id` conserva el id — sin eso, el favorito
                                        de una sala abre el listado de las ocho. */}
                                    <Route path="announcements" element={<Navigate to="/avisos" replace />} />
                                    {/* `/comunicaciones` vivió unas horas el 2026-08-26: se
                                        derivó del encabezado «Centro de comunicaciones», que
                                        resultó ser la ÚNICA vez que esa pantalla decía
                                        «comunicación» —adentro dice «aviso» 34 veces— y el menú
                                        ya decía «Gestionar avisos». Lo levantó el usuario: «¿por
                                        qué si my-announcements dice mis avisos, announcement
                                        dice comunicaciones?». Va igual como redirección: alguien
                                        pudo copiar el enlace en esas horas. */}
                                    <Route path="comunicaciones" element={<Navigate to="/avisos" replace />} />
                                    <Route path="audit" element={<Navigate to="/auditoria-de-tiempos" replace />} />
                                    <Route path="auditview" element={<Navigate to="/auditoria-del-sistema" replace />} />
                                    <Route path="branches" element={<Navigate to="/sucursales" replace />} />
                                    <Route path="ios-test" element={<Navigate to="/prueba-ios" replace />} />
                                    <Route path="my-announcements" element={<Navigate to="/mis-avisos" replace />} />
                                    <Route path="my-documents" element={<Navigate to="/mis-documentos" replace />} />
                                    <Route path="orphan-objects" element={<Navigate to="/objetos-huerfanos" replace />} />
                                    <Route path="payroll" element={<Navigate to="/nomina" replace />} />
                                    <Route path="permissions" element={<Navigate to="/permisos" replace />} />
                                    <Route path="profile" element={<Navigate to="/mi-perfil" replace />} />
                                    <Route path="requests-personales" element={<Navigate to="/solicitudes-personales" replace />} />
                                    <Route path="requests" element={<Navigate to="/solicitudes" replace />} />
                                    <Route path="roles" element={<Navigate to="/cargos" replace />} />
                                    <Route path="schedules" element={<Navigate to="/horarios" replace />} />
                                    <Route path="sync-health" element={<Navigate to="/actualizacion-de-datos" replace />} />
                                    <Route path="vacation-plan" element={<Navigate to="/vacaciones" replace />} />
                                    <Route path="branches/:id" element={<IrAFichaDeSucursal />} />
                                    <Route path="dashboard" element={<Navigate to="/personal" replace />} />
                                    <Route path="dashboard/empleado/:id" element={<IrAFichaDePersonal />} />
                                    <Route path="overview" element={<Navigate to="/inicio" replace />} />
                                    <Route path="employee-detail" element={<Navigate to="/personal" replace />} />
                                    <Route path="staff" element={<Navigate to="/personal" replace />} />
                                    {/* D3.7 — antes esto era un <Navigate> silencioso al primer módulo con
                                        permiso: el usuario aterrizaba en otra pantalla sin saber si el
                                        enlace estaba roto o si le faltaba acceso. */}
                                    <Route path="*" element={<NotFoundView />} />
                                </Routes>
                                </Suspense>
                                </ErrorBoundary>
                            </AppLayout>
                        </div>

                        {modalYaUsado && (
                        <Suspense fallback={null}>
                        <UnifiedModal
                            isOpen={modalOpen}
                            onClose={() => setModalOpen(false)}
                            type={modalType}
                            formData={formData}
                            setFormData={setFormData}
                            handleSubmit={handleSubmit}
                            activeEmployee={activeEmployee || user}
                        />
                        </Suspense>
                        )}
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

// ── El título del navegador nombra la MISMA pantalla que su encabezado ──────
// Esta tabla venía derivando de las otras cuatro que nombran un módulo (el
// `title=` de la vista, `moduleMap`, `permissionModules` y el menú), y como
// nada la cruza con ellas, terminó contradiciéndolas en 13 rutas: `/dashboard`
// decía «Dashboard» —resto de antes de que el tablero pasara a llamarse
// «Inicio», y encima esa ruta es el listado de personal—, `/payroll` decía
// «Planilla» mientras el menú y el encabezado dicen «Nómina», y `/monitor`
// decía «Asistencia», que es el nombre de OTRO grupo del menú.
//
// La regla, para que no vuelva a pasar: **la pestaña se copia del encabezado de
// la vista**, no del menú. El menú puede abreviar porque se lee dentro de su
// grupo («Listado» bajo Personal); la pestaña se lee sola, entre otras veinte.
//
// Faltaban además 19 rutas, que caían al genérico «Portal FarmaSalud».
const ROUTE_TITLES = {
    '/inicio':            'Inicio',
    '/personal':          'Gestión de personal',
    '/monitor':           'Monitor en tiempo real',
    '/auditoria-de-tiempos':             'Auditoría de tiempos',
    '/horarios':         'Horarios',
    '/solicitudes':          'Solicitudes de sucursal',
    '/solicitudes-personales': 'Solicitudes personales',
    '/vacaciones':     'Plan anual de vacaciones',
    '/nomina':           'Nómina',
    '/bonificaciones':    'Bonificaciones',
    '/entrevistas':       'Entrevistas',
    '/avisos':            'Gestión de avisos',
    '/ventas':            'Ventas',
    '/cortes':            'Cortes de caja',
    '/bolsas':            'Bolsas de efectivo',
    '/facturacion':       'Facturación',
    '/cotizaciones':      'Cotizaciones',
    '/clientes':          'Clientes',
    '/metas':             'Metas',
    '/productos':         'Productos',
    '/laboratorios':      'Laboratorios',
    '/pedidos':           'Pedidos a sucursales',
    '/traslados':         'Traslados entre salas',
    '/inventario':        'Inventario',
    '/gestion-stock':     'Gestión de stock',
    '/minmax':            'Min / Max',
    '/ventas-perdidas':   'Ventas perdidas',
    '/encuesta':          'Clima organizacional',
    '/encuesta-admin':    'Gestión de encuestas',
    '/compras':           'Compras (Bodega)',
    '/facturas-compra':   'Facturas de compra',
    '/facturas-sala':     'Facturas de sala',
    '/cuentas-por-pagar': 'Cuentas por pagar',
    '/cargar-compra':     'Cargar compra',
    '/proveedores':       'Proveedores',
    '/libros-iva':        'Libros IVA',
    '/libro-compras-completo': 'Compras completo',
    '/cierre-periodo':    'Cierre de período',
    '/resumen-fiscal':    'Resumen fiscal',
    '/corte-z':           'Corte Z',
    '/conteo-inventario': 'Conteo de inventario',
    '/bitacoras':         'Bitácoras',
    '/sucursales':          'Sucursales',
    '/cargos':            'Cargos y organigrama',
    '/permisos':       'Permisos de acceso',
    '/auditoria-del-sistema':         'Auditoría de sistema',
    '/mantenimiento':     'Mantenimiento',
    '/actualizacion-de-datos':       'Actualización de datos',
    '/sesiones':          'Conexiones',
    '/objetos-huerfanos':    'Objetos huérfanos',
    '/prueba-ios':          'Vista de prueba iOS',
    '/carnes-del-dia':    'Carnés del día',
    '/impresion':         'Prueba de impresión',
    '/mis-avisos':  'Mis avisos',
    '/mis-documentos':      'Mis documentos',
    '/mi-perfil':           'Mi perfil',
    '/kiosk':             'Reloj',
    '/login':             'Portal FarmaSalud',
};

const AppWithToast = () => {
    const location = useLocation();
    const isKioskMode = location.pathname.startsWith('/kiosk');

    useEffect(() => {
        const path = location.pathname;
        const base = '/' + path.split('/')[1];
        const esFichaDePersonal = path.startsWith('/personal/empleado/');
        // El path COMPLETO primero y la base como respaldo. Con la base sola,
        // toda subruta heredaba el título de su padre: `/personal/equipos`
        // decía «Gestión de personal» y su entrada en el mapa no se usaba
        // nunca — un rótulo escrito que nada leía, y nada lo iba a delatar.
        const label = esFichaDePersonal
            ? 'Perfil de empleado'
            : (ROUTE_TITLES[path] ?? ROUTE_TITLES[base] ?? null);
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
                {/* Fuera de <Routes> a propósito: el aviso tiene que estar puesto
                    también en /login y /kiosk, o sea ANTES de que alguien escriba
                    una credencial creyendo que está en producción. */}
                <AvisoEntornoPruebas />
                {/* Fuera de <Routes> por el mismo motivo y por uno propio: es lo
                    que reemplazó a la recarga automática, así que tiene que
                    estar puesto en toda ruta —incluido el kiosco, que vive
                    encendido en una tablet y es el que más días acumula con el
                    mismo bundle. */}
                <AvisoVersionNueva />
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
        <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-brand/25 rounded-full filter blur-[100px] animate-ambient-drift" />
        <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-brand-purple/25 rounded-full filter blur-[100px] animate-ambient-drift-reverse" />
        <div
            className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-success/15 rounded-full filter blur-[120px] animate-ambient-drift"
            style={{ animationDelay: "3s" }}
        />
    </div>
);