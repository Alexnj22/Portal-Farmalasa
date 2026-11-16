// Novedades del portal y la app, para el personal (2026-11-16).
//
// Cada novedad se muestra SÓLO a quien puede ver el módulo que nombra
// (`modulo`, una clave de `role_permissions`): así un dependiente no lee sobre
// pantallas que no tiene, y una novedad de un módulo que todavía no se le
// habilitó a la sucursal (Preventa, hoy) aparece sola el día que se le da el
// permiso. `modulo: null` = para todos.
//
// Las capturas viven en `public/novedades/<año-mes>/`, tomadas de producción
// con los datos de clientes difuminados. Las animadas son WebP: un GIF de la
// misma grabación pesa diez veces más.
//
// Para agregar una tanda: un bloque nuevo ARRIBA en `TANDAS`, con su fecha.
// Los textos siguen `docs/reglas/como-habla-el-portal.md`.

export const APP_PERSONAL_IOS = 'https://apps.apple.com/app/id6817515258';

const M = (archivo, tipo = 'animacion') => ({ src: `/novedades/2026-11/${archivo}`, tipo });

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
                titulo: 'Instala la app del personal',
                resumen: 'Consulta de precios, conteo, traslados y tus avisos en el teléfono.',
                para: 'Hacer desde el teléfono lo mismo que en la computadora, sin buscar una.',
                pasos: [
                    'En iPhone, toca «Abrir en App Store» e instálala.',
                    'En Android, escribe el correo de tu cuenta de Google (el del Play Store) y toca Guardar.',
                    'Te agregamos a la prueba y te llega el enlace para instalarla.',
                    'Entra con tu mismo usuario del portal.',
                ],
                ojo: [
                    'Ese correo también queda en tu ficha de empleado y, si eres cliente, en tu ficha de cliente.',
                    'Los avisos sin leer salen al abrir la app.',
                    'En Cuenta eliges qué pestaña rápida va en la barra.',
                ],
                donde: 'App Store o Google Play',
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
                    'También está en el Inicio de la app del personal.',
                ],
                donde: 'Inicio → Consulta de precios',
            },
            {
                id: 'clientes', modulo: 'clientes', nuevo: true, tema: 'clientes', icono: 'UserPlus',
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
                    'Toca Nueva reserva. Puedes pedir a otra sucursal aunque el cliente no deje anticipo.',
                    'Cuando llegue el producto, toca Ya llegó: apartar.',
                    'Si el cliente lo compró directo en caja, en Más toca Ya se vendió para cerrarlo.',
                ],
                ojo: [
                    'Sin anticipo, el encargo queda a cargo de quien lo aparta.',
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
                    'Cuando la ruta te deje un paquete, firma con tu carné.',
                    'En Traslados toca Recibir traslado y pasa el lector por el ticket, o usa la cámara.',
                    'Confirma lo que llegó. Si vino de más, decláralo ahí mismo.',
                ],
                ojo: [
                    'Si el paquete no era para tu sucursal, marca Llegó aquí por error.',
                    'Te llega un aviso cuando tu paquete viene en camino.',
                    'Al despachar te pide el lote o el vencimiento que falte. Una caja puede llevar varios lotes.',
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
                    'Si falta el lote o el vencimiento, escribe el de la caja.',
                    'Guarda.',
                ],
                ojo: [
                    'El vencimiento va en mes y año.',
                    'Lo dañado o vencido sin lote vuelve con el lote de la caja.',
                ],
                donde: 'Inicio → Ajuste de inventario y Enviar producto',
            },
            {
                id: 'conteo', modulo: 'conteo_inventario', tema: 'productos', icono: 'ClipboardCheck',
                media: M('conteo.webp'), ruta: '/conteo-inventario',
                titulo: 'Conteo: lote y vencimiento en el mismo renglón',
                resumen: 'Cada producto dice qué le falta, y lo que solo cambió de lote ya no cuenta como diferencia.',
                para: 'Contar más rápido y que la diferencia sea real.',
                pasos: [
                    'Abre el conteo de tu sucursal.',
                    'Escribe lo que cuentas en cada lote. Con + Lote agregas uno que no estaba.',
                    'Revisa la columna Dif. antes de cerrar.',
                ],
                ojo: [
                    'En la app del personal ves la diferencia mientras cuentas.',
                    'Si un lote está mal puesto, usa Corregir lote.',
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
                id: 'cumplimiento', modulo: 'cumplimiento', nuevo: true, tema: 'sucursal', icono: 'ShieldCheck',
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
                    'También está en la app del personal.',
                ],
                donde: 'Bitácoras → Cumplimiento sanitario',
            },
            {
                id: 'puntos-web', modulo: null, nuevo: true, tema: 'clientes', icono: 'Star',
                media: M('puntos.webp'),
                titulo: 'Puntos Salud también en el navegador',
                resumen: 'Los clientes que no quieren bajar la app entran desde cualquier teléfono o computadora en app.farmasalud.lat.',
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
    { value: 'app', label: 'Apps' },
];

/** Las novedades que esta persona puede ver, por tanda. */
export function novedadesVisibles(puedeVer) {
    return TANDAS
        .map((t) => ({ ...t, novedades: t.novedades.filter((n) => !n.modulo || puedeVer(n.modulo)) }))
        .filter((t) => t.novedades.length > 0);
}
