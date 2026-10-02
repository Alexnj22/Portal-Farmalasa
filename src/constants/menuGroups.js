// Los grupos del menú: el orden y la agrupación de los módulos.
//
// Vivía dentro de AppLayout.jsx con los íconos como componentes de la web. Se
// mudó al núcleo el 2026-09-29 con los íconos por NOMBRE, para que la app
// nativa arme su menú con la MISMA lista que el portal: una lista escrita dos
// veces se desincroniza sola. `components/common/catalogos/modulos.js` le
// pone los componentes a la web; la app los traduce en `tema/iconos.js`.
//
// Orden: autoservicio del empleado primero, luego gestión de personal,
// luego negocio (Comercial/Inventario), y configuración al final.
// Reestructurado 2026-07-22 (a pedido del usuario) — Inventario tenía 9
// módulos mezclando 3 dominios sin relación (inventario real, compras/
// proveedores, logística inter-sucursal) y Comercial tenía 6 (ventas
// mezclado con incentivos). Nómina vivía dentro de "Personal" junto al
// directorio de empleados; Clima Organizacional estaba partido entre su
// propio grupo (encuesta) y RRHH (encuesta_admin) sin motivo. Ningún grupo
// nuevo pasa de 6 ítems.
export const MENU_GROUPS = [
    { key: 'overview',      label: 'Inicio',        icono: 'Home',          modules: ['overview']                          },
    // `traslados` va acá y no en Inventario: un traslado ES una solicitud
    // —vive en `approval_requests`, con su ciclo pedir → confirmar → recibir— y
    // su permiso nace en este grupo, aparte de `requests` para que confirmar un
    // envío no arrastre aprobar vacaciones.
    { key: 'solicitudes',   label: 'Solicitudes',   icono: 'ClipboardList', modules: ['requests', 'requests_personales', 'traslados'] },
    { key: 'avisos',        label: 'Avisos',         icono: 'Bell',          modules: ['emp_announcements', 'announcements']  },
    { key: 'documentos',    label: 'Documentos',    icono: 'FolderOpen',    modules: ['emp_documents']                       },
    { key: 'clima',         label: 'Clima organizacional', icono: 'BarChart2', modules: ['encuesta', 'encuesta_admin']       },
    { key: 'personal',      label: 'Personal',      icono: 'User',          modules: ['staff_list']                         },
    { key: 'nomina',        label: 'Nómina',        icono: 'DollarSign',    modules: ['payroll']                            },
    { key: 'asistencia',    label: 'Asistencia',    icono: 'Monitor',       modules: ['monitor', 'time_audit']               },
    { key: 'horarios',      label: 'Horarios',      icono: 'Calendar',      modules: ['schedules', 'vacation_plan']          },
    { key: 'rrhh',          label: 'RRHH',          icono: 'Users',         modules: ['entrevistas']                        },
    // `clientes` entra acá y no en un grupo propio: el receptor de la factura es
    // el mismo asunto que Facturación y Cotizaciones, y quien factura es quien
    // necesita su ficha fiscal correcta. Quedan 4 de los 6 que admite un grupo.
    // `puntos` (2026-09-25) va con Clientes: el programa es de los clientes y
    // lo opera quien supervisa la venta. 5 de 6.
    { key: 'comercial',    label: 'Comercial',     icono: 'TrendingUp',    modules: ['ventas', 'facturacion', 'cotizaciones', 'clientes', 'puntos'] },
    // Cortes de caja salió de Comercial a menú propio (2026-08-20, pedido del
    // usuario). No es una pregunta sobre la venta: es el cuadre del efectivo al
    // cerrar el turno, y quien lo abre —la sala que cierra, quien confirma la
    // diferencia— entra por eso y no por otra cosa.
    //
    // El 2026-08-24 dejó de ser un grupo de un módulo: «Bolsas de efectivo» era
    // una PESTAÑA de Cortes y hoy es su vecina. «Me estoy perdiendo en los
    // pasos, al tener tantos, me pierdo y no sé dónde está qué» (usuario) —
    // metidas en una vista, el corte y el circuito del efectivo compartían una
    // píldora que cambiaba de significado según la pestaña, y las cuatro etapas
    // de la bolsa quedaban apiladas dentro de una sola.
    //
    // Son dos preguntas seguidas y por eso van JUNTAS en un grupo y no en dos
    // menús sueltos: el corte dice cuánto efectivo hubo, la bolsa dice dónde
    // está. Se llama «Efectivo» y no «Caja» porque «caja» ya nombra el punto de
    // venta en el resto del portal.
    //
    // Y esto además le abrió la puerta a `bolsas`, que era módulo de permisos
    // propio —con alcance y tres capacidades— sin ruta ni entrada de menú: se
    // llegaba sólo por `/cortes`, detrás del guardia de `cortes_caja`. Quien
    // tuviera `bolsas` y no `cortes_caja` no podía entrar, y no daba error.
    // `caja_vales` va PRIMERO del grupo: es la pantalla con la que se trabaja
    // —abrir, anotar, cortar, cerrar— y las otras dos son de mirar lo que ya
    // pasó. Y va acá y no en un grupo propio porque es el mismo dinero.
    // `cuentas_por_cobrar` va en ESTE grupo y no en uno propio: es el mismo
    // dinero. Pero es su propia ENTRADA porque es su propia pantalla —Efectivo
    // pregunta «¿cuadra el dinero de hoy?» y la cartera «¿quién nos debe de los
    // últimos dos años?»—, y el `dedupe` de abajo la deja pasar porque su ruta
    // es distinta. Va TERCERA y no segunda (pedido del usuario, 2026-09-02):
    // las dos primeras son el efectivo del turno —cuadrarlo y guardarlo—, y la
    // cartera es la pregunta que se hace después. Ojo al contar la posición:
    // `caja_vales` y `cortes_caja` se funden en UNA entrada, así que las cuatro
    // claves de abajo pintan tres renglones.
    { key: 'cortes',       label: 'Efectivo',      icono: 'Wallet',       modules: ['caja_vales', 'cortes_caja', 'bolsas', 'cuentas_por_cobrar'] },
    // Inyecciones en grupo PROPIO (usuario, 2026-10-02): «aparte, porque no es
    // solo venta ni dinero». Con un módulo se pinta plano, a un click.
    { key: 'inyecciones',  label: 'Inyecciones',   icono: 'Syringe',      modules: ['inyecciones'] },
    // Metas salió de Comercial a menú propio (2026-08-04, pedido del usuario).
    // Con un solo módulo el grupo se pinta plano (renderGroup → renderNavItem),
    // así que queda a un click desde cualquier pantalla en vez de detrás del
    // acordeón. Va pegado a Bonificaciones: el tramo del bono sale de la meta.
    { key: 'metas',        label: 'Metas',         icono: 'Target',        modules: ['metas'] },
    // Promociones se retiró el 2026-07-28 y el grupo quedó reservado como el
    // slot de Bonificaciones. Se construyó el 2026-09-01 y volvió con su nombre:
    // es la campaña por la que un laboratorio paga por unidad vendida.
    { key: 'promociones', label: 'Promociones', icono: 'Gift', modules: ['promociones'] },
    // El planificador de contenido para redes (2026-10-01): lo usa el diseñador
    // externo y quien aprueba el calendario.
    // `galeria` es el material liberado para las salas: va en el mismo grupo
    // porque sale del planificador, pero con permiso propio.
    { key: 'marketing', label: 'Marketing', icono: 'Megaphone', modules: ['marketing', 'galeria'] },
    // Encuestas a clientes (2026-10-01): sección propia por pedido del usuario,
    // no una pestaña de Marketing.
    { key: 'encuestas_clientes', label: 'Encuestas', icono: 'ClipboardCheck', modules: ['encuestas_clientes', 'encuestas_aplicar'] },
    { key: 'producto',     label: 'Producto',      icono: 'Package',       modules: ['productos', 'laboratorios'] },
    { key: 'pedidos_sucursales', label: 'Pedidos a sucursales', icono: 'ClipboardList', modules: ['pedidos'] },
    // `inventario` y `gestion_stock` van PRIMERO y no al final de la lista
    // (pedido del usuario, 2026-08-08): las dos eran pestañas de Productos y
    // son las dos preguntas con las que alguien entra a este grupo —qué
    // existencia hay hoy, y qué hacer con la que no se mueve—. Min/Max y el
    // Conteo son lo que se hace *después* de haberlas mirado. Inventario
    // arriba de Gestión de stock (usuario, 2026-09-24): es la que da nombre al
    // grupo y la que más se abre.
    { key: 'inventario',   label: 'Inventario',    icono: 'Boxes',         modules: ['inventario', 'gestion_stock', 'minmax', 'ventas_perdidas', 'conteo_inventario'] },
    // Bitácoras va en grupo PROPIO (pedido del usuario, 2026-08-17) y no dentro
    // de Inventario. No es una pregunta sobre la existencia: es el expediente
    // que la Superintendencia de Regulación Sanitaria pide ver en una
    // inspección, y quien lo abre —el dependiente que anota la lectura, el
    // regente que firma el mes— entra por eso y no por otra cosa. Con un solo
    // módulo el grupo se pinta plano, así que queda a un clic desde cualquier
    // pantalla en vez de detrás de un acordeón.
    { key: 'bitacoras',    label: 'Bitácoras',     icono: 'Thermometer',   modules: ['bitacoras'] },
    // Vecino de Bitácoras y por el mismo motivo: es el expediente que otra
    // autoridad —la Agencia de Ciberseguridad del Estado— puede pedir ver, y
    // quien lo abre entra por eso. Grupo propio y plano, con un solo módulo.
    { key: 'datos_personales', label: 'Solicitudes de datos', icono: 'ShieldCheck', modules: ['datos_personales'] },
    // «Facturas de Sala» entra acá y no en Datos Contables: quien revisa que la
    // factura tomada haya quedado cargada como compra trabaja en este grupo, no
    // en el de los documentos que llegan por correo. Decisión del usuario
    // 2026-08-07 («agregalo en compras, no en contabilidad»).
    { key: 'compras',      label: 'Compras',       icono: 'ShoppingCart',  modules: ['compras', 'cargar_compra', 'facturas_sala', 'cuentas_por_pagar', 'proveedores'] },
    // Datos Contables (2026-07-31, pedido del usuario). Facturas de Compra sale
    // de "Compras": el documento de compra se sincroniza para CONTABILIDAD —el
    // DTE, su JSON/PDF y el proveedor fiscal—, no para decidir qué reponer, que
    // es de lo que trata el resto de ese grupo. Y aquí nace Libros IVA, que se
    // apoya en el mismo dato fiscal desde el otro lado del mostrador.
    { key: 'contabilidad', label: 'Datos contables', icono: 'BookOpen',    modules: ['facturas_compra', 'libros_iva', 'libro_compras_completo', 'cierre_periodo', 'resumen_fiscal', 'corte_z'] },
    { key: 'estructura',    label: 'Estructura',    icono: 'Building2',     modules: ['branches', 'roles']                   },
    { key: 'sistema',       label: 'Sistema',       icono: 'Lock',          modules: ['permissions', 'maintenance', 'auditview', 'ios_test', 'impresion', 'carne_temporal', 'sync_health', 'orphan_objects', 'sesiones'] },
];

/**
 * Los grupos que ve quien tiene estos permisos, con sus módulos ya resueltos.
 *
 * `mapa` es el catálogo de módulos que usa quien llama (la web lo pasa con
 * los íconos puestos); `puede(clave)` contesta si el cargo ve ese módulo.
 *
 * Los «Próximamente» sólo acompañan a un grupo que ya se ve por un permiso
 * real — sin esto, todo empleado veía grupos muertos (ej. «Comercial» con sólo
 * «Bonificaciones Próximamente»).
 *
 * Dos módulos que apuntan a la MISMA ruta son UNA entrada. `caja_vales` y
 * `cortes_caja` son dos permisos —operar la caja y mirar los cortes— y una
 * sola pantalla desde v2.914.0. Sin este filtro el menú pintaría «Efectivo»
 * dos veces a quien tenga los dos; y quedarse con un solo módulo en el grupo
 * dejaría sin entrada a quien tenga el otro —Contabilidad sólo tiene
 * `cortes_caja`—. Gana el primero del grupo, que es el orden que la lista ya
 * declara.
 * @param {typeof MENU_GROUPS} grupos
 * @param {Record<string, any>} mapa
 * @param {(clave: string) => boolean} puede
 */
export function gruposVisibles(grupos, mapa, puede) {
    return grupos.map((g) => {
        const hayReal = g.modules.some((k) => !mapa[k]?.comingSoon && puede(k));
        const vistas = new Set();
        const visibleModules = g.modules
            .filter((k) => (mapa[k]?.comingSoon ? hayReal : puede(k)))
            .filter((k) => {
                const ruta = mapa[k]?.path;
                if (!ruta || vistas.has(ruta)) return false;
                vistas.add(ruta);
                return true;
            })
            .map((k) => ({ key: k, ...mapa[k] }));
        return { ...g, visibleModules };
    }).filter((g) => g.visibleModules.length > 0);
}
