#!/usr/bin/env node
// Gate mecánico de estandarización visual (DESIGN.md §9.0, §6).
//
// Corre seis familias de chequeo sobre src/:
//   1. Elementos nativos del navegador prohibidos (alert/confirm/prompt,
//      <select> crudo, <input type=date|time|datetime-local|month|week>).
//   2. Clases Tailwind de color crudo (paletas gris slate/gray/zinc/neutral/
//      stone en cualquier prefijo, + hex de 3-8 dígitos en className/style)
//      que deberían ser un token semántico (text-content-*, bg-surface-*,
//      border-divider, etc. — ver DESIGN.md §3/§6).
//   3. Buscadores toggleables (un `useState(false)` cuyo nombre contiene
//      "search") sin el hook `useSearchToggle` — contrato obligatorio de
//      DESIGN.md §24 (foco al abrir, Escape cierra+limpia, click afuera
//      cierra solo si está vacío). Nació 2026-07-26 después de que una
//      migración manual (grep por placeholder="Buscar...", 1 sesión) se
//      saltó 12 de 22 archivos reales — la detección por nombre de variable
//      generaliza mejor que grepear texto de placeholder, pero es una
//      heurística de nombre, no un parser: un toggle sin la palabra "search"
//      en su nombre no lo detecta. Si aparece uno así, agregarlo a mano a
//      EXCEPTIONS con la categoría 'search-toggle' documentando por qué NO
//      necesita el hook (ej. AppLayout.jsx: es el modal ⌘K, ya tiene su
//      propio Escape/click-afuera vía el patrón de modal).
//   4. `<input>`/`<textarea>` de texto (excluye checkbox/radio/range/color/
//      file) con font-size computado < 16px — dispara zoom automático al
//      enfocar en iOS Safari (DESIGN.md §25, ~170 inputs arreglados en
//      2026-07-10; sin gate, volvió a driftar a 11 instancias reales para
//      2026-07-26). Excluye utilidades bajo `placeholder:` (solo afectan
//      al placeholder, no al valor tipeado, no dispara el zoom).
//   5. `active:scale-90`/`active:scale-95` — mínimo permitido
//      `active:scale-[0.97]` (DESIGN.md §31 Anti-Patterns).
//   6. `border-l-{2,4,8}` sin `border-r` en la misma línea — indicador de
//      color de borde izquierdo decorativo en filas/cards/listas, prohibido
//      (DESIGN.md §31). El `border-r` emparejado es la señal de que en
//      realidad es un spinner (anillo parcial vía `animate-spin`), no un
//      indicador — no se penaliza esa forma.
//
// Uso: `npm run gate:design` — exit code 1 si hay hallazgos sin excepción.
// Las excepciones viven en EXCEPTIONS más abajo (archivo → motivo), tal
// como quedaron confirmadas archivo-por-archivo en DESIGN.md §6 y
// docs/planes-cerrados/AUDITORIA-TEMA-2026-07.md. Si un archivo nuevo necesita una excepción,
// agregarla aquí Y documentar el motivo en DESIGN.md — nunca solo aquí.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { blanquearComentarios } from './lib/blanquearComentarios.mjs';

const ROOTS = ['src'];

// Los canónicos, leídos de la carpeta y no de una lista a mano. Todo lo que
// vive en `components/common/` es un componente compartido, así que su nombre
// de archivo ES su nombre de componente. Ver la nota en la categoría `import`.
const CANONICOS_COMMON = existsSync('src/components/common')
  ? readdirSync('src/components/common')
      .filter(f => f.endsWith('.jsx'))
      .map(f => f.replace(/\.jsx$/, ''))
  : [];
// Prosa (changelog), no UI real — el gate no debe leer nombres de clases
// mencionados en comentarios históricos como si fueran código vivo.
const EXCLUDE_FILES = new Set(['src/version.js']);

// ── Excepciones documentadas (DESIGN.md §6 "Excepciones documentadas" +
//    §14 componentes que SON el propio canónico) ──────────────────────────
// Formato: 'ruta/relativa.jsx': ['categoria1', 'categoria2', ...]
// Categorías: 'color' (paletas gris/hex crudo permitido en TODO el archivo),
//             'native' (alert/confirm/prompt/select/date permitido),
//             'search-toggle' (toggle con "search" en el nombre que NO es
//             un buscador con input — no necesita useSearchToggle),
//             'small-input' (input/textarea bajo 16px permitido en TODO el
//             archivo — reservado para casos bespoke ya revisados, ninguno
//             hoy), 'scale-tap' (active:scale-90/95 permitido — ninguno
//             hoy), 'left-border' (border-l decorativo permitido — ninguno
//             hoy), 'capa-flotante' (el portal anclado del archivo es un
//             TOOLTIP: sigue al puntero y no se navega, así que apagarle el
//             hover del fondo sería pelearse consigo mismo).
// ── F6 (PLAN-IDENTIDAD-2026-07-29): `color` YA NO ARRASTRA A NADIE ─────────
// Hasta la v2.382.2 las categorías `white`, `hex` e `inline-color` compartían
// compuerta con `color`: excepcionar un archivo para `color` apagaba las otras
// tres sin que nadie lo decidiera. Escondía **389 hallazgos en 30 archivos**, y
// el ratchet no podía verlos porque nunca los contó.
//
// Al separarlas, 13 vistas ordinarias resultaron tener deuda real —aros de
// avatar `border-white` que en tema oscuro dibujan un halo, divisores
// `border-black/[0.04]` invisibles sobre fondo oscuro, y un panel de log
// `bg-black/50` con texto `--success-text`, que en los dos temas claros es
// verde OSCURO sobre negro—. Todo eso está arreglado, no excepcionado.
//
// Lo que queda excepcionado abajo son las superficies bespoke que DESIGN.md §6
// ya documenta (sidebar siempre-oscuro, kiosco, splash, canvas, mapas, HTML de
// impresión), ahora **con cada categoría escrita**. La diferencia importa: que
// una superficie sea de color fijo explica su `text-white`; NO explica un hex
// suelto. Un `hex` nuevo en LoginView hoy sigue pasando, pero uno nuevo en
// cualquier vista normal falla — que es lo que antes no ocurría.
const EXCEPTIONS = {
    // ── El papel de un documento legal no tiene tema ────────────────────────
    // `src/generated/formularioDatos.js` es el formulario de solicitud de datos
    // convertido a una cadena para la ventana de impresión. Sus hex son los del
    // DOCUMENTO —el mismo membrete que el aviso de privacidad y el reglamento de
    // puntos— y no tokens del portal: el papel se imprime en negro sobre blanco
    // y no cambia con el tema de nadie. Además el archivo es GENERADO desde
    // `docs/legal/formulario-solicitud-datos.html`, así que un token acá se
    // perdería en la próxima corrida de `npm run legal:js`.
    'src/generated/formularioDatos.js': ['hex'],

  // El lector de código de barras: `white` y `shadow-literal` sobre la vista de
  // la CÁMARA, que es el único rectángulo del portal que no tiene tema.
  //
  //   · `bg-black` es el fondo del `<video>`. La imagen viene de la cámara y no
  //     del tema, y lo que rodea al cuadro cuando la relación de aspecto no
  //     coincide tiene que ser negro — cualquier token lo pintaría de un color
  //     que se ve como un error de encuadre.
  //   · `border-white/80` es la guía de encuadre. Tiene que contrastar contra
  //     LO QUE SEA que esté mirando la cámara —una caja blanca, una repisa
  //     oscura, un estante a contraluz—, no contra el fondo de la aplicación.
  //     Un token de borde se pierde sobre la mitad de los estantes.
  //   · La sombra `0 0 0 9999px` no es una sombra: es el truco de anillo que
  //     oscurece todo lo que queda FUERA de la guía. No está en la escala
  //     `--shadow-*` porque no pertenece a ella — no describe elevación.
  //     La alternativa son cuatro divs posicionados para el mismo píxel.
  //
  // Documentado en DESIGN.md §6 junto al resto de las excepciones de color.
  'src/components/common/LectorDeCodigo.jsx': ['white', 'shadow-literal'],

  // ── Las tres fotos que NO llevan aro, y por qué ──────────────────────────
  //
  // `LiquidSelect` es la primitiva del desplegable: su `opt.avatar` es una URL
  // cualquiera y la opción puede ser una persona, una sucursal o un
  // laboratorio. Un aro ahí prometería un estado que el componente no puede
  // conocer — no recibe una ficha, recibe una imagen.

  // La foto del formulario de empleado muestra `photoPreview`, que es el
  // archivo que la persona ACABA de elegir y todavía no se guardó: un blob
  // local. `LiquidAvatar` reescribe la URL al endpoint de render para pedirla
  // en WEBP, y sobre un blob eso da una imagen rota. Además el aro sobra donde
  // se está editando a esa misma persona.
  'src/components/forms/EmployeeFormModal.jsx': ['foto-sin-aro'],

  // La encuesta ya usa el ARO para decir otra cosa: `isJefe` pinta un
  // `ring-warning` alrededor de la cara para marcar a quien jefea. Dos aros
  // concéntricos con dos significados distintos no se pueden leer — uno diría
  // «es jefe» y el otro «está de vacaciones», y quien mire vería un color.
  // Además sus filas llegan con nombre y foto y sin id, que en una encuesta es
  // deliberado.

  // El kiosco dimensiona su foto con CUATRO consultas de medio —dos de ellas
  // por ALTO de pantalla— y `AvatarConEstado` necesita un `px` en número para
  // decidir su escalera. No hay un número: hay 144, 176, 128 y 96 según el
  // monitor. Y el aro no aportaría: la pantalla aparece justo después de que
  // esa persona marcó, así que su presencia es el hecho que se está mostrando.
  // «No le debemos nada a nadie en este período» es un VACÍO FELIZ (§26.3), no
  // una lista vacía. La prueba de §26.3: ¿quien abre Cuentas por Pagar quería
  // encontrar algo, o quería que estuviera vacío? Quería que estuviera vacío —
  // y `Sin cuentas por pagar` diría lo mismo tirando la buena noticia al piso.
  // El arranque `No ` lo caza el detector ensanchado el 2026-08-26; acá el
  // patrón se confunde y el texto está bien, que es exactamente el uso sin
  // culpa de EXCEPTIONS que documenta §26.9.
  'src/views/purchases/CuentasPorPagarView.jsx': ['copy-vacio'],
  // Acá es donde los cuatro retirados se DEFINEN como alias — es la solución,
  // no la deuda. Y los canónicos los siguen aceptando a propósito para que las
  // 343 referencias vivas no se rompan mientras migran.
  // Badge/Button/Switch NO están acá: ya tenían entrada más abajo (por 'white'
  // y 'hex') y repetir la clave habría borrado una de las dos. Llevan
  // 'chart-retirado' en aquella. Ver `assertSinClavesDuplicadas`.
  'src/index.css': ['chart-retirado'],
  // `hex`/`inline-color` en CarrilCards NO son color: son las paradas alfa de la
  // máscara que desvanece la tarjeta cortada del borde del carril. `mask-image`
  // solo lee el canal alfa del gradiente —el matiz es irrelevante, `#000` es
  // "opaco" y `transparent` es "invisible"— así que no hay ningún color que
  // pueda salir de un token ni que cambie con el tema. Un token para esto sería
  // un token que no significa nada.
  // `carril-pildora` en su propio archivo es el EJEMPLO DE USO del JSDoc, no un
  // layout: el bloque `── Uso ──` muestra `<CarrilCards><StatCard/></CarrilCards>`
  // dentro de un comentario. Ahí no hay contenedor que pueda llevar `lg:flex-row`
  // porque no hay vista, hay documentación.
  'src/components/common/CarrilCards.jsx': ['hex', 'inline-color', 'carril-pildora'],
  // El `#ffffff` de `EditorDeDocumento` es el relleno del CANVAS que exporta el
  // JPEG del documento, no una superficie de la interfaz: el papel de un
  // documento que se guarda por un año y se imprime para un inspector es
  // blanco, y seguiría siendo blanco con el portal en tema oscuro. Es el mismo
  // criterio que la regla del ticket —«el papel no tiene tema»—, y un token
  // acá haría que el archivo exportado cambiara de color según cómo tenga
  // configurada la pantalla quien lo subió.
  // (Se llamaba `bitacoras/EditorDeReceta.jsx` hasta el 2026-08-20, cuando la
  // salida de dinero necesitó el mismo editor y pasó a `common/`.)
  // (El relleno se mudó a `utils/componerDocumento.js` el 2026-08-29, cuando
  // el camino automático y el editor pasaron a compartir la misma tubería: el
  // motivo es el mismo y ahora vive donde está el píxel.)
  'src/components/common/EditorDeDocumento.jsx': ['hex'],
  'src/utils/componerDocumento.js': ['hex'],
  // `carril-pildora` en ClientesView es la EXCEPCIÓN MEDIDA, no deuda — y estaba
  // contando como ratchet, que es al revés de lo que hay que decir. El motivo
  // está escrito en la propia vista: a 1440px el área de contenido son ~1110px,
  // su píldora mide 975 (tres ranuras y tres chips) y cinco tarjetas necesitan
  // 772 como mínimo. Juntas no entran, y el que cedía era el carril: quedaba en
  // CERO tarjetas visibles, o sea el «una sola cortada parece un error de
  // maquetación» que §17.0 existe para evitar. En dos filas entran las dos
  // enteras. Dejarla en el ratchet decía «esto hay que bajarlo» de un layout que
  // NO hay que bajar — y es justo esta excepción la que otra vista copió sin el
  // motivo, que fue lo que hizo nacer la categoría.
  'src/views/ClientesView.jsx': ['carril-pildora'],
  // Las otras dos excepciones MEDIDAS del carril, y las dos con su número
  // escrito al lado del layout desde la auditoría responsive T4 (2026-07-23):
  //
  //  · `TabCatalogo` — «Sin flex-1, su ancho preferido hace que el flex-wrap
  //    del padre lo baje a su propia línea completa cuando no cabe. Con flex-1
  //    siempre reclama el sobrante: a 1024px el cluster de filtros ocupa ~500px
  //    y deja ~330px al wrapper, forzando UNA tarjeta por fila.»
  //  · `TabSinVenta` — «Sin flex-1/min-w-0 a propósito en el wrapper de cards:
  //    mismo bug que TabCatalogo, columna angosta a 1024×768.»
  //
  // O sea que acá el `flex-wrap` y la ausencia de `flex-1` son el ARREGLO de un
  // bug medido, no el bug. Contarlas como ratchet decía «bajalas», y bajarlas
  // reintroduce el 1024×768 que T4 cerró.
  // Vivía en `src/views/productos/`; se mudó a `src/views/inventario/` el
  // 2026-08-08 al dejar de ser pestaña de Productos. Sólo cambió la ruta — la
  // medición de arriba sigue siendo la misma y no se re-abrió el hallazgo.
  //
  // La ruta vieja NO queda listada: entre v2.520.2 y v2.521.0 existió ahí un
  // puente de una línea (`export { default } from …`) que no tiene layout, así
  // que nunca hubo un segundo hallazgo que excepcionar. v2.521.0 lo borra.
  'src/views/inventario/TabSinVenta.jsx': ['carril-pildora'],
  // Las dos últimas, MEDIDAS EN PANTALLA el 2026-08-06 a 1280 y a 1600 con
  // Playwright (`tests/e2e/materiales.spec.js`), que es lo que §17.0 pide y lo
  // que no se puede deducir del archivo:
  //
  //  · `AttendanceAuditView` — carril 4×200 + huecos = 836, píldora 421 → hacen
  //    falta 1257px. Disponibles: 886 a 1280 y **1182 a 1600**. No entran juntos
  //    en NINGUNO de los dos anchos.
  //  · `TabInventario` — carril 5×148 = 772, píldora 553 → hacen falta 1337px.
  //    Disponibles: 772 en los dos anchos.
  //
  // O sea el mismo caso que `ClientesView`, sólo que ahí el número ya estaba
  // escrito y acá había que ir a buscarlo. En dos filas entran enteras; forzar
  // `lg:flex-row` dejaría el carril en una o dos tarjetas visibles, que es el
  // «una sola cortada parece un error de maquetación» que §17.0 evita.
  // Misma mudanza del 2026-08-08 que su hermana: la ruta es otra, la medición
  // de 1337px contra 772 disponibles es la misma.
  'src/views/inventario/TabInventario.jsx': ['carril-pildora'],
  'src/components/common/SegmentedControl.jsx': ['chart-retirado'],
  'src/components/common/TabBarAction.jsx': ['chart-retirado'],
  'src/components/common/Contador.jsx': ['chart-retirado'],
  // ── `vidrio-a-mano`: las dos familias bespoke (PLAN-MATERIALES §18.1) ─────
  // No son deuda: son las dos pantallas que **viven fuera del shell** y por eso
  // no pueden heredar su material.
  //
  //  · `LoginView` se pinta antes de que exista sesión, tema de perfil ni
  //    layout — es la única vista sin `GlassViewLayout` alrededor. Desde el
  //    2026-08-16 SÍ tiene tema, pero el del SISTEMA (claro/oscuro), y lo
  //    resuelve con variables propias (`--lgn-*`) declaradas en la vista:
  //    fuera del shell no hay tokens de superficie que heredar.
  //  · El kiosco (`timeclock/*`) es oscuro en los CUATRO temas por decisión,
  //    igual que el sidebar antes de §12: corre en una tablet fija de sucursal,
  //    a un brazo de distancia, y su contraste está calibrado para eso.
  //
  // Que sean excepción y no ratchet es deliberado: el ratchet dice «esto hay
  // que bajarlo», y estas dos no hay que bajarlas nunca. Confundirlas con deuda
  // es lo que haría que alguien las «arreglara» rompiéndolas. Las siete
  // entradas viven más abajo, sumadas a las que esos archivos ya tenían — este
  // objeto asertea claves duplicadas, así que una familia nueva se AGREGA a la
  // línea que ya existe, no se declara aparte.
  // Superficies fijas-oscuras (no siguen el tema activo, confirmado en DESIGN.md §6)
  // sidebar + blobs ambientales ('color'); 'search-toggle': searchOpen es el
  // modal ⌘K de navegación global — ya tiene su propio Escape + click en el
  // backdrop para cerrar (patrón de modal estándar, cierra siempre sin
  // importar el texto tipeado, a diferencia de un buscador inline donde
  // perder el texto por accidente sí importa). Ver MenuSearchModal.jsx.
  // 'shadow-literal': el filo del ítem activo es el único glow BICOLOR del
  // portal (verde + magenta del logo). La escala --shadow-glow-* es de un color
  // por token; un token propio para esto sería una escala de uno.
  'src/components/layout/AppLayout.jsx': ['color', 'search-toggle', 'z-index', 'shadow-literal', 'white', 'hex', 'inline-color'],
  // `input-a-mano` (2026-07-29): los 4 que quedaban NO son deuda, son las
  // superficies bespoke de DESIGN.md §25.4 —lista CERRADA— más la paleta de
  // comandos. Pasan de ratchet a excepción nombrada para que la categoría
  // quede en CERO y bloqueante: un `<input>` nuevo en cualquier OTRO archivo
  // falla el gate, que es justo lo que un número en el baseline no garantiza.
  //   · LoginView / AuthPromptPanel — login y kiosco no siguen el tema ni el
  //     sistema de formularios; `PortalInput` traería su caja y su etiqueta.
  //   · MenuSearchModal — el campo del ⌘K es transparente y sin marco: una
  //     paleta de comandos no lleva etiqueta visible (el placeholder y el
  //     `aria-label` son su nombre). Los 3 tienen nombre accesible, vigilado
  //     en cero por `input-sin-nombre`.
  // (LoginView y AuthPromptPanel llevan 'input-a-mano' en su entrada de más
  // abajo — este objeto NO admite la misma clave dos veces: la segunda pisa a
  // la primera en silencio. Lo verifica `assertSinClavesDuplicadas`.)
  'src/components/layout/MenuSearchModal.jsx': ['input-a-mano'],
  'src/views/branch-tabs/TabStaff.jsx': ['color', 'native'], // panel WFM dark + shimmer IA
  // `color`: tooltip flotante dark. `icono-stroke`: el `Sparkles size={100}
  // strokeWidth={0.5}` es la marca de agua del panel (`text-[#F79009]/15`,
  // `pointer-events-none`) — a 100px un trazo de la escala se ve como un dibujo,
  // no como una textura. Es el mismo criterio con que §12 saca a las marcas de
  // agua de la rampa de tamaños.
  // `segmentado-largo`: son los FILTROS DE RANGO (día/semana/mes/…), no la
  // captura de un valor. §15.3 manda select arriba de 3 opciones porque un
  // segmentado largo deja de comparar; un carril de filtros compara justamente
  // eso, y esconder los rangos en un desplegable los vuelve invisibles. Es el
  // mismo motivo por el que las píldoras de filtro son su propio patrón.
  'src/components/forms/FormWfmAnalytics.jsx': ['color', 'icono-stroke', 'white', 'hex', 'segmentado-largo'],
  // El check y el guion del Checkbox van a `strokeWidth={4}`: dentro de una caja
  // de 16px un trazo de 2.5 se pierde, y ese glifo ES el estado del control —
  // si no se ve, el checkbox no comunica nada. No es un ícono de interfaz más.
  'src/components/common/Checkbox.jsx': ['icono-stroke'],
  'src/components/timeclock/IdleScanPanel.jsx': ['material-a-mano', 'color', 'white', 'vidrio-a-mano'], // kiosco
  'src/views/AttendanceMonitorView.jsx': ['color'], // wallboard isDarkConcept
  // Shimmer decorativo de IA idéntico (DESIGN.md §6)
  //
  // 2026-08-06 · el anillo de degradado del botón de IA —`indigo-500` →
  // `purple-500` → `cyan-500`, tres colores CRUDOS y a propósito: es el shimmer
  // de IA, no una superficie del tema— vivía copiado en TRES vistas, así que la
  // excepción estaba escrita tres veces. Ahora vive en `BotonIA` y la excepción
  // también: **una, no tres**. Es la ventaja que el componente compra además de
  // no divergir — y ya habían divergido, dos de las tres copias usaban
  // `border-purple-400` donde la tercera usaba el token `chart-3`.
  'src/components/common/BotonIA.jsx': ['color'],
  'src/views/branch-tabs/TabHistory.jsx': ['color'],
  'src/views/BranchesView.jsx': ['color'],
  'src/views/branch-tabs/TabExpediente.jsx': ['color'],
  'src/components/forms/FormAiSchedulerPreview.jsx': ['color'],
  // Mapas/canvas/PDF — colores hex directos por naturaleza de la tecnología
  'src/views/CotizacionesView.jsx': ['color', 'hex'],
  'src/views/pedidos/CrearRutaModal.jsx': ['color', 'white', 'hex', 'inline-color'], // marcadores Leaflet (L.divIcon HTML)
  // La boleta y la planilla son documentos legales que se imprimen, y la línea
  // 461 arma el archivo de banco (CSV): un separador de miles ahí rompe la
  // carga. La pantalla de la vista SÍ pasa por `formatMoney` (el helper `fmt`).
  'src/views/PayrollView.jsx': ['color', 'formato-cifra', 'hex'],
  // Tooltips flotantes dark (DESIGN.md §6 — no siguen el tema activo por diseño)
  'src/components/forms/FormEditPayrollEntry.jsx': ['color'],
  'src/components/common/SidebarSyncStatus.jsx': ['color', 'white'],
  'src/views/pedidos/tabpedidos/LifecycleTimeline.jsx': ['color'],
  'src/views/schedule-tabs/components/SalyCopilot.jsx': ['color'], // caja IA siempre-oscura, mismo patrón shimmer
  'src/views/schedule-tabs/components/ScheduleChart.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/schedule-tabs/TabShifts.jsx': ['color'], // caja IA siempre-oscura
  // `color`: tooltip flotante dark (resto del archivo ya tokenizado).
  // `segmentado-largo`: son las cinco SECCIONES de la ficha, o sea navegación
  // —el caso que §15.3 ya exime en la misma frase que fija el tope de 3—. Este
  // control reemplazó una pestaña escrita a mano cuyo indicador se calculaba
  // con cinco ternarios; volverla un desplegable sería peor que el original.
  'src/views/EmployeeDetailView.jsx': ['color', 'segmentado-largo'],
  // `carril-pildora`: excepción MEDIDA en pantalla, ver la nota junto a TabInventario.
  'src/views/AttendanceAuditView.jsx': ['color', 'carril-pildora'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/VentasView.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/VacationPlanView.jsx': ['color'], // tooltips flotantes dark
  // Superficies kiosco / cámara / editor de foto — siempre-oscuras por diseño
  // `vidrio-a-mano` + `material-a-mano` agregados el 2026-08-06 al cerrar §20:
  // el kiosco vive FUERA del shell —no hay `data-surface` de la que colgar, ni
  // tema que respetar: es siempre-oscuro por diseño— y su tarjeta del reloj usa
  // `backdrop-blur-[60px]` sobre el fondo de cámara. Es la quinta fila de §20.2
  // («bespoke → EXCEPTIONS con el motivo escrito»), no deuda sin clasificar.
  'src/views/TimeClockView.jsx': ['material-a-mano', 'vidrio-a-mano', 'color', 'white', 'hex', 'inline-color'], // 2026-07-25: fondo/blobs migrados a bg-surface-page + tokens del tema dark; excepción ya solo cubre los 3 micro-acentos azules bespoke de la card del reloj (from-blue-950/from-blue-400/via-blue-400 — hero accent deliberado, no base surface)
  'src/views/LoginView.jsx': ['material-a-mano', 'color', 'z-index', 'input-a-mano', 'white', 'hex', 'inline-color', 'vidrio-a-mano'], // scanner de cámara + fondo splash bespoke (comparte gradiente con App.jsx)
  'src/components/timeclock/KioskConfigModal.jsx': ['material-a-mano', 'color', 'white', 'hex', 'vidrio-a-mano'],
  'src/components/common/ThemeToggle.jsx': ['color', 'white'], // host siempre-oscuro documentado inline (SidebarSettingsMenu)
  // Ilustraciones / branding de terceros — no son superficies del sistema de tokens
  // 'relleno-sin-solid': `selection:bg-success/30 selection:text-white` es el
  // resaltado de SELECCIÓN de texto, no un relleno de control — el usuario ve
  // ese par solo mientras arrastra sobre el bloque de código.
  'src/components/forms/FormAuditDetail.jsx': ['color', 'relleno-sin-solid', 'hex'], // mockup de ventana macOS (colores reales del semáforo Apple)
  'src/views/AccessDeniedView.jsx': ['color'], // verde real de marca WhatsApp
  'src/views/NoAccessView.jsx': ['color'], // verde real de marca WhatsApp
  'src/App.jsx': ['color', 'hex'], // fondo splash bespoke (comparte gradiente con LoginView)
  // Vistas de diagnóstico/QA, no UI real de negocio
  'src/views/IOSTestView.jsx': ['color'],
  // Franja de aviso del tope del portal. Sólo su variante `obra` es bespoke
  // (rayado ámbar/naranja con texto oscuro fijo, no reactivo al tema — ver
  // src/version.js v2.57.1); las otras cuatro variantes usan tokens.
  'src/components/common/BannerPortal.jsx': ['color', 'hex', 'inline-color'],
  // Los componentes canónicos SON la implementación del select/date-picker/
  // modal — su interior legítimamente toca lo nativo que envuelven.
  'src/components/common/LiquidSelect.jsx': ['native', 'foto-sin-aro'],
  'src/components/common/LiquidDatePicker.jsx': ['native'],
  'src/components/common/RangeDatePicker.jsx': ['native'],
  'src/components/common/TimePicker12.jsx': ['native'],
  'src/components/common/PortalTextarea.jsx': ['native'],
  'src/components/common/ConfirmModal.jsx': ['native'],
  'src/components/common/AlertModal.jsx': ['native'],
  'src/components/common/PeriodPicker.jsx': ['native'], // fn local `confirm(s,e)`, no window.confirm
  // Preview/storybook, no visible a usuarios reales
  'src/views/_StatCardPreview.jsx': ['color', 'native'],
  // ── Agregadas en D0 (2026-07-26) al corregir HEX_RE ────────────────────
  // El regex viejo no podía ver estos hex (no hay `className=` en la línea),
  // por eso nunca aparecieron. Son hex por naturaleza de la tecnología,
  // exactamente la categoría "Mapas/canvas/PDF" que ya existe arriba.
  'src/utils/pedidoPrint.js': ['hex'],            // pdfmake: docDefinition, no CSS
  'src/utils/documentoDeBienvenida.js': ['hex'],  // idem: es un PDF, no hay tokens de tema en un papel
  'src/utils/constanciaDeSancion.js': ['hex'],    // idem: la constancia del Art. 83 se imprime y se firma
  // El QR tiene que ser negro puro sobre blanco puro: es lo que lee un lector, y
  // un token de tema lo dejaría claro sobre claro en oscuro — ilegible para
  // cualquier teléfono. Mismo criterio que la guía de encuadre de la cámara.
  'src/components/common/QrDeCaptura.jsx': ['hex'],
  'src/utils/corteZPrint.js': ['hex'],           // idem: el PDF del Corte Z no pasa por CSS ni por los tokens del tema
  // pdfmake: docDefinition, no CSS. `formato-cifra`: el PDF del conteo tiene su
  // propio `fmtMoney` porque va a papel, no a pantalla.
  'src/utils/conteoInventarioPrint.js': ['hex', 'formato-cifra'],
  // <meta name="theme-color"> necesita un color SÓLIDO; --bg-page es un
  // gradiente, así que no se puede derivar del token con getComputedStyle.
  'src/context/ThemeContext.jsx': ['hex'],
  // ── Agregadas en D2.1 (2026-07-26) al tokenizar la escala tipográfica ──
  // Piezas únicas fuera de la rampa, no una escala: emoji decorativos de
  // fondo (120/80px, opacity .07 — decoración, no texto) y un numeral hero
  // de 72px. Con esto la categoría `typography` queda en 0 y bloqueante.
  // 'relleno-sin-solid': el kiosco es superficie bespoke SIEMPRE oscura
  // (§25.4). Ahí `bg-chart-6/10` no es un relleno claro sino un tinte sobre
  // negro, y el texto blanco encima mide de sobra — la regla del `-solid`
  // existe para rellenos sobre fondo claro.
  'src/components/timeclock/FeedbackOverlay.jsx': ['material-a-mano', 'color', 'typography', 'relleno-sin-solid', 'white', 'hex', 'vidrio-a-mano', 'foto-sin-aro'],
  // ── Agregadas en D2.5/N1 (2026-07-26) tras migrar 25 de los 32 hex ─────
  // Los 7 que quedan NO tienen token equivalente y no es honesto forzarlos:
  // · Button.jsx  — #f65a4d es el arranque del degradado destructive del
  //   propio canónico; --danger es su final. Un degradado necesita dos
  //   paradas y solo una es token. Candidato a --danger-gradient en D2.5.
  // · TabCatalogo.jsx — `ctx.fillStyle` de canvas: canvas NO resuelve var(),
  //   necesita un color literal. Único caso técnico real del barrido.
  // · tabminmax/constants.js — #94a3b8 es el escalón MEDIO de la rampa
  //   ABC/XYZ (A/X=chart-8 oscuro, B/Y=este, C/Z=warning/danger). Usar
  //   chart-8 colapsaría dos categorías en un color. Es una rampa
  //   secuencial y el sistema solo tiene paletas categóricas — decidirlo es
  //   trabajo de D2.5, no de un reemplazo mecánico.
  'src/components/common/Button.jsx': ['hex', 'white', 'chart-retirado'],
  // Badge.jsx ES la implementación canónica del patrón sólido que definió N2
  // (bg-X-solid + text-white). Su `text-white` no es deuda: es el contrato.
  // Mismo criterio que la excepción 'native' de LiquidSelect por ser el
  // canónico del <select>.
  'src/components/common/Badge.jsx': ['white', 'chart-retirado'],
  'src/components/common/Switch.jsx': ['white', 'chart-retirado'], // ES el canónico de la perilla
  // ── Perillas de switch (revisadas una por una, 2026-07-27) ─────────────
  // `bg-white` en un círculo pequeño ABSOLUTAMENTE POSICIONADO dentro de un
  // riel: es una perilla de switch, y una perilla es blanca sobre su riel en
  // los cuatro temas —igual que en iOS—, sea el riel claro u oscuro. No es
  // deuda de superficie: es la pieza que indica el estado del control.
  //
  // OJO: el blanco es correcto, pero al revisarlos apareció que TODO LO DEMÁS
  // había drifteado — 18 switches a mano con 8 tamaños, 6 sombras y 8 offsets
  // distintos. Por eso existe ahora components/common/Switch.jsx. Estas
  // excepciones cubren los que faltan migrar (A14), no son permanentes.
  'src/components/forms/BranchHelpers.jsx': ['white'],
  'src/components/forms/FormPlanificador.jsx': ['white'],
  'src/components/forms/FormAddCustomDocument.jsx': ['white'],
  'src/views/AnnouncementsView.jsx': ['white'],
  'src/views/PermissionsView.jsx': ['white'],
  'src/views/BranchDetailView.jsx': ['white'],
  // 'lift-clavado': la fila de vacaciones es tarjeta O tiene lift a mano, nunca
  // las dos — ambas ramas cuelgan del MISMO `isUpcoming` y dan 2px
  // (`data-surface="card"` cuando ya pasó; lift a mano cuando es próxima y no
  // hay superficie que la levante). El gate ve las dos cosas en la etiqueta y
  // no puede probar que las condiciones son complementarias; queda anotado acá
  // en vez de reescribir el marcado sólo para esconderlo del escáner.
  'src/views/employee/EmployeeProfileView.jsx': ['white', 'lift-clavado'],
  'src/views/productos/tabminmax/LabsPanel.jsx': ['white'],
  // Barridos especulares (`via-white/[0.08-0.25]`) sobre botones brand: el
  // fondo es azul en los 4 temas, así que el destello blanco es correcto —
  // ya se decidió en el barrido de v2.62.4. Y los dos `bg-white` que quedan
  // son puntos de un timeline/paso sobre una línea de color.
  'src/components/common/ErrorBoundary.jsx': ['white', 'z-index'],
  'src/views/RequestsView.jsx': ['white'],
  'src/views/EncuestaView.jsx': ['white', 'foto-sin-aro'],
  'src/components/forms/FormNursingRegents.jsx': ['white'],
  'src/views/productos/TabMinMax.jsx': ['white', 'z-index'],
  // ── Superficies siempre-oscuras, agregadas al cerrar D3.8 (2026-07-27) ──
  // Mismo criterio que IdleScanPanel: los paneles del kiosco y los popovers
  // anclados al sidebar NO siguen el tema activo — son oscuros en los cuatro.
  // Ahí `bg-white/[0.06]` y `border-white/10` no son deuda: son la paleta
  // bespoke de esa superficie, que ya está documentada en DESIGN.md §6.
  'src/components/timeclock/AuthPromptPanel.jsx': ['material-a-mano', 'color', 'white', 'input-a-mano', 'vidrio-a-mano'],
  'src/components/timeclock/SelfDeclareShiftPanel.jsx': ['material-a-mano', 'color', 'white', 'vidrio-a-mano'],
  'src/components/timeclock/EarlyExitForm.jsx': ['material-a-mano', 'color', 'white', 'vidrio-a-mano'],
  'src/components/common/SidebarSettingsMenu.jsx': ['color', 'white'],
  // ListRow lleva la paleta `onDark` para las filas de los flyouts del sidebar,
  // que se quedan oscuras en los 4 temas (si no, cuelga un panel claro de un
  // panel oscuro). Antes esa paleta estaba escrita a mano en cada archivo; que
  // viva en el canónico es mejor, pero el blanco sigue siendo literal a
  // propósito y por eso la excepción se mueve acá.
  'src/components/common/ListRow.jsx': ['white'],
  // Misma razón: `PortalInput.onDark` es la paleta bespoke del kiosco viviendo
  // en el canónico en vez de copiada en cada pantalla (2026-07-28).
  "src/components/common/PortalInput.jsx": ['white'],
  'src/components/common/NotificationBell.jsx': ['white'],
  // Misma razón que `ListRow` y `PortalInput`: la paleta de la tarjeta de un
  // aviso vivía escrita a mano DENTRO de `NotificationBell` y desde el
  // 2026-09-04 la comparte con la vista `/notificaciones`, que dibuja la misma
  // tarjeta. Que viva en el canónico es mejor que copiada en dos sitios; el
  // blanco sigue siendo literal a propósito —es un VELO sobre la tarjeta, no su
  // fondo, y el fondo lo fija `[data-surface="card"]` desde `index.css`— y por
  // eso la excepción se mueve con el código en vez de tocar el baseline.
  // La de `NotificationBell` NO queda muerta: la campana conserva blanco crudo
  // propio (el botón, el aviso fijado, el enlace del pie).
  'src/components/common/paletaDeAviso.js': ['white'],
  // `carril-pildora`: excepción MEDIDA, ver la nota junto a ClientesView.
  'src/views/productos/TabCatalogo.jsx': ['hex', 'carril-pildora'],
  'src/views/productos/tabminmax/constants.js': ['hex'],
  // ── D2.2, cierre (2026-07-27) ──────────────────────────────────────────
  // Los 20 `zIndex:` que quedaban son tooltips y popovers PORTALEADOS: se
  // renderizan en document.body y calculan su top/left contra el elemento que
  // los dispara, así que ya necesitan `style` sí o sí. Mover solo el z-index a
  // una clase partiría la decisión de apilamiento en dos mecanismos — peor que
  // dejarla junta. Se excepciona con motivo para que la categoría llegue a 0 y
  // quede BLOQUEANTE: a partir de acá, cualquier zIndex inline NUEVO falla.
  'src/views/DashboardView.jsx': ['color', 'z-index'],
  // `z-index` y `capa-flotante` se fueron el 2026-08-26: los dos existían por el
  // tooltip de «Información pendiente», que esta vista se escribía a mano con su
  // propio `createPortal` y un `zIndex: 99999` inline. Ahora es `LiquidTooltip`
  // —el canónico de §15.10— y el portal lo pone él, con su propia excepción
  // escrita cuatro líneas más abajo. Una excepción que sobrevive a su motivo
  // deja de proteger y pasa a esconder: el día que alguien escriba un `zIndex`
  // nuevo acá, el gate tiene que verlo.
  //
  // `carril-pildora`: la MISMA excepción medida que ClientesView, sólo que a
  // medias — el corte se subió de `lg` a `2xl` en vez de partirlo siempre, así
  // que desde 1536 las dos vuelven al renglón compartido que pide §17.0. El
  // número, medido en producción el 2026-08-26 (`/personal`, menú abierto): a
  // **1280 el carril recibía 392px para 772 de tarjetas** y a 1440 seguía sin
  // entrar la quinta, o sea que «Otros» salía cortada y «Practicantes» —una de
  // las cinco vistas de la pantalla, no un adorno— no se veía nunca en un
  // portátil. Con el corte en `2xl` mide 872 a 1280 y 1032 a 1440: las cinco
  // enteras, desborde 0 en los tres anchos. Lo que la regla evita —que la
  // píldora le descuente 314px al carril en silencio— acá no puede pasar,
  // porque debajo de 1536 no comparten renglón.
  'src/views/StaffManagementView.jsx': ['color', 'carril-pildora'],
  // 'capa-flotante': es EL tooltip canónico. Mismo motivo que arriba.
  'src/components/common/LiquidTooltip.jsx': ['capa-flotante'],
  'src/components/common/LiquidWeekPicker.jsx': ['z-index'],
  'src/components/common/PhotoEditorModal.jsx': ['color', 'z-index', 'hex', 'inline-color'],
  'src/views/productos/tabminmax/RowActions.jsx': ['z-index'],
  'src/views/pedidos/RecepcionModal.jsx': ['z-index'],
  'src/views/pedidos/RutaMapModal.jsx': ['color', 'z-index', 'hex', 'inline-color'],
  'src/views/employee/EmployeeAnnouncementsView.jsx': ['typography', 'z-index'],
  'src/views/RawTestView.jsx': ['color', 'z-index', 'hex', 'inline-color'],
  // AppLayout y LoginView: apilamiento INTERNO de sus propias superficies
  // bespoke (las capas del sidebar siempre-oscuro, los orbes del splash). La
  // escala canónica gobierna el apilamiento ENTRE componentes, no dentro de
  // uno — un z-[2] sobre un z-[1] hermano no compite con nada del resto de la
  // app, y nombrarlo con la escala global sería peor: sugeriría una relación
  // que no existe.
};

// EXCEPTIONS es un objeto literal: repetir una clave NO es un error de JS, la
// segunda simplemente pisa a la primera y la excepción de arriba desaparece sin
// aviso. Pasó el 2026-07-29 al agregar 'input-a-mano' a LoginView y
// AuthPromptPanel: ambos ya figuraban más abajo, así que el gate siguió
// marcándolos y el motivo escrito no servía de nada. Se lee el propio fuente
// porque para cuando el objeto existe la información ya se perdió.
function assertSinClavesDuplicadas() {
  const fuente = readFileSync(new URL(import.meta.url), 'utf8');
  const bloque = fuente.slice(fuente.indexOf('const EXCEPTIONS = {'));
  const cuerpo = bloque.slice(0, bloque.indexOf('\n};'));
  const vistas = new Map();
  for (const m of cuerpo.matchAll(/^\s*'([^']+)':\s*\[/gm)) {
    vistas.set(m[1], (vistas.get(m[1]) || 0) + 1);
  }
  const dup = [...vistas].filter(([, n]) => n > 1).map(([k]) => k);
  if (dup.length) {
    console.error(`\n✗ EXCEPTIONS tiene claves repetidas — la última gana y las anteriores se pierden en silencio:\n${dup.map(d => `  · ${d}`).join('\n')}\n  Unificá cada archivo en UNA sola entrada con todas sus categorías.\n`);
    process.exit(1);
  }
}
assertSinClavesDuplicadas();

const hasException = (file, category) => (EXCEPTIONS[file] || []).includes(category);

function listFiles() {
  // `--file X` limita el escaneo a un archivo suelto. Lo usa
  // `design-doc-gate.mjs` para pasar los ejemplos de DESIGN.md por el mismo
  // gate que el código: un documento que enseña lo que el gate prohíbe es peor
  // que no tener documento.
  const iFile = process.argv.indexOf('--file');
  if (iFile !== -1 && process.argv[iFile + 1]) return [process.argv[iFile + 1]];

  const out = execSync(
    `find ${ROOTS.join(' ')} -type f \\( -name '*.jsx' -o -name '*.js' \\)`,
    { cwd: process.cwd() }
  ).toString().trim();
  return out ? out.split('\n') : [];
}


// ── Categoría 1: elementos nativos ──────────────────────────────────────
const NATIVE_PATTERNS = [
  { re: /\bwindow\.alert\s*\(|(?<!\w)alert\s*\(\s*['"`]/g, label: 'alert() nativo' },
  { re: /\bwindow\.confirm\s*\(/g, label: 'window.confirm() nativo' },
  { re: /\bwindow\.prompt\s*\(|(?<!\w)prompt\s*\(/g, label: 'prompt() nativo' },
  { re: /<select(\s|>)/g, label: '<select> nativo' },
  // Agregado 2026-07-27. Era el ÚLTIMO control de formulario nativo del portal
  // y nadie lo había mirado: 37 `<textarea>` con cuatro radios distintos, en
  // formularios donde el campo de una línea sí pasaba por `PortalInput`. Ahora
  // que están todos migrados, la categoría vuelve a cero absoluto y esto lo
  // deja cerrado — que es la única forma de que no se vuelva a acumular.
  { re: /<textarea(\s|>)/g, label: '<textarea> nativo — usar PortalTextarea' },
];
// `type="date|time|..."` solo es una violación real si el atributo pertenece
// a un <input> HTML nativo (tag en minúscula) — el mismo string en un prop de
// un componente propio (ej. `<LiquidDatePicker type="month">`, prop inerte/
// legado sin efecto) no es un elemento nativo, es un bug de props aparte.
const DATE_TYPE_RE = /type=["'](date|time|datetime-local|month|week)["']/g;
const TAG_OPEN_RE = /<([A-Za-z][\w.]*)/g;

/**
 * Devuelve la etiqueta de apertura COMPLETA que contiene la posición `pos`,
 * respetando llaves, comillas y template literals.
 *
 * Existe porque el atajo `<[A-Za-z][^>]*?…>` corta en el primer `>`, y dentro
 * de un tag JSX ese `>` aparece en cualquier `=>` o `===`. Con ese regex, una
 * tarjeta cuyo `data-tono` lleva un `===` quedaba "cerrada" antes de su propio
 * `className`, así que su lift a mano era invisible para el gate: fue
 * exactamente el falso negativo de `AnnouncementsView` (2026-08-02), detectado
 * midiendo 4px en el navegador con el gate en verde.
 */
/**
 * El mismo texto con los COMENTARIOS reemplazados por espacios.
 *
 * Existe porque `vidrio-a-mano` contaba un `backdrop-filter` escrito dentro de
 * un comentario de `StatCard` —un archivo que no tiene ni un vidrio a mano— y,
 * peor, el número se MOVÍA al editar cualquier otra parte del archivo: el match
 * caía en una posición distinta y `tagQueContiene` resolvía otro tag, así que a
 * veces quedaba dentro de uno con `data-surface` (y se saltaba) y a veces no.
 * Un detector que lee prosa no sólo acusa de más: es INESTABLE, y un ratchet
 * que se mueve solo deja de ser un ratchet.
 *
 * Se reemplaza por espacios y no se borra para que los offsets —y por lo tanto
 * los números de línea y `tagQueContiene`— sigan siendo los del archivo real.
 */
function sinComentarios(txt) {
  let out = '', i = 0;
  while (i < txt.length) {
    const dos = txt.slice(i, i + 2);
    if (dos === '//') {
      const fin = txt.indexOf('\n', i);
      const hasta = fin === -1 ? txt.length : fin;
      out += ' '.repeat(hasta - i); i = hasta;
    } else if (dos === '/*') {
      const fin = txt.indexOf('*/', i + 2);
      const hasta = fin === -1 ? txt.length : fin + 2;
      out += txt.slice(i, hasta).replace(/[^\n]/g, ' '); i = hasta;
    } else { out += txt[i]; i++; }
  }
  return out;
}

function tagQueContiene(txt, pos) {
  let ini = txt.lastIndexOf('<', pos);
  while (ini > 0 && !/[A-Za-z]/.test(txt[ini + 1] || '')) ini = txt.lastIndexOf('<', ini - 1);
  if (ini < 0) return null;
  let i = ini + 1, llaves = 0, comilla = null;
  while (i < txt.length) {
    const c = txt[i];
    if (comilla) {
      if (c === '\\') { i += 2; continue; }
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'" || c === '`') comilla = c;
    else if (c === '{') llaves++;
    else if (c === '}') llaves--;
    else if (c === '>' && llaves === 0) return { texto: txt.slice(ini, i + 1), ini };
    i++;
  }
  return null;
}

/**
 * El valor COMPLETO del `className` de un tag, interpolaciones incluidas.
 *
 * Existe porque `tag.match(/className=[{`"]+([^`"}]*)/)` —lo que usaban los
 * detectores— **corta en la primera `}`**. O sea que de
 * `className={\`base ${activo ? 'bg-surface-card border' : ''}\`}` sólo leía
 * `base `, y toda clase escrita dentro de un condicional era invisible. Medido
 * el 2026-08-16 sobre las tarjetas a mano: 19 de 81 tenían sus clases ahí.
 * Es el mismo defecto que [[feedback_el_gate_de_diseno_no_ve_el_estilo_guardado_en_una_constante]],
 * un nivel más abajo.
 *
 * Y lee sólo el `className` del **nivel 0** del tag: `action={<Button
 * className="…"/>}` mete el de OTRO componente en el mismo texto, que es la
 * trampa que costó una vuelta en `prop-inexistente` (150 «hallazgos» que eran 31).
 */
function classNameDeTag(tag) {
  let i = 0, llaves = 0, comilla = null;
  while (i < tag.length) {
    const c = tag[i];
    if (comilla) {
      if (c === '\\') { i += 2; continue; }
      if (c === comilla) comilla = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { comilla = c; i++; continue; }
    if (c === '{') { llaves++; i++; continue; }
    if (c === '}') { llaves--; i++; continue; }
    if (llaves === 0 && tag.startsWith('className', i) && /[\s=]/.test(tag[i + 9] ?? '')) {
      const eq = tag.indexOf('=', i);
      if (eq < 0) return null;
      let j = eq + 1;
      while (/\s/.test(tag[j] ?? '')) j++;
      if (tag[j] === '"' || tag[j] === "'") {
        const fin = tag.indexOf(tag[j], j + 1);
        return fin < 0 ? null : tag.slice(j + 1, fin);
      }
      if (tag[j] === '{') {
        let k = j + 1, prof = 1, q = null;
        while (k < tag.length && prof > 0) {
          const ch = tag[k];
          if (q) { if (ch === '\\') { k += 2; continue; } if (ch === q) q = null; }
          else if (ch === '"' || ch === "'" || ch === '`') q = ch;
          else if (ch === '{') prof++;
          else if (ch === '}') prof--;
          k++;
        }
        return tag.slice(j + 1, k - 1);
      }
      return null;
    }
    i++;
  }
  return null;
}

/**
 * El valor de UN prop del tag, leído al nivel 0 y con las llaves balanceadas.
 *
 * Generaliza lo que `classNameDeTag` hace con `className`. El «nivel 0» es la
 * parte que no se puede saltear: `action={<Button tabs={…}/>}` mete props de
 * OTRO componente dentro del mismo texto, y contarlos ahí acusa al inocente —
 * la trampa que costó una vuelta en `prop-inexistente`.
 *
 * Devuelve `null` si el prop no está; la CADENA VACÍA es un valor posible
 * (`tabs={}`), así que hay que distinguirlos con `== null` y no con `!valor`.
 */
function propDeTag(tag, nombre) {
  let i = 0, llaves = 0, comilla = null;
  while (i < tag.length) {
    const c = tag[i];
    if (comilla) {
      if (c === '\\') { i += 2; continue; }
      if (c === comilla) comilla = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { comilla = c; i++; continue; }
    if (c === '{') { llaves++; i++; continue; }
    if (c === '}') { llaves--; i++; continue; }
    if (llaves === 0 && tag.startsWith(nombre, i)
        && /[\s=]/.test(tag[i + nombre.length] ?? '')
        && !/[\w$]/.test(tag[i - 1] ?? ' ')) {
      const eq = tag.indexOf('=', i);
      if (eq < 0) return null;
      let j = eq + 1;
      while (/\s/.test(tag[j] ?? '')) j++;
      if (tag[j] === '"' || tag[j] === "'") {
        const fin = tag.indexOf(tag[j], j + 1);
        return fin < 0 ? null : tag.slice(j + 1, fin);
      }
      if (tag[j] === '{') {
        let k = j + 1, prof = 1, q = null;
        while (k < tag.length && prof > 0) {
          const ch = tag[k];
          if (q) { if (ch === '\\') { k += 2; continue; } if (ch === q) q = null; }
          else if (ch === '"' || ch === "'" || ch === '`') q = ch;
          else if (ch === '{') prof++;
          else if (ch === '}') prof--;
          k++;
        }
        return tag.slice(j + 1, k - 1);
      }
      return null;
    }
    i++;
  }
  return null;
}

/**
 * Todos los `<Nombre …>` de un archivo, como pares [inicio, fin).
 *
 * Hermano de `tagQueContiene`, que resuelve UNO desde una posición conocida;
 * este los enumera. Comparten lo único que importa: el fin del tag se busca
 * contando **llaves y comillas**, no con `[^>]*`. Ese `[^>]` se corta en el
 * primer `>`, y `=>` vive adentro de casi todos los `onClick` — un detector
 * escrito así encuentra los tags simples y es ciego justo a los que traen
 * lógica. Medido el 2026-08-05 en el barrido de «Cancelar»: 8 de 16.
 */
function tagsJsx(txt, nombre) {
  const fuera = [];
  const abre = `<${nombre}`;
  let i = 0;
  while ((i = txt.indexOf(abre, i)) >= 0) {
    // `<Button` no puede ser el prefijo de `<ButtonGroup`.
    if (!/[\s/>]/.test(txt[i + abre.length] || '')) { i += abre.length; continue; }
    let j = i + abre.length, llaves = 0, comilla = null;
    while (j < txt.length) {
      const c = txt[j];
      if (comilla) {
        if (c === '\\') { j += 2; continue; }
        if (c === comilla) comilla = null;
      } else if (c === '"' || c === "'" || c === '`') comilla = c;
      else if (c === '{') llaves++;
      else if (c === '}') llaves--;
      else if (c === '>' && llaves === 0) break;
      j++;
    }
    fuera.push([i, j + 1]);
    i = j + 1;
  }
  return fuera;
}

// ── Categoría `prop-inexistente` (2026-08-14) ───────────────────────────────
//
// **Un prop con el nombre equivocado no falla: se ignora.** React no valida
// nada, así que pasarle `message`/`subtext` a `EmptyState` —que espera
// `title`/`subtitle`— pinta el ícono y CERO texto, sin un error, sin un aviso
// y sin que ningún gate lo viera. Estuvo así en dos pantallas de Cortes de caja
// hasta que el usuario lo reportó como «el estado vacío se ve cortado».
//
// El barrido del día que se agregó encontró otros dos, y ninguno se estaba
// buscando: `LiquidDatePicker` recibe `placeholder` en 30 sitios y no lo acepta
// (los campos DD/MM/AAAA traen el suyo escrito), y un `ConfirmModal` de
// TabStaff pasa `hideCancel` — o sea que el diálogo que dice «Entendido»
// muestra además un «Cancelar» que nadie quiso.
//
// ── La firma sale del COMPONENTE, no de una lista ──────────────────────────
// Una tabla de props escrita a mano se desincroniza del registro el día que
// alguien agrega un prop (misma lección que los catálogos: el rótulo sale de la
// fila). Acá se leen los nombres destructurados de la firma real, y un
// componente con `...rest` queda fuera del chequeo: acepta cualquier cosa a
// propósito.
const RESERVADAS_JSX = new Set(['key', 'ref', 'children', 'dangerouslySetInnerHTML']);

/** Los props destructurados de `nombre` en `txt`. `null` = no se puede saber. */
function firmaDeComponente(txtRaw, nombre) {
  const txt = sinComentarios(txtRaw);
  const pats = [
    new RegExp(`(?:export\\s+)?(?:const|let)\\s+${nombre}\\s*=\\s*(?:React\\.)?(?:memo\\(|forwardRef\\(|)+\\s*\\(\\{`),
    new RegExp(`(?:export\\s+)?(?:default\\s+)?function\\s+${nombre}\\s*\\(\\{`),
  ];
  for (const re of pats) {
    const m = re.exec(txt);
    if (!m) continue;
    const ini = txt.indexOf('{', m.index + m[0].length - 1);
    if (ini < 0) continue;
    let prof = 0, j = ini;
    for (; j < txt.length; j++) {
      const c = txt[j];
      if (c === '{') prof++;
      else if (c === '}') { prof--; if (prof === 0) break; }
    }
    const cuerpo = txt.slice(ini + 1, j);
    if (/\.\.\./.test(cuerpo)) return null;   // `...rest`: acepta todo
    // Los nombres al nivel 0: lo que va antes de `:`, `=` o `,`.
    const props = new Set();
    let nivel = 0, buf = '', str = null, saltando = false;
    for (const c of cuerpo) {
      if (str) { if (c === str) str = null; continue; }
      if (c === '"' || c === "'" || c === '`') { str = c; continue; }
      if ('{(['.includes(c)) { nivel++; continue; }
      if ('})]'.includes(c)) { nivel--; continue; }
      if (nivel > 0) continue;
      if (c === ',') { if (!saltando && buf.trim()) props.add(buf.trim()); buf = ''; saltando = false; continue; }
      if (c === '=' || c === ':') { if (buf.trim()) props.add(buf.trim()); buf = ''; saltando = true; continue; }
      if (!saltando) buf += c;
    }
    if (!saltando && buf.trim()) props.add(buf.trim());
    const limpio = new Set([...props].map(p => p.trim()).filter(p => /^[A-Za-z_$][\w$]*$/.test(p)));
    return limpio.size ? limpio : null;
  }
  return null;
}

/** `{ Nombre → Set(props) }` de todo `components/common/`. Se calcula una vez. */
let _firmas = null;
function firmasCanonicas() {
  if (_firmas) return _firmas;
  _firmas = {};
  for (const f of (existsSync('src/components/common') ? readdirSync('src/components/common') : [])) {
    if (!f.endsWith('.jsx')) continue;
    const ruta = `src/components/common/${f}`;
    const txt = readFileSync(ruta, 'utf8');
    const nombres = new Set();
    for (const m of txt.matchAll(/export\s+const\s+([A-Z]\w*)\s*=/g)) nombres.add(m[1]);
    for (const m of txt.matchAll(/export\s+default\s+function\s+([A-Z]\w*)/g)) nombres.add(m[1]);
    const def = /export\s+default\s+([A-Z]\w*)\s*;/.exec(txt);
    if (def) nombres.add(def[1]);
    for (const n of nombres) {
      const props = firmaDeComponente(txt, n);
      if (props) _firmas[n] = { props, origen: ruta };
    }
  }
  return _firmas;
}

/** Los atributos escritos al NIVEL 0 de un tag — `action={<Button onClick=…/>}`
 *  mete adentro props de OTRO componente, y contarlos acusaría al inocente. */
function atributosDelTag(tag, nombre) {
  const fuera = [];
  let k = nombre.length + 1, prof = 0, str = null;
  while (k < tag.length) {
    const c = tag[k];
    if (str) { if (c === str) str = null; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; k++; continue; }
    if (c === '{') { prof++; k++; continue; }
    if (c === '}') { prof--; k++; continue; }
    if (prof === 0 && /\s/.test(tag[k - 1] || '')) {
      const mm = /^([a-zA-Z][\w-]*)\s*=/.exec(tag.slice(k));
      if (mm) { fuera.push(mm[1]); k += mm[0].length; continue; }
    }
    k++;
  }
  return fuera;
}

function nearestOpenTag(lines, lineIdx) {
  for (let i = lineIdx; i >= 0 && i >= lineIdx - 20; i--) {
    const matches = [...lines[i].matchAll(TAG_OPEN_RE)];
    if (matches.length) return matches[matches.length - 1][1];
  }
  return null;
}

// ── Categoría 2: color crudo ─────────────────────────────────────────────
// Toda la paleta default de Tailwind (T7.1 tokenizó ~1,400 usos de esto
// mismo — el gate original solo grepeaba text-slate-/bg-white//bg-slate-/
// border-white/ + hex, dejando fuera las demás familias de color crudo
// igual de no-tokenizadas: purple/green/orange/pink/blue/etc.)
const GRAY_PALETTES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
];
const COLOR_PREFIXES = [
  'bg', 'text', 'border', 'from', 'via', 'to', 'ring', 'divide',
  'placeholder', 'decoration', 'outline', 'accent', 'caret', 'fill', 'stroke',
];
// Un color que no existe en el tema: `chart-N` con N fuera de 1..9…
const RE_CHART_FUERA = /\bchart-(?:[1-9]\d+|0)\b/g;
// …y los TRES retirados el 2026-07-28, ya migrados: quedan como alias para que
// nada se rompa, pero un uso NUEVO es volver a abrir la paleta.
//
// `chart-8` estaba en esta lista y NO correspondía. Al ir a migrar sus 107
// referencias quedó a la vista que no es un categórico retirado sino **el
// neutro de la paleta**, y que está vivo:
//   · `--chart-8-solid` tiene VALOR PROPIO (#64748b), no es alias de nadie
//   · el `neutral` de `Badge` —soft y solid— se apoya en él
//   · tiene familia completa de glows (`--shadow-glow-chart-8*`)
// Marcarlo como retirado obligaba a mapearlo a `content-3`, que es un color de
// TEXTO: usarlo de fondo habría sido cambiar el significado para callar al
// gate. Sale de la lista y se documenta como lo que es (DESIGN.md §6.0).
const CHART_RETIRADOS = { 'chart-2': 'success', 'chart-5': 'chart-9',
                          'chart-7': 'warning' };
const RE_CHART_RETIRADO = /\bchart-[257]\b/g;

const GRAY_RE = new RegExp(
  `\\b(${COLOR_PREFIXES.join('|')})-(${GRAY_PALETTES.join('|')})-\\d{2,3}\\b`,
  'g'
);

// ── Categoría 2b: blanco/negro crudo (D0.1, 2026-07-26) ─────────────────
// GRAY_RE exige un shade numérico (`-\d{2,3}`), así que `bg-white`,
// `text-white` y `border-white` NUNCA se detectaron — 1,639 usos invisibles
// al gate desde que se escribió. Es la tercera repetición del mismo hueco
// (ring-*/via-* en T7, border-slate-* en v2.55.0): el regex solo cubre lo
// que enumera. Categoría propia y no dentro de 'color' para que 'color'
// conserve su significado (paletas Tailwind con shade) y siga en 0.
// Cubre con y sin alpha: bg-white, bg-white/80, bg-white/[0.06], text-black.
// `text-*` y `fill/stroke` quedan FUERA a propósito (afinado 2026-07-27).
// Medido: de 740 `text-white`, 434 están sobre un relleno de color en la misma
// línea —el contrato correcto que definió N2, ≥4.6:1— y de los otros 306 la
// mayoría son íconos dentro de un padre coloreado que un chequeo por línea no
// puede ver. Marcarlos producía ruido, no deuda.
// La división real: **el gate verifica SUPERFICIES** (qué fondo y qué borde
// se pinta, algo que sí se lee en la clase) y **el escáner en vivo verifica
// CONTRASTE** (qué termina viéndose, que depende del árbol). Cada herramienta
// para lo que puede comprobar de verdad.
const WHITE_PREFIXES = ['bg', 'border', 'from', 'via', 'to', 'ring', 'divide', 'outline'];
const WHITE_RE = new RegExp(
  `\\b(${WHITE_PREFIXES.join('|')})-(white|black)(?![\\w-])(\\/(\\[[^\\]]+\\]|[\\d.]+))?`,
  'g'
);

// ── Categoría 2c: hex crudo (D0.4, 2026-07-26) ──────────────────────────
// El regex viejo era `(?:className|style)=[^>]*?#hex`: exigía que el
// `className=`/`style=` estuviera en la MISMA línea y antes del hex, así que
// un hex dentro de una `const` de JS (`const EXPAND_BG = '…#EEF4FF…'`) era
// invisible — así sobrevivió meses en TabCatalogo.jsx hasta v2.62.4.
// Ahora: cualquier hex de 3/6/8 dígitos dentro de un string literal. El
// requisito de comilla en la línea evita los falsos positivos de fragmentos
// de URL y de ids sueltos. Sale de 'color' a categoría propia para no
// volver rojo un contador que hoy está limpio.
const HEX_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const QUOTE_RE = /['"`]/;

// ── Categoría 7: tipografía a mano (D0.2, 2026-07-26) ───────────────────
// No existe escala tipográfica en @theme: 4,491 `text-[Npx]` literales en
// 181 archivos, con 25 valores distintos. D2 define la escala y los migra;
// D0 solo los hace visibles. Dos etiquetas distintas dentro de la misma
// categoría porque no son lo mismo: estar sin tokenizar es deuda, estar
// bajo 9px es ilegible hoy (§7 fija ahí el piso — 270 usos por debajo).
const TYPE_PX_RE = /\btext-\[(\d+)px\]/g;
const TYPE_FLOOR_PX = 9;

// ── Categoría 8: z-index fuera de la escala canónica (D0.3, 2026-07-26) ──
// T1 declaró 16 clases `@utility` (z-modal, z-toast, …) que generan CSS
// real y que NADIE consume: 0 usos contra 553 a mano. DESIGN.md §9 lo
// admite y difiere la migración a "T3/T4" — un plan cerrado el 2026-07-24.
// Se marcan las tres formas, con etiquetas distintas por gravedad.
const Z_ARBITRARY_RE = /\bz-\[(\d+)\]/g;
// z-0 no es una capa: significa "sin elevación". No se penaliza.
const Z_NUMERIC_RE = /\bz-([1-9]\d*)\b/g;
// `zIndex:` inline solo es deuda cuando es apilamiento CSS del sistema con un
// valor fijo. Se excluyen tres cosas que NO lo son (D2.2, 2026-07-26):
//   · marcadores de Google Maps (`new maps.Marker({ …, zIndex: 100 })`) — es
//     el orden de dibujo de otra API, no la pila del DOM;
//   · valores calculados (`zIndex: 4 - idx`) — un stack de tarjetas necesita
//     el índice, no puede ser una clase;
//   · `menuPortal` de react-select — estilo de librería, no admite className.
const Z_INLINE_RE = /\bzIndex\s*:\s*\d+/g;
const Z_INLINE_SKIP_RE = /maps\.Marker|new maps\.|menuPortal/;

// ── Categoría 10: color literal fuera de clases (D0-bis, 2026-07-26) ────
// Punto ciego encontrado al cerrar D1: un gate que lee CLASES no ve nada de
// lo que pasa dentro de `style={{ }}`. La última superficie blanca del
// barrido vivía justamente ahí — TabMinMax.jsx tenía
// `background: 'rgba(255,255,255,0.70)'` inline, invisible para las 5
// categorías de D0 y detectada solo por el escáner en vivo.
// HEX_RE ya cubre los `#rrggbb`; esto cubre la otra mitad: rgb()/rgba()/hsl().
const RGB_LITERAL_RE = /\b(rgba?|hsla?)\(\s*[\d.]/g;
// Las sombras a mano se cuentan aparte (ver abajo): si no, cada
// `shadow-[0_4px_16px_rgba(0,0,0,.06)]` sumaría a las dos categorías.
const SHADOW_ARBITRARY_RE = /shadow-\[[^\]]*\]/g;

// ── Categoría 11: sombra literal fuera de la escala (D0-bis) ────────────
// T7.3 tokenizó 548 de 959 usos (57%) en --shadow-elevation-*/glass-*/glow-*.
// Los 411 restantes siguen escritos a mano y nunca tuvieron gate. Una
// `shadow-[var(--…)]` es correcta; una con el valor literal es la deuda.
// Aros escritos a mano (A16, 2026-07-27). El proyecto YA tenía un aro de foco
// canónico: una regla en index.css sobre button/input/select/textarea/a/
// [role=button]/[tabindex]:focus-visible. Encima había 171 aros a mano en 47
// archivos que no agregaban nada — solo tapaban el canónico con un color
// distinto en cada formulario. Se borraron los 171.
//   · `focus:ring-*`   → redundante, el canónico ya lo pinta
//   · `focus:outline-none` → APAGA el canónico: deja el elemento sin foco
//     visible, que es la regresión de accesibilidad que este trabajo destapó
//   · alpha de aro de estado fuera de /30 (1px) y /45 (2px)
const RING_FOCUS_RE = /(?:focus|focus-visible|group-focus-within):ring-[a-z0-9[]/g;
const RING_KILL_RE = /(?:focus|focus-visible):outline-none/g;
const RING_ALPHA_RE = /(?<![:\w-])ring-1\s+ring-(?:brand|success|warning|danger|chart-\d)(?:-\w+)?(?:\/(?!30\b)[0-9.]+)?(?![\w/-])|(?<![:\w-])ring-2\s+ring-(?:brand|success|warning|danger|chart-\d)(?:-\w+)?(?:\/(?!45\b)[0-9.]+)?(?![\w/-])/g;

// Región colapsada sin `inert` (A17, 2026-07-27). Esconder con
// `opacity-0 pointer-events-none` saca la región del ojo y del mouse pero NO
// del teclado: se tabula adentro y el foco desaparece de la pantalla
// (WCAG 2.4.3 y 2.4.7). Eran 26 regiones en 14 archivos —el "modo búsqueda"
// copiado vista por vista, los paneles de IA, el modo edición de sucursal—.
// Se excluyen los reveals de hover, que son decorativos y no contienen foco.
// Acepta comillas simples Y dobles: la primera versión solo miraba simples y
// se le escaparon 13 regiones (las barras de búsqueda copiadas usan dobles).
// Sin exigir `${…}`: el ternario también aparece dentro de arrays que se unen
// con .join(" ") (AttendanceMonitorView). Cuarta forma del mismo patrón — cada
// una apareció verificando en el navegador, ninguna leyendo el código.
const INERT_RE = /\?\s*(['"])[^'"]*\1\s*:\s*(['"])[^'"]*\2/g;
const HIDDEN_BRANCH = /(['"])([^'"]*)\1/g;

// `(?<!drop-)`: `drop-shadow` NO es `box-shadow` y la escala `--shadow-*` no le
// aplica — una sigue la silueta alfa del elemento (un ícono, un PNG con
// transparencia) y la otra la caja. Pedirle a un halo de ícono que use un token
// de elevación es pedirle que sea otra cosa. Detectado el 2026-07-28 al bajar
// esta categoría a 4: los 4 "restantes" eran 3 drop-shadow y un glow bicolor.
const SHADOW_LITERAL_RE = /(?<!drop-)shadow-\[(?!var\(--)[^\]]+\]/g;

// ── Categoría 9: motion (D0.5, 2026-07-26) ──────────────────────────────
// La regla vieja ("no new framer-motion usage") baneaba la librería entera
// sin distinguir para qué se usa, y por eso se incumplía: 20 de los 25
// archivos la usan para lo que CSS NO puede hacer — AnimatePresence anima
// el DESMONTAJE (cuando React quita el nodo no queda nada que animar) y
// layout/layoutId hace transiciones FLIP entre posiciones. La regla nueva
// permite esas capacidades y prohíbe solo `motion.*` decorativo
// (fade/slide de entrada, hover, tap), que sí es @keyframes + Tailwind.
// Solo cuenta el uso DECORATIVO de componentes motion (`motion.div`,
// `<motion.button>`), no cualquier import de la librería: MotionProvider.jsx
// y useMotionConfig.js importan MotionConfig/useReducedMotion para IMPLEMENTAR
// la política de movimiento — marcarlos sería castigar la solución.
const MOTION_IMPORT_RE = /\bmotion\.[a-z]/;
const MOTION_ALLOWED_RE = /AnimatePresence|layoutId|LayoutGroup|\blayout\b|\bdrag\b/;
// S1.6: prefers-reduced-motion está resuelto para las 18 clases CSS que
// enumera DESIGN.md §25, pero la media query de CSS no detiene animación
// manejada por JS. useReducedMotion tiene 0 usos: los 25 archivos con
// framer-motion ignoran la preferencia de accesibilidad.
const REDUCED_MOTION_RE = /useReducedMotion/;

// ── Categoría 3: buscador toggleable sin useSearchToggle ────────────────
// Heurística de nombre: un `useState(false)` cuya variable termina en
// Search+{Open,Mode,Active,Expanded,Visible} o empieza con show+Search —
// cubre isSearchMode/isSearchOpen/isSearchActive/isSearchExpanded/
// showSearch/searchOpen/ausenciasSearchOpen, todas las variantes reales
// encontradas en el proyecto. Exige el sufijo (no solo "contiene search")
// para no confundir un buscador toggleable con un flag de loading tipo
// isSearching/productSearching ("estoy buscando ahora", no "el buscador
// está abierto") — encontrado como falso positivo real al escribir esto.
const SEARCH_TOGGLE_STATE_RE = /const\s*\[\s*(\w*[Ss]earch(?:Open|Mode|Active|Expanded|Visible)|show[Ss]earch)\s*,\s*set\w+\s*\]\s*=\s*useState\(false\)/g;

// ── Categoría 4: input/textarea bajo 16px (zoom automático iOS Safari) ──
// Excluye utilidades `placeholder:text-*` (y con un breakpoint intermedio,
// `placeholder:sm:text-*`) — solo cambian el placeholder, no el valor
// tipeado, así que no disparan el zoom. Encontrado como falso positivo
// real (`AuthPromptPanel.jsx`, PIN gigante + placeholder chico aparte) al
// escribir esto.
const SMALL_TEXT_RE = /(?<!placeholder:)(?<!placeholder:sm:)(?<!placeholder:md:)(?<!placeholder:lg:)\btext-(xs|sm|\[[1-9]px\]|\[1[0-5]px\])\b/g;
const INPUT_TYPE_EXCLUDE_RE = /type=["'](checkbox|radio|range|color|file)["']/;

// ── Categoría 5: active:scale-90/95 (mínimo permitido: active:scale-[0.97]) ─
const SCALE_TAP_RE = /active:scale-(90|95)\b/g;

// ── Categoría 6: border-l decorativo (indicador de color en fila/card/lista) ─
// Un `border-r` en la MISMA línea es la señal de que es un spinner (anillo
// parcial vía animate-spin), no un indicador — no se penaliza esa forma.
const LEFT_BORDER_RE = /\bborder-l-[248]\b/g;
const RIGHT_BORDER_RE = /\bborder-r(-[248])?\b/;

// ── Categoría `formato-cifra` (F1 de PLAN-IDENTIDAD-2026-07-29) ─────────────
// Toda cifra que ve el usuario pasa por `src/utils/formatNumber.js`
// (`formatMoney` / `formatQty` / `formatPct`), con locale fijo `es-SV`.
//
// Al medirlo había 50 `toFixed(2)`, 15 combinaciones de opciones `Intl` y 4
// locales en uso. Y las locales NO son equivalentes: `es`/`es-ES` dan coma
// decimal (`1234,56`) y `es-VE` punto de miles (`1.234,56`), contra el
// `1,234.56` de `es-SV`. El Dashboard mostraba `$1234,56` en seis lugares.
//
// Dos formas se penalizan:
//   1. `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` con un locale
//      que no sea `es-SV`.
//   2. La plantilla de moneda a mano: `` `$${x.toFixed(2)}` ``.
// `toFixed()` a secas NO se penaliza: redondear es cálculo, no formato.
//
// **`en-CA` está excluido a propósito, y no es una excepción por archivo.**
// `toLocaleDateString('en-CA')` es el idiom estándar para LEER una fecha como
// `YYYY-MM-DD` (opcionalmente en otra zona con `timeZone`) — es una clave de
// dato, no algo que el usuario vea. Lo usan `AppLayout`, `systemSlice`,
// `useTimeClockEngine`, `FormNovedad` y `WidgetAnnulmentRequest`. Excluirlo acá
// en vez de excepcionar esos 5 archivos mantiene la categoría viva en ellos: si
// mañana uno formatea un monto mal, el gate lo ve igual.
const LOCALE_AJENO_RE = /toLocale(?:Date|Time)?String\(\s*['"](?!es-SV|en-CA)[a-z]{2}(?:-[A-Z]{2})?['"]/g;

// ── Categorías `copy-vacio` y `copy-trato` (F2, DESIGN.md §26) ──────────────
// Miran SOLO los slots enumerados, no todo string del proyecto: un gate de
// redacción tiene falsos positivos por naturaleza y limitarlo a los huecos donde
// la regla es inequívoca es lo que lo hace confiable.
//
// **Los slots son solo estos dos**, y acotarlos así fue el trabajo de verdad.
// La primera versión miraba todo `title=` y marcó 123 hallazgos, casi todos
// falsos: `<GlassViewLayout title="Facturas de Compra">` es el NOMBRE de un
// módulo, y ahí el Title Case es correcto porque es un nombre propio. Lo mismo
// `title="Volver a Personal"` (Personal es un módulo). El Title Case que §26.4
// prohíbe es el de una etiqueta que debería leerse como oración —`Sin Horarios`—,
// no el del nombre de una pantalla.
//   1. el `message:` de un objeto (`empty={{…}}`, AlertModal, ConfirmModal)
//   2. `title=` / `subtitle=` **dentro de un `<EmptyState>`**
const SLOT_MESSAGE_RE = /\bmessage:\s*(['"])([^'"]{3,120})\1/g;
const SLOT_EMPTYSTATE_RE = /<EmptyState\b[^>]*?>/gs;
const SLOT_ES_ATTR_RE = /\b(?:title|subtitle)=(?:\{\s*)?(['"])([^'"]{3,120})\1/g;

// 26.1 — los arranques que la regla reemplaza por `Sin <sustantivo>`.
//
// ── Ensanchada el 2026-08-26 ────────────────────────────────────────────────
// La lista cerrada dejaba pasar «No salió nada de acá» —el vacío de las salidas
// de una bolsa—, que es la misma falta que «No hay registros» dicha con otro
// verbo. Enumerar verbos es whack-a-mole: la regla real es que un vacío NO se
// describe negando, se nombra («Sin salidas»).
//
// Por eso ahora entra cualquier arranque `No <algo>`, **menos los que son un
// ERROR y no un vacío**. Medido antes de excluirlos: `^No\s` a secas acusaba a
// 13, y ONCE eran «No se pudo cargar el libro» y familia — que §26.8 manda
// escribir exactamente así, porque un error sí dice qué pasó. Un gate que
// acusa al que hizo bien el trabajo es un gate que se termina desactivando.
const ARRANQUE_MALO_RE = /^(?!No\s+(?:se\s+pud|puedes|podés|pudimos))(No\s|Aún no|Aun no|Ningún|Ninguna|Nada )/;

// 26.4 — Title Case. Solo se aplica a etiquetas CORTAS (≤4 palabras): una
// oración larga lleva nombres propios legítimos ("el botón Agregar", "vuelta a
// base") y ahí el chequeo no distingue. El `[a-záéíóúñ]` que sigue a la
// mayúscula deja pasar las siglas (`MH`, `SRS`, `ERP`, `ABC`, `XYZ`).
const TITLE_CASE_RE = /\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/;

// 26.7 — voseo. Lista cerrada, no heurística de acentos.
//
// **`\b` no sirve acá:** en JS es ASCII, así que `é` cuenta como NO-palabra y
// `\bTené\b` matchea dentro de `Tenés` (hay frontera entre `é` y `s`). Lo
// descubrí porque el gate reportó `Tené` en "Tenés un borrador". Van lookarounds
// explícitos de letra, acentos incluidos.
const VOSEO = ['Creá','Presioná','Usá','Buscá','Probá','Hacé','Revisá','Elegí','Ingresá',
  'Seleccioná','Verificá','Agregá','Escribí','Intentá','Volvé','Guardá','Pedí','Poné',
  'Mirá','Tené','Andá','Marcá','Borrá','Cerrá','Abrí','Mandá','Esperá','Fijate',
  // presente de indicativo en segunda persona (vos), no solo imperativo
  'Tenés','Querés','Podés','Buscás','Archivés','Sabés','Vas a poder','Necesitás',
  // ── 2026-08-07 ──────────────────────────────────────────────────────────
  // Ampliada al escribir los avisos del canon del tablero: el gate marcó
  // `Abrí` y dejó pasar `acomodá`, `encendé`, `publicá` y `elegí` en las
  // frases de al lado. Dos huecos distintos, y los dos son de la lista, no de
  // la regla: faltaban verbos, y `Elegí` sólo estaba en mayúscula, así que a
  // media oración no lo veía nadie.
  'Acomodá','Publicá','Encendé','Apagá','Cambiá','Arrastrá','Soltá','Movés','Acomodás',
  // ── 2026-08-26 ──────────────────────────────────────────────────────────
  // Ampliada mientras se barría «acá»: al pasar el barrido apareció
  // «Descargá la hoja o el CSV, aplicalo, y registralo acá» en verde. Se midió
  // el resto con un barrido de agudas terminadas en á/é/í sobre texto de
  // pantalla y salieron OCHO más que la lista no tenía. O sea que `copy-trato`
  // llevaba meses en cero diciendo «no encontré», no «no hay».
  //
  // El barrido descarta el futuro de indicativo (`confirmará`, `dejará`,
  // `revisará`), que es correcto y suena igual de agudo — el mismo tipo de
  // falso positivo que ya se documenta arriba con `Pedí`.
  'Actualizá','Completá','Contá','Dejá','Descargá','Confirmá','Tocá','Pausás',
  'Aplicá','Registrá','Anotá','Cargá','Sacá','Meté','Contás','Dejás','Tocás'];

// ── `copy-anaquel` — el portal dice «vitrina» o «estante», nunca «anaquel» ──
//
// Decisión del usuario, 2026-08-25: *«no uses nunca anaquel, solo Vitrina /
// Estante»*. No es preferencia de estilo — son las dos palabras que la empresa
// usa, y las únicas que el propio portal ya tenía como DATO: `laboratorios`
// guarda `vitrina`, `estante` y `peldano` para la sala, y el catálogo hace
// elegir entre «Vit.» y «Est.». O sea que la pantalla venía nombrando de una
// forma lo que la base nombraba de otra.
//
// Va como categoría del gate y no como una nota en DESIGN.md porque una regla
// de vocabulario que nadie verifica vuelve sola: se limpiaron 51 usos de una
// vez, y basta que la escriba una sesión para que empiece de nuevo.
//
// Mira las líneas que NO son comentario, igual que `copy-trato`: lo que la
// regla protege es lo que la gente LEE. Los comentarios quedaron limpios en la
// misma tanda, pero acusarlos haría ruido sin proteger a nadie.
//
// ⚠ Y el gate NO puede ver el hueco más grande, que ya mordió una vez: los
// rótulos que viven DENTRO de funciones de Postgres. El aviso del conteo
// cíclico decía «anaquel» y ningún grep del fuente lo encontraba — salió de
// auditar `pg_proc.prosrc`. Al cambiar vocabulario, mirar también ahí.
const ANAQUEL_RE = /\b[Aa]naquel(?:es)?\b/g;

// ── `copy-aqui` — el portal dice «aquí», nunca «acá» ───────────────────────
//
// Decisión del usuario, 2026-08-26: *«aca no se usa. es aqui.»*
//
// Es la misma clase de regla que `copy-anaquel`, y por el mismo motivo: sin
// verificarla vuelve sola. Y acá la deriva ya había GANADO — medido antes de
// barrer, el portal decía **«acá» 40 veces y «aquí» 22** en texto de pantalla.
// O sea que la forma que el usuario no quiere era la mayoritaria, y ninguna de
// las dos estaba decidida en ninguna parte: §26 no las mencionaba.
//
// `\b` no sirve con `á` —es ASCII, así que `á` cuenta como NO-palabra y la
// frontera cae en cualquier parte—; es el mismo tropiezo que documenta VOSEO
// más arriba. Van lookarounds explícitos de letra acentuada.
//
// Mira las líneas que NO son comentario, igual que sus dos hermanas: lo que la
// regla protege es lo que la gente LEE. Los comentarios del repo están escritos
// con «acá» de punta a punta y cambiarlos sería ruido sin proteger a nadie.
//
// ⚠ Y como toda regla de vocabulario, NO ve el texto que vive dentro de
// funciones de Postgres — el mismo hueco que ya mordió con «anaquel». Al
// barrer, mirar también `pg_proc.prosrc`.
const ACA_RE = /(?<![A-Za-zÁÉÍÓÚÑáéíóúñ])([Aa])cá(?![A-Za-zÁÉÍÓÚÑáéíóúñ])/g;

// Las minúsculas van explícitas en vez de poner la bandera `i`: con `i`, `Pedí`
// —que también es «yo pedí», pretérito perfectamente correcto— marcaría como
// voseo cualquier frase en pasado. Ese es justo el falso positivo que vuelve
// inservible un gate de redacción, así que se excluye de la mitad en minúscula
// y el resto sí entra.
const VOSEO_MINUSCULA = VOSEO
  .filter(v => v !== 'Pedí' && v !== 'Vas a poder')
  .map(v => v[0].toLowerCase() + v.slice(1));
const LETRA = 'A-Za-zÁÉÍÓÚÑáéíóúñ';
const VOSEO_RE = new RegExp(
  `(?<![${LETRA}])(${[...VOSEO, ...VOSEO_MINUSCULA].join('|')})(?![${LETRA}])`, 'g');

// ── Categoría `tooltip-no-control` (F3, DESIGN.md §15.10) ───────────────────
// `title=` sobre un elemento NO interactivo. Al medirlos (50 sitios) resultó que
// no son "tooltips sin migrar": son cuatro patrones distintos, y solo uno se
// resuelve con `LiquidTooltip`.
//
//   (A) el escape del truncado — el texto visible está cortado y el `title` tiene
//       el completo. `LiquidTooltip` NO sirve: envuelve en `inline-block` y eso
//       rompe justo el truncado que el `title` existe para salvar.
//   (B) el nombre de un gráfico — un punto de estado, un avatar en pila, un dot
//       por sucursal. Sin `role`, ningún lector de pantalla lo anuncia; con
//       `role="img"` el MISMO `title` pasa a ser su nombre accesible. Un atributo,
//       cero riesgo de layout, y el hover del mouse queda igual.
//   (C) un contenedor de controles con nombre → `role="group"`, misma lógica.
//   (D) prosa suplementaria → ésa sí va a `LiquidTooltip`.
//
// El gate permite (A) por el truncado y (B)/(C) por el rol. Todo lo demás es (D)
// y tiene que ser `LiquidTooltip`.
const TAGS_INTERACTIVOS = new Set(['button','a','input','select','textarea','label','option','optgroup',
  // `title` en éstos es legítimo o requerido por accesibilidad
  'iframe','img','area']);

// ── Categorías `icono-rampa` e `icono-stroke` (F4, DESIGN.md §12) ───────────
// La rampa de §12 se escribió el 2026-07-29 a partir de una medición que contaba
// **props `size` de componentes que no son íconos** — `<VendorAvatar size={5}>`
// es una clave de escala (`5 → w-5 h-5`), no píxeles, y `<PersonAvatar size={34}>`
// tampoco es un ícono. De ahí salían los "1,287 íconos / 33 tamaños". Contando
// solo componentes de `lucide-react` son **1,249 y 24 tamaños**, y los `5`, `30`
// y `34` que figuraban como fuera de rampa nunca existieron.
//
// Para saber si un `size={N}` es de un ícono se lee el import de `lucide-react`
// del propio archivo. **Ojo con las comillas:** 4 archivos importan con comillas
// dobles, y una regex que solo aceptaba simples los daba por no-íconos (así se me
// escaparon `Clock`, `Building2`, `Check`… en la primera pasada).
const LUCIDE_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/gs;
const NO_SON_ICONOS = new Set(['ListRow', 'PersonAvatar', 'VendorAvatar']);

// La rampa: fina abajo (donde un punto se ve porque el ícono compite con texto de
// 10-12px) y gruesa arriba. `9` y `15` entran porque son 116 usos reales en la
// zona fina — la versión anterior los excluía sin decir por qué. `56` sale: cero
// usos, y una rampa que ofrece un valor que nadie usa es el mismo defecto que
// tenía el doc.
const RAMPA_ICONO = new Set([8,9,10,11,12,13,14,15,16,18,20,22,24,26,28,32,36,40,48]);
// A partir de 49px ya no es un ícono de interfaz: es una ilustración o una marca
// de agua, y su tamaño lo decide la caja que llena, no la rampa (§12).
const ILUSTRACION_DESDE = 49;

// El trazo: escala CERRADA de cinco. El doc declaraba `1.5` como default y la
// medición dice lo contrario — en el tramo 15-20px el `2.5` gana **146 a 12**.
// Lo que sí es un sistema: trazo fino para ícono grande. Ver §12.
const STROKE_ESCALA = new Set(['1', '1.5', '2', '2.5', '3']);

// ── Categoría `icono-semantico` (F5 de PLAN-IDENTIDAD-2026-07-29) ───────────
// «Un concepto, un ícono». El plan suponía que `Edit`/`Edit2`/`Edit3` eran alias
// deprecados del MISMO glifo; al abrir el paquete resultó peor: son cuatro
// dibujos distintos. `Edit`→SquarePen (lápiz dentro de una caja), `Edit2`→Pen
// (pluma sin punta), `Edit3`→PenLine (pluma con subrayado) y `Pencil` (lápiz con
// punta). El portal mostraba cuatro lápices para la misma acción. Igual
// `CheckCircle`→CircleCheckBig (círculo abierto, check que se desborda) contra
// `CheckCircle2`→CircleCheck (círculo cerrado, check adentro).
//
// Nota de convención: `CheckCircle2` y `XCircle` son a su vez alias del nombre
// nuevo de Lucide (`CircleCheck`, `CircleX`), igual que `AlertTriangle` o
// `AlertCircle`. El proyecto entero habla el nombrado viejo y se queda así — es
// un renombre sin cambio visual, y mezclar las dos convenciones sería volver al
// problema que esta categoría cierra. Lo que se prohíbe acá es tener DOS nombres
// para el MISMO concepto, no el estilo del nombre.
const ICONO_RETIRADO = {
  Edit:        'Pencil',
  Edit2:       'Pencil',
  Edit3:       'Pencil',
  CheckCircle: 'CheckCircle2',
  CheckCheck:  'Check',
};

const MONEDA_A_MANO_RE = /\$\$\{[^}]*\.toFixed\(\s*[12]\s*\)/g;

// Marca líneas que son comentario puro (`// ...`, `* ...` de bloque, `/* ... */`
// completo en una sola línea) para no confundir código prohibido mencionado
// EN PROSA (ej. "nunca un <select> nativo", "abre ConfirmModal en vez de
// window.confirm") con una violación real. Heurística de una pasada —no es
// un parser JS completo, pero cubre el 100% de los falsos positivos vistos
// en el barrido inicial (ambos eran comentarios de una sola línea).
function commentMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (inBlock) {
      mask[i] = true;
      if (line.includes('*/')) inBlock = false;
      return;
    }
    if (line.startsWith('//') || line.startsWith('*')) {
      mask[i] = true;
      return;
    }
    if ((line.startsWith('/*') || line.startsWith('{/*')) && !line.includes('*/')) {
      mask[i] = true;
      inBlock = true;
    }
  });
  return mask;
}

function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const isComment = commentMask(lines);
  const findings = [];

  /* `isComment` es por RENGLÓN entero: dice «este renglón es un comentario».
   * No alcanza para las reglas de vocabulario, que buscan una palabra suelta —
   * un `// …` pegado después de código, un `/** … *\/` de una sola línea o un
   * `{/* … *\/}` de JSX quedan en un renglón que empieza con código y por lo
   * tanto se leen como texto de pantalla.
   *
   * Medido al estrenar `copy-aqui`: de sus 7 hallazgos, los 7 eran comentarios
   * de esas tres formas. Un detector de vocabulario que acusa comentarios se
   * desactiva solo, que es el modo en que una regla escrita deja de valer. */
  const sinComentarioEnLinea = (line) => line
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/\/\*[\s\S]*$/, '')   // bloque que ABRE acá y cierra más abajo
    .replace(/\/\/.*$/, '');

  const scanPatterns = (patterns, category, exceptionCategory) => {
    if (hasException(path, exceptionCategory)) return;
    for (const { re, label } of patterns) {
      lines.forEach((line, i) => {
        if (isComment[i]) return;
        re.lastIndex = 0;
        if (re.test(line)) {
          findings.push({ line: i + 1, label, category, text: line.trim().slice(0, 120) });
        }
      });
    }
  };

  scanPatterns(NATIVE_PATTERNS, 'native', 'native');

  if (!hasException(path, 'native')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      DATE_TYPE_RE.lastIndex = 0;
      if (DATE_TYPE_RE.test(line) && nearestOpenTag(lines, i) === 'input') {
        findings.push({ line: i + 1, label: 'input date/time nativo', category: 'native', text: line.trim().slice(0, 120) });
      }
    });
  }


  // ── `paleta-cerrada` (2026-07-28) ────────────────────────────────────────
  // Regla del usuario: **no se agregan colores ni variantes de color; se usan
  // los definidos**. Este chequeo la hace verificable en vez de dejarla como
  // buena intención en un documento.
  //
  // Falla si aparece un `--chart-N`, un `chart-N` en clase de Tailwind o una
  // variante `chart-N` con N fuera de la lista. Los nueve existen hoy y no se
  // borran acá —eso cambiaría el aspecto de varias vistas y es decisión del
  // usuario— pero un `chart-10` sería exactamente lo que la regla prohíbe.
  //
  // También marca los nombres de color CRUDOS de Tailwind que no son tokens
  // del tema (violet-500, indigo-400…): son la otra forma de agregar un color
  // sin pasar por la paleta.
  if (!hasException(path, 'paleta-cerrada')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      let m;
      RE_CHART_FUERA.lastIndex = 0;
      while ((m = RE_CHART_FUERA.exec(line))) {
        findings.push({ line: i + 1,
          label: `color fuera de la paleta: ${m[0]} — la paleta es CERRADA (DESIGN.md §6)`,
          category: 'paleta-cerrada', text: line.trim().slice(0, 120) });
      }
      RE_CHART_RETIRADO.lastIndex = 0;
      while ((m = RE_CHART_RETIRADO.exec(line))) {
        findings.push({ line: i + 1,
          label: `${m[0]} está retirado — usar \`${CHART_RETIRADOS[m[0]]}\` (DESIGN.md §6)`,
          category: 'chart-retirado', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'color')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      GRAY_RE.lastIndex = 0;
      let m;
      while ((m = GRAY_RE.exec(line))) {
        findings.push({ line: i + 1, label: `color crudo: ${m[0]}`, category: 'color', text: line.trim().slice(0, 120) });
      }
    });
  }

  // F6 de PLAN-IDENTIDAD-2026-07-29 — LA COMPUERTA YA NO SE COMPARTE.
  // Hasta la v2.382.2 esto decía `!hasException('color') && !hasException('white')`,
  // y lo mismo `hex` e `inline-color`: una excepción de `color` apagaba otras tres
  // categorías. El comentario que lo justificaba —"están excepcionados por ser
  // superficies bespoke de color fijo, el mismo motivo vale para su blanco y su
  // hex"— confunde dos cosas distintas. Que una superficie sea de color fijo
  // explica que use `text-white` o una clase de Tailwind cruda; NO explica que
  // lleve un hex que no está en la paleta cerrada. `DashboardView` estaba
  // excepcionado para `color` (panel oscuro, motivo legítimo) y por esa puerta
  // entraron `#12B76A` y `#F79009`, un verde y un ámbar que no existen en la
  // paleta — y nadie los vio nunca, porque el ratchet no cuenta lo que el gate
  // no mira. Cuatro archivos ya listaban `white` aparte teniendo `color`: la
  // herencia no se sostenía ni en su propia lista.
  // Cada categoría chequea SU excepción. Si un archivo necesita las cuatro, se
  // escriben las cuatro, con su motivo.
  if (!hasException(path, 'white')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      WHITE_RE.lastIndex = 0;
      let m;
      while ((m = WHITE_RE.exec(line))) {
        findings.push({ line: i + 1, label: `blanco/negro crudo: ${m[0]}`, category: 'white', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'hex')) {
    lines.forEach((line, i) => {
      if (isComment[i] || !QUOTE_RE.test(line)) return;
      HEX_RE.lastIndex = 0;
      let m;
      while ((m = HEX_RE.exec(line))) {
        findings.push({ line: i + 1, label: `hex crudo: ${m[0]}`, category: 'hex', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'typography')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      TYPE_PX_RE.lastIndex = 0;
      let m;
      while ((m = TYPE_PX_RE.exec(line))) {
        const px = Number(m[1]);
        const label = px < TYPE_FLOOR_PX
          ? `tipografía bajo el piso legible de ${TYPE_FLOOR_PX}px: ${m[0]}`
          : `tamaño a mano, sin token: ${m[0]}`;
        findings.push({ line: i + 1, label, category: 'typography', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'z-index')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      let m;
      Z_ARBITRARY_RE.lastIndex = 0;
      while ((m = Z_ARBITRARY_RE.exec(line))) {
        findings.push({ line: i + 1, label: `z-index arbitrario: ${m[0]}`, category: 'z-index', text: line.trim().slice(0, 120) });
      }
      Z_NUMERIC_RE.lastIndex = 0;
      while ((m = Z_NUMERIC_RE.exec(line))) {
        findings.push({ line: i + 1, label: `z-index sin nombrar: ${m[0]}`, category: 'z-index', text: line.trim().slice(0, 120) });
      }
      Z_INLINE_RE.lastIndex = 0;
      // La llamada `new maps.Marker({…})` suele abrirse varias líneas antes
      // del `zIndex:`, así que se mira una ventana, no la línea sola.
      const zWindow = lines.slice(Math.max(0, i - 6), i + 2).join(' ');
      if (Z_INLINE_RE.test(line) && !Z_INLINE_SKIP_RE.test(zWindow)) {
        findings.push({ line: i + 1, label: 'zIndex inline con valor fijo', category: 'z-index', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── `window.open('')` con `noopener` DEVUELVE null ──────────────────────
  //
  // Por especificación, y medido en Chromium y WebKit. O sea que la ventana se
  // abre en blanco y quien la abrió no tiene con qué escribirle: el papel no
  // sale nunca. Estuvo así en CINCO sitios —las bitácoras del mes, la boleta de
  // pago, la cotización y los dos carnés— y ninguno lo decía: tres se iban por
  // un `if (!win) return`, uno lanzaba sobre `null.document` y el otro culpaba
  // al navegador de haberla bloqueado.
  //
  // Sólo cuenta cuando la URL es vacía o `about:blank`: `window.open(url, …,
  // 'noopener')` está BIEN —la pestaña abre igual y nadie usa el retorno—, que
  // es lo que hacen los enlaces a documentos del portal.
  if (!hasException(path, 'ventana-noopener')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      const m = /window\.open\(\s*(?:''|""|``|['"`]about:blank['"`])\s*[,)]/.exec(line);
      if (!m) return;
      // Los rasgos pueden seguir en la línea siguiente si la llamada se partió.
      const ventana = lines.slice(i, i + 3).join(' ');
      const cierre = ventana.indexOf(')', ventana.indexOf('window.open('));
      const args = cierre === -1 ? ventana : ventana.slice(0, cierre);
      if (!/noopener/.test(args)) return;
      findings.push({
        line: i + 1,
        label: 'window.open(\'\') con `noopener` — devuelve null y el papel no sale nunca',
        category: 'ventana-noopener',
        text: line.trim().slice(0, 120),
      });
    });
  }

  if (!hasException(path, 'inline-color')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      // Se quitan primero los shadow-[…] para no contar dos veces el mismo rgba
      const stripped = line.replace(SHADOW_ARBITRARY_RE, '');
      RGB_LITERAL_RE.lastIndex = 0;
      let m;
      while ((m = RGB_LITERAL_RE.exec(stripped))) {
        findings.push({ line: i + 1, label: `color literal ${m[1]}() fuera de token`, category: 'inline-color', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── Componente usado sin importar ────────────────────────────────────
  // Categoría agregada el 2026-07-27 después de que TRES vistas se fueran
  // comiteadas y pusheadas con un <SegmentedControl> sin su import. Vite
  // compila igual —no resuelve identificadores de JSX en build— así que el
  // error solo aparece al abrir la vista, como pantalla de ErrorBoundary.
  // Fue un bug del migrador, pero la lección es del gate: si el build no lo
  // ve, tiene que verlo alguien más.
  {
    // La lista NO se escribe a mano: sale de los archivos que hay en
    // `components/common/`. Estaba a mano y por eso se quedó atrás — cuando
    // se crearon `FilterBar`, `PeriodStepper` y `ChartContainer` el gate
    // seguía mirando los 16 de la lista vieja, así que un `<FilterBar>` sin
    // import volvía a pasar el lint, el build Y el gate. Un diccionario a
    // mano siempre termina desactualizado; la carpeta no.
    const CANONICOS = [...CANONICOS_COMMON, 'EmptyState', 'Skeleton', 'SkeletonText',
      'DataTable', 'DataRow', 'DataCell', 'AiThinkingState'];
    const imports = lines.filter(l => /^\s*import\b/.test(l)).join('\n');
    // Los comentarios de bloque se descartan ANTES de buscar usos. Un canónico
    // suele documentar cómo se usa con un ejemplo JSX en su propio docstring
    // (`FilterBar` muestra un LiquidSelect adentro), y eso no es un uso real:
    // marcarlo hacía que documentar bien rompiera el gate. Detectado el
    // 2026-07-27 al crear `FilterBar`. Se blanquean en vez de borrarse para no
    // correr los números de línea de los hallazgos que sí valen.
    // ── También los de `//`, y sin comerse el archivo ────────────────────
    // Este blanqueaba sólo `/* */`, así que una mención en prosa dentro de un
    // comentario de línea —«las iniciales se fueron con el `<LiquidAvatar>`
    // suelto»— se contaba como un USO sin importar, o sea un error inventado
    // sobre código correcto. Y arrastraba el otro defecto: `accept="image/*"`
    // tiene un `/*` DENTRO de una cadena y el regex lo tomaba por comentario.
    const sinComentarios = blanquearComentarios(text);
    const lineasSC = sinComentarios.split('\n');
    for (const comp of CANONICOS) {
      const uso = new RegExp(`<${comp}[\\s/>]`);
      if (!uso.test(sinComentarios)) continue;
      const importado = new RegExp(`\\b${comp}\\b`).test(imports);
      const definido = new RegExp(`^(?:export\\s+)?(?:const|function)\\s+${comp}\\b`, 'm').test(text);
      if (importado || definido) continue;
      const i = lineasSC.findIndex(l => uso.test(l));
      findings.push({ line: i + 1, label: `<${comp}> usado sin importar — el build NO lo detecta`,
        category: 'import', text: (lines[i] || '').trim().slice(0, 120) });
    }
  }

  // ── `iconOnly` sin `icon=`: un botón que no dibuja nada ───────────────
  // Categoría agregada el 2026-09-03. `Button` no renderiza sus `children`
  // cuando lleva `iconOnly` —la línea es `{!iconOnly && <span>…}`, y es a
  // propósito: ahí los hijos son el RÓTULO, que la hoja de acciones recupera
  // aparte—. Así que un ícono pasado como HIJO no se dibuja y queda un
  // cuadro vacío que igual se puede apretar.
  //
  // Lo reportó el usuario mirando el aviso de borrador de la salida de
  // efectivo: «el botón x de borrar no se ve, sólo se ve un cuadro». Estaba
  // en `AvisoDeBorrador`, que es el canónico — o sea en TODOS los avisos de
  // borrador del portal, y era la única forma de descartar lo guardado.
  //
  // No falla el build, no falla el lint y no falla en tiempo de ejecución:
  // el botón existe, responde y está vacío. Sólo se ve mirándolo.
  {
    const sinComentarios = blanquearComentarios(text);
    const BOTON = /<Button\b((?:[^>]|\n)*?)(\/>|>)/g;
    let m;
    while ((m = BOTON.exec(sinComentarios)) !== null) {
      const attrs = m[1];
      if (!/\biconOnly\b/.test(attrs)) continue;
      // `icon={…}` o `loading` alcanzan: los dos dibujan algo.
      if (/\bicon\s*=/.test(attrs) || /\bloading\b/.test(attrs)) continue;
      const line = sinComentarios.slice(0, m.index).split('\n').length;
      findings.push({ line, label: '<Button iconOnly> sin `icon=` — se dibuja un cuadro vacío',
        category: 'boton-sin-icono', text: (lines[line - 1] || '').trim().slice(0, 120) });
    }
  }

  // ── El editor abierto dos veces sobre la misma foto ───────────────────
  // Categoría agregada el 2026-09-03. Una pantalla puede apagar el editor
  // del canónico (`conEditor={false}`) y abrir el suyo, con el tipo de papel
  // que sabe que va a recibir — hay tres así. Pero entonces tiene que mirar
  // el `yaPreparado` de `onChange`: cuando la foto llegó del teléfono ya se
  // recortó, se enderezó y se le dio el acabado allá, y volver a abrir el
  // editor es pedir dos veces el mismo trabajo sobre una foto que alguien ya
  // cuadró.
  //
  // Lo reportó el usuario: «si ya en el teléfono cuadré y confirmé la foto,
  // al mandarla, en la computadora me vuelve a pedir que la cuadre». Pasaba
  // en los TRES. `FileField` ya evitaba abrir el SUYO desde la v2.842.0 —el
  // dato existía— y lo perdía al llamar a `onChange` sin decirlo.
  //
  // No falla nada: la foto se guarda bien. Sólo cuesta el trabajo de la
  // persona, dos veces, y sólo se ve usándolo con un teléfono en la mano.
  {
    const sinComentarios = blanquearComentarios(text);
    if (/<FileField\b/.test(sinComentarios)
        && /\bconEditor\s*=\s*\{\s*false\s*\}/.test(sinComentarios)
        && /\b(EditorDeDocumento|PhotoEditorModal)\b/.test(sinComentarios)
        && !/\byaPreparado\b/.test(sinComentarios)) {
      const i = lines.findIndex(l => /\bconEditor\s*=\s*\{\s*false\s*\}/.test(l));
      findings.push({ line: i + 1,
        label: 'abre su propio editor y no mira `yaPreparado` — la foto del teléfono se cuadra dos veces',
        category: 'editor-dos-veces', text: (lines[i] || '').trim().slice(0, 120) });
    }
  }

  if (!hasException(path, 'inert')) {
    lines.forEach((line, i) => {
      if (isComment[i] || /group-hover:opacity|hover:opacity-100/.test(line)) return;
      // el ternario puede abrirse en esta línea y cerrarse más abajo: se mira
      // la línea y su vecina para no perder los que están partidos
      const chunk = line + '\n' + (lines[i + 1] || '');
      INERT_RE.lastIndex = 0;
      let m;
      while ((m = INERT_RE.exec(chunk))) {
        // el ternario debe EMPEZAR en esta línea; si arranca en la siguiente
        // ya se reportará en su propia pasada (si no, salía duplicado)
        if (m.index >= line.length) continue;
        const branches = m[0].match(HIDDEN_BRANCH) || [];
        // el colapso no siempre usa pointer-events-none: también h-0, w-0,
        // max-w-0, max-h-0 y scale-0. Los tres idiomas aparecieron uno tras
        // otro al verificar; el gate cubre los cinco.
        const oculta = branches.filter(b => b.includes('opacity-0')
          && /\b(pointer-events-none|h-0|w-0|max-w-0|max-h-0|scale-0)\b/.test(b)
          && !/group-hover(\/[\w-]+)?:opacity-100/.test(b));  // eso es un reveal, no un colapso
        if (oculta.length !== 1) continue;
        // ¿ya está resuelto? Vale `inert` en la etiqueta contenedora, y vale
        // también `tabIndex={cond ? 0 : -1}` sobre el propio control — que es
        // como lo hace SearchInput y es igual de correcto para un elemento
        // único. Se mira la etiqueta completa, no solo la línea.
        const back = lines.slice(Math.max(0, i - 6), i + 2).join('\n');
        if (/\binert=/.test(back) || /tabIndex=\{[^}]*-1/.test(back)) continue;
        findings.push({ line: i + 1, label: 'región colapsada sin `inert` — se tabula dentro de lo invisible (WCAG 2.4.3)', category: 'inert', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'ring')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      for (const [re, label] of [
        [RING_FOCUS_RE, 'aro de foco a mano — el canónico de index.css ya lo pinta'],
        [RING_KILL_RE, 'focus:outline-none APAGA el aro de foco canónico (WCAG 2.4.7)'],
        [RING_ALPHA_RE, 'alpha de aro fuera del canon (/30 en 1px, /45 en 2px)'],
      ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          findings.push({ line: i + 1, label, category: 'ring', text: line.trim().slice(0, 120) });
        }
      }
    });
  }

  if (!hasException(path, 'shadow-literal')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      SHADOW_LITERAL_RE.lastIndex = 0;
      let m;
      while ((m = SHADOW_LITERAL_RE.exec(line))) {
        findings.push({ line: i + 1, label: 'sombra literal fuera de la escala --shadow-*', category: 'shadow-literal', text: line.trim().slice(0, 120) });
      }
    });
  }

  // El chequeo de motion corre sobre el texto SIN COMENTARIOS: los ejemplos de
  // uso en el JSDoc de MotionProvider/useMotionConfig contienen `motion.div` y
  // se marcaban a sí mismos. El resto del gate ya usaba commentMask por línea;
  // esta familia la salteaba por trabajar sobre el archivo entero.
  const codeOnly = lines.filter((_, i) => !isComment[i]).join('\n');
  if (!hasException(path, 'motion') && MOTION_IMPORT_RE.test(codeOnly)) {
    if (!MOTION_ALLOWED_RE.test(codeOnly)) {
      findings.push({ line: 1, label: 'framer-motion decorativo (sin AnimatePresence/layout/drag) — usar @keyframes + Tailwind', category: 'motion', text: path });
    }
    // El chequeo por archivo de `useReducedMotion` se retiró en D2.4: ahora
    // <MotionProvider reducedMotion="user"> lo resuelve para TODO el árbol
    // (src/components/MotionProvider.jsx, montado en main.jsx). Exigirlo
    // archivo por archivo sería cargo-cult — la preferencia ya se respeta,
    // y cualquier motion.* nuevo queda cubierto sin que su autor haga nada.
  }

  // ── `lift-clavado` (2026-08-01) ───────────────────────────────────────
  // Una superficie `data-surface="card"` YA se levanta sola: el canónico de
  // `index.css` le aplica `transform: translateY(var(--lift-card))`. Agregarle
  // además un `hover:-translate-y-*` de Tailwind no la reemplaza — **la suma**.
  // En Tailwind v4 esas clases compilan a la propiedad `translate`, que es
  // DISTINTA de `transform`, así que las dos aplican y el desplazamiento se
  // acumula. Medido el 2026-08-01 sobre el mismo elemento, quitándole la clase:
  // 4.00px con ella, 2.00px sin ella. Eran 11 tarjetas moviéndose entre 3 y 6px
  // mientras la de al lado se movía 2 — y encima `translate` no está en la
  // transición del canónico, así que ese sobrante saltaba sin animar.
  //
  // La regla ya estaba escrita en DESIGN.md §5 ("nunca clavar el número"), que
  // es exactamente el tipo de regla que se rompe sola si nada la verifica.
  // Bloqueante en cero desde que se corrigieron las 11.
  if (!hasException(path, 'lift-clavado') && /\.jsx$/.test(path)) {
    // (a) La tarjeta que ya se levanta sola y encima trae un lift a mano.
    //     `data-surface` se acepta literal Y dinámico (`={x ? 'card' : …}`):
    //     `EmployeeProfileView` lo tenía condicional, así que la MISMA fila se
    //     movía 4px o 2px según la fecha.
    //
    //     La etiqueta de apertura se delimita con un escáner que respeta
    //     llaves y comillas, NO con `[^>]*?…>`: ese regex corta en el primer
    //     `>`, que dentro de un tag aparece en cualquier `=>` o `===`. Por eso
    //     dejó pasar `AnnouncementsView` —una tarjeta con lift a mano— y el
    //     gate daba verde con el bug adentro.
    const CARD_ATTR = /data-surface=(?:"card"|\{[^}]*'card'[^}]*\})/g;
    let m;
    while ((m = CARD_ATTR.exec(text))) {
      const tag = tagQueContiene(text, m.index);
      if (!tag) continue;
      const clases = tag.texto.match(
        /(?<![\w-])hover:-translate-y-(?:\[[^\]]+\]|[\w.]+)|(?<![\w-])hover:translate-y-\[var\(--lift-[a-z]+\)\]|(?<![\w-])hover:scale-[^\s"'`}]+/g);
      if (!clases) continue;
      const linea = text.slice(0, tag.ini).split('\n').length;
      if (isComment[linea - 1]) continue;
      findings.push({
        line: linea,
        label: `\`${clases[0]}\` sobre una tarjeta que YA se levanta con \`--lift-card\` — se SUMAN (DESIGN.md §5)`,
        category: 'lift-clavado',
        text: tag.texto.replace(/\s+/g, ' ').slice(0, 120),
      });
    }

    // (b) CUALQUIER lift propio con el número clavado, en control o superficie.
    //     Barridos los 79 el 2026-08-02 (v2.341.0): iban de 1px a 8px sin pasar
    //     por ningún token, así que dos botones hermanos se movían distinto y
    //     ningún tema podía apagarlos —la neutralización de Solid los alcanza
    //     por el nombre de la clase, pero eso es un parche, no el patrón.
    //
    //     `group-hover:` queda FUERA a propósito: mueve a un HIJO y no toca la
    //     caja de hit-testing del padre, así que no es un lift sino una
    //     animación decorativa (un ícono que sube dentro de la tarjeta). Son 14
    //     y tienen sus propios valores por buenas razones.
    const LIFT_CLAVADO = /(?<![\w-])hover:-translate-y-(?:\[[^\]]+\]|[\w.]+)/g;
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      LIFT_CLAVADO.lastIndex = 0;
      let mm;
      while ((mm = LIFT_CLAVADO.exec(line))) {
        findings.push({
          line: i + 1,
          label: `\`${mm[0]}\` con el número clavado — \`hover:translate-y-[var(--lift-card)]\` en una superficie, \`var(--lift-hover)\` en un control (DESIGN.md §2/§5)`,
          category: 'lift-clavado',
          text: line.trim().slice(0, 120),
        });
      }
    });
  }

  // ── `capa-flotante` (2026-08-01) ──────────────────────────────────────
  // Un menú/popover ANCLADO a un disparador se dibuja por portal encima del
  // contenido, pero el contenido sigue recibiendo el puntero: al moverse sobre
  // el menú, la tarjeta que quedó debajo entra y sale de `:hover`, y como
  // `[data-surface="card"]` se levanta 2px, salta un bloque de media pantalla.
  // Medido cruzando el borde del menú de a 2px en el tablero: la tarjeta de
  // 532×256 de atrás pasaba de dy=-2 a dy=0. Se corrige con `useCapaFlotante`
  // (`src/utils/capaFlotante.js`), y esto es lo que impide que el próximo
  // flotante se olvide — que es exactamente cómo se acumuló esta deuda.
  //
  // La firma estructural del flotante ANCLADO son las tres cosas juntas:
  // `createPortal` + `document.body` (sale del árbol) + `getBoundingClientRect`
  // (se posiciona contra un disparador). Un modal centrado no mide un
  // disparador, así que no entra solo.
  //
  // Ya cubierto y por eso exento: `ModalShell` y quien lo use (su velo real
  // tapa el fondo), y quien traiga su propio velo `fixed inset-0`. El resto de
  // los tooltips van en EXCEPTIONS con su motivo escrito, no detectados por
  // heurística: un archivo puede tener un tooltip Y un menú —`DashboardView`
  // tiene los dos— así que exentar por "contiene un tooltip" dejaría pasar el
  // menú de al lado.
  if (!hasException(path, 'capa-flotante') &&
      /\.jsx?$/.test(path) &&
      text.includes('createPortal') &&
      text.includes('document.body') &&
      text.includes('getBoundingClientRect') &&
      !text.includes('useCapaFlotante') &&
      !text.includes('ModalShell') &&
      !text.includes('fixed inset-0')) {
    const linea = lines.findIndex((l, i) => !isComment[i] && l.includes('createPortal')) + 1;
    findings.push({
      line: linea || 1,
      label: 'flotante anclado sin `useCapaFlotante` — lo de atrás sigue reaccionando al puntero (DESIGN.md §5.2)',
      category: 'capa-flotante',
      text: path,
    });
  }

  if (!hasException(path, 'search-toggle') && !text.includes('useSearchToggle')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      SEARCH_TOGGLE_STATE_RE.lastIndex = 0;
      let m;
      while ((m = SEARCH_TOGGLE_STATE_RE.exec(line))) {
        findings.push({ line: i + 1, label: `buscador toggleable "${m[1]}" sin useSearchToggle`, category: 'search-toggle', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── `input-label` (2026-07-28) ────────────────────────────────────────
  // Un `<input>` de texto sin NINGÚN nombre accesible —ni `aria-label`, ni
  // `aria-labelledby`, ni `id` (que un `<label htmlFor>` pueda referenciar),
  // ni `placeholder`, ni `title`— se anuncia como "campo de edición" y nada
  // más (WCAG 4.1.2 y 3.3.2). Medido el 2026-07-28: **73**, y los peores en
  // los formularios de RRHH y nómina, donde el campo sin nombre es el que
  // decide cuánto cobra alguien.
  //
  // El `placeholder` cuenta a regañadientes: es lo que hoy sostiene la mayoría
  // de estos campos, y desaparece al escribir. Pedir `aria-label` en los ~200
  // que ya lo usan sería otra migración; esto ataca el caso en que NO HAY
  // NADA.
  if (!hasException(path, 'input-label')) {
    // Cada `<input …>` completo, aunque abarque varias líneas.
    // Se blanquean los TRES tipos de comentario, incluido `//`. Sin ese
    // último, seis menciones de `<input>` en prosa —"reemplaza el <input> que
    // simulaba tecleo"— se contaban como campos sin nombre. Es la misma trampa
    // que ya costó dos conteos de botones.
    const sinComentarios2 = blanquearComentarios(text);
    // OJO: NO vale `/<input\b[^>]*>/`. La primera `>` de un `<input>` suele ser
    // la flecha de `onChange={e => …}`, así que la etiqueta queda cortada antes
    // del `placeholder` y el gate reporta campos que sí tienen nombre. Es el
    // mismo error que tenía el clasificador de botones, encontrado el mismo día:
    // hay que buscar el `>` de cierre contando llaves.
    const finEtiqueta = (txt, desde) => {
      let prof = 0;
      for (let k = desde; k < txt.length; k++) {
        const c = txt[k];
        if (c === '{') prof++;
        else if (c === '}') prof--;
        else if (c === '>' && prof === 0 && txt[k - 1] !== '=') return k + 1;
      }
      return txt.length;
    };
    const RE_INPUT = /<input\b/g;
    let mi;
    while ((mi = RE_INPUT.exec(sinComentarios2))) {
      const tag = sinComentarios2.slice(mi.index, finEtiqueta(sinComentarios2, mi.index));
      const tipo = (tag.match(/type=["'{\s]*([a-z]+)/) || [, 'text'])[1];
      if (['checkbox', 'radio', 'range', 'color', 'hidden', 'file'].includes(tipo)) continue;
      if (/aria-label|aria-labelledby|\bid=|placeholder=|\btitle=/.test(tag)) continue;
      const linea = sinComentarios2.slice(0, mi.index).split('\n').length;
      findings.push({ line: linea, label: 'input de texto sin nombre accesible (WCAG 4.1.2) — falta aria-label',
        category: 'input-label', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
    }


    // ── `chip-a-mano` (2026-07-28, D3.5) ────────────────────────────────
    // Un `<span>` con relleno horizontal + radio + texto chico en negrita es
    // un chip, y el chip es `Badge`. Medidos al empezar: 101 en 49 archivos,
    // con CUATRO radios para una sola idea (full 62 · md 30 · lg 14 · xl 4).
    //
    // Va con ratchet, no en cero: la cola es larga y plana (1-2 por archivo)
    // y un gate permanentemente rojo no lo mira nadie. Lo que importa es que
    // **no suba**.
    //
    // NO marca: los que envuelven otro elemento (no son chips de texto) ni
    // los contadores, que son `Contador` y tienen ancho mínimo fijo.
    if (!hasException(path, 'chip-a-mano')) {
      const RE_SPAN = /<span\b/g;
      let ms;
      while ((ms = RE_SPAN.exec(sinComentarios2))) {
        const abre = sinComentarios2.slice(ms.index, finEtiqueta(sinComentarios2, ms.index));
        const cls = (abre.match(/className=\{?(`[^`]*`|"[^"]*")/) || [])[1] || '';
        if (!/\bpx-[\d.]+/.test(cls)) continue;
        if (!/\brounded-/.test(cls)) continue;
        if (!/text-(micro|caption|label)\b/.test(cls)) continue;
        if (!/font-(black|bold)\b/.test(cls)) continue;
        if (/min-w-\[/.test(cls)) continue;            // eso es `Contador`
        const linea = sinComentarios2.slice(0, ms.index).split('\n').length;
        findings.push({ line: linea, label: 'chip escrito a mano — usar `Badge` (DESIGN.md §16)',
          category: 'chip-a-mano', text: abre.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `select-con-envoltorio` (2026-07-29) ────────────────────────────
    // Un `<div>` con altura fija que envuelve a `LiquidSelect` para pintarle
    // borde, fondo o estado de error. El canónico YA se pinta entero
    // (`data-surface="input"` + `min-h-[max(40px,var(--tap-min))]`), así que
    // el envoltorio no aporta nada y además ROMPE: medido en el navegador,
    // el div daba 40px de alto y 10px de radio contra los 46px y 8px del
    // control real, y su fondo asomaba alrededor — el select se veía cortado.
    // Eran 35 sitios en 5 formularios (v2.219.0). El estado de error va en la
    // prop `invalid` del propio LiquidSelect.
    //
    // Detecta por la FORMA (div con h-[Npx] o h-N que contiene un
    // LiquidSelect), no por la clase exacta: `FormRehireEmployee` usaba un
    // alias local `inputHover` y otra cadena de error, y un grep por
    // `inputHoverClass` se lo habría saltado — que es justo cómo se escapan
    // los casos en una migración a mano.
    if (!hasException(path, 'select-con-envoltorio')) {
      const RE_DIV = /<div\b[^>]*className=\{?(?:`[^`]*`|"[^"]*")/g;
      let md;
      while ((md = RE_DIV.exec(sinComentarios2))) {
        const abre = md[0];
        if (!/\bh-\[\d+px\]|\bh-\d+\b/.test(abre)) continue;
        // ¿hay un LiquidSelect antes del siguiente <div de apertura?
        const resto = sinComentarios2.slice(md.index + abre.length, md.index + abre.length + 700);
        const hastaOtroDiv = resto.split(/<div\b/)[0];
        if (!/<LiquidSelect\b/.test(hastaOtroDiv)) continue;
        const linea = sinComentarios2.slice(0, md.index).split('\n').length;
        findings.push({ line: linea,
          label: 'LiquidSelect envuelto en un div de alto fijo — el canónico ya se pinta solo; el error va en `invalid`',
          category: 'select-con-envoltorio', text: abre.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `relleno-sin-solid` (2026-07-29) ────────────────────────────────
    // `text-white` sobre un relleno de color que NO es el token `-solid`.
    // Es la regla que N2 dejó escrita en DESIGN.md §6 —teñido usa
    // `bg-X/10 + text-X-text`, sólido usa `bg-X-solid + text-white`— y que
    // nadie verificaba. El 2026-07-29 el escáner de contraste encontró dos
    // botones a **4.23:1** (AA pide 4.5) y al abrirlos el defecto estaba en
    // los CANÓNICOS: `Button.TONE_CLASSES` usaba `bg-chart-N` crudo para las
    // seis tonalidades de gráfico, y `SegmentedControl` estaba migrado a
    // medias (chart-3/8/9 con `-solid`, chart-1/4/6 sin él). 82 usos de
    // `tone="chart-N"` en el portal renderizaban blanco bajo AA.
    // El par se evalúa POR VARIANTE, no sobre la cadena entera: el patrón
    // correcto y muy usado es `bg-danger/10 text-danger hover:bg-danger-solid
    // hover:text-white` — teñido en reposo, sólido al pasar el mouse. Mirando
    // la cadena completa eso da un falso positivo (fue el primer intento de
    // esta regla: 15 hallazgos, los 15 falsos).
    if (!hasException(path, 'relleno-sin-solid')) {
      const RE_CLS = /className=\{?(?:`([^`]*)`|"([^"]*)")/g;
      let mc;
      while ((mc = RE_CLS.exec(sinComentarios2))) {
        const cls = mc[1] || mc[2] || '';
        if (!/text-white\b/.test(cls)) continue;

        // Un `className` con ternario NO renderiza sus dos ramas a la vez.
        // Evaluarlas juntas cruza el `text-white` de una con el relleno de la
        // otra y da falsos positivos (pasó con StaffManagementView, cuya rama
        // "cumpleaños" ya usaba `-solid`). Lo que se renderiza de verdad es
        // «lo literal + UNA rama», así que se arma ese conjunto por rama.
        const literal = cls.replace(/\$\{[^}]*\}/g, ' ');
        const ramas = [...cls.matchAll(/\$\{[^}]*\}/g)]
          .flatMap(m => [...m[0].matchAll(/['"`]([^'"`]*)['"`]/g)].map(q => q[1]));
        const conjuntos = ramas.length ? ramas.map(r => `${literal} ${r}`) : [literal];
        // Los `className` con ternario llegan acá como texto crudo del template
        // literal, con las clases entrecomilladas dentro del `${…}`. Sin limpiar
        // eso, `'bg-danger hover:bg-danger-hover'` no matcheaba y el botón de
        // confirmar de `ConfirmModal` —blanco sobre danger, 3.76:1— se escapó de
        // la primera versión de esta regla.
        // OJO: no se toca el `:` — es el separador de variante, y borrarlo
        // convertía `hover:text-white` en `text-white` de base, marcando como
        // error el patrón CORRECTO (`bg-X/10 text-X-text hover:bg-X-solid
        // hover:text-white`). Se limpia solo la sintaxis del template.
        // OJO: no se toca el `:` — es el separador de variante, y borrarlo
        // convertía `hover:text-white` en `text-white` de base, marcando como
        // error el patrón CORRECTO (`bg-X/10 text-X-text hover:bg-X-solid
        // hover:text-white`).
        let reportado = null;
        for (const conjunto of conjuntos) {
          const porVariante = new Map();
          for (const tok of conjunto.split(/\s+/)) {
            const i = tok.lastIndexOf(':');
            const variante = i === -1 ? '' : tok.slice(0, i);
            const util = i === -1 ? tok : tok.slice(i + 1);
            const g = porVariante.get(variante) || { blanco: false, rellenos: [] };
            if (util === 'text-white') g.blanco = true;
            const mb = util.match(/^bg-(chart-\d|success|warning|danger)(?!-solid)(?:\/\[?[\d.]+\]?)?$/);
            if (mb) g.rellenos.push(mb[1]);
            porVariante.set(variante, g);
          }
          for (const [variante, g] of porVariante) {
            if (!g.blanco || !g.rellenos.length || reportado) continue;
            reportado = { variante, relleno: g.rellenos[0] };
          }
        }
        if (reportado) {
          const pref = reportado.variante ? `${reportado.variante}:` : '';
          const linea = sinComentarios2.slice(0, mc.index).split('\n').length;
          findings.push({ line: linea, label: `\`${pref}text-white\` sobre \`${pref}bg-${reportado.relleno}\` — el relleno sólido usa \`-solid\` (DESIGN.md §6)`,
            category: 'relleno-sin-solid', text: cls.replace(/\s+/g, ' ').slice(0, 110) });
        }
      }
    }

    // ── `celda-a-mano` (2026-07-29, F4/A1) ──────────────────────────────
    // Un `<td>` crudo DENTRO de un `<DataRow>`. Es lo que impedía que la
    // densidad llegara a la fila: `DataCell` es quien pone `h-[var(--row-h)]`
    // y el `data-cell` del que cuelga el interlineado denso; un `<td>` a mano
    // trae su propio `py-3` y deja la fila en 71px cuando --row-h pide 32
    // (medido en /pedidos, TabGenerar.jsx).
    //
    // El alcance es DELIBERADAMENTE estrecho: solo dentro de `<DataRow>`. Hay
    // 224 `<td>` más en el portal y **no son deuda** — son plantillas de
    // impresión (la boleta de PayrollView), sub-tablas dentro de una tarjeta
    // (que DESIGN.md §14 prohíbe que sean `DataTable`) y calendarios. Contar
    // "todos los <td>" habría dado 229 y mandado a migrar 224 cosas que están
    // bien; contar por estructura da 5, que era el número real.
    {
      const RE_ROW = /<DataRow\b/g;
      let mr;
      while ((mr = RE_ROW.exec(sinComentarios2))) {
        const fin = sinComentarios2.indexOf('</DataRow>', mr.index);
        if (fin === -1) continue;
        const bloque = sinComentarios2.slice(mr.index, fin);
        const RE_TD = /<td\b/g;
        let mt;
        while ((mt = RE_TD.exec(bloque))) {
          const linea = sinComentarios2.slice(0, mr.index + mt.index).split('\n').length;
          findings.push({ line: linea, label: '`<td>` a mano dentro de `<DataRow>` — usar `DataCell` (DESIGN.md §14)',
            category: 'celda-a-mano', text: bloque.slice(mt.index, mt.index + 90).replace(/\s+/g, ' ') });
        }
      }
    }

    // ── `input-a-mano` (2026-07-28, D3.4) ───────────────────────────────
    // Un `<input>` de texto fuera de `PortalInput`. El canónico ya reenvía
    // props desde v2.115.0, así que migrar dejó de perder `min`/`max`/`step`
    // y los `aria-label`. Ratchet por el mismo motivo que el anterior.
    //
    // NO marca: checkbox/radio (esos son `Checkbox`), ni los que viven dentro
    // de `components/common/` (ahí están los canónicos mismos).
    if (!hasException(path, 'input-a-mano') && !path.includes('components/common/')) {
      const RE_IN = /<input\b/g;
      let mi2;
      while ((mi2 = RE_IN.exec(sinComentarios2))) {
        const tag = sinComentarios2.slice(mi2.index, finEtiqueta(sinComentarios2, mi2.index));
        const tipo = (tag.match(/type=["'{\s]*([a-z]+)/) || [, 'text'])[1];
        if (['checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes(tipo)) continue;
        const linea = sinComentarios2.slice(0, mi2.index).split('\n').length;
        findings.push({ line: linea, label: 'input fuera de `PortalInput` (DESIGN.md §15)',
          category: 'input-a-mano', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `foto-sin-aro` (2026-08-26, CERO ABSOLUTO) ──────────────────────
    // La foto de una persona se pinta con `AvatarConEstado`, nunca con
    // `LiquidAvatar` suelto.
    //
    // Regla del usuario, dicha en una línea: *«todo lugar que muestre quién lo
    // hizo (nombre + apellido) debe llevar foto, y por lo tanto aro. O donde
    // esté sólo la foto por alguna razón, aro.»*
    //
    // El aro dice si esa persona está —de vacaciones, incapacitada, con
    // permiso— y `LiquidAvatar` es la primitiva que sólo sabe pintar la imagen.
    // Mientras cada pantalla armaba el suyo, el estado aparecía en unas y en
    // otras no **sin que nada fallara**: no hay error, no falta ninguna fila, y
    // sólo se nota cuando alguien busca a quien no está. Ese silencio es la
    // razón del gate — el 2026-08-26 eran 5 archivos con aro y 21 sin él, y la
    // diferencia no se podía ver desde ningún lado.
    //
    // Empieza en CERO y es bloqueante: la migración de los 21 se hizo el mismo
    // día, así que no hay deuda que heredar. Lo que este detector protege no es
    // el pasado, es la pantalla número 27.
    //
    // ── El detector mira la FOTO, no el componente ──────────────────────
    //
    // La primera versión buscaba sólo `<LiquidAvatar`, y llegó a cero el mismo
    // día. El usuario preguntó *«¿quedó canónico? ¿completamente?»* y la
    // respuesta medida fue que no: había **nueve** fotos de persona pintadas
    // con un `<img>` a mano —los selectores de empleado de cargos, sucursales y
    // relevos, el aviso, quién retira el efectivo— y ninguna las veía. El
    // sidebar hacía exactamente eso antes de migrarlo, así que no era un caso
    // hipotético: era el patrón que ya existía.
    //
    // Es la lección de `tarjeta-a-mano` otra vez —llegó a cero en julio y
    // siguió en verde mientras un censo a mano encontraba 81 casos vivos—: un
    // detector que mira UNA de las formas del defecto certifica la ausencia de
    // esa forma, no la del defecto.
    //
    // Así que hay dos reglas. La primitiva suelta, y el `<img>` cuyo `src`
    // nombra la foto de alguien. Lo segundo se reconoce por el nombre del
    // campo, que en este repo es estable: `photo`, `photo_url`, `foto`,
    // `avatar`, o pasado por `webpSignedUrl`.
    //
    // NO marca un `<img>` de un comprobante, una etiqueta o una evidencia
    // —`foto.url` de un vale, por ejemplo— porque ahí no hay ninguna persona
    // cuyo estado se pueda decir. La diferencia la da el campo, no la palabra.
    if (!path.includes('components/common/AvatarConEstado') && !hasException(path, 'foto-sin-aro')) {
      const marcar = (indice, texto) => findings.push({
        line: sinComentarios2.slice(0, indice).split('\n').length,
        label: 'foto de persona sin aro de estado — usar `AvatarConEstado` (DESIGN.md §5.4)',
        category: 'foto-sin-aro', text: texto.replace(/\s+/g, ' ').slice(0, 120),
      });

      let mi3;
      const usoDirecto = /<LiquidAvatar\b/g;
      while ((mi3 = usoDirecto.exec(sinComentarios2))) marcar(mi3.index, '<LiquidAvatar');

      // `foto.url` / `foto?.url` quedan fuera: son el comprobante de un vale,
      // no la cara de nadie. Se descartan antes de mirar el resto.
      const FOTO_DE_PERSONA = /\b(photo|photo_url|photoPreview|foto|avatar|profilePicture)\b|webpSignedUrl\s*\(/;
      const imgs = /<img\b[^>]*>/g;
      while ((mi3 = imgs.exec(sinComentarios2))) {
        const tag = mi3[0];
        const src = (tag.match(/src=\{([^}]*)\}/) || [, ''])[1];
        if (!src || !FOTO_DE_PERSONA.test(src)) continue;
        if (/\bfotos?\s*\??\.\s*url\b|\bevidencia|comprobante|etiqueta/i.test(src)) continue;
        marcar(mi3.index, tag);
      }

      // ── `foto-condicionada`, la tercera forma (2026-09-03) ─────────────
      //
      // Usar `AvatarConEstado` no alcanza si la vista decide ANTES si vale la
      // pena llamarlo:
      //
      //     {emp.photo ? <AvatarConEstado emp={emp} …/> : <CircleUserRound/>}
      //
      // Eso pregunta por un dato que el componente sabe buscar solo —desde el
      // 3-sep resuelve la foto contra el store, igual que el estado— y contesta
      // que no antes de dejarlo intentar. Se pierden las dos cosas: la cara de
      // quien la tiene cargada pero llegó en un objeto sin ese campo, y **el
      // aro**, que es justo lo que esta categoría existe para garantizar. Con
      // el aro adentro del `then` de la condición, `foto-sin-aro` da verde
      // sobre una pantalla donde el aro no aparece nunca.
      //
      // Eran **16 sitios** el día que se escribió, y ninguno estaba mal
      // intencionado: todos rehacían a mano el respaldo que `LiquidAvatar` ya
      // hace —la inicial—, y tres lo hacían PEOR, cambiando la persona por un
      // ícono genérico (un camión, un `CircleUserRound`) que no la nombra.
      //
      // La condición legítima es sobre la PERSONA (`{emp ? <Avatar/> : …}`),
      // nunca sobre su foto: si no hay persona no hay nada que pintar, y si la
      // hay, quien decide es el componente.
      //
      // ── La ventana va por LÍNEAS, y esto ya costó un hallazgo ──────────
      // El primer barrido midió 40 caracteres entre la condición y el `?`. En
      // este repo la indentación sola son 64, así que se le escapó un sitio de
      // `VacationPlanView` — y el número que reportó, 15, se veía completo.
      const CAMPO_FOTO = /\b\w+\s*\??\.\s*(photo|photo_url|photoPreview|foto|avatar|profilePicture)\b/;
      const lineas = sinComentarios2.split('\n');
      lineas.forEach((linea, i) => {
        if (!/<AvatarConEstado\b/.test(linea)) return;
        const ventana = lineas.slice(Math.max(0, i - 5), i + 1).join('\n');
        const cond = ventana.slice(0, ventana.lastIndexOf('<AvatarConEstado'));
        if (!CAMPO_FOTO.test(cond)) return;
        // Sólo si ese campo es lo que DECIDE: un `?` o un `&&` entre la
        // lectura de la foto y el avatar.
        if (!/(\?|&&)[^<]*$/.test(cond)) return;
        findings.push({
          line: i + 1,
          label: 'la foto decide si se pinta el avatar — condicionar sobre la PERSONA, no sobre `photo` (DESIGN.md §5.4)',
          category: 'foto-condicionada', text: linea.trim().slice(0, 120),
        });
      });

      // ── `foto-sin-identidad`, la cuarta forma (2026-09-03) ─────────────
      //
      // Una persona armada a mano SIN su `id`. Sin id `AvatarConEstado` no
      // tiene a quién buscar —ni en el padrón ni preguntándole a la base—, así
      // que la cara puede salir y **el aro no sale nunca**.
      //
      // Y es el silencio más limpio de los cuatro: una firma sin aro se ve
      // EXACTAMENTE igual que la de alguien que está presente. No hay hueco,
      // no hay ícono raro, no hay error. Sólo falta un dato que nadie mira.
      //
      // El caso que lo fundó: las firmas de bitácoras. La RPC ya devolvía
      // `registrado_por` y `realizada_por` —los ids—, la pantalla armaba
      // `{ nombre, nombres, apellidos, foto }` y `Firma` los copiaba a un
      // objeto nuevo. Dos objetos escritos a mano, y el dato estaba en la fila
      // desde el día uno. Su propio comentario ya advertía que «un objeto
      // armado a mano que se olvida la clave no falla»; se lo dijo de `foto` y
      // le pasó con `id`.
      //
      // Sólo mira literales —lo único decidible desde el fuente— y sólo si el
      // objeto NOMBRA a alguien: un `{ photo }` suelto no es una persona.
      const NOMBRA_PERSONA = /\b(name|nombre|first_names|last_names|nombres|apellidos)\s*:/;
      const PROPS_PERSONA = /\b(emp|persona|quien|employee|firmante|autor|responsable)\s*=\s*\{\{/g;
      let mi4;
      while ((mi4 = PROPS_PERSONA.exec(sinComentarios2))) {
        const abre = mi4.index + mi4[0].length - 1;
        let d = 0, fin = -1;
        for (let j = abre; j < sinComentarios2.length; j++) {
          if (sinComentarios2[j] === '{') d++;
          else if (sinComentarios2[j] === '}') { d--; if (!d) { fin = j; break; } }
        }
        if (fin < 0) continue;
        const cuerpo = sinComentarios2.slice(abre + 1, fin);
        if (!NOMBRA_PERSONA.test(cuerpo)) continue;
        if (/\bid\s*[:,}]/.test(cuerpo)) continue;
        findings.push({
          line: sinComentarios2.slice(0, mi4.index).split('\n').length,
          label: 'persona sin `id` — sin él no hay aro de estado, y se ve igual que estar presente (DESIGN.md §5.4)',
          category: 'foto-sin-identidad',
          text: `${mi4[1]}={{ ${cuerpo.replace(/\s+/g, ' ').trim().slice(0, 90)} }}`,
        });
      }
    }

    // ── `tarjeta-a-mano` (2026-07-28) ───────────────────────────────────
    // Un `<div>` que reconstruye `data-surface="card"`: superficie de tarjeta
    // + borde + radio de tarjeta + padding de tarjeta, sin el atributo.
    //
    // Salió de una pregunta del usuario mientras se canonizaba un `<input>`
    // que estaba dentro de una de estas: *"eso de dibujar la tarjeta no es
    // canónico"*. Tenía razón, y era el problema más grande: **185 en 64
    // archivos**. Migrar el campo y dejar su contenedor a mano es arreglar
    // la mitad.
    //
    // Lo que se pierde escribiéndola a mano no es solo repetición: el radio
    // queda FIJO (`rounded-3xl` = 24px siempre) cuando `--card-radius` cambia
    // por tema —en Solid las tarjetas son más tensas—, y el `backdrop-filter`
    // queda escrito aunque Solid prometa cero blur.
    //
    // No mira las superficies bespoke: sidebar, kiosco y login (§25.4).
    //
    // ── Ensanchado el 2026-08-16, porque el CERO era del detector ────────
    // La categoría llegó a 0 en julio (184 → 31 → 0) y siguió en verde
    // mientras un censo a mano encontraba **81 sitios vivos**. Tres de las
    // cinco condiciones viejas dejaban pasar casi todo, y son de manual:
    //
    //   · «tiene padding generoso» descartaba **63 de 81**. Una tarjeta
    //     CONTENEDORA no lleva padding: lo llevan sus hijos. El envoltorio de
    //     sucursal de Facturación era `rounded-2xl border bg-surface-card
    //     shadow-sm` a secas y por eso nunca se marcó. La forma más común de
    //     una tarjeta era justo la que la condición excluía.
    //   · aceptar sólo `rounded-2xl/3xl` dejaba pasar **35**: `rounded-xl`
    //     también es una tarjeta escrita a mano, sólo que con otro número.
    //   · leer únicamente `<div>` dejaba pasar **16**, que son `button`,
    //     `label`, `motion.div`, `a` y `p`.
    //
    // Y por debajo de las tres, el `className` se leía truncado en la primera
    // `}` — ver `classNameDeTag`.
    //
    // Lo que reemplaza a «tiene padding» es «no tiene TAMAÑO FIJO», que es lo
    // que de verdad separa una tarjeta de un envoltorio de campo (`h-[40px]`)
    // o una caja de ícono (`w-10 h-10`). Medido sobre los 147 sitios crudos:
    // 61 son eso y se descartan por esa señal sola.
    if (!/timeclock\/|LoginView|AppLayout/.test(path)) {
      // Un contenedor, no una hoja: `input`, `img` y `svg` no pueden ser una
      // tarjeta ni aunque lleven las clases.
      const HOJAS = new Set(['input', 'img', 'svg', 'br', 'hr', 'path', 'circle', 'rect', 'textarea']);
      const RE_CN = /className\s*=/g;
      let mc2;
      const yaVistos = new Set();
      while ((mc2 = RE_CN.exec(sinComentarios2))) {
        const t = tagQueContiene(sinComentarios2, mc2.index);
        if (!t || yaVistos.has(t.ini)) continue;
        yaVistos.add(t.ini);
        const tag = t.texto;
        if (tag.includes('data-surface')) continue;
        // Sólo etiquetas del DOM (y `motion.*`). Un componente en mayúscula
        // recibe `className` y decide él qué hacer con ella — puede estar
        // reenviándola a su propio canónico.
        const nombre = (tag.match(/^<([A-Za-z][\w.]*)/) || [, ''])[1];
        if (!/^[a-z]/.test(nombre)) continue;
        if (HOJAS.has(nombre)) continue;

        const c = classNameDeTag(tag);
        if (!c) continue;
        // `\b` después de "card" también matchea `bg-surface-card-hover`, que es
        // OTRO token (la superficie de realce, no la de tarjeta). Se vio al
        // migrar el pie de RolesView y marcaba como tarjeta algo que no lo es.
        if (!/bg-surface-card(?!-)/.test(c)) continue;
        if (!/\bborder\b|border-(divider|border-card|\[)/.test(c)) continue;
        if (!/rounded-(xl|2xl|3xl|card|modal|header)/.test(c)) continue;
        // Tamaño fijo → envoltorio de campo o caja de ícono, no una tarjeta.
        if (/\b[wh]-\[|\b[wh]-\d{1,2}\b|\bsize-\d/.test(c)) continue;
        // Tinta y capas flotantes: un chip en línea, un tooltip o un popover
        // no son superficies de tarjeta (DESIGN.md §5.bis «lo que NO es material»).
        if (/\binline-flex\b|\babsolute\b|\bfixed\b|focus-within:|\bw-max\b/.test(c)) continue;

        const linea = sinComentarios2.slice(0, t.ini).split('\n').length;
        findings.push({ line: linea, label: 'tarjeta a mano — usar `data-surface="card"` (DESIGN.md §5)',
          category: 'tarjeta-a-mano', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `rotulo-de-campo-a-mano` (2026-08-26) ───────────────────────────
    // El `<label>` de un campo escrito con sus clases literales en vez de
    // `rotuloCampo()` (`src/utils/rotuloDeCampo.js`).
    //
    // No es una categoría de repetición: es de ALINEACIÓN. Escrito a mano, el
    // alto del rótulo sale de lo que le pongan adentro, y eso mueve el campo
    // que está debajo. Medido en el alta de personal el 2026-08-26 con Chromium
    // sobre el CSS compilado:
    //
    //     sólo texto ............ 15px   (42 campos)
    //     con «Requerido» ....... 25px   (18 campos)
    //     con un botón chico .... 28px
    //     con un botón normal ... 36px   (y margen −2 en vez de 6)
    //
    // O sea que dos campos vecinos arrancaban hasta 21px desalineados según si
    // a uno le tocaba una insignia. Lo reportó el usuario, dos veces.
    //
    // El canónico fija el alto en 20px y acota lo que entra. Un rótulo a mano
    // se lo salta por construcción, y como no falla nada, sólo se ve.
    {
      const re = /<label\s+className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
      let m;
      while ((m = re.exec(sinComentarios2)) !== null) {
        const c = m[1] || m[2] || '';
        // ── Ensanchado el 2026-08-27, porque el primer barrido quedó corto ───
        // La primera versión pedía `tracking-widest` y con eso encontró 114.
        // Un diff mostró rótulos idénticos escritos con `tracking-[0.15em]`,
        // con `tracking-wide` o sin tracking: **57 más en 17 archivos**, que ni
        // el barrido ni el gate miraban. Un rótulo es rótulo por su TAMAÑO y su
        // PESO, no por cómo le espaciaron las letras.
        if (!/\btext-(?:caption|micro|label)\b/.test(c)) continue;
        if (!/\b(?:uppercase|font-black|font-bold|font-semibold)\b/.test(c)) continue;
        const linea = sinComentarios2.slice(0, m.index).split('\n').length;
        findings.push({ line: linea, label: 'rótulo de campo a mano — usar `rotuloCampo()` (DESIGN.md §25.10-ter)',
          category: 'rotulo-de-campo-a-mano', text: c.slice(0, 120) });
      }
    }

    // ── `input-sin-nombre` (2026-07-28, CERO ABSOLUTO) ──────────────────
    // Hermano de `button-name`, para el campo. Un `<input>` sin `aria-label`
    // y sin un `<label htmlFor>` que lo apunte se anuncia como "cuadro de
    // edición, en blanco": no hay forma de saber qué se escribe ahí.
    //
    // El `placeholder` NO cuenta y por eso no se lo mira. Desaparece apenas
    // el campo tiene contenido — justo cuando alguien vuelve a revisar lo que
    // escribió — y varios lectores de pantalla no lo exponen como nombre.
    //
    // Medido el 2026-07-28 al cerrar D3.4: **45 campos anónimos** en 30
    // archivos, la mayoría celdas de grilla densa que se quedan a mano a
    // propósito (`input-a-mano` las tolera vía ratchet). Que un campo sea
    // legítimamente artesanal no lo exime de tener nombre: son dos
    // categorías distintas, y ESTA arranca en cero y es bloqueante.
    //
    // Se salta `components/common/`: ahí `PortalInput` pone el `<label
    // htmlFor>` a varias líneas del `<input>`, fuera de la ventana que mira
    // esta regla, y los demás canónicos ya reciben `ariaLabel`.
    if (!path.includes('components/common/')) {
      const RE_IN2 = /<input\b/g;
      let mi3;
      while ((mi3 = RE_IN2.exec(sinComentarios2))) {
        const tag = sinComentarios2.slice(mi3.index, finEtiqueta(sinComentarios2, mi3.index));
        const tipo = (tag.match(/type=["'{\s]*([a-z]+)/) || [, 'text'])[1];
        if (['checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes(tipo)) continue;
        if (/aria-label|aria-labelledby/.test(tag)) continue;
        // un <label htmlFor> cerca, arriba — el patrón real de un formulario
        const antes = sinComentarios2.slice(Math.max(0, mi3.index - 500), mi3.index);
        if (/<label[^>]*htmlFor/.test(antes)) continue;
        const linea = sinComentarios2.slice(0, mi3.index).split('\n').length;
        findings.push({ line: linea, label: 'input sin nombre accesible: `aria-label` o `<label htmlFor>` (el placeholder no cuenta)',
          category: 'input-sin-nombre', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `monto-nativo` (2026-08-19, CERO ABSOLUTO) ──────────────────────
    // Un campo de DINERO con `type="number"`. El separador decimal de ese
    // control lo pone el idioma de cada computadora, no el portal: en una caja
    // el punto entra y en la de al lado lo tira sin avisar —o al revés con la
    // coma—. Lo reportó el usuario el 2026-08-19: «en mi computadora funciona
    // con . pero en otras solo con ,».
    //
    // Y lo peor no es que no deje escribir: es que **se come la tecla en
    // silencio**. «24,90» tecleado en un campo que espera punto queda «2490».
    // En una temperatura eso ya costó una lectura inventada (v2.647.x); en
    // dinero es un monto equivocado en una bolsa de efectivo.
    //
    // El canónico es `maskType="DECIMAL"` sobre `type="text"`: acepta las dos
    // teclas y deja siempre punto — que es lo que pidió el usuario, «todos
    // deben ser con . ese debe ser el canónico de efectivo».
    //
    // Sólo mira los campos que son DINERO, y por señales duras: el prefijo `$`,
    // el ícono del dólar, el placeholder «0.00», o un nombre/rótulo del
    // vocabulario del dinero. Las cantidades enteras (cajas, unidades, días,
    // edad, horas) se quedan nativas a propósito — ahí el `min`/`max`/`step`
    // del navegador sí trabaja, y varias lo usan para topar contra un saldo.
    //
    // `step="0.01"` NO alcanza como señal, aunque suene a centavos: la viñeta de
    // un proveedor lo usa y es un identificador («v3»), no plata. Y «horas a
    // pagar» tampoco es dinero por decir «pagar» — por eso el vocabulario
    // nombra la COSA (monto, salario, precio) y no el verbo.
    {
      const DINERO = /(monto|amount|salario|sueldo|precio|mensualidad|viatico|abono|cuota|remuner|efectivo|saldo|contado|bonific|deduc)/i;
      const RE_CAMPO = /<(input|PortalInput|LazyInput)\b/g;
      let mm;
      while ((mm = RE_CAMPO.exec(sinComentarios2))) {
        const tag = sinComentarios2.slice(mm.index, finEtiqueta(sinComentarios2, mm.index));
        if (!/type=["'{\s]*number/.test(tag)) continue;
        // Las interpolaciones se borran ANTES de mirar: un `aria-label={`Cantidad
        // de ${x}`}` trae un `$` que no es de dinero, y sin esto la regla
        // marcaba justo los campos de cantidad que tiene que dejar en paz.
        const rotulos = (tag.match(/(?:name|label|aria-label)=\{?["'`]([^"'`]*)/g) || [])
          .join(' ').replace(/\$\{[^}]*\}?/g, ' ').replace(/\$\{?/g, ' ');
        const esDinero = /prefix=["']\$["']/.test(tag)
          || /icon=\{DollarSign\}/.test(tag)
          || /placeholder=["']0\.00["']/.test(tag)
          || rotulos.includes('$')
          || DINERO.test(rotulos);
        if (!esDinero) continue;
        const linea = sinComentarios2.slice(0, mm.index).split('\n').length;
        findings.push({ line: linea, label: 'campo de dinero con `type="number"`: usar `maskType="DECIMAL"` (el separador decimal nativo depende del idioma de cada computadora)',
          category: 'monto-nativo', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
      }
    }

    // ── `try-finally-mudo` (2026-07-29, CERO ABSOLUTO) ──────────────────
    // Un `try { … } finally { setLoading(false) }` SIN `catch`. Si la promesa
    // tira, el spinner se apaga, la lista queda vacía y el usuario lee "no hay
    // datos" cuando en realidad la operación falló. Es el bug de UX más barato
    // de escribir y el más caro de diagnosticar: no deja rastro en pantalla.
    //
    // Medido el 2026-07-29: 7 reales. Se cuenta equilibrando llaves hacia
    // atrás desde el `finally` hasta SU `try` — un detector por líneas los
    // sobrecontaba a 19 (agarraba el `try` de otra función).
    {
      const RE_FIN = /\}\s*finally\s*\{/g;
      let mf;
      while ((mf = RE_FIN.exec(sinComentarios2))) {
        const antes = sinComentarios2.slice(0, mf.index);
        let prof = 0, ini = -1;
        for (let k = antes.length - 1; k >= 0; k--) {
          if (antes[k] === '}') prof++;
          else if (antes[k] === '{') {
            if (prof === 0) { if (/\btry\s*$/.test(antes.slice(Math.max(0, k - 6), k))) ini = k; break; }
            prof--;
          }
        }
        if (ini < 0) continue;
        if (/\}\s*catch\s*[({]/.test(antes.slice(ini))) continue;
        findings.push({ line: antes.split('\n').length, category: 'try-finally-mudo',
          label: 'try/finally sin catch: si falla, el usuario no se entera',
          text: sinComentarios2.slice(mf.index, mf.index + 60).replace(/\s+/g, ' ') });
      }
    }

    // ── `equis-destructiva` (2026-08-05, CERO ABSOLUTO) ─────────────────
    // Un `<Button variant="destructive" icon={X} iconOnly>`. El ✕ cierra o
    // quita; el borrado de verdad lleva papelera. Ver DESIGN.md §15.2.
    //
    // Salió de una pregunta sobre el ✕ del toast: era `destructive`, o sea una
    // pastilla roja sólida para cerrar un aviso, compitiendo con el rojo del
    // ícono de error. Al medirlo, los 66 ✕ del portal estaban en TRES variantes
    // para tres trabajos distintos y la variante no seguía al trabajo —
    // `FinalizarCajasModal` tenía dos formas en el mismo archivo a nueve líneas
    // una de otra. Los 19 `destructive` eran todos cerrar o quitar-de-una-lista;
    // ninguno borraba nada al apretarlo.
    //
    // Se detecta sobre el TAG completo y no por línea: `EmployeeFormModal` los
    // escribe en tres renglones, y un regex de línea encontraba 12 de 19.
    //
    // Y el tag se recorre contando LLAVES, no con `<Button[^>]*>`: ese `[^>]`
    // se corta en el primer `>`, y `=>` está adentro de casi todos los
    // `onClick`. Con la versión regex, el barrido de «Cancelar» de esta misma
    // sesión arregló 8 de 16 y el detector habría dado verde sobre los otros 8
    // — un gate ciego justo en el caso más común.
    //
    // Segundo hallazgo del mismo barrido: el mismo `variant="destructive"` con
    // el rótulo «Cancelar». Cancelar un formulario es lo contrario de guardar,
    // no un borrado; el canónico (`ConfirmModal`) ya lo dibuja `secondary`, y
    // 21 de 45 sitios lo hacían bien. Se cuenta aparte porque el arreglo es
    // otro: acá `secondary`, no `ghost`.
    //
    // Lo que NO cuenta: «Rechazar» y el «Cancelar» con `icon={Ban}` de
    // `EmployeeDetailView`. Los dos SÍ destruyen —deniegan una solicitud,
    // anulan un evento— y por eso llevan otro glifo o son la acción de verdad.
    // El ícono es lo que separa los dos sentidos de la misma palabra.
    for (const [ini, fin] of tagsJsx(sinComentarios2, 'Button')) {
      const tag = sinComentarios2.slice(ini, fin);
      if (!/variant="destructive"/.test(tag)) continue;
      const linea = sinComentarios2.slice(0, ini).split('\n').length;
      const corto = tag.replace(/\s+/g, ' ').slice(0, 90);

      if (/icon=\{X\}/.test(tag) && /\biconOnly\b/.test(tag)) {
        findings.push({ line: linea, category: 'equis-destructiva',
          label: 'el ✕ cierra o quita, no borra — `ghost` (§15.2); si borra de verdad, va papelera',
          text: corto });
        continue;
      }
      // El GLIFO desempata los dos sentidos de «Cancelar»: con `X` (o sin
      // ícono) es cerrar el formulario; con `Ban` o `Trash2` es anular la cosa
      // en sí, y eso sí destruye. Sin esta condición el gate marcaba el
      // «Cancelar» de `EmployeeDetailView`, que pasa un evento a CANCELLED.
      const mIcon = tag.match(/icon=\{(\w+)\}/);
      if (mIcon && mIcon[1] !== 'X') continue;
      const cierre = sinComentarios2.indexOf('</Button>', fin);
      if (cierre > 0 && sinComentarios2.slice(fin, cierre).trim() === 'Cancelar') {
        findings.push({ line: linea, category: 'cancelar-destructivo',
          label: 'Cancelar no destruye: es lo contrario de guardar — `secondary` (§15.2)',
          text: corto });
      }
    }

    // ── `title-redundante` (2026-07-29, CERO ABSOLUTO) ──────────────────
    // El MISMO texto en `aria-label` y en `title`. El `aria-label` ya nombra el
    // control; el `title` solo suma un tooltip del sistema operativo que
    // ignora los cuatro temas y tarda un segundo. Ver DESIGN.md §15.10.
    {
      const RE_T = /title=["']([^"']{3,})["']/g;
      let mt;
      while ((mt = RE_T.exec(sinComentarios2))) {
        const cerca = sinComentarios2.slice(Math.max(0, mt.index - 250), mt.index + 250);
        if (!cerca.includes(`aria-label="${mt[1]}"`)) continue;
        findings.push({ line: sinComentarios2.slice(0, mt.index).split('\n').length,
          category: 'title-redundante', label: 'title= repite el aria-label — sobra el tooltip nativo',
          text: mt[0] });
      }
    }

    // ── `button-name` (2026-07-28) ──────────────────────────────────────
    // Hermano del anterior, para el otro lado del formulario: un `<button>`
    // cuyo contenido son SOLO íconos, sin `aria-label` ni `title`. Un lector
    // de pantalla dice "botón" y se acabó — no hay forma de saber qué hace.
    //
    // Medido el 2026-07-28: **7 reales**, y los siete eran interruptores
    // (resolver una factura, ocultar un producto, el modo privacidad). Los
    // interruptores además necesitan `aria-pressed`, porque sin él el estado
    // solo existe en el color del ícono.
    //
    // Contar esto costó TRES intentos, y vale anotarlos porque son la misma
    // familia de trampa de siempre:
    //   1º  borrar `{…}` a ciegas → un botón cuyo texto sale de una variable
    //       (`{tab.label}`) parecía vacío: 44 falsos positivos.
    //   2º  conservar identificadores → la CONDICIÓN de un ternario
    //       (`{isSolving ? <X/> : <Check/>}`) parecía contenido: 1, se
    //       escapaban 7.
    //   3º  quitar condiciones y guardas antes de mirar el residuo → 8, de
    //       los cuales 7 son defecto y 1 es el chevron `aria-hidden`
    //       deliberado de AttendanceAuditView.
    const RE_BOTON = /<button\b/g;
    let mb;
    while ((mb = RE_BOTON.exec(sinComentarios2))) {
      const finAbre = finEtiqueta(sinComentarios2, mb.index);
      const abre = sinComentarios2.slice(mb.index, finAbre);
      if (/aria-label|aria-labelledby|\btitle=|aria-hidden/.test(abre)) continue;
      // el cuerpo, hasta su `</button>` (sin anidados: basta el primero)
      const cierre = sinComentarios2.indexOf('</button>', finAbre);
      if (cierre === -1) continue;
      let cuerpo = sinComentarios2.slice(finAbre, cierre);
      cuerpo = cuerpo
        .replace(/<[A-Z]\w*(\s[^>]*?)?\/>/g, '')      // <Check size={8} />
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/<\/?[a-z]\w*[^>]*>/g, '')            // etiquetas html sueltas
        .replace(/className=(\{[^{}]*\}|"[^"]*")/g, '')
        // condiciones y guardas NO son contenido
        .replace(/[\w.$[\]'"]+\s*(===?|!==?|>=|<=|>|<)\s*[\w.$[\]'"]+/g, '')
        .replace(/[\w.$[\]]+\s*(\?|&&)/g, '')
        .replace(/[{}?:()[\]&|!=<>,;.\s]|null|undefined/g, '');
      if (cuerpo) continue;                            // queda texto → tiene nombre
      const linea = sinComentarios2.slice(0, mb.index).split('\n').length;
      findings.push({ line: linea, label: 'botón de solo ícono sin nombre accesible (WCAG 4.1.2) — falta aria-label',
        category: 'button-name', text: abre.replace(/\s+/g, ' ').slice(0, 120) });
    }
  }

  if (!hasException(path, 'small-input')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      SMALL_TEXT_RE.lastIndex = 0;
      let m;
      while ((m = SMALL_TEXT_RE.exec(line))) {
        const tag = nearestOpenTag(lines, i);
        if (tag !== 'input' && tag !== 'textarea') continue;
        const windowText = lines.slice(Math.max(0, i - 5), i + 3).join(' ');
        if (INPUT_TYPE_EXCLUDE_RE.test(windowText)) continue;
        findings.push({ line: i + 1, label: `input/textarea bajo 16px: text-${m[1]}`, category: 'small-input', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'scale-tap')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      SCALE_TAP_RE.lastIndex = 0;
      let m;
      while ((m = SCALE_TAP_RE.exec(line))) {
        findings.push({ line: i + 1, label: `active:scale-${m[1]} — mínimo permitido active:scale-[0.97]`, category: 'scale-tap', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'left-border')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      if (RIGHT_BORDER_RE.test(line)) return; // par de spinner, no indicador
      LEFT_BORDER_RE.lastIndex = 0;
      let m;
      while ((m = LEFT_BORDER_RE.exec(line))) {
        findings.push({ line: i + 1, label: `border-l decorativo: ${m[0]}`, category: 'left-border', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── Categoría `carril-pildora` (§17.0) ────────────────────────────────────
  // El carril de tarjetas y la píldora de filtros van en UNA fila. Existe como
  // gate y no solo como prosa porque la regla YA estaba escrita en tres lugares
  // —DESIGN.md §17.0, la memoria del proyecto y el comentario de
  // `ConteoInventarioView`— y se rompió igual: alguien copió el layout de una
  // vista que tiene la excepción MEDIDA y se llevó la excepción sin el motivo.
  //
  // Y no es estética. `useMedidaFila` (FilterBar.jsx) mira al ABUELO de la
  // píldora y busca el carril con `[role="group"]`. En renglones separados lo
  // encuentra igual —es hermano dentro del mismo contenedor— y le descuenta
  // RESERVA_CARRIL (2×148+8+10 = 314px) por un carril que no tiene al lado. El
  // layout equivocado NO falla: le roba 314px a la píldora en silencio, y todo
  // el reparto de §17.0 (primero cede el texto de las acciones, después las
  // ranuras vacías, nunca una aplicada) asume la fila compartida.
  //
  // Se mira la apertura del `<div>` más cercano que envuelve al carril, no un
  // `lg:flex-row` suelto en cualquier parte del archivo: mencionarlo en un
  // comentario no arregla el layout.
  // ── Dos correcciones al detector (2026-08-06, al bajarlo a fondo) ─────────
  // Se auditaron sus 15 hallazgos uno por uno y **cuatro no eran deuda**. El
  // detector medía la LETRA de la regla en vez de lo que la regla protege, que
  // es la tercera vez que pasa acá (los `pointermove` de limpieza, los
  // `backdrop-filter` dentro de comentarios). Las dos causas:
  //
  //  1 · **Una vista sin píldora no tiene nada que mal-medir.** `useMedidaFila`
  //      corre desde `FilterBar`: si la vista no la usa, no hay reserva de
  //      314px que aplicar y el layout del carril es libre. `TabMetricas` no
  //      tiene ni una referencia y salía marcada dos veces.
  //  2 · **`flex` a secas YA es una fila**, y en TODOS los anchos — o sea más
  //      fuerte que `flex-col lg:flex-row`, que apila en móvil. Pedir el
  //      literal marcaba como deuda a `FacturasCompraView` y `TabPedidos`, que
  //      lo hacen bien. Sí siguen contando `flex-col` sin su `lg:flex-row`, y
  //      `flex-wrap`, porque ése SÍ deja caer la píldora a otro renglón cuando
  //      falta ancho, que es exactamente el caso que rompe la medición.
  //
  // Lo que NO se tocó: un `<CarrilCards>` que es el `return` de un
  // subcomponente tiene su contenedor en el archivo del padre y este detector
  // no cruza archivos. Se dejan contando —son hallazgos sin verificar, no
  // hallazgos descartados— para que nadie los dé por buenos sin mirar.
  if (!hasException(path, 'carril-pildora') && /\bFilter(Pill|Bar)\b/.test(text)) {
    // La ventana de 800 caracteres se mide sobre el CÓDIGO, no sobre la prosa
    // (2026-08-20). Se leía el texto crudo, así que un comentario largo entre el
    // contenedor y el carril empujaba al `<div>` fuera de la ventana: `apertura`
    // quedaba vacía, `unaFila` daba falso y el gate acusaba un layout correcto.
    // Pasó en `CortesView` al documentar por qué Bolsas tiene su propio carril —
    // y acusó a los DOS, incluido el que llevaba meses bien.
    //
    // Es la regla #1 de los gates de material —«un detector tiene que enmascarar
    // los comentarios»— con el daño al revés: acá el comentario no inventa un
    // hallazgo, esconde la prueba de que no lo hay. `sinComentarios` los deja en
    // blancos (para no correr los offsets) y el colapso de espacios hace que los
    // 800 midan código.
    const limpioCarril = sinComentarios(text);
    const CARRIL_RE = /<CarrilCards\b/g;
    let c;
    while ((c = CARRIL_RE.exec(limpioCarril))) {
      const linea = limpioCarril.slice(0, c.index).split('\n').length;
      const antes = limpioCarril.slice(0, c.index).replace(/\s+/g, ' ').slice(-800);
      const iDiv = antes.lastIndexOf('<div');
      const apertura = iDiv >= 0 ? antes.slice(iDiv) : '';
      // Es UNA fila si el contenedor es `flex` sin apilar (`flex-col`) y sin
      // envolver (`flex-wrap`), o si declara el `lg:flex-row` del canónico.
      //
      // `flex-wrap` DESCALIFICA aunque haya `lg:flex-row` (2026-08-09). El
      // detector daba por buena `lg:flex-row lg:flex-wrap` —la primera rama del
      // OR se cumplía y ni miraba el wrap— así que las 17 vistas a las que se
      // les puso `lg:flex-wrap` esa mañana pasaron el gate en verde mientras la
      // píldora bajaba de renglón en todas. Lo corrigió el usuario mirando
      // Mín·Máx, no el gate. `\b` alcanza para las dos formas: en
      // `lg:flex-wrap` el `:` es un no-palabra.
      const envuelve = /\bflex-wrap\b/.test(apertura);
      const unaFila = !envuelve && (/lg:flex-row/.test(apertura)
        || (/\bflex\b/.test(apertura) && !/\bflex-col\b/.test(apertura)));
      if (!unaFila) {
        findings.push({
          line: linea, category: 'carril-pildora',
          label: envuelve
            ? 'la fila del carril ENVUELVE (`flex-wrap`) — la píldora baja de renglón '
              + 'cuando falta ancho, y §17.0 pide que lo que ceda sea el carril deslizando'
            : 'carril y píldora en renglones separados — §17.0 pide `lg:flex-row` '
              + 'en el contenedor (si no, FilterBar le descuenta 314px en silencio)',
          text: '<CarrilCards …',
        });
      }
      // Sin `flex-1` el carril no cede el ancho sobrante y la píldora se come
      // el renglón: es la otra mitad del canónico de `StaffManagementView`.
      const tag = limpioCarril.slice(c.index, c.index + 240);
      if (!/flex-1/.test(tag)) {
        findings.push({
          line: linea, category: 'carril-pildora',
          label: 'CarrilCards sin `flex-1` — no cede el ancho sobrante a la píldora (§17.0)',
          text: '<CarrilCards …',
        });
      }
    }
  }

  // ── Categoría `backdrop-root` (DESIGN.md §5.ter, 2026-08-09) ─────────────
  // Un elemento con `transform` / `filter` / `opacity < 1` / `will-change` de
  // esos se vuelve **backdrop root**, y desde ahí el `backdrop-filter` de sus
  // descendientes deja de muestrear la página: la superficie no se rompe, se
  // APAGA. Medido el 2026-08-09: **38 de 41** superficies canónicas de Inicio
  // no ejecutaban su vidrio, y una tarjeta sin su `blur(44px) saturate(200%)`
  // es su color de fondo al 16% — el «gris sucio» que se reportó.
  //
  // Lo que se marca es la puerta que se puede leer del fuente: `transform-gpu`
  // y `will-change-transform` en un ENVOLTORIO. Son la versión PERMANENTE del
  // problema —el lift de hover sólo pone transform mientras el puntero está
  // encima, y eso es aceptable— y ninguno hace falta: el lift canónico compone
  // solo. Se barrieron los 30 que había (15 archivos), así que la categoría
  // arranca en 0 y cualquier hallazgo nuevo falla el gate.
  //
  // NO se marca sobre el mismo tag que declara `data-surface`: ahí el transform
  // no apaga su propio vidrio, y lo que anide ya está aplanado por la regla de
  // «una superficie dentro de otra».
  //
  // Las otras dos puertas no se ven en el fuente y por eso no están acá: el
  // `fill-mode` de las animaciones vive en `index.css` (§5.ter lo fija en
  // `backwards` para toda entrada) y el resto sólo aparece recorriendo el árbol
  // pintado — para eso está el barrido con navegador que documenta §5.ter.
  if (path.endsWith('.jsx') && !hasException(path, 'backdrop-root')) {
    for (const m of text.matchAll(/<[a-zA-Z][^>]*?>/gs)) {
      const tagAbre = m[0];
      if (!/\btransform-gpu\b|\bwill-change-transform\b/.test(tagAbre)) continue;
      if (/data-surface/.test(tagAbre)) continue;
      findings.push({
        line: text.slice(0, m.index).split('\n').length,
        category: 'backdrop-root',
        label: 'transform-gpu/will-change-transform en un envoltorio — apaga el '
             + '`backdrop-filter` de toda superficie que contenga (§5.ter). El lift '
             + 'canónico `hover:translate-y-[var(--lift-*)]` no lo necesita',
        text: tagAbre.slice(0, 90).replace(/\s+/g, ' '),
      });
    }
  }

  // ── Categoría `vidrio-a-mano` (PLAN-MATERIALES §18.1) ─────────────────────
  // Vidrio escrito a mano fuera de una superficie canónica. Existe porque el
  // hallazgo de §13.3 —243 `backdrop-blur` en 81 archivos, un segundo sistema
  // de vidrio corriendo en paralelo al de `data-surface`— no lo detectaba
  // ningún gate: la regla vivía sólo en la prosa de DESIGN.md, y una regla que
  // sólo vive en prosa se rompe.
  //
  // Importa más de lo que parece porque el material NO es solo estética: un
  // `backdrop-filter` convierte al elemento en la RAÍZ del backdrop de sus
  // descendientes (§12.6), así que un blur puesto a mano en un contenedor
  // rompe el vidrio de todo lo que vive adentro — y eso no se ve leyendo el
  // archivo donde está el bug, se ve en otro.
  //
  // Dos cosas NO son hallazgo:
  //  · el velo de un modal (`bg-scrim`): no es superficie, es el fondo que se
  //    oscurece, y ahí el blur es el patrón correcto (`ModalShell`);
  //  · el elemento que YA declara `data-surface`: ahí el blur es redundante
  //    pero no es un sistema paralelo — lo pisa la superficie canónica.
  if (!hasException(path, 'vidrio-a-mano') && /\.jsx$/.test(path)) {
    const VIDRIO_RE = /backdrop-blur(?:-\w+)?|backdrop-filter/g;
    let v;
    const yaVisto = new Set();
    const limpio = sinComentarios(text);   // un `backdrop-filter` en prosa no es vidrio
    while ((v = VIDRIO_RE.exec(limpio))) {
      const tag = tagQueContiene(text, v.index);
      if (!tag || yaVisto.has(tag.ini)) continue;
      yaVisto.add(tag.ini);
      if (/data-surface/.test(tag.texto)) continue;   // canónico: la superficie manda
      if (/bg-scrim/.test(tag.texto)) continue;       // velo, no superficie
      findings.push({
        line: text.slice(0, v.index).split('\n').length,
        category: 'vidrio-a-mano',
        label: 'vidrio a mano fuera de una superficie canónica — usar `data-surface`, '
             + 'o entrar a EXCEPTIONS con el motivo escrito (PLAN-MATERIALES §18.1)',
        text: v[0],
      });
    }
  }

  // ── Categoría `material-a-mano` (PLAN-MATERIALES §8.2) ────────────────────
  // Una capa de §1-§5 escrita con su valor literal en vez de salir de su token.
  //
  // Dos formas, y las dos se ven mucho:
  //  · `backdrop-blur-[24px]` — un desenfoque arbitrario en vez de
  //    `--backdrop-card` / `--backdrop-modal` / `--menu-blur`. Es el token el
  //    que sabe que en Solid la capa NO EXISTE; un literal la enciende en los
  //    cuatro temas.
  //  · un realce interior a mano (`inset … rgba(255,255,255,…)`) en vez de
  //    `--lente-*` o `--shadow-*`. Éste es exactamente el fallo de §19.1
  //    escrito en JSX: un blanco calibrado en claro que ningún tema apaga.
  //
  // NO se mira `filter: blur()` a secas: un blob decorativo desenfocado no es
  // una superficie, y confundirlos infla el número con cosas que están bien.
  if (!hasException(path, 'material-a-mano') && /\.jsx$/.test(path)) {
    const limpioMat = sinComentarios(text);
    for (const [re, label] of [
      [/backdrop-blur-\[\s*[\d.]+px\s*\]/g,
       'desenfoque arbitrario — sale de `--backdrop-*` / `--menu-blur`, que es lo que sabe que en Solid la capa no existe'],
      [/backdrop-?[Ff]ilter[^;'"`]{0,30}blur\(\s*[\d.]+px\s*\)/g,
       '`backdrop-filter` literal en estilo inline — sale de su token'],
      [/inset[^;'"`)]{0,40}rgba?\(\s*255\s*[,\s]\s*255\s*[,\s]\s*255/g,
       'realce interior a mano — sale de `--lente-*` / `--shadow-*` (§19.1: un blanco calibrado en claro que ningún tema apaga)'],
    ]) {
      let m;
      while ((m = re.exec(limpioMat))) {
        findings.push({
          line: text.slice(0, m.index).split('\n').length,
          category: 'material-a-mano', label,
          text: m[0].trim().slice(0, 60),
        });
      }
    }
  }

  // ── Categoría `reloj-a-mano` (PLAN-MATERIALES §7, §8.2) ───────────────────
  // Una duración o una curva escrita literal en JSX en vez de salir del reloj.
  //
  // Nace BLOQUEANTE y sin baseline porque la fase C dejó los `duration-N` en
  // CERO: 468 usos tokenizados, incluida una cola de cinco valores —75, 100,
  // 250, 400, 600— que la tabla del plan nunca listó. El portal no usaba seis
  // duraciones, usaba once. Un gate que arranca con deuda no protege nada:
  // protege cuando el número que vigila es 0 y cualquier reincidencia lo rompe.
  //
  // La regla para elegir escalón, escrita para no volver a decidirla: al MÁS
  // CERCANO, y los empates BAJAN — más rápido se siente mejor que más lento.
  if (!hasException(path, 'reloj-a-mano') && /\.jsx$/.test(path)) {
    const limpioReloj = sinComentarios(text);   // una duración citada en prosa no es una duración
    // `:` cuenta como delimitador previo: sin eso el detector es ciego a todo
    // `duration-*` con variante (`md:`, `group-hover:`, `[&_svg]:`), que fue
    // exactamente cómo se escaparon dos en la migración.
    for (const [re, label] of [
      [/(^|[\s"'`{:])duration-\d+(?![\d[])/g, 'duración literal — sale del reloj (`duration-[var(--dur-*)]`)'],
      [/cubic-bezier\(/g, 'curva literal — sale de `--ease-spring` / `--ease-out`'],
      // Sólo `transitionDuration`: una TRANSICIÓN es interacción y sale del
      // reloj. `animationDuration` NO se mira — los 24 que había son bucles
      // ambientales (shimmer a 4s, blobs escalonados a 2/3/5s) y su período no
      // es una duración de interacción. Meterlos en la escala haría que los
      // tres blobs derivaran al unísono, que es exactamente lo que el
      // escalonado evita: sería usar el reloj para romper el diseño.
      [/transitionDuration:\s*['"`]?\d/g, 'duración de transición literal en estilo inline'],
    ]) {
      let m;
      while ((m = re.exec(limpioReloj))) {
        findings.push({
          line: text.slice(0, m.index).split('\n').length,
          category: 'reloj-a-mano', label,
          text: m[0].trim().slice(0, 60),
        });
      }
    }
  }

  // ── Categoría `puntero-lista` (PLAN-MATERIALES §6) ────────────────────────
  // Un handler de puntero que recorre la lista o mide por evento.
  //
  // Es un gate PREVENTIVO: hoy no hay ninguna utilidad de seguimiento del
  // puntero, y la versión ingenua es la primera que uno escribe. Las tres
  // reglas de §6: tocar sólo el elemento bajo el cursor, cachear el rect e
  // invalidarlo en scroll/resize, y throttlear a un rAF — los `pointermove`
  // llegan más seguido que los cuadros.
  if (!hasException(path, 'puntero-lista') && /\.jsx$/.test(path)) {
    const limpioPtr = sinComentarios(text);
    // Sólo donde el CUERPO está ahí mismo: `onPointerMove={(e) => {…}}` o
    // `addEventListener('pointermove', e => {…})`. La primera versión miraba
    // cualquier mención y daba cuatro falsos positivos — tres eran
    // `removeEventListener` de limpieza y el otro una prop que apunta a un
    // handler definido veinte líneas más arriba. Un detector que mira la
    // REFERENCIA en vez del cuerpo no está midiendo lo que cree medir: acusa
    // al que desmonta el listener igual que al que lo escribe mal.
    const PTR = /(?:onPointerMove|onMouseMove)\s*=\s*\{\s*(?:\(|[A-Za-z_$]+\s*=>)|addEventListener\(\s*['"`](?:pointermove|mousemove)['"`]\s*,\s*(?:\(|[A-Za-z_$]+\s*=>)/g;
    let m;
    while ((m = PTR.exec(limpioPtr))) {
      // el cuerpo empieza en el match: una arrow function normal entra en 600.
      // También sin comentarios: un `getBoundingClientRect()` NOMBRADO en un
      // comentario del handler no es una llamada — es justamente lo contrario,
      // suele ser la nota que explica por qué NO se llama.
      const cuerpo = limpioPtr.slice(m.index, m.index + 600);
      const pecado = /getBoundingClientRect\s*\(/.test(cuerpo) ? 'mide el rect por evento (§6.2: cachearlo)'
        : /querySelectorAll|\.forEach\s*\(|\.map\s*\(/.test(cuerpo) ? 'recorre una lista por evento (§6.1: sólo el elemento bajo el cursor)'
        : null;
      if (pecado && !/requestAnimationFrame/.test(cuerpo)) {
        findings.push({
          line: text.slice(0, m.index).split('\n').length,
          category: 'puntero-lista',
          label: `handler de puntero que ${pecado}`,
          text: m[0],
        });
      }
    }
  }

  if (!hasException(path, 'copy-vacio')) {
    // Se recorre el texto completo, no línea por línea: un `<EmptyState>` suele
    // venir partido en varias líneas y los atributos hay que leerlos del bloque.
    // `kind` importa: §26.5 pide punto en un SUBTÍTULO (es oración completa) y
    // lo prohíbe en un título o mensaje (es una etiqueta). Y §26.1 habla del
    // título del vacío: "No hay alertas ni documentos pendientes." como
    // subtítulo es español correcto, no una violación.
    const slots = []; // { texto, pos, kind }
    SLOT_MESSAGE_RE.lastIndex = 0;
    let m;
    while ((m = SLOT_MESSAGE_RE.exec(text))) slots.push({ texto: m[2].trim(), pos: m.index, kind: 'titulo' });
    SLOT_EMPTYSTATE_RE.lastIndex = 0;
    let bloque;
    while ((bloque = SLOT_EMPTYSTATE_RE.exec(text))) {
      SLOT_ES_ATTR_RE.lastIndex = 0;
      let a;
      while ((a = SLOT_ES_ATTR_RE.exec(bloque[0]))) {
        const kind = bloque[0].slice(Math.max(0, a.index - 9), a.index + 9).includes('subtitle') ? 'subtitulo' : 'titulo';
        slots.push({ texto: a[2].trim(), pos: bloque.index + a.index, kind });
      }
    }
    for (const { texto, pos, kind } of slots) {
      const linea = text.slice(0, pos).split('\n').length;
      if (isComment[linea - 1]) continue;
      const palabras = texto.split(/\s+/).length;
      if (kind === 'titulo') {
        // §26.5 no distingue por cantidad de oraciones sino por ETIQUETA vs
        // PROSA: `Sin facturas en el período.` es una etiqueta y el punto sobra;
        // `Alguien ya leyó este aviso. Por seguridad no puedes eliminarlo.` es
        // prosa y lo lleva. El proxy es corto + una sola oración, porque una
        // etiqueta con verbo conjugado y subordinadas ya no es una etiqueta.
        const unaOracion = texto.split(/\.\s+/).length === 1;
        // Los puntos suspensivos no son un punto final: `Verificando…` es un
        // estado en curso, no una oración cerrada.
        const suspensivos = texto.endsWith('...') || texto.endsWith('…');
        if (texto.endsWith('.') && !suspensivos && unaOracion && palabras <= 6) {
          findings.push({ line: linea, label: `punto final en una etiqueta: "${texto}" (§26.5)`,
            category: 'copy-vacio', text: texto.slice(0, 110) });
        }
        if (ARRANQUE_MALO_RE.test(texto)) {
          findings.push({ line: linea, label: `"${texto}" — el vacío se escribe \`Sin <sustantivo>\` (§26.1)`,
            category: 'copy-vacio', text: texto.slice(0, 110) });
        }
      }
      // Title Case solo en etiquetas cortas: ver el comentario de TITLE_CASE_RE.
      if (palabras <= 4 && TITLE_CASE_RE.test(texto)) {
        findings.push({ line: linea, label: `Title Case en una etiqueta: "${texto}" — sentence case (§26.4)`,
          category: 'copy-vacio', text: texto.slice(0, 110) });
      }
    }
  }

  if (!hasException(path, 'icono-rampa') || !hasException(path, 'icono-stroke') ||
      !hasException(path, 'icono-semantico')) {
    // Nombres de íconos que este archivo importa de lucide-react
    const deLucide = new Set();
    LUCIDE_IMPORT_RE.lastIndex = 0;
    let mi;
    while ((mi = LUCIDE_IMPORT_RE.exec(text))) {
      for (const parte of mi[1].split(',')) {
        const bruto = parte.trim();
        if (!bruto) continue;
        // `X as Y`: el que se juzga es el nombre ORIGINAL (lo que se trae de la
        // librería); el alias local sólo cambia cómo se lo llama acá adentro.
        const original = bruto.split(/\s+as\s+/)[0].trim();
        const local = bruto.split(/\s+as\s+/).pop().trim();
        if (local) deLucide.add(local);
        if (!hasException(path, 'icono-semantico') && ICONO_RETIRADO[original]) {
          const linea = text.slice(0, text.indexOf(bruto, mi.index)).split('\n').length;
          findings.push({ line: linea,
            label: `\`${original}\` está retirado — un concepto, un ícono: usá \`${ICONO_RETIRADO[original]}\` (§12)`,
            category: 'icono-semantico', text: `import { ${original} } from 'lucide-react'` });
        }
      }
    }
    const esIcono = (comp) =>
      !NO_SON_ICONOS.has(comp) &&
      (deLucide.has(comp) || comp.includes('Icon') || comp.includes('icon') || comp.includes('.'));

    for (const m of text.matchAll(/<([A-Za-z][A-Za-z0-9.]*)\b([^>]{0,400}?)\/?>/gs)) {
      const [, comp, attrs] = m;
      if (!esIcono(comp)) continue;
      const linea = text.slice(0, m.index).split('\n').length;
      if (isComment[linea - 1]) continue;

      const talla = /size=\{(\d+)\}/.exec(attrs);
      if (talla && !hasException(path, 'icono-rampa')) {
        const n = Number(talla[1]);
        if (n < ILUSTRACION_DESDE && !RAMPA_ICONO.has(n)) {
          findings.push({ line: linea, label: `size={${n}} fuera de la rampa de §12 — elegí el vecino`,
            category: 'icono-rampa', text: `<${comp} size={${n}}>` });
        }
      }
      const trazo = /strokeWidth=\{([0-9.]+)\}/.exec(attrs);
      if (trazo && !hasException(path, 'icono-stroke')) {
        if (!STROKE_ESCALA.has(trazo[1])) {
          findings.push({ line: linea,
            label: `strokeWidth={${trazo[1]}} fuera de la escala 1 · 1.5 · 2 · 2.5 · 3 (§12)`,
            category: 'icono-stroke', text: `<${comp} strokeWidth={${trazo[1]}}>` });
        }
      }
    }
  }

  if (!hasException(path, 'tooltip-no-control')) {
    let m;
    const RE_TITLE = /\stitle=/g;
    while ((m = RE_TITLE.exec(text))) {
      const i = text.lastIndexOf('<', m.index);
      if (i < 0) continue;
      const entre = text.slice(i + 1, m.index);
      if (entre.includes('>') || entre.length > 600) continue; // no es su tag
      const nombre = /^([A-Za-z][A-Za-z0-9.]*)/.exec(entre)?.[1];
      if (!nombre || !/^[a-z]/.test(nombre)) continue;   // Mayúscula = prop de componente
      if (TAGS_INTERACTIVOS.has(nombre)) continue;
      const cierre = text.indexOf('>', m.index);
      const abre = cierre > 0 ? text.slice(i, cierre + 1) : entre;
      const truncado = /\b(truncate|line-clamp-\d|text-ellipsis)\b/.test(abre);
      const conRol = /\brole=["'](img|group)["']/.test(abre);
      if (truncado || conRol) continue;
      const linea = text.slice(0, m.index).split('\n').length;
      if (isComment[linea - 1]) continue;
      findings.push({ line: linea,
        label: `\`title=\` en <${nombre}> no interactivo — si es un gráfico va \`role="img"\`, si es prosa va \`LiquidTooltip\` (§15.10)`,
        category: 'tooltip-no-control', text: abre.replace(/\s+/g, ' ').slice(0, 110) });
    }
  }

  if (!hasException(path, 'copy-trato')) {
    lines.forEach((linea, i) => {
      if (isComment[i]) return;
      const line = sinComentarioEnLinea(linea);
      VOSEO_RE.lastIndex = 0;
      let m;
      while ((m = VOSEO_RE.exec(line))) {
        findings.push({ line: i + 1, label: `voseo "${m[1]}" — el portal usa tuteo (§26.7)`,
          category: 'copy-trato', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'copy-anaquel')) {
    lines.forEach((linea, i) => {
      if (isComment[i]) return;
      const line = sinComentarioEnLinea(linea);
      ANAQUEL_RE.lastIndex = 0;
      let m;
      while ((m = ANAQUEL_RE.exec(line))) {
        findings.push({ line: i + 1,
          label: `"${m[0]}" — el portal dice «vitrina» o «estante» (decisión del usuario, 2026-08-25)`,
          category: 'copy-anaquel', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'copy-aqui')) {
    lines.forEach((linea, i) => {
      if (isComment[i]) return;
      const line = sinComentarioEnLinea(linea);
      ACA_RE.lastIndex = 0;
      let m;
      while ((m = ACA_RE.exec(line))) {
        findings.push({ line: i + 1,
          label: `"${m[0]}" — el portal dice «aquí» (decisión del usuario, 2026-08-26)`,
          category: 'copy-aqui', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'formato-cifra')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      LOCALE_AJENO_RE.lastIndex = 0;
      let m;
      while ((m = LOCALE_AJENO_RE.exec(line))) {
        findings.push({ line: i + 1, label: `locale ajeno: ${m[0]} — el portal formatea en 'es-SV' vía utils/formatNumber`,
          category: 'formato-cifra', text: line.trim().slice(0, 120) });
      }
      MONEDA_A_MANO_RE.lastIndex = 0;
      while ((m = MONEDA_A_MANO_RE.exec(line))) {
        findings.push({ line: i + 1, label: 'moneda a mano (`$${…toFixed(2)}`) — usar `formatMoney` (utils/formatNumber)',
          category: 'formato-cifra', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── Categoría: error crudo en la UI (2026-08-01) ──────────────────────
  // Un usuario vio este toast en producción:
  //
  //     Sync fallido · Suc. 1
  //     sync_inventory_batch: <!DOCTYPE html> <!--[if lt IE 7]> …
  //
  // El nombre de una función de Postgres más la página de error del ERP, por
  // toast y por notificación del sistema operativo. Había 58 `showToast(…,
  // err.message)` en 24 archivos y 16 `setError(e.message)` más: cada uno la
  // misma fuga esperando su turno.
  //
  // La regla es que el usuario NUNCA ve texto que escribió una máquina. Existe
  // `mensajeAmigable()` (utils/errorMessages) y el guardia del toastStore
  // atrapa lo que se le escape, pero el guardia solo cubre toasts — un
  // `setError` pinta el banner del formulario sin pasar por ahí. Por eso
  // también se chequea acá, estáticamente, sobre TODOS los canales.
  //
  // Nace bloqueante en cero: la deuda se cerró completa en el mismo commit, así
  // que no hay nada que tolerar en el baseline.
  if (!hasException(path, 'error-crudo')) {
    // Canales que terminan a la vista de una persona.
    //
    // El `set…Error` se matchea por FORMA, no por lista de nombres. La primera
    // versión de esta regla enumeraba cinco setters a mano y se le escapaban
    // otros catorce (`setSubmitError`, `setSaveError`, `setBulkError`,
    // `setRowError`, `setLoadError`…) con 25 fugas reales detrás. Una lista a
    // mano se desincroniza del registro el día que alguien nombra un estado
    // distinto — y acá el costo de que se desincronice es justo lo que la
    // categoría existe para evitar.
    const SINK = /\b(showToast|fireBrowserNotif|setMensaje|set[A-Z]\w*(?:Error|Err|Msg))\s*\(/;
    // `.message` / `.details` / `.hint` de un error, pelado.
    const CRUDO = /\b(err|error|e|ex|fnErr|authErr|profErr|updErr|empError|countError)\??\.(message|details|hint)\b/g;
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      if (!SINK.test(line)) return;
      // Ya envuelto por el traductor canónico: `mensajeAmigable(err)` no
      // contiene `.message`, así que lo que quede es una fuga de verdad.
      CRUDO.lastIndex = 0;
      let m;
      while ((m = CRUDO.exec(line))) {
        findings.push({ line: i + 1,
          label: `\`${m[0]}\` crudo a la UI — envolver en \`mensajeAmigable(${m[1]})\` (utils/errorMessages)`,
          category: 'error-crudo', text: line.trim().slice(0, 120) });
      }
    });
  }

  // ── `prop-inexistente`: el prop que el canónico NO acepta ────────────────
  // Ver la nota larga junto a `firmaDeComponente`. Se mira el texto SIN
  // comentarios: un ejemplo de uso escrito en un bloque de documentación no es
  // código vivo, y contarlo movería el ratchet al editar prosa.
  if (!hasException(path, 'prop-inexistente')) {
    const limpio = sinComentarios(text);
    for (const [nombre, { props }] of Object.entries(firmasCanonicas())) {
      // El propio archivo del canónico define el componente, no lo consume.
      if (path.endsWith(`/${nombre}.jsx`)) continue;
      for (const [ini, fin] of tagsJsx(limpio, nombre)) {
        const tag = limpio.slice(ini, fin);
        if (/\{\s*\.\.\./.test(tag)) continue;   // spread: no se sabe qué entra
        for (const p of atributosDelTag(tag, nombre)) {
          if (RESERVADAS_JSX.has(p) || p.includes('-')) continue;
          if (p.startsWith('aria') || p.startsWith('data') || p.startsWith('on') && !/^on[A-Z]/.test(p)) continue;
          if (props.has(p)) continue;
          findings.push({
            line: limpio.slice(0, ini).split('\n').length,
            label: `<${nombre}> no acepta \`${p}\` — React ignora el prop en silencio, así que el efecto que se espera no ocurre`,
            category: 'prop-inexistente', text: tag.replace(/\s+/g, ' ').slice(0, 120),
          });
        }
      }
    }
  }

  // ── `scroll-encadenado`: la baldosa que empuja el tablero ────────────────
  //
  // Reportado por el usuario (2026-08-14): «hay un problema con el scroll en el
  // widget (es general del dashboard), si scroleo y se acaba el scroll interno,
  // hace scroll externo, así que se mueve». Es el encadenamiento por defecto del
  // navegador: al llegar al final de un scroller anidado, la rueda sigue en el
  // de atrás. En el Inicio eso significa que revisar la lista de una baldosa
  // **mueve el tablero entero** debajo del puntero.
  //
  // La regla se acota al tablero a propósito: ahí TODO scroller vive dentro de
  // la rejilla, que a su vez scrollea, así que encadenar siempre está mal. En el
  // resto del portal hay scrollers que SON la página y contenerlos sería peor.
  //
  // Van los dos sitios porque el tablero está partido en dos: los widgets con
  // archivo propio en `views/dashboard/` y **diez más escritos dentro de
  // `DashboardView.jsx`** (turnos, ausencias, solicitudes, sucursales,
  // calendario, avisos, cumpleaños, cotizaciones, top productos, vendedores).
  // Arreglar sólo la carpeta dejaba sin tocar a **cuatro de los cinco** widgets
  // que de verdad scrolleaban — medido en el navegador, no leído: los que
  // scrollean dependen de cuántos datos traen, así que la lista no se puede
  // sacar del código. Estaba resuelto en `WidgetInventorySearch` y en ningún
  // otro: el patrón existía y no había nada que lo propagara.
  //
  // ── Y la vuelta de tuerca del 2026-08-20 ────────────────────────────────
  // `overscroll-contain` apaga los DOS encadenamientos: el accidental (a mitad
  // de un gesto, cuando la lista se acaba) y el deliberado (el gesto que
  // empieza con la lista ya en su tope). Con las baldosas cubriendo el Inicio,
  // lo segundo dejaba la página sin dónde agarrarse: «solo escrolea
  // internamente, si quiero escrolear todo debo salir y buscar otro lugar. lo
  // mismo en android. en iphone si funciona bien».
  //
  // La clase se queda —y esta categoría también— porque sigue siendo el piso
  // correcto. Lo que se le agregó es el escape, y vive en dos sitios que hay
  // que conocer ANTES de mover nada acá:
  //   · rueda → `src/utils/scrollEncadenado.js`
  //   · dedo  → `index.css`, §scroll del tablero
  // Si algún día esta categoría se apaga «porque el scroll no se puede mover»,
  // el arreglo es ése, no quitar la clase: quitarla revive el reporte del 14.
  const enTablero = path.startsWith('src/views/dashboard/') || path === 'src/views/DashboardView.jsx';
  if (enTablero && !hasException(path, 'scroll-encadenado')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      if (!/\boverflow-(?:y-)?auto\b/.test(line)) return;
      if (/\boverscroll-(?:contain|none)\b/.test(line)) return;
      findings.push({ line: i + 1,
        label: 'scroller de widget sin `overscroll-contain` — al terminar su lista la rueda sigue moviendo el tablero de atrás',
        category: 'scroll-encadenado', text: line.trim().slice(0, 120) });
    });
  }

  // ── `segmentado-a-mano`: una-de-N escrita con botones (§15.3) ────────────
  // «Si el estilo depende de `X === valor`, no es un botón con estado: es
  // `SegmentedControl`.» El detector busca la forma exacta que describe la
  // regla — un `.map()` sobre las opciones cuyo `<Button>` decide su
  // `variant`/`tone` comparando contra el PARÁMETRO del map:
  //
  //     {MOTIVOS.map((m) => <Button variant={motivo === m ? 'danger' : …} …
  //
  // Mirar sólo `variant={… === …}` no alcanza y además acusa al inocente: un
  // botón suelto que se pone rojo cuando la acción es destructiva
  // (`tone={modo === 'approve' ? 'success' : 'danger'}`) es correcto y hay tres
  // en el portal. Lo que delata al selector es la comparación contra la
  // variable que el map va repartiendo, o sea que hay N botones y uno está
  // «activo».
  if (!hasException(path, 'segmentado-a-mano')) {
    const limpio = sinComentarios(text);
    const MAP_RE = /\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
    let m;
    while ((m = MAP_RE.exec(limpio))) {
      const param = m[1];
      // El cuerpo del map: desde el `(` de `.map(` hasta su cierre.
      const abre = limpio.indexOf('(', m.index + 4);
      let prof = 0, j = abre;
      for (; j < limpio.length; j++) {
        const c = limpio[j];
        if (c === '(') prof++;
        else if (c === ')') { prof--; if (prof === 0) break; }
      }
      const cuerpo = limpio.slice(abre, j + 1);
      for (const [bi, bf] of tagsJsx(cuerpo, 'Button')) {
        const tag = cuerpo.slice(bi, bf);
        const est = /\b(?:variant|tone)=\{([^]*?)\}/.exec(tag);
        if (!est) continue;
        const cmp = new RegExp(`===\\s*${param}\\b|\\b${param}\\s*===`);
        if (!cmp.test(est[1])) continue;
        findings.push({
          line: limpio.slice(0, m.index).split('\n').length,
          label: 'una-de-N con botones — el estilo depende de `=== valor`, o sea que es `SegmentedControl` (§15.3)',
          category: 'segmentado-a-mano', text: tag.replace(/\s+/g, ' ').slice(0, 120),
        });
        break;
      }
    }
  }

  // ── `pestana-fuera-de-la-url`: la pestaña activa en `useState` ────────────
  //
  // Una pestaña guardada en `useState` se pierde con cualquier recarga: F5 —o
  // volver por el historial, o abrir el enlace que alguien pasó— devuelve a la
  // PRIMERA pestaña sin decir nada. No falla nada, no hay error, así que sólo
  // se nota como «la pantalla se movió sola». Pedido del usuario el 2026-08-20,
  // después de llevar las 20 vistas que faltaban al patrón: «que eso sea
  // canónico / regla siempre ante nuevas vistas».
  //
  // El canónico es `usePestanaEnUrl` (`src/hooks/usePestanaEnUrl.js`), que
  // además valida el `?tab=` contra las pestañas REALMENTE visibles — la parte
  // que se olvida al copiar el bloque a mano, y sin la cual un `?tab=loquesea`
  // deja la vista pintando el vacío.
  //
  // Una barra sin pestañas (`tabs={[]}`, `tabs={EMPTY_ARRAY}`) o con UNA sola
  // no tiene qué recordar: esas vistas usan `ViewTabBar` sólo por su buscador.
  if (!hasException(path, 'pestana-fuera-de-la-url')) {
    const limpio = sinComentarios(text);
    for (const [ini, fin] of tagsJsx(limpio, 'ViewTabBar')) {
      const tag    = limpio.slice(ini, fin);
      const tabs   = propDeTag(tag, 'tabs');
      const activa = propDeTag(tag, 'activeTab');
      if (tabs == null || activa == null) continue;
      // Si la lista está escrita ahí mismo se pueden contar; si viene de una
      // variable no se sabe, y se asume que son varias.
      const esLiteral = /^\[[\s\S]*\]$/.test(tabs.trim());
      const cuantas   = esLiteral ? (tabs.match(/\bkey\s*:/g) || []).length : 2;
      if (cuantas < 2) continue;
      const nombre = activa.trim();
      // `activeTab={algo.complejo}` no es un estado que se pueda rastrear.
      if (!/^[A-Za-z_$][\w$]*$/.test(nombre)) continue;
      const decl = new RegExp(`\\[\\s*${nombre}\\s*,[^\\]]*\\]\\s*=\\s*useState\\b`);
      if (!decl.test(limpio)) continue;
      findings.push({
        line: limpio.slice(0, ini).split('\n').length,
        label: `pestaña \`${nombre}\` en \`useState\` — se pierde al recargar; usar \`usePestanaEnUrl\` (DESIGN.md §14 · ViewTabBar)`,
        category: 'pestana-fuera-de-la-url',
        text: tag.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }

  // ── §15.3 — arriba de 3 opciones, un segmentado deja de comparar ──────────
  //
  // La regla decía «muchas opciones → LiquidSelect», y «muchas» no se puede
  // verificar: cada quien decide si ocho son muchas. El usuario la fijó en TRES
  // el 2026-08-17, mirando «Nivel de Precio Máximo» — ocho niveles en dos
  // renglones de píldoras que marcaban el alto de toda la fila de la rejilla y
  // dejaban «Super Usuario» con la mitad vacía, y a 1440 «Precio 7» cortado por
  // el borde de la tarjeta.
  //
  // Se cuentan las `value:` del literal de `options`. Cuando `options` sale de
  // una variable o de un `.map()` no hay nada que contar en el archivo: eso ya
  // lo cubre la otra mitad de la regla —«vienen de datos → LiquidSelect»— y no
  // se adivina acá.
  if (!hasException(path, 'segmentado-largo')) {
    const limpioSeg = sinComentarios(text);
    for (const [i, j] of tagsJsx(limpioSeg, 'SegmentedControl')) {
      const tag = limpioSeg.slice(i, j);
      const opts = /\boptions=\{\s*\[([^]*?)\]\s*\}/.exec(tag);
      if (!opts) continue;
      const n = (opts[1].match(/\bvalue\s*:/g) || []).length;
      if (n <= 3) continue;
      findings.push({
        line: limpioSeg.slice(0, i).split('\n').length,
        label: `SegmentedControl con ${n} opciones — arriba de 3 va \`LiquidSelect\` (§15.3)`,
        category: 'segmentado-largo',
        text: tag.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }

  return findings;
}

// ── Ratchet de baseline (D0.6, 2026-07-26) ──────────────────────────────
// Las categorías nuevas de D0 suman ~2,000 hallazgos reales. Si fallaran de
// una, el gate quedaría rojo hasta que termine D3 — y un gate permanentemente
// rojo no lo mira nadie, que es exactamente cómo se acumuló esta deuda.
//
// En vez de eso: baseline por categoría, versionado en git. El gate falla si
// el conteo de una categoría SUBE. Así la deuda existente no bloquea, pero
// deuda NUEVA sí — que es el objetivo real de D0 ("evitar que vuelva a
// driftar"). Cada fase baja el baseline de su categoría; cuando llega a 0,
// esa categoría queda bloqueante para siempre.
//
// Las categorías que hoy están en 0 (native, color, search-toggle,
// small-input, scale-tap, left-border, button-name, paleta-cerrada,
// input-sin-nombre) siguen siendo bloqueantes: su baseline es 0, así que
// cualquier hallazgo las hace fallar. Una categoría NUEVA que no figure en
// el JSON también arranca bloqueante (`baseline[c] ?? 0`) — agregarla al
// baseline es una decisión explícita, no el default.
//
// `npm run gate:design -- --update-baseline` reescribe el archivo. Se usa
// deliberadamente al BAJAR deuda, nunca para tapar un hallazgo nuevo.
const BASELINE_PATH = 'scripts/design-gate-baseline.json';

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).categories || {}; }
  catch { return {}; }
}

/**
 * Categoría `tema-incompleto` (PLAN-MATERIALES §19.1).
 *
 * Un token con COLOR FUERTE definido en `:root`, redefinido en algún bloque
 * Solid, y **ausente de `[data-theme="dark"]`** — o sea que Liquid oscuro
 * hereda un valor calibrado sobre una superficie clara.
 *
 * Apareció TRES veces en una sola sesión: el lente de §1.7 (`.62` de blanco
 * lavaba la superficie oscura), `--sidebar-rim` en `0.42` (contorno blanco
 * alrededor del panel, del flotante y del menú), y **once tokens de la escala
 * `--shadow-glass-*`**, todos con un `inset … rgba(255,255,255,.4–.95)`.
 *
 * Lo que los disfraza es justamente que Solid SÍ los redefine: leyendo el
 * archivo parecen tokens con tratamiento por tema. La pregunta «¿este token
 * cambia por tema?» devuelve *sí*; la correcta es **«¿cambia en los cuatro?»**.
 *
 * Que Solid lo redefina es la condición, no un detalle: si nadie lo redefine,
 * el token es geometría o tiempo —un radio, un blur, una duración— y compartir
 * valor entre claro y oscuro es lo correcto. Lo que delata a un token de COLOR
 * es que alguien ya decidió que su valor depende del material.
 */
function temaIncompleto() {
  const RUTA = 'src/index.css';
  if (!existsSync(RUTA)) return [];
  const lineas = readFileSync(RUTA, 'utf8').split('\n');

  // Bloques de primer nivel, por profundidad de llaves. Un parser ingenuo que
  // corta en el primer `}` cierra `:root` en la primera regla anidada y se
  // pierde el 80% de los tokens (medido: 0 en vez de 402).
  const bloques = [];
  let actual = null, prof = 0;
  lineas.forEach((l, i) => {
    if (!actual) {
      const m = l.match(/^(:root|\[data-theme=[^{]*)\s*\{/);
      if (m) { actual = { sel: m[1].trim(), tokens: new Map() }; prof = 1; }
      return;
    }
    prof += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
    if (prof <= 0) { bloques.push(actual); actual = null; prof = 0; return; }
    const t = l.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (t) actual.tokens.set(t[1], { valor: t[2].trim(), linea: i + 1 });
  });
  if (actual) bloques.push(actual);

  const unir = (pred) => {
    const m = new Map();
    for (const b of bloques) if (pred(b.sel)) for (const [k, v] of b.tokens) if (!m.has(k)) m.set(k, v);
    return m;
  };
  const root  = unir(sel => sel === ':root');
  const dark  = unir(sel => /\[data-theme="dark"\]/.test(sel));
  const solid = unir(sel => /\[data-theme="solid(-dark)?"\]/.test(sel));

  // «Color fuerte»: un canal con alfa ≥ .30, o un hex. Por debajo de .30 el
  // valor es un matiz y heredarlo entre claro y oscuro rara vez se nota.
  const fuerte = (v) => {
    if (/#[0-9a-f]{3,8}\b/i.test(v)) return true;
    for (const m of v.matchAll(/rgba?\(\s*[\d\s,./]+?[,/]\s*(\.?\d*\.?\d+)\s*\)/g))
      if (parseFloat(m[1]) >= 0.30) return true;
    return false;
  };

  const out = [];
  for (const [tok, { valor, linea }] of root) {
    if (!fuerte(valor) || dark.has(tok) || !solid.has(tok)) continue;
    out.push({
      line: linea, category: 'tema-incompleto',
      label: `\`${tok}\` tiene color fuerte, Solid lo redefine y \`[data-theme="dark"]\` no — `
           + 'Liquid oscuro hereda un valor calibrado en claro (§19.1)',
      text: valor.slice(0, 60),
    });
  }
  return out;
}

function main() {
  const files = listFiles();
  const byFile = {};
  const byCategory = {};
  let total = 0;

  // ── `tema-incompleto`: se corre UNA vez sobre index.css ──────────────────
  {
    const tema = temaIncompleto();
    if (tema.length) {
      byFile['src/index.css'] = (byFile['src/index.css'] || []).concat(tema);
      total += tema.length;
      byCategory['tema-incompleto'] = (byCategory['tema-incompleto'] || 0) + tema.length;
    }
  }

  for (const file of files) {
    if (EXCLUDE_FILES.has(file)) continue;
    const findings = scanFile(file);
    if (findings.length) {
      byFile[file] = findings;
      total += findings.length;
      for (const f of findings) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ byFile, byCategory }, null, 2));
    process.exit(0);
  }

  if (process.argv.includes('--update-baseline')) {
    writeFileSync(BASELINE_PATH, JSON.stringify({
      _comment: 'Ratchet del gate de diseño. El gate falla si una categoría SUBE respecto a estos números. Cada fase del plan (docs/planes-cerrados/AUDITORIA-DISENO-2026-07-26.md) baja los suyos; al llegar a 0 la categoría queda bloqueante. Regenerar solo al BAJAR deuda: npm run gate:design -- --update-baseline',
      updated: new Date().toISOString().slice(0, 10),
      categories: byCategory,
    }, null, 2) + '\n');
    console.log(`✓ Baseline actualizado en ${BASELINE_PATH}`);
    for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c.padEnd(14)} ${n}`);
    }
    process.exit(0);
  }

  const baseline = loadBaseline();
  const categories = [...new Set([...Object.keys(byCategory), ...Object.keys(baseline)])].sort();
  const regressions = [];

  for (const c of categories) {
    const now = byCategory[c] || 0;
    const max = baseline[c] ?? 0;
    if (now > max) regressions.push({ c, now, max });
  }

  // Detalle solo de lo que regresó, y acotado a los archivos que el autor
  // acaba de tocar. Sin este filtro, agregar un solo `bg-white` imprimía los
  // 1,094 hallazgos de deuda conocida de esa categoría — output que nadie
  // lee, que es justamente cómo se acumuló todo esto. La regresión casi
  // siempre está en lo que se modificó; `--json` sigue dando el volcado
  // completo para análisis.
  if (regressions.length) {
    const bad = new Set(regressions.map(r => r.c));
    let touched = null;
    try {
      const out = execSync('git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null')
        .toString().trim();
      const set = new Set(out ? out.split('\n').filter(Boolean) : []);
      if (set.size) touched = set;
    } catch { /* sin git, o repo recién creado: se cae al modo capado */ }

    const scope = Object.entries(byFile).filter(([f]) => !touched || touched.has(f));
    const shown = scope.length ? scope : Object.entries(byFile);
    if (touched && scope.length) {
      console.log('\n(solo archivos modificados respecto a HEAD — usá --json para el volcado completo)');
    }
    let printed = 0;
    for (const [file, findings] of shown) {
      const rel = findings.filter(f => bad.has(f.category));
      if (!rel.length) continue;
      console.log(`\n${file} (${rel.length})`);
      for (const f of rel) {
        if (printed++ >= 40) { console.log('  … (truncado, usá --json)'); break; }
        console.log(`  L${f.line} [${f.category}] ${f.label} — ${f.text}`);
      }
      if (printed >= 40) break;
    }
  }

  console.log('\n── Estado por categoría ' + '─'.repeat(34));
  for (const c of categories) {
    const now = byCategory[c] || 0;
    const max = baseline[c] ?? 0;
    const mark = now > max ? '✗' : now < max ? '↓' : now === 0 ? '✓' : '·';
    const note = now > max ? `SUBIÓ +${now - max}` : now < max ? `bajó -${max - now} (correr --update-baseline)` : '';
    console.log(`  ${mark} ${c.padEnd(14)} ${String(now).padStart(5)} / ${String(max).padEnd(5)} ${note}`);
  }

  if (regressions.length) {
    console.log(`\n✗ ${regressions.length} categoría(s) con deuda nueva: ${regressions.map(r => r.c).join(', ')}`);
    process.exit(1);
  }
  console.log(`\n✓ Sin deuda nueva. Total bajo baseline: ${total} hallazgo(s) en ${Object.keys(byFile).length} archivo(s).`);
  process.exit(0);
}

main();
