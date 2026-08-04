// Registro de módulos: key → path + label + icon.
//
// Vivía dentro de AppLayout.jsx. Se extrajo el 2026-07-29 porque
// ModuleLockBanner necesita resolver "¿qué módulo es esta ruta?" para poder
// montarse una sola vez en GlassViewLayout en lugar de a mano en cada vista —
// y un componente de `common/` no puede importar el layout entero.
import {
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Activity,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, Cake,
    TrendingUp, Gift, Users, Package, DollarSign, FileText, BarChart2, PenLine, Receipt, Target, FlaskConical, Smartphone,
    PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Mail, Truck, Boxes, Search, Wrench,
    BookOpen, Contact
} from 'lucide-react';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
export const MODULE_MAP = {
    overview:          { path: '/overview',        label: 'Inicio',                   icon: Home          },
    emp_requests:      { path: '/my-requests',    label: 'Mis Solicitudes',          icon: ClipboardList },
    emp_announcements: { path: '/my-announcements',label: 'Mis Avisos',               icon: Bell          },
    emp_profile:       { path: '/profile',         label: 'Mi Perfil',                icon: User          },
    emp_documents:     { path: '/my-documents',   label: 'Mis Documentos',           icon: FolderOpen    },
    staff_list:        { path: '/dashboard',       label: 'Listado',                  icon: User          },
    monitor:           { path: '/monitor',         label: 'Monitor Real-Time',        icon: Monitor       },
    time_audit:        { path: '/audit',           label: 'Auditoría de Tiempos',     icon: AlertTriangle },
    schedules:         { path: '/schedules',       label: 'Horarios y Turnos',        icon: Calendar      },
    requests:          { path: '/requests',        label: 'Gestión de Solicitudes',   icon: ClipboardList },
    vacation_plan:     { path: '/vacation-plan',   label: 'Plan de Vacaciones',       icon: Palmtree      },
    payroll:           { path: '/payroll',          label: 'Nómina',                   icon: DollarSign    },
    branches:          { path: '/branches',        label: 'Sucursales',               icon: Building2     },
    roles:             { path: '/roles',           label: 'Cargos / Organigrama',     icon: ShieldCheck   },
    announcements:     { path: '/announcements',   label: 'Gestionar Avisos',         icon: Megaphone     },
    permissions:       { path: '/permissions',     label: 'Permisos de Acceso',       icon: Lock          },
    auditview:         { path: '/auditview',       label: 'Auditoría General',        icon: Activity      },
    ios_test:          { path: '/ios-test',        label: 'Prueba iOS',               icon: Smartphone    },
    sync_health:       { path: '/sync-health',     label: 'Salud de Syncs',           icon: RadioTower    },
    orphan_objects:    { path: '/orphan-objects',  label: 'Objetos Huérfanos',        icon: Ghost         },
    maintenance:       { path: '/mantenimiento',  label: 'Mantenimiento',            icon: Wrench        },
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icon: TrendingUp },
    metas:             { path: '/metas',            label: 'Metas',                    icon: Target     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icon: FileText   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icon: Receipt    },
    clientes:          { path: '/clientes',         label: 'Clientes',                 icon: Contact    },
    encuesta:          { path: '/encuesta',         label: 'Clima Organizacional',     icon: BarChart2  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icon: PenLine    },
    bonificaciones:    { path: '/bonificaciones',   label: 'Bonificaciones',           icon: Gift,         comingSoon: true },
    entrevistas:       { path: '/entrevistas',      label: 'Entrevistas',              icon: Users,        comingSoon: true },
    productos:         { path: '/productos',        label: 'Productos',                icon: Package       },
    laboratorios:      { path: '/laboratorios',     label: 'Laboratorios',             icon: FlaskConical  },
    pedidos:           { path: '/pedidos',          label: 'Pedidos a Sucursales',     icon: ClipboardList },
    minmax:            { path: '/minmax',           label: 'Min / Max',                icon: BarChart2     },
    ventas_perdidas:   { path: '/ventas-perdidas',  label: 'Ventas Perdidas',          icon: PackageMinus  },
    compras:           { path: '/compras',           label: 'Compras',                  icon: ShoppingCart  },
    facturas_compra:   { path: '/facturas-compra',    label: 'Facturas de Compra',       icon: Mail          },
    libros_iva:        { path: '/libros-iva',         label: 'Libros IVA',               icon: BookOpen      },
    libro_compras_completo: { path: '/libro-compras-completo', label: 'Compras Completo',  icon: BookOpen      },
    corte_z:           { path: '/corte-z',              label: 'Corte Z',                  icon: Receipt       },
    proveedores:       { path: '/proveedores',        label: 'Proveedores',              icon: Truck         },
    conteo_inventario: { path: '/conteo-inventario',  label: 'Conteo de Inventario',     icon: ClipboardCheck },
};


// Ruta actual → key del módulo. AppLayout compara por el PRIMER SEGMENTO porque
// varios paths no coinciden con su key (emp_requests → /my-requests,
// staff_list → /dashboard, time_audit → /audit), y las vistas de detalle cuelgan
// del mismo segmento (/branches/:id).
export function moduleKeyForPath(pathname) {
    const seg = (pathname || '').split('/')[1] || '';
    if (!seg) return null;
    for (const [key, m] of Object.entries(MODULE_MAP)) {
        if (m.path.replace(/^\//, '').split('/')[0] === seg) return key;
    }
    return null;
}
