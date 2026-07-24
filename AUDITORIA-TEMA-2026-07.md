# AUDITORÍA VISUAL DE TEMA 2026-07 — Estado actual + plan para cambiar el tema

> **Cómo usar este documento**: es la auditoría visual + plan ejecutable del sistema de
> tema, y el PUNTO DE ENTRADA de todo el trabajo visual (móvil + estilo). Al decir
> "inicia/continúa AUDITORIA-TEMA-2026-07.md", el orden obligatorio es:
> **(1)** ~~verificar Fases 1–3 de PLAN-MOBILE~~ **YA CUMPLIDO (2026-07-23,
> v2.30.0–v2.32.1)**: shell móvil resuelto y confirmado en dispositivo real —
> body scroll, header sticky, PWA standalone funcional (ver
> `AUDITORIA-MOBILE-HEADER-STANDALONE-2026-07.md`). **(2)** Continuar aquí con
> la primera Fase T pendiente (T1), validando cada fase contra el **contrato de
> completitud §8** (agregado 2026-07-23 a pedido del usuario: DESIGN.md v2.0
> completo y finalizado es el criterio de cierre). Cada fase termina con su verificación visual y su commit propio
> (bump de `APP_VERSION` + changelog). La Fase T2 termina en un GATE: mostrar las
> capturas del prototipo y esperar aprobación del usuario antes de T3.
> Auditoría hecha el 2026-07-22 sobre v2.29.2, con
> Playwright (Chromium 1440×900) contra `npm run dev`, evidencia en
> `docs/audits/tema-2026-07/` (capturas + `audit-shots.mjs`, el script reutilizable
> que loguea y captura las vistas clave en los 4 temas).

---

## 0. Decisiones acordadas (2026-07-22)

1. **Secuencia**: primero PLAN-MOBILE-2026-07.md **Fases 1–3** (scroll estructural,
   crash del Dashboard, estándares del shell). Son bugs P0 agnósticos al tema: nada
   de ese trabajo se pierde si después cambia lo visual.
2. **Después** este plan (Fases T1–T7). La **Fase 4 del plan móvil (pasada vista por
   vista) se absorbe aquí**: cada vista se toca UNA sola vez, migrando tokens de tema
   y adaptación responsive en el mismo pase. La Fase 5 móvil (matriz de verificación)
   se funde con la matriz de QA de este plan (§T7).
3. **Nuevo estilo de diseño**: el objetivo NO es solo hacer el tema cambiable — es
   estrenar un estilo nuevo, **"Solid Modern"** (especificación completa en §7),
   como default: moderno, sin blur (eficiente en hardware viejo) y con densidad
   adaptativa para resoluciones bajas.
4. **Resolución mínima desktop soportada: 1024×768** (hay monitores/PCs antiguos en
   tiendas). Viewport útil real a esa resolución: ~1024×620 (chrome del navegador +
   taskbar) — la altura es la restricción dura, no solo el ancho.
5. **Liquid Glass**: se decide si sobrevive como tema opcional **después de ver el
   prototipo** de Solid Modern (Fase T2). Hasta entonces no se borra nada.

---

## 1. El hallazgo central

**El sistema de temas ya existe. Lo que no existe es su adopción.**

`src/index.css` define un sistema de design tokens completo (líneas 8–192) con
**4 temas**: `liquid` (glass claro, el default), `dark` (glass oscuro), `solid`
(claro plano) y `solid-dark` (oscuro plano). Cada tema resuelve ~40 variables:
fondo de página, 3 niveles de texto, 7 superficies, 6 bordes, 6 sombras, radios y
backdrops. Hay primitivas `[data-surface="card|page-header|modal|dropdown|input|tab-track"]`
que consumen esos tokens, un `ThemeContext` funcional (`src/context/ThemeContext.jsx`,
con persistencia en localStorage y `cycleTheme`) y hasta un `ThemeToggle`
(`src/components/common/ThemeToggle.jsx`).

Pero la medición de adopción da esto:

| Métrica (grep sobre `src/`, 197 archivos JSX) | Valor |
|---|---|
| Archivos que usan `data-surface` | **8** |
| Archivos que usan `var(--...)` en JSX | **1** |
| `ThemeToggle` montado en la UI | **0 veces** (definido, nunca importado) |
| Ocurrencias `text-slate-*` | 4,113 |
| Ocurrencias `bg-white*` | 1,644 |
| Ocurrencias `bg-slate-*` | 891 |
| Ocurrencias `border-white*` | 847 |
| Ocurrencias `text-white` | 770 |
| Ocurrencias semánticas hardcodeadas (red/rose, amber/orange, emerald/green) | ~2,000 |
| Ocurrencias `backdrop-blur` | 510 |
| Hex colors distintos hardcodeados | **105** (`#0052CC` aparece 1,156 veces) |

Conclusión: **"cambiar el tema" hoy = editar ~10,000 clases repartidas en 197
archivos**. Por eso los temas alternativos, aunque definidos, están rotos (ver §3).
El trabajo no es diseñar temas nuevos: es **migrar el consumo** de colores
hardcodeados a los tokens que ya existen. Una vez hecho eso, cambiar el tema (o
crear uno nuevo) es editar un bloque de ~40 variables en un solo archivo.

## 2. Inventario del tema actual (liquid)

### 2.1 Tokens fuente de verdad (`src/index.css:8-72`)

- **Brand**: `#0052CC` (azul), `#003D99` (hover/dark), `#6929C4` (púrpura de acentos).
- **Semánticos**: success `#12B76A`, warning `#F79009`, danger `#F04438`.
- **Fondo de página**: gradiente radial lavanda (`#ddd8ff → #e4e0ff → #eae8ff → #e2deff`)
  + blobs animados `animate-ambient-drift` (DESIGN.md §4).
- **Texto**: primary `#1e293b`, secondary `#475569`, tertiary `#64748b` (= slate-800/600/500,
  de ahí que las clases `text-slate-*` hardcodeadas "coincidan" en liquid y se rompan en
  cualquier otro tema).
- **Glass**: superficies `rgba(230,245,255,…)` con `blur(32-48px) saturate(160-280%)`,
  bordes blancos translúcidos, sombras con inset highlight.

### 2.2 Dónde vive lo hardcodeado (los focos de la migración)

- `src/App.jsx:532,548`: el wrapper del portal entero tiene **`bg-[#E6F0FF]` hardcodeado**
  (ni siquiera coincide con el `--bg-page` lavanda de los tokens: el gradiente que se ve
  es de los blobs ambient). Es la razón #1 de que dark/solid-dark queden con fondo claro.
- Componentes compartidos (DESIGN.md §13-15): `GlassViewLayout`, `ViewTabBar`, `DataTable`,
  `LiquidSelect`, `ModalShell`/`LiquidModal`/`UnifiedModal`/`ConfirmModal`, `TablePagination`,
  `LiquidToast`, botones CTA — todos con paleta glass inline (`bg-white/40
  backdrop-blur-[30px] border-white/80 …`). **Máximo apalancamiento**: migrarlos
  arregla de golpe la mayor parte de cada vista.
- Las 40+ vistas: texto `text-slate-*`, cards `bg-white/60`, filter pills, badges.
- Sidebar: paleta oscura propia (DESIGN.md §6 — "always dark regardless of theme").
  Decisión existente que se mantiene: la sidebar es invariante al tema, como en apps iOS.
- `tailwind.config.js`: quedó residual (keyframes + `shadow-glass`/`rounded-glass` legacy);
  el proyecto ya está en **Tailwind v4** (`@import "tailwindcss"` en index.css), que es
  justo la versión donde los tokens CSS se integran nativo vía `@theme` (§4, Fase T1).

### 2.3 Lo que ya está bien y se conserva

- La escala de radios/sombras/blur está tokenizada y documentada (DESIGN.md §3, §8-10).
- Animaciones centralizadas con `prefers-reduced-motion` completo (index.css:469-508).
- Focus rings de accesibilidad globales (index.css:430-439).
- Print styles que "des-glassean" (index.css:514-536).
- `color-scheme` declarado por tema (scrollbars/inputs nativos correctos).

## 3. Evidencia visual (capturas en `docs/audits/tema-2026-07/`)

| Captura | Qué muestra |
|---|---|
| `02-inicio-liquid.png`, `03-ventas-liquid.png` | **Tema actual: sólido y consistente.** Glass legible, jerarquía clara, sidebar oscura estable. El punto de partida es bueno — esto no es un rescate, es una consolidación. |
| `06-inicio-dark.png`, `07-ventas-dark.png` | **Dark roto**: los tokens oscurecen las superficies pero el fondo sigue claro (el `bg-[#E6F0FF]` de App.jsx + blobs), el texto tokenizado se vuelve blanco sobre fondo claro (KPIs ilegibles: "0% del total" desaparece), las filter pills siguen `bg-white`. Frankenstein a medio camino. |
| `06-inicio-solid.png` | **Solid casi-funciona de casualidad** (las vistas ya eran claras), pero el fondo de página sigue siendo el gradiente lavanda en vez del `#f1f5f9` del token, y todo el glass sigue pagando blur sin verse. |
| `07-ventas-solid-dark.png` | **Solid-dark, el peor caso**: header oscuro con tabs invisibles (VENDEDORES/PRODUCTOS desaparecen), card oscura con tabla interior clara, pills blancas junto a dropdowns negros. |

Lectura importante: los temas alternativos **no están mal diseñados** — sus tokens son
razonables. Se ven así porque el 95% de la UI no los consulta.

## 4. Plan: cómo cambiamos el tema (Fases T1–T7)

La estrategia es **hacer que el tema sea una propiedad de un solo archivo**, y con
esa palanca estrenar el estilo nuevo (§7). El orden importa: primero el puente de
tokens (T1), luego el prototipo aprobable del estilo (T2), y solo entonces la
migración masiva (T3–T4) — así ninguna vista se toca dos veces ni se migra hacia
un estilo que no esté validado.

### Fase T1 — Puente Tailwind v4: tokens → utilidades semánticas

En `index.css`, declarar los tokens dentro de `@theme` para que Tailwind 4 genere
utilidades directamente:

```css
@theme inline {
  --color-brand:        var(--brand);
  --color-brand-dark:   var(--brand-dark);
  --color-success:      var(--success);
  --color-warning:      var(--warning);
  --color-danger:       var(--danger);
  --color-content:      var(--text-primary);
  --color-content-2:    var(--text-secondary);
  --color-content-3:    var(--text-tertiary);
  --color-surface-card: var(--surface-card);
  /* … resto de superficies/bordes */
}
```

Resultado: `text-content`, `text-content-2`, `bg-surface-card`, `border-card`,
`text-brand`, `bg-danger/10`… son clases Tailwind normales (con opacidad, hover,
breakpoints) que **reaccionan al tema activo**. Esto convierte la migración en un
reemplazo mecánico de clases, no en reescritura de componentes.
Definir aquí también el mapeo semántico completo de estados (§referencia product):
hover, selected, disabled, error, warning, success, info.

**Alcance ampliado (auditoría §8, 2026-07-23)**: el puente cubre TODOS los
fundamentos de §8.1, no solo color — tipografía por rol, escala de espaciado,
duraciones/easings, z-index canónico, focus-ring, scrim/divisores y paleta
dataviz. Un solo pase de infraestructura; nada visual cambia todavía.

### Fase T2 — Definir y prototipar "Solid Modern" (gate de aprobación) 🎯

1. Escribir el bloque de tokens del tema nuevo partiendo de `[data-theme="solid"]`
   existente, ajustado a la especificación de §7 (fondo, superficies, sombras,
   radios) + los **tokens de densidad** nuevos (`--space-*`, `--control-h`,
   `--row-h`, `--header-h`) con sus 3 niveles (§7.4). **Entrega además el
   contrato de tema completo (§8.4)**: ramps semánticas con estados, paleta
   dataviz, escala de elevación, y la matriz de contraste AA verificada por
   script — es decir, T2 no define "unos colores": define TODO lo que un tema
   debe declarar, con Solid Modern como primer tema que cumple el contrato.
   También fija la tabla canónica de breakpoints (§8.1: lg:1024 shell,
   md:768 layout interno, 1152/1440+alto densidad) resolviendo la
   contradicción con DESIGN.md §32.
2. Prototipar en el tema nuevo el AppLayout + 2-3 vistas reales (/overview, /ventas,
   /pedidos) — sin migrar el resto todavía.
3. **Lámina de componentes (mockup — regla cero-nativo §9.0)**: una página
   prototipo con la propuesta visual de CADA primitiva canónica en el estilo
   nuevo, claro y oscuro: `Button` (todas las variantes), `Badge`, `Spinner`/
   `Skeleton`, `EmptyState`, `LiquidSelect`, pickers de fecha/hora, `PortalInput`,
   toast, y la jerarquía de modales. Lo que hoy NO existe (§9.1) se diseña aquí
   como mockup; el usuario lo confirma y **queda definido como canónico** antes
   de que T3 escriba una línea de componente real.
4. Capturar la comparativa: {liquid actual vs Solid Modern} × {1440×900,
   1366×768 con zoom 125%, **1024×768**} con `audit-shots.mjs` + la lámina de
   componentes del punto 3.
5. **Gate**: aprobación del usuario sobre las capturas. Aquí se decide (a) ajustes
   al estilo, (b) si Liquid Glass sobrevive como tema opcional o se elimina, y
   (c) la confirmación de la lámina de componentes (punto 3) — con eso los
   canónicos quedan cerrados y T3/T4 son ejecución, no diseño.

### Fase T3 — Migrar los componentes compartidos (el 80% del efecto)

Orden por apalancamiento: `GlassViewLayout` → `ViewTabBar` → `DataTable` +
`TablePagination` → `LiquidSelect` → modales (`ModalShell`, `LiquidModal`,
`UnifiedModal`, `ConfirmModal`, `AlertModal`) → botones/badges/pills → `LiquidToast`,
`LiquidTooltip`, `BranchChips`, `SearchInput`.

**Lista CERRADA de componentes compartidos (agregada 2026-07-23 — mismo criterio
que el checklist de 110 vistas de T4: "T3 completo" = todos migrados o anotados
con razón de exclusión, nunca omitidos en silencio).** Además de los del orden
de arriba, T3 incluye:

- **Overlays/feedback**: `NotificationBell` (campana — 14 usos de glass, de los
  componentes más cargados), `MenuSearchModal` (⌘K), `PhotoEditorModal`,
  `ShiftExceptionModal`, banners (`OfflineBanner`, `PushPromptBanner`,
  `SyncHealthBanner`, `SidebarSyncStatus`).
- **Pickers de fecha/hora** (la spec de estados la define §8.2 "inputs
  incompletos"; la migración a tokens ocurre aquí): `LiquidDatePicker`,
  `LiquidWeekPicker`, `RangeDatePicker`, `PeriodPicker`, `TimePicker12`.
- **Inputs/selección**: `PortalInput`, `CatalogSelect` (variante de
  LiquidSelect — migra con él).
- **Display**: `StatCard`, `LiquidAvatar`, `UserHeader`, `EmployeeDocumentsList`.
- **Shell**: `AppLayout` (blobs ambient por tema + `bg-page`), `ThemeToggle`
  (se restyla aquí, se monta en T6).
- Los `Form*` de `src/components/forms/` (36 archivos) son formularios de
  dominio, no primitivas: se migran en T4 con su vista dueña, y heredan gratis
  lo que T3 haga en `UnifiedModal`/`PortalInput`/`LiquidSelect`.

Además:

- `App.jsx:532/548`: `bg-[#E6F0FF]` → `bg-page` (token). Blobs ambient: por tema
  (en dark bajan opacidad; en solid se apagan — ya hay `--backdrop-*: none`, faltan
  los blobs).
- Donde un componente ya coincide con una primitiva, usar `data-surface` en vez de
  clases (cards de contenido, headers, modales) — menos clases, cero divergencia.
- Los componentes consumen los tokens de densidad (§7.4), no paddings/alturas fijos:
  la compactación en resoluciones bajas sale gratis en toda vista que los use.
- **Adiciones de la auditoría §8 y §9**: (a) T3 CREA los componentes
  compartidos que NO existen: `Button` (§8.2), `Badge`, `Spinner`, `Skeleton`
  y `EmptyState` (§9.1 — hoy son patrones inline duplicados en decenas de
  vistas), y DECIDE la jerarquía de modales (§9.1: hoy conviven 4 sistemas +
  24 overlays hand-rolled); (b) los 9
  blindspots de dark mode de DESIGN.md §22 quedan cerrados aquí (la migración
  a tokens los elimina como clase de bug); (c) consolidación de los
  search-pills hand-rolled en ViewTabBar/SearchInput (el fork que ya recayó 2
  veces); (d) cada componente migrado se re-documenta en DESIGN.md con la
  plantilla §8.5 (anatomía/variantes/tamaños/matriz de estados) EN EL MISMO
  commit — así DESIGN.md v2.0 se escribe incrementalmente, no al final; (e)
  DataTable gana su patrón responsive definitivo (card-list <640px, §8.2).
- **Gate de salida por componente**: captura en Solid Modern (claro y oscuro) a
  1440 y 1024×768 + en liquid (si sigue vivo tras T2, debe quedar pixel-igual).

### Fase T4 — Pasada por vistas (fusionada con Fase 4 móvil)

Por cada vista, UN solo pase que hace las dos cosas:

1. **Tokens**: mapeo mecánico de las clases frecuentes
   (`text-slate-800→text-content`, `text-slate-500/600→text-content-2/3`,
   `bg-white/60→bg-surface-card` o `data-surface="card"`, semánticos
   `text-red-*→text-danger` etc.). Un script de codemod cubre el 90%; revisión
   manual el resto (casos con significado local: charts, badges de estado).
   **Incluye resolver las ~1,288 violaciones de contraste** documentadas en
   DESIGN.md §30 (`text-slate-300/400` sobre superficie clara): el codemod las
   mapea a `text-content-3` (que cumple AA por diseño del tema) — dejan de ser
   deuda pendiente y se cierran vista por vista aquí.
2. **Responsive/densidad** (lo que era Fase 4 móvil, ampliado a low-res desktop):
   tablas con `overflow-x-auto` propio o colapso a cards <640px, filter pills en
   wrap/scroll, touch targets, tipografía ≥16px en inputs, y verificación a
   1024×768 (sin scroll horizontal, header de vista en una línea, tabla con
   filas útiles visibles — §7.6).

Orden: las vistas de tienda primero (/monitor, /my-requests, /pedidos, /minmax,
/ventas), luego el resto. Verificación por vista: 1-2 screenshots móvil + desktop
1440 + desktop 1024×768 (regla de memoria: la verificación visual no es opcional).

**"El resto" no es una frase vaga — es una lista cerrada y enumerable.** Al
2026-07-23 son **110 archivos de vista** (`find src/views -name "*.jsx" | wc -l`:
38 en `src/views/` + 72 en subcarpetas como `productos/tabminmax/`,
`schedule-tabs/`, etc.). T4 mantiene un checklist explícito de esos 110 archivos
(marcados según se migran) — "T4 completo" significa el checklist en 100%, no
"las vistas de tienda más algunas otras". Si algún archivo se decide excluir
deliberadamente (ej. una vista que se va a eliminar pronto), debe quedar anotado
con la razón, no simplemente omitido en silencio.

### Fase T5 — Eficiencia de render (verificación de la promesa)

- En Solid Modern el grueso ya está: **cero `backdrop-filter`** (hoy 510 usos) y
  blobs ambient apagados. Esta fase lo verifica y limpia lo residual.
- Si Liquid sobrevive: degradarlo en móvil (`blur(44px)→blur(24px)`, menos capas
  apiladas) — queda como tema "premium" para hardware capaz.
- Medir antes/después con Playwright traces (frames en scroll de /ventas) en móvil
  emulado y en viewport 1024×768.

### Fase T6 — Exponer el selector de tema

- Montar `ThemeToggle` (o un selector con preview de los temas que sobrevivan a T2)
  en el menú de usuario del AppLayout — regla de memoria: features "al iniciar
  sesión" van en AppLayout, visibles para todo rol.
- Default inicial: Solid Modern claro; respetar `prefers-color-scheme` del SO la
  primera vez para elegir claro/oscuro. Persistencia en localStorage ya existe.
- `<meta name="theme-color">` dinámico para que la status bar móvil acompañe.

### Fase T7 — Matriz de QA + cierre

- **Gate mecánico de cobertura (obligatorio, no reemplazable por muestreo
  visual)**: `grep -rl 'text-slate-[0-9]\|bg-white/\|bg-slate-[0-9]\|border-white/\|#[0-9a-fA-F]\{6\}' src/views src/components --include="*.jsx"`
  debe devolver **0 archivos** (baseline medido 2026-07-23: 183 archivos con al
  menos un match). Este grep, no la captura de pantalla, es el criterio
  pass/fail de "T4 terminó" — las capturas de abajo son una muestra de que SE
  VE bien, no una prueba de que TODO se migró. Cualquier archivo que quede con
  un match real (no falso positivo de un comentario o de un valor
  intencionalmente fuera del sistema de temas, ej. colores de un logo) debe
  quedar en una lista de excepciones explícita con la razón — nunca omitido en
  silencio del conteo.
- Extender `docs/audits/tema-2026-07/audit-shots.mjs`: {temas vivos} × {login,
  /overview, /ventas, /pedidos, /minmax, menú, un modal} × {1440×900,
  1366×768 zoom 125%, **1024×768**, iPhone 13 vertical}. Es la misma matriz de la
  Fase 5 móvil, con las dimensiones tema y low-res añadidas. Esto es un
  muestreo representativo para verificar que SE VE bien en los temas — no
  sustituye el gate mecánico de arriba, que es el que cubre los 110 archivos.
- **DESIGN.md v2.0 — el criterio de cierre del plan**: reescritura final
  verificada contra el checklist §8 COMPLETO (fundamentos, componentes con
  anatomía/estados, patrones, contrato de tema, gobernanza). Solid Modern pasa
  a ser EL estándar documentado; las clases semánticas de tokens son
  obligatorias (prohibido `text-slate-*`/`bg-white/*` nuevos y hex crudo en
  vistas); §22/§23 (blindspots/inconsistencias) se marcan resueltos o se
  eliminan; §10/§13/§32 se reescriben con el modelo móvil real v2.32.x (body
  scroll, header sticky, safe-areas, status bar default) — hoy describen el
  modelo viejo; actualizar memoria.
- Punto de llegada: cambiar el look (retocar el tema o crear otro) = editar/añadir
  un bloque `[data-theme="…"]` que cumple el contrato §8.4. Barato, reversible
  y A/B-able.

## 5. Reglas que aplican (no saltarse)

- Bump `APP_VERSION` + changelog en cada commit; commit+push por fase/lote (Vercel
  auto-deploya: liquid debe quedar pixel-igual en cada push intermedio).
- React Compiler: cuidado con handlers y refs al tocar componentes compartidos.
- Nada de esto toca BD ni edge functions: es 100% frontend.
- `docs/audits/tema-2026-07/` guarda la evidencia; el script `audit-shots.mjs` se
  reutiliza en cada fase (credenciales QA de `.env`, dev server local).

## 6. Estimación de esfuerzo relativo

| Fase | Tamaño | Riesgo |
|---|---|---|
| T1 puente @theme | Chico (1 archivo) | Bajo |
| T2 definición + prototipo Solid Modern | Medio (tokens + 3 vistas) | Bajo (nada se migra hasta aprobar) |
| T3 componentes compartidos | Medio (~15 archivos) | Medio (regresión visual — mitigado con capturas por componente) |
| T4 vistas (tokens + responsive/densidad) | Grande (~40 vistas, por lotes) | Bajo por lote (mecánico + verificación por vista) |
| T5 eficiencia | Chico | Bajo |
| T6 selector | Chico | Bajo |
| T7 QA/cierre | Chico | — |

## 7. Especificación del nuevo estilo — "Solid Modern"

Registro producto (la herramienta desaparece detrás de la tarea). Referencias de
factura: Linear, Stripe Dashboard, Notion. La identidad de Farmalasa se conserva:
azul brand, sidebar oscura, micro-interacciones actuales. Lo que cambia es el
material: de vidrio flotante a superficie sólida precisa.

### 7.1 Color

- **Fondo de página**: neutro tintado al azul brand (partir de `#f4f6fb`; nunca
  blanco puro ni gris puro — chroma leve hacia el hue del brand).
- **Superficies**: opacas, blanco tintado (`#ffffff` con matiz frío mínimo) sobre el
  fondo; segunda capa neutra levemente distinta para paneles/toolbars.
- **Texto**: escala actual slate 800/600/500 (ya coincide con los tokens).
- **Brand y semánticos**: sin cambios (`#0052CC`, success/warning/danger actuales).
  Acento solo en acciones primarias, selección y estado — nunca decoración.
- **Oscuro**: evolución de `solid-dark` existente (slate 900/800), mismo contrato
  de tokens.
- **Sidebar**: se mantiene oscura e invariante al tema (identidad, como hoy).

### 7.2 Material y elevación

- **Cero `backdrop-filter` en todo el tema** (hoy: 510 usos). Es la fuente #1 de
  costo GPU en máquinas viejas. Elevación por borde 1px (`--border-*`) + sombra
  sutil de 2 niveles (reposo/hover). Sin inset highlights de vidrio.
- **Blobs ambient apagados** en Solid Modern (hoy animan composición GPU constante).
- Radios: card 12px, modal 16px, input/botón 8px, pills/badges `rounded-full` se
  mantienen. (Los tokens `--radius-*` de solid ya están cerca: 0.875rem/1.25rem/0.5rem.)

### 7.3 Tipografía

- Stack de sistema (ya en uso). Una sola familia.
- Escala fija rem, ratio 1.125–1.2. Datos/tablas: 13–14px en densidad compacta;
  prosa 15–16px; inputs ≥16px en móvil (evita zoom iOS).
- **Botones y badges: normal-case, nunca mayúsculas con tracking** (decisión
  2026-07-23, comparada lado a lado en la lámina de T2.3 — ver capturas en
  `docs/audits/tema-2026-07/`). El proyecto usa hoy mayúsculas+tracking+peso
  black en CTAs y pills (DESIGN.md §15/§16); puesto junto a una versión
  normal-case con el mismo peso/color/sombra, la versión en mayúsculas se leyó
  como "dashboard corporativo 2016", la normal-case como producto actual. La
  jerarquía primary/secondary se resuelve con color/relleno, no con
  mayúsculas. Aplica a `Button` y `Badge` (§8.2/§9.1, ambos nuevos en T3) desde
  su primera versión — no es un cambio a un componente existente, es la spec
  con la que nacen.

### 7.4 Densidad adaptativa (el corazón del soporte low-res)

Tokens de densidad consumidos por componentes compartidos, con 3 niveles según
viewport (media queries de ancho Y alto — la altura es la restricción dura a
1024×768, donde el viewport útil es ~1024×620):

| Token | Cómoda (≥1440w y ≥820h) | Compacta (<1440w o <820h) | Ultra (<1152w o <700h) |
|---|---|---|---|
| Padding de card | 24px | 16px | 12px |
| Altura header de vista | ~72px | ~56px | ~44px (una línea) |
| Altura fila de tabla | 44px | 38px | 32px |
| Altura de controles | 40px | 36px | 32px |
| Sidebar | expandida | colapsable | rail de iconos (56px) por defecto |
| Font datos | 14px | 14px | 13px |

- Grid fluido con `minmax()`; prohibidos los anchos fijos que fuercen scroll
  horizontal por encima de 1024px.
- El modo móvil (<1024px de ancho) sigue siendo el del plan móvil; "ultra" es
  desktop denso, NO el layout móvil estirado.

### 7.5 Motion

- Se conservan las transiciones actuales (opacity/transform, 150–250ms, ease-out) —
  son baratas. Se eliminan las animaciones de composición permanente (ambient drift).
- `prefers-reduced-motion` ya está resuelto en index.css; se hereda tal cual.

### 7.6 Criterios de aceptación del estilo

1. A **1024×768**: login, /overview y /ventas sin scroll horizontal; header de vista
   en una línea; tabla de /ventas con ≥10 filas visibles; sidebar en rail.
2. A 1366×768 con zoom 125% (viewport ~1093px): densidad compacta/ultra según alto,
   sin colapsar al layout móvil.
3. Cero `backdrop-filter` computado en cualquier vista del tema (verificable por
   script: `getComputedStyle` sobre todos los nodos).
4. Contraste AA en texto sobre toda superficie (los problemas de contraste sobre
   glass desaparecen con superficies opacas — regla de memoria glassmorphism-text-contrast
   queda superada por diseño).
5. Scroll de /ventas fluido en Playwright trace con CPU throttling ×4 (proxy de
   hardware viejo).

### 7.7 Identidad decorativa — colores reales del logo (agregado 2026-07-23)

Durante la exploración interactiva del sidebar/header (fuera de la secuencia
formal T1-T7, a pedido explícito del usuario: "¿podemos integrar los colores
de la empresa? el logo contiene los colores? así se siente personal"), se
muestrearon por pixel los colores reales de `public/Logo512.png`:
**verde `#8ec30f`** (arco superior) y **magenta `#981d97`** (cruz + arco
inferior). Decisión adoptada para **todo el proyecto de aquí en adelante**:

- Estos dos colores (+ variantes suaves `--logo-green-soft`/
  `--logo-magenta-soft`) son los acentos **decorativos/de identidad** —
  glows ambientales, estado activo de navegación, hover de personalización.
- Reemplazan el violeta/índigo/azul genérico usado hasta ahora en esos
  mismos lugares (`--brand-purple` #6929C4, los blobs de `AppLayout.jsx`,
  `from-violet-300 via-indigo-400 to-blue-400` del sidebar) — ese violeta no
  tenía ninguna relación real con la marca, era un acento de "tech genérico".
- **`--brand` (#0052CC) no cambia** — sigue siendo el azul FUNCIONAL
  (botones, CTAs, enlaces, focus rings). La distinción es: azul = acción,
  verde/magenta = identidad/personalidad.
- Tokens ya agregados a `index.css` (`:root` + bridge `@theme inline`):
  `--logo-green`, `--logo-magenta`, `--logo-green-soft`, `--logo-magenta-soft`
  → utilidades `text-logo-green`, `bg-logo-magenta`, etc. Documentado en
  DESIGN.md §6 (v1.4).
- **Aplicado en código real (v2.35.0, 2026-07-23)**, tras 3 rondas de mockup +
  un prototipo interactivo con aprobación explícita: `AppLayout.jsx` — los 3
  blobs ambientales del sidebar (verde arriba/magenta abajo, eco de la
  composición real del logo), el shimmer superior e inferior del header del
  sidebar, el glow/borde del botón de logo, el ícono de nav activo
  (`text-logo-magenta-soft`), la barra de acento (`from-logo-green to-logo-magenta`)
  y el fondo/borde de la pill activa. Verificado con Playwright en desktop y
  móvil (iPhone 13, drawer incluido) — cero errores de consola.
- **De paso, también en código real**: `ViewTabBar.jsx` y el duplicado de
  `VentasView.jsx` — la fila de tabs solo se muestra en desktop (`lg:`); en
  móvil se reemplaza por un `LiquidSelect` compacto con el tab activo
  (ícono + label), resolviendo el caso de Pedidos a Sucursales (5 tabs,
  labels largos) sin truncar ni competir por ancho horizontal.
- **Pendiente**: extender la paleta a los 5 blobs ambientales GLOBALES de
  `AppLayout.jsx` (el fondo detrás de `<main>`, hoy `rgba(110,70,230,…)`
  violeta, `rgba(60,100,240,…)` azul, etc. — sin relación con el logo, fuera
  del alcance de esta sesión que se limitó al sidebar), y a cualquier glow/
  acento decorativo nuevo que se diseñe de aquí en adelante. No aplica a
  elementos funcionales (botones, links, focus) — esos siguen en `--brand`.

## 8. Contrato de completitud del design system (auditoría 2026-07-23)

> Pedido del usuario: verificar que el plan contemple TODO lo que un sistema de
> diseño completo necesita (colores definidos al 100%, formas, reglas, motion,
> botones, listas, tablas, contenedores, buscadores, inputs, tokens, estados)
> para que `DESIGN.md` quede **completo, finalizado y adaptable a otros temas**.
> Este checklist es el criterio de "terminado": **T7 no cierra hasta que
> DESIGN.md v2.0 cumpla cada ítem**. Referencias de estructura: jerarquía de
> tokens primitivo→semántico→componente (W3C DTCG), y el modelo de docs de
> Material 3 / Carbon / Polaris (fundamentos + componentes con anatomía/estados
> + patrones + theming + gobernanza).

### 8.1 Fundamentos (tokens) — brechas encontradas en DESIGN.md v1.1

- [ ] **Jerarquía de color completa**: hoy hay UN valor por rol semántico
  (`--success` etc.) y las badges usan clases Tailwind "que coinciden
  visualmente" (§3 de DESIGN.md lo admite) — doble fuente = deriva garantizada.
  Definir ramp neutral, ramp de brand y ramps semánticas (mínimo
  bg/border/text/hover por rol) como tokens únicos.
- [ ] **Estados de interacción tokenizados**: default/hover/pressed/selected/
  focus/disabled por rol — hoy son clases ad-hoc por componente.
- [ ] **Paleta dataviz por tema**: categórica (≥6), secuencial, y el semáforo
  MUERTA/NORMAL/PICO/CRÍTICA — hoy los charts usan colores ad-hoc por vista.
- [ ] **Overlay/scrim, divisores y focus-ring como tokens** (backdrop del drawer
  hoy `#030B1C/40` hardcodeado; divisor `h-5 w-px bg-slate-100` hardcodeado).
- [ ] **Escala de elevación** 0–3 (borde+sombra por nivel, reglas de uso) — hoy
  sombras por superficie sin escala nombrada.
- [ ] **Matriz de contraste AA verificada por script** para cada par
  texto/superficie de cada tema — DESIGN.md §30 documenta ~1,288 violaciones
  `text-slate-300/400` SIN corregir; el plan debe absorberlas (ver T4).
- [ ] **Tipografía tokenizada por rol** (display/título/sección/cuerpo/dato/
  caption/badge: size+line-height+weight+tracking) con variante por densidad;
  `tabular-nums` obligatorio en columnas numéricas (hoy no especificado).
- [ ] **Escala de espaciado** base-4 como tokens (§10 de DESIGN.md es un
  inventario de paddings, no una escala).
- [ ] **Radios/bordes**: la escala §8 de DESIGN.md pasa a tokens por USO
  (control/card/modal/pill), no por valor.
- [ ] **Motion tokenizado**: escala de duraciones (100/150/200/250/300/700 hoy
  dispersas) + easings nombrados; documentar `animate-route-enter` (existe,
  no está en §11).
- [ ] **Z-index canónico COMPLETO**: §9 de DESIGN.md omite z-20 (main), z-30
  (header móvil v2.32), z-40 (backdrop/tabs), z-[200] (campana desktop),
  z-[300] (flyout), z-[400] (dropdown campana), z-[500] (banners).
- [ ] **Breakpoints + densidad — resolver la CONTRADICCIÓN actual**: DESIGN.md
  §32 dice "un solo breakpoint md:768" pero el shell usa **lg:1024** como
  frontera móvil/desktop, y este plan agrega 1152/1440 + media queries de
  ALTO (<700/<820). Una sola tabla canónica: lg:1024 = frontera de shell;
  md:768 = ajustes de layout interno; 1152/1440 + alto = densidad.
- [ ] Iconografía: ya sólida (§12) — solo tokenizar tamaños y strokeWidth por
  densidad.

### 8.2 Componentes — cada uno debe quedar con anatomía + variantes + tamaños + matriz de estados (default/hover/focus/active/disabled/loading/error) + comportamiento móvil

- [ ] **Button compartido NO existe** (§15: "patterns are inline") — T3 lo crea
  (primary/secondary/ghost/destructive/icon × sm/md) y T4 migra las vistas.
- [ ] **Inputs incompletos**: §29 cubre text input; faltan textarea, checkbox,
  radio, switch, date/time, number/stepper, upload — spec + estados de cada uno.
- [ ] **DataTable responsive definitivo**: §32 admite que el colapso a card-list
  <640px NO existe (solo `hideBelow`). T4 lo necesita — spec del card-list +
  estados loading/empty/error + `--row-h` por densidad (§7.4).
- [ ] **Listas/cards**: spec del row de lista y del card móvil (hoy implícitos).
- [ ] **Los 9 blindspots de dark mode (§22 de DESIGN.md) se cierran en T3** —
  el plan los absorbe explícitamente: LiquidModal, DataTable `useTokens()`,
  LiquidToast, LiquidSelect `isDark`, AlertModal/ConfirmModal `theme` prop,
  ViewTabBar pill, GlassViewLayout body. Al migrar a tokens desaparece la
  clase entera de bug.
- [ ] **Consolidación de buscadores**: los search-pills hand-rolled (§32
  "structural finding, not fixed" — la causa recurrió 2 veces) se eliminan en
  T3/T4 reemplazándolos por ViewTabBar/SearchInput. Si no, el estilo nuevo
  hereda el fork.
- [ ] **Charts**: spec del wrapper recharts con paleta dataviz + tipografía de
  ejes tokenizadas.
- [ ] **Navegación**: documentar el modelo REAL post-v2.32.x — body scroll móvil,
  header sticky, bottom-tabs fixed hermano del root, status bar `default` —
  **§10, §13 y §32 de DESIGN.md describen el modelo VIEJO** (useEffect
  overflow hack, "no env() usage found", meta viewport antigua): quedaron
  obsoletos esta semana y T7 los reescribe.

### 8.3 Patrones

- [ ] Formularios: un solo estándar (§29 a+b+c), eliminar el patrón deprecado
  restante (BranchTabInmueble), todo input nuevo vía PortalInput o clases
  canónicas.
- [ ] Estados de página: agregar `NotFoundView` (mejora ya propuesta en §28).
- [ ] **Formatos de datos** (no documentado hoy): moneda $ SV, números con
  `tabular-nums`, fechas es-SV — reglas únicas.
- [ ] Print styles: se conservan (ya en index.css).

### 8.4 Contrato de tema (la meta del plan)

- [ ] Lista EXHAUSTIVA de variables que un `[data-theme]` debe definir (las ~40
  actuales + densidad + dataviz + scrim + focus + estados + `color-scheme` +
  `theme-color`), con herencia de defaults para que un tema nuevo declare solo
  diffs.
- [ ] Procedimiento "crear un tema" paso a paso + matriz de QA por tema (T7).
- [ ] `theme-color`/meta por tema para status bar móvil — lección v2.32.1:
  cambiar metas del web clip exige borrar y re-agregar el ícono en iOS.

### 8.5 Gobernanza (ver también §9 — mapa de duplicaciones)

- [ ] Reglas post-migración: prohibido `text-slate-*`/`bg-white/*` nuevos en
  vistas, prohibido hex crudo (`#0052CC` → token), checklist visual de PR.
- [ ] Plantilla de documentación de componente (anatomía/estados/uso/no-usar)
  para que DESIGN.md se mantenga al día.
- [ ] DESIGN.md v2.0 al cierre de T7; §22/§23 (blindspots/inconsistencias) se
  marcan resueltos o se eliminan; changelog §30 por fase.

## 9. Mapa de duplicaciones y patrones divergentes (auditoría 2026-07-23)

> Pedido del usuario: verificar que el plan detecte los casos donde **un mismo
> trabajo se resuelve de formas distintas según la vista** (ej. feedback a veces
> con toast, a veces con alert nativo, a veces con label inline). Todo lo de
> abajo está **medido con grep sobre `src/`** (no estimado). Cada fila dice
> dónde se consolida. Regla general: T3 crea/decide el canónico, T4 migra los
> divergentes vista por vista, T7 lo verifica con gate mecánico (§9.3).

### 9.0 Regla CERO-NATIVO + flujo de canonización (decisión del usuario 2026-07-23)

**Nada nativo del navegador en la UI visible.** Todo elemento respeta el estilo
creado del proyecto y reacciona al tema: prohibidos `alert()`, `window.confirm`,
`prompt()`, `<select>` nativo, `<input type="date"|"time">` crudo, y cualquier
control/diálogo/spinner/badge improvisado donde exista (o deba existir) un
canónico. El flujo, **vigente desde ya para todo código nuevo** (no espera a T3):

1. **¿Existe el componente canónico?** → se usa SIEMPRE, sin excepción por
   vista. Los gates de §9.3 lo verifican mecánicamente.
2. **¿No existe?** → NO se improvisa en la vista: se diseña **mockup según el
   estilo** (en la lámina de componentes de T2.3, o como mockup puntual si
   surge después), se muestra al usuario, él confirma, y **queda definido como
   canónico** — se agrega a la lista cerrada de T3 y a DESIGN.md.
3. **Backfill obligatorio**: cada canónico nuevo se retro-aplica a TODO lo ya
   construido — los checklists enumerables de §9.3 (overlays, tablas, pickers
   nativos, alert/confirm) y las 110 vistas de T4 son ese backfill. **T7 no
   cierra con usos nativos o hand-rolled sin excepción anotada.**

### 9.1 El mapa (medido)

| Trabajo | Canónico | Divergencias encontradas | Consolida en |
|---|---|---|---|
| **Feedback de resultado** | `toastStore`→`LiquidToast` (arquitectura SANA: un solo store, montado una vez en App.jsx; 42 archivos lo usan) | **7 `alert()` nativos** (FormPharmacovigilance ×2, FormNovedad ×2, FormAiSchedulerPreview:164, TabExpediente:222, _StatCardPreview); **~18 archivos** con banners inline `setError/setMessage` ad-hoc; `AlertModal` en 6 archivos sin regla escrita de cuándo va él y cuándo un toast | Regla en §9.2 (T2/DESIGN.md); migración en T4 |
| **Confirmación destructiva** | `ConfirmModal` (18 archivos) | **5 `window.confirm` reales**: ShiftExceptionModal:106, StaffManagementView:754, ConteoDetailView:482, TabPromos:276, TabStaff:197 (TabMinMaxRequests ya migró en M7 — ese es el precedente) | T4 (al pasar por cada vista) |
| **Modales** | — **no hay canónico único**: conviven 4 sistemas (`ModalShell` 5, `LiquidModal` 10, `UnifiedModal` 6, `ConfirmModal`/`AlertModal`) | **24 archivos** además con overlay hand-rolled `fixed inset-0` propio | **T3 DEBE decidir la jerarquía** (propuesta: ModalShell = base única de la que derivan los demás; overlays a mano → migrar o anotar excepción) |
| **Select** | `LiquidSelect` (61 archivos) + `CatalogSelect` (3, variante legítima) | **0 `<select>` nativos** — ✅ la regla global SÍ se cumplió; el único match es un comentario | Nada que hacer (caso de éxito: así se ve una consolidación terminada) |
| **Fecha/hora** | `LiquidDatePicker` 26, `RangeDatePicker` 6, `PeriodPicker` 5, `TimePicker12` 7, `LiquidWeekPicker` 1 | **6 `type="date"` + 9 `type="time"` nativos crudos** sueltos en forms | T4; la spec de estados de cada picker la exige §8.2 |
| **Tablas** | `DataTable` (25 archivos) | **15 archivos** con `<table>` hand-rolled | T4: migrar a DataTable o anotar excepción legítima (ej. print/pdfmake) |
| **Loading** | — **no existe** `Spinner` ni `Skeleton` compartidos | 85 archivos con `animate-spin` propio, 79 con `Loader2`, 54 con `animate-pulse` a mano; textos "Cargando" con 3 puntuaciones distintas (`...`, `…`, nada) | **T3 crea `Spinner` + `Skeleton`** (como el Button de §8.2); texto canónico: "Cargando…" |
| **Empty state** | — **no existe componente**, solo el estándar visual documentado (memoria + DESIGN.md) | Textos divergentes por vista ("Sin datos", "Sin resultados", "Sin historial", "Sin ítems"…) cada uno con su markup | **T3 crea `EmptyState`** (props: icono, título, subtítulo, acción) |
| **Badges/pills de estado** | — **no existe `Badge`** | **214 ocurrencias** de badges inline `rounded-full bg-{emerald,red,amber,…}-50/100` con paleta hardcodeada por vista | **T3 crea `Badge`** (ya estaba implícito en "botones/badges/pills"; ahora con medición y explícito). Ramps semánticas de §8.1 son su fuente de color |
| **Búsqueda** | `SearchInput` común | importado por **1 solo archivo**, vs 36 inputs `placeholder="Buscar…"` hand-rolled | Ya identificado en §8.2 (el fork que recayó 2 veces); esta es la medición |
| **Inputs de texto** | `PortalInput` | **3 archivos** lo usan, vs 85 con `<input>` crudo | §8.2 ya lo exige; T4 migra form por form |
| **Tooltip** | `LiquidTooltip` (3 archivos) | **294 `title=` nativos** | Regla en §9.2; no se fuerza migración masiva |
| **KPI/stat cards** | `StatCard` (8 archivos) | vistas grandes con cards KPI inline propias | T4: auditar por vista si StatCard aplica o se anota excepción |

### 9.2 Reglas de uso que DEBEN quedar escritas en DESIGN.md v2.0 (hoy no existen — son la CAUSA de la divergencia)

1. **Toast vs AlertModal vs inline**: toast = resultado efímero de una acción
   (éxito, error recuperable, "guardado"); `AlertModal` = error/aviso bloqueante
   que el usuario debe leer para continuar; **inline junto al campo** = error de
   validación de formulario (nunca un toast para "campo requerido"). `alert()`
   y `window.confirm` nativos: **prohibidos** (rompen el tema, no theme-ables,
   bloquean el thread).
2. **Jerarquía de modales** (la decide T3): qué componente para formulario,
   para confirmación, para visor de documento; cuándo drawer vs modal.
3. **Tooltip** (ajustado a la regla §9.0): contenido informativo visible
   siempre vía `LiquidTooltip`. `title=` nativo queda SOLO como refuerzo de
   accesibilidad cuando el mismo texto ya es visible en la UI — nunca como
   única vía de información. Los 294 `title=` actuales se triagean en el pase
   T4 (eliminar redundantes / migrar los informativos a LiquidTooltip).
4. **Texto de loading/empty**: "Cargando…" (con elipsis U+2026) y catálogo
   corto de textos de vacío (con el componente `EmptyState` la divergencia
   muere sola).

### 9.3 Gates mecánicos que se suman al de T7

Al gate de colores existente (§T7) se agregan, con el mismo criterio pass/fail:

```
grep -rn "[^a-zA-Z.]alert(\|window.confirm\|[^a-zA-Z.]prompt(" src --include="*.jsx"  → 0 (hoy: 12)
grep -rln "<select" src --include="*.jsx"                             → 0 reales (hoy: 0 ✅)
grep -rn 'type="date"\|type="time"' src --include="*.jsx"             → 0 fuera de los pickers canónicos (hoy: 15)
grep -rln "<table" src/views src/components --include="*.jsx"         → solo lista de excepciones anotadas (hoy: 15 sin anotar)
```

Y checklists enumerables (mismo modelo que las 110 vistas de T4): los 24
overlays `fixed inset-0`, los 15 `<table>`, los 6+9 date/time nativos —
cada uno migrado o anotado con razón, nunca omitido en silencio. **Estos
checklists SON el backfill que exige §9.0.3**: cuando un canónico nuevo nace
(en T2.3 o después), su lista de usos divergentes existentes se agrega aquí y
se vacía antes de cerrar T7.

## 10. Estado de T4 (actualizado 2026-07-23, sesión de continuación)

### 10.1 Codemod mecánico — hecho

Script en dos pasadas sobre `src/views/**/*.jsx` (~4,500 reemplazos):
`text-slate-300..900→text-content/-2/-3`, `bg-white/N→bg-surface-card`,
`border-white/N→border-border-card`, `#0052CC/#003D99→brand/brand-hover`
(fix aplicado también a la variante minúscula `#003d99`, encontrada en
`WidgetAnnulmentRequest.jsx`/`WidgetMinMaxRequest.jsx` — el regex original
era case-sensitive), semánticos `red/emerald/amber→danger/success/warning`.
Segunda pasada cubrió `bg-slate-50/100/200/300/400` y `text-slate-200`, que
la primera pasada no tocaba (gap real, encontrado al medir el gate).

**Bug encontrado y corregido en v2.47.2 (estuvo en prod desde v2.46.0)**:
la primera versión del codemod preservaba el sufijo de opacidad original
del caller al mapear `bg/border-{red,emerald,amber}-{50,100,200}/NN` a los
tokens semánticos (`bg-amber-50/80` → `bg-warning/80`). Ese NN modulaba la
opacidad de un color YA claro (compositing de vidrio sobre el fondo), no
"qué tan saturado" debía verse — reenviarlo al token sólido producía un
banner/badge mucho más intenso que el original (de tinte casi blanco a
bloque ámbar sólido). Afectaba ~60 archivos ya en producción, invisible a
build/test. `sem()` corregida para usar siempre la opacidad por defecto
(`/10` bg, `/30` border en estado base; `/20`/`/50` en `hover:`/`focus:`/
`group-hover:`, para no aplanar transiciones de hover legítimas — un
primer intento de corrección global sí las aplanó por error en
`PhotoEditorModal.jsx`, detectado y revertido antes de commitear). Pase
correctivo aplicado a los ~60 archivos afectados de `src/views`.

Extendido a `src/components/**/*.jsx` en v2.47.2 (84 archivos, 49
migrados) — el gate de T7 siempre incluyó esta carpeta pero nunca se había
auditado en esta sesión de continuación. Mismas reglas, mismo criterio de
exclusión para contexto siempre-oscuro/fijo (ver §10.2).

Gate de T7 (`grep -rl 'text-slate-[0-9]\|bg-white/\|bg-slate-[0-9]\|
border-white/\|#[0-9a-fA-F]\{6\}' src/views src/components`): **183 → 71
archivos** con al menos un match (49 en `src/views`, 22 en
`src/components`). De esos, el grueso de los matches de clase Tailwind
restantes son `bg-slate-500..950` (confirmado por grep de contexto: son
botones/chips neutros SIEMPRE oscuros a propósito — "Ver más", tooltips,
badges de acción — mismo criterio que `ThemeToggle.jsx`/
`SidebarSyncStatus.jsx` de T3, no superficies de card). Todo lo demás
restante es hex crudo — ver §10.2.

Verificado con Playwright (liquid/solid/dark) en las vistas de mayor
tráfico: `VentasView` (137→2 matches originales), `AttendanceMonitorView`,
`DashboardView`, y tras el fix de opacidad, `RolesView` (banner de error),
`EmployeeProfileView` (stat card "Pendientes"), `FacturacionView` (chips
de estado) — el salto es de cajas planas grises/blancas sin distinción en
dark theme a superficies y acentos correctos por tema.

### 10.2 Excepciones documentadas (hex crudo restante, por categoría)

Ninguna de estas necesita migrarse a tokens — quedan anotadas para que el
gate de T7 las excluya explícitamente en vez de perseguirlas a ciegas:

- **Pantallas siempre-oscuras por diseño** (mismo criterio que el sidebar/
  login ya documentado): `LoginView.jsx` (gradiente propio), `TimeClockView.jsx`
  (`#060B18`, kiosco de asistencia).
- **Templates de impresión/PDF** (un documento impreso no tiene modo
  oscuro): `CotizacionesView.jsx` — bloque de estilos inline HTML para el
  PDF de cotización.
- **Colores de librería de gráficos** (Recharts/canvas — `stroke`/`fill`/
  `contentStyle` reciben strings de color, no clases Tailwind; migrar
  requeriría `var(--token)` inyectado vía JS, evaluado caso por caso):
  `DashboardView.jsx`, `MetasView.jsx`, `EncuestaView.jsx`,
  `SchedulesView.jsx` + `schedule-tabs/components/ScheduleCalendar.jsx` +
  `ScheduleChart.jsx`, `productos/tabminmax/CoverageBar.jsx`,
  `pedidos/RutaMapModal.jsx`, `pedidos/CrearRutaModal.jsx`. Varios de estos
  valores YA coinciden exacto con un token (`#12B76A`=success, `#F79009`=
  warning, `#F04438`=danger) — candidatos baratos para una pasada futura
  con `var(--success)` etc., pero no bloquean T4.
- **Paletas decorativas de un solo uso** (badges/acentos con su propio
  color, no reutilizados, mismo criterio que el ícono morado de
  `aiSchedulerPreview` en T3): `#6929C4` (morado, repetido en varias vistas
  como acento de un módulo específico), `PermissionsView.jsx`,
  `PayrollView.jsx`, `AttendanceMonitorView.jsx`, `VacationPlanView.jsx`,
  `EmployeeAnnouncementsView.jsx`, `branch-tabs/TabExpenses.jsx`,
  `dashboard/WidgetInventorySearch.jsx`, `productos/TabCatalogo.jsx`,
  `RolesView.jsx`, `EmployeeDetailView.jsx`, `NoAccessView.jsx`,
  `AccessDeniedView.jsx` (verde WhatsApp `#25D366`, no un token del
  proyecto).
- **Herramientas de diagnóstico, no UI de negocio** (rutas reales pero
  gateadas/no orientadas al usuario final): `IOSTestView.jsx`,
  `RawTestView.jsx`.
- **`bg-slate-700/800/900/950`** en ~15 archivos (`pedidos/*`,
  `branch-tabs/TabStaff.jsx`, `BranchesView.jsx`, etc.): botones/chips
  neutros siempre-oscuros a propósito, no card surfaces — ver arriba.
- **`src/components` — contexto siempre-oscuro/fondo fijo (excluidos del
  codemod de v2.47.2, no solo "quedaron pendientes")**: `AppLayout.jsx`
  (rail del sidebar — glass decorativo sobre fondo oscuro permanente,
  mismo hallazgo ya documentado en T3), `SidebarSyncStatus.jsx`,
  `ThemeToggle.jsx` (variante "sidebar", mismo host oscuro permanente que
  el anterior), y los 6 archivos de `src/components/timeclock/` (pantalla
  de reloj checador — `bg-[#0A0F1C]/80` fijo, kiosco). Migrar cualquiera
  de estos a `bg-surface-card`/`border-border-card`/`text-content*` los
  rompe: esos tokens resuelven a superficie CLARA en tema claro, pero el
  fondo real ahí es oscuro sin importar el tema — confirmado por diff
  antes de commitear (revertido dos veces esta sesión al aparecer).

### 10.3 Responsive/densidad — barrido de "sin scroll horizontal a 1024×768"

Hecho: Playwright logueado, recorre las 37 rutas top-level reales de
`App.jsx` (una por módulo — no cada tab/sub-vista interna) a 1024×768,
mide `scrollWidth` vs `clientWidth` del documento. **36/37 limpias, cero
scroll horizontal.** La única excepción (`/pedidos`) es el bug preexistente
y no relacionado del paquete `@capacitor-community/background-geolocation`
(falla de resolución de import en el dev server, documentado varias veces
en esta sesión — no es un problema de layout).

Verificación visual manual (screenshots) en las 5 vistas de tienda del
orden del plan (/monitor, /my-requests, /minmax→productos, /ventas — 
/pedidos bloqueada por el bug de arriba): 4/5 limpias sin cambios
(sidebar colapsa a rail, header en una línea, sin scroll). Una encontró
un bug real, corregido:

- **`productos/TabCatalogo.jsx`** — el wrapper de las 5 stat cards llevaba
  `flex-1 min-w-0`, que siempre reclama el espacio "sobrante" del row en
  vez de envolver como bloque completo. Con el cluster de filtros
  (Activos/Todos + 2 LiquidSelect + Enriquecer SRS) ocupando ~500px de los
  846px disponibles a 1024px, el wrapper de cards quedaba con solo ~330px
  — 1 card por fila, hueco enorme a la derecha (confirmado con
  `getBoundingClientRect` en cada nivel del árbol). Corregido quitando
  `flex-1 min-w-0`: sin ellos, el ancho preferido del contenido hace que
  el `flex-wrap` del padre baje el bloque completo a su propia línea
  cuando no cabe — 5 cards en fila completa a 1024px y a 1440px (los
  filtros quedan debajo en vez de al lado, layout alternativo válido).

El mismo barrido se repitió sobre **iPhone 13 vertical** (viewport de
Playwright `devices['iPhone 13']`): resultado idéntico, 36/37 rutas
limpias (misma excepción `/pedidos`, mismo bug preexistente).

**Auditoría de sub-tabs anidadas** (clic real por tab, no solo la ruta
default): identificadas vía `[data-surface="tab-track"]` en las 3 vistas
que exponen `ViewTabBar` con tabs internas — `productos` (Catálogo,
Inventario, Gestión de Stock), `schedules` (Horarios, Catálogo, Feriados),
`ventas` (Ventas, Vendedores, Productos). `branches`/`roles`/`staff` no
usan este patrón de tabs. Las 9 tabs clickeadas a 1024×768 con chequeo de
`scrollWidth` vs `clientWidth`: las 9 limpias.

La revisión visual (no solo mecánica) de "Gestión de Stock" encontró el
**mismo bug de `TabCatalogo.jsx`** (arriba) copiado en otros archivos.
Grep del patrón exacto y luego de variantes con distinto `gap`/orden
encontró **6 ocurrencias más** en total, todas con el mismo fix (quitar
`flex-1 min-w-0` del wrapper de stat cards):
`productos/TabSinVenta.jsx` (la vista real detrás de "Gestión de Stock"),
`productos/TabInventario.jsx`, `pedidos/TabReglas.jsx`,
`StaffManagementView.jsx`, `VentasView.jsx` (3 ocurrencias, una por cada
una de sus 3 tabs internas), `purchases/FacturasCompraView.jsx`.
Verificado con Playwright en las 7 superficies corregidas — filas de
cards completas, sin columna angosta. Búsqueda final de cierre (grep de
`flex-wrap` + `flex-1` + `min-w-0` combinados en la misma línea/className
en todo `src/views` y `src/components`): **cero coincidencias
restantes** — esta clase de bug se considera cerrada (v2.46.2 → v2.47.1).

### 10.4 Pendiente de T4

Con el barrido de scroll horizontal (desktop + iPhone 13) y la auditoría
de sub-tabs ya hechos, lo que queda explícitamente sin verificar:
- **Modales — muestra representativa revisada (v2.47.3), no exhaustiva**:
  abiertos con Playwright a 1024×768 y verificados sin scroll horizontal +
  captura visual: `PromoModal` (`/promociones`, wizard 2 pasos),
  `EmployeeFormModal` (`/staff`, wizard 4 pasos, tab Personal), 
  `NuevoConteoModal` (`/conteo-inventario`). Los 3 limpios — ancho fijo
  centrado, sin overflow, formularios legibles. **No abiertos**: modales
  de `/pedidos` (`CrearRutaModal`, `RecepcionModal`, `LlegadaModal`) —
  bloqueados por el bug preexistente de `@capacitor-community/
  background-geolocation` (ver nota al final de esta sección); modal de
  `ShiftExceptionModal` en `/schedules` — el selector automático no
  encontró su botón disparador (posiblemente requiere seleccionar una
  celda del calendario primero, no un botón de header); modal de
  `/payroll` — sin botón "nuevo" visible en el header para este usuario
  (puede ser gated por período ya abierto o por permiso). Cobertura
  parcial, no el 100% de los ~30 overlays hand-rolled del proyecto (§9.1).
- **Touch targets — medido y corregido el hallazgo sistémico (v2.47.3)**:
  barrido con Playwright en viewport iPhone 13 sobre 9 rutas (`/overview`,
  `/monitor`, `/my-requests`, `/minmax`, `/ventas`, `/profile`,
  `/solicitudes`, `/avisos`, `/my-schedule`), midiendo `getBoundingClientRect`
  de todo `button`/`a[href]`/`[role=button]`/checkbox/radio contra un piso
  de 40px. Encontrado: 30 elementos de 250×32px, IDÉNTICOS en las 9 rutas
  — los ítems indentados (hijos de grupo, ej. "Mis Solicitudes" bajo
  "Solicitudes") del drawer de navegación móvil en `AppLayout.jsx`
  (`px-2.5 py-2`, ~32px de alto, bien bajo el mínimo de 44px de Apple
  HIG). Mismo bloque de código sirve al sidebar de escritorio (mouse, sin
  problema) y al drawer móvil (touch) — fix con `min-h-[44px]` aplicado
  SOLO cuando `isMobile`. Verificado: 30 → 0 elementos bajo el umbral,
  captura del drawer confirma que no rompe el layout indentado. **Pendiente,
  menor prioridad**: los controles de personalizar/redimensionar widgets
  de `DashboardView.jsx` (20-28px, iconos secundarios de baja frecuencia
  de uso — "Personalizar", drag-handles de resize) no se tocaron; no son
  navegación primaria y requerirían rediseño del header del widget, fuera
  de alcance de un fix mecánico.
- **Tipografía ≥16px en inputs móviles** — investigado (no solo pendiente):
  `PortalInput.jsx`/`CatalogSelect.jsx` (los `<input>` de texto libre) ya
  usan `text-[16px]` — correcto, sin zoom-on-focus de iOS. El input de
  filtro interno de `LiquidSelect.jsx` (se abre y hace autofocus al 
  desplegar, línea 194) y el `<input>` de `SearchInput.jsx` sí renderizan
  bajo 16px (`text-[11-13px]` según variante). En teoría dispara
  zoom-on-focus de iOS Safari — pero el `<meta viewport>`
  (`index.html:9`, decisión "Bloque 5.7b") ya pone `user-scalable=no` en
  el modo de uso real de este portal (PWA standalone instalada, build
  nativo Capacitor, o `/kiosk`), que anula el zoom-on-focus por completo
  ahí. Solo persiste en el modo pestaña-de-navegador-normal, donde el
  propio Bloque 5.7b restaura el zoom deliberadamente por accesibilidad
  (WCAG 1.4.4) — es decir, ese modo YA espera y permite zoom, no es una
  regresión. Impacto real bajo; no se tocó `LiquidSelect`/`SearchInput`
  para evitar el riesgo de romper el layout denso de `nano`/`compact`
  (usados en `TimePicker12.jsx`, `FormAiSchedulerPreview.jsx` y decenas
  de selects en toda la app) a cambio de un beneficio marginal en el modo
  menos usado. Documentado como excepción deliberada, no un olvido.
- **Revisión visual por vista en iPhone 13 — hecha para las 4 vistas de
  tienda accesibles (v2.47.3)**: capturas de pantalla completas (no solo
  el barrido mecánico de scroll horizontal) en `/monitor`, `/my-requests`,
  `/minmax`, `/ventas`. Las 4 limpias — stat cards en grid responsive de 2
  columnas, tabs con scroll horizontal esperado, estados de carga
  (skeletons) renderizando correctamente. Único hallazgo: en `/monitor`,
  la foto de un empleado (Alva Gabriela Ayala Tobar) muestra el ícono
  roto de imagen + texto "Foto" en vez de un placeholder — es un
  problema de dato (`photo_url` vacío o URL firmada que falló), no de
  CSS/tema, fuera de alcance de este plan.
- **Revisión dirigida por tamaño de archivo (v2.47.3, a pedido del
  usuario)**: las capturas anteriores (T4 completo + esta sesión) ya
  cubrían las vistas más grandes de mayor riesgo — `VentasView.jsx`
  (2,490 líneas, #1), `FacturacionView.jsx` (2,208, #2),
  `productos/TabCatalogo.jsx` (1,954, #4, origen del bug de stat-cards),
  `purchases/FacturasCompraView.jsx` (1,346) — pero quedaban 8 de las 13
  vistas más grandes del proyecto sin verificación visual: se revisaron
  a 1024×768 en esta sesión: `AttendanceAuditView.jsx` (1,503, `/audit`),
  `VacationPlanView.jsx` (1,151, `/vacation-plan`), `CotizacionesView.jsx`
  (1,137, `/cotizaciones`), `EncuestaView.jsx`/`EncuestaAdminView.jsx`
  (1,514/1,364, `/encuesta`, `/encuesta-admin`), `PermissionsView.jsx`
  (1,101, `/permissions`), `productos/TabMinMax.jsx` (1,707 líneas, la
  vista de mayor tamaño sin cubrir hasta ahora — tab "Sucursal" de
  `/minmax`) y `productos/TabMinMaxNetwork.jsx` (tab "Red"). Las 8
  limpias — sin scroll horizontal, stat cards/pills en fila completa,
  tablas anchas (`TabMinMaxNetwork`, 7 columnas de sucursal) sin desborde.
  Único hallazgo (no es bug de tema): la tab "Sucursal" de `TabMinMax.jsx`
  renderiza completamente vacía (0 caracteres de texto, confirmado por
  DOM) para la cuenta de prueba usada — no es un problema de contraste
  (se verificó que no hay texto invisible), es más probable un tema de
  alcance de datos/scope de sucursal para esta cuenta específica;
  la tab "Red" (misma vista, alcance de red completa) sí muestra datos
  correctamente. No investigado más a fondo por estar fuera del alcance
  de este plan de tema/responsive. `EmployeeDetailView.jsx` (1,266
  líneas, se abre haciendo clic en un empleado desde `/staff`) también
  revisado: limpio, stat cards en fila completa, avatar placeholder e
  historial vacío con el patrón de empty state correcto. **Con esto, las
  13 vistas más grandes del proyecto (top-13 por líneas de código) quedan
  todas verificadas visualmente a 1024×768 en esta sesión.**
- **`/pedidos`** (y sus tabs: `TabPedidos`, `TabReglas`, `TabMetricas`,
  `TabRutas`) sigue bloqueada para cualquier auditoría (visual o
  mecánica vía Playwright logueado) hasta que se resuelva el bug
  preexistente de `@capacitor-community/background-geolocation` — no es
  parte de T4, pero es un bloqueador transversal a tener en cuenta. La
  revisión manual de `TabReglas.jsx`/`pedidos/RutaEnCursoCard.jsx` sí
  recibió el fix de stat-cards de todos modos (código auditado por grep,
  no por navegación en vivo).
