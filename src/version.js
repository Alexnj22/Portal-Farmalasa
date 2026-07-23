// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments

export const APP_VERSION = '2.31.1';
export const APP_AUTHOR  = 'Edwin Nunez';

// v2.31.1 — fix(pwa): recarga automática al reanudar la app standalone.
// Descubrimiento clave (capturas del usuario, 2026-07-23 7:34am): la PWA
// mostraba los datos del día ANTERIOR (775 docs / $7,953) mientras Safari,
// en el mismo minuto, mostraba los de hoy (18 docs / $205) — iOS estaba
// RESUMIENDO la sesión suspendida de ayer en vez de recargar. Las apps
// "agregadas a inicio" nunca recargan solas al reabrirse (y no tienen
// botón de refresh): la instancia del usuario llevaba días corriendo
// código viejo, por eso NINGÚN fix de v2.30.x/v2.31.0 "funcionaba" — no
// habían llegado a ejecutarse ahí. Fix: script inline en index.html que,
// SOLO en modo standalone/nativo, recarga la página al volver a primer
// plano si estuvo oculta >30 min (con chequeo de navigator.onLine para no
// recargar hacia la pantalla offline). La verificación real de v2.31.0
// (shell reestructurado) sigue pendiente: requiere que el usuario mate la
// instancia zombie una vez (borrar ícono + re-agregar, o force-quit).

// v2.31.0 — fix(mobile): reestructura el shell móvil al patrón app-shell
// estándar — el fix estructural del header invisible en PWA standalone.
// Descartado el bug de iOS 26.1 (usuario en versión nueva, otros sitios
// PWA funcionan): el problema es la combinación exótica del shell propio.
// Cambios:
// 1. El wrapper autenticado, GlobalBackground y la raíz de AppLayout ya NO
//    llevan altura medida (`--app-100dvh` eliminado, script incluido):
//    `fixed inset-0` define la caja por definición del viewport — no puede
//    medir mal en ningún contexto (Safari tab / standalone / Capacitor).
// 2. Header móvil: de `position:fixed z-40` (anidado en main relative z-20
//    dentro del wrapper fixed — el fixed-en-contextos-anidados que el
//    compositor de WebKit standalone no pintaba, franja gris de la
//    auditoría) a flex-item normal del shell, con
//    `padding-top: env(safe-area-inset-top)` pintando su propio fondo bajo
//    el status bar (patrón claude.ai). Spacer compensatorio eliminado.
// 3. Bottom-tabs: de `fixed bottom-0` a flex-item final con safe-area;
//    padding compensatorio de #main-scroll eliminado (pb normal + safe
//    area bottom para el caso sin tabs). Strip de vidrio del safe-area
//    bottom eliminado (redundante con 2 y 3).
// 4. Cero `backdrop-filter` en el chrome móvil (header, bottom-tabs,
//    backdrop del drawer, cara del sidebar en <lg): fondos casi opacos en
//    su lugar. blur+fixed en standalone iOS tiene historial de bugs de
//    compositor; además alinea con la dirección Solid Modern
//    (AUDITORIA-TEMA-2026-07 §7.2). Desktop (lg:) queda pixel-igual.
// 5. Drawer móvil (aside): altura por `top-0 bottom-0` + márgenes en vez
//    de calc() medido — antes en standalone el alto calculado desbordaba
//    el viewport (margen safe-area-top 62px + alto viewport-16).
// A diferencia de v2.30.0 (flex-items que fallaron), aquí el alto del
// shell no depende de 100dvh ni de JS: inset-0 es el viewport exacto, así
// que los flex-items no pueden quedar fuera de pantalla.
//
// v2.30.3 — fix(mobile): GlobalBackground seguía en 100dvh crudo, no
// migrado en v2.30.2. Auditoría completa de todo `h-[100dvh]` en el shell
// autenticado: la capa de fondo ambiental (blur orbs, primer hijo dentro
// del wrapper ya migrado) seguía sin usar `--app-100dvh`. Corregido por
// consistencia — pero medido en vivo con Playwright ANTES de este cambio
// ya mostraba el wrapper, #main-scroll y el contenido correctamente
// dimensionados (664px exactos, sin holgura), así que esta inconsistencia
// específica no explica el bug reportado por el usuario (persiste tras
// 3 intentos — v2.30.0/1/2 — en su dispositivo real, nunca reproducido en
// dev, build de producción, ni la URL real vía Playwright/WebKit). Este
// entorno no tiene Xcode.app (solo Command Line Tools, sin simulador) ni
// Android SDK/emulador — sin acceso a un dispositivo real o simulador,
// diagnosticar más a ciegas no es productivo; el siguiente paso requiere
// datos en vivo del dispositivo real del usuario (Safari Remote Web
// Inspector o info de modelo/versión de iOS).
//
// v2.30.2 — fix(mobile): 100dvh medido por JS en vez de confiar en el CSS
// nativo. El usuario confirmó que v2.30.1 (revert de header/tabs a fixed)
// NO resolvió nada — mismos síntomas exactos: ☰ ausente en modo standalone
// y una franja blanca real (no solo el toolbar de Safari) al fondo, en
// ambos contextos. Eso descarta la teoría de v2.30.1 (posición fixed vs
// flex-item) como causa suficiente: si `position:fixed` se posiciona
// contra el viewport real sin importar el alto de sus ancestros, el ☰
// debería verse SIEMPRE — que siguiera desapareciendo apunta a que el
// propio `100dvh` nativo se está midiendo mal en el dispositivo real del
// usuario en modo standalone, afectando todo lo que depende de él
// (incluida la franja blanca: el shell termina antes del borde real de
// pantalla y se ve el blanco default de la WebView detrás).
//
// No reproducible con Playwright (simula un viewport exacto y estático,
// nunca la ambigüedad real de dvh en iOS standalone) ni con Xcode
// Simulator (no instalado en esta máquina — solo Command Line Tools, sin
// Xcode.app; tampoco hay Android SDK/emulator). Sin poder verificar en
// vivo, se aplica el fix estándar de la industria para exactamente esta
// clase de bug: medir el alto real vía JS
// (`visualViewport.height` con fallback a `innerHeight`, más preciso que
// `dvh` con teclado/barra dinámica) y exponerlo como variable CSS
// `--app-100dvh` (script inline en index.html, corre antes de que React
// monte + listeners de resize/orientationchange/visualViewport). El shell
// (`App.jsx` wrapper autenticado, div raíz de `AppLayout`, aside en
// móvil) usa `var(--app-100dvh, 100dvh)` — el fallback a `100dvh` nativo
// solo cubre el instante antes de que el script corra, nunca se depende
// de él solo. Verificado en dev/WebKit que la variable se fija
// correctamente (664px = innerHeight) y que scroll + desktop siguen
// intactos — pero la confirmación real solo la puede dar el usuario en su
// dispositivo, ya que el bug nunca fue reproducible en este entorno.
//
// v2.30.1 — fix(mobile): header/bottom-tabs vuelven a position:fixed
// (regresión de v2.30.0). El usuario reportó en vivo, en el sitio en
// producción y ESPECÍFICAMENTE en el modo "agregar a inicio" (PWA
// standalone, no Safari normal): el ícono ☰ desaparecía arriba y quedaba
// un espacio en blanco enorme abajo sin usar toda la pantalla. Reproducido
// con capturas reales del usuario (Safari normal: perfecto; webapp
// standalone: roto) — no reproducible con Playwright/WebKit (no puede
// emular `display-mode: standalone`), así que no lo detecté en la
// verificación original de v2.30.0.
//
// Causa: v2.30.0 convirtió el header y los bottom-tabs de `position:fixed`
// (independientes del alto del shell, ya que se posicionan contra el
// viewport sin importar la cadena de contenedores) a flex-items normales
// DENTRO de un shell cuyo alto depende enteramente de que `100dvh` se
// calcule bien en el div raíz de AppLayout. iOS calcula `100dvh` distinto
// en modo standalone (PWA instalada) que en una pestaña normal de Safari
// — ahí es donde este fix no alcanzaba: si ese cálculo sale mal, TODO lo
// que dependía de él (header, contenido, tabs) se corría/recortaba en
// bloque, dejando el patrón exacto reportado (header cortado arriba,
// hueco abajo).
//
// Fix: header y bottom-tabs vuelven a `position:fixed` (como estaban antes
// de v2.30.0) — inmunes a esa ambigüedad de `100dvh`, ya que se posicionan
// contra el viewport real sin depender del alto calculado del shell. Se
// restaura el spacer de altura fija tras el header y el padding-bottom
// compensatorio en `#main-scroll` para hasSelfOnly, exactamente como antes
// de v2.30.0. Lo que SÍ se mantiene (y sigue arreglando el bug real de
// scroll de la auditoría 2026-07-18): `#main-scroll` con
// `overflow-y-auto` real en todos los breakpoints y el alto sin
// condicionar a `lg:` en el div raíz de AppLayout — verificado de nuevo
// en vivo tras este cambio, sigue scrolleando igual. Modelo híbrido: el
// contenido interno confía en el alto del shell (funciona en todos los
// contextos probados), pero el chrome de navegación (header/tabs) no
// depende de él en absoluto.
//
// v2.30.0 — fix(mobile): Fase 1 de PLAN-MOBILE-2026-07.md — restaura el
// scroll en móvil vertical, roto desde hacía semanas (auditoría 2026-07-18).
// Causa raíz verificada con Playwright/WebKit iPhone 13 contra dev server:
// el div raíz de AppLayout solo fijaba altura (`h-[100dvh]`) y overflow
// bajo `lg:`, así que en móvil no tenía altura acotada — sin eso, ningún
// hijo (incluido #main-scroll) podía calcular un `flex-1/min-h-0` real, y
// el contenido simplemente desbordaba, clippeado en silencio por el
// wrapper `fixed overflow-hidden` de App.jsx sin ningún scroll container
// que lo alcanzara. Medido antes/después: `#main-scroll` pasó de
// `scrollHeight === clientHeight` (sin scroll posible) a `clientHeight`
// acotado al viewport con `scrollHeight` mayor y `scrollTop` sostenible.
// Modelo nuevo: altura de AppLayout sin condicionar a `lg:`, `#main-scroll`
// como scroll container real en todos los breakpoints
// (`flex-1 min-h-0 overflow-y-auto lg:overflow-hidden`), header móvil y
// bottom-tabs pasan de `position:fixed` a flex-items normales dentro de
// `<main>` (spacer manual y padding compensatorio eliminados — la altura
// la da el flex layout). Se elimina el useEffect-hack que forzaba
// `overflow:auto` inline sobre html/body/#root (parche que quedaba
// anulado por el wrapper fixed y ya no hace falta con scroll interno) y
// el componente muerto `MobileConstructionScreen` (desmontado desde
// b01bf8f, la definición seguía en App.jsx). Verificado: swipe/scrollTop
// funcional en /ventas /overview /home, hamburger + drawer abren
// correctamente, cero scroll horizontal de página, desktop pixel-igual
// (screenshots 1440px antes/después). Fase 2 (crash intermitente del
// Dashboard) diagnosticada pero NO resuelta en este commit — ver nota
// aparte; no era consecuencia de este fix (reproducido igual con la
// Fase 1 aplicada).
//
// v2.29.3 — fix(facturas-compra): zoom duplicado en el visor de PDF +
// pinch-zoom roto en móvil, reportado por el usuario en vivo en
// /facturas-compra. Causa real del "duplicado": el iframe del PDF (dentro
// de PdfZoomViewer, FormPurchaseDteViewer.jsx) tiene pointer-events:none a
// propósito (para que el contenedor reciba los gestos en vez del visor
// nativo), pero el visor nativo de PDF del navegador (Chrome/Edge) sigue
// DIBUJANDO su propia barra de zoom flotante encima del PDF aunque no sea
// clickeable — de ahí la barra doble. Confirmado con Playwright contra la
// URL firmada real de un documento (con y sin el fix, en iframe real y en
// navegación top-level) y también contra prod en vivo. Fix: agregar
// `#toolbar=0&navpanes=0&scrollbar=0` al src del iframe — open-param
// estándar que Chrome/Edge respetan para no dibujar su UI nativa; no se
// aplica al link "Abrir en pestaña nueva", donde si conviene tenerla.
//
// Pinch en móvil: el manejo de touch (touchstart/touchmove/touchend +
// cálculo de distancia entre 2 dedos) ya estaba implementado y probado
// correcto vía simulación de touch multi-punto (Chromium mobile emulation
// + CDP Input.dispatchTouchEvent, 100%→400% tras el gesto). El gap real es
// que Safari/iOS dispara gesturestart/gesturechange/gestureend — un
// mecanismo propio de WebKit para pinch, separado de los touch events
// estándar — que puede ganarle a touch-action:none y hacer zoom nativo de
// TODA la página en vez de solo el visor. Agregado: preventDefault en
// esos 3 eventos (no-op en Chrome/Firefox, que no los disparan); el
// cálculo de zoom real sigue siendo el mismo de siempre vía touchmove.

// v2.29.2 — fix(menu): badge del buscador mostraba ⌘K fijo, símbolo de
// teclado Mac que no existe en Windows/Linux — el usuario lo notó
// probando en Windows. El atajo en sí siempre funcionó en ambos
// (window keydown ya escuchaba metaKey || ctrlKey), pero el hint
// visual/tooltip estaba hardcodeado. Ahora SHORTCUT_LABEL detecta la
// plataforma vía navigator.userAgent (Mac/iPhone/iPad/iPod → '⌘K',
// cualquier otro → 'Ctrl K') y se usa tanto en el badge visible como
// en el title. Verificado con Playwright spoofeando userAgent de
// Windows y de Mac por separado: Windows muestra "Ctrl K", Mac sigue
// mostrando "⌘K".

// v2.29.1 — fix(menu): trigger del buscador menos invasivo, a pedido
// directo del usuario tras ver v2.29.0 en vivo ("puede ser un ícono, o
// algo menos invasivo"). Antes era su propia sección con border-b,
// fondo, padding extra y el badge ⌘K en una caja aparte — ahora es un
// botón más dentro de <nav>, con las mismas clases exactas que un ítem
// de menú normal (renderNavItem): mismo tamaño de ícono (20px/1.5),
// mismo hover, mismo padding. En colapsado se ve idéntico a cualquier
// otro ícono del riel — ya no hay un bloque separado. Verificado con
// Playwright: expandido se ve como un ítem más arriba de "Inicio",
// colapsado es solo un ícono en el riel, y el click sigue abriendo el
// modal en ambos casos.
//
// v2.29.0 — feat(menu): buscador global del menú (Cmd/Ctrl+K), a pedido del
// usuario tras la reestructuración del sidebar (v2.28.x) — con más grupos
// separados, la queja real era "no sé en cuál grupo metimos X". Nuevo
// MenuSearchModal.jsx: indexa los módulos ya visibles (filtrados por
// permiso en AppLayout, igual que el sidebar) contra su label + el label
// de su grupo + una lista de sinónimos por módulo
// (constants/menuSearchKeywords.js) usando smartFilter/tokenMatch/
// fuzzyScore (searchUtils.js, mismo motor que el buscador de Permisos) —
// así "venta de productos" encuentra Ventas y "fichas de empleados"
// encuentra Listado (Personal), sin que el usuario sepa el nombre exacto
// del módulo. Trigger: botón "Buscar" fijo bajo el logo en el sidebar
// (ícono solo si está colapsado) + ícono en la barra superior móvil +
// atajo global ⌘K/Ctrl+K. Modal glass centrado (mismo lenguaje visual que
// ConfirmModal): input con autofoco, resultados con ícono+label+
// breadcrumb de grupo, navegación por teclado (↑↓ + Enter, con wraparound)
// y footer de hints. Verificado con Playwright contra vite preview: abre
// por botón y por ⌘K, "venta de productos"→Ventas, "fichas de
// empleados"→Listado, query sin match muestra el empty state, Enter sobre
// "pedidos" navega a /pedidos y cierra el modal. Build de producción
// limpio.
//
// v2.28.2 — refactor(inicio): a pedido del usuario, corrige el alcance de
// v2.28.1 — solo pidió eliminar "Inicio" (emp_home/EmployeeHomeView), no
// "Dashboard". Dashboard (overview) PASA A SER Inicio: relabel 'Dashboard'
// → 'Inicio' en MODULE_MAP (AppLayout), PermissionsView y el título de
// GlassViewLayout dentro de DashboardView.jsx; icono LayoutDashboard →
// Home en ambos lugares (LayoutDashboard queda sin uso ahí, se quita el
// import). El viejo /home se elimina por completo: ruta en App.jsx,
// import lazy de EmployeeHomeView, fallback en defaultRedirect,
// '/home' de ROUTE_TITLES, entrada 'emp_home' de MODULE_MAP/SELF_KEYS/
// MENU_GROUPS/PermissionsView, y los archivos
// src/views/employee/EmployeeHomeView.jsx + src/data/employeeHome.js
// (sin otros consumidores, confirmado por grep antes de borrar).
//
// Write a prod (confirmado explícitamente por el usuario): antes de
// borrar el fallback de emp_home en defaultRedirect, se detectó vía
// SQL que 3 roles (Regente de Enfermeria=7 empleados, Tecnico de
// Mantenimiento y Servicios Generales=2, Supervisor/a de Ventas=1)
// dependían de emp_home=true para aterrizar en algún lado al iniciar
// sesión — no tienen ningún otro permiso de la lista de fallback
// (emp_requests, etc.), solo permisos de negocio (productos, ventas_*)
// que ese redirect no revisa. Sin este fix habrían caído en /no-access.
// Se les otorgó can_view=true en 'overview' (mismo perfil que tenían en
// emp_home, ahora unificado bajo Inicio). Verificado con Playwright
// (vite preview): sidebar muestra "Inicio" activo y resaltado, header
// de la vista dice "Inicio", visitar /home directo redirige a /overview
// en vez de página muerta, build de producción limpio (sin chunk de
// EmployeeHomeView).
//
// v2.28.1 — refactor(menu): separa "Inventario" (9→3 módulos) en tres grupos
// del sidebar (a pedido del usuario). Nuevo grupo "Producto" (Productos +
// Laboratorios, el catálogo). Nuevo grupo "Pedidos a Sucursales" (solo
// pedidos, ítem individual — antes mezclado con catálogo y control de
// stock). "Inventario" ahora solo control de stock: Min/Max, Ventas
// Perdidas, Conteo de Inventario (icono Boxes en vez de Package, que pasó
// a "Producto"). Elimina del sidebar los grupos "Dashboard" (overview) e
// "Inicio" (emp_home) — rutas/permisos intactos, se van a rediseñar en el
// futuro dashboard unificado; por ahora sin entrada de menú.
//
// v2.28.0 — refactor(menu): reestructura MENU_GROUPS del sidebar (a pedido
// del usuario). Inventario tenía 9 módulos mezclando 3 dominios sin
// relación (inventario real, compras/proveedores, logística inter-
// sucursal); Comercial tenía 6 (ventas mezclado con incentivos). Nómina
// vivía dentro de "Personal" junto al directorio; Clima Organizacional
// estaba partido entre su propio grupo (encuesta) y RRHH (encuesta_admin).
// Grupos nuevos: "Nómina" (solo payroll), "Promociones" (promociones +
// bonificaciones, separado de Comercial) y "Compras" (compras +
// facturas_compra + proveedores, separado de Inventario). Clima
// Organizacional ahora incluye encuesta + encuesta_admin juntos. Ningún
// grupo queda con más de 6 ítems. Verificado con Playwright: sidebar y
// accordions abren correctamente, sin grupos huérfanos.


// v2.27.6 — fix(proveedores): botón "Guardar Cambios" del modal de detalle
// no quedaba fijo como en Nuevo Empleado — la causa: editProveedor vive en
// HIDES_FOOTER de UnifiedModal.jsx (guardado propio, multi-parte: categoría/
// match ERP se guardan solos al cambiar, aparte del botón), así que nunca
// tuvo el footer compartido que SÍ vive fuera del área con scroll para
// newEmployee/editBranch/etc. En vez de mover ese guardado al switch
// centralizado de App.jsx (handleSubmit por modalType), se fijó el propio
// botón con `position: sticky; bottom: 0` dentro del mismo contenedor
// scrolleable — mismo resultado visual, sin tocar el guardado multi-parte
// existente. Verificado con Playwright (visible sin scrollear, viewport
// bajo a propósito para forzar el caso).


// v2.27.5 — feat(facturas-compra): el buscador de Documentos ahora
// encuentra por alias del proveedor (proveedores_maestro.alias, v2.27.1)
// — antes solo funcionaba en el módulo Proveedores. get_purchase_dte_documents
// agrega proveedor_alias al SELECT; tokenMatch lo incluye en TabDocumentos
// (filtro principal + snippet de "match por contenido del ítem").


// v2.27.4 — fix(proveedores): tabla no cabía en el ancho — columna
// Proveedor sin tope de ancho se estiraba con nombres largos y empujaba
// todo lo demás. Columna Giro eliminada del todo (sigue siendo buscable,
// solo ya no se muestra). Proveedor con w-[260px] + max-w+truncate en el
// nombre; Categoría y Match ERP también truncan en vez de desbordar o
// envolver en 4 líneas (caso real: "DISTRIBUIDORA ISRAEL ( ANA FRANCISCA
// CEDILLOS"). Badges (Tipo, "Sin categoría", "Sin match ERP") con
// whitespace-nowrap — antes partían la palabra a la mitad en columnas
// angostas. Verificado con Playwright a 1920px y 1440px.


// v2.27.3 — fix(proveedores): reestructura el modal de detalle
// (FormProveedorDetail.jsx) — la fila de 4 columnas (Tipo de Proveedor/
// Categoría/Categoría Contable/Match ERP) quedaba tan angosta que el texto
// de los LiquidSelect se encimaba con el ícono/flecha. Ahora son 2
// secciones con encabezado (Clasificación, Contacto y Pago, Estado y
// Notas) en grids de 2 columnas — hechos derivados (Tipo de Proveedor,
// Categoría Contable) como badges de solo lectura, separados de las 2
// decisiones editables (Categoría, Match ERP). UnifiedModal: ícono
// genérico (Settings) reemplazado por Truck para editProveedor, ancho
// max-w-2xl→max-w-3xl, y el título dejó de usar leading-none (se
// aplastaba en 2 líneas con nombres largos de razón social).


// v2.27.2 — fix(facturas-compra): mensaje de "Sincronizar" y de descarga
// masiva pasan a toast en vez de texto inline pegado al botón (pedido del
// usuario) — quita el `syncMsg` que quedaba truncado/apretado junto al pill
// de fecha; error de sync también pasa a toast (antes se perdía si el
// usuario no miraba justo ahí). Descarga masiva ahora confirma con un toast
// de éxito al terminar (antes no daba ninguna señal de que ya cerró el ZIP).

// v2.27.1 — fix(proveedores): "Tipo de Proveedor" mostraba la clase de
// gasto/costo de la categoría asignada (renombrado a "Categoría Contable",
// sigue existiendo, solo estaba mal etiquetado). El tipo real, según el
// Código Tributario, es el régimen fiscal: Contribuyente de IVA (tiene NRC)
// vs Sujeto Excluido de IVA (Art. 119 CT, sin NRC — no da crédito fiscal, y
// si es persona natural por un servicio aplica retención de Renta 10%,
// Art. 156 CT). Derivado server-side en get_proveedores_maestro a partir de
// nrc IS NOT NULL — sin columna nueva ni backfill, ya viene NULL para
// sujetos excluidos desde proveedorFromDte.ts. Badge nuevo en la tabla y en
// el detalle. feat: columna `alias` (búsqueda alterna, ej. como le dicen de
// palabra en Bodega) — input en el detalle, tokenMatch en ProveedoresView.


// v2.27.0 — feat(facturas-compra/sync): adjuntos .zip en correos de compra ya
// no se descartan enteros ("no soportado v1") — sync-purchase-emails los abre
// en memoria (JSZip) y extrae los .json/.pdf al mismo pipeline de matching
// existente (fases 1-3), sin código de emparejamiento nuevo. Zips corruptos o
// con contraseña se guardan crudos y se encolan en Revisión (kind nuevo
// 'orphan_zip', migración 20260722220000 agrega el valor al CHECK) en vez de
// perderse en silencio. TabRevision muestra badge "ZIP sin abrir" para ese
// caso. Deploy verificado en prod (v46, cron corrió limpio tras el deploy).
// StatCard: valor principal ahora achica el font (18px) + truncate en vez de
// romper línea — pedido explícito tras el fix anterior (break-words).

// v2.26.3 — feat(permisos): nuevo permiso granular "Cards Contables"
// (facturas_compra_ver_montos) bajo Facturas de Compra en Permisos de
// Acceso — mismo patrón que minmax_ver_costos. Backfill (migración
// 20260722210000) mantiene la visibilidad actual para los 3 roles que ya
// veían las cards (Gerente General, Supervisor/a de Ventas, Contador
// Externo); cualquier otro rol arranca en false y se activa manualmente.
// fix(facturas-compra): valor de las StatCard con `break-words` — montos
// largos ya no se salían del borde de la card (sin espacios, el navegador
// no podía wrappear antes).
//
// v2.26.2 — fix(facturas-compra): bug real de extracción de IVA, encontrado
// explicándole al usuario las cards nuevas (2026-07-23). La card "Crédito
// Fiscal IVA" mostraba $36.82 para julio contra $199K de compras —
// proporción absurda. Causa: sync-purchase-emails leía total_iva de
// resumen.totalIva, campo que NO EXISTE en el esquema real de Hacienda
// (confirmado inspeccionando un CCF real) — el IVA vive en
// resumen.tributos[] como {codigo: "20", valor: N}. 513 de 516 documentos
// de julio tenían total_iva en NULL, incluyendo 415 CCF con IVA real sin
// extraer. Fix: extractTotalIva() lee tributos código 20 (con fallback a
// totalIva directo por si algún proveedor sí lo trae así). Nuevo modo
// backfill_total_iva (mismo patrón que backfill_items_text, pagina por
// total_iva IS NULL, re-lee el JSON ya guardado en Storage sin Gmail) —
// corrido en prod: 1,161 documentos recalculados, 1,038 con IVA real
// recuperado. Crédito Fiscal de julio pasó de $36.82 a $20,552.71
// (verificado en vivo). auth_can_edit_any ya cubre este modo (mismo gate
// que backfill_items_text/backfill_detect_codes).

// v2.26.1 — fix(facturas-compra): descarga masiva — auditoría real de
// tiempos + bug de descarga silenciosa (2026-07-23). Medido en vivo (caso
// real "Este mes", 518 docs, 2 tandas, 109MB): (1) probé concurrencia de
// descarga del edge function en 16/40/80 — sin diferencia (36-40s los
// tres); (2) probé DEFLATE nivel 1 en vez de STORE para reducir bytes —
// ahorra <5% (los PDF ya vienen comprimidos) Y ROMPIÓ el edge function con
// 50+ docs (500, probable OOM/CPU) — revertido de inmediato, quedó STORE.
// Conclusión: el cuello de botella es transferencia de datos real
// (~1.5-2MB/s sostenido, no mejora con más paralelismo del servidor) — no
// hay atajo de servidor. Lo que SÍ se corrigió: (a) bug real — a.click() +
// URL.revokeObjectURL() espalda-con-espalda sin agregar el <a> al DOM
// podía revocar el blob antes de que el navegador empezara a leerlo,
// perdiendo la descarga en silencio sin error en consola (exactamente lo
// reportado) — nuevo triggerDownload() con el patrón robusto (DOM
// append/click/remove + revoke con demora), aplicado en las 3 rutas de
// descarga del módulo; (b) las tandas ahora se piden en paralelo (antes
// esperaban una a la otra sin dependencia real entre ellas); (c) progreso
// real en MB descargados (Content-Length + ReadableStream) en vez de
// "tanda x/y" estático — la espera ahora se ve activa en vez de trabada.
// Verificado en vivo: descarga de 109MB completa y válida (unzip -t sin
// errores, 1044 archivos), progreso fluido 0.4→109.4 MB en pantalla.

// v2.26.0 — feat(facturas-compra): cards contables reemplazan filtros Tipo/
// Proveedor (pedido del usuario 2026-07-22: "ya en el buscador los
// filtra" — cierto desde el fix del buscador en v2.25.7). En su lugar, 5
// StatCard (componente compartido) con lectura contable real: Total
// Compras (bruto, excluye invalidados), Crédito Fiscal IVA (suma total_iva
// con signo — Notas de Crédito en negativo — excluye invalidados: Art.
// 119-E CT), Compras Netas (mismo signo aplicado a monto_total, ya neto de
// NC), Invalidados (count + monto excluido, clickable → filtra la tabla),
// Sin Proveedor (count de documentos sin proveedor_id — reemplaza el
// filtro "(sin proveedor)" del select eliminado, clickable → filtra).
// Cards calculadas sobre TODO el período (rows), no sobre la tabla ya
// filtrada por texto — mismo criterio que VentasView, para que no
// fluctúen solo por tipear en el buscador. Verificado en vivo: caso real
// de julio 2026 mostró 41 documentos sin proveedor (todos "Doc. Contable
// de Liquidación" de bancos/financieras — no son compras reales, dato
// nuevo que antes no era visible sin abrir el select uno por uno).

// v2.25.7 — fix(facturas-compra): 3 hallazgos reales tras probar el caso
// Jamilu/Suministros Enmanuel en vivo (2026-07-22). (1) Badge "Ver
// documento" en la fila de Documentos para todo doc invalidado con un PDF
// de anulación vinculado (mismo patrón que "Ver original" de NC/ND) —
// nuevo campo invalidacion_source en get_purchase_dte_documents (subquery
// sobre review_queue.matched_document_id). (2) Bug real: el documento 1281
// (SUMINISTROS ENMANUEL) ya estaba invalidado desde el 2026-07-19 vía el
// flujo JSON oficial de Hacienda, pero su fila de Revisión (267, aviso de
// Easyfact) se quedó pendiente para siempre — el detector automático solo
// reconocía la palabra "anulado" y el PDF decía "invalidación". Fix: si el
// documento YA está invalidado por cualquier vía, la fila se auto-resuelve
// sin pasar por Revisión (aplicado en sync-purchase-emails y en
// backfill_detect_codes); se limpió la fila 267 existente. (3) El buscador
// de Documentos no encontraba nada con "anulado" o "nota de credito" — solo
// conocía tipo_dte crudo ("05") y la palabra "invalidado"; ahora incluye la
// etiqueta legible del tipo (dteTypeLabel) y el sinónimo "anulado".

// v2.25.6 — feat(facturas-compra): 4 pedidos tras probar el flujo de
// Clasificar en vivo (2026-07-22). (1) ZIP masivo ahora organiza por carpeta
// de tipo_dte (Credito Fiscal, Nota de Crédito, etc. — catálogo MH
// duplicado en el edge function, Deno no puede importar src/) y agrega una
// carpeta "Revisar" con lo que sigue pendiente en Revisión (PDFs huérfanos,
// JSON inválido). (2) Empaquetado más rápido: compression STORE en vez de
// DEFLATE (los PDF ya vienen comprimidos, doble compresión era CPU
// desperdiciada — medido con un ZIP real de 1043 archivos/114MB, completa
// en ~154s en 2 tandas) + concurrencia de descarga 8→16 + camino rápido en
// el cliente que evita desempacar/reempacar cuando hay una sola tanda.
// (3) Bug real reportado — una descarga se quedó en "1/2" sin avanzar ni
// tirar error: supabase.functions.invoke() no tenía timeout propio, así que
// un edge function lento dejaba la UI colgada en silencio. Diagnosticado en
// vivo: NO era el edge function (probado con curl, 300 docs completan en
// 54s) sino que mi propio harness de QA usaba un puerto (4321) fuera del
// CORS allowlist del edge function (localhost:4173 es el válido) — "Failed
// to fetch" instantáneo, no un colgado real. Aun así se agregó
// AbortController con timeout de 120s por tanda para que un colgado
// genuino (red, function fría) muestre error en vez de esperar para
// siempre. (4) El PDF de anulación que justificó marcar un documento
// invalidado (ver classify_purchase_dte_review, v2.25.5) no tenía forma de
// verse desde el detalle una vez que la fila salía de Revisión — nuevo RPC
// get_purchase_dte_review_source(p_document_id) + link "Ver PDF de
// anulación" en el banner de invalidado (FormPurchaseDteViewer). Verificado
// en vivo contra el caso real de Grupo Jamilu (documento 1827).

// v2.25.5 — refactor(facturas-compra): rediseño del flujo de invalidado a
// pedido del usuario — el botón suelto "Marcar/Quitar invalidado" en
// FormPurchaseDteViewer (v2.25.4) no tenía contexto de QUÉ PDF lo
// justificaba. Se revirtió por completo (botón, estado, RPC
// set_purchase_dte_invalidado dropeado) y se reemplazó por "Clasificar" en
// TabRevision: junto a cada PDF huérfano, el usuario elige el tipo (aviso de
// anulación vs. otro documento relacionado) y el documento DTE al que se
// enlaza; el efecto (invalidar) es consecuencia de esa clasificación, con
// trazabilidad real vía review_queue.matched_document_id. Nuevo RPC
// classify_purchase_dte_review (SECURITY DEFINER, auth_can_edit_any).
// También: limpieza de viewDetail (ya no pasa canEdit/onInvalidadoChanged al
// modal, innecesario ahora que el flujo vive en Revisión).

// v2.25.4 — feat(facturas-compra): marca manual de invalidado + intento de
// detección automática (caso real Grupo Jamilu, 2026-07-22). Se amplió
// DOC_TYPE_NOTICE_RE para capturar "ANULADO"/"ANULADA" sueltos (antes solo
// frases completas) y se agregó detección específica (isAnulado) que
// marcaría invalidado=true automático en el documento con el mismo código
// — VERIFICADO EN VIVO contra el caso real antes de decidir si dejarlo
// automático (a pedido explícito del usuario): el sello "ANULADO" de Grupo
// Jamilu es un watermark gráfico, no texto seleccionable — unpdf no lo
// detecta, así que el mecanismo automático queda en el código (inerte para
// este tipo de caso, podría activarse si algún proveedor sí incrusta la
// palabra como texto real) pero NO es la vía confiable. En su lugar: nuevo
// RPC set_purchase_dte_invalidado + botón "Marcar/Quitar invalidado" en
// FormPurchaseDteViewer (visible solo con canEdit) — antes invalidado era
// 100% de solo lectura en toda la UI, sin ninguna forma manual de
// corregirlo. Reversible (toggle), auditado.

// v2.25.3 — fix(facturas-compra): TabRevision — modal + botones (feedback
// del usuario tras usar el módulo en vivo). (1) Click en el archivo abre el
// visor en modal (viewDocument/FormDocumentViewer, mismo patrón que "Ver
// detalle" en Documentos) en vez de una pestaña nueva del navegador. (2)
// Todos los botones de acción de Revisión (Detectar/Emparejar/Sin JSON/
// Descartar) rediseñados a ícono arriba + subtítulo chico abajo
// (ActionButton, componente nuevo reusable) — antes eran texto+ícono en
// línea, apretados. DetectCodeAction gana un modo `compact` para seguir
// viéndose bien en el badge inline de TabDocumentos, donde no cabe la caja
// grande.

// v2.25.2 — perf/fix(facturas-compra): E3 + E8 (PLAN-MEJORAS-DTE-
// PROVEEDORES-2026-07.md Fase 5, a pedido del usuario). (E3)
// upsert_proveedor_from_dte devuelve {id, supplier_id} en un solo json —
// sync-purchase-emails y backfill-proveedores-dte ya no hacen un SELECT
// aparte a proveedores_maestro solo para leer el supplier_id que el RPC ya
// calculó internamente (backfill-proveedores-dte ahora también setea
// supplier_id, algo que antes dejaba sin tocar). (E8) PDFs huérfanos cuyo
// código de generación coincide con un documento que YA tiene su propio
// PDF (dos documentos nunca deberían compartir codigoGeneracion — el
// segundo es o un reenvío del mismo archivo, o un aviso/nota distinta que
// solo lo menciona) se descartan automáticamente en vez de ensuciar
// Revisión — SOLO si dos señales coinciden: código Y tamaño casi idéntico
// (±2%) al PDF ya guardado. Bug real encontrado y corregido durante la
// verificación: la primera versión (solo por palabras clave del texto)
// descartó por error un aviso legítimo de "Comprobante Anulado" (Grupo
// Jamilu) que no usaba ninguna de las frases contempladas — false
// negative real en datos de producción, endurecido a exigir ambas señales
// antes de decidir solo. Verificado en prod: 5 de 6 PDFs re-evaluados
// bajo el criterio estricto siguen siendo duplicados reales (Súper
// Selectos ×3, Diszasa ×2); el de Grupo Jamilu correctamente vuelve a
// quedar pendiente de revisión humana.

// v2.25.1 — perf(facturas-compra): Fase 5 eficiencia (PLAN-MEJORAS-DTE-
// PROVEEDORES-2026-07.md), E1/E2/E4/E5/E6. (E1) selectDoneMessageIds
// reemplaza getDoneMessageIds — antes bajaba TODA
// purchase_dte_processed_messages de la cuenta en cada corrida (crece sin
// tope); ahora consulta solo los candidateIds de la ventana de Gmail de
// esta corrida, en chunks de 500. O(historial) → O(ventana). (E2)
// markMessagesProcessed: 1 upsert en lote al final de la corrida en vez de
// 1 por mensaje. (E4) export-purchase-dte-zip descarga JSON+PDF en tandas
// de 8 en paralelo en vez de en serie — una descarga de 300 docs baja de
// minutos a segundos. (E5) "Sincronizar ahora" se re-invoca sola mientras
// hasMore (tope de seguridad 10 tandas, contador visible "tanda N") — antes
// exigía que el usuario re-clickeara por cada tanda. (E6) backfill-
// proveedores-dte y backfill-dte-related-docs paginan por cursor (after_id/
// nextAfterId) en vez de re-consultar siempre "las primeras 200" — una fila
// que falla para siempre quedaba bloqueando la cabeza de la cola,
// hasMore nunca bajaba. Efecto colateral real del fix: backfill-dte-
// related-docs corrido en prod emparejó 43 NC/ND que habían quedado sin
// conectar a su documento original. Verificado en vivo: sync real (0-4
// mensajes según corrida) sin errores tras cada deploy.

// v2.25.0 — feat(facturas-compra): detección automática de Código de
// Generación en PDFs huérfanos (a pedido del usuario, extiende 3.2).
// sync-purchase-emails ahora extrae el UUID (dte_guia_tecnica.pdf pág. 7)
// de todo PDF huérfano server-side (unpdf, extracción de texto sin DOM/
// canvas, compatible con el runtime de Edge Functions) al momento de
// encolarlo a Revisión — antes dependía de un clic manual del usuario. Si
// el DTE ya está sincronizado y sin su propio PDF, se adjunta directo, sin
// pasar por Revisión. Si el JSON llega DESPUÉS del PDF, la reconciliación
// es igual de automática (se guarda el código detectado en
// purchase_dte_review_queue.ai_suggested — columna jsonb que existía sin
// usar — y el próximo insert de un DTE nuevo revisa si hay un huérfano
// pendiente esperando ese código). Nuevo RPC de solo lectura
// find_purchase_dte_document_by_codigo + botón "Detectar código" (pdfjs-
// dist client-side) como respaldo manual en Revisión y en Documentos
// ("Sin JSON"). Backfill (modo backfill_detect_codes) corrido en prod
// sobre los 13 PDFs huérfanos pre-existentes: 10 códigos detectados, 3 sin
// capa de texto legible. Bug real encontrado en el camino: 3 de esos 13
// eran PDFs de VENTAS que la propia cuenta de sync se mandaba a sí misma
// ("Comprobantes COF + JSON") — -in:sent no los excluía porque nunca
// pasaban por "Enviados" de Gmail (relay directo al inbox); agregado
// -from:{cuenta} al query + chequeo defensivo en el código, y las 3 filas
// contaminadas descartadas. Verificado en vivo: auto-detección sin clic,
// RPC find_by_codigo, y el guard existente (pdf_path IS NULL) bloqueando
// correctamente 2 intentos de emparejar avisos de anulación/duplicados
// contra documentos que ya tenían su PDF real — cero datos corrompidos.

// v2.24.2 — fix(facturas-compra): AttachJsonAction (3.2) ordena el listado
// "Adjuntar JSON" por cercanía de received_at al correo original en vez de
// filtrar por "sin PDF propio" — un reenvío que trae PDF+JSON juntos crea
// una fila YA completa (con su propio pdf_path), que ese filtro hubiera
// excluido del selector sin poder fusionarla. El listado sigue amplio a
// propósito (cualquier doc con JSON del período), solo reordenado.

// v2.24.1 — feat(facturas-compra): Fase 3 auditoría DTE+Proveedores
// (cumplimiento legal, Decreto 487 / Art. 147 CT). (3.1) sync-purchase-
// emails ahora sube TAMBIÉN los bytes originales del adjunto/link intactos
// (<codigo>.orig.json, columna orig_json_path) además del JSON normalizado
// que sigue siendo la fuente de UI/búsqueda — respaldo de integridad ante
// fiscalización, best-effort (no bloquea la ingesta si falla). Captura
// sello_recibido cuando el proveedor manda el sobre {selloRecibido,
// firmaElectronica, dteJson} (antes se descartaba). Gap documentado: no
// aplica retroactivo — los bytes originales de lo ya sincronizado solo
// viven en Gmail. (3.2) Acción manual "Adjuntar JSON" en Documentos (junto
// al badge "Sin JSON"): fusiona un doc confirmado-sin-JSON con su
// duplicado que sí trajo el JSON completo — RPC nuevo
// merge_purchase_dte_documents, conserva el PDF ya revisado, adopta datos
// estructurados+JSON del duplicado, repointea NC/ND relacionadas, borra el
// duplicado. Sin match automático a propósito: las filas sin JSON no
// guardan numero_control/monto/fecha/NIT, ningún campo confiable para
// fusionar sin intervención humana. (3.3) email_sync_log sumado al cron
// purge-sync-logs-daily (90 días); COMMENT ON TABLE en
// purchase_dte_processed_messages para que nadie la agregue a una purga
// futura (es el ledger anti-re-escaneo de Gmail).

// v2.24.0 — feat(facturas-compra): búsqueda por contenido del JSON (Fase 4,
// PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md, pedido directo del usuario).
// Caso real: COFARSAL vende saldo Claro/Tigo en sus CCF — buscar "claro"
// antes obligaba a abrir documento por documento porque el buscador solo
// cubría proveedor/NIT/número/código. Columna items_text (+ items_norm
// generada, mismo patrón que proveedores_maestro.nombre_norm) con las
// descripciones únicas de cuerpoDocumento[]; el sync la puebla en cada
// insert nuevo; backfill (modo backfill_items_text, mismo patrón que
// repair_stored_json) corrido en prod hasta hasMore:false — 1,169/1,169
// documentos. Búsqueda cliente (capa 1, alcanza para v1): items_text
// sumado a tokenMatch de TabDocumentos + get_purchase_dte_documents lo
// expone. UX: cuando el match viene del contenido (no de proveedor/
// número), sub-texto azul bajo el nombre mostrando el fragmento del ítem
// que matcheó. Verificado con Playwright + datos reales: "claro" → 4 CCF
// de COFARSAL, "tigo" → 3 CCF, ambos con snippet visible.

// v2.23.12 — feat(facturas-compra,proveedores): Fase 2 auditoría DTE+
// Proveedores (consistencia maestro vs ERP). (2.1) Filtro de Proveedor y
// botón "Emparejar" en Facturas de Compra migrados de suppliers (ERP) a
// proveedores_maestro — set_purchase_dte_proveedor (RPC nuevo) reemplaza
// set_purchase_dte_supplier; "(sin proveedor)" ahora es !proveedor_id.
// (2.2) sync-purchase-emails ya no resuelve supplier_id con su propio
// .eq('nrc', ...) exacto — lo deriva de proveedores_maestro.supplier_id
// después de upsert_proveedor_from_dte (que sí usa el match normalizado de
// dígitos). Backfill one-off en prod: 769 documentos actualizados. (2.3
// P4) NC/ND (05/06) ya no cuentan como "compra" para docs_count/
// ultima_vez_visto del proveedor. (2.3 P5) Columna percibe_1_override
// nueva — una corrección manual en el detalle de Proveedor ahora manda de
// verdad; antes el OR de la detección automática la revertía con el
// siguiente DTE que trajera IVA percibido.

// v2.23.11 — fix(facturas-compra,proveedores): Fase 1 de la auditoría
// 2026-07-19 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md). 4 bugs:
// (1) invalidaciones "pendientes" se perdían en silencio — el CHECK de
// purchase_dte_review_queue no permitía kind='invalidacion_pendiente' y el
// upsert no chequeaba error; agregado chequeo de error en TODOS los
// upserts/updates de sync-purchase-emails (selectAllMessageIds,
// markMessageProcessed, update invalidado, lookup supplier, upserts a
// review_queue) — si falla marcar invalidado o encolar a revisión, el
// mensaje ya NO se marca procesado, se reintenta. Remediación: re-scan con
// debug_query recuperó 1 invalidación más (CCF 4AE56C62..., Suministros
// Enmanuel). (2) invalidado era invisible en la UI (riesgo fiscal, Art.
// 119-E CT) — get_purchase_dte_documents ahora expone invalidado/motivo/at,
// badge rojo en TabDocumentos + banner en el visor + buscable por
// "invalidado". (3) filtro "(sin match ERP)" en Proveedores mostraba
// siempre 0 filas — el branch de categoría lo capturaba antes del manejo
// dedicado. (4) colisión de nombres en ZIP masivo para docs sin JSON
// (codigo_generacion NULL → null.json se pisaban entre sí) — fallback
// doc-${id}, más chequeo de error en .download() con manifest-errores.txt.
// Verificado con Playwright (login real, badge Invalidado visible y
// buscable, filtro sin-match-ERP con resultados).

// v2.23.10 — fix(sync-purchase-emails): valida contenido real antes de
// aceptar un link como candidato JSON. Bug encontrado por el usuario: 3
// filas en Revisión mostraban el HTML de un Warning de PHP en vez de un DTE
// (dteqr_json.php del proveedor farma_salud/clientesdte3 respondía HTTP 200
// con Content-Type application/json pero el body era
// "file_put_contents(...): failed to open stream" — el .json no existía en
// su filesystem). collectLinkAttachments() solo validaba el header
// Content-Type, nunca el body; ahora looksLikeJson() chequea que el
// contenido empiece con { o [ antes de aceptarlo, y si no, se omite con un
// warning que incluye la URL y un snippet del body real (antes el warning
// solo decía "JSON inválido (no parsea)" sin rastro de la causa). No afectó
// facturación real (estas filas nunca tocaron purchase_dte_documents), pero
// mejora el diagnóstico de proveedores con endpoints rotos.

// v2.23.9 — feat(facturas-compra): descarta acuses/Resp de Hacienda en
// silencio y conecta invalidaciones al DTE original. Antes, los JSON de
// "acuse de recibido" del MH (esquema propio: selloRecibido/estado top-level,
// mismo codigoGeneracion que el DTE real pero sin identificacion/
// cuerpoDocumento) y las notificaciones de "invalidación" (proveedor anula
// un DTE ya emitido) caían indistintas en purchase_dte_review_queue junto
// con JSON genuinamente roto. Ahora: acuses se descartan sin encolar (ruido
// esperado, no facturas perdidas); invalidaciones marcan
// purchase_dte_documents.invalidado=true en el documento original (columna
// nueva, migración 20260719160000) si ya existe, o se encolan con
// kind='invalidacion_pendiente' (distinto de invalid_json) si el DTE
// original aún no llegó. Limpieza retroactiva: 20 filas resueltas
// eliminadas de Revisión, 1 invalidación conectada (CCF 4AE56C62...,
// Suministros Enmanuel, motivo "CAMBIO DE PRODUCTO").

// v2.23.8 — chore(sync-purchase-emails): agrega parámetro debug_query
// (diagnóstico) al endpoint — permite pasar un query de Gmail custom y
// bypassear purchase_dte_processed_messages sin borrar la tabla. Usado para
// encontrar que los correos de Movistar reportados por el usuario (23/24 jun)
// llegaban a farmasalud.sv@gmail.com, no a compraslasalud.sv@gmail.com — el
// fix de v2.23.7 (imágenes tapando el cupo de links candidatos) sí era
// correcto, solo estaba mirando la cuenta equivocada. Recuperados 5
// documentos de Movistar en farmasalud.sv (jun-jul 2026) con el debug_query.

// v2.23.7 — fix(facturas-compra): dos bugs reportados por el usuario.
// (1) sync-purchase-emails: solo 2 de 5 correos Movistar de jun-jul se
// procesaban, en silencio (0 warnings). Causa: extractCandidateLinks()
// capturaba URLs de imágenes decorativas de la plantilla (ej.
// ".../factura-digital-fide_01.png", matchea LINK_KEYWORD_RE por tener
// "factura" en el nombre) como candidatos, y el slice(0, MAX_LINK_CANDIDATES)
// las contaba ANTES del loop que genera warnings — si una plantilla traía
// más imágenes que otra, el link real de descarga quedaba fuera del cupo sin
// dejar rastro. Fix: excluir extensiones de imagen de los candidatos
// (IMAGE_EXT_RE) + subir el cupo 6→10 de margen. Desplegado + reset de
// last_synced_date/purchase_dte_processed_messages solo para la cuenta
// compraslasalud.sv@gmail.com (id 2) para forzar re-escaneo desde junio.
// (2) FormPurchaseDteViewer: el iframe del visor de PDF no tenía zoom propio
// — en build nativo/PWA instalada, index.html fija user-scalable=no a nivel
// de página (a propósito), lo que también anulaba cualquier pinch-zoom
// dentro del iframe, y en desktop el toolbar del visor no aparece embebido.
// Fix: PdfZoomViewer nuevo — botones +/-/reset, Ctrl+rueda en desktop, y
// gesto de pinch (2 dedos) vía listeners táctiles nativos no-pasivos,
// independiente del bloqueo global de zoom del viewport.

// v2.23.6 — fix(facturas-compra/sync-purchase-emails): caso real reportado
// por el usuario — facturaelectronicamovistarsv@movistar.com.sv nunca se
// descargaba, ni con la búsqueda ya ampliada de v2.23.5. Causa real (2
// capas): (1) el correo de Movistar no tiene NINGÚN adjunto real (ni
// siquiera el banner es inline) — has:attachment como único gate ya se
// había ampliado, pero (2) la razón de fondo era que TODOS los <a href> del
// correo son wrappers de click-tracking de SendGrid con texto interior
// vacío (confirmado con debug real: 15 links, los 15 con label ""), y los
// dos links reales de descarga ("DTE: https://...pdf" / "JSON: https://...
// json") están escritos como TEXTO PLANO VISIBLE dentro del HTML, sin
// ningún <a> — Gmail los muestra como si fueran links por su propio
// auto-linkify al renderizar, pero el HTML fuente no los envuelve. Como
// extractCandidateLinks() solo corría el regex de "URL suelta" contra los
// sibling text/plain (no contra el HTML), este patrón era 100% invisible.
// Fix: el mismo regex corre también contra el HTML crudo. Verificado con
// los 2 mensajes reales de Movistar — ambos se descargaron y emparejaron
// bien tras el fix. Un rescan completo de las 2 cuentas confirmó que no hay
// otros remitentes con este mismo patrón en el rango actual.

// v2.23.5 — feat/fix(facturas-compra): 4 pedidos más del usuario tras
// probar v2.23.4 en vivo. (1) JSON inválido que no menciona factura/DTE en
// ningún lado (ni el nombre del adjunto ni el asunto/snippet del correo) se
// descarta directo — antes cualquier .json roto entraba a Revisión aunque
// fuera de otro tipo de correo. (2) Gmail query ahora excluye -in:sent
// -in:drafts -in:chats: el usuario notó que se estaban descargando correos
// que la propia cuenta ENVIÓ (Gmail busca "todo el correo" por defecto, no
// solo bandeja de entrada). (3) Revisión: nuevo botón "Confirmar sin JSON"
// para PDFs huérfanos que nunca van a tener su JSON — crea el documento
// igual (codigo_generacion/tipo_dte/json_path NULL, columnas relajadas en
// migración 20260719_purchase_dte_confirm_sin_json.sql) y la tabla de
// Documentos muestra un badge "Sin JSON" (también deshabilita el botón de
// descargar JSON cuando no hay). El status 'confirmado' ya estaba
// anticipado en el CHECK de purchase_dte_review_queue desde el 17-jul pero
// nunca se había usado. (4) Bug real encontrado por el usuario: el modal de
// detalle no mostraba items ("cuerpoDocumento") en documentos con el
// envelope de Hacienda (dteJson/firmaElectronica) — el fix de v2.23.4
// desenvolvía el JSON solo para las columnas de la fila insertada, pero el
// archivo SUBIDO A STORAGE seguía siendo los bytes crudos del adjunto (el
// sobre sin desenvolver), que es justo lo que el modal lee directo. Ahora
// se sube el objeto ya normalizado (unwrapDteEnvelope + repairMojibakeDeep)
// en vez de re-descargar el adjunto crudo. Los ~1,150 documentos ya
// existentes (reprocesados hoy en el wipe+rerun de v2.23.3/4) se repararon
// con un pase nuevo y paginado (`repair_stored_json: true` en el body del
// edge function) que re-normaliza el .json ya guardado sin tocar Gmail.

// v2.23.4 — fix(facturas-compra/sync-purchase-emails): 2 hallazgos más,
// encontrados auditando datos reales en prod tras v2.23.3. (1) Envelope de
// DTE no reconocido: farmavalue (reenviado por arquitecto.aleman9@gmail.com)
// no manda el DTE plano sino { selloRecibido, firmaElectronica, dteJson } —
// el servicio de recepción de Hacienda envuelve el documento; dteJson ya
// viene decodificado, firmaElectronica es el mismo DTE como JWS (se decodifica
// el payload si dteJson no vino). Antes esto se rechazaba siempre como
// "sin identificacion.codigoGeneracion" pese a que el DTE real sí estaba
// adentro — 100% de los reenvíos de ese remitente caían en invalid_json.
// (2) Mojibake en emisor_nombre: confirmado con datos reales de
// facturaelectronica@facturas.claro.com.sv — su propio sistema re-decodifica
// UTF-8 como Windows-1252 antes de guardar ("Ñ" llega literal como "Ã‘").
// Se repara re-codificando el string a bytes cp1252 (tabla completa 0x80–
// 0x9F, la única franja donde cp1252 difiere de Latin-1) y re-decodificando
// como UTF-8 estricto; si no da UTF-8 válido se asume que no era mojibake y
// se deja igual. Ambos fixes solo aplican hacia adelante — los ~1,150
// documentos ya guardados necesitan reprocesarse (backfill limpio) para
// beneficiarse.

// v2.23.3 — fix(facturas-compra/sync-purchase-emails): 3 hallazgos reportados
// por el usuario sobre la descarga de DTE vía Gmail API. (1) Filtro de
// correos que no son factura/DTE: un PDF suelto (sin JSON en el mismo
// correo) ahora exige que el asunto o el snippet del correo mencione
// factura/DTE/comprobante/CCF antes de descargarlo y encolarlo para
// revisión — antes cualquier PDF en cualquier correo con adjunto se
// guardaba como "huérfano" aunque no tuviera nada que ver con una factura.
// (2) Enlaces en el cuerpo del correo: algunos proveedores mandan
// "descargue su factura aquí" en vez de adjuntar el archivo — ahora se
// extraen los links del HTML/texto del cuerpo, se filtran por keyword
// (factura/dte/descarga/.pdf/.json) + guard anti-SSRF (bloquea IPs
// literales/localhost/*.local), se descargan (límite 15MB) y si el
// content-type resuelve a PDF/JSON/ZIP entran al mismo pipeline que un
// adjunto normal. (3) Fix del pairing JSON↔PDF que fallaba en
// cimberton.fe@avdinternacional.com y otros: antes solo emparejaba por
// nombre de archivo idéntico; ahora 3 fases — nombre idéntico → código de
// generación/número de control embebido en el nombre del PDF → si queda
// exactamente 1 JSON válido y 1 PDF sin usar en el correo, se asume que son
// el par aunque el nombre no se parezca en nada.

// v2.23.2 — fix(nav): auditoría completa del menú lateral (AppLayout).
// (1) FIX del "scroll raro": el efecto de scroll dependía de openGroups, así
// que abrir/cerrar CUALQUIER grupo disparaba un smooth-scroll persiguiendo
// al ítem activo; ahora solo se revela el ítem activo al navegar, y abrir
// un grupo ancla el propio grupo (revealOpenedGroup, mínimo movimiento).
// (2) Acordeón real: un solo grupo abierto (antes el grupo activo quedaba
// forzado abierto, inflando la lista). (3) Reestructura de MENU_GROUPS:
// autoservicio → personal → negocio → configuración; `encuesta` (Clima
// Organizacional) estaba en MODULE_MAP pero en NINGÚN grupo (inalcanzable
// desde el nav); Horarios absorbe Plan de Vacaciones; Estructura/Sistema al
// final. (4) Los "Próximamente" ya no crean grupos muertos para empleados
// sin permisos reales del grupo. (5) focus-visible ring en todos los
// controles del nav (ítems, grupos, PINs, logo, logout, tabs móviles,
// flyouts) + aria-current/aria-label/aria-expanded correctos. (6) Colapsado:
// click en grupo abre el flyout (antes era no-op) y Escape lo cierra.
// (7) Limpieza: fallback muerto en recomputePill, clase typo "Bone".
// Nota React Compiler: handlers no pueden capturar refs (rompe la
// preservación de memoización de recomputePill) — el reveal vive en un
// useEffect sobre openGroupKey.

// v2.23.1 — feat(facturas-compra): badge inverso NC→CCF, a pedido directo
// del usuario ("así como haces en la venta ver la NC, quiero al revés").
// get_purchase_dte_documents enriquece `documento_relacionado` (antes solo
// el código) con los mismos campos que `notas_credito[]` (json_path/
// pdf_path incluidos) para poder abrir el detalle del CCF sin que esté en
// el rango de fechas visible. Badge azul "🔗 Ver original" en la fila de la
// NC/ND — mismo mecanismo que el badge ámbar "NC" del CCF, reusa
// viewPurchaseDte sin cambios. Fix de paso: la primera versión mostraba
// "Ver Crédito Fiscal (CCF)" completo y se rompía en 4 líneas dentro de la
// columna Tipo — texto fijo corto "Ver original" (detalle completo queda en
// el title/tooltip). Verificado en vivo: abre el CCF correcto ($996.57,
// mismo documento que tenía el badge NC).

// v2.23.0 — feat(facturas-compra): 4 mejoras a pedido directo del usuario.
// (1) Quitado el texto "Máx. 300 — acotá fechas" del pill de Descargar.
// (2) Export ZIP sin límite: downloadPurchaseDteZipBulk ahora chunkea el
// pedido en tandas de 300 (mismo tope que export-purchase-dte-zip, es un
// límite de tiempo de ejecución del edge function, no del usuario) y
// mergea todas las tandas en un solo ZIP final con JSZip en el navegador
// — verificado con datos reales: el mes actual trae >300 docs, 2 tandas,
// ambas 200, merge correcto (unit-test de la lógica de merge + verificación
// en vivo). (3) `defaultDateRange()` pasa de "últimos 60 días" a "Este mes"
// (mismo criterio día 1→último día que el preset de PeriodPicker).
// (4) Match CCF↔Nota de Crédito/Débito: columna nueva
// `documento_relacionado_id` en purchase_dte_documents, poblada leyendo
// `documentoRelacionado[0].numeroDocumento` del DTE de la NC/ND (confirmado
// con JSON real — es el codigoGeneracion o numeroControl del documento que
// corrige). Backfill corrido sobre los 114 NC/ND existentes: 43 emparejados
// (71 sin match porque su CCF original nunca llegó a este sync). Badge "NC"
// en el CCF, clickeable → abre el detalle de la Nota de Crédito directo
// (verificado en vivo con LABORATORIOS VIJOSA). sync-purchase-emails
// empareja en vivo para documentos nuevos; backfill-dte-related-docs nueva
// (edge function) cubre el caso de orden invertido (NC llega antes que el
// CCF que corrige).

// v2.22.1 — fix(proveedores): categoría/match ERP mudados a solo el modal
// (antes editables inline en la tabla también — a pedido directo del
// usuario) + campo nuevo "Tipo de Proveedor" en el modal (derivado de la
// `clase` de la categoría — costo/gasto_operativo/gasto_admin/otro — nunca
// fue un campo propio, PLAN-PROVEEDORES-2026-07.md §2 ya lo definía así,
// solo faltaba mostrarlo). Fix real de matching ERP: suppliers.nrc trae
// guión en 73 filas legacy ("9407-2") y el NRC que sale del DTE nunca
// ("94072") — mismo NRC, el match exacto no encontraba nada (2/92 antes).
// upsert_proveedor_from_dte ahora compara NRC normalizado (solo dígitos);
// backfill aplicado a los proveedores ya existentes: 51/92 con match ERP
// ahora, verificado sin ambigüedad (0 NRC normalizado duplicado en ninguna
// tabla) y nombres coincidentes en la muestra revisada.

// v2.22.0 — feat(proveedores): Fase 4 del Maestro de Proveedores — módulo UI
// completo. ProveedoresView.jsx (módulo nuevo, grupo Inventario): lista con
// filter pill en el body (categoría/clase/activo, incl. "(sin categoría)" y
// "(sin match ERP)"), categoría asignable inline (LiquidSelect), match ERP
// con el mismo patrón de "Emparejar" que FacturasCompraView. Modal detalle
// (FormProveedorDetail, patrón FormEditContact — self-contained, footer
// propio, HIDES_FOOTER) con datos fiscales de solo lectura + campos
// curados a mano (contacto, teléfono 2, nombre para cheques, notas, activo,
// override de percibe_1) y link "Ver documentos" a Facturas de Compra
// filtrado por NIT (?q=). FacturasCompraView ahora prioriza el nombre del
// maestro (proveedor_id) sobre el match ERP (dato secundario). Checklist de
// módulo nuevo completo: ruta App.jsx, menú AppLayout, PermissionsView,
// role_permissions (roles 2/3/13, aplicado en Fase 1). appendAuditLog en las
// 3 acciones (ver detalle, set categoría, set match, update manual).
// Verificado end-to-end con Playwright + datos reales de prod: lista con 59
// proveedores, asignación de categoría y campos manuales persistidos y
// confirmados en BD, auditoría registrada, cross-link a Facturas de Compra
// filtrando correctamente (datos de prueba revertidos tras verificar).

// v2.21.2 — fix(proveedores): tipo_dte '09' es "Documento Contable de
// Liquidación" (CAT-002 oficial, src/utils/dteTypes.js), no "Nota de
// Remisión" como se asumió al ver el JSON de muestra de Redserfinsa — misma
// familia que 08, que el plan ya excluye de auto-crear proveedor (el emisor
// suele ser un intermediario/cliente reportando, no un proveedor real).
// Revertido en el shared parser + redeploy de ambas edge functions.
// Corrección de datos en prod: 115 documentos tipo 09 desvinculados,
// docs_count/fechas recalculados en los 2 proveedores afectados (Banco
// Promerica, Servicios Financieros) — ninguno se borró, ambos tienen
// documentos legítimos de otros tipos.

// v2.21.1 — feat(proveedores): Fases 2 y 3 del Maestro de Proveedores —
// backfill + auto-registro en vivo. Edge function nueva
// `backfill-proveedores-dte` (paginado 200/corrida, hasMore) corrida en prod:
// los 339 DTE ya guardados quedaron vinculados (proveedor_id), 34 proveedores
// creados, 0 duplicados. Se confirmó con datos reales que el tipo de DTE 09
// (Nota de Remisión) comparte el mismo bloque `emisor` que 01/03/05/06 — se
// agregó a la lista de tipos que auto-crean proveedor (no estaba en la tabla
// original del plan; validado con el caso real "Servicios Financieros" 94
// docs). Lógica de extracción compartida en
// `supabase/functions/_shared/proveedorFromDte.ts` (usada por el backfill y
// por `sync-purchase-emails`, que ahora llama `upsert_proveedor_from_dte`
// tras cada documento nuevo). Probado con una corrida real de
// "Sincronizar ahora": 95 documentos nuevos, 25 proveedores nuevos, 100%
// con proveedor_id, sin errores.

// v2.21.0 — feat(proveedores): Fase 1 del Maestro de Proveedores
// (PLAN-PROVEEDORES-2026-07.md) — BD solamente, sin UI todavía. Tablas
// `proveedores_categorias` (seed de 16 categorías contables) y
// `proveedores_maestro` (identidad fiscal del DTE: NIT/DUI/NRC, giro,
// dirección, flags percibe_1/retiene_renta observados; curación manual:
// categoría, match con `suppliers` del ERP, contacto, notas). Columna
// `proveedor_id` en `purchase_dte_documents`. RPC `upsert_proveedor_from_dte`
// (service_role, la llamará el sync/backfill) hace upsert condicional por
// NIT/DUI sin pisar nunca los campos curados a mano. RPCs de lectura
// (`get_proveedores_maestro`, Patrón C) y escritura manual
// (`set_proveedor_categoria`, `set_proveedor_supplier`, `update_proveedor_manual`).
// Permisos del módulo `proveedores` para roles 2/3/13. Aplicado en staging
// (ewcmerxqjvludtgskuin) primero — verificado upsert idempotente, gating de
// permisos, caso FSE con DUI sin NIT — y luego en prod, advisor 0 errores en
// ambos. Próximo: Fase 2 (backfill de los ~339 JSON ya guardados).
//
// v2.20.12 — feat(facturas-compra): columnas ordenables en TabDocumentos —
// Fecha, Proveedor, Tipo y Monto (a pedido directo del usuario; N° Control
// y Acciones quedan sin ordenar). Mismo contrato de DataTable que
// VentasView (columnas con `sortable: true` + sortKey/sortDir/onSort);
// orden client-side sobre `filtered` (ya se carga todo el rango client-side
// en este tab, Patrón C) — sub-orden aplicado antes de paginar, resetea a
// página 1 en cada cambio de columna/dirección. Default al hacer clic:
// Fecha/Monto arrancan en desc (más reciente/mayor primero), Proveedor/Tipo
// en asc (alfabético) — mismo criterio que otras vistas con sort.
//
// v2.20.11 — fix(facturas-compra): botón "Descargar" del pill de
// TabDocumentos. El usuario preguntó por qué aparecía deshabilitado — la
// razón (tope de 300 documentos por ZIP, ver v2.20.10) solo se explicaba en
// un `title` nativo (tooltip al pasar el mouse), fácil de no ver. Se agregó
// texto visible junto al botón ("⚠ Máx. 300 — acotá fechas") cuando está
// deshabilitado por esa causa, sin necesidad de hover. Ícono cambiado de
// Archive (caja) a Download (flecha hacia bandeja) a pedido directo del
// usuario — Archive se mantiene en la acción de fila "paquete JSON+PDF" y
// en el botón "Todo" del modal, donde sí tiene sentido como ícono de ZIP.
//
// v2.20.10 — fix(facturas-compra): 3 hallazgos más en el modal de detalle DTE
// y la tabla. (1) No había forma de descargar PDF+JSON juntos desde el
// modal — se agregó botón "Todo" (ícono Archive) junto a PDF/JSON, reutiliza
// downloadPurchaseDtePackage (mismo ZIP de la acción de fila en la tabla),
// solo cuando el documento tiene PDF asociado. (2) "Descargar JSON"/
// "Descargar PDF" (modal y acciones de fila en la tabla) en realidad
// llamaban a openStoredFile — abre una pestaña nueva y navega, correcto para
// botones "Ver" pero no para botones etiquetados "Descargar" (confirmado:
// todos los DEMÁS usos de openStoredFile en el proyecto están etiquetados
// "Ver", solo Facturas de Compra decía "Descargar" con ese comportamiento).
// Nuevo helper `downloadStoredFile` en storageFiles.js: trae el archivo como
// blob (un <a download> con URL cross-origin de Storage no fuerza descarga,
// solo funciona con blobs del mismo origen) y dispara un <a> temporal con
// atributo download — confirmado con Playwright (`page.waitForEvent
// ('download')`) que ahora sí dispara descarga real y no abre pestaña, para
// JSON, PDF, y el ZIP de "Todo". (3) Orden de columnas de la tabla a pedido
// directo del usuario: Fecha | Proveedor | Tipo | N° Control | Monto |
// Acciones (antes Fecha | Tipo | N° Control | Proveedor | Monto).
//
// v2.20.9 — fix(facturas-compra): 2 ajustes al pill de TabDocumentos tras
// probar v2.20.8. (1) "Descargar filtrados" → "Descargar" (el "filtrados"
// se sobreentiende dentro del pill de filtros) y se movió de una fila
// suelta debajo del pill a ser un segmento más del pill (mismo patrón que
// Sincronizar). (2) Se eliminó la fila "N documentos" que vivía junto al
// botón — redundante con el badge total de TablePagination más abajo.
//
// v2.20.8 — fix(facturas-compra): 7 hallazgos visuales reportados por el
// usuario tras probar la vista en prod. (1) El pill de fecha (2
// LiquidDatePicker sueltos "Inicio"/"Fin") se reemplazó por PeriodPicker —
// mismo componente de rango con accesos rápidos que usa VentasView.
// dateStart/dateEnd locales pasaron a un solo estado dateRange formato
// "start|end" (mismo contrato que monthRange en VentasView), derivado donde
// se necesitan las fechas sueltas. (2) Los LiquidSelect de Tipo/Proveedor
// renderizaban el ícono en un <Tag>/<Users> suelto ANTES del select en vez
// de usar el prop icon={} de LiquidSelect (que lo dibuja DENTRO del pill,
// como en VentasView FilterControls) — corregido, con ancho dinámico por
// longitud de label igual que branchW/labW en VentasView. (3-4) TabDocumentos
// y TabRevision envolvían su contenido en <div className="flex flex-col
// gap-4"> sin padding — el pill de filtros y la tabla quedaban pegados a los
// bordes del card. Cambiado a "p-5 md:p-6 space-y-5" (mismo wrapper que
// TabVentas en VentasView). (5) "Sincronizar ahora" vivía suelto a la
// izquierda del pill — se incorporó como último segmento del pill (con
// divider), siguiendo el patrón de toggles de FilterControls. (6) Modal PDF
// "cortado": la causa real NO era la altura del modal (h-[85vh] ya estaba
// bien desde v2.20.6) sino que el contenido interno de
// FormPurchaseDteViewer/FormDocumentViewer usaba h-full (porcentaje) en
// cadena a través de un padre dimensionado solo por flex-grow — Chromium no
// resuelve ese porcentaje como "definite" ahí (confirmado con Playwright:
// medí el DOM real, el contenido colapsaba a 430px de los 850px
// disponibles). Fix: toda la cadena (UnifiedModal scrollRef → wrapper →
// <form> → raíz de Form*Viewer → cada rama del contenido) pasó de
// h-full/min-h-full a flex-1/min-h-0 encadenado, que no depende de
// resolución de porcentajes. Aplicado también a FormDocumentViewer
// (viewDocument) por tener el mismo patrón frágil, aunque no fue reportado.
// Confirmado con Playwright: el bloque de contenido ahora mide 832px de
// 850px disponibles (antes 430px). (7) El modal solo tenía botón de
// descarga "JSON" — se agregó un botón "PDF" (mismo estilo secundario que
// el toggle Detalle/PDF) cuando document.pdf_path existe.

// v2.20.7 — fix(facturas-compra): CAUSA REAL del modal de PDF cerrándose al
// tocar la pestaña "PDF" (v2.20.6 mitigó con altura/iframe pero no atacaba
// la causa raíz — el usuario confirmó que seguía pasando). Los botones
// "Detalle"/"PDF"/"JSON" de FormPurchaseDteViewer.jsx viven dentro de
// <form id="unified-modal-form" onSubmit={handleLocalSubmit}> (UnifiedModal.jsx)
// y NO tenían type="button" — un <button> sin type dentro de un <form> es
// type="submit" por defecto, así que tocar "PDF" disparaba un submit real.
// handleLocalSubmit no tiene case para "viewPurchaseDte", cae al fallback
// genérico `if (handleSubmit) await handleSubmit(e)`, y App.jsx's
// handleSubmit hace `setModalOpen(false)` INCONDICIONALMENTE justo después
// del switch (sin default/guard) — cierra el modal sin importar qué type
// tenía, sin lanzar error ni loggear nada. Fix: type="button" en los 3
// botones de FormPurchaseDteViewer.jsx. Confirmado con Playwright: el modal
// ya no se desmonta al tocar PDF (antes: [data-surface="modal"] pasaba de 2
// a 0; ahora se mantiene en 2).

// v2.20.6 — fix(facturas-compra): 6 hallazgos reportados directamente por el
// usuario tras probar la vista. (1-2) Header duplicado: ViewTabBar se
// renderizaba como hermano suelto ANTES de GlassViewLayout (2 filas
// apiladas) en vez de ser el valor completo de filtersContent — patrón real
// usado por LaboratoriosView/PedidosView/PromocionesView. "Sincronizar
// ahora" se movió al body (TabDocumentos), junto al pill de filtros. (3)
// Los 2 <input type="date"> crudos del pill de filtros pasaron a
// LiquidDatePicker (regla global del proyecto). (4) TabDocumentos no
// paginaba — Patrón C carga todo el rango filtrado de una vez client-side;
// se agregó TablePagination con slice de página sobre el array ya filtrado
// (mismo patrón que TabSinVenta.jsx). (5) Bug real en el modal de detalle:
// UnifiedModal.getModalHeightClass() solo daba altura fija (h-[85vh]) al
// tipo "viewDocument" — "viewPurchaseDte" caía al default
// max-h-[90vh] h-fit, sin ancestro de altura definida para el h-full que usa
// FormPurchaseDteViewer. Corregido para que viewPurchaseDte reciba el mismo
// h-[85vh]. Además, el embed de PDF pasó de <object>+<iframe> anidado a un
// <iframe> simple con un link "Abrir en pestaña nueva" siempre visible (no
// solo como fallback interno) — refuerzo defensivo independiente de la causa
// exacta del cierre. Nota: en local (vite dev/preview) el iframe hacia la
// signed URL de Storage aborta por el COEP require-corp de
// vite.config.js:server.headers (confirmado con curl -I, headers reales);
// vercel.json (prod) NO tiene ese header — la falla observada en local muy
// probablemente no ocurre en producción real. Ver PLAN-FACTURAS-COMPRA-2026-07.md
// para el detalle completo de la investigación. (6) SupplierMatchCell y
// MatchDocumentAction ("Emparejar"/"Emparejar a documento") no tenían forma
// de cancelar sin elegir una opción — se agregó botón X junto al selector en
// ambos. Verificado visualmente: header de una sola fila, date picker,
// paginación (338 docs / 14 páginas) y botón cancelar confirmados con
// screenshots; PDF y 2do botón cancelar no reproducibles 100% en headless
// por las razones de COEP arriba.

// v2.20.5 — fix(facturas-compra): auditoría completa contra DESIGN.md.
// Violación real de §17 (Filter Pills): el pill de fecha/tipo/proveedor
// estaba en filtersContent del header — la regla es explícita: esa slot es
// SOLO para search/tabs/acciones primarias ("Nuevo X", export), el pill de
// filtros va en el body, junto a la tabla (patrón VentasView/FilterControls).
// Movido a TabDocumentos; filtersContent quedó solo con "Sincronizar ahora"
// (ahora sí con la tipografía real de botón secundario: font-black uppercase
// tracking-widest, no el estilo de link que tenía). De paso, badges (tipo DTE,
// PDF-sin-JSON/JSON-inválido) alineados al patrón real de "Semantic status
// badge" (§16: borde + fondo /10, no bg sólido) — "PDF sin JSON" pasó de sky
// (no es un color semántico documentado) a blue/info. Nota: ComprasView.jsx
// (la vista de la que partí como referencia) tiene la MISMA violación de §17
// — no corregida en esta pasada, es una vista aparte no tocada esta sesión.
// Verificado visualmente sin regresiones.

// v2.20.4 — fix(compras/facturas-compra): fetchSuppliersBasic ya no ignora
// error — el hallazgo de code review que había quedado documentado como "no
// corregido a propósito" (matching ComprasView.jsx) se corrigió en las 2
// vistas a la vez para no dejar el portal con 2 estilos distintos para la
// misma llamada. Ahora ambas loguean el error a consola en vez de mostrar el
// selector de proveedores vacío en silencio.

// v2.20.3 — fix(facturas-compra): code review post-implementación (3 agentes
// independientes, ángulos correctness/removed-behavior/cross-file). Bugs
// reales corregidos:
// - SupplierMatchCell/MatchDocumentAction: try/finally sin catch tragaba
//   errores del RPC en silencio y cerraba la UI como si hubiera guardado —
//   ahora muestran el error real.
// - discard() en cola de revisión no tenía ningún manejo de error.
// - Botones de edición (Emparejar proveedor, Descartar, Emparejar a
//   documento) no respetaban canEdit — un rol con solo can_view los veía
//   igual y fallaban en silencio contra el RPC (FORBIDDEN sin mostrar nada).
// - syncPurchaseEmailsNow/downloadPurchaseDteZipBulk mostraban el mensaje
//   genérico de supabase-js ("Edge Function returned a non-2xx status
//   code") en vez del error real armado por la función — agregado parseo
//   de error.context.
// - resolve_purchase_dte_review (RPC): no validaba kind='orphan_pdf' antes
//   de pisar pdf_path con la ruta de un JSON inválido; y marcaba
//   'emparejado' aunque el UPDATE no afectara ninguna fila (documento que
//   ya tenía PDF) — el archivo quedaba huérfano sin aviso. Ambos con guard +
//   RAISE EXCEPTION ahora.
// - sync-purchase-emails: un DTE duplicado (ON CONFLICT DO NOTHING) o un
//   correo con solo adjuntos .zip no dejaban ninguna fila en BD, así que se
//   re-escaneaban desde Gmail en CADA corrida del cron, para siempre
//   (confirmado con datos reales: SERFINSA manda un zip diario). Fix: tabla
//   purchase_dte_processed_messages, marca CADA mensaje como procesado sin
//   importar el resultado.
// - fetchSuppliersBasic() se llamaba 2 veces por separado (padre +
//   TabDocumentos) — unificado en una sola carga en el padre.
// - Cola de revisión: abrir/descargar el archivo no llamaba a
//   appendAuditLog (regla del proyecto); selector de "emparejar a
//   documento" no se refrescaba si cambiaba el rango de fechas.

// v2.20.2 — feat(facturas-compra): botón "Emparejar a documento" en la cola de
// revisión (MatchDocumentAction), único gap conocido que quedaba de la Fase 5.
// Solo para filas orphan_pdf — busca entre los documentos ya sincronizados
// (carga perezosa, solo si alguien abre el matcher) y llama al RPC
// resolve_purchase_dte_review('emparejado', ...) que ya existía. Verificado
// visualmente: 31 pendientes de revisión, el selector abre y lista los 322
// documentos del rango. Con esto la Fase 5 queda 100% completa — todas las
// tareas del plan cerradas salvo los diferidos (correo 3, cuenta 2, cron).

// v2.20.1 — feat(facturas-compra): modal de detalle DTE (FormPurchaseDteViewer,
// parsea el JSON real — emisor/receptor/ítems/totales, tab PDF cuando existe),
// descarga "paquete" por documento (jszip client-side), descarga masiva
// (edge function export-purchase-dte-zip, tope 300 docs, sin persistir zip
// temporal). Fix: Content-Type application/zip no lo reconoce supabase-js como
// blob (cae a .text() y corrompe el binario) — usar application/octet-stream.
// Verificado visualmente con datos reales (Playwright): modal muestra ítems y
// totales correctos ($7.00 = $2.65+$3.54, coincide con la lista), ambas
// descargas disparan el evento download sin errores. Fase 5 (UI) del plan
// queda completa — quedan solo incrementos condicionales/diferidos (correo 3,
// cuenta 2, reactivar cron).

// v2.20.0 — feat(facturas-compra): módulo nuevo completo (Fase 5) —
// FacturasCompraView.jsx (tabs Documentos/Revisión), registrado en permisos +
// menú (Inventario) + ruta /facturas-compra. RPCs Patrón C
// (get_purchase_dte_documents/get_purchase_dte_review_queue), match manual de
// proveedor (set_purchase_dte_supplier), descartar de la cola de revisión
// (resolve_purchase_dte_review), botón "Sincronizar ahora". Fix de datos: BD
// guardaba rutas crudas de Storage en vez de URL formato-public (regla #10 del
// proyecto) — corregido en la edge function + backfill de las 339+97 filas ya
// sincronizadas. Verificado visualmente con datos reales: 338 documentos, 97
// pendientes de revisión (mayoría PDF-sin-JSON de comercios@promerica.com.sv —
// dato real para la decisión de Fase 3.5).

// v2.19.10 — feat(facturas-compra): cron diario sync-purchase-emails-daily
// (3:00 AM El Salvador, jobid 183) registrado en prod — INACTIVO a propósito
// hasta cerrar el módulo (Fase 5/6), decisión del usuario. body:'{}' procesa
// todas las cuentas activas, incluida compraslasalud.sv (aún sin backfill
// manual) — el cron va a ir avanzando su historial solo, en lotes, gracias al
// presupuesto de tiempo + hasMore de la edge function.

// v2.19.9 — feat(facturas-compra): edge function sync-purchase-emails (Fase 2) +
// tabla purchase_dte_review_queue generalizada (PDFs huérfanos Y JSON
// inválidos/invalidaciones DTE, con estado "descartado"). Probada end-to-end en
// producción con la cuenta farmasalud.sv@gmail.com: 339 documentos insertados,
// 93 PDFs sin emparejar, 4 JSON inválidos. Dos bugs reales encontrados y
// corregidos en el camino: (1) backfills grandes excedían el límite de ejecución
// de la edge function → ahora procesa en lotes con presupuesto de tiempo
// (TIME_BUDGET_MS) y salta mensajes ya resueltos entre llamadas (hasMore); (2)
// Supabase Storage rechaza rutas con espacios/acentos/símbolos en nombres de
// adjunto libres del proveedor → sanitizeStorageKey normaliza antes de subir.

// v2.19.8 — feat(facturas-compra): tabla email_sync_log dedicada (patrón bloque7B,
// NO reusar sync_log genérico — acoplado a semántica de ventas DTE) + extensión de
// la vista v_sync_health con la rama 'email'. Aplicada en staging y prod, 0 errores
// de seguridad. Confirmado también que las credenciales Gmail van como secrets de
// la edge function (Deno.env), no Supabase Vault, pese al nombre de la columna
// vault_secret_name — comentario SQL agregado para no confundir a futuro.

// v2.19.7 — feat(facturas-compra): Fase 1.3 aplicada (BD) — supplier_id real en
// purchase_dte_documents (match manual de proveedor), credenciales Gmail por
// cuenta (client_id/secret propios de cada cuenta, no compartidos), tabla
// purchase_dte_unmatched_pdfs (PDFs sin JSON o sin match de nombre de archivo, ya
// no se descartan en silencio), y seeds: 2 cuentas Gmail conectadas
// (farmasalud.sv, compraslasalud.sv) + permisos del módulo para Gerente
// General/Administrador. Migraciones 20260717_purchase_dte_email_sync_v2 y
// 20260717_purchase_dte_email_seeds aplicadas en staging y prod, 0 errores de
// seguridad. Aún sin UI ni edge function — próximo: Fase 2 (sync-purchase-emails).

// v2.19.6 — fix(ventas): computePrevRange comparaba SIEMPRE contra 1 mes atrás fijo,
// sin importar cuántos meses abarcara el rango seleccionado. Con presets multi-mes
// ("Últimos 3 meses", "Este año") el % de la card quedaba comparando un rango grande
// contra una ventana ~1 mes, muy solapada con la actual → % sin sentido (ej. "Este
// año" mostraba -~80% en vez de compararse contra el año completo anterior). Fix:
// el shift ahora es proporcional a los meses que abarca [fini,ffin] (monthsSpan),
// preservando el caso por defecto (rango de 1 mes → shift de 1 mes, sin cambio).

// v2.19.5 — feat(facturas-compra): base del módulo de facturas de compra por
// correo — migración 20260717_purchase_dte_email_sync (tablas
// email_sync_accounts + purchase_dte_documents, bucket privado purchase-dte)
// y script scripts/gmail-refresh-token.mjs para autorizar las cuentas Gmail
// (OAuth una vez por cuenta, token a Vault). Sin cambios de UI todavía.

// v2.19.4 — fix(ventas/vendedores): las cards "Total Ventas" y "Facturas"
// quedaban fijas en el total de TODO el período al buscar un vendedor —
// se calculaban sobre `rows` (sin filtrar) en vez de `knownRows` (respeta
// el buscador), a diferencia de la card "Vendedores" que sí reaccionaba.
// Ahora ambas cards suman knownRows + unknownByBranch, igual que la tabla.

// v2.19.3 — fix(reglas/promociones): 2 focos más del mismo bug de
// presentaciones inactivas (post-fix get_stock_analysis v2.19.2).
// fetchProductPresentacionesForDispatch (TabReglas — configurar regla de
// despacho) y fetchProductPreciosForPromo (PromoModal — agregar producto a
// promoción) no filtraban activo=true: el staff podía elegir una
// presentación descontinuada como regla de despacho o precio de promo.
// Regla de despacho preserva la presentación YA configurada aunque se haya
// desactivado desde entonces (via keepIdPresentacion + .or()), para no
// romper la edición de reglas existentes; promociones no tiene ese caso
// (siempre es alta nueva) así que filtro directo.

// v2.19.2 — fix(minmax): get_stock_analysis ya no muestra presentaciones
// inactivas en el CSV. catalog_pres/catalog_base_pres (fallback cuando el
// producto no tiene esa presentación en inventario) leían product_precios
// sin filtrar activo=true, a diferencia de get_pedido_preview que sí lo hace.
// Caso real: ALCANFOR SOBRE X 6 UNIDADES (id 985) tenía una presentación
// "1x190" (factor 190) marcada activo=false junto a la real "1x1"
// (activo=true) — el CSV de Bodega mostraba la 1x190 inactiva como
// "presentación mayor disponible".

// v2.19.1 — fix(pedidos): Bodega ya no cuenta pedido_items pendientes
// indefinidamente contra su stock disponible.
// get_pedido_generar_dashboard (tab "sin stock en Bodega" de Pedidos)
// restaba del inventario físico de Bodega todo pedido_items con
// status='pendiente', sin importar cuánto tiempo llevara así. Ese status
// solo cambia a 'recibido' cuando la sucursal destino corre "Confirmar
// recepción" (RecepcionModal) — pero las sucursales aún no tienen acceso
// al portal, así que ese flujo nunca corre y el backlog crece sin límite
// (caso real: Micropore 1x5 con 147 unidades "comprometidas" desde hace
// 19 días contra solo 65 físicas → falso "sin stock"). Nueva columna
// stock_config.pedido_recepcion_activa (default false) desactiva ese
// neteo mientras el flujo de recepción no esté en uso real; reactivar
// con 1 UPDATE cuando todas las sucursales tengan acceso — sin migración
// nueva. Ver supabase/migrations/20260718000200_pedido_recepcion_activa_flag.sql.
//
// v2.19.0 — feat(minmax): cards renombradas + tooltips, y XYZ pasa a
// percentiles relativos por sucursal.
// Cards: "Total retenido" → "Inventario" (a pedido); "Inversión proyectada"
// → "Catálogo a MIN·MAX" con tooltip aclarando que es el valor teórico del
// catálogo completo a MIN/MAX (NO resta el stock actual, no es "lo que
// falta comprar" — decisión explícita del usuario de mantenerlo así, solo
// clarificar el nombre). Tooltips agregados a las otras 4 cards
// (Inventario/útil/excedente/sin movimiento) explicando cada fórmula.
// XYZ relativo: el corte de CV para clasificar X/Y/Z pasa de absoluto/global
// (X≤150%, Y≤400%) a percentiles calculados DENTRO de cada sucursal — con
// sucursales de bajo volumen (Salud 5: ~20-40x menos velocidad que las
// demás) NINGÚN producto bajaba de 400% de CV, la matriz ABC×XYZ caía 100%
// en Z sin diferenciación. Verificado con simulación contra datos reales:
// sucursales grandes quedan casi igual (~5%/30%/65%, muy cerca de su
// distribución actual), Salud 5 pasa de 0/0/100% a 15%/24%/61% real.
// Nueva config stock_config.xyz_x_percentile/xyz_y_percentile (default 5/35,
// reemplaza xyz_x_cv_max/xyz_y_cv_max en ConfigPanel — las columnas viejas
// quedan sin uso). Verificado: reorder_x/y/z_days eran los 3 iguales (25) al
// momento del cambio, así que este fix NO altera ningún MIN/MAX ya
// calculado, solo la etiqueta.
// Efecto colateral corregido a pedido del usuario: calculate_stock_params
// ahora sincroniza SIEMPRE en vivo la clasificación (abc_class,
// demand_variability, cv, velocity, etc. — igual que ya hacía con
// calc_min/calc_max) en vez de marcar 'pending' cuando solo cambia la
// etiqueta sin cambiar MIN/MAX. La revisión manual queda reservada
// exclusivamente para cuando el NÚMERO de MIN/MAX cambiaría — evita que la
// próxima corrida de "Calcular" marque miles de productos como pendientes
// solo por el relabeling del fix de percentiles. Probado con 2 casos
// sintéticos (solo-clasificación vs MIN/MAX real) en staging y prod.
// v2.18.1 — fix(minmax): Bodega ya no se marca "Suc. pendientes" por
// sucursales ocultas. Reportado por el usuario con un caso real (SIMILAC 2
// PROSENSITIVE X 800GR): La Popular tenía una fila draft_status='pending'
// desde el 2026-06-14 (más de un mes), pero is_hidden=true — invisible en
// toda la UI, pero el trigger de Bodega restaurado ayer (20260717230000) no
// excluía sucursales ocultas de su cálculo de "¿están todas publicadas?",
// así que esa fila fantasma seguía contando para siempre. Encontrados 4
// productos con el mismo patrón latente (92, 566, 1527, 2808). Fix: la suma
// de Bodega ahora excluye is_hidden=true, igual que ya hacen
// calculate_stock_params/publish_stock_params en el resto del pipeline.
// Probado con reproducción exacta del bug + caso de regresión (pendiente
// real en sucursal visible sigue funcionando) en staging y prod.
// v2.18.0 — feat(minmax): nuevo indicador "Riesgo regla" en la pestaña
// Sucursal. Marca productos cuyo MAX efectivo, llevado a la unidad de
// despacho del producto (factor de presentación de su regla × múltiplo),
// no alcanza el umbral del 40% ni en el mejor caso (repunte completo desde
// stock 0) — mismo umbral que ya usa get_pedido_preview (revision_minmax)
// para decidir si reponer una unidad completa. Si un producto queda
// marcado, su MIN/MAX actual NUNCA va a generar un pedido real: hay que
// bajarlo a 0/0 o subir el MAX para que supere el umbral. Se calcula 100%
// en el cliente (helpers.js: hasDispatchRisk) con dispatch_pres_factor/
// dispatch_multiplo que get_stock_analysis ya devuelve por fila — sin
// tocar esa RPC (evita duplicar el motor completo de reglas de despacho de
// get_pedido_preview, que es mucho más elaborado: multiplo/blister/
// solo_cajas/caja_especial). Solo aplica a sucursales de venta, no a
// Bodega. Nuevo chip de filtro junto a "Revisar" (mismo patrón visual) +
// badge "RIESGO REGLA" en la fila, junto a MANUAL/BORRADOR. Verificado en
// vivo con Playwright contra prod: 32 productos marcados en La Popular
// (ej. TEGADERM MIN 0/MAX 3 vs caja de 8 unidades — 3 no llega al 40% de
// 8; JERINGA MIN 10/MAX 25 vs caja de 100).
// v2.17.65 — perf(minmax): LabsPanel usa get_active_product_lab_counts (RPC
// con GROUP BY server-side) en vez de descargar laboratorio_id de todos los
// productos activos al cliente. Antes: ~4,354 filas en varios chunks
// paralelos solo para reducirlas a un conteo por laboratorio en JS. Ahora:
// 1 llamada, 323 filas (una por laboratorio, suma verificada idéntica).
// Última deuda pendiente de la auditoría MinMax 2026-07-17 — cierra el
// tema por completo. M3 (forecast v2 con safety stock estadístico):
// rechazada, no se aplica. M4 (lead time auto-aprendido de compras): se
// mantiene diferida hasta que el sistema de facturación esté completo. M6
// (excedente de Bodega como %): queda documentada, sin fecha.
// v2.17.64 — fix(minmax): restaura el badge "SUC. PEND." de Bodega. El
// trigger de Bodega había perdido el soporte de "sucursal con borrador
// pendiente → Bodega en pending" desde una migración del 2026-06-19 (un mes
// antes de esta sesión, probablemente un efecto secundario accidental del
// fix de clamp min/max de ese día) — decisión del usuario tras el
// /code-review de cierre: restaurarlo. Ahora, si CUALQUIER sucursal tiene un
// draft pendiente, Bodega pasa a draft_status='pending' con
// draft_min/draft_max = Σ del mejor valor disponible por sucursal (draft si
// está pending, publicado si no) — min_units/max_units quedan congelados en
// el último valor vivo hasta que se resuelva el pendiente, que es lo que
// dispara el badge en la UI. Cuando todas las sucursales vuelven a estar
// publicadas, Bodega vuelve a vivo normalmente. Mantiene todas las mejoras
// de esta sesión sobre el trigger: statement-level (M1), fix de Σ=0 (M-2),
// filtro de cambio relevante vía old_rows/new_rows, guard de recursión.
// Probado con 6 casos en staging (incluye la transición completa
// vivo→pending→vivo) y re-verificado igual en prod antes de limpiar.
// v2.17.63 — fix(minmax): retry de los 5 ángulos de /code-review que habían
// quedado cortados por límite de sesión + resolución de los 3 hallazgos de
// duplicación pedidos explícitamente. BUG REAL encontrado (no cosmético):
// approve_minmax_request tenía "ON CONFLICT DO UPDATE ... WHERE is_hidden IS
// NOT TRUE" — si el producto estaba oculto, el UPDATE se saltaba en silencio
// pero la función igual marcaba la solicitud 'approved', insertaba history y
// devolvía ok:true (aprobación fantasma). Fix: valida is_hidden ANTES y
// aborta con excepción clara (PRODUCT_HIDDEN). approve_minmax_requests_bulk
// ahora DELEGA a approve_minmax_request en loop (savepoint implícito por
// item vía EXCEPTION) en vez de duplicar la lógica de escritura — hereda el
// fix del bug automáticamente y cierra el hallazgo de duplicación/altitud.
// reject_minmax_request (se había salteado del revoke-anon anterior) también
// corregido. Centralizado minmax_effective(base,manual) como único punto de
// verdad de la fórmula aditiva, usado ahora por get_stock_analysis,
// get_pedido_preview y get_network_summary_json (antes cada una la
// reimplementaba inline). minmaxLabs.js: helper fetchPaginated compartido
// (ya no se duplica consigo mismo) + unhideStockParamsForProducts ahora
// filtra por is_hidden=true (dejó de escribir incondicional tras quitarle el
// cap de 1000 en Fase 2 — regla del proyecto de nunca escribir sin comparar)
// + su caller en LabsPanel.jsx ahora sí chequea errores de los chunks.
// TabMinMaxRequests: runBulkApprove ahora reporta los 3 tipos de omisión
// (bodega/oculto/ya-decidida, antes solo bodega) y procesa audit
// logs/notificaciones en lotes de 20 en vez de un solo Promise.all sin tope.
// useMinMaxData.js usa el mismo helper JS effectiveMinMax (era el 3er lugar
// con la fórmula inline, no detectado en el pase anterior). config.toml:
// removida la entrada huérfana de sync-erp-minmax (carpeta ya borrada).
// Hallazgo documentado sin aplicar (deuda de rendimiento, no de bug):
// fetchActiveProductLabIds descarga miles de filas al cliente solo para
// contar por laboratorio — requeriría una RPC nueva, fuera de alcance de un
// fix puntual. Hallazgo importante para decisión del usuario (no corregido
// unilateralmente): el trigger de Bodega perdió el soporte de "sucursal con
// borrador pendiente → Bodega en pending" en una migración del 2026-06-19,
// un mes antes de esta sesión — mi reescritura a statement-level fue fiel al
// comportamiento real vigente, no lo rompió, pero es una regresión de
// producto real y silenciosa. Todo probado en staging con casos sintéticos
// (incluye el caso nuevo de producto oculto) y re-verificado en prod antes
// de limpiar.
// v2.17.62 — fix(minmax): /code-review de cierre de la auditoría 2026-07-17 —
// revoke anon de approve_minmax_requests_bulk (función nueva, se me olvidó el
// REVOKE/GRANT que sí puse en get_network_summary_json — anon tenía EXECUTE
// por default de Postgres al crear la función). De paso: approve_minmax_request
// y get_pedido_preview (pre-existentes, solo tocadas con CREATE OR REPLACE en
// esta sesión, que preserva grants viejos) también tenían anon desde antes —
// corregido igual. Riesgo práctico bajo (SECURITY INVOKER + RLS solo aplica a
// authenticated), pero viola la regla explícita del proyecto. Encontrado
// corriendo /code-review sobre el diff acumulado de las 4 fases (paso del
// checklist original que había quedado pendiente). Otros 3 hallazgos del
// review (duplicación de la fórmula aditiva en 5+ lugares, approve_bulk
// duplica la lógica de approve individual, minmaxLabs.js duplica boilerplate
// de paginación con minmaxRequests.js) quedan documentados sin aplicar —
// deuda de mantenimiento real pero bajo riesgo, no ameritan tocar código ya
// probado extensivamente.
// v2.17.61 — perf(minmax): Fase 4 de la auditoría 2026-07-17 — M2 (Red Patrón C)
// + M7 (aprobación masiva atómica). get_network_summary → get_network_summary_json
// (Patrón C, 1 sola ejecución agregada en vez de ~5 chunks de .range() que
// re-ejecutaban la función completa cada uno). De paso corrige dos bugs de
// correctness encontrados al tocar la función (fuera del alcance original de M2,
// confirmados con datos reales antes de aplicar): manual_min/manual_max usaban
// COALESCE (reemplazo) en vez de la fórmula aditiva ya vigente en
// get_stock_analysis/get_pedido_preview desde Fase 1 — verificado que ahora
// coincide exactamente entre ambas vistas (producto 5044/suc.6: 400, antes 257
// mal calculado); y el factor de presentación de inventario salía de un regex
// roto sobre "detalle" en vez de product_precios.factor — corrige un sub-conteo
// real de stock (producto 322/suc.7: 24 unidades reales, antes 2 por el regex).
// get_network_summary (vieja, con EXECUTE a anon) queda eliminada.
// approve_minmax_requests_bulk: RPC atómica para "Aprobar todo" en Solicitudes
// — antes N llamadas seriadas a approve_minmax_request (si fallaba a mitad
// quedaba en estado parcial); ahora 1 sola transacción, Bodega se omite del
// batch en vez de abortarlo (reporta skipped_bodega), solicitudes ya decididas
// por otra persona se reportan sin romper el resto (skipped_not_found).
// window.confirm reemplazado por ConfirmModal estándar (B-6). Notificaciones
// agrupadas por empleado (1 por requester en vez de 1 por solicitud). Ambas
// RPCs probadas con datos sintéticos en staging y re-verificadas en prod antes
// de limpiar. Con esto se cierran las 4 fases de la auditoría MinMax
// 2026-07-17 (quedan diferidas M3/M4/M6, sin fecha).
// v2.17.60 — fix(minmax): Fase 3 de la auditoría 2026-07-17 — bajos + limpieza.
// (3.1) Borrada supabase/functions/sync-erp-minmax/ — escribía a la tabla
// erp_minmax, eliminada en v2.2.209; sin cron que la invocara. (3.2) DROP
// get_stock_analysis_count — sin callers en src/ desde v2.9.28 (Patrón C).
// get_minmax_comparison, el otro huérfano de la auditoría original, ya no
// existía en la base. (3.3 / B-2) calculate_stock_params migra de
// regexp_match(presentacion) a ii.factor_unidades (columna pre-calculada,
// misma que usa get_stock_analysis) — verificado 0 discrepancias en las
// 559,150 filas de sales_invoice_items antes de aplicar. (3.4 / B-4)
// get_minmax_approver_ids rutea por role_id=13 fijo en vez de
// "ILIKE 'supervisor%ventas%'" — mismo id que SALES_SUPERVISOR_ROLE_ID en
// WidgetAnnulmentRequest.jsx. (3.5 / B-5) TabMinMaxNetwork: quitado el
// border-l-4 coloreado, queda solo el tint de fondo. (3.6 / B-1) Polling de
// Bodega (fetchStockParamsUpdates) migra a cursor keyset (updated_at,
// erp_product_id) + .limit(1000) — una publicación masiva escribe miles de
// filas con el mismo timestamp; el cursor simple se saltaba el resto para
// siempre. (3.7 / B-8, B-9) ERP_NAMES/ERP_ORDER consolidados en
// tabminmax/constants.js (TabMinMaxNetwork, TabMinMaxRequests,
// WidgetMinMaxRequest ya no los redefinen); fix de race en el widget —
// catalogReady pasa de ref a state para que la búsqueda se recompute si el
// catálogo termina de cargar después de que el usuario ya tipeó.
// Migraciones de BD probadas primero en staging.
// v2.17.59 — fix(minmax): Fase 2 de la auditoría 2026-07-17 — 5 hallazgos medios.
// (M-1) MinMaxView: activeTab inicial usaba 'sucursal' fijo — un usuario sin permiso
// de esa tab igual la veía renderizada; ahora arranca en TABS[0]?.key. (B-7) Botones
// Config/Labs en TabMinMax gateados por can_edit (antes cualquiera los veía y el
// guardado fallaba con RLS crudo). (M-3) minmaxLabs.js: fetchActiveProductLabIds y
// fetchProductIdsByLaboratorio migran a Patrón B (count + chunks) — con >1000
// productos activos los conteos por laboratorio quedaban truncados y un laboratorio
// grande se des-ocultaba solo parcialmente; unhideStockParamsForProducts migra a
// Patrón A (chunkea el input). (M-4) ConfigPanel: Field extraído a nivel de módulo —
// se recreaba en cada render y el input perdía el foco tras cada tecla. (M-5)
// Historial: MINMAX_REQUEST_APPROVED/REJECTED ahora loggean target=producto (antes
// target=solicitud, invisible en el modal de historial del producto); agregado a la
// lista de acciones que carga ese modal.
// (2.2 + mejora M1) trg_bodega_draft_sync reescrito de FOR EACH ROW a FOR EACH
// STATEMENT con transition tables (INSERT/UPDATE separados porque Postgres no
// permite transition tables con lista de columnas ni en triggers multi-evento) —
// un "Publicar todo" de ~4,000 productos pasa de ~4,000 ejecuciones a 1 sola
// agregada. El filtro de "¿cambió algo relevante?" ahora compara old_rows/new_rows
// (más preciso que UPDATE OF). De paso corrige M-2: se eliminó el early-return
// cuando Σ=0, que dejaba a Bodega con MIN/MAX viejos si la última sucursal con stock
// quedaba en 0 por una edición en vivo. Probado con 6 casos sintéticos en staging
// (ewcmerxqjvludtgskuin) y re-verificado igual en prod antes de limpiar los datos
// de prueba (productos ficticios 99001/99002, sin dejar rastro en
// product_stock_params ni en su historial). — fix(minmax): Fase 1 de la auditoría 2026-07-17 — unifica la semántica de
// manual_min/manual_max (quedaba dividida en 3 lecturas contradictorias entre MinMax,
// Pedidos y Solicitudes). approve_minmax_request ahora escribe min_units/max_units
// directo (antes escribía el valor absoluto solicitado en manual_*, que get_stock_analysis
// interpreta como delta aditivo — aprobar una solicitud inflaba el efectivo mostrado en
// MinMax) + limpia manual_* + bloquea explícito si el target es Bodega (id 6, que deriva su
// MIN/MAX de trg_bodega_draft_sync, no de solicitudes). get_pedido_preview, ItemSections.jsx
// (revisión en Pedidos) y WidgetMinMaxRequest.jsx ("En uso ahora") migran de
// COALESCE(manual, min_units) a min_units + COALESCE(manual, 0), igual que get_stock_analysis.
// manual_* queda EXCLUSIVO de Bodega (delta aditivo real). Verificado con prueba end-to-end en
// prod (producto MICROPORE 1X5 YDAS 3M/CUREBAND, suc. 1) y revertido sin dejar rastro.
// Además: minmax_ignored tenía una policy RLS abierta (USING(true) para ALL, hallazgo nuevo
// no visto en la auditoría original) — reemplazada por SELECT abierto + escritura gateada por
// auth_can_edit_any(['minmax']). Revoke EXECUTE de get_stock_analysis a anon (B-3). Aplicado
// primero en staging (ewcmerxqjvludtgskuin), luego prod. Detalle completo:
// AUDITORIA-MINMAX-2026-07-17.md.
// v2.17.57 — fix(minmax): calculate_stock_params(p_erp_sucursal_id=6) (Bodega)
// se quita por completo — generaba un borrador independiente (demanda agregada
// + ABC/XYZ propio) que NUNCA podía convertirse en el min_units/max_units real
// de Bodega, porque publish_stock_params excluye erp_sucursal_id=6 en sus dos
// bloques. Quedaba como ruido puro acumulado (3,050+ filas sin resolver desde
// junio). El valor real de Bodega siempre viene de sync_bodega_draft_from_branch
// (tiempo real, SUM de sucursales) o de publish_stock_params al publicar —
// nunca de este cálculo. Llamar con p_erp_sucursal_id=6 ahora devuelve
// {ok:false, skipped:true, reason:'bodega_not_calculated_here'} en vez de
// calcular en silencio. auto-calculate-minmax ya no incluye 6 en ERP_ORDER
// (6 sucursales de venta, no 7). Limpiadas las 212 filas residuales de Bodega
// (150 pending + 62 sparse_data) que habían quedado de antes del fix, con OK
// explícito del usuario — draft_status='none', draft_min/max=NULL.
// Migración 20260717034921_remove_bodega_from_calculate_stock_params.sql.

// v2.17.56 — fix(minmax): calculate_stock_params(Bodega) reportaba drafted=0
// siempre, aunque generara borradores reales — el RETURN final sumaba v_count
// (nunca asignada en la rama de Bodega) en vez de v_count + v_bodega_count.
// Bug preexistente, encontrado al investigar por qué el recálculo manual de
// verify_jwt (0B.2) mostró números raros por sucursal. Fix de una línea,
// staging primero, sin cambio de comportamiento para las 6 sucursales
// normales (rama mutuamente excluyente). Además: la invocación manual de
// prueba de 0B.2 disparó un recálculo real en Salud 2/Salud 3 (855 productos
// auto-aplicados) que el usuario no pidió — revertido por completo usando el
// snapshot que graba trg_psp_capture_history antes de cada cambio, verificado
// con muestreo antes/después. Sin cambios en src/.

// v2.17.55 — fix(bloque0b.2): auto-calculate-minmax había vuelto a
// verify_jwt=true (0B.2 la puso en false 2026-07-11; un redeploy de Bloque
// 7B el 2026-07-16, para agregarle logging, la resetió sin el flag
// --no-verify-jwt). Su cron mensual manda un secreto propio como Bearer, no
// un JWT real — con verify_jwt=true el gateway la habría bloqueado con 401
// en su próxima corrida (día 1, 15:00 UTC), el mismo bug original.
// Encontrado en una pasada de verificación pedida por el usuario tras
// cerrar PLAN-EJECUCION-2026-07.md (Bloques 0-8): se releyó el estado real
// de prod (advisors, policies, RPCs, build/lint/tests, storage, índices)
// contra lo documentado como "Aplicado" — todo confirmado correcto salvo
// este único drift. Corregido con el mismo workaround de siempre (mv .env
// aparte, redeploy con --no-verify-jwt, restaurar .env) — mismo código
// fuente, solo cambió la config. Verificado con invocación manual real vía
// net.http_post: 200 OK, resultados reales por sucursal. Sin cambios en
// src/.

// v2.17.54 — docs: PLAN-BUSCADORES-NORMALIZACION.md actualizado a estado
// APLICADO (Fase 1 + Fase 2, prod + staging, v2.17.53) — checklist marcado,
// alcance real corregido (3 archivos no 6 en Fase 1, 9 RPCs no 8, 2 RPCs
// nuevas en 2.4-B), Fase 3 explícitamente pendiente. Sin cambios de código.

// v2.17.53 — feat(buscadores): normalización total client-side (Fase 1) +
// servidor completo probado en staging (Fase 2, PLAN-BUSCADORES-NORMALIZACION.md).
// Fase 1 (aplica directo, riesgo cero): ConteoInventarioView.jsx migrado de
// filtro naive a smartFilter+banner isFuzzy; SchedulesView.jsx reemplaza
// reimplementación manual de strip de acentos por normSearch(); usePedidosData.js
// unifica búsqueda de pedidos en un solo tokenMatch(searchTerm, numero, notes).
// Fase 2 (aplicada y verificada en staging ewcmerxqjvludtgskuin, PROD PENDIENTE
// de OK explícito): extensión unaccent + norm_search()/f_unaccent() (espejo
// SQL de normSearch() de searchUtils.js); 9 RPCs con p_search reescritos de
// ILIKE crudo a match por tokens (norm_search(col) LIKE ALL(pats)) —
// inventory_grouped (4 paths), inventory_inversion, inventory_proximos_count,
// get_conteo_items_search/_count, get_conteo_products_page/_count (estos 4 con
// haystack concatenado multi-columna, paridad real con tokenMatch),
// get_product_sales_agg/_jsonb; columnas generadas products.nombre_norm/
// pactivo_norm + índices GIN trigram, vista products_with_lab expone
// nombre_norm; nuevo helper likePattern() en searchUtils.js + 6 call sites de
// .ilike() migrados a *_norm (conteoInventario.js, recepcion.js,
// promotions.js, cotizaciones.js, productos.js, dispatchRules.js — este
// último cierra el bug real reportado: TabReglas.jsx ya mandaba normSearch()
// pero el server comparaba contra columna cruda con tildes); 2 RPCs nuevas
// (search_ventas_ids, search_inventory_descripcion_ids) para sales_invoices e
// inventory — tablas calientes, sin ALTER TABLE, solo RPC+índice de expresión.
// Los 5 casos canónicos (ssn→S.S.N, alcohol 90→ALCOHOL-90, acido→ÁCIDO
// FÓLICO, 500 gravol→GRAVOL 500MG orden invertido, EXPLAIN confirma índice
// GIN) verificados end-to-end contra datos sintéticos en staging, limpiados
// al terminar. Fuera de alcance: prod (falta OK explícito), customers (ya
// tiene search_name generado, no es la fuente de los bugs), Fase 3 fuzzy
// server-side.

// v2.17.52 — fix(ci): diagnostica y corrige las 3 fallas preexistentes de
// e2e-smoke.js (existían desde el 2026-07-15T13:58, sin relación con
// Bloque 8 ni con ningún refactor — ningún código de la app cambió entre el
// último run verde y el primero rojo). Causa raíz en los 3 casos: permisos
// incompletos del rol dedicado a CI (role_id=33, QA/Testing), no bugs de la
// app. (1) Dashboard: faltaba dash_kpi.can_view → la fila de KPIs (incl.
// "Empleados activos") nunca renderizaba. (2) Pedidos: faltaba
// pedidos_tab_historial.can_view → PedidosView.jsx filtra TABS por
// hasPermission(t.permKey), ningún tab pasaba, el label "Pedidos" nunca
// aparecía. Ambos se completaron con can_view=true (can_edit sigue false,
// mismo criterio de mínimo privilegio del rol). (3)
// "Modal de Editar Empleado...race condition": el test clickeaba
// button.last() de la fila asumiendo que era el lápiz "Edición rápida" —
// en StaffManagementView.jsx el último botón es en realidad "Ver perfil
// completo" (navega a EmployeeDetailView, dossier de solo lectura), cuyo
// botón Editar gatea con staff_detail.can_edit (deliberadamente false para
// esta cuenta). Corregido apuntando el selector directo al botón por
// title="Edición rápida" (staff_list.can_edit=true, que la cuenta ya
// tenía) — coincide con el diseño original documentado en memoria al crear
// la cuenta QA. Verificado: lint/build/15 tests verdes localmente.

// v2.17.51 — feat(bloque8): employees.secondary_role_id (Cargo Secundario)
// ahora SUMA permisos vía modelo de unión (primario OR secundario), en vez
// de ser puramente cosmético. Backend: nuevo helper
// auth_employee_secondary_role_id(); auth_has_module_permission(),
// auth_can_edit_any() y auth_module_scope() reescritas con OR entre rol
// primario y secundario (empate de scope: gana 'ALL', el más permisivo).
// NULL en secondary_role_id es seguro sin caso especial (empleados sin
// cargo secundario se comportan idéntico a antes). Migración aplicada
// primero en staging, verificada en transacciones ROLLBACK sobre prod con
// 2 empleados reales (Alexander Melgar/Idalia Serrano, role_id=23+20):
// productos_tab_inventario pasa de false→true (positivo real), bonificaciones
// se mantiene false (ambos roles la niegan), Jonathan Melgar (rol 30, sin
// cargo secundario) cero diferencias en ningún módulo (regresión limpia).
// ensure_user_by_code ahora selecciona y devuelve secondary_role_id/
// secondaryRoleId (ningún path de login lo exponía antes). AuthContext.jsx:
// loginWithUsername copia secondaryRoleId; refreshPermissions pide permisos
// de ambos role_id (fetchRolePermissionsForRoles nueva en
// src/data/permissions.js) y mergea por module_key (OR de acciones, scope
// más permisivo) en un solo lugar — hasPermission/getScope no cambian, ya
// consumen el mapa pre-mergeado; suscripción Realtime amplía el filtro a
// role_id=in.(primario,secundario) cuando hay cargo secundario. Fuera de
// alcance (documentado): policies de announcements por audiencia de rol,
// check-sync-health-alerts (mecanismo distinto), max_price_level/is_su
// (solo rol primario). Verificado: lint limpio, build limpio, 15 tests
// verdes.

// v2.17.50 — refactor(bloque6.C, continuación, PR2/2): extrae el hook de
// estado/fetch de TabPedidos.jsx a src/views/pedidos/tabpedidos/usePedidosData.js.
// CIERRA la segunda mitad del Bloque 6.C. Extracción mecánica: 43
// useState/useRef + 9 useEffect + 28 handlers + 7 useMemo movidos tal cual
// (mismos nombres, misma lógica, incluida la suscripción realtime con el
// truco `expandedMetaRef` y el efecto de GPS en background). TabPedidos.jsx
// 1971→918 líneas (-53%), queda solo con el JSX (incluidos 3 handlers async
// embebidos que ya vivían en el JSX antes de este refactor — el onConfirmed
// de RecepcionModal y los 2 botones Iniciar/Completar ruta — se dejaron tal
// cual, solo llamando a los valores que ahora vienen del hook). 100%
// mecánico, sin ninguna desviación de comportamiento (a diferencia de PR1,
// TabPedidos no tenía lógica duplicada que consolidar). Verificado: lint
// limpio, build limpio, 15 tests verdes, Playwright en vivo contra
// /pedidos?tab=pedidos con datos reales de producción (cards de pedidos con
// timeline de lifecycle, stats, fotos de empleados de apoyo) — sin errores
// de consola relacionados, sin ejercitar ninguna acción de lifecycle
// (Pausar/Finalizar/Crear Ruta/Anular no se clickearon).

// v2.17.49 — refactor(bloque6.C, continuación, PR1/2): extrae el hook de
// estado/fetch de TabMinMax.jsx a src/views/productos/tabminmax/useMinMaxData.js.
// Extracción mecánica: 50 useState/useRef + 9 useEffect + 24 handlers + 6
// useMemo movidos tal cual (mismos nombres, misma lógica). TabMinMax.jsx
// 2565→1666 líneas (-35%), queda solo con el JSX + `cycleDays`/`canManage`
// (no dependen del hook) + hook call/destructure. STAT_CFGS/VISIBLE_STAT_KEYS
// movidos a tabminmax/constants.js (los necesitan tanto el hook como el JSX).
// Única desviación no textual (deliberada, de bajo riesgo): los 2 fetchers de
// tooltip de Bodega, antes duplicados inline en el JSX (`onMouseEnter` de la
// misma llamada a `get_product_branch_summary`), se consolidan en
// `openBodegaTooltip`/`closeBodegaTooltip`; `_openBodegaEdit` (definida
// inline por fila) se mueve tal cual como `openBodegaEdit(row, field,
// isBodega)`. Verificado: lint limpio, build limpio, 15 tests verdes,
// Playwright en vivo contra /minmax con datos reales de producción (La
// Popular: cost cards, matriz ABC×XYZ con conteos reales, fila expandida
// con stock por sucursal vía ExpandedPanel) — sin errores de consola
// relacionados, sin escribir ningún cambio real de MIN/MAX.

// v2.17.48 — chore(theme): completa el barrido de Aurora/Cosmos pedido por
// el usuario más allá de TabCatalogo.jsx. Grep exhaustivo de "aurora",
// "cosmos", "compat", "data-theme" en todo src/ (y docs/*.md) — confirmado:
// data-theme="dark/solid/solid-dark" son temas reales y activos (no Aurora),
// sin relación con el pedido. Único remanente real encontrado: las
// animaciones `cosmos-in`/`cosmos-panel` en tailwind.config.js (keyframes +
// utilidades) y sus 2 referencias en el bloque prefers-reduced-motion de
// index.css — quedaron huérfanas tras borrar AuroraExpandedPanel/
// AuroraFullscreenModal en v2.17.47 (eran las únicas que las usaban,
// confirmado por grep: cero matches de "animate-cosmos" en todo src/ antes
// de este borrado). Eliminadas de tailwind.config.js e index.css; DESIGN.md
// actualizado (tabla de animaciones + lista de reduced-motion) para no
// documentar clases que ya no existen. Build+lint+15 tests verdes.
//
// v2.17.47 — chore(TabCatalogo): elimina AuroraExpandedPanel/
// AuroraFullscreenModal/AuroraView (534 líneas) — código muerto del tema
// "Aurora" (Cosmos) que sobrevivió a la eliminación de Aurora/Compat de
// hace semanas (confirmado: AuroraView nunca se invoca en ningún lado del
// árbol de render; AuroraFullscreenModal/AuroraExpandedPanel solo se usaban
// entre sí, anidados dentro del propio bloque muerto). Hallazgo encontrado
// durante 7B.6, pedido explícito del usuario para limpiarlo del todo — el
// proyecto solo tiene Liquid Glass. Build+lint+15 tests verdes; verificado
// en vivo (/productos con 4,357 productos reales, fila expandida OK).

// v2.17.46 — feat(bloque7b.2): tracker de corto vence — resolución
// automática de proveedor. Decisión del usuario: nueva columna
// proveedores.vineta cruzada con product_precios.vineta (el precio-viñeta
// vigente del producto) para desambiguar cuando un laboratorio tiene varios
// proveedores (caso real, no teórico: labs con 2-5 proveedores). Nuevo RPC
// get_product_vencimiento_policy(p_erp_product_id) resuelve: match por
// viñeta → fallback a proveedor único del lab → null si sigue ambiguo.
// ND a nivel de producto (products.devolutivo=false) manda sobre la
// política del proveedor, no al revés. TabPoliticaVencimiento.jsx: input
// "Viñeta" nuevo en el form de proveedor (autosave, mismo patrón que meses).
// ExpandedPanel.jsx (TabMinMax "Vencimientos próximos"): muestra proveedor
// resuelto + punto rojo COFARSAL a nivel de producto (regla b) + "Enviar a
// bodega antes del [fecha]" calculado con la regla (g) real de Bodega —
// la cuenta regresiva es sobre la política en meses, NO el mes de
// vencimiento (vence diciembre, política 2 meses → límite es la última
// semana de SEPTIEMBRE, no octubre, porque el envío tarda ~1 mes en llegar,
// regla h) — + aviso ND "reportar a jefe 6-7 meses antes" (regla f).
// Verificado con datos reales de prod en transacciones ROLLBACK (cero
// escritura permanente): caso proveedor único resuelve correcto; caso
// ambiguo (lab con 5 proveedores) resuelve correcto por match de viñeta.
// Reglas (d)/(e) de la spec (descuento a responsable, escalación a jefe de
// Bodega) quedan fuera de alcance — son un workflow de aprobación/atribución
// nuevo, no una vista de solo lectura, decisión de producto aparte.

// v2.17.45 — feat(bloque7b.8): modo offline del kiosco, Fases A+B.
// Fase A (useKioskDevice.js/branchSlice.js): validateKioskToken ahora
// distingue "la RPC respondió que no" (revocación real) de "la RPC no pudo
// ejecutarse" (error de red) — antes ambos casos devolvían el mismo `false`
// y useTimeClockEngine.js mostraba "KIOSCO NO AUTORIZADO" para los dos por
// igual, bloqueando marcajes reales solo por un corte de conexión.
// verifyDevice() ahora devuelve {config, networkError} y usa una ventana de
// gracia de 15min (lastVerifiedAt persistido) para seguir confiando en la
// última verificación exitosa cuando hay error de red.
// Fase B (nuevo src/utils/attendanceQueue.js): finalizePunch ya no es
// fire-and-forget — espera el resultado real de registerAttendance antes de
// pintar "éxito" (antes podía mostrar éxito aunque el insert nunca llegara a
// la BD). Si falla, el marcaje se encola en localStorage y se reintenta solo
// (evento 'online' + poll cada 30s) llamando de nuevo a registerAttendance
// (mismo camino que un marcaje normal, con toda su auditoría intacta).
// OfflineBanner montado en TimeClockView.jsx (antes solo estaba en
// AppLayout.jsx — el kiosco daba cero feedback de conectividad).
// Fase C (@capacitor/network) NO aplica: /kiosk está gateado por
// !isMobileOrApp() en App.jsx — nunca corre en la app nativa Capacitor ni en
// tablets/celulares, solo en un navegador de escritorio normal. Fase D
// (cache de datos) queda diferida — no hay problema real que resuelva hoy.
// Verificado en vivo con Playwright (context.setOffline): banner "Sin
// conexión" aparece correctamente sobre el kiosco. 15 tests unitarios verdes.

// v2.17.44 — feat(bloque7b.6): historial de precios en catálogo. Nueva
// sección "Historial de precios" en ExpandedProductRow (TabCatalogo.jsx),
// junto a "Historial de compras" — lee product_precios_history (modelo
// SCD2, ya tenía RLS abierta a authenticated, no hizo falta RPC nuevo).
// fetchProductDetail (data/productos.js) suma una 6ª query en el mismo
// Promise.all ya existente. Dedupe en la UI de snapshots de precio
// idénticos consecutivos por presentación (la tabla acumula una fila por
// corrida del sync aunque el precio no cambie — write-churn preexistente,
// fuera de alcance tocar el sync acá). No reemplaza "Cambios en el
// producto" (product_precios_changelog) — son conceptos distintos,
// coexisten como 2 secciones. Verificado en vivo: producto real con 26
// filas de historial, dedupe funcionando, consistente con la duplicación
// "UNIDAD ×2" que ya existe en la tabla de precios vigentes de arriba
// (2 presentaciones legítimas distintas, mismo tipo genérico).

// v2.17.43 — feat(bloque7b.7): vista de Objetos Huérfanos. Nueva
// OrphanObjectsView.jsx en menú Sistema (moduleKey "orphan_objects",
// registrado en PermissionsView.jsx, permiso otorgado a role_id=13 igual
// que sync_health) — tablero de seguimiento sobre orphan_objects_registry
// (tabla nueva, sembrada con 8 casos reales verificados de nuevo antes de
// sembrar, no copiados ciego de notas viejas: SalyChatOverlay ya eliminado
// -resuelto-, StageAnim/EmpChip/StagePill de TabPedidos importados pero sin
// uso en el JSX -confirmado con grep, EmpChip/StagePill SÍ están importados,
// contradice una nota vieja que decía "sin caller" a secas-, RutaEnCursoCard
// sin ningún import, ShiftExceptionModal con estado que nunca se pone en
// true, FormAiSchedulerPreview sin ningún openModal() que lo invoque,
// sync-erp-minmax código muerto hallado en Fase 0). No es detección
// automática (el proyecto no tiene knip/ts-prune) — es un registro manual
// donde se marca estado (candidato/confirmado/falso positivo/resuelto).
// Verificado en vivo con Playwright: las 8 filas renderizan con notas y
// selector de estado editable.

// v2.17.42 — feat(bloque7b.3): dashboard de salud de syncs. Nueva vista
// SyncHealthView.jsx en el menú Sistema (moduleKey "sync_health", registrado
// en PermissionsView.jsx) — tabs por dominio (Productos/MinMax/Compras/
// Backup) sobre v_sync_health (Fase 0), polling cada 30s (no Realtime, es un
// dashboard histórico). src/data/syncHealth.js nuevo. No reemplaza
// SyncHealthBanner/useSyncMonitor (esos siguen siendo el aviso operativo en
// vivo de inventario). Verificado en vivo con Playwright (permiso temporal
// otorgado y revertido en el momento, con OK explícito, ya que ningún
// empleado real tiene hoy el rol "Sistema — Alertas Técnicas" como primario):
// menú/rutas/tabs renderizan correctamente, estado vacío correcto para
// MinMax (dominio sin corridas aún).

// v2.17.41 — feat(bloque7b.5): export CSV en Ventas Perdidas. Nueva utilidad
// compartida src/utils/csvExport.js (primera extracción del patrón Blob+BOM+
// separador ";"+CRLF que ya usaba TabMinMax.jsx ad-hoc, sin su lógica de
// negocio) + botón "CSV" en VentasPperdidasView.jsx (visible cuando hay
// filas, respeta el tab activo). appendAuditLog('EXPORT_VENTAS_PERDIDAS').
// Verificado en vivo con Playwright: descarga real disparada,
// ventas_perdidas_pendiente_2026-07-16.csv.

// v2.17.40 — feat(bloque7b.4): feedback sonoro del kiosco tras escaneo.
// El feedback visual (FeedbackOverlay + colores por caso) ya existía; el
// único gap real era audio (confirmado: 0 usos de Audio()/beep en todo el
// repo). Nuevo src/utils/kioskSound.js — tonos generados con Web Audio API
// (sin .mp3, evita autoplay-policy en WebViews de Capacitor). Enganchado con
// un solo useEffect sobre feedback.color en useTimeClockEngine.js, reusando
// la máquina de estados existente (verde/azul/morado→éxito, naranja/rosa→
// advertencia, rojo→error). Verificado en vivo con Playwright: overlay rojo
// "KIOSCO NO AUTORIZADO" dispara el tono de error (2 osciladores confirmados).
//
// v2.17.39 — fix(bloque7A.7 gap): get_stock_analysis leía columnas viejas de
// dispatch_rules (solo_cajas/multiplo/blister/multiplo_unidades — siempre
// vacías desde la migración al modelo nuevo) en vez de dispatch_id_presentacion/
// dispatch_multiplo/dispatch_label, por eso hasRule era siempre false en
// TabMinMax. RPC reescrita con el mismo CTE dispatch_pres_factor que ya usa
// get_pedido_preview correctamente (product_precios.factor × dispatch_multiplo).
// TabMinMax.jsx actualizado para leer dispatch_pres_factor/dispatch_multiplo/
// dispatch_tipo. Verificado en vivo: 393 productos con regla real ahora
// muestran su múltiplo (ej. "Bote ×2", 3→4 redondeado correctamente).
//
// v2.17.38 — feat(bloque7A.7): valor numérico de Despacho en TabMinMax —
// dispMin/dispMax/applyRule ya calculaban el MIN/MAX redondeado a la
// regla de despacho, pero el JSX solo mostraba el nombre de la regla
// (ruleNote), nunca el resultado numérico. Agregada una segunda línea
// bajo el badge de presentación ("{applyRule(dispMin)} · {applyRule
// (dispMax)}", con tooltip), visible solo cuando hasRule && hasPres —
// display puramente aditivo, reutiliza el applyRule ya existente sin
// introducir matemática nueva (área con historial de bugs de redondeo,
// ver project_pedido_preview_dispatch_rounding).
//
// Hallazgo real durante la verificación en vivo: nunca se pudo ver el
// badge nuevo con datos reales porque get_stock_analysis (la RPC que
// alimenta esta vista) selecciona dr.solo_cajas/dr.multiplo/dr.blister/
// dr.multiplo_unidades de dispatch_rules — columnas que están vacías en
// las 845 filas de la tabla (0 con solo_cajas=true, 0 con multiplo>1,
// 0 con blister>1, 0 con multiplo_unidades>1). La regla real vive en
// dispatch_rules.dispatch_multiplo (393 filas con valor >1, confirmado
// contra la BD), una columna que la RPC nunca lee. hasRule es siempre
// false hoy en toda la vista — no es un bug de este PR ni del
// componente, es un desalineamiento previo entre la RPC y el esquema
// real de dispatch_rules. Fuera de alcance de 7A.7 (gap de UI, no de
// pipeline de datos) — documentado como hallazgo nuevo en el plan para
// una sesión futura. El código de este PR es correcto y se poblará en
// cuanto se corrija get_stock_analysis. Build + lint + 15 tests verdes.

// v2.17.37 — feat(bloque7A.6): botón "Ocultar filtrados" en TabMinMax —
// hideFiltered() tenía la lógica de bulk-hide completa (RPC vía
// upsertStockParamsBulk + audit log MINMAX_HIDE_FILTERED) pero sin botón
// ni confirmación. Agregado en la toolbar de drafts (mismo grupo que
// "Descartar"/"Publicar", visible cuando draftCount>0 y hay filtro
// activo), con ConfirmModal — mismo patrón exacto que "Descartar"
// (isDestructive, isProcessing, mensaje explicando el alcance). El
// mensaje aclara que es reversible desde el filtro de ocultos
// (unhideProduct/unhideAll, ya existentes). hideFiltered ahora envuelve
// la escritura en try/finally con setHidingFiltered + toast de éxito/error,
// igual que handlePublish. Verificado: build/lint/15 tests verdes; en
// vivo el filtro ABC=A aplicó correctamente (51 productos, pill visible),
// el botón nuevo vive en el mismo contenedor condicional que "Descartar"
// (requiere draftCount>0 — no se forzó "Calcular" para no escribir drafts
// a prod solo para la captura), sin errores de consola nuevos.

// v2.17.36 — feat(bloque7A.5): tarjeta "Llegada confirmada" en
// ReceptionActions.jsx — llegadaEmp/llegadaTipo llegaban como prop pero,
// a diferencia de erpEmp (con su bloque "Confirmado en Sistema de
// Ventas"), el Paso 1 (llegada de cajas) simplemente desaparecía sin
// dejar registro de quién/qué tipo confirmó una vez llegadaOk=true.
// Agregada tarjeta "Confirmado" equivalente, mismo patrón visual que el
// bloque de erpOk (empChip + acento emerald), con label de tipo
// reutilizando el mismo vocabulario que LLEGADA_TIPO_INFO de
// PostCompletionSection.jsx (sin novedad/caja dañada/caja faltante/daños
// + faltantes). Verificado en vivo: build limpio, sin pedido real en
// estado "enviado" ahora mismo para ver la tarjeta (mismo hallazgo que
// 7A.1/7A.3), cero errores de React/consola nuevos.

// v2.17.35 — feat(bloque7A.3): botón "Todo OK" en RecepcionModal — gap
// confirmado real. handleTodoOk (línea ~428) tenía lógica completa
// (confirma recibido = enviado para la caja/pedido actualmente abierto,
// sin revisar línea por línea) pero ningún caller. Investigado a fondo
// primero: existe una función hermana `handleConfirmarTodo` con caller ya
// activo ("Confirmar todo OK" en la pantalla de selección de cajas), pero
// opera a otro nivel — confirma TODAS las cajas accesibles de una vez desde
// el picker, mientras que handleTodoOk es el atajo para la caja/pedido que
// ya está abierto en la pantalla de items. No son duplicados. Agregado
// botón "Todo OK" en el footer de esa pantalla, junto al botón principal
// "Confirmar Caja X"/"Confirmar recepción", mismo wording/icono (Check)
// que el patrón ya usado en handleConfirmarTodo. Verificado en vivo: build
// limpio, sin pedido real en estado "enviado" ahora mismo para abrir el
// modal (mismo hallazgo que 7A.1), cero errores de React/consola nuevos.

// v2.17.34 — fix(bloque7A.2): auto-copy-weekly-roster — bugs encadenados
// de status literal. `.eq('status', 'ACTIVE')` (×2: filtro de Talento
// Humano y filtro de fallback Admin/Supervisor) nunca matcheaba nada —
// employees.status es 'ACTIVO' (español, verificado contra la BD real:
// 49/49 activos con ese valor exacto). Efecto encadenado: al no encontrar
// NINGÚN destinatario válido (ni TH ni fallback), `recipientIds` quedaba
// siempre vacío y `target_type: recipientIds.length > 0 ? 'EMPLOYEE' :
// 'ALL'` caía siempre en 'ALL' — un broadcast a TODA la empresa en vez de
// la notificación dirigida a TH/Admin que el código realmente intentaba
// enviar. Corregido ambos `.eq('status', 'ACTIVE')` → `'ACTIVO'`. role_id
// 11 (Talento Humano) y FALLBACK_SYSTEM_ROLES (ADMIN/SUPERVISOR) ya
// estaban correctos, verificados contra roles/employees reales. Impacto
// histórico = 0 (nunca hubo un conflicto de turno que disparara esta
// rama), pero el bug quedaba latente hacia adelante. Edge function
// desplegada a producción (`deploy_edge_function`, verify_jwt=true
// preservado). Sin cambios de frontend, sin tests unitarios aplicables
// (edge function Deno, fuera del runner de Vitest).

// v2.17.33 — feat(bloque7A.1): cierre de bodega en Pedidos — backend listo
// desde 2026-06-21, faltaba el punto de entrada en la UI. Agregado un
// bloque nuevo en DifSection.jsx (dentro de la tarjeta de pedido, visible
// cuando todas las diferencias individuales ya fueron confirmadas): bodega
// escribe una nota opcional y marca "Marcar corregido"
// (update_pedido_sucursal_lifecycle stage=corregir_bodega), luego sucursal
// ve la nota y hace "Confirmar corrección recibida"
// (stage=confirmar_correccion). Backend sin cambios — RPC y columnas de
// pedido_sucursal_status (corregido_bodega_at/por/nota,
// confirmado_correccion_at/por) ya existían y ya se seleccionaban en
// get_pedidos_en_curso. handleCorregirBodega/handleConfirmarCorreccion en
// TabPedidos.jsx tenían el backend completo pero ningún caller — ahora
// wireados vía 2 props nuevas de DifSection. Mismo patrón visual/de gating
// que el resto de DifSection (isBranch decide qué lado ve qué acción, sin
// chequeo de permiso extra en el cliente — el RPC ya lo hace server-side).
// Verificado en vivo: /pedidos?tab=pedidos carga sin errores nuevos, el
// resto del timeline/tarjetas de pedidos reales sigue renderizando
// exactamente igual (sin regresión); no hay actualmente ningún pedido en
// el estado "parcial con diferencias ya confirmadas" para ejercitar el
// botón nuevo en vivo sin escribir a producción sin permiso. Build + lint
// + 15 tests unitarios verdes.

// v2.17.32 — docs(plan): Bloque 6.B CERRADO — sobre-fetch investigado y
// cerrado sin cambios de código. employees_safe/employee_events/
// employee_documents ya se escalaban a "mi sucursal"/"solo yo" para
// self-service desde antes de esta sesión. Lo único sin scope hoy es
// employee_rosters (semana actual) y shifts, pero con ~47 empleados
// activos totales el ahorro real de escalar rosters es de ~40 filas
// descartadas en memoria — no un problema de performance — y shifts es
// una tabla chica de uso legítimo compañía-entera (Monitor/Auditoría/
// Kiosco/Admin), escalarla arriesga esos consumidores por casi nada.
// Decisión informada del usuario: no vale el riesgo/complejidad para el
// tamaño actual de la empresa. La race condition real (el problema que
// originalmente motivó el bloque) ya quedó resuelta en v2.17.31.

// v2.17.31 — refactor(bloque6.B): primer slice de fetchBoot — employeesStatus
// desacoplado de bootStatus. systemSlice.js: fetchBoot() dividido en 2 grupos
// que arrancan ambos de inmediato (mismo tiempo total de red, cero
// serialización nueva): grupo liviano (holidays/branches/roles/shifts/
// announcements) y grupo empleados (rosters/employees_safe/events/documents/
// branch_assign). bootStatus mantiene su significado exacto (sigue sin pasar
// a 'ready' hasta que TODO termine); employeesStatus (nuevo) pasa a 'ready'
// en cuanto el grupo de empleados específicamente termina, sin esperar a los
// datos livianos. Consumidores migrados (los únicos 2 puntos de entrada al
// modal "Editar Empleado" en todo el repo): StaffManagementView.jsx (3 usos:
// gate de apertura, canEdit del botón, 5 checks de loading/skeleton) y
// EmployeeDetailView.jsx (handleEditProfile) — este último NO tenía ninguna
// protección hasta ahora, era un punto de entrada abierto a la misma race
// condition documentada en StaffManagementView.jsx (employees arranca del
// snapshot sanitizado de localStorage sin DUI/ISSS/AFP/banco/kiosk_pin
// mientras employees_safe sigue en vuelo; abrir "Editar" en esa ventana
// mostraba campos vacíos y guardar los sobrescribía con NULL en la BD).
// App.jsx y SchedulesView.jsx no se tocan (no leen bootStatus). Sin cambios
// de esquema de BD — puro estado de frontend. Verificado en vivo con
// Playwright: login fresco → abrir "Edición rápida" en /dashboard → modal
// abre con DUI real poblado (no vacío); mismo check desde
// /dashboard/empleado/:id → "Editar" (el punto antes desprotegido) — ambos
// con datos reales de Dolores Concepción Tejada Hernández. Sin errores
// nuevos en consola (solo ruido pre-existente: COEP, CORS de
// ensure_user_by_code). Build + lint + 15 tests unitarios verdes.
// Deja abierto el resto de 6.B (más slices, sobre-fetch) para futuras
// sesiones — este PR cierra exactamente lo que pedía el plan: "migrar
// primero el modal de empleado".

// v2.17.30 — refactor(bloque6.A): CIERRE — último bloque de 19 archivos de
// 1 sitio cada uno, PR final de la migración completa. Archivos: TabExpenses,
// PayrollView, NoAccessView, AccessDeniedView, pedidoPrint.js,
// useTimeClockEngine.js, PracticanteModal, AppLayout, FormWfmAnalytics,
// FormEditPayrollEntry, TabStaff, SyncHealthBanner, SidebarSyncStatus,
// TabHistorial, ConfigPanel, TabMinMaxRequests, EmployeeDocumentsView,
// WidgetSrsInventory, WidgetInventorySearch. 12 funciones nuevas +
// extensión de fetchOvertimeBankRows (agrega subtype, superset-reuse) en
// data/payroll.js, data/branches.js, data/permissions.js, data/pedidos.js,
// data/practicantes.js, data/ventasPerdidas.js (×2), data/schedules.js (×2),
// data/inventory.js (×2), data/promotions.js, data/stockParams.js,
// data/minmaxRequests.js. Reuso exacto: insertApprovalRequestSilent
// (useTimeClockEngine, payload en array — mismo shape que
// WidgetAnnulmentRequest) y fetchOwnApprovalRequests (EmployeeDocumentsView,
// select superset ya usado por EmployeeRequestsView). fetchRoleName y
// fetchInventorySyncLogRecent son funciones nuevas compartidas por 2
// archivos cada una (NoAccessView/AccessDeniedView; SyncHealthBanner/
// SidebarSyncStatus — mismo query, SyncHealthBanner selecciona superset con
// items_count). Verificado en vivo con Playwright contra datos reales:
// /promociones?tab=historial (promoción cerrada real "OMEGA 3 1000MG" con
// productos/branches/ventas reales vía fetchClosedPromotions), /branches/2
// → tab Gastos (TabExpenses renderiza sin error, estado vacío correcto — sin
// pagos PAGADO aún), /minmax → panel de Configuración abre con los 15
// campos poblados desde fetchStockConfigFull (NO se guardó — escribir
// stock_config de producción requiere consentimiento explícito del usuario
// en el momento, no cubierto por esta sesión autónoma), /payroll y
// /overview cargan sin errores (SidebarSyncStatus + AppLayout badge de
// ventas perdidas se ejercitan en cada carga de página, sin errores en
// ninguna de las ~7 páginas visitadas). Ruido de consola pre-existente sin
// relación (COEP, CORS de ensure_user_by_code, top_productos transitorio)
// presente igual que antes, cero errores nuevos. Escaneo Python de todo
// src/ confirma 0 sitios supabase.from() reales restantes fuera de
// src/data/*.js (quedan los 11 de systemSlice.js/fetchBoot, deliberadamente
// fuera de alcance — Bloque 6.B). Build + lint + 15 tests unitarios verdes.
// CIERRA Bloque 6.A: 173 sitios corregidos migrados en 22 PRs.
//
// v2.17.29 — refactor(bloque6.A): ExpandedPanel.jsx + ItemSections.jsx +
// ApoioScanModal.jsx + ProductosView.jsx + MinMaxView.jsx +
// EmployeeDetailView.jsx + auditSlice.js + usePushSubscription.js +
// NuevoConteoModal.jsx + EmployeeFormModal.jsx — 20 supabase.from()
// migradas (2×10). Dos módulos nuevos: data/pushSubscriptions.js (2fn) y
// data/audit.js (2fn — insertAuditLog/fetchAuditLogs, el corazón de
// appendAuditLog usado en TODO el proyecto). data/stockParams.js +6fn
// (MinMaxView, ItemSections, ExpandedPanel). data/pedidos.js +2fn
// (ApoioScanModal). data/employees.js +3fn (EmployeeDetailView timeline +
// EmployeeFormModal catálogo educativo/última baja). data/requests.js
// +1fn (EmployeeDetailView tab Solicitudes). ProductosView.jsx y
// NuevoConteoModal.jsx no necesitaron NINGUNA función nueva — sus 4
// sitios combinados reutilizan fetchLaboratoriosBasic,
// fetchProductCategories (ya en data/inventarioTab.js) y
// searchActiveProductsForConteo (ya en data/conteoInventario.js) al
// 100%. Verificado en vivo con Playwright contra datos reales de
// producción: /auditview (1000 registros reales, usuarios y acciones
// reales), /minmax → expandir fila (ExpandedPanel con stock real de red,
// compra real de C.IMBERTON S.A., venta real a cliente), /conteo-
// inventario → Nuevo Conteo (sin errores), /dashboard → detalle de
// empleado real (Dolores Concepción Tejada Hernández, historial +
// timeline reales) → Editar (EmployeeFormModal con catálogo educativo
// cargado sin errores). ApoioScanModal.jsx no se pudo ejercitar en vivo
// (requiere simular un scan de carné por teclado dentro de un pedido
// activo) — verificado por sustitución 1:1 exacta. Build + lint + 15
// tests unitarios verdes.

// v2.17.28 — refactor(bloque6.A): TabPromos.jsx + TabBonificaciones.jsx +
// TabSinVenta.jsx + TabLaboratorios.jsx + EmployeeProfileView.jsx +
// AuthContext.jsx + FormTurnos.jsx — 21 supabase.from() migradas (3×7).
// data/promotions.js +6fn (fetchPromotionBonifications, insertPromotionPayment,
// updatePromotionBonificationPaid, fetchPromotionsList, updatePromotionEstado,
// deletePromotion). data/stockParams.js +3fn (minmax_ignored: fetch/upsert/delete).
// data/laboratorios.js +2fn (lab_locations) — el tercer sitio de
// TabLaboratorios.jsx reutiliza fetchLaboratoriosBasic ya existente.
// data/employeeSelfService.js +3fn para EmployeeProfileView. data/system.js
// +2fn para FormTurnos (upsertShift/updateShiftFlags). data/permissions.js
// +2fn (fetchRolePermissionsForRole/fetchRolePriceLevelAndSU) y data/auth.js
// nuevo (1fn: fetchEmployeeSafeByUsername) para AuthContext.jsx —
// código de login crítico, preservado exacto (mismo .single(), sin
// tocar el flujo de reintentos/retry). FormTurnos.jsx resultó
// inalcanzable desde la UI (mismo patrón que EmployeeScheduleView/
// RutaEnCursoCard/ShiftExceptionModal de PRs anteriores): el tipo de
// modal "manageShifts" está definido en UnifiedModal.jsx pero ningún
// openModal() lo dispara. Verificado en vivo con Playwright (login
// fresco en 5 sesiones distintas, confirmando que el flujo de auth
// sigue funcionando): /promociones
// (real, sin promos activas), /promociones?tab=bonificaciones (real,
// sin bonificaciones aún), /productos?tab=sinventa (Gestión de Stock
// carga sin errores), /laboratorios (355 laboratorios reales, 1 con
// ubicación, 7 sucursales), /profile (Edwin Nuñez, 4 pendientes reales,
// historial real). FormTurnos.jsx verificado por sustitución 1:1 exacta
// al no ser alcanzable. Build + lint + 15 tests verdes.

// v2.17.27 — refactor(bloque6.A): RutaMapModal.jsx + RutaEnCursoCard.jsx +
// VentasPperdidasView.jsx + ShiftExceptionModal.jsx — 16 supabase.from()
// migradas (4+4+4+4). RutaMapModal solo necesitó 1 función nueva
// (fetchRutaLocationSingle en data/pedidos.js) — los otros 3 sitios
// reutilizan fetchSucursalesConCoords/upsertRutaLocation ya existentes.
// RutaEnCursoCard resultó ser 100% reuso (0 funciones nuevas): sus 4
// sitios son literalmente el mismo código que RutaCard en TabRutas.jsx
// (updateRutaStatus×2, updateRutaPedidoEntregado, fetchBranchIdForSucursal)
// — y resultó ser código muerto: el changelog v2.2.341 documenta
// "eliminar RutaEnCursoCard" pero el archivo nunca se borró del repo, solo
// dejó de importarse (mismo patrón que EmployeeScheduleView.jsx en
// v2.17.25). data/ventasPerdidas.js nuevo (4 fn). data/system.js +2 fn
// para ShiftExceptionModal.jsx (fetchPublishedRosterWithId/
// updateEmployeeRosterById, cada una reutilizada 2× dentro del mismo
// archivo — handleSave y handleRemoveException comparten el query
// exacto). ShiftExceptionModal.jsx tampoco es alcanzable en vivo: su
// botón trigger (setShowExceptionModal(true)) no existe en
// EmployeeDetailView.jsx — el modal y su estado quedaron pero sin
// disparador. Verificado en vivo con Playwright: /pedidos?tab=rutas →
// "Ver mapa" (Ruta #4, conductor real, fallback Leaflet correcto ante
// RefererNotAllowedMapError de Google Maps en localhost — comportamiento
// esperado, no regresión), /ventas-perdidas (productos reales buscados
// por clientes, reportante real). RutaEnCursoCard y ShiftExceptionModal
// verificados por sustitución 1:1 exacta al no ser alcanzables. Build +
// lint + 15 tests verdes.

// v2.17.26 — refactor(bloque6.A): ComprasView.jsx + WidgetMinMaxRequest.jsx +
// ConteoDetailView.jsx + LabsPanel.jsx — 20 supabase.from() migradas
// (5+5+5+5). Tres módulos nuevos: src/data/compras.js (5 fn),
// src/data/minmaxRequests.js (5 fn — las 2 últimas preservan el patrón de
// paginación en paralelo count+N chunks de 1000 vía .range(), Patrón B de
// CLAUDE.md, sin cambios de comportamiento) y src/data/minmaxLabs.js
// (5 fn). data/conteoInventario.js extendido con 5 fn más (10 → 15
// llamadas cubiertas en ese módulo). Verificado en vivo con Playwright
// contra datos reales de producción: /compras (334 facturas reales,
// proveedores y montos reales), /minmax → panel de laboratorios (5
// ocultos, conteos de productos reales por laboratorio), /overview →
// widget "Ajuste de Min/Max" (búsqueda real: DEXA NEUROBION INY., DOLO
// NEUROBION), /conteo-inventario → conteo real de Bodega en progreso con
// productos/lotes reales. Sin errores de consola atribuibles al cambio
// (incluye la falsa alarma ya documentada de "[top_productos] Failed to
// fetch", confirmada transitoria y no relacionada). Build + lint + 15
// tests unitarios verdes.

// v2.17.25 — refactor(bloque6.A): PromoModal.jsx + EmployeeRequestsView.jsx +
// EmployeeScheduleView.jsx — 18 supabase.from() migradas (6+6+6). Dos
// módulos nuevos: src/data/promotions.js (6 fn: searchActiveProductsByName,
// fetchProductPreciosForPromo, fetchSalesBranches, insertPromotion,
// insertPromotionBranches, insertPromotionProducts) y
// src/data/employeeSelfService.js (9 fn: 5 para EmployeeRequestsView —
// fetchOwnApprovalRequests, fetchPendingShiftChangeRequestsForApprover,
// fetchOwnMinMaxChangeRequests, fetchEmployeeNamesByIds,
// fetchEmployeeEventsByTypes — y 4 para EmployeeScheduleView —
// fetchPublishedRosterForWeek, fetchEmployeeEventsByTypesUntil,
// fetchMyVacationPlansMultiYear, fetchPendingVacationChangeRequest). Ambos
// archivos de EmployeeXView reutilizan además updateApprovalRequest/
// insertApprovalRequest (data/requests.js) y updateVacationPlan
// (data/vacationPlans.js) ya existentes — el insert de approval_requests en
// EmployeeScheduleView pasó de un `.select()` genérico a la variante con
// columnas explícitas de insertApprovalRequest, sin impacto: el caller solo
// lee id/status/metadata/created_at, todos incluidos. Verificado en vivo con
// Playwright: /my-requests (solicitudes reales — Cambio de Vendedor,
// pendientes con niveles reales), /promociones → "Nueva" (Paso 1 carga
// sucursales reales: La Popular + Salud 1-5). El paso de búsqueda de
// productos (searchActiveProductsByName) no se pudo automatizar por el
// widget LiquidSelect con búsqueda server-side — verificado por
// sustitución 1:1 exacta. EmployeeScheduleView.jsx no tiene ruta activa en
// App.jsx actualmente (no se pudo verificar en vivo por esa razón, no por
// el cambio) — se migró igual porque el archivo y sus queries siguen
// siendo código real del repo. Sin errores de consola atribuibles al
// cambio. Build + lint + 15 tests verdes.

// v2.17.24 — refactor(bloque6.A): WidgetAnnulmentRequest.jsx +
// TabGenerar.jsx + CrearRutaModal.jsx — 19 supabase.from() migradas
// (7+6+6). data/customers.js nuevo (1 fn: searchCustomersByTokens, con
// el .or() dinámico por token intacto). data/requests.js +1 fn
// (insertApprovalRequestSilent — variante sin .select() de vuelta,
// reutilizada 4× por los 4 formularios de anulación/cambio de
// pago/vendedor/cliente, que antes tenían 4 inserts idénticos en forma
// pero con payload distinto). data/facturacion.js +2 fn
// (fetchInvoiceItemsForInvoice, fetchBranchInvoicesForMonth).
// data/pedidos.js +11 fn: 5 para TabGenerar (fetchActiveEmployeesBasic,
// fetchPedidoNumero, fetchPedidoIdsSinceExcluding,
// fetchPedidoSucursalStatusForPedidos, fetchPedidoItemsForPrintCapture
// — esta última reutiliza updatePedidoSucursalStatus ya existente) y
// 6 para CrearRutaModal (fetchEmployeeDriverInfo,
// fetchPedidosDisponiblesParaRuta, fetchPedidoSucursalStatusFinalizados,
// fetchSucursalesConCoords, fetchBranchIdsForSucursales — más 2 sitios
// que reutilizan updateRutaStatus y fetchBranchIdForSucursal ya
// definidos en PRs anteriores). Verificado en vivo con Playwright:
// /pedidos?tab=generar (dashboard real de sucursales con % de
// abastecimiento y 981 productos sin stock en Bodega), /overview
// (widgets del dominio sales_invoices — Facturación Hoy, Top Productos —
// con datos reales y cero errores, confirmando que las queries nuevas
// de facturacion.js funcionan; el widget de anulación en sí no está en
// el layout de dashboard de esta cuenta de prueba). CrearRutaModal.jsx
// no se pudo ejercitar en vivo — el botón "Nueva Ruta" está detrás de
// pedidos_tab_rutas.can_edit, permiso que esta cuenta no tiene (mismo
// gap ya documentado para TabRutas.jsx en el PR anterior) — verificado
// por sustitución 1:1 exacta de cada query. Sin errores de consola
// atribuibles al cambio en ningún caso. Build + lint + 15 tests verdes.

// v2.17.23 — refactor(bloque6.A): SchedulesView.jsx + TabRutas.jsx — 15
// supabase.from() migradas (8+7). Módulo nuevo src/data/schedules.js (5 fn):
// fetchScheduleCoverageAtBranch, fetchScheduleCoverageFromBranch,
// fetchBranchHourlySales, deleteScheduleCoverage, upsertScheduleCoverage —
// los otros 3 de los 8 sitios de SchedulesView reutilizan
// fetchRostersForWeekByEmployees (data/requests.js) y
// upsertWeeklyRoster/upsertBulkWeeklyRosters (data/system.js). TabRutas.jsx
// resultó ser casi puro reuso: 5 de sus 7 sitios ya existían en
// data/pedidos.js (updateRutaStatus, updateRutaPedidoEntregado,
// fetchBranchNamesForSucursales, fetchBranchIdForSucursal — este último
// reutilizado dos veces); solo 2 funciones nuevas (fetchRutasConParadas,
// fetchPedidoNumerosByIds) se agregaron a ese mismo módulo, en vez de
// crear un archivo nuevo solo para dos exports. Import muerto de
// `supabase` eliminado en SchedulesView.jsx (queda solo para
// .channel()/.removeChannel() en TabRutas.jsx). Verificado en vivo con
// Playwright contra datos reales de producción: /schedules (horario
// semanal real con 5+ empleados de La Popular), /pedidos?tab=rutas
// (Historial Rutas con Ruta #4, conductor Francisco Ernesto Ramirez,
// entrega real a La Popular). Sin errores de consola atribuibles al
// cambio. Build + lint + 15 tests unitarios verdes.
// v2.17.22 — refactor(bloque6.A): vacationPlanSlice.js — 14 supabase.from()
// migradas. Módulo nuevo src/data/vacationPlans.js (8 fn): fetchVacationHeaders,
// updateVacationHeaderStatus, updateVacationPlansBulkPreApprove,
// fetchVacationChangeRequests, updateVacationPlan (genérica, con toggle
// returning=true/false para preservar el .select().single() exacto de cada
// sitio), fetchVacationPlans, fetchOverlappingVacationPlans, insertVacationPlan.
// El update final de approval_requests en processChangeRequest reutiliza
// updateApprovalRequest de data/requests.js (mismo query exacto, no se
// duplica). Este archivo NO estaba en el inventario original de 385 sitios
// (undercount ya documentado en PLAN-EJECUCION-2026-07.md) — es el primero
// de los 173 sitios reales descubiertos en el reescaneo completo del
// 2026-07-15. Verificado en vivo con Playwright contra datos reales de
// producción: /vacation-plan renderiza Plan de Vacaciones 2026 con
// asignación real (Andy Mancia, La Popular, 02-ene→16-ene, CONFIRMADO).
// Sin errores de consola atribuibles al cambio (solo el ruido preexistente
// ya documentado: COEP, CORS de ensure_user_by_code, widget top_productos).
// Los paths de escritura (aprobar/rechazar cambio, crear/editar/cancelar
// plan) no se ejercitaron en vivo por tratarse de datos reales de RRHH —
// verificados por sustitución 1:1 exacta de cada query. Build + lint +
// 15 tests unitarios verdes.
// v2.17.21 — refactor(bloque6.A): TabInventario.jsx + EmployeeHomeView.jsx
// + EncuestaView.jsx + SrsEnriquecerModal.jsx — 29 supabase.from()
// migradas (7+8+7+7). Dos módulos nuevos: src/data/inventarioTab.js
// (5 fn) y employeeHome.js (6 fn); el resto se resolvió extendiendo
// módulos ya existentes de este bloque (encuestas.js +2 fn, productos.js
// +2 fn) o reutilizando funciones idénticas ya definidas
// (fetchLaboratoriosBasic, fetchEmployeeRosterSchedule,
// fetchRostersForWeekByEmployees, fetchSurveys/Bloques/Preguntas/
// updateSurvey, deleteProductActivePrinciples/insertProductActivePrinciples/
// updateProductPrincipioActivo) — 11 de los 29 sitios no crearon función
// nueva, solo importaron la que ya existía de un PR anterior de este
// mismo bloque.
// Verificado en vivo con Playwright contra datos reales de producción:
// Inventario (13,925 productos, 525 vencidos, $313,780.13 inversión,
// filas reales de ENSURE ADVANCE en las 7 sucursales), Inicio de
// empleado (horario semanal real con compañeros de sucursal), Clima
// Organizacional 2026 (38 participantes, score global 78/100, puntajes
// reales por bloque). Sin errores de consola atribuibles al cambio —
// se descartó una falsa alarma inicial de "fetchAllRows error" que
// resultó ser requests abortados por el propio script de prueba al
// navegar rápido entre páginas, confirmado al reproducir cada vista en
// aislamiento sin ese error. Build + lint + 15 tests unitarios verdes.
// v2.17.20 — refactor(bloque6.A): TabPoliticaVencimiento.jsx +
// TabReglas.jsx + AttendanceAuditView.jsx — 25 supabase.from() migradas
// (8+9+8; conteo real, no 21). Tres módulos nuevos: src/data/
// laboratorios.js (8 fn), dispatchRules.js (9 fn), attendanceAudit.js
// (5 fn) — attendanceAudit.js además reutiliza updateAttendancePunch/
// updateEmployee de data/employees.js y updateApprovalRequest de
// data/requests.js (mismo query exacto, no se duplica). Otro while-loop
// manual de paginación 1000-en-1000 (dispatch_rules en TabReglas)
// reemplazado por fetchAllRows.
// Verificado en vivo con Playwright contra datos reales de producción:
// Laboratorios/Política de Vencimiento (355 laboratorios, 18
// proveedores reales), Reglas de Despacho (4,354 productos activos,
// 845 con regla, 3,509 sin regla, filas reales), Auditoría de Tiempos
// (8 empleados con nombres reales, 76 ausencias, quincena actual). Sin
// errores de consola atribuibles al cambio. Build + lint + 15 tests
// unitarios verdes.
// v2.17.19 — refactor(bloque6.A): PermissionsView.jsx + CotizacionesView.jsx
// — 25 supabase.from() migradas (10+15; conteo real, no 16). Dos módulos
// nuevos: src/data/permissions.js (6 fn) y src/data/cotizaciones.js (8 fn).
// CotizacionesView.jsx reutiliza fetchBranchesBasic de data/system.js
// (Bloque 6.A, PR4) — mismo query exacto. Otro while-loop manual de
// paginación 1000-en-1000 (product_precios para el catálogo de la
// cotización) reemplazado por fetchAllRows.
// Verificado en vivo con Playwright contra datos reales de producción:
// Permisos de Acceso con roles y conteos reales (Gerente General 32/57
// módulos, Administrador 35/57, etc.) y el panel de detalle de un
// cargo con nivel de precio y toggles de módulo reales; Cotizaciones
// con la lista y stats cargando correctamente. Sin errores de consola
// atribuibles al cambio. Build + lint + 15 tests unitarios verdes.
// v2.17.18 — refactor(bloque6.A): RecepcionModal.jsx + DashboardView.jsx
// — 18 supabase.from() migradas (9+9). Dos módulos nuevos:
// src/data/recepcion.js (6 fn) y src/data/dashboard.js (9 fn).
// RecepcionModal.jsx reutiliza updatePedidoSucursalStatus de
// data/pedidos.js (Bloque 6.A, PR2) para los 3 sitios que actualizan
// cajas_recibidas — mismo query exacto, no se duplica. Otro while-loop
// manual de paginación 1000-en-1000 (product_precios por lote de
// productos) reemplazado por fetchAllRows.
// Verificado en vivo con Playwright contra datos reales de producción:
// Dashboard completo (49 empleados activos, 4 solicitudes pendientes,
// widgets de ventas por sucursal con montos reales, "Facturación Hoy"
// 382 documentos/$3,694.40, gráfico "Ventas por día" con datos reales,
// layout de widgets personalizado cargado correctamente desde
// user_dashboard_prefs). Sin errores de consola atribuibles al cambio.
// Build + lint + 15 tests unitarios verdes.
// v2.17.17 — refactor(bloque6.A): VentasView.jsx + EncuestaAdminView.jsx
// — 24 supabase.from() migradas (13+11; conteo real, no 20). Dos módulos
// nuevos: src/data/ventas.js (12 fn) y src/data/encuestas.js (11 fn).
// Verificado en vivo con Playwright: Ventas con datos reales de
// producción (10,431 facturas, $109,916.07 total ventas, filas con
// clientes/vendedores/sucursales reales), Gestión de Encuestas con el
// formulario cargando correctamente. Sin errores de consola atribuibles
// al cambio. Build + lint + 15 tests unitarios verdes.
// v2.17.16 — refactor(bloque6.A): requestsSlice.js + slices chicos
// (practicantesSlice, notificationsSlice, conteoInventarioSlice,
// payrollSlice) — 63 supabase.from() migradas (36+5+5+3+14; conteo real,
// no ~25). Cinco módulos nuevos: src/data/requests.js (25 fn),
// practicantes.js (5 fn), notifications.js (5 fn), conteoInventario.js
// (3 fn), payroll.js (12 fn).
// requestsSlice.js es el motor de enrutamiento de aprobaciones (quién
// aprueba qué solicitud, subiendo recursivamente por la jerarquía de
// roles) — el módulo de mayor sensibilidad de este PR. Los lookups de
// empleados que se parecen pero difieren en qué filtros son
// condicionales vs. fijos se dejaron como funciones separadas
// (fetchActiveEmployeesInRoleAndBranch vs.
// fetchActiveEmployeesBySystemRoleConditional/ByRoleIdConditional) —
// fusionarlas habría cambiado el comportamiento real de enrutamiento,
// no solo movido el query. employee_rosters (lectura+upsert) reutiliza
// fetchEmployeeRosterSchedule/upsertWeeklyRoster ya definidos en
// data/employees.js y data/system.js (Bloque 6.A, PRs anteriores).
// Verificado en vivo con Playwright: Bandeja de Aprobaciones con 2
// solicitudes reales (CAMBIO DE VENDEDOR, nivel 1/3, nombres y fechas
// reales), Nómina con estado vacío real ("Sin períodos aún") — cero
// errores de consola (ni siquiera el ruido COEP habitual). Los paths de
// escritura (crear/aprobar/rechazar solicitud, generar planilla,
// practicantes) no se ejercitaron en vivo por no tocar datos reales de
// RRHH sin permiso explícito — verificados por sustitución 1:1 exacta
// de cada query. Build + lint + 15 tests unitarios verdes.
// v2.17.15 — refactor(bloque6.A): employeeSlice.js + branchSlice.js —
// 35 supabase.from() migradas (20 + 15; conteo real, no 29 — mismo
// motivo de líneas partidas). Dos nuevos módulos: src/data/employees.js
// (10 fn) y src/data/branches.js (13 fn). Reutilización real entre
// módulos de este mismo bloque: employee_branches/employee_rosters ya
// tenían funciones equivalentes en data/system.js (Bloque 6.A,
// systemSlice.js) — employeeSlice.js las importa en vez de duplicar
// (insertEmployeeBranches, deleteEmployeeBranches, upsertWeeklyRoster).
// Los supabase.storage.from() de subida de archivos (fotos, documentos,
// contratos) quedan intactos en ambos archivos — acceso a bucket, no a
// tabla.
// Verificado en vivo con Playwright contra datos reales de producción:
// Monitor en Tiempo Real (49 empleados reales, horarios/turnos/pausas
// reales — ejercita fetchAttendanceSince), Sucursales (7 sucursales
// reales con datos de kioscos/legal/local/servicios), Gestión de
// Personal (48 empleados reales con roles/sucursales/estados). Los
// paths de escritura (alta/edición/baja de empleado, marcaje de
// asistencia, alta/edición de sucursal, gastos, kioscos) no se
// ejercitaron en vivo por no tocar datos reales de RRHH/sucursales sin
// permiso explícito — verificados por sustitución 1:1 exacta de cada
// query. Build + lint + 15 tests unitarios verdes.
// v2.17.14 — refactor(bloque6.A): FacturacionView.jsx — 23 supabase.from()
// migradas a src/data/facturacion.js (nuevo módulo, 19 funciones). El
// conteo real era 23, no 18 (mismo motivo que systemSlice/TabMinMax:
// llamadas partidas en dos líneas). Los 2 supabase.storage.from()
// ('payment-proofs') quedaron intactos — acceso a bucket, no a tabla.
// **Bug de paginación corregido de paso**: la query de pagos no-efectivo
// (fetchNonCashInvoices, tab "No Efectivo") filtraba sales_invoices
// —tabla flagged en CLAUDE.md como obligatoriamente paginada— SIN
// fetchAllRows; un mes con mucho volumen de tarjeta/transferencia podía
// truncarse en silencio sobre el cap de 1000 filas de PostgREST. Las
// otras dos queries de sales_invoices en este archivo (facturas NULA,
// pendientes de Hacienda) ya usaban fetchAllRows correctamente.
// fetchInvoicesByIds(ids, columns) generalizado cubre 3 sitios distintos
// (lookup de facturas resueltas/pendientes-MH/confirmadas, cada uno con
// su propio set de columnas).
// Verificado en vivo con Playwright contra datos reales de producción,
// las 4 sub-pestañas: SALTOS con gaps reales (La Popular, Salud 1) y
// contador de campos nulos correcto; NO EFECTIVO con 470 pendientes
// reales ($11,544.66 — 376 tarjeta/79 crédito/15 transferencia) y
// nombres de clientes reales en la tabla. Sin errores de consola
// atribuibles al cambio. Build + lint + 15 tests unitarios verdes.
// v2.17.13 — refactor(bloque6.A): TabMinMax.jsx — 23 supabase.from()
// migradas a src/data/stockParams.js (nuevo módulo, 10 funciones). El
// conteo real era 23, no 20 (mismo motivo que systemSlice: llamadas
// partidas en dos líneas que el grep de una sola línea no detectaba).
// La inmensa mayoría de los sitios son upsert/update a
// product_stock_params con la misma clave compuesta (erp_product_id,
// erp_sucursal_id) — se consolidaron en upsertStockParams/
// updateStockParams genéricos (el caller sigue armando el payload/
// patch exacto que ya armaba antes; cubren ~15 de los 23 sitios).
// Verificado en vivo con Playwright contra datos reales de producción:
// vista Min/Max con cost cards reales ($31.9k/$26.6k/$2.1k/$734.73/
// $15.9k→$31.1k), matriz ABC×XYZ con conteos reales, tabla con
// productos y MIN·MAX reales; modal de historial abierto con datos
// reales de auditoría (Edwin Nuñez, BORRADOR, MIN/MAX 0→1). Los paths
// de escritura (upsert/update sobre MIN/MAX, que alimentan compras)
// no se ejercitaron en vivo por no tocar datos reales de compras sin
// permiso explícito — verificados por sustitución 1:1 exacta de cada
// query. Build + lint + 15 tests unitarios verdes.
// v2.17.12 — refactor(bloque6.A): systemSlice.js — 34 supabase.from()
// migradas a src/data/system.js (nuevo módulo, 24 funciones). El
// conteo real de sitios en este archivo era 34, no 31 como decía el
// inventario original de la sesión — el grep inicial de 6.A (patrón de
// una sola línea) no detectaba las llamadas `supabase\n.from(...)`
// partidas en dos líneas, bastante comunes en este slice.
// **Deliberadamente NO se tocó `fetchBoot`** (11 de los sitios del
// archivo) ni el estado `bootStatus`/`isBootSyncing`/`bootPromise` —
// es la función más usada y de mayor riesgo de todo el proyecto
// (corre en cada login), y su refactor es alcance de 6.B (partir el
// monolito), una sesión dedicada aparte con prueba en staging primero.
// `fetchKioskBoot` sí se migró (2 sitios) — es una función
// independiente que no toca la máquina de estados de boot.
// 4 pares de sitios eran duplicados literales, consolidados en una
// función cada uno: updateEmployeeFields (aplicar/revertir un evento
// de RRHH sobre employees), insertEmployeeDocument (adjuntar
// documento desde registerEmployeeEvent y desde addDocumentToEvent),
// updateEmployeeEventMetadata (cancelar/editar un evento), setShiftActive
// (archivar/reactivar un turno).
// Verificado en vivo con Playwright: login (ejercita fetchBoot intacto),
// Centro de Comunicaciones con avisos reales, Horarios y Turnos,
// Jerarquía Institucional con datos reales de roles. Los paths de
// escritura (insert/update/delete de eventos, roles, avisos, turnos,
// asuetos, rosters) no se ejercitaron en vivo para no escribir datos
// de RRHH reales sin permiso explícito — verificados por sustitución
// 1:1 de forma exacta de cada query, no por corrida en vivo. Build +
// lint + 15 tests unitarios verdes.
// v2.17.11 — refactor(bloque6.A): TabCatalogo.jsx — las 29 llamadas
// supabase.from() migradas a src/data/productos.js (nuevo módulo, 15
// funciones). Dos pares de sitios eran duplicados literales,
// consolidados en una sola función: el update de foto_url (dos
// componentes de foto distintos con la misma lógica de guardar) y el
// fetch de detalle expandido de un producto (prefetchRow y toggleRow
// llamaban exactamente las mismas 5 queries en paralelo — ahora
// fetchProductDetail). El query dinámico de la lista principal
// (loadProducts, con .or/.eq/.order condicionales según búsqueda y
// filtros) se consolidó en fetchProductsList(params); el control de
// flujo (el early-return cuando effectiveBids queda vacío) se quedó en
// el componente, solo el query builder se movió.
// Verificado en vivo con Playwright contra datos reales: tab CATÁLOGO
// con contadores reales (4,354 activos/818 inactivos, 11 nuevos, 6
// modificados, 4 con pérdida, 27 margen bajo), búsqueda "electrolit" →
// ELECTROLIT COCO 625ML con laboratorio/estado correctos, fila
// expandida con presentaciones y precios reales (factor, costo, 7
// niveles de precio con % de margen). Sin errores de consola
// atribuibles al cambio. Build + lint + 15 tests unitarios verdes.
// v2.17.10 — refactor(bloque6.A): TabPedidos.jsx — las 45 llamadas
// supabase.from() del componente principal (post-6.C) migradas a
// src/data/pedidos.js (nuevo módulo, 22 funciones). El archivo tenía
// el perfil de riesgo más alto de los 61 archivos del inventario 6.A:
// flujos de negocio secuenciales/ramificados (confirmación de llegada,
// reenvío de cajas faltantes, finalizar con cajas) con múltiples
// queries entrelazadas en el mismo handler — se optó por sustitución
// 1:1 de cada query por su función (sin tocar el control de flujo),
// no por extraer los handlers completos. Deduplicación real donde el
// query era 100% idéntico entre sitios: updatePedidoSucursalStatus/
// fetchPedidoSucursalStatus (getter/setter genéricos por
// pedido_id+erp_sucursal_id, cubren ~15 sitios), fetchBodegaBranchId
// (4 lookups idénticos de la sucursal de bodega), updatePedidoItemsFaltaCaja.
// Bug de paginación corregido de paso: fetchItems tenía DOS while-loops
// manuales de paginación 1000-en-1000 (pedido_items, pedido_item_eventos)
// duplicando la lógica que ya existe en fetchAllRows — reemplazados por
// fetchPedidoItemsAll/fetchPedidoItemEventosAll, mismo comportamiento,
// sin código repetido.
// Verificado en vivo con Playwright contra datos reales de producción:
// tab PEDIDOS con 6 sucursales activas, expandir pedido 04-140726-1-S3
// (474 solicitados / 151 enviados / 308 sin stock / 13 por regla) →
// drill-down a "Productos enviados" con datos reales de producto/
// laboratorio/presentación intactos. Sin errores de consola atribuibles
// al cambio (el ruido de COEP/CORS/ensure_user_by_code es preexistente,
// no relacionado). Build + lint + 15 tests unitarios verdes.
// v2.17.9 — refactor(bloque6.A): primer módulo real de la capa de datos
// — src/data/inventory.js (antes src/data/ solo tenía catálogos
// estáticos: constants.js, elSalvadorGeo.js, nationalities.js).
// Empieza por WidgetInventorySearch.jsx, el consumidor que el plan ya
// señalaba como punto de partida (había tenido un bug de datos antes).
// Hallazgo real de paso: 2 de las 3 queries a `inventory`/`products`
// del widget NO usaban fetchAllRows — `inventory` es una de las tablas
// que CLAUDE.md marca como obligatoriamente paginada (max-rows=1000 de
// PostgREST); un término de búsqueda amplio (ej. un principio activo
// muy común, con muchos productos × sucursales × lotes) podía truncar
// resultados en silencio. Las 4 funciones nuevas
// (fetchProductPhotoMap, fetchProductsByPrincipioActivo, searchInventory,
// fetchInventoryByProductIds) usan fetchAllRows consistentemente.
// No es un hook (a diferencia de "hook por entidad" en la descripción
// original del plan) — el widget dispara la búsqueda de forma
// imperativa con debounce propio, así que funciones async simples
// encajan mejor que un hook con auto-fetch; el hook sí tiene sentido
// para consumidores que hacen fetch-on-mount, se evaluará caso por
// caso en la migración oportunista.
// Verificado en vivo con Playwright: búsqueda real "ensure" desde el
// Dashboard → "LA POPULAR 68 uds" con 4 productos y cantidades
// correctas (2/2/9/12 uds), idéntico a antes de la migración.
// Build + lint + 15 tests unitarios verdes.
// v2.17.8 — refactor(bloque6.C): CIERRA TabPedidos.jsx (3457→2037 líneas,
// -1420 en este PR; -48% desde el original 3943). Último y más grande
// lote de la sesión: ItemSection+ItemSections (las 4 tablas
// colapsables de un pedido expandido — Enviados/Agotamiento/Sin stock/
// Revisar regla — con su editor inline de MIN/MAX), LifecycleTimeline+
// PauseBadge (la línea de tiempo horizontal del ciclo de vida del
// pedido), DifSection (resolución de diferencias bodega↔sucursal),
// PostCompletionSection (resumen de recepción), ReceptionActions (los
// 2 pasos de recepción: confirmar llegada + confirmar en Sistema de
// Ventas), FilterPill (filtros de sucursal/fecha/estado) →
// src/views/pedidos/tabpedidos/. Los 7 helpers de fecha/formato que
// TabPedidos.jsx comparte con sus sub-componentes (fmtMin, elapsed,
// fmtEntrega, fmtRelative, getBranchStage, calcSolicitado,
// currentMonthRange) quedaron centralizados en tabpedidos/helpers.js,
// importados de vuelta donde el cuerpo principal los sigue usando.
// Extracción mecánica en los 6 PRs de TabPedidos.jsx de hoy — mismo
// JSX/lógica, solo cambia el límite de archivo.
// Verificado en vivo con Playwright expandiendo un pedido real: la
// línea de tiempo completa (Confirmado→Inicio→Listo→...→Finalizado con
// avatares reales), las 4 tablas colapsables con conteos reales
// (Enviados 151/Sin inventario 308/Revisar regla 13), y al abrir
// "Productos enviados" la tabla completa con datos de producción
// (ALDACTONE, ANALGEPLUS, etc., columnas LABORATORIO/PRODUCTO/
// PRESENTACIÓN/SOLICITADO/ENVIADO/ESTADO) — todo idéntico a como se
// veía antes de la extracción, cero errores de consola.
// Con esto, TabMinMax.jsx (2584 líneas, componente principal +
// ExpandedPanel-scale ~1955) y TabPedidos.jsx (2037 líneas) quedan
// ambos reducidos a esencialmente su componente principal de
// orquestación — 6.C completo en el sentido "todo lo mecánicamente
// extraíble ya se extrajo"; lo que queda en cada archivo es el hook de
// estado/fetch central de cada tab, que es un refactor de otra
// naturaleza (partir estado, no mover JSX) y queda fuera de este
// bloque de trabajo.
// Build + lint + 15 tests unitarios verdes.
// v2.17.7 — refactor(bloque6.C): 2do lote de TabPedidos.jsx (3840→3457
// líneas, -383). Los 3 modales de acción: PauseModal (pausar despacho,
// motivo + comentario), AnularModal (anular pedido, con/sin motivo
// obligatorio según si ya se inició), ApoioScanModal (escáner de
// carné por keydown para registrar apoyo — lookup en `employees` +
// upsert en `pedido_apoyo` + auditoría) → tabpedidos/PauseModal.jsx,
// AnularModal.jsx, ApoioScanModal.jsx. PAUSE_REASONS (usado también en
// el cuerpo principal, línea ~2417) → tabpedidos/constants.js.
// Los 3 son igual de auto-contenidos que las extracciones anteriores
// (props + estado propio, ApoioScanModal con sus propios fetches/
// writes a Supabase pero sin depender de nada del scope de
// TabPedidos) — mismo patrón mecánico.
// Verificación en vivo con límite honesto: los 3 modales solo se abren
// con un pedido en un estado de ciclo de vida específico (preparando/
// recién iniciado) que ningún pedido real tenía en el momento de
// verificar — no se forzó ese estado con un write real solo para
// probar la extracción. Confirmado en cambio: cero errores de consola
// al cargar /pedidos → PEDIDOS (los imports/exports de los 3 modales
// están bien enlazados — un import roto habría tirado abajo todo el
// módulo) y al expandir una card real (ItemSections, todavía sin
// extraer, sigue funcionando igual al lado). Misma transcripción
// exacta del JSX/lógica que las 6 extracciones anteriores ya probadas
// en vivo esta sesión.
// Build + lint + 15 tests unitarios verdes.
// v2.17.6 — refactor(bloque6.C): arranca TabPedidos.jsx (3943→3840
// líneas). Primer lote, mismo patrón que TabMinMax: las 6 animaciones
// de "stage" (MotorcycleAnim/BoxStackAnim/PausedAnim/VioletGlow/
// ScanAnim/PingDot + su dispatcher StageAnim) → tabpedidos/
// StageAnims.jsx; EmpChip/StagePill/SucPill → archivos propios.
// STAGE_CONFIG/COLOR_CLS/SUC_COLORS (usados solo dentro de estos
// componentes, no en el cuerpo principal) → tabpedidos/constants.js.
// **Hallazgo de paso, no corregido (fuera de alcance de esta
// extracción):** StageAnim, EmpChip y StagePill no tienen NINGÚN
// caller en todo el archivo — código muerto real, no falso positivo de
// grep (verificado explícitamente). Quedaron extraídos igual (mecánico,
// sin criterio de "está vivo o no"), documentado acá para que quede
// registro; decidir si se borran o se les busca uso es una decisión de
// producto aparte. SucPill sí tiene un caller real (la card de cada
// pedido) y se verificó en vivo con Playwright: los pills de color por
// sucursal (Salud 1 azul, Salud 2 violeta, Salud 3 esmeralda, etc.) se
// ven idénticos en la pestaña PEDIDOS real, con datos de producción,
// junto al LifecycleTimeline (todavía sin extraer) funcionando igual.
// Build + lint + 15 tests unitarios verdes.
// v2.17.5 — refactor(bloque6.C): 4ta extracción de TabMinMax.jsx
// (2913→2584 líneas, -329; -34% acumulado desde 3947). `ConfigPanel`
// (panel flotante de configuración: ciclo de reposición, reorden por
// XYZ, umbrales ABC/XYZ, buffer de seguridad, winsorización — escribe
// en stock_config) y `LabsPanel` (visibilidad de laboratorios en
// MinMax, toggle + auditoría) → tabminmax/ConfigPanel.jsx y
// tabminmax/LabsPanel.jsx. Ambos igual de auto-contenidos que las
// extracciones anteriores (props + estado propio, sin closures sobre
// TabMinMax) — mismo patrón mecánico.
// Con esto, TabMinMax.jsx solo conserva el componente principal
// (~1,955 líneas: fetch/estado de la tabla, filtros, DataTable,
// modales de historial/publicación). Los 4 PRs de esta sesión
// extrajeron 10 sub-componentes + todos los helpers/constantes
// compartidos a src/views/productos/tabminmax/.
// Verificado en vivo con Playwright: ConfigPanel abre con los valores
// reales guardados (35 días cobertura, 180 días ventana, 25/25/25
// reorden XYZ, 150%/400% umbrales XYZ, 70%/90% ABC); LabsPanel abre con
// la lista real de laboratorios y conteo de productos ("5 ocultos",
// "1-ABBOTT NUTRICIONAL 52 productos", etc.).
// Build + lint + 15 tests unitarios verdes.
// v2.17.4 — refactor(bloque6.C): 3ra extracción de TabMinMax.jsx
// (3507→2913 líneas, -594 — la extracción más grande hasta ahora).
// `ExpandedPanel` → `tabminmax/ExpandedPanel.jsx`: el sub-componente más
// grande y con más acoplamiento real de los 4 hechos hasta ahora — hace
// sus propios fetches a Supabase (get_product_branch_summary,
// get_product_expiring_lots, product_stock_params_history,
// product_cost_history, get_product_last_sales) en 2 waves (branch
// summary primero, resto en paralelo), usa useAuth/useNowTick, y
// consume StockBar/AbcXyzBadge (ya extraídos en PRs anteriores —
// primera vez que un componente extraído consume a otro).
// De paso, quedaron compartidas por fin sin duplicar: ERP_NAMES/
// ERP_ORDER/ALERT (usadas también en el cuerpo principal de TabMinMax,
// ~25 sitios) → tabminmax/constants.js; sortedPres/smallestPres/
// formatUnits/formatDominant (usadas en ambos lados) →
// tabminmax/helpers.js. Extracción mecánica — misma lógica/JSX, solo
// cambia el límite de archivo.
// Verificado en vivo con Playwright expandiendo una fila real: grilla
// de 7 sucursales con StockBar y badge "BORRADOR" ámbar, Referencia
// pedido (cobertura 38.6d, MIN/MAX), Últimas compras/ventas con datos
// reales (proveedor, cliente, fechas, precios), Proyección de stock
// (+30/+60/+90d), Historial de cálculos con AbcXyzBadge anidado — todo
// idéntico a como se veía antes de la extracción.
// Build + lint + 15 tests unitarios verdes.
// v2.17.3 — refactor(bloque6.C): 2da extracción de TabMinMax.jsx
// (3800→3507 líneas, -293 líneas). `AbcXyzMatrix` (grilla ABC×XYZ
// clicable, filtra la tabla) y `RowActions` (máx 3 botones + dropdown
// "Más" por fila: Poner 0/Restaurar/Historial/Ocultar/0 en red/
// Descartar/Publicar) → `tabminmax/AbcXyzMatrix.jsx` y
// `tabminmax/RowActions.jsx`. Ambos eran igual de auto-contenidos que
// el primer lote (props + callbacks, sin closures sobre el estado
// interno de TabMinMax) — mismo patrón mecánico, mismo nivel de riesgo
// bajo. `XYZ_KEYS`/`ABC_KEYS` (solo usados dentro de AbcXyzMatrix) se
// movieron junto con el componente, sin quedar duplicados.
// Verificado en vivo con Playwright contra datos reales: grilla ABC×XYZ
// idéntica (54/230/87/6/183/214/3/143/457), botones "Poner 0"/
// "Restaurar" en la columna ACCIONES funcionando igual que antes.
// Quedan para el siguiente PR: ExpandedPanel (~547 líneas, el más
// grande y con más acoplamiento real — hace sus propios fetches RPC),
// ConfigPanel, LabsPanel — y después TabPedidos.jsx completo.
// Build + lint + 15 tests unitarios verdes.
// v2.17.2 — refactor(bloque6.C): primera extracción de TabMinMax.jsx
// (3947→3800 líneas). Empezando por el menor acoplamiento, como pide el
// plan ("un PR chico por vez"): 6 componentes 100% presentacionales
// (CoverageBar, StockBar, AbcXyzBadge, CardSkeletons, CostCards,
// DraftCostCard) + los 2 helpers/constantes que comparten con el resto
// del archivo (fmtMoney, normXyz → tabminmax/helpers.js; ABC_CFG,
// XYZ_CFG → tabminmax/constants.js, estos 2 últimos ya no se usaban
// fuera de AbcXyzBadge así que no se re-importan en el archivo
// principal). Nuevo directorio `src/views/productos/tabminmax/`.
// Extracción mecánica — mismo JSX/lógica, solo cambia el límite de
// archivo; sin cambios de comportamiento. Verificado en vivo con
// Playwright contra datos reales: CostCards ($32.0k/$26.7k/$2.1k/
// $735.65), DraftCostCard ($15.9k → $31.1k) y AbcXyzBadge (columna
// CLASE de la tabla: AY/AZ/BZ con el color-coding correcto, Z en rosa)
// renderizan idéntico a antes. Quedan para próximos PRs de 6.C:
// AbcXyzMatrix, RowActions, ExpandedPanel, ConfigPanel, LabsPanel (todo
// TabMinMax.jsx), y luego TabPedidos.jsx completo (mismo patrón, ya
// tiene sub-componentes bien separados adentro del archivo: MotorcycleAnim,
// PauseModal, AnularModal, ApoioScanModal, ItemSection, LifecycleTimeline,
// DifSection, etc.). Build + lint + 15 tests unitarios verdes.
// v2.17.1 — design(bloque5.7): cierra las 2 decisiones de producto que
// quedaban pendientes, decididas junto al usuario.
// 5.7a (animate-bounce): auditados los 16 usos existentes — ninguno es
// el anti-patrón real (rebote decorativo sin propósito). Son 3
// categorías legítimas: indicador de carga (App.jsx, puntos
// secuenciados, mismo patrón que iMessage/Slack), badge de cumpleaños
// (AppLayout/StaffManagementView/EmployeeHomeView, celebración
// deliberada y consistente), ícono de error en FeedbackOverlay.jsx
// (feedback de kiosco, atención necesaria en pantalla de uso rápido/
// desatendido). Sin cambios de código — se documentó el estándar en
// DESIGN.md §31 con las 3 categorías permitidas, para que auditorías
// futuras no lo vuelvan a marcar como pendiente sin necesidad.
// 5.7b (user-scalable=no): bloqueaba pinch-zoom sin condición — tensión
// real con WCAG 1.4.4 para cualquiera navegando el portal como página
// web normal. En vez de elegir un solo lado (todo bloqueado o todo
// abierto), se hizo condicional: nuevo script inline en index.html
// (corre sincrónico antes de que React monte, sin parpadeo de
// comportamiento) que mantiene el zoom bloqueado SOLO en build nativo
// (Capacitor.isNativePlatform()), PWA ya instalada (display-mode:
// standalone / navigator.standalone en iOS), o la ruta /kiosk (tablet
// montada en sucursal). En cualquier otro caso — pestaña de navegador
// normal, incluso en celular — se reescribe el meta viewport para
// permitir pinch-zoom real. Verificado en vivo con Playwright: pestaña
// normal → zoom habilitado; /kiosk → zoom bloqueado; flag
// navigator.standalone simulado (iOS) → zoom bloqueado. Sin errores de
// consola en ningún caso.
// Build + lint + 15 tests unitarios verdes. Bloque 5 CERRADO 7/7.
// v2.17.0 — feat(bloque5.5): pantalla de "sin conexión" para la PWA.
// Alcance decidido con el usuario: mínimo, no offline funcional real —
// `public/sw.js` (antes solo manejaba Web Push, cero fetch/cache) ahora
// intercepta SOLO requests de navegación (`event.request.mode ===
// 'navigate'`) y el logo que usa la propia pantalla de offline
// (`/Logo192.png`); intenta red primero, y si falla sirve
// `public/offline.html` (página estática nueva, self-contained, sin
// depender de ningún asset con hash del build) en vez del error nativo
// del navegador. Deliberadamente NO cachea index.html/JS/CSS del bundle
// — es el riesgo real que el plan marcaba ("riesgo de stale"): el
// proyecto ya tuvo que resolver un problema real de chunks viejos tras
// deploy (ver el guard de `vite:preloadError` en `src/main.jsx`,
// preexistente) y un service worker que cachea el App Shell mal
// invalidado es la causa clásica de ese mismo problema en otros
// proyectos PWA. Al no tocar en absoluto cómo se sirven JS/CSS/HTML del
// build, ese riesgo queda en cero — la única superficie cacheada
// (offline.html + un logo) no cambia con cada deploy.
// Verificado en vivo con Playwright (Chromium real, `context.setOffline`):
// 1ª carga online → SW se instala y activa; offline → navegar muestra
// "Sin conexión" con logo cacheado visible y botón Reintentar; volver
// online → navegación normal se recupera sin rastro, sin recargar
// manualmente el SW. Build + lint + 15 tests unitarios verdes.
// v2.16.11 — design(bloque5.6): pase de accesibilidad dirigido, cerrando
// los gaps ya documentados en DESIGN.md §25 (no se inventó alcance nuevo,
// se cerró lo ya catalogado en la auditoría de diseño anterior).
// Hallazgo principal: ModalShell tenía la prop `ariaLabel` desde siempre,
// pero NINGÚN caller la pasaba nunca — TODOS los modales de la app
// (incluido UnifiedModal, el sistema de modales de mayor tráfico, ~40
// tipos de formulario) anunciaban a lectores de pantalla con el genérico
// "Ventana modal" sin importar el contenido real. Arreglado en la raíz:
// LiquidModal ahora acepta y reenvía `ariaLabel`; los 9 sitios reales que
// usan <LiquidModal>/<ModalShell> directo ahora pasan el título real del
// modal (UnifiedModal reusa su propio getModalTitle() ya existente).
// LiquidSelect (usado en ~30+ sitios) ganó el patrón combobox/listbox
// completo: role="combobox" + aria-haspopup + aria-expanded +
// aria-controls en el trigger (con id real vía useId()), role="listbox"
// en el dropdown, role="option"+aria-selected+id en cada opción, y
// aria-activedescendant apuntando a la opción resaltada por teclado.
// Grupos colapsables del sidebar (AppLayout.jsx): aria-expanded +
// aria-controls en el header del grupo, id real en el contenedor del
// submenu.
// PortalInput (el componente de input compartido — "todo formulario
// nuevo debe reusarlo", ver comentario en el propio archivo): ahora
// asocia label<->input vía id/htmlFor, y expone aria-required/
// aria-invalid/aria-describedby apuntando al badge de "Requerido"/error
// ya visible. Solo 4 usos hoy, pero arregla el componente canónico, no
// cada formulario — cualquier form nuevo que lo reuse queda correcto
// por default.
// Fuera de alcance de este pase (documentado en DESIGN.md §25, no
// mecánico de resolver en un solo componente compartido): inputs
// hand-rolled fuera de PortalInput (la mayoría del formulario de
// Empleado y otros), y el gap de focus-visible en inputs glass con
// outline-none (ya tienen su propio ring visible, solo no está
// gateado a focus-visible).
// Verificado en vivo con Playwright: toggle de grupo del sidebar
// (aria-expanded false→true, id de submenu real), LiquidSelect
// (aria-controls apunta a un listbox real con opciones role="option"),
// modal de Promociones (aria-label="Nueva Promoción" confirmado en el
// DOM real, antes habría sido "Ventana modal"). Build + lint + 15 tests
// unitarios verdes.
// v2.16.10 — design(bloque5.3): touch targets <44px, long-tail dirigido
// (WCAG 2.5.8). Auditoría propia con Playwright (getBoundingClientRect +
// chequeo de intersección real con viewport, mismo fix del bug de falsos
// positivos por sidebar transform:translateX que ya documentaba la
// auditoría original) sobre 25 rutas × 2 viewports (390px/768px): 240
// instancias crudas, 39 combos ruta/viewport.
// Triado en 2 categorías:
// (A) BUG REAL, mecánico y seguro — corregido: el botón de abrir/cerrar
// búsqueda de ViewTabBar.jsx ya se había fijado a 44px uniforme en Fase 4
// de la auditoría original, pero 22 vistas tienen su PROPIA copia
// duplicada de ese mismo botón (el hallazgo "Search pattern duplication"
// de DESIGN.md §32, ya documentado pero no cerrado) — esas copias seguían
// con el patrón viejo `w-10 h-10 md:w-11 md:h-11`/`w-9 h-9 md:w-10
// md:h-10` (40px en mobile). 34 instancias en 22 archivos →
// `w-11 h-11` uniforme, igual que el componente ya-corregido. Más: 2
// botones fijos en 40px sin variante responsive (AttendanceMonitorView,
// "Buscar empleado"/"Ver concepto oscuro") → 44px. Total: 36 botones
// reales, 24 archivos.
// (B) Enlaces/CTAs de texto sin padding real (hit-box literal = tamaño
// del texto) — corregidos con el mismo patrón `p-X -m-X` ya usado en el
// botón hamburguesa de AppLayout (padding agranda el área de toque, el
// margen negativo cancela el desplazamiento visual): los 7 links "Ver/Ver
// todas/Ver todos" de las cards del Dashboard, y "Seleccionar todas" de
// TabGenerar.jsx (Pedidos).
// (C) CTAs primarios con altura real unos px por debajo de 44 (NO son
// pills decorativas, son la acción principal de su vista) — bumpeados
// directamente: "Cancelar" (búsqueda de Payroll/VacationPlan, h-10→h-11),
// "Nueva Cotización" (py-2.5→py-3.5), "Crear Encuesta" (py-3→py-3.5),
// "Admin Facturas" (h-9/h-10→h-11).
// NO tocado, documentado como trade-off deliberado (mismo criterio que
// el precedente ya sentado en la auditoría original con el botón
// "Activar" de PushPromptBanner — agrandarlos cambia notablemente el
// carácter visual del elemento, no es un bug oculto de hit-box):
// - Íconos flotantes hover-reveal de tamaño fijo (Dashboard "Cambiar
//   tamaño" 27px, ScheduleChart "Expandir Análisis" 24px) — insignias
//   circulares pequeñas deliberadas, agrandar a 44px sería un cambio
//   visual real, no un padding invisible (ya tienen w/h fijo 1:1 con su
//   círculo visible).
// - Grupos de íconos densos en cards (RolesView Editar/Eliminar/Ver
//   Empleados, AnnouncementsView Editar/Archivar/Eliminar aviso,
//   BranchesView Copiar/Diagnóstico/Ver Perfil/Ajustes) — agrandar el
//   hit-box invisible arriesga solapar el área de toque de íconos
//   vecinos muy próximos entre sí (mis-clicks), riesgo real de UX no
//   mecánico de resolver.
// - TODAS las pills de filtro/tab con texto (TODOS/ARCHIVO/ACTIVOS/
//   ANULADAS/CLIMA/VISUAL/LISTADO/DÍAS/HORAS/Salud 1-5/etc., ~130
//   instancias) — es el mismo Filter Pill Standard / Tab Bar Standard
//   usado deliberadamente en TODA la app (ver DESIGN.md), no un
//   accidente por vista. Agrandarlas a 44px de alto sería un rediseño
//   sistémico del componente de pill compacta, fuera de alcance de un
//   fix de accesibilidad puntual.
// - Botones internos de LiquidSelect (X de limpiar, chevron) — son
//   controles secundarios anidados DENTRO de un trigger ya de 40-44px
//   que en sí mismo es un área de click grande (abre el dropdown); usado
//   en ~30+ sitios de la app, cambiar su comportamiento de hit-box tiene
//   blast radius alto para un beneficio incierto — no tocado.
// - Toggles tipo switch (ej. announcements 40x20) — proporción estándar
//   de industria para switches, no una violación de hit-box en el
//   sentido de "botón sin padding".
// Re-auditado después de los fixes: 240→210 instancias crudas (-26 firmas
// únicas, 0 regresiones nuevas — diff de conjuntos antes/después
// confirma cero apariciones nuevas). Verificado con Playwright en vivo
// (desktop 1440px + mobile 390px, 8 rutas: overview/facturacion/
// cotizaciones/branches/roles/monitor/payroll/requests) sin errores de
// página ni regresiones visuales — el patrón padding/margen-negativo
// deja la posición visual idéntica, los CTAs bumpeados se ven
// proporcionados. Build + lint + 15 tests unitarios verdes.
// v2.16.9 — design(bloque5.4): últimos 2 <select> nativos migrados a
// LiquidSelect — TimePicker12 (stepper hora/minuto/AM-PM) y
// FormAiSchedulerPreview (celda de turno en grilla densa). Ninguno de los
// dos calzaba en los tamaños existentes de LiquidSelect (min-h-[40px] fijo,
// dropdown con piso de 170px) — se agregó una variante nueva `nano`: sin
// ícono izquierdo (libera espacio horizontal), texto centrado, min-h-[26px],
// piso de dropdown 120px. No se tocó compact/default — 0 regresión visual
// en los ~30 usos existentes de LiquidSelect (confirmado por diff: solo se
// agregaron ramas condicionales `nano ? ... : ...`, todas con fallback al
// comportamiento previo).
// TimePicker12: los 3 <select> (hora/minuto/AM-PM) → LiquidSelect nano+bare,
// clearable=false (mismo comportamiento: siempre hay un valor una vez el
// usuario empieza a elegir). Verificado en vivo con Playwright (Horarios y
// Turnos → Catálogo → Nuevo Turno): abrir cada stepper, elegir 07/30/PM,
// el campo ENTRADA queda "07:30 PM" y el validador SALY AI recalcula la
// duración en vivo — el onChange sigue propagando igual que antes. Un
// efecto secundario cosmético conocido y aceptado: el input de búsqueda
// interno de LiquidSelect (placeholder "Buscar...") se ve recortado en
// campos de 44-52px de ancho — no bloquea nada (las listas son de 2-12
// ítems, no hace falta escribir para filtrar).
// FormAiSchedulerPreview: los 2 <select> de celda de turno (con turno
// asignado y celda "LIBRE") → LiquidSelect nano+bare; el primero con
// clearable+clearLabel="LIBRE" replicando el <option value="">LIBRE</option>
// que tenía antes. **No se pudo verificar en vivo**: se confirmó por grep
// que este componente no tiene ningún caller que lo monte (el modal
// `aiSchedulerPreview` de UnifiedModal.jsx nunca se abre desde ningún botón
// de la UI actual — feature huérfana preexistente, fuera del alcance de
// este ítem arreglarlo). Verificado solo por lint+build+revisión de código.
// v2.16.8 — design(bloque5.2): contraste text-slate-300/400 sobre superficie
// clara — 1,698 → 216 instancias, las 216 restantes verificadas una por una
// como excepciones legítimas (íconos, placeholders, disabled, iconCls). 132
// archivos tocados. NO fue find/replace ciego (la advertencia del plan por
// 409 falsos positivos en la auditoría original): metodología validada
// primero a mano en el archivo más grande (TabMinMax.jsx, 122→17 instancias,
// revisadas 1 por 1 — incluye 15 labels de sección al tier correcto
// text-slate-600, un badge de clasificación ABC que rompía el patrón de sus
// hermanos, y un botón "Ocultar" que un heurístico ciego se hubiera saltado
// por un `disabled:pointer-events-none` no relacionado en la misma clase),
// después escalada a script (heurística: reconoce iconos Lucide en su propio
// tag, placeholders, estados disabled reales, y distingue "label" uppercase-
// tracking-widest → slate-600 vs "sub-texto" → slate-500 por el resto).
// Verificado el resultado del script contra el archivo hecho a mano (mismo
// resultado), y aislado el remanente de 216 con un segundo filtro (excluye
// placeholder + cualquier línea con un tag JSX en mayúscula) — dio solo 6
// líneas sospechosas, las 6 confirmadas como excepciones reales (2
// disabled:text-slate-400, 4 iconCls). Verificado en vivo con Playwright
// (desktop 1440px y mobile 390px, login + 7 rutas incl. Roles con datos
// reales) sin errores de página ni regresiones visuales. Build + lint +
// 15 tests unitarios verdes.

// v2.16.7 — perf(bloque4.3): product_stock_params fuera de supabase_realtime
// — concentraba 1,271,562 de ~1,274,010 writes acumulados (99.8%) entre las
// 11 tablas de la publicación, ~25% del CPU total de la DB en decode de WAL.
// Su única suscripción real en todo el proyecto era TabMinMax.jsx (canal
// bodega-params-watch, vista de Bodega) — reemplazada por polling cada 5s
// con el MISMO parche quirúrgico por fila que ya usaba el push (no hay
// full-reload: se compara `updated_at > cursor`, se traen solo las filas
// que cambiaron, y se mergean en el array existente sin tocar scroll ni
// ediciones en curso en otras filas). DROP TABLE de la publicación vía
// migración con lock_timeout.
// Verificado: escritura de prueba con OK explícito sobre un producto real
// de Bodega (erp_product_id=3959, manual_max null→99→null, revertido
// limpio) confirma que el mecanismo de escritura/lectura funciona
// correctamente end-to-end; el trigger real que alimenta Bodega
// (trg_bodega_draft_sync — suma MIN/MAX de todas las sucursales cuando
// cambia cualquiera, ver auditoría de esta sesión) también toca
// `updated_at`, así que el caso de uso más común (recalcular/publicar
// MIN-MAX de una sucursal) queda cubierto igual que con el push.
// 4.4 (refresh_product_sales_monthly_agg) quedó SIN cambios a propósito:
// medido en vivo, el caso típico corre en ~800ms (no los 9.68s que
// mostraba el promedio acumulado de pg_stat_statements, inflado por
// corridas viejas) — no había nada que arreglar con el rediseño
// originalmente propuesto.

// v2.16.6 — fix(bloque5.1): overflow móvil de DataTable/grids — causa raíz
// real encontrada, era un bug de layout compartido, no de `hideBelow`.
// `<main>` en AppLayout.jsx es un flex item (`flex-1`) sin `min-w-0` — por
// default CSS un flex item nunca se achica por debajo del ancho NATURAL de
// su contenido (min-width:auto), sin importar cuánto espacio le dé su
// contenedor. En desktop no se notaba porque `lg:overflow-hidden` +
// suficiente ancho de viewport lo tapaban. En móvil, `#root` corre con
// `overflow:visible` (el useEffect de arriba lo fuerza así para dar scroll
// nativo de página) — sin min-w-0, `main` se renderizaba a su ancho natural
// (628-668px medido) en vez de los 390px disponibles, y como NINGÚN
// contenedor entre `#root` y ese contenido establece un scroll container,
// lo que sobraba (238-278px) no quedaba oculto-pero-alcanzable: quedaba
// literalmente fuera del alcance, sin ningún scroll que lo revelara. Por
// eso "hideBelow no lo resolvía" — el problema nunca fue cuántas columnas
// mostraba la tabla, era que el layout entero alrededor ya se había roto
// antes de que la tabla hiciera nada. Fix: un `min-w-0` en `<main>`. Un
// componente compartido (usado en las 40+ rutas), una sola línea.
// Verificado con Playwright en viewport 390×844 (iPhone real): ANTES —
// en /pedidos los chips "Salud 1/3/5" (columna derecha de una grid-cols-2)
// medían x≈426px, fuera del viewport de 390px, sin scroll que los
// alcanzara; en /productos la card blanca se veía cortada a la derecha.
// DESPUÉS — mainScrollScrollWidth pasó de 628-668px a exactamente 390px en
// ambas rutas, los 6 chips de sucursal (La Popular + Salud 1-5) visibles y
// clickeables, la card de /productos llega al borde derecho del viewport
// sin corte. Sin regresión en desktop (1440px, capturas de /pedidos,
// /productos, /ventas — idénticas a antes, 0 errores de página). Build +
// lint + 15 tests unitarios verdes.



// v2.16.5 — fix(bloque2): limpieza de deuda de lint, parte 5 (CIERRE) —
// no-unused-vars 52/52 restantes, 0/186 total desde que arrancó el barrido.
// Todo problema de lint del proyecto queda en 0 (`npx eslint .` limpio).
// pedidos/: LlegadaModal (`totalCajas` redundante con `cajas.length` real),
// RecepcionModal (`navKey` — helper de nav por teclado abandonado, la nav
// real está inline 2 líneas más abajo; `handleTodoOk` preservado con
// eslint-disable, ver 7A.3), TabRutas (`fmtMin`/`fmtDate` sin caller).
// TabPedidos — el más grande (17 sitios): 2 funciones completas preservadas
// con eslint-disable + comentario (`handleCorregirBodega`/
// `handleConfirmarCorreccion`, gap 7A.1, backend listo sin botón), 1 prop
// preservada igual (`llegadaEmp`/`llegadaTipo` en ReceptionActions — falta
// un bloque "Confirmado" como el que sí tiene erpOk, pero es tarjeta nueva
// no una línea, no se improvisa en flujo de pedidos), 1 bug real corregido
// (`isApoyoBodega` calculado pero nunca usado — el botón "Apoyo" no se
// ocultaba para quien ya había dado apoyo; server-side ya dedupaba por id
// así que no era pérdida de datos, pero sí podía confundir; ahora
// `canApoyo && !isApoyoBodega`), resto código muerto real (`fmtDate`,
// `uniqueActiveRutas`/`pedidoStages`/`isDone` superseded por lógica inline
// ya existente, `navKey` duplicado, `cajaKey`/`row` props sin uso interno).
// productos/: TabCatalogo (`cellBg`/`trackCls`/`sectionLabel` muertos,
// `branches` prop sin uso en 2 componentes incluido uno con "Aurora" en el
// nombre — sigue con caller activo pese al memo de "no Aurora", ese memo
// es sobre el theme CSS eliminado, no sobre este componente puntual).
// TabMinMax — el más grande de productos (18 sitios): 3 hallazgos reales
// preservados con eslint-disable (no borrados): `hideFiltered` (acción
// bulk completa con audit log MINMAX_HIDE_FILTERED, sin botón — acción
// masiva real, necesita decisión de producto + posible modal de
// confirmación antes de exponerla); `dispMin`/`dispMax`/`hasPres`/
// `applyRule` en la celda "Despacho" (calculan el MIN/MAX ya redondeado
// por la regla de despacho pero el JSX solo muestra el nombre de la regla,
// nunca el resultado numérico — área con historial de bugs de redondeo,
// no se inventa el formato). Resto código muerto real: `fadeUp`,
// `relativeTime` (confirma el gap ya documentado en 1.7 — de verdad sin
// caller), `getBreakdown` (superseded por `formatDominant`), estado
// `error`/`publishResult` que solo se reseteaba a null y nunca se leía
// (4 sitios), `handleEditSave`/`lastCalcAt`/`lastDraftCalcAt`/
// `criticalAOut`/`criticalABelow`/`hasActiveData` sin consumidor real.
// promociones/ + schedule-tabs/: catch(e)→catch{}, props sin uso interno
// (`allBranches`, `onRefresh`, `newId`), `tokenMatch` normaliza solo
// (mismo patrón que ya apareció en EmployeeDetailView/TabExpediente parte 4).
// 2 bugs reales de paso corregidos en EmployeeAnnouncementsView.jsx (commit
// anterior) — este batch no tocó archivos de empleado.
// Verificado en vivo (vite preview + Playwright): login, Ventas,
// Facturación, Pedidos (Generar + sucursales), Productos (Catálogo +
// Gestión de Stock) — 0 errores de página/consola de React en las 5 rutas
// más tocadas. Build + 15 tests unitarios verdes.

// v2.16.4 — fix(bloque2): limpieza de deuda de lint, parte 4 — no-unused-vars
// 50/102 revisados uno por uno (no barrido ciego). Categorías: (a) código
// muerto real (funciones/estado/props nunca leídos — ~30 sitios, incl. una
// `fetchSrs` completa abandonada en SrsBuscadorWidget.jsx, superseded por
// `srsFetch`); (b) `catch (e)`/`catch (_)` → `catch {}` donde el error nunca
// se usaba (~10 sitios); (c) parámetros de función sin caller real que los
// use (`startIdleWatcher(u)` en AuthContext.jsx lee `userRef.current` en vez
// del arg; `preApprovePlan(headerId, year)`, `buildFooterCallback(_meta)`,
// `updatePayrollPeriodStatus(..., _meta)`).
// 2 hallazgos reales corregidos de paso (no cosméticos):
// - FacturacionView.jsx: las 2 secciones de "pagos pendientes por tipo"
//   (inmediatos + crédito) calculaban `tipoTotalPages`/`tipoPg` para paginar
//   pero el <DataTable> nunca tenía `footer={<Pagination .../>}` — con
//   PAGE_SIZE=10, cualquier tipo de pago con >10 transacciones pendientes
//   quedaba con las filas extra invisibles y sin forma de navegarlas
//   (truncado silencioso, mismo patrón que CLAUDE.md ya documenta para
//   PostgREST). Cerrado replicando el `footer={<Pagination .../>}` que ya
//   usa la sección "confirmados" del mismo archivo. De paso, `expandedId`
//   (state completamente huérfano, solo se reseteaba a null, nunca se leía
//   ni se setteaba a otro valor — vestigio de antes de que existiera
//   `solvingId`) también eliminado.
// - VentasView.jsx: `isVendSearchFuzzy` (resultado de smartFilter en la
//   pestaña Vendedores) se calculaba pero nunca se mostraba el banner
//   "resultados similares" — sí existe para la pestaña Productos
//   (`isProdFuzzy`, línea ~1845). Agregado el mismo banner a Vendedores.
// Encontrados pero NO tocados (fuera de alcance, no son solo lint): en
// TabPedidos.jsx, `handleCorregirBodega`/`handleConfirmarCorreccion`
// (backend listo sin botón en UI, ver 7A.1) y en RecepcionModal.jsx,
// `handleTodoOk` (posible botón faltante, ver 7A.3) — se prefijarán/
// documentarán en la parte 5, NO se borran: son gaps de feature conocidos,
// no dead code.
// Build + 15 tests unitarios verdes. Quedan 52 no-unused-vars, todos en
// pedidos/productos/promociones/schedule-tabs.

// v2.16.3 — fix(bloque2): limpieza de deuda de lint, parte 3 —
// react-refresh/only-export-components (8/8) y
// react-hooks/preserve-manual-memoization (7/7) CERRADOS. Los primeros son
// archivos que mezclan un export de componente con un export de
// hook/constante/helper (patrón establecido del proyecto: useAuth/useTheme
// junto a su Provider, EL_SALVADOR_GEO/clampInt/formatPhoneMask/safeParse
// junto a LazyInput) — separar el hook a otro archivo tocaría decenas de
// imports por una mejora de solo Fast Refresh en dev, no vale la pena.
// Los segundos son casos donde el React Compiler no puede re-verificar una
// memoización manual ya correcta (closures con setTimeout anidados,
// deps con encadenamiento opcional) — memoización manual sigue funcionando
// igual, es limitación del compiler, no bug. Nota: en
// EmployeeAnnouncementsView.jsx el eslint-disable-next-line inicial no
// suprimía el error real (ESLint ancla el diagnóstico al inicio del nodo
// useCallback, no a la línea de deps) — corregido con bloque
// eslint-disable/eslint-enable en vez de disable-next-line.
// De paso, 2 fixes reales de deps (EmployeeProfileView.jsx: emp?.weeklySchedule/
// emp?.birth_date → emp completo; EmployeeRequestsView.jsx: user?.id → user)
// evitan que el memo/callback quede con un valor stale si la referencia del
// objeto cambia pero el campo opcional leído no. Build+tests limpios.
// Quedan 102: no-unused-vars (único rule restante).

// v2.16.2 — fix(bloque2): limpieza de deuda de lint, parte 2 — no-empty
// CERRADO (36/36). Todos eran `catch {}` legítimos alrededor de
// localStorage/JSON.parse (puede tirar en modo privado, cuota excedida,
// o JSON corrupto) o de limpiezas best-effort (cámara del scanner,
// notificación del navegador, audit log de un ErrorBoundary) — ninguno
// era un bug real. Fix: comentario explicando el motivo dentro de cada
// bloque (ESLint no marca `no-empty` si el bloque tiene un comentario,
// es el mecanismo estándar de la regla para "vacío a propósito").
// DashboardView.jsx concentraba 21 de los 36 — mismo patrón exacto
// repetido, un solo find/replace.
// CI: agregado VITE_SUPABASE_URL/ANON_KEY dummy al job de Vitest — un
// test importa pedidoPrint.js, que arrastra supabaseClient.js
// (createClient() a nivel de módulo) aunque el test nunca llame a
// Supabase; sin esos env vars el job fallaba en GitHub Actions (no
// hay .env ahí). Verificado en vivo con el mismo valor dummy localmente.
// Build+tests limpios. Quedan 117: no-unused-vars (102),
// react-refresh/only-export-components (8), preserve-manual-memoization (7).

// v2.16.1 — fix(bloque2): limpieza de deuda de lint para poder hacer CI
// bloqueante (respuesta a "¿y si los corregimos?" en vez de solo marcar
// el paso de lint como no-bloqueante). 33/186 cerrados en esta tanda:
// no-undef (5, api/oss-proxy.js y public/sw.js corrían con globals de
// browser en vez de Node/ServiceWorker — fix de config, no de código);
// 19 "unused eslint-disable directive" (comentarios de supresión que ya
// no suprimían nada, confirmado por el propio ESLint antes de borrarlos —
// varios eran míos de sesiones anteriores de Bloque 1.6, vueltos
// innecesarios por fixes posteriores en cascada); no-useless-escape (4,
// regex con \- y \/ innecesarios dentro de character classes);
// no-case-declarations (1, case sin bloque); no-irregular-whitespace (2,
// un BOM y una NBSP literales embebidos como bytes crudos en vez de
// \uXXXX — SrsBuscadorWidget.jsx ya usaba el patrón correcto,
// WidgetSrsInventory.jsx no); no-control-regex (2, genuinamente
// intencional — limpia basura binaria/PUA de lectores de código de
// barras — suprimido con justificación, no removido).
// Build limpio. Quedan 153: no-unused-vars (102), no-empty (36),
// react-refresh/only-export-components (8), preserve-manual-memoization (7).

// v2.16.0 — feat(bloque2): fundación de testing — Vitest + Playwright + CI.
// Vitest instalado (+ @testing-library/react/jest-dom, jsdom); 15 tests
// unitarios de regresión sobre lógica pura que YA rompió en producción:
// `applyPresRule` (regla del 40% para convertir unidades a presentaciones,
// extraída de TabMinMax.jsx a `src/utils/presentacion.js` para poder
// testearla sin importar la vista completa) y `toDispatch`/
// `lotesToDispatch`/`lotesAsignadosToDispatch` (conversión ERP↔dispatch
// factor en pedidoPrint.js, exportadas). **Nota importante de alcance**:
// los otros 2 ítems que pedía el plan — "dispatch rounding 40%" (la
// decisión de redondeo real de get_pedido_preview) e "inv_dedup" — viven
// 100% en SQL/plpgsql (supabase/migrations/*.sql), no en JS. Vitest no
// puede testearlos directamente; escribir un "espejo" en JS de esa lógica
// sería test theater (probaría una copia, no el código real desplegado).
// Quedan documentados como gap conocido — cobertura real requeriría pgTAP
// u otro framework de testing SQL, fuera del alcance de "instalar Vitest".
// Playwright instalado como devDependency del proyecto (antes solo se usaba
// ad-hoc en el scratchpad de sesión) + `tests/e2e/smoke.spec.js`: login
// usuario/contraseña, login por carné (lector físico simulado vía
// keydown), Dashboard, Pedidos, y el modal de Editar Empleado (guardia
// contra la race condition de campos sensibles — ver
// project_sensitive_fields_boot_race). Credenciales SIEMPRE por env vars
// (E2E_USER/E2E_PASSWORD/E2E_CARNE_CODE), nunca hardcodeadas; tests sin
// esas env vars se saltan solos. CI (.github/workflows/ci.yml): lint+vitest
// en cada PR/push a main sin secrets; el job de Playwright smoke necesita
// secrets de GitHub (E2E_USER/E2E_PASSWORD — cuenta de prueba dedicada, NO
// credenciales reales de producción, por decisión explícita del usuario) —
// pendiente de configurar esos secrets y crear la cuenta QA antes de que
// ese job pase en CI. Build/lint/tests verificados en verde localmente
// (186 problemas de lint, mismo baseline que antes de este cambio — 0
// nuevos).

// v2.15.27 — fix(bloque1/1.6, parte 10 — CIERRE): exhaustive-deps, últimos
// 17/89 → **1.6 completo: 0/173 ocurrencias reales de lint restantes**
// (react-hooks/exhaustive-deps + set-state-in-effect + purity +
// static-components + immutability + refs, las 6 categorías de "riesgo
// real" que catalogó la auditoría, de 379 problemas de lint totales a 186 —
// el resto son cosméticos: no-unused-vars 102, no-empty 36, etc., fuera del
// alcance de 1.6).
// TabExpenses/TabHistory/TabStaff/TabMinMax: mismos patrones ya vistos
// (fallback inestable, función sin useCallback, constante redeclarada por
// render). EmployeeAnnouncementsView: readCheck (dependía solo de user.id)
// envuelto en useCallback, reutilizado en 2 memos. EmployeeHomeView/
// EmployeeScheduleView: agregado `weekStart` junto a weekStartISO (mismo
// origen, cambian juntos). ConteoDetailView: 4 campos del item (contado_at/
// contado_por_nombre/estado_item/nota) agregados — sin ellos, un update
// concurrente de metadata del item no refrescaba el editor local (bug real
// de prop-sync, no solo cosmético). CrearRutaModal/FinalizarCajasModal:
// deps de modal reset-on-open agregadas. RecepcionModal/TabPedidos (x2):
// deps primitivas agregadas. TabPedidos — un `// eslint-disable-line
// (loadActiveRutas es estable [])` preexistente estaba mal formado (el
// paréntesis se interpretaba como nombre de regla inválido, no suprimía
// nada) — corregido a `eslint-disable-next-line react-hooks/exhaustive-deps`
// con justificación real: fetchItems/loadActiveRutas son forward-references
// (declaradas más abajo en el archivo de 3900+ líneas) cuyas propias deps
// casi nunca cambian en la vida del componente — mover su declaración queda
// fuera de alcance de este barrido. TabShifts: currentForm.end agregado
// (auto-corrector, el propio efecto lo setea).
// Build limpio. Verificación visual adicional en VentasView (parte 9) ya
// cubrió el patrón de refs más riesgoso de esta serie.

// v2.15.26 — fix(bloque1/1.6, parte 9): exhaustive-deps, siguientes 9/89
// (RolesView, SchedulesView, VacationPlanView completo, VentasView
// completo). RolesView: getRoleDepth no estaba en useCallback — envuelto
// con su dep real (roles), reutilizado por los 2 memos que lo llamaban.
// SchedulesView/VacationPlanView: deps de store (fetchBoot,
// fetchVacationHeaders/Plans/ChangeRequests) + `year` agregadas — todas
// acciones estables o primitivos, sin riesgo de bucle.
// VentasView (los 3 restantes, cierra la vista): `fetchRows` leía
// itemsCache/pricesCache/changelogCache directo del estado para decidir
// qué prefetchear — agregarlos a deps habría hecho que fetchRows cambiara
// de identidad cada vez que el propio prefetch de precios/items/changelog
// completa, dueño de un re-fetch en cascada de TODA la tabla (stats+rows)
// cada vez que llega un precio o un changelog de fondo. Se agregaron 3 refs
// "siempre frescas" (itemsCacheRef/pricesCacheRef/changelogCacheRef,
// mismo patrón useEffect-mirror ya usado en el archivo) y fetchRows ahora
// lee de los refs en vez del estado — cero cambio de comportamiento,
// verificado en vivo (login + expandir una fila real en /ventas, ítems y
// precios cargan igual). SPECIAL_CODES (objeto inline redeclarado cada
// render) movido a constante de módulo; allowedDrillTiers (ya memoizado)
// solo le faltaba estar en el array de deps de otro callback.
// Build limpio. Quedan 17 exhaustive-deps.

// v2.15.25 — fix(bloque1/1.6, parte 8): exhaustive-deps, siguientes 8/89
// (FacturacionView, PayrollView, RequestsView). FacturacionView: 2 efectos
// de auto-expandir sección al buscar ganaron sus deps reales (resolved/
// resolvedMatchesTerm/resolvedThisMonth); CONFIRMED_SORT_ACCESSORS (objeto
// con funciones que cerraban sobre `getBranch`, inestable) memoizado con
// useMemo([branches]) e inlineado el lookup de sucursal directo (ya no
// depende de `getBranch`); `useSortable()` — su `sortFn`/`toggle` no
// estaban en useCallback, causa raíz de por qué CONFIRMED_SORT_ACCESSORS
// no se podía estabilizar — ahora ambos son estables por (sortKey, sortDir).
// PayrollView: agregadas fetchPayrollPeriods/activePeriod/fetchPayrollEntries
// (acciones de store, estables).
// **RequestsView — el hallazgo "más preocupante" que marcó la auditoría**:
// 2 efectos de carga de solicitudes pendientes de aprobación corrían UNA
// SOLA VEZ al montar (`[]`), sin reaccionar a `canApprove`/`user`/`getScope`
// — si esos valores no estaban listos en el primer render (carga async de
// permisos), el aprobador podía ver una lista de solicitudes con el scope
// incorrecto (todas en vez de solo las de su sucursal, o viceversa) hasta
// el próximo evento `requests-updated`. Corregido: ambos efectos ahora
// reaccionan a canApprove/user.id/user.branchId/getScope/fetchRequests.
// El efecto de deep-link (prefillEmployeeId) también ganó sus deps reales
// — es auto-corrector (el propio navigate() limpia el state que dispara
// la guarda, no hay riesgo de bucle).
// Build limpio. Quedan 26 exhaustive-deps.

// v2.15.24 — fix(bloque1/1.6, parte 7): exhaustive-deps, siguientes 11/89
// (AttendanceMonitorView, AuditView, BranchDetailView, DashboardView,
// EmployeeDetailView, EncuestaAdminView). AttendanceMonitorView:
// evaluateEmployeeStatus no estaba en useCallback — envuelto con sus 3 deps
// reales (todas ya trackeadas por el memo que lo llama, cero riesgo);
// destapó 3 deps ahora redundantes (currentTime/shifts/todayStr) que se
// quitaron del memo externo. AuditView: mismo fallback `|| []` inestable de
// siempre. BranchDetailView: `history.length` se lee solo para decidir si
// mostrar el spinner (skip en refresh) — incluirlo dispararía un refetch en
// bucle sobre sí mismo — suprimido con justificación explícita, no se
// agrega (único caso de esta tanda donde agregar la dep SÍ es peligroso).
// DashboardView: `activeSizes` con el mismo patrón de fallback inestable
// (constante de módulo) que alimentaba el par ref-mirror ya sospechoso de
// la parte 5; agregadas getScope/userBranchStr (guard existente ya evita
// efectos secundarios). EmployeeDetailView: loadEmpRequests/emp agregados
// (funciones/objetos ya estables o ya trackeados indirectamente).
// EncuestaAdminView: `respondedIds` (un `new Set()` inline, recalculado
// cada render) memoizado con useMemo sobre `respuestas` — mismo patrón que
// las constantes EMPTY_OBJ/EMPTY_ARRAY pero para un valor derivado en vez
// de un literal fijo.
// Build limpio. Quedan 34 exhaustive-deps.

// v2.15.23 — fix(bloque1/1.6, parte 6): exhaustive-deps, siguientes 12/89
// (AnnouncementsView + AttendanceAuditView completo, 9 de sus 9 sitios).
// AnnouncementsView.jsx: fallback `|| []` inestable (constante de módulo);
// handleCancelEdit se declaraba DESPUÉS del efecto de keydown que lo usaba
// (funcionaba en runtime por closure/hoisting de la ejecución del render,
// pero no se podía agregar a deps sin ReferenceError) — reordenado antes
// del efecto, cero cambio de comportamiento.
// AttendanceAuditView.jsx (view completa cerrada): `now = new Date()` sin
// memoizar en DayCard/EmployeeAuditRow anulaba la memoización real de 2
// useMemo pesados (recorren todos los punches/quincenas) — cambiado a
// `useMemo(() => new Date(), [])` (estable por instancia de card, no
// necesita tick en vivo como los badges de v2.15.17/18); employees/branches/
// shifts con el mismo patrón de fallback inestable ya visto (constante de
// módulo); agregadas 2 deps reales (loadAttendanceLastDays, showToast — ya
// en uso, solo faltaban en el array).
// Build limpio. Verificación visual: login + nav + Ventas (BranchChips) en
// vite preview con Playwright, sin errores de consola atribuibles a estos
// cambios (solo warnings COEP preexistentes del modo preview).
// Quedan 45 exhaustive-deps.

// v2.15.22 — fix(bloque1/1.6, parte 5): exhaustive-deps, siguientes 16/89
// (BranchChips, AppLayout — shell de navegación; useKioskDevice,
// useTimeClockEngine). BranchChips.jsx: recomputeVisibility/recomputeIndicator
// no estaban en useCallback (identidad nueva cada render) — envueltos con
// sus deps reales; `visibleKeys.join(",")`/`hiddenKeys.join(",")` inline en
// el array de deps (el linter no puede analizar una expresión ahí) —
// extraídos a variables `visibleKeysStr`/`hiddenKeysStr`. AppLayout.jsx:
// mismo patrón para recomputePill (posición del indicador/"pill" del menú
// activo) — envuelto en useCallback con sus 5 deps reales (activeId,
// activePath, visibleGroups, isExpanded, openGroups); el efecto de montaje
// único que registra el ResizeObserver + listener de resize capturaba una
// clausura vieja de recomputePill (bug real de stale closure, no solo
// cosmético de lint) — ahora se re-suscribe cuando cambian sus deps.
// useKioskDevice.js/useTimeClockEngine.js: mismos fallbacks `|| []`
// inestables ya vistos en la parte 4, resueltos con constantes de módulo;
// useTimeClockEngine también: agregado `showToast` (ya estaba en uso, solo
// faltaba en deps) y `registerAttendance`/`earlyPendingData?.actualTime`/
// `earlyPendingData?.earlyMins` en handleScan — de paso apareció (mismo
// fenómeno que en sesiones previas: un fix destapa el siguiente) una dep
// `closeFeedback` realmente no usada en ese callback — removida.
// Build limpio. Quedan 57 exhaustive-deps.
// ⚠️ Pendiente: verificación visual de AppLayout (nav pill) y BranchChips —
// son componentes compartidos de alto tráfico, no se pudo probar en browser
// en esta sesión todavía.

// v2.15.21 — fix(bloque1/1.6, parte 4): react-hooks/exhaustive-deps, primeros
// 16/89 cerrados (2 categorías de bajo riesgo primero):
// (a) "unnecessary dependency" — AnnouncementsView.jsx/EncuestaView.jsx:
// quitado `employees`/`invertedIndices` de un useMemo que no los usa
// (limpieza directa, cero riesgo).
// (b) "logical expression podría cambiar cada render" — fallback `|| []`/`|| {}`
// evaluado directo en el cuerpo del render y usado como dep de useMemo/
// useCallback aguas abajo: crea una referencia nueva cada render mientras el
// valor real es null/undefined, rompiendo la memoización real (no es un bug
// de comportamiento, es un problema de performance/exhaustive-deps).
// Arreglado con constantes de módulo estables (`EMPTY_OBJ`/`EMPTY_EMPLOYEES`/
// etc.) en FormBranchEmployees, FormSucursal (4 sitios), FormPlanificador
// (2 sitios), FormEditPayrollEntry (colateral, ver abajo).
// Además: EmployeeFormModal — CATALOG_CATEGORIES movida a constante de
// módulo (vivía redeclarada dentro del componente); FormAiSchedulerPreview —
// agregado `otherBranchEmployees` (mismo memo deps que branchEmployees, ya
// en el array); FormEditPayrollEntry — agregado `entry.days_worked`
// (primitivo, sin riesgo); FormLeadership — agregado `formData.selectedEmpId`;
// FormNovedad — agregados `formData?.disabilityDays`/`formData.endDate`
// (mismo patrón self-healing ya usado en EmployeeFormModal para kiosk_pin,
// verificado que el guard existente evita bucle); FormTurnos —
// handleArchiveShift/handleRestoreShift no estaban en useCallback (identidad
// nueva cada render) — envueltos en useCallback([fetchShifts, showToast])
// para poder incluirlos en el dep array de TurnoCard sin romper su memo.
// Colateral: arreglar FormEditPayrollEntry.jsx:102 destapó un segundo
// missing-dep en la misma función (`emp`/`entry` con el mismo problema de
// fallback inline) — cerrado de paso con la misma constante EMPTY_OBJ.
// Build limpio. Quedan 73 exhaustive-deps.

// v2.15.20 — fix(bloque1/1.6, parte 3): react-hooks/set-state-in-effect
// CERRADO — las 34 ocurrencias restantes (66/66 en total con la parte 2).
// Mismo criterio caso por caso: cada efecto revisado, clasificado y
// suprimido con eslint-disable-line + justificación específica del patrón
// real (fetch-on-mount, reset de estado derivado al cambiar filtro/prop/id,
// o medición de DOM). Archivos: MinMaxView, PayrollView, PermissionsView,
// RequestsView, StaffManagementView, VentasView (5 más), dashboard/
// WidgetAnnulmentRequest, dashboard/WidgetMinMaxRequest, employee/
// EmployeeDocumentsView, employee/EmployeeHomeView, employee/
// EmployeeRequestsView (2), inventario/ConteoDetailView, pedidos/
// FinalizarCajasModal, pedidos/LlegadaModal, pedidos/TabEnCurso, pedidos/
// TabPedidos, pedidos/TabReglas, pedidos/TabRutas, productos/TabCatalogo,
// productos/TabLaboratorios (2), productos/TabMinMax, promociones/
// TabBonificaciones, promociones/TabHistorial, promociones/TabPromos,
// schedule-tabs/InlineDayEditor (2). Build limpio. Sin cambios de
// comportamiento en ninguno de los 66. Sigue exhaustive-deps (89), última
// categoría de 1.6.

// v2.15.19 — fix(bloque1/1.6, parte 2): react-hooks/set-state-in-effect,
// primera mitad (32 de 66 cerradas, 34 restantes). Todas resueltas con
// `eslint-disable-line` + justificación puntual (mismo patrón ya establecido
// en TabPoliticaVencimiento.jsx) — cada una revisada individualmente y
// confirmada como uno de los 3 patrones idiomáticos/seguros: (a) fetch-on-mount
// (`useEffect(()=>{load();},[load])`), (b) reset de paginación/estado derivado
// al cambiar filtros, o (c) medición real de DOM en useLayoutEffect
// (BranchChips, BranchDetailView). Sin cambios de comportamiento en ninguno —
// ver mensajes inline por archivo para la justificación específica. Archivos:
// BranchChips, ConfirmModal, LiquidDatePicker, LiquidSelect, LiquidWeekPicker,
// PeriodPicker, TimePicker12, BranchHelpers, FormAddCustomDocument, AppLayout,
// usePushSubscription, AccessDeniedView, NoAccessView, AttendanceMonitorView,
// AuditView, BranchDetailView, ComprasView, EncuestaAdminView, FacturacionView
// (las 8 de este archivo). Build limpio. Continúa con el resto de
// set-state-in-effect (34) + exhaustive-deps (89) en la siguiente parte.

// v2.15.18 — fix(bloque1/1.6, parte 1): purity (6), static-components (5),
// immutability (4), refs (2) — 17 de 173 ocurrencias reales de lint cerradas.
// purity: NotificationBell.jsx (Date.now() en función solo invocada desde
// onClick, falso positivo del compiler — eslint-disable justificado),
// SidebarSyncStatus.jsx/SyncHealthBanner.jsx/FormNovedad.jsx/VentasView.jsx
// (2 sitios) — Date.now()/new Date() en render reemplazado por useNowTick(),
// mismo hook de v2.15.17. static-components: EmployeeDocumentsList.jsx
// (Icon = docIcon() selecciona entre 4 íconos ya importados, no crea uno
// nuevo — eslint-disable justificado); TabCatalogo.jsx — CompatTh (4 sitios)
// vivía dentro de CompatView/CompatSideDrawer/CompatExpandedPanel, un bloque
// de ~550 líneas 100% muerto (sin ningún caller, confirmado con grep) desde
// el rediseño Devolutivo/ND — eliminado completo, no solo suprimido el lint.
// immutability: DashboardView.jsx — setBouncingIds usado antes de declararse
// (reordenado, cero cambio de comportamiento) + widgetLayoutRef/
// widgetSizesRef con eslint-disable justificado (mismo patrón exacto que
// mobileLayoutRef/activeLayoutRef que NO disparan la regla — inconsistencia
// del compiler, no bug real); VacationPlanView.jsx — "showHeader" de grupo
// por sucursal usaba una variable mutable dentro de un .map(), lo cual SÍ es
// un riesgo real bajo memoización por-fila del compiler (una fila cacheada
// se saltaría la mutación) — reescrito sin mutación: showHeader se computa
// contra el elemento anterior por índice (el array ya viene ordenado por
// sucursal). refs: EmployeeAnnouncementsView.jsx — pendingReadsRef/onReadRef
// se asignaban directo en el cuerpo del render — movido a useEffect (patrón
// estándar "ref siempre actualizado").
// set-state-in-effect: 2 ocurrencias en SidebarSyncStatus/SyncHealthBanner
// (fetchLatest() al montar) quedaron ocultas detrás del error de purity del
// compiler hasta arreglar ese — cerradas de paso con el mismo patrón
// eslint-disable + justificación ya usado en TabPoliticaVencimiento.jsx.
// Build limpio (vite build). Quedan 155 ocurrencias reales (set-state-in-effect
// 66 + exhaustive-deps 89) — continúa en la siguiente parte de 1.6.

// v2.15.17 — fix(bloque1): 1.3, 1.4, 1.5, 1.7 (edge functions + TabMinMax/TabSinVenta).
// 1.3: consolidate-timesheets ya no ignora el error del upsert de timesheets
// (log + contador `failed` en la respuesta); sync-promo-sales ya no ignora el
// error del SELECT de promotion_sales_cache ni de los 2 UPDATE de auto-cierre
// (estado='closed') — antes autoClosed++ se incrementaba aunque el UPDATE
// fallara. 1.4: sync-promo-sales calculaba el factor de presentación con un
// regex sobre el texto libre `presentacion` (viola CLAUDE.md §Factor de
// Presentación) — reemplazado por lookup real contra product_precios.factor,
// mismo patrón `pres_factors` de get_stock_analysis (MAX(factor) agrupado por
// product_id + UPPER(descripcion)), precargado una sola vez para todos los
// promotion_products antes del loop. 1.5: `saveHiddenTimer` en TabMinMax.jsx —
// ref muerta, nunca asignada ni leída (comentario decía "kept for cleanup
// safety" pero no había nada que limpiar) — eliminada. 1.7: `daysLeft` en
// ExpandedPanel (TabMinMax) y `days`/`d` en UltimaVentaCell (TabSinVenta) se
// calculaban con Date.now()/new Date() directo en el render — si el
// componente no volvía a renderizar por otra razón, el badge de "días
// restantes"/"hace Xd" quedaba congelado en el valor de cuando se montó.
// Nuevo hook compartido `useNowTick` (src/hooks/useNowTick.js, tick cada 60s)
// reemplaza esos 3 usos para que el badge se mantenga correcto con el tiempo.
// Build limpio (vite build).

// v2.15.16 — fix(bloque1/1.2): cierra el resto del inventario de 35 sitios —
// los 16 archivos restantes además de requestsSlice.js/payrollSlice.js (v2.15.15):
// pedidoPrint.js, SidebarSyncStatus.jsx, NuevoConteoModal.jsx, EncuestaAdminView.jsx,
// FacturacionView.jsx (7 más), VentasPperdidasView.jsx, MinMaxView.jsx,
// SyncHealthBanner.jsx, VentasView.jsx (5 más), CotizacionesView.jsx (8),
// RecepcionModal.jsx (4), TabPedidos.jsx (16), PromoModal.jsx, EmployeeDetailView.jsx,
// TabCatalogo.jsx (5), ConteoDetailView.jsx (4). ~70 sitios en total. Mismo criterio
// que v2.15.15: donde ya hay try/catch con manejo real, error real → throw (se
// propaga al catch existente en vez de seguir con data vacía en silencio); donde
// no hay manejo de errores previsto (varios reads de UI/prefetch), se agrega
// console.error con contexto sin cambiar el control de flujo. 2 bugs de UX
// reales corregidos de paso en FacturacionView.jsx (handleSolve/handleConfirm):
// si el insert de resolución/confirmación fallaba, la UI igual marcaba la
// factura como resuelta/confirmada — ahora aborta y loguea si el insert falla.
// Build limpio, 0 lint nuevo (119 preexistentes antes y después, verificado
// contra HEAD con git stash).

// v2.15.15 — fix(bloque1/1.2): requestsSlice.js (22 sitios) y payrollSlice.js
// (4 sitios) — const { data } = await supabase sin chequear error. En
// requestsSlice (resolución de aprobador/roster/cobertura) se agrega
// console.error con contexto sin cambiar el fallback existente (preserva la
// resiliencia de la cadena de aprobadores, pero ahora una falla real queda
// visible en logs en vez de indistinguible de "sin resultados"). En
// payrollSlice, generatePayrollEntries ahora aborta (throw) si fallan
// timesheets/anticipos/planes de vacaciones — antes generaba nómina con esos
// datos faltantes en silencio (días trabajados, deducciones de anticipo o
// bono de vacaciones incorrectos sin ningún aviso); fetchOvertimeBankBalance
// ahora loguea el error en vez de devolver 0 indistinguible de "sin horas".

// v2.15.14 — fix(bloque1/1.1): 3 selects sobre tablas grandes sin paginar
// (cap silencioso de 1000 filas de PostgREST) — reemplazados por
// fetchAllRows: FacturacionView.jsx dos loadData (backlog de facturas
// estado nulo/NULA, backlog pendientes de Hacienda recibido_mh IS NULL);
// WidgetInventorySearch.jsx (mapa de fotos de productos, se re-fetch en
// cada búsqueda). VentasView.jsx:503 (4to ítem del audit) resultó ya
// corregido por trabajo previo no relacionado (fetchStats usa fetchAllRows
// desde v2.9.15; fetchRows ya tenía .range()/.limit(200)) — falso positivo
// hoy, sin cambios.

// v2.15.13 — perf(sync): Bloque 4.1/4.2 del plan de ejecución. Índice
// CONCURRENTLY idx_inventory_sync_log_venc_synced (is_vencidos, synced_at
// DESC) en prod — la tabla (468K filas) estaba en 100% sequential scan,
// 10.8B tuplas leídas acumuladas, por el polling de SyncHealthBanner cada
// 90s. Además se quitó la suscripción postgres_changes de
// SyncHealthBanner.jsx a inventory_sync_log: esa tabla nunca estuvo en la
// publicación supabase_realtime, así que la suscripción no disparaba nunca
// — código muerto que aparentaba funcionar, el polling de 90s ya cubría el
// refresh real.

// v2.15.12 — docs(search): PLAN-BUSCADORES-NORMALIZACION.md — plan completo
// (no aplicado) para normalización total de búsqueda: norm_search() en
// Postgres (unaccent + strip puntuación, espejo de searchUtils.normSearch),
// índices GIN trigram sobre expresión norm, match por tokens en RPCs con
// p_search (LIKE ALL — "alcohol 90" debe matchear "ALCOHOL-90"), columnas
// generadas *_norm en products para los .ilike() directos, y migración de
// las 6 vistas client-side que siguen con búsqueda naive. Hallazgo: hoy la
// normalización es unilateral (frontend manda normSearch(q) pero el SQL
// compara contra columna cruda) — S.S.N/ALCOHOL-90/tildes no se encuentran
// server-side.

// v2.15.11 — fix(security): 0B.8 — kiosk_devices.kiosk_verify permitía SELECT
// anon+true (cualquiera sin sesión leía toda la tabla). Nueva RPC SECURITY
// DEFINER verify_kiosk_device(device_id, device_token) valida server-side;
// branchSlice.validateKioskToken ahora la usa en vez de un SELECT directo.
// Policy kiosk_verify dropeada. Probado primero en staging (branch
// ewcmerxqjvludtgskuin) con datos sintéticos, luego aplicado a prod y
// verificado contra un kiosk_devices real existente.

// v2.15.10 — docs(audit): staging branch verificado 100% en verde (99
// tablas/9 vistas/112 funciones/11 triggers/99 RLS/208 policies/346
// constraints, todo coincide contra producción) sin ningún write a prod.
// Se había intentado registrar el baseline en supabase_migrations.
// schema_migrations de prod (aprobado como "una fila liviana de metadata,
// cero DDL"), pero la ejecución real requería appendear ~9,800 líneas de
// DDL en esa fila para que sirviera su propósito — excedía lo aprobado.
// El clasificador de permisos lo bloqueó dos veces correctamente; se
// verificó por lectura que ningún objeto de esquema fue tocado (solo la
// fila de bookkeeping, 2/19 chunks) y se revirtió con un DELETE, dejando
// producción exactamente como estaba. La cirugía del registro de prod
// queda diferida indefinidamente — no es necesaria para tener staging
// utilizable. Nueva regla: cualquier write a prod requiere OK directo y
// específico del usuario para esa operación exacta, nunca heredado de una
// aprobación previa más amplia. Detalle completo en AUDITORIA-2026-07.md.

// v2.15.9 — chore: 4 quick wins de la Fase 6 de la auditoría integral
// (AUDITORIA-2026-07.md), cero riesgo, no tocan rutas calientes ni
// dependen del entorno de staging pendiente. (1) eslint.config.js:
// globalIgnores agrega dist/android/ios/.agents — baja el ruido de lint
// de 2,746 a 379 problemas reales, sin cambiar ninguna regla. (2)
// ModalShell.jsx: nuevo prop opcional ariaLabel (default "Ventana modal")
// aplicado como aria-label en el div role="dialog" — el componente es un
// compound component que no controla el título de sus children, así que
// aria-labelledby real requeriría tocar cada caller; esto cierra el gap
// real ("las pantallas de lectura no anunciaban nada") sin ese refactor.
// LiquidSelect.jsx: aria-haspopup="listbox" + aria-expanded={isOpen} en
// el div trigger principal (ambos gaps ya documentados en DESIGN.md §25).
// (3) Eliminado src/components/SalyChatOverlay.jsx — confirmado con grep
// que no tenía ningún import/uso fuera de su propio archivo (código
// muerto, pendiente #3 de Fase 2). (4) supabase/config.toml: agregada la
// entrada faltante [functions.notify-new-products-daily] (verify_jwt=true,
// coincide con el valor real ya confirmado vía list_edge_functions en
// Fase 2/3) — el código de la función ya gateaba correctamente, solo
// faltaba la entrada de configuración (pendiente #5 de Fase 2).

// v2.15.8 — design/UX: Fase 4 de la auditoría integral (AUDITORIA-2026-07.md).
// (1) FIX de mayor impacto del pase: ~170 inputs/textareas en ~60 archivos
// tenían font-size <16px, disparando el zoom automático de iOS Safari al
// enfocar el campo — piso subido a text-[16px] en todo el proyecto (regla
// nueva en DESIGN.md §32, recién creado: no existía estándar móvil/responsive
// documentado antes de este pase). (2) Touch targets <44px corregidos en los
// 2 componentes de los que depende casi toda vista: ViewTabBar.jsx (pills de
// tab, botones de abrir/cerrar búsqueda) y AppLayout.jsx (botón hamburguesa,
// que no tenía padding — su hit-box literal era 22×22px). (3) active:scale-90
// /-95 → active:scale-[0.97] en 297 sitios (11 archivos, módulo pedidos/) por
// regla DESIGN.md §31. (4) 9 <select> nativos → LiquidSelect en 6 archivos
// (FormTurnos, EarlyExitForm, EncuestaView, AnnouncementsView, AuditView,
// ComprasView) — verificado que el resto del código en esos archivos ya
// coacciona a String() en sus comparaciones, así que el swap no rompe nada
// pese a que LiquidSelect devuelve el valor tal cual (no siempre string).
// (5) 1 fix de contraste puntual (TabCatalogo.jsx, hint "Ctrl+V" con
// text-slate-300 + font-normal dentro de un botón clickeable). Hallazgo
// grande documentado pero NO corregido (fuera de alcance de un pase
// mecánico): ~1,288 violaciones reales de text-slate-300/400 sobre
// superficie clara en 127 archivos — un find/replace ciego atraparía
// también ~409 usos legítimos (iconos, tooltips oscuros), así que queda
// para un pase dedicado futuro. También documentado sin tocar: Service
// Worker sin ningún caching/fetch (PWA instalable pero sin comportamiento
// offline real), y el <select> por celda de FormAiSchedulerPreview.jsx +
// el stepper compuesto de TimePicker12.jsx (swaps no triviales, requieren
// una variante nueva del componente compartido).

// v2.15.7 — security: 2 stored-XSS reales encontrados en Fase 3 de la
// auditoría integral (AUDITORIA-2026-07.md), fix inmediato por ser
// crítico/explotable ahora (órdenes permanentes de la auditoría).
// (1) CotizacionesView.jsx (buildPrintHTML) y (2) PayrollView.jsx
// (buildBoletaHTML): ambos arman HTML crudo con datos de negocio
// (nombre/nota/nit de cliente, detalle de viáticos, historial de edición
// de planilla, nombre de banco, etc.) interpolados sin escapar y lo
// inyectan vía document.write() en una ventana abierta con window.open().
// Cualquier campo de texto libre (p.ej. "Notas" de una cotización o el
// detalle de un viático) podía contener <script> y ejecutarse en el
// contexto del portal al imprimir. Fix: se agrega el helper esc() (mismo
// patrón ya usado en FormNovedad.jsx) y se envuelve cada interpolación de
// datos de usuario/negocio; además se agrega 'noopener' a los 3
// window.open() de impresión (los 2 de arriba + FormNovedad.jsx, este
// último ya estaba bien escapado, solo se endurece el noopener) para que
// un HTML inyectado no pueda alcanzar el opener vía window.opener. Cero
// cambio de lógica de negocio — el HTML resultante es idéntico salvo el
// escapado de entidades.

// v2.15.6 — fix: 2 bugs reales encontrados al validar el resto de errores de
// lint (no-undef, react-hooks/rules-of-hooks) en todo el repo.
// (1) EmployeeDetailView.jsx: la variable `isHiring` se usaba en el timeline
// de Historial Operativo (color del punto + badge "Hito de Inicio Operativo")
// pero nunca se declaraba — ReferenceError en CUALQUIER evento de CUALQUIER
// empleado (no solo altas), no solo los de tipo HIRE/HIRING. Verificado en
// vivo con el único empleado con evento real en producción (Cendy Quintanilla,
// evento PROMOTION): antes del fix habría roto el render del historial; ahora
// se declara `isHiring = ev.type === 'HIRE' || ev.type === 'HIRING'` junto al
// resto del cálculo de evTheme.
// (2) useTimeClockEngine.js: 5 llamadas a useStaff() dentro de expresiones
// `props.x ?? useStaff(...)` — hook condicional (rules-of-hooks), no dispara
// hoy porque el único caller (TimeClockView) nunca pasa esos props, pero
// quedaba frágil ante cualquier caller futuro que sí los pase. Se separaron
// las llamadas al hook (siempre incondicionales) del fallback con `??`.

// v2.15.5 — chore: fix raíz de falsos positivos de lint Icon/motion + limpieza
// de código muerto encontrado al validarlos.
// (1) Se agrega eslint-plugin-react (solo la regla react/jsx-uses-vars) a
// eslint.config.js — resuelve en la raíz los 38 falsos positivos no-unused-vars
// de "motion"/"Icon" usados en JSX (framer-motion, iconos destructurados) sin
// tener que comentar eslint-disable archivo por archivo. Se removieron los
// disables ahora redundantes en TabPoliticaVencimiento.jsx, DashboardView.jsx
// y EncuestaView.jsx.
// (2) WidgetInventorySearch.jsx: se eliminó un bloque de estado/función
// ("reportOpen"/"reportState"/"submitReport") huérfano de un refactor previo
// — el feature de "reportar producto no encontrado" real y funcional vive en
// SrsCompactCard (botón "Reportar" por tarjeta), este otro nunca se llamaba.
// (3) WidgetInventorySearch.jsx: sanitizeSrs() tenía bytes de control literales
// pegados directo en el regex (incluye un NUL byte), lo que hacía que el
// archivo se detectara como binario por herramientas de texto plano. Se
// reescribió con escapes \x/\u estándar — comportamiento verificado idéntico
// con test aislado, cero cambio funcional.
//
// Hallazgo documentado sin resolver (requiere decisión de producto, no es
// lint): en TabPedidos.jsx, handleCorregirBodega/handleConfirmarCorreccion
// (líneas ~3012-3034) están completas pero no están conectadas a ningún botón
// — el flujo "diferencias → corregir bodega → confirmar corrección" tiene
// backend completo (columnas + RPC desde 20260621_pedidos_diferencias_correccion_workflow.sql)
// pero ningún punto de entrada en la UI. La notificación push a bodega dice
// "revisá y marcalo como corregido" pero no hay dónde hacerlo. Pendiente de
// decisión: dónde va el botón/modal y si es de uno o dos pasos.

// v2.15.4 — chore(laboratorios): silencia 4 falsos positivos de lint en
// TabPoliticaVencimiento.jsx (preexistentes en main, no introducidos por
// v2.15.3) con comentarios eslint-disable puntuales, mismo patrón usado en
// DashboardView.jsx/EncuestaView.jsx: "motion"/"Icon" se usan en JSX pero
// no-unused-vars no lo detecta sin eslint-plugin-react; los dos
// useEffect (carga inicial + reset de paginación) son patrones
// intencionales que la regla react-hooks/set-state-in-effect marca en
// falso. No es una limpieza global — el resto del repo tiene ~150/67
// instancias del mismo patrón sin tocar (fuera de alcance).

// v2.15.3 — fix(laboratorios): 3 correcciones en Política de Vencimiento.
// (1) "Marcar laboratorio completo como ND" usaba window.confirm() nativo del
// navegador — se reemplazó por ConfirmModal (Liquid Glass), igual que el resto
// del portal; se agregó el mismo fix al confirm de eliminar proveedor.
// (2) El botón "Marcar laboratorio completo como ND" ocupaba el ancho completo
// de la fila con borde punteado — ahora es un pill pequeño alineado a la
// derecha junto al label "PROVEEDORES".
// (3) El formulario "Agregar proveedor" pasó de un panel apilado con botón
// "Guardar" a una fila inline (nombre, meses, ND, notas) con autoguardado
// (debounce 700ms, sin botón Guardar) — igual patrón que Devolutivo/Categoría
// en TabCatalogo. El botón "+ Agregar proveedor" ya NO se oculta al agregar:
// se pueden abrir varias filas a la vez, un laboratorio puede tener varios
// proveedores.

// v2.15.2 — feat(laboratorios): selector de proveedor/droguería + política ND
// real en Laboratorios > Vencimiento, a pedido directo del área de Bodega.
// (1) El campo "Nombre del proveedor" era texto libre — se reemplazó por un
// selector (LiquidSelect + "Otro...") sobre la tabla `suppliers` real (78
// proveedores sincronizados del ERP vía sync-erp-purchases, incluye COFARSAL),
// combinada con cualquier nombre ya guardado en `proveedores` — mismo patrón
// de catálogo + "Otro" que educación/especialidades (CatalogSelect), sin tocar
// `suppliers` (espejo del ERP, RLS solo permite escritura a service_role).
// (2) "Meses antes de vencer por política de devolución" ahora es SIEMPRE
// visible y obligatorio (antes quedaba oculto y opcional detrás de un toggle
// "Devolutivo") — el check "Marcar como ND" es ahora la excepción explícita
// que lo deshabilita, no al revés; default de fila nueva es devolutivo=true,
// igual convención que products.devolutivo (TabCatalogo, v2.15.0). (3) Punto
// rojo junto al nombre de proveedores COFARSAL (regla de Bodega: revisar
// primero por ese proveedor al chequear corto vence). (4) Nuevo botón "Marcar
// laboratorio completo como ND" por laboratorio — confirma con el conteo real
// de productos afectados y voltea products.devolutivo=false en bloque para
// todo el laboratorio (poco común que un laboratorio sea 100% ND, pero cuando
// pasa evita editar producto por producto en Catálogo). Reglas completas de
// Bodega para corto vence (COFARSAL, ND 6-7 meses antes, fechas de envío
// 25-30 de cada mes, etc.) guardadas en memoria del proyecto como spec para
// un futuro tracker — no implementadas aún (no existe hoy un listado de
// productos por vencer a nivel de inventario). Verificado en vivo
// (Playwright): selector trae los 78 proveedores reales incl. COFARSAL,
// "Otro" revela el input de texto libre, meses queda en rojo/"Requerido" con
// Guardar deshabilitado hasta llenarlo, toggle ND lo deshabilita
// correctamente, botón de laboratorio completo muestra el conteo real (55
// productos) en el confirm — cancelado a propósito para no escribir sobre
// datos de producción sin permiso explícito.

// v2.15.1 — feat(laboratorios): paginación en Laboratorios > Vencimiento.
// La lista de laboratorios (acordeón con proveedores/política de devolución)
// no paginaba y renderizaba todos los resultados de una vez. Se agregó el
// patrón estándar de paginación cliente (page/pageSize + TablePagination),
// igual al usado en TabSinVenta/TabGestionStock: reset de página al buscar
// o cambiar el tamaño de página, slice de la lista filtrada.

// v2.15.0 — feat(productos): rediseño de "Devolutivo" en Catálogo. Se
// descubrió que los 5,170 productos estaban en devolutivo=false (default de
// columna, nunca clasificados) — el toggle no distinguía "no clasificado" de
// "confirmado no devolutivo". Se confirmó con el usuario la regla real: por
// defecto los proveedores SÍ aceptan devolución; "No Devolutivo" (ND) es la
// excepción. Cambios: (1) badge "ND" ámbar en la fila del producto cuando
// devolutivo=false, (2) los 34 productos de SOPHIA (laboratorio_id 216)
// marcados ND, default de la columna volteado a true para productos nuevos,
// (3) el toggle en el panel expandido ahora resalta en ámbar el estado ND
// (antes resaltaba en verde "Devolutivo", lo cual invertía la lectura de cuál
// es la excepción a vigilar), (4) se eliminó el botón "Guardar" del panel
// expandido — Categoría y Principios Activos ahora autoguardan (igual que
// Devolutivo y la foto, que ya autoguardaban); footer queda solo con
// "Cerrar". Verificado en vivo: login + búsqueda "sophia" en Ventas >
// Productos, badge ND visible en fila y panel, toggle ámbar correcto, footer
// sin Guardar. No se probó el autoguardado de Categoría contra un producto
// real para no escribir un valor de prueba en datos de producción; la lógica
// replica el patrón ya en uso (devolutivo) verificado end-to-end.

// v2.14.2 — fix(ventas): ocultar producto no sobrevivía a un reload (F5). El
// toggle solo actualizaba productsCache.current (memoria) — un reload borra
// la memoria y cae a localStorage (ppv5_...), que seguía con
// oculto_en_ventas desactualizado hasta que el TTL de 20 min expirara. Ahora
// también parcha el registro dentro de localStorage al ocultar/mostrar.
// Además, a pedido: se agrega quién y cuándo ocultó cada producto —
// products.oculto_por (FK a employees) + oculto_at, resueltos server-side vía
// nuevo RPC toggle_producto_oculto_ventas() con auth_employee_id() (no un
// update directo, para que el cliente no pueda enviar cualquier oculto_por).
// get_product_sales_agg expone el nombre vía JOIN a employees; el tooltip del
// ícono de ojo en modo "solo ocultos" muestra "Oculto por X el DD/MM".
// Bump ppv5→ppv6 en caché (mismo motivo que bumps anteriores — nuevos campos
// en la fila). Verificado en vivo con un F5 real: producto sigue oculto tras
// el reload, tooltip muestra el nombre correcto resuelto del servidor. Se
// encontró y limpió además un producto oculto residual de pruebas de una
// sesión previa (oculto_por NULL, hide hecho con el código viejo pre-RPC).

// v2.14.1 — fix(ventas): rediseña "Unidades" de Ventas > Productos (v2.13.3/
// v2.13.4 revertidas). El subtexto con el desglose crudo ("234 BLISTER + 1
// CAJA + 1 C...") no multiplicaba por factor y no reconciliaba a simple vista
// con el total mostrado arriba — confuso y truncado. La celda vuelve a
// mostrar siempre el número plano en unidades base (como antes de v2.13.3,
// consistente en single/multi-presentación y cualquier factor). El desglose
// se movió a un tooltip (hover, mismo patrón que "Total con IVA") que sí
// reconcilia: cada presentación como "cantidad × factor = subtotal u", con
// línea de Total al final cuando hay más de una presentación. Verificado en
// vivo: "ACETAMINOFEN 500MG CAJA X 100 TAB MK" (4 presentaciones) —
// 234×10 + 1×100 + 1×100 + 35×1 = 2,575, suma exacta con la celda.

// v2.14.0 — feat(ventas): ocultar producto en Ventas > Productos. Ícono de ojo
// al final de cada fila (products.oculto_en_ventas, global — para todos los
// usuarios, no afecta Catálogo/Inventario/MinMax). Por defecto la lista
// excluye los ocultos; mini card "Ocultos" (aparece solo si hay ≥1) muestra el
// conteo y, al hacer clic, invierte la vista a "solo ocultos" para revisarlos
// o destaparlos — mismo patrón ya usado para "Pts. Canjeados" en Ventas.
// get_product_sales_agg ahora expone oculto_en_ventas (recreada — el cambio de
// return type exige DROP+CREATE); get_product_sales_total excluye ocultos del
// cálculo de período anterior para que la comparación no incluya lo que ya no
// se ve en el período actual. Bump ppv4→ppv5 en la caché localStorage (mismo
// motivo que ppv3→ppv4 de v2.13.1: la fila cacheada no traía el campo nuevo).
// Verificado en vivo: ocultar/destapar contra Supabase real, estado
// persistente entre reloads, KPIs recalculados en modo "solo ocultos"; BD
// confirmada en 0 productos ocultos al terminar la prueba.

// v2.13.4 — fix(ventas): la desambiguación de "Unidades" (v2.13.3) solo cubría
// productos de UNA presentación con factor > 1. El mismo problema existe con
// varias presentaciones si alguna tiene factor > 1 — "144" en un producto con
// "2 presentaciones" se puede leer como 144 unidades sueltas cuando en
// realidad fueron, ej. 13 BLISTER + 2 CAJA. La condición ahora es
// `presentaciones.some(p => factor > 1)` en vez de exigir una sola
// presentación: con múltiples presentaciones y algún factor > 1 se agrega el
// desglose crudo como subtexto ("13 BLISTER + 2 CAJA"); se sigue omitiendo
// solo cuando TODO el mix es factor 1 (sería idéntico al total, redundante).
// Verificado contra datos reales: "NEUROBION X 120 TAB." y "DOLO NEUROBION N
// X 120 TAB." ahora muestran el desglose; "NEUROBION 25,000 AMP" (2
// presentaciones, ambas factor 1 en el ERP pese a llamarse "CAJA") se
// confirmó sin ambigüedad real y se queda sin desglose correctamente.

// v2.13.3 — fix(ventas): ambigüedad en "Unidades" de Ventas > Productos. Un
// producto con una sola presentación de factor alto (ej. "REVERSAL FLEX X 20
// TABLETAS", CAJA 1X20) mostraba solo "20" en unidades base — se podía leer
// como "20 cajas" cuando en realidad fue 1 caja de 20 tabletas (confirmado con
// el detalle de la venta real: CANT. 1, presentación CAJA 1X20). Cuando la fila
// tiene una única presentación y esa presentación tiene factor > 1, la celda
// ahora muestra la cantidad tal como se vendió ("1 CAJA 1X20") con el total en
// unidades base como subtexto ("20 u"). Con factor 1 (UNIDAD) o con múltiples
// presentaciones se deja el número simple de siempre — el subtexto sería
// redundante o no hay una sola presentación que mostrar como "vendida así".
// Verificado en vivo contra 12 productos reales con las tres combinaciones
// (single+factor>1, single+factor=1, multi-presentación).

// v2.13.2 — fix+feat(ventas): KPIs de Productos acotados por laboratorio + Total
// con IVA en hover.
// 1) Las 4 stat cards (Total s/IVA, Costo, Utilidad, Margen) se calculaban sobre
//    `rows` (dataset completo del período) ignorando el filtro de laboratorio —
//    al filtrar por lab, las cards seguían mostrando el total global. Se agregó
//    labFilteredRows (rows acotado por filterLab, sin tocar el buscador — ese
//    sigue sin afectar las cards, mismo criterio ya existente) y las cards ahora
//    se recalculan sobre ese subconjunto. La comparación vs. período anterior
//    (prevProdStats, que viene de un RPC sin filtro por lab) se oculta mientras
//    filterLab está activo para no comparar un total acotado contra uno global.
// 2) Total con IVA: como get_product_sales_agg ya normaliza "neto" a s/IVA para
//    todo tipo de documento (CCF se deja tal cual porque su total_linea ya es
//    s/IVA; el resto se divide entre 1.13), con IVA = neto × 1.13 de forma
//    uniforme. Se agregó como tooltip (LiquidTooltip) en hover: en la card
//    "Total s/IVA" (con el total acotado por lab si aplica) y en la celda de
//    cada fila. Verificado en vivo con capturas antes/después de filtrar y hover
//    de card y fila.

// v2.13.1 — fix(ventas+stock): dos bugs post-deploy.
// 1) Columna "Laboratorio" en Ventas > Productos aparecía vacía ("—") para
//    usuarios con la caché localStorage (ppv3_) poblada ANTES del deploy de
//    v2.12.1 — esas filas cacheadas no tenían laboratorio_id/laboratorio_nombre
//    y el TTL de 20 min las mantenía vigentes tras el deploy. Bump ppv3→ppv4
//    (mismo patrón que el fix ppv2→ppv3 de v2.9.15) + purga incondicional de
//    ppv2_/ppv3_ en vez de esperar su TTL. Verificado sembrando una caché ppv3
//    sin esos campos y confirmando que tras el reload se ignora, se purga y se
//    refetchea con Laboratorio poblado.
// 2) get_products_sold_no_minmax_jsonb / get_stagnant_inventory_jsonb (Gestión
//    de Stock, TabSinVenta) usaban RETURNS jsonb + jsonb_agg en vez de RETURNS
//    json + json_agg — viola la regla del proyecto (jsonb_agg spillea a disco en
//    payloads grandes, medido 4.6x más lento). Recreadas con el patrón correcto,
//    grants revisados (anon sin acceso, authenticated sí).

// v2.13.0 — feat(conteo-inventario+laboratorios): política de vencimiento. Cierra
// el trabajo interrumpido de la sesión anterior (3/5 tareas ya estaban en BD):
// 1) crear_conteo_inventario ya NO filtra por vencidos — el conteo físico siempre
//    incluye TODO el inventario del alcance elegido; lo vencido/próximo a vencer se
//    señala como aviso (badge) en vez de excluirse del snapshot. Se quitó el
//    checkbox "Incluir productos vencidos" del modal (ya no aplica).
// 2) ConteoDetailView: badge "Vencido"/"Por vencer" (90 días) por línea y agregado
//    a nivel de producto (con_vencidos_count/con_proximos_count, ya calculados en
//    get_conteo_products_page).
// 3) Nueva tabla proveedores (laboratorio_id FK, devolutivo, meses_devolucion,
//    notas) + products.devolutivo — permite registrar, por proveedor, si el
//    laboratorio acepta devoluciones y con cuántos meses de anticipación, y anular
//    esa política a nivel de producto individual cuando aplique.
// 4) Nueva pestaña "Política de Vencimiento" en Laboratorios: lista los 355
//    laboratorios en acordeón, permite agregar/editar/eliminar proveedores con su
//    política de devolución (TabPoliticaVencimiento.jsx).
// 5) TabCatalogo: toggle "Devolutivo" en el panel expandido de producto para poder
//    marcar productos individuales (products.devolutivo, sin UI hasta ahora).
// Verificado en vivo: modal de conteo sin el checkbox, RPCs en BD ya con los
// campos esperados, pestaña nueva creando/mostrando proveedores contra Supabase
// real (dato de prueba limpiado al terminar), toggle de producto persistiendo y
// revirtiendo correctamente. Build y lint sin regresiones (ruido de lint
// preexistente idéntico al de TabLaboratorios.jsx, no introducido por este cambio).

// v2.12.1 — feat(ventas): columna "Laboratorio" en Ventas > Productos, con filtro
// dedicado (pill LiquidSelect junto a Sucursal) para ver ventas por laboratorio. El
// backend (get_product_sales_agg / get_product_sales_agg_jsonb) ya traía
// laboratorio_id/laboratorio_nombre vía JOIN a products/laboratorios; se agregó la
// columna a la tabla, el estado filterLab, labOptions derivado de las filas cargadas,
// y el filtro se aplica sobre el dataset ya descargado (sin round-trip extra).

// v2.12.0 — feat(conteo-inventario): agrupación por producto + catálogo en "Agregar
// Producto" + corrección de lote. Cambios pedidos tras revisar el módulo en uso real:
// 1) Se quitó "No encontrado"/SIN_UBICAR — un físico=0 ya comunica lo mismo, el botón
//    era redundante (el usuario: "si en inventario hay 1 y pongo 0 es no encontrado").
// 2) Laboratorio y Presentación pasan a columnas propias (antes subtítulo del nombre del
//    producto) — get_conteo_items_search/count ahora también buscan por esos dos campos.
// 3) La tabla se reestructura a fila-de-producto + hijas expandibles por lote/presentación
//    (ProductGroupRow/ItemRow). LA PAGINACIÓN CAMBIA de fila a PRODUCTO — nuevas RPCs
//    get_conteo_products_count/page agregan sistema/físico/diferencia por producto vía
//    GROUP BY, con el mismo patrón live_inv (JOIN a inventory agregado por sucursal, no
//    subquery correlacionada por fila) para acotar el costo del lookup en vivo. Así un
//    producto con muchos lotes (ej. 9 en el caso de prueba) nunca se parte entre dos
//    páginas y el total mostrado siempre es exacto (decisión confirmada con el usuario:
//    paginar por producto, no cargar todo sin límite).
// 4) Corrección de lote: ícono de lápiz junto al lote abre un modal (editar_lote_conteo_item)
//    para cuando el físico encontrado trae un lote distinto al del snapshot (ej. ERP no
//    sincronizó el lote nuevo) — solo corrige la etiqueta de auditoría, nunca inventory.
// 5) "Agregar Producto/Lote": el buscador ahora excluye productos ya presentes en el
//    conteo (get_conteo_existing_product_ids); Presentación se toma del catálogo real del
//    producto (product_precios→presentaciones, no texto libre); Lote ofrece los lotes
//    existentes de ese producto/sucursal en inventory + opción "+ Otro lote (nuevo)" — al
//    elegir un lote existente la fecha de vencimiento se amarra automáticamente (deshabilitada
//    para edición manual); "Otro" habilita fecha manual para un lote genuinamente nuevo.
// 6) Navegación tipo Excel: flechas arriba/abajo dentro del input de Físico saltan al
//    mismo input de la fila anterior/siguiente (recorre el DOM en orden visual, así que
//    salta automáticamente productos colapsados).
// 7) Indicador "en vivo" más notorio (badge "● Vivo" en vez de un punto de 9px) — se deja
//    animate-pulse de Tailwind (opacity vía GPU, sin animation-delay por instancia, así que
//    ya laten en fase — no cada uno a su ritmo).
// get_conteo_items_search seguía con SUM(cantidad) correlacionado por fila; se reemplazó
// por un JOIN a una CTE live_inv agregada una sola vez por sucursal (misma optimización
// reutilizada en las nuevas RPCs de producto).

// v2.11.2 — feat(conteo-inventario): conteo "en caliente" + trazabilidad de quién contó.
// Antes el "sistema" era un snapshot congelado al crear el conteo; ahora, mientras un ítem
// no se ha contado (fisico_cantidad IS NULL y no es agregado manual), tanto la lista
// (get_conteo_items_search) como el JSON de impresión (get_conteo_items_jsonb) muestran
// el stock VIGENTE releído en vivo de `inventory` (ícono pulsante junto al valor), para
// que sucursales que no cierran puedan contar sin distorsionar la comparación. El valor
// solo se congela en el servidor, en el instante exacto del guardado — nunca lo decide el
// cliente — vía la nueva RPC `guardar_conteo_item`, que también registra en la nueva tabla
// append-only `conteo_inventario_item_history` (RLS SELECT-only) quién contó cada línea y
// cada edición posterior (`get_conteo_item_history`). ConteoDetailView muestra "Contado
// por {nombre}" con botón de historial (ItemHistoryModal). Se agrega dirty-check en
// ItemRow.commit() (compara contra la última combinación fisico/nota/estado realmente
// guardada) para que un blur sin cambios (ej. Tab entre celdas) no dispare un guardado ni
// una fila de historial redundante — bug real encontrado en la verificación E2E (2
// entradas idénticas para la misma edición).
// fix(conteo-inventario): ChevronRight sin importar en ConteoDetailView (el botón de
// cierre del pill de búsqueda tiraba ReferenceError y la vista de detalle quedaba en
// ErrorBoundary permanente). fix(db): get_conteo_items_search (versión con p_limit/
// p_offset) fallaba con "column reference \"estado_item\" is ambiguous" — al convertirse a
// plpgsql, las columnas de RETURNS TABLE (estado_item, diferencia, lote, etc.) quedan como
// variables implícitas que colisionan con las columnas homónimas del CTE; se resolvió
// calificando todas las referencias con el alias de la CTE (`b.estado_item`, etc.) y
// cast::int al SUM(cantidad) (bigint) para que coincida con el tipo integer declarado.
// Se eliminó el overload viejo de 3 argumentos (quedaba huérfano desde la migración
// anterior). Verificado E2E completo: crear conteo MANUAL → contar en vivo → guardar
// (congela sistema + historial) → editar (segunda entrada de historial) → 0 duplicados
// tras el fix → limpieza de datos de prueba (0 filas en las 3 tablas).

// v2.11.1 — fix(conteo-inventario): corrige el header/buscador del módulo para que
// siga el estándar del portal (ver BranchesView.jsx/StaffManagementView.jsx). El error:
// ConteoInventarioView y ConteoDetailView renderizaban <ViewTabBar> como hermano suelto
// ANTES de <GlassViewLayout>, en vez de pasarlo dentro de `filtersContent` — esto crea un
// segundo header flotante desconectado del real (bug ya explicado por el usuario: "por
// qué el buscador está arriba así"), y como GlassViewLayout ya tiene su propio header
// sticky con filtersContent, el patrón correcto (igual que TODAS las demás vistas) es
// construir un único bloque "pill deslizante" (búsqueda + botón de acción) y pasarlo como
// filtersContent — no un ViewTabBar aparte. Se reescribió ConteoInventarioView con esa
// pill (botón "Nuevo Conteo" ahora con el gradiente azul de marca estándar, no el botón
// verde/no-estándar anterior). ConteoDetailView también recibió el mismo filtersContent
// (antes no tenía ninguno, causando que el buscador general "desapareciera" al navegar
// del listado al detalle) y se eliminó el buscador duplicado que vivía suelto en el
// cuerpo — los pills de filtro por estado (Todos/Pendientes/Con diferencia/Sin ubicar)
// se mantienen en el cuerpo (esos sí son filtros de contenido, no búsqueda global).


// v2.11.0 — feat(conteo-inventario): nuevo módulo "Conteo de Inventario" (auditoría
// física por sucursal/bodega). Grano lote+presentación (mismo grano crudo de `inventory`,
// sin re-derivar factor/mv_product_factor — el físico se anota en la misma unidad ya
// impresa). NO ajusta `inventory` (esa tabla la llena el sync del ERP) — solo detecta,
// documenta y deja firma de aprobación auditable de faltantes/sobrantes; la corrección
// real ocurre en el ERP por el proceso operativo de siempre. Flujo: crear (snapshot vía
// INSERT...SELECT server-side desde `inventory`, alcance TOTAL/LABORATORIO/BAJO_RECETA/
// MANUAL, filtra vencidos por defecto) → contar (autosave por fila, diferencia en vivo) →
// finalizar (agrega totales + valor $ faltante/sobrante por SQL) → aprobar (firma,
// gateado por can_approve). RLS con scope real por sucursal (auth_has_module_permission +
// auth_module_scope + auth_employee_branch_id — mismo patrón que minmax_change_requests,
// más robusto que el scope solo-cliente usado en Practicantes). 2 tablas nuevas
// (conteos_inventario, conteo_inventario_items) + 6 RPCs (crear_conteo_inventario,
// finalizar_conteo_inventario, aprobar_conteo_inventario, get_conteo_items_jsonb,
// get_conteo_items_count, get_conteo_items_search — estas 2 últimas paginan con CTE
// MATERIALIZED para evitar el plan genérico lento de "(param IS NULL OR ...)", ver
// feedback_sql_function_generic_plans). Imprime 2 PDFs vía pdfmake (hoja de conteo en
// blanco + reporte de resultados con firmas) en utils/conteoInventarioPrint.js —
// autocontenido, no reusa pedidoPrint.js (trae lógica de despacho/factor que no aplica).
// Verificado end-to-end contra Supabase real (2538 filas de snapshot en La Popular,
// crear→contar→finalizar→aprobar→2 PDFs descargados, 3 eventos de audit_logs) y limpiado
// por completo al terminar.


// v2.10.3 — feat(practicantes): 5 correcciones pedidas tras revisar el modal.
// (1) Se agregan Fecha de Nacimiento y Teléfono (propio del practicante, aparte
// del teléfono del tutor) — antes no se pedían. (2) Con la fecha de nacimiento
// se calcula edad/menor (calcAge/MINOR_AGE, extraído a utils/ageUtils.js — 3ra
// duplicación de esa lógica tras Empleados y StaffManagementView, ahora
// compartida): si es menor, DUI se reemplaza por Documento Alterno (requerido)
// + aviso legal Art. 23.2 CT (el DUI no se tramita hasta los 18); si es
// adulto, se pide DUI. (3) Sucursal ahora agrupa por tipo (Farmacias/Bodega/
// Administración/Personal Externo) con separadores, igual que en Empleados —
// mismo patrón TYPE_ORDER/AREA_LABEL + opt.isSeparator de LiquidSelect.
// (4) Institución Educativa pasa de texto libre a catálogo (nueva categoría
// 'INSTITUCION_EDUCATIVA' en la tabla education_catalog_entries, la misma que
// ya usa Empleados para especialidad/profesión) con fallback "Otra...";
// practicantesSlice.js registra el valor nuevo en el catálogo al guardar. Se
// extrajeron CatalogSelect/CatalogOtherInput/isCatalogOther/buildCatalogOptions
// (antes locales a EmployeeFormModal.jsx) a components/common/CatalogSelect.jsx
// y utils/educationCatalogs.js para reusarlos sin duplicar. (5) Se elimina
// "Horas Completadas" por completo (columna DROP en BD) — no hay fichaje para
// practicantes por diseño legal, así que un conteo manual sin fuente de verdad
// no aportaba; queda solo "Horas Requeridas" como meta declarada.

// v2.10.2 — style(practicantes): a pedido del usuario, PracticanteModal.jsx se restiló
// para calzar exactamente con la estructura visual de EmployeeFormModal — no solo
// "parecido", sino el mismo componente. Se extrajo `PortalInput` (antes local a
// EmployeeFormModal.jsx) a `src/components/common/PortalInput.jsx`, y `inputHoverClass`/
// `applyInputMask` a `src/utils/inputStyles.js` (evita un tercer archivo con el mismo
// estilo duplicado, mismo criterio ya aplicado a duiUtils.js). EmployeeFormModal.jsx ahora
// importa de ahí en vez de mantener su propia copia — cero cambio de comportamiento.
// PracticanteModal.jsx pasó de un panel único estilo Promociones (gradiente violeta,
// inputs sin icono) a: header blanco/glass con squircle (icono violeta GraduationCap,
// mismo squircleClass que UnifiedModal), campos agrupados en "islas" con header de
// icono+título (mismo patrón que Nómina/Personal en Empleados), PortalInput con icono +
// glow azul de marca (#0052CC) en cada campo, y footer idéntico (Cancelar blanco +
// Guardar/Registrar azul de marca, deshabilitado mientras el form sea inválido). También
// se corrigió el timing de validación: los badges "Requerido" y bordes rojos ahora se
// muestran SIEMPRE que el campo esté vacío (como Empleados), no solo tras un intento de
// guardar fallido — se eliminó el estado `touched` que gateaba eso.

// v2.10.1 — refactor(practicantes): a pedido del usuario, se elimina la vista/ruta/menú/
// permiso separados de "Practicantes" (v2.10.0) y se fusiona su visualización dentro de
// Gestión de Personal (StaffManagementView) — un solo punto de entrada, con badge violeta
// "Practicante" para distinguirlos. Se agrega un 5to StaffStatCard "Practicantes" (violet)
// que alterna la tabla entre empleados y practicantes (misma DataTable, columnas "Empleado"→
// "Practicante" y "Cargos Asignados"→"Tipo" cuando está activo); PracticanteRow es un
// componente nuevo (no reusa EmployeeRow: sus campos de "pendiente" — dui/isss/hire_date/
// employee_documents — no existen en un practicante y generarían badges falsos). Botón
// "Nuevo Practicante" junto a "Nuevo Empleado". La tabla `practicantes` y su RLS de
// escritura ahora se gatean con auth_can_edit_any(['staff_list']) en vez de un module_key
// 'practicantes' propio (migración 20260709_practicantes_gate_under_staff_list), ya que no
// existe más una pantalla de Permisos separada para concederlo. Se eliminó
// src/views/PracticantesView.jsx (código muerto tras el merge); practicantesSlice.js,
// PracticanteModal.jsx y duiUtils.js se mantienen sin cambios (se siguen reutilizando).
// Se preserva la separación legal de fondo (Art. 20 CT): practicantes NO tienen kiosk_pin,
// ISSS/AFP, fichaje ni aparecen en nómina — solo cambió DÓNDE se ven en el UI, no el modelo
// de datos.
//
// v2.10.0 — feat(practicantes): nuevo módulo "Practicantes" (RRHH) para horas sociales /
// pasantías académicas NO remuneradas — separado a propósito de employees/nómina/kiosco.
// Razón legal: el Código de Trabajo no contempla trabajo subordinado sin pago (el único
// régimen de "prácticas" pagadas es el Contrato de Aprendizaje Art. 61-70, ya cubierto por
// contract_type='PRACTICAS' en v2.9.35); modelar horas sociales dentro de employees (con
// kiosk_pin, fichaje, ISSS/AFP) generaría el mismo rastro de datos que un juez usaría para
// presumir relación laboral real (Art. 20 CT). Tabla nueva `practicantes` (RLS: SELECT
// authenticated, escritura via auth_can_edit_any(['practicantes']) con wrapper (SELECT...)),
// sin kiosk/ISSS-AFP/nómina, con convenio institucional OBLIGATORIO (bloqueo duro en el
// modal, no el patrón "Pendiente" no-bloqueante de Empleados) subido al bucket privado
// 'documents' ya existente (sin bucket/policies nuevos). Campos: sucursal, institución
// educativa, tutor + teléfono, supervisor interno opcional, fecha inicio/fin obligatorias,
// horas requeridas/completadas (manuales, sin timesheet), estado (activo/finalizado/
// cancelado) con badge "Vencido" calculado en cliente. Nuevos archivos:
// src/store/slices/practicantesSlice.js, src/components/practicantes/PracticanteModal.jsx,
// src/views/PracticantesView.jsx. Registrado en App.jsx (ruta + PermissionGuard),
// AppLayout.jsx (grupo RRHH) y PermissionsView.jsx (grupo RRHH, hasScope:true). Además:
// isValidDUIAlgorithm/maskDui extraídos de EmployeeFormModal.jsx a src/utils/duiUtils.js
// (evita un tercer duplicado del algoritmo; EmployeeFormModal ahora importa de ahí, mismo
// comportamiento).
//
// v2.9.35 — feat(empleados): nuevo tipo de contrato "Prácticas / Aprendizaje" en el modal
// de creación/edición (EmployeeFormModal). Corresponde legalmente al Contrato de Aprendizaje
// del Código de Trabajo (Art. 61-70), no al Art. 25 (plazo fijo) que ya cubre "Temporal" —
// por eso reutiliza fecha de inicio/fin obligatorias (como Temporal) pero NO los campos
// Base Legal del Plazo/Motivo Concreto (exclusivos del régimen de plazo fijo). Se agregó
// un aviso informativo con las 3 obligaciones clave del régimen de aprendices: forma
// escrita + aprobación/inscripción ante el Ministerio de Trabajo (Art. 61), salario mínimo
// reducido por año de aprendizaje 50%/75%/100% (Art. 69), y exención de responsabilidad
// por terminación al llegar al fin del contrato (Art. 68). Sin migración de BD: contract_type
// no tiene CHECK constraint (solo contract_temporal_legal_basis lo tiene, y no aplica aquí).
//
// v2.9.34 — fix(minmax): 2 bugs reportados por el usuario. (1) Badge "N borrador(es)" +
// filtro "Solo borradores" desincronizados: draftCount/sparseCount/changesCount/stats se
// calculaban sobre `data` completo, pero la tabla filtrada excluye productos ocultos
// (is_hidden) INCONDICIONALMENTE antes de aplicar cualquier otro filtro — repro exacto:
// La Popular mostraba "1 borrador" (ELECTROLIT JAMAICA 625ML, is_hidden=true, draft
// pendiente de un hide+zero-out) pero "Solo borradores" daba 0 resultados. Fix: el loop
// de conteo ahora salta filas ocultas, igual que filteredBase. (2) Historial MIN/MAX no
// registraba varios tipos de cambio — 4 causas encontradas y corregidas: (a) openHistory
// filtraba por una lista de acciones vieja/incompleta (incluía 'MINMAX_MANUAL_OVERRIDE',
// un action de un componente EditRow/EditDraftRow 100% muerto — nunca se renderiza en
// JSX, eliminado ~200 líneas — y le faltaban MINMAX_BODEGA_MANUAL_OVERRIDE/RESET_MANUAL,
// MINMAX_UPDATED_FROM_PEDIDO, MINMAX_RESET_CLEAR, MINMAX_DISCARD_DRAFT,
// MINMAX_ZERO_ALL_BRANCHES); (b) las 2 llamadas a appendAuditLog('MINMAX_BODEGA_MANUAL_
// OVERRIDE', ...) nunca incluían sucursal_id en los details, y el filtro de openHistory
// exige `details->>sucursal_id = sucursal actual` — con NULL nunca matcheaba aunque el
// action estuviera en la lista; (c) BUG CRÍTICO en TabPedidos.jsx doSave: el target_id
// del audit log era `row.pedido_id` (undefined → loggeaba target_id=NULL) en vez de
// `row.erp_product_id` — los cambios de MIN/MAX hechos desde "Revisión MIN/MAX" en
// Pedidos JAMÁS podían aparecer en el historial de ningún producto, sin importar el
// filtro; (d) modelo de datos fragmentado: cada guardado de una sola celda (MIN o MAX)
// loggeaba SOLO ese campo (field:'MIN'/'MAX', old_value/new_value) — a pedido del
// usuario ("no se debe guardar el min y max individual, sino todo junto") se unificó
// TODA acción de historial a una sola forma {old_min,old_max,new_min,new_max,
// sucursal_id} — una entrada por guardado con el estado completo antes/después, nunca
// fragmentado por campo. Con eso el render del modal se simplificó a un solo path
// (MINMAX_HISTORY_ACTION_META: label+color por acción) en vez de 3 ramas ad-hoc
// (isReset/isZero/default) que ya no cubrían todos los casos. BACKFILL de datos
// existentes en audit_logs (producción, verificado con SELECT antes/después): 198
// MINMAX_UPDATED_FROM_PEDIDO con target_id NULL → corregido a target_id=product_id;
// 39 MINMAX_BODEGA_MANUAL_OVERRIDE sin sucursal_id → sucursal_id=6 + normalizados a
// old_min/new_min; 5,249 MINMAX_LIVE_EDIT/MINMAX_DRAFT_EDIT de una sola celda →
// normalizados a old_min/old_max/new_min/new_max (el campo no tocado queda sin dato
// histórico, honesto — nunca se capturó); 92 MINMAX_RESET_CALC, 138 MINMAX_ZERO_OUT/
// LIVE_ZERO/ZERO_ALL_BRANCHES, 8 MINMAX_BODEGA_RESET_MANUAL → mismo tratamiento. Todo
// el historial pre-existente ahora es visible y consistente con el formato nuevo.
// Verificado con Playwright + queries directas a product_stock_params/audit_logs
// contra producción (usuario estaba probando en vivo en simultáneo — la secuencia real
// de sus pruebas en INDOMETACINA 25MG quedó capturada correctamente en el historial).

// v2.9.33 — fix(minmax/bodega): badge "SIN SALAS" se disparaba con cualquier producto con override manual en Bodega, sin importar si las sucursales sí tenían MIN/MAX real (repro: INDOMETACINA 25MG, Σ sucursales=366/671 marcado como retirado de todas las salas). Causa: la condición leía `row.min_units`/`row.max_units`, campos que NO existen en las filas devueltas por get_stock_analysis_jsonb (el RPC expone `pub_min`/`pub_max`) — `Number(undefined ?? 0)` siempre daba 0, así que `has_manual && Σ=0` era casi siempre cierto. Fix: usar `row.pub_min`/`row.pub_max` (la Σ real de sucursales), igual que el resto del componente. De paso: se confirmó que el modelo aditivo del trigger sync_bodega_draft_from_branch (effective = Σ sucursales + manual delta) SÍ preserva manual_min/manual_max correctamente — el reporte original ("sucursal sobrescribe el manual de bodega") no se pudo reproducir en el código actual; puede haber sido este mismo bug de badge generando la confusión.

// v2.9.32 — perf(pedidos): los 2 pendientes de la auditoría, con resultado idéntico verificado (pedidos es delicado). (1) get_pedido_sucursal_stats + get_pedido_sin_bodega recomputaban el MISMO esqueleto pesado (inv_dedup sobre 24K filas de inventario + necesidades + bodega_net, ~400-480ms cada una) y TabGenerar las llamaba a ambas al montar Y en cada refreshStats (~800ms de servidor por carga). Diagnóstico: no era plan genérico (inline 424ms ≈ función 481ms) ni un solo nodo dominante (inv_dedup 68ms + necesidades 38ms + agregaciones) — era trabajo duplicado. Nuevo RPC get_pedido_generar_dashboard(p_sucursal_ids) RETURNS jsonb {stats, sin_bodega}: computa la base UNA vez con las CTEs TEXTUALMENTE idénticas a las originales (única transformación: con_bodega/sin_bodega UNION ALL → flag EXISTS por fila, equivalente por construcción); plpgsql force_custom_plan. Las 2 funciones originales quedan INTACTAS en BD como referencia. VERIFICADO: sin_bodega 964 items 0 diffs en ambas direcciones, stats 0 diffs campo a campo vs las originales; medido 313-337ms el combinado vs ~800ms las dos. TabGenerar.jsx: refreshStats unificado con la llamada única (mount + refresh); Playwright contra build de producción: la vista carga con UN solo RPC (277KB), 6 tarjetas de sucursal y tabla de 964 productos sin stock idénticas. (2) get_top_supplier_per_product: FALSA ALARMA — 5-8ms en caliente como función (el plan ya era óptimo: bitmap por idx_purchase_items_product + probes por PK); los 428ms medidos antes eran caché fría + hint-bits de páginas recién escritas por sync-purchases-10min (dirtied=42 en el primer plan). Sin cambios — no había nada que corregir sin inventar riesgo.

// v2.9.31 — fix(datos/ventas) + perf(db) + ops(resync junio): (A) RESYNC JUNIO a pedido del usuario ("hubieron unos cambios"): disparados los 6 backfill-dte-sales con el mismo payload del cron mensual (fromYear/Month=2026-06, chunkDays 7, request_ids 836129-834); los 6 OK: 0 facturas nuevas, 71 actualizadas (Popular 40, S1 6, S2 10, S3 7, S4 4, S5 4); conteos/totales por sucursal idénticos al baseline pre-resync (cambios a nivel de campos/líneas); agregados refrescados al momento (monthly_agg 0 escrituras — sumas por producto sin cambios netos; daily_stats 1 fila). (B) BUG DE DATOS descubierto en la auditoría: get_product_sales_agg ignoraba p_ffin en meses pasados — pres_past sumaba MESES COMPLETOS del agregado, así que el badge "% vs período anterior" de Ventas→Productos comparaba julio 1-8 contra TODO junio dividido entre 8 días: mostraba ↓71.6% ($199,437) cuando lo correcto es ↑0.7% ($56,485.83). Rediseño de la descomposición del rango (bounds/bounds2 + pres_partial que reemplaza a pres_start_partial): porción del mes actual en vivo + meses pasados completos desde product_sales_monthly_agg + días sueltos de meses parciales desde facturas — también corrige rangos tipo 10-abr→20-jun que antes incluían junio completo. VERIFICACIÓN: mes completo (2,710 productos), multi-mes (3,111) y arranque a mitad de mes con sucursal (2,559) = 0 diferencias vs la versión anterior; rango parcial 1-8 jun = exacto contra escaneo directo de facturas (1,873 productos, 0 diffs). Los wrappers jsonb/total heredan el fix sin cambios de cliente; badge verificado en navegador (↑0.7%, sub $56,485.83 · 1/6→8/6). (C) refresh_inventory_grouped_mv condicional: el cron de 2 min reescribía la MV completa (~370-490ms + churn) aunque inventory no cambiara; ahora compara n_tup_ins+upd+del de pg_stat_user_tables contra el último refresh (tabla nueva mv_refresh_state, RLS+policy SELECT) y salta si no hubo escrituras — medido: 370ms con cambios, 0ms sin cambios; detecta cualquier escritor y un reset de stats solo fuerza un refresh de más (dirección segura); edge function intacta. (D) AUDITORÍA GLOBAL de los 17 RPCs restantes del frontend (batch con clock_timestamp): get_pedidos_en_curso 39ms, inventory_grouped 23ms, get_sucursal_net_stock 20ms, get_pedido_kpis 8ms, inventory_inversion 5ms, get_product_branch_summary/get_ventas_con_puntos/get_pausa_razones_stats 3ms, get_product_trend 2ms, inventory_proximos_count/get_product_expiring_lots 1ms, get_product_last_sales 44ms — todo sano. PENDIENTES para siguiente pase (costo inherente, no plan genérico; módulo Pedidos a Sucursales): get_pedido_sucursal_stats 747ms y get_top_supplier_per_product 428ms; get_pedido_item_stats 196ms aceptable. Además seguir de cerca el mean de get_product_sales_total en producción (4 llamadas frías llegaron a 2.7s pre-fix; con pres_partial el caso badge ahora cuesta ~292ms server-side).

// v2.9.30 — perf(db): las 3 mejoras pendientes de la auditoría v2.9.29, solo BD (cero cambios de código cliente). (1) FIX ESTRUCTURAL — sales_invoice_items.factor_unidades (smallint): materializa el factor de presentación ("1X10"→10) que live_sales (get_stock_analysis) y sales_6m (get_stagnant_inventory) derivaban con regexp_match POR FILA en cada llamada; poblada por trigger BEFORE INSERT/UPDATE OF presentacion (fn_set_item_factor_unidades — cubre syncs, resyncs y heal sin tocar edge functions), backfill batched de las 549,171 filas verificado con 0 descuadres contra AMBAS variantes de regex usadas en el código; equivalencia del CTE viejo vs nuevo: 0 diferencias en 13,872 grupos sucursal×producto. Cirugía de índices en la tabla caliente (8→5): idx_sii_invoice_covering recreado CONCURRENTLY agregando factor_unidades al INCLUDE (mantiene descripcion/presentacion/cantidad/total_linea de las que depende get_product_sales_agg vía index-only scans, 62M usos); eliminados idx_sales_items_invoice (18MB, dominado por el covering), idx_sales_items_product e idx_sii_erp_product_id (ambos dominados por idx_sii_product_invoice) — menos mantenimiento de índices en cada INSERT del sync. Resultado: MinMax sucursal 402→303ms end-to-end. (2) MinMax BODEGA 1,377→776ms end-to-end (el peor caso del portal, resuelto por factor+covering sin necesidad de MV). Sin-venta global baja además a 1,108ms (de 9,084 original). (3) get_pedido_sin_bodega 700→319ms (2.2×): mismo diagnóstico de plan genérico que get_puntos_canjeados (v2.9.29) pero la query es demasiado compleja para un fence puntual — convertida a plpgsql con SET plan_cache_mode=force_custom_plan (planea con los valores reales en cada llamada; SQL del cuerpo INTACTO — la lógica delicada de inv_dedup/factores/dispatch no se tocó); salida verificada idéntica: 964 items, 0 diferencias elemento a elemento en ambas direcciones. Además: advisor de seguridad sigue en 0 ERRORES; se cerraron los EXECUTE de authenticated sobre refresh_sales_daily_stats/refresh_product_sales_monthly_agg (solo service_role — son cron-only, pg_cron corre como postgres). Verificado con Playwright contra build de producción: MinMax carga 4,226 productos con el get_stock_analysis nuevo. Migraciones: sii_factor_unidades_column_trigger, stock_analysis_stagnant_use_factor_unidades, stagnant_sales_6m_use_factor_unidades, pedido_sin_bodega_custom_plan.

// v2.9.29 — perf(db): auditoría completa de consultas con pg_stat_statements + EXPLAIN ANALYZE, a pedido del usuario ("¿es lo más eficiente? /ventas?tab=productos es lenta; auditoría completa, bajar tiempos respetando datos reales e íntegros"). 5 FIXES aplicados, todos con verificación de equivalencia de datos: (1) get_stagnant_inventory 9,084ms→1,356ms (6.7×): el CTE last_sale_all re-agregaba TODA la historia de sales_invoice_items (548K facturas) en cada llamada para derivar última venta por sucursal×producto — reemplazado por product_last_sale (mantenida por trigger fn_update_product_last_sale); equivalencia verificada fila a fila: 0 diferencias reales en 3,403 filas globales + 110 de sucursal (los únicos deltas del EXCEPT eran orden arbitrario de empates dentro de jsonb_agg; los 6 descuadres de product_last_sale vs historia viva son erp_product_id=0, basura ERP que la función nunca devuelve). (2) get_puntos_canjeados 923ms→12ms (75×), y se llama 2 veces por carga de Ventas: las funciones LANGUAGE sql planean con PARÁMETROS GENÉRICOS — los patrones (p_branch_id IS NULL OR ...) hacían que el plan genérico escaneara todos los items del rango en vez de partir de las ~740 líneas de puntos (erp_product_id=0, literal sin parámetros) de toda la historia; fix: CTE MATERIALIZED como fence que fija el orden items→invoices-por-PK; montos verificados idénticos ($28.56 jul-todas, $79.30 jun-suc27). LECCIÓN GENERAL: si un RPC es lento pero su SQL inline es rápido, es el plan genérico — medir ambos. (3) get_product_sales_agg_jsonb reescrito json_agg/RETURNS json (mismo fix v2.9.28) + nuevo get_product_sales_total(fini,ffin,branch): el badge "% vs período anterior" de Ventas→Productos descargaba el dataset COMPLETO del período anterior (~1.1MB medido) solo para sumar neto en el cliente — ahora suma server-side sobre la misma función (27 bytes; misma fuente ⇒ totales consistentes garantizados). (4) refresh_sales_daily_stats y refresh_product_sales_monthly_agg hacían DELETE+INSERT completo de su ventana cada 15 min (2.8s y 4.5s por corrida, ~4,759 corridas c/u desde mayo) — el cron de daily pasaba ¡365 días! y el de monthly reescribía 3 meses de agregados inmutables (verificado: la corrida condicional retorna 0 escrituras en régimen); reescritos con el patrón anti-churn de v2.9.27 (DELETE por diferencia de keys + upsert IS DISTINCT FROM), idempotencia verificada (run1/run2: 3/0 y 0/0). Crons recalibrados: daily-stats cada 15 min con ventana de 3 días + full 365 diario 06:20 UTC (job nuevo refresh-sales-daily-stats-full); monthly-agg de */15 a hourly (min 7); vacuum-inventory-10min y vacuum-products-30min → hourly (el churn que los justificaba murió en v2.9.27). (5) pg_stat_statements RESET 2026-07-09 01:57 UTC como baseline limpio post-fixes (los datos previos mezclaban la era RLS-por-fila y los patrones chunked viejos). MEDIDO Y SANO (no tocado): get_ventas_stats 8ms, get_vendedores_resumen 41ms, get_product_drill_lines 24ms, get_products_sold_no_minmax 262ms, get_inventory_cost_summary 34ms, get_draft_cost_estimate 18ms, get_product_sales_agg 305-373ms (mes completo). PENDIENTE ANOTADO: get_pedido_sin_bodega 700ms (lógica delicada de dedup/factores, no se tocó); get_stock_analysis bodega 1.38s (pre-agregar si molesta); live_sales/sales_6m con regex sobre presentacion (~170-300ms, materializar factor en sales_invoice_items al sync sería el fix estructural). Verificado con Playwright contra build de producción: Ventas→Productos carga con badge -71.6% vs período anterior desde el RPC nuevo, MinMax intacto.

// v2.9.28 — perf(minmax): carga de MinMax en UNA sola llamada, sin cap de 1000 filas y ~5× menos tiempo de servidor. El patrón anterior (v2.2.74/75: get_stock_analysis_count + N chunks .range() en paralelo) RE-EJECUTABA get_stock_analysis completa una vez por chunk porque PostgREST aplica limit/offset SOBRE el resultado de la función (~6 ejecuciones × ~311ms-1.2s por load, por usuario). Nuevo RPC get_stock_analysis_jsonb(p_erp_sucursal_id) — Patrón C del CLAUDE.md: una única ejecución agregada a JSON, el cap de max-rows no aplica a escalares. HALLAZGO medido con EXPLAIN ANALYZE: la primera versión con jsonb_agg tardaba 1,963ms en caliente (construir 4.6MB de jsonb binario spillea a disco: temp read/written 578) vs 402ms con json_agg/to_json (texto, sin spill) — migración get_stock_analysis_json_agg_perf la reescribe RETURNS json (REVOKE PUBLIC/anon, GRANT authenticated/service_role, search_path fijo, STABLE). TabMinMax.loadData simplificado: Promise.all de 4 llamadas (rows+costos+draft+config) en vez de 2 fases con count+chunks. Verificado con Playwright contra build de producción: La Popular carga 4,226 productos (match exacto con count SQL), stats/matriz ABC×XYZ/borradores intactos. Peor caso Bodega (suc. 6): 1.38s server-side. get_stock_analysis_count queda sin callers en src/ (se conserva en BD). Además: meta.gs restaurado (había sido sobrescrito accidentalmente con notas de sesión — rescatadas en notas-auditoria-2026-07-08.md, sin trackear).

// v2.9.27 — perf(db/edge): eliminación estructural del write-churn de los syncs + limpieza final RLS, a pedido del usuario ("piensa a futuro, incorporaremos facturación; necesito el portal completamente fluido y eficiente"). Medición previa (pg_stat_user_tables): inventory con 23,786 filas vivas acumulaba 935 MILLONES de updates (el sync reescribía TODAS las filas cada minuto solo para bumpear synced_at, aunque nada cambiara — 13 ubicaciones × ~24K filas × 60/hora), products 160M updates y product_precios 32.7M (sync-products reescribía las ~8K filas cada 10 min solo por updated_at=now). Ese churn era el consumidor #1 del Disk IO budget (la alerta del dashboard), generaba WAL constante que el poller de Realtime debía decodificar (900+ min de CPU acumulados en queries wal->>), y forzaba el cron vacuum-inventory-10min. FIX (migración write_churn_reduction_and_rls_wrap_cleanup): (1) RPC sync_inventory_batch(erp_sucursal_id, is_vencidos, rows jsonb) — INSERT ON CONFLICT(sync_key) DO UPDATE ... WHERE IS DISTINCT FROM (solo escribe si cantidad/descripcion/presentacion cambió; lote/detalle/fecha_venc/producto forman parte del sync_key) + DELETE de stale por diferencia de sync_keys (ya no depende de bumpear synced_at por fila); SECURITY DEFINER, search_path fijo, EXECUTE solo service_role. sync-dte-sales v59 lo usa (una llamada por sucursal/área en vez de chunks de 200 + delete). VERIFICADO en producción: los syncs procesan ~14,000 filas ERP/minuto y escriben 0–44 (antes ~24,000/min) — reducción >99.8% de escrituras; inventory_sync_log sigue registrando cada corrida así que SidebarSyncStatus/SyncHealthBanner (frescura) no se afectan — leen del log, no de inventory.synced_at. (2) RPC upsert_product_precios_batch(rows jsonb) mismo patrón para product_precios; sync-products v28 lo usa; updated_at ahora solo se bumpea en cambios reales (verificado: no-op=0 escrituras, cambio real=1; nada en src/ ni funciones DB consume product_precios.updated_at). (3) Se envolvieron en (SELECT ...) las 29 policies de ESCRITURA que quedaban con llamadas auth_* desnudas (DO block con regexp_replace + ALTER POLICY sobre lista explícita: branches, dispatch_rules, employees_insert, lab_locations, mmcr_insert, overtime_bank, product_active_principles, product_categories, promotions×5, role_permissions×3, roles_delete, shifts_delete, stock_config, survey_responses) — verificación posterior: 0 policies sin wrapper en todo public. NOTA de la sesión: durante la prueba del RPC de precios se escribió un costo ficticio (99999.99) en product_precios id=20705099 (product 5197/pres 9); se restauró disparando sync-products manualmente (el ERP es fuente de verdad). Impacto esperado: Disk IO budget deja de consumirse, CPU baja del churn base, autovacuum de inventory casi ocioso, y headroom real en la instancia Micro para el módulo de facturación.

// v2.9.26 — fix(db/rls-perf): CPU 65→78% (7-8 jul), "Disk IO budget consumed", MinMax sin cargar y todo el portal lento. CAUSA RAÍZ: las policies RLS creadas/reescritas el 6-8 jul (branch_rls_*, scope_aware_*, minmax_cross_module, granular_ver_costos) llamaban `auth_has_module_permission()`/`auth_module_scope()`/`auth_employee_branch_id()`/`auth_can_edit_any()` SIN envolver en `(SELECT ...)` — Postgres evalúa una función desnuda en el qual POR FILA aunque sea STABLE (el HOTFIX del 6 jul envolvió el auth.uid() DENTRO de los helpers, pero no las llamadas a los helpers en las policies; el advisor de Supabase tampoco lo detecta porque solo linta auth.uid() directo). Cada llamada consulta employees + role_permissions ⇒ en sales_invoices (548K filas) medido con EXPLAIN ANALYZE y sesión simulada (SET ROLE authenticated + JWT del rol Jefe/a de Compras): count() de las 27K facturas de junio = 25,078ms y 493,466 buffer hits ANTES vs 19.6ms y 4,860 buffers DESPUÉS (~1,280× más rápido; el plan pasa de Filter con 6 llamadas por fila a 7 InitPlans evaluados una vez). El timeline encaja exacto: policies desnudas aplicadas la noche del 6 jul → primer día hábil (7 jul) CPU 65%; el 8 jul se reescribieron igual de desnudas y se sumaron más ramas OR (v2.9.23/24) → 78%+ y el panel de MinMax (purchase_receipts/sales_invoices vía esas policies) dejó de cargar. FIX (migración fix_rls_initplan_hot_tables_wrap_helpers, aplicada con el nuevo estándar SET lock_timeout='5s', entró al primer intento en horario): reescritas con wrapper `(SELECT ...)` las 4 policies SELECT calientes (sales_invoices_select, purchase_receipts_select, purchase_receipt_items_select, sync_log_admin_read) + psp_insert/psp_update de product_stock_params (publicación masiva de MinMax), semántica y roles idénticos. Quedan ~20 policies de escritura (INSERT/UPDATE/DELETE) con llamadas desnudas en tablas chicas de escritura fila-a-fila (branches, promotions, dispatch_rules, roles, shifts, stock_config, etc.) — impacto insignificante, anotadas como limpieza pendiente. Regla nueva en CLAUDE.md §3: toda llamada auth_* en policies SIEMPRE envuelta en (SELECT ...).

// v2.9.25 — fix(edge/sync-dte-sales) + docs(post-mortem outage 2026-07-08): investigación urgente del reporte "no funciona nada" (todas las peticiones a Supabase fallando en Safari con "Fetch API cannot load ... due to access control checks" / "TypeError: Load failed", 15:52 y 16:00 UTC). DIAGNÓSTICO del outage: NO fue CORS ni un bug del frontend — las migraciones RLS de v2.9.23/24 (aplicadas 15:48–15:56 UTC, en horario) hacen DROP/CREATE POLICY sobre sales_invoices/purchase_receipts, que requieren lock ACCESS EXCLUSIVE; esas tablas reciben escrituras CADA MINUTO de los crons sync-dte-sales (6 sucursales DTE + 7 inventario, corridas concurrentes de 5-18s) más lecturas largas de analytics, así que la migración se encoló esperando el lock, toda consulta posterior a esas tablas se encoló detrás, el pool de conexiones se agotó y Auth/PostgREST empezaron a devolver 500/504 ("timeout: context deadline exceeded" en logs de GoTrue 15:55) — las respuestas 504 del gateway no llevan headers CORS, por eso Safari lo reporta como "access control checks" (mensaje engañoso). El servicio se recuperó SOLO al terminar las migraciones (~16:02; a las 16:03 ya había tráfico Safari/Mac exitoso con 200). Verificado ahora: proyecto ACTIVE_HEALTHY, preflight CORS 200 con headers correctos, REST 200 con anon key, 0 locks/0 transacciones colgadas, tráfico normal. PROTECCIÓN: nueva regla crítica en CLAUDE.md — toda migración DDL debe llevar `SET lock_timeout = '5s'` (si no consigue el lock, falla y se reintenta en vez de congelar producción) y el DDL sobre tablas calientes preferir la ventana 06:00–11:59 UTC en que los crons de sync están inactivos. BUG REAL ADICIONAL encontrado durante la investigación (activo, error en logs de Postgres cada minuto desde hace un mes): sync-dte-sales consultaba `presentaciones.descripcion`, columna eliminada el 2026-06-08 (migración drop_presentaciones_descripcion) — el error se ignoraba en silencio (`const { data } = await ...` sin chequear error), el presLookup quedaba vacío y `sales_invoice_items.id_presentacion` se insertaba NULL (confirmado: las 548,172 filas están NULL; ningún RPC lo consume funcionalmente — solo get_product_drill_lines lo pasa a la UI tolerando NULL; el match real de presentación se hace por texto contra product_precios). Fix desplegado (edge function v58): eliminado el lookup muerto y el parámetro presLookup de syncBranch; id_presentacion queda NULL explícito documentado como legacy. Regla nueva en CLAUDE.md: nunca ignorar el `error` de queries supabase-js en edge functions, y al eliminar/renombrar columnas grepear también supabase/functions/ (no solo src/).

// v2.9.24 — refactor(db/rls) + feat(permissions): a pedido del usuario, reemplaza el atajo amplio de v2.9.23 ("tener `minmax`=ALL desbloquea costos de compra/venta") por un permiso dedicado y granular, siguiendo el mismo patrón ya usado para tabs/widgets (`minmax_tab_solicitudes`, `dash_top_productos`, etc.) — así un admin decide rol por rol quién ve costos/proveedores sin depender de si ese rol tiene o no el módulo completo de Compras/Ventas/MinMax. Nuevos permisos en `PermissionsView.jsx`: `minmax_ver_costos` (tab bajo Min/Max: "Ver Costos (Compras/Ventas)") y `productos_tab_catalogo_costos` (tab bajo Productos: "Catálogo: Costos de Compra") — este último resuelve el caso que se había dejado pendiente en v2.9.23 (el historial de compra embebido en el detalle de producto del Catálogo, que antes hubiera requerido exponer costos a los ~20 roles que ya tienen acceso al tab Catálogo). RLS: `purchase_receipts_select`/`purchase_receipt_items_select` ahora aceptan `minmax_ver_costos` O `productos_tab_catalogo_costos` como ruta alterna (además de `compras` completo); `sales_invoices_select` acepta `minmax_ver_costos` (reemplaza el `minmax` genérico) manteniendo `dash_top_productos` sin cambios. Semilla: se otorgó el nuevo permiso a Gerente General, Administrador y Supervisor/a de Ventas (ya lo veían por tener `compras`+`ventas` completos) y a Jefe/a de Compras y Logística (el rol que reportó el bug original) — cualquier otro rol queda en false, ajustable desde Permisos de Acceso. Frontend: `TabMinMax.jsx` (`ExpandedPanel`) y `TabCatalogo.jsx` (`ExpandedProductRow`/`PurchaseHistorySection`) ahora verifican el permiso antes de disparar las consultas y muestran "Sin permiso para ver costos de compra" en vez de un falso "sin datos" cuando el rol no lo tiene. Verificado con simulación de sesión (SET ROLE authenticated + JWT) para el rol reportado: sigue viendo filas reales tras el cambio de permiso amplio→granular.

// v2.9.23 — fix(auth) + fix(db/rls): a pedido del usuario, valida 2 reportes tras las correcciones mayores de sesiones pasadas. (1) BUG REAL en `AuthContext.jsx`: `completeLogin` y `completePasswordChange` calculaban `su = await withSignedPhoto(u)` (URL firmada correcta, bucket de fotos es privado) y la guardaban bien en localStorage, pero llamaban `setUser(u)` con el objeto SIN firmar — el estado React (y por tanto el avatar en UserHeader/EmployeeProfileView/EmployeeHomeView, ninguno con `onError`) quedaba con la foto cruda (403 en bucket privado) hasta el próximo reload, que sí hidrataba bien desde localStorage. Afecta sobre todo el login por escaneo de carné (`login()` → `completeLogin`, flujo principal hoy). Corregido: `setUser(su)`/`startIdleWatcher(su)` en ambas funciones. (2) BUG REAL de RLS confirmado con simulación de sesión (SET ROLE authenticated + JWT de la empleada): el panel "Últimas compras / Últimas ventas" embebido en MinMax (`TabMinMax.jsx`) lee `purchase_receipts`/`purchase_receipt_items` (RLS exige módulo `compras`) y `sales_invoices` (RLS exige módulo `ventas`), pero MinMax en sí se gatea por el módulo `minmax` — un rol con `minmax=ALL` pero sin `compras`/`ventas` (Jefe/a de Compras y Logística, exactamente el rol reportado) veía el panel completamente vacío por RLS, no por falta de datos (confirmado: 0 filas visibles vs. datos reales sincronizados hasta el día anterior). Mismo patrón afectaba el widget "Top productos del mes" del Dashboard (permiso dedicado `dash_top_productos`, otorgado también a Auxiliar de Bodega) contra `sales_invoices`. Auditados TODOS los `auth_has_module_permission` de la BD (grep de `pg_policies`) buscando más casos del mismo patrón (módulo embebido ≠ módulo que gatea el permiso de UI): se descartó `productos_tab_catalogo` → `purchase_receipt_items` porque ese permiso lo tienen ~20 roles (casi toda la empresa) y ORear ahí expondría costos/proveedores de compra a todo el mundo — se deja pendiente de decisión explícita del usuario, no es un fix seguro por defecto. `dash_annulment_req`/`dash_facturacion`/`dash_cotizaciones` no tienen impacto activo hoy (todo rol que los tiene ya tiene `ventas`/`cotizaciones` también) — quedan anotados para revisar si se asignan a un rol nuevo sin el módulo base. Fix aplicado (migración `minmax_cross_module_purchase_sales_visibility`): las policies `purchase_receipts_select`, `purchase_receipt_items_select` y `sales_invoices_select` ahora aceptan `minmax` (y `sales_invoices_select` también `dash_top_productos`) como ruta alterna de lectura, cada una respetando su propio scope (ALL/BRANCH) — no se tocó el permiso `compras`/`ventas` de ningún rol, solo se le enseñó a la RLS que MinMax/el widget de Top Productos son consumidores legítimos. Verificado con simulación de sesión: la empleada afectada y el Auxiliar de Bodega ahora ven filas reales en ambas tablas.

// v2.9.22 — fix(ux/global) + fix(personal/ficha-médica): a pedido del usuario, dos cambios. (1) BUG REAL de posicionamiento en `LiquidSelect.jsx` (componente compartido, usado en TODO el proyecto) — la posición del dropdown se calculaba UNA sola vez al abrir (`getBoundingClientRect` en el click) y se forzaba el cierre ante CUALQUIER scroll de la página vía `window.addEventListener('scroll', handleScroll, true)` (capture:true captura el scroll de cualquier elemento anidado en toda la página, no solo el contenedor del select). Esto producía exactamente lo reportado: si el trigger vivía dentro de un bloque recién montado con animación de entrada (`animate-in zoom-in-95`, patrón usado en todo el proyecto para campos condicionales — ej. Tipo/Grado de Discapacidad al marcar el checkbox), un click durante esos ~200ms capturaba el rect a mitad de la animación y el dropdown quedaba flotando en una posición vieja, desconectado del trigger real (confirmado con el screenshot del usuario: el dropdown de "Grado" — Leve/Moderada/Severa — aparecía junto a "Tipo de Sangre", ~500px arriba de su trigger real). Además, cualquier scroll en OTRA parte de la página cerraba un select recién abierto, percibido como "no abre" o "se oculta". Corregido con seguimiento continuo de posición: un loop de `requestAnimationFrame` recalcula el rect en cada frame mientras el dropdown está abierto (mismo enfoque que Popper/Floating UI), así el dropdown sigue al trigger en vivo pase lo que pase (animación, scroll, resize de hermanos), con un ref de comparación para no re-renderizar si la posición no cambió; el listener de scroll agresivo se eliminó — ahora solo se cierra si el trigger deja de estar visible en el viewport. (2) En "Enfermedad Crónica / Condición Médica", cada condición ya agregada se mostraba como un `<select>` permanente en vez de un valor fijo — a pedido del usuario, ahora una condición ya elegida se colapsa a una mini-pill (label + botón × para quitar) y el select solo se muestra para la condición que aún se está eligiendo (recién agregada, o "Otra..." sin texto todavío). Verificado en vivo con Playwright: se agregaron 2 condiciones (Diabetes Tipo 2, Asma) — ambas colapsan a pills correctamente y el dropdown de búsqueda abre pegado a su trigger (confirmado con el fix de posicionamiento); sin guardar cambios reales sobre el empleado de prueba.

// v2.9.21 — fix(personal/ficha-médica): 6 ajustes puntuales a pedido del usuario sobre lo agregado en v2.9.20. (1) Enfermedad Crónica ahora es una lista (0..N condiciones) en vez de un solo valor — un empleado puede tener varias a la vez; columna `employees.chronic_condition` (text) reemplazada por `chronic_conditions` (jsonb array, mismo patrón que additional_skills/economic_dependents), migración `employees_chronic_condition_to_array` (0 filas usaban la columna vieja, migración limpia). (2) BUG REAL encontrado y corregido en el componente compartido `LiquidSelect.jsx`: el botón "Todos" (clearLabel) para limpiar la selección aparecía en selects opcionales aunque no hubiera nada seleccionado — causa: la condición de visibilidad comparaba `value !== ''`, pero un empleado existente recién migrado trae `null` (no `''`) en un campo nunca tocado, y `null !== ''` es `true` en JS — el botón se mostraba igual. Corregido a `value != null && value !== ''`; también se optó por dejar Tipo de Discapacidad y Grado como campos no-clearable (mismo patrón que Especialidad/Profesión, ya que ahora son requeridos — ver punto 6), lo que además evita mostrar "Todos" ahí. (3) El checkbox "Cuenta con certificación" se movió a ser la 3ª columna junto a Tipo/Grado (antes era una fila aparte a ancho completo) — mismo bloque de Discapacidad ahora ocupa menos alto. (4) Teléfono de Emergencia se movió a 3ª columna junto a Avisar a/Parentesco (antes fila aparte). (5)/(6) Tipo de Discapacidad y Grado: solo pueden seleccionarse si "¿Tiene alguna discapacidad?" está activado (ya era así por render condicional) y ahora son obligatorios en ese caso — badge "Requerido" + bloquean Guardar vía `isFormFullyValid` cuando `has_disability=true` y falta cualquiera de los dos (o "Otra..." sin especificar). `employees_safe` recreada de nuevo en la misma migración con la columna renombrada (72 columnas). Verificado en vivo con Playwright: catálogo de Enfermedad Crónica permite agregar 2+ condiciones con selects independientes, "Todos" ya no aparece en ningún dropdown de esta sección, badges "Requerido" visibles en Tipo/Grado al activar Discapacidad, certificación y teléfono ya en su columna corta — sin guardar cambios reales.

// v2.9.20 — feat(personal/ficha-médica): a pedido del usuario, tras separar Tipo de Sangre del Contacto de Emergencia (subtítulos propios ahora, ya no parece que el tipo de sangre es de la persona a avisar), investigación del Código de Trabajo (Art. 30: el patrono no puede asignar trabajo físico incompatible a un trabajador con enfermedad crónica incapacitante en tratamiento, y debe igualdad salarial/de trato para personas con discapacidad) + research en vivo de CONAIPD (conaipd.gob.sv) confirmando que la certificación de discapacidad hoy la emite ISRI o ISSS (el carné único de CONAIPD aún no está implementado) y que "Leve/Moderada/Severa" es la escala de grado usada en El Salvador. Agregado: (1) "Enfermedad Crónica / Condición Médica" — catálogo estandarizado (no texto libre, mismo patrón de profesiones/especialidades: CatalogSelect + "Otra..." que se auto-registra) en `education_catalog_entries` categoría ENFERMEDAD_CRONICA, 20 valores sembrados. (2) "Discapacidad" — checkbox que revela Tipo (catálogo TIPO_DISCAPACIDAD, 6 valores: Física o Motora/Visual/Auditiva/Intelectual/Psicosocial/Múltiple, + Otro) y Grado (Leve/Moderada/Severa, escala fija) + checkbox "Cuenta con certificación de discapacidad (ISRI/CONAIPD)" que agrega un slot nuevo en Documentos para anexar el carné/certificación, igual patrón que Licencia de Moto/Carro. Nuevas columnas employees.chronic_condition/has_disability/disability_type/disability_grade/disability_has_certification (migración `employees_add_medical_condition_and_disability_fields`, 0 errores nuevos en advisors). BUG REAL encontrado y corregido de paso: `employees_safe` (la vista que alimenta el listado principal de Personal, fetchBoot) resultó NO ser `SELECT *` como decía la memoria del proyecto — es una lista explícita de columnas que quedó desactualizada otra vez, esta vez faltando `nursing_license_number`/`pharmacist_license_number` (agregadas en v2.8.0, migración `add_nursing_and_pharmacist_license_number` del mismo día, después del fix de columnas stale de esa mañana). Se corrigió la vista completa (72 columnas) en la misma migración; memoria del proyecto actualizada para reflejar la realidad (columnas explícitas, no SELECT *) y evitar que se vuelva a asumir lo contrario. Verificado en vivo con Playwright: build limpio, catálogos de Enfermedad Crónica y Tipo de Discapacidad muestran los valores sembrados reales en el select, el toggle de Discapacidad revela/oculta Tipo+Grado+certificación correctamente, y al marcar la certificación aparece el slot "Certificación de Discapacidad — ISRI / CONAIPD" en la pestaña Documentos — sin guardar cambios reales sobre el empleado de prueba.

// v2.9.19 — fix(personal/ux): a pedido del usuario, en Ficha Médica y Emergencia el campo de contacto de emergencia decía en el placeholder "Familiar o Pareja" (sugería un tipo de relación, no lo que se debía escribir) y el label redundaba "(Nombre)". Ahora label="Avisar a", placeholder="Nombre".

// v2.9.18 — feat(personal/orden) + fix(personal/dependientes-validación): a pedido del usuario, en el modal de Empleado, la sección "Vehículo y Acreditaciones" ahora aparece justo debajo de "Nivel Académico" (antes iba después de Ficha Médica y Emergencia, al final de la pestaña Personal). Además, la edad manual agregada en v2.9.17 para "Personas que Dependen Económicamente" ahora se valida de verdad: entero entre 0 y 120, sin decimales ni negativos — bloquea Guardar (`isFormFullyValid`) con badge rojo "Requerido"/"0-120" igual que el resto del formulario, y employeeSlice.js lanza error explícito si de algún modo llega inválido al guardar. Extraída la lógica de "modo edad" (`isDependentAgeOnly`/`isDependentAgeInvalid`/`getDependentAge`) a `src/utils/economicDependents.js`, compartida entre el modal y el store — cierra la duplicación que /code-review había señalado en v2.9.17 (cliente y servidor ya no pueden divergir en qué cuenta como "edad válida").

// v2.9.17 — feat(personal/dependientes): a pedido del usuario, en el modal de creación/edición de empleado, sección "Personas que Dependen Económicamente", ahora se puede alternar entre "Fecha de Nacimiento" exacta y solo la "Edad" en años cuando no se conoce la fecha (link "No sé la fecha" / "Ingresar fecha" junto al label). `economic_dependents` (JSONB) gana los campos `age` y `age_only`, poblados solo cuando no hay `birth_date`; `normalizeEconomicDependents` en employeeSlice.js los persiste (age_only guardado explícitamente, no re-derivado en cada carga). Sin migración de BD (columna JSONB, sin esquema fijo). /code-review encontró y corrigió en la misma sesión: bug de "cero falsy" (`parseInt(age) || null` descartaba silenciosamente edad=0 de un bebé, tanto al guardar como al mostrar) y un guard de NaN inconsistente entre cliente/servidor para el estado age_only — ambos alineados.

// v2.9.16 — fix(ventas/cache): el usuario seguía viendo "1000 productos" en /ventas?tab=productos después del fix de v2.9.15 — causa real: el caché de localStorage (`ppv2_...`, 20 min de vida) guardaba resultados escritos ANTES del fix, con los datos truncados a 1000, y como seguía "vigente" se servía sin volver a pedir nada — el fix del RPC nunca se ejecutaba mientras el caché viejo no expirara. Bump de la key a `ppv3_` para invalidar cualquier entrada vieja sin depender de que el usuario borre localStorage a mano; la limpieza automática ahora purga TODA entrada `ppv2_` que encuentre (no solo por TTL) y sigue limpiando `ppv3_` vencidas normalmente. Verificado en vivo: planté una entrada `ppv2_` falsa con datos truncados — la app la ignoró, hizo el fetch paginado completo (5 llamadas de red), y purgó la entrada vieja dejando solo la `ppv3_` fresca.

// v2.9.15 — fix(ventas/cap1000): a pedido del usuario ("en la tab de productos de ventas veo que dice 1000 productos, evalúa que no tenga el límite ya conocido") — confirmado real: `get_product_sales_agg` no pagina server-side y `VentasView.jsx` la llamaba con `.range(0,999)` fijo. Con 1,618 productos vendidos solo en julio (sin filtrar sucursal), el cap de PostgREST ya se estaba activando: se ocultaban 600+ productos reales (los de menor rotación, por el `ORDER BY neto DESC` del RPC) sin ningún aviso — y probablemente más al incluir los productos con stock pero cero ventas que la misma consulta agrega al final. Reemplazado por `fetchAllRows` (mismo helper de `src/utils/supabaseUtils.js` usado en TabInventario desde v2.9.1) — pagina hasta agotar el resultado real. De paso, unificado el cálculo de "período anterior" (`prevProdStats`) que ya tenía un loop manual idéntico escrito a mano — ahora usa el mismo helper, elimina la duplicación. Verificado en vivo: la red ahora muestra múltiples llamadas paginadas (`offset=0`, `offset=1000`, `offset=2000`) hasta agotar los datos reales, tabla y totales ($38,875.53/$12,898.11/33.2%) calculados sobre el dataset completo. Auditoría del mismo patrón en el resto del código: encontrado y corregido un segundo caso real en `fetchStats` (la suma/puntos de facturas con filtro especial —anuladas/antibiótico/búsqueda— se calculaba solo sobre las primeras 1000 aunque el conteo mostrado sí fuera exacto); revisados todos los demás usos de `count:'exact'` en el proyecto (ComprasView, TabReglas, TabCatalogo, etc.) — todos ya paginan correctamente con `.range()` por página, sin bug. `TabMinMaxRequests.jsx` tiene un `.limit(1000)` sin paginar pero la tabla real solo tiene 2 filas hoy — no representa un riesgo actual, no se tocó.

// v2.9.14 — fix(seguridad-CRÍTICO): HOTFIX de performance — todas las policies escritas en esta sesión desde announcements en adelante (anuncios, minmax_change_requests, approval_requests, attendance, employees/employee_branches, payroll_entries, sales_invoices, cotizaciones, vacation_plans, employee_rosters, y las 14 tablas de pedidos/compras/rutas de v2.9.13) llamaban a `auth_has_module_permission()`, `auth_module_scope()`, `auth_employee_branch_id()`, `auth_employee_erp_sucursal_id()` SIN envolver en `(select ...)` — el mismo problema de auth_rls_initplan ya corregido para `auth.uid()`/`auth.role()` en v2.9.2, pero no aplicado a estas funciones nuevas. Sin el wrapping, Postgres re-evalúa la función POR CADA FILA en vez de una sola vez (InitPlan). El usuario reportó la app lenta/rota después de v2.9.13 ("tarda demasiado en ventas, minmax no me aparece") — confirmado con EXPLAIN ANALYZE en producción: `sales_invoices` (2001 filas) pasó de 1561ms a 6.7ms al aplicar el fix (230x más rápido); un `count(*)` sin filtro sobre las 320k filas de la tabla, que antes colgaba indefinidamente (timeout), ahora completa en 1.6s (costo normal de escanear la tabla, ya no por-fila). Reescritas TODAS las policies con el wrapping correcto — mismo comportamiento/permisos, solo la forma de evaluación. Verificado en ambos sentidos: Fernando Oliva (sin permiso) sigue viendo 0 facturas; Edwin (admin) sigue viendo todo, ahora en milisegundos. MinMax se probó a fondo con navegación real (clic en sidebar, no recarga de URL) y funciona correctamente — la apariencia "vacía" reportada coincide con el mismo hipo de red transitorio que afectó TODO en la captura del usuario (incluso `/auth/v1/user`, nunca tocado), confirmado por logs de API/auth sin errores reales en ese momento.

// v2.9.13 — fix(seguridad): auditoría a fondo de `pedidos` + 14 tablas relacionadas (pedido_items, pedido_sucursal_status, pedido_item_eventos, pedido_pausa_historial, pedido_recepcion_extras/firmas, pedido_apoyo, pedidos_snapshots, purchase_receipts/receipt_items/sync_log, rutas, ruta_pedidos, ruta_locations) — TODAS tenían SELECT (y varias INSERT/UPDATE) `USING(true)`, igual que ventas/cotizaciones en v2.9.12. Confirmado con datos reales: "Dependiente de Farmacia" (22 empleados, 47% de la compañía, scope=BRANCH) y "Jefe/a de Sala" (6 empleados, scope=BRANCH) tienen `pedidos.can_edit=true` — veían y podían escribir pedidos de TODAS las sucursales cuando su scope decía que debía ser solo la propia. `pedidos`/`pedidos_snapshots` usan `sucursal_ids` (array, un pedido puede despachar a varias sucursales) con containment `ANY()`; el resto usa `erp_sucursal_id` escalar resuelto vía nuevo helper `auth_employee_erp_sucursal_id()` (traduce mi sucursal interna → id ERP vía `erp_sucursal_map`). `rutas`/`ruta_pedidos`/`ruta_locations` usan el permiso separado `pedidos_tab_rutas`, que en la práctica siempre es scope=ALL (ver la ruta completa no es sensible por sucursal). La mayoría de estas tablas NO tenían policy de INSERT/UPDATE en absoluto (los flujos pasan por RPCs SECURITY DEFINER) — esas ya estaban correctamente cerradas, no se tocaron. NOTA: esta migración introdujo el bug de performance corregido en v2.9.14 — ver esa entrada.

// v2.9.12 — fix(seguridad): a pedido directo del usuario ("necesito que el sistema sea seguro... si un usuario no tiene permiso ni acceso a algo, no pueda verlo") — endurecidas 5 tablas que tenían SELECT/ALL literalmente `USING (true)` para cualquier autenticado, sin revisar ni siquiera el permiso can_view del módulo (no era el bug de scope de v2.9.10/11, era la ausencia total de permiso). `sales_invoices` (320,231 filas reales — datos financieros) y `cotizaciones` ahora exigen `can_view`/`can_edit` del módulo + `scope` de sucursal; verificado en vivo: un empleado sin el permiso pasó de ver 2,001 facturas reales a 0, el admin (scope=ALL) sigue viendo todo igual. `vacation_plans`, `employee_rosters` y `attendance` (lectura) preservan además el acceso a "mi propio registro" — y `employee_rosters` también "compañeros de mi misma sucursal" — porque EmployeeHomeView/EmployeeScheduleView/EmployeeProfileView los leen directo en self-service (así funciona "quién trabaja hoy" y "mis vacaciones" sin el permiso admin); `vacation_plans` también preserva el acceso vía permiso `payroll` (payrollSlice lee vacaciones de todos los empleados para nómina). Verificado en vivo con RLS simulado: Fernando Oliva (sin permisos, sucursal Bodega) ve su propio roster/vacaciones/asistencia y el roster de un compañero de SU sucursal, pero NO el de un empleado de otra sucursal ni la asistencia de sus compañeros (solo la propia). Build + Playwright: admin recorre ventas/cotizaciones/vacation-plan/schedules/monitor/payroll sin errores. Pendiente (fuera de esta sesión, deliberadamente): `pedidos` y sus ~15 tablas relacionadas — mismo patrón de `USING(true)`, pero CLAUDE.md marca ese flujo como crítico de no romper; requiere sesión dedicada con el mismo rigor de verificación.

// v2.9.11 — fix(seguridad): auditoría completa del patrón "bypass ignora scope" en TODAS las policies que usan auth_has_module_permission (no solo announcements). BUG ACTIVO confirmado y corregido en `minmax_change_requests`: Cendy Quintanilla (Jefe/a de Compras y Logística, scope='BRANCH', can_approve=true, sucursal Bodega) veía y podía decidir solicitudes de MinMax de CUALQUIER sucursal — verificado en vivo antes/después del fix (antes: veía ambas; después: solo la suya). Mismo mecanismo aplicado (aunque sin rol activo explotándolo hoy, para que el bug no reaparezca al configurar un rol así) a `approval_requests` (vía employees.branch_id del solicitante), `attendance` (ídem), `employees`/`employee_branches` (branch_id directo o vía employee_id), y `payroll_entries` (ya tenía fallback branch-aware, pero el primer OR seguía bypaseando). A pedido directo del usuario, tras confirmar que Jefe/a de Compras y Logística SÍ necesita ver MinMax de toda la empresa (no solo su sucursal — compras/logística es una función cross-branch), se cambió `role_permissions.scope` de 'BRANCH' a 'ALL' para ese rol+módulo — ahora configurable correctamente desde Permisos (`/permissions`), donde el toggle de alcance por fin tiene efecto real en el RLS. Re-verificado en vivo: Cendy vuelve a ver ambas sucursales tras el cambio de scope.

// v2.9.10 — fix(seguridad): fix de MECANISMO, no solo de dato, para el bug de privacidad de v2.9.9 — el usuario preguntó directamente "¿modificaste el policy para que funcione según lo esperado?" y la respuesta era no: solo se había quitado el permiso a un rol puntual, pero las 4 policies de `announcements` (SELECT/INSERT/UPDATE/DELETE) seguían sin revisar `role_permissions.scope` — cualquier OTRO rol con `can_edit=true` y `scope='BRANCH'` habría tenido el mismo acceso total a la empresa (confirmado: 2 roles activos — Jefe/a de Sala, Jefe/a de Compras y Logística — están en esa combinación ahora mismo). Nuevo helper `auth_module_scope(module_key)` (lee `role_permissions.scope` para el rol actual, default 'ALL' si no hay fila) y las 4 policies ahora exigen `scope='ALL'` para el bypass total, o restringen INSERT/UPDATE/DELETE/SELECT-bypass a `target_type='BRANCH' AND target_value=mi sucursal` cuando `scope='BRANCH'` — la audiencia normal (GLOBAL/su sucursal/su rol/dirigido a él) sigue intacta para todos. Verificado en vivo con RLS simulado usando un editor scope=BRANCH real (Jefa de Sala, sucursal 25): SELECT limitado a GLOBAL+su sucursal (ya no ve otra sucursal ni avisos de otro empleado), UPDATE sobre un aviso de otra sucursal bloqueado (0 filas), INSERT de un aviso GLOBAL rechazado por RLS con error 42501, INSERT en su propia sucursal permitido. Confirmado que un editor scope=ALL (Edwin, Supervisor/a de Ventas) sigue viendo todo sin cambios. Nota para el usuario: el mismo patrón (`scope` no revisado por RLS) existe en otros 24 módulos (`staff_list`, `requests`, `pedidos`, `ventas`, `minmax`, `schedules`, etc.) — no auditado en esta sesión, pendiente de revisión si se confirma el mismo riesgo ahí.

// v2.9.9 — fix(seguridad): BUG DE PRIVACIDAD real encontrado al validar el fix de avisos de v2.9.4 — el rol "Dependiente de Farmacia" (22 de 47 empleados activos, 47% de la compañía) tenía `can_view=true`/`can_edit=true` en `role_permissions` para el módulo `announcements`. La policy RLS usa ese permiso como bypass total de la audiencia (pensado para admins) — así que estos 22 empleados veían y podían crear/editar/borrar avisos de TODA la empresa, incluyendo avisos dirigidos a otras sucursales o a compañeros específicos. La fila tenía `scope='BRANCH'` (la intención original probablemente era limitarlos a su propia sucursal) pero la policy nunca chequea `scope`, así que en la práctica era acceso total. Confirmado en vivo con RLS simulado (empleado real de este rol veía un aviso de otra sucursal y uno dirigido a otro compañero) — a pedido directo del usuario, se retiran ambos permisos (`UPDATE role_permissions SET can_view=false, can_edit=false WHERE role_id=30 AND module_key='announcements'`). Ahora ese rol pasa al flujo self-service normal: solo ve GLOBAL/su sucursal/su rol/dirigidos a él. Re-verificado en vivo tras el fix: el mismo empleado ya NO ve el aviso de otra sucursal ni el dirigido a otro compañero — solo GLOBAL y el de su propia sucursal.

// v2.9.8 — perf(fetchBoot): completa el punto 9 de la auditoría — hallazgo real: `fetchBoot` descargaba el roster COMPLETO de la empresa (todos los empleados + eventos + documentos) para cualquier login, sin importar el permiso. Auditoría de las 4 vistas self-service que consumen `employees` (EmployeeHomeView, EmployeeProfileView, EmployeeRequestsView, EmployeeAnnouncementsView) confirmó que ninguna necesita más que (a) el propio registro y (b) compañeros de SU MISMA sucursal (para "quién trabaja hoy" y el picker de compañero en cambio de turno) — nunca otra sucursal, nunca `.history`/`.documents` de alguien más. Hoy 44 de 47 empleados activos (94%) no tienen `staff_list.can_view` y son 100% self-service. `fetchBoot` ahora resuelve ese permiso primero (una consulta chica a `role_permissions`, falla ABIERTO — carga todo — ante cualquier error de red o rol sin id, para nunca ocultarle datos a un admin por un hipo de conexión) y, solo si falta el permiso, escala `employees_safe` a `branch_id = mi sucursal` y `employee_events`/`employee_documents` a `employee_id = yo`. Simulado con un empleado self-service real (Fernando Oliva, sucursal 30): 4 empleados en vez de 47 (91% menos). Verificado en vivo: el camino admin (Edwin, `staff_list.can_view=true`) sigue sin filtro — "Empleados activos: 47" intacto en el Dashboard, request de red a `employees_safe` confirmado sin `branch_id`. `holidays`/`branches`/`roles`/`shifts`/`employee_rosters`/`employee_branches` quedan sin escalar (tablas chicas, sin problema de crecimiento). Build de producción limpio.

// v2.9.7 — perf(selectores): completa el punto 10 de la auditoría — 12 sitios en 11 archivos usaban `useStaff()`/`useStaffStore()` SIN selector (`const { a, b } = useStaff()`), suscribiendo el componente a la tienda COMPLETA — cualquier cambio en cualquier parte del estado global (una notificación que llega, un aviso marcado leído, etc.) forzaba un re-render aunque el componente solo necesitara 1-2 campos. Convertidos a selectores individuales (`const a = useStaff(s => s.a)`) en: `VentasView.jsx` (×2 sitios), `EmployeeDetailView.jsx`, `AttendanceAuditView.jsx`, `BranchDetailView.jsx`, `AnnouncementsView.jsx`, `AttendanceMonitorView.jsx`, `StaffManagementView.jsx`, `SchedulesView.jsx`, `TabShifts.jsx`, `InlineDayEditor.jsx` (envuelto en `memo` — el patrón anterior anulaba el memo por completo), `EmployeeRequestsView.jsx`. Sin cambio de comportamiento — mismos valores, misma forma de los datos, solo la granularidad de la suscripción. Verificado en vivo con Playwright: login + navegación por las 7 vistas tocadas, sin errores de consola nuevos (el único error observado, `[top_productos]` en `DashboardView.jsx:967`, es preexistente y de un archivo no tocado en este cambio). Build de producción limpio.

// v2.9.6 — fix(code-review): 2 bugs reales encontrados en /code-review del diff de la sesión de auditoría (v2.9.1-v2.9.5), ambos confirmados y corregidos. (1) El Suspense único de App.jsx envolvía tanto las rutas públicas como el AppLayout+rutas internas — al navegar entre vistas ya autenticado (ej. Dashboard→Ventas) con un chunk aún no cacheado, React reemplazaba TODO el subárbol del Suspense más cercano, no solo el contenido: el sidebar completo desaparecía y la pantalla de carga a full-screen tapaba todo. Agregado un segundo `<Suspense>` interno (`ContentLoadingFallback`, más liviano) alrededor de las rutas dentro de AppLayout — el sidebar ahora se queda montado durante la navegación. Verificado en vivo con Playwright: 6 rutas nunca visitadas, sidebar presente en cada una (polling cada 30ms tras cada navegación). (2) `deleteAllNotifications` (nuevo en v2.9.5) borraba TODO lo del destinatario al momento del commit (tras los 3s de deshacer), incluyendo notificaciones que llegaran por realtime DURANTE esa ventana — rompía el contrato explícito ya documentado en el archivo ("lo que llegue durante la ventana no se toca") que sí respeta el borrado individual. Ahora captura un `cutoff` (timestamp) al momento del click, antes de la ventana de deshacer, y solo borra hasta ese corte — mismo contrato que el borrado por IDs. Build de producción limpio.

// v2.9.5 — fix(notificaciones+solicitudes): 2 bugs confirmados de la auditoría, con OK explícito del usuario para el approach de cada uno. (1) "Borrar todas" en la campana solo borraba las ≤100 notificaciones cargadas (fetchNotifications pagina con .limit(100)) — las más viejas reaparecían en el siguiente fetch. Nueva acción `deleteAllNotifications` en notificationsSlice.js borra TODO lo del destinatario server-side (RLS ya limita a sus propias filas); la ventana de Deshacer de 3s sigue igual para lo visible. (2) Solicitudes con approver_id=null (cuando resolveApprover/resolveNextApprover no encontraban a nadie, o incluso cuando el fetch del propio empleado fallaba) quedaban invisibles para TODO aprobador, incluso admins — fetchRequests filtraba por eq('approver_id', miId), que nunca matchea null. Agregado `resolveFallbackApprover` (último recurso: cualquier empleado activo con role_permissions.can_approve=true en el módulo 'requests' — hoy solo "Supervisor/a de Ventas") que garantiza que createRequest NUNCA inserte approver_id null. Además, fetchRequests ahora usa `.or(approver_id.eq.X, approver_id.is.null)` como red de seguridad — RLS de approval_requests ya da acceso total a can_approve, así que esto no cambia permisos, solo evita que una huérfana futura quede oculta por el filtro de UI. Verificado: 0 solicitudes huérfanas existían en producción al momento del fix. Build de producción limpio.

// v2.9.4 — fix(avisos): BUG CRÍTICO confirmado y corregido — empleados sin permiso can_edit en announcements (o sea, todos los no-admin) no veían NINGÚN aviso GLOBAL, por ROL o dirigido a ELLOS (EMPLOYEE); solo BRANCH tenía intención correcta y tampoco funcionaba. Causas reales, las 4 confirmadas con test en vivo (RLS simulado con JWT, employee de rol sin can_edit): (1) la policy comparaba `target_type='ALL'` pero la app siempre escribe `'GLOBAL'` — nunca matcheaba; (2) la comparación de BRANCH usaba `target_value::text` (cast de jsonb, que preserva las comillas: `"3"`) contra un valor plano sin comillas (`3`) — jamás eran iguales aunque el target_type y la sucursal coincidieran; (3) ROLE comparaba el NOMBRE del cargo (lo que la app realmente guarda, ej. "Regente") contra `auth_employee_role_id()` (un id numérico) — comparación imposible por diseño, ahora resuelve el nombre vía join a `roles`; (4) no existía NINGUNA cláusula para EMPLOYEE — los avisos dirigidos a una persona específica eran invisibles para ella. Además, `auth_employee_branch_id()` no tenía el fallback por username/code que sí tienen sus funciones hermanas — los logins por carné (@staff.local) nunca resolvían su sucursal; agregado. Verificado en vivo con RLS simulado (JWT + rol sin can_edit): las 4 combinaciones MATCH visibles, las 3 NOMATCH correctamente ocultas. Además se corrigió el mismo patrón de bug duplicado en 5 lugares del cliente (useSyncMonitor, NotificationBell, AppLayout, EmployeeAnnouncementsView, EmployeeHomeView, systemSlice) que trataban BRANCH como array en vez de escalar y no manejaban ROLE — unificados en `src/utils/announcementAudience.js`, un solo punto de verdad que espeja la lógica real de creación (`AnnouncementsView.jsx`). Se agregó también el pill/badge de "Cargo" que faltaba en la vista de avisos del empleado. Build de producción limpio.

// v2.9.3 — perf(app): code-splitting de rutas — la ganancia grande de la auditoría de performance. `App.jsx` importaba las 40+ vistas de forma estática (51 imports), empaquetando todo en un solo chunk eager de 5.24MB/1.74MB gzip que se descargaba ANTES de poder pintar el login. Convertidas todas las vistas de ruta (excepto el shell: `AppLayout`, `UnifiedModal`, `LiquidToast`, `AlertModal`, `ErrorBoundary`, que se usan en cada ruta) a `React.lazy` + un único `<Suspense>` envolviendo el árbol de rutas, con fallback en el mismo lenguaje glass del loader de sesión existente (`RouteLoadingFallback`). Resultado medido con `vite build`: el chunk de entrada bajó de 5,370KB/1,740KB gzip a 820KB/243KB gzip (~86% menos JS eager); el CSS (613KB/60KB gzip) y el HTML (18KB/4KB gzip) no cambiaron. La vista más pesada ahora es `PedidosView` (2.19MB/911KB gzip, por `TabPedidos.jsx` de 3,905 líneas) pero solo se descarga al navegar a `/pedidos`, ya no bloquea la carga inicial — no se tocó ese archivo (fuera de alcance de esta fase, es candidato a refactor futuro). Efecto colateral bueno: `npm run dev` estaba roto para carga completa desde hace tiempo (`PedidosView` eager arrastraba `@capacitor-community/background-geolocation`, que hacía 500 el transform de Vite en dev) — con `PedidosView` ahora lazy, `npm run dev` monta limpio (confirmado en vivo). Verificado con Playwright contra el build de producción: login + navegación por `/dashboard`, `/pedidos`, `/productos`, `/requests`, `/overview` sin errores de consola ni pantallas en blanco, todas las vistas lazy cargan y renderizan correctamente.

// v2.9.2 — perf(db): segunda tanda de la auditoría — solo advisors de Supabase, sin cambios de frontend. (1) `auth_rls_initplan`: 4 policies (`ruta_locations` ×2, `push_subscriptions` ×2) llamaban `auth.role()`/`auth.email()` sin envolver, forzando re-evaluación por fila — envueltas en `(select auth.*())`. (2) `multiple_permissive_policies`: `employees_kiosk_select` era byte-idéntica a `employees_select` (mismo USING, mismo rol PUBLIC) — eliminado el duplicado sin cambiar acceso efectivo; `ruta_locations` tenía una policy de SELECT redundante con su policy ALL — eliminada; `push_subscriptions` tenía dos policies permisivas evaluándose juntas en cada SELECT — separadas en INSERT/UPDATE/DELETE (own-only) + un SELECT único que combina ambas condiciones (own OR service_role) con un solo OR en vez de dos policies. (3) 15 índices nuevos en FKs sin cubrir que el advisor de performance marcó y que NO son de puro audit en tabla chica (regla #2 CLAUDE.md no aplica: son tablas operativas activas) — los 9 `*_por` de `pedido_sucursal_status`, `confirmado_suc_por`/`entregado_por` de `ruta_pedidos`, y `branch_id`/`paid_by`/`created_by` de la familia `promotion_*`. Verificado: los 3 advisors de seguridad arreglados ya no aparecen en el re-chequeo. Cero cambio de comportamiento visible — build de producción limpio.

// v2.9.1 — fix(auditoría): 3 hallazgos reales de la auditoría de hardening/performance (diagnóstico completo, informe entregado por separado). (1) `TabInventario.jsx` calculaba el mapa de cantidades vencidas (`vencidosMap`) con un `select` sobre `inventory` sin `.range()` — si el total de filas `is_vencidos=true` (sin filtro de sucursal, vista "todas las sucursales") superaba las 1000 filas del cap silencioso de PostgREST, los totales de vencidos quedaban truncados en silencio; ahora usa el helper compartido `fetchAllRows` (extraído de `systemSlice.js` a `src/utils/supabaseUtils.js`, mismo comportamiento, ahora reutilizable) para paginar hasta agotar la tabla. (2) La URL de la edge function `send-push-notification` estaba hardcodeada por separado en 3 funciones DEFINER (`notify_employees`, `notify_branch`, `notify_push_on_announcement`) — centralizada en `public.push_function_url()`, un solo punto de cambio si la URL del proyecto cambia. (3) Borrados `AdminLayout.jsx` y `EmployeeLayout.jsx` (código muerto confirmado: cero imports en todo `src/`, superados hace tiempo por `AppLayout.jsx` unificado). Sin cambios de comportamiento visible salvo la corrección silenciosa del cálculo de vencidos. Build de producción limpio.

// v2.9.0 — feat(personal): reordena 3 áreas del detalle de empleado que el usuario señaló como confusas ("Documentos"/"Solicitudes"/"Clima" duplicados o mal ubicados entre Mi Perfil, el menú del empleado y EmployeeDetailView). (1) Bug real corregido: la pestaña "Archivo" de EmployeeDetailView (RRHH viendo a un empleado) leía `emp.documents` — la misma tabla legada siempre vacía en producción que ya se había corregido en StaffManagementView v2.8.0 — así que RRHH nunca veía el expediente real (CV/Contrato/DUI/Carné/Anualidad); ahora lee `emp.employee_documents`, el mismo expediente real. (2) Extraído `src/components/common/EmployeeDocumentsList.jsx` (docIcon + fila con badge de vencimiento + botón "Ver" vía openStoredFile, ordenado por urgencia) para no duplicar esa lógica entre EmployeeProfileView y EmployeeDetailView — ambas vistas ahora consumen el mismo componente. (3) Renombrada la sección "Mis Documentos" de Mi Perfil a "Mi Expediente" (a pedido directo del usuario) para no chocar de nombre con el menú "Mis Documentos" (que es otro concepto: adjuntos de solicitudes — incapacidades/constancias — no el expediente de credenciales). (4) La pestaña "Solicitudes" de EmployeeDetailView pasó a ser de solo lectura (sin crear/cancelar inline, a pedido directo del usuario: "que solo sean lecturas de expediente") — el botón "Nueva Solicitud" ahora navega a Gestión de Solicitudes (`/requests`) en vez de abrir un formulario embebido; título corregido de "Mis Solicitudes" (copy de self-service pegado en una vista de admin) a "Solicitudes del Empleado". (5) Nueva función real en Gestión de Solicitudes (`RequestsView`, antes solo aprobaba/rechazaba): botón "+ Nueva Solicitud" con selector de empleado (LiquidSelect) + los mismos 6 tipos creables (Vacaciones/Permiso/Cambio de Turno/Horas Extra/Anticipo/Constancia), gateado por `hasPermission('requests','can_edit')` — recibe además un deep-link desde el botón de EmployeeDetailView vía `navigate(..., { state: { prefillEmployeeId } })`, que abre el modal con ese empleado ya seleccionado. (6) Eliminada la pestaña "Clima" de EmployeeDetailView (mostraba las respuestas individuales de la encuesta de clima por empleado — a pedido directo del usuario, probablemente por romper la confidencialidad que una encuesta de clima necesita para ser honesta); limpiado el estado/efecto de `survey_responses` y los íconos que ya no se usaban. Verificado en vivo (Playwright/vite preview): 5 pestañas en el detalle de empleado (antes 6, sin Clima), "Archivo" usa el componente compartido con su empty state estándar, "Solicitudes del Empleado" sin acciones inline, clic en "Nueva Solicitud" navega a /requests y abre el modal con Jennifer García pre-seleccionada. Build de producción limpio.

// v2.8.4 — fix(personal): auditoría real de DESIGN.md sobre EmployeeProfileView.jsx, a pedido directo del usuario tras señalar que la primera pasada (v2.8.3) no había hecho la verificación/mejora visual pedida. 2 desviaciones reales encontradas y corregidas: (1) `GlassViewLayout` se invocaba sin `transparentBody={true}` (en el skeleton de carga Y en el render principal) — las 4 vistas hermanas del empleado (EmployeeDocumentsView, EmployeeAnnouncementsView, EmployeeHomeView, EmployeeRequestsView) SÍ lo tienen, así que "Mi Perfil" era la única que envolvía sus propias glass cards (SectionCard, incluyendo la nueva "Mis Documentos") dentro de la card semi-opaca por defecto de GlassViewLayout — doble-card confirmado visualmente (capa de blur/superficie de más, look distinto al resto del portal). (2) El buscador inline de "Historial de Eventos" usaba un `<input type="text">` crudo con su propio botón de expandir/colapsar — DESIGN.md §24 Tipo 2 prohíbe explícitamente el input crudo ("siempre SearchInput"); reemplazado por el componente compartido `SearchInput` (size="sm", siempre visible, sin el toggle de expansión). Verificado en vivo (Playwright/vite preview) en desktop y mobile tras el fix: el frame de vidrio extra desapareció (fondo ambient directo, igual que las vistas hermanas) y el buscador ahora es la píldora estándar. Build de producción limpio.

// v2.8.3 — feat(personal): nueva sección "Mis Documentos" en Mi Perfil (EmployeeProfileView), a pedido directo del usuario ("aquí tenemos documentos... vamos a la vista del perfil del empleado"). Hasta ahora el expediente de documentos (employee_documents JSONB: CV, Contrato, DUI, y si aplica Carné/Anualidad JVPQF/JVPE) solo era visible para RRHH en el modal de edición — el propio empleado no tenía dónde ver su expediente ni sus vencimientos, aunque check-employee-doc-expiry ya le notifica directamente. Aplicado DESIGN.md: la card "Contacto & Documentos" existente (que en realidad no mostraba ningún documento) se separó en "Contacto" (igual que antes) + nueva card "Mis Documentos" con el mismo componente Field/SectionCard del resto de la vista, reutilizando getExpiryBadge/getExpiringDocuments de documentExpiry.js (mismos colores/umbrales que el modal de edición y el listado de Personal — una sola fuente de verdad) y openStoredFile de storageFiles.js (bucket privado 'documents', URL firmada al click en "Ver", nunca cruda). Documentos vencidos/por vencer se listan primero. Botón "Ver" solo si hay archivo; badge "Pendiente" (mismo estilo ámbar ya usado en el modal) si no. Empty state con el patrón estándar del proyecto (glow + ícono glass + título bold, sin subtítulo). Sin borde izquierdo de color en las filas (regla explícita del proyecto). Verificado en vivo (Playwright/vite preview) contra datos reales: estado vacío confirmado en el perfil del propio Edwin Nuñez (ningún empleado tiene aún documentos cargados en producción); el build de producción queda limpio.

// v2.8.2 — feat(personal): fecha límite de pago de la anualidad CSSP, a pedido directo del usuario ("hay fechas límites para pago? es igual para todos?"). Investigación (avisos oficiales recurrentes de cssp.gob.sv) confirmó que el CSSP fija un límite único —31 de marzo, "los tres primeros meses del año"— igual para TODOS los profesionales de salud inscritos (no varía por Junta/JVPQF/JVPE); es un instructivo administrativo del CSSP, no un artículo del Código de Salud. Nuevo `getNextAnnualidadCsspDueDate()` en `documentExpiry.js` (devuelve el próximo 31 de marzo, o el del año siguiente si ya pasó); `EmployeeFormModal.handleDocFileChange` lo usa para autocompletar el `expiry_date` de los slots "Anualidad JVPQF"/"Anualidad JVPE" al subir el recibo, solo si no hay fecha ya escrita a mano o detectada por IA en el propio documento (nunca pisa una fecha real). Hint del slot actualizado con la fecha límite. Sin cambios en check-employee-doc-expiry: al quedar el expiry_date bien poblado, el cron diario ya existente (umbrales 60/30/7 días + vencido) notifica automáticamente al empleado y a todo Talento Humano activo, sin lógica nueva. Verificado con build de producción limpio.

// v2.8.1 — fix(personal): corrección real de normativa a pedido directo del usuario ("la anualidad no es lo mismo que el carné de enfermería"). Investigación adicional (Manual de Procedimientos JVPE oficial de cssp.gob.sv) confirmó que v2.8.0 mezclaba ambos conceptos en un solo slot/expiry_date: el carné (tarjeta física) se reemite rara vez (pérdida/deterioro/cambio de categoría académica) mientras la anualidad es un pago recurrente cada año calendario (primeros 3 meses del año) que puede quedar en mora por varios años sin que el carné físico cambie — el vencimiento que realmente exige RTS 11.02.04:24 §6.3.1 ("acreditación vigente") es el de la anualidad del año en curso, no la fecha de emisión del carné. Corregido: EmployeeFormModal ahora tiene 2 slots de documento separados por profesión regulada — "Carné JVPQF"/"Carné de Enfermería — JVPE" (sin el sufijo "(anualidad)", cada uno con su input de número de carné) y nuevos slots "Anualidad JVPQF — solvencia del año en curso"/"Anualidad JVPE — solvencia del año en curso" (con nota explicando que es un comprobante de pago distinto, renovable cada año), cada uno con su propio expiry_date independiente. Sin cambios de esquema de BD ni en check-employee-doc-expiry/StaffManagementView.getPendingItems — ambos ya eran genéricos por categoría (leen cualquier entrada de employee_documents con expiry_date), así que las nuevas categorías quedan cubiertas automáticamente por el aviso de vencimiento existente. Memoria (reference_sv_pharma_health_regulations) corregida con la distinción y la fuente (Manual de Procedimientos JVPE, extraído con pdftotext).

// v2.8.0 — feat(personal): vencimiento de documentos con aviso real (empleado + Talento Humano) + carné JVPQF/JVPE para Regente/Enfermería, a pedido directo del usuario, incluyendo investigación de la normativa sanitaria de El Salvador aplicable. (1) Investigación: SRS (Superintendencia de Regulación Sanitaria) regula el ESTABLECIMIENTO, no es lo mismo que las Juntas de Vigilancia (JVPQF para Químico Farmacéutico/Regente, JVPE para Enfermería) que emiten el carné individual — el label del código mezclaba ambos conceptos, corregido. Código de Salud (Arts. 306-311), Ley de Medicamentos (Art. 55-56), RTS 11.02.04:24 (BPA/BPD vigente, dic. 2024, §6.3.1 exige acreditación vigente para TODO el personal no solo el Regente) y directrices JVPQF descargados y guardados en memoria (reference_sv_pharma_health_regulations) igual que el Código de Trabajo. (2) Nuevas columnas nursing_license_number (N° JVPE) y pharmacist_license_number (N° JVPQF) en employees; el slot de documento "Acreditación SRS" se relabeleó a "Carné JVPQF — Regente/Químico Farmacéutico (anualidad)" y el de Enfermería a "Carné de Enfermería — JVPE (anualidad)", ambos ahora con su input de número de carné. Nuevo slot "Contrato de Regencia" (requisito de registro SRS). Detección ampliada: antes solo por Cargo (rol) — ahora también por Profesión (catálogo education_catalog_entries), a pedido directo del usuario ("si es enfermero/regente COMO PROFESIÓN"); el checkbox manual de JVPQF se conserva como override. (3) Bug real encontrado y corregido: el tooltip "Información pendiente" del listado de Personal (getPendingItems, StaffManagementView) leía emp.documents — una tabla legada de adjuntos de eventos RRHH, sin columna category y con 0 filas en producción — en vez de emp.employee_documents (la columna JSONB real que usa el modal Empleado); el chequeo de "Documento de identidad" llevaba tiempo indefinido siempre marcado como faltante sin importar si ya se había subido. Corregido a leer la fuente real. (4) Nuevo aviso de vencimiento generalizado a CUALQUIER documento del expediente (no solo Enfermería/Regente, por RTS 11.02.04:24 §6.3.1): banner "Información pendiente" (modal, no bloqueante) + nuevo chip visual en el listado (StaffManagementView, mismo patrón que cumpleaños/aniversario) + notificación real nueva (edge function check-employee-doc-expiry + cron diario 13:30 UTC) que llega al propio empleado y a todo Talento Humano activo vía notify_employees, con deduplicación por check_key — antes NINGÚN canal notificaba vencimientos a nivel de empleado (solo existía un badge visual dentro del propio modal, y el único cron real (check-doc-expiry) es a nivel de sucursal). Umbrales/lógica centralizados en nuevo src/utils/documentExpiry.js, compartido entre modal y listado. (5) Re-verificación contra el Código de Trabajo (a pedido directo): confirmado que el trabajo de v2.6.0/v2.7.9 (nacionalidad Art.23.1, documento alterno + aviso de jornada nocturna/examen médico Art.116-117 para menores, catálogo cerrado de Base Legal Temporal Art.25, tope de 44h semanales Art.161, badge de período de prueba Art.28, dependientes económicos Art.23) sigue vigente y correctamente aplicado — sin violaciones nuevas encontradas, sin cambios de código en esa área. Verificado en vivo (Playwright/vite preview) contra datos reales: build de producción limpio, migración de columnas + cron aplicada (get_advisors 0 errores nuevos), edge function invocada manualmente (0 notificaciones creadas, correcto — ningún empleado tiene aún documentos con fecha de vencimiento), ficha de Helen Huezo (cargo "Regente de Enfermeria") muestra el carné JVPE con su input de número automáticamente, y al marcar manualmente el checkbox JVPQF aparecen los 3 elementos nuevos (carné JVPQF + input de número + Contrato de Regencia) sin afectar el slot de Enfermería — sin guardar cambios reales
// v2.7.9 — fix(personal): verificación exhaustiva en vivo (Playwright) del flujo de creación/edición de empleado, a pedido directo del usuario ("verifica que todo esté correcto y funcional, busca mejoras"). 6 bugs reales encontrados y corregidos: (1) BD: la vista `employees_safe` (usada para cargar el listado completo de Personal) estaba desactualizada desde antes de v2.4.0 — le faltaban ~33 columnas agregadas desde entonces (nationality, email, employee_documents, campos de educación, vehículo/licencias, etc.); al editar un empleado esos campos se veían vacíos aunque tuvieran datos reales, y subir UN documento nuevo en la pestaña Documentos borraba silenciosamente todos los documentos ya existentes (el array completo se sobrescribía con solo el nuevo). Corregido con migración: la vista ahora es `SELECT * FROM employees` (security_invoker se mantiene; verificado que ninguna otra vista/función depende de su lista de columnas específica, y que el único RPC anon que la toca ya arma su propio jsonb_build_object con campos explícitos, sin exposición nueva). (2) LiquidDatePicker: escribir una fecha a mano (DD/MM/AAAA) era prácticamente imposible — cada pulsación con la fecha incompleta emitía onChange('') al padre, lo que disparaba el useEffect que sincroniza los inputs locales desde `value` y los reseteaba a vacío en cada tecla. Corregido: mientras la fecha esté incompleta simplemente no se emite nada (el valor anterior se conserva) — ya no hace falta usar el calendario visual para poder teclear una fecha. Afecta todos los campos de fecha de la app, no solo Personal. (3) App.jsx: el default de "Nuevo Empleado" seteaba `hireDate`/`branchId` (camelCase) pero el formulario lee `hire_date`/`branch_id` (snake_case) — el default de "hoy" en Fecha de Contratación nunca se aplicaba en la práctica; corregido a `hire_date` (branchId se quitó en vez de forzarlo, para no auto-asignar una sucursal equivocada). (4) App.jsx: el código de empleado por defecto se generaba como "EMP1234" — con letras, lo que SIEMPRE fallaba la regla de negocio "solo números" (y el trigger de BD) al guardar; corregido a un número puro. (5) Race condition real de seguridad: tras un boot fresco (login, F5, pestaña nueva), `employees` arranca con el snapshot SANITIZADO de localStorage (persistEmployees quita a propósito DUI/ISSS/AFP/banco/kiosk_pin antes de cachear, buena práctica ya existente) mientras el fetch real a employees_safe no ha respondido — si se abría "Editar" en esa ventana de milisegundos, esos campos aparecían vacíos, arriesgando que se guardaran como NULL sobre datos reales. Corregido: el botón "Edición rápida" (y Recontratar) ahora se deshabilita mientras `bootStatus !== 'ready'`, con aviso explicando que se están sincronizando los datos. (6) Confirmado por regresión: el trabajo de la sesión anterior (Guardar en cualquier pestaña + validación integral, v2.7.7) sigue funcionando correctamente tras estos fixes. Verificado en vivo con Playwright contra la BD real: alta completa de un empleado de prueba (las 4 pestañas, incluida subida de documento), reapertura en modo edición confirmando que TODOS los campos —incluido el documento— cargan correctamente, edición con un segundo documento sin perder el primero, y el escenario exacto de la race condition reproducido y corregido (botón deshabilitado → habilitado con datos completos). Empleado y usuario de prueba eliminados de la BD al finalizar

// Changelog (most recent first)
// v2.7.8 — fix(personal): mensajes de "Feliz Cumpleaños" decían "todo el equipo de Farmalasa" — nombre incorrecto, la empresa se llama Farmacias La Popular y La Salud (Farmalasa es el nombre del portal/software, no de la empresa). Corregido en los 3 lugares donde aparecía: toast de AppLayout (nuevo en v2.7.7), banner de EmployeeHomeView (v2.7.6), y la notificación de cumpleaños de timeClock.audit.js (pre-existente, mismo error de nombre)
// v2.7.7 — feat(personal): botón Guardar disponible en cualquier pestaña al editar un empleado + validación integral del formulario, a pedido directo del usuario. (1) El modal Empleado (UnifiedModal footer) forzaba a llegar hasta "Documentos" (última pestaña) para poder guardar — en modo edición ya no: Guardar ahora aparece en las 4 pestañas (Personal/Contrato/Nómina/Documentos), junto al botón "Siguiente" cuando no es la última; en modo creación (Nuevo Empleado) se mantiene el wizard tal cual (Siguiente hasta Documentos), sin cambios. (2) Bug real detectado por el usuario: el botón Guardar aparecía siempre verde/habilitado aunque hubiera campos "Requerido" en rojo (ej. DUI vacío) — EmployeeFormModal nunca reportaba su validez a UnifiedModal (a diferencia de FormNovedad, que sí usa onValidationChange). Nuevo isFormFullyValid (EmployeeFormModal) recorre TODAS las condiciones "Requerido"/inválido ya existentes en el propio formulario — Nombres/Apellidos, DUI o documento alterno según minoría de edad, Fecha de Nacimiento, Género, Estado Civil, Distrito (si hay Departamento), direcciones alternas, teléfonos, Nivel Académico (grado/especialidad/profesión/maestría según corresponda), Sucursal/Cargo, Horas/Salario, contrato Temporal (Base Legal/Motivo), ISSS/AFP (formato) y Código — sin importar en qué pestaña esté parado el usuario; se reporta al padre vía onValidationChange (mismo patrón que FormNovedad) y deshabilita Guardar (con tooltip explicando el porqué) hasta que TODO esté correcto. Los "pendientes" ya establecidos como no-bloqueantes (imagen de DUI/documento, ISSS/AFP sin decidir) siguen sin bloquear — la nueva validación solo cubre los campos que YA se marcaban "Requerido" en rojo, no reabre esa decisión de negocio. getEmployeeValidationError (UnifiedModal) se mantiene como mensaje de error legible al intentar guardar de todos modos. (3) Nuevo: si hoy es el cumpleaños de quien inició sesión, aparece un toast "¡Feliz cumpleaños! 🎂" (LiquidToast, nueva variante `birthday` con icono de pastel) al entrar al portal — vive en AppLayout (no en una vista puntual como Dashboard o Inicio) para que se note sin importar en qué módulo aterrice, con un badge 🎂 persistente junto al avatar del usuario en la barra lateral (expandida, colapsada y topbar móvil) mientras dure el día. Corrige que el banner de cumpleaños de la sesión anterior (v2.7.6) solo vivía en EmployeeHomeView ("Inicio"), invisible para cualquier usuario que entrara directo al Dashboard u otro módulo (caso real: Edwin Nuñez, cumpleaños 1996-07-05, no veía nada al aterrizar en Dashboard). Verificado en vivo (Playwright/vite preview) con datos reales: toast + badge aparecen en Dashboard sin visitar Inicio; en modal de edición, Guardar visible en pestaña Personal con DUI vacío → deshabilitado con tooltip; al completar DUI con formato válido, Guardar sigue deshabilitado hasta completar Estado Civil (confirmado con screenshot), validando que el bloqueo es real e integral
// v2.7.6 — feat(personal): 4 mejoras a los indicadores de "pendiente" y cumpleaños, a pedido directo del usuario tras revisar v2.7.5. (1) El tooltip de "Información pendiente" (icono ámbar junto al nombre en el listado) ahora también refleja el documento de identidad (imagen DUI frente/reverso, o documento alterno si es menor) — antes solo cubría DUI/Fecha de Nacimiento/ISSS-AFP como texto, sin considerar que el modal Empleado ya marca ese documento como pendiente por separado (pendingItems). getPendingItems ahora es la única fuente de verdad y coincide con el modal; el tooltip pasó de una línea plana "Pendiente: X • Y" a una lista con encabezado "Información pendiente" y un renglón por dato con su motivo ("DUI — falta el número", "Documento de identidad — falta subir la imagen"). (2) Cumpleaños en el listado: dejó de mostrar siempre "Día N" (poco natural) — ahora usa lenguaje relativo: "Mañana", "En 5 días", "¡Hoy cumple 36!" (con la edad real calculada); los que ya pasaron este mes se ocultan (mostrar una fecha vieja no aporta). (3) Fila de cumpleaños de hoy rediseñada: degradado rosa/ámbar más sutil, insignia 🎂 animada en la esquina del avatar, confetti con emojis (🎉✨🎊) en vez de los 4 puntos de colores sin relación al tema. (4) Nuevo: portal de autoservicio del empleado (EmployeeHomeView) detecta si hoy es el cumpleaños de quien inició sesión — cambia el saludo del header a "¡Feliz cumpleaños, {nombre}! 🎉" con icono de pastel, y agrega un banner festivo arriba del dashboard ("Hoy cumples N años — todo el equipo de Farmalasa te desea un día increíble") para que se sienta personal. Verificado en vivo (Playwright/vite preview) contra datos reales: tooltip de pendiente muestra los 3 datos + documento correctamente, Dolores Tejada (cumple mañana) muestra "Mañana", Jennifer Garcia (cumple hoy) muestra fila festiva completa con "¡Hoy cumple 36!", confetti y badge de pastel; EmployeeHomeView sin errores de consola para usuario sin cumpleaños hoy
// v2.7.5 — fix(personal): 4 ajustes a pedido directo del usuario tras revisar v2.7.4. (1) El badge ámbar "Pendiente — no bloquea el alta" en el card DUI/Documento de Identidad (pestaña Documentos) ahora solo dice "Pendiente" — el resto de la explicación queda solo en comentario de código. (2) El badge "PENDIENTE" del listado de Personal (StaffManagementView, junto al nombre) tenía icono + texto — a pedido del usuario, ahora es solo el icono AlertCircle (el tooltip con el detalle de qué falta se conserva al hacer hover). (3) Nueva regla global: los nombres cortos que se muestran en listados/avatares deben ser SIEMPRE primer nombre + primer apellido, sin importar cuántos nombres/apellidos tenga el empleado — antes StaffManagementView y ScheduleCalendar tenían cada uno su propia función formatShortName que operaba sobre el `name` concatenado con una heurística frágil (parts[0]+parts[2], rompía con 1 o 3+ nombres/apellidos). Nuevo helper compartido shortEmployeeName (src/utils/nameUtils.js) que usa los campos ya separados first_names/last_names (obligatorios desde el alta, primer token de cada uno) y solo cae al heurístico viejo sobre `name` para registros legado sin esos campos. Reemplazadas ambas duplicaciones. (4) Columna "Empleado" del listado de Personal angostada (280px→360px) para que quepan bien nombre+badges (pendiente/cumpleaños/aniversario) sin truncarse; columna "Acciones" angostada (sin ancho fijo→180px, botones Recontratar/Ver Perfil pasan a icon-only con tooltip, igual que Editar) para compensar el espacio. Verificado con eslint: sin errores nuevos (los 4 preexistentes en StaffManagementView/ScheduleCalendar/EmployeeFormModal ya estaban antes de este cambio)
// v2.7.4 — fix(personal): 3 correcciones al bloque de identidad, a pedido directo del usuario tras revisar v2.7.3. (1) Quitado el color azul distintivo del card "DUI" en Documentos — ahora usa el mismo estilo neutro (border-slate-200/70 bg-slate-50/60) que el resto de documentos; agruparlos en un solo card ya comunica que son el mismo documento, no hacía falta el color. (2) El campo "Documento de Identidad Alternativo" no tenía sentido como texto libre con placeholder "Partida de Nacimiento, Carné de Minoridad..." — separado en 2 campos normales de 1 columna en Personal: "Tipo de Documento" (select: Partida de Nacimiento/Carné de Minoridad/Pasaporte/Otro, mismo ALT_ID_DOCUMENT_TYPE_OPTIONS ya creado) y "Número de Documento" (el número real que trae ese documento, reutilizando la columna alt_identity_document). El selector de tipo duplicado que vivía en Documentos se quitó — ese tab ahora solo muestra el nombre del tipo ya elegido en Personal (nuevo helper altIdDocTypeLabel) como título del card, sin selector repetido. (3) Ya no ocupa colSpan=2 fijo — Tipo de Documento y Número de Documento son 2 columnas normales de 1 espacio cada una, igual que el resto de campos del formulario; "Especifica el Tipo" solo aparece a ancho completo si se elige "Otro documento legal...". Verificado en vivo con fecha de nacimiento 2010 (16 años, Menor de Edad): DUI desaparece por completo, Tipo/Número en fila normal de 2 columnas, al elegir "Partida de Nacimiento" el card de Documentos muestra ese título sin selector duplicado y sin color azul
// v2.7.3 — feat(personal)/fix(personal): 3 ajustes al bloque de identidad de la pestaña Documentos, a pedido directo del usuario. (1) DUI Frente/Reverso dejó de verse como 2 documentos independientes — ahora viven agrupados en un solo card "DUI" (borde/fondo azul distintivo) con Frente|Reverso lado a lado adentro; el vencimiento solo se pide una vez (en Frente, ya que ambos lados son el mismo documento físico). (2) Para menores de edad, el card cambia a "Documento de Identidad" con un nuevo selector "Tipo de Documento" (Partida de Nacimiento / Carné de Minoridad / Pasaporte / Otro documento legal... con texto libre, reutilizando el patrón CatalogSelect/CatalogOtherInput ya usado en el archivo) antes del upload — nueva columna alt_identity_document_type (migración add_alt_identity_document_type). (3) Corregido: la imagen del DUI/documento alterno NO debe bloquear el alta del empleado (a diferencia del campo de texto DUI, que sí es obligatorio desde v2.6.0) — cambiados los badges de rojo "Requerido" a ámbar "Pendiente — no bloquea el alta", y agregado "DUI (Documento)" a pendingItems (el mismo banner "Información Pendiente" que ya usan DUI/Fecha de Nacimiento/ISSS-AFP en modo edición) para que quede visible que falta sin impedir guardar. Verificado en vivo: card DUI agrupado con Frente/Reverso y badge ámbar de pendiente (ya no rojo)
// v2.7.2 — fix(personal): 3 correcciones a la pestaña Documentos, a pedido directo del usuario. (1) Faltaba el DUI — se agregaron slots fijos "DUI (Frente)" y "DUI (Reverso)" (siempre visibles, junto a CV/Contrato). (2) "Licencia de Conducir" era un único slot genérico sin relación con la sección Personal — ahora son 2 slots condicionales, "Licencia de Motocicleta" y "Licencia de Automóvil", que solo aparecen si su checkbox respectivo (has_motorcycle_license/has_car_license) está activo en Vehículo y Acreditaciones. (3) Restaurado el checkbox "Acreditación de la SRS" en esa misma sección (se había quitado por error al mover el documento a la pestaña Documentos) — el slot de subida solo aparece si está marcado; ya no lleva su propio campo de fecha (esa vive en el documento, vía IA o manual). documentCategories ahora es un useMemo condicionado por has_motorcycle_license/has_car_license/has_srs_accreditation además del cargo de enfermería. Quitada la validación server-side obsoleta "Falta la Fecha de Vencimiento de la Acreditación SRS" (ya no aplica, el campo vive en employee_documents). Verificado en vivo: sin checkboxes activos solo aparecen CV/Contrato/DUI Frente/DUI Reverso; al marcar Licencia de Motocicleta + SRS en Personal, ambos slots aparecen de inmediato en Documentos
// v2.7.1 — fix(personal): la detección de IA de "Fecha de Vencimiento" en la pestaña Documentos quedaba diferida hasta Guardar (y solo era visible al reabrir la ficha) — a pedido directo del usuario, ahora la subida + análisis con IA ocurre EN EL MOMENTO de elegir el archivo, no al guardar. Nuevo helper exportado getStoragePathFromUrl (storageFiles.js, reutiliza el mismo STORAGE_PATH_RE ya usado por getSignedFileUrl/signStorageUrls) para derivar bucket+path desde la URL pública recién subida y poder llamar analyze-document de inmediato. handleDocFileChange ahora es async: sube el archivo al bucket 'documents' (carpeta employees/{id}/documents si ya existe el empleado, employee-documents/unassigned si es de alta), invoca analyze-document, y si la IA detecta expDate y el usuario no había tecleado una, la autocompleta en el campo — todo antes de que el usuario toque "Guardar". Nuevo estado "Subiendo y analizando con IA…" (spinner) por documento mientras esto ocurre. uploadEmployeeDocuments (employeeSlice.js) queda igual como fallback/compatibilidad para cualquier documento que aún llegue como File crudo. Verificado en vivo: spinner aparece de inmediato al elegir el archivo, termina limpio sin crashear aunque el PDF de prueba no tenga fecha real que detectar
// v2.7.0 — feat(personal): nueva pestaña "Documentos" en el modal Empleado (CV, Contrato Firmado, Licencia de Conducir, Acreditación SRS —reubicada desde Vehículo, ahora con archivo real en vez de solo checkbox+fecha—, y Acreditación de Enfermería condicional si el Cargo Principal contiene "enfermer"), más lista abierta "+ Agregar Documento" para cualquier otro archivo. Cada documento admite Fecha de Vencimiento opcional; al Guardar, cada archivo se sube al bucket privado 'documents' y se envía al mismo edge function 'analyze-document' que ya usa el expediente de sucursal (Gemini) — si la IA detecta una fecha de vencimiento en el propio documento y el usuario no tecleó una, se autocompleta (a pedido directo del usuario). Nuevo badge de vencimiento en la propia pestaña (rojo si vencido o vence en ≤30 días, ámbar si ≤60) para avisar de documentos próximos a caducar. Nueva columna jsonb employee_documents (migración add_employee_documents_column) + nuevo action uploadEmployeeDocuments en employeeSlice.js compartido por addEmployee/updateEmployee. Además, fix(personal): la ventana para asignar vacaciones estaba hardcodeada a 3 meses tras el aniversario — el Art. 182 del Código de Trabajo da 4 meses (plantilla ≤100 empleados) o 6 (más de 100); vacationPlanSlice.js ahora calcula el headcount activo real para elegir la ventana correcta. Verificado en vivo (Playwright/vite preview): 4 pasos en el stepper (Personal/Contrato/Nómina/Documentos), slot de Enfermería aparece solo con cargo "Regente de Enfermería", subida de PDF de prueba + fecha de vencimiento manual dispara el badge rojo "Vence en 15 días"
// v2.6.0 — feat(personal): 5 mejoras de cumplimiento legal al modal Empleado tras auditoría contra el Código de Trabajo de El Salvador, a pedido directo del usuario. (1) Nueva "Nacionalidad" (select, catálogo ~195 países/gentilicios en src/data/nationalities.js, El Salvador y Centroamérica primero) — exigida por Art. 23.1. (2) Indicador de menor de edad: badge "Menor de Edad" junto a Fecha de Nacimiento cuando edad<18 + aviso de Art. 116-117 (jornada nocturna prohibida, examen médico obligatorio); DUI ahora requerido SOLO para adultos — si es menor se sustituye por un nuevo campo "Documento de Identidad Alternativo" (Art. 23.2: "cualquier documento fehaciente" — partida de nacimiento, carné de minoridad — ya que el DUI no se tramita antes de los 18 en El Salvador). Bloqueo duro agregado en UnifiedModal.jsx (hard block de "Nuevo Empleado") y en validateOptionalFormats (employeeSlice.js), ambos con la misma excepción de minoría de edad. (3) Contrato Temporal: nuevo select "Base Legal del Plazo" (catálogo cerrado de 2 opciones, las únicas que el Art. 25 admite) + campo abierto "Motivo Concreto" (texto libre, lo redacta la empresa caso por caso) — ambos requeridos cuando el tipo es Temporal, para dejar respaldo escrito si se disputa la validez del plazo. (4) Nuevo banner de riesgo legal cuando se elige "Servicios Profesionales": advierte que el Art. 20 presume contrato laboral real por subordinación (horario/cargo/sucursal ya asignados en este mismo expediente) sin importar la etiqueta. (5) Indicador de Período de Prueba: se calcula automáticamente desde Fecha de Contratación + 30 días (Art. 28, ya no hay que capturarlo a mano) y se muestra como badge en la pestaña Contrato; si el empleado tiene un evento TERMINATION a menos de 1 año de la nueva fecha de contratación, se marca como exento de período de prueba (Art. 28 último párrafo: recontratación antes de 1 año no permite volver a estipularlo). Migración add_nationality_alt_id_and_temporal_contract_reason (columnas nationality, alt_identity_document, contract_temporal_legal_basis, contract_temporal_reason). Verificado en vivo (Playwright/vite preview): banner de Servicios Profesionales, Base Legal + Motivo Concreto requeridos en Temporal, badge "En Período de Prueba — vence el 04 de agosto de 2026" tras fijar Fecha de Contratación a hoy
// v2.5.2 — feat(personal)/fix(personal): 3 ajustes a la pestaña Contrato del modal Empleado, a pedido directo del usuario. (1) "Temporal / Plazo Fijo" → "Temporal" en Tipo de Contrato (CONTRACT_TYPE_OPTIONS). (2) Layout: en vez de que "Fecha Fin de Contrato" (solo Temporal) apareciera como fila completa aparte debajo, ahora vive en la MISMA fila que Tipo de Contrato/Fecha de Inicio de Contrato — esa fila pasa de grid-cols-2 a grid-cols-3 solo cuando contract_type==='TEMPORAL' (mismo truco aplicado a la fila de Horas Semanales/Salario Base: pasa a 3 columnas cuando se elige "Otro", mostrando el input numérico como columna propia con su label "Horas (Otro)" en vez de metido debajo del select). (3) Bug real de negocio: el tope de "Horas Semanales" con "Otro" decía "Entre 1 y 80" sin base legal — investigado el Código de Trabajo de El Salvador (Art. 161, confirmado vía MTPS/Consortium Legal/finiquitojusto.com): la jornada ordinaria semanal diurna máxima es 44h (39h la nocturna); no hay mínimo legal para tiempo parcial. MAX_WEEKLY_HOURS bajó de 80→44 (cliente, EmployeeFormModal.jsx) y el mismo tope 1-80→1-44 en el validador server-side (validateOptionalFormats, employeeSlice.js) — quedaban desincronizados antes de este fix. Guardado en memoria del proyecto para futuras validaciones laborales. Verificado en vivo (Playwright/vite preview): Temporal muestra Tipo/Inicio/Fin en una sola fila de 3 columnas, "Otro" en Horas Semanales expande a 3 columnas con el input al lado del select, error de "Otro" ahora dice "Entre 1 y 44"
// v2.5.1 — fix(personal): 2 bugs reportados en la pestaña Contrato de v2.5.0. (1) Bug real de "Otro" en Horas Semanales: al elegir "Otro" se limpiaba weekly_contracted_hours a '' para que el usuario tecleara, pero isCustomHours('') está diseñado para devolver false (no confundir "vacío" con "personalizado") — el select rebotaba de inmediato de vuelta a "Tiempo Completo 44h" y el input nunca aparecía. Fix: sentinel OTRO_HOURS_SENTINEL ('__OTRO_HORAS__') en vez de '' mientras no se ha tecleado nada, mismo patrón ya usado en el archivo para "Otra especialidad" (OTRA_ESPECIALIDAD) — el input de horas muestra '' mientras el valor sea el sentinel. (2) Layout: "Fecha Fin de Contrato" (visible solo si Temporal) vivía en una celda fija del grid de 2 columnas bajo "Tipo de Contrato" — cuando no aplicaba, dejaba un div vacío que generaba un hueco visual grande en la columna izquierda. Reordenado a Tipo de Contrato/Fecha Inicio (fila 1) → Horas Semanales/Salario (fila 2) → Fecha Fin de Contrato como fila condicional de ancho completo (fila 3, solo si Temporal) — sin placeholders vacíos. Verificado en vivo (Playwright/vite preview): "Otro" se mantiene seleccionado y el input aparece de inmediato, tecleado "36" limpia el error; card de Contrato sin huecos con Indefinido, "Fecha Fin de Contrato" aparece como fila completa y prolija al elegir Temporal
// v2.5.0 — feat(personal): 7 mejoras a la pestaña Contrato + nueva subsección Vehículo/Acreditaciones en Personal, a pedido directo del usuario. (1) Nueva "Fecha de Inicio de Contrato" (columna contract_start_date) junto a Tipo de Contrato — distinta de Fecha de Contratación (hire_date), ya que el contrato y el inicio real de labores pueden diferir (además sirve de referencia para horarios); backfileada con hire_date para los 3 empleados que ya la tenían. (2) Fecha Fin de Contrato (ya existía para Temporal) ahora valida que sea posterior a la Fecha de Inicio de Contrato, cliente y servidor. (3)(6) "Horas Semanales" dejó de ser un input de texto libre "(WFM)" — ahora es un LiquidSelect con Tiempo Completo 44h / Medio Tiempo 22h / Otro (input numérico que aparece solo con "Otro"); el modo se deriva del propio valor guardado (sin estado interno), comparando siempre vía String() porque weekly_contracted_hours llega como number desde Postgres — bug real detectado y corregido en la propia sesión (los 47 empleados con 44 horas se mostraban como "Otro" antes del fix). (4) Validación de Salario Base (>0) y Horas Semanales (1-80) en cliente (badge rojo) y servidor (validateOptionalFormats). (5) Quitado "Medio Tiempo (Part-Time)" de Tipo de Contrato — ahora es solo una configuración de horas, no un tipo de contrato (0 empleados lo tenían, sin necesidad de migrar datos). (7) Nueva subsección "Vehículo y Acreditaciones" en Personal: Posee Moto / Posee Carro / Licencia de Motocicleta / Licencia de Automóvil (checkboxes independientes) + Acreditación de la SRS con Fecha de Vencimiento condicional (nuevas columnas has_motorcycle/has_car/has_motorcycle_license/has_car_license/has_srs_accreditation/srs_accreditation_expiry, migración add_contract_start_date_and_vehicle_srs_fields). Verificado en vivo (Playwright/vite preview): dropdown de Tipo de Contrato con solo 3 opciones, validación de salario negativo marca "DEBE SER MAYOR A 0", Horas Semanales muestra "Tiempo Completo 44h" correctamente tras el fix, sección Vehículo/Acreditaciones renderiza los 5 campos

// v2.4.14 — style(personal): regla global del modal Empleado — ningún select debe mostrar "Ninguno" como opción para limpiar. Quitado clearLabel="Ninguno" (clearable={false}) de los 5 selects restantes que aún lo tenían: Parentesco (dependiente económico), Parentesco (Avisar a/Ficha Médica), Cargo Secundario (Apoyo), Institución AFP, Banco — sumado al de Tipo de Sangre ya corregido en v2.4.13. Ya no queda ninguna ocurrencia de "Ninguno" en EmployeeFormModal.jsx
// v2.4.13 —
// v2.4.13 — style(personal): 2 ajustes rápidos a pedido del usuario. (1) "Dependiente"→"Persona" en toda la sección de dependientes económicos ("Persona 1", "Agregar Persona", "Quitar persona", "Igual que Persona N" en el selector de copiar dirección) — solo texto visible, sin tocar nombres de campos/funciones (economic_dependents, addDependent, etc. sin cambios). (2) Quitado "Ninguno" de Tipo de Sangre (clearable={false}, mismo patrón que Género/Estado Civil/Departamento). Verificado en vivo: "Persona 1"/"Agregar Persona" renderizan correctamente
// v2.4.12 — feat(personal): 3 mejoras al modal Empleado a pedido directo del usuario. (1) fix: "¿Tiene Maestría?" y "¿Actualmente estudiando?" (Universitario) ahora son mutuamente excluyentes en ambas direcciones — v2.4.11 solo apagaba/ocultaba "estudiando" al marcar maestría; ahora activar "estudiando" también apaga y oculta el bloque de maestría (implica que la licenciatura sigue en curso, no puede haber maestría todavía). Reforzado en handleSelectChange (UI) y en addEmployee/updateEmployee de employeeSlice.js (is_studying manda como fuente de verdad si ambos llegan true por algún camino directo al store). (2) Ficha Médica y Emergencia: agregado selector de Parentesco (PARENTESCO_OPTIONS compartido, 13 opciones) para "Avisar a", y botón "+ Agregar" para teléfonos de emergencia adicionales (mismo patrón que Teléfono principal) — nuevas columnas emergency_contact_relationship/emergency_contact_extra_phones, con validación de formato SV para cada teléfono adicional. (3) Nueva sección "Personas que Dependen Económicamente" (antes de Ficha Médica) — cada dependiente: Nombre, Fecha de Nacimiento (con edad calculada en vivo vía calcAge), Parentesco, Departamento/Distrito/Dirección Detallada; selector "Copiar dirección de..." (empleado o cualquier otro dependiente ya cargado) para no re-teclear cuando viven en la misma casa — nueva columna jsonb economic_dependents, migración add_economic_dependents_and_emergency_contact_fields. Verificado en vivo (Playwright/vite preview): mutua exclusión funciona en ambas direcciones, sección de dependientes renderiza en el orden correcto con nombre/dirección en mayúscula automática; la interacción de clic del selector "Copiar dirección de..." no se pudo verificar por automatización (Playwright no abría el dropdown en ese punto del scroll) pero el handler copyDependentAddress replica exactamente el patrón ya probado de updateAddress/extra_addresses
// v2.4.11 — fix(personal): 2 correcciones al bloque Universitario/Maestría del modal Empleado, a partir de dudas directas del usuario tras v2.4.10. (1) Confirmado (sin cambios de código, ya funcionaba): registerCatalogEntry/registerSkillCatalogEntries en employeeSlice.js ya hacían upsert de cualquier valor tecleado en "Otro..." a education_catalog_entries — queda disponible como opción real en el siguiente registro. (2) Bug real corregido: "¿Tiene Maestría/Postgrado?" y "¿Actualmente estudiando?" (Universitario) eran completamente independientes — se podía marcar ambos a la vez, contradictorio (tener maestría implica que la licenciatura ya terminó). Fix: al marcar has_maestria, se fuerza is_studying=false (y se limpian sus fechas) y el bloque "¿Actualmente estudiando?" se oculta mientras has_maestria esté activo; el toggle inverso (desmarcar maestría) limpia sus propios campos. Además, la maestría en sí no tenía forma de marcarse "en curso" — nuevo toggle "¿Maestría en curso?" (columnas maestria_is_studying/maestria_study_start_date/maestria_study_duration_years, migración add_maestria_in_progress_tracking) con su propio mes/año de inicio + duración y fecha estimada de fin, calcada del bloque de Universitario. Validado en 3 capas: UI (handleSelectChange cruza los toggles), addEmployee/updateEmployee (dbPayload fuerza is_studying=false si has_maestria=true, defensa en profundidad si el store se llama fuera del form) y validateOptionalFormats (bloquea server-side is_studying+has_maestria simultáneos y maestría "en curso" con fecha estimada ya vencida). Build de producción limpio; sin browser tool disponible en la sesión para verificación visual en vivo — pendiente de confirmar en pantalla
// v2.4.10 — feat(personal): Universitario/Maestría rediseñados + cursos con institución y horas + catálogos ampliados. (1) Quitado "Universitario (Estudiante)" — "Universitario" es un solo nivel, el toggle "¿Actualmente estudiando?" (ya siempre visible, ver #4) define si es estudiante o graduado. (2) Maestría/Postgrado dejó de ser un Nivel Académico separado — requiere estudio universitario previo, así que ahora es un complemento "¿Tiene Maestría / Postgrado?" que solo aparece al seleccionar Universitario (nuevas columnas has_maestria/maestria_title), con su propio catálogo MAESTRIA_POSTGRADO (25 programas investigados de UES/UCA/UPED/UTEC/UEES: MBA, Gerencia del Talento Humano, Salud Pública, Farmacología, etc.) + "Otra..." con upsert. (3) Profesión/Título de Universitario ahora aparece a la par de Nivel Académico (antes a ancho completo). (4) "¿Actualmente estudiando?" siempre visible para Bachillerato Técnico/Técnico Superior/Universitario. (5) Selector de Maestría también a la par de su propio label. (6) Cursos/Habilidades Adicionales dejó de ser un input de texto suelto — cada entrada ahora pide Curso/Habilidad, Institución y Horas Totales, en un bloque tipo "Dirección Alterna" con botón de quitar. (7) Curso/Habilidad e Institución son selectores con catálogo + "Otra..." (igual que especialidades/profesiones): CURSO_HABILIDAD (26 cursos investigados: Atención al Cliente, Excel, Inglés, Farmacovigilancia, BPA, etc.) e INSTITUCION_CAPACITACION (13 instituciones reales de El Salvador: INSAFORP, ITCA-FEPADE, Cruz Roja Salvadoreña, Colegio de Farmacéuticos, etc.), con upsert automático al guardar. additional_skills migró de text[] a jsonb (array de objetos). Verificado en vivo: dropdown de Nivel Académico con 5 opciones (sin Estudiante/Maestría), Universitario muestra Profesión a la par + estudiando + complemento de Maestría con su propio selector, Cursos/Habilidades con los 3 campos y catálogo real cargado desde BD
// v2.4.9 — feat(personal): especialidades y profesiones ahora viven en la BD (tabla education_catalog_entries), no hardcodeadas — a propuesta del usuario, en vez de fusionar catálogo estático + entradas custom, el catálogo completo se sembró en la tabla (80 valores investigados: 20 especialidades Bachillerato Técnico, 24 Técnico Superior, 36 profesiones universitarias de UES/institutos técnicos) y la app lee siempre de ahí. 5 fixes adicionales: (1) "Otra especialidad"/"Otra profesión" ya no se aprietan a la par del select — ahora aparecen en su propia fila a ancho completo debajo (isCatalogOther deriva el estado de "es otro" del propio dato, sin useState interno, evitando que el select y el input de texto libre se desincronicen). (2) Arreglado el layout roto de "¿Actualmente estudiando?" — el badge "REVISA FECHAS" se apretaba junto al label de Duración en la grilla de 3 columnas; PortalInput ahora solo muestra el badge de error si hay errorMessage (antes se renderizaba vacío), y Duración solo marca el borde rojo, el mensaje completo ya vive en el texto de abajo. (3) Al desmarcar "¿Actualmente estudiando?" ahora sí se limpian study_start_date/study_duration_years (antes quedaban huérfanos y reaparecían al volver a marcar). (4) Técnico Superior ya no muestra Profesión/Título (iba a la par de Especialidad, redundante — su título ya es la especialidad). Profesión/Título en Universitario/Maestría dejó de ser texto libre: ahora es un selector con catálogo (PROFESION_UNIVERSITARIA) + "Otra profesión...". (5) Cualquier valor tecleado en "Otra..." se registra en education_catalog_entries (upsert, ignora duplicados) al guardar el empleado — queda disponible como opción real en el siguiente registro, sea especialidad técnica o profesión universitaria/maestría. Verificado en vivo: layout de "otra" a ancho completo, Duración sin badge roto, desmarcar limpia campos, Técnico Superior sin Profesión/Título duplicado, Universitario (Graduado) con selector de profesiones real, entrada de prueba insertada directo en BD apareció de inmediato como opción buscable
// v2.4.8 — feat(personal): 5 ajustes a Nivel Académico y validaciones relacionadas en el modal Empleado. (1) Quitado "Ninguno" de Nivel Académico (clearable={false}). (2) Cascada de "requerido": Grado Finalizado (Básica), Especialidad (Bachillerato Técnico/Técnico Superior) y Profesión/Título ahora muestran badge rojo "Requerido" si el nivel que los activa está seleccionado pero el campo quedó vacío — mismo patrón para Distrito cuando hay Departamento seleccionado (dirección principal y cada dirección alterna). Client-side únicamente (visual, no bloquea guardado), igual que Género/Estado Civil. (3) Fecha de Nacimiento valida que sea real: no futura, edad entre 16-90 años (calcAge + MIN/MAX_WORK_AGE), con badge de error "Fecha futura"/"Edad debe ser 16-90"; si es válida muestra "· N años" junto al label. Bloqueado también server-side en validateOptionalFormats (employeeSlice.js). (4) Especialidad ahora aparece a la par de Nivel Académico (quitado md:col-span-2); Bachillerato Técnico ya no muestra Profesión/Título (sacado de LEVELS_WITH_PROFESSION — su "título" es la especialidad, no una profesión aparte). (5) "¿Actualmente estudiando?" valida realismo: si la fecha estimada de fin (inicio + duración) ya pasó, se marca en rojo "Finalizó en MES AÑO — no puede seguir 'actualmente estudiando'" y bloquea el guardado server-side. Verificado en vivo: sin "Ninguno", Bachillerato Técnico muestra Especialidad al lado sin Profesión/Título, fecha 1995 → "31 años", fecha 2020 → "EDAD DEBE SER 16-90"
// v2.4.7 — fix(personal): corregido el orden de la sección de dirección en el modal Empleado — quedó Dirección Detallada → Departamento/Distrito → "+ Agregar Dirección Alterna" (v2.4.6 lo había puesto Departamento/Distrito primero por error de interpretación). Sin cambios de datos ni de la estructura de dirección alterna (Departamento+Distrito+Dirección completos), solo reorden visual
// v2.4.6 — feat(personal): rediseño de la sección de dirección en el modal Empleado. Departamento + Distrito (renombrado de "Municipio / Distrito" a solo "Distrito") ahora van primero, luego Dirección Detallada, luego "+ Agregar Dirección Alterna". Cada dirección alterna dejó de ser un solo campo de texto — ahora pide los 3 datos completos (Departamento, Distrito, Dirección Detallada) igual que la dirección principal, con su propio dropdown de distrito filtrado por su propio departamento. extra_addresses cambió de text[] a jsonb (array de objetos {department, municipality, address}) vía migración employees_extra_addresses_to_jsonb — no había datos previos que migrar. Nuevo helper normalizeExtraAddresses en employeeSlice.js descarta filas vacías (agregadas con "+" pero nunca llenadas) antes de guardar. Verificado en vivo: orden correcto, label "Distrito" sin "Municipio", bloque de Dirección Alterna 1 pide sus 3 campos
// v2.4.5 — feat(personal): campos de texto libre del modal Empleado se guardan siempre en MAYÚSCULA — Nombres, Apellidos, Dirección Detallada, Dirección Alterna, Profesión/Título, Avisar a (Nombre), especialidad "Otra..." y Cursos/Habilidades Adicionales. Doble capa: se transforma en vivo mientras se escribe (handleChange vía UPPERCASE_FIELDS, más los updaters de arrays/SpecialtySelector) y de nuevo al guardar en employeeSlice.js (addEmployee/updateEmployee), para blindar también datos legacy en modo edición. Deliberadamente excluidos: Correo Electrónico (convención minúscula), username, teléfonos/DUI/ISSS/AFP (numéricos), y los selects con catálogo fijo (Departamento, Municipio, Institución AFP, Banco) que no son texto libre. Verificado en vivo: "juan carlos" → "JUAN CARLOS", "pérez de garcía" → "PÉREZ DE GARCÍA", "colonia escalón..." → "COLONIA ESCALÓN..." (acentos se preservan)
// v2.4.4 — feat(personal): 7 ajustes al modal Nuevo/Editar Empleado. (1) Quitado el subtítulo "Nueva ficha de empleado" (UnifiedModal ahora no renderiza el <p> si getModalSubtitle() devuelve null). (2) Nombres/Apellidos ahora validan formato (solo letras/acentos/Ñ/espacios/guiones/apóstrofes, mínimo 2 caracteres) client-side (isValidPersonName, badge "Solo letras") y server-side (validateOptionalFormats); "apellido de casada" ya funcionaba (campo de texto libre, sin cambios necesarios ahí). (3) Validación de numeración de El Salvador en Teléfono/Teléfono de Emergencia/teléfonos adicionales: 8 dígitos + debe iniciar en 2 (fijo), 6 o 7 (celular) — isValidSVPhone, client-side y server-side (validateOptionalFormats). (4) Género y Estado Civil ahora son requeridos (badge rojo "Requerido" cuando vacíos, mismo patrón visual que Nombres/Apellidos/Área de Trabajo). (5) Quitado "Ninguno" de Estado Civil (clearable={false}, ya no tiene sentido si es requerido). (6) Sección de dirección reordenada: Dirección Detallada ahora arriba, con botón "+ Agregar Dirección Alterna" debajo que agrega inputs de texto libre etiquetados "Dirección Alterna N" con botón de quitar (array extra_addresses, nueva columna vía migración employees_add_extra_addresses); Departamento/Municipio quedaron después. (7) Quitado "Ninguno" de Departamento (clearable={false}) — Municipio también, por consistencia (mismo tipo de campo). employeeSlice.js actualizado para persistir extra_addresses en addEmployee/updateEmployee. Verificado en vivo: sin subtítulo, "Juan1" marca "Solo letras", "1234-5678" marca "Debe iniciar en 2, 6 o 7", Estado Civil sin "Ninguno" en el dropdown, botón de dirección alterna agrega/quita filas correctamente
// v2.4.3 — docs(design): documentado en DESIGN.md el bug de StaffManagementView v2.4.2 (DataTable envuelto en un data-surface="card" adicional) como regla explícita — nueva nota en §14 DataTable ("Never wrap DataTable in an extra card container") citando VentasView como referencia (DataTable/TablePagination sueltos, sin wrapper), más entrada corta en §31 Anti-Patterns para que sea fácil de detectar en revisión
// v2.4.2 — fix(personal): 2 correcciones en StaffManagementView. (1) La tabla vivía dentro de un data-surface="card" adicional (bg-white/30 backdrop-blur-2xl + scroll interno propio) que duplicaba el card que el propio DataTable ya trae — por eso se veía distinta a VentasView, donde DataTable/TablePagination van sueltos en el flujo normal de la página. Quitado el wrapper doble y el scroll interno redundante (GlassViewLayout ya provee su propio contenedor con scroll); también se quitó el toolbar "N Empleados Listados" + badge "Filtrado por" (VentasView no tiene ese texto, el conteo solo vive en TablePagination). (2) La cuenta técnica "Administrador del Sistema" (system_role=SUPERADMIN, username sufarmasalud, usada para acceso de sistema, no una persona real) aparecía mezclada en el listado de personal — excluida en scopeFilteredEmployees por system_role, igual que ya se hace por scope de sucursal. Verificado en vivo: Total bajó de 47→46, buscar "Administrador" solo trae a Carlos Renderos (rol real), layout de la tabla ahora idéntico al de Ventas
// v2.4.1 — fix(ventas): las stat cards (Facturas/Total Ventas/Ticket Prom./Pts. Canjeados) no se actualizaban al activar Anuladas, Receta Médica (antibiótico) o buscar — fetchStats siempre llamaba al RPC get_ventas_stats/get_puntos_canjeados, que no tiene parámetro para esos 3 filtros y además excluye NULA/DTE INVALIDADO siempre (usa sales_daily_stats pre-agregado solo para ventas válidas, por eso no se puede simplemente agregarle un parámetro sin romper el fast-path). Sucursal y período sí llegaban al RPC correctamente — el bug era específico de Anuladas/antibiótico/búsqueda. Fix: cuando alguno de esos 3 está activo, fetchStats agrega en el cliente con exactamente los mismos filtros que fetchRows (mismo query a sales_invoices, mismo cálculo de puntos canjeados vía sales_invoice_items deduplicado) en vez de usar el RPC; sin comparativo de período anterior en ese modo (evita % engañoso comparando universos distintos). Verificado en vivo: activar Anuladas en Julio 2026 → cards muestran Facturas 7 / Total $154.10 / Ticket Prom $22.01, exactamente la suma de las 7 filas anuladas visibles en la tabla
// v2.4.0 — feat(personal): mejoras al modal Nuevo/Editar Empleado. (1) Rename app-wide "colaborador"→"empleado" (51 ocurrencias en 21 archivos: labels, toasts, tooltips, columnas, placeholders — incluye llaves internas de EncuestaView.jsx usadas para persistir resúmenes IA en surveys.ai_summaries, renombradas de forma consistente en ambos arrays del archivo). (2) LiquidSelect: nuevo prop `clearLabel` (default 'Todos', backward-compatible) — el botón de limpiar del componente mostraba literalmente "Todos" en CUALQUIER select con clearable, incluyendo campos de datos personales donde no tiene sentido (Género, Estado Civil, Nivel Académico, etc.); ahora usa clearable={false} donde no aplica clear (Género, Tipo de Cuenta) y clearLabel="Ninguno" donde sí (Estado Civil, Departamento, Tipo de Sangre, AFP, Banco, Cargo Secundario). (3) Validación de formato de correo (regex + mensaje inline igual que DUI, más bloqueo server-side en validateOptionalFormats de employeeSlice.js). (4) Nivel Académico rediseñado como sección interactiva: Educación Básica (grado finalizado 1°-9° a la par), Bachillerato General (sin campos extra) y Bachillerato Técnico (agregado, especialidad vía SpecialtySelector — catálogo de 19 especialidades MINEDUCYT tradicional+reforma 2026 + "Otra especialidad" con texto libre), Técnico Superior (especialidad con catálogo de 10 carreras comunes en farmacia/retail + "Otra"), toggle "¿Actualmente estudiando?" con mes/año de inicio + duración en años y fecha estimada de fin calculada, campo Profesión/Título variable según nivel (oculto en Básica/Bachillerato General), "+ Agregar Curso/Habilidad" para cursos adicionales (array). Nuevas columnas en employees: education_grade_completed, education_specialty, is_studying, study_start_date, study_duration_years, additional_skills[], extra_phones[] (migración employees_add_education_and_extra_fields). (5) Estado Civil movido junto a Género (misma fila). (6) "+ Agregar" teléfonos adicionales (array extra_phones, cada uno con botón de quitar). addEmployee/updateEmployee en employeeSlice.js actualizados para persistir todos los campos nuevos. Verificado en vivo: los 7 niveles académicos, especialidad+"Otra", toggle de estudiante con mes/año/duración, teléfono adicional, botón de curso/habilidad
// v2.3.17 — fix(personal): stat cards y pill de Sucursal quedaban pegadas (sin el espacio hacia la derecha que sí tiene VentasView) — al angostar las cards en v2.3.15 quité por error el flex-1 min-w-0 del DIV contenedor completo, cuando el problema real había sido el flex-1 de cada card individual (StatCard compartido). Ahora que las cards usan StaffStatCard sin flex-1 propio, se restauró flex-1 min-w-0 solo en el contenedor que las agrupa — empuja el pill de Sucursal al extremo derecho sin volver a estirar las cards. Verificado en vivo: layout ahora idéntico al patrón de VentasView (cards agrupadas a la izquierda, pill al extremo derecho con espacio real entre ambos)
// v2.3.16 — docs(design): corregido DESIGN.md §17 Filter Pills — el texto decía que los filtros van en filtersContent (header de GlassViewLayout), pero la propia referencia citada (VentasView) los renderiza en el body, junto a las stat cards (FilterControls en TabVentas/TabVendedores/TabProductos, nunca pasado a filtersContent). El doc contradecía su propio ejemplo. Corregido para reflejar el patrón real: filtro pill en el body (cards flex-1 izquierda, pill shrink-0 derecha), filtersContent reservado para buscador/tabs/acciones primarias. StaffManagementView (v2.3.13-15) ya seguía el patrón real correctamente — no requirió cambios de código, solo se documentó lo que ya era cierto
// v2.3.15 — fix(personal): 3 correcciones en StaffManagementView tras feedback directo. (1) Cards: el desglose por sucursal de v2.3.14 usaba el StatCard compartido con flex-1 basis-0, que se estira para llenar todo el ancho disponible — con solo 3-4 cards en pantallas grandes se veían enormes, muy distinto al patrón real de Productos/Pedidos (cards con min-w fijo, sin stretch). Se revirtió el contenido a Total/Activos/Apoyo/Otros (como pidió el usuario) con un StaffStatCard local angosto (min-w-[130px], sin flex-1, calcado del botón-filtro de TabInventario) — ya no ocupan espacio de más. Botón de exportar sigue en el pill de Sucursal. (2) Bug de foco: GlassViewLayout renderiza filtersContent DOS veces (copia desktop + copia mobile oculta por CSS) — el useRef compartido del input de búsqueda se ataba a la copia equivocada (probablemente la oculta), por lo que .focus() nunca aterrizaba en el input visible. Reemplazado por un callback ref inline (mismo patrón que ya usa VentasView), que llama focus() por nodo montado en vez de por referencia compartida. Verificado: el elemento activo tras abrir el buscador ahora es el input, no un botón. (3) Bug de búsqueda: "salud 2" traía también empleados de Salud 1/3 porque el código de empleado (ej. "201", "205") contiene el dígito "2" como substring dentro del texto combinado nombre+código+rol+sucursal usado por tokenMatch. Se separó el código a un fallback aparte (searchEmployees helper) — el match principal es solo nombre+rol+sucursal, código solo se prueba si ese match da 0 resultados. Verificado: "salud 2" ahora trae únicamente empleados de Salud 2
// v2.3.14 — feat(personal): stat cards de StaffManagementView pasan de Total/Activos/Apoyo/Otros (redundante en la práctica — Activos casi siempre = Total, Apoyo/Otros casi siempre 0) a Total + desglose real por sucursal (Top 2 por cantidad de personal + "+ Otras N" agregado), cada una clicable para filtrar por esa sucursal en 1 clic. Cálculo vía branchBreakdown nuevo — respeta scope de rol y búsqueda pero ignora el selectedBranch actual (para no colapsar el desglose a una sola sucursal una vez elegida). Se eliminó el estado activeStatFilter y el paso de filtro por estado operativo (ya no usado). Botón de exportar CSV movido del pill de búsqueda/acciones del header al pill de filtro de Sucursal (junto al select), dejando el header solo con Nuevo Empleado + búsqueda — mucho más compacto, ya no se ve "ancho" comparado a VentasView. Verificado con SQL directo: Salud 3 y Salud 1 son las 2 sucursales con más personal (7 c/u) pese a que La Popular aparece primero en la tabla (solo por orden de visualización, tiene 6); Total 47 = suma exacta de las 3 cards + Otras
// v2.3.13 — style(personal): stat cards de StaffManagementView reemplazadas por el componente compartido StatCard (src/components/common/StatCard.jsx) — el mismo que ya usa VentasView — en vez de 4 botones grid hechos a mano (rounded-[2rem], texto 2xl/3xl, iconos 20px); ahora comparten exactamente el lenguaje visual de Productos (rounded-2xl, texto-[22px], iconos 15px strokeWidth 1.5) y además se auto-igualan de ancho (flex-1 basis-0) sin necesidad de hardcodear min-w por card. El filtro de Sucursal se movió del header (mezclado con búsqueda/export/nuevo empleado en un solo pill) a su propio pill dedicado en el body, a la derecha de las stat cards — mismo patrón exacto que VentasView (FilterControls junto a los StatCard) y que las 3 tabs de Productos (cards izquierda flex-1, pill derecha shrink-0), con el botón de limpiar filtros ahora dentro de ese pill. El buscador expandible del header se investigó y NO se tocó: VentasView usa el mismo patrón morphing (búsqueda ↔ tabs) casi con las mismas clases — es el estándar real para vistas GlassViewLayout sin ViewTabBar, no una desviación. Verificado en vivo: cards de igual alto/ancho, pill de Sucursal sin truncar, filtro "Otros" activa correctamente con botón de limpiar en el pill
// v2.3.12 — fix(personal): auditoría DESIGN.md en StaffManagementView (Listado de Personal). El footer de paginación estaba reimplementado a mano con un <select> nativo para el tamaño de página — viola la regla más dura del proyecto ("no <select> nativo, usar LiquidSelect") y además duplicaba el componente compartido TablePagination (ya usado por las 3 tabs de Productos, que no usa select nativo). Reemplazado por <TablePagination>; itemsPerPage default 15→25 para calzar con PAGE_SIZE_OPTIONS=[25,50,100] del componente compartido. También corregido: el banner "resultados similares" (isFuzzy) se renderizaba como children de <DataTable>, terminando como un <div> inválido dentro de <tbody> (HTML5 foster-parenting lo saca de la tabla) — movido a renderizar inmediatamente antes de <DataTable>, como especifica DESIGN.md §24. Verificado en vivo: paginación funcional sin <select> nativo, 47 colaboradores, pill de tamaño de página (25/50/100) presente en el DOM. Pendiente de decisión (no tocado): el buscador expandible del header usa surface tokens ad-hoc no documentados (no reutiliza SearchInput/ViewTabBar), y las 4 stat cards usan una escala visual distinta a las de Productos (rounded-[2rem] vs rounded-2xl, texto 2xl/3xl vs 22px)
// v2.3.11 — fix(productos): auditoría DESIGN.md ampliada a las 3 tabs (Catálogo/Inventario/Gestión de Stock). Hallazgo grave en TabSinVenta.jsx: cada fila usaba border-l-[3px] con color dinámico (verde/ámbar/naranja/índigo/gris según nivel de sugerencia, o verde/rojo según in_minmax) — viola la regla más explícita del proyecto ("nunca border-l coloreado en filas/cards/listas", memoria feedback_no_left_border_indicators); la info ya estaba duplicada en los badges de la columna Sugerencia/Min-Max, así que se quitó sin pérdida de información. También corregido: sub-filter cards de la misma vista usaban text-[21px] mientras la card "total" usa text-[22px] (inconsistencia propia del archivo); divisor vertical h-12 bg-slate-200/50 desalineado con el h-14 bg-slate-100 de TabCatalogo — unificado a h-14 bg-slate-100. Filter pill normalizado al spec exacto de DESIGN.md §17 (bg-white/80 border-slate-200/70) en TabCatalogo (tenía bg-white 100% opaco + border-slate-200/80) y TabSinVenta (tenía bg-white/60 border-white/50 — el más alejado del spec de las 3 tabs)
// v2.3.10 — style(inventario): auditoría contra DESIGN.md — badge "ANTIBIÓTICO" corregido a "Bajo Receta" (única de las tabs de Productos que usaba el label viejo; TabCatalogo ya usa "Bajo Receta" en sus 2 badges, regla de memoria feedback_antibiotico_label) y el `<th>` del desglose expandido (Presentación/Lote/Vence/Cant./Unidades) pasó de text-slate-400 a text-slate-500 para igualar el color de header que ya usa el propio DataTable (tk.thText) — antes había dos grises distintos para "header de tabla" en la misma vista. Resto de la vista (filter pill, stat cards, empty/loading state, LiquidSelect, sort pattern, botón Reintentar) ya calza con el patrón de su tab hermano TabCatalogo — sin cambios ahí
// v2.3.9 — fix(inventario): al desplegar un producto en la tabla Inventario, ya no se muestran presentaciones sin inventario — handleExpand traía TODAS las filas de `inventory` (regular y vencidos) sin filtrar por cantidad, así que una presentación con cantidad=0 aparecía igual (en gris) junto a las que sí tienen stock. Se agregó `.gt('cantidad', 0)` a ambas queries (regular + vencidos) en TabInventario.jsx. Confirmado por SQL: TRANSPORE 1X10 YDS X 12 3M/CUREBAND en Salud 1 tenía 1 fila PAQUETE cantidad=0 + 1 fila UNIDAD con stock — ahora solo la de UNIDAD se trae
// v2.3.8 — fix(inventario): jerarquía de sub-orden corregida — al ordenar por Laboratorio, la v2.3.7 sub-ordenaba primero por Sucursal y luego por Producto (agrupaba todo Bodega junto, con los productos revueltos alfabéticamente dentro), cuando debía ser Laboratorio → Producto → Sucursal (ej. ENSURE ADVANCE FRESA X 400GR debe listar sus 7 sucursales juntas en el orden de negocio antes de pasar al siguiente producto). Solo BD: se invirtió el orden de las dos claves de tie-break finales en las 4 rutas del RPC inventory_grouped (descripcion ahora va antes que el rango de sucursal). Verificado en vivo: ENSURE ADVANCE FRESA X 400GR agrupa Bodega→La Popular→Salud1→2→3→4→5 antes de pasar a X 850GR
// v2.3.7 — fix(inventario): orden de Sucursal en la tabla Inventario ahora sigue el orden de negocio (Bodega, La Popular, Salud 1..5) en vez del erp_sucursal_id crudo — antes el sort por Sucursal (o el sub-orden implícito al ordenar por Laboratorio) salía en orden numérico de ID (Salud1,2,3,4,LaPopular,Salud5,Bodega). Solo BD: las 4 rutas internas del RPC inventory_grouped ahora usan un CASE de rango fijo (Bodega=1, LaPopular=2, Salud1..4=3-6, Salud5=7) tanto para el sort explícito p_sort='sucursal' (asc/desc) como de sub-orden (tie-break) bajo cualquier otro sort — así "ordenado por Laboratorio" ahora también agrupa correctamente por sucursal en el orden esperado dentro de cada laboratorio. Cero cambios de frontend (TabInventario.jsx solo pasa p_sort/p_sort_dir, la lógica vive en el RPC). Verificado en vivo: sort Sucursal asc → Bodega primero; sort Laboratorio asc → dentro de "1-ABBOTT NUTRICIONAL" todo Bodega aparece antes que La Popular/Salud1-5
// v2.3.6 — feat(inventario): reordenar columnas de la tabla Inventario a Sucursal | Laboratorio | Producto | Presentación | Lote | Und. | Vence, orden por defecto ahora es Laboratorio ascendente, y "VARIOS" en Lote (multi-lote) ya no se ve en gris/cursiva — mismo font-mono text-slate-500 que un lote normal. Requirió agregar la columna `laboratorio` (join a `laboratorios`) y la rama de sort `p_sort='laboratorio'` en las 4 rutas internas del RPC inventory_grouped (paths A/B/C/D — MV + raw scan de vencidos), ya que antes el nombre del laboratorio se resolvía client-side vía una query aparte a `products` y no existía forma de ordenar por él a través de la paginación server-side; TabInventario.jsx ahora usa `group.laboratorio` directo del RPC (se eliminó labMap y la query extra). Verificado en vivo: build limpio + sesión real (Edwin Nuñez) mostrando SYNTHROID con "VARIOS" en Lote con estilo idéntico a lotes normales y orden alfabético por laboratorio (ABBOTT primero)
// v2.3.5 — feat(inventario): filtro "Área vencidos" al ver Bodega — tarjeta-botón nueva (rose, PackageX) visible solo con sucursal=Bodega que lista los productos con unidades en el área física de vencidos (ubicación 2); usa el PATH D ya existente del RPC inventory_grouped (p_area_vencidos, MV vencidos_unidades>0) que estaba sin conectar en el frontend; contador = productos con "N V" (vencidosMap), exclusión mutua con Vencidos-por-fecha y Próx. a vencer, y se apaga solo al cambiar de sucursal; verificado en vivo: 71 productos en el área de bodega. Además se quitó el indicador de último sync ("ahora mismo / hace Xh") del header de Inventario
// v2.3.4 — fix(inventario): productos con stock SOLO en área de vencidos volvieron a la vista Inventario — tras separar ubicaciones (v2.3.3), inventory_grouped_mv seguía con WHERE is_vencidos=false y los productos sin stock regular desaparecían del listado (38 productos de bodega invisibles, ej. TOPRON JBE X 120 ML). MV recreada (solo BD, cero cambios de frontend): agrupa TODO el inventario, métricas regulares (unidades/lotes/fechas/costo→inversión) vía FILTER (NOT is_vencidos) manteniendo su semántica exacta, y columna nueva vencidos_unidades; ahora esos productos rinden "0 und / N V" con su sección Ubicación Vencidos al expandir (la UI ya lo soportaba: vencidosMap + presentaciones null-safe). Índices recreados igual (uq_igmv para REFRESH CONCURRENTLY del cron cada 2 min) + REVOKE anon/authenticated (MV privada, regla 6). Verificado: TOPRON JBE 0/3V en MV, 38 solo-vencidos visibles, 2,587 filas suc6
// v2.3.3 — fix(inventario): bodega ya no mezcla el área de vencidos en el stock regular — la descarga "regular" de bodega usaba id_ubicacion=0 del ERP (TODO mezclado), así que las unidades vencidas viajaban dentro de filas is_vencidos=false y el generador de pedidos las contaba aunque get_pedido_preview filtra NOT is_vencidos (el filtro existía pero el dato venía contaminado; en la UI los mismos lotes salían duplicados en Inventario Regular y Ubicación Vencidos). Fix: columna nueva erp_sucursal_map.inv_ubicaciones jsonb — bodega=[{id:1 regular},{id:2 vencidos}] — y sync-dte-sales lee las ubicaciones desde BD con prioridad BD→secret→[{0}] (el secret ERP_INV_BRANCH_MAP queda solo para credenciales; sucursales sin config BD siguen igual). Verificado en vivo: TOPRON quedó 1 und regular (BEA069) + 3 en vencidos, bodega bajó de 13,687→13,542 und regulares (~145 fantasma eliminadas por el cleanup synced_at), cron cada 1 min + MV cada 2 min lo mantienen. get_pedido_preview/mv_stock_analysis/inventory_grouped_mv ya filtraban is_vencidos — sin cambios ahí
// v2.3.2 — feat(notificaciones): Deshacer al borrar + indicador de acción — (1) borrar (individual o todas) abre ventana de 3s antes del DELETE real: la fila se convierte en franja "Notificación borrada · Deshacer" con barra de cuenta regresiva (framer-motion lineal 3s); el masivo muestra franja bajo el header "Borrando N…" con las filas atenuadas; Deshacer cancela el timer y restaura; el commit borra SOLO los IDs capturados al click (deleteNotificationsByIds nuevo en slice — lo que llegue por realtime durante la ventana no se toca); StrictMode-safe (ids+timer en ref, commit fuera de updaters); cerrar el panel no cancela el borrado, logout sí; (2) las filas ya no se ven iguales: solo las que tienen deep-link muestran chip con verbo (Revisar solicitud / Confirmar recepción / Confirmar llegada / Ver detalle / Ver) — azul si no-leída, gris si leída, con micro-desplazamiento al hover — y las filas sin link pierden el hover y el cursor pointer (solo marcan leída)
// v2.3.1 — feat(notificaciones): campana v2 con Liquid Glass — panel con el glass canónico del proyecto (variantes light/dark vía useTheme, mismo tratamiento que LiquidSelect: blur+saturate, borde blanco, sombras multi-capa, shimmer superior) y animación de apertura framer-motion; NUEVO borrar: individual (X al hover en desktop / siempre tenue en touch, exit animado) y "Borrar todas" con confirmación inline de 2 taps (auto-cancela 3.5s) — policy RLS notifications_delete (solo destinatario) + deleteNotification/clearAllNotifications en slice; interactividad: chip de acción en no-leídas accionables (Revisar solicitud / Confirmar recepción / Confirmar llegada / Ver detalle) y clic navega al deep-link; realtime visible: fila nueva entra con slide + flash azul 4s y la campana hace wiggle 1.6s al subir el contador (además del toast y push existentes); scroll oculto (scrollbar-hide); contraste corregido a mínimos del DS (slate-500+)
// v2.3.0 — feat(notificaciones): separación Aviso/Notificación/Solicitud — cada canal con UN propósito. (1) BD: tabla notifications (1 fila por destinatario, RLS solo-destinatario vía auth_employee_id() nuevo, realtime, retención cron 90d) + RPCs DEFINER notify_employees/notify_branch con push server-side opcional (send-push-notification); (2) UI: campana NotificationBell (desktop flotante + header móvil) con panel glass, contador, marcar leída(s), deep-links y fila fijada de avisos sin leer; hook useNotificationsChannel (fetch + realtime + toast) montado una vez en AppLayout; notificationsSlice en staffStore; (3) Solicitudes: crear solicitud ahora NOTIFICA al aprobador con push (RRHH createRequest ambos caminos, widgets anulación/pago/vendedor/cliente, minmax) — antes nadie se enteraba; decisiones (aprobar/rechazar/avance de nivel/vacaciones confirmadas/alerta cobertura) van a la campana en vez de ensuciar avisos; FIX: los 4 push del widget facturación usaban { employeeId } que el edge function no entiende → pusheaban a TODA la empresa, ahora target EMPLOYEE correcto; (4) Pedidos: los 10 inserts de tracking a announcements → notifications por sucursal; matriz de ruido: push solo accionables (conductor llegó, reenvío en camino, problemas/faltantes que requieren otro envío, diferencias), resto solo campana (en preparación, en camino, cajas de más, confirmado OK); (5) Limpieza: 37 filas de ruido migradas de announcements → notifications (EMPLOYEE conserva lectura; tracking BRANCH fan-out marcado leído) y announcements quedó 100% comunicados (Saly + AnnouncementsView únicos escritores); minmax_change_requests se mantiene como tabla propia (RPCs aplican a product_stock_params/ERP + aprobación masiva) pero unificado al mismo canal de notificaciones
// v2.2.470 — feat(solicitudes): vista del aprobador para Cambio de Cliente — RequestsView reconoce CLIENT_CHANGE_REQUEST: badge teal "Cambio de Cliente" en catálogo (requestsSlice), ícono Contact, estilos de tarjeta teal, resumen en fila (correlativo · actual → nuevo) y bloque de detalle antes→después: tarjeta de factura (correlativo + total) y comparativa Cliente actual | Cambiar a con avatar de inicial y NIT/DUI del nuevo
// v2.2.469 — feat(dashboard): widget Modificar Facturación — (1) nuevo tipo "Cambio de Cliente" (CLIENT_CHANGE_REQUEST): tarjeta teal en el selector, muestra el cliente actual y buscador server-side sobre los 23K clientes completos (tokens AND en search_name normalizado + NIT/DUI/teléfono/ERP, insensible a acentos en ambas direcciones vía columna generada customers.search_name, debounce 300ms, top 30) — precisión verificada: "jose"→solo JOSE/JOSÉ, "maria lopez"→163 exactos, PEÑA/NUÑEZ encontrados sin acento; metadata con cliente actual/nuevo + push al supervisor + audit; (2) filtro de fecha ahora usa LiquidDatePicker (eliminado el input date nativo — regla del proyecto)
// v2.2.468 — feat(empleados): campos opcionales con formato fijo ahora BLOQUEAN el guardado si están a medias — validateOptionalFormats en addEmployee/updateEmployee: Teléfono (8), Tel. Emergencia (8), ISSS (9), NUP (12); regla "o se completa, o se borra para quedar pendiente" con mensaje explícito en el banner del modal; vacío sigue siendo válido (banner Información Pendiente lo recuerda en edición); testeado 9/9 casos; 0 empleados existentes afectados (verificado en BD)
// v2.2.467 — feat(empleados): DUI ahora BLOQUEA el guardado si es inválido/duplicado/incompleto (antes solo aviso visual) — validateDui en addEmployee/updateEmployee (formato 00000000-0 + dígito verificador + duplicado, testeado 4/4 casos); BD: índice único employees_dui_unique + CHECK chk_employees_dui_format (probados en vivo); máscara nueva en Número de Cuenta (dígitos y guiones, máx 25); avisos "Incompleto"/"Debe tener N dígitos" en DUI a medias, Teléfono, Tel. Emergencia, ISSS (9) y NUP (12)
// v2.2.466 — feat(empleados): el modal de creación/edición muestra el PIN del carné (SHA-256 del código) en vivo bajo Cod. Empleado — pill oscura con el PIN de 8 caracteres que se recalcula al escribir el código + botón copiar al portapapeles con toast; es el valor del código de barras del carné
// v2.2.465 — fix(fotos/encuestas): 7 renders más con orden photo_url||photo invertido a photo||photo_url (StaffManagementView era el reporte original — foto 400 en Personal; VentasView ×3, EarlyExitForm, FeedbackOverlay condición, EmployeeFormModal condición); fix embed roto en perfil: survey_responses→survey_bloques no tiene FK (PGRST200, bug pre-existente silenciado) — bloques ahora anidados vía surveys(bloques:survey_bloques(...)) + fallback result.survey?.bloques; verificado REST 200
// v2.2.464 — feat(storage): Fases 2+3 — bucket empleados (fotos) privado: firma en LOTE (createSignedUrls 12h) en fetchBoot/fetchKioskBoot (photo=firmada, photo_url=crudo identificador BD); AuthContext withSignedPhoto en los 4 logins (7d) + re-firma al arrancar de caché (photoRaw); signPhotosDeep() en las 10 vistas con selects directos de photo_url (Encuestas, VentasPerdidas, RecepcionModal, TabPedidos×3, CrearRutaModal, TabMinMax×2, Facturación historial); escritores que copian fotos a BD guardan RAW (confirmed_by_photo, vendor_photo en anulaciones); 9 renders reordenados photo||photo_url; límites nuevos: documents 10MB pdf/imágenes, empleados 10MB imágenes. Verificado: privado en BD, requests nuevas 400, CDN expira ≤1h
// v2.2.463 — feat(storage): Fase 1 buckets privados — documents (boletas ISSS, finiquitos, docs legales) y payment-proofs ya no son públicos: cualquier URL compartida deja de funcionar sin sesión; nuevo helper storageFiles.js (getSignedFileUrl/openStoredFile) convierte las URLs guardadas en BD a URLs firmadas con expiración 1h al momento de mostrar (sin migración de datos); parcheados los 5 puntos de visualización: FormDocumentViewer (visor central + loading "Generando acceso seguro"), FileUploader de sucursales, comprobantes en Facturación, documentos del empleado (vista propia) y botón de descarga del expediente en EmployeeDetailView (estaba muerto, sin onClick); policy documents_authenticated_select en storage.objects. Pendiente Fase 2: bucket empleados (fotos) vía firma en lote en fetchBoot/kiosk
// v2.2.462 — feat(db): backup semanal + eficiencia — edge function backup-critical-tables exporta 28 tablas de trabajo manual/config (empleados, permisos, min/max 17.8K filas, dispatch_rules, promociones, nómina, audit_logs) como JSON gzip al bucket privado 'backups' con retención 60 días (cron domingos 2am SV; primer run verificado 28/28, 1.16MB; datos ERP no se exportan — se recuperan por resync); RPC backup_dump_table con whitelist solo service_role; refrescos pesados (product_sales_monthly_agg 4.2s + sales_daily_stats 2.7s cada 15min) alineados al horario operativo 6am-11pm SV en vez de 24/7
// v2.2.461 — feat(db): protección contra modificación/eliminación masiva — policies granulares en las 35 tablas que permitían DELETE/UPDATE abierto a cualquier autenticado: SELECT abierto, escrituras solo las que el portal ejecuta (verificado por grep), DELETE eliminado en historial (employee_events/documents, timesheets, rutas, pedido_*), candado auth_can_edit_any(módulos) en config/catálogos (product_stock_params→minmax|pedidos, customers solo-lectura, branches, dispatch_rules, promotions, roles, shifts, overtime_bank, stock_config); auth_employee_role_id/auth_has_module_permission ahora resuelven por uid→code→username (los logins por carné ya no quedaban sin permisos); helper nuevo auth_can_edit_any; VACUUM sales_invoices + autovacuum 0.02 en sales_invoices/items. Verificado con JWTs simulados: Supervisor y Dependiente-por-carné editan min/max ✓, JWT sin empleado → 0 filas en todo lo destructivo ✓
// v2.2.460 — feat(db): hardening completo BD (advisor 199→108, ERRORES 14→0) — RLS en 9 tablas abiertas (overtime_bank, stock_config, erp_sucursal_map, product_last_sale, product_sales_monthly_agg, etc.) con policies dimensionadas al uso real; 5 vistas a security_invoker; 32 funciones SECURITY DEFINER revocadas de PUBLIC/anon (kiosco pre-login exento); search_path fijo en 47 funciones; MVs fuera de la API (mv_product_factor conserva authenticated por get_pedido_preview INVOKER); drop mv_product_last_sale (muerta); 9 índices FK nuevos + 9 índices sin uso eliminados (~36MB); cron purge-sync-logs-daily (retención 90d solo logs de sync). Códigos de empleado: los 6 no numéricos migrados a 71015-71020 con PIN regenerado y metadata Auth sincronizado. Convenciones BD documentadas en CLAUDE.md. Cero cambios de datos de negocio — verificado end-to-end (get_pedido_preview, get_stock_analysis, pedidos en curso, kiosco) con SET ROLE authenticated/anon
// v2.2.459 — feat(empleados): código de empleado SOLO numérico — inputs con máscara de dígitos (EmployeeFormModal + FormNovedad CODE_CHANGE), generador produce 4 dígitos (antes EMP####), validación /^\d+$/ en addEmployee/updateEmployee/registerEmployeeEvent y trigger BD enforce_numeric_employee_code (INSERT + UPDATE OF code solo cuando cambia — los 6 códigos legacy SUPERADMIN/ADM-005/carlos/celina/edwin/rutilio siguen funcionando sin tocar). Con dígitos desaparece la inconsistencia de case en el hash SHA-256 del kiosk_pin
// v2.2.458 — feat(empleados): cancelar revierte + acciones programadas — (1) cancelEmployeeEvent revierte el cambio aplicado usando snapshot previousValues del metadata (solo campos cuyo valor actual sigue siendo el aplicado; cancelar una baja restaura sucursal/cargo/pin, re-inserta employee_branches y des-banea las cuentas Auth); (2) eventos con fecha efectiva futura quedan SCHEDULED (no se aplican al registrar) y los aplica el cron diario apply-scheduled-employee-events (5am SV, pg_cron+ADMIN_INVOKE_SECRET) con re-validación de headcount y snapshot al aplicar; banner "Acción Programada" en FormNovedad; disable-employee-auth v3 acepta ADMIN_INVOKE_SECRET para invocación desde el cron
// v2.2.457 — fix(empleados): overhaul módulo de personal — (1) baja revoca acceso real: nueva edge function disable-employee-auth banea cuenta @farmalasa.app + cuentas carné @staff.local y cierra sesiones; loginWithUsername bloquea status !== ACTIVO; rehire re-activa cuentas; (2) acciones RRHH ahora APLICAN el cambio: PROMOTION/TRANSFER/SALARY/CODE_CHANGE escriben en employees (antes solo registraban el evento) con validación de headcount + código duplicado server-side; (3) "Quitar de sucursal" funciona: updateEmployee acepta branch_id null (antes solo truthy); (4) BD: constraints de status unificados (ACTIVO/INACTIVO/BAJA/LIQUIDADO/SUSPENDIDO); (5) bulk-create-employee-users v12 usa temporal aleatoria (no "1234" — tomable y además fallaba por mínimo 6 chars); (6) contraseña temporal del alta visible en toast 20s + clipboard; extras: deleteEmployee unificado vía registerEmployeeEvent(TERMINATION), baja limpia employee_branches, fetchBoot pagina employees/events/docs/branches (cap 1000 PostgREST), headcount en updateEmployee/rehire/jefaturas, generateUniqueCode verifica colisiones, getEffectiveBranchId lee metadata.targetBranchId, getEffectiveStatus cubre BAJA/LIQUIDADO/SUSPENDIDO
// v2.2.456 — fix(app): auto-reload en vite:preloadError — al editar empleado con una pestaña de un deploy anterior, el chunk lazy (EmployeeFormModal) ya no existía y el SPA fallback devolvía index.html ("text/html is not a valid JavaScript MIME type"); ahora la app se recarga sola (guard 30s anti-loop). Hardening flujo personal: code con trim + guard de duplicados en addEmployee/updateEmployee (el código es la credencial del carné), code obligatorio también al editar, índice único case-insensitive employees_code_norm_key en BD
// v2.2.455 — feat(login): prioridad inicial del lector — primeros 10s sin foco en inputs (se libera el autofocus del navegador) con countdown visible en la pill ("usuario en Xs"); si no hay login al vencer, el foco pasa automáticamente a usuario; la ventana se cancela al escanear, abrir cámara o tocar los campos. Botón de cámara solo se muestra si el dispositivo tiene cámara (enumerateDevices videoinput)
// v2.2.454 — fix(login): escaneo de carné no iniciaba sesión (3 causas: ensure_user_by_code creaba cuenta con password aleatoria para match por code → signIn fallaba; onAuthStateChange descartaba cuentas kiosk sin must_change_password=false → perfil nunca se seteaba; input oculto del lector se remontaba cada 200ms por el countdown perdiendo foco/buffer). Rediseño LoginView: usuario+contraseña siempre visibles, pill de lector siempre activa con captura global de teclado (Enter-terminated), pausa automática al escribir en los campos, cámara opcional; login() ahora completa el perfil determinísticamente (2ª llamada autenticada a ensure_user_by_code + completeLogin)
// v2.2.453 — fix(sql): get_pedido_preview — doble redondeo en reponer bloqueaba despachos con dispatch_rules (ANARA×3 pedía 2 sobres pero no despachaba nada); ahora el umbral 40% se evalúa una sola vez contra need_u real (sin redondeo previo al factor de presentación) en vez de reponer*factor ya redondeado; solo afecta sucursales no limitadas por bodega, no toca distribución entre sucursales
// v2.2.452 — fix(pedidos): MIN/MAX sin auto-revert — flechas y edición secuencial funcionan; validación solo al detener escritura; onBlur solo muestra borde rojo; confirmación 0/0 con ConfirmModal (no window.confirm)
// v2.2.451 — fix(pedidos): dispatch_multiplo columna en pedido_items + backfill + confirm_pedido actualizado; badge regla ahora muestra multiplo correcto (ej. UNIDAD | ×3)
// v2.2.450 — fix(pedidos): React error #310 — mover revertToOrig useCallback antes del early return de loading para cumplir Rules of Hooks
// v2.2.449 — fix(pedidos/sql): revision_minmax usa approx_cajas(reponer) 40%; agotamiento cubre unit_base=NULL y approx>0; fmtRegla badge "CAJA ×12 | ×1"; MIN/MAX errores solo toast; reclasifica items activos
// v2.2.448 — fix(pedidos): inline MIN/MAX validación refleja constraint DB (min=0→max≤1; min≥1→max>min); doSave catch revierte editMap a origMap; onBlur revierte si error activo
// v2.2.447 — fix(sql): get_pedido_preview — revision_minmax solo cuando reponer×factor < unit_base (necesidad genuinamente baja); agotamiento cuando reponer×factor >= unit_base pero bodega no alcanzó (ej. La Popular ELECTROLIT MORA AZUL); reclasifica pedido_items activos existentes
// v2.2.446 — fix(minmax): hasRestaura para sucursales incluye has_manual (no solo bodega); resetToCalc rama sin-calc también limpia manual_min/manual_max + has_manual=false local
// v2.2.445 — fix(minmax): pedidos escribe min_units/max_units + limpia manual (no override); TabMinMax Restaurar live también limpia manual_min/max + has_manual=false en estado local
// v2.2.444 — fix(pedidos): fmtRegla — lee dispatch_tipo/dispatch_factor del item (sin join dispatch_rules que falla nested); columna "Regla"; motivo siempre "Necesidad baja" en sección; MIN/MAX auto-save 800ms debounce + validación + Restaurar + 0/0 rose
// v2.2.443 — fix(sql): get_pedido_preview — revision_minmax solo para productos CON dispatch_rule activa; sin regla + asignado=0 → agotamiento; UPDATE fix en pedido_items activos existentes
// v2.2.442 — fix(pedidos): revertir reclasificación — todos los revision_minmax van a "Revisar regla de despacho" (mezcla con/sin regla); motivo por fila diferencia ambos; fix agotamientoAll→agotamiento en JSX
// v2.2.441 — fix(pedidos): revision_minmax sin regla → sección "Stock insuficiente" (no "Revisar regla"); MIN/MAX siempre editable en fila: ventas 6M + inputs directos + Guardar + botón 0/0; datos de PSP via fetch en useEffect
// v2.2.440 — fix(pedidos): "Revisar regla de despacho" — fmtRegla muestra "Sin regla" vs badge por tipo; motivo diferencia sin-regla (stock insuf.) vs con-regla (necesidad baja); fila inline MIN/MAX editable por producto; nota de sección actualizada
// v2.2.439 — fix(pedidos): cajas_especiales_llegadas escrito a DB al confirmar reenvío (mismo bug que electrolit_ok); partial clear proporcional cuando algunas especiales aún faltan
// v2.2.438 — fix(pedidos): audit post-fix — electrolit_ok escrito a DB al confirmar reenvío; DifSection auto-fetch en cold load; indicador "Esperando vuelta conductor" en vez de botón invisible; CrearRutaModal pre-selecciona pedido del reenvío + incluye status parcial; toast en no-op segunda llegada; elimina double-loadActive
// v2.2.437 — fix(pedidos): 6 bugs flujo reenvío — (1) handleReportarDiferencias await + loadActive (card refresca sola); (2) DifSection visible en completado (historial read-only); (3) Reenviar no se oculta con pedido_status=completado si hay falta_cajas; (4) check vuelta_base_at: Reenviar bloqueado si conductor aún en ruta; (5) auto-abre CrearRutaModal tras confirmar reenvío; (6) electrolit_ok !== true (cubre null además de false)
// v2.2.436 — fix(minmax): 0/0 siempre muestra —/— (no solo dead/noHistory); panel MIN·MAX red en bodega muestra sucursales con 0/0 como —·— en vez de ocultarlas
// v2.2.435 — fix(pedidos): auditoría final TabPedidos — openFinalizarModal: try/catch/finally evita botón bloqueado en error; inline Iniciar+Base ruta: try/catch con toast de error en fallo DB
// v2.2.434 — fix(pedidos): 10 bugs módulo completo — DB: get_pedidos_en_curso agrega cajas_especiales_llegadas (DROP+CREATE); elimina overload legacy anular_pedido(uuid); RLS en pedido_apoyo/rutas/ruta_pedidos; índice compuesto pedido_items(pedido_id,status); TabEnCurso: num_pausas→pauses.length; TabGenerar: try/catch/finally en dashStats+sinBodega+refreshStats; TabRutas: status filter→todos los estados + realtime subscription; CrearRutaModal: catch en Promise.all + error visible en footer al fallar submit
// v2.2.433 — fix(pedidos): 9 issues flujo completo — ReenvioLlegadaModal bloquea confirmar si electrolit sin responder + badge "Pendiente"; fetchItems try/finally evita spinner eterno; RecepcionModal limpia presMap en re-apertura; PostCompletionSection auto-carga items + muestra quién confirmó; handleConfirmarTodo incluye especiales; LlegadaModal texto "Todas llegaron OK" cuando sin interacción; badge "Especial" en items sin caja_map
// v2.2.432 — feat(pedidos): cajas especiales en RecepcionModal (tiles E1/E2 con estado ok/dañada/faltante, header y flujo diferenciado); PostCompletionSection resumen post-completado en cards; borrador auto-guardado en LlegadaModal y FinalizarCajasModal con restauración
// v2.2.431 — fix(pedidos): quita badge "Entregado en sucursal"; Reenviar caja muestra modal confirmación con conteo pendiente; oculta Reenviar si completado; banner reenvío menciona Electrolit+especiales; real-time UPDATE en pedido_items; DifSection muestra foto+nombre proponente + cantidad Solicitado+Enviado+Físico
// v2.2.430 — fix(pedidos): PDF header más compacto + Caja row más grande + Cajas Adicionales gris (B&W); FinalizarCajasModal muestra "Pág. N" + texto "Primer producto" + oculta scrollbar; LlegadaModal placeholder "# de caja" + validación requerida + badge cajas extra; RecepcionModal elimina botón "Todo OK" redundante
// v2.2.429 — fix(widget-facturacion): findTargetEmployee busca por role_id=13 (Supervisor/a de Ventas) en vez de system_role genérico
// v2.2.428 — fix(widget-facturacion): solicitudes van a rol SUPERVISOR (no JEFE/SUBJEFE); fallback a ADMIN/SUPERADMIN si no hay supervisor en la sucursal
// v2.2.427 — fix(widget-facturacion): avatar vendedor junto al nombre (no al inicio de fila), buscador 2/3 + date picker 1/3, botón enviar sticky, header y detalle más compactos
// v2.2.426 — fix(widget-facturacion): título correcto, avatar vendedor en lista, detalle 2 cols + ID venta + fecha destacada, encabezado unificado en todos los formularios, cambio de vendedor sin códigos
// v2.2.425 — feat(facturacion): elimina Mi Horario; widget anulación → Solicitar Modificación a Facturación (anulación+CCF+crédito, cambio de pago, cambio de vendedor); nuevos tipos en RequestsView
// v2.2.424 — feat(alertas-dte): check-sales-alerts edge fn + cron 5min — 3 ventas consecutivas pendientes MH → push a Supervisor; CCF pendiente/anulada → push urgente; sales_alert_log evita duplicados
// v2.2.423 — fix(widget-inventario): quita colores por sucursal — todas neutral slate, solo vencidos rose
// v2.2.422 — fix(widget-inventario): bodega en ERP_BRANCH_MAP + vencidos en drill-down (AlertTriangle + rose)
// v2.2.421 — feat(widget-minmax): superpoderes en búsqueda — precarga catálogo completo paginado, smartFilter encuentra "GRVOL"→"GRAVOL"
// v2.2.420 — feat(widget-inventario): muestra sección "Bodega · Área de Vencidos" (rose) con lotes y cantidades; get_product_branch_summary devuelve vencidos_stock
// v2.2.419 — fix(pedidos): pill "stock insuf." en card igualado a estilo de los demás (slate-100/600)
// v2.2.418 — fix(pedidos): búsqueda se limpia al cerrar sección (useEffect on !open)
// v2.2.417 — fix(pedidos): agotamiento aparece en AMBAS secciones (enviados + stock insuf.); COLS_AGOTAMIENTO con col "Faltó"; búsqueda persiste al cerrar sección, smartFilter superpoderes, lupa siempre visible
// v2.2.416 — fix(pedidos): PDF incluye items agotamiento; búsqueda rediseñada (icono derecha → expande compacto, Escape cierra); sinCount+agotamientoCount en pie de PDF
// v2.2.415 — feat(pedidos): búsqueda dentro de cada sección del detalle de pedido (Productos enviados, Sin inventario, Stock insuficiente, Revisar regla)
// v2.2.414 — feat(pedidos): agotamiento de stock — nuevo flag cuando bodega tenía stock pero insuficiente para cubrir necesidad completa; RPC get_pedido_preview + get_pedido_item_stats actualizados; badge naranja "stock insuf." en cards y sección separada en detalle de pedido
// v2.2.413 — fix(inventario): "X und / Y V" global — rose-600 en lugar de amber, visible en todas las sucursales (no solo Bodega); expand vencidos en rose para todas las ramas
// v2.2.412 — feat(inventario/bodega): dual stock display — "7 und / 1 V" inline en Und. (ámbar, solo si tiene vencidos); expand muestra "Inventario regular" y "Ubicación vencidos" en secciones separadas; solo activo al filtrar por Bodega
// v2.2.411 — fix(ventas/productos): 3 fixes drill-down — (1) paginación estándar con selector de tamaño (25/50/100); (2) COF es c/IVA (solo CCF es sin IVA); (3) badges de tier con número (Viñeta=1 Desc=2 VIP=3 Clínica=4 Mayoreo=5 Premium=6 P7=7) en TabProductos y TabVentas
// v2.2.410 — feat(ventas/productos): drill-down tabla individual — (1) paginación de 20 filas con TablePagination; (2) precios c/IVA: precio unitario y total muestran valor con IVA para FAC/FCF, sin IVA para CCF/COF; (3) P. Unit. muestra número + badge de tier debajo; col "Total s/IVA"→"Total"; TablePagination oculta selector de tamaño cuando no hay onPageSizeChange
// v2.2.409 — fix(minmax): tooltip "Suc. pendientes" quedaba pegado — race condition async: onMouseLeave limpiaba pero el await supabase.rpc() resolvía después y re-seteaba; fix con tooltipCancelRef que aborta el resultado si el mouse ya salió; crea CLAUDE.md con regla 1000 filas PostgREST siempre cargada
// v2.2.408 — fix(minmax): CHUNK 5000→1000 — PostgREST corta a 1000 filas/request; revertir garantiza los ~4200 productos completos en 5 llamadas paralelas
// v2.2.407 — fix(minmax): búsqueda 100% fiable — cuando filtro de categoría oculta resultados, mensaje claro + botón "Quitar filtros y ver resultado"
// v2.2.406 — fix(search): superpoderes en 100% del codebase — FormLeadership, EmployeeDetailView, TabExpediente, EmployeeDocumentsView, EmployeeProfileView, TabLaboratorios, TabMinMax lab filter, TabMinMaxNetwork, ScheduleCalendar
// v2.2.405 — feat(search): estandarización completa §24 DESIGN.md — smartFilter/tokenMatch en VentasView TabProductos, SchedulesView, TabPedidos, TabMinMaxRequests, RecepcionModal, EncuestaAdminView picker, AttendanceMonitor, TabShifts
// v2.2.404 — fix(search): superpoderes en todos los tabs de Pedidos — TabGenerar sinBodega smartFilter+banner, TabReglas normSearch server-side, TabMetricas smartFilter, TabRutas/TabEnCurso tokenMatch
// v2.2.403 — feat(search): fuzzy fallback en TODOS los buscadores — smartFilter reemplaza tokenMatch en 14 vistas; banner "Resultados similares" en todas las listas; graovl→GRAVOL, S.S.N→SSN con tolerancia a errores
// v2.2.402 — feat(search): búsqueda inteligente en TODOS los buscadores — server-side normSearch antes de p_search (TabProductos/Inventario/Catálogo); tokenMatch en Facturación/Payroll/Announcements/Requests/Widget/TabHistory/Roles/Permissions/VacationPlan/EmpAnnouncements; S.S.N=SSN resuelto
// v2.2.401 — feat(search): searchUtils (normSearch+tokenMatch+fuzzyScore+smartFilter) + SearchInput component; MinMax/SinVenta/AuditView/StaffManagement/Branches/VentasVendedores con búsqueda inteligente; banner fuzzy en MinMax; S.S.N=SSN con puntuación stripping
// v2.2.400 — perf(minmax): 5 fixes carga — product_last_sale tabla+trigger elimina scan 548K, remueve d2 dead join, CHUNK 1K→5K, inv_all_pres filtrada por sucursal, índice parcial pending_drafts; bodega muestra sucursal de última venta
// v2.2.399 — fix(ui): "Abx"/"Antibiótico" → "Bajo Receta" en TabPedidos y TabCatalogo
// v2.2.398 — fix(pdf): Cajas Adicionales muestra subtexto und. cuando tiene_dispatch_label=true; propaga dispF a buildEspecialesBlock
// v2.2.397 — fix(pdf): isLabel usa tiene_dispatch_label=true en vez de CUSTOM_LABELS; agrega dispatch_rules al ITEMS_SELECT
// v2.2.388 — fix(pdf): revierte header a 3 filas; origen+destino en 1 línea sin salto (·); logo margin-right 10; farmacia margin-top 5 para centrado vertical
// v2.2.387 — fix(pdf): header — fusiona título+origen→destino en 1 fila (headerRows 3→2); logo margen derecho 7→10; nombre farmacia margin-top para centrado vertical con logo
// v2.2.386 — feat(pdf): Cajas Adicionales agrupadas por producto — una fila con rango E1–E5 + total cajas + lotes sumados; mismo ancho de columnas que tabla principal
// v2.2.385 — fix(pdf): isAdicional restringe adicionales a dispatch_label='CAJA' — ESTUCHE/BOLSA permanecen en tabla principal; caja_especial siempre a adicionales
// v2.2.384 — fix(pdf): isAdicional usa tiene_dispatch_label (DB) en vez de CUSTOM_LABELS+dispF>erpF — elimina falsos positivos en productos normales con presentacion CAJA; DB expone tiene_dispatch_label en get_pedido_preview; mejora texto "Mostrar en PDF como" en TabReglas
// v2.2.383 — fix(generar): elimina banner verde "Pedido confirmado" con botón Descargar; el toast ya notifica el éxito
// v2.2.382 — feat(pdf): sección "Cajas Adicionales" — renombrada desde "Cajas Especiales"; incluye Electrolit (dispatch_tipo CAJA/ESTUCHE/BOLSA con dispFactor>erpFactor) junto con cajas especiales; ambos tipos excluidos de tabla principal; helper isAdicional() centraliza la clasificación; printPerSucursal + printFromPedidoItems + getExactPageGroups actualizados
// v2.2.381 — perf(db): get_pedido_preview reescritura TEMP TABLE — elimina query monolítica 22 CTEs (planner tardaba 25s+); convierte a 12 TEMP TABLEs secuenciales con índices intermedios; cada paso planifica en <5ms; 1 sucursal: ~270ms, 6 sucursales: <1s; diagnóstico: create mv_product_factor + debug_pedido_timings
// v2.2.380 — perf(db): get_pedido_preview reescritura — elimina DISTINCT ON de inv_suc (→ GROUP BY); fusiona inv_suc+inv_agg, bodega_raw+bodega, bodega_lotes_raw+bodega_lotes_pres, lote_intersect+lotes_por_sucursal; MATERIALIZED en 9 CTEs claves (inv_agg, inv_bodega, necesidades, pres_units_needed, pres_units_total, ventas_suc, ventas_total, bodega, distribucion, con_reglas_uncapped, con_reglas, bodega_lotes); elimina suc_map redundante; reduce 31→22 CTEs
// v2.2.379 — fix(db): get_pedido_preview — box-fill corregido: box_cajas_case12 descuenta cajas ya asignadas por Cases 1/2 antes de repartir box-fill; box_fill_ranked excluye sucursales con Case 1/2; usa cajas_restantes como presupuesto real → Electrolit 4 cajas = Salud1:12 La Popular:12 Salud3:24 Salud2:0 (total=48, sin desperdicio)
// v2.2.378 — fix(db): get_pedido_preview — box-fill best-first: cuando bodega tiene >= 1 caja completa pero proporción no alcanza, redistribuye cajas por orden de urgencia (reponer DESC); unidades huérfanas (bodega < 1 caja total) se envían proporcional raw en pedido siguiente
// v2.2.377 — fix(db): get_pedido_preview — regla despacho respeta max_asignable: WHEN unit_base IS NOT NULL THEN 0 antes del ELSE asignado_raw; sin regla disponible pero max < 1 caja → asigna 0 (no bypass)
// v2.2.376 — fix(generar): código pedido en modo distribución global usa SUCURSALES.length → dist='3'; fix(db): get_pedido_preview VOLATILE+SECURITY DEFINER+SET LOCAL timeout=0; ALTER ROLE authenticated timeout 30s
// v2.2.375 — feat(pedidos): anular pedido desde TabPedidos — botón "Anular" visible a bodega en pedidos confirmados no finalizados; si ninguna sucursal inició → confirma directo sin motivo; si alguna inició pero sin finalizar → exige motivo (mín. 5 chars); si cualquier sucursal finalizó → botón oculto; llama anular_pedido RPC (p_anulado_por + p_motivo); toast éxito/error + audit log PEDIDO_ANULADO
// v2.2.374 — chore(pedidos): eliminar TabRecepcion/TabHistorial/TabDiferencias (código huérfano ~1500 líneas); fix busyAction silencioso → toast "Hay una operación en curso" en openFinalizarModal/handleLlegada/handleMarkErp; fix cajaDanada en auto-open RecepcionModal post-reenvío usa cajasDanadas del ciclo actual en vez de pss.cajas_danadas del primer envío
// v2.2.373 — fix(pedidos): flujo recepción completo — electrolit/especial marcan falta_caja:true si no llegan; botón "Reenviar" se muestra para electrolit+especial faltantes; ReenvioLlegadaModal muestra secciones electrolit y especiales pendientes; handleConfirmarTodo/Finalizar solo pone allDone:true cuando no quedan falta_caja items; pills Dañada/Faltante inline sin separador
// v2.2.372 — fix(generar): badge prioridad y % más grandes (text-[10px] h-5 vs text-[8px] h-4)
// v2.2.371 — fix(pedidos): stock sucursal en revisar-regla muestra "X und" (Math.round(packs×factor)); motivo muestra "Reponer X und" con Math.ceil sin decimales
// v2.2.370 — fix(pdf): cajas especiales — mismo formato que productos normales (Caja/Producto/Presentación/Cant./Lote); lote distribuido por caja vía FEFO solo si el producto tiene lote+vence; columna Lote omitida si ningún especial tiene lote
// v2.2.369 — feat(pedidos): programar entrega — botón junto a PDF en stage preparado; modal con historial de cambios; badge "Entrega estimada" en sucursal; DB: entrega_programada_at + entrega_programada_historial en pedido_sucursal_status
// v2.2.368 — fix(pedidos): recepción con cajas faltantes — getExactPageGroups como fallback cuando pagina_items vacío; auto-abrir RecepcionModal tras reenvío-llegada; openModal/openReenvioModal siempre fetch fresco; RPC receive_pedido_sucursal guarda AND NOT falta_caja en SELECT y UPDATE
// v2.2.367 — fix(pedidos): scrollbar-hide en LlegadaModal y RecepcionModal — scroll funciona pero la barra queda oculta
// v2.2.366 — fix(pedidos): LlegadaModal — max-h-[90vh] + flex-1 min-h-0 overflow-y-auto; todas las secciones (cajas, electrolit, especiales, extras) dentro del div scrolleable; footer shrink-0
// v2.2.365 — fix(pedidos): RecepcionModal — max-h-[90vh] en las 3 pantallas (cajas/items/extras) para evitar que el modal crezca fuera de pantalla al agregar muchas cajas
// v2.2.364 — fix(StatCard): sub usa min-h-[13px] puro sin caracter relleno; inactiveBg marcado con TODO comentario para [data-surface="card-flat"] en pase de dark mode
// v2.2.363 — feat(components): StatCard.jsx — componente reutilizable de metrica; flex-1 basis-0 min-w-[150px] iguala anchos; sub reserva min-h-[13px]; props icon/iconBg/iconCls/label/value/valueCls/sub/active/activeBg/inactiveBg/loading/onClick
// v2.2.362 — refactor(design): VentasView A1-A6 — transition-all→específico (9 sitios), font-normal→medium (×2), bg-blue-500→#0052CC en drill pills, rounded→rounded-md badge presentación, <img>→LiquidAvatar en drill-down, hover:scale-110→sin lift en botones ✕; DESIGN.md excepción transition-all para multi-propiedad
// v2.2.361 — feat(a11y/perf): ErrorBoundary glass (catch+audit+reload); OfflineBanner wifi (online/offline events); @media prefers-reduced-motion (desactiva orbes/shimmer/glow/wiggle, reduce entradas a fade 120ms); design.md v1.0 completo (31 secciones)
// v2.2.360 — refactor(design): arquitectura de temas — 4 variantes (liquid/dark/solid/solid-dark); tokens CSS var() en todos los [data-surface]; hover solo en puntero real (@media hover:hover); dark mode + Solid theme tokens; renombra aurora→glow-danger/warning, badge-pulse, compat-row→table-row-enter; ThemeContext funcional con cycleTheme; unifica scrollbar-hide
// v2.2.359 — feat(gps): background GPS nativo via Capacitor (@capacitor/geolocation + @capacitor-community/background-geolocation); permisos Android/iOS; GPS persistente en TabPedidos independiente del modal
// v2.2.358 — fix(rutas): paradas live en RutaMapModal (suscripción ruta_pedidos); foto conductor en grupo; race condition loadActiveRutas; loop notif batch; isConductor String(); lat/lng != null
// v2.2.357 — feat(pedidos): badges neutros (sin color) en cards; toast en sucursal al recibir "en camino"; suc_name enriquecido en paradas de ruta activa
// v2.2.351 — fix(rutas): TDZ crash loadActiveRutas en deps array; hour12:true en toda la app
// v2.2.344 — fix(pedidos): quitar barra duplicada de ruta; botones Iniciar/Vuelta+Entregué en header ruta; fix sucursalCounts branch; Realtime rutas↔activeRows (v2.2.344)
// v2.2.343 — fix+feat(pedidos): fix crash Map constructor; ruta-card agrupa pedidos hijos; header ruta con mapa + GPS dot (v2.2.343)
// v2.2.342 — feat(pedidos): barra de ruta en card (Ruta#N, conductor, GPS dot, Ver mapa, Entregué); fix filtro branch client-side (v2.2.342)
// v2.2.341 — feat(pedidos): pedidos en ruta van al tope de la lista (sort en_ruta→procesando→con_obs); eliminar RutaEnCursoCard; "En camino"→"En ruta" (v2.2.341)
// v2.2.340 — feat(pedidos): rutas activas como card "En Ruta" al tope de TabPedidos sin sub-tabs; sucursal ve su parada y puede ver mapa del repartidor; pedidos en ruta excluidos de la lista normal (v2.2.340)
// v2.2.339 — feat(pedidos): sub-tabs Procesando/En Ruta con slide + RutaEnCursoCard integrada (v2.2.339)
// v2.2.338 — fix(rutas): isConductor null-safe; quitar animate-spin-slow inexistente (v2.2.338)
// v2.2.337 — feat(rutas): rastreo GPS en vivo conductor↔admin + recálculo ruta c/2min (v2.2.337)
// v2.2.336 — fix(rutas): .catch→.then en announcements insert; GPS usa getCurrentPosition para forzar permiso (v2.2.336)
// v2.2.335 — feat(rutas): RutaMapModal con GPS en vivo + botón en card + CrearRuta más grande (v2.2.335)
// v2.2.326 — feat(rutas): mapa usa Leaflet+OSM cuando Google Maps falla; foto conductor en chips (v2.2.326)
// v2.2.325 — fix: pedido_apoyo 400 (drop índice 3col redundante); Maps InvalidKey → gm_authFailure + placeholder (v2.2.325)
// v2.2.324 — feat(rutas): mapa Google Maps en confirmar ruta + timeline con tiempos conducir/descarga/vuelta a base (v2.2.324)
// v2.2.323 — feat(pedidos/pausa): apoyo reanuda explícitamente; reanudado_por registrado en DB + visible en tooltip (v2.2.323)
// v2.2.322 — fix(pedidos/rutas): 5 bugs — pausado bloquea finalizar, apoyo auto-reanuda, busyAction per-card, FinalizarModal re-apertura bloqueada, CrearRuta sin pedidos (v2.2.322)
// v2.2.321 — fix(rutas): conductor auto = usuario actual; Google Maps Distance Matrix API; pedidos_tab_rutas en PermissionsView (v2.2.321)
// v2.2.320 — feat(pedidos/rutas): Sistema de Rutas completo — TabRutas, CrearRutaModal, optimización TSP, DB rutas+ruta_pedidos (v2.2.320)
// v2.2.319 — feat(sucursales): campos lat/lng GPS en edición de sucursal para sistema de rutas (v2.2.319)
// v2.2.318 — feat(pedidos): PDF und. base en regla PDF; motivo+stock en sin-stock/regla; caja_especial E1/E2; cajas de más (v2.2.318)
// v2.2.317 — feat(pedidos/pausa): tooltip motivo/inicio/fin + multi-badge para 2+ pausas (v2.2.317)
// v2.2.316 — feat(pedidos/electrolit): contador faltantes + notif bodega + badge en card (v2.2.316)
// v2.2.315 — feat(login): scan-pending 10s + fallback manual; fix(pedidos): reserva libera al finalizar_at (v2.2.315)
// v2.2.314 — fix(pedidos): quitar auto-open RecepcionModal + corregir JSONB {} vs [] (v2.2.314)
// v2.2.313 — fix+feat(pedidos): 6 mejoras recepción + PDF 3col + electrolit (v2.2.313)
// v2.2.312 — feat(pedidos): numeración por sucursal/mes + PDF caja a la derecha (v2.2.312)
// v2.2.311 — fix(pedidos/pill): X limpiar no aparece en branch sin filtro activo
// v2.2.310 — fix(pedidos): pill h-14 fijo para altura consistente
// v2.2.309 — fix(pedidos): cards y pill corregidos al estándar real de TabInventario
// v2.2.308 — fix(pedidos): pill glass idéntico a productos; cards sin translate, border via style
// v2.2.307 — fix(pedidos): branch ve su propia card informativa del mes
// v2.2.306 — fix(pedidos): cards glass exacto CostCards; observaciones en strip cajas/electrolit
// v2.2.305 — fix(pedidos): cards glass estándar en misma línea que pill; observaciones inline con divisor
// v2.2.304 — feat(pedidos): quitar sección EN CURSO; cards por sucursal; detalle observaciones en card
// v2.2.303 — feat(pedidos/filtros): Completados ocultos por defecto; filtros Con observación + Completados
// v2.2.302 — feat(pdf): 5 mejoras al PDF de despacho (header, caja, lotes, centrado, footer)
// v2.2.301 — fix(recepcion/extras): EXTRAS_GRID sin columna asig → nombre producto con más espacio (~180px vs ~116px)
// v2.2.300 — fix(recepcion): LiquidSelect compact con menos padding → más texto visible; dropdown buscador via portal (no clipeado)
// v2.2.299 — fix(pedidos/timeline): guardar arrived_por en ciclo reenvío + mostrar quien confirmó 2ª llegada; ocultar tiempos elapsed según rol
// v2.2.298 — feat(pedidos/extras): pantalla de extras con mismo grid format que items (max-w-2xl, cabeceras Físico/Sistema, fila por producto)
// v2.2.297 — style(pedidos/recepcion): reemplazar <select> nativos por LiquidSelect en RecepcionModal (extras + items grid)
// v2.2.296 — feat(pedidos/extras): pantalla dedicada 'Productos extra' con búsqueda, presentaciones y cantidades separadas del grid de items
// v2.2.295 — feat(pedidos/recepcion): auto-open RecepcionModal post-llegada; páginas en picker cajas; botón Confirmar Todo; falta_caja en ITEMS_SELECT
// v2.2.294 — ux(pedidos/llegada): número de página visible en LlegadaModal y ReenvioLlegadaModal como subtext de cada caja
// v2.2.293 — ux(pedidos/recepcion): quitar banner llegada confirmada; dañada+faltante como badges compactos inline
// v2.2.292 — fix(pedidos/electrolit): solo contar dispatch_tipo=CAJA (625ml); excluir Pediátrico (UNIDAD); dividir por dispatch_factor no factor
// v2.2.291 — feat(pedidos): contador cajas Electrolit en card + modal En Ruta; calculado al finalizar y guardado en DB
// v2.2.290 — fix(pedidos): PackageX faltaba en imports TabPedidos; mejorar toggles LlegadaModal/ReenvioLlegadaModal con label + fondo reactivo
// v2.2.289 — feat(pedidos/apoyo): separar apoyo preparación (bodega) vs recepción (sala venta); limpiar pedido 51 para pruebas
// v2.2.288 — fix(pedidos/reenvio): 2 bugs stress-test — handleSegundaLlegada legacy abre modal para pedidos sin historial; falta_cajas no se limpiaba al llegar todo el reenvío
// v2.2.287 — fix(pedidos/reenvio): 4 bugs — falta_caja no se limpiaba en cajas llegadas, TL arrays OOB en ciclos 3+, banner Revisar aparecía con faltantes pendientes, compat pedidos viejos reenvio_bodega_at sin historial
// v2.2.286 — feat(pedidos/llegada): flujo reenvío completo — LlegadaModal per-caja 3-way (OK/Dañada/No llegó), soporte tipo 'mixto', ReenvioLlegadaModal para confirmar reenvío con estado por caja, ciclos múltiples en reenvios_historial, ReceptionActions con banners independientes dañada+faltante, timeline anidado por ciclo
// v2.2.285 — fix(pedidos/cap1000): eventos también paginado con loop; .range(0,4999) no supera el cap igual que .range(0,9999)
// v2.2.284 — fix(pedidos/cap1000): paginación en fetchItems+fetchPedidoItems; hay pedidos activos con 1007/1003 items que se truncaban silenciosamente; +range(0,4999) en eventos
// v2.2.283 — feat(pedidos/apoyo): toast "Ya está de apoyo" si el empleado ya fue registrado; check local antes de tocar DB
// v2.2.282 — fix(pedidos/apoyo): UNIQUE INDEX en (pedido_id,erp_sucursal_id,employee_id) + drop FK registered_by→employees; upsert fallaba silenciosamente para usuarios sin registro en employees
// v2.2.281 — fix(pedidos/apoyo): batch-load para TODOS los usuarios (no solo branch); bodega perdía apoyo al refrescar porque el effect tenía guard isBranch
// v2.2.280 — fix(pedidos/cards): badge+ring caja dañada, apoyo con nombre+foto, cajas siempre visible, confirm En Ruta con nro cajas grande, fix apoyo desaparecía (loadActive post-save)
// v2.2.279 — feat(pedidos/recepcion): botón "Todo OK" en grid de caja — confirma cantidades exactas sin diferencias en un tap, sin tocar el estado de los inputs
// v2.2.278 — feat(pedidos/recepcion): recepción por caja independiente — picker de cajas, confirmar caja a caja, cajas_recibidas en DB, falta_caja separada, lastbox cierra + notifica; fallback sin caja_map = flujo original
// v2.2.277 — feat(pedidos/timeline): reenvio_por guardado en DB + mostrado en timeline; falta_caja reutiliza llegadaEmp; opacity cards completadas 60→80; FinalizarCajasModal rediseño visual (page-count card, input grande, page rows con badge+cards de cajas)
// v2.2.276 — feat(pedidos/finalizar): paginas pre-calculadas al generar PDF → Finalizar instantáneo; fix getBuffer() Promise API; paginas guardadas en pedido_sucursal_status
// v2.2.275 — feat(pedidos/finalizar): getExactPageGroups via pdfmake pageBreakBefore — id='row_N' en celdas → conteo exacto de páginas y primer producto por página del PDF real
// v2.2.274 — fix(pedidos/finalizar): recalibrar alturas de fila getPageGroups (paddingTop/Bottom=0 en layout → _ROW_BASE=15, _LOTE_XTRA=9, _BADGE_ADD=8); revertir printFromPedidoItems a paginación pdfmake natural — PDF queda idéntico al original
// v2.2.273 — fix(pedidos/finalizar): paginación manual sincronizada — PDF y modal usan splitPrintRows idéntico; conteo de páginas exacto; getPageGroups mapea igual que printFromPedidoItems; FinalizarCajasModal multi-select cajas por página; muestra primer producto+lab+count por página
// v2.2.272 — feat(pedidos/finalizar): asignación página→caja al Finalizar (FinalizarCajasModal); getPageGroups calibrado empíricamente (≈35 filas/pág); LlegadaModal usa caja_map real de DB; PDF agrega espacio 'Caja: ___'; falta_caja usa pagina_items exacto; total_cajas visible en card y en notif En Ruta
// v2.2.271 — feat(pedidos/llegada): modal de confirmación de llegada con 3 opciones (completa/falta_caja/caja_dañada); selección de nº de caja; falta_caja notifica bodega+reenvío+segunda llegada; RecepcionModal filtra items falta_caja y muestra banner caja dañada
// v2.2.270 — fix(pedidos/pdf): fetchItems ahora incluye presentaciones!erp_presentacion_id(tipo); printFromPedidoItems mostraba '-' en productos sin dispatch_tipo porque el join faltaba
// v2.2.269 — fix(pedidos/notif): bodega recibe 1 sola notificación al confirmar recepción (sin novedad → normal, con diferencias/problemas → HIGH); elimina duplicado confirmado+diferencias
// v2.2.268 — feat(pedidos/notif): push+bell a bodega al confirmar recepción ERP (siempre) + ya existía notif de diferencias/problemas (dañado/vencido) vía handleReportarDiferencias
// v2.2.267 — feat(pedidos/notif): 2 notificaciones push+bell a la sucursal destino: al Iniciar (bodega empieza a preparar) y al marcar En Ruta; lookup por erp_sucursal_id→branch_id en erp_sucursal_map
// v2.2.266 — fix(pedidos): (1) canEdit usa 'pedidos' como module_key correcto (antes 'pedidos_en_curso' nunca matcheaba → Edwin sin acceso); (2) ReceptionActions solo visible cuando pedido_status='enviado' (pedido en ruta), no antes
// v2.2.265 — fix(pedidos/permisos): GESTIONAR ahora gatéa PDF+Iniciar+Pausar+Finalizar+Reanudar+EnRuta — canActuar cambia de (canEdit||!isBranch) a (canEdit&&!isBranch); sin GESTIONAR solo se puede ver
// v2.2.264 — feat(pedidos): botón PDF en cada card de TabPedidos — descarga el PDF del pedido directamente desde los items guardados en DB (printFromPedidoItems); visible solo para admin/bodega (!isBranch); spinner mientras genera
// v2.2.263 — fix(pedidos/recepcion): presentaciones paginadas en chunks de 1000 (evita cap PostgREST); join explícito id_presentacion; AMOXICILINA y similares ahora muestran todas las presentaciones (caja+blíster+unidad)
// v2.2.262 — fix(pedidos/recepcion): presOpts muestra presentaciones originales (product_precios) + presentación especial de la regla primero, sin duplicados
// v2.2.261 — fix(pedidos/recepcion): presOpts siempre pone la presentación de la regla (dispatch) primero cuando dispatch_tipo existe y factor ≠ factor_erp; elimina dependencia del match de rawOpts
// v2.2.260 — fix(pedidos/recepcion): extras con 0+0 muestra warning visual + bloquea submit con mensaje claro
// v2.2.259 — fix(pedidos/recepcion): (1) drop overload p_responsables que causaba ambigüedad en RPC; (2) input ¿Cuántos? al marcar dañado/vencido (cantidad_problema en DB); (3) extras permiten qty=0 en físico o sistema
// v2.2.258 — fix(pedidos/timeline): nodos Diferencias/Corregido muestran checkmark cuando tienen timestamp (isExtraNode bypass); get_pedidos_en_curso v7 agrega llegada_fisica_por + recibido_erp_por
// v2.2.257 — feat(pedidos/diferencias): resolución por ítem bodega↔sucursal: bodega propone tipo+nota, sucursal confirma o rechaza con razón, bodega re-propone; auto-completa pedido al confirmar todos; historial actividad realtime en DifSection; DB: pedido_item_eventos table + resolve_pedido_item RPC + 10 columnas en pedido_items
// v2.2.256 — fix(pedidos/recepcion): 3 bugs críticos resueltos: (1) p_responsables eliminado del RPC call (causaba "function not found"), (2) receive_pedido_sucursal v3 lee y guarda error_tipo del JSON + con_diferencia cuando error_tipo IS NOT NULL, (3) pedido_recepcion_extras table + get_pedido_item_stats RPC creados; auto-load items para pedidos parciales en DifSection
// v2.2.255 — fix(pedidos/recepcion): header sticky dentro del scroll container (alineación exacta con columnas sin mismatch de scrollbar); workflow diferencias completo: migración DB add corregido_bodega_at/confirmado_correccion_at/diferencias_reportadas_at + lifecycle stages + get_pedidos_en_curso v6; notificación bodega siempre corre (desacoplada del RPC); DifSection muestra error_tipo badge con colores; received_by en fetchItems
// v2.2.254 — fix(pedidos/recepcion): fórmula toDispatch(qty*erpFactor/dispFactor) igual que PDF para qty correcta (Electrolit=cajas, Acetaminofen=10); extra busca regla despacho en pedido_items; ERROR_TIPOS solo Dañado/Vencido/Otro; panel problema en 1 línea + campo nota + botón Listo/Enter
// v2.2.253 — fix(pedidos/recepcion): X cierra buscador (no modal) cuando search abierto; scroll a extra recién agregado; cantidad_asignada ya es display unit (no dividir por factor); cantidad_recibida = fQty (no ×factor); delta y hasDiff en display units
// v2.2.252 — fix(pedidos/recepcion): botón "Confirmar" siempre clickeable (no depende de pendientesCount); rows ordenados por laboratorio; pres despacho siempre en presOpts; diff detecta auto error_tipo; ⚠ abre panel pills de causa; extras como filas de tabla (fPres/fQty/sPres/sQty) con color indigo + borrar
// v2.2.251 — fix(pedidos/recepcion): qty en unidades despacho (÷factor, submit ×factor); extras filtra productos ya en pedido; col pres 8rem; asig centrado; ⚠ más visible
// v2.2.250 — fix(pedidos/recepcion): header tabla fuera del Body (siempre visible); flechas en selects de presentación con detección de borde; extras rediseñado con dropdown hacia arriba + auto-focus
// v2.2.249 — fix(pedidos/recepcion): presentaciones con join presentaciones(tipo) → "BLISTER 1x10"; header fijo con grupo+cols visible; nav flechas ↑↓ entre filas en qty inputs
// v2.2.248 — fix(pedidos/recepcion): presentaciones desde descripcion ERP (BLISTER 1x10, CAJA 1x100, UNIDAD 1x1); dedup por factor; nombre producto sin truncar
// v2.2.247 — fix(pedidos/recepcion): labels de presentación usando fmtFactor (Caja ×N, Blíster ×N, Unidad) en lugar de descripcion ERP; presMap solo guarda factor
// v2.2.246 — feat(pedidos/recepcion): modal 6 columnas Físico vs Sistema — presentación editable (dropdown product_precios), qty editable ambos lados, diff auto-detectado, botón ⚠ para problema sin diff (dañado/vencido); fix receive_pedido_sucursal: error_tipo IS NOT NULL también activa con_diferencia
// v2.2.245 — feat(pedidos/diferencias): flujo completo — lupa horizontal, modal en Paso 2 llama recibir_erp+reportar_diferencias, DifSection, TL 2 nodos condicionales, get_pedidos_en_curso v7, 3 nuevos lifecycle stages
// v2.2.244 — fix(recepcion/modal): layout tabular (Producto | Presentación | Asignado | Recibido) + fmtPresentacion siempre retorna valor (Unidad como fallback)
// v2.2.243 — fix(recepcion/modal): presentación inline a la derecha del nombre del producto, no debajo
// v2.2.242 — feat(recepcion/modal): 4 mejoras — (1) quita "Pedido #N" del título, codigo queda en subtítulo; (2) elimina botón "Todo exacto"; (3) lupa animada con AnimatePresence + motion; (4) presentación del producto (Caja ×24, Blíster ×10…) bajo el nombre según dispatch_tipo/dispatch_factor
// v2.2.241 — fix(pedidos/recepcion): Revisar abre modal sin necesitar expandir — openModal carga items on-demand; fetchItems retorna datos además de setearlos
// v2.2.240 — fix(pedidos/timeline): nodo erp renombrado a "Finalizado" en línea de tiempo
// v2.2.239 — feat(pedidos/modal): responsables de apoyo en RecepcionModal — al abrir el modal carga pedido_apoyo y muestra los chips de empleados como "Responsables" (read-only)
// v2.2.238 — feat(pedidos/recepcion): pendientes sin expandir + modal mejorado — get_pedido_item_stats agrega columna pendientes; Paso 2 muestra conteo desde cardStats sin necesitar abrir card; RecepcionModal: quita sección responsables (apoyo ya está afuera), agrega codigo en header, lupa de búsqueda de producto
// v2.2.237 — feat(pedidos/sucursal): botón Apoyo en Paso 2 y 3 + avatares stack en timeline — batch-load apoyo al cargar tab (sin expandir); ReceptionActions muestra "Apoyo" con chip apilado en Paso 2 (revisión) y Paso 3 (sis.ventas); timeline nodos Llegada y Sis.Ventas muestran stack de fotos del equipo de apoyo siempre visible
// v2.2.236 — feat(pedidos/sucursal): responsables en recepción + renombrar ERP→Sistema de Ventas — get_pedidos_en_curso v6 agrega llegada_fisica_por, recibido_erp_por, conteo_por; timeline nodos Llegada y Sis.Ventas muestran foto+nombre del responsable; ReceptionActions muestra chip de empleado en cada paso confirmado; "ERP"/"Finalizado" renombrado a "Sistema de Ventas" en labels, stage pill, botones
// v2.2.235 — fix(pedidos/sucursal): opacity solo cuando recibido_erp_at está puesto (isFadedOut); Paso 3 Marcar ERP aparece sin necesitar items cargados — pedidoDone=true (completado/parcial) activa Paso 3 directamente; Paso 2 muestra "Ítems confirmados" cuando pedidoDone
// v2.2.234 — fix(pedidos/card): 3 correcciones — (1) quita badge doble "Completado" (PEDIDO_PILL ya lo muestra); (2) ReceptionActions visible para completado/parcial cuando recibido_erp_at es null (stage!='erp'), permite Marcar ERP tras contar ítems; (3) get_pedidos_en_curso v5 restaura pss.codigo (perdido en v3/v4)
// v2.2.233 — fix(pedidos): fecha filtra completados igual que ventas — get_pedidos_en_curso v4 sin restricción de días (el filterDate del frontend controla el rango, mismo patrón que VentasView); sort pone completado/parcial siempre al fondo; FilterPill compacta (text-[11px] py-1 buttons, py-1.5 sections) igual al estándar VentasView/Historial
// v2.2.232 — fix(pedidos): pedidos completado/parcial visibles 7 días — get_pedidos_en_curso v4 incluye status completado/parcial de los últimos 7 días; activos siempre primero; card con opacity-60 + badge "Completado" (verde) / "Con diferencias" (ámbar) sin botones de acción
// v2.2.231 — fix(pedidos/sucursal): oculta ReceptionActions cuando stage=erp (recibido_erp_at ya puesto) — el timeline ya muestra el pedido como finalizado, el bloque de recepción es redundante
// v2.2.230 — fix(pedidos/sucursal): 3 correcciones card sucursal — (1) botones Confirmar llegada y Recibir visibles sin expandir la card; (2) timeline muestra nombre del empleado que marcó Listo (finalizado_por) y En Ruta (enviado_por); (3) confirmar llegada ahora avanza el timeline inmediatamente (handleLlegada/handleMarkErp llaman loadActive tras el RPC); get_pedidos_en_curso v3 agrega finalizado_por+enviado_por
// v2.2.229 — feat(dashboard): scope Mi Sucursal activo en 9 widgets (trend, shifts, sales, absences, requests, branches, birthdays, KPI general/rrhh)
// v2.2.228 — feat(permisos): agrega selector de scope "Todos / Mi Sucursal" al módulo Pedidos a Sucursales
// v2.2.227 — fix(pedidos/timeline): tiempo transcurrido entre etapas más grande (9px) y color más sólido (slate-600 semibold)
// v2.2.226 — feat(pedidos): elimina sección Historial de TabPedidos; los filtros de fecha cubren la funcionalidad
// v2.2.225 — fix(pedidos/pausa): elimina razón "Falta de personal" del modal de pausa de despacho
// v2.2.224 — fix(modals): restaura blur de fondo en todos los modals — ModalShell overlay vuelve a bg-slate-900/40 backdrop-blur-sm (revertido accidentalmente en commit ececdaf de abril); todos los modals del portal recuperan el scrim oscuro + blur de fondo estándar
// v2.2.223 — refactor(modals): LiquidModal sub-components Header/Body/Footer; bg-transparent en header + relative z-10 en secciones para que el glass blur sea visible; migrados PauseModal+ApoioScanModal (TabPedidos), anular+apoyo+pausa (TabHistorial), RecepcionModal, SrsEnriquecerModal; inputs/selects pasan a bg-white/60 para no tapar glass
// v2.2.222 — refactor(modals): LiquidModal — componente estándar glass en src/components/common/LiquidModal.jsx; migrados UnifiedModal, SrsEnriquecerModal, ShiftExceptionModal, PromoModal, PedidoModal (ahora re-exporta LiquidModal); elimina 5 overlays propios y 5 tarjetas bg-white opacas; AlertModal/ConfirmModal/KioskConfigModal/PhotoEditorModal quedan sin cambios (estilos especializados justificados)
// v2.2.221 — feat(pedidos/modals): Liquid Glass estándar en todos los modals de pedidos — nuevo PedidoModal.jsx (ModalShell + tarjeta glass: rounded-[2.5rem], bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%], border white/90, shadow profunda); aplicado en PauseModal+ApoyoModal (TabPedidos), RecepcionModal, 3 modals de TabHistorial (anular, apoyo, pausa); igual al estándar de UnifiedModal
// v2.2.220 — fix(pedidos/TabPedidos): columna Presentación en "Revisar regla" muestra unidad de stock en vez de unidad de despacho — nueva función renderPresStock: cuando factor≠dispatch_factor (ej. AZITROMICINA factor=1 tableta, despacho CAJA×12), muestra "Unidad" para que "Solicitado=4" lea como "4 Unidad"; cuando stocking=despacho (CLEVIUM CAJA X 10) mantiene el tipo original; COLS_REGLA usa renderPresStock; COLS_ENVIADOS y COLS_SIN_STOCK sin cambio (ahí sí aplica la unidad de despacho)
// v2.2.219 — fix(pedidos/reglas): fmtRegla no duplica factor en badge — TabPedidos.jsx: showFactor ahora verifica que dispatch_tipo no contenga ya el factor numérico (ej. "CAJA X 10" con factor=10 mostraba "CAJA X 10 10"; fix: !dispatch_tipo.includes(String(factor))); también: data-fix regla Clevium (id=369) replicada a dispatch_id_presentacion=1 (UNIDAD) tras reversión accidental por auto-save del EditPanel con estado cacheado
// v2.2.218 — fix(pedidos/reglas): 3 correcciones — (1) TabGenerar: botón "Reimprimir" → "Descargar pedido" con ícono Download; banner "confirmado e impreso" → "confirmado"; estado "Confirmando e imprimiendo…" → "Confirmando…"; (2) TabReglas EditPanel: subtexto de pill de presentación simplificado de "N und. por pack · descripcion" → "×N unidades" (elimina repetición del factor cuando el nombre del tipo ya lo contiene, ej. "CAJA X 10 [10 und. por pack]"); (3) DB data-fix: regla dispatch de CLEVIUM 25MG/10ML X 10 SOBRES (id=369) corregida de dispatch_id_presentacion=69 (CAJA X 10, factor=10) a dispatch_id_presentacion=1 (UNIDAD, factor=1) — el producto se despacha por sobre individual, no por caja; badge TabReglas ahora muestra "UNIDAD" en vez de "CAJA X 10" y el cálculo de pedido usa factor=1
// v2.2.217 — fix(pedidos/reponer): regla del 40% aplicada en espacio de unidades — get_pedido_preview v23: necesidades.reponer ahora calcula need_units=max_units−stock_units y aplica FLOOR(need/factor)+(need%factor≥40%×factor?1:0); corrige ALKA SELTZER EXTREME (max=80,stock=41,need=39≥20→1 CAJA, antes ROUND(80/50)=2→2 CAJAS); también corrige cualquier producto donde max_units no es múltiplo exacto del factor; stock_sucursal expone max_units_raw y stock_units_raw para el cálculo
// v2.2.216 — fix(pedidos/pdf): dispatch_label activa etiqueta visual de CAJA en PDF — get_pedido_preview v22: dispatch_pres_factor expone dp_display_factor (dp_factor × dp_multiplo cuando dispatch_label IS NOT NULL) y dp_tipo=COALESCE(dispatch_label, pres.tipo); con_reglas usa dp_display_factor en dispatch_factor output; PDF llama toDispatch(N, 1, 12)=1 CAJA en lugar de 12 UNIDADES; dispatch_label='CAJA' seteado en 11 productos ELECTROLIT ×12; sin cambios en product_precios — puramente visual vía dispatch_rules.dispatch_label
// v2.2.215 — fix(pedidos): 2 correcciones — (1) get_pedido_preview cambia RETURNS TABLE→RETURNS jsonb (bypasa cap 1000 filas de PostgREST; pedido #39 truncaba 18+ productos en suc.4); TabGenerar elimina .range(0,49999) y parsea Array.isArray(data); (2) calcSolicitado corregido — max_qty_snapshot y stock_packs_snapshot ambos están en PACKS, fórmula correcta: Math.ceil(max - stock), no Math.ceil((max - stock×factor)/factor); NOTA: la sobre-asignación por 40%-roundup de dispatch_multiplo es comportamiento intencional (19 packs ≥ 40% de 25 → enviar 25 completos)
// v2.2.214 — fix(pedidos/dispatch): pref_factor CTE en stock_sucursal — al elegir la presentación de cálculo se prioriza el factor de la dispatch rule (cuando existe), luego el menor factor > 1; corrige NOVOMIT suc1 (ROUND(181/250)=1 pasaba con factor=250 → ahora factor=10/BLISTER, max_qty=18 en vez de 1) y AERO OM suc2/4 (mismo bug); auto_pres_factor cambia ORDER BY DESC→ASC para fallback sin regla (BLISTER antes que CAJA); aplica a get_pedido_preview, get_pedido_sucursal_stats y get_pedido_sin_bodega
// v2.2.213 — fix(pedidos/psp): data-fix PSP para ELEQUINE×20, ENALAM×10, ESOMEPRAKEM×10 — min_units/max_units estaban en "cajas ERP" (factor=1 erp) en vez de tabletas; se multiplican por el factor real para que ROUND(max/factor) dé el número de cajas correcto; trigger bodega recalculó Σ sucursales automáticamente
// v2.2.212 — fix(pedidos/inv): factor de inventario desde product_precios — vista v_product_factor mapea (product_id, presentacion) → factor oficial; inv_suc/inv_bodega/inv_dedup hacen LEFT JOIN a la vista; fallback al split('x') del detalle si no hay match; corrige 13 filas con detalle incorrecto (ELEQUINE×20 reportaba 8 en vez de 160 tabletas, ENALAM×10 reportaba 2 en vez de 20, etc.)
// v2.2.211 — fix(pedidos): timeout al generar — split inv_dedup→inv_suc+inv_bodega, SET statement_timeout=120s; errores en español + LiquidToast en TabGenerar
// v2.2.210 — fix(pedidos): dedup presentaciones en get_pedido_preview/stats/sin_bodega — DISTINCT ON (suc,producto) + inv_agg elimina 710 filas extra causadas por N id_presentacion activos con mismo tipo+factor en product_precios
// v2.2.209 — refactor(minmax): elimina erp_minmax — cron sync-erp-minmax-hourly desactivado, tabla erp_minmax eliminada, edge function sync-erp-minmax borrada; todas las funciones DB (get_pedido_preview, get_pedido_sucursal_stats, get_pedido_sin_bodega, get_stagnant_inventory, get_no_sales_products, get_products_sold_no_minmax, get_product_sales_agg) migradas a usar product_stock_params; parámetro p_use_portal_minmax eliminado de 2 RPCs; TabGenerar.jsx actualizado
// v2.2.208 — fix(minmax/data): MIN=0 MAX>1 eliminado — 7 suc5 + 227 bodega corregidos a min=1; publish_stock_params y trigger bodega clampeados (GREATEST(min,1) cuando max>1); constraint chk_min_lt_max ampliado cubre ambos: MIN≥MAX y MIN=0/MAX>1
// v2.2.207 — fix(minmax/data): 327 filas con min=max (ambos >0) corregidas con min=max-1; causa raíz: bug LEAST(NULL,N)=N ya corregido en v2.2.206; constraint chk_min_lt_max en DB bloquea min≥max (cuando ambos >0) a nivel de BD para siempre
// v2.2.206 — fix(minmax/publish): LEAST(NULL,1)=1 en PostgreSQL — cuando solo se guardaba draft_max pero no draft_min, publish_stock_params publicaba min=max (ej. 0/1 → 1/1); fix: COALESCE(draft_min,0) y COALESCE(draft_max,0) en LEAST/GREATEST para tratar NULL como 0; data-fix retroactivo en ELEQUINE 750 X 5 suc.4
// v2.2.205 — fix(minmax/pres): columna Presentación ahora usa catalog_base_pres (product_precios JOIN presentaciones por id_presentacion, factor ASC) en vez de inv_base_pres; corrige ELEQUINE 750 X 20 y todos los productos donde dos filas de product_precios comparten la misma descripcion pero distinto factor — pres_factors MAX(factor) borraba la UNIDAD (factor=1) y la base quedaba CAJA X 20
// v2.2.204 — fix(minmax/pres): "Caja x 20 ×20" → "Caja x 20"; si el tipo ya contiene el factor como número no se agrega ×N; afectaba 161 productos (ELEQUINE y similares con presentacion="CAJA X N" y factor=N en product_precios)
// v2.2.203 — fix(minmax/csv): presentaciones en CSV bodega usan nombres reales (CAJA/BLISTER) en vez de códigos ERP (1x10); un solo scan de inventory vía inv_all_pres → inv_base_pres + inv_other_pres_agg; fallback: red > catalog ERP
// v2.2.202 — perf(minmax/bodega): realtime quirúrgico — product_stock_params en publicación supabase_realtime; payload postgres_changes parchea solo la fila afectada (effective/pub/alert_status) sin RPC extra ni reload de tabla
// v2.2.201 — fix(minmax/bodega): (1) trigger usa solo valores publicados (min_units) nunca draft; bodega siempre live; (2) realtime subscription — bodega se auto-actualiza al editar sucursales sin reload; (3) badge "Suc. pendientes" en celda bodega live vía has_pending_branches; (4) label "Borrador" claro en stock en red y MIN·MAX red panel
// v2.2.200 — feat(minmax/bodega): modelo aditivo — manual_min/max ahora es DELTA (excedente sobre Σ sucursales), no reemplazo; effective = sum + delta; si salas bajan a 0 bodega conserva solo su excedente; si salas suben bodega escala automáticamente; migración de datos existentes: old_manual − sum = nuevo delta
// v2.2.199 — fix(minmax/bodega): trigger sync_bodega_draft_from_branch — antes siempre escribía draft_status='pending' en bodega aunque todas las sucursales estuvieran publicadas; ahora: si ALL sucursales publicadas → bodega actualiza min_units/max_units en modo live (none); 2,075 productos promovidos retroactivamente de borrador a live; 1,308 siguen pending porque tienen sucursales con borradores reales
// v2.2.198 — fix(minmax/rpc): get_stock_analysis — columna Presentación mostraba la presentación MAYOR; nuevo CTE inv_base_pres busca la presentación con factor más pequeño en TODAS las sucursales (incluso bodega sin stock propio); va primero en el array para que "BLISTER" tenga prioridad sobre código ERP "1X10" al mismo factor
// v2.2.197 — fix(minmax/ui): columna "Despacho" renombrada a "Presentación"; segunda fila MIN/MAX eliminada de la celda — solo queda la pill con tipo+factor (ej. "Blíster ×10")
// v2.2.196 — fix(minmax/rpc): get_stock_analysis — (1) inv_base usa product_precios.factor via pres_factors CTE (NUNCA regex sobre detalle); (2) inv_summary solo agrega presentaciones factor>1; (3) catalog_pres fallback desde product_precios cuando no hay presentaciones con factor>1; (4) last_sale para bodega incluye ventas de TODAS las sucursales (bodega no vende al público); (5) canExpand agrega daily_velocity>0 como red de seguridad; LECHE NAN y OMEPRAZOL BALAXI ahora expanden y muestran presentación correcta
// v2.2.195 — fix(compras): precio_unitario histórico corregido — ERP siempre devolvía el precio actual del catálogo, sobreescribiendo el precio real de cada recibo; fix: precio_unitario=total_linea/cantidad (18,405 registros corregidos); sync actualizado para usar la misma lógica en nuevas compras; vista product_cost_history reconstruida con CASE que prioriza total_linea/cantidad sobre el campo crudo
// v2.2.194 — fix(minmax/csv): proveedores y stock de red en CSV bodega — .range(0,9999) no bypasea el cap 1000 de PostgREST; fix real: chunkear los IDs de input en grupos de ≤1000 para que cada llamada RPC devuelva ≤1000 filas; Promise.all paralelo de todos los chunks; APETIL-CRECE y todos los productos 1001+ ahora muestran proveedor correcto
// v2.2.193 — fix(minmax/rpc): get_sucursal_net_stock usa product_precios.factor (entero exacto) en vez de regex sobre detalle — CTE pres_factors deduplica por (product_id, UPPER(descripcion)) para evitar multiplicar filas en el SUM; fallback COALESCE(...,1) para presentaciones sin match
// v2.2.192 — fix(minmax/rpc): get_sucursal_net_stock usaba columna 'presentacion' para extraer factor XxN — 24.7% de filas (4667/18872) tienen el patrón solo en 'detalle'; corregido a detalle; stock de red ahora correcto (ej. VENDA GASA 17→26 und)
// v2.2.191 — fix(minmax/csv): PostgREST cap en get_sucursal_net_stock y get_top_supplier_per_product — ambas RPC usan .range(0,9999) para no truncar en 1000 filas (causa de "Sin registro" en productos con proveedor real)
// v2.2.190 — fix(minmax/csv): alerta SIN MIN/MAX cuando producto tiene inventario pero sin parámetros; proveedor vacío → "Sin registro" (sync compras desde may-2025, ~273 productos sin historial)
// v2.2.189 — feat(minmax/csv): bodega CSV — quita Ventas 6 meses, agrega Cantidad a pedir (MAX-inventario, min 0), Proveedor (top por cantidad comprada via get_top_supplier_per_product RPC); orden final: Inventario actual → Cantidad a pedir → Proveedor → Alerta
// v2.2.188 — fix(minmax/csv): alerta bodega prioriza MIN de bodega — si bodegaStock < effective_min siempre CRÍTICO independientemente de días de red; etiqueta "CRÍTICO (Xd red)" diferencia entre bajo-MIN vs cobertura-red-baja; corrige caso Tylenol (4 und / MIN 46) que salía ATENCIÓN por cobertura de red
// v2.2.187 — fix(minmax/csv): alertas bodega — labels unificados CRÍTICO/ATENCIÓN para todas las clases (ya no separación A/B vs C), días de cobertura incluidos en etiqueta (ej. "CRÍTICO (8d)", "ATENCIÓN (22d)"), sin alerta cuando vel=0 (sin ventas recientes), header "Ventas período" → "Ventas 6 meses"
// v2.2.186 — feat(pedidos/empty-state): subtítulos eliminados de empty states (text-slate-400 invisible sobre LiquidGlass); solo título bold; patrón glass-icon + glow guardado en memoria permanente
// v2.2.185 — feat(pedidos/empty-state): empty states con glassmorphism — icono glass rounded + glow difuso + titulo bold + subtitulo descriptivo (patron my-announcements). Guardado como estandar de disenio para todo el proyecto.
// v2.2.184 — fix(pedidos/TabPedidos): 7 correcciones — (1) apoyo explicado: canEdit→!isBranch (Edwin supervisor no tenía pedidos_en_curso.can_edit en role_permissions); (2) stats ahora usan get_pedido_item_stats RPC server-side en vez de fetch 5000+ filas client-side (range(0,4999) truncaba pedidos); (3) get_pedidos_en_curso v3 agrega campo codigo; (4) card muestra codigo del pedido (el que se imprime) en vez de #numero; (5) botón Apoyo solo visible en sin_iniciar/preparando/pausado — no en tránsito/contando/erp; (6) card más compacta (px-3 py-2, iconos 10px, nodo timeline 48px); (7) motion.div layout eliminado de cards (principal causa de lentitud); todos los pedidos de prueba borrados del DB
// v2.2.183 — feat(pedidos/TabPedidos): 5 mejoras — (1) FilterPill: fecha se mueve antes de los status buttons (Sucursal → Fecha → Estado); (2) EmpChips duplicados eliminados sobre la timeline; avatares de creador/iniciador en timeline ampliados a w-7 h-7; (3) apoyo display simplificado solo con avatares; (4) pills de stats en card sin desplegar (enviados/sin stock/por regla con ⚠); (5) filteredRows y filteredHistory memoizados con useMemo
// v2.2.182 — fix(pedidos): cleanup — migración incorrecta borrada (20260618_get_pedido_preview_garantia_minima.sql) y TabMinMaxComparacion.jsx eliminado (componente no usado)
// v2.2.181 — fix(distribucion): get_pedido_preview v5 — regla de despacho siempre se respeta; parcial solo cuando bodega tiene menos de 1 dispatch_unit (huérfanos); revision_minmax usa asignado_raw=0 en vez de asignado_final=0 para no confundir regla correctamente bloqueada con escasez real
// v2.2.180 — fix(distribucion): get_pedido_preview — segundo WHEN en con_reglas requería asignado_uncapped > 0; sin esa guarda, productos con fracción < 40% (uncapped=0) y max_asignable grande enviaban FLOOR(max_asignable/unit_base)*unit_base en vez del parcial correcto (ej. VIROGRIP enviaba 96 cuando solo necesitaba 7)
// v2.2.179 — fix(distribucion): get_pedido_preview — si bodega asignó packs pero la fracción no llega al 40% del dispatch_unit, ahora se envía asignado_raw como despacho parcial en vez de bloquear con cero. revision_minmax queda solo para sucursales donde asignado_raw=0 (bodega genuinamente sin stock para esa sucursal)
// v2.2.178 — feat(pedidos/TabPedidos): 8 mejoras — (1) timeline con elapsed time + avatares del creador/iniciador por nodo; (2) último nodo renombrado a "Finalizado"; (3) botón Apoyo con scanner-only modal (kiosk_pin), tabla pedido_apoyo; (4) pausa con ring ámbar + shadow; (5) card completa clickeable; (6) texto más oscuro/grande (glassmorphism contrast); (7) PauseModal estilo UnifiedModal; (8) animación timeline con box-shadow glow (evita clipping)
// v2.2.177 — feat(pedidos/TabPedidos): (1) TablePagination estándar en ItemSection — selector de tamaño de página (25/50/100) + numeración animada con pill azul + ir-a-página + badge total, igual a TabInventario/TabMinMax; (2) LifecycleTimeline animado — 6 nodos (Confirmado→Inicio→Listo→En Ruta→Llegada→ERP) con dots de spring, ping pulsante en nodo activo, líneas que se llenan con motion, badge ⏸ Nm en la línea entre Inicio y Listo cuando hay pausa, dot ámbar cuando está pausado
// v2.2.176 — feat(pedidos/TabPedidos): 5 mejoras — (1) filterSuc usa '' en vez de 'all' elimina duplicado Todas/Todos en dropdown; (2) 3 secciones de ítems colapsadas por default; (3) DataTable confirmado como componente global en common/DataTable; (4) PeriodPicker de fecha en FilterPill (igual a VentasView) — filtra historial en DB y en curso client-side; (5) badge "Nm en pausa" con tooltip en stage strip cuando hay tiempo acumulado de pausa
// v2.2.175 — feat(pedidos/TabPedidos): columnas Presentación + Solicitado en las 3 secciones de ítems — COLS_ENVIADOS agrega Presentación; COLS_SIN_STOCK agrega Presentación y Solicitado; COLS_REGLA agrega Presentación y Solicitado; renderPresentacion helper muestra pill con tipo de despacho (Caja ×N, Blíster ×N, Unid ×N) con fallback a factor
// v2.2.174 — fix(pedidos/TabPedidos): 3 fixes — (1) PauseModal: ModalShell requería open={true} — sin él retorna null y el modal nunca aparece al presionar Pausar; (2) canMarcarEnRuta simplificado a stage==='preparado' por sucursal, sin esperar allFinalized de otras sucursales; (3) ItemSection de Productos enviados abre por default (defaultOpen=true) para mostrar columna Solicitado inmediatamente
// v2.2.173 — feat(pedidos/TabPedidos): 5 fixes — (1) BoxStackAnim reemplaza ConveyorAnim (vuelve a v2.2.168); (2) openPauseModal con try/catch — modal siempre abre aunque falle detección kiosko; (3) EmpChip muestra creador+iniciador con foto; botón "Marcar en Ruta" → marcar_pedido_enviado; gate canEdit=hasPermission(pedidos_en_curso,can_edit) en todos los botones de ciclo de vida; (4) DataTable estándar en ItemSections con DataRow/DataCell; (5) columna Solicitado en COLS_ENVIADOS = Math.max(0,ceil((max_qty_snapshot − stock_packs_snapshot×factor)/factor))
// v2.2.172 — fix: commit archivos omitidos en sesiones anteriores — PromocionesView filtrado de tabs por permisos (promociones_tab_*); SchedulesView filtrado de tabs por permisos (schedules_tab_*) con fallback; migracion get_product_last_sales agrega campo cliente e individual transactions
// v2.2.171 — feat(pedidos/kiosko): trigger DB attendance_kiosko_pedido_lifecycle — OUT_LUNCH auto-pausa pedidos activos iniciados por el empleado, IN_LUNCH auto-reanuda; modal pausa detecta estado kiosko (attendance OUT_LUNCH sin IN_LUNCH hoy) — banner teal + auto-selecciona Almuerzo; corrige columna razon en pedido_pausa_historial (era pausa_razon)
// v2.2.170 — feat(pedidos/TabPedidos): ConveyorAnim cinta transportadora reemplaza sonar ping; modal pausa con 6 razones y validacion Almuerzo via pedido_pausa_historial; 3 secciones de items con DataTable/DataRow/DataCell estandar y paginacion; fetchItems ampliado con dispatch/laboratorios; columnas detalladas por seccion
// v2.2.169 — fix+feat(pedidos/TabPedidos): fix NaN en tiempos (elapsed usaba new Date(undefined)→Invalid Date; ahora new Date()); 3 secciones colapsables por card (Productos enviados/Sin inventario/Revisar regla) con MiniTable paginada (15/p) y estándar DataTable; resumen Solicitados·Enviados·Sin inventario·Revisar en strip al abrir card; nueva animación PreparandoAnim (sonar ping rings + package flotante + mini-boxes laterales); CollapsibleSection con AnimatePresence; columnas: Producto, Cant., Estado / Sin stock / Ajustar regla
// v2.2.168 — fix+feat(pedidos/TabPedidos): fix 400 error — fetchItems recibe pedidoId/sucId directamente sin parsear el key string (NaN en UUIDs); pill de filtro a la derecha en header "En curso"; filtros en pill: Pendientes (confirmado) + En camino (enviado) + limpiar todo; SucPill de color por erp_sucursal_id; botones siempre visibles y progresivos (Iniciar→Pausar+Finalizar→Reanudar); animaciones mejoradas (MotorcycleAnim 44×28, BoxStackAnim 4 niveles, PausedAnim barras dobles, ruedas con rotate Framer)
// v2.2.167 — fix(pedidos): TabPedidos — pill filtro estándar VentasView; sin botón Refrescar (realtime); una card por sucursal en sección activa; botón Iniciar inline en card cuando stage=sin_iniciar + pedido confirmado
// v2.2.166 — fix(ventas): ReferenceError getScope — TabVentas, TabVendedores y TabProductos son componentes de nivel superior que no heredan el scope de VentasView; cada uno ahora llama useAuth() para obtener getScope localmente
// v2.2.165 — feat(pedidos): TabPedidos unificado — historial + en curso + recepción + diferencias fusionados en una sola vista de cards con animaciones por etapa (moto en tránsito, cajas apilando en preparación, ping dots pulsantes, scan teal, glow violeta); scope-aware: empleados BRANCH ven solo su sucursal y tienen flujo recepción inline (confirmar llegada → contar ítems → marcar ERP); filtro pill por sucursal para admins; PedidosView reducido a 4 tabs; PermissionsView actualizado
// v2.2.164 — feat(minmax/scope): scope BRANCH implementado en Tab Sucursal — MinMaxView consulta erp_sucursal_map para obtener el erp_sucursal_id del usuario cuando scope=BRANCH; pasa lockedErpId a TabMinMax; TabMinMax inicializa selectedErp con lockedErpId y oculta el selector de sucursal cuando está bloqueado
// v2.2.163 — feat(permisos/scope): scope BRANCH aplicado en 6 vistas — Monitor (BranchChips oculto), AuditView (dropdown sucursal oculto), VacationPlan (selector oculto), Ventas (FilterControls sin selector), Facturación (selector oculto), Nómina (selector oculto); todos inicializan filterBranch con user.branchId cuando scope=BRANCH; emp_schedule: ruta /my-schedule + PermissionGuard + entrada MODULE_MAP + SELF_KEYS + menú Inicio en AppLayout
// v2.2.162 — feat(pedidos/permisos): TabHistorial historial completo pausas múltiples (pedido_pausa_historial — pause/resume, razón, duración, tiempo neto); TabDiferencias botones vista en filter pill estándar; permisos audit — emp_schedule, tabs promociones/pedidos/minmax, permKeys en_curso/metricas, schedules_tab_shifts, hasScope payroll/ventas/facturacion/minmax, TabMinMaxComparacion eliminado
// v2.2.161 — feat(pedidos): mejoras integrales — (1) pedido_pausa_historial: historial completo de pausas múltiples (ya no se sobreescribe la última); (2) Recepción 1 "Confirmar llegada de cajas" (llegada_fisica_at) gatea el conteo de ítems — no se puede contar sin confirmar llegada física; (3) anular_pedido bloquea estado "parcial" (ítems ya recibidos); (4) realtime en TabRecepcion refresca ítems del pedido expandido; (5) auto-notificación a bodega cuando pedido se completa sin diferencias; (6) sección "No enviados esta vez" (sin_stock/revision_minmax) visible en recepción; (7) TabEnCurso: semáforo en tiempo real de todos los pedidos activos con lifecycle por sucursal y progreso de recepción; (8) TabMetricas: tiempos promedio de prep/pausa/tránsito/recuento por sucursal + top razones de pausa; (9) RPCs get_pedidos_en_curso, get_pedido_kpis, get_pausa_razones_stats
// v2.2.160 — fix(reglas): contraste texto panel dispatch — labels sección text-slate-400→slate-600, sub-texto text-slate-300→slate-500 para legibilidad sobre glassmorphism
// v2.2.159 — fix(reglas): dispatch_label UI — pills preset CAJA/ESTUCHE/BOLSA en lugar de texto libre; movidas al tope del panel (junto a presentaciones); Ejemplo corregido (1 CAJA en vez de 12 UNIDAD cuando hay etiqueta); "Quitar regla" rojo por defecto; autoguarda al seleccionar pill.
// v2.2.158 — feat(reglas/pdf): dispatch_label — etiqueta personalizada por producto en el PDF; Electrolit ×12 → "1 CAJA" en vez de "12 UNIDADES"; get_pedido_preview v21 plega dp_multiplo en dp_factor cuando dispatch_label IS NOT NULL para que toDispatch() convierta correctamente.
// v2.2.157 — fix(pedidos): 4 correcciones — (1) PDF header más compacto (márgenes 8→6px, fonts reducidos); footer restaurado "Revisado por / N/M / Recibido por" en TODAS las páginas; última página agrega firma compacta ARRIBA del footer sin espacio vacío; PAGE_MARGINS[3]=44pt; (2) sin_bodega devuelve JSONB — bypasea cap max-rows=1000 de PostgREST; (3) pedidos de prueba borrados del DB (30 pedidos 18856 items); (4) logo del PDF se mantiene.
// v2.2.153 — fix(pedidos): 6 correcciones — (1) PDF por sucursal nombrado con código del pedido (01-170617-3-PO.pdf); (2) descargas simultáneas con 150ms de intervalo en vez de 1s; (3) sin_bodega usa .range(0,9998) — elimina cap PostgREST 1000 filas; (4) encabezado B&W: gris claro #eee sin relleno negro, FARMACIA LA SALUD/LA POPULAR según destino, sin "Farmalasa S.A. de C.V.", direcciones origen y destino desde DB, más compacto; (5) "Generado por + fecha/hora" en contenido del PDF, no en footer; (6) firmas: línea arriba para firmar → nombre impreso bajo la línea → etiqueta; eliminado AUTORIZA; PAGE_MARGINS[3]=60pt para reducir espacio vacío inferior.
// v2.2.152 — fix(pedidos): 8 mejoras — (1) selector ERP/Portal eliminado, siempre usa MIN/MAX Portal; (2) sucursales sin MIN/MAX Portal publicado se ocultan de las cards; (3) PDF descarga directamente (download) con nombre correcto — elimina iframe+print que nombraba el archivo con el título de la pestaña; (4) auto-detección de presentación de despacho v20: ORDER BY factor DESC → elige la mayor disponible (CAJA antes que BLISTER, ej. AMITRAL GX → "1 CAJA" en vez de "10 BLISTER"); (5) firmas en el footer de la ÚLTIMA página vía callback pdfmake, margen inferior 110pt; páginas intermedias solo muestran número de página; (6) .range(0,4999) en query bodega lotes de TabHistorial — elimina cap silencioso PostgREST 1000 filas; (7) PDF combinado (todas las sucursales en un solo archivo, no N descargas); (8) encabezado rediseñado con logo, FARMACIA FARMALASA, ORDEN DE DESPACHO, Bodega→Sucursal, código, fecha.
// v2.2.151 — fix(minmax/csv): ventas período en bodega convertidas a presentación mayor con decimal — si factor>1, units_sold_6m÷factor con 1 decimal y coma como separador (ej. 1,4 cajas); si factor=1 queda en unidades enteras; sin redondeo 40% (es un dato informativo, no un objetivo).
// v2.2.150 — fix(minmax/csv): alerta bodega usa cobertura de red completa (bodega + sucursales) — nueva RPC get_sucursal_net_stock agrega stock real de las 6 sucursales (excl. bodega) por producto; CSV bodega calcula días_cobertura=(stock_bodega+stock_sucursales)/velocidad_diaria; umbrales: <14d→CRÍTICO (A/B) / BAJO MÍNIMO (C), 14–30d A/B→ATENCIÓN, ≥30d→sin alerta; elimina dependencia de alert_status que ignoraba el inventario real de las sucursales.
// v2.2.149 — feat(minmax/csv): bodega CSV — orden lab, alerta críticos, MIN<MAX — (1) filas ordenadas por laboratorio→producto; (2) columna "Alerta": SIN STOCK (out_of_stock), CRÍTICO (A/B + below_min), BAJO MÍNIMO (C + below_min), ATENCIÓN (A/B + approaching); (3) tras conversión 40%, si minPres===maxPres>0 entonces minPres=maxPres-1 para garantizar MIN<MAX.
// v2.2.148 — feat(minmax/csv): exportación bodega con conversión a presentación y nuevas columnas — CSV de bodega usa sortedPres[0] (presentación mayor disponible del producto) para convertir MIN, MAX e Inventario actual con la regla del 40% (floor + ceiling si residuo/factor >= 0.4); agrega columnas "Presentación" (tipo de la presentación) e "Inventario actual" (cantidad convertida); sucursales normales mantienen el CSV original en unidades base.
// v2.2.147 — fix(minmax): confirmación clase A/B también cubre "0 en red" desde bodega — handleZeroAllBranches refactorizado para aceptar row como parámetro; onZeroAllBranches en RowActions desvía A/B al modal de alta rotación (pendingZeroAll:true) en vez del genérico; zeroAllConfirm genérico queda solo para clase C/sin clase; el modal de alta rotación adapta título, mensaje y botón según sea poner-0-local o 0-en-red.
// v2.2.146 — fix(minmax): confirmación "poner 0 en clase A/B" ahora cubre el editor inline y navegación con flechas — saveDraftCell y saveDraftPair interceptan antes del write cuando numVal=0 y el valor anterior era >0 en producto A/B; guardan el edit pendiente (pendingCell/pendingPair) en el estado del ConfirmModal; al confirmar se reanuda el save con {confirmed:true} que bypass el check; al cancelar el edit se descarta; el botón "Poner 0" de RowActions usa el mismo modal con pendingCell/pendingPair=null para mantener la ruta de zeroOutRow.
// v2.2.145 — feat(minmax): confirmaciones en acciones críticas — (1) Calcular individual y Calcular todas: ConfirmModal antes de ejecutar (no destructivo, informa que sobrescribe borradores); (2) Descartar borrador individual (per-fila): ConfirmModal destructivo antes de revertir; (3) Poner 0 en producto de clase A o B: ConfirmModal destructivo adicional con clase y velocidad del producto (para clase C o sin clase sigue directo sin confirmar); las confirmaciones de Publicar, Descartar todo y 0 en red ya existían.
// v2.2.144 — feat(minmax/bodega): botón "0 en red" + fix publish_stock_params v7 — (1) nuevo botón de acción en bodega "0 en red": abre ConfirmModal y llama RPC zero_out_product_all_branches que publica 0/0 en todas las sucursales y bodega en un solo paso (limpia drafts y overrides manuales); el botón aparece en el dropdown "Más" de RowActions solo cuando selectedErp=6 y canManage; (2) migración publish_stock_params v7: corrige HAVING que excluía productos cuando la Σ pub=0/0, causando que bodega conservara un draft stale "pending" aunque ninguna sucursal tuviera draft activo; el OR EXISTS en el HAVING garantiza que bodega recibe draft_status='none' cuando todas las salas publican 0/0; (3) fix inmediato: limpieza de 180 registros stale en bodega.
// v2.2.143 — fix(minmax/bodega): 3 correcciones en ExpandedPanel y tabla bodega — (1) "MIN·MAX red" ya no incluye bodega en su propia lista (filtro id!==6 en ERP_ORDER.map); (2) mensaje "Sin MIN·MAX en ninguna sala" cuando todas las sucursales tienen 0/0 y sin borradores pendientes; (3) badge "SIN SALAS" en filas de bodega cuando el producto fue retirado de todas las salas (draft_min+draft_max=0 pendiente, o min_units+max_units=0 con override manual).
// v2.2.142 — feat(minmax): venta mensual inline — agrega "/mes" entre diaria y 6 meses en la fila de producto (Math.round(v6m×30), mismo promedio 6m que ya se usaba; sin cambio de DB).
// v2.2.141 — fix(pedidos/pdf+rpc): 4 correcciones — (1) centrado vertical de todas las celdas en PDF (loteStackNode faltaba verticalAlignment:'middle' en ambas ramas — stack y texto vacío); (2) badge "BAJO RECETA" ahora es un chip de color (amber-100/amber-900) en lugar de texto en negrita plano, usando mini-table pdfmake sin borde con fillColor y padding; (3) RPC get_pedido_preview v19b: redondeo al múltiplo de despacho más cercano con umbral de 40% — elimina CEIL incondicional (v15-v18); fórmula: FLOOR(need/unit) + (residuo ≥ 40%×unit ? 1 : 0); aplica a todos los tipos de regla (dp_factor, solo_cajas, multiplo, blister, multiplo_unidades) y subsume el check de "0" de v18; cap-fallback mejorado: en lugar de revertir a unidades ERP sueltas cuando no alcanza el ideal redondeado, busca el múltiplo completo más grande que sí cabe; (4) auto-detección de presentación de despacho para productos SIN dispatch_rule — CTE auto_pres_factor selecciona el empaque físico más pequeño disponible (factor > 1, ORDER BY factor ASC → BLISTER antes que CAJA); la cantidad se redondea automáticamente al empaque entero más cercano usando el mismo umbral de 40%, igual que si tuviera regla explícita (en bodega no se fraccionan blisters ni cajas).
// v2.2.140 — fix(auth): reintento automático + mensaje claro en fallas de red durante login — login/loginWithEmail/loginWithUsername ahora reintentan hasta 3 veces (1.2s entre intentos) cuando Supabase responde con un error de tipo "Failed to fetch"/AuthRetryableFetchError (DNS/conectividad transitoria), en vez de fallar al primer intento; si tras los reintentos sigue fallando, se muestra "No se pudo conectar a internet. Revisa tu WiFi/datos e intenta de nuevo." en vez del mensaje crudo del error. login() ahora retorna {ok,error} en vez de boolean (LoginView.jsx actualizado, único consumidor).
// v2.2.139 — fix(pedidos/pdf): 4 ajustes tras probar el footer/conversión de v2.2.138 — (1) footer invisible al imprimir en papel real: el margen inferior de página (30pt) dejaba el texto del footer a ~5mm del borde físico, justo en el límite del margen de hardware típico de cualquier impresora (4-6mm) — el PDF lo tenía bien (confirmado generando y revisando el archivo), pero se recortaba al imprimir; margen inferior subido a 44pt para dar holgura real; (2) el PDF ya no se guardaba con el nombre del pedido al usar "Guardar como PDF" — Chrome toma el nombre sugerido del document.title de la pestaña en el momento de imprimir, no del título interno del PDF (info.title), aunque esté embebido en un iframe; ahora se pone document.title al título del pedido justo antes de print() y se restaura después; (3) quitado el sufijo "pk" en la cantidad de cada lote (ej. "L001 · ene-26 · 3" en vez de "...3pk"); (4) productos sin lote registrado (genéricos, no se rastrean por lote) ya no muestran "—" en la celda Lote — queda en blanco, evita la impresión de un dato faltante.
// v2.2.138 — fix(pedidos/pdf): 4 bugs reportados tras imprimir desde Historial — (1) productos con cantidad=0 (revision_minmax, regla del 40% mínimo de despacho) ya no se imprimían como "0" en la hoja — printFromPedidoItems ahora filtra qty<=0 igual que printPerSucursal/printFromPreview; (2) la hoja de pedido nunca convertía a la presentación mayor (ej. JERINGA INSULINA 100 unidades → debía mostrar 1 CAJA) porque pedido_items nunca persistía factor/dispatch_tipo/dispatch_factor al confirmar — agregadas 3 columnas nuevas (migración pedido_items_dispatch_snapshot + confirm_pedido actualizado), TabGenerar.jsx ahora las envía, TabHistorial.jsx las consulta, y printFromPedidoItems aplica toDispatch()/lotesAsignadosToDispatch() igual que el resto de los flujos de impresión — pedidos viejos sin estos campos conservan el comportamiento anterior (fallback seguro); (3) fila de producto con varios lotes no centraba verticalmente Lab/Producto/Presentación/Cant/✓ contra el stack de lotes — usa verticalAlignment:'middle' nativo de pdfmake (soportado desde v0.3.4, confirmado en v0.3.11 instalada); (4) pie de página por hoja: paginación "1 / N" centrada, "Revisado por: ___" a la izquierda y "Recibido por: ___" a la derecha, en una sola fila pequeña dentro del margen inferior — vía footer callback de pdfmake.
// v2.2.137 — fix(pedidos/pdf): reemplazo completo del motor de impresión — HTML+CSS print (window.print) por pdfmake, que genera el PDF real en vez de depender de cómo cada navegador/impresora fragmenta HTML al imprimir. Corrige los 3 defectos reportados al imprimir en papel real: (1) encabezado no repetía en cada hoja — ahora usa headerRows nativo de pdfmake, garantizado por el motor que dibuja el PDF, no por CSS; (2) márgenes al límite sin verificar — pageMargins exactos codificados en el PDF (24/22/24/30pt), muy por encima del margen de hardware típico de cualquier impresora (~4-6mm); (3) un producto no se veía tras imprimir — causa raíz: pdfmake's rowSpan (usado para fusionar Lab/Producto/Cant cuando un producto tiene varios lotes) NO es atómico al paginar, lo confirmé con una prueba dirigida: un producto de 4 lotes posicionado justo en el borde de página se dividía entre hojas, dejando Lab/Producto/Cant en blanco en la continuación — bug invisible en pantalla pero real al imprimir. Fix: cada producto es ahora una sola fila de tabla (lotes apilados como líneas dentro de la celda Lote, sin rowSpan) + dontBreakRows:true en la tabla, así pdfmake mueve el producto completo a la siguiente hoja si no cabe, nunca lo corta. Verificado con suite de pruebas: multi-lote 1-90 filas, nombres largos con wrap, multi-sucursal con secciones vacías, barrido de firma en el límite de página (23 vs 24 filas), y barrido del producto de 4 lotes en cada fila del borde de página real (43-46) — todos pasan. Dependencia añadida: pdfmake.
// v2.2.136 — feat(pedidos/generar): numeral de ranking de urgencia en las cards de sucursal — badge gris junto al % de urgencia mostrando su posición (1, 2, 3...) ordenado de mayor a menor avg_urgencia_pct, para saber en qué orden despachar
// v2.2.135 — fix(pedidos/pdf): 4 ajustes de impresión — (1) lotes múltiples ahora fusionan Lab/Producto/Presentación/Cant/✓ con rowspan en vez de repetir filas vacías — todo el bloque queda centrado verticalmente (vertical-align:middle) y se elimina el borde punteado entre lotes que parecía indicar "sin asignar"; (2) elimina el indicador circular "R" de regla de despacho (BADGE_REGLA + campo tiene_regla); (3) elimina el wrapper flex+min-height:calc(100vh-14mm) usado para anclar firmas al fondo — causaba página en blanco al final cuando el cálculo de altura no cuadraba con la paginación real; firmas ahora fluyen normalmente tras la tabla con page-break-inside:avoid; (4) thead{display:table-header-group} explícito — encabezado se repite de forma confiable en cada hoja sin el contexto flex que lo rompía
// v2.2.134 — fix(pedidos/pdf): tabla rota — display:flex en th/td con colgroup hacía que el navegador generara una sola celda anónima envolviendo todas las columnas (el contenido se apilaba en la primera columna y el resto de la tabla quedaba en blanco); reemplazado por display nativo de celda (vertical-align:middle + text-align en vez de align-items/justify-content)
// v2.2.133 — fix(pedidos/pdf): rediseño completo de impresión — (1) tabla real <table><thead> en vez de flex+conteo manual de filas: el encabezado ahora se repite nativamente en cada hoja, elimina bug de header apareciendo a media página; (2) orden de columnas: Laboratorio, Producto, Presentación, Cantidad, Lote, ✓; (3) lotes múltiples salen una fila por lote (no apilados en una celda) — Lab/Producto/Presentación/Cant solo en la primera fila, continuación con borde punteado; (4) badge AB renombrado a "Bajo Receta" en negrita pequeña; (5) nuevo indicador circular "R" junto al producto cuando tiene_regla_despacho=true (printPerSucursal/printFromPreview); (6) firmas ancladas al fondo de la última hoja vía flex+min-height:calc(100vh-14mm), ya no quedan pegadas al final de la tabla; (7) padding vertical de filas reducido (4px→2px, min-height 24px→16px) y cantidad menos pesada (13px/800→11px/700) — más filas por hoja; tamaño carta sin cambios (@page size:letter).
// v2.2.132 — fix(minmax): 0 es válido cuando max>0 — regla: mostrar 0 solo si el par tiene max>0; — si ambos son 0/null. Display, inline edit, arrow nav y CSV corregidos.
// v2.2.131 — fix(minmax): 3 bugs — (1) null/0 coerción: inline edit y CSV ya no muestran ni guardan 0 cuando MIN/MAX no está asignado (0 → —); (2) borrador en publicados: live save ahora incluye draft_status:'none' + cross-validation en saveDraftPair; (3) latencia: setData optimista antes del await, revert si error.
// v2.2.130 — fix(pedidos/rpc): umbral mínimo de despacho 40% — si reponer < 40% de la unidad de despacho (CAJA/BLISTER/etc.), asignado=0 y el producto cae en revision_minmax. Evita enviar 1 CAJA completa cuando solo se necesitan 1-2 unidades. El operador ajusta la regla o MIN/MAX de esa sucursal. Aplica a todos los tipos de regla (nueva + legado).
// v2.2.129 — fix(pedidos/rpc): dispatch cap en get_pedido_preview v17 — si CEIL(raw/múltiplo)×múltiplo excede el disponible de bodega para esa sucursal, se despacha asignado_raw usando presentación ERP base (sin redondeo). Elimina sobre-asignación de min-stock en TABCIN (2 und en vez de 72), ALCOHOL (8 en vez de 10) y ALERFIN (disponible real en vez de blisters de más). Test: 0 LOTE_MISMATCH, 0 DISPATCH_OVERFLOW
// v2.2.128 — fix(pedidos/pdf): dispatch_tipo+dispatch_factor en get_pedido_preview v16; PDF convierte qty y lotes a packs de despacho (JERINGA INSULINA 0.5ML mostraba 100 unidades → ahora 1 CAJA; FARSENTAL BLISTER×2 correcto; cualquier producto con presentación de despacho distinta a la ERP se muestra correctamente)
// v2.2.127 — fix(pdf): reemplaza <tbody>-por-fila por filas display:flex con break-inside:avoid (fiable en Chrome print); encabezado de columnas se repite cada 28 filas en secciones largas; lotes ya no desbordan (word-break:break-word en celda flex); centrado vertical en todas las celdas (align-items:center); menos ancho al ✓ (22px) y más al Producto (flex:2)
// v2.2.126 — perf(reglas): JOIN presentaciones en dispatch_rules (elimina query serial); hiddenLabIds null-check evita doble fetch inicial; dispatch_tipo desde presCache post-save (badge instantáneo); ruleTypeLabel fuera del componente
// v2.2.125 — fix(reglas): sort estado/despacho client-side; quita filtro lab; dedup presentaciones por factor (prefiere la de la regla existente); paginación correcta con pageSize dinámico y totalPages
// v2.2.124 — fix(reglas): quita columna AB, agrega badge "Bajo receta" inline en nombre del producto, laboratorio completo sin truncar, col lab+producto ya ordenables por header
// v2.2.123 — fix(reglas): solo_cajas NOT NULL → false al guardar; cache presentaciones en presCache ref (sin re-fetch al reabrir panel)
// v2.2.122 — feat(reglas): rediseño TabReglas por presentación real + migración total 710 reglas — TabReglas nuevo panel: muestra presentaciones reales del producto (CAJA/BLISTER/UNIDAD/etc.), usuario selecciona cuál es la unidad de despacho y cuántas por lote (×1..×50+); get_pedido_preview v15 con CTE dispatch_pres_factor (fórmula universal CEIL(raw×factor/(dp_factor×dp_multiplo))×dp_factor×dp_multiplo/factor); backward-compat con reglas legacy (solo_cajas/multiplo/blister/multiplo_unidades); migración automática DB: 710/710 reglas convertidas al nuevo sistema
// v2.2.121 — fix(pdf+rpc): @page margin:0 elimina URL del footer, tbody-por-fila corrige corte entre páginas, lotes en stack vertical (display:block), restaura col Presentación separada; get_pedido_preview v14 cambia FLOOR→CEIL en rama solo_cajas (redondea a cajas completas hacia arriba) y agrega guard caja_factor IS NULL (no aplica conversión si el producto no tiene presentación CAJA en product_precios)
// v2.2.120 — fix(pdf): B&W optimizado + about:srcdoc + nombre completo + cantidad con tipo + bug lotes_asignados — (1) printHtml usa Blob URL (blob:// en header, no about:srcdoc); (2) product name: white-space:normal word-break:break-word (antes cortaba con ellipsis); (3) diseño B&W: header negro sólido, badges AB en outline, filas impares #f2f2f2, bordes grises, sin colores RGB; lotes distinguibles por tipografía [bold·italic·bold] con │ separador; (4) fmtCant+parseTipo: cantidad muestra "1 CAJA"/"3 FRASCO" en lugar de "1" solo; UND/UNIDAD permanece sin etiqueta; (5) BUG fix: lotesText en printFromPedidoItems lee l.take??l.cantidad??l.packs (lotes_asignados del DB no tiene l.take); (6) columna Presentación eliminada y fusionada en Cantidad — 5 columnas totales
// v2.2.119 — fix(pedidos/pdf): build error + rediseño PDF completo — (1) buildSignatures faltaba } de cierre → printHtml/openPrintWindow/exports quedaban dentro de la función, rollup rechazaba export fuera de módulo; (2) position:fixed en sig-block eliminado — firmas en flujo normal del documento (no se repiten en cada página); (3) @page margins en lugar de padding en body — page-break-inside+break-inside en tr para cortes correctos; (4) diseño compacto: TH 7.5px uppercase tracking, filas 3px vertical, cantidad 14px bold, lote 8px; tabla table-layout:fixed
// v2.2.118 — fix(pedidos/pdf): excluye productos qty=0 del PDF + orden columnas + firmas al fondo — filter qty>0 en printPerSucursal/printFromPreview; columnas: Producto|Lab|Cant|Present|Lote|✓; firmas fixed bottom:10mm con padding-bottom:52mm en body; estructura firmas mejorada con border-spacing
// v2.2.117 — fix(pedidos): selección = glow ring solo, sin cambio de color — card mantiene fondo/texto original; selección agrega ring-blue-400 + shadow glow + shimmer line más brillante + checkmark azul sólido; se eliminan todos los overrides isOn de colores internos
// v2.2.116 — feat(pedidos): urgencia ponderada por reponer + indicador último pedido — avg_urgencia_pct ahora es media ponderada por unidades a reponer (productos A con más necesidad pesan más); stats v4 agrega last_pedido_at; cards muestran "hoy/ayer/hace Xd" con color verde<7d ámbar<14d rojo≥14d
// v2.2.115 — fix(pedidos): card seleccionada liquid glass encendida — glass azul translúcido (no sólido), sombra 45% difusa, highlight top más brillante (via-white/90), doble capa de luz difusa con blur interno
// v2.2.114 — fix(pedidos): urgencia absoluta + cards seleccionadas azul encendido — get_pedido_sucursal_stats v3 agrega avg_urgencia_pct (AVG reponer/max×100 por sucursal); thresholds absolutos ≥65%=rojo ≥40%=ámbar <40%=verde; badge muestra % real; selected = gradiente azul sólido #1565D8→#003590 con glow 60% y ring
// v2.2.113 — refactor(pedidos): elimina Vista previa + rediseña cards sucursal liquid glass — se remueven handleCalcular, handleConfirmar, preview screen, renderRow, grouped/sortedSucIds/globalTotals, ajustes, notas, responsable/revisado (~500 líneas); cards de sucursal rediseñadas con glassmorphism (backdrop-blur, gradient, highlight line, inner glow, badge pills animados)
// v2.2.112 — fix(pedidos): selector MIN/MAX liquid glass + stats reactivos + conteo productos — toggle pill sliding con glassmorphism; get_pedido_sucursal_stats v2 acepta p_use_portal_minmax y retorna con/sin_bodega_productos; stats se re-fetcha al cambiar fuente; cards de sucursal muestran productos (no packs)
// v2.2.111 — feat(pedidos): selector MIN/MAX ERP vs Portal en TabGenerar — toggle pill "MIN/MAX ERP / MIN/MAX Portal"; get_pedido_preview v13 acepta p_use_portal_minmax (lee product_stock_params.manual_min/min_units ÷ factor en lugar de erp_minmax); badge en pantalla de preview indica fuente activa
// v2.2.110 — fix(pedidos): elimina borradores de TabGenerar — flujo migrado a "Generar y confirmar" directo; se removieron estado/funciones/UI de savingSnap/snapMsg/snapshots/loadingSnaps/snapsOpen/deletingSnap/handleGuardarBorrador/loadSnapshots/handleLoadSnapshot/handleDeleteSnapshot e imports Save+Trash2
// v2.2.109 — feat(pedidos): Realtime en TabRecepcion — canal supabase_realtime para tabla pedidos (ALTER PUBLICATION); suscripción filtra client-side por sucursal_ids.includes(erpSucursalId); refresca lista automáticamente ante INSERT/UPDATE; banner pulsante "Nuevo pedido #N" con auto-dismiss 8s cuando llega pedido enviado
// v2.2.108 — fix(pedidos): 3 mejoras — (1) TabGenerar: borradores cargables — sección "Borradores guardados" en dashboard lista snapshots con Cargar (carga datos+sucursales en preview) y Eliminar; ERP_NAMES/SUCURSALES ahora importados de constants/erp.js; (2) TabDiferencias: resolución de diferencias — columnas resuelta_at/resuelta_por en pedido_items (DB migration); botón "Resolver" por fila en vista Detalle marca la diferencia cerrada; toggle "Mostrar/Ocultar resueltas"; get_pedido_diferencias_stats v2 expone pedido_item_id+resuelta_at+limit 500; (3) ERP_NAMES dedup en TabRecepcion, TabDiferencias, TabGenerar → importan desde constants/erp.js
// v2.2.107 — fix(pedidos): 6 correcciones — (1) TabRecepcion paginación aumentada a 500 pedidos (era 100); (2) TabDiferencias timezone El Salvador UTC-6 en filtros de fecha (era UTC 0); (3) RecepcionModal quita cap max en cantidad recibida (permite registrar más de lo asignado); (4) TabGenerar re-fetcha dashStats+sinBodega tras confirmar pedido (datos ya no quedan stale); (5) PedidosView lazy mount tabs (no montados hasta navegar) + recepcionKey separado de historialKey; (6) src/constants/erp.js centraliza ERP_NAMES, SUCURSALES y ERP_BODEGA_ID
// v2.2.106 — fix(minmax): (1) DraftCostCard en Bodega cambia etiqueta a "Σ red efectiva" + icono ámbar (vs violeta en sucursales) — deja claro que es la suma auto-calculada, no un borrador manual; (2) badge "N·N" ámbar con dot pulsante reemplaza "→ N·N prev." en DataCell Bodega — más reconocible como estado accionable; title="Hover para ver sucursales pendientes" para discoverability
// v2.2.105 — fix(minmax): (1) CSV semicolons + BOM para Excel — sep=; + \uFEFF (BOM) elimina el problema de columnas unidas en Excel español; (2) Bodega: oculta "Todas las sucursales" (ya estaba oculto Calcular); (3) aviso Bodega movido inline al filter bar (chip compacto con estado pendientes/al-día), elimina la fila extra; (4) canExpand incluye effective_min>0 || effective_max>0 — productos con params pero sin inventario (p.ej. Bodega) ya se pueden desplegar
// v2.2.104 — fix(minmax): pill de filtros rediseñada — glassmorphism real (rgba bg + blur(20px) saturate(180%) + border blanco) en el outer; siempre rounded-2xl completo (sin border-r-0 que dejaba el lado derecho cortado en Bodega); separador vertical antes de Calcular en lugar de border-r-0 en el inner; animaciones chipAnim/iconAnim/ctaAnim más rápidas (100ms easeOutExpo) y sin spring underdamped (ζ≈0.53→easeOut); transition-colors en todos los botones de la pill
// v2.2.103 — fix(minmax): (1) Bodega sin botón Calcular — se actualiza sola vía trigger+publish; handleRecalcularAll excluye id=6; empty state Bodega explica flujo correcto; (2) badge "SUC. PEND." ámbar en columna producto cuando Bodega row tiene draft_status=pending (alguna sucursal no ha publicado); hover "→ N·N prev." ya muestra qué sucursales
// v2.2.102 — fix(minmax): RowActions hover lag — elimina whileHover y:-2 (spring underdamped ζ≈0.43 que oscilaba/bounceaba); elimina delay stagger de items dropdown; apertura dropdown: spring→easeOut 100ms; queda solo whileTap con spring crítico (damping 40) para feedback de clic inmediato
// v2.2.101 — fix(minmax): RowActions — "Más" solo aparece cuando hay >3 botones en total; con ≤3 se muestran todos directamente (Bodega: Restaurar+Historial+Ocultar sin dropdown)
// v2.2.100 — fix(minmax): Bodega pub_min histórico incorrecto — min_units en Bodega estaba puesto como Σ efectivo (incluyendo sucursales en borrador) en lugar de Σ publicado; migración retroactiva corrige todos los registros (manual_min IS NULL); get_stock_analysis ya retorna effective_min=pub_sum; tooltip on-hover "→ N·N prev." muestra sucursales pendientes con su draft_min·draft_max
// v2.2.99 — fix(minmax): 2 gaps cosméticos Bodega — (1) DataCell Σ no aparecía en carga inicial para productos con min_units=NULL pero draft_min>0 (pub_min=0 desde get_stock_analysis); condición extendida a draft_min/draft_max y valor muestra max(pub,draft); (2) resetToCalc dejaba pub_min=min_units??0 en estado → tras Restaurar, DataCell mostraba Σ incorrecto hasta próximo _openBodegaEdit; ahora pub_min=max(min_units,draft_min) igual que _openBodegaEdit
// v2.2.98 — fix(minmax): floor Bodega ignoraba draft_min — productos sin publicar (min_units=NULL) tienen effective_min desde draft_min (trigger Σ sucursales); floor ahora = max(min_units, draft_min) → ENSURE ADVANCE LIQ con draft_min=34 ya no permite poner 1
// v2.2.97 — fix(minmax): validación floor Bodega no funcionaba cuando pub_min era stale → openBodegaEdit hace fetch fresco de min_units/max_units antes de abrir el editor y almacena bodegaPubMin/Max en inlineDraftEdit; validateEditForRow usa esos valores frescos; saveDraftCell/saveDraftPair tienen segunda línea de defensa con floor re-validado
// v2.2.96 — fix(minmax): Restaurar Bodega mostraba "--" cuando pub_min era stale (0 en estado local aunque sucursales ya publicaron) → después de limpiar manual_min/max, re-lee min_units/max_units/draft_min/max desde product_stock_params para obtener Σ real actual
// v2.2.95 — fix(minmax): 3 bugs Bodega — (1) indicador MANUAL persiste al abrir/cerrar sin editar → saveDraftCell/saveDraftPair skip si valor no cambió; (2) Restaurar no limpiaba manual → resetToCalc path Bodega UPDATE manual_min=NULL; hasRestaura incluye isBodegaRow&&has_manual; (3) botón Más siempre visible → renderizado condicional dropdownBtns.length>0; toast 0/0 → mensaje contextual "sin publicar" cuando pub_min=pub_max=0
// v2.2.94 — feat(minmax): Bodega override manual con piso Σ — get_stock_analysis v10 expone pub_min/pub_max; validateEditForRow bloquea valores menores a Σ sucursales; saveDraftCell/saveDraftPair para Bodega guardan en manual_min/manual_max (no draft); celda muestra "Σ N·N" en violeta bajo el override; toast al abrir celda informa la Σ actual
// v2.2.93 — fix(minmax): Bodega — banners unificados en 1 strip liquid glass (Info + "Al día"/"N pendientes" pill); RowActions recibe isBodegaRow → oculta Publicar/Descartar/Poner0 para Bodega; "Más" dropdown de Bodega queda limpio
// v2.2.92 — fix(minmax): Bodega no muestra botón Publicar ni badge BORRADOR — filas Bodega se excluyen de draftCount; bodegaPendingCount alerta cuántos productos tienen sucursales pendientes; DataCell muestra min_units/max_units publicados como primario y draft como "→ N·N prev."; Despacho y validateEditForRow usan valores publicados para Bodega; BORRADOR badge oculto para Bodega
// v2.2.91 — fix(minmax): ExpandedPanel ventas + MIN·MAX red solo en Bodega (isBodega=erp_sucursal_id===6); sucursales vuelven a 2 columnas con ventas filtradas por sucursal; Bodega mantiene 3 columnas con ventas de toda la red + badge sucursal + MIN·MAX red
// v2.2.90 — fix(minmax): publish_stock_params v6 — Bodega se auto-confirma al publicar cualquier sucursal: min_units/max_units = Σ sucursales publicadas; draft preview (→ Σ efectivo) solo si quedan borradores pendientes; cuando todas publican, draft de Bodega se limpia; Bodega nunca requiere publicación manual; sucursal_id=6 excluida del paso 1 (no puede publicarse como sucursal normal)
// v2.2.89 — feat(minmax): ExpandedPanel — borrador visible en cards de sucursal (→ draftMin·draftMax en dashed amber); ventas: últimas 6 sin importar sucursal (badge sucursal en cada fila); 3ª columna "MIN·MAX red" compacta con indicador de borrador por sucursal; get_product_branch_summary retorna draft_min/draft_max/draft_status; get_product_last_sales soporta p_erp_sucursal_id=null (todas las sucursales) + retorna erp_sucursal_id
// v2.2.88 — feat(minmax): calculate_stock_params v3 — auto-aplica borradores ≤40% cambio o primera asignación; >40% o 0→0 quedan como borrador; Bodega excluida del cron mensual (se mantiene sola); nightly-minmax-recalc eliminado; notificación mensual muestra X auto-aplicados · Y pendientes
// v2.2.87 — fix(minmax): MIN·MAX centrado en columna (wrapper w-full justify-center); companion value restaurado con borde punteado border-2 border-dashed (estado puntuado) al editar MIN o MAX
// v2.2.86 — fix(minmax): MIN·MAX valores en recuadros con ancho fijo min-w-[36px] (sin salto al editar); Despacho MIN·MAX en 1 línea con separador; dropdown Más items horizontales (icono+texto) via dropCls sin flex-col
// v2.2.85 — feat(minmax): 10 mejoras UI — Fórmula actual card igual alto que matrix (items-stretch) + colores monocromáticos slate; cantidad siempre slate-700 (sin rojo/naranja condicional); AbcXyzBadge solo texto plano (C=amber, Z=rose, resto slate); celda Producto 1 fila compacta (Package icon + stock | BarChart2 icon + v/día · 6m · última venta); Despacho pill incluye regla con separador "|"; MIN·MAX celda combinada (1 línea con "·"); columna Estado eliminada → dot badge en foto del producto (title=label, hover info); dropdown Más icono+texto ya en v2.2.84; ExpandedPanel sin backdropFilter (sin lag al expandir); ExpandedPanel sin breakdown de presentaciones
// v2.2.84 — fix(minmax): RowActions AnimatePresence dentro de createPortal (fix dropdown invisible); wrapper group único onMouseLeave (sin dead zones al pasar entre botones); spring stiffness 900/26 más fluido; expansión spring stiffness 380 mass 0.7 willChange:height; ExpandedPanel AnimatePresence mode:wait en branch grid + detail sections con fade+slide entry
// v2.2.83 — fix(minmax): RowActions portal dropdown (createPortal+fixed position, siempre visible sin clipping); siempre 3 elementos (pool prioritario: Poner0→Restaurar→Historial→Ocultar, 1eros 2 visibles + Más); cierre en scroll; ExpandedPanel 2-wave loading (branches primero, detalles en paralelo); breakdown sin columna und; ventas con cliente; proyección+historial en 2 columnas al fondo; liquid glass design
// v2.2.82 — feat(minmax): RowActions component — máx 3 visibles (Poner 0 + Restaurar + Más); hover en Más abre dropdown glass con animación spring+stagger (Historial, Descartar, Publicar, Ocultar); fallback Ocultar/Mostrar cuando no hay primarios
// v2.2.81 — fix(minmax): acciones botones spring y-shift fluido (sin scale, stiffness 800 damping 30); publicar=glass igual a otros; ABC matrix: gap-[3px] compacto, hover y-shift sin overlap, header con padding; estados pill neutral slate, solo el dot con color
// v2.2.80 — fix(minmax): 8 ajustes UI — clase A chip dentro del filtro pill (togglable, no separado); publicar botón sólido azul #0052CC + texto blanco (más prominente); draft pill color neutro blanco glass (sin ámbar); badge BORRADOR en tabla color neutro slate; ABC: A/B neutrales, solo C con tono ámbar; XYZ: X/Y neutrales, solo Z con rose; Despacho MIN/MAX unificados a slate-700/500; Acciones botones flex-col icon+label estandarizados
// v2.2.79 — feat(minmax): publicar liquid glass (shimmer sweep + spring hover/tap); draft+publicar integrado en pill amber a la derecha de filtros (una sola fila); clase A como pill glass solo cuando hasPublishedData (⚠ + pills sin stock/bajo mín + click → Ver A); eliminado Row 2 separado
// v2.2.78 — fix(minmax): 7 mejoras UI — solo filtros Excesos/Sin mov./Sin hist./Revisar+ocultos; Limpiar siempre rojo; pocos datos=chip igual; cards montos slate-800 uniforme; alerta A compacta glass; badge SIN HISTORIAL eliminado; foto w-7 zoom overlay; cols lab 18%+despacho 130px; ABC matrix p-3 gap-1
// v2.2.77 — fix(minmax): chips sin lag (transition-all→transition-[bg,border,color] duration-100 + backdrop-blur-sm siempre); botón global "Limpiar" (aparece con cualquier filtro activo, limpia todo); ABC matrix más compacta + liquid glass real en celdas (backdrop-blur+inner shadow cuando activa, spring whileHover/whileTap en celdas y header); scroll al expandir → data-expand-row + 380ms delay (espera animación 350ms)
// v2.2.76 — fix(minmax): stat filter chips más compactos + glass activo (px-2.5 py-1.5, rounded-xl, backdrop-blur+shadow cuando activo); DraftCostCard misma altura que CostCards (delta integrado en label, sin fila extra); scroll suave al expandir producto (scrollIntoView block:nearest con 60ms delay)
// v2.2.75 — fix(minmax): PostgREST cap en HEAD request — reemplaza count:exact/head:true por RPC get_stock_analysis_count (lee directo de mv_stock_analysis con índice, sub-ms); parallel chunks ahora usan count real → todos los productos cargados
// v2.2.74 — perf(minmax): A+B architecture — mv_stock_analysis MV (pre-computa branches/dead_stock en 4,279 filas × 7 sucursales); get_stock_analysis usa MV lookup + live JOINs en 45ms; loadData carga count+meta en paralelo (Phase 1) luego todos los chunks simultáneos Promise.all (Phase 2); calculate_stock_params refresca mv_stock_analysis al finalizar
// v2.2.73 — fix(minmax): restaura while-loop con metadata paralela (PostgREST cap 1000 → todos los productos); fix(pagination): scrollIntoView instant al cambiar página (ya no sube el scroll); feat(layout): botones flotantes glassmorphism subir/bajar (GlassViewLayout, aparecen tras scroll > 150px)
// v2.2.72 — perf(minmax): consolida 10+ useMemo passes en un solo O(N) derivado; fix colores invisibles en glass (text-slate-200→400, opacity-15→30, spinners/icons/text-slate-300→400/500); paginación: "···" siempre visible con mayor contraste, input "Ir a / [n]" siempre disponible cuando totalPages>7 (sin clic previo)
// v2.2.71 — perf(minmax): mv_product_last_sale reemplaza last_sale CTE (533K→16K filas indexadas); loadData usa Promise.all paralelo + single range(0,4999) en lugar de while-loop secuencial; stale-while-revalidate (sin setData([])); calculate_stock_params refresca el MV al finalizar
// v2.2.70 — fix(minmax): get_stock_analysis incluye catalog_pres CTE (product_precios+presentaciones con descripcion) en los 4 branches → Levoxanet y dead stock siempre ven presentación del catálogo; hasPres=pres.length>0 (factor=1 ya no queda invisible); regla de despacho inline con pill; MIN/MAX text-[10px] font-semibold amber-600/blue-600
// v2.2.69 — fix(minmax): Despacho siempre visible (dead stock inclusive); sin regla = cantidades exactas; con regla = nota pequeña gris (und×N/blist×N/caja×N/solo cajas) + redondeo ≥50%
// v2.2.68 — feat(minmax): paginación framer-motion layoutId sliding pill (azul se desliza entre páginas), NavBtn whileHover/whileTap spring, ellipsis "•••" sutil; Despacho: fetch product_precios+presentaciones como fallback cuando presentations=[], capTipo capitaliza tipo, displayDesc muestra "Caja 1x1" desde product_precios.descripcion; ventas: calculate_stock_params usa CURRENT_DATE-6months (meses calendario) en lugar de analysis_days días → units_sold_6m coincide con filtro 6m en Ventas
// v2.2.67 — feat(minmax): paginación glassmorphism con animaciones, hover, input manual de página (click en "···"), botones primera/última; fila expandida única (Set→null, AnimatePresence height:0→auto), panel glassmorphism; columna Despacho fallback a row.presentacion cuando smallestPres.tipo="und"; AbcXyzMatrix colores azul unificado por intensidad, grid compacto gap-[3px]; fix DataTable overflow-y:visible para liberar scroll vertical; fix filtro pill overflow-x:auto para evitar scroll horizontal; audit MINMAX_PUBLISH con published_by+published_count+scope
// v2.2.66 — fix(minmax): columna Despacho — pill siempre visible (gris neutral para sin-regla, coloreado para reglas); equivalentes MIN/MAX más pequeños y tenues (text-[9px] amber-500/blue-500 sin bold); padding !px-2 en DataCell; minWidth 960→860px + className width en Clase/MIN/MAX/Despacho/Estado/Acciones para evitar scroll horizontal al expandir inline
// v2.2.65 — feat(minmax): columna "Equiv." → "Despacho" — muestra chip de regla de despacho (und×N, blist×N, caja×N, solo cajas) o presentación base (UNIDAD/FRASCO/BLISTER) cuando no hay regla; MIN/MAX desglosados en presentaciones disponibles usando formatUnits; get_stock_analysis v9 agrega dispatch_rules JOIN (4 nuevas cols: dispatch_solo_cajas/multiplo/blister/multiplo_unidades)
// v2.2.64 — fix(minmax): inversión proyectada visible aunque esté todo publicado; card muestra delta +/- vs publicado cuando hay borradores; alerta clase A con desglose "X sin stock · Y bajo mínimo"; botón filtra clase A completa (no solo sin stock)
// v2.2.63 — fix(minmax): elimina badge "POCOS DATOS" de filas isSparse — la leyenda naranja ya lo comunica
// v2.2.62 — fix(minmax): fecha últ. venta en alerta "Rotación mínima"; "--" solo cuando MIN=0 y MAX=0 simultáneamente (MIN=0/MAX=1 ya muestra los valores); falta de ABC explicada (producto sin revenue_6m no entra al ranking ABC, XYZ sí se calcula)
// v2.2.61 — fix(minmax): 6 ajustes de detalle — última venta muestra año (2-digit); alerta "rotación mínima" quita "· confirmar MIN/MAX"; "Inversión proyectada" persiste aunque no haya borradores (basado en costo min/max, no en product_count); historial filtra por sucursal (filter details->>sucursal_id); deadstock/sin-historial con min>0 ya muestran el valor editable (condición !minN / !maxN); AbcXyzBadge muestra "—" cuando abc/xyz es null (no badge vacío)
// v2.2.60 — fix(pedidos): ReferenceError: Can't find variable: X — ícono X (cerrar banner confirmado) no estaba importado de lucide-react en TabGenerar; la página quedaba blanca al renderizar el banner después de confirmar/imprimir
// v2.2.59 — Pedidos lifecycle v2: código de pedido xx-aabbcc-d-yy por sucursal; PDF separado por sucursal (printPerSucursal, 1 diálogo por sucursal escalonados 1s); botones Pausar (modal de razón: Almuerzo/Actividades/Interrupción/Otro) y Reanudar por sucursal; DB nuevas columnas codigo/pausado_at/pausa_razon/reanudado_at; RPCs init_pedido_sucursal_codigos y update_pedido_sucursal_lifecycle v2 (stages pausar/reanudar); badge código en header sucursal; nodo Pausado/Reanudado en timeline; canFinalizar bloquea si pausado; fix ReferenceError: catch {} → catch(err) {}
// v2.2.58 — Pedidos integral: Generar = confirmar final + imprimir vía iframe oculto (sin pestaña nueva, sin URL en el papel via @page margin:0) + banner éxito con reimprimir; botón secundario Vista previa y ajustes; PDF orden por laboratorio+producto, líneas horizontales por fila, más ancho a Producto, "Generado por" siempre; FIX employees.nombre→name (el select de responsable nunca cargaba — por eso el PDF salía sin responsable) y user_id→id en TabRecepcion (la recepción de sucursal no resolvía la sucursal del empleado); RecepcionModal unificado (ModalShell portal centrado) compartido por Historial+Recepción con tipo de error por diferencia (faltante/dañado/vencido/equivocado), productos no esperados (tabla pedido_recepcion_extras), múltiples responsables por escaneo de carné (tabla pedido_recepcion_firmas + RPC receive_pedido_sucursal p_responsables); TabHistorial: filter pill estándar (estados+fechas), chips de responsable/envió/anuló con foto, "Recibido por" con foto por sucursal, lupa expansible para buscar dentro del pedido (también en Recepción), modal anular via ModalShell
// v2.2.57 — TabReglas autoguardado: tipo "Sin regla" (5to tipo, elimina la regla al seleccionarlo); seleccionar cualquier tipo aplica al instante (múltiplos arrancan en ×2, el menor); pills de múltiplo autoguardan al clic; input libre y notas guardan en blur/Enter; indicador Guardando…/Guardado en header del panel; sin botones Guardar/Cancelar/Eliminar ni ConfirmModal; rulesMap se actualiza localmente vía ref (sin re-fetch de la tabla en cada clic)
// v2.2.56 — Pedidos QA post-v2.2.55: fix stale closure globalMode en handleCalcular (deps); PDF @page tamaño carta + márgenes 10mm + tr/sig-block page-break-inside:avoid + thead repetido; bloque firmas/sello siempre presente (antes desaparecía sin responsable); SQL solo_cajas matchea LIKE 'CAJA%' (CAJA X 24, etc.) en caja_factor_map y guard de presentación
// v2.2.55 — Pedidos mejoras integrales: A1 fix solo_cajas SQL enforcement + data-fix multiplo rules; B1 globalMode distribución toda bodega (p_target_ids RPC); B2 multiplo_unidades regla de despacho; B3 auto-print + reimprimir al confirmar; B4 badge no-enviados + laboratorio+necesidad en secciones sin_stock/revisión; A2 sin página en blanco final PDF; A3 meta responsable/revisor en PDF; A4 feedback guardar borrador; C PDF: compact, lab column, checkbox ✓, pill AB, firmas al final
// v2.2.54 — Pedidos FASE 6 UX: input recepción con max=cantidad_asignada (no excede asignado); guardar borrador preserva ajustes manuales (direct insert vs RPC que recalcula desde DB); aviso beforeunload al salir con ajustes sin guardar; lotes por fila en historial; conteos filter pill desde totalCounts; sin_stock en impresión con badge naranja
// v2.2.53 — Pedidos FASE 5: reporte de diferencias — RPC get_pedido_diferencias_stats (por sucursal/producto/detalle con fecha); tab Diferencias en PedidosView con stat cards, barras de diferencia y vista detalle con búsqueda
// v2.2.52 — Pedidos FASE 4: tab Recepción para empleados de sucursal — pedidos 'enviado' filtrados por sucursal del empleado; modal de recepción con cantidad por ítem + nota diferencia; notificación a bodega si hay diferencias; permiso pedidos_tab_recepcion en PermissionsView
// v2.2.51 — Pedidos FASE 1.1: corrección conversión de unidades en get_pedido_preview/stats/sin_bodega — inv_dedup normaliza inventory.cantidad a unidades reales (cantidad×factor_detalle); dedup defensivo incluye presentacion+detalle; ZAMEN 1.30pk, NEUROBION 6.00pk (sale de necesidad), DOLO NEUROTROPAS 2.56pk
// v2.2.50 — Pedidos FASE 3: trazabilidad completa — responsable/revisor en confirm; estado 'enviado' + RPC marcar_pedido_enviado; notificación movida a despacho; motivo en anular; received_by en recepción; nombres en impresión
// v2.2.49 — fix(MinMax): canExpand incluye is_catalog_only — productos Branch 4 ya se pueden desplegar para ver stock en red y compras
// v2.2.48 — fix(MinMax): arrow nav no pone 0 en productos catalog_only (Branch 4) — effective_min/max es 0 (no null) y is_dead_stock=false, el check anterior los dejaba pasar como valor '0'
// v2.2.47 — fix(DB): get_stock_analysis v8 — excluye productos inactivos (activo=false) de los 4 branches; 739 inactivos del catálogo ya no aparecen en MinMax
// v2.2.46 — MinMax: get_stock_analysis v8 — Branch 4 (catalog-only) restaura productos sin presencia en sucursal (3042 en La Popular); ocultos por defecto, visibles al buscar o filtrar "Sin historial"; fix Branch 3 NOT EXISTS auto-referencial; fix arrow nav no pone 0 en productos "—" al navegar con flechas
// v2.2.45 — fix(DB): get_stock_analysis v7 — Branch 3 (sin historial) vuelve a retornar dead_stock + is_dead_stock=true; v6 los había regresado a out_of_stock/false causando que no aparecieran en "Sin movimiento" ni fueran editables
// v2.2.44 — MinMax fix: celdas MIN/MAX siempre editables para canManage (eliminado gate hasPublishedData en último branch — sucursales no publicadas como La Popular quedaban todas en read-only)
// v2.2.43 — MinMax fix: canExpand incluye last_sale_date != null (antes solo stock > 0 — productos sin inventario pero con historial de ventas no se podían desplegar)
// v2.2.42 — MinMax fix: restaurar en productos sin calc_min nulifica effective_min/max en estado local y los mantiene en rama dead/noHistory (clickable) en vez de caer en rama read-only; alert_status se recalcula al instante al guardar MIN/MAX (saveDraftCell/saveDraftPair/resetToCalc) usando approaching_pct cargado de stock_config
// v2.2.41 — MinMax fix: botón Restaurar aparece para cualquier producto con borrador activo (antes solo para productos con calc_min o dead/noHistory — noHistory nunca era true porque el SQL no retorna alert_status=no_data)
// v2.2.40 — MinMax fix: flechas ↑↓ navegan producto a producto siempre (eliminado filtro hasDraft que saltaba filas sin borrador); valor vacío en flecha ya no cierra el editor, navega sin guardar
// v2.2.39 — MinMax: saveDraftPair (1 sola llamada DB para par MIN+MAX); pendingMin visual en celda MIN mientras se edita MAX (borde punteado); resetToCalc limpia a null para productos sin historial (restaura a —); guardia de valor vacío en blur/Enter/Tab (no guarda 0 al tocar — sin escribir); celdas dead/noHistory muestran — en vez de 0
// v2.2.38 — MinMax fix: Tab desde MIN no guarda MIN en DB hasta que el usuario finalice MAX; si la validación del par falla (ej. MIN=0/MAX=3) nada se guarda y el editor cierra limpio; al confirmar MAX se guardan ambos en el orden correcto para respetar constraints DB
// v2.2.37 — MinMax: last_sale_date integrado en get_stock_analysis v6 via CTE MATERIALIZED (elimina RPC separado get_last_sale_dates que fallaba para ~50% productos); índices idx_sii_erp_product_id + idx_si_branch_estado para acelerar ventas expandidas; texto última venta más visible (slate-700 font-semibold) y "sin venta" / "Últ. venta DD Mmm" en todos los productos incluidos dead/noHistory
// v2.2.36 — MinMax fix: get_last_sale_dates .range(0,9999) elimina cap 1000 filas PostgREST (fechas faltantes en productos >1000); validateEditForRow agrega checks MAX=0/MIN>0 y MIN>0/MAX=0 que antes pasaban silenciosamente
// v2.2.35 — MinMax: validación diferida MIN→MAX (Tab/ArrowRight no bloquea en transición; pendingMin propaga valor para validación final); get_last_sale_dates RPC + fecha última venta junto a "N vend." en fila principal; get_product_last_sales RPC + panel expandido con dos columnas Compras/Ventas
// v2.2.34 — Pedidos FASE 2: receive_pedido_sucursal guard (anulado/completado + solo items pendientes); anular_pedido registra anulado_por/at/motivo; confirm_pedido valida array no vacío/qty>=0/sucursal válida; RLS pedidos+pedido_items+dispatch_rules
// v2.2.33 — Pedidos FASE 1: inv_dedup DISTINCT ON (5585 grupos duplicados ERP corregidos); pending_committed descuenta bodega de pedidos activos; get_pedido_preview/stats/sin_bodega/count actualizados
// v2.2.32 — notify-new-products-daily: edge fn + cron lun-sáb 8am; RPC get_logistics_chief_ids con fallback a Administrador si vacaciones/incapacidad
// v2.2.31 — sync-erp-purchases: cron diario → cada 10 min (ayer+hoy); items upsert para todas las recepciones (no solo nuevas); productos ignoreDuplicates:false
// v2.2.30 — MinMax: tab vs ERP eliminada; get_stock_analysis Branch 4 — productos sin presencia en sucursal (is_catalog_only=true); ocultos por defecto, visibles al buscar o filtrar "Sin historial"; chip Sin historial restaurado en STAT_CFGS
// v2.2.29 — MinMax: tab vs ERP eliminada (TabMinMaxComparacion)
// v2.2.28 — TabReglas: tipo de regla único (solo_cajas/multiplo/blister) con radio visual; AnimatePresence + motion.div en panel edición; guardar limpia campos del tipo no activo; validación de múltiplo requerido antes de guardar
// v2.2.27 — TabReglas: fix 0 productos (created_at no existe en products_with_lab); DataRow+DataCell estándar; LiquidSelect labs con bare mode; stat cards estilo TabCatalogo; nuevos este mes startOfMonth; excluye labs ocultar_en_minmax igual que MinMax; filtro nuevo usa .in(newIds) server-side; TablePagination estándar
// v2.2.26 — TabReglas: rediseño completo — cards info izq + pill filtros der; columnas ordenables (lab/producto); click en fila abre panel edición inline; panel redesignado con toggle Solo Cajas prominente + pill-selectors; solo_cajas=true por defecto; badge "Nuevo" + filtro+contador para productos añadidos en los últimos 30 días
// v2.2.25 — Pedidos: distribución bodega en unidades de despacho (multiplo) desde el inicio; fase complemento redistribuye packs sobrantes a mayor necesidad insatisfecha; solo_cajas=true+CAJA preserva en Bodega; presentaciones UNIDAD/BLISTER siempre envían complemento para evitar stock muerto
// v2.2.24 — Pedidos: urgencia_pct ≥min→100 (crítico); loadMore aplica filtros fecha; StatCards desde DB (totalCounts); audit log ELIMINAR_BORRADOR_PEDIDO; TabReglas filtros server-side + paginación siempre; TabGenerar notifica sucursales al confirmar; drop get_pedido_sin_bodega_count
// v2.2.23 — MinMax: Ocultar/Ocultos integrados como chips al final de Row1 (sin fila separada); whileHover en pill glass + amber pill; Publicar con whileHover scale+y+shadow floating; dot de estado pulsa al activarse
// v2.2.22 — MinMax: rediseño completo zona filtros+borradores — 2 filas separadas: Row1 pill liquid glass (filtros estado + pocos datos); Row2 amber glass pill (borradores+toggles+descartar) + Publicar CTA elevado con sombra azul independiente; sin elementos cargados en una sola línea
// v2.2.21 — MinMax: Ocultar/Ocultos movidos al espacio entre matrix y pill de filtros; pill de filtros rediseñada igual que pill de sucursal (bg-white/80 border-slate-200/70 h-5 dividers); Publicar azul como cap derecho separado
// v2.2.20 — MinMax: pill de filtros unificada y glassmorphic — status chips, pocos datos, borradores y Publicar en una sola pill; chips más grandes (px-3 py-2 text-[11px]); colores activos por categoría (chipActive); sección draft entra animada desde la derecha cuando hay borradores; X badge animado con AnimatePresence
// v2.2.19 — fix(DB): get_stock_analysis Branch 3 ahora devuelve dead_stock+is_dead_stock=true — antes emitía out_of_stock/ok, por eso "Sin historial" siempre daba 0; ahora aparecen bajo "Sin movimiento"
// v2.2.18 — MinMax: DraftCostCard igualada en altura a CostCards (una sola línea de valores, gap-0.5, text-[14px]); "Sin historial" eliminado de STAT_CFGS (redundante con Sin movimiento); pills aún más compactas (px-2 py-1 text-[10px])
// v2.2.17 — MinMax: cálculo mensual automático (edge fn auto-calculate-minmax + pg_cron día 1 a las 3am); notificación push al Supervisor de Ventas con fallback a jefe inmediato; RPC discard_stock_drafts; botón "Descartar todo" con confirm modal; botón Trash2 por fila para descartar borrador individual
// v2.2.16 — MinMax: cards (Total retenido/Inventario útil/etc.) muestran skeleton al cambiar sucursal; pills de filtro más compactas (px-2.5 py-1.5); botón Ocultar rosa, botón Historial azul
// v2.2.15 — MinMax: filtros de estado unidos en una sola pill contenedor (rounded-2xl); "Pocos datos" movido dentro de la pill de estado; borradores+publicar en pill separada (solo visible cuando hay borradores); mensaje badge sparse mejorado (mayorista vs rotación mínima)
// v2.2.14 — MinMax: skeleton al cambiar sucursal (setData([]) antes de fetch); spinner en botón Ocultar mientras espera DB; historial audit_logs limpiado
// v2.2.13 — Sidebar: scroll automático al ítem activo al abrir submenú (espera 330ms a que termine la animación, luego scrollea la nav)
// v2.2.12 — MinMax: fix tab "Sin movimiento" mostraba 0 (alert_status era 'no_data' en vez de 'dead_stock' desde calc_columns); filtro "pocos datos" ahora es toggle independiente (filterSparse) — muestra solo sparse sin mezclar borradores
// v2.2.11 — MinMax: "Calcular todas" llama por sucursal en secuencia (muestra progreso "La Popular 1/7"); DB: work_mem 128MB elimina disk spill, data-modifying CTEs fusionan sparse+main en un solo scan, ranked filtra dias>=3
// v2.2.10 — MinMax: todos los mensajes usan LiquidToast — error de carga, calcular éxito/error, aviso bodega; eliminado banner inline de error
// v2.2.9  — MinMax: detección de productos con datos insuficientes (< 3 días de venta) — badge "POCOS DATOS", MIN/MAX con borde punteado naranja "⚠ Confirmar", guardado siempre como borrador; botón de filtro en barra; calculate_stock_params excluye estos del cálculo automático
// v2.2.8  — MinMax: fix timeout al cambiar sucursal — eliminado subquery d2 inutilizado en get_stock_analysis (escaneaba toda sales_invoice_items sin filtro); índice en erp_sucursal_map(branch_id); errores DB traducidos al español
// v2.2.7  — MinMax: labels con bajo contraste en glassmorphism corregidos — velocidad/día, separador ·, vend., laboratorio, N act. bajo MIN/MAX, ≈ cantidad bajo inputs; todos legibles
// v2.2.6  — MinMax: todo via LiquidToast (publicar, restaurar, errores); banner fijo de publicación eliminado; error DB muestra mensaje real en lugar de hardcoded
// v2.2.5  — MinMax: modal historial MIN/MAX por producto — foto producto + foto empleado + fecha/hora + campo + valor anterior→nuevo; audit log enriquecido (product, field_label, old_value, new_value)
// v2.2.4  — MinMax: avisos LiquidToast con nombre del producto; warn si valor guardado es 4× mayor/menor al calculado (warnIfOutrageous); errores de validación y DB via LiquidToast
// v2.2.3  — MinMax: fix raíz del toast invisible — backdrop-filter del body card creaba containing block para position:fixed; ahora el toast usa createPortal→document.body; skipBlurSave en todos los error paths; toast fallback en error DB
// v2.2.2  — MinMax: fix definitivo toast validación usando validateEditForRow(row) puro sin closure de data; botón Restaurar verde; skipBlurSave en path de error para evitar doble-fire
// v2.2.1  — MinMax: fix toast de validación (validateEdit síncrono en cada handler antes de navegar); backfill calc_min/calc_max en 17k filas; texto "act." más visible (slate-400)
// v2.2.0  — MinMax: validación MIN/MAX muestra LiquidToast con el error y revierte al valor anterior; botón Restaurar (RotateCcw) en acciones devuelve al valor originalmente calculado por Calcular (calc_min/calc_max en DB)
// v2.1.9  — MinMax: error de validación (MAX>MIN, regla 0/x) se muestra inline debajo del input en rojo; el input permanece abierto para corrección
// v2.1.8  — MinMax: permisos can_edit/can_approve/can_view; modo live post-publicación (edits van directo a min_units/max_units); filtro "Solo cambios" auto al recalcular con datos publicados; validación inline MAX>MIN y regla 0/x (MIN=0→MAX solo 0 o 1); tabla product_stock_params limpiada para inicio fresco
// v2.1.7  — Widget Ajuste Min/Max: aviso reformulado ("MIN y MAX se ingresan en unidades. 30 und = 1 CAJA" + "Factor calculado: 1x30"); se quita el equivalente bajo los inputs MIN/MAX; foto del producto y principio activo en el header del formulario y en los resultados de búsqueda
// v2.1.6  — Widget Ajuste Min/Max: deja claro que MIN/MAX son en UNIDADES (no presentaciones) — aviso con el factor de la presentación dominante (ej: 1 CAJA = 100 und (1x100)), labels "Nuevo MIN/MAX (und)", y equivalente en vivo bajo cada input y en "En uso ahora" (≈ N CAJA). Carga presentaciones de product_precios
// v2.1.5  — Reset de contraseña: al restablecer (EmployeeDetailView) ahora se muestra la contraseña temporal aleatoria que genera el edge function en un modal con botón de copiar ("no se volverá a mostrar"); antes solo salía un toast y la temporal quedaba invisible
// v2.1.4  — MinMax solicitudes: el empleado ve el estado de sus solicitudes de ajuste en "Mis Solicitudes" (EmployeeRequestsView lee minmax_change_requests propias; card MinMaxStatusCard con estado pendiente/aprobada/rechazada + respuesta del supervisor), bajo las pestañas Pendientes/Aprobadas/Rechazadas. Antes la confirmación solo llegaba por push
// v2.1.3  — MinMax solicitudes: ruteo de notificación al rol Supervisor/a de Ventas (RPC get_minmax_approver_ids), con fallback al jefe inmediato (rol padre) si está de vacaciones/incapacidad/permiso hoy. Rediseño visual de la pestaña Solicitudes: filter pill estándar (sucursal + Aprobar todas/filtradas), grid de cards glassmorphic multi-columna con foto del solicitante, ventas 6m, actual→propuesto, aprobar/rechazar con razón inline; historial filtrable por sucursal con estado
// v2.1.2  — MinMax solicitudes: widget muestra ventas últimos 6 meses de la sucursal (contexto para proponer); columna current_sales_6m guarda el snapshot; cola de aprobación (pestaña Solicitudes) con filtro por sucursal (chips con conteo) + ventas 6m en cada tarjeta
// v2.1.1  — MinMax widget: ahora aparece en Permisos (dash_minmax_req con scope) y respeta alcance — scope ALL muestra selector de sucursal ERP en el header (como Anulaciones), scope limitado fija la sucursal del empleado (mapeo branch_id→ERP por nombre). RLS de solicitudes gateada por dash_minmax_req (operación puede proponer sin acceso al módulo). Selector de sucursal interno del widget eliminado (viene del header)
// v2.1.0  — MinMax workflow de solicitudes de ajuste: tabla minmax_change_requests + RLS (can_edit propone / can_approve aprueba) + RPCs approve/reject_minmax_request (aplican override manual atómico); WidgetMinMaxRequest en Dashboard/Operación (busca producto, propone MIN/MAX, push a aprobadores); pestaña "Solicitudes" en MinMax (cola + historial, aprobar/rechazar con push al solicitante); PermissionsView minmax hasApprove:true. Integridad: CHECK max>=min en product_stock_params (manual/calc/draft) + guard en publish_stock_params + 1 draft corrupto saneado. Item 5 visual: border-l ámbar eliminado de EditDraftRow, transition-all→transition-colors en hovers de color, text-[7px]→[9px]
// v2.0.3  — Edge functions hardening: sync-products a secret ERP_PRODUCTS_CREDS + requireInvokeSecret; set-employee-password reset a contraseña temporal aleatoria; ensure_user_by_code búsqueda parametrizada; fix 401 heal-dte-sync/backfill (usaban service key en vez de ADMIN_INVOKE_SECRET → redes de seguridad caídas); paginación >1000 filas (dte/purchases/promo); helper Gemini compartido (sin listar modelos por request); check-doc-expiry UTC-6 real; sync-promo auto-cierre filtra por período; cookie ERP cacheada por invocación; UPDATE en lote en desactivación de presentaciones; heal sin re-sync por huecos (falsos positivos)
// v2.0.2  — sync-products v23: fix raíz — presentaciones upsert solo tipo (factor/descripcion eliminados); precios upsert directo sin carga masiva en memoria; paginación con .order('id'); laboratorio_id y product_precios ahora correctos para APITENA/NEUROBION ADVANCE/FARSENTAL/IMATION
// v2.0.1  — PromoModal: deduplicar presentaciones por tipo+descripción (no por id); mantener pasos montados (fecha y producto en progreso no se pierden al navegar); header gradiente azul-violeta, body blanco sólido; selector presentación con factor (CAJA · 1X10); búsqueda productos server-side (sin cap 1000); pills filtro alineadas a derecha en los 3 tabs de Promociones
// v2.0.0  — Módulo Promociones: 6 tablas DB (promotions, branches, products, bonifications, payments, sales_cache); PromocionesView 3 tabs (Activas/Bonificaciones/Historial); edge function sync-promo-sales + cron 4:30am; MinMax excluye ventas de períodos en promo (calculate_stock_params actualizado)
// v1.8.1  — Compras: aviso global + filtro "Sin proveedor" + ícono ⚠ en filas sin supplier_id; edge function v11 fallback por nombre
// v1.8.0  — Módulo Compras: vista dedicada /compras con tab Facturas (expandible por ítems) y tab Productos (product_purchase_summary); filtros por fecha y proveedor
// v1.7.0  — MinMax: panel expandido muestra "Últimas compras (Bodega)" — fecha, cantidad, precio, proveedor, lote
// v1.6.9  — MinMax: denominador dinámico para productos nuevos (days_since_first_purchase vs analysis_days fijo); badge "Xd DATOS"; tabla suppliers + vista product_purchase_summary; cron sync-purchases-daily
// v1.6.8  — Nueva edge function sync-erp-purchases + tablas purchase_receipts/items/sync_log (compras ERP con discover mode)
// v1.6.7  — MinMax: Bodega draft = trigger DB en tiempo real (Σ efectivos de sucursales al editar draft); publish_stock_params sin auto-update Bodega
// v1.6.6  — MinMax: fix banner Bodega (edición sí permitida); backfill draft Bodega existente; toast al editar MIN/MAX en Bodega
// v1.6.5  — MinMax: Bodega borrador auto-actualiza al publicar sucursal (draft_min/max = Σ, draft_status pending); banner violet explicativo; toast al editar celda en Bodega
// v1.6.4  — MinMax: Bodega Opción A — al publicar sucursal, Bodega MIN/MAX = Σ min/max publicados de todas las sucursales (automático, sin paso extra)
// v1.6.3  — MinMax: winsorización P95 de outliers de demanda (configurable en stock_config.outlier_percentile)
// v1.6.2  — MinMax: panel Labs glassmorphic con toggle ocultar_en_minmax, buscador, limpieza is_hidden al desocultar lab
// v1.6.1  — MinMax: filtro "Ocultos" → ver y mostrar ocultos individualmente o en lote ("Mostrar todos")
// v1.6.0  — MinMax: Labs panel — ocultar_en_minmax en laboratorios; productos de labs ocultos no se contabilizan como ocultos individuales
// v1.5.9  — MinMax: ocultar por laboratorio — SARITA/CONSTANCIA/BEBIDAS/RECARGAS/NEVERIA excluidos por defecto
// v1.5.8  — MinMax: errores de calcular/publicar → toast rojo en español; timeout → mensaje claro sugiere recalcular por sucursal
// v1.5.7  — MinMax: todos los productos activos visibles (no_data UNION ALL en get_stock_analysis); MIN/MAX editable para dead-stock y sin-historial; warning ⚠ 6m
// v1.5.6  — MinMax: ocultar usa upsert — dead-stock products (sin fila en product_stock_params) ahora persisten ocultos tras reload
// v1.5.5  — MinMax: get_draft_cost_estimate excluye is_hidden=true — conteo y costos ahora correctos sin ocultos
// v1.5.4  — MinMax: botón "Ocultar filtrados (N)" — oculta en lote todos los productos visibles con el filtro activo
// v1.5.3  — MinMax: ocultar → is_hidden en DB (compartido), draft 0/0, excluido de recálculos; card "Inversión borrador"
// v1.5.2  — MinMax: búsqueda por laboratorio (además de nombre de producto)
// v1.5.1  — MinMax: card "Objetivo borrador" — costo estimado MIN→MAX del inventario calculado (RPC get_draft_cost_estimate)
// v1.5.0  — MinMax: onFocus select() en celdas MIN/MAX — al entrar se selecciona el valor para reemplazarlo de inmediato
// v1.4.99 — MinMax: Enter/↓ en celda MIN o MAX guarda y salta al siguiente producto; ↑ salta al anterior; Tab/→ sigue abriendo MAX del mismo producto
// v1.4.98 — MinMax vs ERP: agrega Bodega (ID 6) al selector de sucursal — faltaba en ERP_NAMES/ERP_ORDER
// v1.4.97 — MinMax vs ERP: chunked fetch (range 1000) — PostgREST cap silencioso cortaba a 1000 filas (sucursales tienen 1500–2000+ productos)
// v1.4.96 — MinMax vs ERP: rediseño visual — selector sucursal a la derecha, pill estándar izq (Borrador/Publicado + filtros); sucursal con ERP_NAMES hardcoded (no useAuth)
// v1.4.95 — MinMax vs ERP: fix TypeError — TablePagination recibía totalRows/onPage/onPageSize en vez de total/onPageChange/onPageSizeChange
// v1.4.94 — MinMax vs ERP: fix TypeError (columns/sortKey/empty props incorrectos en DataTable) + DeltaCell defensivo
// v1.4.93 — MinMax: tab "vs ERP" — compara borrador/publicado contra MIN/MAX del ERP por sucursal
// v1.4.92 — MinMax CSV: quita columna XYZ separada (Clase ya muestra AX/BY/CZ)
// v1.4.91 — MinMax CSV: quita Estado/Stock/Cobertura/Pedir/Ingresos; agrega Laboratorio y Clase completa (ABC+XYZ)
// v1.4.90 — get_product_sales_agg: mes parcial de inicio desde invoice_items (no monthly_agg) → cantidad exacta al día igual que MinMax
// v1.4.89 — PeriodPicker: "Últimos 6 meses" = hoy−180 días (rolling, igual que MinMax) en vez de inicio de mes calendario
// v1.4.88 — fix: GlassViewLayout overflow-x-hidden — scroll horizontal ya no mueve el body bajo el menú
// v1.4.87 — MinMax: formatDominant CEIL (floor→ceil) + símbolo ≥ — cajas indivisibles, cantidad cubre el umbral en unidades
// v1.4.86 — MinMax: Equiv. siempre visible — cajas/blisters en amber/blue, sin presentación en slate-400 "N und", dead=—
// v1.4.85 — MinMax: MIN/MAX muestran número puro; columna Equiv. con formatDominant (amber=MIN, blue=MAX); "—" si sin presentaciones
// v1.4.84 — MinMax: fix TDZ 2 — draftCount movido antes de requestPublish (segunda referencia circular en dep arrays)
// v1.4.83 — MinMax: fix TDZ — handlePublish declarado antes de startDeferredPublish (dep array evaluado en cada render)
// v1.4.82 — MinMax: quita Cobertura+Stock columnas; stock inline bajo nombre; MIN/MAX botón-pill clickeable (amber/blue); input w-20 + Tab→MAX, ArrowLeft→MIN; XCircle tooltip; quita "und" subtítulos
// v1.4.81 — MinMax: CostCards sin hero-metric (14px vs 20px); blur 20px→4px en matriz; Publicar con ConfirmModal + toast cancelable 5s
// v1.4.80 — MinMax: hiddenIds → Supabase user_metadata (cross-device); fix DataTable key (no remount on filter); collapse expanded row al editar MIN/MAX
// v1.4.79 — MinMax: hiddenIds persiste en localStorage por sucursal (minmax_hidden_{erp})
// v1.4.78 — MinMax: animaciones fluidas — easeOutExpo, presets chipAnim/ctaAnim/iconAnim/fadeUp, sin spring en hover
// v1.4.77 — MinMax: spring hover/tap en chips+pills+controles+acciones; glass inactivo backdrop-blur; active glass tinted
// v1.4.76 — MinMax: quita fila D de matriz ABC×XYZ (nunca tiene datos)
// v1.4.75 — MinMax: sort default laboratorio, ocultar productos, XCircle visible, matriz compacta, motion chips+tabla
// v1.4.74 — MinMax: columna Clase ordenable (AX→DZ, usa draft si existe)
// v1.4.73 — MinMax: columna Laboratorio ordenable (sortable + localeCompare 'es')
// v1.4.72 — MinMax: draft pill = glass idéntico a pill controles, publicar azul #0052CC, motion enter/exit + AnimatePresence
// v1.4.71 — MinMax: borradores/publicar en pill contenedor (sección blanca + cap ámbar), push right con ml-auto
// v1.4.70 — MinMax: borradores/publicar como pills junto a chips de estado; matriz más compacta; "Todas las sucursales"
// v1.4.69 — MinMax: fix TDZ — filteredDraftIds/filterLabel movidos debajo de filtered (ReferenceError antes de inicialización)
// v1.4.68 — MinMax: MIN floor — si MAX>1, MIN mínimo 1; solo (0,1) válido con MIN=0 (calculate_stock_params actualizado en DB)
// v1.4.67 — MinMax: publicar filtrados — botón "Publicar Clase A (N)" / "Publicar filtrados (N)" en banner cuando hay filtro activo con borradores
// v1.4.66 — MinMax auditoría: formatDominant CEIL→FLOOR+~, EditRow border-l eliminado, validación MIN+MAX obligatorio par, calculate_stock_params usa erp_sucursal_map
// v1.4.65 — MinMax tabla: ventas bajo nombre (no columna separada), columna Laboratorio, Stock actual = Faltan/Exceso en texto (sin barra), DB get_stock_analysis v3 + laboratorio_nombre
// v1.4.64 — MinMax tabla: foto producto, columna Ventas (und/día + vend 6m + tendencia), StockBar en Stock, columna Acciones separada, quita border-l color, employee photo en banners/toast
// v1.4.63 — MinMax: botón XCircle pone draft MIN/MAX en 0; matriz activa usa outline (no intersección con vecinos); quita Edit3
// v1.4.62 — MinMax: MIN/MAX borrador muestran presentación dominante + und (igual que publicados); input muestra hint ≈ cajas mientras se escribe
// v1.4.61 — MinMax: pill Calcular como sibling (visual fix), Toda la red, Publicar inline con badge, matrix glassmorphism+hover z-index, cards se actualizan al editar draft
// v1.4.60 — MinMax: 6 fixes — toast para calcResult, edición inline MIN/MAX borrador, matrix/filtro usan draft, badges solo draft, get_inventory_cost_summary draft fallback
// v1.4.59 — MinMax: cards glassmorphic grandes, pill unificada (branch+CSV+cfg+todas+recalcular), sin leyenda ni ABC/XYZ duplicados en pill
// v1.4.58 — MinMax: redesign visual — cards compactas izq, pill filtro der, chips alertas sobre tabla, skeleton matriz, botones min-w+active:scale, sin AZ ni Ciclo
// v1.4.57 — MinMax: edición de borrador inline (EditDraftRow) — editar draft_min/draft_max antes de publicar, muestra valor en uso como referencia
// v1.4.56 — MinMax: CSV+sucursal, banner config→recalc, alerta clase A críticos, filtro AZ, proyección 30/60/90d, acciones dead stock, traslados en Red, orden defecto visible, pg_cron 3am diario
// v1.4.55 — MinMax: workflow Borrador/Publicar — calcular genera borradores; diff live→draft en tabla; Publicar por fila o todo; get_stock_analysis VOLATILE; TabMinMaxNetwork chunked fetch; fix indexOf O(n²)
// v1.4.54 — MinMax: fix MAX > MIN siempre — MAX = GREATEST(CEIL(v×cycle), MIN+1, 1); 0 casos inválidos en 17k registros
// v1.4.53 — MinMax: fix pisos MIN/MAX — slow movers usan FLOOR+0 y MAX≥1 (no más MAX=2 para ventas esporádicas)
// v1.4.52 — MinMax: fix 1000-row cap en get_stock_analysis (chunked fetch hasta agotar resultados)
// v1.4.51 — MinMax: umbrales XYZ corregidos (X≤150, Y≤400) + recálculo completo red; fix La Popular sin AX/AY
// v1.4.50 — MinMax: DataTable estándar + TablePagination (25/50/100) + filter pill (Ventas standard) en Sucursal y Red
// v1.4.49 — MinMax: tab Red (TabMinMaxNetwork), ExpandedPanel → Pedir+Traslado+Vencimientos+Historial, EditRow → lead_time_days por producto
// v1.4.48 — MinMax: corrige todo — approaching_pct configurable, velocity_30d + tendencia, sort columnas, Pedir, audit log, buffer days config, fmtMoney, keys React, lastCalcAt, CSV Pedir, branch cards números base
// v1.4.47 — MinMax: ExpandedPanel → vista consolidada multi-sucursal (7 cards con stock/MIN/MAX/StockBar + totales red)
// v1.4.46 — MinMax: Bodega con MIN/MAX real (demanda consolidada todas sucursales); botón Recalcular todas; quita bloqueo Bodega
// v1.4.45 — VentasPerdidas: foto del empleado en lugar de ícono User; fallback a inicial si no tiene foto
// v1.4.44 — VentasPerdidas: fix tabs (key en TABS); WidgetInventorySearch: botón Reportar inline junto a badge ACTIVO
// v1.4.43 — Ventas Perdidas: botón reportar en cada card SRS (con nombre/lab/principio); vista rediseñada, tabs sin traba
// v1.4.42 — PermissionsView: agregar módulo ventas_perdidas al grupo Inventario
// v1.4.41 — Ventas Perdidas: módulo + badge realtime + botón reportar en widget (sin stock → cantidad → BD)
// v1.4.40 — WidgetInventorySearch: sin stock → auto SRS + alternativas en inventario por principio activo
// v1.4.39 — WidgetInventorySearch: total sucursal más visible (coloreado, 12px); búsqueda por principio activo
// v1.4.38 — Fix definitivo factor: presentaciones solo guarda tipo; factor/descripcion siempre desde product_precios
// v1.4.37 — Ventas/Productos: cantidad en unidades base (cantidad×factor ERP); RPC incluye factor por presentación
// v1.4.36 — MinMax: clasificación ABC×XYZ, ciclo uniforme 45 días, panel de configuración (stock_config), CoverageBar, matriz filtrable
// v1.4.35 — AuthContext: Realtime subscription a role_permissions → menú y PermissionGuard reactivos al instante
// v1.4.34 — MinMaxView: módulo independiente en menú Inventario (/minmax); removido de ProductosView tabs
// v1.4.33 — WidgetInventorySearch: overscroll-contain (no body scroll bleed); glass card separation (shadow+border, no colored left border)
// v1.4.32 — WidgetInventorySearch: left accent border per product (branch color), space-y-2, input bg-white/80 (glass container visible)
// v1.4.31 — WidgetInventorySearch: Lightbox via createPortal → ya no queda cortada por transform del widget padre
// v1.4.30 — WidgetInventorySearch: glassmorphism consistente en cards de productos (single-lot y multi-lot, lista y drill-down)
// v1.4.29 — WidgetAnnulmentRequest: anulación siempre permitida (warning si fuera de gracia); ojo muestra productos; botón rojo si vencida
// v1.4.28 — WidgetAnnulmentRequest: cliente primary, correlativo+ID secondary, botón anulación directo en fila, back correcto
// v1.4.27 — WidgetAnnulmentRequest: fix sucursal_id→branch_id (columna correcta en sales_invoices)
// v1.4.26 — WidgetAnnulmentRequest: pill sucursal en header WidgetCard; fix tipo_dte→tipo_documento; cliente+tipo_pago; popup detalle; búsqueda por cliente/fecha/monto
// v1.4.25 — WidgetAnnulmentRequest: LiquidSelect de sucursal cuando scope=ALL; supervisor de sucursal seleccionada
// v1.4.24 — DashboardView: restaurar WidgetCard en los 3 widgets de Operación; quitar KPI row
// v1.4.23 — DashboardView: quitar fila de 4 KPI cards de la pestaña Operación
// v1.4.22 — DashboardView: commit pendiente — Operación tab sin WidgetCard (glass pane directo en los 3 widgets)
// v1.4.21 — WidgetInventorySearch: click producto→drill-down todas sucursales, foto miniatura + lightbox; Operación tab sin WidgetCard (glass pane)
// v1.4.20 — WidgetInventorySearch: rediseño branch-first, glassmorphism, stagger, multi-lote; fix layout merge BD→operacion
// v1.4.19 — Dashboard: pestaña Operación con widgets Inventario, Anulaciones y SRS+Inventario
// v1.4.18 — EmployeeDetailView: historial conectado a employee_timeline view (real-time, todos los eventos)
// v1.4.17 — VIEW employee_timeline: UNION ALL de hire/events/audit_logs(movimientos)/rosters publicados
// v1.4.16 — Drop system_roles+product_costs; employee_history→audit_logs; costo en product_precios_history + PRICE_FIELDS
// v1.4.15 — Bug4: align timeClock.audit.js AUDIT_SEVERITY enum with auditSlice (WARN→WARNING, ERROR→WARNING, SECURITY→CRITICAL)
// v1.4.14 — Bug fixes: Sunday key 0→7 (disability/vacation/recall), SHIFT_CHANGE UTC→local, handleSaveCell stale closure, kiosk cross-branch coverage via get_kiosk_coverage_employees
// v1.4.13 — Cross-branch coverage: schedule_coverage table, CoverageEmployeeRow, Apoyo badge, InlineDayEditor coverageMeta
// v1.4.12 — ScheduleCalendar: overflow-anchor none on scroll container (eliminates scroll jump on popup open)
// v1.4.11 — InlineDayEditor: deduplicate shifts by name+start+end (same key as TabShifts catalog)
// v1.4.10 — LiquidSelect: explicit exit objects + null child; InlineDayEditor: body-card glass config; TimePicker12: wider selects + more padding
// v1.4.9 — LiquidSelect: AnimatePresence close animation (Framer Motion); InlineDayEditor: glassmorphic bg-white/28 + motion.div enter/exit
// v1.4.8 — chart: expand btn inline (no overlap); LiquidSelect: close animation; InlineDayEditor: glassmorphic + scale/fade enter+exit
// v1.4.7 — chart: Muerta color #64748b, labels X dentro de barra, py-2 min-h-[80px]
// v1.4.6 — chart min-h 90px, labels X 8px/black/slate-500; GlassViewLayout body flex-1 (no empty space)
// v1.4.5 — Horarios: barras más gruesas (gap-[3px]), min-h-[120px], labels abajo, botón expandir
// v1.4.4 — Horarios: chart compacto h-full sin min-h, se adapta al alto del pill (flex-1 bars)
// v1.4.3 — Horarios: chart izq + pill der misma altura, fondo chart = pill glass, leyenda al header
// v1.4.2 — Horarios: chart de barras restaurado, pill de filtros propia arriba del chart
// v1.4.1 — Horarios: heatmap chart (días/horas) con controles integrados en un solo card glassmorphic
// v1.4.0 — Horarios: chart shorter + glassmorphic, publish btn solid blue, week text contrast, Personal header height fix
// v1.3.9 — Horarios: chart left + pill (with publish) right inside body; weekIsPublished some() fix
// v1.3.8 — Horarios: chart full-width above body (subContent), filter pill inside body right-aligned
// v1.3.6 — Horarios: glassmorphic filter pill + chart moved to subContent (between header/body)
// v1.3.5 — Horarios: calendar controls wrapped in Ventas filter pill standard
// v1.3.4 — Fix JSX fragment/div mismatch in AppLayout sidebar footer (build error)
// v1.3.3 — Version label in sidebar menu; controls pill moved to body (below header)
// v1.3.2 — Fix TDZ error (validBranches before initialization) in SchedulesView
// v1.3.1 — Controls pill back in header, employee cards 20% narrower, glassmorphic photo bg
// v1.3.0 — Horarios redesign: ViewTabBar tabs+search, remove SALY, improved Feriados panel
// v1.2.x — LiquidSelect ghost-sizer fix (size stability on open), iOS Safari scroll fixes
// v1.1.x — AppLayout flicker fix, mobile unrestricted access, DTE sync v15 fixes
// v1.0.0 — Initial production release
