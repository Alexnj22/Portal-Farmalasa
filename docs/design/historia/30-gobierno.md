# Gobierno y changelog del documento — historia

> Historia de DESIGN.md §30. Copia fiel del texto que vivía en DESIGN.md hasta el 2026-11-06, cuando el documento se condensó: allá quedaron la regla, el canónico, un ejemplo corto y el gate; acá, las mediciones y los incidentes que explican por qué. Las citas a líneas de código y los números de sección son los de ESA época (la Voz era §26, hoy §34).

## 30. Governance & Changelog

### Extend-vs-create rule

Before creating a new component, verify:

| Need | Check first |
|---|---|
| Any overlay / modal | `ModalShell`, `UnifiedModal`, `LiquidModal`, `ConfirmModal`, `AlertModal` |
| Any select / dropdown | `LiquidSelect` |
| Any tooltip | `LiquidTooltip` |
| Any data table | `DataTable` |
| Any view wrapper | `GlassViewLayout` + `ViewTabBar` |
| Any avatar | `LiquidAvatar` |
| Any toast | `useToastStore` (via `LiquidToast`) |
| Un campo de formulario | `PortalInput` / `PortalTextarea` (§15.11) — sin etiqueta visible también: `label` es opcional |
| Una tarjeta / contenedor | `data-surface="card"` (§5), con `data-tono` si lleva estado (§5.1). **Nunca** `bg-surface-card + border + rounded` a mano |
| Un buscador | `ViewTabBar` (header de vista) · `SearchInput` (widget/modal/tab) · `SearchInput expandable` (toolbar de widget) — §24 |
| Un botón, de cualquier forma | `Button` (§15.2) · `TabBarAction` dentro de `ViewTabBar` (§15.5) |
| Una de N opciones | `SegmentedControl` (§15.3) · `FilterBar.Chip` si es un filtro (§17) |
| Una etiqueta de estado | `Badge` (§16.1) |
| Un contador sobre un ícono | `Contador` (§16.2) |
| Una fecha | `LiquidDatePicker` — nunca `<input type="date">` |

Creating a parallel component that duplicates functionality is prohibited. Extend the existing one or open a design discussion first.

**El hueco casi siempre está en el canónico, no en la vista.** Es el hallazgo
que más se repitió en la auditoría de julio: cuando alguien escribió un control
a mano, en la enorme mayoría de los casos fue porque al canónico le faltaba una
ranura. Nueve encontrados y tapados en D3: `Badge` y `PortalInput` tiraban en
silencio todo prop que no estuviera en su lista fija (`title`, `min`/`max`/
`step`, 22 `aria-label`); `Button`/`TabBarAction` no daban nombre accesible a
los `iconOnly` (102 de 194 no tenían); `SegmentedControl` no sabía apilar ícono
sobre etiqueta; `PortalInput` no sabía tintarse; `DataRow` y el `<th>` ordenable
de `DataTable` no respondían al teclado; `LiquidSelect` no era enfocable.

**Antes de migrar una vista al canónico, leé las props del canónico.** Tres de
los cuatro hallazgos del 2026-07-28 estaban ahí y no en la vista. Migrar sin
mirar habría borrado atributos reales sin que fallara el build, ni el lint, ni
el gate.

### Changelog

| Version | Date | Notes |
|---|---|---|
| v2.2 | 2026-07-28 | **Cierre de la estandarización.** `tarjeta-a-mano` 184→**0** e `input-a-mano` 60→**4**, las dos categorías nuevas del gate. Tres ranuras nuevas en los canónicos, y las tres salieron de la misma pregunta —*¿por qué esto está escrito a mano?*—: `label` OPCIONAL en `PortalInput` (rescató 43 campos: era lo único que los dejaba fuera), `onDark` (kiosco: anatomía del canónico, paleta bespoke) y `data-tono` en la tarjeta (§5.1 — el canónico era INDECORABLE: ni un `border-*` ni un `ring-*` le ganaban, así que marcar una tarjeta en edición obligaba a renunciar a él). Reescritas §15.11 (tabla de ranuras con lo que rescató cada una), §15.12 (de "61 celdas de grilla" a **4 excepciones reales**, nombradas y justificadas), §5 (tabla de superficies + §5.1 `data-tono` + la regla de no anidar tarjetas). Lo que se recuperó no es solo dejar de repetir clases: la forma volvió a ser del TEMA — medido, el radio de tarjeta da 28px en Liquid y 12px en Sólido, cuando 150 tarjetas lo tenían fijo en 24px. |
| v2.1 | 2026-07-28 | **D3/D4** — cierre de `AUDITORIA-DISENO-2026-07-26.md`. Reescritos §15 (agrega §15.8 "cuándo NO es un botón", §15.11 `PortalInput` con `tono`, §15.12 cuándo un `<input>` a mano es correcto), §6.0 (paleta consolidada de 13→9 categóricos, los retirados quedan como ALIAS y no como valores, más los colores del logo integrados), §25 (agrega §25.1 nombre accesible, §25.2 qué atributo de estado y cuándo, §25.3 teclado en tablas; corrige la afirmación de que `LiquidSelect` tenía el patrón combobox completo — tenía los roles, no el teclado) y §30 (tabla extend-vs-create ampliada + la regla de leer las props del canónico antes de migrar). Migrado: 276→60 botones a mano (137 abiertos en D3.3, 77 migrados y 60 que eran el canónico equivocado — §15.8), 101→8 chips, 99→61 inputs, 4 buscadores. Arreglado en el canónico, que es donde estaba el hueco 9 de cada 10 veces: `Badge`/`PortalInput` que tiraban props, 102 `iconOnly` sin nombre, `DataRow` y 62 columnas ordenables sin teclado, `LiquidSelect` inalcanzable con Tab en los 70 archivos que lo usan. Gate: 5 categorías nuevas, 3 de ellas en cero absoluto (`button-name`, `paleta-cerrada`, `input-sin-nombre`). |
| v2.0 | 2026-07-24 | **T7.4** — cierre de `AUDITORIA-TEMA-2026-07.md` T7. Reescribe §3 (paleta dataviz: 6→9 chart-N, regla de 3 buckets, excepciones documentadas; escala canónica de sombras nueva, 542/967 usos consolidados en 19 tokens) y §6 (tabla "Semantic" de clases crudas reemplazada por los tokens reales de severidad — esa tabla vieja era literalmente la causa del problema que T7.1 cerró). Corrige §2 (default cambió a Solid Modern en T6, ya no es Liquid). Migración de color: 119 archivos, ~1,400+ usos de color crudo → tokens. Decisión de si Liquid Glass sobrevive como tema sigue diferida — ver §2. |
| v1.0 | 2026-06-24 | Initial audit — Phases A, B, C complete. 4-theme architecture, full component inventory, accessibility/performance/cross-browser audit. |
| v1.1 | 2026-07-10 | Fase 4 design/UX audit (`AUDITORIA-2026-07.md`). Added §32 Mobile & Responsive Standard (did not exist before). Fixed project-wide: `active:scale-90/95` → `active:scale-[0.97]` (§31 compliance, ~300 sites), input font-size floor 16px (~170 inputs, iOS zoom fix), touch targets in `ViewTabBar`/`AppLayout` header to 44px, 9 native `<select>` → `LiquidSelect` swaps. Found but NOT fixed (documented only, too large/risky for a mechanical pass): ~1,288 `text-slate-300/400`-on-light-surface contrast violations across 127 files. |
| v1.5 | 2026-07-23 | Los cambios de v1.4 pasaron de prototipo a **código real** en `AppLayout.jsx` (v2.35.0): los 3 blobs ambientales del sidebar, shimmer, glow/borde del logo, ícono de nav activo y barra de acento ya usan `--logo-green`/`--logo-magenta`. De paso: `ViewTabBar.jsx` y el duplicado de `VentasView.jsx` ganan un modo responsive — fila de tabs solo en desktop, `LiquidSelect` compacto con el tab activo en móvil (resuelve el caso de 5 tabs/labels largos de Pedidos a Sucursales). Verificado con Playwright en desktop y móvil (iPhone 13, drawer incluido), cero errores de consola. Pendiente: los 5 blobs ambientales GLOBALES de `AppLayout.jsx` (fondo detrás de `<main>`) siguen en violeta/azul genérico, fuera del alcance de esta sesión. |
| v1.4 | 2026-07-23 | Colores reales del logo (`--logo-green: #8ec30f`, `--logo-magenta: #981d97` + variantes suaves), muestreados por pixel de `public/Logo512.png` — a pedido del usuario, se adoptan como los acentos DECORATIVOS/de identidad del proyecto de aquí en adelante (glows ambientales, estado activo de nav, hover de personalización), reemplazando el violeta/índigo genérico (`--brand-purple`, blobs de `AppLayout.jsx`) que no tenía relación real con la marca. `--brand` (#0052CC) sigue siendo el azul funcional, sin cambios. Tokens agregados a `index.css` + bridge `@theme inline`. Aplicado primero al prototipo interactivo del sidebar (ver §7.7 de `AUDITORIA-TEMA-2026-07.md`); pendiente extender a los blobs ambientales globales y cualquier glow decorativo nuevo. |
| v1.3 | 2026-07-23 | Fase T2 de `AUDITORIA-TEMA-2026-07.md` — refinamiento "Solid Modern" (`solid`/`solid-dark`: `--bg-page` tinte frío, radios 12px/16px) + contrato de tema ampliado: ramps de estado (hover/pressed por semántica, derivadas de valores ya usados en el código), escala de elevación 0-3, densidad adaptativa (3 niveles, tokens `--space-card-padding`/`--control-h`/`--row-h`/`--header-h`, sidebar auto-colapsa a rail en nivel "ultra" vía `isUltraDensity` en `AppLayout.jsx`), blobs ambient apagados en solid/solid-dark. Script de contraste AA nuevo (`contrast-check.mjs`, sin dependencias) encontró y corrigió un fallo real: `--text-tertiary` en solid/solid-dark no cumplía AA (2.56:1/2.76:1) contra `surface-card` opaco — corregido a 4.76:1/4.92:1. `ViewTabBar.jsx` migrado de verdad a tokens (primer componente con la plantilla de doc §8.5) — cierra el blindspot de dark mode de §22 vía el token net-new `--surface-tab-active`; su duplicado hand-rolled en `VentasView.jsx` (ya documentado en §32/§23) recibió la misma migración. `GlassViewLayout.jsx` limpiado de clases muertas (confirmado con Playwright que `data-surface="card"`/`"page-header"` ya ganaban la cascada sobre las clases Tailwind hardcodeadas coexistentes — CSS Cascade Layers: lo no-layered de `index.css` siempre gana sobre `@layer utilities` de Tailwind, sin importar orden ni especificidad). §32 resuelve la contradicción de breakpoints (`md:768` vs `lg:1024` real). Corrección de §5 (tokens de `dropdown`/`input`/`tab-track` documentados vs reales). Capturas del gate en `docs/audits/tema-2026-07/shots-t2-gate/` — pendiente aprobación del usuario antes de T3. |
| v1.2 | 2026-07-23 | Fase T1 de `AUDITORIA-TEMA-2026-07.md` — puente Tailwind v4 (`@theme inline` en `index.css`): tokens de color/radio/sombra existentes ahora son utilidades reales (`bg-surface-card`, `text-content-2`, `rounded-card`, `shadow-modal`, `bg-brand`…). Renombrados los primitivos crudos de radio/sombra (`--radius-card`→`--card-radius` etc.) para evitar autorreferencia circular con el namespace de Tailwind. Tokens net-new: focus-ring, scrim, divisor, paleta dataviz categórica (6), semáforo de riesgo de stock (7 estados reales de `tabminmax/constants.js`, corrige la mención errónea de "MUERTA/NORMAL/PICO/CRÍTICA" — ese es en realidad un semáforo *distinto*, de volumen de transacciones/hora en `DashboardView.jsx`, también tokenizado ahora). Z-index canónico (16 clases) vía `@utility` (Tailwind v4 no tiene namespace `@theme` para z-index). Corregidos de paso: `tailwind.config.js` estaba muerto (el proyecto usa `@tailwindcss/postcss` sin `@config` — confirmado porque Tailwind escaneaba el repo completo, no solo `src/`, incluyendo strings de archivos `.md`); sus 3 animaciones realmente usadas (`wiggle`, `kpi-enter`, `widget-settle`) no generaban NINGÚN CSS en producción (bug silencioso pre-existente en `NotificationBell`/`DashboardView`) — migradas a `@keyframes` nativos en `index.css`, archivo eliminado. `App.jsx:529/545` (`bg-[#E6F0FF]` hardcodeado, rompía dark/solid) → `bg-surface-page`; `AppLayout.jsx:710` scrim hardcodeado → `bg-scrim` (ambos same-value, cero cambio visual, corregidos de inmediato en vez de diferirse a T3 — ver `feedback_fix_violations_immediately` en memoria). §5, §9, §11 corregidos para reflejar el CSS real (tokens de `dropdown`/`input`/`tab-track` que no existían, keyframes fantasma). Cero componentes/vistas migrados a las nuevas utilidades — eso es T3/T4. |

