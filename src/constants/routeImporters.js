// ── Carga diferida de las vistas ────────────────────────────────────────────
// Los import() viven en ESTE objeto y no sueltos en cada lazy() para que el
// prefetch del menú pueda reusar exactamente la misma función: al pasar el
// mouse por un ítem se dispara su import(), así el chunk ya está resuelto y
// evaluado cuando se hace clic. Medido antes de esto: la primera entrada a un
// módulo tardaba entre 350 y 850 ms y la segunda 60 ms — la diferencia es
// justamente resolver y evaluar el módulo.
export const IMPORTADORES = {
    EmployeeAnnouncementsView: () => import("../views/employee/EmployeeAnnouncementsView"),
    EmployeeProfileView: () => import("../views/employee/EmployeeProfileView"),
    EmployeeDocumentsView: () => import("../views/employee/EmployeeDocumentsView"),
    AttendanceMonitorView: () => import("../views/AttendanceMonitorView"),
    // `/personal` desde el 2026-08-26: el equipo agrupado por sucursal.
    EquiposView: () => import("../views/personal/EquiposView"),
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
    ImpresionView: () => import("../views/ImpresionView"),
    CarnesDelDiaView: () => import("../views/CarnesDelDiaView"),
    SyncHealthView: () => import("../views/SyncHealthView"),
    SesionesView: () => import("../views/SesionesView"),
    OrphanObjectsView: () => import("../views/OrphanObjectsView"),
    MaintenanceView: () => import("../views/MaintenanceView"),
    RawTestView: () => import("../views/RawTestView"),
    RequestsView: () => import("../views/RequestsView"),
    VacationPlanView: () => import("../views/VacationPlanView"),
    PayrollView: () => import("../views/PayrollView"),
    VentasView: () => import("../views/VentasView"),
    CortesView: () => import("../views/CortesView"),
    BolsasView: () => import("../views/BolsasView"),
    CuentasPorCobrarView: () => import("../views/CuentasPorCobrarView"),
    MiCajaView: () => import("../views/MiCajaView"),
    /* «Efectivo» son DOS chunks y el segundo no se puede descubrir solo.
     *
     * `CortesView` es el anfitrión y `MiCajaView` su pestaña «Hoy», diferida
     * adentro. Precargando sólo al anfitrión, el navegador no se entera de que
     * la otra existe hasta que baja y EVALÚA la primera: dos viajes en fila de
     * ~215 ms cada uno, medidos contra producción, y el segundo no podía
     * arrancar antes aunque la conexión estuviera libre.
     *
     * Pedirlas juntas las pone a viajar a la vez. No cambia quién paga el peso
     * —siguen siendo dos chunks, así que Contabilidad, que no tiene
     * `caja_vales`, nunca evalúa el de «Hoy»— sólo cuándo se piden. */
    CajaCompleta: () => Promise.all([
        import("../views/CortesView"),
        import("../views/MiCajaView"),
    ]).then(([anfitrion]) => anfitrion),
    ProductosView: () => import("../views/ProductosView"),
    LaboratoriosView: () => import("../views/LaboratoriosView"),
    PedidosView: () => import("../views/PedidosView"),
    GestionStockView: () => import("../views/GestionStockView"),
    InventarioView: () => import("../views/InventarioView"),
    MinMaxView: () => import("../views/MinMaxView"),
    TrasladosView: () => import("../views/TrasladosView"),
    VentasPperdidasView: () => import("../views/VentasPperdidasView"),
    ComprasView: () => import("../views/ComprasView"),
    FacturasSalaView: () => import("../views/purchases/FacturasSalaView"),
    CuentasPorPagarView: () => import("../views/purchases/CuentasPorPagarView"),
    CargarCompraView: () => import("../views/purchases/CargarCompraView"),
    FacturasCompraView: () => import("../views/purchases/FacturasCompraView"),
    LibrosIvaView: () => import("../views/contabilidad/LibrosIvaView"),
    LibroComprasCompletoView: () => import("../views/contabilidad/LibroComprasCompletoView"),
    CierrePeriodoView: () => import("../views/contabilidad/CierrePeriodoView"),
    ResumenFiscalView: () => import("../views/contabilidad/ResumenFiscalView"),
    CorteZView: () => import("../views/contabilidad/CorteZView"),
    MetasView: () => import("../views/metas/MetasView"),
    PromocionesView: () => import("../views/promociones/PromocionesView"),
    ProveedoresView: () => import("../views/purchases/ProveedoresView"),
    ClientesView: () => import("../views/ClientesView"),
    MisPuntosView: () => import("../views/MisPuntosView"),
    NotificacionesView: () => import("../views/NotificacionesView"),
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
    BitacorasView: () => import("../views/BitacorasView"),
};

// Primer segmento de la ruta → vista que la atiende.
//
// Decía «GENERADO leyendo las <Route> de App.jsx», y no hay generador: se
// escribió a mano una vez. El 2026-08-26 se renombraron 19 rutas y este mapa
// quedó viejo, con el modo de falla que el comentario mismo describía — «el
// prefetch no encuentra la clave y no hace nada». No rompe nada: sólo hace que
// 19 vistas carguen lento la primera vez, sin error y sin que nadie lo note.
// (Y `cortes` estaba desde antes como `cortes_caja`, que es la clave del MÓDULO
// y no el segmento de la ruta: Cortes de caja nunca se precargó.)
//
// Hoy lo verifica `npm run gate:rutas`: toda ruta que no sea una redirección
// tiene que tener su clave acá.
export const IMPORTADOR_POR_RUTA = {
    '*': IMPORTADORES.NotFoundView,
    'avisos': IMPORTADORES.AnnouncementsView,
    'auditoria-de-tiempos': IMPORTADORES.AttendanceAuditView,
    'auditoria-del-sistema': IMPORTADORES.AuditView,
    'bitacoras': IMPORTADORES.BitacorasView,
    'clientes': IMPORTADORES.ClientesView,
    'mis-puntos': IMPORTADORES.MisPuntosView,
    'compras': IMPORTADORES.ComprasView,
    'facturas-sala': IMPORTADORES.FacturasSalaView,
    'cuentas-por-pagar': IMPORTADORES.CuentasPorPagarView,
    'cargar-compra': IMPORTADORES.CargarCompraView,
    'conteo-inventario': IMPORTADORES.ConteoInventarioView,
    'cotizaciones': IMPORTADORES.CotizacionesView,
    'encuesta': IMPORTADORES.EncuestaView,
    'encuesta-admin': IMPORTADORES.EncuestaAdminView,
    'facturacion': IMPORTADORES.FacturacionView,
    'gestion-stock': IMPORTADORES.GestionStockView,
    'inventario': IMPORTADORES.InventarioView,
    'facturas-compra': IMPORTADORES.FacturasCompraView,
    'libros-iva': IMPORTADORES.LibrosIvaView,
    'libro-compras-completo': IMPORTADORES.LibroComprasCompletoView,
    'cierre-periodo': IMPORTADORES.CierrePeriodoView,
    'resumen-fiscal': IMPORTADORES.ResumenFiscalView,
    'corte-z': IMPORTADORES.CorteZView,
    'metas': IMPORTADORES.MetasView,
    'promociones': IMPORTADORES.PromocionesView,
    'impresion': IMPORTADORES.ImpresionView,
    'carnes-del-dia': IMPORTADORES.CarnesDelDiaView,
    'prueba-ios': IMPORTADORES.IOSTestView,
    'laboratorios': IMPORTADORES.LaboratoriosView,
    'mantenimiento': IMPORTADORES.MaintenanceView,
    'minmax': IMPORTADORES.MinMaxView,
    'traslados': IMPORTADORES.TrasladosView,
    'monitor': IMPORTADORES.AttendanceMonitorView,
    'mis-avisos': IMPORTADORES.EmployeeAnnouncementsView,
    'notificaciones': IMPORTADORES.NotificacionesView,
    'mis-documentos': IMPORTADORES.EmployeeDocumentsView,
    // `/my-requests` se fusionó en `/solicitudes-personales` el 2026-08-11 y hoy
    // sólo redirige. Se deja porque el prefetch corre ANTES de la redirección:
    // precargar la vista destino desde el enlace viejo es exactamente lo que se
    // quiere.
    'my-requests': IMPORTADORES.RequestsView,
    'objetos-huerfanos': IMPORTADORES.OrphanObjectsView,
    'inicio': IMPORTADORES.DashboardView,
    'nomina': IMPORTADORES.PayrollView,
    'pedidos': IMPORTADORES.PedidosView,
    // Estas dos nunca estuvieron: el listado de personal y el de sucursales
    // no se precargaban desde que existe el mapa, y no había forma de
    // notarlo — un prefetch que no encuentra su clave no falla, no avisa y
    // no deja rastro. Las encontró el chequeo del gate, no una persona.
    'personal': IMPORTADORES.EquiposView,
    'sucursales': IMPORTADORES.BranchesView,
    'permisos': IMPORTADORES.PermissionsView,
    'productos': IMPORTADORES.ProductosView,
    'mi-perfil': IMPORTADORES.EmployeeProfileView,
    'proveedores': IMPORTADORES.ProveedoresView,
    'raw-test': IMPORTADORES.RawTestView,
    'solicitudes': IMPORTADORES.RequestsView,
    // Misma vista, otro ámbito y otro permiso — comparte el importador para que
    // el prefetch de una sirva a la otra.
    'solicitudes-personales': IMPORTADORES.RequestsView,
    'cargos': IMPORTADORES.RolesView,
    'horarios': IMPORTADORES.SchedulesView,
    'actualizacion-de-datos': IMPORTADORES.SyncHealthView,
    'sesiones': IMPORTADORES.SesionesView,
    'vacaciones': IMPORTADORES.VacationPlanView,
    'ventas': IMPORTADORES.VentasView,
    'cortes': IMPORTADORES.CortesView,
    'bolsas': IMPORTADORES.BolsasView,
    'cuentas-por-cobrar': IMPORTADORES.CuentasPorCobrarView,
    // «Efectivo» ES `CortesView` desde v2.914.0 — `MiCajaView` es su pestaña
    // «Hoy» y viaja adentro. Precargar la ruta tiene que traer LAS DOS: con el
    // anfitrión solo, el chunk de la pestaña esperaba a que éste terminara de
    // evaluarse. Ver `CajaCompleta`.
    'caja': IMPORTADORES.CajaCompleta,
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
