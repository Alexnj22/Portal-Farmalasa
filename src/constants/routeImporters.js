// ── Carga diferida de las vistas ────────────────────────────────────────────
// Los import() viven en ESTE objeto y no sueltos en cada lazy() para que el
// prefetch del menú pueda reusar exactamente la misma función: al pasar el
// mouse por un ítem se dispara su import(), así el chunk ya está resuelto y
// evaluado cuando se hace clic. Medido antes de esto: la primera entrada a un
// módulo tardaba entre 350 y 850 ms y la segunda 60 ms — la diferencia es
// justamente resolver y evaluar el módulo.
export const IMPORTADORES = {
    EmployeeAnnouncementsView: () => import("../views/employee/EmployeeAnnouncementsView"),
    EmployeeRequestsView: () => import("../views/employee/EmployeeRequestsView"),
    EmployeeProfileView: () => import("../views/employee/EmployeeProfileView"),
    EmployeeDocumentsView: () => import("../views/employee/EmployeeDocumentsView"),
    AttendanceMonitorView: () => import("../views/AttendanceMonitorView"),
    StaffManagementView: () => import("../views/StaffManagementView"),
    BranchesView: () => import("../views/BranchesView"),
    BranchDetailView: () => import("../views/BranchDetailView"),
    RolesView: () => import("../views/RolesView"),
    PermissionsView: () => import("../views/PermissionsView"),
    SchedulesView: () => import("../views/SchedulesView"),
    EmployeeDetailView: () => import("../views/EmployeeDetailView"),
    TimeClockView: () => import("../views/TimeClockView"),
    AnnouncementsView: () => import("../views/AnnouncementsView"),
    AttendanceAuditView: () => import("../views/AttendanceAuditView"),
    LoginView: () => import("../views/LoginView"),
    AuditView: () => import("../views/AuditView"),
    IOSTestView: () => import("../views/IOSTestView"),
    SyncHealthView: () => import("../views/SyncHealthView"),
    OrphanObjectsView: () => import("../views/OrphanObjectsView"),
    MaintenanceView: () => import("../views/MaintenanceView"),
    RawTestView: () => import("../views/RawTestView"),
    RequestsView: () => import("../views/RequestsView"),
    VacationPlanView: () => import("../views/VacationPlanView"),
    PayrollView: () => import("../views/PayrollView"),
    VentasView: () => import("../views/VentasView"),
    ProductosView: () => import("../views/ProductosView"),
    LaboratoriosView: () => import("../views/LaboratoriosView"),
    PedidosView: () => import("../views/PedidosView"),
    MinMaxView: () => import("../views/MinMaxView"),
    VentasPperdidasView: () => import("../views/VentasPperdidasView"),
    ComprasView: () => import("../views/ComprasView"),
    FacturasCompraView: () => import("../views/purchases/FacturasCompraView"),
    LibrosIvaView: () => import("../views/contabilidad/LibrosIvaView"),
    LibroComprasCompletoView: () => import("../views/contabilidad/LibroComprasCompletoView"),
    CorteZView: () => import("../views/contabilidad/CorteZView"),
    MetasView: () => import("../views/metas/MetasView"),
    ProveedoresView: () => import("../views/purchases/ProveedoresView"),
    ClientesView: () => import("../views/ClientesView"),
    ConteoInventarioView: () => import("../views/ConteoInventarioView"),
    ConteoDetailView: () => import("../views/inventario/ConteoDetailView"),
    FacturacionView: () => import("../views/FacturacionView"),
    CotizacionesView: () => import("../views/CotizacionesView"),
    EncuestaView: () => import("../views/EncuestaView"),
    EncuestaAdminView: () => import("../views/EncuestaAdminView"),
    NoAccessView: () => import("../views/NoAccessView"),
    AccessDeniedView: () => import("../views/AccessDeniedView"),
    DashboardView: () => import("../views/DashboardView"),
    NotFoundView: () => import("../views/NotFoundView"),
};

// Primer segmento de la ruta → vista que la atiende. GENERADO leyendo las
// <Route> de App.jsx (no escrito a mano): si una vista se renombra y este mapa
// queda viejo, el prefetch simplemente no encuentra la clave y no hace nada —
// nunca rompe la navegación, que sigue con el lazy() normal.
export const IMPORTADOR_POR_RUTA = {
    '*': IMPORTADORES.NotFoundView,
    'announcements': IMPORTADORES.AnnouncementsView,
    'audit': IMPORTADORES.AttendanceAuditView,
    'auditview': IMPORTADORES.AuditView,
    'clientes': IMPORTADORES.ClientesView,
    'compras': IMPORTADORES.ComprasView,
    'conteo-inventario': IMPORTADORES.ConteoInventarioView,
    'cotizaciones': IMPORTADORES.CotizacionesView,
    'encuesta': IMPORTADORES.EncuestaView,
    'encuesta-admin': IMPORTADORES.EncuestaAdminView,
    'facturacion': IMPORTADORES.FacturacionView,
    'facturas-compra': IMPORTADORES.FacturasCompraView,
    'libros-iva': IMPORTADORES.LibrosIvaView,
    'libro-compras-completo': IMPORTADORES.LibroComprasCompletoView,
    'corte-z': IMPORTADORES.CorteZView,
    'metas': IMPORTADORES.MetasView,
    'ios-test': IMPORTADORES.IOSTestView,
    'laboratorios': IMPORTADORES.LaboratoriosView,
    'mantenimiento': IMPORTADORES.MaintenanceView,
    'minmax': IMPORTADORES.MinMaxView,
    'monitor': IMPORTADORES.AttendanceMonitorView,
    'my-announcements': IMPORTADORES.EmployeeAnnouncementsView,
    'my-documents': IMPORTADORES.EmployeeDocumentsView,
    'my-requests': IMPORTADORES.EmployeeRequestsView,
    'orphan-objects': IMPORTADORES.OrphanObjectsView,
    'overview': IMPORTADORES.DashboardView,
    'payroll': IMPORTADORES.PayrollView,
    'pedidos': IMPORTADORES.PedidosView,
    'permissions': IMPORTADORES.PermissionsView,
    'productos': IMPORTADORES.ProductosView,
    'profile': IMPORTADORES.EmployeeProfileView,
    'proveedores': IMPORTADORES.ProveedoresView,
    'raw-test': IMPORTADORES.RawTestView,
    'requests': IMPORTADORES.RequestsView,
    'roles': IMPORTADORES.RolesView,
    'schedules': IMPORTADORES.SchedulesView,
    'sync-health': IMPORTADORES.SyncHealthView,
    'vacation-plan': IMPORTADORES.VacationPlanView,
    'ventas': IMPORTADORES.VentasView,
    'ventas-perdidas': IMPORTADORES.VentasPperdidasView,
};

// Dispara la carga del módulo de una ruta. Idempotente: el import() de Vite
// cachea la promesa, así que pasar el mouse veinte veces por el mismo ítem no
// descarga nada dos veces.
export function prefetchRuta(pathname) {
    const seg = String(pathname || '').split('/')[1] || '';
    const cargar = IMPORTADOR_POR_RUTA[seg];
    if (cargar) cargar().catch(() => { /* si falla, el lazy() lo reintenta al navegar */ });
}
