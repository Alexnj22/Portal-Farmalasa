# Buscadores — historia

> Historia de DESIGN.md §24. Copia fiel del texto que vivía en DESIGN.md hasta el 2026-11-06, cuando el documento se condensó: allá quedaron la regla, el canónico, un ejemplo corto y el gate; acá, las mediciones y los incidentes que explican por qué. Las citas a líneas de código y los números de sección son los de ESA época (la Voz era §26, hoy §34).

## 24. Search Patterns

Tres tipos de buscador en el Portal. Toda búsqueda debe mapearse a uno de estos — nunca crear un cuarto patrón.

---

### Tipo 1 — Header de vista (ViewTabBar)

**Dónde:** todas las vistas GlassViewLayout con tabs.

Cubierto en §14 ViewTabBar. El `searchTerm` vive en la vista y se pasa como prop a los tabs. Nunca agregar un input local dentro de un tab — el search siempre vive en el header.

---

### Tipo 2 — Inline / Widget (SearchInput)

**Dónde:** cards de dashboard, cuerpo de modales, RecepcionModal, widgets internos, y cualquier search fuera del header de vista.

**Componente:** `SearchInput` — `src/components/common/SearchInput.jsx`

**Visual spec:**
```
Input:  data-surface="input" (borde + fondo vidrio del tema activo)
        text-content placeholder:text-content-3
        focus:outline-solid focus:outline-1 focus:outline-offset-[-1px] focus:outline-brand/60
        — 1px, offset negativo = se dibuja EXACTO sobre el borde existente
          (mismo grosor), se ve como un simple cambio de color de borde,
          nunca como un ring/línea aparte
Ícono:  <Search> text-brand strokeWidth={2.5}  — izquierda
Clear:  <X>     hover:text-danger strokeWidth={2.5} — aparece solo cuando value truthy
```

**Foco — decisión 2026-07-26 (mockup aprobado, 4 opciones comparadas):** el estilo previo (`focus:outline focus:outline-2 focus:outline-offset-0`) dibujaba un outline de 2px por FUERA del borde de 1px ya existente — dos líneas concéntricas, se leía como una "línea interna" fea. La opción elegida (mockup "A": cambio de color de borde puro, sin ring/glow/lift) se implementa con `outline-solid outline-1 outline-offset-[-1px]` en vez de `border-*`: el input tiene `data-surface="input"`, y esa regla vive fuera de cualquier `@layer` de Tailwind (ver comentario en `src/utils/inputStyles.js:6-8`) — un unlayered `border` de stylesheet le gana SIEMPRE a un `focus:border-*` de Tailwind (capa `utilities`), sin importar especificidad. `outline` es una propiedad distinta que no compite por esa regla, y con offset `-1px`/ancho `1px` queda dibujado exactamente sobre el borde existente — visualmente idéntico a "cambiarle el color al borde", sin las dos líneas del bug original. Mismo criterio que `inputHoverClass` (`src/utils/inputStyles.js`), que ya usaba outline por la misma razón.

**Gotcha de Tailwind v4 encontrado al implementar esto:** `outline-none` fija la custom property compartida `--tw-outline-style: none`, y la utilidad simple `outline`/`outline-1` en foco solo LEE esa variable (`outline-style: var(--tw-outline-style)`) — no la sobreescribe. Como `.outline-none` no tiene pseudo-clase, sigue matcheando incluso con el input enfocado y su `--tw-outline-style: none` gana por especificidad, así que un `focus:outline` de foco quedaba con `outline-style: none` computado pese a tener color/ancho/offset seteados (verificado con `getComputedStyle` — el outline nunca se pintaba). Hace falta `focus:outline-solid` explícito, que sí escribe `--tw-outline-style: solid` con la especificidad de `:focus` y gana la cascada.

**Auditoría 2026-07-26 — mismo bug encontrado en `LiquidSelect` (Tipo 3, `serverSearch`):** el pill trigger (`src/components/common/LiquidSelect.jsx`, `pillBaseClasses`) también combinaba `outline-none` (unconditional) con `outline outline-2 outline-offset-0 outline-brand/30` (condicional a `isOpen`, sin `-solid`) — mismo gotcha, pero con el efecto opuesto al de `SearchInput`: en vez de verse feo, el anillo de foco simplemente **nunca se pintaba** (confirmado con `getComputedStyle`: `outlineStyle: "none"` estando abierto). Corregido con el mismo patrón (`outline-solid outline-1 outline-offset-[-1px] outline-brand/60`), verificado en vivo contra el picker de productos de `CotizacionesView` — ahora se ve un borde de acento limpio, sin doble línea. Afecta a los ~30 usos de `LiquidSelect` en el proyecto (cualquiera con `serverSearch`/combobox abierto, no bare). Fix aplicado con confirmación explícita del usuario por el cambio de comportamiento visual (algo que nunca se vio se vuelve visible en todos esos lugares).

**Cierre del gap — 2026-07-26, misma sesión:** los 5 buscadores hand-rolled detectados en la auditoría (`AnnouncementsView.jsx:687` picker de destinatarios, `RecepcionModal.jsx:909` buscador de producto extra, `RecepcionModal.jsx:1042` buscador de producto, `ScheduleCalendar.jsx:853` cobertura entre sucursales, `ItemSections.jsx:252` filtro por sección de ítems) se migraron a `SearchInput`, ninguno quedó pendiente. Ninguno tenía el bug de línea/ring roto, pero todos violaban "nunca `<input>` crudo para búsquedas" — no se dejaron como deuda.

Para poder migrarlos, `SearchInput.jsx` ganó 3 capacidades que antes le faltaban (todas necesarias por casos reales, no especulativas):
- **`ref` (forwardRef, vía `useImperativeHandle`)** — resuelve al `<input>` real. Necesario porque varios callers enfocan el buscador programáticamente desde un botón externo (`searchRef.current?.focus()` en `RecepcionModal`/`ItemSections` al togglear visibilidad).
- **`disabled`** — necesario en `AnnouncementsView` (picker deshabilitado mientras `isSubmitting`).
- **`onKeyDown`** (pass-through al input real) — necesario en `ItemSections` para cerrar el buscador con Escape.

Verificado en vivo con Playwright: `AnnouncementsView` (picker de destinatarios, tipeo + filtrado + botón "+" funcionando). Los otros 4 no se pudieron verificar con captura en vivo en esta sesión (requieren estado de datos — un pedido pendiente de recepción, o una semana de horario editable — que no existía en el entorno de prueba; no es un bug introducido, confirmado revisando que los archivos bloqueantes, ej. `TabPedidos.jsx`, no fueron tocados). Se verificaron por revisión de diff (props/refs cableados 1:1 con el original) + `eslint` limpio + `gate:design` en 0.

En la variante `expandable` abierta, el borde toma el `accentColor` del widget (o `--brand` si no se pasa uno) vía estado `isFocused` + `style` inline en el wrapper — un inline `style` sí gana sobre la regla unlayered de `data-surface="input"` (los estilos inline superan cualquier CSS de hoja de estilos, con o sin capas), así que ahí no hace falta el truco del outline; el color además es un hex dinámico que no puede resolverse con una clase Tailwind estática de todos modos.

**Sizes:**

| `size` | Altura | Usar en |
|--------|--------|---------|
| `"sm"` | ~32px | Cabecera compacta dentro de cards, listas picker |
| `"md"` | ~40px | Search principal de widget o modal |

**Uso mínimo:**
```jsx
import SearchInput from '../components/common/SearchInput';

<SearchInput
  value={search}
  onChange={setSearch}
  placeholder="Buscar producto..."
  size="sm"
/>
```

**Reglas:**
- Nunca usar `<input type="text">` crudo para búsquedas inline — siempre `SearchInput`.
- Siempre emparejar con `smartFilter` o `tokenMatch` (ver §24 Lógica de búsqueda).
- Siempre mostrar el banner fuzzy cuando `isFuzzy && searchTerm` (solo con `smartFilter`).

---

### Tipo 2b — Buscador expandible de widget (`SearchInput expandable`)

**Origen:** mockup aprobado 2026-07-25 para los 4 widgets de Operación del Dashboard (`WidgetInventorySearch`, `WidgetMinMaxRequest`, `WidgetAnnulmentRequest`, `WidgetSrsInventory`) — antes cada uno tenía su propio `<input>` a mano apilado sobre los filtros, compitiendo por el mismo ancho angosto de la card.

**Cuándo usar esto en vez de un `SearchInput` normal — no es una cuestión de espacio disponible, es de qué rol cumple el buscador ahí:**

| Contexto | Componente |
|---|---|
| El buscador es un **control aparte** dentro de un widget, modal o cuerpo de tab — no importa si sobra ancho o no | `SearchInput expandable` — **siempre arranca colapsado por defecto**, incluso con espacio de sobra. El espacio disponible no es el criterio. |
| El buscador vive **pegado a una lista de selección que ya está abierta en pantalla** (Tipo 3 — picker más abajo): la lista y el campo son una sola pieza, no un control que tenga sentido ocultar | `SearchInput` estático (`size="sm"`/`"md"`) |
| Filtra el **contenido principal de toda la vista** (la tabla/lista que el usuario vino a ver a esta página) | Buscador de `ViewTabBar` en el header (Tipo 1) — nunca un input local dentro de un tab |

Regla corta: si el buscador es un control que se puede mostrar/ocultar sin romper nada a su alrededor, arranca colapsado, punto — un modal ancho con espacio de sobra no es excusa para dejarlo abierto por defecto. Solo se muestra siempre abierto cuando el campo y la lista que filtra son la misma pieza visual (picker). Si filtra la vista entera, es del header.

**Comportamiento:**
- Arranca colapsado a un cuadrado de 32px (solo ícono) — no un input vacío ocupando ancho.
- Se abre **hacia la izquierda** al tocarlo (mismo espíritu que el buscador de `ViewTabBar`, adaptado a un espacio angosto) — el caller lo ubica DENTRO de una fila `flex items-center justify-end gap-1.5`, con los chips de filtro (`LiquidDatePicker`, `LiquidSelect`, etc.) DESPUÉS en el DOM, así quedan siempre anclados a la derecha y el buscador crece hacia el espacio vacío sin taparlos.
- Colapsa solo si está vacío y se hace click afuera — una búsqueda con texto se queda abierta hasta que el usuario la borra explícitamente (no perder el resultado por accidente).
- El ícono colapsado usa `accentColor` (hex de `CATEGORY_META` del widget — naranja `productos`, verde `ventas`, etc.), **nunca `bg-brand`/azul genérico** — se integra con el color de categoría que ya tiene el header de la card en vez de leerse como un botón de acción aparte.

**Uso mínimo:**
```jsx
<div className="flex items-center justify-end gap-1.5 shrink-0">
  <SearchInput expandable accentColor="var(--warning)" value={search} onChange={setSearch} placeholder="Buscar producto..." />
  {/* filtros después, si los hay — quedan a la derecha del buscador */}
</div>
```

---

### Tipo 3 — Picker / Selección

**Dónde:** selección de destinatarios (AnnouncementsView), selección de productos en modales.

| Tamaño lista | Componente | Patrón |
|---|---|---|
| > 100 ítems (DB) | `LiquidSelect` con `serverSearch={true}` + `onSearchChange` | `normSearch()` antes de enviar a `ilike` |
| ≤ 100 ítems (memoria) | `SearchInput size="sm"` al tope de `div` scrollable | Filtrar con `tokenMatch` client-side |

Nunca usar `<input>` crudo para pickers.

---

### Lógica de búsqueda estándar

Todas las búsquedas usan `src/utils/searchUtils.js`:

| Función | Usar cuando |
|---------|-------------|
| `normSearch(str)` | Normalizar antes de DB `ilike` — quita acentos, puntuación, lowercase |
| `tokenMatch(query, ...fields)` | Listas pequeñas en memoria (pickers, < 200 items) |
| `smartFilter(query, data, getFields)` | Cuerpos de tabs y widgets — incluye fallback fuzzy automático |

**Patrón two-pass con smartFilter:**
```js
const { results, isFuzzy } = !searchTerm.trim()
    ? { results: base, isFuzzy: false }
    : smartFilter(searchTerm, base, r => [r.campo1, r.campo2]);
```

**Banner fuzzy estándar** — inmediatamente antes de la tabla/lista, cuando `isFuzzy && searchTerm`:
```jsx
{isFuzzy && searchTerm && (
    <Notice variant="warning" icon={Search} className="mb-3">
        Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
    </Notice>
)}
```

> **Corregido el 2026-07-30.** Esta sección enseñaba el banner como un `<div>` a
> mano —`bg-warning/10 border border-warning/30 text-label text-warning
> font-semibold`— mientras §15.6 dice que un aviso inline con ícono **es**
> `Notice`, y usa esta misma frase como su ejemplo. El documento se contradecía, y
> el snippet de acá ganó: se copió en **15 vistas**, ninguna usaba `Notice`. Es el
> mismo modo de falla que el snippet de §16.2, que llegó a 9 copias — un doc
> desactualizado no es un doc incompleto, es un doc que **enseña la deuda**.
>
> Y el snippet traía un error propio: `text-warning`, que es el color de RELLENO.
> Sobre `bg-warning/10` da **2.16:1** — falla AA, que pide 4.5. `Notice` usa
> `text-warning-text` (5.98:1), y su propio comentario documenta esa medición.
> Curiosamente las 12 copias vivas escribieron `-text` por su cuenta: acá las
> vistas estaban mejor que el documento, y quien lo hubiera copiado tal cual
> habría publicado el fallo de contraste.
>
> Lo vigila la categoría **`aviso-a-mano`** del gate.

---

### Contrato de apertura/cierre — OBLIGATORIO en todo buscador toggleable

**Regla del usuario, 2026-07-26: "TODOS deben funcionar así siempre."** Aplica
a cualquier buscador que se puede mostrar/ocultar (Tipo 1 header, Tipo 2b
widget, o un toggle hand-rolled con su propio show/hide) — sin excepción,
sin ir caso por caso:

1. **Al abrir, foco automático** en el input (cada caller ya lo hacía con
   `autoFocus` o `inputRef.current?.focus()` tras el timeout de su propia
   animación de apertura — eso no cambia).
2. **Escape cierra Y limpia** — nunca solo una de las dos cosas.
3. **Click afuera cierra SOLO si está vacío** — con texto se queda abierto
   (no se pierde un resultado por accidente, mismo criterio que el
   buscador expandible de widget).

**Implementación:** hook compartido `useSearchToggle` en `src/plataforma/useSearchToggle.js`.

```jsx
import { useSearchToggle } from '../hooks/useSearchToggle';

const { containerProps } = useSearchToggle({
    active: isSearchMode,        // bool — el buscador está abierto
    value: searchTerm,           // string actual del input
    onClear: () => setSearchTerm(''),
    onClose: () => setIsSearchMode(false),
});

// spread en el contenedor que delimita "adentro" del buscador (incluye el
// botón que lo abre/cierra, así un click en ese botón nunca cuenta como
// "afuera" y dispara un doble toggle)
<div {...containerProps}>...</div>
```

**Gotcha de reglas de hooks:** varios componentes con esta necesidad tienen
`return` tempranos por pantalla/condición (`RecepcionModal` por
screen, `ItemSection` por `if (!count) return null`). El hook SIEMPRE debe
llamarse antes de esos returns — nunca después — o se salta en algunos
renders y rompe las reglas de hooks de React.

**Bug crítico real (2026-07-26, reportado por el usuario: "no funciona el
buscador" en Nómina y Plan de Vacaciones) — por qué es `containerProps`
(atributo data-*) y NO `containerRef` (ref de nodo DOM), como se implementó
originalmente:** `GlassViewLayout` renderiza `filtersContent` DOS VECES —
una copia desktop y una copia móvil, cada una oculta por CSS según
breakpoint pero AMBAS montadas en el DOM simultáneamente. Un `ref` es un
objeto con un solo `.current` — si la misma pieza de JSX (creada una vez en
el padre, con el ref ya adjunto) se monta dos veces, ambas copias comparten
el MISMO objeto ref, y solo la última en commitear se queda con `.current`.
Resultado: clickear DENTRO de la copia visible se comparaba contra
`containerRef.current`, que apuntaba a la copia OCULTA → se leía como
"click afuera" → cerraba el buscador antes de poder escribir la primera
letra. `ViewTabBar`/`SearchInput` nunca tuvieron este bug porque el hook se
llama DENTRO del componente reutilizable — cada copia montada crea su
propio ref interno, no uno compartido desde afuera. Fix: un atributo
`data-search-toggle-id` (vía `useId()`) en vez de un ref — ambas copias
montadas lo llevan por igual, y `e.target.closest(selector)` encuentra
cualquiera de las dos sin importar cuál se clickeó. Ver `src/plataforma/useSearchToggle.js`
para la implementación completa y el comentario in-line con el mismo
razonamiento.

**Migrado 2026-07-26, en dos pasadas** — la primera (8 archivos) se hizo
grepeando por placeholder de texto (`"Buscar..."`) y sampleando resultados
a mano; el usuario preguntó explícitamente si se había revisado archivo
por archivo, y la respuesta honesta fue no — un caso real
(`EmployeeDocumentsView.jsx`, `/my-documents`) quedó afuera pese a estar en
el mismo grep original. Segunda pasada: grep estructural por el NOMBRE del
state (`const [xSearchOpen/Mode/Active/Expanded, ...] = useState(false)`
en vez de por texto de placeholder) encontró **22 archivos reales en
total**, 14 más que la primera pasada.

Lista completa: `SearchInput` (`expandable`), `ViewTabBar` (Tipo 1
canónico — antes solo cerraba con el botón, sin Escape ni click-afuera),
`BranchesView`, `AnnouncementsView` (header), `PayrollView`, `RequestsView`,
`TabHistory`, `FacturacionView`, `ConteoInventarioView`, `RolesView`,
`PermissionsView`, `AuditView`, `StaffManagementView`, `VacationPlanView`,
`AttendanceMonitorView` (dos copias del mismo buscador — variante clara y
variante "dark concept" — mismo `containerProps` spreadeado en ambas, solo
una está montada a la vez, sin conflicto porque es un atributo data-*, no un
ref), `EmployeeDocumentsView`, `EmployeeAnnouncementsView`,
`ConteoDetailView`, `EmployeeDetailView` (`ausenciasSearchOpen`),
`TabExpediente` — estos eran duplicados hand-rolled del patrón de
`ViewTabBar`/`SearchInput expandable` con Escape parcial o nada; y
`RecepcionModal` (`showSearch`), `ScheduleCalendar` (`showCoverageSearch`),
`ItemSections` (`searchOpen`, ya tenía Escape+clear, le faltaba
click-afuera). Verificado en vivo con Playwright (tipeo, Escape,
click-afuera con y sin texto) en el widget Ajuste de Min/Max, en
`ViewTabBar`/Productos, y en `/my-documents`; el resto por revisión de
diff + eslint limpio + `gate:design` en 0.

**Gate automático (`npm run gate:design`), agregado en la misma sesión
para que esto no vuelva a pasar:** una tercera categoría de chequeo en
`scripts/design-gate.mjs` detecta cualquier `useState(false)` cuyo nombre
termina en `Search{Open,Mode,Active,Expanded,Visible}` o empieza con
`showSearch`, y falla si ese archivo no importa `useSearchToggle`. Es una
heurística de nombre (no un parser), documentada con su propio falso
positivo real encontrado al escribirla (`isSearching`/`productSearching` —
un flag de "estoy buscando ahora", no "el buscador está abierto" — el
regex exige el sufijo Open/Mode/Active/Expanded/Visible, no solo que el
nombre contenga "search", para no confundir los dos). Excepción
documentada: `AppLayout.jsx` (`searchOpen` del modal ⌘K — ya tiene su
propio Escape/click-en-backdrop vía el patrón de modal estándar, semántica
distinta a la de "no perder texto por accidente"). Cualquier buscador
toggleable nuevo que el gate no detecte porque su variable no contiene
"search" en el nombre es un hueco conocido de esta heurística, no un
`gate:design` en verde falso — si aparece uno así, agregar el nombre al
regex o una excepción documentada, no ignorarlo.

`LiquidSelect` (Tipo 3 combobox) ya tenía Escape+click-afuera propios desde
antes (2026-07-15, ver §25 ARIA) — cierra y limpia el filtro SIEMPRE al
click afuera, sin la excepción de "si tiene texto" — eso es intencional:
ahí el texto es un filtro de la lista abierta, no un resultado de búsqueda
que se pueda perder, así que no aplica el mismo criterio. No se tocó.

---
