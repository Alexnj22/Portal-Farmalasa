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
// AUDITORIA-TEMA-2026-07.md. Si un archivo nuevo necesita una excepción,
// agregarla aquí Y documentar el motivo en DESIGN.md — nunca solo aquí.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOTS = ['src'];
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
  // Superficies fijas-oscuras (no siguen el tema activo, confirmado en DESIGN.md §6)
  // sidebar + blobs ambientales ('color'); 'search-toggle': searchOpen es el
  // modal ⌘K de navegación global — ya tiene su propio Escape + click en el
  // backdrop para cerrar (patrón de modal estándar, cierra siempre sin
  // importar el texto tipeado, a diferencia de un buscador inline donde
  // perder el texto por accidente sí importa). Ver MenuSearchModal.jsx.
  'src/components/layout/AppLayout.jsx': ['color', 'search-toggle'],
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
  'src/views/pedidos/RutaMapModal.jsx': ['color'], // marcadores Leaflet (L.divIcon HTML)
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
  'src/views/StaffManagementView.jsx': ['color'], // tooltip flotante dark
  'src/views/DashboardView.jsx': ['color'], // tooltips flotantes dark (resto del archivo ya tokenizado)
  // Superficies kiosco / cámara / editor de foto — siempre-oscuras por diseño
  'src/views/TimeClockView.jsx': ['color'], // 2026-07-25: fondo/blobs migrados a bg-surface-page + tokens del tema dark; excepción ya solo cubre los 3 micro-acentos azules bespoke de la card del reloj (from-blue-950/from-blue-400/via-blue-400 — hero accent deliberado, no base surface)
  'src/views/LoginView.jsx': ['color'], // scanner de cámara + fondo splash bespoke (comparte gradiente con App.jsx)
  'src/components/timeclock/KioskConfigModal.jsx': ['color'],
  'src/components/timeclock/FeedbackOverlay.jsx': ['color'], // overlay kiosco full-screen
  'src/components/common/PhotoEditorModal.jsx': ['color'], // canvas de edición siempre-oscuro
  'src/components/common/ThemeToggle.jsx': ['color'], // host siempre-oscuro documentado inline (SidebarSettingsMenu)
  // Ilustraciones / branding de terceros — no son superficies del sistema de tokens
  'src/components/forms/FormAuditDetail.jsx': ['color'], // mockup de ventana macOS (colores reales del semáforo Apple)
  'src/views/AccessDeniedView.jsx': ['color'], // verde real de marca WhatsApp
  'src/views/NoAccessView.jsx': ['color'], // verde real de marca WhatsApp
  'src/App.jsx': ['color'], // fondo splash bespoke (comparte gradiente con LoginView)
  // Vistas de diagnóstico/QA, no UI real de negocio
  'src/views/RawTestView.jsx': ['color'],
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
  'src/components/timeclock/FeedbackOverlay.jsx': ['color', 'typography'],
  'src/views/employee/EmployeeAnnouncementsView.jsx': ['typography'],
};

const hasException = (file, category) => (EXCEPTIONS[file] || []).includes(category);

function listFiles() {
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
const WHITE_RE = new RegExp(
  `\\b(${COLOR_PREFIXES.join('|')})-(white|black)(?![\\w-])(\\/(\\[[^\\]]+\\]|[\\d.]+))?`,
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
const SHADOW_LITERAL_RE = /shadow-\[(?!var\(--)[^\]]+\]/g;

// ── Categoría 9: motion (D0.5, 2026-07-26) ──────────────────────────────
// La regla vieja ("no new framer-motion usage") baneaba la librería entera
// sin distinguir para qué se usa, y por eso se incumplía: 20 de los 25
// archivos la usan para lo que CSS NO puede hacer — AnimatePresence anima
// el DESMONTAJE (cuando React quita el nodo no queda nada que animar) y
// layout/layoutId hace transiciones FLIP entre posiciones. La regla nueva
// permite esas capacidades y prohíbe solo `motion.*` decorativo
// (fade/slide de entrada, hover, tap), que sí es @keyframes + Tailwind.
const MOTION_IMPORT_RE = /from\s+['"]framer-motion['"]/;
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

  if (!hasException(path, 'motion') && MOTION_IMPORT_RE.test(text)) {
    if (!MOTION_ALLOWED_RE.test(text)) {
      findings.push({ line: 1, label: 'framer-motion decorativo (sin AnimatePresence/layout/drag) — usar @keyframes + Tailwind', category: 'motion', text: path });
    }
    if (!REDUCED_MOTION_RE.test(text)) {
      findings.push({ line: 1, label: 'framer-motion sin useReducedMotion — ignora prefers-reduced-motion (S1.6)', category: 'motion', text: path });
    }
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
// small-input, scale-tap, left-border) siguen siendo bloqueantes: su
// baseline es 0, así que cualquier hallazgo las hace fallar.
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
      _comment: 'Ratchet del gate de diseño. El gate falla si una categoría SUBE respecto a estos números. Cada fase del plan (AUDITORIA-DISENO-2026-07-26.md) baja los suyos; al llegar a 0 la categoría queda bloqueante. Regenerar solo al BAJAR deuda: npm run gate:design -- --update-baseline',
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
