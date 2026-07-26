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

import { readFileSync } from 'node:fs';
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
// Hex crudo dentro de className/style (evita falsos positivos de hashes/ids sueltos)
const HEX_RE = /(?:className|style)=[^>]*?#[0-9a-fA-F]{3,8}\b/g;

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
      HEX_RE.lastIndex = 0;
      if (HEX_RE.test(line)) {
        findings.push({ line: i + 1, label: 'hex crudo', category: 'color', text: line.trim().slice(0, 120) });
      }
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

function main() {
  const files = listFiles();
  let total = 0;
  const byFile = {};

  for (const file of files) {
    if (EXCLUDE_FILES.has(file)) continue;
    const findings = scanFile(file);
    if (findings.length) {
      byFile[file] = findings;
      total += findings.length;
    }
  }

  const jsonMode = process.argv.includes('--json');
  if (jsonMode) {
    console.log(JSON.stringify(byFile, null, 2));
  } else {
    for (const [file, findings] of Object.entries(byFile)) {
      console.log(`\n${file} (${findings.length})`);
      for (const f of findings) {
        console.log(`  L${f.line} [${f.category}] ${f.label} — ${f.text}`);
      }
    }
    console.log(`\n${total ? '✗' : '✓'} ${total} hallazgo(s) en ${Object.keys(byFile).length} archivo(s) sin excepción documentada.`);
  }

  process.exit(total ? 1 : 0);
}

main();
