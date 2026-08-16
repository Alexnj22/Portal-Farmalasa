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

- **`compras.php`** (`https://clientesdte3.oss.com.sv/farma_salud/compras.php`).
  No se probó qué acepta ni con qué formato. Que el portal ya ejecute cosas en
  el sistema de origen no prueba que este endpoint sirva para esto.
- **El costo de leer el JSON** de cada documento (hoy nadie lo lee en lote).
- Las 50 líneas (1.8%) en que el código de barras cayó en un producto que no
  estaba en esa compra. Pueden ser sustituciones, devoluciones o un código de
  barras repetido en el catálogo; no se abrieron una por una.
