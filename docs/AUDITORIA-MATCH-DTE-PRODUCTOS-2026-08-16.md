# ¿Se puede cargar la compra sola? — auditoría del match DTE ↔ productos

**2026-08-16.** Pregunta del usuario: si Bodega va a cargar todas las compras,
¿se puede automatizar? Y la duda concreta: **el nombre del producto en el DTE no
es igual al nuestro**, así que ¿con qué se hace el match?

Esto no es una estimación. Se midió contra lo que ya pasó.

## El banco de pruebas

Toda compra registrada tiene sus renglones en `purchase_receipt_items`, y ahí
`erp_product_id` **es** `products.id` — verificado: 40,576 líneas históricas, las
40,576 casan, ninguna sin producto. O sea que existe la respuesta correcta
escrita por una persona para cada línea de cada factura.

Cruzando esas compras con su DTE (por sello de Hacienda o por número de
documento) quedan **789 compras de 60 proveedores** entre el 1-jun y el
15-ago-2026: **6,920 renglones de DTE** contra **6,819 renglones cargados a
mano**. Ese es el banco: se le pide al matcher que adivine, y se compara con lo
que la persona eligió.

## Primero: el nombre efectivamente NO coincide

Factura de Montreal del 12-ago, siete renglones, comparados uno a uno:

| lo que dice el DTE | lo que tenemos nosotros |
|---|---|
| `OFTIGEL 2% GEL OFT X 10 G` | OFTIGEL **0.2%** GEL OFTALMICO X 10 **GR** |
| `NAFINA PLUS SOL OFT X 15 ML` | NAFINA PLUS **GOTAS** X 15 ML |
| `TODEX SUSP OFT X 5 ML` | TODEX **GOTAS** X 5 ML |
| `SOLEX 0.5% SOL OFT X 15 ML` | **SOLEX GOTAS 0.5%** X 15 ML |
| `TODEXFINA SOL OFT X 7.5 ML` | TODEXFINA **GOTAS** X 7.5 ML |

El proveedor escribe «SOL OFT» donde nosotros escribimos «GOTAS», «G» donde
nosotros «GR», y hasta la concentración cambia de forma (`2%` / `0.2%`).
**Comparar nombres exactos da casi cero.** La pregunta correcta no es si el
nombre coincide, sino qué otra cosa sí.

## La cascada, medida

Sobre las 1,288 líneas de agosto, cada una resuelta y comparada contra el
producto que la persona cargó en esa misma compra:

| vía | líneas | % del total | acierto |
|---|---:|---:|---:|
| **1. Código de barras** del DTE contra `products.codigo_barras` | 467 | 36.3% | **99.8%** |
| **2. Nombre** con parecido ≥ 0.75 | 111 | 8.6% | **99.1%** |
| 3. Nombre con parecido 0.45–0.75 | 376 | 29.2% | 91.5% |
| 4. Nombre con parecido < 0.45 | 220 | 17.1% | 66.8% |
| 5. Sin candidato | 114 | 8.9% | — |

**Las dos primeras vías —45% de los renglones— aciertan más del 99%.** Eso es lo
que se puede cargar sin preguntar. La tercera (29%) es «propone y confirma». Las
dos últimas (26%) son trabajo humano.

El corte de 0.75 no es un número elegido: es donde la precisión salta al 99%. El
gradiente completo, medido: ≥0.75 → 98.7%, 0.60–0.75 → 94.4%, 0.45–0.60 → 89.0%,
0.25–0.45 → 69.2%.

## Lo que de verdad resuelve el problema: el código del proveedor

Cada proveedor antepone **su** código de producto. Está en el 96% de los
renglones (6,650 de 6,920), y no es nuestro código — pero es estable:

- Se aprendieron **1,056 códigos** anclándolos con el código de barras.
  **Cero ambiguos**: ningún `(proveedor, código)` apuntó nunca a dos productos
  distintos.
- **86.9% de los renglones** usan un código que aparece en más de un documento,
  y eso en apenas dos meses y medio (2,697 códigos distintos, 2.36 documentos
  cada uno).

O sea: **cada vez que alguien confirma una línea, esa confirmación sirve para
siempre para ese proveedor.** Un diccionario `(proveedor, código) → producto`
alimentado por las confirmaciones llega a cubrir ~87% de los renglones con
precisión de código de barras, y lo hace solo, sin que nadie lo mantenga.

Lo que hoy NO alcanza para arrancarlo: el diccionario anclado por código de
barras sólo aprende de los proveedores que publican el código de barras
(COFARSAL, Santa Lucía), y esos ya no lo necesitan. Rescató 5 líneas. **El
diccionario tiene que sembrarse con las confirmaciones de la gente, no con los
códigos de barras.**

## Estos números son un PISO, no un techo

Se midió sobre `items_text`, que es el JSON **aplanado en una sola cadena**: el
sync une los renglones con ` | ` y pega `código + descripción`. Eso obligó a
adivinar con expresiones regulares dónde termina el nombre y empieza el lote, y
cada proveedor lo escribe distinto (`Lote: X Cant.: N`, `L138601 V. 01-11-2028`,
`|75781|08/08/2027|12.000000`, `LOTE: … VENCE: …`, `cantidad - lote - fecha
caducidad 2 - 89009RA1 - …`).

Se midió cuánto de la «inestabilidad» del código es culpa de ese parseo: de los
1,847 códigos que aparecen en más de un documento, 1,540 (83.4%) traen el mismo
nombre siempre. Los 307 restantes se revisaron uno por uno y **ninguno era el
proveedor cambiando el nombre**:

- `dolgenal 60mgx 1amp|75903|03092028|…` — el nombre es idéntico; lo que cambia
  es el lote, que quedó pegado porque ese proveedor separa con `|` y no con
  «LOTE:».
- `Fecha exp 29022028` — Droguería Nova pone el vencimiento en su propio
  renglón, y mi regex leyó «Fecha» como si fuera un código.
- `false|1000|04536|…` — Leterago no manda descripción: manda `false`.

**En el JSON del DTE (`cuerpoDocumento`) nada de eso hay que adivinar:**
`codigo`, `descripcion`, `cantidad` y `precioUni` vienen como campos separados
—se ve en `extractItemsText` de `sync-purchase-emails`, que es justamente quien
los aplana—. Leer el JSON en vez del texto sube todas las cifras de arriba y
además regala la cantidad y el precio, que es lo que hace falta para cargar.

## Cómo se construiría

1. **Leer el JSON, no `items_text`.** Ya está guardado en Storage
   (`purchase_dte_documents.json_path`). Todo lo demás depende de esto.
2. **Cascada por origen, y cada línea dice de dónde salió su producto:**
   código de barras → diccionario aprendido → parecido de nombre → nada.
3. **Una pantalla de confirmación, factura por factura**, con el producto
   propuesto y su origen. Lo que vino por código de barras o por diccionario
   llega marcado listo; lo demás pide un ojo.
4. **Cada confirmación escribe el diccionario.** Es la pieza que hace que el
   trabajo baje solo con el tiempo.
5. **Recién entonces, escribir al sistema.** Y sólo cuando la factura entera
   está resuelta: media compra cargada es peor que ninguna.

**Nunca cargar sin confirmar lo que salió del parecido de nombre.** Con 91.5% de
acierto, una de cada doce líneas entraría al inventario como otro producto — y
un inventario mal cargado no avisa: se descubre contando.

## Lo que NO se verificó

- **`compras.php`** — al escribir esto no se había mirado. **Se estudió el mismo
  día: ver la segunda parte de este documento.** Lo que sigue sin probarse es el
  `insert`: se leyó qué recibe, no se envió nunca.
- **El costo de leer el JSON** de cada documento (hoy nadie lo lee en lote).
- Las 50 líneas (1.8%) en que el código de barras cayó en un producto que no
  estaba en esa compra. Pueden ser sustituciones, devoluciones o un código de
  barras repetido en el catálogo; no se abrieron una por una.

---

# Segunda parte: `compras.php` — sí, el circuito cierra

Estudiado el 2026-08-16 **sin escribir nada**: se bajó la página y su JavaScript
(`js/funciones/funciones_compras.js`, 1,258 líneas) y se leyeron dos consultas.
**No se envió ningún `insert`; no se creó ninguna compra.**

## Los cuatro procesos

`compras.php` es un endpoint POST con un campo `process` que decide qué hace:

| `process` | qué hace | escribe |
|---|---|:--:|
| `validarNumdoc` | ¿ya existe ese número de documento para ese proveedor? | no |
| `consultar_stock` | ficha del producto por `id_producto` | no |
| `datos_proveedores` | la percepción del proveedor | no |
| **`insert`** | **crea la compra y da ingreso al inventario** | **sí** |

Y el `insert` recibe exactamente esto:

```
process, datos, json_arr, cuantos, total, fecha, concepto, destino, proveedor,
tipo_doc, numero_doc, sumas_sin_iva, subtotal, iva, venta_exenta,
total_percepcion, dias_credito, id_compra, total_renta_retenida, json_imp_arr,
tipo_operacion, clasificacion, tipo_costo_gasto, total_fovial, total_cotrans,
clase_documento_tributario, numero_serie
```

Cada renglón dentro de `json_arr` (`storeTblValue()`):

```
id_producto, compra, venta, cant, unidad, vence, id_presentacion,
exento, bandera, descripcion_ser, compra_fin, numero_lote
```

**De esos doce campos, el DTE da tres** —`id_producto` (vía el matcher), `cant`
y `compra`—; **cinco los da el propio sistema** cuando se le pregunta por el
producto (`consultar_stock` devuelve costo, precio de venta, unidad,
presentación y si es perecedero); y **dos no los da nadie: `vence` y
`numero_lote`.**

## Lo que el DTE no trae: lote y vencimiento

El estándar de Hacienda no tiene campo de lote ni de vencimiento. Los
proveedores los escriben **dentro de la descripción**, cada uno a su manera
—`Lote: 8168 … Fecha Exp.: 01/01/2030`, `L138601 V. 01-11-2028`,
`|75781|08/08/2027|`, `LOTE: 251082 VENCE: 31/10/2027`—. Y hacen falta: de tres
productos consultados, dos vienen con `perecedero = 1`.

Se pueden sacar con una regla por proveedor —son pocos y el formato es fijo—
pero **es la parte que no se puede resolver de forma genérica**, y por eso la
pantalla de confirmación tiene que mostrarlos para que un ojo los mire.

## ⚠️ Un producto tiene DOS números, y confundirlos devuelve otro producto

**Corregido el 2026-08-16.** La primera versión de este documento decía que los
id de producto eran por cuenta, como pasa con `id_proveedor`. **Era falso, y el
error fue del instrumento**: se consultó `consultar_stock` con `tipo=1`, que no
es ninguno de los dos modos reales, y devolvió otra cosa.

El sistema identifica un producto de dos maneras, y `consultar_stock` lo decide
con `tipo`:

| `tipo` | qué espera en `id_producto` | quién lo usa en la pantalla |
|---|---|---|
| `C` | el **código** del producto | la caja «Ingrese Código de producto» |
| `D` | el **id interno** | el buscador por nombre, que lo saca de `autocomp_prod.php` |

Y devuelve siempre `id_p`, que es **el id interno** — el mismo que después viaja
en `json_arr` como `id_producto`. O sea que la pantalla convierte código → id
antes de guardar.

Consultado con `tipo=D`, los cuatro casos probados dan exactamente nuestro
catálogo:

| se pidió | el sistema respondió | nuestro `products.id` |
|---|---|---|
| `2461` | TODEXFINA GOTAS X 7.5 ML | TODEXFINA GOTAS X 7.5 ML |
| `2445` | NAFINA PLUS GOTAS X 15 ML | NAFINA PLUS GOTAS X 15 ML |
| `2449` | OFTIGEL 0.2% GEL OFTALMICO X 10 GR | OFTIGEL 0.2% GEL OFTALMICO X 10 GR |
| `2014` | PSICODOL 1MG/ML X 60 ML | PSICODOL 1MG/ML X 60 ML |

**`products.id` ES el id interno del sistema.** No hay desfase, no hay que
traducir nada y la automatización puede armar `json_arr` con el id que ya
tenemos. Lo confirma también el histórico: en la compra 153684 los siete
renglones cargados a mano casan por id con el nombre exacto de nuestro catálogo.

Lo que sí es cierto es lo que pasa al equivocarse de modo: pedir `2445` por la
vía del código devuelve **PSICODOL (id 2014)** — un producto real, con
`typeinfo: Success`, sin ningún error. Por eso queda escrito acá: **la
automatización usa `tipo=D` y el id; nunca la vía del código.** El código del
producto en el sistema es otro número que nosotros no guardamos (para estos dos
casos iba 431 arriba del id, pero ese desfase no es una regla en la que
apoyarse).

Aparte, y sin cambios: **`id_proveedor` sí depende de la cuenta** — está medido
en `scrape-erp-proveedores`, y `suppliers.erp_supplier_id` salió de la cuenta de
COMPRAS. Esta automatización va con `ERP_PURCHASES_CREDS` de todos modos, porque
es la cuenta que numera los proveedores igual que nosotros.

## Dos cosas más que conviene saber

- **La compra cae en la sucursal de la SESIÓN**, no en un campo del formulario:
  se cambia con `cambio_sesion.php` (`process=set_sucursal`). La automatización
  tiene que fijar Bodega antes de insertar.
- **El sistema ya rechaza el documento repetido** (`validarNumdoc`, por
  proveedor + número). Es el mismo freno que el aviso nuevo del libro, pero del
  otro lado: uno impide crearlo, el otro lo caza si ya está.

# El diccionario: proveedor + código → producto

Sí: cada confirmación queda anexada y no se vuelve a preguntar. La llave es
**`(NIT del proveedor, código del proveedor) → products.id`**, y el proveedor va
en la llave por dos motivos:

1. **El mismo producto se le compra a varios proveedores, y cada uno lo nombra y
   lo numera distinto.** Medido: de 3,774 productos comprados, **1,180 (31.3%)
   vienen de más de un proveedor** — 1,055 de dos, 125 de tres o más, hasta 5.
   Esos son 2, 3 o 5 renglones del diccionario apuntando al MISMO producto
   nuestro. Cada uno se aprende una vez y no se vuelve a preguntar.
2. **El código es interno de cada proveedor** (`31045`, `0070410`, `35CG`): que
   hoy no choquen entre proveedores es suerte del muestreo, no una garantía.
   Meter el NIT en la llave no cuesta nada y quita el problema para siempre.

Para los proveedores que no mandan código usable —Droguería Nova no manda
ninguno, Leterago manda `false` como descripción— la llave de repuesto es
`(NIT, descripción normalizada)`. Peor, pero también se aprende una sola vez.

Lo que el diccionario **no** debe hacer es aprender solo de lo que adivinó el
parecido de nombre. Se siembra con lo que confirmó una persona y con lo que
resolvió el código de barras; el parecido propone, nunca enseña.

---

# Tercera parte: el formato de cada proveedor

## Lo que NO varía: cantidad y precio

El `cuerpoDocumento` del DTE lo fija Hacienda, así que `cantidad`, `precioUni`,
`uniMedida`, `numItem` y `ventaGravada/ventaExenta/ventaNoSuj` **vienen como
campos numéricos en todos los proveedores por igual**. No hay nada que
interpretar ni que medir por proveedor: el visor de facturas del portal
(`FormPurchaseDteViewer.jsx`) ya los lee así de documentos reales.

**Lo único que cambia de un proveedor a otro es qué escriben dentro de
`descripcion`** — y ahí es donde meten el lote y el vencimiento, que el estándar
no tiene como campo.

## Y hacen falta en casi todas las líneas

Medido sobre las 40,576 líneas de compras ya cargadas:

- **100% tienen lote** (40,573 de 40,576)
- **97.5% tienen vencimiento**
- 97% son productos perecederos

O sea que no es un dato opcional: si no sale del DTE, alguien lo teclea.

## Los seis formatos, medidos

Sobre las líneas de los últimos 120 días:

| proveedor | líneas | vencimiento | lote |
|---|---:|---|---|
| COFARSAL | 3,289 | `Fecha Exp.: dd/mm/aaaa` (99%) | `Lote: X` |
| MONTREAL | 937 | `V. dd-mm-aaaa` (100%) | token suelto antes de `V.` |
| DROGUERÍA AMERICANA | 527 | entre `\|`, sin rótulo (96%) | entre `\|` |
| RONASA | 431 | `VENCE: dd/mm/aaaa` (98%) | `LOTE: X` |
| DROGUERÍA SANTA LUCÍA | 308 | entre `\|`, sin rótulo (100%) | entre `\|` |
| C. IMBERTON | 258 | tras `cantidad - lote - fecha caducidad` (90%) | ídem |
| LAB. VIJOSA | 222 | `(V-mm-aa)` — **sólo mes y año** (99%) | `LOTE: X` |
| DROG. NUEVA SAN CARLOS | 218 | `VENCE: dd/mm/aaaa` (100%) | `LOTE: X` |
| LETERAGO | 288 | entre `\|`, **sólo en el 48%** | entre `\|` |
| DROGUERÍA NOVA | 146 | `Fecha Exp.` **en un renglón aparte** (33%) | `Lote:` |

Seis reglas —rótulo explícito, `V.`, `VENCE:`, pipes, `caducidad`, `(V-`—
cubren esos diez proveedores, que son el grueso del volumen.

## Los que NO lo mandan, y son perecederos igual

| proveedor | líneas | lleva lote/vence en el DTE | los necesita |
|---|---:|:--:|:--:|
| GAMMA LABORATORIES | 251 | **no** | 100% |
| MENFAR | 189 | **no** | 100% |
| SAVONA (LA NEVERÍA) | 184 | **no** | 100% |
| CONGELADOS DEL SABOR | 139 | **no** | 100% |
| STEINER | 98 | **no** | — |

Son **~950 líneas cada cuatro meses** en las que el dato no existe en ningún
lado electrónico: hay que leerlo de la caja física. **Para esos proveedores la
carga no puede ser automática**, y la pantalla tiene que pedirlos.

## Por qué el JSON no es opcional: `items_text` PIERDE renglones

`extractItemsText` descarta la descripción repetida (`seen.has(desc)`), así que
dos renglones del mismo producto —dos lotes de la misma entrega— se funden en
uno. Medido contra las compras ya cargadas:

| proveedor | renglones en el texto | renglones cargados | compras a las que les falta |
|---|---:|---:|---:|
| **COFARSAL** | 2,926 | **3,103** | **81 de 209 (39%)** |
| MONTREAL | 456 | 464 | 4 de 71 |
| RONASA | 315 | 319 | 3 de 24 |

Sólo COFARSAL pierde **177 renglones**. Una compra armada desde `items_text`
entraría incompleta y nadie lo notaría hasta contar. **El JSON es obligatorio, no
una mejora.**

## Lo que falta verificar, y por qué no se hizo todavía

Todo lo de arriba sale de `items_text`, que conserva `descripcion` **literal**
—así que el mapa de formatos es real—. Lo que **no** se pudo confirmar leyendo
los JSON de verdad:

- que **todos** los proveedores llenen `cantidad` y `precioUni` como manda el
  estándar (y no, por ejemplo, cantidad 1 con el total en el precio);
- si alguno usa `montoDescu` (descuento por línea), que cambiaría el costo real;
- cuántos renglones trae de verdad cada documento, sin la deduplicación.

Los archivos están en el bucket privado `purchase-dte` y leerlos en lote pide
una credencial de servicio, que esta sesión no tiene. Es el primer paso de la
implementación, no un pendiente de esta auditoría.

---

# Cuarta parte: los JSON de verdad (14 proveedores)

Leídos con `leer-dte-json`, la función que se desplegó para esto: baja el
archivo del bucket privado con la credencial del servidor y devuelve el
`cuerpoDocumento`. Se invoca desde Postgres con `net.http_post` y el secreto de
Vault, igual que los crons. **No escribe nada.**

## Todos mandan exactamente los mismos campos

COFARSAL, MONTREAL, RONASA, DROGUERÍA AMERICANA, SANTA LUCÍA, IMBERTON, VIJOSA,
NUEVA SAN CARLOS, LETERAGO, NOVA, GAMMA, MENFAR, SAVONA, CONGELADOS y STEINER
traen el renglón **idéntico**:

```
numItem, tipoItem, numeroDocumento, cantidad, codigo, codTributo, uniMedida,
descripcion, precioUni, montoDescu, ventaNoSuj, ventaExenta, ventaGravada,
noGravado, tributos, psv
```

(MENFAR y AMERICANA omiten `psv`/`noGravado`, que son opcionales.)

**No hay formato por proveedor que descifrar para cantidad, precio, descuento ni
unidad**: son campos numéricos del estándar y vienen llenos. Verificado contra
el papel — Gamma, renglón 1: `cantidad: 4`, `precioUni: 2.548673`,
`ventaGravada: 10.19`, y 4 × 2.548673 = 10.19. Cuadra.

## NINGUNO manda lote ni vencimiento

Ni en el renglón, ni en `apendice`, ni en `otrosDocumentos`. El `apendice` —que
sí traen 13 de los 14— es metadato del documento, no de la línea: número de
pedido, transporte, vendedor, condición de pago, código de cliente.

Los diez proveedores que «sí lo mandan» lo meten **dentro de `descripcion`**,
que es texto libre. Los otros cinco no lo mandan en ningún lado.

## El papel dice más que el documento electrónico

La factura de GAMMA del 12-08 imprime **columnas `Lote` y `Vence`** —renglón 1:
lote `D26017`, vence `04/2028`— y su JSON, leído entero, **no las tiene**:
`apendice: null`, y el renglón trae sólo los campos del estándar. Gamma las
imprime desde su propio sistema; no viajan en el DTE.

**Eso abre el camino que faltaba para esos cinco proveedores**: el PDF también
está guardado (`purchase_dte_documents.pdf_path`), y el repo ya extrae texto de
PDF sin navegador — `unpdf`, en `sync-purchase-emails`, para detectar el código
de generación de un PDF huérfano. Leer lote y vencimiento de la tabla impresa es
el mismo trabajo. **No está probado todavía**, pero deja de ser «hay que
teclearlo» y pasa a ser «hay que leer el PDF».

## De paso: COFARSAL dice a qué sala es la factura

Su `apendice` trae `AP3 = "FARMACIA POPULAR"` con etiqueta **«Sucursal»**. Si
eso viene siempre, el widget «Facturas de mi sala» podría asignar sus facturas
solo —hoy las ofrece a todas para que alguien las reclame—. Es una pista, no una
medición: haría falta leer varias para saber si el campo es constante y si el
nombre casa con nuestras salas.

---

# Quinta parte: leer el lote y el vencimiento del PDF — probado

El JSON no los trae para cinco proveedores. El PDF sí, y está guardado. Se
probó con `unpdf`, el mismo extractor que ya usa `sync-purchase-emails`.

## Cómo se lee, y por qué así

**No se busca «un lote» a ciegas.** El JSON ya dice, de cada renglón, el código,
la descripción, la cantidad y el precio. Así que el dato que falta queda
**encerrado entre dos anclas conocidas** y no hay que adivinar cuál número de la
línea es cuál. Dos formas, medidas:

- **(A) columnas sin rótulo** — GAMMA imprime `código descripción LOTE VENCE
  cant precio`: se lee lo que hay entre la descripción y la cantidad.
- **(B) rótulos explícitos** — MENFAR imprime `descripción Lote: X
  Vencimiento: Y`: se busca el rótulo en una ventana corta después de la
  descripción, para no traerse el lote del renglón siguiente.

Si ninguna ancla aparece, devuelve **nulo**. Un vencimiento inventado es un dato
sanitario falso; que la pantalla lo pida es lo correcto.

## Resultados

| proveedor | renglones | lote | vencimiento |
|---|---:|---:|---:|
| **GAMMA** (2 facturas) | 15 y 15 | **15/15 y 15/15** | **15/15 y 15/15** |
| MENFAR (2 facturas) | 4 y 1 | **4/4 y 1/1** | 0/4 y 1/1 |
| RONASA (2 facturas) | 24 y 22 | 23 y 21 | 23 y 20 |
| VIJOSA | 32 | 24 | 0 |
| COFARSAL, MONTREAL | 17, 10 | 0 | 0 |

Verificado contra el papel que mandó el usuario: GAMMA renglón 1, lote `D26017`,
vence `04/2028`. Es exactamente lo que dice la factura.

Los ceros **no son fallas**, y hay que leerlos distinto:

- **COFARSAL y MONTREAL** no necesitan el PDF: su lote y su vencimiento ya vienen
  dentro de `descripcion`, en el JSON. El extractor busca *después* de la
  descripción, y ahí ya no está.
- **MENFAR** imprime `Vencimiento: ?` en una factura y una fecha real en otra:
  el dato no existe, no es que no se encuentre.
- **VIJOSA** escribe el vencimiento como `(V-12-27)` —sólo mes y año— y ese
  formato pide su propia regla.

## Lo que queda claro

**El circuito está completo de punta a punta.** Producto, cantidad, precio,
lote y vencimiento tienen de dónde salir, y lo único que falta es una regla por
proveedor para el lote/vencimiento — que es trabajo conocido, no incertidumbre.

El orden correcto para buscarlos, que salió de estas mediciones:

1. **`descripcion` del JSON** (COFARSAL, MONTREAL, RONASA, AMERICANA, SANTA
   LUCÍA, IMBERTON, VIJOSA, NUEVA SAN CARLOS, LETERAGO, NOVA)
2. **el PDF** (GAMMA, MENFAR)
3. **nadie lo manda** (SAVONA, CONGELADOS, STEINER — helados y bebidas): la
   pantalla lo pide, como hoy.

Y un hallazgo suelto del mismo barrido: **CONGELADOS y STEINER mandan el código
de barras dentro de la descripción** (`Choco Cono Sarita|7401090803022|15.000
|Caja`, `ELECTROLIT MORA AZUL 625ML | 7501125184277`). Para el match de producto
eso los pone en la vía del 99.8%, que es la mejor que hay.

---

# Sexta parte: el vencimiento es MES Y AÑO, y eso lo cambia todo

Regla del negocio dada por el usuario, y confirmada contra los datos: **de las
24,776 líneas de compra de los últimos diez meses, las 24,776 se guardaron con
día 1.** Cero excepciones. (Las 483 con otro día son todas anteriores a
noviembre de 2025, de una convención que ya no se usa; `inventory` dice lo
mismo: 13,206 con día 1 contra 268.)

**El día que imprime el proveedor es ruido.** COFARSAL escribe `01/01/2030`,
RONASA `31/10/2027`, GAMMA `04/2028` y VIJOSA `(V-12-27)`: los cuatro terminan
en el mismo lugar, `AAAA-MM-01`.

Y con eso el formato de VIJOSA —que sin esta regla parecía incompleto por no
traer día— resulta ser **exactamente lo que hace falta**. Al aplicarla pasó de
**0 a 32 de 32**.

## Resultado final del extractor

| proveedor | renglones | lote | vencimiento | de dónde |
|---|---:|---:|---:|---|
| VIJOSA | 32 | 32 | **32** | descripción |
| RONASA | 24 | 24 | **24** | descripción |
| COFARSAL | 17 | 17 | **17** | descripción |
| GAMMA | 15 | 15 | **15** | **PDF** |
| MONTREAL | 10 | 0 | **10** | descripción |
| NUEVA SAN CARLOS | 4 | 4 | **4** | descripción |
| SANTA LUCÍA | 4 | 0 | **4** | descripción |
| MENFAR | 4 | 4 | 0 | **PDF** |
| IMBERTON | 1 | 0 | **1** | descripción |
| AMERICANA | 1 | 0 | 0 | — |

**Vencimiento: ocho de diez proveedores al 100%.** Los dos que faltan son
MENFAR —que imprime literalmente `Vencimiento: ?`, o sea que el dato no
existe— y AMERICANA, que lo manda entre `|` sin rótulo y necesita su regla
posicional.

**Lote: falta en MONTREAL, SANTA LUCÍA y AMERICANA**, los tres por lo mismo —
lo mandan sin rótulo, en una posición fija entre separadores. Es una regla por
proveedor, que era lo previsto desde el principio.

## Un lote inventado es peor que ninguno

IMBERTON rotula sus columnas `cantidad - lote - fecha caducidad`, y el extractor
devolvía **`-`** como número de lote: el guion del rótulo. Un dato que parece
válido y no lo es entra al inventario sin que nada avise. Ahora un lote necesita
al menos dos caracteres alfanuméricos, y si no los tiene devuelve nulo — que es
lo que hace que la pantalla lo pida.

---

# Séptima parte: el lote sin rótulo — y el resultado final

El usuario señaló que DROGUERÍA AMERICANA **sí** manda lote y vencimiento:

```
OVESTIN CREMA 1MG. X 15GR.|B22625K|30/11/2027|7.000000
```

Tenía razón, y la tabla anterior estaba mal por una razón que vale anotar: **la
probé con un solo documento de un solo renglón, y ese renglón era
`REINTEGRO CASA 40 - ||`** — un reintegro, no un producto. Una muestra de uno,
generalizada. Ver [[feedback_una_muestra_de_uno_no_es_el_formato_del_proveedor]].

## El lote se ancla en la fecha, no se busca solo

Casi la mitad de los proveedores manda el lote **sin rótulo**, en una posición
fija. Buscar «algo que parezca un lote» devuelve presentaciones y gramajes, así
que se usa el vencimiento como ancla —que sí se reconoce solo— y **el lote es lo
que está pegado antes**:

- **entre `|`**: el campo anterior al que es una fecha, y sin espacios (el
  nombre del producto también va entre `|`, pero lleva espacios) — AMERICANA,
  SANTA LUCÍA, LETERAGO
- **con la fecha rotulada**: el token pegado antes del rótulo, exigiendo que
  mezcle letra y dígito para no traerse el `30` de «X 30» — MONTREAL
- **con la fila entera rotulada**: IMBERTON escribe el encabezado y después los
  valores en ese orden (`cantidad - lote - fecha caducidad 2 - 790748N11 -
  18-07-2027`), así que el ancla es el orden que él mismo declara

## Un precio leído como fecha

LETERAGO devolvía **`false`** como número de lote. Su descripción es
`false|12.00|02197|01/12/2027|5.00|`, y el precio `12.00` se leía como
**diciembre del año 2000** —mes 12, año 00—, lo que corría el ancla un campo y
tomaba `false` como lote.

La ventana de años válidos pasó de `2000..2100` a **`hoy-5 .. hoy+20`**. Un
vencimiento de hace 26 años no existe en una compra de hoy, y esa sola condición
mata la lectura falsa. Ahora LETERAGO devuelve `S17946`, que es el lote de
verdad.

## Resultado final — 12 proveedores, 378 renglones

| proveedor | renglones | lote | vencimiento |
|---|---:|---:|---:|
| RONASA | 63 | 63 | 63 |
| COFARSAL | 51 | 51 | 51 |
| LETERAGO | 47 | 47 | 47 |
| GAMMA | 43 | 43 | 43 (PDF) |
| VIJOSA | 36 | 36 | 36 |
| DROGUERÍA NOVA | 29 | 29 | 28 |
| DROGUERÍA AMERICANA | 27 | 26 | 26 |
| NUEVA SAN CARLOS | 22 | 22 | 22 |
| MENFAR | 18 | 18 (PDF) | 14 |
| MONTREAL | 16 | 16 | 16 |
| C. IMBERTON | 15 | 15 | 15 |
| SANTA LUCÍA | 11 | 11 | 11 |
| **total** | **378** | **377 · 99.7%** | **372 · 98.4%** |

Lo que falta es explicable, uno por uno: el renglón de AMERICANA es el
reintegro; los 4 de MENFAR son los que imprimen `Vencimiento: ?`; queda 1 de
NOVA sin mirar.

**El lote y el vencimiento dejaron de ser el problema.** Quedan SAVONA,
CONGELADOS y STEINER —helados y bebidas—, que no los mandan en ningún lado y los
seguirá poniendo una persona, como hoy.

---

# Octava parte: las pruebas — ¿y si pone un vencimiento equivocado?

Pedido del usuario, y es la pregunta correcta: lo que produce esta lectura entra
al inventario como **fecha de vencimiento de un medicamento**. Un mes corrido no
da error — se descubre contando, o no se descubre.

## 1. La lógica salió de la función y quedó con pruebas

`supabase/functions/_shared/loteVencimiento.ts`: funciones puras, sin red ni
base. `leer-dte-json` la **importa** en vez de tener una copia — una copia con
pruebas al lado prueba la copia, no lo que corre.

`tests/unit/loteVencimiento.test.js`, **23 pruebas**, con cadenas **literales de
producción** (no ejemplos redactados: un caso inventado prueba la regex contra
sí misma). Cubren los ocho formatos, y sobre todo las trampas encontradas:

- el precio `12.00` de LETERAGO que se leía como diciembre del 2000
- el guion del rótulo de IMBERTON que salía como número de lote
- el gramaje (`X 30`, `500ML`) que no debe confundirse con un lote
- `(V-12-27)` de VIJOSA, que es mes y año
- que dos renglones seguidos del mismo PDF no se roben el lote entre sí
- que **sin ancla devuelve nulo**, en vez de adivinar

El año de referencia se pasa como parámetro para que la ventana de fechas
creíbles no dependa de cuándo se corran las pruebas.

## 2. Contrastado contra lo que una persona escribió

La prueba de fuego: cada compra registrada tiene el vencimiento que alguien
tecleó mirando la caja. Se compara el **conjunto** de fechas leídas contra el
tecleado —así el error del matcher de productos no se mete en una medición que
es sólo del extractor—.

**21 documentos pareados, 18 idénticos.** Las cuatro diferencias, una por una:

| documento | qué pasó |
|---|---|
| **GAMMA 5314** (CLOMAZOL) | La factura dice lote `B26102`, vence `02/2029`. **La persona tecleó lote `GENERICO` y vence `02/2030`.** El extractor tiene razón; lo confirma la captura de la propia factura. |
| **VIJOSA 4826** | Una línea difiere y la otra —de la misma factura y el mismo formato `(V-mm-aa)`— coincide exacto. El formato se lee bien; lo que difiere es lo que se tecleó. |
| **AMERICANA 5249** | No es un error: el DTE trae cada producto **dos veces**, la venta y la bonificación (`*…|0.000000`), con el mismo lote y la misma fecha. La persona las junta en un renglón. |
| **GAMMA 2285** | Lo mismo: 24 renglones en el DTE contra 22 cargados. |

## 3. Lo que la prueba destapó del proceso de hoy

**El 57.1% de las líneas de compra —23,177 de 40,576— tienen el lote tecleado
como `GENERICO`.** No es un lote: es un relleno.

Eso reencuadra toda la comparación de arriba. **Lo tecleado a mano no es una
verdad limpia contra la cual medir**: en más de la mitad de los casos el lote no
se copió de ningún lado, y el vencimiento que lo acompaña sale de la misma
escritura apurada (el CLOMAZOL con `GENERICO` traía también el año cambiado).

O sea que la carga automática no es sólo más rápida. **Es más exacta**, y le
devuelve al inventario la trazabilidad por lote que hoy no tiene en la mitad de
sus renglones — que es justo lo que el Art. 142 pide que el registro refleje
«clara y verazmente».

---

# Novena parte: la propuesta armada — sin escribir en ningún lado

Primera entrega, corriendo. `leer-dte-json` en `modo: 'propuesta'` arma la
compra entera de un documento y **no toca el sistema de origen ni la base**:
sólo lee. Es lo que va a alimentar la pantalla.

## El encabezado, campo por campo

Comparado con el formulario real que se llena hoy:

| campo del formulario | de dónde sale | ¿sale solo? |
|---|---|---|
| Proveedor | NIT del emisor → `proveedores_maestro.supplier_id` | sí |
| Tipo Documento | `identificacion.tipoDte` | sí |
| Numero de Documento | `codigoGeneracion` | sí |
| Fecha | `identificacion.fecEmi` | sí |
| **Días Crédito** | **`resumen.pagos[].periodo`** | **en el 39% de las facturas** |
| Tipo de operación | `proveedores_maestro.f07_tipo_operacion` | **sí, 36 de 36** |
| Clasificación | `proveedores_maestro.f07_clasificacion` | **sí, 36 de 36** |
| Tipo de Costo/Gasto | `proveedores_maestro.f07_tipo_costo_gasto` | **sí, 36 de 36** |
| Numero Serie (Sello) | `selloRecibido` | sí, 30 de 36 |
| Destino / Clase de Documento | fijos | sí |

**Los tres campos fiscales ya estaban en el portal** —`f07_tipo_operacion`,
`f07_clasificacion`, `f07_tipo_costo_gasto` en la ficha del proveedor— y salen
en el 100% de las facturas probadas. Nadie los va a teclear más.

## Días de crédito

El estándar lo trae en `resumen.pagos[]`: `plazo` es un catálogo (01 días,
02 meses, 03 años) y `periodo` el número. **Lo mandan COFARSAL, GAMMA, NOVA,
MONTREAL y AMERICANA — el 39% de las facturas probadas.** GAMMA dice
`plazo 01, periodo 30` y su PDF imprime «Plazo: 30 Días»: cuadra.

Dos cosas que hay que saber:

- **`condicionOperacion = 2` (crédito) en TODAS.** Ninguna compra probada es de
  contado.
- **Un emisor lo manda mal**: DROGUERÍA AMERICANA pone `plazo 02` (meses) con
  `periodo 75` — 75 meses son seis años. Se detecta con un tope: si el plazo
  convertido pasa de 365 días, se toma el número crudo. No se puede confiar
  ciegamente en el catálogo del emisor.

Los que NO lo mandan lo escriben en el apéndice, en texto libre y cada uno a su
manera («Crédito 30», «60 días», «Sesenta dias»). **La salida limpia es un campo
`dias_credito` por proveedor en el portal**, que se propone y se aprende de lo
que se confirma — igual que el diccionario de productos. Hoy no existe: ni
`proveedores_maestro` ni `purchase_receipts` lo guardan.

## El sello: ¿es necesario? Sí, y con número

| ¿la compra tiene sello? | compras | ¿se cruzan con su documento? |
|---|---:|---:|
| **Sí** | 877 | **777 · 88.6%** |
| **No** | 594 | **12 · 2.0%** |

**Sin el sello, el 98% de las compras queda huérfana**: no se liga a su DTE, el
libro no la cruza, el detector de duplicados no la ve y la reconciliación no
puede confirmarla. Hoy se llena en el 59.6% de los casos. Cargando desde el
documento se llena siempre, y ese 40% ciego desaparece.

## Los renglones: 36 facturas, 353 renglones

| | renglones | % |
|---|---:|---:|
| con producto propuesto | 333 | **94.3%** |
| con lote | 330 | **93.5%** |
| con vencimiento | 325 | **92.1%** |

Lo que falta es explicable: los 23 sin lote y 22 de los 28 sin vencimiento son
**CONGELADOS DEL SABOR** (helados: no los manda nadie), y 4 son MENFAR con su
`Vencimiento: ?`.

## Una corrección que salió de correr esto

La primera pasada dio **28% de renglones sin ningún candidato**. La causa: al
emparejador le llegaba la descripción **cruda**, con el lote y la fecha adentro,
que son ruido distinto en cada renglón y hunden el parecido de nombre.

Pasándole el **nombre limpio** —`nombreLimpio()`, con sus pruebas— bajó a
**5.7%**. Cinco veces mejor por limpiar la entrada, sin tocar el emparejador.

Y el propio test unitario encontró un error en esa limpieza: `L60640` quedaba
en `L6`, porque la regla que quita la cantidad final no exigía un espacio antes
del número.

## Lo que sigue

1. La pantalla que muestra esto y deja confirmar renglón por renglón.
2. Cada confirmación escribe `compra_producto_alias` — el diccionario —, y de
   ahí en adelante ese proveedor no vuelve a preguntar por ese producto.
3. Un `dias_credito` por proveedor, con el mismo mecanismo.
4. Recién al final, el `insert` al sistema.

---

# Décima parte: la pantalla — «Cargar compra»

Primera entrega en el portal (Compras → **Cargar compra**). Lista los documentos
recibidos que **todavía no tienen compra registrada** —al abrirla, **481 en 60
días por $93,594.94**— y al abrir uno arma la compra entera para revisarla.

**No escribe nada en el sistema de origen.** A propósito: convierte «teclear 40
renglones» en «revisar 40 renglones», sin ningún riesgo, y es lo que prueba el
emparejador contra facturas reales antes de dejarlo tocar nada.

## Cada renglón dice de dónde salió

| rótulo | qué significa | acierto medido |
|---|---|---|
| **Código de barras** | el documento trae el EAN y existe en el catálogo | 99.8% |
| **Ya confirmado** | alguien lo confirmó antes; el diccionario lo recuerda | llave exacta |
| **Por parecido · N%** | el mejor parecido de nombre, con su número | 99.1% sobre 0.75, y se cae rápido |

**El parecido nunca llega marcado como listo**, por más alto que sea el número.
Medido: entre 0.45 y 0.75 acierta 91.5% — una de cada doce líneas entraría al
inventario como otro producto, y eso no avisa: se descubre contando.

## Lo único que sí escribe: el diccionario

Al confirmar («Es correcto» o eligiendo otro producto) se guarda
`(NIT del proveedor, su código) → nuestro producto`, y **ese proveedor no vuelve
a preguntar por ese producto**. Está medido que el 87% de los renglones usan un
código que se repite, así que el trabajo baja solo con el uso.

El diccionario **no aprende de lo que adivinó el parecido**: sólo de esto y del
código de barras. Si aprendiera de sus propias adivinanzas, un error se volvería
permanente.

## Dos defectos que salieron de construirla

**El emparejador recibía la descripción cruda.** Con el lote y la fecha adentro
—ruido distinto en cada renglón— el 28% de los renglones quedaba sin ningún
candidato. Pasándole el nombre limpio bajó a **5.7%**.

**La función negaba el paso a todo el mundo.** Al abrirla al navegador,
`requireActiveEmployeeUser` devuelve sólo `id/status/code/name` — **el rol no
viene**—, así que la comprobación de permiso miraba un campo inexistente y
respondía 401 a todos. Verificado después: **200 con la sesión del usuario, 401
con un token inventado**.

## Lo que sigue faltando

1. El `insert` al sistema de origen — leído, nunca enviado.
2. El diccionario arranca vacío: las primeras facturas de cada proveedor
   preguntan, y a partir de ahí no.
3. SAVONA, CONGELADOS y STEINER no mandan lote ni vencimiento en ningún lado.

---

# Parte 11 — La auditoría de cierre (2026-08-16)

Todo lo construido para Compras, revisado de punta a punta. **Doce comprobaciones
de camino de fallo, cinco de fuga de datos, los cinco registros de cada módulo,
los advisors de Supabase y una prueba de humo en el navegador.** Dos defectos
encontrados y corregidos (v2.642.1); el resto pasó sin tocar nada.

## Lo que se comprobó, y con qué

### 1. Los advisors de Supabase: **0 ERRORES**

De los 271 avisos abiertos, **ninguno es de lo construido acá** — verificado uno
por uno y no por el conteo: el único `rls_enabled_no_policy` es `identidad_vales`,
los tres `function_search_path_mutable` son funciones de otros módulos, y ninguno
de los 16 `anon_security_definer_function_executable` cae en las RPC nuevas.

### 2. Los caminos de fallo, con el mensaje que ve la persona

`scratchpad/auditoria.mjs` — 12 comprobaciones, cada una provocando el error a
propósito contra el entorno de pruebas y **leyendo el texto devuelto**, no sólo
que fallara:

| se intenta | tiene que decir |
|---|---|
| pago sin aplicaciones | «Un pago tiene que decir a qué facturas se aplica.» |
| aplicar más de lo que se debe | «A la factura N sólo le quedan $X por pagar.» |
| aplicar a una factura de otro proveedor | «La factura N no es deuda de ese proveedor.» |
| aplicación en cero o negativa | «Cada aplicación tiene que ser mayor que cero.» |
| **la misma factura dos veces** | ← **fallaba: ver abajo** |
| aprobar sin ser Gerencia | «No tenés permiso para aprobar pagos.» |
| aprobar dos veces | «Ese pago ya no está pendiente.» |
| anular sin motivo | «Anular un pago exige decir por qué.» |
| anular un pago ya anulado | «Ese pago ya está anulado.» |
| confirmar un alias de un producto que no existe | «Ese producto no existe.» |
| condiciones de crédito con días negativos | «Los días de crédito no pueden ser negativos.» |
| leer el documento sin sesión | 401 |

### 3. Las fugas: `anon` no ve nada

`scratchpad/fugas.mjs` — con la llave pública y sin sesión, **cero filas** de
`compra_pagos`, `compra_pago_aplicado`, `compra_producto_alias`,
`compra_deuda_documentos` y `proveedores_maestro`; y un `INSERT` directo a las
dos tablas de pagos devuelve **403**. Es lo esperado: esas tablas tienen policy
de SELECT y **ninguna de escritura a propósito** —toda la validación de saldo
vive en `registrar_pago_compra`, que es lo único que puede mirar cuánto queda de
un documento antes de escribir.

### 4. Los cinco registros de cada módulo

`cuentas_por_pagar` y `cargar_compra` declarados en `moduleMap.js`,
`permissionModules.js`, `routeImporters.js`, el menú de `AppLayout.jsx` y
`App.jsx` (lazy + ruta + título), más las filas de `role_permissions`. El
`gate:permisos` cierra en verde: todo lo declarado se consulta y todo lo
consultado está declarado.

### 5. En el navegador

Con la cuenta de pruebas: **Cuentas por pagar**, **Cargar compra**,
**Proveedores** (con su nueva sección de Condiciones de Crédito), **Compras
completo** y el widget **Facturas de mi sala** abren, cargan y **no dejan un solo
error propio en consola**.

### 6. Los gates

293 pruebas, `gate:design` sin deuda nueva, `gate:migrations --remote` sin
deriva (380 filas en el registro de prod, todas con su archivo), `data-gate` en
verde, `eslint` limpio y compila.

## Los dos defectos que salieron, y qué eran

**Un pago con la misma factura dos veces devolvía el error de Postgres crudo.**
`[{doc:1, monto:10}, {doc:1, monto:10}]` chocaba contra el índice único y la
pantalla mostraba *«duplicate key value violates unique constraint
compra_pago_aplicado_pago_id_document_id_key»*. El freno funcionaba —no se
guardó nada de más— pero quien lo lee no puede saber qué hizo mal, y ese texto
en una pantalla de plata parece una falla del sistema. Hoy se comprueba **antes
de escribir nada**: «Una misma factura no puede ir dos veces en el mismo pago.»
(`20260816234229`.)

**El carril de tarjetas no aplanaba los fragmentos.** `Children.toArray` aplana
arreglos pero **no un `<>`**, así que en Libro de compras completo, Libros de IVA
y Corte Z el carril recibía **una** hija en vez de tres: le ponía `compacta` al
fragmento —React avisaba en consola— y las tarjetas de adentro **nunca recibían
el prop**, que es justo el que evita que su línea de detalle se corte a mitad de
palabra bajo 176px. De paso el cupo de §17.0 contaba el fragmento como una sola
tarjeta. No era de Compras, pero apareció mirando Compras.

## Una comprobación que pasaba por el motivo equivocado

Tres de las doce daban verde **porque `set_proveedor_condiciones_credito` no
existía en el entorno de pruebas**: PostgREST devolvía *«Could not find the
function … in the schema cache»*, el script veía «falló como se esperaba» y lo
contaba como acierto. Aplicada la función al entorno y repetidas, las doce pasan
**por lo que dicen probar**. Es la forma más barata de un verde falso: un error
que llega en el momento correcto y no es el que se estaba buscando.

## Lo que la auditoría NO puede decir

- **El diccionario está vacío.** Todo lo medido del emparejador salió del código
  de barras y del parecido de nombre; la vía que más va a resolver —la
  confirmación humana— todavía no tiene una sola fila.
- **Ningún pago real pasó por acá.** Los pagos probados son de prueba, en el
  entorno de prueba. El circuito completo —Compras registra, Gerencia aprueba—
  no se ha corrido con plata de verdad.
- **Nada se escribió nunca en el sistema de origen.** Sigue siendo la pieza que
  falta, y hasta que exista, «Cargar compra» arma la compra y la muestra.
