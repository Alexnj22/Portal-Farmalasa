# Ticket de traslado y confirmación por escaneo

**Fecha:** 2026-08-23 · **Auditado contra producción:** 2026-08-24 · **Estado:** decidido, sin construir

> La auditoría del 24-ago cambió tres cosas del plan original: apareció el
> código que faltaba (`id_traslado`), se cayó el paso 1 para Bodega (no tiene
> ticketera) y los pedidos salieron de v1. Las secciones de abajo ya están
> corregidas; el detalle de qué se midió está en «Auditoría».

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
   6-7 cm; a 12 por día son ~80 cm diarios. **El largo del rollo no está
   verificado** —«tres meses» era una estimación, no una medición—, pero con
   ese consumo cualquier rollo comercial aguanta más de un mes. Medición real
   del papel que HOY se gasta, en «Auditoría · el papel».
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
| Incluir los **pedidos** a Bodega en v1 | **Fuera de v1** (auditoría 24-ago). Un pedido no es una bolsa: son ~424 renglones y muchas cajas. Su código confirmaría el pedido, no que las cajas estén todas arriba — y lo que se olvida en un pedido es UNA CAJA. La hoja de despacho ya cumple. Ver «Auditoría · por qué los pedidos salen de v1». |
| Ticketera en **Bodega** | **Pendiente de instalar** (decisión del usuario, 24-ago). Las otras seis salas funcionan desde el día uno. |
| Inventar una secuencia para el código | **Descartada.** `id_traslado` ya existe y es compartida con los pedidos. Ver «El código». |

---

## El modelo

### El ticket

Uno por traslado. Se imprime **donde está físicamente el producto**, en el
momento en que el despacho se confirma.

**«Donde está el producto» NO es `origen_branch_name`.** El 28% de los
traslados que salen de Bodega (53 de 191) son `por_respaldo`: los despacha otra
sala mientras Bodega está cerrada. Caso real del 24-ago —
`origen_branch_name: "Bodega"`, `by_sala: "S3"`—: el ticket tiene que decir
«DE: Salud 3» y el trabajo de impresión tiene que ir a la caja de Salud 3. Se
toma de quien confirma el despacho, y el listado del retiro incluye
`salas_que_cubre_ahora` (la MISMA función que usa la policy — ver
`fetchSalasQueCubro`).

**Bodega no tiene ticketera y queda pendiente de instalarla** (decisión del
usuario, 24-ago). Mientras tanto sus traslados —el 55% del total— no imprimen
por la cola; `imprimirDocumento` cae solo al diálogo del navegador, así que la
pantalla funciona igual y el papel sale por donde haya. **Las otras seis salas
sí quedan cubiertas desde el día uno**, y entre ellas se mueven 159 traslados
cada 30 días (5.3 por día).

### Solicitud o traslado: el ticket tiene que decirlo

Pedido del usuario el 24-ago, y no es cosmético — son dos hechos distintos para
quien recibe:

| familia | qué es | quién la abre | ¿el destino la espera? |
|---|---|---|---|
| **SOLICITUD** | la sala que NO tiene pide, y la que tiene confirma | `src/data/traslados.js` · `INVENTORY_TRANSFER_REQUEST` | **sí**, alguien la pidió |
| **ENVÍO** | la sala que tiene EMPUJA sin que le pidan | `src/data/envios.js` | **no**, le llega de sorpresa |
| PEDIDO | a Bodega, con hoja de despacho | tabla `pedidos` | fuera de v1 |

Va en `ticket.titulo`, que el maquetador ya imprime en mayúsculas debajo de la
regla: **no hace falta mecanismo nuevo**. Y cambia el aviso al destino: una
solicitud dice «va en camino lo que pediste»; un envío tiene que decir qué es y
por qué se lo mandan, porque nadie del otro lado lo estaba esperando.

Contenido, en 54 columnas (letra chica del rollo):

```
                     SOLICITUD
______________________________________________________
              [ codigo de barras CODE128 ]
                       32277
DE: Salud 2                     PARA: Salud 1
Pide: Helen Huezo      Envia: Karen Figueroa
24/08/26 04:35 p.m.
______________________________________________________
CANT  PRODUCTO
  1   FOSFOCIL 500 X 12 CAPS
______________________________________________________
              Recibido por: ______________
```

El `32277` de abajo de las barras es la **leyenda del código**, que el
maquetador ya sabe imprimir (`codigos[].leyenda`) — no es el HRI de la
impresora, que sigue apagado. Ver «El código».

### El código: ya existe, y sirve para los dos flujos

`approval_requests` sólo tiene `id uuid` —36 caracteres, inviable en un CODE128
de rollo—, así que el plan original iba a inventar una secuencia. **No hace
falta.** `metadata.erp_traslado` trae `id_traslado`: cinco dígitos,
secuencial, y es **una sola secuencia compartida con los pedidos** (medido el
24-ago: pedidos 28480–32205, solicitudes entre salas 29441–32278). Un solo tipo
de código cubre los dos flujos, que es justo lo que se pidió.

Tres cosas que hay que saber antes de usarlo:

- **Existe sólo DESPUÉS del despacho exitoso.** No estorba: es exactamente el
  momento en que hay que imprimir. Pero significa que no se puede pre-imprimir
  un ticket «para llenar después».
- **Está doble-codificado.** `metadata.erp_traslado` es una **cadena JSON dentro
  del jsonb**, no un objeto: se lee
  `(metadata->>'erp_traslado')::jsonb->>'id_traslado'`, **nunca**
  `metadata->'erp_traslado'->>'id_traslado'`. Hoy el portal sólo lo usa como
  bandera de «ya se despachó», así que nadie lo había abierto.
- **Cinco dígitos entran de sobra.** Con `BARRAS_MODULO = 2` un CODE128 de 5
  caracteres mide ~25 mm de los ~72 mm útiles del rollo. El tope práctico son
  ~20 caracteres; no acercarse sin volver a medir.

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
- **El valor del código va como `leyenda`, no como HRI.** `HRI_APAGADO` está
  así a pedido expreso del usuario porque el carné es una credencial; el código
  de un traslado no lo es, y alguien tiene que poder teclearlo cuando el escaneo
  falle. **No tocar `codigoDeBarrasParaElRollo`** — el maquetador ya imprime un
  renglón de leyenda debajo de cada código, así que la regla del carné queda
  intacta y no hay código nuevo que escribir.
  ⚠️ El comentario de `seccionesParaElPrograma` dice que la impresora imprime el
  valor «con `GS H 2`». Está desactualizado: el código manda `GS H 0` y el HRI
  está apagado. Corregirlo al pasar por ahí.
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
| — | **Recorte de papel de los tickets que ya salen** (título sin doble alto, blanco del pie): ~13%. Suelto, no bloquea nada, y no vale la pena hacerlo antes que lo de arriba | nada |
| — | **Ticketera de Bodega**: pendiente de comprar/instalar. Destraba el 55% restante | hardware |

El paso 1 ya mata el tirro por sí solo y no depende de ninguna pantalla nueva.
Si el día se acaba ahí, el día valió la pena — y cubre a las seis salas que
tienen caja, que son 5.3 traslados al día.

---

## Lo que este plan NO hace

- No crea el objeto «bolsa» ni un código a nivel bolsa.
- No agrega rutas, paradas ni optimización para sala→sala.
- No escanea producto por producto al cargar.
- No cambia `codigoDeBarrasParaElRollo` ni la regla del HRI apagado del carné.
- No optimiza el contenido del ticket para ahorrar papel: **está medido y no
  hace falta** — ver «Auditoría · el papel».
- No cubre los pedidos a Bodega (fuera de v1) ni instala la ticketera de Bodega
  (pendiente, decisión del usuario).

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

---

## Auditoría — 2026-08-24

Medido contra producción. Lo que sigue **ya está aplicado** en las secciones de
arriba; queda acá el detalle de qué se midió y por qué cambió la decisión.

### De dónde salen los traslados, y quién puede imprimir

```sql
select metadata->>'origen_branch_name' origen, count(*) traslados,
       round(count(*)/30.0,2) por_dia,
       count(*) filter (where (metadata->>'erp_traslado')::jsonb ? 'por_respaldo') por_respaldo
from public.approval_requests
where type='INVENTORY_TRANSFER_REQUEST' and created_at > now() - interval '30 days'
group by 1 order by 2 desc;
```

| origen | traslados/30d | por día | por respaldo |
|---|---:|---:|---:|
| **Bodega** | **191** | 6.37 | **53** |
| Salud 1 | 48 | 1.60 | 0 |
| Salud 2 | 44 | 1.47 | 0 |
| Salud 3 | 28 | 0.93 | 0 |
| Salud 5 | 15 | 0.50 | 0 |
| Salud 4 | 14 | 0.47 | 0 |
| La Popular | 8 | 0.27 | 0 |
| Bodega · Área de Vencidos | 3 | 0.10 | 2 |

Y las cajas de impresión, el mismo día:

| sala | caja | estado |
|---|---:|---|
| La Popular, Salud 1, 2, 3, 4, 5 | 1 c/u | **viva** (latido de hace segundos) |
| **Bodega** | 0 | **sin caja** |
| Administración | 0 | sin caja |

**Bodega es el origen del 55% de los traslados y no tiene ticketera.** El plan
original decía «se imprime en la ticketera de la sala de origen» y para más de
la mitad de los casos eso no existía. Decisión del usuario: **queda pendiente
instalarla**, y las seis salas restantes —159 traslados cada 30 días, 5.3 por
día— entran igual.

Los **53 `por_respaldo`** son el segundo hallazgo y es más sutil: el origen
registrado dice «Bodega» pero el producto y la persona están en otra sala.
Imprimir por `origen_branch_name` mandaría el papel a la caja que no existe y
escribiría un origen falso en el ticket.

### El código que ya existía

`approval_requests` no tiene número propio (`id uuid`, 36 caracteres). Pero:

```sql
select 'pedidos' fuente, min(id_traslado::bigint), max(id_traslado::bigint)
from public.pedido_traslado_linea
where id_traslado ~ '^[0-9]+$' and created_at > now() - interval '30 days'
union all
select 'solicitudes entre salas',
       min((metadata->>'erp_traslado')::jsonb->>'id_traslado')::bigint,
       max((metadata->>'erp_traslado')::jsonb->>'id_traslado')::bigint
from public.approval_requests
where type='INVENTORY_TRANSFER_REQUEST' and metadata ? 'erp_traslado'
  and created_at > now() - interval '30 days';
```

| fuente | menor | mayor |
|---|---:|---:|
| pedidos | 28480 | 32205 |
| solicitudes entre salas | 29441 | 32278 |

**Una sola secuencia, entrelazada.** Cinco dígitos, perfecto para un CODE128 de
rollo. Detalle en «El código».

### Por qué los pedidos salen de v1

```sql
select count(distinct id_traslado) traslados, count(*) renglones,
       count(distinct (pedido_id::text||'-'||erp_sucursal_id::text)) entregas
from public.pedido_traslado_linea
where created_at > now() - interval '30 days' and id_traslado is not null;
```

**3,196 `id_traslado` distintos para 20 entregas pedido-sala.** Cada renglón del
pedido crea su propio traslado. Y por el otro lado: 61 pedidos en 30 días (2.0
por día, 1.0 sala cada uno) con **25,840 renglones** — unos 424 por entrega.

O sea que para un pedido, `id_traslado` no identifica lo que se carga: lo
identifica `pedidos.numero`. Son dos espacios de códigos, y el plan original los
trató como uno.

Pero el motivo de fondo para dejarlos afuera no es el código, es físico: **un
pedido no es una bolsa, son muchas cajas.** Un código a nivel pedido confirma el
pedido, no que sus cajas estén todas arriba del camión — y lo que se olvida en
un pedido es una caja. La garantía «no olvidés nada» es real para las bolsas
chicas de sala a sala (12 al día, fáciles de dejar) y sólo a medias para los
pedidos. Meterlos exige resolver el conteo de cajas, que es otro problema.

### El papel

Lo que HOY sale por la cola de las salas, en 30 días:

```sql
with e as (
  select titulo, length(contenido) bytes, encode(contenido,'escape') t
  from public.cola_impresion where created_at > now() - interval '30 days'
), l as (
  select titulo, bytes, length(t) - length(replace(t, chr(10), '')) lineas from e
)
select titulo, count(*) impresos, round(avg(lineas),1) lineas_prom,
       round(sum(lineas)*0.35/100,2) metros_30d
from l group by titulo order by 2 desc;
```

| ticket | impresos/30d | por día | líneas | ~cm | m/30d |
|---|---:|---:|---:|---:|---:|
| Bolsa de efectivo | 155 | 5.2 | 19.1 | 6.7 | 10.39 |
| Vale de efectivo | 18 | 0.6 | 18.9 | 6.6 | 1.19 |
| Prueba de la caja | 3 | 0.1 | 23.3 | 8.2 | 0.25 |
| Entrega de bolsas | 1 | — | 24.0 | 8.4 | 0.08 |
| Carné del día | 1 | — | 18.0 | 6.3 | 0.06 |
| **total** | **178** | **5.9** | | | **~12 m** |

**Doce metros al mes entre las seis salas.** Y el maquetador ya está optimizado:
los cuatro renglones en blanco que dejaban los códigos de impresora se quitaron
en v2.654.2, y el encabezado de empresa es opcional (la etiqueta de bolsa no lo
lleva).

**De esos 19 renglones, 6 son el margen de corte** (`SALTOS_DE_CORTE = 6`,
~17 mm) y **no se tocan**: está medido con papel en la mano el 2026-08-17 — con
12 mm la cuchilla se comía la última línea. Es la trampa de este pedido: el
recorte más obvio es justamente el que sostiene el ticket.

Lo realmente recortable son ~2 renglones de 19 —el título en doble alto, que
ocupa el alto de dos, y el blanco antes del pie—: **13%, o sea 1.5 m al mes.**
Se puede hacer, pero conviene saber que ahí no hay nada que ganar.

Dos límites de esta medición, que hay que decir: **no incluye lo que sale por el
camino directo** (sin pasar por la cola) ni el papel del **sistema de
facturación**, que es casi seguro el que se lleva los rollos de verdad. Si el
objetivo es gastar menos papel, el número que falta medir es ése.

### Lo demás que se revisó

- **`grupo_id` no existe en ningún dato real** — cero filas en 30 días. La
  solicitud a varias salas (v2.672.0–v2.680.0) nunca se usó. No diseñar el
  ticket alrededor de eso.
- **`fetchTrasladosPorConfirmar` lleva `.range(0, 200)`.** Hoy no trunca nada
  —los pendientes son pocos y el filtro por origen va en el servidor— pero el
  listado del retiro **no debe heredar ese patrón**: es exactamente la forma del
  bug que escondió tres cajas despachadas (CLAUDE.md, «un tope se aplica ANTES
  del filtro»). Con 14 objetos al día no hay riesgo de cruzar las 1000 filas.
- **Falta decidir**: qué permiso de módulo filtra el listado, y qué pasa cuando
  la sala no tiene señal (el código no lleva los productos, así que resolverlo
  exige la base — con 14 escaneos al día, la salida razonable es permitir marcar
  «cargado» sin resolver y reconciliar después, o decir que sin señal no
  funciona).


---

## El retiro — diseño cerrado con el usuario el 2026-08-24

Reemplaza al «retiro» del plan original: es más simple de usar y más exigente de
construir, porque introduce un estado que el circuito no tenía.

### Francisco no elige nada

> «que él no tenga que seleccionar en qué sala está, que el código de barras lo
> diga ya, así cuando escanea, sólo se va llenando con los productos /
> solicitudes y traslados.»

Cada ticket ya sabe de dónde sale y a dónde va, así que **el primer escaneo dice
dónde está parado**. No hay selector de sala, no hay configuración, y no se puede
elegir mal.

Y como el manifiesto se arma escaneando, el portal sabe **qué lleva encima**. De
ahí sale solo lo que se pidió al llegar a cada sucursal:

- **qué dejar** = lo que trae con destino a esa sala
- **qué recoger** = lo que esa sala tiene pendiente de salir

### La ubicación avisa, el escaneo decide

**Medido el 2026-08-24, y es lo que cierra la discusión:**

| par de salas | metros |
|---|---:|
| **Salud 3 ↔ Bodega** | **4** |
| Salud 1 ↔ Salud 2 | 319 |
| todos los demás | 2.827 o más |

Salud 3 y Bodega **son el mismo edificio**. Ningún GPS los separa —la precisión
buena de un teléfono son 5-20 m— y no es un par cualquiera: Bodega es el 55% de
los traslados y Salud 3 es su sala de respaldo.

Así que **la ubicación no puede decidir en qué sala está nadie**. Sirve para lo
que sí hace bien: avisar *antes* de bajar del vehículo, mientras se acerca. Si
esa pista confunde Salud 3 con Bodega no rompe nada, porque el escaneo corrige.

Y **funciona hoy, en la web**: `RutaMapModal` ya usa
`navigator.geolocation.watchPosition` en producción para el mapa de rutas. Lo
que necesita la app nativa es la ubicación **de fondo** (pantalla apagada), que
no es el caso de alguien con el teléfono en la mano.

### El estado nuevo: en tránsito, con nombre

> «que quede en tránsito con Francisco, ya en responsabilidad de quien escanea y
> se lleva el producto.»

Hoy el circuito tiene dos estados —despachado (`erp_traslado`) y recibido
(`erp_recibido`)— y entre los dos la bolsa no tiene dueño. El retiro agrega el
tercero: **entre que sale y llega, hay una persona responsable con nombre.**

Consecuencias que hay que construir con él, no después:

- La sala de destino tiene que **ver de quién viene**, no sólo que está en
  camino.
- Una bolsa en tránsito que nadie entrega **se queda así para siempre** si nadie
  la vigila. Necesita edad y aviso, igual que el descarte que vuelve.
- Recibir **cierra la custodia**. Y una bolsa que nunca se retiró se sigue
  pudiendo recibir: es el caso de la sala vecina, donde alguien la cruza
  caminando. **El retiro es opcional; la custodia existe sólo si alguien la
  tomó.**

### Quién entrega: dos personas, salvo cuando son la misma

> «debemos tener a alguien responsable que me los entrega, así que en el modal de
> escanear tickets, que se escanee el responsable de entregar de esa sucursal.»

Al llegar a una sala, **alguien de esa sala escanea su carné una vez** —no una
por ticket— y con eso queda registrado quién entregó. Después Francisco escanea
las bolsas.

**La excepción, dicha por el usuario:** no aplica cuando quien retira ES de la
sala que entrega. «Si Francisco, que es de Bodega, retira algo de Bodega, él
mismo es el responsable. O si de Salud 1 retira algo de ahí mismo para Salud 2.»

O sea la regla es una sola: **si el retirador pertenece a la sala que entrega, no
hay segunda firma, porque sería la suya.**

### ⚠️ La sala que entrega NO es `origen_branch_name`

Es la trampa de todo este diseño, y ya está medida: **53 traslados que dicen
«Bodega» los despachó S3**, y 3 más del área de vencidos. Cuando una sala está
cerrada, la cubre su respaldo y **la bolsa está en el mostrador de la otra**.

Entonces, para decidir si hace falta la segunda firma, lo que manda es dónde está
FÍSICAMENTE la bolsa:

```
sala que entrega = por_respaldo ? metadata.erp_traslado.by_sala : origen_branch_id
```

`by_sala` viene como código (`"S3"`), no como id de sala: hay que traducirlo con
`ERP_CODIGOS` de `constants/erp.js`. Usar `origen_branch_name` haría que un
traslado entregado por Salud 3 pida la firma de alguien de Bodega —que a esa hora
está cerrada— y el retiro se trabaría sin que nadie entienda por qué.

Con Salud 3 y Bodega a cuatro metros, en la práctica la persona está ahí al lado;
lo que importa es que el portal **le pida el carné a quien de verdad puede
firmar**.

### Lo que queda por decidir

- Dónde vive el estado en tránsito: una clave nueva en el `metadata`
  (`retiro: { by, by_name, at, sala, entrego, entrego_name }`) o su propia tabla.
  Una tabla permite el historial de varios intentos; el `metadata` es más barato
  y es donde ya viven los otros dos estados.
- Cuántos días en tránsito disparan el aviso, y a quién.
- Si el retirador puede cerrar un retiro sin entregar todo (y qué pasa con lo que
  le sobró encima).
