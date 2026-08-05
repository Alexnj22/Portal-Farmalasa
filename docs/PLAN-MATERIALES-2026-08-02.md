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
| **Elementos sin definir** | **ninguno.** Barra de pestañas (§11) y sidebar (§12) cerrados el 2026-08-05 |
| **Implementado** | nada de los tokens de material. El reloj y la curva **sí** existen (preexistían), y `--lift-card` existe **con otro valor que el confirmado** — ver §0.bis |
| **Bloqueo** | **ninguno.** El alcance del vidrio se cerró el 2026-08-05 (§1.5) y con él cayó la última decisión que frenaba la fase D |

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

### Regla obligatoria del seguimiento del puntero

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

---

## 8. Orden de ejecución

Las fases están ordenadas por **dependencia real**, no por comodidad. Una fase
no arranca sin su bloqueo resuelto, porque si arranca hay que rehacerla.

| # | Fase | Bloqueada por | Se verifica con |
|---|---|---|---|
| **A** | ~~Cerrar el alcance del vidrio~~ ✅ hecho (§1.5) · quedan las 2 mediciones de §10 | — | Quedan escritas acá con su motivo |
| **B** | ~~Definir barra de pestañas y sidebar~~ ✅ **hecho** (§11 y §12) | — | Sus secciones, con valores y mediciones |
| **C** | El reloj: decidir si crece, y migrar los 89 easings | A | `npm run gate:design` con la categoría nueva en 0 |
| **D** | Tokens de §1-§5 en `index.css`, **en los cuatro temas** | A, B | Captura de los 4 temas por elemento |
| **E** | `data-interactive` en las tarjetas clicables | D | El gel se ve; el gate lo exige |
| **F** | Utilidad de seguimiento del puntero (§6) | D | Banco de 60fps repetido |
| **G** | Remover el barrido (`.sweep`) | D | 0 en `index.css`, JSX y `DESIGN.md` |
| **H** | `DESIGN.md` §2 y §5 + el cambio de contrato de §1.4 | D | El texto y el código dicen lo mismo |

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

| categoría | falla ante |
|---|---|
| `material-a-mano` | un valor de las capas de §1-§5 escrito literal en JSX o CSS en vez de salir de su token |
| `reloj-a-mano` | `duration-N` / `cubic-bezier(...)` literal fuera de `index.css` |
| `puntero-lista` | un handler de `pointermove` que recorra una lista o llame `getBoundingClientRect()` por evento (§6) |

Ninguna va al baseline: una categoría ausente del JSON arranca bloqueante sola.
Por eso la fase C —bajar la deuda existente— va **antes** de que el gate exista.

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
