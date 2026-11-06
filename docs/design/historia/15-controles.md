# Historia — §15 Controles canónicos

Crónica de las mediciones e incidentes que dieron forma a las reglas de
`DESIGN.md` §15. Las reglas viven allá; acá queda el **por qué**, tal como se
escribió en su momento. Si una regla de §15 parece arbitraria, la respuesta
está en esta página.

## 15 — por qué existe la sección

Reescrita el 2026-07-27 (D4). La versión anterior decía *"No shared button
component — patterns are inline"* y mostraba hex crudos y radios fijos. Eso
dejó de ser cierto y era lo que hacía que la deuda volviera: cada persona que
leía el documento escribía otro botón a mano.

## 15.1 — los seis radios

Cuando se midió, había seis radios distintos en botones (`rounded-xl` 186,
`rounded-full` 109, `rounded-2xl` 82, `rounded-btn` 50, sin radio 48,
`rounded-lg` 32). No eran seis decisiones: eran seis formas de ignorar el token.

## 15.2 — `variant` y `tone`, y el origen de `soft`

`variant` y `tone` son ejes distintos a propósito. Mezclarlos en un solo eje
fue el error que se corrigió al medir los 115 botones coloreados.

`soft` salió de medir 37 botones a mano con `bg-success/10`, `bg-danger/10`,
`bg-warning/10`. No eran capricho: los `tone` del canónico son todos
**sólidos**, y un relleno sólido grita. Dos sólidos juntos compiten por ser el
principal; el tenue dice *"esta acción es de esta categoría, pero no es la
acción principal de la pantalla"*. Migrarlos a sólido habría perdido ese dato.

## 15.2 — el ✕ (2026-08-05)

Salió de una pregunta del usuario sobre el ✕ del toast —«no se ve bien, ¿es
canónico?»— y la respuesta era que no había canónico. Al medirlo: **66 botones
`icon={X} iconOnly` repartidos en tres variantes** (19 `destructive`, 19
`secondary`, 28 `ghost`) para lo que son **tres trabajos** distintos, y la
variante no seguía al trabajo. `FinalizarCajasModal` tenía las dos formas en el
mismo archivo, a nueve líneas una de otra; `EmployeeFormModal` quitaba siete
filas de lista en `destructive` y la octava en `ghost`.

Una pastilla roja sólida para cerrar miente sobre lo que pasa al apretarla, y
en un toast de error competía con el rojo del ícono a 300px de distancia. Los
19 ✕ en `secondary` se unificaron a `ghost`.

## 15.3 — el tope de tres opciones (2026-08-17)

Antes de que se estableciera (123 botones con estilo `X === valor` fueron el
motivo de crear `SegmentedControl`), la regla decía «muchas opciones», y
«muchas» no se puede verificar ni discutir: cada quien decide si ocho son
muchas. Regla del usuario (2026-08-17): **arriba de tres, va select.**

El segmentado sirve para **comparar de un vistazo**. Con más de tres pasa a ser
una lista disfrazada, con dos costos:

- **Ocupa el alto de la tarjeta.** «Nivel de Precio Máximo», con ocho niveles,
  pintaba dos renglones de píldoras. Al estar en una rejilla, ese alto lo
  heredaba toda la fila: «Super Usuario» quedaba con la mitad inferior vacía.
  Con el select, las tres tarjetas del cargo entran en una fila pareja.
- **Se corta o pide scroll.** Ocho píldoras no entran a lo ancho: a 1440
  «Precio 7» quedaba tapado por el borde, y taparlo con `overflow-x-auto` es
  esconder el problema — nadie descubre una opción que hay que arrastrar para
  ver.

## 15.5 — `TONO_POR_ICONO` (2026-07-30)

Auditados los **193 botones `iconOnly`** del proyecto: **18 íconos se dibujaban
con 2 a 4 colores distintos**. El ojo aparecía sin tono, `chart-1`, `success`
y `secondary`; `Download` era `success` en Personal y `chart-1` en Facturas de
Compra.

Medido al aplicarlo: de los 193 `iconOnly`, **20 pasaron a llevar color** y 172
quedaron igual — 41 de ellos por decisión explícita. El tono explícito suele
codificar la ACCIÓN y no el ícono, y eso es correcto: `Eye` + `success` es
"restaurar sugerencia", `RefreshCw` + `success` es "recontratar", `RotateCcw` +
`chart-3` es "regenerar con IA" (`chart-3` es el color de IA del portal).

La regla del relleno-vs-ícono se ve en la píldora de Ventas: fondo neutro, ojo
azul. Facturas de Compra pinta Eye/Download/FileJson/Archive de `chart-1` a la
vez con tono explícito.

## 15.5 — `soloIcono` (2026-07-30)

Se intentó apagar el relleno con un `px-0` en el `className` del llamador y
**perdió contra el `px-3.5` del tamaño** — entre dos utilidades de Tailwind el
ganador lo decide el orden de la hoja de estilos, no el del atributo `class`.
Resultado medido: un botón de 36px con 28 de relleno y el SVG aplastado a
**6×18** en vez de 18×18. El usuario lo reportó como "el ícono es demasiado
pequeño".

Hasta esa fecha `soloIcono` solo cambiaba el relleno y el tamaño del ícono: el
texto se seguía pintando, así que cada llamador tenía que pasar
`children={null}` *además* de la prop. `FilterBar` lo hacía; nadie más lo
sabía. El primer llamador directo que no lo supo dibujó "RESTAURAR 10 OCULTOS"
encima del select de al lado.

Del mismo arreglo: el rótulo llevaba `hidden sm:inline`. Esa clase lo escondía
bajo 640px —en la hoja de filtros del teléfono los botones son de ancho
completo y salían con un ícono suelto y 300px de vacío al lado—, y arriba de
720px, el único sitio donde la píldora de escritorio se dibuja, no llegaba a
aplicarse nunca. Solo hacía daño.

## 15.5 — el modal en táctil

Medido en un iPhone: en un modal centrado convertido a hoja, "Cancelar"
quedaba debajo del indicador de inicio — de ahí las variantes de descendiente
de `ModalShell` sobre el área segura. `ConfigPanel` y `LabsPanel` tenían
`align="top"` y dejaba el panel flotando a 10vh del borde superior; se les
quitó: no son paletas de comandos, son formularios.

`HojaMovil`: en 390px los botones en fila quedaban en dos blancos de ~180px;
apilados miden 356px de ancho. Con `data-surface` real el blur medido era
`blur(24px)` y el fondo cambiaba de tema sin tocar nada. Sin `!` en
`rounded-b-none!`, las cuatro esquinas quedaban en 32px.

`AsaHoja` estaba escrito a mano en **seis** sitios, en dos variantes (`w-9`/`/40`
y `w-10`/`/30`).

El pie que decide solo: apilar cuesta ~52px de alto, y con el teclado abierto
en un teléfono de 844px eso es el **11% del área útil**.

## 15.5 — la gota

- **El origen se lee al abrir.** `ModalShell` no se desmonta entre aperturas.
  Congelarlo en el primer render lo dejaba en `null` para siempre. En
  `HojaMovil` no se notaba porque se remonta en cada apertura; el defecto
  apareció recién al subir la gota al canónico.
- **El clip va en el elemento con vidrio.** Con el clip en el envoltorio de
  `ModalShell`, el texto de la lista se leía **nítido** a través de la hoja
  durante toda la apertura y el vidrio aparecía recién al terminar. Fue la
  séptima vez que la familia de reglas del backdrop root mordió en el
  proyecto, y la primera por `clip-path`.
- **Por qué `clip-path` y no `scale`.** Un `@keyframes` fijo solo sabe escalar
  "un poco desde abajo" y se lee como *algo entró*. Un FLIP con `scale()`
  escala también el `backdrop-filter`: a `scale(0.14)` los 24px de blur valen
  ~3. Con el recorte, medido: `transform: none` y `blur(24px)` en todos los
  cuadros.
- **La primera versión pedía el origen por prop** (`origenX`, con un
  `@keyframes` propio) y solo la tenían las hojas de `BarraFlotante`; se
  reemplazó por `leerUltimoToque()` y el recorte. Una prop opcional es una
  prop que alguien va a olvidar — la misma lección del `buscador` que 1 de 22
  vistas pasaba.
- **El contenedor sin velo no se anima.** `animate-in fade-in` medido
  `0 → 0.29 → 0.68 → 0.90` de opacidad mientras la hoja se abría: vidrio
  muerto durante toda la entrada.
- **El radio final** estaba quemado en 28px; en `solid` el token baja y las
  esquinas no coincidían.
- **Solid**: hasta v2.293.0 la rama sin vidrio era `scale(0.94) → scale(1)`.
  Escalar arrastraba la capa de sombra (18px de difuminado redibujados por
  cuadro), un zoom del 6% no decía nada, y el arrastre del asa quedaba muerto.
  Se pasó a `translate`. Detalle en el encabezado de
  `src/components/common/gotaApertura.js`.

## 15.5 — el material de la capa móvil

Reporte: "Calcular" y "Parámetros" no se veían igual que la hoja de la barra —
unas usaban `modal` (85%) y la de la barra `card` (16%). Se unificó en una
constante, y después se partió en DOS (`MATERIAL_CLUSTER` = `card`,
`MATERIAL_HOJA` = `dropdown`): a 16% el usuario preguntó "¿qué son esos
recuadros en los botones?" — eran los bordes de la tabla de atrás atravesando
la hoja. Con `card`, *"SALUD 2 se lee ENTERO y cae encima de ACCIONES. Es
vidrio, pero ilegible"*; con `dropdown` (72%), *"lo de atrás queda como un
fantasma y los rótulos se leen limpios"*. El clúster se queda en `card` por
decisión explícita del usuario ("el liquidglass del filterpill no es
liquidglass").

## 15.5 — `LiquidModal.Footer`

El canónico existía y lo usaba 1 de 6; los otros 5 repetían el mismo div
carácter por carácter (`flex-none px-6 md:px-10 py-5 border-t flex
justify-between items-center`). Se adoptó esa forma real en vez de imponer otra.

## 15.5 — la barra flotante

El primer intento de reservar su alto sumaba la barra a los 40px que ya había y
dejaba 50px de vacío después del paginador. Medido a 430×932: relleno 111px,
hueco visible 22px.

El buscador: se eligió sobre cuatro variantes con maqueta. La descartada de
cerca era el campo pegado al **encabezado de la pantalla**: el teclado ocupa la
mitad de abajo, así que el dedo teclea abajo y el ojo salta ~500px en cada
letra. Antes de 2026-07-30 el campo se estiraba *dentro* del clúster y
expulsaba a los otros botones: buscar y filtrar eran excluyentes.

## 15.6 — `Notice bloque` (2026-08-26)

Reportado sobre el aviso del invariante de Bolsas: «se ve fatal». En siete
renglones, `--btn-radius` = 9999px dibujaba un óvalo gigante con las esquinas
comiéndose el texto.

## 15.8 — cierre de D3.3 (2026-07-28)

Se abrieron los **137** `<button>` escritos a mano que quedaban. Migraron 77;
los otros 60 **no** eran deuda: eran el canónico equivocado. Los **nueve**
ítems del menú principal eran botones: ⌘/Ctrl+clic y el botón del medio no
abrían en otra pestaña, el navegador no mostraba a dónde lleva, y un lector de
pantalla anunciaba "botón" para los 36 enlaces del menú.

## 15.10 — `LiquidTooltip` y `title=` (2026-07-29)

- El recorte contra el borde usaba un medio-ancho fijo —140px el de texto, 180
  el rico—; un tooltip corto cerca del borde derecho se corría más de 100px.
- `text-content-3` sobre el tooltip daba gris oscuro sobre fondo oscuro en
  tema claro — estaba en varios de los 30 tooltips escritos a mano.
- **9 `LiquidTooltip` contra 208 atributos `title=`.** De esos 208, **204 eran
  el único nombre accesible del control**. Había 4 con `title` igual al
  `aria-label`.
- F3: 50 `title=` sobre elementos no interactivos: 12 truncados (A), 22
  gráficos (B), 1 grupo (C), 15 prosa (D). Migrar los 22 de (B) habría roto la
  pila de avatares (`margin-left: -6px`).
- `CajaFecha` de `ConteoDetailView`: su `title` explica por qué está inerte,
  pero lleva `pointer-events-none` en ese estado — el texto es inalcanzable
  justo cuando importa. Queda como deuda de esa vista.
- Al terminar quedaron 9 hover cards: los 3 de `FacturacionView`,
  `EncuestaView`, `TabExpediente` y los 2 de `TabStaff`.

## 15.11 — `PortalInput` (2026-07-28)

De los ~20 campos con etiqueta escritos a mano que quedaban en julio,
**ninguno asociaba su `<label>` con el campo** — hacer clic en la etiqueta no
enfocaba nada. Las ranuras rescataron: `label` opcional 43, `tono` 33,
`labelAction` 37, `onDark` 1.

## 15.11.1 — dinero (2026-08-19)

Lo reportó el usuario: *«en mi computadora funciona con `.` pero en otras solo
con `,`. todos deben ser con `.`, ese debe ser el canónico de efectivo»*. El
separador de `input[type=number]` lo decide el idioma de cada computadora, y la
tecla que no espera **se la come**: «120,50» se registraba como **12050**. En
una temperatura ya había costado una lectura inventada (por eso nació
`DECIMAL`, 2026-08-17).

## 15.11.2 — el tope (2026-09-29)

Regla del usuario: *«que no permita ingresar un monto mayor al permitido no
tiene sentido. Si se escribe un valor mayor, que se ponga el max permitido.»*
Primer uso: Cuentas por Cobrar (3-sep).

## 15.12 — los cuatro `<input>` a mano (2026-07-28)

La versión anterior decía que el caso legítimo era "la celda de una grilla
densa" y contaba 61. Preguntado por el usuario —*"¿por qué son excepción? ¿qué
criterio tomaste?"*— se verificó ancestro por ancestro. **No aguantó.** De los
56, 43 eran el campo del canónico sin etiqueta, y de los 7 finales, 4 tampoco
eran excepción: dos eran `PortalInput` reconstruido a mano y dos eran
`SearchInput expandable` reconstruido. Quedaron **4**.

## 15.13 — `LiquidSelect` envuelto (2026-07-29)

Hasta v2.219.0 había **46 sitios** que envolvían `LiquidSelect` para darle
borde o marcar error. Medido en el navegador:

| | El envoltorio | El control real |
|---|---|---|
| Alto | 40 px | **46 px** |
| Radio | 10 px | 8 px |
| Borde | 0 px | 1 px |
| Fondo | rojo 10% (error) | blanco opaco |

El fondo del envoltorio asomaba alrededor, y su `hover:border-brand/40` pintaba
sobre un borde de ancho cero. Al migrar, el script desenvolvió por la clase del
div sin mirar qué había adentro y se llevó 3 `LiquidDatePicker` (cuyo
contenedor es `h-full` y sí necesita el envoltorio); lo detectó leer el diff,
no el gate. Un grep por `inputHoverClass` se saltaba `FormRehireEmployee`, que
usaba un alias local — por eso el gate detecta por forma.
