# Auditoría de Diseño — Portal Farmalasa

**Fecha:** 2026-07-26 · **Versión auditada:** v2.62.4 (`fba6af02`)
**Alcance:** frontend completo — 199 archivos `.jsx` (109 vistas + 86 componentes), 82,589 líneas.
**Método:** lectura de código + medición mecánica + QA visual autenticado en vivo (Playwright).
**Evidencia:** `docs/audits/diseno-2026-07-26/` (capturas + `scan-dark.json`).

---

## 0. Resumen ejecutivo

El sistema de diseño **existe y es bueno**. El problema no es que falte diseño: es que
hay tres desconexiones entre lo que se construyó, lo que se documentó y lo que las
vistas realmente usan.

| | Veredicto |
|---|---|
| ¿Están los tokens bien definidos? | **Sí.** 4 temas completos, ~40 tokens cada uno, primitivas `data-surface`, escala de sombras, paleta dataviz, semáforos de dominio. |
| ¿Se usan? | **Parcialmente.** Superficie/texto/borde sí (~70-85%). Tipografía, radios, z-index y densidad **no** (0-0.5%). |
| ¿Es estándar entre elementos? | **No.** Familias enteras (botones, inputs, skeletons, empty states, spinners, pantallas de carga) tienen canónico construido y ~0 adopción, o directamente no tienen canónico. |
| ¿Se sigue haciendo a mano? | **Sí, masivamente.** 4,491 tamaños de texto, 627 radios, 553 z-index, 411 sombras, 639 `<button>`, 112 `<input>` escritos a mano. |
| ¿DESIGN.md está completo? | **La estructura sí (32 secciones), el contenido no.** Prescribe en ≥7 lugares clases que el propio gate prohíbe hoy, y afirma cosas que dejaron de ser ciertas. |

### Las tres causas raíz

**C1 — El documento contradice al código.** `DESIGN.md` §15 dice literalmente
*"No shared button component — patterns are inline"*, pero `Button.jsx` existe desde
la Fase T3 con 5 variantes y fue aprobado en la lámina de componentes T2.3. Quien sigue
el doc escribe botones a mano; por eso `Button.jsx` tiene **1 solo import en todo el
proyecto** (y es `DataTable`, no una vista). El doc además prescribe `text-slate-600`,
`bg-white`, `border-slate-200` y hex crudo en 7 secciones — exactamente lo que
`gate:design` bloquea hoy.

**C2 — Familias de tokens construidas y nunca conectadas.** Tres escalas canónicas
completas se declararon y jamás se consumieron: z-index (16 clases `@utility`,
**0 usos**), radios (6 tokens en `@theme`, **3 usos** contra 627 arbitrarios) y densidad
(`--row-h`/`--header-h`/`--space-card-padding`, **0 usos**). No es deuda nueva: `DESIGN.md`
§9 lo admite y lo difiere a "T3/T4"… un plan que se declaró CERRADO el 2026-07-24.

**C3 — El gate mecánico es ciego al blanco.** `GRAY_RE` en `scripts/design-gate.mjs`
exige un shade numérico (`-\d{2,3}`), así que `bg-white`, `text-white` y `border-white`
—**1,639 usos en el proyecto**— nunca fueron detectados ni una sola vez. Es la misma
clase de hueco que ya se documentó dos veces antes (`ring-*`/`via-*` en T7,
`border-slate-*` en v2.55.0), repetida por tercera vez.

### Impacto medido en vivo

QA autenticado sobre **29 rutas en tema oscuro**:

- **52 superficies blancas opacas** de tamaño real (≥2,400 px²) pintadas sobre el fondo oscuro.
- **166 nodos de texto por debajo del mínimo AA** de contraste.
- Peores vistas: `encuesta` (10 superficies / 48 textos), `facturacion` (6 / 37),
  `overview` (10 / 17), `branches` (10 / 2).

Ver `docs/audits/diseno-2026-07-26/dark-encuesta.png`: cuatro tarjetas KPI blancas con
el texto blanco del tema encima — ilegibles.

---

## 1. Hallazgos por severidad

### S1 — Rompen la experiencia hoy

---

#### S1.1 · `bg-white` opaco: 561 usos en 107 archivos

**El hallazgo más grande de la auditoría.** Tarjetas, pastillas, botones y paneles con
fondo blanco fijo que no reacciona al tema. En dark y solid-dark quedan como bloques
blancos con el texto del tema (claro) encima → invisible.

Confirmado en vivo, no inferido: 52 instancias reales detectadas por `getComputedStyle`
sobre 29 rutas.

| Archivo | Usos |
|---|---|
| `views/FacturacionView.jsx` | 32 |
| `views/EncuestaView.jsx` | 20 |
| `components/forms/EmployeeFormModal.jsx` | 20 |
| `views/EmployeeDetailView.jsx` | 19 |
| `views/productos/TabCatalogo.jsx` | 17 |
| `views/RolesView.jsx` | 13 |
| …otros 101 archivos | 440 |

Familia completa de blanco crudo: `bg-white` opaco 561 · `bg-white/alpha` 137 ·
`text-white` 728 · `border-white` 213 = **1,639 usos**. No todos son bugs (el sidebar y
el kiosco son superficies bespoke siempre-oscuras, y `text-white` sobre un botón brand es
correcto) — pero ninguno pasó jamás por un gate.

---

#### S1.2 · `text-brand` no tiene variante oscura: 512 usos en 106 archivos

`--brand` (`#0052CC`) está definido **solo en `:root`**. No hay override por tema y no
existe `--brand-text`, a diferencia de `--chart-N-text`, `--success-text`, `--warning-text`
y `--danger-text`, que sí tienen su par claro para dark/solid-dark.

Medido en vivo sobre la tarjeta oscura: **2.85:1** — falla AA (mínimo 4.5:1). Afecta
enlaces, valores destacados, nombres de empleado, chips y encabezados en 106 archivos.

Es exactamente el bug que T7 arregló para `Badge.jsx` creando los `--chart-N-text`;
el color más usado del sistema quedó fuera de ese arreglo.

---

#### S1.3 · Tipografía por debajo del umbral legible: 270 usos

`text-[8px]` (229), `text-[7px]` (39) y `text-[6px]` (2) en ~20 archivos, incluidos
`PortalInput.jsx`, `AppLayout.jsx`, `EmployeeFormModal.jsx` y `DashboardView.jsx`.
`DESIGN.md` §7 fija el piso de la escala en 9px; estos están por debajo de su propia regla
y aparecieron en el escaneo de contraste como fallos reales.

---

#### S1.4 · `RouteLoadingFallback` sigue hardcodeado claro

`src/App.jsx:159` — la pantalla de carga que se ve **en cada cambio de ruta**:

```jsx
bg-white/35 backdrop-blur-3xl border border-white/70
shadow-[0_32px_80px_rgba(0,82,204,0.10),…]
```

Es el mismo patrón que se corrigió 10 líneas más abajo en v2.62.4 (el splash de
"Verificando sesión…"). Se escapó porque el barrido de esa versión buscaba *stops de
gradiente*, no `bg-white/NN` a secas — otra vez el hueco C3.

---

#### S1.5 · El preloader de `index.html` ignora el tema

`index.html:89` pinta un degradado lavanda fijo (`#e2daff → #f3f4fb`) más `body { background-color: #E6F0FF }`
antes de que React monte. Un usuario en dark ve un flash claro a pantalla completa en
**cada arranque**. Requiere un script inline de bootstrap de tema en `<head>` (lee
`localStorage['portal-theme']` y estampa `data-theme` antes del primer pintado).

---

### S2 — Deuda estructural

---

#### S2.1 · No existe escala tipográfica: 4,491 tamaños escritos a mano

Cero tokens de tipografía en `@theme`. 181 archivos escriben `text-[Npx]` literal, con
**25 valores distintos**:

| px | usos | | px | usos |
|---|---|---|---|---|
| 10 | 1,330 | | 14 | 93 |
| 11 | 862 | | 15 | 63 |
| 9 | 849 | | 22 | 43 |
| 12 | 471 | | 8 | 229 |
| 13 | 249 | | 7 | 39 |
| 16 | 205 | | otros 14 valores | 57 |

Hay una escala real de facto (10/11/9/12/13 = 84% de los usos) — simplemente nunca se
tokenizó. `DESIGN.md` §7 la documenta **como strings literales**, consagrando el
hand-writing en vez de resolverlo.

---

#### S2.2 · Tres escalas canónicas con adopción cero

| Escala | Construida | Adopción real | A mano |
|---|---|---|---|
| **Z-index** | 16 clases `@utility` (T1) | **0** | 553 usos en 110 archivos (445 `z-N` + 79 `z-[N]` + 29 `zIndex:` inline) |
| **Radios** | 6 tokens en `@theme` | **3** | 627 `rounded-[…]` en 99 archivos |
| **Densidad** | `--row-h`, `--header-h`, `--space-card-padding` × 3 niveles | **0** | — |

Sombras es el contraste positivo: **548 tokenizadas contra 411 a mano (57%)** — la única
escala donde T7.3 sí conectó el token con el consumo.

---

#### S2.3 · Componentes canónicos construidos y no adoptados

| Componente | Importado por | Compite contra |
|---|---|---|
| `Button.jsx` | **1** (`DataTable`, ninguna vista) | 639 `<button>` crudos en 102 archivos |
| `PortalInput.jsx` | **2** | 112 `<input>` crudos en 39 archivos |
| `Badge.jsx` | **1** (`ProveedoresView`) | badges inline en casi toda vista |
| `StatCard.jsx` | **1** real (+1 archivo de preview) | KPI cards a mano en Inicio, Productos, Facturación… |
| `PromptModal.jsx` | **1** | — |
| `LiquidTooltip.jsx` | **2** | `title=` nativo |

Con buena adopción (referencia de que el modelo funciona cuando se conecta):
`LiquidSelect` 60 · `GlassViewLayout` 40 · `useToastStore` 42 · `LiquidDatePicker` 31 ·
`DataTable` 24 · `ConfirmModal` 19 · `TablePagination` 16 · `ViewTabBar` 14.

`data-surface`, la primitiva base: **50 usos en 32 de 199 archivos**.

---

#### S2.4 · Skeletons: dos idiomas compitiendo, ningún componente

- Clase CSS `.skeleton` (`index.css`) — **131 usos**.
- `animate-pulse` a mano — **99 usos en 53 archivos**.
- Solo 4 componentes skeleton nombrados, **los 4 locales a su archivo**
  (`KpiCardSkeleton` y `SalesBranchSkeleton` en `DashboardView`, `SkeletonSection` en
  `WidgetInventorySearch`, `CardSkeletons` en `tabminmax/`).

No existe `<Skeleton>` compartido. Cada vista decide forma, altura y ritmo por su cuenta.

---

#### S2.5 · Empty states: el estándar existe en el doc, no en el código

`DESIGN.md` §18 define el patrón (squircle glass + título + subtítulo) y lo llama
obligatorio. En el código, la única función `EmptyState` es **local a
`FacturacionView.jsx:101`** — no es compartida. 35 archivos tienen textos de vacío;
20 usan la prop `empty` de `DataTable`; el resto lo copia a mano.

Peor: la receta del §18 prescribe `bg-white/50 border-white/80` + `text-slate-700` +
`text-slate-500` — las tres clases prohibidas hoy.

---

#### S2.6 · Tres pantallas de carga y tres spinners distintos

| Dónde | Tratamiento |
|---|---|
| `RouteLoadingFallback` (App.jsx) | Tarjeta glass + `Loader2` + texto "Cargando…" |
| `ContentLoadingFallback` (App.jsx) | `Loader2` suelto, sin tarjeta ni texto |
| `FallbackLoader` (UnifiedModal.jsx) | Borde rotatorio bespoke + texto "Cargando Módulo…" |

Y a nivel proyecto: `Loader2` (171 usos / 82 archivos) contra `animate-spin` genérico
(198 / 87) contra el borde rotatorio de `UnifiedModal`.

---

#### S2.7 · Dos sistemas de modal en paralelo

`ModalShell` (base, envuelto por `LiquidModal` y `AlertModal`) coexiste con
`UnifiedModal.jsx` — **944 líneas, un switchboard con ~30 tipos de formulario**,
importado por 6 archivos. Son dos arquitecturas distintas para el mismo problema.
`DESIGN.md` §23.4 ya reconoce que hay dos rutas de scroll-lock, pero no la duplicación
de fondo.

---

#### S2.8 · `framer-motion` creció contra su propia regla

`DESIGN.md` §23.1: *"present in 14 files. Standard is CSS keyframes + Tailwind
transitions. No new framer-motion usage."* Realidad hoy: **25 archivos**. La regla no
tiene gate, así que no se cumple.

---

### S3 — Documentación

#### S3.1 · DESIGN.md prescribe lo que el gate prohíbe

36 menciones a clases hoy bloqueadas, en al menos 7 secciones:

| Línea | Sección | Prescribe |
|---|---|---|
| 30 | §1 Philosophy | `text-slate-600` / `text-slate-500` |
| 561 | §7 Typography | `text-slate-600` / `text-slate-500` |
| 1055 | §15 Buttons | `text-slate-600 bg-white border-slate-200 hover:bg-slate-50` |
| 1186-87 | §18 Empty States | `text-slate-700`, `text-slate-500` |
| 1751, 1763 | §29 Forms | `text-slate-700 placeholder-slate-400` |
| §15 primary | §15 Buttons | hex crudo `#0052CC` / `#003D99` |
| §28 | Page States | `bg-amber-50/90 border-amber-200/80 text-amber-700` |

#### S3.2 · Afirmaciones que dejaron de ser ciertas

- **§15**: "No shared button component" → `Button.jsx` existe desde T3 con 5 variantes.
- **§8**: documenta radios como literales `rounded-[Nrem]`, sin mencionar los tokens `--radius-*` que existen en `@theme`.
- **§23.1**: framer-motion "en 14 archivos" → son 25.
- **§28**: afirma que el fallback de `ErrorBoundary` *"uses only existing CSS tokens — respects active theme, no hardcoded light color"*. Era falso: tenía un sheen `from-white/40` hardcodeado (corregido ayer en v2.62.4) y su sombra sigue siendo un literal.
- **§9**: difiere la migración de z-index a "T3/T4" — plan declarado cerrado el 2026-07-24.

#### S3.3 · Ocho componentes sin documentar

`StatCard`, `TimePicker12`, `RangeDatePicker`, `PeriodPicker`, `LiquidWeekPicker`,
`CatalogSelect`, `SyncHealthBanner`, `EmployeeDocumentsList` — no aparecen en DESIGN.md.

#### S3.4 · Huecos para "sistema terminado"

No existe: escala tipográfica tokenizada · contrato de estados por componente
(reposo/hover/focus/activo/deshabilitado/cargando/error/vacío) · plantilla de
documentación por componente (prometida en el contrato §8) · guía de densidad
consumible · reglas de motion con tokens · página 404 dedicada (§28 la marca como
"optional improvement" desde hace tiempo).

---

## 2. Lo que está bien (para no romperlo)

- **Los 4 temas están bien diseñados y son completos.** El contraste de `--text-*` se
  corrigió con medición real (v2.59.0). Los semáforos de dominio (stock, txvol) están
  tokenizados y son correctos.
- **Login y kiosco están sanos.** Verificado en vivo: login fuerza `data-theme=null` en
  los 4 temas (siempre claro, por diseño); el kiosco fuerza `dark` y renderiza **0 inputs**
  — el refactor de v2.60.0 se sostiene.
- **Móvil sin desbordes.** 390×844 real sobre `overview`, `ventas` y `encuesta`:
  `scrollWidth === clientWidth` en las tres.
- **Superficie, texto y borde tienen buena adopción**: `bg-surface-*` 1,520 ·
  `text-content-*` 4,046 · `border-divider`/`border-card` 1,423.
- **`gate:design` funciona** para lo que sí cubre (nativo, paletas de color con shade,
  inputs <16px, `active:scale`, `border-l`). El problema es su cobertura, no su diseño.

---

## 3. Plan de acción

Cada fase cierra con un criterio **verificable por script**, no por inspección.

### Fase D0 — Tapar el hueco del gate *(medio día)*

Sin esto, todo lo demás vuelve a driftar.

1. Extender `GRAY_RE` para cubrir `white`/`black` sin shade numérico.
2. Agregar categoría **`typography`**: `text-[Npx]` fuera de la escala aprobada.
3. Agregar categoría **`z-index`**: `z-[N]` y `zIndex:` inline fuera de la escala canónica.
4. Corregir `HEX_RE`: hoy solo detecta hex dentro de `className=`/`style=` **en la misma
   línea**, por eso `#EEF4FF` sobrevivió meses dentro de una `const` de JS.
5. Agregar chequeo de `framer-motion` (lista cerrada de archivos permitidos).

**Cierre:** el gate corre y reporta el baseline real (se espera ~2,000+ hallazgos).
No se arregla nada todavía — solo se hace visible.

---

### Fase D1 — S1: lo que rompe hoy *(2-3 días)*

| # | Acción | Alcance |
|---|---|---|
| D1.1 | Crear `--brand-text` con variante por tema y migrar `text-brand` usado como color de texto | 512 usos / 106 archivos |
| D1.2 | Barrer `bg-white` opaco → `bg-surface-card`/`--card-tint-base` según rol | 561 usos / 107 archivos, empezando por Facturación, Encuesta, EmployeeFormModal |
| D1.3 | Subir los 270 usos <9px al piso de 9px | ~20 archivos |
| D1.4 | Tokenizar `RouteLoadingFallback` | 1 archivo |
| D1.5 | Script inline de bootstrap de tema en `index.html` | 1 archivo |

**Cierre:** re-correr el escáner en vivo sobre las 29 rutas → **0 superficies blancas** y
**0 nodos bajo AA** en dark y solid-dark. Es el mismo script de esta auditoría, así que la
comparación es directa contra el baseline 52/166.

---

### Fase D2 — Conectar las escalas muertas *(3-4 días)*

| # | Acción |
|---|---|
| D2.1 | Definir la escala tipográfica en `@theme` a partir de la escala de facto medida (9/10/11/12/13/16/22) y migrar los 4,491 usos |
| D2.2 | Migrar los 553 z-index a las 16 clases canónicas, revisando cada punto de apilamiento contra sus vecinos |
| D2.3 | Migrar los 627 radios a `rounded-card`/`modal`/`btn`/`input`/`badge` |
| D2.4 | Decidir densidad: conectarla de verdad o **borrar los tokens** — hoy son código muerto que aparenta un sistema que no existe |

**Cierre:** gate en 0 para typography y z-index; `rounded-[…]` reducido a las excepciones
documentadas.

---

### Fase D3 — Adopción de componentes *(1 semana)*

| # | Acción |
|---|---|
| D3.1 | Migrar `<button>` → `Button` (639 usos / 102 archivos), ampliando variantes si falta alguna real |
| D3.2 | Migrar `<input>` de texto → `PortalInput` (112 / 39) |
| D3.3 | Crear `<Skeleton>` compartido y unificar `.skeleton` + `animate-pulse` |
| D3.4 | Promover `EmptyState` de `FacturacionView` a `components/common/` y adoptarlo en los ~15 archivos que lo copian |
| D3.5 | Unificar las 3 pantallas de carga en un `<LoadingState variant="route\|content\|modal">` |
| D3.6 | Adoptar `Badge` y `StatCard`, o eliminarlos si el patrón real es otro |
| D3.7 | Decidir el futuro de `UnifiedModal` (944 líneas): migrarlo sobre `ModalShell` o congelarlo formalmente |

**Cierre:** `<button>`/`<input>` crudos solo en los componentes canónicos y en excepciones
documentadas; un solo idioma de skeleton, empty state y loading.

---

### Fase D4 — Reescribir DESIGN.md *(2 días)*

Con D1-D3 cerradas, el doc describe algo real.

1. Corregir las 36 prescripciones prohibidas y las 5 afirmaciones falsas de §3.2.
2. Documentar los 8 componentes faltantes.
3. Agregar lo que falta para "sistema terminado": escala tipográfica, contrato de estados
   por componente, plantilla de documentación, guía de densidad, tokens de motion.
4. Regla de gobernanza nueva: **toda sección de DESIGN.md que prescriba clases debe estar
   cubierta por el gate**. Si el gate no la puede verificar, es una convención, no un
   estándar — y se marca como tal.

**Cierre:** un script que extrae los bloques de código de DESIGN.md y los pasa por
`gate:design`. Si el doc prescribe algo prohibido, falla.

---

## 4. Preguntas abiertas para decidir

1. **Densidad** (`--row-h`/`--header-h`/`--space-card-padding`): ¿se conecta o se borra?
   Se diseñó en T2 para 3 niveles (cómoda/compacta/ultra) y nunca se consumió.
2. **`UnifiedModal`**: ¿se migra a `ModalShell` o se congela como legacy aceptado?
3. **Página 404**: hoy el catch-all redirige en silencio. ¿Se crea la vista dedicada?
4. **`framer-motion`**: la regla dice "no más usos" y pasó de 14 a 25 archivos.
   ¿Se hace cumplir con gate, o se acepta y se documenta cuándo es válido?
5. **Orden de ejecución**: el plan asume D0 → D1 → D2 → D3 → D4. D1 se puede adelantar
   si la prioridad es que el modo oscuro deje de verse roto ya.

---

## Anexo — Evidencia

- `docs/audits/diseno-2026-07-26/scan-dark.json` — resultado crudo del escáner (29 rutas).
- `docs/audits/diseno-2026-07-26/dark-*.png` — captura por ruta en tema oscuro.
- `docs/audits/diseno-2026-07-26/solid-dark-*.png`, `solid-*.png`, `liquid-*.png` — contraste entre temas.
- `docs/audits/diseno-2026-07-26/movil-dark-*.png` — 390×844 real.
- `docs/audits/diseno-2026-07-26/kiosk-1366x768.png`, `login.png`.
