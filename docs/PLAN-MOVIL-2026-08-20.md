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

**Hoy no termina.** La corrida del 2026-08-20 murió a los **18.5 minutos con 7
de 38 rutas medidas**: el proceso de contenido de WebKit se lleva la página
(`Target page, context or browser has been closed`). El propio spec ya lo
documenta y da la salida —partirlo en dos mitades— pero eso está escrito como
nota, no como el modo de correrlo.

> **Un barrido que no termina no dice «está todo bien»: dice que no se midió.**
> Es el mismo agujero que el spec ya conoce en otra forma —«sin sesión, el
> barrido mide el login 37 veces y sale todo en cero»—, y la respuesta tiene que
> ser la misma: **cortar con ruido, no reportar**.

**F0 es bloqueante para el resto de este plan**, porque todas las fases que
siguen se priorizan con números que hoy no existen.

### F0 · Que el barrido llegue al final

- Partirlo en dos mitades como su propio encabezado indica, y que el partido sea
  el modo **normal** de correrlo, no una nota al pie.
- Que una corrida incompleta **falle**, en vez de escribir un informe parcial
  que se lee igual que uno completo. Hoy el informe de 7 rutas y el de 38 se
  llaman igual.
- Reciclar el contexto entre mitades.

**Criterio de aceptación**: un informe con las 38 rutas, y una corrida cortada
que se distingue de una completa sin abrir el JSON.

---

## 3. Lo medido y abierto

Sale de las 7 rutas que sí se alcanzaron. **No es la foto completa** — es lo que
hay, y hay que decir cuál es cuál.

| ruta | desborde | dedo <44pt | zoom iOS | inalcanzables | sin acuse |
|---|---|---|---|---|---|
| overview | 0 | 0 | 0 | **7** | 2 |
| cortes | 0 | 0 | 0 | 0 | **30** |
| ventas · compras · productos · pedidos · minmax | 0 | 0 | 0 | 0 | 0 |

### F1 · El acuse del toque (30 en Cortes, 2 en el tablero)

Una tarjeta que se toca y no acusa recibo se lee como que la pantalla se colgó.
En el teléfono no hay cursor ni realce de hover: el acuse **es** la única señal
de que el toque entró.

Las 30 de Cortes son la misma tarjeta repetida, o sea **un arreglo, no treinta**.
Va en el canónico —`data-interactive` y el gel de §1.6— y no tarjeta por
tarjeta.

### F2 · Los 7 inalcanzables del tablero

Elementos que el barrido marca como imposibles de alcanzar. Hay que abrirlos uno
por uno: la categoría mezcla «tapado por otra capa» con «fuera del marco», y son
arreglos distintos.

---

## 4. Lo NO medido — y por qué importa que esté escrito

Esto es la mitad del plan. Las cuatro cosas de abajo **no las cubre ningún gate
ni el barrido de hoy**, así que su ausencia de hallazgos no significa nada.

### F3 · Los diálogos y los formularios largos

**41 archivos de vista declaran diálogos y hay 40 componentes de formulario.**
El barrido con `MODALES=1` abre exactamente dos cosas por ruta —la hoja de la
primera ficha y la acción principal— y mide lo que aparece. Un formulario de
empleado, uno de sucursal o el editor de una boleta **nunca se abrieron en 390px
en una medición**.

Es donde más superficie hay sin mirar, y es la superficie donde el defecto
duele más: un formulario que no entra no es incómodo, es **trabajo perdido** —y
el portal cierra la sesión sola a los 5 minutos en los cargos de sala.

Empezar por los que ya tienen borrador (`gate:borradores`), que son los que el
proyecto ya identificó como largos.

### F4 · Las vistas sin tabla

**35 de 212 archivos de vista usan `DataTable`.** Todo el canon de §32.8/§32.9
—ficha, expediente, mantenida— aplica a esas 35. Las demás —el tablero, Cortes,
Bitácoras, la encuesta, el reloj, el kiosco— tienen su propio layout y **nunca
pasaron por esta revisión**. Cortes ya aparece con sus 30 sin acuse, y es la
única de ese grupo que el barrido alcanzó a medir.

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

1. **F0** — que el barrido termine. Sin esto, lo demás se prioriza a ciegas.
2. **F1** — el acuse del toque. Un arreglo canónico, 32 síntomas.
3. **F4** — las vistas sin tabla, empezando por Cortes, que ya tiene hallazgos.
4. **F3** — diálogos y formularios, empezando por los que guardan borrador.
5. **F2** — los inalcanzables del tablero.
6. **F5** — una corrida acostado.
7. **F6** — el aparato real. Es el único que no depende de nosotros.

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
| v2.697.1 | confirmar un pago desde el teléfono |
