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
    BookOpen, Contact, Calculator, ArrowLeftRight, ReceiptText, MonitorSmartphone, Printer, IdCard, Wallet, Landmark, PackagePlus,
    Thermometer
} from 'lucide-react';

// ── Módulos individuales (key → path + label + icon) ────────────────────────
export const MODULE_MAP = {
    overview:          { path: '/inicio',          label: 'Inicio',                   icon: Home          },
    emp_announcements: { path: '/mis-avisos',label: 'Mis avisos',               icon: Bell          },
    emp_profile:       { path: '/mi-perfil',         label: 'Mi perfil',                icon: User          },
    emp_documents:     { path: '/mis-documentos',   label: 'Mis documentos',           icon: FolderOpen    },
    staff_list:        { path: '/personal',        label: 'Listado',                  icon: User          },
    // «Monitor real-time» era la única etiqueta del menú en inglés, y el
    // encabezado de la vista ya decía «Monitor en tiempo real».
    monitor:           { path: '/monitor',         label: 'Monitor en tiempo real',   icon: Monitor       },
    time_audit:        { path: '/auditoria-de-tiempos',           label: 'Auditoría de tiempos',     icon: AlertTriangle },
    schedules:         { path: '/horarios',       label: 'Horarios y turnos',        icon: Calendar      },
    // El centro de la sala: descartes, cargas, traslados, Min/Max y facturación.
    // Se llamaba «Gestión de Solicitudes», que prometía gestionar a quien sólo
    // mira — y desde el 2026-08-10 la sala entera lo ve sin poder decidir.
    requests:            { path: '/solicitudes',             label: 'Solicitudes de sucursal', icon: ClipboardList },
    requests_personales: { path: '/solicitudes-personales',  label: 'Solicitudes personales',  icon: Palmtree },
    vacation_plan:     { path: '/vacaciones',   label: 'Plan de vacaciones',       icon: Palmtree      },
    traslados:         { path: '/traslados',       label: 'Traslados entre salas',    icon: ArrowLeftRight },
    payroll:           { path: '/nomina',          label: 'Nómina',                   icon: DollarSign    },
    branches:          { path: '/sucursales',        label: 'Sucursales',               icon: Building2     },
    roles:             { path: '/cargos',           label: 'Cargos y organigrama',     icon: ShieldCheck   },
    announcements:     { path: '/avisos',          label: 'Gestionar avisos',         icon: Megaphone     },
    permissions:       { path: '/permisos',     label: 'Permisos de acceso',       icon: Lock          },
    auditview:         { path: '/auditoria-del-sistema',       label: 'Auditoría general',        icon: Activity      },
    ios_test:          { path: '/prueba-ios',        label: 'Prueba iOS',               icon: Smartphone    },
    impresion:         { path: '/impresion',       label: 'Prueba de impresión',      icon: Printer       },
    carne_temporal:    { path: '/carnes-del-dia',  label: 'Carnés del día',           icon: IdCard        },
    sync_health:       { path: '/actualizacion-de-datos',     label: 'Actualización de datos',   icon: RadioTower    },
    sesiones:          { path: '/sesiones',        label: 'Conexiones',               icon: MonitorSmartphone },
    orphan_objects:    { path: '/objetos-huerfanos',  label: 'Objetos huérfanos',        icon: Ghost         },
    maintenance:       { path: '/mantenimiento',  label: 'Mantenimiento',            icon: Wrench        },
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icon: TrendingUp },
    /* «Mi caja» y «Cortes de caja» son UNA sola pantalla desde v2.914.0, así que
     * los dos módulos apuntan a la MISMA ruta y el menú los funde en una entrada
     * (ver el `dedupe` por `path` de `AppLayout`). Siguen siendo dos permisos —
     * operar la caja y mirar los cortes son dos cosas distintas y hay gente con
     * uno solo—, pero no dos destinos: eran el mismo dinero en dos sitios y
     * obligaban a saltar de pantalla para seguir un turno.
     *
     * `/cortes` sigue existiendo y redirige, porque la nombran avisos ya
     * enviados y los favoritos de quien la usaba. */
    cortes_caja:       { path: '/caja',             label: 'Efectivo',                 icon: Wallet     },
    bolsas:            { path: '/bolsas',           label: 'Bolsas de efectivo',       icon: Package    },
    caja_vales:        { path: '/caja',             label: 'Efectivo',                 icon: Wallet     },
    metas:             { path: '/metas',            label: 'Metas',                    icon: Target     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icon: FileText   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icon: Receipt    },
    clientes:          { path: '/clientes',         label: 'Clientes',                 icon: Contact    },
    encuesta:          { path: '/encuesta',         label: 'Clima organizacional',     icon: BarChart2  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icon: PenLine    },
    /* El slot de «Bonificaciones» era el que quedó cuando se retiró Promociones
     * el 2026-07-28. Se reconvirtió en el módulo real el 2026-09-01: la clave
     * pasa a `promociones` para que coincida con el primer segmento de la ruta
     * —que es como `moduleKeyForPath` resuelve el módulo—, y los permisos ya
     * repartidos se migraron con ella. El usuario las llama promociones; la
     * bonificación es lo que gana cada persona, que es otra cosa. */
    promociones:       { path: '/promociones',      label: 'Promociones',              icon: Gift       },
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
    cuentas_por_pagar: { path: '/cuentas-por-pagar', label: 'Cuentas por pagar',        icon: Landmark      },
    cargar_compra:     { path: '/cargar-compra',      label: 'Cargar compra',            icon: PackagePlus   },
    facturas_compra:   { path: '/facturas-compra',    label: 'Facturas de compra',       icon: Mail          },
    libros_iva:        { path: '/libros-iva',         label: 'Libros IVA',               icon: BookOpen      },
    libro_compras_completo: { path: '/libro-compras-completo', label: 'Compras completo',  icon: BookOpen      },
    cierre_periodo:    { path: '/cierre-periodo',    label: 'Cierre de período',        icon: CalendarCheck },
    resumen_fiscal:    { path: '/resumen-fiscal',      label: 'Resumen fiscal',           icon: Calculator    },
    corte_z:           { path: '/corte-z',              label: 'Corte Z',                  icon: Receipt       },
    proveedores:       { path: '/proveedores',        label: 'Proveedores',              icon: Truck         },
    conteo_inventario: { path: '/conteo-inventario',  label: 'Conteo de inventario',     icon: ClipboardCheck },
    // Vecindario: el conteo. Las dos describen el estado FÍSICO de lo que hay
    // guardado —una cuenta unidades, la otra vigila las condiciones en que se
    // guardan— y las dos se llenan de pie, en la sala, con el teléfono.
    bitacoras:         { path: '/bitacoras',           label: 'Bitácoras',                icon: Thermometer   },
};


// Ruta actual → key del módulo. AppLayout compara por el PRIMER SEGMENTO porque
// varios paths no coinciden con su key (staff_list → /personal,
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
