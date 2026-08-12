// Registro de módulos para permisos: grupo → módulos con etiqueta CLARA,
// descripción de una línea, ícono y sus sub-permisos.
//
// ── El campo `sub:` y por qué cada entrada lleva `tipo` ────────────────────
// Hasta la auditoría del 2026-08-03 esto se llamaba `tabs:` y ahí adentro
// convivían dos cosas distintas: pestañas de verdad (`ventas_tab_ventas`) y
// capacidades que no son pestañas (`minmax_ver_costos` gatea columnas de costo,
// `conteo_ver_sistema` rompe el conteo ciego, `facturas_compra_descargar` gatea
// la descarga). La pantalla las mostraba todas bajo el rótulo "Pestañas", que
// para la mitad era mentira — y el peor caso, `productos_tab_catalogo_costos`,
// se llamaba `tab` y gateaba una columna.
//
// Ahora `sub` es la lista de sub-permisos y cada uno declara qué es:
//     tipo: 'tab' → una pestaña de la vista
//     tipo: 'cap' → una capacidad (descargar, ver montos, ver costos, abrir)
// La pantalla de Permisos las pinta en dos bloques separados. El canon de
// nombres vive en docs/planes-cerrados/AUDITORIA-PERMISOS-2026-08-03.md §7-bis: la clave
// empieza SIEMPRE por la del módulo, y `_tab_` es solo para pestañas.
//
// Vivía dentro de PermissionsView.jsx. Se extrajo el 2026-07-29 para que la vista
// de Mantenimiento muestre los mismos nombres — a pedido del usuario, "el nombre
// de los módulos debe ser claro, como en permisos". El registro de AppLayout
// (constants/moduleMap.js) tiene etiquetas de MENÚ, que son más cortas y a veces
// ambiguas fuera de su grupo: ahí `staff_list` es "Listado" y acá es "Listado de
// Personal"; `staff_detail` no está en el menú y acá es "Expediente completo".
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, MousePointerClick,
    TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock, Gift, DollarSign, FileText, Package, Receipt, Target, FlaskConical, Smartphone,
    Sparkles, Layers, Globe2, BadgeAlert, PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Truck, Boxes, MonitorSmartphone, ShieldOff,
    BookOpen, Contact, Wrench, Users, Calculator, ReceiptText
} from 'lucide-react';
import { tematicaDe } from './dashboardTabs';

const GRUPOS_CRUDOS = [
    {
        group: 'Autogestión',
        color: 'text-success-text',
        modules: [
            // `emp_requests` («Mis Solicitudes») se fue el 2026-08-11: era la
            // segunda llave de la misma puerta. Quien sólo manda las suyas hoy
            // lleva `requests_personales` con alcance «sólo míos» — una fila
            // en esta pantalla en vez de dos que se contradicen.
            { key: 'emp_announcements', label: 'Mis avisos',          desc: 'Recibir y leer comunicados internos dirigidos al empleado',  icon: Bell,          hasApprove: false },
            { key: 'emp_profile',       label: 'Mi perfil',           desc: 'Ver y actualizar datos personales propios',                  icon: User,          hasApprove: false },
            { key: 'emp_documents',     label: 'Mis documentos',      desc: 'Consultar documentos personales: incapacidades, constancias, etc.', icon: FolderOpen, hasApprove: false },
        ],
    },
    {
        group: 'Personal',
        color: 'text-chart-3-text',
        modules: [
            { key: 'staff_list',   label: 'Listado de personal',    desc: 'Ver y buscar empleados, datos básicos y estado',            icon: User,          hasApprove: false, hasScope: true, sub: [
                { key: 'staff_list_descargar', label: 'Descargar el listado (CSV)', tipo: 'cap' },
            ]},
            { key: 'staff_detail', label: 'Expediente completo',    desc: 'Perfil, historial, eventos y documentos del empleado',      icon: User,          hasApprove: false, hasScope: true },
            { key: 'staff_salary', label: 'Salarios e ingresos',    desc: 'Información salarial y ajustes de nómina (datos sensibles)',icon: User,          hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Asistencia',
        color: 'text-warning',
        modules: [
            { key: 'monitor',      label: 'Monitor real-time',      desc: 'Monitoreo en vivo de marcaciones y asistencia activa',      icon: Monitor,       hasApprove: false, hasScope: true },
            { key: 'time_audit',   label: 'Auditoría de tiempos',   desc: 'Revisión y corrección de marcaciones históricas',           icon: AlertTriangle, hasApprove: false, hasScope: true, sub: [
                { key: 'time_audit_descargar', label: 'Descargar las marcaciones (CSV)', tipo: 'cap' },
            ]},
        ],
    },
    {
        group: 'Operaciones',
        color: 'text-chart-1-text',
        modules: [
            { key: 'schedules',    label: 'Horarios y turnos',      desc: 'Creación y asignación de horarios semanales',               icon: Calendar,      hasApprove: false, hasScope: true, sub: [
                { key: 'schedules_tab_calendar', label: 'Calendario',         tipo: 'tab' },
                { key: 'schedules_tab_shifts',   label: 'Catálogo de turnos', tipo: 'tab' },
                { key: 'schedules_tab_holidays', label: 'Feriados',           tipo: 'tab' },
            ]},
            // ── Las solicitudes se partieron en dos el 2026-08-10 ────────────
            // `approval_requests` guarda dos cosas que no se parecen: las que
            // hablan de la SALA (existencia y facturas) y las que hablan de una
            // PERSONA (vacaciones, incapacidad, anticipo). Con un solo módulo,
            // abrirle el centro a la sala —pedido del usuario: «toda la
            // sucursal debe poder ver las solicitudes»— le habría abierto de
            // arrastre quién está incapacitado y quién pidió adelanto.
            //
            // El corte lo hace `es_solicitud_operativa()` en Postgres, y las
            // policies de `approval_requests` piden un módulo u otro según de
            // qué lado caiga el tipo. Un tipo nuevo sin clasificar cae en
            // PERSONAL, que es el lado cerrado.
            { key: 'requests',     label: 'Solicitudes de sucursal', desc: 'El centro de solicitudes de la sala: descartes y cargas de inventario, traslados, Min/Max y cambios a facturación. Ver = estar al día de lo que pidió la sala y cómo se resolvió; Aprobar = decidirlas', icon: ClipboardList, hasApprove: true,  hasScope: true },
            { key: 'requests_personales', label: 'Solicitudes personales', desc: 'Las que hablan de una persona y no de la sala: vacaciones, permiso, incapacidad, anticipo salarial y constancias. Ver acá es ver datos sensibles del expediente ajeno', icon: Palmtree, hasApprove: true, hasScope: true },
            // Módulo aparte de `requests` a propósito: acá `can_approve` habilita
            // confirmar un traslado de la propia sala y NADA más. Metido dentro de
            // Solicitudes, dárselo a una jefatura de sala le entregaría de arrastre
            // las vacaciones y los anticipos de su gente.
            // La descripción decía sólo «Confirmar el envío…», que era cierto
            // cuando el módulo era únicamente la baldosa del tablero. Desde que
            // tiene vista propia (`/traslados`, 2026-08-07) también abre el
            // historial, y buscarlo en esta pantalla por «vista» o «historial»
            // no daba nada — reportado así: «¿no está en permisos?».
            { key: 'traslados',    label: 'Traslados entre salas',  desc: 'Abrir la vista de traslados —lo que está en camino y el historial con sus motivos— y confirmar el envío de producto que otra sala pide',  icon: Truck,         hasApprove: true,  hasScope: true },
            { key: 'vacation_plan',label: 'Plan de vacaciones',     desc: 'Planificación anual de períodos vacacionales',              icon: Palmtree,      hasApprove: false, hasScope: true },
            { key: 'payroll',      label: 'Nómina',                 desc: 'Generación, edición y aprobación de planillas quincenales',  icon: DollarSign,    hasApprove: true,  hasScope: true, sub: [
                // La boleta y la planilla impresas se llevan el salario de cada
                // empleado en papel. Es la descarga más sensible del portal.
                { key: 'payroll_descargar', label: 'Imprimir boletas y planilla', tipo: 'cap' },
            ]},
        ],
    },
    {
        group: 'Comercial',
        color: 'text-success',
        modules: [
            // Sin `_ver_montos` a propósito (canon §7-bis): en Ventas el monto ES
            // la vista — esconder los $ deja una pantalla sin sentido.
            // Lo que sí se puede separar es el RESUMEN del período: las tarjetas
            // de arriba (total vendido, ticket promedio, utilidad, margen) son el
            // consolidado de la sala, y se puede querer que alguien trabaje la
            // lista factura por factura sin ver el acumulado. Gatea las tarjetas
            // de las tres pestañas, no las columnas de la tabla.
            { key: 'ventas',        label: 'Ventas',        desc: 'Anulaciones en tiempo real, ranking de vendedores y productos más vendidos', icon: TrendingUp, hasApprove: false, hasScope: true, sub: [
                { key: 'ventas_tab_ventas',     label: 'Ventas',     tipo: 'tab' },
                { key: 'ventas_tab_vendedores', label: 'Vendedores', tipo: 'tab' },
                { key: 'ventas_tab_productos',  label: 'Productos',  tipo: 'tab' },
                { key: 'ventas_ver_cards',      label: 'Ver las tarjetas de resumen', tipo: 'cap' },
            ]},
            { key: 'facturacion',   label: 'Facturación',   desc: 'Anuladas, pendientes MH, saltos de correlativo, pagos no-efectivo y observaciones', icon: FileText,   hasApprove: false, hasScope: true, sub: [
                { key: 'facturacion_tab_anuladas',      label: 'Anuladas',      tipo: 'tab' },
                { key: 'facturacion_tab_pendiente_mh',  label: 'Pendiente MH',  tipo: 'tab' },
                { key: 'facturacion_tab_saltos',        label: 'Saltos',        tipo: 'tab' },
                { key: 'facturacion_tab_no_efectivo',   label: 'No Efectivo',   tipo: 'tab' },
                { key: 'facturacion_tab_observaciones', label: 'Observaciones', tipo: 'tab' },
                { key: 'facturacion_ver_montos',        label: 'Ver montos',    tipo: 'cap' },
            ]},
            // Tampoco lleva `_ver_montos`: una cotización sin precios no es nada.
            { key: 'cotizaciones',   label: 'Cotizaciones',  desc: 'Crear, guardar e imprimir cotizaciones con productos del catálogo, IVA y retención', icon: Receipt,       hasApprove: false, hasScope: true, sub: [
                { key: 'cotizaciones_descargar', label: 'Imprimir / guardar PDF', tipo: 'cap' },
            ]},
            { key: 'clientes',       label: 'Clientes',      desc: 'Ficha fiscal del cliente: identidad (DUI/NIT/NRC), categoría, contacto y ubicación con la cascada departamento-municipio-distrito. Muestra la facturación de cada cliente para saber qué ficha vale la pena completar. Editar = corregir la ficha; los datos de un contribuyente exigen confirmación aparte', icon: Contact, hasApprove: false, sub: [
                // Acá el monto SÍ es una columna más: la ficha fiscal se completa
                // igual sin ver cuánto factura cada cliente.
                { key: 'clientes_ver_montos', label: 'Ver la facturación por cliente', tipo: 'cap' },
            ]},
            { key: 'metas',          label: 'Metas',         desc: 'Metas mensuales de venta por sala: cumplimiento en vivo, proyección de cierre e histórico con el tramo del bono', icon: Target, hasApprove: true, hasScope: true },
            { key: 'bonificaciones', label: 'Bonificaciones',desc: 'Esquemas de bonificación por ventas y metas alcanzadas (próximamente)',                icon: DollarSign,    hasApprove: false, comingSoon: true },
        ],
    },
    {
        group: 'Inventario',
        color: 'text-chart-9-text',
        modules: [
            { key: 'productos', label: 'Productos', desc: 'Catálogo de productos con su ficha, precios y ubicaciones, y el maestro de presentaciones en que se venden', icon: Package, hasApprove: false, sub: [
                { key: 'productos_tab_catalogo',   label: 'Catálogo',   tipo: 'tab' },
                // Las pestañas «Inventario» y «Sin Venta» dejaron de vivir acá
                // el 2026-08-08: son los módulos `inventario` y `gestion_stock`
                // del grupo Inventario. Sus claves viejas
                // (`productos_tab_inventario`, `productos_tab_sinventa`) se
                // borraron de `role_permissions` en la misma migración que
                // sembró las nuevas — si quedaran, la pantalla de Permisos las
                // seguiría mostrando como pestañas que ya no existen.
                { key: 'productos_tab_presentaciones', label: 'Presentaciones', tipo: 'tab' },
                // Era `productos_tab_catalogo_costos` y NO es una pestaña: gatea
                // las columnas de costo dentro del Catálogo. Renombrada en el
                // barrido del canon (2026-08-03). Ojo: dos policies de Postgres
                // la nombran (purchase_receipts_select y
                // purchase_receipt_items_select) — se actualizaron en la misma
                // migración que renombró las filas.
                { key: 'productos_ver_costos',     label: 'Ver costos de compra', tipo: 'cap' },
            ]},
            // Las dos nacieron como pestañas de Productos y pasaron a módulo
            // propio el 2026-08-08 (pedido del usuario). Ninguna lleva `sub`:
            // lo que gateaba cada pestaña era su propia clave, y esa clave ES
            // ahora el módulo.
            // Sin `hasScope`: las dos muestran las 7 sucursales y ninguna
            // consulta `getScope()`. Ofrecer el ámbito BRANCH en la pantalla de
            // Permisos sería prometer un recorte que el código no hace — es lo
            // mismo que heredan de haber sido pestañas de `productos`, que
            // tampoco lo declara.
            { key: 'gestion_stock', label: 'Gestión de stock', desc: 'Qué se está vendiendo sin parámetros de reposición y qué existencia lleva medio año sin moverse, con la sugerencia de qué hacer con cada caso', icon: Activity, hasApprove: false },
            { key: 'inventario', label: 'Inventario', desc: 'Existencia por sucursal en tiempo real con desglose de lotes, vencimientos y productos ya vencidos', icon: Boxes, hasApprove: false },
            { key: 'minmax', label: 'Min / Max', desc: 'Análisis de stock mínimo y máximo por sucursal, clasificación ABC, variabilidad de demanda y ajuste manual de parámetros. Aprobar = publicar cambios y resolver solicitudes de ajuste', icon: BarChart2, hasApprove: true, hasScope: true, sub: [
                { key: 'minmax_tab_sucursal',    label: 'Sucursal',    tipo: 'tab' },
                { key: 'minmax_ver_costos',      label: 'Ver costos de compra y venta', tipo: 'cap' },
                { key: 'minmax_descargar',       label: 'Descargar el análisis (CSV)',  tipo: 'cap' },
            ]},
            { key: 'ventas_perdidas', label: 'Ventas perdidas', desc: 'Registro de productos solicitados sin stock; alertas de compra para logística con seguimiento de estado', icon: PackageMinus, hasApprove: false, sub: [
                { key: 'ventas_perdidas_descargar', label: 'Descargar el registro (CSV)', tipo: 'cap' },
            ]},
            { key: 'compras', label: 'Compras', desc: 'Historial de facturas de compra de Bodega: facturas por fecha y proveedor, detalle de ítems y resumen por producto', icon: ShoppingCart, hasApprove: false, sub: [
                { key: 'compras_tab_facturas',  label: 'Facturas',   tipo: 'tab' },
                { key: 'compras_tab_productos', label: 'Productos',  tipo: 'tab' },
                { key: 'compras_ver_montos',    label: 'Ver montos', tipo: 'cap' },
            ]},
            // La otra mitad del widget «Facturas de mi Sala» del tablero. Nació
            // como pestaña de Compras (v2.487.0) y pasó a vista propia el mismo
            // día: tiene su propia pregunta —qué se tomó y no se cargó—, su
            // propio período y su propio ciclo. `can_edit` es lo que habilita
            // liberar una factura tomada por una sala: la sala sola no puede si
            // ya quedó cargada como compra.
            { key: 'facturas_sala', label: 'Facturas de sala', desc: 'Qué factura tomó cada sala, quién la tomó y si terminó cargada como compra; liberar una tomada por error', icon: ReceiptText, hasApprove: false, sub: [
                { key: 'facturas_sala_ver_montos', label: 'Ver montos', tipo: 'cap' },
            ]},
            { key: 'proveedores', label: 'Proveedores', desc: 'Maestro de proveedores auto-registrado desde los DTE de compra: datos fiscales, categoría contable y vinculación manual con el proveedor registrado', icon: Truck, hasApprove: false },
            { key: 'conteo_inventario', label: 'Conteo de inventario', desc: 'Auditoría física de stock por sucursal/bodega: snapshot del sistema, captura de conteo físico, faltantes/sobrantes, impresión de hoja y resultados. Aprobar = firmar el conteo finalizado', icon: ClipboardCheck, hasApprove: true, hasScope: true, sub: [
                // El conteo es CIEGO mientras está abierto: sin este permiso la
                // existencia del sistema NO SALE de la base (no es un switch en
                // la vista, que era lo de antes). Con el conteo ya finalizado los
                // números son el resultado y los ve cualquiera que vea el módulo.
                //
                // La clave NO empieza por `conteo_inventario_` como manda el
                // canon, y se deja así a propósito: la nombra la función de
                // Postgres `conteo_puede_ver_sistema`, así que renombrarla es
                // tocar la base por cosmética. Las dos de abajo sí son canónicas.
                { key: 'conteo_ver_sistema', label: 'Ver existencia del sistema (rompe el ciego)', tipo: 'cap' },
                // La hoja impresa lleva la existencia del sistema al papel: sin
                // este permiso, el ciego se rompía por la impresora aunque
                // `conteo_ver_sistema` estuviera apagado.
                { key: 'conteo_inventario_descargar',  label: 'Imprimir la hoja de conteo', tipo: 'cap' },
                { key: 'conteo_inventario_ver_montos', label: 'Ver el valorizado',          tipo: 'cap' },
                // Gestionar ya borra el conteo que se armó mal —abierto y sin un
                // solo renglón contado—, porque ahí no se pierde trabajo de
                // nadie. Esta capacidad es para lo otro: un conteo a medio
                // contar son horas de alguien, y uno finalizado es evidencia
                // firmada con el nombre de quién contó cada renglón.
                { key: 'conteo_inventario_eliminar',   label: 'Eliminar un conteo ya empezado o finalizado', tipo: 'cap' },
            ]},
            { key: 'laboratorios', label: 'Laboratorios', desc: 'Lista de laboratorios con su ubicación física en bodega, editable por módulo', icon: FlaskConical, hasApprove: false },
            { key: 'pedidos', label: 'Pedidos a sucursales', desc: 'Generación de pedidos de reposición de Bodega hacia sucursales, seguimiento en tiempo real y recepción por sucursal', icon: Package, hasApprove: false, hasScope: true, sub: [
                { key: 'pedidos_tab_generar',   label: 'Generar',             tipo: 'tab' },
                { key: 'pedidos_tab_historial', label: 'Pedidos (unificado)', tipo: 'tab' },
                { key: 'pedidos_tab_rutas',     label: 'Rutas de entrega',    tipo: 'tab' },
                { key: 'pedidos_tab_metricas',  label: 'Métricas',            tipo: 'tab' },
                { key: 'pedidos_tab_reglas',    label: 'Reglas de despacho',  tipo: 'tab' },
                // REIMPRIMIR, no imprimir: la hoja que sale al GENERAR el pedido
                // es el entregable del flujo de bodega —con ella se arman las
                // cajas— y bloquearla dejaría el pedido hecho y sin papel. Este
                // permiso gatea el PDF de un pedido ya generado.
                { key: 'pedidos_descargar',     label: 'Reimprimir el pedido (PDF)', tipo: 'cap' },
            ]},
        ],
    },
    {
        // Datos Contables (2026-07-31). El grupo del menú y el de esta pantalla
        // se mantienen espejados a propósito: si el permiso vive en "Inventario"
        // y el menú lo muestra en "Datos contables", quien reparte accesos lo
        // busca donde no está.
        group: 'Datos contables',
        color: 'text-chart-1-text',
        modules: [
            { key: 'facturas_compra', label: 'Facturas de compra (correo)', desc: 'Facturas de compra (DTE) sincronizadas automáticamente desde las bandejas de correo de la empresa: descarga de JSON/PDF, match de proveedor y cola de revisión de adjuntos sin procesar', icon: FileText, hasApprove: false, sub: [
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
                { key: 'facturas_compra_abrir',      label: 'Abrir el documento (JSON/PDF)',     tipo: 'cap' },
                { key: 'facturas_compra_descargar',  label: 'Descargar archivos (JSON/PDF/ZIP)', tipo: 'cap' },
                { key: 'facturas_compra_ver_montos', label: 'Ver montos',                        tipo: 'cap' },
            ]},
            // Cada pestaña es un libro distinto, no un corte del mismo dato: por
            // eso acá `_tab_` sí corresponde. Un contador externo puede necesitar
            // Compras y no las ventas, o al revés.
            { key: 'libros_iva', label: 'Libros IVA', desc: 'Los siete libros y anexos de IVA, con exportación a CSV. Ventas: consumidor final (Art. 83), contribuyentes (Art. 85) y anexo de anulados, solo con sello de Hacienda. Compras: libro del Art. 86 y los anexos de percepción, retención y sujeto excluido', icon: BookOpen, hasApprove: false, hasScope: true, sub: [
                { key: 'libros_iva_tab_consumidor',    label: 'Consumidor',     tipo: 'tab' },
                { key: 'libros_iva_tab_contribuyente', label: 'Contribuyentes', tipo: 'tab' },
                { key: 'libros_iva_tab_compras',       label: 'Compras',        tipo: 'tab' },
                { key: 'libros_iva_tab_anulados',      label: 'Anulados',       tipo: 'tab' },
                { key: 'libros_iva_tab_percepcion',    label: 'Percepción',     tipo: 'tab' },
                { key: 'libros_iva_tab_retencion',     label: 'Retención',      tipo: 'tab' },
                { key: 'libros_iva_tab_renta',         label: 'Renta',          tipo: 'tab' },
                { key: 'libros_iva_descargar',         label: 'Exportar los libros (CSV)', tipo: 'cap' },
                { key: 'libros_iva_ver_montos',        label: 'Ver montos',                tipo: 'cap' },
            ]},
            { key: 'corte_z', label: 'Corte Z', desc: 'El Corte Z mensual de cada sucursal, tal como lo declaró: las ventas con tiquete, con factura y con crédito fiscal, y el total general. Al lado va el mismo número calculado desde las facturas selladas por Hacienda, para cotejarlo. Se descarga en PDF, por sucursal o todas juntas', icon: Receipt, hasApprove: false, hasScope: true, sub: [
                { key: 'corte_z_descargar',  label: 'Descargar el PDF', tipo: 'cap' },
                { key: 'corte_z_ver_montos', label: 'Ver montos',       tipo: 'cap' },
            ]},
            { key: 'libro_compras_completo', label: 'Libro de compras completo', desc: 'El libro de compras con lo que la farmacia compró de verdad: las compras registradas más los documentos del proveedor que llegaron por correo y nunca se registraron como compra. No reemplaza al libro de Libros IVA, que sirve para cotejarse contra el archivo original. Exporta el número de documento completo, no el cortado a 20 caracteres', icon: BookOpen, hasApprove: false, hasScope: true, sub: [
                { key: 'libro_compras_completo_descargar',  label: 'Exportar el libro (CSV)', tipo: 'cap' },
                { key: 'libro_compras_completo_ver_montos', label: 'Ver montos',              tipo: 'cap' },
            ]},

            { key: 'resumen_fiscal', label: 'Resumen fiscal', desc: 'El movimiento fiscal del mes en un número por concepto: débito por ventas, crédito por compras (incluidas las que llegaron como documento y no se registraron), notas de crédito y débito, percepción, retención, y el pago a cuenta del 1.75% sobre ventas (Art. 151). Es un indicador: NO incluye el saldo a favor del mes anterior, así que no reemplaza a la declaración', icon: Calculator, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'RRHH',
        color: 'text-chart-3-text',
        modules: [
            { key: 'encuesta',       label: 'Clima organizacional', desc: 'Dashboard de resultados de encuesta de clima 2026 con análisis por bloque, sucursal y empleado', icon: BarChart2,   hasApprove: false },
            { key: 'encuesta_admin', label: 'Gestión de encuesta',  desc: 'Agregar y eliminar respuestas de encuestas de clima organizacional',                              icon: BarChart2,   hasApprove: false },
            { key: 'entrevistas',    label: 'Entrevistas',          desc: 'Gestión del proceso de selección y entrevistas de candidatos (próximamente)',                    icon: Briefcase,  hasApprove: false, comingSoon: true },
        ],
    },
    {
        group: 'Estructura',
        color: 'text-chart-9-text',
        modules: [
            { key: 'branches',     label: 'Sucursales',             desc: 'Gestión de sucursales, contratos y datos operativos',       icon: Building2,     hasApprove: false, sub: [
                { key: 'branches_descargar', label: 'Descargar el historial (CSV)', tipo: 'cap' },
            ]},
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
            // `dash_distribution` vivía acá y se quitó en el barrido del canon
            // (2026-08-03): el widget "Distribución de cargos" ya no existe —
            // no está en `ALL_WIDGET_IDS` de DashboardView— así que el permiso
            // repartía acceso a una pantalla que nadie puede ver. Sus filas se
            // borraron en la misma migración.
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
            { key: 'dash_minmax_req',     label: 'Widget: Ajuste de Min/Max',     desc: 'Proponer cambios de mínimo/máximo por producto y sucursal; se envían a aprobación del supervisor', icon: BarChart2, hasApprove: false, hasScope: true },
            { key: 'dash_inv_movement',   label: 'Widget: Ajuste de Inventario',  desc: 'Solicitar que se cargue o se descargue producto —vencimiento, descarte, producto dañado o consumo interno—; el inventario se mueve al aprobarla', icon: PackageMinus, hasApprove: false, hasScope: true },
            { key: 'dash_traslados',      label: 'Widget: Traslados entre salas', desc: 'Ver lo que otra sala pide del inventario propio y lo que uno pidió y viene en camino', icon: Truck, hasApprove: false, hasScope: true },
            // `can_view` lista y descarga; `can_edit` es lo que habilita TOMAR
            // una factura. El alcance importa de verdad acá: con scope BRANCH la
            // base rechaza cualquier pedido sobre otra sala, no solo lo esconde.
            { key: 'dash_facturas_sala',  label: 'Widget: Facturas de mi Sala',   desc: 'Tomar la factura del proveedor que le corresponde a la sala —agua y recargas de Tigo, Claro y Movistar— para poder cargar la compra. Al tomarla queda registrada a nombre de esa sala y ya no le aparece a las demás', icon: ReceiptText, hasApprove: false, hasScope: true },
            // Los dos widgets de venta tienen DOS lecturas, y la capacidad
            // «vista completa» es la que decide cuál se pinta. Apagada, el
            // widget sigue estando —la sala necesita saber cómo va— pero habla
            // en porcentajes: se van los montos y quedan el cumplimiento, el
            // ritmo diario que hace falta y el ticket promedio. Es lo que se le
            // puede dejar puesto a una sala sin publicarle a cada quien cuánto
            // vendió el de al lado.
            { key: 'dash_meta_sala',      label: 'Widget: Meta del mes',          desc: 'Ver la meta de la sala con el avance del mes, lo vendido hoy y la proyección de cierre (scope BRANCH la limita a su propia sala)', icon: Target, hasApprove: false, hasScope: true, sub: [
                { key: 'dash_meta_sala_vista_completa', label: 'Vista completa (con los montos vendidos)', tipo: 'cap' },
            ]},
            { key: 'dash_vendedores',     label: 'Widget: Venta por vendedor',    desc: 'Ranking de vendedores del mes con su ticket promedio y sus días trabajados; muestra en rojo a quien está bajo el promedio de la sala (scope BRANCH lo limita a su propia sala)', icon: Users, hasApprove: false, hasScope: true, sub: [
                { key: 'dash_vendedores_vista_completa', label: 'Vista completa (con lo vendido por cada quien)', tipo: 'cap' },
            ]},
        ],
    },
    {
        group: 'Sistema',
        color: 'text-content-2',
        modules: [
            { key: 'kiosk_pin',    label: 'PIN de Marcación',       desc: 'Ver y copiar el PIN personal para marcar en el kiosco',     icon: ShieldCheck,   hasApprove: false },
            { key: 'su_pin',       label: 'Código SU (Supervisores)', desc: 'Ver el código SU de 6 dígitos para autorizar marcajes de jefes y subjefes', icon: ShieldAlert, hasApprove: false },
            { key: 'permissions',  label: 'Permisos de acceso',     desc: 'Control de acceso por rol a módulos del sistema',           icon: Lock,          hasApprove: false },
            // Faltaba en este registro y por eso NO se podía otorgar desde
            // Permisos (auditoría 2026-08-03): la ruta ya exigía
            // `PermissionGuard moduleKey="maintenance"`, el menú ya lo listaba
            // en Sistema y la base ya tenía filas para 2 roles — la única
            // pieza ausente era la de repartirlo. Es además el módulo que pone
            // a los demás en solo lectura, así que quedarse sin forma de
            // asignarlo es justo lo que no conviene.
            { key: 'maintenance',  label: 'Mantenimiento',          desc: 'Poner un módulo en solo lectura para el resto del personal, con motivo y duración: se sigue viendo todo, no se puede editar ni aprobar', icon: Wrench, hasApprove: false },
            { key: 'auditview',    label: 'Auditoría general',      desc: 'Registro completo de cambios y acciones en el sistema',     icon: Activity,      hasApprove: false },
            { key: 'ios_test',     label: 'Prueba iOS',             desc: 'Vista de prueba para verificar safe areas y layout en iOS', icon: Smartphone,    hasApprove: false },
            { key: 'sync_health',  label: 'Salud de syncs',         desc: 'Historial de corridas de sync por dominio (productos/minmax/compras/backup) y alertas de fallo', icon: RadioTower, hasApprove: false },
            { key: 'orphan_objects', label: 'Objetos huérfanos',   desc: 'Tablero de seguimiento de candidatos a código muerto (componentes, funciones, edge functions sin caller)', icon: Ghost, hasApprove: false },
            // Ver a qué hora y desde dónde se conecta cada persona es dato
            // sensible: se reparte con cuidado. `can_edit` es el que cierra.
            { key: 'sesiones',     label: 'Conexiones',             desc: 'Qué dispositivos tienen sesión abierta, cuándo se usaron por última vez y desde dónde; permite cerrar una a distancia', icon: MonitorSmartphone, hasApprove: false },
            // Aparte de `sesiones` a propósito: cerrar una conexión sólo impide
            // renovarla, mientras que bloquear deja a la persona sin entrar y sin
            // leer NADA desde la siguiente petición. Es más grave y se reparte a
            // menos gente.
            { key: 'bloqueos',     label: 'Bloquear personas',      desc: 'Quitarle a alguien el acceso al portal por completo, por un tiempo o hasta que se le devuelva; cierra sus conexiones y le impide entrar', icon: ShieldOff, hasApprove: false },
        ],
    },
];

// ── El grupo «Dashboard» se parte por PESTAÑA ────────────────────────────────
// Eran veinticuatro interruptores seguidos bajo un solo rótulo, y el tablero los
// muestra repartidos en cuatro pestañas: quien reparte permisos no tenía forma
// de saber qué pestaña estaba armando. Reportado el 2026-08-07: «como se tiene
// por pestañas, que estén separados».
//
// El reparto NO se copia acá: sale de `dashboardTabs.js`, el mismo que usa el
// tablero. Y se hace por transformación en vez de reescribir las entradas a mano
// para que las descripciones —que son largas y se afinaron una por una— sigan
// viviendo en un solo lugar.
//
// Cada widget cae en UN grupo: dos interruptores del mismo permiso no se pueden
// leer. Por eso acá se usa `tematicaDe`, que devuelve la pestaña propia o `null`
// — y no `catalogoDePestana`, que para General devuelve todo porque allá General
// SÍ es el resumen completo.
const ROTULO_PESTANA = {
    general:   'Inicio · General',
    comercial: 'Inicio · Comercial',
    rrhh:      'Inicio · RRHH',
    operacion: 'Inicio · Operación',
};

export const MODULE_GROUPS = GRUPOS_CRUDOS.flatMap(g => {
    if (g.group !== 'Dashboard') return [g];
    const enPestana = { general: [], comercial: [], rrhh: [], operacion: [] };
    // `overview` no es un widget: es el permiso de entrar a la vista. Encabeza
    // General, que es donde primero se mira.
    g.modules.forEach(m => {
        if (!m.key.startsWith('dash_')) { enPestana.general.push(m); return; }
        enPestana[tematicaDe(m.key.slice('dash_'.length)) || 'general'].push(m);
    });
    return Object.entries(enPestana)
        .filter(([, mods]) => mods.length)
        .map(([tab, mods]) => ({ group: ROTULO_PESTANA[tab], color: g.color, modules: mods }));
});

// Plano: key → { label, desc, icon, group }. Incluye los sub-permisos, que
// también son claves de role_permissions (y por lo tanto bloqueables).
export const MODULE_INFO = Object.fromEntries(
    MODULE_GROUPS.flatMap(g => g.modules.flatMap(m => [
        [m.key, { label: m.label, desc: m.desc, icon: m.icon, group: g.group }],
        ...(m.sub || []).map(s => [s.key, {
            label: `${m.label} › ${s.label}`,
            desc: s.tipo === 'cap'
                ? `Capacidad "${s.label}" dentro de ${m.label}`
                : `Pestaña "${s.label}" dentro de ${m.label}`,
            icon: m.icon,
            group: g.group,
        }]),
    ])),
);

// Helpers para separar los dos tipos sin repetir el filtro en cada pantalla.
export const pestanasDe   = (m) => (m.sub || []).filter(s => s.tipo === 'tab');
export const capacidadesDe = (m) => (m.sub || []).filter(s => s.tipo === 'cap');
