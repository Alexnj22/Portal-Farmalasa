# Plan — el portal en el teléfono (2026-08-20)

Nace de un reporte de una línea: *«en facturas de compra cuando abro una card me
da información, pero muy reducida, no puedo ver los productos, no puedo ver el
pdf»*. Lo que empezó como una vista resultó ser **16 de las 59 tablas del
portal**, y al abrirlas aparecieron tres capas más de defectos que nadie podía
ver porque la primera capa tapaba a las otras.

Este documento dice **qué quedó cerrado**, **qué queda abierto**, y —lo más
importante— **qué todavía no se pudo medir**, que es la parte que un plan
honesto no puede omitir.

---

## 0. El principio que ordena todo lo demás

> **En el teléfono, un control que responde y no lleva a ningún lado es peor que
> un control que no existe.**

Los tres defectos de esta tanda son la misma cosa dicha de tres formas:

- una ficha que abre una hoja genérica **encima** del detalle real,
- un botón que expande un `<tr>` que en modo ficha **no se pinta**,
- una columna de acciones que el teléfono **no dibuja**.

En los tres casos la pantalla responde, no da error, no le falta ninguna fila, y
**en escritorio funciona**. Por eso sobrevivieron meses: el modo de falla es el
silencio.

---

## 1. Lo que quedó cerrado (v2.693.0 → v2.697.1)

| # | qué | medido |
|---|---|---|
| 1 | El toque de la ficha va al destino real | **16 de 59 tablas** estaban mal (27%) |
| 2 | El detalle que vivía en un `<tr colSpan>` | 6 vistas movidas a `ExpedienteMovil` |
| 3 | La tarjeta con celda rica se apila | Libro de compras 161px → **0**; Compras 77px → **0** |
| 4 | Las acciones, al mantener presionado | 9 tablas; antes **inalcanzables** en el teléfono |
| 5 | El documento entra en 390px | El botón de JSON y la columna **Total** salían del marco |
| 6 | El panel de Mín·Máx se lee | las 7 salas decían todas «S.»; el historial cortado a media cifra |

Y quedó **una regla que no se puede olvidar**: la categoría
`toque-de-ficha-sin-destino` de `npm run gate:movil`, bloqueante en cero,
verificada contra una regresión fabricada en sus dos formas (la prop suelta y la
constante `movil={MOVIL}`). El canon está en **DESIGN.md §32.8 y §32.9**.

**Estado del canon hoy** — 59 tablas: 9 vistas con `ExpedienteMovil`,
12 tablas declaran acciones, 5 apiladas, 4 con `movil={false}` (todas anidadas,
con motivo escrito). `gate:movil` en **0/0** en sus cinco categorías.

---

## 2. El instrumento — y por qué el plan empieza acá

`tests/e2e/barrido-total-movil.spec.js` abre las 38 rutas en **WebKit iPhone
13** y cuenta lo que ningún gate estático puede ver: desborde, blancos de dedo
por debajo de 44pt, inputs que disparan el zoom de iOS, elementos inalcanzables,
toques sin acuse y encadenamiento de scroll.

**No terminaba.** La corrida del 2026-08-20 murió a los **18.5 minutos con 7 de
38 rutas medidas**: el proceso de contenido de WebKit se lleva la página
(`Target page, context or browser has been closed`), y el informe parcial se
escribía con el mismo nombre que uno completo.

> **Un barrido que no termina no dice «está todo bien»: dice que no se midió.**
> Es el mismo agujero que el spec ya conoce en otra forma —«sin sesión, el
> barrido mide el login 37 veces y sale todo en cero»—, y la respuesta es la
> misma: **cortar con ruido, no reportar**.

### F0 · CERRADO — el barrido llega al final

**38 de 38 rutas en 3.3 minutos**, contra 7 en 18.5 y muerte. Tres cambios:

1. **Reciclar el CONTEXTO, no sólo la página.** El spec ya cerraba y reabría la
   página cada 8 rutas, y aun así murió en la **7** — o sea antes del primer
   reciclado. La causa: WebKit reparte varias páginas del mismo contexto en un
   solo proceso de contenido, y ese proceso es el que se pasa de su techo;
   cerrar una página adentro no lo suelta. Un contexto nuevo **es** un proceso
   nuevo. El precio es volver a entrar —la sesión vive en el contexto— y son ~5
   segundos cada 6 rutas contra perder el barrido entero.
2. **El informe vive en `.parcial.json` mientras corre** y sólo se renombra al
   nombre final cuando se midieron todas las rutas previstas. La incompletitud
   viaja en el NOMBRE, que es donde este archivo ya pone lo que distingue una
   corrida de otra, y no en un campo que alguien tiene que acordarse de mirar.
3. **Una corrida incompleta FALLA**, y dice cuántas rutas faltaron y cuáles.

Verificado en las dos direcciones: la corrida completa renombra al nombre limpio,
y una regresión fabricada —cortar el recorrido a la tercera ruta— deja el
`.parcial.json` y falla con «faltan 2 de 5: compras, productos».

## 3. Lo medido — las 38 rutas

Con el barrido terminando, la foto completa del portal de pie en WebKit iPhone
13:

| dimensión | total en 38 rutas |
|---|---|
| desborde de elemento | **0** |
| desborde de página | **0** |
| blanco de dedo < 44pt | **0** |
| inputs que disparan el zoom de iOS | **0** |
| encadenamiento de scroll | **0** |
| tablas en el teléfono | **1** (excepción declarada) |
| toques sin acuse | 36 → **0** |
| blancos inalcanzables | 14 → **0** |

### F1 · CERRADO — el acuse del toque, y un detector que acusaba al inocente

El barrido marcaba **36 en Cortes**. Medido uno por uno: **36 de 37 llevaban
`data-interactive`**, o sea que ya reciben el gel al presionar —`index.css` §1.6
les da `[data-interactive]:active { transform: scale(.994) }`—. El detector
miraba sólo el atributo `class` buscando `active:`, así que no veía el acuse
declarado en la hoja de estilo.

**El 97% del número era el detector acusando al código que hizo bien el
trabajo**, y el número grande tapaba al hallazgo real: **un solo botón mudo**,
que salía en TODAS las rutas porque vive en el marco —el disparador de Ajustes y
su gemelo del tema—. Los dos tienen `hover:` y no tenían `active:`.

Es el modo de falla que este proyecto ya tiene escrito —«acusar al que hizo bien
el trabajo es cómo un gate se termina desactivando»— con el agravante de que
esconde lo que sí hay que arreglar.

### F2 · CERRADO — los 14 inalcanzables eran dos gráficos y un error de cuenta

Los 7 del tablero y los 7 de Horarios son lo mismo: **las barras de un gráfico
semanal**, que se tocan para abrir ese día. El alto sobraba (50 y 158px); el
ancho no llegaba a 44.

Dos causas distintas y las dos reales:

- **De cuenta**: `noCabe` contaba los hijos **posicionados** como hermanos del
  flex. La rejilla de líneas punteadas del gráfico de Horarios es un
  `absolute inset-0` adentro de la fila de barras, así que dividía por 8 días
  para 7 y reportaba 36px donde había 42. Un hijo fuera del flujo no reparte
  ancho.
- **De ancho**: siete días en los ~316px que deja el relleno de la tarjeta dan
  40px por barra. Van a sangre en el teléfono —`-mx-3`, el mismo patrón que ya
  usa el libro de IVA— y el hueco baja a 4px: quedan ~45.

**Y queda una sola `✗` en el barrido**: `schedules` con una tabla en el teléfono.
Es `ScheduleCalendar`, **excepción declarada** en `mobile-gate` con su motivo —
la fila no es un registro, es un empleado cruzado con siete días.

## 4. Lo NO medido — y por qué importa que esté escrito

Esto es la mitad del plan. Las cuatro cosas de abajo **no las cubre ningún gate
ni el barrido de hoy**, así que su ausencia de hallazgos no significa nada.

### F3 · CERRADO — los diálogos, medidos por primera vez en 390px

**41 archivos de vista declaran diálogos y hay 40 componentes de formulario**, y
ninguno se había abierto nunca en 390px en una medición. `barrido-total-movil`
con `MODALES=1` abre exactamente dos cosas por ruta: la hoja de la primera ficha
y el primer botón del clúster flotante.

Ahora hay un barrido propio —`tests/e2e/dialogos-movil.spec.js`— que **abre los
diálogos apretando botones de verdad** y mide lo que aparece. **14 diálogos en
4.3 minutos**, y **un solo hallazgo**: los dos acordeones del detalle de un
comunicado medían **332×31** — el ancho sobra, el alto no llega a los 44 del
blanco de dedo. Corregido con `min-h-[var(--tap-min)]`, que en escritorio vale 0
y no cambia nada.

#### El freno, que es la parte importante

Corre contra producción, así que **abrir no puede escribir**:

1. Sólo se aprieta lo que coincide con `ABRE` — verbos que abren un panel.
2. Nunca lo que coincide con `NO_TOCAR`, y esa lista **gana** sobre la primera:
   anular, eliminar, enviar, sincronizar, imprimir, recalcular, confirmar…
3. Adentro del diálogo **no se toca nada**: se mide y se cierra.
4. Un botón **sin nombre accesible no se aprieta**: si no se puede leer qué
   hace, no se puede saber que es seguro.

Escrita hacia el lado seguro a propósito — perder una medición es un hueco,
apretar «Sincronizar» en producción es un incidente.

#### Cuatro cosas que salieron de correrlo, no de pensarlo

- **El clúster flotante SÍ entra.** La primera versión excluía todo el marco y
  tiraba las acciones junto con la navegación: «Nuevo empleado» vive ahí.
- **«Abrió» no siempre es `role="dialog"`.** Varias pantallas cambian de MODO
  dentro de la misma vista —«Nueva Cotización» es eso—, y son justamente
  formularios largos. El segundo signo es que aparecieron controles de captura
  que antes no estaban, que es la misma cuenta que usa `gate:borradores`.
- **Se espera a la condición, no al reloj.** Los formularios pesados llegan por
  `await import()`, así que aparecen cuando bajó su chunk. Con espera fija,
  «Nuevo empleado» daba «no abrió nada» y el hueco parecía del portal.
- **Un nombre, una medición.** Sucursales daba **32 candidatos que son 4
  diálogos** — la misma tarjeta repetida por sucursal.

#### Lo que este barrido todavía no alcanza

Y hay que decirlo, porque su verde no cubre esto:

- **Un tope de 4 disparadores por ruta**, y lo que queda afuera se **anota** en
  la corrida: 7 en Sucursales y 11 en el tablero. Un tope silencioso se lee como
  «se midió todo».
- **«Nuevo empleado» no llegó a abrirse** —el disparador responde y no aparece
  ni diálogo ni campos—, así que el formulario más largo del portal sigue sin
  medir. Es lo primero que hay que destrabar.
- **Los formularios que exigen datos previos** —el editor de una boleta necesita
  una planilla generada— quedan fuera por falta de datos, no por diseño.

### F4 · CERRADO — el barrido visitaba 38 rutas de 65

La pregunta original era «las vistas sin tabla nunca pasaron por esta revisión».
Al ir a medirlas apareció algo más concreto y peor: **`App.jsx` declara 65 rutas
y el barrido visitaba 38**. Descontando comodines, login, el kiosco pre-sesión,
los andamios de prueba y las que llevan `:id`, quedaban **16 rutas reales que no
se medían nunca** — o sea que el «cero hallazgos» de F0/F1/F2 hablaba de dos
tercios del portal.

Y no eran vistas menores: **Inventario, Traslados, Cuentas por pagar y Gestión de
stock** están entre las más usadas.

**Medidas las 16**: desborde 0, desborde de página 0, zoom de iOS 0,
inalcanzables 0, sin acuse 0, tablas en el teléfono 0, ninguna reventada.

**Un hallazgo**: en **Traslados**, la cara de la tarjeta que abre el detalle
medía **308×40** — el ancho sobra, el alto queda 4px por debajo de los 44 del
blanco de dedo. Corregido con `min-h-[var(--tap-min)]` y verificado en una
segunda corrida.

**Las 16 quedan DENTRO de la lista del barrido**, que es el punto: medirlas una
vez a mano no las vuelve a medir mañana. La lista pasa de 38 a 54 rutas, y las
que siguen afuera están escritas con su motivo en el propio archivo.

#### Una anomalía que no se pudo reproducir, y se anota como tal

En la primera corrida el barrido **se colgó en `gestion-stock`** y no avanzó en
~20 minutos. Medida sola después, esa ruta responde en **23 segundos y sale
limpia**. Y una corrida posterior de las 16 tardó 10 minutos en dos rutas que
antes tomaban segundos. El patrón apunta a **producción lenta en ese momento**
—esa tarde se aplicaron migraciones y un cambio de `statement_timeout`— y no a
la vista. Queda anotado en vez de convertido en un hallazgo: no se pudo
reproducir, así que afirmar que Gestión de stock cuelga sería inventar una causa.

### F5 · Acostado

`usePanelLateral` existe y el corte está escrito y medido —un iPhone 13 acostado
es 844×390, y ahí una hoja inferior gasta el 63% del alto para mostrar dos
controles—. Lo que no hay es **una corrida del barrido en horizontal**. Todo lo
de este plan se midió de pie.

### F6 · El aparato de verdad

DESIGN.md §32.6 ya lo dice y sigue siendo cierto: **`env(safe-area-inset-*)`
vale 0 en todo emulador**, así que la emulación no puede distinguir «está bien
resuelto» de «no está resuelto». El notch y la barra de gestos necesitan un
teléfono real con el shell de Capacitor.

### F7 · Lo que el gate no puede ver, por construcción

`toque-de-ficha-sin-destino` lee el fuente. Una fila envuelta en su propio
componente —`memo(EmployeeRow)`— es una caja cerrada: no se puede saber desde
afuera si adentro hay un `onClick`. **Un verde no prueba que las 59 tablas estén
bien; prueba que ninguna de las que se pueden leer quedó sin declarar.** La
diferencia se cubre midiendo (F0), no leyendo.

---

## 5. Orden sugerido

~~F0~~ · ~~F1~~ · ~~F2~~ (v2.698.4) · ~~F3~~ (v2.699.2) · ~~F4~~ — **cerradas**. El
barrido de vistas y el de diálogos terminan, y de pie el portal mide **cero** en
todo lo que saben contar.

Lo que sigue, en orden:

1. **Destrabar «Nuevo empleado»** en el barrido de diálogos y subir el tope, para
   que F3 cubra lo que hoy anota como pendiente — el formulario más largo del
   portal sigue sin medir.
2. **F5** — una corrida acostado. Todo lo de este plan se midió de pie.
3. **F6** — el aparato real. Es el único que no depende de nosotros.
4. **F7** — cerrar el hueco de las filas envueltas en su propio componente.

Y uno que no es de este plan pero está rojo: **`gate:borradores`** acusa a
`PedirTrasladoModal.jsx` —7 campos de captura sin borrador—, de v2.691. Con la
sesión cerrándose sola a los 5 minutos en los cargos de sala, ahí se pierde lo
escrito sin dejar rastro.

---

## 6. Cómo se verifica cada cosa

Lo aprendido en esta tanda, para no volver a pagarlo:

- **Compilar y pasar los gates no prueba nada sobre lo que se ve.** Los seis
  arreglos de esta tanda pasaban todos los gates *antes* de arreglarse.
- **Medir, no leer.** Dónde aplicar `apilada` salió de contar píxeles
  recortados por ficha, no de mirar el JSX. Dos de las tablas que «parecían»
  candidatas no recortaban nada, y la peor del portal (161px) no estaba en la
  lista escrita a mano.
- **Al contar recorte, descontar lo que desborda por diseño**: un carril con
  `overflow-x` se alcanza deslizando, y `text-overflow: ellipsis` desborda
  siempre — así es como se dibujan los puntos suspensivos. Sin descontarlos, el
  90% de los hallazgos son ruido y el gate se termina ignorando.
- **Un detector nuevo se prueba contra una regresión fabricada** antes de
  creerle el cero, y en cada forma que tiene que resolver.
- **Una vista que revienta mide igual que una vista vacía.** Cero fichas, cero
  tablas, cero desborde.

---

## 7. Bitácora

| versión | qué |
|---|---|
| v2.693.0 | el toque de la ficha va al destino real (16 tablas) · gate `toque-de-ficha-sin-destino` · §32.8 |
| v2.693.1 | el documento de compra entra en 390px |
| v2.694.2 | el panel de Mín·Máx se lee |
| v2.696.0 | `apilada` y `acciones: 'mantener'` · §32.9 |
| v2.697.0 | el mismo canon en las otras nueve tablas |
| v2.698.0 | confirmar un pago desde el teléfono · este plan |
| v2.698.4 | F0/F1/F2 — el barrido termina, y el portal mide cero de pie |
| v2.699.2 | F3 — los diálogos, medidos por primera vez en 390px |
| v2.699.3 | F4 — el barrido visitaba 38 rutas de 65; ahora 54 |
