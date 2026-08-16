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

## ⚠️ La trampa: los id de producto son POR CUENTA

Medido, no supuesto. Consultando con la cuenta de **clientes**:

| se pidió | el sistema respondió | nuestro producto con ese id |
|---|---|---|
| `id_producto=2445` | PSICODOL 1MG/ML X 60 ML | NAFINA PLUS GOTAS X 15 ML |
| `id_producto=2449` | ROSECOL 20 MG X 30 TAB | OFTIGEL 0.2% GEL OFTALMICO X 10 GR |

Es el mismo fenómeno ya documentado para `id_proveedor` en
`scrape-erp-proveedores`, y ahora se confirma que también aplica a los
productos: **`products.id` sólo coincide con la numeración de la cuenta de
COMPRAS**, que es de donde se bajó (`descargar_compras_json.php`).

**Automatizar con la cuenta equivocada cargaría productos completamente
distintos, y sin error**: la compra se registraría bien, con el total correcto,
y el inventario quedaría mal. Se descubriría contando. Toda esta automatización
va con `ERP_PURCHASES_CREDS` y con ninguna otra.

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
