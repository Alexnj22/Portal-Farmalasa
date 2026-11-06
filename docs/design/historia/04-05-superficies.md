# Historia — fondo ambiental y superficies (§4–§5.3)

Narrativa que antes vivía en `DESIGN.md` §4–§5.3. Las reglas siguen allá.

## Los orbes de julio

Hasta agosto los cinco orbes eran violeta/azul/lavanda; hoy son el verde y el magenta del logo (`AppLayout.jsx`). El `AmbientBG` del login se retiró el 2026-08-06.

```
Orb 1: 70vw × 70vw  top:-15% left:-15%  purple rgba(110,70,230,0.45)  blur(35px)  animate-ambient-drift
Orb 2: 55vw × 55vw  top:-5%  right:-20% blue   rgba(60,100,240,0.38)  blur(30px)  animate-ambient-drift-reverse
Orb 3: 80vw × 80vw  bottom:-35% left:-10% lavender rgba(150,80,240,0.35) blur(40px) animate-ambient-drift 18s delay 4s
Orb 4: 45vw × 45vw  top:25%  right:5%   sky    rgba(90,150,255,0.32)  blur(28px)  animate-ambient-drift-reverse 14s delay 2s
Orb 5: 30vw × 30vw  top:50%  left:38%   violet rgba(200,120,255,0.28) blur(22px)  animate-ambient-drift 11s delay 6s
```

## El cuerpo de vista dejó de ser superficie (2026-08-20)

**El CUERPO DE VISTA ya no es una superficie (2026-08-20).** `GlassViewLayout`
dejó de emitir `data-surface="card"` en su cuerpo — decisión del usuario, tras
preguntar por qué el marco tenía el vidrio y las tarjetas no:

> «¿Por qué el body tiene el efecto?»

Mientras el cuerpo fue una tarjeta, **toda tarjeta del portal era una anidada** y
§1.5 la aplanaba —sin desenfoque, sin sombra, sin lente— para evitar el 1.02:1
de vidrio sobre vidrio. Al retirar esa capa las tarjetas quedan en primer nivel
y se llevan su material, **sin tocar §1.5**: la anidada sigue existiendo para
quien de verdad anide.

No fue un salto a ciegas: **en teléfono el cuerpo ya venía sin card desde el
2026-07-30** (la cadena de anchos se comía 92px de 320), o sea que las 33 vistas
ya se dibujaban así en móvil todos los días. Lo que cambió es que el escritorio
pasó a verse como lo que ya funcionaba en la mano.

**Se levanta la tarjeta APUNTADA, y sus contenedores se quedan quietos
(2026-08-20).** `:hover` matchea al elemento *y a todos sus ancestros*, así que
sin las dos reglas de abajo los lifts se suman — medido el 2026-08-02: 4px en
/staff, /schedules y /announcements contra los 2px de una tarjeta suelta.

Eso ya estaba resuelto, **pero al revés**: la regla vieja era
`[card] [card]:hover { transform: none }`, que calla a la tarjeta **apuntada** y
deja levantarse al contenedor. Y el contenedor casi siempre es el **cuerpo de
vista** (`GlassViewLayout` lo emite con `data-surface="card"`), así que apuntar
una tarjeta levantaba la vista entera mientras la tarjeta se quedaba quieta.

> «No tiene sentido que si entro a la card lo que se active sea el body; el body
> se debe activar sólo al cargar la vista y luego las cards.» — el usuario,
> 2026-08-20, con captura.

El síntoma medido era cierto y la causa estaba bien identificada; lo que estaba
mal era **a quién se callaba**. Dos consecuencias para quien escriba una vista:

- **El cuerpo de vista no responde al puntero** — hoy ni siquiera es una
  superficie, así que no hay nada que callarle. Duró un commit un atributo
  `data-cuerpo="vista"` que le apagaba sólo el lift; se retiró junto con la
  superficie, porque una regla que no puede matchear no es un interruptor.
- **`:has()` es el selector correcto y no hay alternativa**: hace falta mirar
  hacia ABAJO desde el contenedor. Donde no exista (Chrome <105, Safari <15.4,
  Firefox <121) la regla se ignora y vuelve el lift acumulado — degrada, no
  rompe.

## El lift: de dónde sale el número

**El lift se queda — es la sensación Liquid Glass, y es el canónico para toda
superficie** (decisión del usuario, 2026-08-01, tras comparar tres opciones en
un mockup con los tokens reales). Lo que cambió es de dónde sale el número:

**`--lift-card` es el lift de las SUPERFICIES; `--lift-hover` el de los
CONTROLES.** Son dos tokens a propósito: un botón de 32px y una tarjeta de
1080px no necesitan el mismo desplazamiento — 2px en el botón se lee como
salto, 1px en la tarjeta no se ve.

| token | quién lo usa | liquid / dark | solid / solid-dark |
|---|---|---|---|
| `--lift-card` | `data-surface="card"` | `-3px` | `-1px` |
| `--lift-hover` | `Button`, `TablePagination`, `data-surface="page-header"` | `-1px` | `0px` |

Existe porque el lift de la tarjeta estaba **clavado en `-2px`**, y por eso no
se apagaba en Solid: la neutralización de tema (`index.css`) sólo alcanza a las
clases Tailwind `[class*="hover:-translate-y"]`, nunca a una regla de
`data-surface`. Medido antes del arreglo: `dy=-2` en los tres temas, incluido el
que entonces prometía no moverse.

**Los valores de hoy son otros, y por dos razones distintas** (`PLAN-MATERIALES`
§1.1 y §1.4, aplicados el 2026-08-06): Liquid subió a **`-3px`** porque con el
material nuevo `-2` casi no se leía, y Solid **dejó de valer `0`**: cede
**`-1px`**. Ese `-1` es una decisión, no un descuido — un guiño de que la pieza
responde, sin el salto que contradiría la promesa de eficiencia del material.
El texto de arriba decía «no se mueve» un día más que el código, que es el
mismo desfase que este bloque existe para contar.

> **Nunca clavar el número.** Una superficie nueva usa `var(--lift-card)`; un
> control, `var(--lift-hover)`. Clavar `-2px` es exactamente el bug que esto
> arregla, y no hay tema que lo pueda rescatar después.

**El lift mueve la caja de hit-testing, y eso tiene un costo conocido.** Al
entrar por el borde INFERIOR la tarjeta se levanta y su borde pasa por encima
del cursor, así que `:hover` se apaga sola y vuelve a encenderse — el ojo lo ve
como *"se activa, se quita y se activa"*. Medido en el tablero: con el puntero a
1, 2 y 3px del borde inferior la tarjeta queda hovereada el **0%** del tiempo; a
5px, el 100%. Es una **banda muerta de ~4px** en el borde inferior.

Lo que hay hoy es **histéresis**: la transición espera `--card-espera-salida`
(140ms) sólo al SALIR, así que el des-hover momentáneo que produce el propio
lift se agota antes de que la sombra empiece a volver. Verificado: una salida de
60ms o 120ms mueve la sombra **0px**; una salida real de 400ms la devuelve
completa. Entrar sigue siendo inmediato (30ms medidos), porque la transición que
manda es la del estilo DESPUÉS del cambio y al entrar esa es la de `:hover`.

**La banda muerta sigue ahí.** Cerrarla requiere compensar el área de impacto
con un pseudo-elemento que extienda la caja hacia abajo `var(--lift-card)`, y eso
exige `position: relative` en las **175** tarjetas que hoy no declaran posición
—con riesgo de re-anclar sus hijos absolutos—. No se hizo por eso; queda escrito
para que la próxima vez la decisión arranque con el número.

**Y nunca agregarle un `hover:-translate-y-*` a una tarjeta: no la reemplaza,
se SUMA.** En Tailwind v4 esas clases compilan a la propiedad `translate`, que
es distinta de `transform` —donde vive el canónico—, así que las dos aplican.
Medido el 2026-08-01 sobre el mismo elemento, quitándole la clase: **4.00px con
ella, 2.00px sin ella.** Eran 11 tarjetas moviéndose entre 3 y 6px mientras la
de al lado se movía 2, y encima `translate` no está en la transición del
canónico, así que ese sobrante saltaba sin animar. Corregidas las 11; lo vigila
la categoría **`lift-clavado`** de `npm run gate:design`, bloqueante en cero.

## `bg-surface-card` es el color, no la tarjeta (2026-08-07)

Reportado así: *«el modo oscuro se ve perfecto, pero el modo claro no»*, y sobre
la misma pieza: *«no tiene el brillo del borde al entrar a la card, ni los
efectos de click»*. Las dos cosas eran el mismo error.

Las baldosas del tablero estaban escritas
`rounded-2xl border border-border-card bg-surface-card` sobre un `<button>`
pelado. **Todos los tokens correctos, y aun así mal**: esas tres clases copian
el color del canónico y dejan afuera todo lo demás —

| lo que trae `[data-surface="card"]` | lo que da la clase suelta |
|---|---|
| `backdrop-filter: var(--backdrop-card)` | — |
| `--card-shadow` + los 4 `inset` del lente | — |
| el `::after` que destella al apuntarla | — |
| el gel al presionar (con `data-interactive`) | — |
| `--card-radius` del tema | el radio que uno escribió |

En **oscuro no se nota**: el color solo ya separa de un fondo oscuro. En claro
la tarjeta desaparece contra la página, porque lo que la despegaba era la
escarcha y el lente, no el relleno. Medido en la baldosa antes y después:
`backdrop-filter` pasó de `none` a `blur(44px) saturate(2)` y la sombra de 1
capa a 6.

**La regla:** una superficie va por su `data-surface`, nunca por sus clases de
color. `bg-surface-card` está bien para lo que NO es una tarjeta —el relleno de
un envoltorio de input, un chip— y para eso existe.

**Esto SÍ lo vigila un gate, desde el 2026-08-16 — y la historia de por qué
tardó es la lección.** El texto que estaba acá decía que no se podía: la terna
`bg-surface-card` + borde + radio da **133** coincidencias, casi todas legítimas
(envoltorios de campo con alto fijo), y un detector con esa tasa de falsos
positivos se silencia a la semana. La conclusión era correcta sobre la señal
probada y **equivocada sobre el problema**: lo que descarta a un envoltorio de
campo no es el padding, es el **tamaño fijo**.

La categoría `tarjeta-a-mano` existía desde julio y estaba en **0**. Un censo a
mano en agosto encontró **81 sitios vivos**. El cero era del instrumento, y
sus tres condiciones fallidas valen para cualquier detector que se escriba:

| condición vieja | cuántas dejaba pasar | por qué |
|---|---|---|
| «tiene padding generoso» | **63 de 81** | una tarjeta CONTENEDORA no lleva padding — lo llevan sus hijos |
| sólo `rounded-2xl/3xl` | 35 | `rounded-xl` también es una tarjeta a mano |
| sólo `<div>` | 16 | las otras son `button`, `label`, `motion.div`, `a`, `p` |

Más un punto ciego por debajo: el `className` se leía con
`/className=[{`"]+([^`"}]*)/`, que **corta en la primera `}`** — o sea que toda
clase escrita dentro de un `${cond ? … : …}` era invisible (19 de las 81). Lo
resuelve `classNameDeTag()`, que lee el valor completo y sólo el del nivel 0 del
tag.

Entró por ratchet con **66** —deuda vieja, no nueva— y baja archivo por archivo.

> **La moraleja, que es de método:** cuando un detector no encuentra nada,
> antes de creerle hay que contar a mano una vez. Un gate verde prueba su
> detector, no la ausencia del defecto.

## `data-tono`: el canónico era indecorable (2026-07-28)

**El canónico era INDECORABLE, y eso explicaba las últimas tarjetas escritas a
mano.** `index.css` va sin `@layer`, así que `[data-surface="card"]` le gana a
cualquier utilidad de Tailwind. Medido en el navegador:

| lo que se intenta | resultado |
|---|---|
| `data-surface="card"` | borde del tema |
| `+ border-warning/40` | **sin cambio** |
| `+ border-2 border-warning/40` | **sin cambio** |
| `+ ring-2 ring-warning/40` | **sin cambio** — el ring es un `box-shadow` y acá ya se declara uno |

O sea que para marcar una tarjeta *en edición* o *con error* no quedaba más que
renunciar al canónico y pintarla entera a mano. No era descuido de quien la
escribió: era la única salida.

Con un atributo la especificidad sube sola —`[data-surface][data-tono]` es
(0,2,0) contra (0,1,0)— y el estado se lee en el marcado en vez de en una
ristra de clases condicionales:

## Capa flotante (2026-08-01)

**Un menú anclado se dibuja por portal encima del contenido, pero el contenido
sigue recibiendo el puntero.** Al moverse sobre el menú, la tarjeta que quedó
debajo entra y sale de `:hover` — y con el lift de arriba, salta un bloque de
media pantalla. Medido cruzando el borde del menú de a 2px en el tablero: la
tarjeta de 532×256 de atrás pasaba de `dy=-2` a `dy=0`. Se leía como un rebote
entre el select y la tarjeta.

**Apagar sólo el movimiento no alcanzaba** (corregido 2026-08-02). La primera
versión conservaba la sombra de hover a propósito. Se veía cortado, y la
medición explicó por qué: apagar el `transform` no apaga el `:hover`, y ese
estado **sigue alternando** cuando el puntero cruza el borde del menú. Medido
cruzándolo 4 veces: **8 cambios de `:hover` y 96 de `box-shadow`** — la sombra de
la tarjeta de atrás encendiéndose y apagándose, con su transición de 200ms
cortada a la mitad cada vez, mientras uno elige una opción. Tras el arreglo, los
mismos 4 cruces dan **0 cambios de `box-shadow`**.

La lección: el mockup con el que se eligió tenía la tarjeta hovereada de forma
continua, así que el artefacto no aparecía. **Con el menú encima, cualquier
respuesta al puntero es mentira** — el puntero está operando el menú, no el
fondo.

Se implementa **redefiniendo dos custom properties**
(`--card-lift-activo` / `--card-sombra-activa`), no escribiendo `box-shadow` en
una regla más específica: los `data-tono` declaran box-shadow propio y subir la
especificidad acá les borraría el aro de color.

**Se apagan los efectos, NO el puntero.** El reflejo es un velo `fixed inset-0`
—lo que ya hace `ModalShell`— y resuelve el hover de un saque, pero **rompe el
scroll**: esta app no scrollea el `body` sino un contenedor interno, y el velo
cuelga de `body`, así que la rueda se queda sin ancestro scrolleable. Verificado
con el menú abierto: el scroller interno clavado en 400 mientras que con el menú
cerrado sí se movía. En `ModalShell` no se nota porque ahí bloquear el fondo es
lo que se quiere. La regla toca `transform`/`box-shadow` y nada más, así que el
hit-testing queda intacto y un menú que abre por `mouseenter` sigue funcionando.

**Los tooltips quedan afuera a propósito.** Un tooltip aparece *porque* estás
hovereando algo y se va al salir: apagarle el hover del fondo sería pelearse
consigo mismo. Van a `EXCEPTIONS` con su motivo escrito —no auto-detectados—
porque un archivo puede tener un tooltip **y** un menú (`DashboardView` tiene
los dos) y exentar el archivo entero dejaría pasar el menú de al lado.

## `OjoDeTarjeta`: el barrido tiene que incluir los canónicos (2026-08-15)

La primera pasada buscó `<div>`/`<button>` con clases de tarjeta y un manejador
de clic. Encontró 44 candidatos y 4 tarjetas de verdad — y **se dejó afuera la
mayor parte del portal**, porque las tarjetas más repetidas no se escriben con
clases: las dibuja un canónico y el manejador viaja como *prop* de un componente
en mayúscula.

| dónde | qué es | cubre |
|---|---|---|
| `Ficha` de `DataTable` | lo que una tabla pinta por debajo de `lg` | **33 vistas** de una sola vez |
| `ListRow surface="card"` | tarjeta suelta en una grilla | hoy Conteo (teléfono) |
| `<button data-surface="card">` a mano | la tarjeta escrita en la vista | Solicitudes, Conexiones, Cortes, Personal de sucursal |

En `Ficha` el ojo sale de `alTocar`, que es la misma condición que decide si la
ficha es un `<button>`: **la señal y el comportamiento salen del mismo dato**, así
que no pueden discrepar. Y va dentro del cuerpo, no en la tira de acciones — ahí
abajo, junto a una papelera, un ícono suelto se lee como un segundo botón.

`ListRow surface="card"` **no** lo pone solo: su otro uso con `onClick`
(`PayrollView`) es una selección, y un ojo ahí mentiría. Va explícito en
`trailing`.

**Un chevron de expandir NO sobrevive al modo ficha.** Varias tablas ponen un
`ChevronDown` en una celda para señalar que la fila despliega una hermana. Por
debajo de `lg` esa hermana no se pinta —el chevron apunta a nada— y encima queda
al lado del ojo. Van con `hidden lg:inline`: hecho en Ventas e Inventario, que
es donde el barrido midió el choque; Conteo ya lo tenía por el mismo motivo.

Aplicado el 2026-08-15 a Solicitudes (ya lo tenía a mano, se migró al canónico),
Cortes de caja, Conexiones, las dos tarjetas de «Personal asignado» de una
sucursal, la ficha móvil de `DataTable` y la tarjeta de conteo del teléfono.
Los widgets del Inicio quedaron fuera **con motivo medido**: sus filas o eligen
(un cliente, un vendedor, un producto que se agrega), o crean, o ya llevan
chevron.

**Y una insignia sobre una foto va DESPUÉS de la foto, sin z-index.** La
`<img>` de `LiquidAvatar` lleva `z-base` para tapar su brillo de carga, y hasta
esta fecha ese 10 se escapaba del avatar —`position: relative` sin `z-index` no
crea contexto de apilado— y le ganaba a cualquier hermano posicionado. La
insignia del tipo de solicitud, un disco de 18px en la esquina de la cara, se
veía como un arco de 2px. `LiquidAvatar` ahora es `isolate`: el 10 se queda
adentro y el orden natural manda afuera. Si tenés que escribir un `z-` para que
algo se vea encima de una foto, el problema es otro.
