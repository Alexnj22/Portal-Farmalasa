# Plan de materiales — Liquid Glass y Solid (2026-08-02)

Definición de la identidad de los dos temas, **elemento por elemento**, decidida
sobre mockups interactivos con los tokens reales. Nada de esto está
implementado todavía: este documento es el contrato que la implementación tiene
que cumplir, y se va completando a medida que se cierra cada elemento.

**Estado:** superficie, botón, campo y select/menú CERRADOS · faltan modal, barra de pestañas y sidebar.

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
  --lift-card:      -3px;    /* movimiento al entrar y salir */
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
  --lift-card:   -1px;    /* ver §1.4 */
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

### 1.4 ⚠️ El contrato de §2 hay que cambiarlo

`DESIGN.md` §2 dice hoy, para Solid: *"no se mueve; solo cambia de color"*. El
valor elegido es `--lift-card: -1px`, o sea que **sí se mueve**. Es una decisión
deliberada del usuario y 1px es un guiño, no un salto — pero **el texto del
contrato tiene que cambiar con él**. Dejarlo como está reproduce exactamente el
bug que originó todo este trabajo: una regla escrita que el código viola.

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

## 5. Rendimiento — medido, no estimado

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

## 6. Lo que la implementación tiene que incluir

Cuando se cierren todos los elementos:

- [ ] Tokens de §1 a §4 en `src/index.css`, en los cuatro temas.
- [ ] `data-interactive` explícito en las tarjetas clicables — el gel y el
      hundido no tienen dónde aplicarse sin él. Hoy de **220**
      `data-surface="card"` apenas **3** declaran `onClick`.
- [ ] Utilidad de seguimiento del puntero con las tres reglas de §5.
- [ ] Remover el barrido (`.sweep`): marcado, `index.css` y la sección de `DESIGN.md`.
- [ ] `DESIGN.md` §2 y §5 actualizados, incluido el cambio de contrato de §1.4.
- [ ] Categorías de gate nuevas: que no se pueda clavar un valor de material a
      mano, ni escribir un seguimiento de puntero que recorra la lista.

---

## 7. Decisiones abiertas

**El alcance del vidrio.** Apple limita Liquid Glass a las capas de navegación y
evita explícitamente el «vidrio sobre vidrio». El portal tiene **220**
superficies de vidrio, algunas anidadas — ya se midió que una tarjeta dentro de
otra acumulaba los dos lifts (4px contra 2px), corregido en v2.342.0 con una
regla, pero el apilamiento de material sigue. Falta decidir si el vidrio
completo se reserva para navegación y flotantes, y las tarjetas de contenido
llevan una versión atenuada.

**Contraste.** Una superficie translúcida cambia su relación de contraste según
lo que tenga detrás; es la crítica documentada más seria a Liquid Glass. Al
cerrar los valores hay que medir el texto sobre el peor fondo posible, no sobre
el lienzo del mockup. El portal ya corrigió `--text-tertiary` por este mismo
motivo.

---

## 8. Elementos pendientes de definir

Cada uno se cierra con su mockup y sus valores antes de tocar código:

| elemento | por qué importa |
|---|---|
| Modal | la «gota» tiene tokens propios (340/240ms) |
| Barra de pestañas | `tab-track` es la única otra superficie con lift |
| Sidebar | oscuro en los cuatro temas — caso aparte |

---

## Referencias

- Mockup de Liquid Glass, capa por capa · `claude.ai/code/artifact/33d118ae-ab63-422c-bb5a-f397b3dab434`
- Mockup de Solid · `claude.ai/code/artifact/ca3c7aa1-d223-400d-863c-40d753287937`
- Mockup del botón · `claude.ai/code/artifact/d46fc8d4-1297-499b-9f97-b0655a7f7eb0`
- Mockup del campo · `claude.ai/code/artifact/5103da29-f54d-4d95-85d3-89a3630c3e9b`
- Mockup del select abierto · `claude.ai/code/artifact/02c65fc4-24a7-4d6e-9be3-3e6a614b15e0`
- Banco de movimiento (escala de duraciones) · `claude.ai/code/artifact/5f3e5bd4-19f9-4cdd-9b37-95f856c05427`
- [Apple — Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Refracción con CSS y SVG — kube.io](https://kube.io/blog/liquid-glass-css-svg/) · la refracción real
  (`feDisplacementMap` como `backdrop-filter`) se verificó funcionando en Chromium;
  WebKit headless no renderiza **ningún** `backdrop-filter`, así que no puede
  responder por Safari. Queda como mejora progresiva, nunca como base.
