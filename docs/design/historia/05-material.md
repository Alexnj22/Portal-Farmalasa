# Historia — material y backdrop root (§5.bis–§5.ter)

Mediciones que antes vivían en `DESIGN.md` §5.bis.1 y §5.ter. Las reglas siguen allá. Detalle completo en `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md`.

## `data-filo="ceder"` (2026-08-11)

- **`data-filo="ceder"`: el botón que ES la cara de su tarjeta** (2026-08-11). «La pieza
  más interna» asume que un botón dentro de una superficie es *una parte* de ella. A
  veces no lo es: es su cara. En la campana, el encabezado de cada notificación es un
  botón que ocupa el 80% de la tarjeta y deja afuera Aprobar/Rechazar — el filo corría
  el rectángulo del encabezado y **cortaba la tarjeta en dos**, justo arriba de los
  botones («la animación hover no pasa por el borde de la card»). Con el atributo, el
  botón no dibuja su filo y lo corre la tarjeta, que es la forma que el ojo reconoce.
  Son **dos** reglas en `index.css` —el `content: none` del botón y el `:has(> …:hover)`
  de la tarjeta—, porque la guarda `:not(:has(…))` también hay que levantarla. Va sólo
  donde el botón sea la cara de la superficie, nunca en un control que es una pieza.

## El escalón anidado en Liquid claro iba al revés (2026-08-15)

Reportado sobre la vista de Pedidos: *«en la recepción en liquidglass no se
distingue ni lee bien el texto, se ve todo muy sutil»*. No era de Pedidos.

`--anidada` valía `rgba(12,20,48,.09)` en Liquid claro, o sea **oscurecía**,
siguiendo la regla «en claro oscurece». Pero esa regla mira el TEMA y lo que
manda es el MATERIAL de abajo. En Solid claro el contenedor es blanco opaco y
oscurecer está bien. En Liquid claro el contenedor es un 16 % de tinte pálido
sobre el ambiente lavanda, **ya oscurecido por el `saturate(200%)` del propio
vidrio** — bajarle otro escalón dejaba la tarjeta más oscura que la página.

Medido sobre una captura de producción, píxel pintado:

| capa | luminancia |
|---|---|
| página | 0.522 |
| cuerpo de vista (vidrio nivel 1) | 0.465 |
| **tarjeta (anidada)** | **0.387** ← más oscura que la página |

Y como el **cuerpo de vista también es `data-surface="card"`**, esto no afectaba
a unos pocos paneles anidados: afectaba a **toda tarjeta del portal**. Contraste
de la tinta sobre esa tarjeta, antes → después de invertir el escalón:

| tinta | antes | después | AA 4.5:1 |
|---|---|---|---|
| `content` | 6.09 | **9.78** | ✓ |
| `content-2` | 3.15 | **5.07** | ✓ |
| `content-3` | 2.58 | 4.15 | ✗ sigue corto |
| aviso `info` (`bg-brand/10` + `-text`) | 2.54 | 3.95 | ✗ |
| aviso `success` | 2.18 | 3.38 | ✗ |
| aviso `warning` | 2.67 | 4.13 | ✗ |
| aviso `danger` | 2.76 | 4.27 | ✗ |
| aviso `chart-3` | 2.78 | 4.30 | ✗ |

**Invertirlo REFUERZA el escalón, no lo debilita**: la separación entre la
anidada y su contenedor sube de 1.21:1 a 1.30:1 — que es exactamente lo que
§1.5 le pide (sin escalón queda a 1.02:1, invisible).

Tres cosas que valen para la próxima:

1. **Un token de material se verifica sobre el PÍXEL PINTADO, no sobre su
   valor.** `--text-tertiary` lleva escrito en su comentario que da 4.96:1
   «sobre surface-card (liquid)». Daba 2.58:1. El cálculo se había hecho contra
   una tarjeta clara *supuesta*, y nadie volvió a mirarla después de que el
   material de agosto la volviera translúcida. Es la contracara de
   `feedback_una_captura_verifica_el_bundle_no_el_codigo`.
2. **`backdrop-filter: saturate(200%)` OSCURECE un fondo de color.** Subir el
   croma baja la luminancia. En un tema claro sobre un ambiente saturado, el
   vidrio no aclara: apaga.
3. **La fila de la tabla de arriba decía «En claro oscurecer es falso» y el
   código hacía justo eso.** El doc tenía la regla correcta y el token la
   contradecía; ningún gate cruza las dos cosas.

**Los avisos teñidos — CERRADO el 2026-08-15** (era el pendiente de esta misma
sección). El escalón arreglaba la tinta lisa pero no los `bg-X/10` + `text-X-text`,
que quedaban entre 3.4 y 4.3:1. La causa era del par tinte/token, no del material:
subir el alfa del tinte los **empeora**, porque los acentos son de tono medio y
acercan el fondo al texto en vez de alejarlo (medido: `success` va de 3.38 a /10
hasta 3.23 a /35).

Se bajaron los **nueve** `*-text` de los temas claros —sólo la luminosidad, tono
y saturación intactos (HLS), y lo mínimo para cruzar 4.6:1—:

| token | antes | después | en Solid |
|---|---|---|---|
| `brand` | 3.86 | **4.61** | 6.71 |
| `success` | 3.33 | **4.65** | 6.72 |
| `warning` | 4.07 | **4.62** | 6.68 |
| `danger` | 4.18 | **4.63** | 6.74 |
| `chart-1` | 4.04 | **4.60** | 6.65 |
| `chart-3` | 4.23 | **4.61** | 6.67 |
| `chart-4` | 4.48 | **4.60** | 6.63 |
| `chart-6` | 3.60 | **4.62** | 6.69 |
| `chart-9` | 3.39 | **4.65** | 6.71 |

**El error de origen estaba escrito y nadie lo leyó como tal.** El comentario de
`--chart-4-text` dice que se calibró «sobre el chip claro (base al 12 % sobre
blanco)» y que era «el único de las 32 combinaciones color×tema que fallaba».
Blanco es la tarjeta de **Solid**. Ese barrido dio por buenos los otros ocho
porque los midió contra el tema equivocado — el mismo error que este documento
describe arriba, cometido dos veces con seis meses de diferencia. Es
[[feedback_un_token_de_material_se_mide_sobre_el_pixel_pintado]] en su forma más
literal.

**SIGUE ABIERTO — el escalón de tinta lisa.** `content-3` queda en 4.15:1 sobre
la tarjeta. Bajarlo a 4.8 es una línea, pero `content-2` está en 5.07: quedarían
a un pelo uno del otro y el terciario dejaría de leerse como terciario. Cerrarlo
bien es mover los DOS (`content-2` → ~7.0, `content-3` → ~4.8), y eso es un
cambio de la escala tipográfica del tema claro, no un arreglo de contraste. No se
tomó.

## El backdrop root (2026-08-09)

Medido el 2026-08-09 en Inicio: **38 de 41** superficies canónicas con vidrio no lo
estaban ejecutando. Tres causas, las tres arregladas:

| causa | dónde estaba | por qué se coló |
|---|---|---|
| `backdrop-filter: blur(1px)` en el **velo** del modal | `[data-velo]` | un píxel invisible a ojo, que costaba el vidrio de **todos** los modales |
| `animation-fill-mode: both` en las animaciones de **entrada** | 6 clases de `index.css` | `to { transform: none }` se interpola como matriz identidad, y `both` la sigue aplicando para siempre |
| `transform-gpu` / `will-change-transform` en **envoltorios** | 30 tags de 15 archivos | hábito pre-`will-change`; con el lift de hover no hace falta |

Cómo se verifica, en dos mitades:

- **Lo que se ve en el fuente** lo vigila el gate, categoría `backdrop-root`:
  `transform-gpu` / `will-change-transform` en un tag que no declara `data-surface`.
  Arranca en **0** (se barrieron los 30 que había), así que cualquiera nuevo falla.
- **Lo que no se ve en el fuente** —el `fill-mode` de una animación, un `opacity`
  heredado, un `contain` implícito— sólo aparece recorriendo el árbol **pintado**:
  para cada `[data-surface]` con `backdrop-filter`, mirar si algún ancestro crea un
  backdrop root. Verificado así sobre 30 rutas: **0 superficies apagadas**, y lo que
  queda son las anidadas, que es el caso legítimo.
