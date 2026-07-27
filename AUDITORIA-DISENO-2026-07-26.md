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

Secuencia: **D0 → D1 → D2 → D2.5 → D3 → D4**. D2.5 se agregó el 2026-07-26 al detectar
que el plan cubría la fontanería de tokens y la adopción de componentes, pero nunca la
consistencia visual entre elementos — ver su sección más abajo.

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

### Fase D2.5 — Inventario visual y canónico por familia *(3-4 días)*

**Hueco del plan original, detectado 2026-07-26.** D3 dice "migrar `<button>` → `Button`,
ampliando variantes si falta alguna real" — pero nadie sabe qué es "real". No se puede
migrar 639 botones a un componente que ofrece 2 alturas cuando hay 9 en uso, sin decidir
antes cuáles de esas 9 son legítimas. El plan cubría la *fontanería* de tokens y la
*adopción* de componentes, pero nunca la pregunta que las une: **¿los elementos se ven
iguales entre sí?**

Medido sobre el código real:

| Familia | Elementos | Radios distintos | Alturas | Paddings |
|---|---|---|---|---|
| **Botones** | 291 con `className` | **12** | **9** | **26** |
| **Badges / pills** | 1,108 | **12** | **11** | **24** |
| **Inputs crudos** | 59 | 6 | 3 | 8 |
| Cards con `data-surface` | 9 | 3 | — | 3 |

Los radios de botón más usados: `rounded-full` (102), `rounded-xl` (73), `rounded-lg`
(27), `rounded-2xl` (21), más 8 valores sueltos. Las alturas van de `h-6` a `h-12` sin
patrón. Los tamaños de texto, 7 distintos; los pesos, 4.

Esto no es "algo de variación": **no existe un estándar de botón**. Y `Button.jsx`, el
canónico, ofrece 2 tamaños (`h-[34px]`, `h-[42px]`) y 5 variantes — que no mapean contra
las 9 alturas en uso. Migrar sin decidir primero produciría 639 botones cambiando de
tamaño de forma arbitraria.

**Entregable por familia**, en este orden:

1. **Inventario** — agrupar los usos reales por forma visual y contar cada cluster.
2. **Decisión** — qué clusters son variantes legítimas (con su razón de ser: jerarquía,
   densidad, contexto) y cuáles son accidentes históricos que colapsan en otra.
3. **Definición** — el canónico expone exactamente esas variantes, ni una más.
4. **Documentación** — ficha por componente en `DESIGN.md` (variantes, estados,
   cuándo usar cada una), que es lo que D4 necesita para no volver a quedar stale.

**Familias a cubrir:** botones · badges y pills · inputs de texto · selects · date/time
pickers · cards y paneles · KPI/stat cards · modales · tabs · filter pills · tablas ·
avatares · tooltips · toasts · spinners · skeletons · empty states · tamaños de icono.

**Cierre:** cada familia tiene su set canónico decidido y documentado, y el gate
verifica lo verificable — p. ej. un radio de botón fuera del set aprobado es un
hallazgo, igual que hoy lo es un `text-slate-500`. Solo entonces D3 puede migrar contra
un objetivo que existe.

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

## 4. Decisiones tomadas (2026-07-26)

Las cinco preguntas abiertas quedaron resueltas. Lo que sigue es la versión vigente
del plan; las fases de arriba se leen con estos ajustes.

### 4.1 · Densidad — **se conecta**, sin `--font-data`

Los tokens ya están bien calibrados y se aplican **automáticamente por viewport**
(ancho *o* alto), sin toggle de usuario:

| Nivel | Disparo | `--row-h` | `--control-h` | `--space-card-padding` | `--header-h` |
|---|---|---|---|---|---|
| Cómoda | ≥1440 ancho y ≥820 alto | 44px | 40px | 24px | 72px |
| Compacta | <1440 ancho **o** <820 alto | 38px | 36px | 16px | 56px |
| Ultra | <1152 ancho **o** <700 alto | 32px | 32px | 12px | 44px |

Se conecta porque el problema es real y ya mordió una vez: el kiosco chocó exactamente
con esto a 1366×768 y lo resolvió por su cuenta con un `@media(max-height:800px)` local
(v2.60.1). Sin tokens consumidos, cada pantalla reinventa su propia solución.

El costo es bajo si la adopción va **solo por los canónicos**: `DataTable` es dueño de
la altura de fila, `Button` de la altura de control, las primitivas `data-surface` del
padding de tarjeta. Son ~4 puntos de consumo, no 199 archivos — y salen casi gratis
como subproducto de la fase D3.

**`--font-data` se elimina.** Es una preocupación tipográfica y colisionaría con la
escala que define D2, creando dos fuentes de verdad para el tamaño de texto.

**Queda explícito:** la densidad es responsiva, no una preferencia del usuario. Si en
algún momento se quiere un selector cómoda/compacta/ultra en Ajustes, es trabajo aparte.

#### Conflicto encontrado al extenderla a móvil — hay que corregir los disparos

Los tokens tal como están **romperían el táctil**. `Ultra` dispara con
`(max-width: 1151.98px)`, así que un teléfono de 390px cae en ultra y recibe
`--control-h: 32px` / `--row-h: 32px`. El mínimo táctil del proyecto es **44px**
(WCAG 2.5.8 AA, documentado en §25 del propio `DESIGN.md`). Conectarlos sin tocar los
disparos haría exactamente lo contrario de lo que se busca.

La causa es que hoy un solo disparo mezcla dos problemas distintos. La densidad por
viewport responde a *cuánto entra en una pantalla que se opera con mouse*; en táctil la
restricción no son los píxeles disponibles sino el tamaño del dedo. Corrección:

```css
/* Los disparos por ancho/alto se acotan a punteros de precisión */
@media (max-width: 1439.98px) and (pointer: fine),
       (max-height:  819.98px) and (pointer: fine) { … }

/* Y el táctil recibe un piso, independiente del ancho */
@media (pointer: coarse) {
  :root { --control-h: 44px; --row-h: 44px; }
}
```

No es "sin densidad en móvil": el **padding sí compacta** (12–16px). Lo que tiene piso
es la altura de control y de fila, que es lo que se toca con el dedo.

### 4.2 · `UnifiedModal` — **se migra sobre `ModalShell`**

Nada queda a mano y nada queda duplicado. Los 944 líneas pasan a construirse sobre el
shell canónico; lo que `UnifiedModal` hoy resuelve y `ModalShell` no (el switchboard de
~30 formularios, el scroll interno del visor de PDF) se extrae como capacidad del
canónico, no como una segunda arquitectura.

Regla general que aplica a toda la fase D3: **si falta una pieza, se diseña y se agrega
al canónico** para que sirva al siguiente caso igual — nunca se resuelve inline.

### 4.3 · Página 404 — **se crea**

`NotFoundView` dedicada, sobre el `EmptyState` compartido que produce D3.5, con acción
"Volver al inicio". Reemplaza el `<Navigate to={defaultRedirect} replace />` silencioso
del catch-all.

### 4.4 · `framer-motion` — la regla estaba mal escrita; se reemplaza por una acotada

La prohibición actual ("no new framer-motion usage") banea la librería entera sin
distinguir para qué se usa. Por eso se incumple: de los 25 archivos, **20 la usan para
cosas que CSS no puede hacer**.

| Uso | Cantidad | ¿CSS puede? |
|---|---|---|
| `AnimatePresence` — animación de salida al desmontar | 38 usos / 17 archivos | **No.** Cuando React quita el nodo no queda nada que animar. |
| `layout` / `layoutId` — transición FLIP entre posiciones | 13 usos / 2 archivos | **No**, sin medir posiciones a mano en JS. |
| `drag` | 5 usos | **No.** |
| `motion.*` solo para fade/slide de entrada, hover o tap | 5 archivos | **Sí.** `@keyframes` + Tailwind. |

Los 5 archivos que sí son violaciones reales: `LifecycleTimeline.jsx`,
`ApoioScanModal.jsx`, `StageAnims.jsx`, `AbcXyzMatrix.jsx`, `LabsPanel.jsx`.

**Regla nueva:** `AnimatePresence`, `layout`/`layoutId` y `drag` están permitidos.
`motion.*` para entrada/hover/tap está prohibido — eso es CSS. El gate marca cualquier
archivo que importe `motion` sin importar también alguna de las tres capacidades
permitidas.

#### Hallazgo nuevo que salió de analizar esto — S1.6 · reduced-motion solo cubre la mitad

`DESIGN.md` §25 declara `prefers-reduced-motion` como **"Implemented"** y enumera 18
clases CSS desactivadas o reducidas. Es cierto — **para las animaciones CSS**. Pero
`useReducedMotion` tiene **0 usos** en el proyecto, y la media query de CSS no detiene
animación manejada por JS: los 25 archivos con framer-motion (38 transiciones de
`AnimatePresence`, springs, drag) siguen animando aunque el usuario haya pedido menos
movimiento.

Es severidad S1: el doc afirma que la preferencia de accesibilidad está respetada y solo
lo está en uno de los dos sistemas de animación. **`useReducedMotion` pasa a ser
obligatorio en todo archivo que use framer-motion**, y entra en el gate de D0.

### 4.6 · Motion como eje del tema — **Liquid expresivo, Solid eficiente**

Decisión del usuario: la animación rica vive en Liquid Glass; Solid Modern es el tema
rápido. Es coherente con lo que Solid **ya es** (`--backdrop-*: none`, `--*-sheen:
transparent`) y con el precedente que ya existe en `index.css:596` — los blobs
ambientales ya están apagados en `solid`/`solid-dark`. Esto lo formaliza en vez de
dejarlo como excepción suelta.

**Con una condición: el corte es decorativo contra funcional, no "motion sí / motion no".**

| | Liquid / Liquid Dark | Solid / Solid Dark |
|---|---|---|
| **Decorativo** — orbes ambientales, barridos de shimmer, sheen, lifts de hover, entradas escalonadas, springs, glows pulsantes | Completo, es la identidad del tema | **Apagado** |
| **Funcional** — spinners, skeletons, entrada/salida de toast y modal, dirección del cambio de tab, feedback de escaneo del kiosco | Con spring y duración plena | **Se queda**, pero corto y lineal (~120–150ms, sin spring) |

Si Solid apagara también lo funcional se pierde la señal de que algo pasó: un modal que
aparece de golpe y un toast sin entrada no se leen como "rápido", se leen como roto. La
animación funcional comunica causa y presencia; ésa no es decoración.

**Implementación — un solo lugar, y de paso cierra S1.6.** El lado CSS es directo
(`[data-theme="solid"]`, ya hay precedente). framer-motion es JS y no lee CSS, así que
necesita un hook `useMotionConfig()` que derive los presets de transición de
`useTheme()` + `useReducedMotion()`. Ese hook responde las dos preguntas en el mismo
sitio — *¿es el tema eficiente?* y *¿el usuario pidió menos movimiento?* — con una regla
de precedencia clara: **la accesibilidad siempre gana sobre la estética**. Un usuario con
`prefers-reduced-motion` obtiene el mínimo en los cuatro temas.

Entra en D2 (definir el hook y el corte) y se aplica en D3 (adopción por componente).

### 4.5 · Orden — **D1 se adelanta**

Queda: **D0 → D1 → D2 → D3 → D4**. D0 sigue primero por costo/beneficio (medio día, y
sin él no hay forma de medir si D1 realmente cerró ni de evitar que vuelva a driftar),
pero el objetivo de la primera semana es que el modo oscuro deje de verse roto.

---

## 5. Registro de ejecución

### D0 — Tapar el hueco del gate · **CERRADA** (2026-07-26)

`scripts/design-gate.mjs` pasa de 6 a 11 categorías. Baseline real medido:

| Categoría | Hallazgos | Estado |
|---|---|---|
| `typography` | 4,490 | nueva (D0.2) — incluye 270 bajo el piso de 9px, con etiqueta propia |
| `white` | 1,094 | nueva (D0.1) — `bg/text/border-white` y `-black`, con y sin alpha |
| `z-index` | 552 | nueva (D0.3) — `z-[N]`, `z-N` y `zIndex:` inline |
| `hex` | 32 | ampliada (D0.4) — sale de `color` a categoría propia |
| `motion` | 30 | nueva (D0.5) — 5 decorativos + 25 sin `useReducedMotion` |
| `native`, `color`, `search-toggle`, `small-input`, `scale-tap`, `left-border` | 0 | siguen bloqueantes |

**Total: 6,198 hallazgos en 190 archivos** que el gate no veía ayer.

#### El gate funciona por ratchet, no por cero absoluto

Decisión tomada dentro de D0. Si las cinco categorías nuevas fallaran de una,
`npm run gate:design` quedaría rojo hasta terminar D3 — y un gate permanentemente rojo
no lo mira nadie, que es exactamente cómo se acumuló esta deuda. En su lugar:

- Baseline por categoría versionado en `scripts/design-gate-baseline.json`.
- **El gate falla si una categoría sube.** La deuda existente no bloquea; la deuda nueva sí.
- Al bajar deuda: `npm run gate:design -- --update-baseline` y se commitea el JSON.
  Nunca para tapar un hallazgo nuevo.
- Cuando una categoría llega a 0, queda bloqueante para siempre.

Verificado inyectando una violación temporal: el gate falló con
`typography SUBIÓ +1` / `z-index SUBIÓ +1`, y volvió a verde al revertirla. El detalle
se acota a los archivos modificados respecto a `HEAD` — sin ese filtro, un solo
`bg-white` nuevo imprimía los 1,094 hallazgos conocidos de la categoría.

`CLAUDE.md` actualizado: la regla decía "debe dar 0 hallazgos", que con el ratchet ya
no describe el contrato.

#### Excepciones agregadas (calibración, no deuda)

Al corregir `HEX_RE` aparecieron 93 hex que el regex viejo no podía ver por no tener
`className=` en la misma línea. Son hex por naturaleza de la tecnología, la misma
categoría "Mapas/canvas/PDF" que ya existía:

- `utils/pedidoPrint.js` (51) y `utils/conteoInventarioPrint.js` (38) — `docDefinition`
  de pdfmake, no CSS.
- `context/ThemeContext.jsx` (4) — `<meta name="theme-color">` necesita un color sólido
  y `--bg-page` es un gradiente, así que no se puede derivar del token.

#### Hallazgo nuevo encontrado durante D0 — **pendiente de decisión**

**N1 · Objetos de configuración migrados a medias.** En `tabminmax/constants.js` los
config de ABC/XYZ tienen el campo `cls` correctamente tokenizado por T7.1
(`bg-surface-card-hover`, `text-warning-text`, `text-danger-text`…) pero el campo
`color:` **del mismo objeto** quedó en hex crudo:

```js
C: { bg: 'bg-warning/10 text-warning-text border-warning/30', …, color: '#f59e0b' },
Z: { …, cls: 'text-danger-text bg-danger/10 border-danger/30', color: '#e11d48' },
```

T7.1 migró las clases Tailwind y no tocó los valores que se pasan a SVG/charts, así que
media configuración quedó tokenizada y media no. Es el mismo patrón que el semáforo
`--txvol-*` que se corrigió en v2.58.1 ("seguía duplicado a mano como hex crudo en 4
archivos productores + 1 consumidor").

Alcance: los 32 hex que quedan en el baseline, concentrados en
`tabminmax/constants.js` (10), `TabExpenses.jsx` (6), `EncuestaView.jsx` (4),
`CoverageBar.jsx` (4), `WidgetInventorySearch.jsx` (3) y 5 archivos con 1 cada uno.
Varios son duplicados exactos de tokens que ya existen — `#F79009` es `--warning`,
`#12B76A` es `--success`, `#0052CC` es `--brand`, `#64748b` es `--chart-8`.

**Decisión (2026-07-26): se agenda a D2**, donde ya se tocan los tokens y las escalas.
Queda registrado en el baseline, así que no puede crecer sin que el gate avise.

### D1 — Lo que rompe hoy · **CERRADA** (2026-07-26)

| Criterio | Antes | Ahora |
|---|---|---|
| Superficies blancas opacas en oscuro | 52 | **0** ✓ |
| Nodos de texto bajo AA | 166 | **0** ✓ |

Criterio de cierre cumplido exacto sobre las mismas 29 rutas, con el mismo script
(`docs/audits/diseno-2026-07-26/scan-contraste.mjs`).

- **D1.1** — `--brand-text` con variante oscura (`#60A5FA`, el `--chart-1-text` que esos
  temas ya usaban). 503 usos migrados en 106 archivos. De 2.85:1 a 7.35:1.
- **D1.2** — 543 `bg-white` migrados, clasificados por rol: 108 hover, 299 con borde,
  114 superficie suelta, 14 pills activas a `--surface-tab-active`. **18 perillas de
  switch sin tocar** — una perilla redonda absolutamente posicionada es blanca sobre su
  riel en los 4 temas, igual que en iOS. La última superficie blanca vivía en un `style`
  inline (`TabMinMax.jsx`), invisible para un gate que lee clases.
- **D1.3** — 270 usos bajo el piso legible subidos a 9px.
- **D1.4 / D1.5** — `RouteLoadingFallback` tokenizado; bootstrap de tema inline en
  `index.html`, verificado bloqueando el bundle JS.

#### Corrección al propio escáner

El primer conteo post-D1 daba 39 nodos bajo AA, 29 de ellos el banner de construcción
con un supuesto **1.1:1**. Era un falso positivo del escáner: las franjas del banner son
un `repeating-linear-gradient` (`backgroundImage`, sin `backgroundColor`), así que el
walk de ancestros lo atravesaba y medía su texto oscuro contra el fondo oscuro de la
página. Contra sus franjas reales mide **8.28:1 y 10.62:1** — de lo más legible del
portal. El escáner ahora devuelve "indeterminado" al toparse con un `backgroundImage` en
lugar de inventar un número.

#### Hueco del plan detectado (2026-07-26) — **D2.5 agregada**

A pedido del usuario se verificó si el plan garantizaba que los botones —y el resto de
elementos— quedaran estándar en color, forma y estilo. **No lo garantizaba.** Se agregó
la fase D2.5 con el inventario medido: 12 radios y 9 alturas distintas de botón, 12
radios y 11 alturas de badge. Ver la sección de la fase para el detalle.

#### Hallazgo nuevo — **N2 · texto blanco sobre los colores sólidos, pendiente de decisión**

Los 3 nodos que quedan no son residuos de D1: son instancias de un patrón sistémico que
la auditoría original no había aislado. **El texto blanco sobre los rellenos sólidos de
color falla AA casi en todos**, y como esos colores no cambian por tema, **falla también
en los temas claros** — no es un bug de modo oscuro.

| Fondo | Contraste con blanco | Usos con `text-white` |
|---|---|---|
| `bg-warning` `#F79009` | 2.35:1 ✗ | 31 |
| `bg-chart-7` `#eab308` | 1.92:1 ✗ | — |
| `bg-chart-5` `#06b6d4` | 2.43:1 ✗ | — |
| `bg-chart-9` `#14b8a6` | 2.49:1 ✗ | 9 |
| `bg-chart-2` `#10b981` | 2.54:1 ✗ | — |
| `bg-success` `#12B76A` | 2.62:1 ✗ | 56 |
| `bg-chart-4` `#f97316` | 2.80:1 ✗ | 2 |
| `bg-chart-6` `#ec4899` | 3.53:1 ✗ | 7 |
| `bg-chart-1` `#3b82f6` | 3.68:1 ✗ | 14 |
| `bg-danger` `#F04438` | 3.76:1 ✗ | 84 |
| `bg-chart-3` `#8b5cf6` | 4.23:1 ✗ | 29 |
| `bg-chart-8` `#64748b` | 4.76:1 ✓ | 18 |
| `bg-brand` `#0052CC` | 6.82:1 ✓ | — |

**232 usos que fallan.** El escáner solo vio 3 porque el resto vive en estados que no se
renderizan por defecto: modales cerrados, filtros sin tocar, badges condicionales.

El sistema ya tiene resuelto el caso *teñido* (`bg-success/10` + `text-success-text`, que
sí pasa). Lo que nunca se definió es el caso *relleno sólido*: qué color de fondo es
seguro cuando el texto encima es blanco. `--brand` y `--chart-8` lo son por casualidad,
no por diseño.

**Resuelto en la misma pasada (decisión del usuario).** 12 tokens `-solid` nuevos, el
gemelo exacto de los `--chart-N-text` que T7 creó para el problema inverso. Los valores
salen del shade 600/700 de la **misma familia Tailwind** que ya usa el proyecto, no
oscurecidos a ojo: el badge sigue leyéndose verde/rojo/ámbar, solo más saturado. Un
único valor para los 4 temas — el par relleno+blanco no depende del fondo de la página.

`--success-solid` #047857 (5.48:1) · `--danger-solid` #dc2626 (4.83) ·
`--warning-solid` #b45309 (5.02) · `--chart-1-solid` #2563eb (5.17) ·
`--chart-2-solid` #047857 · `--chart-3-solid` #7c3aed (5.70) ·
`--chart-4-solid` #c2410c · `--chart-5-solid` #0e7490 · `--chart-6-solid` #db2777 (4.60) ·
`--chart-7-solid` #a16207 · `--chart-8-solid` #64748b (ya pasaba, se nombra por simetría) ·
`--chart-9-solid` #0f766e.

**268 usos migrados en 84 archivos**, solo donde `text-white` aparece en el mismo
atributo `className` que el relleno.

---

## Anexo — Evidencia

- `docs/audits/diseno-2026-07-26/scan-dark.json` — resultado crudo del escáner (29 rutas).
- `docs/audits/diseno-2026-07-26/dark-*.png` — captura por ruta en tema oscuro.
- `docs/audits/diseno-2026-07-26/solid-dark-*.png`, `solid-*.png`, `liquid-*.png` — contraste entre temas.
- `docs/audits/diseno-2026-07-26/movil-dark-*.png` — 390×844 real.
- `docs/audits/diseno-2026-07-26/kiosk-1366x768.png`, `login.png`.
