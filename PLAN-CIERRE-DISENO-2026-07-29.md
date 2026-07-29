# Plan — cierre definitivo del sistema de diseño

**Origen:** los cuatro residuos que quedaron vivos después de cerrar D0–D4
(`docs/planes-cerrados/PLAN-DISENO-PENDIENTE.md`) y la auditoría de puntos
ciegos del gate (`PLAN-CORRECCION-AUDITORIA-2026-07-29.md`, v2.183–2.187).

**Regla de trabajo:** una fase no se cierra sin criterio verificable —el gate,
un conteo re-medido, o el navegador—. Un hallazgo nuevo se documenta siempre,
se resuelva o no. Al terminar, auditoría completa y confirmación.

---

## Estado de partida (medido el 2026-07-29, no arrastrado)

| | |
|---|---|
| `npm run gate:design` | verde · 22 de 23 categorías en **cero absoluto y bloqueantes** |
| única con ratchet | `input-a-mano` **4** en 3 archivos |
| D0–D4 | cerradas (2026-07-28) |
| P1/P2/P3 puntos ciegos | cerradas (v2.187.0) |

---

## F1 · Los tres modales fuera del canónico

**Lo que rompe hoy.** `MenuSearchModal`, `PromptModal` y `PhotoEditorModal`
construyen el modal a mano (`createPortal` + `fixed inset-0` + scroll lock
propio). Contra lo que da `ModalShell`:

| | `ModalShell` | los tres |
|---|---|---|
| `role="dialog"` | ✓ | **✗ ninguno** |
| `aria-modal="true"` | ✓ | **✗ ninguno** |
| Escape cierra | ✓ | solo `MenuSearchModal` |
| scroll lock con restauración | ✓ (guarda el valor previo) | pisan `''` |

Para un lector de pantalla ninguno de los tres es un diálogo: es contenido que
apareció al final del `<body>`. Y dos se cierran únicamente con el mouse.

**Trabajo:** los tres pasan a componerse sobre `ModalShell`, igual que
`AlertModal`. Lo que el canónico no cubra se le agrega al canónico, no inline
(regla de D3 ya establecida). Casos previstos:
- `MenuSearchModal` ancla arriba (`items-start pt-[10vh]`), no al centro.
- `PhotoEditorModal` no debe cerrarse con clic en el fondo mientras se recorta.
- `PromptModal` tiene un `<button>` crudo de confirmar → `Button loading`.

**Cierre:** los tres con `role="dialog"`, `aria-modal` y Escape, verificado en
vivo abriendo cada uno.

---

## F2 · El vidrio que el contrato Solid no apaga

Solid Modern promete **cero `backdrop-filter`**. La regla que lo aplica
(`index.css:1452`) exige **dos** subcadenas en la misma clase
(`bg-surface-*` Y `backdrop-blur`), así que solo alcanza a lo ya migrado.

Medido hoy: **66 con `bg-surface-*` (se apagan) · 82 sin él (siguen
difuminando en Solid)**. El doc de D3 los llamó «costo sin efecto»; es
incorrecto para los teñidos: `bg-danger/10` es translúcido, o sea que el blur
sí se ve. El contrato no se cumple en 82 lugares.

**Por qué el selector se acotó** (comentario en `index.css:1434`): un
`[class*="backdrop-blur"]` amplio mataba también el vidrio del sidebar y de
login. **Pero eso hoy se puede acotar mejor**: `LoginView` *quita*
`data-theme` y `TimeClockView` fuerza `dark`, así que **ninguno de los dos se
renderiza nunca bajo `[data-theme="solid"]`**. La única superficie bespoke que
sí vive dentro del tema es el **sidebar**.

**Trabajo:** invertir la regla — apagar `backdrop-blur` en Solid **por
defecto**, con exclusión explícita para el sidebar. Así el contrato se cumple
solo para todo lo que se escriba en el futuro, en vez de depender de que cada
autor combine las dos clases.

**Cierre:** 0 elementos con `backdrop-filter` computado ≠ `none` en Solid
fuera del sidebar, medido en el navegador (no por grep).

---

## F3 · `input-a-mano` a cero absoluto

Los 4 restantes, abiertos uno por uno:

| archivo | qué es |
|---|---|
| `LoginView.jsx:474` ×2 | login — superficie bespoke |
| `AuthPromptPanel.jsx:75` | kiosco — superficie bespoke |
| `MenuSearchModal.jsx:90` | campo del ⌘K — paleta de comandos |

Los tres primeros son la lista **CERRADA** de superficies bespoke de
DESIGN.md §25.4. El cuarto es un campo transparente sin caja dentro del
buscador: `PortalInput` le pondría marco y etiqueta, que es justo lo que una
paleta de comandos no lleva.

**Trabajo:** dejar de contarlos por número (ratchet) y pasarlos a **excepción
nombrada** en el gate —la lista de archivos bespoke, igual que `EXCEPTIONS`—,
con su porqué. La categoría queda en **0 y bloqueante**: un input nuevo fuera
de esos cuatro sitios falla el gate.

**Cierre:** `scripts/design-gate-baseline.json` sin categorías, y las 23
bloqueantes.

---

## F4 · A1 · la densidad no comprime filas en escritorio

`h-[var(--row-h)]` en un `<td>` es **mínimo, no máximo** (así lo define CSS
para celdas), y el contenido —avatar de 36px + dos líneas— lo excede. La
celda se queda en ~45px aunque `--row-h` baje a 32 en `ultra`.

**Trabajo:** medir en vivo a viewport `ultra` qué celdas exceden y por qué;
después decidir entre (a) hacer que la anatomía de la fila responda a la
densidad dentro del canónico, o (b) documentar el límite y corregir el
contrato del token, si resulta que lo que sobra es contenido legítimo.
No se decide antes de medir.

**Cierre:** o las filas comprimen, o `--row-h` dice en el doc lo que
realmente hace y el hallazgo deja de estar abierto.

---

## F5 · Los 224 targets táctiles

Medidos en WebKit iPhone sobre 33 rutas. El grueso son barras de gráfico
clickeables y celdas de grilla densa, donde 44px es incorrecto —WCAG 2.5.5
(AAA) tiene excepción explícita para presentación esencial, y 2.5.8 (AA,
24×24) ya se cumple—.

**Trabajo:** volver a medir, clasificar cada uno en (1) corregible sin dañar
el diseño → se corrige, (2) presentación esencial → excepción documentada.
Lo que no caiga en ninguna de las dos es deuda real y se corrige.

**Cierre:** cada uno de los 224 en una de las dos listas, ninguno sin
clasificar.

---

## F6 · Auditoría final

1. `npm run build` · `npx eslint src/` · `npm run gate:design` ·
   `npm run gate:doc` · `npm run gate:version`
2. Escáner de contraste (`docs/audits/diseno-2026-07-26/scan-contraste.mjs`)
   sobre las rutas reales: criterio 0 superficies blancas / 0 nodos bajo AA,
   igual que el cierre de D1.
3. Barrido en vivo en los **4 temas** + móvil WebKit.
4. Confirmación al usuario con los números re-medidos.

---

# Registro de ejecución (2026-07-29)

## F0 · El hallazgo que no estaba en el plan: 223 animaciones muertas

Apareció al abrir `ModalShell` para F1. `animate-in fade-in zoom-in-95` es
sintaxis del plugin **`tailwindcss-animate` (Tailwind v3), que nunca estuvo
instalado** — `index.css` solo hacía `@import "tailwindcss"`, y v4 no trae esas
utilidades de core. Verificado contra el bundle, que es la única prueba válida:

| clase | en el bundle (antes) |
|---|---|
| `duration-500`, `animate-pulse`, `rounded-btn` | ✓ existen |
| `animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-*`, `animate-out` | **0** |

**223 bloques en 73 archivos**, incluidos los dos canónicos de modal. Todo
modal, dropdown y panel del portal aparecía de golpe — justo lo que D2.4
declara movimiento funcional que se queda.

Resuelto instalando `tw-animate-css` (sucesor del plugin para v4, CSS puro,
mismo API): **no hubo que tocar un solo JSX**, y la duración sale del
`duration-*` que ya estaba escrito al lado. Atado a los **dos** gates:

| | animaciones corriendo en `/ventas` |
|---|---|
| liquid, normal | 105 (6 con geometría) |
| solid, normal | **12** — el tema rápido se nota |
| liquid, `reduce` | **0** |
| solid, `reduce` | **0** |

## F1 · Los tres modales · cerrado

`MenuSearchModal`, `PromptModal` y `PhotoEditorModal` pasan a componerse sobre
`ModalShell`. Verificado en vivo el ⌘K: `role="dialog"` · `aria-modal="true"` ·
`aria-label="Buscar en el portal"` · Escape cierra · foco en el campo · la
animación `enter` corriendo de verdad. Consola sin errores.

Al canónico le faltaban tres cosas, y se le agregaron a él, no inline:
`align="top"` (una paleta de comandos ancla arriba), `closeOnBackdrop={false}`
(un clic afuera durante un recorte tiraba el trabajo sin preguntar) y
`surface`/`panelClassName` (el ⌘K es material `dropdown`, no `modal`; sin esto
quedaban dos vidrios apilados). Y **le faltaba la salida animada**: entraba pero
desaparecía de golpe, así que migrar los dos que sí la tenían habría sido una
regresión. Ahora `ModalShell` mantiene el panel montado 180ms para animarla.

## F2 · El contrato Solid · cerrado

La regla exigía `bg-surface-*` **y** `backdrop-blur` en la misma clase, así que
solo alcanzaba a lo ya migrado: 66 apagados, **82 siguiendo con vidrio**. Se
invierte — se apaga por defecto y la excepción es explícita
(`data-bespoke-glass` en el `<aside>` y en el flyout, que en el DOM cuelga
fuera de él). Login y kiosco no la necesitan: uno **quita** `data-theme` y el
otro fuerza `dark`, así que nunca se pintan bajo solid.

Medido en el navegador, no por grep: **0 elementos con `backdrop-filter` vivo
fuera del sidebar**, en `solid` y `solid-dark`, sobre 5 rutas.

## F3 · `input-a-mano` en cero · cerrado

Los 4 restantes pasan de ratchet a **excepción nombrada**: 3 son superficies
bespoke (§25.4, lista cerrada) y el cuarto es el campo del ⌘K. El baseline
queda **vacío** y todas las categorías bloqueantes.

**Y el gate tenía un agujero propio:** `EXCEPTIONS` es un objeto literal, así
que repetir una clave hace que la segunda pise a la primera **en silencio**. Me
mordió al agregar las excepciones (LoginView y AuthPromptPanel ya figuraban más
abajo) y al buscarlo aparecieron **4 duplicados que ya existían** — 4
excepciones que llevaban tiempo sin aplicarse. Ahora lo verifica
`assertSinClavesDuplicadas`, que lee el propio fuente porque para cuando el
objeto existe la información ya se perdió.

## F4 · A1, la densidad y las filas · cerrado

El hallazgo estaba mal enunciado. Medido con datos reales a 1100px
(`--row-h: 32px`), la densidad **sí** comprime; lo que no comprime es una celda
que apila dos o tres datos, y no puede: el `height` de un `<td>` es un mínimo
por spec.

| ruta | antes | después |
|---|---|---|
| `/compras` | 32px (exceso 0) | 32px |
| `/proveedores` | 34px (2) | 33px |
| `/ventas` | 52px (**20**) | **42px** (10) |
| `/pedidos` | 71px (**39**) | **41px** (9) |
| `/facturas-compra` | 48px (16) | 48px (16) |

Dos causas, dos arreglos:
1. **Interlineado de lectura en modo denso.** La celda hereda 1.5 y desperdicia
   ~6px por línea apilada. La densidad ahora aprieta a 1.35 / 1.2 vía
   `td[data-cell]`. No se oculta ni un dato.
2. **`<td>` escritos a mano dentro de un `<DataRow>`** — traen su propio
   `py-3` y saltean el canónico entero. Eran **5**, todos en `TabGenerar.jsx`.
   Migrados a `DataCell`.

Categoría nueva del gate: **`celda-a-mano`**, bloqueante en cero, y
deliberadamente estrecha (solo dentro de `<DataRow>`). Contar "todos los `<td>`"
habría dado 229 y mandado a migrar plantillas de impresión y calendarios que
están bien; contar por estructura dio 5. Probada con una fixture antes de
darla por buena: una regla que no dispara es peor que no tenerla.

## F5 · Los targets táctiles · cerrado

**De "224 sin clasificar" a 989 controles medidos y 7 con motivo escrito.**
El grueso de los 224 no eran targets: 50 chevrons `aria-hidden` que duplican
una fila ya clicable, 26 inputs `sr-only` cuyo target es su etiqueta visible, y
botones de 44px declarados que el rect reportaba en 42 por un `scale` de
ancestro. Detalle y criterio en DESIGN.md §25.9.

Deuda real corregida: `SegmentedControl` y `LiquidSelect` (alturas fijas por
debajo del piso del dedo — los dos son canónicos, así que se arregló para todo
el portal), `PeriodStepper`, los botones de `/branches` y el chip de tres
segmentos de `/facturacion`.

Los 7 que quedan son las barras del gráfico de ventas: ahí el ancho **es** el
dato, WCAG 2.5.5 tiene excepción para presentación esencial y 2.5.8 (AA) se
cumple.
