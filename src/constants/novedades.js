// Novedades del portal y la app, para el personal (2026-11-16).
//
// Cada persona ve lo que le toca, en dos niveles:
//
//   · La NOVEDAD entera exige el módulo que nombra (`modulo`, una clave de
//     `role_permissions`) y, si lleva `si`, esa condición. Quien no la cumple
//     no la ve. Una novedad de un módulo que todavía no se le dio a la
//     sucursal (Preventa, hoy) aparece sola el día que se da el permiso.
//   · Cada PASO y cada «ten en cuenta» puede ser texto (para todos los que ven
//     la novedad) o `{ t, si }`: sólo para quien cumple `si`. Así un
//     dependiente lee lo que hace él, y Bodega o administración leen lo suyo.
//
// `si` es `{ modulo, nivel }` (nivel: 'can_view' | 'can_edit' | 'can_approve'),
// `{ grupo }` (uno o varios de `GRUPOS`: basta uno), `{ alguno: [...] }`
// (basta una) o una lista de ésos, que se cumplen TODOS.
//
// Las capturas viven en `public/novedades/<año-mes>/`, tomadas de producción
// con los datos de clientes difuminados. Las animadas son WebP: un GIF de la
// misma grabación pesa diez veces más.
//
// Para agregar una tanda: un bloque nuevo ARRIBA en `TANDAS`, con su fecha.
// Los textos siguen `docs/reglas/como-habla-el-portal.md`.

export const APP_PERSONAL_IOS = 'https://apps.apple.com/sv/app/portal-farmasalud/id6817515258';
// La de Android vive en la prueba interna: sólo abre para un correo que ya está
// en la lista de Play Console (pestaña «Prueba Android»).
export const APP_PERSONAL_ANDROID = 'https://play.google.com/store/apps/details?id=lat.farmasalud.portal';
export const APP_PERSONAL_NOMBRE = 'Portal Farmasalud';

// Para lo que NO se distingue por permisos: los cargos de sala tienen los
// mismos módulos, y lo que cambia es la responsabilidad. Son ids de `roles`
// (los de administración son los de la memoria `user_admin_son_cuatro_cargos`).
export const GRUPOS = {
    sala: [19, 20, 23, 30, 41], // Jefe/a y Subjefe/a de Sala, Regente de Enfermería, Dependiente, Practicante
    jefe: [19, 20],             // Jefe/a y Subjefe/a de Sala
    bodega: [12, 15],           // Jefe/a de Compras y Logística, Auxiliar de Bodega
    admin: [2, 3, 11, 13, 33],  // Gerente General, Administrador, Talento Humano, Supervisor/a de Ventas (y QA, que los imita)
};

// `portada`: la imagen fija de la tarjeta (el último cuadro de la animación).
// La animación sólo corre al abrir la novedad.
const M = (archivo, tipo = 'animacion') => ({
    src: `/novedades/2026-11/${archivo}?v=2`,
    tipo,
    portada: `/novedades/2026-11/${tipo === 'animacion' ? archivo.replace(/\.webp$/, '-final.jpg') : archivo}?v=2`,
});
const EDITA = (modulo) => ({ modulo, nivel: 'can_edit' });
const APRUEBA = (modulo) => ({ modulo, nivel: 'can_approve' });

export const TANDAS = [
    {
        id: '2026-11-b',
        titulo: 'Segunda quincena de noviembre',
        desde: '2026-11-02',
        hasta: '2026-11-16',
        novedades: [
            {
                id: 'app-personal', modulo: null, nuevo: true, tema: 'app', especial: 'app-personal',
                icono: 'Smartphone', media: M('app-personal.jpg', 'icono'),
                titulo: 'Instala Portal Farmasalud, la app del personal',
                resumen: 'Consulta de precios, conteo, traslados y tus avisos en el teléfono.',
                para: 'Hacer desde el teléfono lo mismo que en la computadora, sin buscar una.',
                pasos: [
                    'En iPhone, descárgala de App Store.',
                    'En Android, deja aquí el correo de tu cuenta de Google. Cuando te llegue el aviso, descárgala de Google Play.',
                    'Entra con tu usuario y contraseña del portal.',
                ],
                ojo: [
                    'Ese correo también queda en tus datos de empleado y, si eres cliente, en tus datos de cliente.',
                    'Los avisos sin leer salen al abrir la app.',
                    'En Cuenta eliges qué pestaña rápida va en la barra.',
                    { t: 'En la app también cuentas inventario y ves la diferencia mientras cuentas.', si: EDITA('conteo_inventario') },
                    { t: 'Cumplimiento sanitario también está en la app.', si: [{ modulo: 'cumplimiento' }, { grupo: 'admin' }] },
                ],
                donde: 'App Store o Google Play',
            },
            {
                id: 'prueba-android', modulo: 'novedades', si: EDITA('novedades'), nuevo: true, tema: 'app', icono: 'Smartphone',
                media: null, ruta: '/novedades?tab=android',
                titulo: 'Da acceso a la app en Android',
                resumen: 'El personal con Android deja aquí su correo de Google. Tú lo agregas en Google Play y el portal le avisa que ya puede descargarla.',
                para: 'Que todo el personal tenga la app, también en Android.',
                pasos: [
                    'Abre la pestaña Android.',
                    'Toca Copiar correos.',
                    'Toca Abrir Google Play Console. Abre Portal Farmasalud → Pruebas internas → Testers, pega los correos y guarda.',
                    'Vuelve aquí y toca Agregados, avisarles. A cada uno le llega un aviso con sus pasos.',
                ],
                ojo: [
                    'Si alguien cambia su correo, vuelve a salir como por agregar.',
                    'Si alguien no vio el aviso, toca Avisar de nuevo en su fila.',
                ],
                donde: 'Avisos → Novedades → Android',
            },
            {
                id: 'preventa', modulo: 'preventa', nuevo: true, tema: 'vender', icono: 'Receipt',
                media: M('preventa.webp'), ruta: '/preventa',
                titulo: 'Preventa: arma la venta y mándala a caja',
                resumen: 'Atiendes al cliente en el portal y la venta llega a la caja con tu nombre. El cliente solo pasa a pagar.',
                para: 'Que el cliente no espere dos veces y que la venta quede a tu nombre aunque cobre otra persona.',
                pasos: [
                    'Elige al cliente. Ves sus puntos, lo que suele llevar y sus últimas compras.',
                    'Busca el producto o escanéalo. Con las flechas eliges y Enter lo agrega.',
                    'Si no hay aquí, te dice en qué sucursal hay: pídelo o apártalo.',
                    'Elige factura o crédito fiscal y si canjea puntos.',
                    'Toca Enviar a caja (F2).',
                ],
                ojo: [
                    'Antes de enviar te dice todo lo que falta, y cada aviso te lleva a corregirlo.',
                    'Si al cliente le falta un dato, toca Completar datos.',
                    'En el Inicio, el cuadro Preventa muestra lo que sigue sin cobrar y tiene el botón Nueva.',
                    'Es la primera opción de Comercial.',
                    { t: 'Hoy solo la usa administración. Las sucursales la ven el día que se les da el permiso.', si: { grupo: 'admin' } },
                ],
                donde: 'Comercial → Preventa',
            },
            {
                id: 'precios', modulo: 'dash_consulta_precios', nuevo: true, tema: 'vender', icono: 'Tag',
                media: M('precios.webp'), ruta: '/inicio',
                titulo: 'Consulta de precios en el Inicio',
                resumen: 'Busca por nombre o principio activo y ve el precio de cada presentación y la existencia en cada sucursal.',
                para: 'Responder «¿cuánto cuesta?» y «¿tienen?» sin salir del Inicio.',
                pasos: [
                    'En el Inicio, escribe en Consulta de precios.',
                    'Elige el producto con las flechas y Enter.',
                    'Toca Unidad, Blíster o Caja para ver sus precios.',
                ],
                ojo: [
                    'Regular y Preferente van lado a lado, y abajo Público, Mayoreo y Mayoreo Plus.',
                    'Abajo ves la existencia por lote en cada sucursal.',
                    { t: 'Si no hay en tu sucursal, mira cuál tiene y pide un traslado o aparta en Reservas.', si: { grupo: 'sala' } },
                    'También está en el Inicio de la app del personal.',
                ],
                donde: 'Inicio → Consulta de precios',
            },
            {
                id: 'clientes', modulo: 'clientes_crear', nuevo: true, tema: 'clientes', icono: 'UserPlus',
                media: M('cliente.webp'), ruta: '/clientes',
                titulo: 'Crea clientes nuevos desde el portal',
                resumen: 'El número de cliente se asigna solo. Eliges el tipo y el formulario te pide solo lo necesario.',
                para: 'Dejar al cliente listo para facturar desde la primera compra.',
                pasos: [
                    'Ve a Clientes y toca Nuevo cliente.',
                    'Elige el tipo: Consumidor, Contribuyente u Otro.',
                    'Llena lo que dice Requerido y toca Crear cliente.',
                ],
                ojo: [
                    'Si el cliente ya existe (mismo DUI, NIT o nombre), te lleva a sus datos en vez de duplicarlo.',
                    'El DUI y el NIT se revisan al escribirlos.',
                    'El giro se elige de la lista del Ministerio de Hacienda.',
                    'En la lista ves el nivel de Puntos Salud de cada cliente.',
                ],
                donde: 'Clientes → Clientes → Nuevo cliente',
            },
            {
                id: 'reservas', modulo: 'reservas', tema: 'clientes', icono: 'ShoppingBag',
                media: M('reservas.webp'), ruta: '/reservas',
                titulo: 'Encargos y reservas más claros',
                resumen: 'Cada encargo dice quién lo pidió, qué respondió Bodega, cuánto dejó de anticipo y cuánto falta.',
                para: 'Saber en qué va cada encargo sin llamar a nadie.',
                pasos: [
                    { t: 'Toca Nueva reserva y elige el producto: de tu sucursal, en camino o pedido a otra.', si: EDITA('reservas') },
                    { t: 'Si el cliente no deja anticipo, en Dónde paga elige Sin anticipo y marca Quedo como responsable.', si: EDITA('reservas') },
                    { t: 'Cuando llegue el producto, toca Ya llegó: apartar.', si: EDITA('reservas') },
                    { t: 'El encargo que dice Por cobrar se cobra desde su tarjeta: toca Cobrar.', si: EDITA('reservas') },
                    { t: 'Al avisarle al cliente, toca Registrar aviso, elige llamada o en persona y anota qué respondió.', si: EDITA('reservas') },
                    { t: 'Si el cliente lo compró directo en caja, en Más toca Ya se vendió para cerrarlo.', si: EDITA('reservas') },
                    { t: 'Abre Reservas: cada encargo dice qué sucursal lo pidió y qué falta.', si: { grupo: 'bodega' } },
                ],
                ojo: [
                    { t: 'Sin anticipo, el encargo queda a cargo de quien lo aparta. El cliente paga todo al retirar.', si: EDITA('reservas') },
                    { t: 'Cobrar solo sale en tu sucursal.', si: EDITA('reservas') },
                    'Desde que queda lista, el cliente tiene 30 días para retirarla.',
                ],
                donde: 'Comercial → Reservas',
            },
            {
                id: 'traslados', modulo: 'traslados', tema: 'productos', icono: 'Truck',
                media: M('traslados.webp'), ruta: '/traslados',
                titulo: 'Traslados: los paquetes viajan con la ruta',
                resumen: 'Los paquetes entre sucursales van con la ruta de reparto. Al recibirlos escaneas el ticket y confirmas.',
                para: 'Que ningún paquete se quede sin recibir y que una diferencia se aclare en el momento.',
                pasos: [
                    'Abre Traslados: cada solicitud dice qué lote viaja y en qué va el paquete.',
                    { t: 'Cuando la ruta te deje un paquete, firma con tu carné.', si: { grupo: 'sala' } },
                    { t: 'En Traslados toca Recibir traslado y pasa el lector por el ticket, o usa la cámara.', si: { grupo: 'sala' } },
                    { t: 'Confirma lo que llegó. Si vino de más, decláralo ahí mismo.', si: { grupo: 'sala' } },
                    { t: 'Al despachar, el portal te pide el lote o el vencimiento que falte.', si: { grupo: ['bodega', 'admin'] } },
                    { t: 'Una caja puede llevar varios lotes: escribe cada uno.', si: { grupo: ['bodega', 'admin'] } },
                    { t: 'El ticket va con la caja: en la sucursal lo escanean para recibir.', si: { grupo: ['bodega', 'admin'] } },
                ],
                ojo: [
                    { t: 'Si el paquete no era para tu sucursal, marca Llegó aquí por error.', si: { grupo: 'sala' } },
                    { t: 'Te llega un aviso cuando tu paquete viene en camino.', si: { grupo: 'sala' } },
                    'El ticket del traslado ahora trae el lote y el vencimiento de cada producto.',
                ],
                donde: 'Solicitudes → Traslados entre sucursales',
            },
            {
                id: 'corregir-lote', modulo: 'dash_inv_movement', nuevo: true, tema: 'productos', icono: 'CalendarClock',
                media: M('lote.webp'), ruta: '/inicio',
                titulo: 'Corrige lote o vencimiento sin esperar aprobación',
                resumen: 'Si un producto quedó con el lote o la fecha equivocada, lo corriges tú. Las unidades no cambian.',
                para: 'Que el vencimiento que ve el portal sea el de la caja que tienes en la mano.',
                pasos: [
                    'En el Inicio abre Ajuste de inventario.',
                    'Toca Corregir lote o vencimiento y busca el producto.',
                    'Elige el lote mal puesto y escribe el lote y el vencimiento de la caja.',
                    'Escribe por qué y guarda.',
                ],
                ojo: [
                    'El vencimiento va en mes y año.',
                    'Antes de guardar ves Así queda la sucursal.',
                    'Queda anotado quién lo hizo y por qué.',
                    { t: 'Como no pasa por aprobación, revisa de vez en cuando quién corrigió y por qué.', si: { grupo: ['jefe', 'admin'] } },
                ],
                donde: 'Inicio → Ajuste de inventario',
            },
            {
                id: 'lote-de-la-caja', modulo: 'dash_inv_movement', tema: 'productos', icono: 'PackageCheck',
                media: M('lote-final.jpg', 'foto'), ruta: '/inicio',
                titulo: 'Envíos y descartes piden el lote de la caja',
                resumen: 'Si el producto no tiene lote o fecha en el portal, al enviarlo, descartarlo o devolverlo te pide el que trae la caja.',
                para: 'Que el lote y el vencimiento viajen correctos de una sucursal a otra.',
                pasos: [
                    'Al enviar, descartar o devolver, agrega el producto como siempre.',
                    'Si no tiene lote, elige Sin lote asignado.',
                    'Escribe el lote y el vencimiento que dice la caja.',
                    'Guarda o envía.',
                ],
                ojo: [
                    'El vencimiento va en mes y año.',
                    'Lo dañado o vencido sin lote vuelve con el lote de la caja.',
                    'Ahora todo medicamento lleva lote: también te lo pide al recibir y en traslados.',
                ],
                donde: 'Inicio → Ajuste de inventario y Enviar producto',
            },
            {
                id: 'conteo', modulo: 'conteo_inventario', tema: 'productos', icono: 'ClipboardCheck',
                media: M('conteo.webp'), ruta: '/conteo-inventario',
                titulo: 'Conteo: lote y vencimiento en cada producto',
                resumen: 'Cada producto dice qué le falta, y lo que solo cambió de lote ya no cuenta como diferencia.',
                para: 'Contar más rápido y que la diferencia sea real.',
                pasos: [
                    'Abre el conteo de tu sucursal.',
                    'Escribe lo que cuentas en cada lote. Con + Lote agregas uno que no estaba.',
                    'Guarda lo contado. Después verás la columna Dif. con la diferencia.',
                    { t: 'Al revisar un conteo, la diferencia ya no incluye lo que solo cambió de lote.', si: APRUEBA('conteo_inventario') },
                ],
                ojo: [
                    'Un producto regulado pide lote y vencimiento; uno perecedero, solo vencimiento; los demás, solo la cantidad.',
                    'En la app del personal ves la diferencia mientras cuentas.',
                    { t: 'Si un lote está mal puesto, usa Corregir lote.', si: { modulo: 'dash_inv_movement' } },
                ],
                donde: 'Inventario → Conteo de inventario',
            },
            {
                id: 'que-falta', modulo: null, tema: 'sucursal', icono: 'CircleAlert',
                media: M('avisos.jpg', 'foto'),
                titulo: 'Los formularios te dicen qué falta',
                resumen: 'Si un formulario no está completo, el aviso dice qué falta y te lleva directo a ese campo.',
                para: 'No perder tiempo buscando por qué no se guarda.',
                pasos: [
                    'Llena el formulario.',
                    'Si algo falta, se marca en rojo y abajo dice qué es.',
                    'Toca el aviso y te lleva al campo.',
                ],
                ojo: ['Vale en enviar producto, apartar, nuevo cliente, devolver pedido y las demás ventanas.'],
                donde: 'En todo el portal',
            },
            {
                id: 'cumplimiento', modulo: 'cumplimiento', si: { grupo: 'admin' }, nuevo: true, tema: 'sucursal', icono: 'ShieldCheck',
                media: M('cumplimiento.jpg', 'foto'), ruta: '/cumplimiento',
                titulo: 'Cumplimiento sanitario de tu sucursal',
                resumen: 'Las obligaciones sanitarias de tu sucursal en un solo lugar, con lo urgente primero.',
                para: 'Saber qué te falta antes de que llegue la inspección.',
                pasos: [
                    'Abre Cumplimiento sanitario.',
                    'Revisa Qué toca hacer: lo rojo tiene plazo corriendo.',
                    'Toca la obligación y anota el registro desde ahí.',
                ],
                ojo: [
                    'Acreditación del mostrador, autoinspección, vencidos, retiros y farmacovigilancia.',
                    'Ves todas las sucursales: empieza por la que tiene más en rojo.',
                    'También está en la app del personal.',
                ],
                donde: 'Bitácoras → Cumplimiento sanitario',
            },
            {
                id: 'puntos-personal', modulo: null, nuevo: true, tema: 'tuyo', icono: 'Star',
                media: M('puntos-personal.jpg', 'foto'),
                titulo: 'Ganas puntos en cada compra',
                resumen: 'Como parte del personal, ganas 1 punto por cada $1 en cualquier compra, sea al precio que sea.',
                para: 'Que tus compras en la farmacia también te den puntos para canjear.',
                pasos: [
                    'Al pagar en caja, da tu DUI o tu número de cliente.',
                    'Paga como siempre.',
                    'Mira tus puntos en la app Puntos Salud o en app.farmasalud.lat.',
                ],
                ojo: [
                    'Vale desde el 15 de noviembre.',
                    'Lo que pagas con puntos no suma puntos.',
                ],
                donde: 'En caja, con tu DUI',
            },
            {
                id: 'mi-perfil', modulo: 'emp_profile', nuevo: true, tema: 'tuyo', icono: 'UserRound',
                media: M('mi-perfil.jpg', 'foto'), ruta: '/mi-perfil',
                titulo: 'Mi perfil con tu semana real',
                resumen: 'Tu perfil muestra la semana con tu horario de verdad, las horas que llevas y tus datos.',
                para: 'Saber tu horario de la semana sin preguntarle a nadie.',
                pasos: [
                    'Toca tu nombre abajo en el menú para abrir Mi perfil.',
                    'Revisa la tarjeta de la semana: Hoy va marcado.',
                    'Toca Solicitudes pendientes para ver las tuyas.',
                ],
                ojo: ['También está en la app del personal, en Cuenta.'],
                donde: 'Tu nombre, abajo en el menú → Mi perfil',
            },
            {
                id: 'voucher', modulo: 'caja_vales', si: EDITA('caja_vales'), nuevo: true, tema: 'vender', icono: 'CreditCard',
                media: M('voucher.jpg', 'foto'), ruta: '/caja',
                titulo: 'El voucher pide total y número',
                resumen: 'Al cobrar con tarjeta, además de la foto del voucher escribes el total y el número.',
                para: 'Que cada pago con tarjeta cuadre en el corte sin buscar el papel.',
                pasos: [
                    'En Cómo pagó elige Tarjeta y sube o toma la foto del voucher.',
                    'Escribe el total y el número del voucher.',
                    'Si no se leen, toca No puedo leer el total o el número y explica por qué.',
                ],
                ojo: [
                    'Sin total y número, o sin explicar por qué, no se guarda.',
                    'Si no hay voucher, toca No tengo el voucher y escribe por qué.',
                    'Lo que no se pudo leer queda pendiente de autorización.',
                ],
                donde: 'Efectivo → Hoy → Entrada → Cómo pagó',
            },
            {
                id: 'cierre-mensual', modulo: 'corte_z', nuevo: true, tema: 'sucursal', icono: 'FileText',
                media: M('cierre-mensual.jpg', 'foto'), ruta: '/corte-z',
                titulo: 'Cierre mensual por sucursal',
                resumen: 'El cierre mensual de cada sucursal, con sus montos y el PDF para descargar.',
                para: 'Revisar el mes de una sucursal sin pedir el reporte.',
                pasos: [
                    'Abre Cierre mensual.',
                    'Elige el mes con las flechas.',
                    'Revisa los montos y el cotejo contra el libro, o descarga el PDF.',
                ],
                ojo: ['También está en la app del personal.'],
                donde: 'Datos contables → Cierre mensual',
            },
            {
                id: 'quien-esta', modulo: 'dash_shifts', nuevo: true, tema: 'sucursal', icono: 'Users',
                media: M('quien-esta.jpg', 'foto'), ruta: '/inicio',
                titulo: 'Quién está hoy, en el Inicio',
                resumen: 'El Inicio muestra quién está trabajando y quién falta hoy, y en Cumpleaños y Calendario quién cumple y el próximo feriado.',
                para: 'Saber de un vistazo con quién cuentas hoy.',
                pasos: [
                    'Abre el Inicio.',
                    'Mira Quién está hoy: en labores o ausente.',
                    'En tamaño chico, Cumpleaños dice quién cumple hoy y Calendario el próximo feriado.',
                ],
                ojo: ['Con Personalizar, arriba a la derecha, eliges el tamaño de cada cuadro.'],
                donde: 'Inicio → General o RRHH',
            },
            {
                id: 'solicitudes-inicio', modulo: 'dash_requests', nuevo: true, tema: 'sucursal', icono: 'Inbox',
                si: { alguno: [APRUEBA('requests'), APRUEBA('requests_personales')] },
                media: M('solicitudes.jpg', 'foto'), ruta: '/inicio',
                titulo: 'Decide solicitudes desde el Inicio',
                resumen: 'Apruebas o rechazas una solicitud sin salir del Inicio.',
                para: 'Que nadie espere por una solicitud que se resuelve en un toque.',
                pasos: [
                    'En el Inicio, en Solicitudes pendientes, toca una.',
                    'Revisa el detalle.',
                    'Toca Aprobar o Rechazar.',
                ],
                ojo: ['Cada número del Inicio lleva a su lista completa.'],
                donde: 'Inicio → Solicitudes pendientes',
            },
            {
                id: 'vencidos-bodega', modulo: 'cargar_compra', si: EDITA('cargar_compra'), nuevo: true, tema: 'productos', icono: 'Archive',
                media: M('vencidos-bodega.jpg', 'foto'), ruta: '/inicio',
                titulo: 'Bodega: pasa producto a vencidos',
                resumen: 'En Bodega, pasas producto del estante a la bodega de vencidos con motivo y foto, y lo devuelves si fue por error.',
                para: 'Que lo vencido o dañado salga del inventario que se vende el mismo día.',
                pasos: [
                    'En el Inicio, en Ajuste de inventario, elige Enviar a bodega de vencidos.',
                    'Busca el producto, el lote y la cantidad.',
                    'Elige el motivo. Si es por daño, la foto es obligatoria.',
                    'Confirma.',
                ],
                ojo: [
                    'Solo sale estando en la sucursal Bodega.',
                    'Si fue por error, en Ajuste de inventario toca Devolver a bodega.',
                    'Mueve la existencia en el momento, sin aprobación.',
                ],
                donde: 'Inicio → Operación → Ajuste de inventario',
            },
            {
                id: 'puntos-web', modulo: null, nuevo: true, tema: 'clientes', icono: 'Star',
                si: { grupo: ['sala', 'admin'] },
                media: M('puntos.webp'),
                titulo: 'Puntos Salud también en el navegador',
                resumen: 'La app de clientes todavía no está disponible. Mientras tanto, entran desde cualquier teléfono o computadora en app.farmasalud.lat.',
                para: 'Que más clientes vean sus puntos, ofertas y reservas.',
                pasos: [
                    'Dile al cliente que entre a app.farmasalud.lat.',
                    'Entra con su documento y su teléfono.',
                    'Ahí ve sus puntos, ofertas, sus inyecciones, la tienda y las sucursales.',
                ],
                ojo: [
                    'Puede reservar y retirar sin fila.',
                    'La consulta de puntos del portal ahora lleva a la app.',
                ],
                donde: 'app.farmasalud.lat',
            },
        ],
    },
];

export const TEMAS = [
    { value: 'todos', label: 'Todo' },
    { value: 'vender', label: 'Vender' },
    { value: 'clientes', label: 'Clientes' },
    { value: 'productos', label: 'Productos y traslados' },
    { value: 'sucursal', label: 'Sucursal' },
    { value: 'tuyo', label: 'Para ti' },
    { value: 'app', label: 'Apps' },
];

/**
 * ¿Cumple esta persona la condición?
 * @param {any} si
 * @param {{ puede: (modulo: string, nivel: string) => boolean, roleId: number|null }} ctx
 */
export function cumple(si, ctx) {
    if (!si) return true;
    if (Array.isArray(si)) return si.every((x) => cumple(x, ctx));
    if (si.alguno) return si.alguno.some((x) => cumple(x, ctx));
    if (si.grupo) {
        const grupos = Array.isArray(si.grupo) ? si.grupo : [si.grupo];
        return grupos.some((g) => (GRUPOS[g] || []).includes(ctx.roleId));
    }
    if (si.modulo) return ctx.puede(si.modulo, si.nivel || 'can_view');
    return true;
}

const texto = (x) => (typeof x === 'string' ? x : x.t);
const lineas = (lista, ctx) => (lista || []).filter((x) => typeof x === 'string' || cumple(x.si, ctx)).map(texto);

/** Las novedades que esta persona ve, por tanda, con los pasos que le tocan. */
export function novedadesVisibles(ctx) {
    return TANDAS
        .map((t) => ({
            ...t,
            novedades: t.novedades
                .filter((n) => (!n.modulo || ctx.puede(n.modulo, 'can_view')) && cumple(n.si, ctx))
                .map((n) => ({ ...n, pasos: lineas(n.pasos, ctx), ojo: lineas(n.ojo, ctx) }))
                .filter((n) => n.pasos.length > 0),
        }))
        .filter((t) => t.novedades.length > 0);
}
