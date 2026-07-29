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
//             hoy).
const EXCEPTIONS = {
  // Acá es donde los cuatro retirados se DEFINEN como alias — es la solución,
  // no la deuda. Y los canónicos los siguen aceptando a propósito para que las
  // 343 referencias vivas no se rompan mientras migran.
  // Badge/Button/Switch NO están acá: ya tenían entrada más abajo (por 'white'
  // y 'hex') y repetir la clave habría borrado una de las dos. Llevan
  // 'chart-retirado' en aquella. Ver `assertSinClavesDuplicadas`.
  'src/index.css': ['chart-retirado'],
  'src/components/common/SegmentedControl.jsx': ['chart-retirado'],
  'src/components/common/TabBarAction.jsx': ['chart-retirado'],
  'src/components/common/Contador.jsx': ['chart-retirado'],
  // Superficies fijas-oscuras (no siguen el tema activo, confirmado en DESIGN.md §6)
  // sidebar + blobs ambientales ('color'); 'search-toggle': searchOpen es el
  // modal ⌘K de navegación global — ya tiene su propio Escape + click en el
  // backdrop para cerrar (patrón de modal estándar, cierra siempre sin
  // importar el texto tipeado, a diferencia de un buscador inline donde
  // perder el texto por accidente sí importa). Ver MenuSearchModal.jsx.
  // 'shadow-literal': el filo del ítem activo es el único glow BICOLOR del
  // portal (verde + magenta del logo). La escala --shadow-glow-* es de un color
  // por token; un token propio para esto sería una escala de uno.
  'src/components/layout/AppLayout.jsx': ['color', 'search-toggle', 'z-index', 'shadow-literal'],
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
  'src/components/forms/FormWfmAnalytics.jsx': ['color'], // tooltip flotante dark
  'src/components/timeclock/IdleScanPanel.jsx': ['color'], // kiosco
  'src/views/AttendanceMonitorView.jsx': ['color'], // wallboard isDarkConcept
  // Shimmer decorativo de IA idéntico (DESIGN.md §6)
  'src/views/branch-tabs/TabHistory.jsx': ['color'],
  'src/views/BranchesView.jsx': ['color'],
  'src/views/branch-tabs/TabExpediente.jsx': ['color'],
  'src/components/forms/FormAiSchedulerPreview.jsx': ['color'],
  // Mapas/canvas/PDF — colores hex directos por naturaleza de la tecnología
  'src/views/CotizacionesView.jsx': ['color'],
  'src/views/pedidos/CrearRutaModal.jsx': ['color'], // marcadores Leaflet (L.divIcon HTML)
  'src/views/PayrollView.jsx': ['color'], // plantilla de impresión (boleta HTML)
  // Tooltips flotantes dark (DESIGN.md §6 — no siguen el tema activo por diseño)
  'src/components/forms/FormEditPayrollEntry.jsx': ['color'],
  'src/components/common/SidebarSyncStatus.jsx': ['color'],
  'src/views/pedidos/tabpedidos/LifecycleTimeline.jsx': ['color'],
  'src/views/schedule-tabs/components/SalyCopilot.jsx': ['color'], // caja IA siempre-oscura, mismo patrón shimmer
  'src/views/schedule-tabs/components/ScheduleChart.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/schedule-tabs/TabShifts.jsx': ['color'], // caja IA siempre-oscura
  'src/views/EmployeeDetailView.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/AttendanceAuditView.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/VentasView.jsx': ['color'], // tooltip flotante dark (resto del archivo ya tokenizado)
  'src/views/VacationPlanView.jsx': ['color'], // tooltips flotantes dark
  // Superficies kiosco / cámara / editor de foto — siempre-oscuras por diseño
  'src/views/TimeClockView.jsx': ['color'], // 2026-07-25: fondo/blobs migrados a bg-surface-page + tokens del tema dark; excepción ya solo cubre los 3 micro-acentos azules bespoke de la card del reloj (from-blue-950/from-blue-400/via-blue-400 — hero accent deliberado, no base surface)
  'src/views/LoginView.jsx': ['color', 'z-index', 'input-a-mano'], // scanner de cámara + fondo splash bespoke (comparte gradiente con App.jsx)
  'src/components/timeclock/KioskConfigModal.jsx': ['color'],
  'src/components/common/ThemeToggle.jsx': ['color'], // host siempre-oscuro documentado inline (SidebarSettingsMenu)
  // Ilustraciones / branding de terceros — no son superficies del sistema de tokens
  // 'relleno-sin-solid': `selection:bg-success/30 selection:text-white` es el
  // resaltado de SELECCIÓN de texto, no un relleno de control — el usuario ve
  // ese par solo mientras arrastra sobre el bloque de código.
  'src/components/forms/FormAuditDetail.jsx': ['color', 'relleno-sin-solid'], // mockup de ventana macOS (colores reales del semáforo Apple)
  'src/views/AccessDeniedView.jsx': ['color'], // verde real de marca WhatsApp
  'src/views/NoAccessView.jsx': ['color'], // verde real de marca WhatsApp
  'src/App.jsx': ['color'], // fondo splash bespoke (comparte gradiente con LoginView)
  // Vistas de diagnóstico/QA, no UI real de negocio
  'src/views/IOSTestView.jsx': ['color'],
  // Banner bespoke fijo (franja rayada ámbar/naranja con texto oscuro fijo,
  // no reactivo al tema — ver src/version.js v2.57.1)
  'src/components/common/ThemeMigrationRibbon.jsx': ['color'],
  // Los componentes canónicos SON la implementación del select/date-picker/
  // modal — su interior legítimamente toca lo nativo que envuelven.
  'src/components/common/LiquidSelect.jsx': ['native'],
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
  'src/utils/conteoInventarioPrint.js': ['hex'],  // pdfmake: docDefinition, no CSS
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
  'src/components/timeclock/FeedbackOverlay.jsx': ['color', 'typography', 'relleno-sin-solid'],
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
  'src/views/employee/EmployeeProfileView.jsx': ['white'],
  'src/views/productos/tabminmax/LabsPanel.jsx': ['white'],
  // Barridos especulares (`via-white/[0.08-0.25]`) sobre botones brand: el
  // fondo es azul en los 4 temas, así que el destello blanco es correcto —
  // ya se decidió en el barrido de v2.62.4. Y los dos `bg-white` que quedan
  // son puntos de un timeline/paso sobre una línea de color.
  'src/components/common/ErrorBoundary.jsx': ['white', 'z-index'],
  'src/views/RequestsView.jsx': ['white'],
  'src/views/EncuestaView.jsx': ['white'],
  'src/components/forms/FormNursingRegents.jsx': ['white'],
  'src/views/productos/TabMinMax.jsx': ['white', 'z-index'],
  // ── Superficies siempre-oscuras, agregadas al cerrar D3.8 (2026-07-27) ──
  // Mismo criterio que IdleScanPanel: los paneles del kiosco y los popovers
  // anclados al sidebar NO siguen el tema activo — son oscuros en los cuatro.
  // Ahí `bg-white/[0.06]` y `border-white/10` no son deuda: son la paleta
  // bespoke de esa superficie, que ya está documentada en DESIGN.md §6.
  'src/components/timeclock/AuthPromptPanel.jsx': ['color', 'white', 'input-a-mano'],
  'src/components/timeclock/SelfDeclareShiftPanel.jsx': ['color', 'white'],
  'src/components/timeclock/EarlyExitForm.jsx': ['color', 'white'],
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
  'src/views/productos/TabCatalogo.jsx': ['hex'],
  'src/views/productos/tabminmax/constants.js': ['hex'],
  // ── D2.2, cierre (2026-07-27) ──────────────────────────────────────────
  // Los 20 `zIndex:` que quedaban son tooltips y popovers PORTALEADOS: se
  // renderizan en document.body y calculan su top/left contra el elemento que
  // los dispara, así que ya necesitan `style` sí o sí. Mover solo el z-index a
  // una clase partiría la decisión de apilamiento en dos mecanismos — peor que
  // dejarla junta. Se excepciona con motivo para que la categoría llegue a 0 y
  // quede BLOQUEANTE: a partir de acá, cualquier zIndex inline NUEVO falla.
  'src/views/DashboardView.jsx': ['color', 'z-index'],
  'src/views/StaffManagementView.jsx': ['color', 'z-index'],
  'src/components/common/LiquidWeekPicker.jsx': ['z-index'],
  'src/components/common/PhotoEditorModal.jsx': ['color', 'z-index'],
  'src/views/productos/tabminmax/RowActions.jsx': ['z-index'],
  'src/views/pedidos/RecepcionModal.jsx': ['z-index'],
  'src/views/pedidos/RutaMapModal.jsx': ['color', 'z-index'],
  'src/views/employee/EmployeeAnnouncementsView.jsx': ['typography', 'z-index'],
  'src/views/RawTestView.jsx': ['color', 'z-index'],
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

  // 'white' y 'hex' heredan la excepción de 'color': los archivos ya
  // excepcionados lo están por ser superficies bespoke de color fijo
  // (sidebar siempre-oscuro, kiosco, splash, canvas/PDF, marca de terceros)
  // — exactamente el mismo motivo por el que su blanco y su hex son
  // legítimos. Duplicar las ~25 entradas no agregaría información.
  if (!hasException(path, 'color') && !hasException(path, 'white')) {
    lines.forEach((line, i) => {
      if (isComment[i]) return;
      WHITE_RE.lastIndex = 0;
      let m;
      while ((m = WHITE_RE.exec(line))) {
        findings.push({ line: i + 1, label: `blanco/negro crudo: ${m[0]}`, category: 'white', text: line.trim().slice(0, 120) });
      }
    });
  }

  if (!hasException(path, 'color') && !hasException(path, 'hex')) {
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

  if (!hasException(path, 'color') && !hasException(path, 'inline-color')) {
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
    const sinComentarios = text.replace(/\/\*[\s\S]*?\*\//g,
      m => m.replace(/[^\n]/g, ' '));
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
    const sinComentarios2 = text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
      .replace(/\/\*[\s\S]*?\*\//g,     m => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g,             m => m.replace(/[^\n]/g, ' '));
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
    // Exige las cuatro señales juntas y descarta las cajas de ícono
    // (`w-10 h-10`) para no marcar píldoras ni avatares. No mira las
    // superficies bespoke: sidebar, kiosco y login (DESIGN.md §25.4).
    if (!/timeclock\/|LoginView|AppLayout/.test(path)) {
      const RE_DIV = /<div\b(?:(?!>).)*?>/gs;
      let md;
      while ((md = RE_DIV.exec(sinComentarios2))) {
        const tag = md[0];
        if (tag.includes('data-surface')) continue;
        const mc = tag.match(/className=[{`"]+([^`"}]*)/);
        if (!mc) continue;
        const c = mc[1];
        // `\b` después de "card" también matchea `bg-surface-card-hover`, que es
        // OTRO token (la superficie de realce, no la de tarjeta). Se vio al
        // migrar el pie de RolesView y marcaba como tarjeta algo que no lo es.
        if (!/bg-surface-card(?!-)/.test(c)) continue;
        if (!/\bborder\b|border-(divider|border-card)/.test(c)) continue;
        if (!/rounded-(2xl|3xl|card|modal|header)/.test(c)) continue;
        if (!/\bp-[3-9]|\bp-1[0-9]|\bpx-[4-9]|\bpy-[3-9]/.test(c)) continue;
        if (/\bw-\d{1,2}\b|\bh-\d{1,2}\b/.test(c)) continue;
        const linea = sinComentarios2.slice(0, md.index).split('\n').length;
        findings.push({ line: linea, label: 'tarjeta a mano — usar `data-surface="card"` (DESIGN.md §5)',
          category: 'tarjeta-a-mano', text: tag.replace(/\s+/g, ' ').slice(0, 120) });
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

function main() {
  const files = listFiles();
  const byFile = {};
  const byCategory = {};
  let total = 0;

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
