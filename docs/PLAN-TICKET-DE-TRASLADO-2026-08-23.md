# Ticket de traslado y confirmación por escaneo

**Fecha:** 2026-08-23 · **Estado:** decidido, sin construir · **Arranca:** 2026-08-24

---

## El problema, dicho por quien lo tiene

> «las solicitudes de productos entre sucursales y bodega y los traslados entre
> salas normalmente en las sucursales lo que hacen es poner un tirro a la bolsa
> y le ponen de qué sucursal es y a dónde va, pero es algo informal»

El tirro es el único registro del objeto que de verdad viaja. El portal sabe que
existe un traslado aprobado y sabe que alguien lo va a recibir, pero **entre la
bolsa cerrada y la bolsa abierta no hay nada**: no consta quién la cargó, ni a
qué hora salió, ni —el caso que motiva todo esto— que había otra bolsa al lado
que se quedó.

---

## La medición que fija el alcance

Corrida el 2026-08-23 contra producción. **Volver a correrla antes de discutir
cualquier cosa sobre tamaño o gasto**, porque todo lo que sigue depende de estos
dos números:

```sql
-- Volumen diario
select type, count(*) total,
       count(*) filter (where created_at > now() - interval '30 days') ultimos_30d,
       round(count(*) filter (where created_at > now() - interval '30 days')/30.0, 1) por_dia
from public.approval_requests
group by type having count(*) filter (where created_at > now() - interval '30 days') > 0
order by ultimos_30d desc;

-- Renglones por traslado
with t as (
  select coalesce(jsonb_array_length(metadata->'items'), 0) as n
  from public.approval_requests
  where type='INVENTORY_TRANSFER_REQUEST' and created_at > now() - interval '30 days'
)
select count(*) traslados, sum(n) renglones, round(avg(n),1) promedio, max(n) maximo from t;
```

| | valor |
|---|---:|
| Traslados `INVENTORY_TRANSFER_REQUEST` en 30 días | **350** |
| Por día, entre las 7 salas | **11.7** |
| Renglones totales | 363 |
| Renglones por traslado — promedio | **1.0** |
| Renglones por traslado — máximo | **5** |

**Un traslado es, casi siempre, un solo producto.** Y son doce al día en todo el
portal, o sea menos de dos por sala.

Los envíos (`data/envios.js`, la familia de EMPUJAR) no aparecen: el módulo salió
el 22-ago y todavía no tuvo su primera corrida real. Cuando la tenga, este
conteo hay que rehacerlo — el plan lo cubre igual, pero el tamaño podría cambiar.

### Las dos consecuencias

1. **El papel no es el problema.** Un ticket de un renglón en letra chica mide
   6-7 cm; a 12 por día son ~80 cm diarios y un rollo de 80 m dura tres meses.
   No hay nada que optimizar en el contenido del ticket. Lo que sí se
   desperdicia es **el corte** (2-3 cm de avance cada uno) — ver «El ticket».
2. **La ceremonia tiene que ser mínima.** Doce escaneos al día no pagan una capa
   de bolsas, ni una de rutas, ni una pantalla de administración. Si algo de
   esto empieza a pedir una, es señal de que se fue de tamaño.

---

## Lo que YA está construido

Esto no se rehace. Buena parte del trabajo de mañana es enchufar piezas que
existen, no escribirlas.

| pieza | dónde | estado |
|---|---|---|
| Código por pedido | `src/utils/pedidoPrint.js:563` `buildPedidoCodigo` → `NN-DDMMYY-D-S1` | ya sale en la hoja de despacho |
| Barras en la ticketera | `src/utils/ticketPrint.js` — `codigoDeBarrasParaElRollo`, ESC/POS `GS k`, CODE128 y CODE39 | escrito, **sin probar en papel** |
| Barras en el navegador | `dibujarCodigoDeBarras` (SVG, `jsbarcode` por `await import`) | funciona |
| Impresión | `imprimirDocumento` + cola por sala (`components/impresion/CajasDeImpresion.jsx`) | en producción |
| Lector físico (teclado) | `src/hooks/useCapturaDeCarne.js` — separa lector de tecleo por velocidad (`GAP_HUMANO_MS = 80`) | en producción (apoyo de pedido, entrega de efectivo) |
| Cámara | `src/components/common/LectorDeCodigo.jsx` (`@zxing`, lazy) | en producción (Conteo de inventario) |
| Identificar a una persona por carné | `src/views/pedidos/tabpedidos/ApoioScanModal.jsx` | el patrón a copiar para el retirador |
| Un aviso por sucursal, con push | `src/utils/avisoSalidaPedido.js` → `notifyBranch` | **ya es 1 por sala, no por pedido** |
| Recibir y marcar faltante | `ruta_pedidos.discrepancia`, `views/pedidos/tabpedidos/DecisionDiferencia.jsx` | existe para bodega→sala |
| Traslados sala→sala | `src/data/traslados.js` (pedir) · `src/data/envios.js` (empujar) · `approval_requests` type `INVENTORY_TRANSFER_REQUEST`, hermanados por `metadata->>grupo_id` | **no imprime nada** ← el hueco |

---

## Lo que se decidió, y lo que se descartó

Decisiones del usuario el 2026-08-23. Están acá para no volver a discutirlas.

| propuesta | decisión |
|---|---|
| Un código a nivel **bolsa** que agrupe varios traslados | **Descartada.** Los tickets van pegados **afuera** de la bolsa, así que se escanean sin abrirla. Un ticket por traslado. No existe el objeto «bolsa». |
| Flujo distinto para salas cercanas (Salud 1 ↔ Salud 2) | **Descartada.** El flujo es el mismo siempre. Cuando hay un solo traslado, la alerta no aparece y no molesta a nadie. |
| Escanear producto por producto al cargar | **Fuera de v1.** Lo que se verifica al cargar es el **traslado**; el producto se verifica al **recibir**, con el modelo de diferencias que ya existe. |
| Capa de ruta / optimización para sala→sala | **Descartada.** Doce traslados al día no la pagan. |
| El código de barras «contiene todos los productos» | **Aclarado.** Un código 1D no guarda productos: guarda el identificador del traslado y el portal resuelve el contenido. Mejor así — el papel no se puede desactualizar. |

---

## El modelo

### El ticket

Uno por traslado. Se imprime en la ticketera de la sala de **origen** al
despachar.

Contenido, en 54 columnas (letra chica del rollo):

```
______________________________________________________
                      TRASLADO
                     TR000047
              [ codigo de barras CODE128 ]

DE: Salud 1                     PARA: Salud 2
Pide: Ana Pena          Envia: Jose Martinez
23/08/26 03:08 p.m.
______________________________________________________
CANT  PRODUCTO
  2   AMOXICILINA 500MG CAP x 12
______________________________________________________
              Recibido por: ______________
```

Reglas que ya son del proyecto y aplican tal cual:

- **Sin encabezado de empresa.** Es un documento interno; el nombre y la
  dirección son 4-5 renglones que no sirven a nadie. Arranca en `TRASLADO`.
- **Sólo ASCII** — `soloAscii` de `src/utils/ticketCampos.js`. «NUÑEZ» sale
  `NUÆEZ` si no se pliega, y los nombres de producto vienen de la base sin que
  nadie los escribiera pensando en papel térmico.
- **El nombre del producto se recorta acá** (`recortar`), no en la impresora,
  que parte a mitad de palabra donde se le acaba el rollo.
- **Nada del sistema de origen en el papel.** CLAUDE.md, «la pantalla habla del
  PORTAL»: vale también para lo que se imprime.
- **El valor del código va escrito como texto normal** (`TR000047` arriba de las
  barras), **no como HRI**. `HRI_APAGADO` en `ticketPrint.js` está así a pedido
  expreso del usuario porque el carné es una credencial; el código de un
  traslado no lo es, y alguien tiene que poder teclearlo cuando el escaneo
  falle. **No tocar `codigoDeBarrasParaElRollo` para esto** — se resuelve
  imprimiendo el texto por separado, y así la regla del carné queda intacta.
- **El valor es alfanumérico sin guiones.** `limpiarValorDeBarras` deja sólo
  `A-Z0-9`: el formato de `buildPedidoCodigo` (`01-230826-1-S1`) se aplastaría a
  `012308261S1`. El código del traslado **nace** alfanumérico, no se limpia
  después.

### El corte, que es lo único que se desperdicia

Cada corte se come 2-3 cm de avance. Con tres traslados de Salud 1 a Salud 2 en
la misma bolsa, los cortes cuestan más que los tres tickets.

**Al imprimir, si hay varios pendientes al mismo destino, salen en una tira con
línea de corte punteada entre ellos y un solo corte al final.** Cada uno
conserva su código; se separan a mano. Es la misma pregunta que hace la alerta
del retiro, respondida en la impresora — y no reintroduce el objeto «bolsa».

### El retiro

Se abre **en la pantalla de la sala de origen**, no en el teléfono del que se
lleva las cosas.

1. **El retirador se identifica con su carné.** Mismo patrón que
   `ApoioScanModal` — `useCapturaDeCarne` ya distingue el lector de un tecleo
   por la velocidad, y lo que queda registrado es que esa persona **estuvo ahí
   con su carné**, no un nombre tecleado.
2. La pantalla muestra **el listado de traslados pendientes que SALEN de esta
   sala** (filtrado por permisos).
3. Se escanean los tickets. Cada escaneo marca su traslado como cargado.
4. Al dar **Finalizar**, el portal compara contra los pendientes y avisa.
5. Se emite **un aviso por sala de destino** (`notifyBranch`, con push), con
   todos los traslados que van para ella. Ya existe el mecanismo:
   `avisarSalidaALasSalas`.

### Las dos severidades de la alerta

Son dos preguntas distintas y no se pueden mezclar: si se alerta de todo, la
gente aprende a saltear la alerta, y entonces tampoco ve la que importa.

| caso | ejemplo | comportamiento |
|---|---|---|
| **Alerta fuerte** — hay un pendiente para un destino que **ya vas a visitar** | Cargaste un traslado a Salud 2 y quedó otro para Salud 2 | Rojo. Descartarlo **exige motivo escrito**. Es un error, no una decisión. |
| **Aviso** — hay un pendiente para **otro** destino | Queda algo para Salud 4 y no vas para allá | Informativo. Un toque para sumarlo. Se descarta sin motivo. |

El listado se filtra por **origen**; la alerta se calcula por **destino** contra
lo que se escaneó en esta pasada.

### El descarte, y por qué tiene que volver

«Deja constancia» sirve para auditar después. No evita nada si mañana el
traslado reaparece tan callado como hoy — así es como un aviso descartable se
convierte en «olvidar con permiso».

1. El descarte es **una fila propia** (quién, cuándo, cuál traslado, en qué
   retiro, motivo si lo hubo). **No un campo en el `metadata` del traslado**: el
   mismo traslado se puede descartar tres días seguidos y las tres veces cuentan
   por separado.
2. Vuelve al listado **con su edad**, y ordenado primero: «lleva 3 días sin
   salir».
3. **Al tercer descarte se le avisa a la sala de destino.** Es la que está
   esperando y la única que va a reclamar. Ver
   [[feedback_una_alarma_que_espera_a_que_alguien_mire_no_cierra_el_circuito]].

---

## La prueba de papel va primero

**No se construye nada hasta que esto conteste.** Es una prueba de cinco
minutos.

`carnePrint.js:17` dice que **CODE128 es la simbología del carné de plástico, o
sea la única ya probada contra los lectores que hay en las salas**. Lo que sigue
sin respuesta **no es si el lector la lee**: es si la rendición en papel térmico
(`GS k I`, `BARRAS_MODULO = 2` puntos) sale legible.

Procedimiento:

1. Imprimir por la **cola de la sala** (el agente escribe con `lp -o raw`, sin el
   programa de la caja en el medio) un CODE128 de 8 caracteres.
2. Pasarlo por el lector físico de la sala.
3. **Comprobar que el sistema de facturación siga imprimiendo después.** Un
   comando que la impresora no entienda la deja esperando bytes y se traga el
   trabajo siguiente — ya pasó con el `\x00` de `GS V 66 0`, que colgó la
   ticketera de Salud 4.
4. Si CODE128 no sale legible, repetir con CODE39 (`SIMBOLOGIAS` ya acepta las
   dos). Ocupa casi el doble de ancho por carácter, así que puede haber que
   bajar `BARRAS_MODULO`.

**Si contesta que sí, el lector físico entra en v1 y la cámara queda de
respaldo** — que es al revés de lo que se supuso al empezar a discutir esto.

### La cámara, si hace falta

`LectorDeCodigo` funciona, pero **se cierra después de una lectura**. Escanear
seis tickets seguidos son seis ciclos de abrir/apuntar/500 ms de
calentamiento/cerrar. Para servir necesita **modo continuo**: la cámara queda
abierta, acumula y deduplica.

Y hay un riesgo propio de la cámara que el lector físico no tiene: los primeros
cuadros vienen borrosos y **zxing inventa lecturas** (documentado en el archivo).
Acá una lectura falsa marca como cargado algo que no está. Se defiende solo si
**el servidor rechaza todo código que no esté en la lista de pendientes de esta
sala** — que hay que hacer igual.

---

## Los tres casos que hay que resolver o el flujo se traba

1. **Ticket roto o ilegible.** Tiene que existir «buscar por destino y confirmar
   a mano», con registro de que se hizo así. Sin esto, el primer ticket mojado
   deja a alguien sin salida y la conclusión es dejar de usar la pantalla.
2. **Ticket viejo reusado.** Un código ya recibido el 22-ago **no puede volver a
   confirmar nada**: el servidor lo rechaza nombrando la fecha. Sin esto, un
   ticket que no se destruyó revalida en silencio.
3. **Reimpresión.** `impreso_at` en la fila, y reimprimir es explícito y deja
   rastro. Si no, hay dos papeles con el mismo código dando vueltas.

Y uno más, del mismo tipo: escanear un ticket que **sale de otra sala** (alguien
pegó un papel viejo) se rechaza nombrando el origen.

---

## El riesgo que hay que diseñar en contra

Si la pantalla **bloquea** el retiro hasta que todo esté escaneado, el día que
una bolsa no esté lista alguien la va a escanear igual, o va a imprimir un
ticket de algo que no existe. El antídoto no es un candado más duro: es que
**«no va hoy, porque…» sea un botón de primera clase**, más fácil que la salida
deshonesta. Es el mismo criterio que ya tiene `pedido_items.motivo_no_envio`.

---

## Orden de construcción

| # | qué | depende de |
|---|---|---|
| 0 | **Prueba de papel** (arriba) | nada |
| 1 | **Ticket impreso** por traslado, con su código, sin encabezado de empresa, con la tira de corte único por destino | 0 |
| 2 | **Pantalla de retiro**: listado por origen, carné del retirador, escaneo, las dos alertas, descarte con constancia | 1 |
| 3 | **El descarte que vuelve**: edad en el listado y aviso al destino al tercero | 2 |
| 4 | **Recepción escaneando**, reusando el modelo de diferencias que ya existe | 2 |

El paso 1 ya mata el tirro por sí solo y no depende de ninguna pantalla nueva.
Si el día se acaba ahí, el día valió la pena.

---

## Lo que este plan NO hace

- No crea el objeto «bolsa» ni un código a nivel bolsa.
- No agrega rutas, paradas ni optimización para sala→sala.
- No escanea producto por producto al cargar.
- No cambia `codigoDeBarrasParaElRollo` ni la regla del HRI apagado del carné.
- No optimiza el contenido del ticket para ahorrar papel: **está medido y no
  hace falta**.

---

## Recordatorios del repo que aplican

- **Tabla nueva**: PK + `created_at` + **RLS con policy explícita**. `USING
  (true)` prohibido en UPDATE/DELETE y `WITH CHECK (true)` en INSERT. Toda
  llamada `auth_*` dentro de una policy va envuelta en `(SELECT ...)`.
- **Migración**: `SET lock_timeout = '5s'` siempre, y **el archivo local en el
  mismo commit** con la versión de 14 dígitos que devolvió el servidor. Cerrar
  con `npm run gate:migrations` y `-- --remote`.
- **Pantalla nueva**: `usePestanaEnUrl` si tiene pestañas, `LiquidSelect` en vez
  de `<select>`, `appendAuditLog` en cada acción, y **declararla en
  `auditoria/areas.mjs`** — un archivo sin área hace fallar `gate:auditoria`.
- **Gates antes de cerrar**: `gate:movil` (toca tablas y diálogos), `gate:design`,
  `gate:borradores` si el formulario pasa de 6 controles, `gate:auditoria`.
- **Versión**: `npm run version:bump -- minor "Título"`, entrada en
  `CHANGELOG.md`, nunca en `src/version.js`.
- **Otras sesiones tocan este árbol**: `git status --short` antes de editar un
  archivo ajeno, paths explícitos en cada `git add`, nunca `add -A`.
