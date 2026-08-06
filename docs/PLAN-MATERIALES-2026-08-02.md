# Plan de materiales — Liquid Glass y Solid (2026-08-02)

Definición de la identidad de los dos temas, **elemento por elemento**, decidida
sobre mockups interactivos con los tokens reales. Este documento es el contrato
que la implementación tiene que cumplir.

**Auditado y reescrito el 2026-08-05** para que sea definitivo: cada número
volvió a medirse contra el código de hoy, se incorporó el modal (que tenía
mockup y no estaba acá), y las fases quedaron ordenadas con su dependencia y su
criterio de verificación. Lo que sigue es ejecutable tal cual.

| | |
|---|---|
| **Elementos cerrados** | superficie · botón · campo · select/menú · modal — **los cinco CONFIRMADOS por el usuario el 2026-08-05** sobre el mockup consolidado (ver Referencias). Sus bases están en §0.ter · **el alcance del vidrio y la animación de la placa, en §1.5 y §1.6** |
| **Elementos sin definir** | `page-header` (2 usos) y `sheet` (1) — **`tooltip` cerrado en §14**. Ver el inventario de §13 |
| **Implementado** | nada de los tokens de material. El reloj y la curva **sí** existen (preexistían), y `--lift-card` existe **con otro valor que el confirmado** — ver §0.bis |
| **Bloqueo** | La fase D no puede cerrarse sin §13: hay **28 usos de vidrio a mano** fuera del sistema y fuera de toda excepción, incluidos 4 en `ModalShell`, que es el canónico de modales |

> **Confirmación del 2026-08-05.** Los cinco elementos se revisaron renderizados
> con sus valores exactos, Liquid contra Solid, sobre los fondos reales de cada
> tema, y el usuario los aprobó **tal cual**. Eso resuelve cuatro de las cinco
> preguntas que estaban abiertas: el lift de Solid en `-1px`, la remoción del
> barrido, el velo del modal en `0.00` y el panel del modal en `0.51`/`10px`.
> Los valores de este documento son ahora los definitivos; lo que falta es
> **implementarlos**, no volver a discutirlos.

---

## 0.bis. Auditoría del 2026-08-05 — qué dice el plan y qué dice el código

El encabezado anterior decía *«nada de esto está implementado todavía»*. Es
falso en dos puntos, y uno de ellos es una **contradicción viva**: hay un token
en producción con un valor distinto del que este documento declara decidido.

| lo que el plan afirmaba | medido hoy | veredicto |
|---|---|---|
| Nada implementado | El **reloj** (`--dur-fast/base/slow` = 150/200/300 en Liquid, 90/120/180 en Solid) y la **curva** (`--ease-spring`, distinta por tema) ya existen | La fila «reloj» de §1.3 **ya está**. No se reimplementa |
| `--lift-card: -3px` (Liquid) · `-1px` (Solid) | `index.css`: **`-2px`** en `:root`, **`0px`** en los dos Solid | ⚠️ **Contradicción.** El token existe con otro valor. Ver abajo |
| «lifts a mano: 79» | Corregidos en v2.342.0 (barrido de los 79) | Cerrado |
| «duraciones clavadas: 616» | **617** `duration-N` | Sin cambio — y **§8 no lo agendaba**. Ahora sí: §7 |
| «easings clavados: 101, de los cuales 89 son copia de `--ease-spring`» | **101**, y los 89 son copia **exacta** de la curva de *Liquid* | Sin cambio. Y es peor de lo que decía — ver §7 |
| «220 `data-surface="card"`, 3 con `onClick`» | **225** hoy · **`data-interactive` no existe en ningún archivo** | Sin cambio |
| Remover el barrido (`.sweep`) | Vivo: **16** en `index.css`, **10** en JSX (5 archivos), **3** en `DESIGN.md` | Sin cambio |

### El conflicto de `--lift-card`, y por qué importa más de lo que parece

`--lift-card` vale hoy `-2px` en Liquid y `0px` en Solid. Este documento declara
cerrado `-3px` y `-1px`. Son tres estados distintos conviviendo:

- **El código** dice Solid `0px` — no se mueve.
- **`DESIGN.md` §2** dice Solid *«no se mueve; solo cambia de color»* — coincide con el código.
- **Este plan (§1.4)** dice que el usuario eligió `-1px` y que por eso **hay que
  cambiar el contrato de §2**.

O sea que §1.4 describe un cambio de contrato que nunca se aplicó, y mientras
tanto el código y `DESIGN.md` están de acuerdo entre ellos. **No es un bug: es
una decisión pendiente de ejecutar**, y desde el 2026-08-05 está confirmada.

La consecuencia práctica: si alguien lee §1.1 y escribe `-3px` sin leer §1.4,
rompe el acuerdo entre código y doc sin enterarse. **El token y el texto de
`DESIGN.md` §2 se cambian en el mismo commit** — es la fase H de §8, y es la
única de las ocho que no se puede partir en dos.

---

## 0.ter. Los tokens son FACTORES, y faltaba la base que multiplican

Encontrado el 2026-08-05 al medir el tema oscuro, y es el hallazgo que impedía
que este documento fuera implementable.

**`--glass-especular: 1.60` no es un valor: es un multiplicador.** Y el documento
nunca dice qué multiplica. De los ~30 tokens de §1 a §5, **21 son factores
adimensionales** (`especular`, `rim`, `lente`, `tono`, `sombra`, `anillo`,
`hueco`, `luzinv`, `aclara`, `halo`, `glow`, `filo`…); los demás sí son absolutos
(`7rem`, `-3px`, `60px`, `220ms`). Dos personas implementando de acá sacan dos
portales distintos, los dos «cumpliendo» el contrato.

No es teórico: **pasó al construir el mockup de revisión.** Con el mismo `1.60`,
una base alta dibujaba una esfera con filo duro y una base baja un brillo suave.
El token era idéntico; el material, otro.

### La prueba: la tabla de §1.1 no se puede reproducir

§1.1 justifica la técnica «núcleo claro + aro oscuro» con **1.30 sobre claros**.
Medido sobre la superficie real del portal, barriendo la alfa base:

| alfa base del núcleo | reflejo vs superficie |
|---|---|
| 0.17 *(la del mockup confirmado)* | 1.03:1 |
| 0.32 | 1.10:1 |
| 0.42 | 1.14:1 |
| 0.70 *(un borrón blanco)* | 1.23:1 |

**Ni reventándolo se llega a 1.30.** El número de §1.1 salió de otra medición —
seguramente contra el fondo de página y no contra la superficie de la tarjeta —
y como el documento no decía la base, nadie podía notar que no cerraba. La tabla
se conserva como el *razonamiento* que llevó a elegir la técnica (que sigue
siendo correcta: el aro es lo que hace legible un brillo sobre algo claro), pero
**no como una medición reproducible**.

### La base, ahora escrita — sale del mockup que el usuario confirmó

Esto es lo que los factores multiplican. **Es normativo**: cambiar una de estas
alfas cambia el material aunque el token siga diciendo `1.60`.

```css
/* §1 · Tarjeta — Liquid. Base: --surface-card + --border-card del tema. */
.card { background: var(--surface-card); border: 1px solid var(--border-card);
        backdrop-filter: blur(18px) saturate(180%);
        box-shadow: 0 8px 32px rgba(15,23,42,.10); }

/* reflejo (× --glass-especular) — el aro necesita MUCHAS paradas: con pocas se
   ve como el filo de una esfera en vez de como la sombra de un brillo */
.card .especular { background: radial-gradient(var(--glass-esp-radio) var(--glass-esp-radio) at var(--mx) var(--my),
  rgba(255,255,255,calc(.17 * var(--glass-especular)))  0%,
  rgba(255,255,255,calc(.13 * var(--glass-especular))) 26%,
  rgba(255,255,255,calc(.05 * var(--glass-especular))) 44%,
  rgba(255,255,255,0)                                  56%,
  rgba(12,20,48,  calc(.035 * var(--glass-especular))) 68%,
  rgba(12,20,48,  calc(.018 * var(--glass-especular))) 82%,
  rgba(12,20,48,0)                                    100%); }

/* canto vivo 1px (× --glass-rim) */
.card .rim { background: conic-gradient(from var(--rim-ang,210deg),
  rgba(255,255,255,calc(.95 * var(--glass-rim))),
  rgba(255,255,255,calc(.10 * var(--glass-rim))) 28%,
  rgba(255,255,255,calc(.06 * var(--glass-rim))) 58%,
  rgba(255,255,255,calc(.75 * var(--glass-rim))) 82%,
  rgba(255,255,255,calc(.95 * var(--glass-rim)))); }

/* lente (× --glass-lente) — los CUATRO filos, no sólo arriba */
.card { box-shadow: …,
  inset  0  2px 0      rgba(255,255,255,calc(.62 * var(--glass-lente))),
  inset  2px 0  6px -3px rgba(255,255,255,calc(.58 * var(--glass-lente))),
  inset -2px 0  6px -3px rgba(255,255,255,calc(.58 * var(--glass-lente))),
  inset  0 -1px 1px      rgba(255,255,255,calc(.31 * var(--glass-lente))); }

/* §1 · Tarjeta — Solid */
.card { box-shadow: 0 2px 6px rgba(15,23,42,calc(.07 * var(--solid-sombra))),
                    0 1px 2px rgba(15,23,42,calc(.05 * var(--solid-sombra))); }
.card:hover { background: var(--surface-card-hover);        /* × --solid-tono */
              box-shadow: …, 0 0 0 3px rgba(15,23,42,calc(.10 * var(--solid-anillo))); }

/* §2 · Botón — el aro NO escala con la intensidad: ése es el motivo de --btn-esp-aro */
.btn .especular { background: radial-gradient(var(--btn-esp-radio) var(--btn-esp-radio) at var(--mx) var(--my),
  rgba(255,255,255,calc(.55 * var(--btn-especular)))  0%,
  rgba(255,255,255,calc(.30 * var(--btn-especular))) 30%,
  rgba(255,255,255,0)                                50%,
  rgba(12,20,48,  calc(.55 * var(--btn-esp-aro)))    66%,
  rgba(12,20,48,  calc(.22 * var(--btn-esp-aro)))    82%,
  rgba(12,20,48,0)                                  100%); }

/* §3 · Campo — el hueco arriba, la luz ABAJO */
.campo { box-shadow: inset 0  2px 8px rgba(15,23,42,calc(.09 * var(--campo-hueco))),
                     inset 0 -1px 0   rgba(255,255,255,calc(.72 * var(--campo-luzinv))); }
.campo:hover { background: color-mix(in srgb, var(--surface-input),
                                     white calc(10% * var(--campo-aclara))); }

/* §4 · Menú flotante */
.menu { background: color-mix(in srgb, #f0f8ff calc(var(--menu-opacidad) * 100%), transparent);
        backdrop-filter: blur(var(--menu-blur)) saturate(165%);
        box-shadow: 0 24px 60px rgba(0,0,0,calc(.14 * var(--menu-sombra))),
          inset 0 1px 0      rgba(255,255,255,calc(.90 * var(--menu-halo))),
          inset 0 0 22px -6px rgba(120,140,255,calc(.45 * var(--menu-glow))); }

/* §5 · Modal — el filo arriba, y el rim/lente de la tarjeta */
.modal { box-shadow: 0 32px 80px rgba(0,0,0,calc(.18 * var(--modal-sombra))),
          inset 0 2px 0 rgba(255,255,255,calc(.95 * var(--modal-filo))),
          /* + las cuatro inset de lente, × --modal-lente */ ; }
.velo  { background: rgba(3,11,28,calc(.50 * var(--velo-oscuridad)));
         backdrop-filter: blur(var(--velo-blur)); }
```

### Liquid en tema oscuro — medido por primera vez

§10 lo listaba como decisión abierta porque **ninguna medición del documento se
había hecho sobre fondo oscuro**. Hecha ahora, con los valores confirmados:

| | Liquid claro | Liquid oscuro |
|---|---|---|
| núcleo del reflejo vs superficie | 1.03:1 | **2.43:1** |
| aro oscuro vs superficie | 1.02:1 | **1.01:1 — muerto** |

**El mismo token da dos materiales distintos.** En oscuro el reflejo es más de
dos veces más visible, y el aro oscuro —que en claro es lo que lo hace legible—
sobre una superficie oscura no separa nada: es una capa que se compone para
nada. Dos consecuencias para la fase D:

1. `[data-theme="dark"]` necesita **su propio `--glass-especular`**, más bajo.
   Heredar el `1.60` de `:root` deja un reflejo el doble de fuerte.
2. En los dos temas oscuros el aro puede irse. No hace falta un token nuevo:
   basta que la base del aro sea `0` ahí.

---

## 0. Por qué existe este documento

El detonante fue un rebote visible al mover el mouse cerca de un menú abierto.
Persiguiéndolo aparecieron tres cosas que comparten una misma raíz — **un valor
clavado a mano no lo alcanza ningún tema**:

| hallazgo | medido |
|---|---|
| el lift de la tarjeta estaba clavado en `-2px` | `dy=-2` en los **tres** temas, incluido Solid, cuyo contrato dice que no se mueve |
| lifts escritos a mano en JSX | **79**, de 1px a 8px, contra **31** que usaban un token |
| duraciones clavadas | **616** contra **31** por token |
| easings clavados | **101**, de los cuales **89** son copia literal de `--ease-spring` |

De ahí la regla que gobierna todo lo que sigue: **si un valor define la
identidad, vive en un token y lo vigila un gate.** Ningún número de este
documento se escribe a mano en un componente.

---

## 1. Superficie — `data-surface="card"` ✅ CERRADO

### 1.1 Liquid Glass

Apple describe su material como tres capas: **highlight** (la luz que se mueve),
**shadow** (la separación del fondo) e **illumination** (el material que dobla la
luz). Se replican las tres, con estos valores aprobados:

```css
:root {
  --glass-especular: 1.60;   /* intensidad del reflejo que sigue al puntero */
  --glass-esp-radio: 7rem;   /* tamaño del halo */
  --glass-rim:       1.45;   /* canto vivo de 1px */
  --glass-lente:     1.45;   /* sombras interiores del filo */
  --lift-card:      -3px;    /* CONFIRMADO — hoy el código vale -2px. Ver §0.bis */
}
```

**Reglas de construcción, no negociables:**

- **El reflejo va DEBAJO del contenido** — `z-index: 0` en la capa especular,
  `z-index: 1` en el contenido. Encima se come el texto y los botones: fue un
  bug real del primer mockup y el usuario lo detectó de inmediato.
- **El reflejo sólo existe bajo el puntero** — `opacity: 0` en reposo. Con
  `--mx/--my` en su valor por defecto el gradiente se dibuja en **todas** las
  piezas a la vez aunque el mouse esté en la otra punta.
- **El reflejo lleva núcleo claro Y ARO OSCURO, sin `mix-blend-mode`.** Un
  reflejo blanco con `screen` es matemáticamente invisible sobre una superficie
  blanca — no se puede aclarar lo que ya está en blanco. Medido sobre las bases
  reales del portal:

  | técnica | sobre claros | sobre coloreados |
  |---|---|---|
  | blanco + `screen` | **1.06** (invisible) | 3.54 |
  | sólo oscuro | 1.34 | **1.15** (se pierde) |
  | **núcleo claro + aro oscuro** | **1.30** | **4.05** |

  Lo que hace legible un brillo sobre algo claro es **la sombra que lo rodea**,
  igual que en la vida real. Y como no necesita `mix-blend-mode`, ahorra además
  una capa de composición.
- **El gel de presión vive en LO QUE SE APRIETA**, no en el contenedor. En una
  tarjeta clicable, la tarjeta entera; en una tarjeta con botones, los botones —
  la tarjeta no se mueve. Verificado: la clicable cede 7px, la de botones 0.
- El canto vivo (`::before`) sí va encima, pero es 1px y no toca el contenido.

### 1.2 Solid

**No copia la luz que sigue al puntero.** Simular material contradice la promesa
de eficiencia, y un reflejo sobre una superficie opaca se lee como un error de
render. Solid se siente vivo por responder al instante y con precisión; la
profundidad sale de **apilar superficies opacas**, no de desenfocar.

```css
[data-theme="solid"], [data-theme="solid-dark"] {
  --solid-filo:   0;      /* 1px claro arriba — apagado */
  --solid-tono:   2.00;   /* escalón de tinte sobre el fondo */
  --solid-sombra: 2.00;   /* corta y contrastada */
  --solid-anillo: 0.40;   /* aro nítido al apuntar */
  --lift-card:   -1px;    /* CONFIRMADO 2026-08-05 — hoy el código vale 0px. Ver §1.4 */
}
```

**`--solid-filo: 0` está verificado.** La duda era si sin el filo la tarjeta se
separaría en modo oscuro, donde una sombra negra no aporta nada. Medido: la
superficie `#1e293b` contra el fondo `#0f172a` da **1.22:1**, y con el borde
claro alcanza. El escalón de tono hace el trabajo solo — que es justamente el
principio: **el tono es el recurso principal y la sombra el secundario**, al
revés de como suele hacerse. Eso es lo que permite que el mismo set de tokens
funcione en claro y en oscuro sin variantes.

### 1.3 Correspondencia entre los dos materiales

Los mismos roles, distinto material:

| rol | Liquid Glass | Solid |
|---|---|---|
| luz | especular que sigue al puntero | **nada sigue al puntero** — responde el borde |
| canto | anillo de 1px con gradiente | aro nítido de 3px al apuntar |
| filo | lente: sombras interiores | 1px claro arriba (hoy apagado) |
| movimiento | `-3px` al entrar y salir | `-1px` |
| presión | gel: `scale(.978)` | hundido: `inset` + 1px hacia abajo |
| reloj | 150/200/300ms | 90/120/180ms |

### 1.4 El contrato de `DESIGN.md` §2 hay que cambiarlo

`DESIGN.md` §2 dice hoy, para Solid: *"no se mueve; solo cambia de color"*. El
valor **confirmado el 2026-08-05** es `--lift-card: -1px`, o sea que **sí se
mueve**. 1px es un guiño, no un salto — pero **el texto del contrato tiene que
cambiar con él**.

Dejarlo como está reproduce exactamente el bug que originó todo este trabajo:
una regla escrita que el código viola. Y ojo con el orden — hoy el código
(`0px`) y `DESIGN.md` («no se mueve») están de acuerdo entre ellos; el que
difiere es este plan. **Se cambian los dos en el mismo commit** (fase H de §8),
nunca el token primero.

---

### 1.5 El alcance del vidrio — la anidada se APLANA ✅ CERRADO 2026-08-05

Era la única decisión que bloqueaba la implementación. Se cerró sobre mockup, en
los dos temas y sobre el fondo real del portal (los cinco orbes de `AppLayout`).

**El hallazgo que la resolvió: una tarjeta de vidrio dentro de otra es invisible
como superficie separada.** Medido sobre el patrón real —una tarjeta de sección
con tarjetas adentro, que es lo que hacen `EmployeeDetailView` (5),
`FormNovedad` (4) y el Dashboard (3):

| | Liquid claro | Liquid oscuro |
|---|---|---|
| anidada de vidrio vs su contenedora | **1.024:1** | **1.022:1** |
| reflejo de la contenedora, con una capa de vidrio encima | 1.09:1 | **1.47:1** *(de 2.43)* |
| **anidada aplanada** vs su contenedora | **1.206:1** | **1.268:1** |

El umbral de «se ven distintos» está cerca de 1.1:1, así que 1.02 no lo distingue
nadie. El vidrio anidado **no comunica jerarquía**: sólo agrega una capa de
composición y, peor, **le apaga el reflejo a la tarjeta de abajo**.

**La regla:** un `data-surface="card"` dentro de otro **pierde el
`backdrop-filter`** y pasa a un escalón de tono. Una sola regla por descendencia
—no hay que tocar 225 llamadores ni inventar una prop que alguien se va a olvidar
de pasar.

```css
/* El escalón INVIERTE su dirección según el tema. */
:root                { --anidada: rgba(12,20,48,.09); }   /* claro: OSCURECE */
[data-theme="dark"]  { --anidada: rgba(255,255,255,.09); } /* oscuro: ACLARA  */

.card [data-surface="card"] {
  background: var(--anidada);
  border: 1px solid var(--border-card);
  backdrop-filter: none;      /* sin reflejo, sin lente */
}
```

**Dos cosas que sólo aparecieron midiendo:**

1. **`--surface-card-hover` no sirve para esto.** Fue el primer intento: dio
   **1.020:1** en claro y **1.059:1** en oscuro, casi lo mismo que el problema.
   Ese token está calibrado como *estado de hover*, no como escalón de jerarquía.
   La anidada necesita **token propio**.
2. **La dirección del escalón se invierte por tema.** En claro hay que
   **oscurecer**: aclarar sobre una superficie casi blanca no despega (blanco al
   28% da 1.093, debajo del umbral). En oscuro hay que **aclarar**: oscurecer no
   funciona ni al extremo (negro al 48% da 1.082, invisible), porque la tarjeta
   ya está casi tan oscura como la página. Es el principio de §3 —*el hueco es un
   escalón de tono*— pero con la dirección atada al **tema**, no al elemento.

**Por qué no se reservó el vidrio a navegación y flotantes** (la regla estricta
de Apple, que era la otra salida): con las tarjetas de contenido opacas, en una
vista de listado —la mayoría del portal— Liquid y Solid se parecen demasiado, y
el gradiente de página deja de verse a través de nada. Apple puede permitírselo
porque su contenido va sobre fotos y mapas; **el portal muestra tablas sobre un
gradiente propio**. El hallazgo nunca fue «hay demasiado vidrio» sino «el vidrio
anidado no se ve», y apagarlo en todo el contenido es resolver un problema de
jerarquía con una amputación.

---

### 1.6 La animación de la placa: EL FILO CORRE ✅ CERRADO 2026-08-05

**Se retira el reflejo que persigue al puntero.** El usuario lo rechazó tras
verlo renderizado: sobre una tarjeta con filas adentro se lee como un halo
pintado encima, no como luz en el material. En su lugar, la identidad se mueve
**por el canto**.

**El gesto:** al entrar a una pieza, un destello recorre su perímetro una vez y
se queda donde lo dejaste — como cuando inclinás un vidrio y el brillo viaja por
el borde. La vuelta va de `210deg` a `570deg`: **termina en el mismo ángulo en
que empezó**, así que relanzarla no produce ningún salto.

```css
@property --rim-ang  { syntax:'<angle>'; initial-value:210deg; inherits:false; }
@property --fila-ang { syntax:'<angle>'; initial-value:210deg; inherits:false; }

/* base tenue + arco ANGOSTO muy brillante, no medio perímetro */
.rim { background: conic-gradient(from var(--rim-ang),
  var(--rim-base) 0%, var(--rim-base) 2%,
  var(--rim-glint) 7%, var(--rim-glint) 13%,
  var(--rim-base) 18%, var(--rim-base) 100%);
  filter: drop-shadow(0 0 9px var(--rim-bloom))
          drop-shadow(0 0 4px var(--rim-bloom))
          drop-shadow(0 0 1px var(--rim-bloom)); }

@keyframes filo-corre { from { --rim-ang: 210deg } to { --rim-ang: 570deg } }
```

**Cuatro decisiones que salieron de iterarlo, y ninguna es cosmética:**

**a) El canto ES el borde.** La primera versión no se veía —cero píxeles de
cambio en claro— y no porque no animara: el ángulo llegaba a 469°. El problema
era que **debajo del canto había un `border` fijo**, así que la parte apagada del
cónico quedaba idéntica a la base y el destello no tenía contra qué leerse. El
borde fijo se apaga y el canto lo reemplaza.

**b) El bloom invierte su color por tema.** En claro el destello es blanco y su
bloom **oscuro**; en oscuro, al revés. Es la misma física que §1.1 midió para el
reflejo —*un brillo blanco sobre algo claro es matemáticamente invisible*— y la
misma solución que el plan ya había elegido ahí: «núcleo claro + aro oscuro».

**c) La anidada tiene canto propio.** No la convierte en vidrio sobre vidrio: lo
caro y lo que medía 1.02:1 era el `backdrop-filter`, **no el borde**. Un cónico
de 1px no compone ninguna capa. Y hay una lectura física que lo sostiene: la fila
no es una segunda placa, es una **región rebajada dentro de la misma**, y un
cambio de profundidad en el vidrio atrapa luz — es lo que hace visible al vidrio
grabado. Usa la misma estructura de destello angosto que la placa; con un cónico
ancho pegaba mucho menos.

**d) Cada pieza lleva su PROPIO ángulo.** Un `--rim-ang` compartido y heredado
hacía barrer a la placa y a las tres filas **a la vez** — se leía como si la
tarjeta entera reaccionara a algo que pasó en un renglón. Con `--rim-ang` para la
placa y `--fila-ang` para cada fila, ambos `inherits: false`, **barre sólo lo que
está bajo el puntero**. Verificado: entrando a la fila 2, ella pasa a 336° y la
placa y sus hermanas se quedan en 210°.

**El disparador.** Es la **única de las animaciones que necesita JS**: unas 10
líneas. Un `pointerover` delegado en la tarjeta calcula la pieza activa —la fila
bajo el puntero, o la placa si no hay ninguna—, apaga la anterior y relanza la
nueva quitando y reponiendo la clase con un reflow en el medio. Moverse dentro de
la misma pieza no relanza; sólo cambiar de pieza.

**Lo que se ve, medido comparando cuadros del recorrido:**

| versión | claro | oscuro |
|---|---|---|
| primera — invisible | máx **3**/255 | máx 93/255 |
| con bloom oscuro | máx 47 | máx 94 |
| + arco más ancho y más bloom | máx 64 · medio 46 | máx 117 · medio 61 |
| **+ lente por tema (§1.7)** | máx **64** · medio 47 | máx **155** · medio **111** |

El salto final en oscuro **no vino de subirle el brillo al destello: vino de
bajarle el lente**. Con el canto en reposo tenue, el destello tiene contra qué
destacarse. *A veces se gana contraste apagando lo de al lado, no encendiendo lo
que querés que se vea.*

**Qué hace Solid:** nada. Su borde es nítido y fijo; no hay canto que recorrer.

---

### 1.7 ⚠️ El «lente» estaba clavado y es ciego al tema — CORREGIDO

Encontrado al revisar el tema oscuro del mockup de §1.6. §1.1 define la capa de
lente con **alfas absolutas** (`.62`, `.58`, `.31` de blanco, × `--glass-lente`),
y §0.ter las guardó como base normativa. Están calibradas mirando **un solo
tema**.

Medido en la tarjeta oscura **en reposo**:

| | |
|---|---|
| superficie de la placa | `[14,23,60]` |
| su filo interior, con el lente clavado | **`[234,234,237]`** — casi blanco |
| el mismo filo, con el lente por tema | `[52,60,90]` |

Sobre lavanda claro, un blanco al `.90` es un brillo sutil en el filo. Sobre navy
oscuro es **una franja blanca cruzando el tope de la tarjeta**. Es exactamente el
defecto que §0.ter ya había encontrado con el reflejo: un número calibrado para
un tema y guardado como si fuera universal.

```css
:root               { --lente-top: .62; --lente-lado: .58; --lente-bajo: .31; }
[data-theme="dark"] { --lente-top: .10; --lente-lado: .07; --lente-bajo: .04; }
```

**Consecuencia para §0.ter:** su bloque de bases es normativo, pero **las alfas
del lente y del filo del modal (§5) tienen que salir de estos tokens, no de los
literales**. Al implementar la fase D hay que revisar cada base de §0.ter con la
misma pregunta: *¿esto se midió en los dos temas o en uno?*

---

## 2. Botón ✅ CERRADO

El elemento más repetido del portal. Cuatro variantes reales: `primary`,
`secondary`, `ghost`, `destructive`.

```css
:root {                                  /* Liquid Glass */
  --btn-especular: 0.40;
  --btn-esp-radio: 3rem;
  --btn-esp-aro:   0.10;   /* piso del aro — legibilidad sobre blancos */
  --btn-rim:       1.00;
  --btn-barrido:   0;
  --lift-hover:   -1px;
}

[data-theme="solid"], [data-theme="solid-dark"] {
  /* Solid NO declara estas capas: no existen, no se apagan. */
  --lift-hover: 0px;
}

/* El gel va en las CUATRO variantes, no en dos */
.btn:active { transform: scale(.965); }
[data-theme="solid"] .btn:active {
  transform: translateY(1px);
  box-shadow: inset 0 2px 4px rgba(15,23,42,.24);
}

/* Única capa compartida: el foco. Es accesibilidad, no material. */
.btn:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 40%, transparent); }
```

**En Liquid el botón es vidrio de verdad**: translúcido con `backdrop-filter`,
no un degradado opaco. Si no se ve lo que hay detrás, no es vidrio — y así
estaba el primer mockup, que el usuario rechazó por eso mismo.

**Proporción del reflejo.** 3rem sobre un botón de ~150px es el mismo ~32% que
7rem sobre una tarjeta de 320px: el reflejo se lee del mismo tamaño relativo en
los dos elementos.

**`--btn-esp-aro` existe porque el aro no puede escalar con la intensidad.** Al
bajar la intensidad a 0.40 el aro caía a .052 y el botón blanco volvía a **1.11**
de contraste — prácticamente el 1.06 del bug original. Con piso 0.10 sube a
~1.20 sin cambiar nada en los coloreados. La intensidad gobierna el brillo; el
aro garantiza la legibilidad. Son dos cosas distintas y por eso son dos tokens.

**Solid no declara ninguna capa de vidrio.** Sin `backdrop-filter`, sin
`::before`/`::after`, sin `mix-blend-mode`. Cada una de esas capas es una
superficie que el navegador compone aparte — ahí está la eficiencia, no en usar
menos color. Solid queda con **2 capas activas** contra **6** de Liquid.

### 2.1 Consecuencias en el código existente

- **El gel está a medias hoy:** `primary` y `destructive` llevan
  `active:scale-[0.98]`; `secondary` y `ghost` no llevan nada. No es una
  decisión, es una inconsistencia — pasa a las cuatro.
- **`--btn-barrido: 0` es una REMOCIÓN, no un apagado.** El shimmer ya existe
  implementado (`.sweep` en `index.css`) y `DESIGN.md` lo documenta como *"All
  primary CTA buttons include an inner shimmer overlay"*. Apagarlo obliga a:
  borrar esa sección de `DESIGN.md`, quitar los `<span class="sweep">` del
  marcado —si no queda DOM muerto— y eliminar las reglas de `index.css`. Se
  decidió así porque con el reflejo y el canto vivo el barrido es redundante, y
  además era la capa más cara de las tres.
- **El foco es la única capa compartida** entre los dos materiales, y no es
  graduable: es accesibilidad, no estilo.

---

## 3. Campo ✅ CERRADO

**El campo invierte el material: es un HUECO, no una superficie.** Una tarjeta y
un botón sobresalen —la luz les pega arriba y se levantan al apuntarlos—; un
campo está hundido. El portal ya lo trataba así sin nombrarlo: `data-surface="input"`
lleva `box-shadow: inset 0 2px 8px`.

```css
:root {                                  /* Liquid Glass */
  --campo-hueco:   2.00;   /* sombra interior de arriba */
  --campo-luzinv:  1.25;   /* filo claro ABAJO */
  --campo-aclara:  1.00;   /* deja pasar más luz al apuntar */
  /* sin reflejo, sin canto vivo, sin lift: un hueco no sobresale */
}
[data-theme="solid"], [data-theme="solid-dark"] { --campo-hueco: 2.00; }
```

| rol | tarjeta / botón | campo |
|---|---|---|
| filo claro | arriba | **abajo** — la luz entra por el borde inferior |
| al apuntar | se levanta | **se aclara** — un hueco no se levanta |
| reflejo que sigue al puntero | sí | **no** — sería mentir sobre la forma |

**En Solid el hueco es un escalón de TONO, no una sombra.** Medido: la sombra
sola daba **1.03:1** de profundidad, o sea plano. Y como la tarjeta que lo
contiene es blanca y `--surface-input` también, un campo blanco **desaparece**
dentro de ella. El campo pasa a ser más oscuro que su contenedor — el mismo
principio de §1.2: en Solid el tono es el recurso principal.

**Verificado con los valores elegidos** (píxeles reales, no teoría):

| | texto | campo vs tarjeta |
|---|---|---|
| Liquid | **5.05:1** ✅ AA | 1.114:1 ✅ |
| Solid | **4.94:1** ✅ AA | 1.101:1 ✅ |

**El foco y el estado inválido NO se reabren.** Se decidieron el 2026-07-26
comparando cuatro mockups: cambio de color de borde puro, sin ring, sin glow y
sin lift. Van con `outline` y no con `border` porque `data-surface="input"` pinta
su borde desde una regla sin `@layer`, que le gana a cualquier utilidad de
Tailwind.

---

## 4. Select abierto · menú flotante ✅ CERRADO

**Dos materiales opuestos a 8px de distancia.** El disparador es un hueco (§3);
el menú que sale de él es una capa flotante — y según Apple, la capa flotante es
justo donde el vidrio **más** corresponde, al revés que las 220 tarjetas.

```css
:root {                                  /* Liquid Glass */
  --menu-opacidad: 0.58;
  --menu-blur:     60px;
  --menu-sombra:   2.00;
  --menu-halo:     1.00;
  --menu-glow:     2.00;
  --menu-entrada:  220ms;
}
[data-theme="solid"], [data-theme="solid-dark"] {
  --menu-opacidad: 1;                 /* opaco */
  --menu-blur:     0px;               /* no existe */
  --menu-sombra:   2.00;
  --menu-entrada:  var(--dur-slow);   /* 180ms — sale del reloj del tema */
}
```

### 4.1 El hallazgo: sobre vidrio flotante el texto va en `--content`

A 0.58 de opacidad, donde un objeto saturado del fondo pasa por detrás, el texto
de las opciones daba **3.37:1** — debajo del mínimo AA de 4.5. Es la crítica
documentada a Liquid Glass, medida sobre nuestros propios valores.

**Subir la opacidad casi no ayuda:**

| opacidad | peor contraste |
|---|---|
| 0.58 | 3.37:1 ❌ |
| 0.64 | 3.45:1 ❌ |
| 0.70 | 3.50:1 ❌ |
| 0.76 | 3.59:1 ❌ |

Sacrificar casi todo el vidrio gana 0.22 y **sigue fallando**: el velo es claro,
pero un azul saturado detrás se mantiene en luminancia media.

**Lo que lo arregla es oscurecer el texto**, con la misma opacidad de 0.58:

| texto | peor contraste |
|---|---|
| `--content-2` (`#3c4a63`) | 3.37:1 ❌ |
| **`--content` (`#1e293b`)** | **5.53:1** ✅ |

> **Regla: texto sobre vidrio flotante va en `--content`, nunca en
> `--content-2`.** El vidrio puede ser todo lo translúcido que se quiera; lo que
> no puede es llevar texto secundario encima.

### 4.2 Lo que ya está implementado

Que el fondo deje de responder con el menú abierto ya existe
(`capaFlotante.js`, v2.337.2–v2.343.2). Verificado en el mockup: la tarjeta de
atrás se mueve **0.0px** con el menú abierto y **3.0px** con él cerrado.

---

## 5. Modal — velo + panel ✅ CERRADO

> **Recuperado en la auditoría del 2026-08-05.** El mockup existe desde el
> 2026-08-03 («Paso 6 · el modal») con sus valores adentro, pero **nunca se
> escribió acá**: la sección de pendientes lo seguía listando. Es exactamente el
> modo de falla que este documento existe para evitar — una decisión tomada que
> no se anota se vuelve a tomar. Los números de abajo son los que quedaron
> guardados en el mockup; **confirmar el velo antes de implementar** (ver la
> nota al pie).

El modal es la única capa que **apaga el resto de la pantalla**, así que tiene
dos piezas de material: el **velo** y el **panel**.

**La decisión de fondo: el vidrio se unifica por lo que tiene DETRÁS, no por lo
que lleva encima.** Menú y modal comparten opacidad y canto porque los dos
flotan sobre contenido arbitrario. La tarjeta queda aparte —se apoya en el fondo
de página, que es controlado— y por eso puede ser mucho más transparente.
Medido sobre el párrafo del modal:

| opacidad del panel | contraste del párrafo |
|---|---|
| 0.16 (la de la tarjeta) | 4.04:1 ❌ debajo de AA |
| **0.58 (la del menú)** | **7.90:1** ✅ |

```css
:root {                                  /* Liquid Glass */
  --velo-oscuridad: 0.00;   /* CONFIRMADO — el velo NO oscurece, sólo desenfoca */
  --velo-blur:      1px;
  --modal-opacidad: 0.51;
  --modal-blur:     10px;
  --modal-sombra:   2.00;
  --modal-filo:     1.60;
  --modal-rim:      1.45;   /* = --glass-rim de la tarjeta */
  --modal-lente:    1.45;   /* = --glass-lente de la tarjeta */
}

[data-theme="solid"], [data-theme="solid-dark"] {
  --velo-oscuridad: 0.17;
  --velo-blur:      0px;    /* no existe: es la capa más cara */
  --modal-opacidad: 1;      /* opaco */
  --modal-blur:     0px;
  --modal-sombra:   1.00;
}
```

### 5.1 El canto vivo del modal es FIJO, no sigue al puntero

El canto de 1px es del **material**, así que va en toda superficie de vidrio.
Lo único que cambia es de dónde viene la luz:

| tipo de pieza | luz del canto |
|---|---|
| tarjeta, botón — cosas que **apuntás** | sigue al puntero |
| menú, modal — cosas donde **operás adentro** | viene de la escena y queda **fija** |

Un canto que gira mientras leés un párrafo distrae; uno fijo dice «esto es
vidrio» y se calla.

### 5.2 La gota: no se reabre

El movimiento del modal ya estaba decidido antes de este mockup, y con razones
medidas:

- **En vidrio se abre el RECORTE** (`clip-path: circle()`), **no se escala el
  panel**. Escalarlo escalaría su `backdrop-filter`, y el vidrio llegaría al
  final en vez de estar desde el principio.
- **En Solid es deslizamiento** (`translate`), que es lo único que el compositor
  mueve sin repintar.
- Las dos ramas cuelgan de `__gota`, con `--gota-entrada`/`--gota-salida` por
  tema (340/240ms en vidrio, 200ms en Solid).

### 5.3 El velo y la opacidad del panel — CONFIRMADOS, con su motivo

Las dos se revisaron renderizadas el 2026-08-05 y quedaron **tal cual**. Se
escribe acá el motivo para que ninguna auditoría futura las «corrija» sola:

**`--velo-oscuridad: 0.00` es deliberado.** El velo de Liquid **no oscurece**:
sólo desenfoca 1px. El panel de vidrio ya separa por sí mismo —tiene su propio
blur, su canto y su lente— y oscurecer además duplicaría el efecto. Solid sí
oscurece (`0.17`) porque su panel es opaco y no tiene con qué separarse del
fondo. **No es una omisión: es la diferencia entre los dos materiales.**

**Menú y modal comparten CRITERIO, no número.** El menú es `0.58`/`60px`; el
modal es `0.51`/`10px`. Lo que comparten es la razón por la que pueden ser
translúcidos —los dos flotan sobre contenido arbitrario, y por eso ninguno puede
bajar a la opacidad de la tarjeta (`0.16`, que daría 4.04:1 en el párrafo del
modal)—. El número no tiene por qué ser el mismo: un menú es una lista corta que
se lee de un vistazo y aguanta más vidrio; un modal lleva un párrafo que se lee
entero, y ahí el blur bajo mantiene el texto quieto.

### 5.4 El destructivo dentro del vidrio queda translúcido

Apareció al revisar el mockup, no en el documento: el botón **Anular pedido**
dentro del panel de vidrio se lee más pálido que el rojo macizo de Solid, porque
§2 dice que en Liquid el botón es translúcido de verdad. **Se confirma así.** Un
CTA destructivo pierde algo de peso, pero hacer una excepción opaca rompería la
única regla que sostiene todo §2 —si no se ve lo que hay detrás, no es vidrio— y
el modal ya avisa por texto, no sólo por color.

---

## 6. Rendimiento — medido, no estimado

Banco de pruebas con la CPU estrangulada vía CDP, barrido continuo del puntero,
muestreo por cuadro.

**Resultado: los tres a 60fps sostenidos, cero cuadros sobre 33ms**, incluso con
60 tarjetas y CPU ×6.

| caso | mediana | cuadros >33ms |
|---|---|---|
| Liquid hoy (referencia) | 16.6ms | 0 |
| Liquid nuevo | 16.7ms | 0 |
| Solid nuevo | 16.6ms | 0 |

**Las capas nuevas no cuestan nada. Lo que cuesta es implementarlas mal.**

La primera medición dio 23.8ms (~42fps) y la causa no era el efecto sino el
JavaScript: el handler de `pointermove` llamaba `getBoundingClientRect()` sobre
**todas** las tarjetas en cada movimiento, forzando layout por cuadro.

| implementación | mediana |
|---|---|
| ingenua — todas las piezas, rect en vivo | **27.6ms** → 36fps |
| correcta — sólo la hovereada, rect cacheado, rAF | **16.7ms** → 60fps |

### 6.1 ⛔ La utilidad NO se construye: se quedó sin consumidor

Al ir a escribirla apareció que **no hay nada que la use**. Medido en el código:
`--mx`/`--my` aparecen **0 veces**, `.especular` como capa en JSX **0 veces**, y
`--btn-especular` **1 vez** — el token que escribió la propia fase D.

El motivo es una decisión posterior del propio plan. **§1.6 reemplazó la luz que
sigue al puntero por el destello del canto**, después de que el usuario la
descartara: *«mejor sin luz, no me convence»*. Esa decisión se tomó mirando la
tarjeta, pero el argumento no era sobre la tarjeta — era sobre el **lenguaje**: una
luz que persigue el mouse no comunica estado, y sobre vidrio-sobre-vidrio ni
siquiera llega a verse. El especular del botón (§2) es la misma capa en otra pieza,
y quedó huérfano sin que nadie lo notara porque nunca se había implementado.

**Construirla igual sería agregar código muerto**, que es literalmente el argumento
con el que §2.1 removió el barrido tres párrafos más arriba. Así que no se construye.

Dos consecuencias que sí hay que atender:

1. **`--glass-especular`, `--glass-esp-radio`, `--btn-especular` y `--btn-esp-aro`
   son factores de una capa que no existe.** Se dejan escritos porque son la
   especificación de §1.1/§2 y el día que se decida el especular ya están medidos —
   pero **hoy no multiplican nada**, y eso está anotado acá para que nadie los lea
   como si estuvieran vivos.
2. **Queda una pregunta para el usuario**, la única que este plan no puede
   responderse solo: *§2 decidió un especular para el botón antes de que §1.6
   descartara la luz que sigue al puntero. ¿El botón también pierde esa capa, o el
   argumento valía sólo para la tarjeta?*

**El gate `puntero-lista` se queda igual**, y ahora es puramente preventivo: vigila
una utilidad que no existe, para el día que alguien la escriba. Es el único de los
tres que protege contra código futuro en vez de deuda presente.

### Regla obligatoria del seguimiento del puntero (si algún día se construye)

La versión ingenua es la primera que uno escribe, así que va con gate:

1. Tocar **sólo el elemento bajo el cursor**, nunca recorrer la lista.
2. **Cachear el rect** e invalidarlo en `scroll`/`resize`, nunca medirlo por evento.
3. **Throttle a un `requestAnimationFrame`**: los `pointermove` llegan más
   seguido que los cuadros.

Solid es barato por construcción: sin `backdrop-filter` no hay nada que
componer. Su promesa de eficiencia es real, no retórica.

---

## 7. El reloj y la curva — lo que el plan diagnosticaba y no agendaba

Este documento nace de §0: *«un valor clavado a mano no lo alcanza ningún
tema»*. Pero el checklist anterior sólo pedía un gate para que **no entren
valores nuevos** — los que ya están nunca se agendaron. Sin esta fase, el gate
nace rojo el día uno y la única salida sería ponerle un número al baseline, que
es justo lo que la skill `design-gate` prohíbe.

### 7.1 La curva: 89 sitios que Solid nunca alcanza

De los **101** `cubic-bezier()` escritos a mano, **89 son copia exacta de
`cubic-bezier(0.23, 1, 0.32, 1)`** — el valor de `--ease-spring` **en Liquid**.
Y `--ease-spring` **es distinto por tema**:

| tema | `--ease-spring` |
|---|---|
| Liquid | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Solid | `cubic-bezier(0.2, 0, 0.2, 1)` |

O sea que en Solid esos 89 sitios siguen animando con la curva elástica de
Liquid. **Es el mismo defecto que originó el plan —un token de tema que el
código puentea— pero en la curva en vez del lift**, y con 89 casos en vez de
uno. Migrarlos es un reemplazo textual de un solo valor: `cubic-bezier(0.23, 1,
0.32, 1)` → `var(--ease-spring)`. Los 12 restantes van uno por uno.

### 7.2 El reloj: 617 duraciones, y 224 fuera de escala

| valor | usos | ¿está en el reloj? |
|---|---|---|
| `duration-300` | 206 | sí → `--dur-slow` (Liquid) |
| `duration-200` | 116 | sí → `--dur-base` |
| `duration-150` | 53 | sí → `--dur-fast` |
| `duration-500` | 150 | **no** |
| `duration-700` | 68 | **no** |
| `duration-1000` | 6 | **no** |

**375 mapean limpio** a los tres escalones. Los otros **224 no tienen token
porque el reloj no llega hasta ahí** — y ése es el hallazgo: no es que estén mal
escritos, es que **la escala tiene tres escalones y el portal usa seis**. Antes
de migrar hay que decidir si el reloj crece (un `--dur-lento` y un `--dur-muy-lento`,
con su valor por tema) o si esos 224 son animación ambiental que no pertenece al
reloj de interacción. **Decidirlo primero; migrar después.**

De los 617, **77 están en los canónicos** (`components/common`) — ésos primero:
casi todo el portal pasa por ellos, igual que en §2 con el trazo de los íconos.


### 7.3 El reloj creció un escalón ✅ CERRADO 2026-08-05

**Primero, una premisa mía que no sobrevivió a la medición.** Al ofrecer las opciones
escribí que los 224 huérfanos se repartían entre interacción (`duration-500`) y
**animación ambiental** (700/1000). Contados:

| | 500 | 700 | 1000 |
|---|---|---|---|
| bucles (shimmer, pulse, spin) | 0 | **0** | **0** |
| transiciones de UI | 88 | 43 | 6 |
| entradas (`animate-in`) | 62 | 23 | 0 |
| halos/blobs decorativos | 0 | 3 | 6 |

**De los 224, sólo 9 son decoración.** El portal no usa seis escalones porque tenga
animación ambiental: los usa porque **nadie estaba eligiendo de una escala**. Es el
mismo hallazgo que §13 en otra dimensión — el diagnóstico cómodo («eso es ambiental,
no cuenta») se cae en cuanto se cuenta.

**Decidido y hecho: `--dur-lento`, cuarto escalón.**

```css
:root                        { --dur-lento: 500ms; }
[data-theme="solid"], [data-theme="solid-dark"] { --dur-lento: 300ms; }
```

Mismo factor 0.6 que los otros tres (150/200/300 → 90/120/180). **Migrados los 150
`duration-500` → `duration-[var(--dur-lento)]`** en 52 archivos, cero restos.

**Los 700 bajaron — decidido por el usuario el 2026-08-05.** 700ms para un
`group-hover:scale-110` se siente lento, y el sentido de tener una escala es poder
decir que no. Retemplados los 69 de `duration-700` y los 6 de `duration-1000`.

### 7.3.bis La cola que la tabla de §7.2 tampoco listaba

Al terminar quedaban **20 usos más** en cinco valores que la tabla de §7.2 nunca
mencionó: `75` (3), `100` (6), `250` (4), `400` (4), `600` (1). O sea que el portal no
usaba seis valores de duración: **usaba once**. Es el mismo subconteo que §13 y §18.1,
tercera vez en el mismo documento.

**La regla para cerrarlos, escrita para que no haya que volver a decidirla: al escalón
más cercano, y los empates BAJAN.** Más rápido se siente mejor que más lento, y `250`
y `400` son empates exactos.

| | | |
|---|---|---|
| 75, 100 | → `--dur-fast` (150) | 9 usos |
| 250 | → `--dur-base` (200) | empate, baja · 4 usos |
| 400 | → `--dur-slow` (300) | empate, baja · 4 usos |
| 600 | → `--dur-lento` (500) | 1 uso |

**Y dos que el primer barrido no vio, por una variante:** `[&_svg]:duration-300`. El
regex pedía espacio, comilla o llave antes del token, y `:` no estaba en esa lista —
así que era ciego a todo `duration-*` con variante (`md:`, `group-hover:`,
`[&_svg]:`). Corregido agregando `:` al delimitador.

**Resultado: cero literales `duration-N` en JSX.** Los cuatro escalones emiten su
utilidad en el bundle (verificado: `--tw-duration` + `transition-duration`), así que
`reloj-a-mano` puede nacer bloqueante, sin baseline.

### 7.4 En Solid, la mitad «entrada» del reloj no existe — y está bien

Verificado en ejecución sobre el bundle, no en el fuente:

| | transición | entrada |
|---|---|---|
| Liquid | 0.5 s ✅ | 0.5 s ✅ |
| Solid | 0.3 s ✅ | **0.13 s** |

No es un fallo de la migración. `[data-theme="solid"] .animate-in` fija
`animation-duration: 130ms` (decisión D2.4: en Solid las entradas son cortas y
lineales) y **gana por especificidad a cualquier `duration-*`**. O sea que en Solid el
escalón sólo gobierna las **transiciones**: las 62 entradas migradas no tienen ni
tenían variante en ese tema.

Dos cosas que se siguen de esto, y que valen para toda la fase C:

1. **Verificar un token del reloj exige mirar los cuatro temas por separado**, igual
   que el material. Una duración que «funciona» puede estar siendo pisada por una
   regla de tema con más especificidad, y el fuente no lo delata.
2. **Ese `130ms` es un literal fuera de la escala** — ni `--dur-fast` (90) ni
   `--dur-base` (120). Es la misma familia que la sombra a mano de §16, sólo que al
   revés: no es ciego al tema, es específico de un tema y sin token. Al crear
   `reloj-a-mano` hay que decidir si se vuelve `--dur-entrada-solid` o se ajusta a un
   escalón existente.

---

## 8. Orden de ejecución

Las fases están ordenadas por **dependencia real**, no por comodidad. Una fase
no arranca sin su bloqueo resuelto, porque si arranca hay que rehacerla.

| # | Fase | Bloqueada por | Se verifica con |
|---|---|---|---|
| **A** | ~~Cerrar el alcance del vidrio~~ ✅ hecho (§1.5) · quedan las 2 mediciones de §10 | — | Quedan escritas acá con su motivo |
| **B** | ~~Definir barra de pestañas y sidebar~~ ✅ **hecho** (§11 y §12) | — | Sus secciones, con valores y mediciones |
| **C** | ~~El reloj~~ ✅ **hecho 2026-08-05** — 468 usos tokenizados, 0 literales | A | `reloj-a-mano` en 0 y bloqueante |
| **D** | ~~Tokens de §1-§5 en los cuatro temas~~ ✅ **hecho 2026-08-05** | A, B | Medido en la app real, 4 temas |
| **E** | ~~`data-interactive` + el filo que corre (§1.6)~~ ✅ **hecho 2026-08-05** | D | 6.672 px en la apuntada, 0 en la vecina |
| **F** | ~~Utilidad de seguimiento del puntero~~ ⛔ **SIN CONSUMIDOR** — ver §6.1 | D | El gate `puntero-lista` queda de guardia |
| **G** | ~~Remover el barrido (`.sweep`)~~ ✅ **hecho 2026-08-05** | D | 0 en `index.css`, JSX y `DESIGN.md` |
| **H** | ~~`DESIGN.md` §25.4 y el barrido~~ ✅ **hecho 2026-08-05** | D | El texto y el código dicen lo mismo |

### 8.1 Detalle por fase

- **D · los cuatro temas, no dos.** Los bloques CSS de §1-§5 declaran `:root` y
  `[data-theme="solid"], [data-theme="solid-dark"]`. Falta
  **`[data-theme="dark"]`**, que hereda de `:root` — y un reflejo especular
  blanco no se comporta igual sobre una superficie oscura que sobre una clara.
  Las tablas de contraste de §1.1 miden *«sobre claros»* y *«sobre
  coloreados»*: **ninguna mide sobre oscuro.** Hay que medirlo antes de heredar
  por omisión.
- **E · `data-interactive`.** Hoy hay **225** `data-surface="card"` y **cero**
  `data-interactive` en todo el proyecto. El gel y el hundido no tienen dónde
  aplicarse sin él. Y la lista no sale de `onClick`: una tarjeta puede ser
  clicable a través de un `wrapper`. Sale de recorrerlas.
- **G · el barrido.** No es apagar un token: es **remover**. Vivo hoy en 16
  lugares de `index.css`, 10 de JSX (`App`, `AppLayout`, `ErrorBoundary`,
  `Button`, `LiquidAvatar`) y 3 de `DESIGN.md`. Si se apaga sin remover queda
  DOM muerto, que es la deuda que el propio §2.1 quiere evitar.

### 8.2 Los gates que faltan

Hoy `design-gate.mjs` tiene 41 categorías y **ninguna mira el movimiento**:
`dur-`, `duration` y `ease-spring` no aparecen en el archivo. Las tres que hay
que agregar:

| categoría | falla ante | estado |
|---|---|---|
| `vidrio-a-mano` | `backdrop-blur` fuera de una superficie canónica | ✅ **activa** — ratchet en 150 |
| `reloj-a-mano` | `duration-N` / `cubic-bezier(...)` literal en JSX | ✅ **activa, en 0 y bloqueante** |
| `puntero-lista` | un handler de puntero que recorra una lista o mida el rect por evento | ✅ **activa, en 0 y bloqueante** |
| `material-a-mano` | una capa de §1-§5 con su valor literal en vez de su token | ✅ **activa** — ratchet en 18 |
| `tema-incompleto` | un token de color que `[data-theme="dark"]` hereda del tema claro | ✅ **activa, en 0 y bloqueante** |

**`reloj-a-mano` mira las transiciones, no las animaciones — a propósito.**
`animationDuration` queda fuera: los 24 que había son **bucles ambientales** (shimmer
a 4s, blobs escalonados a 2/3/5s) y el período de un bucle no es una duración de
interacción. Meterlos en la escala haría que los tres blobs derivaran al unísono, que
es exactamente lo que el escalonado evita — sería usar el reloj para romper el diseño.

**Y `puntero-lista` daba cuatro falsos positivos en su primera versión.** Miraba
cualquier mención de `pointermove`: tres de los cuatro eran `removeEventListener` de
limpieza y el otro una prop apuntando a un handler definido veinte líneas más arriba.
**Un detector que mira la referencia en vez del cuerpo no mide lo que cree medir** —
acusa a quien desmonta el listener igual que a quien lo escribe mal.

Ninguna va al baseline: una categoría ausente del JSON arranca bloqueante sola.
Por eso la fase C —bajar la deuda existente— va **antes** de que el gate exista.

**Dos de las cuatro cumplieron eso; `material-a-mano` no, y el motivo está medido.**
Sus 18 hallazgos son todos `backdrop-blur-[Npx]` con valores que **no mapean a ningún
token**: 2, 3, 15, 18, 20, 30, 44 y 60 px. Sólo tres coinciden con algo
(`44px`=`--backdrop-card`, `60px`=`--menu-blur`, `2-3px`≈velo). Los demás necesitan
decidir **qué superficie es cada sitio** antes de poder tokenizarlo, y eso es
exactamente el trabajo de la fase D sobre los 137 de `vidrio-a-mano`.

**Y no es casualidad que sea el mismo trabajo: 13 de los 18 son el MISMO sitio que
`vidrio-a-mano` ya marca.** Convertir uno a superficie canónica baja los dos ratchets a
la vez. Dos gates distintos mirando la misma deuda desde dos ángulos —«¿esto es una
superficie?» y «¿este valor sale de un token?»— no es duplicación: es que la deuda
tiene las dos caras.

---

## 9. Definición de terminado

El plan se cierra cuando, todo junto:

- Los siete elementos (§1-§5 + §11 pestañas + §12 sidebar) tienen sus valores
  acá, en los **cuatro** temas, y el código los lee de tokens.
- `DESIGN.md` §25.4 reescrito: el sidebar **sale** de las superficies bespoke
  siempre-oscuras (§12.1), en el mismo commit que su token.
- `npm run gate:design` verde con las **tres categorías nuevas en cero**.
- El banco de §6 repetido sobre la implementación real: 60fps sostenidos, cero
  cuadros sobre 33ms, con la CPU estrangulada.
- Captura de cada elemento en los cuatro temas, y con `prefers-reduced-motion`.
- `DESIGN.md` §2 y §5 dicen lo mismo que el código — incluido el lift de Solid.
- Cero `.sweep` en el repo.
- Este documento movido a `docs/planes-cerrados/`.

---

## 10. Decisiones abiertas

**Quedaba una bloqueante y se cerró.** Las dos que siguen no frenan la fase D:
son mediciones que hay que hacer al implementar, no elecciones pendientes.

**1 · El alcance del vidrio — ✅ CERRADO el 2026-08-05.** Se resolvió en **§1.5**:
la tarjeta anidada pierde el `backdrop-filter` y pasa a un escalón de tono, con
la dirección invertida por tema. El vidrio completo se queda en todas las
superficies —no se reserva a navegación—, porque el hallazgo nunca fue «hay
demasiado vidrio» sino «el vidrio anidado no se ve» (1.02:1). Ver §1.5 para los
números y el motivo de descartar la regla estricta de Apple.

**2 · Contraste sobre el peor fondo.** Una superficie translúcida cambia su
contraste según lo que tenga detrás; es la crítica documentada más seria a
Liquid Glass, y §4.1 ya la encontró en el menú (3.37:1 → se arregló oscureciendo
el texto, no subiendo la opacidad). Al cerrar los valores hay que medir sobre el
peor fondo posible, **no sobre el lienzo del mockup**. El portal ya corrigió
`--text-tertiary` por este mismo motivo.

**3 · Liquid en tema oscuro — MEDIDO, ya no es una incógnita.** Ver §0.ter: el
reflejo pasa de 1.03:1 en claro a **2.43:1** en oscuro con el mismo token, y el
aro oscuro queda muerto (1.01:1). Lo que falta no es medir sino **elegir el
`--glass-especular` de `[data-theme="dark"]`**, que hoy hereda el de `:root`.

**Resueltas el 2026-08-05** (ya no bloquean): el lift de Solid en `-1px`, la
remoción del barrido, el velo del modal en `0.00`, la opacidad del panel en
`0.51`/`10px` y el destructivo translúcido dentro del vidrio. Los motivos
quedaron escritos en §1.4, §2.1, §5.3 y §5.4 — no en una conversación.

---

> **Fase B CONFIRMADA por el usuario el 2026-08-05**, incluidas las dos
> correcciones finales: el menú de ajustes vuelve a ser vidrio (§12.7) y los
> flotantes anclados van portaleados (§12.6).

## 11. Barra de pestañas ✅ CERRADO 2026-08-05

El riel es vidrio —`blur(40px)`, la única otra superficie con lift— y todo lo
demás sale de reglas ya escritas: la **píldora activa es el caso de §1.5**, una
región opaca dentro de una placa, así que **no lleva `backdrop-filter` pero sí
canto propio**. El lente va por tema (§1.7); en Solid es `0`.

```css
--lift-track: -2px;   /* NUEVO. Solid: 0 */
/* el resto ya existe: --surface-tab-track, --surface-tab-active,
   --tab-track-radius, --tab-track-backdrop */
```

### 11.1 El hover de la pestaña inactiva

La pieza bajo el puntero toma **el relleno de la activa al 55%**, sube `1px` y
enciende su canto. Los dos extremos se probaron y fallan: al 100% las dos se ven
iguales mientras el mouse está encima y se pierde cuál está puesta; con sólo
cambio de color de texto no se siente clicable. **El 55% más el lift es lo que
las mantiene en dos niveles.**

### 11.2 El `scale(1.02)` de la activa se retira

`ViewTabBar` agranda hoy la pestaña activa un 2%. Con el canto vivo encima eso
**deforma el borde de 1px y lo vuelve borroso** — un canto escalado deja de ser
un canto. Es el mismo choque que §1.6 evita en la placa. La píldora ya se
distingue por fondo, sombra y canto; la escala sobra.

---

## 12. Sidebar ✅ CERRADO 2026-08-05

### 12.1 ⚠️ Deja de ser siempre-oscuro — y eso reescribe `DESIGN.md` §25.4

**Decisión del usuario:** el sidebar **sigue el tema**. Hoy §25.4 dice que es
*chrome* y que «oscuro es su identidad, igual que la barra lateral de un editor»,
y por eso vive en la lista de superficies bespoke junto al kiosco y al splash.
**Sale de esa lista.** Como con el lift de Solid en §1.4: el token y el texto se
cambian **en el mismo commit**, o queda un contrato que nadie sabe si manda.

### 12.2 El instrumento de medición estaba mal, y cambió la respuesta

El sidebar no se despegaba del contenido, y al medirlo con **ratio de contraste**
parecía que no había salida. **El ratio mide luminancia** —sirve para saber si un
texto se lee, no si dos superficies se ven distintas—. El instrumento correcto es
**ΔE**: ΔE ≥ 2.3 «apenas se nota», ΔE ≥ 5 «claramente distinto».

| sidebar vs tarjeta de contenido | ratio | ΔE | |
|---|---|---|---|
| claro · blanco `.34` | 1.053 | **4.1** | la misma cosa |
| **claro · navy `.15`** | 1.358 | **16.8** | ✅ elegido |
| oscuro · navy `.62` | 1.006 | **3.2** | la misma cosa |
| **oscuro · negro `.60`** | 1.097 | **14.4** | ✅ elegido |
| oscuro · violeta del logo `.72` | 1.068 | 13.1 | funcionaba; se prefirió el negro |

**Con el ratio, oscurecer topaba en 1.112 y el cambio de tono no movía el
número.** Nunca fue que no separaban: era que el número no las veía.

> **Regla que sale de acá y vale para todo el documento: para «¿estas dos
> superficies se ven distintas?» se mide ΔE, no ratio de contraste.** El ratio
> queda para lo que fue diseñado — texto sobre fondo.

```css
:root               { --sidebar-bg: rgba(30,41,80,.15); }  /* claro: OSCURECE */
[data-theme="dark"] { --sidebar-bg: rgba(0,0,0,.60);    }  /* oscuro: OSCURECE más */
```

**Y en oscuro no se aclara.** Fue la primera propuesta (blanco `.11`, ΔE 13.0) y
el usuario la rechazó con razón: aclarar el chrome contradice el modo oscuro. Es
la **excepción** a la inversión de §1.5 —donde en oscuro se aclara— y el motivo
es que el sidebar no es una región dentro de una placa: es una superficie
hermana, y ahí la dirección la manda la identidad del tema, no el contraste.

### 12.3 El destello de las piezas anidadas no tenía bloom

El canto de la placa llevaba `drop-shadow`; las piezas anidadas —filas del menú,
píldora de pestaña— se quedaron sin él. Sin bloom, en tema claro **un destello
blanco sobre una fila clara es invisible**, que es §1.1 por tercera vez. Ahora lo
tienen, con el color invertido por tema igual que el de la placa.

### 12.4 Las cuatro variantes, y la que manda es la ORIENTACIÓN

| variante | ancho | qué se anima | submenús |
|---|---|---|---|
| **Escritorio** | 13.5rem | — | acordeón en el lugar |
| **Compacto** | 3.4rem | `width` 340ms + rótulos 220ms | flyout al apuntar |
| **Móvil vertical** | hoja de 11.5rem sobre velo | `translateX` 280ms + velo 240ms | acordeón en la hoja |
| **Móvil horizontal** | rail de 3.1rem, fijo | — | flyout |

**El compacto anima `width`, no `transform`.** §6 prohíbe lo que corre por
cuadro y §1.6 evita `transform` sobre superficies con `backdrop-filter` —lo
mata—. Compactar es un gesto **puntual**: pasa por layout una vez cada varios
minutos. Los rótulos se desvanecen en 220ms mientras la caja cierra en 340ms,
así el texto se va **antes** de que el espacio desaparezca y no se ve recortarse.

**En horizontal la escasez se da vuelta: sobra ancho y falta alto.** Con ~390px
de alto los 13 grupos no entran, así que la hoja obliga a scrollear justo cuando
la pantalla ya es un pasillo, y el velo tapa una superficie que tiene poca altura
útil. El rail cuesta 3.1rem —el 6% de la pantalla— y a cambio **desaparecen el
velo, la hoja y el gesto de abrir**. O sea que **no es «una variante móvil» sino
dos, y la elige la orientación, no el tamaño de pantalla.**

### 12.5 El menú de configuración: sigue al sidebar, con opacidad de flotante

Es un popover **anclado al sidebar**, así que es una extensión suya y usa su
material: mismo tono, mismo canto, mismo destello. La regla de hoy dice
«bespoke oscuro, nunca tokens» — **el principio no cambia** (el popover sigue al
sidebar), lo que cambia es a qué obliga ahora que el sidebar sigue el tema.

Pero **flota sobre contenido arbitrario**, así que necesita la opacidad de una
capa flotante, no la de la superficie: con la del sidebar, el texto de atrás se
lee a través. Es exactamente lo que §5.3 fijó para menú y modal — **mismo
criterio, otro número**.

```css
:root               { --cfg-bg: rgba(233,231,247,.94); }
[data-theme="dark"] { --cfg-bg: rgba(9,11,22,.94);     }
```

**Y un detalle de apilamiento que costó encontrar:** el popover vive dentro del
contexto de apilamiento del sidebar (`isolation:isolate`), y sidebar y contenido
son hermanos posicionados sin `z-index` — así que ganaba el que va después en el
DOM y **el popover quedaba detrás de la tarjeta**. El sidebar necesita
`z-index: 2` contra el `1` del contenido.

### 12.6 ⚠️ Un `backdrop-filter` es la RAÍZ del backdrop de sus descendientes

El hallazgo más reutilizable de la fase B, y explica por qué la app real portalea
sus popovers anclados.

**Síntoma:** el flyout del modo compacto y el menú de configuración se veían con
el texto del contenido de al lado **nítido detrás**, pisando el suyo. El
`backdrop-filter` estaba aplicado —`blur(44px) saturate(2)`, verificado en el
estilo computado— y no hacía nada.

**Causa:** un elemento con `backdrop-filter` se convierte en **backdrop root**
para sus descendientes. El sidebar es vidrio, así que un flotante *adentro* sólo
puede desenfocar lo que está **dentro del sidebar**: el contenido de al lado
nunca entra a su muestra, y como el flotante es translúcido, se transparenta
sobre él sin desenfocarlo. No hay opacidad que arregle eso — sólo taparlo del
todo, que es perder el vidrio.

**La regla:** *un flotante que necesita desenfocar lo que hay detrás no puede
vivir dentro de otra superficie con `backdrop-filter`.* Va portaleado. Es de la
misma familia que «`transform` mata `backdrop-filter`» (§1.6): **el contexto de
apilamiento define qué puede ver una capa**, y las dos trampas se manifiestan
igual — el efecto está escrito, se computa, y no se ve.

### 12.7 La opacidad del flotante: se corrigió una sobrecorrección

Primero le puse `0.94` al popover para que el texto se leyera. **Eso mata el
vidrio, y es justo el camino que §4.1 descarta**: ahí ya estaba medido que subir
la opacidad de `0.58` a `0.76` gana **0.22 y sigue fallando**, y que lo que
arregla el texto es llevarlo a `--content` pleno.

Con el flotante portaleado y a opacidad de vidrio, medido sobre el fondo
dominante del popover: **12.52:1 en claro y 17.65:1 en oscuro** — muy por encima
de AA. La sobrecorrección no sólo era fea: era innecesaria.

```css
:root               { --cfg-bg: rgba(236,234,250,.62); --cfg-txt: var(--content); }
[data-theme="dark"] { --cfg-bg: rgba(10,12,26,.66);    --cfg-txt: var(--content); }
```

> **Nota de medición:** el contraste del texto sobre una superficie de vidrio se
> mide contra el **color dominante** (la moda) del área, no contra el píxel más
> oscuro que se encuentre: a esta resolución el muestreo no distingue un glifo
> antialiaseado de un fondo, y da 1.00:1 sobre el texto mismo.

### 12.6 La fluidez, medida

Banco de §6 —CPU estrangulada por CDP, muestreo por cuadro, tres ciclos:

| gesto | CPU ×1 | ×4 | ×6 |
|---|---|---|---|
| compactar / expandir | 16.7ms · 0 malos | 16.6ms · 0 | 16.7ms · 0 |
| hoja móvil | 16.7ms · 0 | 16.7ms · 0 | 16.7ms · 0 |
| el destello por filas | 16.7ms · 0 | 16.7ms · 0 | 16.7ms · 0 |

**60fps sostenidos en las tres hasta CPU ×6**, p95 bajo 17.6ms, cero cuadros
sobre 33. **Salvedad:** es Chromium headless, el mismo banco que usó §6, y el
repo tiene anotado que *headless miente sobre rendimiento*. Al implementar hay
que repetirlo en un navegador real y, para el móvil, **en WebKit**.

---

## 13. ⚠️ El inventario que este plan nunca hizo

Levantado el 2026-08-05, a pregunta del usuario: *«¿ya están todos los elementos?
¿tablas, alertas…?»*. **No.** Y el motivo importa más que la lista: el plan fue
elemento por elemento **a partir de una lista que nadie verificó** — es el mismo
modo de falla que ya apareció dos veces acá (los alias de íconos que no eran
alias, el `1.30` de §1.1 que no se podía reproducir).

### 13.1 Las superficies canónicas: 10 declaradas, 7 cubiertas

`index.css` declara **10** `data-surface`. El plan trata siete:

| superficie | usos en JSX | ¿en el plan? |
|---|---|---|
| `card` | 227 | ✅ §1 |
| `dropdown` | 22 | ✅ §4 |
| `tooltip` | **16** | ✅ **§14** (cerrado el 2026-08-05) |
| `input` | 10 | ✅ §3 |
| `modal` | 7 | ✅ §5 |
| `sidebar-popover` | 3 | ✅ §12.5 |
| `page-header` | **2** | ❌ **falta** |
| `sidebar` | 1 | ✅ §12 |
| `tab-track` | 1 | ✅ §11 |
| `sheet` | **1** | ❌ **falta** (§12.4 lo describe como hoja móvil, pero no como superficie con material) |

**`tooltip` es el hueco más grande.** Tiene tokens propios desde la decisión 1a
—es oscuro en los cuatro temas— pero el plan **nunca le dio canto, lente ni
destello**, y con 16 usos es la tercera superficie más usada del portal.

### 13.2 Lo que el usuario preguntó, respondido

- **Tablas: cubiertas.** `DataTable` usa `data-surface="card"`, así que hereda
  §1 completo. No necesita sección propia.
- **Alertas: a medias.** `AlertModal` usa `data-surface="modal"` ✅, pero
  **`ConfirmModal` no declara ninguna superficie** — es un modal que el sistema
  no sabe que es un modal.
- **`Notice` y `Badge` no declaran superficie.** Puede ser correcto —un chip es
  tinta, no vidrio— pero **no está escrito en ningún lado**, y lo que no está
  escrito se vuelve a preguntar.

### 13.3 El hallazgo grande: hay un segundo sistema de vidrio corriendo en paralelo

| | |
|---|---|
| usos de `backdrop-blur` en el portal | **243** en 81 archivos |
| de ésos, en archivos **sin ninguna superficie canónica** | **88** en 29 archivos |
| de ésos, ya reconocidos como bespoke en `EXCEPTIONS` | 60 en 15 archivos — legítimo |
| **vidrio que no es ni canónico ni excepción** | **28 en 14 archivos** |

Y el primero de esa lista duele: **`ModalShell` — el canónico de modales— tiene
4 `backdrop-blur` propios**. O sea que el componente que define cómo se ve un
modal no usa la superficie de modal.

Los otros 13: `WidgetInventorySearch` (7), `TabLaboratorios` (4),
`TabMinMaxNetwork`, `TabPoliticaVencimiento` (2 c/u), y ocho con uno cada uno.

### 13.4 Qué hay que hacer con esto

1. ~~**Definir `tooltip`**~~ ✅ **hecho — §14.**
2. **Definir `page-header` y `sheet`**, o declarar por escrito que heredan de
   `card` y no llevan material propio.
3. **`ConfirmModal` declara `data-surface="modal"`.**
4. **Escribir qué NO es material** — `Notice`, `Badge`, chips: son tinta sobre
   una superficie, no superficies. Una frase alcanza, y evita la pregunta.
5. **`ModalShell` usa la superficie de modal** en vez de su vidrio a mano.
6. **Los 28 restantes**: cada uno pasa a una superficie canónica o entra a
   `EXCEPTIONS` con su motivo escrito — el mismo tratamiento que F6 de
   PLAN-IDENTIDAD le dio a los hex.

> **Y la lección de método, que vale más que los seis ítems:** un plan que
> recorre «elemento por elemento» necesita que **la lista de elementos salga de
> un registro**, no de la memoria de quien lo escribe. Acá el registro existía
> —los `data-surface` de `index.css`— y nadie lo consultó. Es la misma regla que
> el repo ya tiene escrita para otros casos: *una lista a mano se desincroniza
> del registro*.

---

## 14. Tooltip ✅ CERRADO 2026-08-05

La superficie que §13 destapó. Sus tokens existen desde la **decisión 1a**
(`--tooltip-bg`, `-border`, `-text`, `-text-2`, `-radius`, `-backdrop`, `-shadow`)
y ya son por tema; lo que faltaba era **el material**: canto, lente y destello.

**Es oscuro en los cuatro temas** — como el sidebar *antes* de §12. Acá esa
condición se conserva: un tooltip no es una superficie de la pantalla, es una
nota flotando encima, y ésa fue la razón original de la decisión 1a.

**Dos cosas que hereda de decisiones ya tomadas y no se rediscuten:**

1. **Su canto es FIJO, no recorre.** §5.1 lo fijó para el modal: en una pieza
   donde *se lee u opera adentro* la luz viene de la escena y se queda quieta; el
   destello que recorre es para lo que *se apunta*. **Un tooltip se lee.**
2. **Su canto lleva tokens propios**, como el sidebar en §12.2, porque el tooltip
   tampoco sigue el tema. Si usara los del tema activo, en claro le tocarían
   valores calibrados para fondos claros sobre su navy — **exactamente el defecto
   que §1.7 corrigió en el lente**.

### 14.1 A `0.86` el tooltip no se leía como vidrio

`--tooltip-bg` valía `rgba(13,20,48,0.86)`. **Sí dejaba pasar el fondo, pero
apenas**: medido con dos objetos saturados detrás, el píxel del tooltip cambiaba
**1.125:1** entre uno y otro, contra el **1.00** de Solid, que es opaco. La
diferencia existía y no se veía — o sea que el `blur(20px)` era decorativo.

| opacidad | el fondo se ve |
|---|---|
| 0.55 | 1.709:1 |
| **0.70** | **1.390:1** ✅ elegido |
| 0.86 *(antes)* | 1.125:1 — indistinguible de opaco |
| 0.94 | 1.047:1 — ya no pasa nada |

Baja a **`0.70`** (y `0.74` en el tema oscuro, que parte de un navy más claro).
El texto no sufre: es blanco al 95% sobre navy.

**Y sí es vidrio, no transparencia.** Son cosas distintas y hay cómo separarlas:
el vidrio **desenfoca** lo de atrás, la transparencia lo **deja pasar tal cual**.
Medido como energía de borde (cuánto cambia un píxel respecto al de al lado) de
un texto puesto detrás:

| lo que hay encima del texto | energía de borde |
|---|---|
| nada | 16.17 — nítido |
| sólo `rgba(…,.70)`, sin blur | **4.84** — se leería a través |
| **`.70` + `blur(20px) saturate(180%)`** | **0.03** — la forma desaparece |
| Solid, opaco | 0.00 |

O sea: **transmite color pero no detalle**. Eso es vidrio esmerilado, que es
exactamente lo que tiene que ser — y es la razón de que a `0.86` pareciera
opaco: el blur ya borraba la forma, y con tan poca opacidad tampoco pasaba
color, así que no quedaba **nada** que delatara el material.

### 14.2 El destello corre AL ABRIRSE, no al apuntar

§5.1 fija que el canto de una pieza donde *se lee* es fijo — pero eso habla de su
**reposo**, no de su **llegada**. Y un tooltip **no se puede apuntar**: si el
barrido colgara del hover no correría nunca. Corre **una vez al aparecer** y se
queda quieto.

Es un matiz de §5.1 que sólo aparece en piezas que nacen del hover *de otra
cosa*: el modal se abre por un clic y puede animar su llegada como quiera; el
tooltip aparece solo, y su única oportunidad de mostrar material es ese instante.

```css
/* el canto del tooltip NO sale del tema: la superficie es siempre oscura */
--tooltip-rim-base:  rgba(255,255,255,.16);
--tooltip-rim-glint: #ffffff;
--tooltip-rim-bloom: rgba(160,200,255,.75);
[data-theme="solid"], [data-theme="solid-dark"] {
  --tooltip-rim-glint: rgba(255,255,255,.10);   /* Solid no destella */
  --tooltip-rim-bloom: transparent;
}
```

---

## 15. Tabla y paginación

### 15.1 La tabla NO era vidrio sobre vidrio — pero su encabezado no ocluye

**Buena noticia primero:** `DataTable` **ya cumple §1.5 sin saberlo**. Es *una*
placa (`data-surface="card"`) con las filas separadas por `divide-y divide-divider`
— no son tarjetas anidadas. No hay vidrio sobre vidrio que corregir, y por eso las
tablas no necesitan sección de material propia: heredan §1 entero.

**El defecto está en otro lado.** El `thead` es `sticky top-0` con
`theadBg: 'bg-brand/[0.04]'` — **4% de tinte sobre una placa que ya es
translúcida**. Cuando las filas pasan por debajo **se leen a través del
encabezado**, y los dos textos se pisan.

No es un descuido de tema: ese tinte se pensó como **acento** —marcar que la fila
de títulos es distinta— no como **oclusión**. Son dos trabajos y sólo se hizo uno.

**El arreglo respeta §1.5:** el encabezado es una región de la placa, así que
lleva escalón de tono con la dirección invertida por tema —oscurece en claro,
aclara en oscuro— pero **opaco**, porque además tiene que tapar. Es el mismo
token que la fila anidada llevado a la opacidad que el trabajo exige.

```css
:root               { --thead-bg: rgba(228,230,244,.97); }
[data-theme="dark"] { --thead-bg: rgba(20,28,58,.97);    }
[data-theme="solid"]{ --thead-bg: #eef1f7;               }
```

> **La regla, que vale más allá de la tabla: una superficie pegajosa tiene una
> obligación que una superficie normal no tiene — tapar lo que pasa por debajo.**
> Ninguna opacidad pensada para *acento* sirve para *oclusión*. Al implementar,
> revisar toda otra superficie `sticky` con el mismo criterio.

### 15.1.bis La tabla vive dentro del cuerpo de vista, que TAMBIÉN es vidrio

Levantado por el usuario: *«normalmente una tabla está bajo un body que es otro
vidrio»*. Es cierto — `GlassViewLayout` le pone `data-surface="card"` al cuerpo
cuando no es `transparentBody` ni móvil. Así que la tabla es **vidrio sobre
vidrio a nivel de vista**, un nivel más arriba del que §1.5 tenía en mente.

**Y §1.5 ya lo resuelve.** Medido **en la app**, no en un mockup: `/dashboard`
a 1440×900, píxeles compuestos de la fila contra el cuerpo que la contiene,
con y sin la regla inyectada.

| | hoy | con §1.5 | texto |
|---|---|---|---|
| Liquid claro | ΔE 9.15 — nítido | 10.44 | 8.93:1 → 7.62:1 |
| **Liquid oscuro** | **ΔE 4.37 — apenas** | **11.48** ✅ | 12.51:1 → 10.95:1 |

**No hace falta ninguna regla nueva**: es la verificación de que la regla de la
anidada sirve para *cualquier* superficie dentro de otra, no sólo para una fila
dentro de una tarjeta. Vale la pena que quede escrito, porque §1.5 se redactó
mirando el caso chico.

**El mockup se equivocaba sobre el tema claro.** Ahí daba ΔE 5.3 («apenas») y en
la app real da 9.15 — o sea que en claro **nunca hubo problema**; el caso es
**sólo el oscuro**, donde la fila y el cuerpo comparten el mismo navy y lo único
que las separa es la línea divisoria. El mockup acertó el diagnóstico y erró la
extensión: una superficie sintética no reproduce lo que hay detrás del vidrio
real, y el vidrio compone contra eso.

*(El contraste del **texto** nunca fue el problema: 12.51:1 hoy y 10.95:1 con la
regla, las dos muy por encima de AA. Lo que fallaba era que las **superficies**
se fundieran, y para eso el instrumento es ΔE, no el ratio. Ver §12.2.)*

### 15.2 Paginación: ya estaba bien

Es una **placa hermana** de la tabla, no una región adentro — `DESIGN.md` §14 ya
manda que vaya como hermana suelta y nunca envuelta. Así que **no aplica §1.5**:
le corresponde el material completo de §1 (vidrio, canto, lente, destello), y sus
botones son regiones adentro que sí siguen la regla de la anidada.

**No necesitó ninguna regla nueva** de material, y por eso vale la pena que esté
escrito: es la prueba de que el sistema ya cubre casos que nunca se miraron.

**Lo único que sí hay que fijar es su alineación.** Hoy queda pegada a una
esquina, que no es ni una cosa ni la otra. Dos disposiciones válidas, y hay que
elegir una:

**Elegida por el usuario el 2026-08-05: la DISTRIBUIDA.**

| | cómo | |
|---|---|---|
| Centrada | la píldora se alinea al medio del ancho de la vista | descartada |
| **Distribuida** | tres zonas — `cuántas páginas · pasar página · cuánto hay` | ✅ **elegida** |

La distribuida es una **grilla de tres columnas `1fr auto 1fr`**, no un
`space-between` de dos bloques: así el paginador queda en el centro **real** del
ancho y no se corre según lo largo que sea el texto de los costados.

```css
.paginacion { display:grid; grid-template-columns:1fr auto 1fr; align-items:center }
.paginacion > :first-child { justify-self:start }   /* 52 páginas   */
.paginacion > :nth-child(2){ justify-self:center }  /* ‹ 1/52 ›     */
.paginacion > :last-child  { justify-self:end }     /* 1,284 items  */
```

Nunca pegada a un borde sin ocupar el ancho — eso lee como un elemento que se
quedó donde cayó.

---

---

## 16. Encabezado flotante — su hover es ciego al tema ✅ CONFIRMADO 2026-08-05

Todo el material de `page-header` sale de tokens por tema. **Su hover no:**

```css
[data-surface="page-header"]:hover {
  box-shadow: 0 32px 64px -12px rgba(0,0,0,0.22);   /* ← a mano, en los 4 temas */
  transform: translateY(var(--lift-hover));          /* ← este sí es token: -1px / 0px */
}
```

En Liquid encaja. En **Solid** la sombra de reposo es `0 1px 4px rgba(0,0,0,.08)` y al pasar el
mouse salta a una sombra de vidrio de 64px que no pertenece a ese material. Es el modo de falla
de §1.7 otra vez —**un valor calibrado en un tema, guardado como universal**— y van cuatro.

**Confirmado por el usuario el 2026-08-05.** La propuesta va más fuerte que tokenizar
la sombra: **el encabezado no reacciona al mouse en ningún tema.** §1.6 fijó que el hover de una superficie es el destello del canto, y eso vale para lo
que *se apunta*. El encabezado no se apunta: se **cruza** para llegar a un control. Hoy
cualquier viaje del mouse hacia el buscador levanta la barra entera. Lo que sí reacciona es cada
control de adentro, que es lo que la persona está buscando.

Si se prefiere conservar el gesto, la alternativa es un token `--header-shadow-hover` con valor
por tema — pero entonces hay que responder qué significa «apuntar» una barra que ocupa el ancho
de la pantalla.

---

## 17. Hoja táctil — paga por vidrio y por opacidad, y no cobra ninguno ✅ CONFIRMADO 2026-08-05

`--surface-sheet` vale `0.985` **y encima declara `blur(20px)`**. El comentario que lo acompaña
dice *«sigue siendo vidrio — el blur está»*. **Medido, no:** a esa opacidad el fondo cambia el
píxel **1.012:1**, y el umbral de lo indistinguible de opaco es 1.00. Y es la superficie más
cara del portal para llevar un blur: cubre **80% de la pantalla de un teléfono**.

| configuración | pasa color | fantasma del texto | lectura |
|---|---|---|---|
| sin hoja (referencia) | — | 10.228 | el texto de atrás se lee entero |
| 0.72 **sin** blur | — | **2.853** | fantasma legible — **esto es el bug que se reportó** |
| **0.72 con blur** | 1.176:1 | **0.018** | nada se transparenta |
| 0.985 sin blur | 1.001:1 | 0.176 | fantasma tenue |
| 0.985 con blur *(hoy)* | 1.012:1 | 0.020 | igual que 0.72 con blur, pero sin material |

**El renglón que decide es el segundo.** Con el blur puesto, 0.72 oculta el fondo *igual de bien*
que 0.985 —0.018 contra 0.020, y medido en Chromium **y en WebKit** con la estructura real de
`FilterBar`, los dos motores dan lo mismo—. O sea que la opacidad de 0.985 no defiende contra la
transparencia: defiende contra **que el blur no se aplique**, que es el único estado donde el
texto se lee.

**No pude establecer por qué el blur no actuaba** cuando se reportó el bug en el iPhone 13
(v2.100.0, 2026-07-27): la hoja usaba `data-surface="modal"`, o sea que tenía blur, y el prefijo
`-webkit-` está presente en el CSS compilado de las **diez** superficies (verificado en
`dist/assets/*.css`, que es donde la memoria del proyecto dice que hay que mirar).

### Las dos opciones, y por qué recomiendo la segunda

| | qué es | |
|---|---|---|
| **A · vidrio 0.72** | el material se ve en un teléfono | ⚠️ reabre una configuración cuyo fallo no entendemos |
| **B · opaca 1.00 sin blur** | idéntica a hoy a la vista | ✅ **recomendada** |

**Y el mockup destapó un efecto lateral que no había previsto: a 0.72 la hoja se ve gris sucio,
no como vidrio.** El motivo es estructural — el velo que oscurece la app es **hermano** de la
hoja y queda *detrás* de ella, así que forma parte de su backdrop; una hoja translúcida sobre un
velo al 45% muestrea el velo. Para que A se viera como vidrio habría que sacar la hoja de encima
del velo, o sea rehacer la estructura del modal.

**Confirmada la B por el usuario el 2026-08-05**: a la vista no cambia nada (a 0.985 ya se ve
opaca) y quita un blur de pantalla completa del dispositivo donde más cuesta. Se implementa en
la Fase D; la auditoría móvil —que el usuario decidió hacer aparte y después— puede revisarla,
pero con el blur ya fuera no hay nada que se vea distinto para revisar. Lo que **no** es defendible es quedarse en `0.985 +
blur`, que paga los dos costos y no cobra ninguno.

> **La regla general, que es la del tooltip vista al revés:** antes de poner un
> `backdrop-filter`, comprobar que la opacidad **deja pasar algo**. Un blur bajo una superficie
> opaca no es un adorno caro: es un costo invisible que nadie va a encontrar leyendo el CSS,
> porque ahí *parece* que hay vidrio.

---

## 18. Dos afirmaciones de §13 eran falsas — y comparten la causa

§13 se escribió cruzando los `data-surface` de `index.css` contra un grep **por archivo**. Ese
cruce **no ve la composición**.

| §13 afirmaba | lo que dice el código |
|---|---|
| *«`ModalShell` tiene 4 `backdrop-blur` propios; el componente que define cómo se ve un modal no usa la superficie de modal.»* | **Tiene uno**, y va en el **velo** (`bg-scrim backdrop-blur-sm`), que no es superficie sino el fondo que se oscurece. Y sí declara `data-surface={surface}` con `"modal"` por defecto. ❌ |
| *«`ConfirmModal` no declara ninguna superficie.»* | Sus **dos** caminos la declaran: escritorio monta `ModalShell` sin prop (→ `"modal"`); táctil monta `ModalShell surface={null}` con `HojaMovil`, que trae la suya. ❌ |

> **La lección es una variante de la que §13 ya había escrito.** Allá el problema era que la
> lista no salía del registro. Acá el registro **sí** se consultó — lo que falló fue **leerlo por
> archivo en vez de por árbol de render**. En un sistema donde la superficie se hereda del
> envoltorio, `grep data-surface` sobre un archivo responde una pregunta distinta de la que uno
> cree estar haciendo: no dice «¿esta pieza tiene material?», dice «¿esta pieza lo declara *ella
> misma*?».

### 18.1 No eran 28: son 196 — y el error tiene la MISMA causa ✅ REGLA ACTIVA

Al escribir el detector quedó claro que «28 en 14 archivos» también estaba mal, y
**por el mismo motivo que las dos afirmaciones de arriba**: ese número contaba sólo los
archivos donde *ninguna* pieza declaraba superficie. Un archivo que tiene una tarjeta
canónica y además cuatro vidrios a mano no aparecía. Contando **por elemento**, que es
la unidad real:

| grupo | vidrios a mano | archivos |
|---|---|---|
| vistas | **115** | 42 |
| el kiosco (`timeclock/*`) | 26 | 6 |
| `components/forms/*` | 25 | 14 |
| `LoginView` | 17 | 1 |
| `components/common/*` | 9 | 7 |
| `components/layout/*` | 4 | 1 |
| **total** | **196** | **71** |

Van **tres** correcciones a §13 y las tres son la misma: *leer por archivo lo que se
compone por árbol*. Que el número se haya multiplicado por siete al mirarlo bien es el
argumento más fuerte a favor de que esto sea un gate y no un párrafo.

**La regla está activa: categoría `vidrio-a-mano` en `scripts/design-gate.mjs`.**
Marca todo `backdrop-blur*` / `backdrop-filter` en JSX cuyo tag contenedor no declare
`data-surface`. Dos cosas no son hallazgo, y el motivo está escrito en el gate:

- **el velo de un modal** (`bg-scrim`) — no es superficie, es el fondo que se oscurece,
  y ahí el blur es el patrón correcto (`ModalShell`);
- **el elemento que ya declara `data-surface`** — ahí el blur es redundante, no un
  sistema paralelo: lo pisa la superficie canónica.

El tag se resuelve con `tagQueContiene`, que cuenta llaves y comillas. Un `[^>]*` se
corta en el primer `>` y `=>` vive adentro de casi todo `onClick`: sería ciego justo a
los tags que traen lógica.

#### Cómo quedó repartido

| | | |
|---|---|---|
| `LoginView` (17) + kiosco (26) | **43** | **excepción con motivo** — no son deuda |
| chips tintados de `WidgetInventorySearch` | **3** | **corregidos** — §18.2, la tinta no lleva vidrio |
| el resto | **150** | **ratchet**: no puede subir, y baja fase por fase |

`LoginView` y el kiosco son **excepción y no ratchet a propósito**: el ratchet dice
«esto hay que bajarlo», y estas dos no hay que bajarlas nunca — son las pantallas que
viven **fuera del shell** y por eso no pueden heredar su material. Confundirlas con
deuda es lo que haría que alguien las «arreglara» rompiéndolas.

#### Por qué los 150 restantes NO se convierten hoy

Al mirarlos uno por uno, casi ninguno es una tarjeta canónica mal escrita:

- **Son paneles anidados.** `rounded-2xl` compila a `0.625rem` y `--card-radius` vale
  `1.75rem` en Liquid: ponerles `data-surface="card"` los convertiría en tarjetas de
  primer nivel, que es justo lo que **§1.5 dice que no deben ser**. Su destino es
  aplanarse con `--anidada`… **y ese token todavía no existe** — §1.5 es decisión, no
  código.
- **Varios usan el borde para señalar estado** (`border-chart-9/30` cuando está
  abierto). `data-surface` gana la cascada, así que convertirlos apagaría la señal.
- **Dos son encabezados pegajosos dentro de un modal** (`RecepcionModal`), o sea el
  caso que §15.1 ya nombró: una superficie pegajosa tiene que **ocluir**, y
  `bg-surface-card` es una opacidad de acento.

O sea que los 150 **no son una lista de arreglos sueltos: son el trabajo de la Fase D**,
y el ratchet es lo que garantiza que no crezcan mientras tanto.

### 18.2 Lo que faltaba escribir sobre lo que NO es material

**`Notice`, `Badge` y los chips no son superficies, son tinta.** Se apoyan sobre una superficie y
toman su color de la paleta semántica; no llevan canto, ni lente, ni destello, ni
`backdrop-filter`. **No declarar `data-surface` es lo correcto para ellos** — lo que faltaba no
era el atributo, era la frase.

---

---

## 19. Lo que la implementación enseñó (2026-08-05, v2.405→v2.419)

Las fases C–H se ejecutaron y el usuario revisó el resultado en pantalla, tema por
tema. Salieron **nueve correcciones**, y ocho de ellas comparten dos causas. Esta
sección existe porque esas dos causas valen más que las nueve correcciones.

### 19.1 ⚠️ La causa que apareció TRES veces: el tema que falta es el oscuro

| qué | valor heredado del tema claro |
|---|---|
| el lente (§1.7) | `--lente-top: .62` → en oscuro lavaba la superficie |
| `--sidebar-rim` | `0.42` de blanco → contorno blanco en panel, flotante y menú |
| **once tokens de sombra** | `inset … rgba(255,255,255,.4–.95)` en toda la escala `--shadow-glass-*` |

Los tres son **un valor calibrado sobre una superficie clara, guardado en `:root`,
redefinido en Solid, y nunca en `[data-theme="dark"]`.**

**Y lo que los disfraza es justamente que Solid sí los redefine.** Leyendo el archivo
parecen tokens con tratamiento por tema. La pregunta que yo me hacía —«¿este token
cambia por tema?»— devolvía *sí*. La pregunta correcta es **«¿cambia en los cuatro?»**.

> **Esto es detectable automáticamente y es el único de los modos de falla de esta
> sesión que lo es.** ✅ **Gate `tema-incompleto` activo, en 0 y bloqueante**: marca un
> token con color fuerte definido en `:root`, redefinido en algún bloque Solid, y
> **ausente de `[data-theme="dark"]`**.

**Que Solid lo redefina es la condición, no un detalle.** Si nadie lo redefine, el token
es geometría o tiempo —un radio, un blur, una duración— y compartir valor entre claro y
oscuro es lo correcto: un primer intento sin esa condición marcaba 28 tokens, casi todos
radios y desenfoques que **deben** compartirse. Lo que delata a un token de color es que
alguien ya decidió que su valor depende del material.

Umbral: **alfa ≥ .30 o un hex**. Por debajo de .30 el valor es un matiz y heredarlo
entre claro y oscuro rara vez se nota.

Al activarlo quedaba **un solo caso vivo** —`--sidebar-item-hover-shadow`—, que se
cerró. Verificado contra una sonda sintética: muerde ahí y calla sobre el archivo real.

### 19.2 La causa que apareció CINCO veces: la dirección del realce la manda el fondo

`--anidada` (§1.5), el tinte del sidebar, el lente, el canto y el realce del hover: en
los cinco la corrección fue la misma frase. **Un realce claro sobre una superficie
clara no existe, y uno oscuro sobre una oscura tampoco.**

Pero hay un matiz que costó dos vueltas y conviene dejar escrito, porque la regla
ingenua («en claro oscurecer, en oscuro aclarar») **es falsa**:

| superficie | dirección | por qué |
|---|---|---|
| la anidada (§1.5) | oscurece en claro | **se hunde** un paso |
| el panel del sidebar | **aclara** en claro | **flota** sobre la página |
| el realce del hover | **aclara siempre** | apoyar el dedo sobre vidrio deja pasar **más** luz |

**La dirección la decide el ROL de la superficie, no el tema.** Lo que el tema decide es
la *base* sobre la que se aplica.

### 19.3 El canto: tres correcciones y una regla

1. **El destello no llegaba casi a ningún lado.** Colgaba de `[data-interactive]` —29
   sitios—; después se marcaron 53 a mano y seguían faltando el avatar, el de salir, el
   buscador y todo el menú de ajustes. **Tres rondas de «te faltaron éstos» son la señal
   de que el criterio está mal, no la lista.** El registro de lo que es interactivo ya
   existe en el DOM: `button`, `a[href]`, `[role="button"]`. Hoy son **108 controles**
   dentro de superficies de vidrio, sin lista que mantener.
2. **`:hover` sube por el árbol.** Con el canto en todas partes, apuntar una fila barría
   la fila, la tabla, el cuerpo de vista y el sidebar. La guarda es
   `:not(:has(:is([data-surface],[data-interactive],button,a[href],[role="button"]):hover))`.
   **Son dos problemas distintos con dos soluciones distintas:** `inherits: false` en
   `--rim-ang` impide que el ángulo **baje**; el `:not(:has(…))` impide que el hover
   **suba**.
3. **El contraste vive DENTRO del anillo.** El destello se veía sólo por su bloom —un
   `drop-shadow`—, así que bastaba un `overflow: hidden` para borrarlo: el botón de
   salir y el buscador lo tienen, y eran justo los dos que no mostraban nada. Ahora el
   anillo lleva `--rim-sombra`, un flanco oscuro pegado al destello.

> **Un efecto que depende de que nada lo recorte no es un material, es un truco.**

**§10.2 queda resuelta acá, y no en una tabla.** El arco blanco competía contra lo que
hubiera detrás del panel translúcido: medido en Liquid claro, su contraste local iba de
**1.60:1 a 1.03:1** según la zona del fondo. El flanco se lo lleva puesto, así que ya no
depende del peor fondo — que era exactamente lo que §10.2 pedía verificar.

Valores finales del canto: arco del **10%** del perímetro (era 6%: en un ítem ancho un
6% es un punto que pasa demasiado rápido), anillo de **1.5px** en los dos Liquid,
`--rim-bloom: transparent` en todos.

### 19.4 Dos reglas de implementación que costaron una regresión cada una

**Una utilidad transversal nunca fija `position` sobre una superficie que existe PARA
estar posicionada.** Para anclar el destello se le puso `position: relative` a los
cuatro flotantes, y un flotante es `fixed` con su `top`/`left` calculados en JS: el menú
de Ajustes abría en **y = 1420 con la ventana en 960**. Sin error de consola, sin fallo
de build, sin hallazgo de gate — el elemento existía, tenía tamaño y el DOM lo reportaba
visible. Sólo estaba en otro lado.

**Un migrador por regex tiene que contemplar las alfas entre corchetes.**
`border-white/[0.07]` quedó como `border-[rgb(var(--sidebar-ink))]/[0.07]`, clase
inválida que Tailwind descarta en silencio: **30 clases en 4 archivos**, y compilaba
igual. Un borde que desaparece no rompe el build.

### 19.5 ⚠️ Método: tres instrumentos mintieron

Vale escribirlo porque los tres parecían razonables:

1. **Colores computados sobre una superficie translúcida.** `getComputedStyle` devuelve
   `rgba(...,0.15)`; al parsearlo se pierde la alfa y se lee como un sólido oscuro.
   Dictaminó «texto ilegible» sobre un panel perfectamente legible. **Para superficies
   translúcidas se miden píxeles compuestos.**
2. **Muestrear el anillo 1 px bajo el borde.** El `::after` va por **dentro** del
   `border` propio del elemento, así que se estaba midiendo el borde. Devolvió números
   **idénticos byte a byte** antes y después de un cambio real de CSS — y ese
   «idéntico» fue la única señal de que el instrumento estaba roto.
3. **Aislar el anillo por diferencia con el no-hover.** El hover cambia **todo** el
   elemento, así que los píxeles «que cambiaron» incluyen fondo y texto: terminó
   midiendo texto contra fondo y reportando 6:1 donde no había nada que ver.

> **Un diff de píxeles sobre algo que se mueve *y* cambia de fondo miente en las dos
> direcciones.** En los tres casos lo que cerró la cuestión fue **mirar la captura**. Y
> en dos de los tres el instrumento reportó *éxito* donde no lo había, que es el error
> más caro: el que no se investiga.

### 19.6 Y una corrección mía contra una medición vencida

En v2.416.1 invertí el destello a un arco **oscuro** en tema claro, razonando que un
arco blanco sobre superficie clara no se ve. Era cierto **cuando el panel era casi
blanco** — pero tres versiones antes yo mismo lo había cambiado a lavanda
`rgb(183,187,206)` justamente para que no se viera sucio, y sobre eso el blanco
contrasta de sobra.

**Apliqué una regla correcta contra una medición vencida. La física no cambió; cambió
la superficie.** Cuando un valor se decide midiendo, la medición hay que rehacerla el
día que se toca la superficie sobre la que se midió — y el que la tocó fui yo.

---

## Referencias

- Mockup de Liquid Glass, capa por capa · `claude.ai/code/artifact/33d118ae-ab63-422c-bb5a-f397b3dab434`
- Mockup de Solid · `claude.ai/code/artifact/ca3c7aa1-d223-400d-863c-40d753287937`
- Mockup del botón · `claude.ai/code/artifact/d46fc8d4-1297-499b-9f97-b0655a7f7eb0`
- Mockup del campo · `claude.ai/code/artifact/5103da29-f54d-4d95-85d3-89a3630c3e9b`
- Mockup del select abierto · `claude.ai/code/artifact/02c65fc4-24a7-4d6e-9be3-3e6a614b15e0`
- Mockup del modal (paso 6) · `claude.ai/code/artifact/a502c611-3498-476f-ac3e-cd533bcb7985`
- **Mockup consolidado de revisión — los 5 elementos con sus valores finales,
  sobre el que el usuario confirmó el 2026-08-05** ·
  `claude.ai/code/artifact/e9834d18-d35e-489c-adb7-9d7f4da21db1`
- **Tooltip, tabla y paginación** (§14, §15) ·
  `claude.ai/code/artifact/783e03f8-9b2c-42e6-9d5e-83abee19bb9c`
- **Pestañas con hover y las dos propuestas de sidebar** (§11, §12) ·
  `claude.ai/code/artifact/bcd95723-aeff-4062-a910-61380da312ff`
- **Sidebar: contraste medido con ΔE, las 4 variantes, el menú de configuración
  y el banco de fluidez** (§12) ·
  `claude.ai/code/artifact/c5a38bd9-97ef-476b-a573-d196af0bf7e9`
- **El alcance del vidrio — vidrio sobre vidrio, claro y oscuro** (§1.5) ·
  `claude.ai/code/artifact/ec8ca176-9cff-4239-846f-93d0d2af621f`
- **Vidrio líquido — las tres animaciones, sobre el fondo real con los orbes**
  (§1.6, la elegida es «el filo corre») ·
  `claude.ai/code/artifact/857b127c-f3af-49fa-9e5c-ce39bb6e1a70`
- Banco de movimiento (escala de duraciones) · `claude.ai/code/artifact/5f3e5bd4-19f9-4cdd-9b37-95f856c05427`
- [Apple — Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Refracción con CSS y SVG — kube.io](https://kube.io/blog/liquid-glass-css-svg/) · la refracción real
  (`feDisplacementMap` como `backdrop-filter`) se verificó funcionando en Chromium;
  WebKit headless no renderiza **ningún** `backdrop-filter`, así que no puede
  responder por Safari. Queda como mejora progresiva, nunca como base.
