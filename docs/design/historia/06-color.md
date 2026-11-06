# §6 Color — por qué la paleta es así

Historia que acompaña a DESIGN.md §6. La regla vive allá; acá queda el porqué.

## La paleta cerrada (regla del usuario, 2026-07-28)

El estado medido el 2026-07-28 mostraba por qué la regla hacía falta — el uso
estaba muy desparejo:

| variante | usos | |
|---|---|---|
| `chart-3` | 76 | en uso real |
| `chart-1` | 43 | en uso real |
| `chart-4` | 21 | en uso real |
| `chart-9` | 18 | en uso real |
| `chart-6` | 12 | en uso real |
| `chart-2` · `chart-5` · `chart-7` · `chart-8` | 7 · 7 · 6 · 4 | **un color por caso** |

Los cuatro de abajo no eran categorías del negocio: eran "hacía falta otro
color" resuelto agregando uno.

## La consolidación (§6.0)

Eran trece tokens. Se midió la distancia perceptual (ΔE, CIELAB) entre los 78
pares posibles y **cuatro no eran categorías: eran el mismo color con otro
nombre**:

| retirado | → | por qué |
|---|---|---|
| `chart-2` | `success` | ΔE 11.6 y su `-solid` era **el mismo hex** (`#047857`) |
| `chart-8` | `neutral` | `Badge` ya usaba `chart-8-solid` como su neutro |
| `chart-5` | `chart-9` | cian y verde azulado; nunca aparecen juntos |
| `chart-7` | `warning` | dorado y ámbar; los dos leen "atención" |

Al retirarlos tenían 343 referencias en 88 archivos: por eso quedaron como
alias apuntando al destino (el color se unificó sin reescribir nada) y el gate
`chart-retirado` bloquea usos nuevos.

Medidas las 32 combinaciones (8 colores × 4 temas) contra AA: **31 pasaban, 1
no** — `chart-4` en liquid, 4.32:1. Su `-text` bajó de `#c2410c` a `#9a3412`.

## Los colores del logo (2026-07-23 · 2026-08-31)

`--logo-green` y `--logo-magenta` se muestrearon por pixel de
`public/Logo512.png` (arco superior verde, cruz + arco inferior magenta). Antes
la identidad decorativa era un violeta/índigo genérico (`from-violet-500/22 via-indigo-400/14 to-blue-500/8`
en la navegación activa, `from-violet-300 via-indigo-400 to-blue-400` en la
barra de acento) sin relación con la marca. Se aplicó primero al panel lateral
(AUDITORIA-TEMA-2026-07.md §7.7) y después a los orbes del fondo.

Los `-text` de identidad (2026-08-31): el verde del logo es LIMA y sobre una
superficie clara da ~2.3:1; el magenta sirve en claro (7.25:1) y se apaga sobre
oscuro. Los temas oscuros usan las `-soft`. Medido sobre blanco, `#4f6d08` da
5.96:1. Se estrenaron en `/mis-puntos`.

## Severidad: el bug de `Badge` y las clases crudas

La tabla original de este documento recomendaba `text-emerald-500/600/700`,
`text-red-500/600/700`, etc. directos de Tailwind. Esa fue exactamente la causa
del problema que T7.1 cerró (119 archivos, ~1,400 usos de color crudo sin
sistema). Y `Badge.jsx` usaba hex fijo en vez del token `-text`, invisible
porque el componente no tenía usos reales en ese momento.
