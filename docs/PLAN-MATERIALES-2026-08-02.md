# Plan de materiales — Liquid Glass y Solid (2026-08-02)

Definición de la identidad de los dos temas, **elemento por elemento**, decidida
sobre mockups interactivos con los tokens reales. Nada de esto está
implementado todavía: este documento es el contrato que la implementación tiene
que cumplir, y se va completando a medida que se cierra cada elemento.

**Estado:** superficie (tarjeta) CERRADA · el resto pendiente.

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

## 2. Rendimiento — medido, no estimado

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

## 3. Lo que la implementación tiene que incluir

Cuando se cierren todos los elementos:

- [ ] Tokens de §1 en `src/index.css`, en los cuatro temas.
- [ ] `data-interactive` explícito en las tarjetas clicables — el gel y el
      hundido no tienen dónde aplicarse sin él. Hoy de **220**
      `data-surface="card"` apenas **3** declaran `onClick`.
- [ ] Utilidad de seguimiento del puntero con las tres reglas de §2.
- [ ] `DESIGN.md` §2 y §5 actualizados, incluido el cambio de contrato de §1.4.
- [ ] Categorías de gate nuevas: que no se pueda clavar un valor de material a
      mano, ni escribir un seguimiento de puntero que recorra la lista.

---

## 4. Decisiones abiertas

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

## 5. Elementos pendientes de definir

Cada uno se cierra con su mockup y sus valores antes de tocar código:

| elemento | por qué importa |
|---|---|
| **Botón** | el gesto más repetido; es donde vive el gel |
| Campo / `LiquidSelect` | superficie + foco + estado inválido |
| Menú flotante / dropdown | ya tiene capa flotante; falta su material |
| Modal | la «gota» tiene tokens propios (340/240ms) |
| Barra de pestañas | `tab-track` es la única otra superficie con lift |
| Sidebar | oscuro en los cuatro temas — caso aparte |

---

## Referencias

- Mockup de Liquid Glass, capa por capa · `claude.ai/code/artifact/33d118ae-ab63-422c-bb5a-f397b3dab434`
- Mockup de Solid · `claude.ai/code/artifact/ca3c7aa1-d223-400d-863c-40d753287937`
- Banco de movimiento (escala de duraciones) · `claude.ai/code/artifact/5f3e5bd4-19f9-4cdd-9b37-95f856c05427`
- [Apple — Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Refracción con CSS y SVG — kube.io](https://kube.io/blog/liquid-glass-css-svg/) · la refracción real
  (`feDisplacementMap` como `backdrop-filter`) se verificó funcionando en Chromium;
  WebKit headless no renderiza **ningún** `backdrop-filter`, así que no puede
  responder por Safari. Queda como mejora progresiva, nunca como base.
