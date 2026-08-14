// Registro de módulos: key → path + label + icon.
//
// Vivía dentro de AppLayout.jsx. Se extrajo el 2026-07-29 porque
// ModuleLockBanner necesita resolver "¿qué módulo es esta ruta?" para poder
// montarse una sola vez en GlassViewLayout en lugar de a mano en cada vista —
// y un componente de `common/` no puede importar el layout entero.
import { CalendarCheck,
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Activity,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, Cake,
    TrendingUp, Gift, Users, Package, DollarSign, FileText, BarChart2, PenLine, Receipt, Target, FlaskConical, Smartphone,
    PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Mail, Truck, Boxes, Search, Wrench,
    BookOpen, Contact, Calculator, ArrowLeftRight, ReceiptText, MonitorSmartphone, Printer, Wallet
} from 'lucide-react';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
export const MODULE_MAP = {
    overview:          { path: '/overview',        label: 'Inicio',                   icon: Home          },
    emp_announcements: { path: '/my-announcements',label: 'Mis avisos',               icon: Bell          },
    emp_profile:       { path: '/profile',         label: 'Mi perfil',                icon: User          },
    emp_documents:     { path: '/my-documents',   label: 'Mis documentos',           icon: FolderOpen    },
    staff_list:        { path: '/dashboard',       label: 'Listado',                  icon: User          },
    // «Monitor real-time» era la única etiqueta del menú en inglés, y el
    // encabezado de la vista ya decía «Monitor en tiempo real».
    monitor:           { path: '/monitor',         label: 'Monitor en tiempo real',   icon: Monitor       },
    time_audit:        { path: '/audit',           label: 'Auditoría de tiempos',     icon: AlertTriangle },
    schedules:         { path: '/schedules',       label: 'Horarios y turnos',        icon: Calendar      },
    // El centro de la sala: descartes, cargas, traslados, Min/Max y facturación.
    // Se llamaba «Gestión de Solicitudes», que prometía gestionar a quien sólo
    // mira — y desde el 2026-08-10 la sala entera lo ve sin poder decidir.
    requests:            { path: '/requests',             label: 'Solicitudes de sucursal', icon: ClipboardList },
    requests_personales: { path: '/requests-personales',  label: 'Solicitudes personales',  icon: Palmtree },
    vacation_plan:     { path: '/vacation-plan',   label: 'Plan de vacaciones',       icon: Palmtree      },
    traslados:         { path: '/traslados',       label: 'Traslados entre salas',    icon: ArrowLeftRight },
    payroll:           { path: '/payroll',          label: 'Nómina',                   icon: DollarSign    },
    branches:          { path: '/branches',        label: 'Sucursales',               icon: Building2     },
    roles:             { path: '/roles',           label: 'Cargos / Organigrama',     icon: ShieldCheck   },
    announcements:     { path: '/announcements',   label: 'Gestionar avisos',         icon: Megaphone     },
    permissions:       { path: '/permissions',     label: 'Permisos de acceso',       icon: Lock          },
    auditview:         { path: '/auditview',       label: 'Auditoría general',        icon: Activity      },
    ios_test:          { path: '/ios-test',        label: 'Prueba iOS',               icon: Smartphone    },
    impresion:         { path: '/impresion',       label: 'Prueba de impresión',      icon: Printer       },
    sync_health:       { path: '/sync-health',     label: 'Salud de syncs',           icon: RadioTower    },
    sesiones:          { path: '/sesiones',        label: 'Conexiones',               icon: MonitorSmartphone },
    orphan_objects:    { path: '/orphan-objects',  label: 'Objetos huérfanos',        icon: Ghost         },
    maintenance:       { path: '/mantenimiento',  label: 'Mantenimiento',            icon: Wrench        },
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icon: TrendingUp },
    cortes_caja:       { path: '/cortes',           label: 'Cortes de caja',           icon: Wallet     },
    metas:             { path: '/metas',            label: 'Metas',                    icon: Target     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icon: FileText   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icon: Receipt    },
    clientes:          { path: '/clientes',         label: 'Clientes',                 icon: Contact    },
    encuesta:          { path: '/encuesta',         label: 'Clima organizacional',     icon: BarChart2  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icon: PenLine    },
    bonificaciones:    { path: '/bonificaciones',   label: 'Bonificaciones',           icon: Gift,         comingSoon: true },
    entrevistas:       { path: '/entrevistas',      label: 'Entrevistas',              icon: Users,        comingSoon: true },
    productos:         { path: '/productos',        label: 'Productos',                icon: Package       },
    laboratorios:      { path: '/laboratorios',     label: 'Laboratorios',             icon: FlaskConical  },
    pedidos:           { path: '/pedidos',          label: 'Pedidos a sucursales',     icon: ClipboardList },
    // Las dos salieron de ser pestañas de Productos (v2.521.0). El catálogo
    // describe QUÉ es un producto; estas dos describen CUÁNTO hay y qué hacer
    // con eso, así que su vecindario es Min/Max y el Conteo, no la ficha.
    gestion_stock:     { path: '/gestion-stock',   label: 'Gestión de stock',         icon: Activity      },
    inventario:        { path: '/inventario',       label: 'Inventario',               icon: Boxes         },
    minmax:            { path: '/minmax',           label: 'Min / Max',                icon: BarChart2     },
    ventas_perdidas:   { path: '/ventas-perdidas',  label: 'Ventas perdidas',          icon: PackageMinus  },
    compras:           { path: '/compras',           label: 'Compras',                  icon: ShoppingCart  },
    facturas_sala:     { path: '/facturas-sala',     label: 'Facturas de sala',         icon: ReceiptText   },
    facturas_compra:   { path: '/facturas-compra',    label: 'Facturas de compra',       icon: Mail          },
    libros_iva:        { path: '/libros-iva',         label: 'Libros IVA',               icon: BookOpen      },
    libro_compras_completo: { path: '/libro-compras-completo', label: 'Compras completo',  icon: BookOpen      },
    cierre_periodo:    { path: '/cierre-periodo',    label: 'Cierre de período',        icon: CalendarCheck },
    resumen_fiscal:    { path: '/resumen-fiscal',      label: 'Resumen fiscal',           icon: Calculator    },
    corte_z:           { path: '/corte-z',              label: 'Corte Z',                  icon: Receipt       },
    proveedores:       { path: '/proveedores',        label: 'Proveedores',              icon: Truck         },
    conteo_inventario: { path: '/conteo-inventario',  label: 'Conteo de inventario',     icon: ClipboardCheck },
};


// Ruta actual → key del módulo. AppLayout compara por el PRIMER SEGMENTO porque
// varios paths no coinciden con su key (staff_list → /dashboard,
// time_audit → /audit), y las vistas de detalle cuelgan
// del mismo segmento (/branches/:id).
export function moduleKeyForPath(pathname) {
    const seg = (pathname || '').split('/')[1] || '';
    if (!seg) return null;
    for (const [key, m] of Object.entries(MODULE_MAP)) {
        if (m.path.replace(/^\//, '').split('/')[0] === seg) return key;
    }
    return null;
}
