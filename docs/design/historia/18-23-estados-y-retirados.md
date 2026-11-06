# Historia — §18 a §23 (estados de vista y secciones retiradas)

> Texto original de DESIGN.md §18–§23, movido aquí el 2026-11-06. §19 (stub), §22 (blindspots
> de tema oscuro, todos resueltos) y §23 (inconsistencias conocidas) se retiraron del documento.
> Varias afirmaciones de abajo ya son FALSAS y se conservan sólo como historia: `modal-glass-layer`
> no existe, `ConfirmModal`/`AlertModal` ya no tienen `z-[99999]` ni bloqueo de scroll propio,
> el sidebar NO es siempre oscuro (sigue el tema por `--sidebar-*`), y `framer-motion` se rige por
> la categoría `motion` del gate (AnimatePresence/layout/layoutId/drag permitidos).

### 18. Estados de vista — `StateViews`

> Reescrito el 2026-07-27 (D4). La versión anterior describía el patrón con
> clases sueltas (`w-16 h-16 rounded-[1.5rem] bg-white/50 …`) y por eso se
> reescribió a mano en cada vista. **Existe un componente desde hace tiempo y
> este documento no lo mencionaba** — así es como se acumuló la deuda.

Todo vive en `src/components/common/StateViews.jsx`.

#### 18.1 `EmptyState` — obligatorio donde puede haber cero datos

```jsx
import { EmptyState } from '@/components/common/StateViews';

<EmptyState
    icon={FolderOpen}
    title="Sin documentos aún"
    subtitle="Aquí aparecerán tus constancias y boletas."
    action={<Button icon={Plus} onClick={crear}>Subir el primero</Button>}
/>
```

| prop | para qué |
|---|---|
| `icon` · `title` · `subtitle` | el contenido |
| `action` | **la salida**. Sin esto es una pantalla muerta: el usuario ve que no hay nada y no sabe qué hacer. |
| `compact` | dentro de un panel o una tarjeta, no a página completa |
| `iconClass` · `glowClass` | color semántico cuando el vacío tiene un matiz (aviso, error) |

Distinguir **"no hay nada todavía"** de **"tu filtro no encontró nada"**: son
mensajes distintos y la salida también (crear el primero vs. limpiar el filtro).

`DataTable` tiene su propia prop `empty` para el vacío dentro de la tabla.

#### 18.2 `Skeleton` y `SkeletonText` — nunca un spinner de sección

```jsx
import { Skeleton, SkeletonText } from '@/components/common/StateViews';

<Skeleton w={48} h={48} rounded="1rem" />
<SkeletonText lines={2} />
```

**El spinner solo va dentro de un botón** mientras una acción está en curso
(`<Loader2 className="animate-spin" />`, y `Button` ya lo hace con `loading`).
Para una sección que está cargando va el esqueleto, que muestra la *forma* de lo
que viene en vez de un girito sin información.

`delayed` (activo por defecto) espera 250 ms antes de aparecer: sin eso, una
carga rápida produce un parpadeo peor que no mostrar nada.

`DataTable` acepta `loading` + `skeletonRows`.

#### 18.3 `LoadingState` y `AiThinkingState`

`LoadingState` cubre las tres escalas —`route`, `content`, `inline`— para cuando
todavía no se sabe la forma del contenido. `AiThinkingState` es el estado propio
de las vistas con resumen generado.

---

### 19. Loading & Skeleton States

Fusionado en **§18.2**. Se mantiene el número para no romper referencias
externas.

---

### 20. Scrollbar

Hidden everywhere. Authoritative definition in `src/index.css`:
```css
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
```
(Removed duplicate that was in `App.css`.)

Applied to: sidebar nav (`<nav>`), all `overflow-y-auto` containers, GlassViewLayout scroll container.

Never expose the browser scrollbar. If a custom scrollbar is ever needed, it must match the Liquid Glass aesthetic.

---

### 21. Platform & Native (Capacitor)

App ID: `lat.farmasalud.portal`. Web dir: `dist`. Capacitor v8.2.0.

Native-only plugins (no web bundle):
- `@capacitor/geolocation` v8.2.0 — foreground GPS
- `@capacitor-community/background-geolocation` v1.2.26 — background GPS

Both excluded from Vite bundling via `optimizeDeps.exclude` + `rollupOptions.external` in `vite.config.js`. All imports use `/* @vite-ignore */` dynamic import inside an `isNative` guard:

```js
if (isNative) {
  import(/* @vite-ignore */ '@capacitor/geolocation').then(m => { CapGeo = m.Geolocation; }).catch(() => {});
  import(/* @vite-ignore */ '@capacitor-community/background-geolocation').then(m => { BgGeo = m.BackgroundGeolocation; }).catch(() => {});
}
```

Platform detection: `isMobileOrApp()` in `src/utils/helpers.js` — checks `Capacitor.isNativePlatform()`, mobile UA, modern iPad. Gates camera, GPS, and touch-specific UI behaviors.

Before first APK build: update `versionCode` and `versionName` in `android/app/build.gradle`.

---

### 22. Known Dark Mode Blindspots — RESUELTO (verificado 2026-07-25)

Esta sección quedó completamente stale: los 7 puntos que listaba ya
estaban corregidos en el código (la migración real pasó, el doc nunca se
actualizó — el mismo patrón que motivó el gate mecánico de §6). Verificado
línea por línea contra el código actual el 2026-07-25:

| Componente | Estado real verificado |
|---|---|
| `LiquidModal` inner glass layer | Usa clase `modal-glass-layer`, color por tema definido en `index.css` (no hardcoded) |
| `DataTable` `useTokens()` | Devuelve tokens reactivos (`bg-brand/[0.04]`, `text-content-3`, etc.), container con `data-surface="card"` |
| `LiquidToast` | Solo lee `{isOpen,title,message,type,hideToast}` de `toastStore` — sin campo `theme`, 100% tokens |
| `LiquidSelect` | Sin prop `isDark`/`theme` en absoluto |
| `AlertModal` / `ConfirmModal` | Sin prop `theme`, sin `isDark` — 100% tokens (`text-danger`, `bg-brand`, `text-content-3`) |
| `ViewTabBar` pill | Usa `data-surface="tab-track"`, mapeado a `--surface-tab-track` por tema en `index.css` |
| `GlassViewLayout` body card | Ya usa `data-surface={transparentBody ? undefined : 'card'}` |

**En teléfono la card del cuerpo no va (2026-07-30).** Medida la cadena de anchos
en un iPhone de 320px, del viewport al primer texto se iban **92px (29%)** en
cromo anidado: `px-2` del shell, `px-2` del cuerpo, el borde de la card, el
padding de la vista y el de la tarjeta del contenido. Y esa card envuelve
contenido que casi siempre trae su propia card —las tarjetas por producto del
conteo, los widgets del Inicio—, o sea el doble borde y doble radio que este
documento ya llama "una isla dentro de otra isla".

Con mouse la card sí sirve: delimita el área de trabajo dentro de una pantalla
ancha. **En un teléfono la pantalla ES el área de trabajo.** Debajo de 768px el
cuerpo pierde la card y el gutter horizontal; de 768 para arriba no cambia nada
(verificado en 1440/900/768/767).

`data-surface` es un atributo, no una clase, así que no se apaga con un
breakpoint de Tailwind: la decisión pasa por `useMediaQuery`. Y tiene que ser el
atributo AUSENTE, no una clase que lo pise — el material de `data-surface` gana
la cascada contra cualquier clase equivalente (T2).


No queda ninguna acción pendiente de esta lista. Si aparece un blindspot
real nuevo, documentarlo aquí con fecha — no reabrir esta tabla completa
sin verificar cada punto contra el código primero.

---

### 23. Known Inconsistencies

1. **Framer-motion** — present in 14 files. Standard is CSS keyframes + Tailwind transitions. No new framer-motion usage. Existing usages are noted per-component above.

2. ~~Dark mode blindspots~~ — RESUELTO, ver §22.

3. ~~GlassViewLayout body card~~ — RESUELTO, ver §22 (ya usa `data-surface`).

4. **ConfirmModal / AlertModal scroll lock** — both have own `document.body.style.overflow = 'hidden'` logic separate from ModalShell's scroll lock. Two scroll-lock paths exist. Acceptable given their `z-[99999]` requirement but worth unifying.

5. **Sidebar always dark** — `data-surface="sidebar"` intentionally deviates from the theme system. The sidebar is always dark glass regardless of app theme. By design.

6. **Hardcoded `#0052CC`** — ACOTADO (2026-07-25): la duplicación real (el semáforo de volumen de transacciones — `DashboardView.jsx`×2, `SchedulesView.jsx`, `FormWfmAnalytics.jsx`, consumido por `ScheduleCalendar.jsx`) se migró a `var(--txvol-normal)` etc. Lo que queda crudo son casos ya cubiertos por la excepción de Recharts/canvas (`DashboardView.jsx` Area/gradient SVG, `TabExpenses.jsx` BarChart SVG) y por la excepción de `KpiCard` (`color` prop, string-concat de alpha) — ambas ya documentadas en §6, no son deuda nueva.

7. ~~Three validation error patterns coexist~~ — **RESUELTO 2026-07-25.** Resultó ser 2 problemas distintos, no 1 con 3 estilos: el badge "Requerido" (campo vacío) y el banner de error de envío/servidor nunca competían entre sí. Decisión (con mockup mostrado al usuario — badge vs asterisco sobre los mismos 3 campos reales): el badge se queda como estándar, ya no está deprecado (26+ campos reales vía `PortalInput.jsx`, a11y ya correcta). Lo único que sí era inconsistente — `FormSetPassword.jsx`/`LoginView.jsx` mostraban el error de envío como texto plano en vez del banner con caja+ícono de los otros 8 archivos — ya migrado. Ver §28 "Validation error standard".

---
