# Historia — temas y tokens (§2–§3)

Narrativa y mediciones que antes vivían en `DESIGN.md` §2–§3. Las reglas siguen allá; esto es el porqué. Los valores citados son los de su fecha: la fuente de verdad es `src/index.css`.

## Encabezado de la v2.0 (2026-07-24)

> **v2.0 — 2026-07-24** — refleja el cierre de T7 (`AUDITORIA-TEMA-2026-07.md`):
> color 100% tokenizado (T7.1, 119 archivos), sombras consolidadas al 56%
> en 19 tokens canónicos (T7.3), matriz de QA de 4 temas verificada (T7.2).
> Decisión sobre Liquid Glass ya tomada (T7.5): se mantienen los 4 temas,
> reestructurados como 2 ejes (Estilo/Modo) en `ThemeToggle` — ver §2.

## Por qué existe el contrato Liquid / Solid (2026-07-27)

No son dos paletas del mismo diseño. Son **dos materiales**, y la diferencia
tiene que verse en cinco ejes. Escrito acá porque al medirlo el 2026-07-27
resultó que **75 de los 93 tokens de sombra/brillo eran idénticos entre los
dos**: Solid solo apagaba animaciones y blur, y seguía pintando halos de 40px y
`inset 0 1px 0 rgba(255,255,255,.85)` — un brillo blanco interior, que es
literalmente el artefacto que hace que algo lea como vidrio.

Los 176 lifts escritos a mano se neutralizan con una regla de tema (`index.css`), pero eso es un parche: el canónico de la tarjeta estaba clavado en `-2px` y por eso se levantaba también en Solid hasta el 2026-08-01.

## Escala canónica de sombras (Fase T7.3, 2026-07-24)

Antes de T7.3, cada vista escribía su propio `shadow-[0_Npx_Mpx_rgba(...)]`
a mano — auditoría encontró **974 usos, 556 valores únicos** sin ningún
sistema detrás (el mismo problema que T7.1 resolvió para color). Estos 14
tokens (+5 agregados en la 2ª pasada para glows categóricos) reemplazan la
fragmentación real — **542 de 967 usos (56%) ya migrados**. Deliberadamente
NO usan el namespace `--shadow-*` de `@theme` (ese lo ocupa Tailwind para
generar `shadow-sm`/`md`/`lg` nativos — 960 usos sanos que no se tocan) —
se consumen vía arbitrary value: `className="shadow-[var(--shadow-elevation-md)]"`.

Valores de julio (hoy cambiaron: la escala `--shadow-glass-1…5` perdió el realce blanco en Liquid oscuro, ver `index.css` §1.7.bis):

```
/* Elevación neutra — reemplaza ~295 usos de sombra negra pura */
--shadow-elevation-xs: 0 2px 8px rgba(0,0,0,.04)    /* reposo: fila, chip */
--shadow-elevation-sm: 0 4px 16px rgba(0,0,0,.06)   /* tarjeta pequeña */
--shadow-elevation-md: 0 8px 28px rgba(0,0,0,.08)   /* tarjeta / hover, la más común */
--shadow-elevation-lg: 0 16px 48px rgba(0,0,0,.12)  /* panel flotante, dropdown */
--shadow-elevation-xl: 0 24px 64px rgba(0,0,0,.16)  /* modal, overlay principal */

/* Glass compound (inset claro + sombra exterior) — ~72 usos */
--shadow-glass-sm: inset 0 1px 0 rgba(255,255,255,.9), 0 2px 10px rgba(0,0,0,.06)
--shadow-glass-md: inset 0 2px 10px rgba(255,255,255,.4), 0 8px 24px rgba(0,0,0,.08)
--shadow-glass-lg: inset 0 2px 15px rgba(255,255,255,.7), 0 8px 30px rgba(0,0,0,.04)

/* Glow de marca + severidad (hover/focus) — ~208 + ~141 usos */
--shadow-glow-brand:   0 6px 20px rgba(0,82,204,.4)
--shadow-glow-success: 0 4px 15px rgba(18,183,106,.35)
--shadow-glow-warning: 0 4px 15px rgba(247,144,9,.35)
--shadow-glow-danger:  0 4px 15px rgba(240,68,56,.35)
--shadow-ring-brand:   0 0 0 4px rgba(0,82,204,.15)

/* Glow de acento categórico — mismo patrón, agregado en la 2ª pasada
   de T7.3 al descubrir que existían glows de chart-N no cubiertos por
   el mockup original (violeta/naranja/azul/dorado/pizarra) */
--shadow-glow-chart-1: 0 4px 15px rgba(59,130,246,.35)  /* azul */
--shadow-glow-chart-3: 0 4px 15px rgba(139,92,246,.35)  /* violeta */
--shadow-glow-chart-4: 0 4px 15px rgba(249,115,22,.35)  /* naranja */
--shadow-glow-chart-7: 0 4px 15px rgba(234,179,8,.35)   /* dorado */
--shadow-glow-chart-8: 0 4px 15px rgba(100,116,139,.3)  /* pizarra */
```

**Qué queda sin tocar (~426 usos, decisión deliberada):** shadows de
**varias capas combinadas** (p.ej. un anillo de foco + glow + highlight de
glass en una sola declaración con 3-4 grupos separados por coma). Forzar
esos a un solo token aplanaría una composición que hoy tiene más de una
intención visual superpuesta — eso es rediseño, no consolidación de
duplicados, y no estaba dentro del alcance aprobado. Mismo criterio que el
resto de excepciones documentadas en este archivo: no mecanizar lo que
requiere criterio caso por caso.

Remedido el 2026-11-06: quedan unas 8 sombras literales en `src/` (6 `shadow-[…]` + 2 `boxShadow` inline).

## Migración de color (T7.1)

Migración cerrada: **119 archivos, ~1,400+ usos de color crudo (`bg-emerald-500`, `text-red-600`, etc.) reemplazados** por `bg-success`/`text-warning-text`/etc. — ya no hay una fase "pendiente", esto es el estado real del código. Ver §6 (Color System) para la regla de 3 buckets que gobernó la migración y las excepciones documentadas.

## La paleta categórica original de 9 tonos (T7.1)

Hoy consolidada a 5 (ver `DESIGN.md` §6.0). Valores de julio:

```
--chart-1: #3b82f6  --chart-1-text: #1d4ed8  /* azul */
--chart-2: #10b981  --chart-2-text: #047857  /* esmeralda */
--chart-3: #8b5cf6  --chart-3-text: #6d28d9  /* violeta */
--chart-4: #f97316  --chart-4-text: #c2410c  /* naranja */
--chart-5: #06b6d4  --chart-5-text: #0e7490  /* cian */
--chart-6: #ec4899  --chart-6-text: #be185d  /* rosa */
--chart-7: #eab308  --chart-7-text: #854d0e  /* dorado, T7.1 */
--chart-8: #64748b  --chart-8-text: #334155  /* pizarra, T7.1 */
--chart-9: #14b8a6  --chart-9-text: #0f766e  /* teal, T7.1 — RequestsView necesitaba 9 categorías reales */
```

## Excepciones de color — la lista por archivo, tal como se decidió

La fuente de verdad es `EXCEPTIONS` en `scripts/design-gate.mjs`; esta lista es la de julio–agosto.

**Excepciones documentadas** (no se tokenizan, no son "color suelto sin
revisar" — fueron evaluadas y decididas explícitamente):
- **Superficies fijas-oscuras** (sidebar de AppLayout, paneles de kiosco,
  tooltips flotantes con `bg-slate-900/95`, el wallboard `isDarkConcept`
  de `AttendanceMonitorView.jsx`): usan la variante **base** de los tokens
  (`text-success`, no `text-success-text`) porque no seguían el tema activo
  — usar la variante `-text` ahí perdería contraste si el tema real fuera
  claro.
- **Shimmer decorativo de IA** (gradiente `indigo→purple→cyan`, idéntico en
  6+ archivos: `TabStaff.jsx`, `TabHistory.jsx`, `BranchesView.jsx`,
  `TabExpediente.jsx`, `FormAiSchedulerPreview.jsx`): es una identidad
  visual ya estandarizada por repetición exacta, no una duplicación por
  resolver.
- **`KpiCard`** (`color + '18'` string-concat para alpha): limitación
  técnica, no puede usar `var()` en ese contexto.
- **Leaflet/Google Maps markers, Recharts/canvas, plantillas de impresión
  PDF** (`CotizacionesView.jsx`, `PayrollView.jsx`, `CrearRutaModal.jsx`,
  `RutaMapModal.jsx`, props SVG de Recharts en `DashboardView.jsx`/
  `TabExpenses.jsx` — `stopColor`/`stroke`/`fill`/`tick`): colores hex
  directos, fuera del sistema de tokens CSS por naturaleza de la
  tecnología. **Excepción — no exención**: si el hex duplica un valor que
  YA tiene token (ej. el semáforo de volumen de transacciones), sigue
  debiendo consumir el token vía `var(--token)` como string — ver el caso
  de `DashboardView.jsx`/`SchedulesView.jsx`/`FormWfmAnalytics.jsx`/
  `ScheduleCalendar.jsx` corregido 2026-07-25 (5 archivos duplicaban
  `--txvol-*` a mano, sin sincronía si el token cambiaba).
- **Tooltips flotantes dark** (mismo patrón que el punto anterior, ahora
  con la lista completa de archivos): `FormWfmAnalytics.jsx`,
  `FormEditPayrollEntry.jsx`, `SidebarSyncStatus.jsx`,
  `LifecycleTimeline.jsx`, `ScheduleChart.jsx`, `EmployeeDetailView.jsx`,
  `AttendanceAuditView.jsx`, `VentasView.jsx`, `VacationPlanView.jsx`,
  `StaffManagementView.jsx`, `DashboardView.jsx` — solo la franja
  `bg-slate-800/900/950` + `text-white` del tooltip en sí, el resto de
  cada archivo SÍ está tokenizado.
- **Caja de IA siempre-oscura** (mismo criterio que el shimmer): `SalyCopilot.jsx`,
  `TabShifts.jsx`.
- **Superficies kiosco/cámara/editor** (pantallas que fuerzan
  `data-theme="dark"` en `<html>` mientras están montadas, o que son
  herramientas técnicas — canvas, video — donde el fondo oscuro no es
  negociable): `KioskConfigModal.jsx`, `FeedbackOverlay.jsx`,
  `PhotoEditorModal.jsx`, `LoginView.jsx` (solo el scanner de cámara + el
  fondo splash bespoke, comparte gradiente con `App.jsx`). `TimeClockView.jsx`
  ya NO cuenta como excepción de fondo/blobs (2026-07-25: migrado a
  `bg-surface-page` + los 5 blobs verde/magenta de `AppLayout.jsx`, mismos
  tokens que el resto del proyecto) — la excepción restante solo cubre los 3
  micro-acentos azules bespoke de la card del reloj (`from-blue-950/[0.30]`,
  `from-blue-400/[0.04]`, `via-blue-400/12`), un hero accent deliberado.
- **`ThemeToggle.jsx`** variante `dark`: documentado inline en el propio
  archivo — vivía dentro de un host siempre-oscuro (`SidebarSettingsMenu`).
  **Desactualizado desde 2026-08-05**: el sidebar dejó de ser siempre-oscuro y
  sigue al tema (PLAN-MATERIALES §12.1). Sus `bg-white/N` pasaron a
  `rgb(var(--sidebar-ink)/N)`, que conserva la alfa exacta y sólo invierte la
  base — en los temas oscuros la tinta vale `255 255 255`, o sea idéntico a lo
  que había.
- **Ilustraciones/branding de terceros**: `FormAuditDetail.jsx` (semáforo
  real de ventana macOS — colores exactos de Apple), `AccessDeniedView.jsx`
  / `NoAccessView.jsx` (verde real de marca WhatsApp `#25D366`),
  `ThemeMigrationRibbon.jsx` (franja rayada ámbar/naranja bespoke, texto
  fijo, no reactiva al tema).
- **Vistas de diagnóstico/QA** (no son UI real de negocio, mismo criterio
  que el archivo de preview): `RawTestView.jsx`, `IOSTestView.jsx`.

## Por qué existe el gate (2026-07-25) y por qué vigila la firma de los canónicos

Todo lo anterior (T7.1 + T7.1c + esta pasada) se auditó a mano con regex de
una sola sesión que luego se perdían — la razón real por la que
`border-slate-*`, `ring-*`/`via-*`, y toda la paleta cromática (purple/
green/orange/pink/blue/etc., no solo grises) se filtraron sin detectar
durante meses (ver `feedback_shadow_color_gate_lessons` y este mismo
hallazgo repetido). Ahora existe un script versionado que corre las DOS
familias de chequeo (nativo + color) sobre TODO `src/`, no solo un
grep ad-hoc de la sesión:


**El gate también vigila que el canónico se use con SU firma (2026-08-14).**
La categoría `prop-inexistente` compara los props que recibe cada componente de
`components/common/` contra los que su firma destructura de verdad. Existe
porque **React no valida props: uno con el nombre equivocado se ignora en
silencio** — `EmptyState` con `message`/`subtext` (espera `title`/`subtitle`)
pintaba el ícono y cero texto, en dos pantallas, sin error y sin que nada lo
viera. El barrido del día que se agregó encontró otros 29: `LiquidDatePicker`
recibía `placeholder` en 28 sitios sin aceptarlo, y un `ConfirmModal` pasaba
`hideCancel`, o sea que el diálogo de «Entendido» venía con un «Cancelar» de
regalo. La firma se lee del componente, nunca de una tabla a mano; un
componente con `...rest` queda fuera del chequeo.

`monto-nativo` (2026-08-19) cubre §15.11.1: un campo de DINERO con
`type="number"`. Nace en cero y es bloqueante. Reconoce el dinero por señales
duras —`prefix="$"`, `icon={DollarSign}`, `placeholder="0.00"`, o un
`name`/`label` del vocabulario del dinero— y borra las interpolaciones antes de
mirar: sin eso, un `aria-label={\`Cantidad de ${x}\`}` traía un `$` que no era de
plata y la regla marcaba justo los campos de cantidad que tiene que dejar en paz.

Su hermana `segmentado-a-mano` cubre §15.3: un `.map()` de opciones cuyo
`<Button>` decide su `variant`/`tone` comparando contra el parámetro del map es
un `SegmentedControl` escrito a mano. Un botón suelto que cambia de tono según
la acción **no** lo es, y por eso el detector mira el parámetro y no el `===`.

## Refinamiento Solid y contraste AA (Fase T2)

### 3.2 Fase T2 — refinamiento "Solid Modern" + contrato de tema ampliado

- **`solid`/`solid-dark` refinados** por spec §7: `--bg-page` con tinte frío
  hacia el brand (`#f4f6fb` en light), radios `--card-radius`/`--modal-radius`
  ajustados a 12px/16px (antes 14px/20px).
- **Ramps de estado** (`--brand-hover/-pressed`, `--success/-warning/-danger-
  hover/-pressed`, `--state-selected-overlay`, `--state-disabled-opacity`):
  derivadas de valores ya usados en el código (brand-hover = brand-dark ya
  era el hover real; success/warning/danger toman el siguiente escalón
  Tailwind 600/700). `--state-selected-overlay` es la única decisión
  genuinamente nueva (no derivada) — revisar en el gate.
- **Escala de elevación** `--elevation-0..3`: nombra `--card-shadow`/`--modal-
  shadow` existentes como niveles 1/2, agrega nivel 3 (flyouts sobre modales).
- **Script de contraste AA** (`scripts/tema/contrast-check.mjs`,
  JS puro sin dependencias): corrigió un fallo real encontrado en Fase T2 —
  `--text-tertiary` en `solid` (`#94a3b8`, 2.56:1) y `solid-dark`
  (`rgba(100,116,139,.9)`, 2.76:1) no cumplían AA contra `surface-card`
  opaco; corregidos a `#64748b`/`rgba(148,163,184,.9)` (4.76:1/4.92:1).
  **2026-07-25 — segunda vuelta real:** el script mismo tenía un hueco
  metodológico — trataba `content-3` como "siempre texto grande" (umbral
  3:1) sin verificar que en la práctica se usa en badges/labels de 9-11px,
  que NO califican para la excepción de texto grande de WCAG (requiere
  18px+, o ~19px+ en negrita). Con el umbral real (4.5:1), `liquid`
  (`#64748b`, 3.80:1) y `dark` (`rgba(255,255,255,.42)`, 4.00:1) fallaban
  — nadie los había revisado porque `solid`/`solid-dark` fueron los únicos
  "fallos" que el script marcó en su momento. Corregidos a `#526279`
  (4.96:1) y `rgba(255,255,255,.50)` (5.14:1) respectivamente. Los 4 temas
  cumplen AA_NORMAL real para las 3 variantes de texto — ver mockup
  aprobado por el usuario antes de aplicar (cambia el tono de TODO lo que
  use `text-content-3`, token global).
- **Blobs ambient apagados** en `solid`/`solid-dark` (`display:none` sobre
  `.animate-ambient-drift*`) — cero composición GPU constante, cumple §7.2.
- **Densidad adaptativa** — ver tabla completa en §32.
