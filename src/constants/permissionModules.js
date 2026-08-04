// Registro de módulos para permisos: grupo → módulos con etiqueta CLARA,
// descripción de una línea, ícono y sus pestañas.
//
// Vivía dentro de PermissionsView.jsx. Se extrajo el 2026-07-29 para que la vista
// de Mantenimiento muestre los mismos nombres — a pedido del usuario, "el nombre
// de los módulos debe ser claro, como en permisos". El registro de AppLayout
// (constants/moduleMap.js) tiene etiquetas de MENÚ, que son más cortas y a veces
// ambiguas fuera de su grupo: ahí `staff_list` es "Listado" y acá es "Listado de
// Personal"; `staff_detail` no está en el menú y acá es "Expediente Completo".
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, MousePointerClick,
    TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock, Gift, DollarSign, FileText, Package, Receipt, Target, FlaskConical, Smartphone,
    Sparkles, Layers, Globe2, BadgeAlert, PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Truck,
    BookOpen, Contact
} from 'lucide-react';

export const MODULE_GROUPS = [
    {
        group: 'Autogestión',
        color: 'text-success-text',
        modules: [
            { key: 'emp_requests',      label: 'Mis Solicitudes',     desc: 'Crear y seguir solicitudes propias (permiso, vacación, etc.)', icon: ClipboardList, hasApprove: false },
            { key: 'emp_announcements', label: 'Mis Avisos',          desc: 'Recibir y leer comunicados internos dirigidos al empleado',  icon: Bell,          hasApprove: false },
            { key: 'emp_profile',       label: 'Mi Perfil',           desc: 'Ver y actualizar datos personales propios',                  icon: User,          hasApprove: false },
            { key: 'emp_documents',     label: 'Mis Documentos',      desc: 'Consultar documentos personales: incapacidades, constancias, etc.', icon: FolderOpen, hasApprove: false },
        ],
    },
    {
        group: 'Personal',
        color: 'text-chart-3-text',
        modules: [
            { key: 'staff_list',   label: 'Listado de Personal',    desc: 'Ver y buscar empleados, datos básicos y estado',            icon: User,          hasApprove: false, hasScope: true },
            { key: 'staff_detail', label: 'Expediente Completo',    desc: 'Perfil, historial, eventos y documentos del empleado',      icon: User,          hasApprove: false, hasScope: true },
            { key: 'staff_salary', label: 'Salarios e Ingresos',    desc: 'Información salarial y ajustes de nómina (datos sensibles)',icon: User,          hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Asistencia',
        color: 'text-warning',
        modules: [
            { key: 'monitor',      label: 'Monitor Real-Time',      desc: 'Monitoreo en vivo de marcaciones y asistencia activa',      icon: Monitor,       hasApprove: false, hasScope: true },
            { key: 'time_audit',   label: 'Auditoría de Tiempos',   desc: 'Revisión y corrección de marcaciones históricas',           icon: AlertTriangle, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Operaciones',
        color: 'text-chart-1-text',
        modules: [
            { key: 'schedules',    label: 'Horarios y Turnos',      desc: 'Creación y asignación de horarios semanales',               icon: Calendar,      hasApprove: false, hasScope: true, tabs: [
                { key: 'schedules_tab_calendar', label: 'Calendario' },
                { key: 'schedules_tab_shifts',   label: 'Catálogo de Turnos' },
                { key: 'schedules_tab_holidays', label: 'Feriados' },
            ]},
            { key: 'requests',     label: 'Solicitudes',            desc: 'Revisión y aprobación de permisos, vacaciones e incapacidades', icon: ClipboardList, hasApprove: true,  hasScope: true },
            { key: 'vacation_plan',label: 'Plan de Vacaciones',     desc: 'Planificación anual de períodos vacacionales',              icon: Palmtree,      hasApprove: false, hasScope: true },
            { key: 'payroll',      label: 'Nómina',                 desc: 'Generación, edición y aprobación de planillas quincenales',  icon: DollarSign,    hasApprove: true,  hasScope: true },
        ],
    },
    {
        group: 'Comercial',
        color: 'text-success',
        modules: [
            { key: 'ventas',        label: 'Ventas',        desc: 'Anulaciones en tiempo real, ranking de vendedores y productos más vendidos', icon: TrendingUp, hasApprove: false, hasScope: true, tabs: [
                { key: 'ventas_tab_ventas',     label: 'Ventas'     },
                { key: 'ventas_tab_vendedores', label: 'Vendedores' },
                { key: 'ventas_tab_productos',  label: 'Productos'  },
            ]},
            { key: 'facturacion',   label: 'Facturación',   desc: 'Anuladas, pendientes MH, saltos de correlativo, pagos no-efectivo y observaciones', icon: FileText,   hasApprove: false, hasScope: true, tabs: [
                { key: 'facturacion_tab_anuladas',      label: 'Anuladas'      },
                { key: 'facturacion_tab_pendiente_mh',  label: 'Pendiente MH'  },
                { key: 'facturacion_tab_saltos',        label: 'Saltos'        },
                { key: 'facturacion_tab_no_efectivo',   label: 'No Efectivo'   },
                { key: 'facturacion_tab_observaciones', label: 'Observaciones' },
            ]},
            { key: 'cotizaciones',   label: 'Cotizaciones',  desc: 'Crear, guardar e imprimir cotizaciones con productos del catálogo, IVA y retención', icon: Receipt,       hasApprove: false, hasScope: true },
            { key: 'clientes',       label: 'Clientes',      desc: 'Ficha fiscal del cliente: identidad (DUI/NIT/NRC), categoría, contacto y ubicación con la cascada departamento-municipio-distrito. Muestra la facturación de cada cliente para saber qué ficha vale la pena completar. Editar = corregir la ficha; los datos de un contribuyente exigen confirmación aparte', icon: Contact, hasApprove: false },
            { key: 'metas',          label: 'Metas',         desc: 'Dashboard de metas de ventas por sucursal con proyecciones y gráficas (próximamente)', icon: Target,        hasApprove: false, comingSoon: true },
            { key: 'bonificaciones', label: 'Bonificaciones',desc: 'Esquemas de bonificación por ventas y metas alcanzadas (próximamente)',                icon: DollarSign,    hasApprove: false, comingSoon: true },
        ],
    },
    {
        group: 'Inventario',
        color: 'text-chart-9-text',
        modules: [
            { key: 'productos', label: 'Productos', desc: 'Catálogo de productos, ubicaciones por sucursal, costos, precios e inventario en tiempo real', icon: Package, hasApprove: false, tabs: [
                { key: 'productos_tab_catalogo',        label: 'Catálogo'   },
                { key: 'productos_tab_catalogo_costos', label: 'Catálogo: Costos de Compra' },
                { key: 'productos_tab_inventario',      label: 'Inventario' },
                { key: 'productos_tab_sinventa',        label: 'Sin Venta'  },
            ]},
            { key: 'minmax', label: 'Min / Max', desc: 'Análisis de stock mínimo y máximo por sucursal, clasificación ABC, variabilidad de demanda y ajuste manual de parámetros. Aprobar = publicar cambios y resolver solicitudes de ajuste', icon: BarChart2, hasApprove: true, hasScope: true, tabs: [
                { key: 'minmax_tab_sucursal',    label: 'Sucursal'    },
                { key: 'minmax_ver_costos',      label: 'Ver Costos (Compras/Ventas)' },
                { key: 'minmax_tab_red',         label: 'Red'         },
                { key: 'minmax_tab_solicitudes', label: 'Solicitudes' },
            ]},
            { key: 'ventas_perdidas', label: 'Ventas Perdidas', desc: 'Registro de productos solicitados sin stock; alertas de compra para logística con seguimiento de estado', icon: PackageMinus, hasApprove: false },
            { key: 'compras', label: 'Compras', desc: 'Historial de facturas de compra de Bodega: facturas por fecha y proveedor, detalle de ítems y resumen por producto', icon: ShoppingCart, hasApprove: false },
            { key: 'proveedores', label: 'Proveedores', desc: 'Maestro de proveedores auto-registrado desde los DTE de compra: datos fiscales, categoría contable y vinculación manual con el proveedor registrado', icon: Truck, hasApprove: false },
            { key: 'conteo_inventario', label: 'Conteo de Inventario', desc: 'Auditoría física de stock por sucursal/bodega: snapshot del sistema, captura de conteo físico, faltantes/sobrantes, impresión de hoja y resultados. Aprobar = firmar el conteo finalizado', icon: ClipboardCheck, hasApprove: true, hasScope: true, tabs: [
                // El conteo es CIEGO mientras está abierto: sin este permiso la
                // existencia del sistema NO SALE de la base (no es un switch en
                // la vista, que era lo de antes). Con el conteo ya finalizado los
                // números son el resultado y los ve cualquiera que vea el módulo.
                { key: 'conteo_ver_sistema', label: 'Ver Existencia del Sistema (rompe el ciego)' },
            ]},
            { key: 'laboratorios', label: 'Laboratorios', desc: 'Lista de laboratorios con su ubicación física en bodega, editable por módulo', icon: FlaskConical, hasApprove: false },
            { key: 'pedidos', label: 'Pedidos a Sucursales', desc: 'Generación de pedidos de reposición de Bodega hacia sucursales, seguimiento en tiempo real y recepción por sucursal', icon: Package, hasApprove: false, hasScope: true, tabs: [
                { key: 'pedidos_tab_generar',   label: 'Generar'              },
                { key: 'pedidos_tab_historial', label: 'Pedidos (unificado)'  },
                { key: 'pedidos_tab_rutas',     label: 'Rutas de entrega'     },
                { key: 'pedidos_tab_metricas',  label: 'Métricas'             },
                { key: 'pedidos_tab_reglas',    label: 'Reglas de despacho'   },
            ]},
        ],
    },
    {
        // Datos Contables (2026-07-31). El grupo del menú y el de esta pantalla
        // se mantienen espejados a propósito: si el permiso vive en "Inventario"
        // y el menú lo muestra en "Datos Contables", quien reparte accesos lo
        // busca donde no está.
        group: 'Datos Contables',
        color: 'text-chart-1-text',
        modules: [
            { key: 'facturas_compra', label: 'Facturas de Compra (Correo)', desc: 'Facturas de compra (DTE) sincronizadas automáticamente desde las bandejas de correo de la empresa: descarga de JSON/PDF, match de proveedor y cola de revisión de adjuntos sin procesar', icon: FileText, hasApprove: false, tabs: [
                // Tres cosas distintas, tres permisos (pedido del usuario
                // 2026-08-03): ver el listado (facturas_compra.can_view),
                // ABRIR el documento en pantalla, y DESCARGAR el archivo. Sin
                // ninguno de los dos de abajo quedan fecha, proveedor, tipo,
                // n° de control y monto, y nada más.
                //
                // El gate no vive solo en la vista: `purchase_dte_storage_select`
                // exige uno de los dos para leer el bucket, y
                // `export-purchase-dte-manifest` (el ZIP masivo) exige
                // específicamente el de descarga.
                { key: 'facturas_compra_abrir',      label: 'Abrir el Documento (JSON/PDF)' },
                { key: 'facturas_compra_descargar',  label: 'Descargar Archivos (JSON/PDF/ZIP)' },
                { key: 'facturas_compra_ver_montos', label: 'Cards Contables' },
            ]},
            { key: 'libros_iva', label: 'Libros IVA', desc: 'Los siete libros y anexos de IVA, con exportación a CSV. Ventas: consumidor final (Art. 83), contribuyentes (Art. 85) y anexo de anulados, solo con sello de Hacienda. Compras: libro del Art. 86 y los anexos de percepción, retención y sujeto excluido', icon: BookOpen, hasApprove: false, hasScope: true },
            { key: 'corte_z', label: 'Corte Z', desc: 'El Corte Z mensual de cada sucursal, tal como lo declaró: las ventas con tiquete, con factura y con crédito fiscal, y el total general. Al lado va el mismo número calculado desde las facturas selladas por Hacienda, para cotejarlo. Se descarga en PDF, por sucursal o todas juntas', icon: Receipt, hasApprove: false, hasScope: true },
            { key: 'libro_compras_completo', label: 'Libro de Compras Completo', desc: 'El libro de compras con lo que la farmacia compró de verdad: las compras del ERP más los DTE recibidos por correo que nunca se registraron como compra. No reemplaza al libro de Libros IVA, que sale del ERP y sirve para cotejarse contra el archivo del origen. Exporta el número de documento completo, no el cortado a 20 caracteres', icon: BookOpen, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'RRHH',
        color: 'text-chart-3-text',
        modules: [
            { key: 'encuesta',       label: 'Clima Organizacional', desc: 'Dashboard de resultados de encuesta de clima 2026 con análisis por bloque, sucursal y empleado', icon: BarChart2,   hasApprove: false },
            { key: 'encuesta_admin', label: 'Gestión de Encuesta',  desc: 'Agregar y eliminar respuestas de encuestas de clima organizacional',                              icon: BarChart2,   hasApprove: false },
            { key: 'entrevistas',    label: 'Entrevistas',          desc: 'Gestión del proceso de selección y entrevistas de candidatos (próximamente)',                    icon: Briefcase,  hasApprove: false, comingSoon: true },
        ],
    },
    {
        group: 'Estructura',
        color: 'text-chart-9-text',
        modules: [
            { key: 'branches',     label: 'Sucursales',             desc: 'Gestión de sucursales, contratos y datos operativos',       icon: Building2,     hasApprove: false },
            { key: 'roles',        label: 'Cargos / Organigrama',   desc: 'Estructura organizacional, jerarquías y cargos',            icon: ShieldCheck,   hasApprove: false },
        ],
    },
    {
        group: 'Comunicación',
        color: 'text-danger-text',
        modules: [
            { key: 'announcements',label: 'Avisos',                 desc: 'Publicación y gestión de comunicados internos',             icon: Megaphone,     hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Dashboard',
        color: 'text-chart-3-text',
        modules: [
            { key: 'overview',          label: 'Inicio',                     desc: 'Acceso a la vista general del portal con widgets configurables',           icon: Home, hasApprove: false, hasScope: true },
            { key: 'dash_kpi',          label: 'Widget: Estadísticas clave', desc: 'Ver métricas generales: empleados, asistencia, solicitudes y sucursales',  icon: TrendingUp,      hasApprove: false, hasScope: true },
            { key: 'dash_trend',        label: 'Widget: Tendencia asistencia',desc: 'Gráfica de asistencia de los últimos 7 días por día',                      icon: Activity,        hasApprove: false, hasScope: true },
            { key: 'dash_requests',     label: 'Widget: Solicitudes',         desc: 'Solicitudes pendientes de aprobación en el dashboard',                     icon: ClipboardList,   hasApprove: false, hasScope: true },
            { key: 'dash_branches',     label: 'Widget: Sucursales',          desc: 'Estado y alertas de sucursales en el dashboard',                           icon: Building2,       hasApprove: false, hasScope: true },
            { key: 'dash_calendar',     label: 'Widget: Calendario',          desc: 'Calendario mensual con feriados y eventos',                               icon: CalendarDays,    hasApprove: false },
            { key: 'dash_distribution', label: 'Widget: Distribución cargos', desc: 'Gráfica de distribución de personal por cargo',                           icon: PieChart,        hasApprove: false, hasScope: true },
            { key: 'dash_announcements',label: 'Widget: Avisos recientes',    desc: 'Últimos avisos publicados en el dashboard',                               icon: Megaphone,       hasApprove: false, hasScope: true },
            { key: 'dash_shifts',       label: 'Widget: Estado de turnos',    desc: 'Ver quién está en labores, almuerzo o lactancia por sucursal en tiempo real', icon: Clock,       hasApprove: false, hasScope: true },
            { key: 'dash_absences',     label: 'Widget: Ausencias activas',   desc: 'Empleados con vacaciones, incapacidad o permiso activos hoy',              icon: UserX,           hasApprove: false, hasScope: true },
            { key: 'dash_sales',          label: 'Widget: Ventas por hora',       desc: 'Historial promedio de transacciones por hora del día por sucursal',        icon: BarChart2,       hasApprove: false, hasScope: true },
            { key: 'dash_birthdays',      label: 'Widget: Cumpleaños del mes',    desc: 'Cumpleañeros del mes con foto, sucursal y edad',                           icon: Gift,            hasApprove: false, hasScope: true },
            { key: 'dash_cotizaciones',   label: 'Widget: Cotizaciones activas',  desc: 'Resumen de cotizaciones activas del mes con montos en el dashboard',       icon: Receipt,         hasApprove: false, hasScope: true },
            { key: 'dash_facturacion',    label: 'Widget: Facturación hoy',       desc: 'Documentos emitidos hoy (CCF/FCF) con total facturado en el dashboard',   icon: FileText,        hasApprove: false, hasScope: true },
            { key: 'dash_top_productos',  label: 'Widget: Top Productos del mes', desc: 'Ranking de los 10 productos más vendidos en el mes actual',               icon: Package,         hasApprove: false, hasScope: true },
            { key: 'dash_inv_search',     label: 'Widget: Consulta de Inventario',desc: 'Buscar productos en inventario multi-sucursal con desglose de lotes y vencimientos', icon: Package,    hasApprove: false, hasScope: true },
            { key: 'dash_annulment_req',  label: 'Widget: Solicitud de Anulación',desc: 'Crear solicitudes de anulación de facturas dentro del período de gracia de 3 días',  icon: Receipt,    hasApprove: false, hasScope: true },
            { key: 'dash_srs_inv',        label: 'Widget: Búsqueda SRS + Stock',  desc: 'Consultar el registro SRS de medicamentos y cruzar con inventario propio',            icon: FlaskConical,hasApprove: false, hasScope: true },
            { key: 'dash_minmax_req',     label: 'Widget: Ajuste de Min/Max',     desc: 'Proponer cambios de mínimo/máximo por producto y sucursal; se envían a aprobación del supervisor', icon: BarChart2, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Sistema',
        color: 'text-content-2',
        modules: [
            { key: 'kiosk_pin',    label: 'PIN de Marcación',       desc: 'Ver y copiar el PIN personal para marcar en el kiosco',     icon: ShieldCheck,   hasApprove: false },
            { key: 'su_pin',       label: 'Código SU (Supervisores)', desc: 'Ver el código SU de 6 dígitos para autorizar marcajes de jefes y subjefes', icon: ShieldAlert, hasApprove: false },
            { key: 'permissions',  label: 'Permisos de Acceso',     desc: 'Control de acceso por rol a módulos del sistema',           icon: Lock,          hasApprove: false },
            { key: 'auditview',    label: 'Auditoría General',      desc: 'Registro completo de cambios y acciones en el sistema',     icon: Activity,      hasApprove: false },
            { key: 'ios_test',     label: 'Prueba iOS',             desc: 'Vista de prueba para verificar safe areas y layout en iOS', icon: Smartphone,    hasApprove: false },
            { key: 'sync_health',  label: 'Salud de Syncs',         desc: 'Historial de corridas de sync por dominio (productos/minmax/compras/backup) y alertas de fallo', icon: RadioTower, hasApprove: false },
            { key: 'orphan_objects', label: 'Objetos Huérfanos',   desc: 'Tablero de seguimiento de candidatos a código muerto (componentes, funciones, edge functions sin caller)', icon: Ghost, hasApprove: false },
        ],
    },
];

// Plano: key → { label, desc, icon, group }. Incluye las pestañas, que también
// son claves de role_permissions (y por lo tanto bloqueables).
export const MODULE_INFO = Object.fromEntries(
    MODULE_GROUPS.flatMap(g => g.modules.flatMap(m => [
        [m.key, { label: m.label, desc: m.desc, icon: m.icon, group: g.group }],
        ...(m.tabs || []).map(t => [t.key, {
            label: `${m.label} › ${t.label}`,
            desc: `Pestaña "${t.label}" dentro de ${m.label}`,
            icon: m.icon,
            group: g.group,
        }]),
    ])),
);
