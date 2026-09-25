// Registro de módulos: key → path + label + icon.
//
// Vivía dentro de AppLayout.jsx. Se extrajo el 2026-07-29 porque
// ModuleLockBanner necesita resolver "¿qué módulo es esta ruta?" para poder
// montarse una sola vez en GlassViewLayout en lugar de a mano en cada vista —
// y un componente de `common/` no puede importar el layout entero.

// ── Módulos individuales (key → path + label + icon) ────────────────────────
// Los íconos van por NOMBRE (`icono`); la interfaz los dibuja con
// `components/common/catalogos/modulos.js`, que entrega este mismo mapa con
// `.icon`. El núcleo no importa componentes de la web.
export const MODULE_MAP = {
    overview:          { path: '/inicio',          label: 'Inicio',                   icono: 'Home'          },
    emp_announcements: { path: '/mis-avisos',label: 'Mis avisos',               icono: 'Bell'          },
    emp_profile:       { path: '/mi-perfil',         label: 'Mi perfil',                icono: 'User'          },
    emp_documents:     { path: '/mis-documentos',   label: 'Mis documentos',           icono: 'FolderOpen'    },
    staff_list:        { path: '/personal',        label: 'Listado',                  icono: 'User'          },
    // «Monitor real-time» era la única etiqueta del menú en inglés, y el
    // encabezado de la vista ya decía «Monitor en tiempo real».
    monitor:           { path: '/monitor',         label: 'Monitor en tiempo real',   icono: 'Monitor'       },
    time_audit:        { path: '/auditoria-de-tiempos',           label: 'Auditoría de tiempos',     icono: 'AlertTriangle' },
    schedules:         { path: '/horarios',       label: 'Horarios y turnos',        icono: 'Calendar'      },
    // El centro de la sala: descartes, cargas, traslados, Min/Max y facturación.
    // Se llamaba «Gestión de Solicitudes», que prometía gestionar a quien sólo
    // mira — y desde el 2026-08-10 la sala entera lo ve sin poder decidir.
    requests:            { path: '/solicitudes',             label: 'Solicitudes de sucursal', icono: 'ClipboardList' },
    requests_personales: { path: '/solicitudes-personales',  label: 'Solicitudes personales',  icono: 'Palmtree' },
    vacation_plan:     { path: '/vacaciones',   label: 'Plan de vacaciones',       icono: 'Palmtree'      },
    traslados:         { path: '/traslados',       label: 'Traslados entre salas',    icono: 'ArrowLeftRight' },
    payroll:           { path: '/nomina',          label: 'Nómina',                   icono: 'DollarSign'    },
    branches:          { path: '/sucursales',        label: 'Sucursales',               icono: 'Building2'     },
    roles:             { path: '/cargos',           label: 'Cargos y organigrama',     icono: 'ShieldCheck'   },
    announcements:     { path: '/avisos',          label: 'Gestionar avisos',         icono: 'Megaphone'     },
    permissions:       { path: '/permisos',     label: 'Permisos de acceso',       icono: 'Lock'          },
    auditview:         { path: '/auditoria-del-sistema',       label: 'Auditoría general',        icono: 'Activity'      },
    ios_test:          { path: '/prueba-ios',        label: 'Prueba iOS',               icono: 'Smartphone'    },
    impresion:         { path: '/impresion',       label: 'Prueba de impresión',      icono: 'Printer'       },
    carne_temporal:    { path: '/carnes-del-dia',  label: 'Carnés del día',           icono: 'IdCard'        },
    sync_health:       { path: '/actualizacion-de-datos',     label: 'Actualización de datos',   icono: 'RadioTower'    },
    sesiones:          { path: '/sesiones',        label: 'Conexiones',               icono: 'MonitorSmartphone' },
    orphan_objects:    { path: '/objetos-huerfanos',  label: 'Objetos huérfanos',        icono: 'Ghost'         },
    maintenance:       { path: '/mantenimiento',  label: 'Mantenimiento',            icono: 'Wrench'        },
    // ── Próximamente ──
    ventas:            { path: '/ventas',           label: 'Ventas',                   icono: 'TrendingUp' },
    /* «Mi caja» y «Cortes de caja» son UNA sola pantalla desde v2.914.0, así que
     * los dos módulos apuntan a la MISMA ruta y el menú los funde en una entrada
     * (ver el `dedupe` por `path` de `AppLayout`). Siguen siendo dos permisos —
     * operar la caja y mirar los cortes son dos cosas distintas y hay gente con
     * uno solo—, pero no dos destinos: eran el mismo dinero en dos sitios y
     * obligaban a saltar de pantalla para seguir un turno.
     *
     * `/cortes` sigue existiendo y redirige, porque la nombran avisos ya
     * enviados y los favoritos de quien la usaba. */
    cortes_caja:       { path: '/caja',             label: 'Efectivo',                 icono: 'Wallet'     },
    bolsas:            { path: '/bolsas',           label: 'Bolsas de efectivo',       icono: 'Package'    },
    /* Vista propia y no una pestaña de Efectivo: Efectivo contesta «¿cuadra el
     * dinero de HOY?» y esto «¿quién nos debe de los últimos dos años?». */
    cuentas_por_cobrar:{ path: '/cuentas-por-cobrar', label: 'Cuentas por cobrar',      icono: 'HandCoins'  },
    caja_vales:        { path: '/caja',             label: 'Efectivo',                 icono: 'Wallet'     },
    metas:             { path: '/metas',            label: 'Metas',                    icono: 'Target'     },
    facturacion:       { path: '/facturacion',      label: 'Facturación',              icono: 'FileText'   },
    cotizaciones:      { path: '/cotizaciones',     label: 'Cotizaciones',             icono: 'Receipt'    },
    clientes:          { path: '/clientes',         label: 'Clientes',                 icono: 'Contact'    },
    encuesta:          { path: '/encuesta',         label: 'Clima organizacional',     icono: 'BarChart2'  },
    encuesta_admin:    { path: '/encuesta-admin',   label: 'Encuestas',                icono: 'PenLine'    },
    /* El slot de «Bonificaciones» era el que quedó cuando se retiró Promociones
     * el 2026-07-28. Se reconvirtió en el módulo real el 2026-09-01: la clave
     * pasa a `promociones` para que coincida con el primer segmento de la ruta
     * —que es como `moduleKeyForPath` resuelve el módulo—, y los permisos ya
     * repartidos se migraron con ella. El usuario las llama promociones; la
     * bonificación es lo que gana cada persona, que es otra cosa. */
    promociones:       { path: '/promociones',      label: 'Promociones',              icono: 'Gift'       },
    entrevistas:       { path: '/entrevistas',      label: 'Entrevistas',              icono: 'Users',        comingSoon: true },
    productos:         { path: '/productos',        label: 'Productos',                icono: 'Package'       },
    laboratorios:      { path: '/laboratorios',     label: 'Laboratorios',             icono: 'FlaskConical'  },
    pedidos:           { path: '/pedidos',          label: 'Pedidos a sucursales',     icono: 'ClipboardList' },
    // Las dos salieron de ser pestañas de Productos (v2.521.0). El catálogo
    // describe QUÉ es un producto; estas dos describen CUÁNTO hay y qué hacer
    // con eso, así que su vecindario es Min/Max y el Conteo, no la ficha.
    gestion_stock:     { path: '/gestion-stock',   label: 'Gestión de stock',         icono: 'Activity'      },
    inventario:        { path: '/inventario',       label: 'Inventario',               icono: 'Boxes'         },
    minmax:            { path: '/minmax',           label: 'Min / Max',                icono: 'BarChart2'     },
    ventas_perdidas:   { path: '/ventas-perdidas',  label: 'Ventas perdidas',          icono: 'PackageMinus'  },
    compras:           { path: '/compras',           label: 'Compras',                  icono: 'ShoppingCart'  },
    facturas_sala:     { path: '/facturas-sala',     label: 'Facturas de sala',         icono: 'ReceiptText'   },
    cuentas_por_pagar: { path: '/cuentas-por-pagar', label: 'Cuentas por pagar',        icono: 'Landmark'      },
    cargar_compra:     { path: '/cargar-compra',      label: 'Cargar compra',            icono: 'PackagePlus'   },
    facturas_compra:   { path: '/facturas-compra',    label: 'Facturas de compra',       icono: 'Mail'          },
    libros_iva:        { path: '/libros-iva',         label: 'Libros IVA',               icono: 'BookOpen'      },
    libro_compras_completo: { path: '/libro-compras-completo', label: 'Compras completo',  icono: 'BookOpen'      },
    cierre_periodo:    { path: '/cierre-periodo',    label: 'Cierre de período',        icono: 'CalendarCheck' },
    resumen_fiscal:    { path: '/resumen-fiscal',      label: 'Resumen fiscal',           icono: 'Calculator'    },
    corte_z:           { path: '/corte-z',              label: 'Corte Z',                  icono: 'Receipt'       },
    proveedores:       { path: '/proveedores',        label: 'Proveedores',              icono: 'Truck'         },
    conteo_inventario: { path: '/conteo-inventario',  label: 'Conteo de inventario',     icono: 'ClipboardCheck' },
    // Vecindario: el conteo. Las dos describen el estado FÍSICO de lo que hay
    // guardado —una cuenta unidades, la otra vigila las condiciones en que se
    // guardan— y las dos se llenan de pie, en la sala, con el teléfono.
    bitacoras:         { path: '/bitacoras',           label: 'Bitácoras',                icono: 'Thermometer'   },
    // Vecindario: las bitácoras. Las dos son registros que una autoridad puede
    // venir a pedir, y en las dos lo que se enseña no es el dato sino la
    // constancia de que se llevó al día.
    datos_personales:  { path: '/solicitudes-datos',   label: 'Solicitudes de datos',     icono: 'ShieldCheck'   },
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
