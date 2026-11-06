# §12 Íconos — historia de las mediciones

## Un concepto, un ícono (F5, 2026-07-29)

La sección fijaba la librería y los tamaños, pero nunca qué ícono significa qué.
Medido: `Editar` se dibujaba con cuatro íconos (`Edit3` 32 · `Pencil` 21 ·
`Edit2` 10 · `Edit` 3) y `Confirmar` con cuatro (`CheckCircle2` · `Check` ·
`CheckCircle` · `CheckCheck`). Y no era sólo el nombre: los cuatro "lápices"
son cuatro dibujos distintos.

| Import | Glifo real | Qué se ve |
|---|---|---|
| `Edit` | `SquarePen` | lápiz dentro de una caja |
| `Edit2` | `Pen` | pluma sin punta |
| `Edit3` | `PenLine` | pluma con subrayado |
| `Pencil` | `Pencil` | lápiz con punta |

`CheckCircle` es `CircleCheckBig` (círculo abierto, la marca se desborda) y
`CheckCircle2` es `CircleCheck` (círculo cerrado). La deriva era de dibujo, no
de nomenclatura. `CheckCheck` tenía 3 usos, todos la marca simple. `XCircle`
figuraba como segundo ícono de "eliminar" y no lo era en ningún sitio: sus 14
usos eran cancelar, invalidar, revocar y "poner 0".

## La rampa (F4, 2026-07-29)

La versión anterior decía "1,287 íconos, 33 tamaños". Estaba mal: contaba props
`size` de componentes que no son íconos (`<VendorAvatar size={5}>` es una clave
de escala; `<PersonAvatar size={34}>` tampoco es un ícono). Contando sólo
`lucide-react`: **1,249 íconos, 24 tamaños**. `9` (61 usos) y `15` (55) entraron
a la rampa; `56` salió (cero usos).

## El trazo

`strokeWidth` tenía 14 valores distintos y el doc declaraba `1.5` como default.
La medición:

| tamaño | trazos en uso | dominante |
|---|---|---|
| 8-14 | 1.5(2) · 2(57) · **2.5(197)** · 3(57) | `2.5` |
| 15-20 | 1.5(12) · 2(31) · **2.5(146)** · 3(5) | `2.5` |
| 21-28 | **1.5(14)** · 2(15) · 2.5(28) | transición |
| 29-48 | 1(1) · **1.5(21)** · 2(16) | `1.5` |
| ≥49 | 0.5 · 1 · 1.5 | fino |

## Arriba de 48px

La sección anterior decía "tres marcas de agua: 100, 80 y 64". Son dos cosas
distintas: el `64` de `FormLeadership` no es marca de agua (no tiene opacidad
propia, es la ilustración de "Esperando candidato"), y el 96 de
`FeedbackOverlay` y el 70 de `AttendanceMonitorView` no estaban listados.
