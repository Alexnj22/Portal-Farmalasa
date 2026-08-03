# Libros de IVA — formato de los archivos y hallazgos

Fecha: 2026-08-01 · Versiones v2.333.0 → v2.335.1

Este documento fija **el formato exacto de los archivos que el portal replica** y
deja anotados los **errores encontrados en el origen**, para no volver a
deducirlos. Todo lo de acá se verificó contra los archivos reales de junio 2026,
descargados por sucursal (`erpId` explícito), no por muestreo ni de memoria.

---

## 1. Reglas de formato comunes

| Regla | Valor |
|---|---|
| Separador | `;` |
| Encabezado | **ninguno** — los archivos arrancan directo en datos |
| Fecha | `DD/MM/YYYY` |
| Decimales | `.` (punto), 2 posiciones… salvo la percepción de compras, que va con **4** |
| Número de control | **sin guiones**: `DTE01S001P005000000000019619` |
| Código de generación | consumidor: guiones → **espacios**. Contribuyentes y anulados: **pelado** (32 caracteres) |
| NRC / NIT | **sin guiones**: `250887-5` → `2508875` |

La puntuación del código de generación **cambia entre reportes sin ninguna
lógica detrás**. Hay que copiar cada una como es.

## 2. Endpoints

| Reporte | Archivo | Estado |
|---|---|---|
| Ventas a consumidor | `libro_ventas_consumidor_csv.php` | ✅ |
| Ventas a contribuyentes | `libro_ventas_contribuyente_csv.php` | ✅ |
| Documentos anulados | `documentos_anulados_csv.php` | ✅ |
| Libro de compras | `libro_compras_iva_csv.php` | ✅ |
| Anexo de retención | `libro_retencion_iva_csv.php` | ✅ (vacío en toda la historia) |
| Anexo de percepción | `libro_percepcion_iva_csv.php` | ✅ **con datos** — pide las credenciales de COMPRAS, no las de ventas |
| Sujeto excluido | — | ❌ **no se encontró** (9 nombres probados) |

Parámetros: `?fechaInicio=YYYY-MM-DD&fechaFin=YYYY-MM-DD`. **La sucursal es
estado de sesión**, no un parámetro: hay que hacer `POST cambio_sesion.php` con
`process=set_sucursal` antes de pedir el archivo.

Herramienta para volver a mirarlos: Edge Function `erp-csv-probe`.

## 3. Mapa de columnas

### Consumidor final — 22 columnas
```
0  fecha            8  cód. generación "al"    16 0.00
1  4 (clase)        9  (vacío)                 17 0.00
2  01 (tipo)        10 ventas exentas          18 0.00
3  nº control 1º    11 0.00                    19 0.00
4  sello del 1º     12 0.00                    20 total del día
5  id interno 1º    13 0.0000                  21 2 (constante)
6  id interno últ.  14 ventas gravadas
7  cód. gen. "del"  15 0.00
```

### Contribuyentes — 19 columnas
```
0 fecha        5 cód. generación   10 0.00           15 0.00
1 4            6 id interno        11 0             16 total
2 03           7 NRC               12 gravadas      17 NIT
3 nº control   8 cliente           13 débito fiscal 18 1
4 sello        9 exentas           14 0.00
```

### Anulados — 10 columnas
```
0 nº control   3 0    6 sello
1 4            4 tipo (01/03)   7 0
2 0            5 D    8 0     9 código de generación
```
Las seis constantes se verificaron iguales en las 80 filas de junio. El anexo
**no lleva** fecha, cliente ni total.

### Percepción — 9 columnas
```
0 correlativo   3 NIT            6 sello (40)
1 fecha         4 tipo doc (03)  7 monto sujeto (4 decimales)
2 proveedor     5 nº documento   8 percepción (4 decimales)
```
**Pide las credenciales de COMPRAS.** Con las de ventas devuelve vacío, que es
indistinguible de "no hay percepción" — así se dio por vacío en la primera
pasada. El sello sale vacío del lado del portal: el anexo del ERP lo trae, pero
no viene en la fuente que alimenta Compras.

### Compras — 23 columnas
```
0 fecha       6 exentas    12 0.00         18 2
1 4           7 0.00       13 crédito      19 5
2 (vacío)     8 0.00       14 total        20 3
3 nº doc      9 gravadas   15 (vacío)      21 percepción (4 dec.)
4 NIT         10 0.00      16 1            22 sello
5 proveedor   11 0.00      17 1
```
**Gravadas = `subtotal − percepción`** (LETERAGO: 577.71 − 5.72 = 571.99, exacto).

### Columnas que quedaron sin identificar

Varias van en cero en **toda** la muestra disponible, así que no se pudo saber
cuál es cuál: consumidor 11-13 y 15-19, contribuyentes 10-11, compras 7-8 y
10-12. Haría falta un período con ventas exentas, exportaciones o importaciones,
y **no existe uno en el histórico**. Se escriben como constantes en cero, igual
que el origen. Las de compras 17-21 (`1;1;2;5;3`) se copian tal cual.

Esto queda dicho y no adivinado: es la contracara de la regla de verificar todas
las columnas — si una no se puede verificar, se declara.

---

## 4. HALLAZGOS — errores en el origen

### 4.1 El libro de consumidor reporta códigos de generación equivocados

**Verificado en 2 de 2 días, sucursal 2 (`erpId` 5), con el archivo filtrado por
sucursal.**

| Día | Columna | Lo que reporta | A qué documento pertenece | Cuál era el correcto |
|---|---|---|---|---|
| 01/06 | cód. gen. "del" | `010D5CAF…` | id 297861 | id 297361 (`A8AEE366…`) |
| 01/06 | cód. gen. "al" | `FF69D633…` | id 298050 | id 298111 (`E0CA8B8C…`) |
| 02/06 | cód. gen. "del" | `0042379F…` | id 298303 | id 298226 (`E989E5EC…`) |
| 02/06 | cód. gen. "al" | `FDA8EC5F…` | id 298228 | id 298920 (`D32D32DB…`) |

Los cuatro son documentos **del medio del día**. Peor: el 02/06 el que llama
"al" (correlativo `…243`) tiene correlativo **menor** que el que llama "del"
(`…258`) — o sea que ni siquiera son consistentes entre sí.

El resto de la fila **sí es correcto**: número de control, sello, IDs y montos
coinciden con el primer y último documento del día. El problema está acotado a
esas dos columnas.

#### La causa — identificada el 2026-08-03, julio 2026, sucursal 2

No son documentos al azar: el origen ordena los códigos de generación
**alfabéticamente** y toma el primero y el último. O sea `MIN()`/`MAX()` sobre la
columna de texto, en vez del primer y último documento del día.

Como el código de generación es un UUID aleatorio, el resultado es un documento
cualquiera — pero siempre uno que empieza en `00…`/`01…`/`02…` para la columna
"del" y en `FF…`/`FE…`/`FC…` para la "al". Los cuatro casos de junio de la tabla
de arriba encajan solos (`010D5CAF`, `0042379F` / `FF69D633`, `FDA8EC5F`).

Verificado en **31 de 31 días de julio 2026** de La Popular: reconstruyendo la
columna como `min(codigo_generacion)` / `max(codigo_generacion)` por día, el md5
del conjunto `fecha;del;al` da **`5b9a8836e47dd9db9e9ff79fb25de431`** en los dos
lados — identidad exacta, no coincidencia parcial.

Las otras 19 columnas de las 31 filas son **idénticas** entre los dos archivos,
sello incluido. La única diferencia adicional es de formato, no de dato: en
`gravadas` (col. 14) el origen suelta el cero final (`884.1`) mientras escribe el
total (col. 20) con dos decimales (`884.10`) — se contradice dentro de la misma
fila. El portal escribe las dos con dos decimales, que es lo que pide el formato.

**Qué hace el portal:** emite los códigos **correctos** — los del primer y
último documento del día ordenados por correlativo. No se replica el error: es
un dato que se declara, y copiar un identificador equivocado en un libro fiscal
sería copiar el error, no el formato.

**Qué conviene hacer:** reportarlo al proveedor del ERP. Mientras no se corrija,
los dos archivos van a diferir en esas dos columnas, y **la diferencia es a
favor del portal**.

### 4.2 El libro de compras no resta las notas de crédito

139 documentos (135 notas de crédito + 4 de débito), **IVA neto $2,673.84** en
dos meses y medio. Detalle en `CHANGELOG.md` v2.334.0.

El **Art. 62 de la Ley de IVA** obliga a ajustar el crédito fiscal por las notas
de crédito recibidas, en el período en que se reciben. Hoy no se está haciendo:
los documentos llegan por correo y nunca se capturan, aunque el ERP tiene la
pantalla para hacerlo (*Nota crédito compras*).

El portal **no las resta del libro** —para no crear dos verdades del mismo
período— y las muestra en sección propia con su total, para que el ajuste se
haga al declarar. La corrección de fondo es capturarlas donde nacen.

### 4.3 El sello de las compras SÍ está en la fuente — corregido el 2026-08-03

> **Este hallazgo era falso.** Se dejó el texto original abajo porque el error
> importa más que la conclusión: se dio por inexistente un dato que estaba a la
> vista, en la columna 22 del propio reporte de compras.

Desde v2.348.0 (C1) el sync lo guarda en `purchase_receipts.sello_recibido`, con
validación de 40 alfanuméricos y descartando la fila si el reporte trae más de un
valor para el mismo documento. Verificado del 1 al 10 de julio: 124 de 138
compras con sello, cero inválidos guardados.

**Todavía no se emite en el CSV**, y el motivo es otro: solo está donde el sync
volvió a correr. Julio 56.7% (265 de 467), junio y agosto 0%. Emitirlo hoy daría
un archivo que declara el sello en unos meses y no en otros. Primero el backfill
de junio y agosto —en ventanas de ≤10 días—, después se emite en las **dos**
transcripciones: el `exportCsv` de `LibrosIvaView` y la rama `compras` de
`generar_csv_libro`.

#### De quién es ese sello — verificado el 2026-08-03

Es del **proveedor**, no nuestro. Hacienda le da el sello a quien EMITE el DTE, y
en una compra el emisor es el proveedor: esa columna prueba que **el documento
del proveedor** llegó a Hacienda, que es lo que el Art. 86 necesita para que el
crédito fiscal esté respaldado.

| Prueba | Resultado |
|---|---|
| Contra el DTE que el proveedor manda por correo (`purchase_dte_documents`) | **82 de 82 idénticos**, 28 proveedores |
| Contra nuestros sellos de venta (`sales_invoices.recibido_mh`) | **0 de 356** coinciden |

#### El techo por sucursal — medido contra el archivo del origen, julio 2026

Bajado con `erp-csv-probe` sucursal por sucursal y contada la columna 23,
aplicándole **la regla del portal** (40 alfanuméricos exactos; descartar si un
mismo documento trae dos sellos distintos):

| Sucursal | Filas | Sellos que da el origen | Los que tenía el portal | Faltaban |
|---|---|---|---|---|
| Bodega | 414 | **407** | 260 | **147** |
| Salud 3 | 16 | 7 | 5 | 2 |
| La Popular | 12 | **0** | 0 | 0 |
| Salud 1 | 15 | **0** | 0 | 0 |
| Salud 2 | 9 | **0** | 0 | 0 |
| Salud 4 | 1 | **0** | 0 | 0 |

Dos conclusiones distintas, y conviene no mezclarlas:

1. **En Bodega el hueco es NUESTRO.** El origen trae el sello en 412 de 414 filas
   y nuestra propia regla aceptaría 407 —con **cero** casos ambiguos—, así que no
   lo está rechazando el filtro: el backfill no había pasado por todo el mes.
2. **En las otras cuatro sucursales no hay nada que traer.** El origen manda la
   columna **vacía en las 37 filas**. Esto confirma, ya medido, lo que
   `20260803014738` afirmaba sin evidencia (y que remitía a un «§11» de este
   documento que no existía).

**El techo real de julio es 414 de 467 (88.7%), no 100%.** Salud 3 lo muestra
bien: tiene 15 filas con algo en la columna pero solo 7 son sellos — las demás
traen el código de generación (36 caracteres) o texto pegado a mano, que es la
contaminación H19 que `selloValido` filtra a propósito.

#### Backfill corrido el 2026-08-03 — junio, julio y agosto

Solo **Bodega y Salud 3**: son las únicas donde el origen emite la columna, así
que correrlo en las otras cinco serían ~200 upserts incondicionales a cambio de
nada. 14 llamadas (7 ventanas de ≤10 días × 2 sucursales), las 14 en verde.

| Mes | Bodega | Salud 3 |
|---|---|---|
| Junio | 260 → **325 de 335 (97.0%)** | 5 → 7 |
| Julio | 260 → **409 de 414 (98.8%)** | 5 → 7 |
| Agosto | 0 → **27 de 28 (96.4%)** | 0 → 1 |

Julio quedó **por encima** del techo que se había medido con el archivo del mes
entero (409 contra 407): una ventana de 10 días desambigua documentos que en el
mes completo compartían clave. No es un error de la medición anterior — es que
el techo depende del tamaño de la ventana.

#### TRAMPA: el origen escribe TODOS los CSV en un único archivo temporal

Descubierto al lanzar 14 sondas en paralelo. El generador del origen hace
`fopen('csv/libro_compras.csv')` en una ruta **fija y compartida**, así que dos
peticiones simultáneas chocan y una recibe esto en vez del CSV:

```
Warning: fopen(csv/libro_compras.csv): failed to open stream: File exists …
Warning: fwrite() expects parameter 1 to be resource, bool given …
Warning: readfile(csv/libro_compras.csv): failed to open stream: No such file …
```

Devuelve **HTTP 200**, así que ni el `r.ok` ni el chequeo de HTML lo atrapan: son
líneas de texto plano. De 21 sondas, 1 salió así.

**Esto es peligroso en `fastBackfill`, no solo en el probe.** Si le toca el
archivo contaminado, `columnaPorNumero` arma un mapa vacío y **todas** las filas
de esa ventana reciben `sello_recibido: null` — o sea que borraría sellos buenos
en silencio, en una columna fiscal. En la corrida del 2026-08-03 no pasó
(verificado ventana por ventana: 94.9%–100%, ninguna en cero), pero fue suerte.

**Mientras no haya guarda, las llamadas al origen van de a una.** La guarda
natural es rechazar el archivo si trae `Warning:` / `failed to open stream`, o
—más robusto— si el número de filas no se parece al que informa el DataTable.

<details><summary>Texto original del hallazgo (incorrecto)</summary>

El archivo del ERP lo trae (columna 23), pero no viene en la fuente que alimenta
el módulo de Compras del portal. En el archivo del portal esa columna sale
**vacía**, no en cero: no sabemos el valor, y escribir uno sería inventarlo.

---

</details>

### 4.4 El id interno NO es el orden de emisión — corregido el 2026-08-03

Hallazgo propio, no del origen: **el libro elegía mal el primer y el último
documento del día**, y venía de una decisión nuestra del día anterior.

`20260802033604` había cambiado el criterio de correlativo a **id interno**, para
que nuestro archivo se pareciera al del origen («el origen lista por orden de
captura»). Se tomó al origen como árbitro de lo correcto — el mismo error que
§4.1 ya había desarmado para las columnas de al lado.

**La hora de emisión lo decide sin ambigüedad.** Sobre los 22,192 pares
consecutivos de julio 2026, contando cuántas veces la hora va *para atrás* al
recorrer el día:

| Criterio de orden | Inversiones de hora |
|---|---|
| Por **correlativo** | **0** |
| Por **id interno** | **2,234** (10.1%) |

Y el caso que aquella migración citaba como prueba es el que la refuta. La
Popular, 2026-06-08:

| | Documento | Hora |
|---|---|---|
| Lo que el libro llamaba «primero» | `…020977` (id interno 302651) | **10:25:31** |
| El primero de verdad | `…020473` (id interno 302658) | **07:15:33** |

El id interno es el orden en que el origen **capturó** las filas, no en que se
**emitieron** los documentos.

**Alcance:** 252 días con el primero mal y 510 con el último, sobre 2,709
branch-días de historia — **26%**. Afectaba cuatro columnas de identificación
del libro de consumidor. **Ningún monto**: el total diario es una suma sobre el
día y no depende de qué documento se nombre (verificado: julio de La Popular da
$42,957.84 antes y después, idéntico al del origen).

Corregido en `20260803161220`, con las **cinco** columnas de identidad bajo el
mismo criterio — sería peor una fila donde el sello es de un documento y el id
interno de otro. Consecuencia aceptada: el archivo del portal ya no es un clon
del origen en esas columnas, igual que desde §4.1 no lo es en los códigos de
generación.

**Trampa en la que caí al corregirlo, anotada porque casi cuesta caro:** escribí
el cuerpo nuevo de `_docs_sin_numero_control` partiendo del archivo de
`20260802033604`, sin ver que `20260802205606` (B4) ya la había tocado después
para agregarle el filtro del sello. La migración correctora se llevó ese filtro
puesto. Restaurado en `20260803161329`. **El cuerpo de una función que se va a
reemplazar se saca de `pg_get_functiondef`, no del último archivo de migración
que uno encuentre.**

## 5. Estado y pendientes

**Cerrado:** los cinco archivos con datos salen con el formato del origen,
verificados columna por columna. El número de control de ventas está completo
(7,017 documentos) y se mantiene solo.

**Pendiente, por decisión — sólo documentado:**

- **Histórico 2025-05 → 2026-05** sin las 4 columnas fiscales de compras.
  Contabilidad sólo necesita junio y julio, que **están cerrados y verificados**
  (12 de 12 branch-meses idénticos en 6 medidas). La vista marca en rojo los
  meses incompletos, así que no se pueden presentar por error. Para
  completarlos: `fastBackfill: true` mes por mes.
- **Cruce compras ↔ documentos del correo**: 86.7% hoy, 91.2% alcanzable con
  tres reglas en cascada. 6 casos ambiguos se dejarían fuera a propósito.
- **Sujeto excluido**: no se encontró su archivo en el origen. Sale vacío en toda
  la historia de todas formas.
- **Anexo de retención**: usa el mismo formato que percepción por ser su
  hermano, pero **no está verificado con datos** — el archivo del ERP salió
  vacío en toda su historia (2025-01 → 2026-07, 7 sucursales).
- **Precisión de los montos de percepción**: el ERP guarda `577.7115` y el sync
  redondea a `577.71`, así que el anexo del portal sale con `571.9900` donde el
  del ERP dice `571.9915`. ~0.0015 por fila. Se corrige en el sync, no en el
  exportador.


---

## 6. VERIFICACIÓN CONTRA EL ORIGEN — junio 2026, 7 sucursales

Hecha el 2026-08-02 con `verificar-csv-libros`, que baja el archivo real por
sucursal y lo compara **línea por línea** contra una **segunda implementación**
del exportador escrita aparte en SQL (`generar_csv_libro`). Dos implementaciones
independientes que coinciden entre sí y con el origen valen más que reusar el
mismo código para verificarse a sí mismo.

### El conteo de líneas coincide EXACTO en los cinco

| Reporte | Origen | Portal |
|---|---|---|
| Consumidor | 180 | 180 |
| Contribuyentes | 49 | 49 |
| Anulados | 80 | 80 |
| Compras | 389 | 389 |
| Percepción | 226 | 226 |

Eso prueba que el filtro, el período y el universo de documentos son correctos
en las 7 sucursales.

### Filas idénticas, excluyendo las columnas con causa conocida

| Reporte | Coinciden | % |
|---|---|---|
| **Anulados** | 80 / 80 | **100%** |
| **Consumidor** | 180 / 180 | **100%** (tras el resync del 4.4) |
| **Contribuyentes** | 47 / 49 | **96%** |
| Compras | 226 / 389 | 58% |
| Percepción | 8 / 226 | 3.5% |

### Columnas excluidas, cada una con su motivo

| Reporte | Col | Motivo |
|---|---|---|
| Consumidor | 7, 8 | **el origen las reporta mal** (§4.1); el portal emite las correctas |
| Contribuyentes | 17 | el origen deja el NIT vacío; el portal lo tiene |
| Compras | 4 | NIT del proveedor que al portal le falta — **15 de 67 proveedores** |
| Compras | 22 | el sello, que no viene en la fuente |
| Percepción | 3, 6 | mismo NIT y mismo sello |

### Lo que todavía difiere, y por qué

**Percepción — precisión.** El origen guarda `253.4428`; el sync redondea a
`253.44` al guardarlo, así que el portal escribe `253.4400`. **No es formato: es
pérdida de precisión en el sync.** Se arregla guardando más decimales en
`purchase_receipts`, y eso merece su propia verificación porque esa columna hoy
cuadra al centavo en 12 de 12 branch-meses.

**Compras — orden residual en 3 sucursales.** Las filas quedan desplazadas una
posición (el origen trae 15/06 donde el portal trae 16/06). Como los totales
coinciden, no falta ni sobra ningún documento: es un criterio de orden que en
esas sucursales no es sólo `erp_purchase_id`. Sin resolver.

### Correcciones que salieron de esta verificación

1. **Orden por id interno** en compras, percepción, retención, anulados y
   contribuyentes. Antes iban por número de documento y eso desalineaba el
   archivo entero. Anulados pasó de 78 a **80 de 80**.
2. **Extremos del día por id interno** en el libro de consumidor. Antes se
   elegían por correlativo, que no es el mismo orden. Consumidor pasó de 130 a
   **179 de 180**. Cambiar el criterio metió 760 documentos nuevos en la cola del
   número de control, que se drenaron el mismo día.


---

## 7. HALLAZGO — el sync de ventas puede perder documentos

La única línea de consumidor que seguía difiriendo (sucursal 4, 2026-06-20) no
era un problema de formato ni de criterio: **al portal le faltaba una venta**.

| | Documentos | Total |
|---|---|---|
| Portal antes | 138 | $1,617.65 |
| Origen | 139 | $1,663.63 |
| **Portal tras re-sincronizar ese día** | **139** | **$1,663.63** |

Un `sync-dte-sales` acotado a ese día y sucursal la trajo, y el total cerró **al
centavo**. Con eso el libro de consumidor de junio quedó en **180 de 180**.

**Lo que importa no es el documento, es el modo de fallo.** El libro no falla ni
avisa cuando le falta una venta: sale con un documento menos y cuadra consigo
mismo. Sólo se ve comparando contra el origen.

Ya existe `check-purchases-reconciliation` (diario, 07:20 UTC) que hace
exactamente este cuadre **para compras** — conteo y monto, 7 sucursales, y avisa
al rol de alertas técnicas cuando no cierra. **No existe el equivalente para
ventas.** Es el hueco de control más grande que dejó esta auditoría.

### El NIT de proveedores: el dato está, falta el vínculo

Corrección a lo dicho en §5: no es que falte el NIT. Está en
`proveedores_maestro` y **coincide con el del origen** — SAVONA `06142105670017`,
SKY SOLUTIONS `06140311061010`, COMERCIALIZADORA INTERAMERICANA `06142008011037`.
Lo que falta es `supplier_id`, que está en NULL: esas fichas nacieron de los DTE
(`source: dte`) y nunca se ligaron al proveedor del módulo de Compras. Son 11 de
los 15 casos. El libro las busca por ese vínculo, no las encuentra, y escribe la
columna vacía.


---

## 8. PENDIENTE — la precisión de 2 vs 4 decimales

**Para consultar con el contador antes de tocar nada.**

El anexo de percepción del origen muestra los montos con **cuatro decimales**;
`purchase_receipts` los guarda con **dos**, porque el sync los redondea al
guardarlos.

```
Origen : 253.4428          Origen : 571.9915
Portal : 253.4400          Portal : 571.9900
```

### Cuánto es

| | Junio 2026 |
|---|---|
| Filas del anexo | 226 |
| Monto sujeto declarado | $153,148.40 |
| Percepción declarada | $1,531.44 |
| **Error acumulado del redondeo** | **menos de $1 en el mes** |

Son unas 3 milésimas por fila. En plata es despreciable; lo que lo hace visible
es que aparece en **todas** las filas, porque la comparación es texto contra
texto.

### La pregunta para el contador

**¿El anexo de percepción se presenta con 2 o con 4 decimales?** De eso depende
qué hacer:

- **Si se presenta con 2** — no hay nada que hacer. El portal ya declara el valor
  redondeado y coincide con lo que se informa.
- **Si se presenta con 4** — hay que cambiar la precisión con la que el sync
  guarda `subtotal` y `percepcion_iva` en `purchase_receipts`, y **rehacer el
  histórico**.

### Por qué no se cambió por las dudas

Esa columna **hoy cuadra al centavo en 12 de 12 branch-meses** contra el origen.
Cambiarle la precisión toca el dato base de un libro que ya está verificado, así
que merece su propia verificación completa — no se hace "de paso". Y si la
respuesta es "se presenta con 2", el cambio sería trabajo y riesgo por nada.

Lo mismo aplica al libro de compras, que usa `subtotal − percepción`: hoy da
`571.99` donde el origen calcula `571.9915`. En el libro se presenta con 2
decimales de todas formas, así que ahí la diferencia no llega al archivo.

---

## 9. Los tres bytes que no se ven (C7 · H20)

El archivo que baja el portal es **byte a byte** el mismo que el del origen, y eso
es a propósito: la comparación del §6 es un `diff`, y un `diff` que se ensucia con
diferencias de codificación **deja de servir para lo único que se le pide**, que es
mostrar diferencias de datos. Tres decisiones, ninguna cosmética, todas en
`src/utils/csvExport.js`:

| Decisión | Byte | Por qué |
|---|---|---|
| **BOM al inicio** | `EF BB BF` | Sin él, Excel en es-SV abre el archivo como Latin-1 y `PEÑA` sale `PEÃ‘A`. Es el mismo motivo por el que lo trae el origen. |
| **CRLF entre filas** | `0D 0A` | Lo que trae el origen. Con LF a secas el diff marca **todas** las líneas como distintas. |
| **Sin salto final** | — | El archivo termina en el último dato. Un `\n` de más lo lee Excel como una fila vacía, y un libro fiscal con una fila en blanco al final es una fila del libro. |

La tercera es la que se escapa: `lines.join('\r\n')` **no** agrega terminador al
final, y hay que dejarlo así. El reflejo de escribir `lines.map(l => l + '\r\n')`
—que es lo natural— agrega una línea vacía que ningún lector humano ve y que el
diff marca en cada archivo.

**Lo que NO se copia del origen es el contenido.** El formato se replica para poder
cotejar; los datos se corrigen. Las diferencias vivas y su motivo están en el §6
("Lo que todavía difiere"), y la regla general en `CLAUDE.md`: el origen sirvió para
confirmar que lo que sacamos es real, no para copiarle los errores.

Aplica a **todo** export del portal, no solo a los libros — `exportCsv` es
compartida. Un export nuevo que quiera otro formato tiene que decir por qué.

---

## 10. El número de documento: cotejar y presentar no son el mismo uso (C3)

`purchase_receipts.documento_numero` **no guarda un número de control**. Guarda un
**código de generación cortado a 20 caracteres**: `7EC4501D-6456-4E0D-A`. Son 778
de 872 compras de junio en adelante. Con ese string no se busca el documento ni se
le reclama nada a un proveedor — no identifica nada.

El número real existe del lado de las facturas que llegan por correo
(`purchase_dte_documents.numero_control`, `DTE-03-M001P001-000000000003484`) y se
recupera con el mismo cruce del Libro Completo: sello primero, que es exacto,
después el código truncado, y siempre con el NIT del proveedor de guarda. Medido en
julio 2026: **380 de 467**.

**La pantalla muestra el real; el CSV sigue llevando el del origen.** No es una
inconsistencia, son dos usos distintos:

| | qué es | qué lleva |
|---|---|---|
| Pantalla del libro | el portal, que debe ser correcto | el número de control real, con el del origen en el `title` para reconciliar |
| CSV del libro | la réplica que se COTEJA | el del origen, sin tocar |
| Libro Completo | el libro que el portal sabe armar | el código de generación completo |

El CSV no se toca por un motivo medible, no por prudencia: esa columna es la clave
más discriminante del cotejo, y el número de control **no es derivable** del código
truncado —son campos distintos—, así que tampoco se puede normalizar uno al otro
para comparar. Cambiarlo dejaría el cotejo cruzando por fecha + proveedor + montos,
que en un mes cargado colisiona de verdad.

Si algún día el número real tiene que salir en un archivo, el archivo es el del
Libro Completo, que existe justamente para eso.

### Lo que el origen corta no siempre es un código de generación

Mirando la pantalla de julio aparecen cuatro largos distintos en esa columna: 8,
9, 20 y 31. Los de 31 son los que C3 recuperó. Los de 20 **no son todos códigos de
generación cortados**: algunos son un *número de control* cortado a 20 —
`DTE-03-M001P001-0000`—, o sea que el origen trunca a ciegas cualquier cosa que le
pongan.

Eso sugiere un cruce más: buscar por prefijo contra `numero_control`. **Se midió y
se descartó.** De las 19 compras de julio sin cruzar cuyo número empieza con
`DTE-`, ni una sola da un candidato único:

| candidatos que da el prefijo | compras |
|---|---|
| 0 | 4 |
| 8 | 1 |
| 9 | 1 |
| 11 | 8 |
| 232 | 4 |
| 1000 | 1 |

Un prefijo de 20 caracteres deja **11 dígitos de correlativo libres**, así que
matchea contra media numeración del emisor. Cruzar por ahí sería elegir un
documento al azar y mostrarlo como si fuera el bueno. Se quedan sin número real, y
eso es la respuesta correcta.

---

## 11. El NIT y el sello del libro de compras: qué se pudo y qué no (C1b · C8 · H22)

El sync ya baja el libro de compras para el sello y la percepción. C1b agrega dos
índices al mismo archivo —**columna 4, el NIT del emisor; columna 5, su nombre**—
y con eso completa la ficha del proveedor cuando está vacía, o la crea cuando no
existe (C8, `completar_nit_proveedores`). Tres candados: NIT válido, nunca pisar
uno existente, y nunca tomar un NIT que ya es de otra ficha —eso es una fusión de
proveedores y la decide una persona, no un cron.

### El agujero que este bloque venía a tapar ya estaba tapado

El plan hablaba de *«21 proveedores con compras y sin ficha, 98 filas del libro
con NIT vacío»*. Medido hoy, después del barrido del maestro (E4, v2.340.0):
**junio 2 filas, julio 1, agosto 0** — y las tres son el mismo proveedor, PEPSI.

### Y el que queda no se puede tapar desde acá

Se fue a buscar al archivo. La fila de PEPSI en el libro del origen, Salud 1,
16/06/2026:

```
16/06/2026;4;;DTE-1234291;;PEPSI;0.00;0.00;0.00;16.81;…
                          ↑ columna 4: vacía
```

**El origen tampoco sabe el NIT de PEPSI.** No es un dato que el portal esté
perdiendo: no existe en ninguna de las fuentes disponibles. Se completa a mano en
la ficha o no se completa. C1b no falló al no tomarlo — declinó con razón, y eso
se verificó contra el archivo real, no contra la intención del código.

### El sello no falta por fecha, falta por SUCURSAL

C1 dejó el sello en 56.7% de julio y se leyó como "falta correr el backfill de
los meses viejos". Al abrirlo por sucursal se ve otra cosa:

| Sucursal | Compras de julio | Con sello |
|---|---|---|
| Bodega | 414 | 260 (63%) |
| Salud 3 | 16 | 5 (31%) |
| Salud 1 | 15 | **0** |
| La Popular | 12 | **0** |
| Salud 2 | 9 | **0** |
| Salud 4 | 1 | **0** |

Y se confirmó en el archivo: las filas de Salud 1 de junio traen la columna 22
vacía. **El origen emite el sello para unas sucursales y no para otras**, así que
ningún backfill lo va a completar — el dato no está del otro lado. Para esas
compras el sello hay que sacarlo del cruce con la factura que llega por correo
(C2), que es justamente por lo que ese cruce existe.

Corolario práctico: el 56.7% de julio es 63% de Bodega diluido por cinco
sucursales en cero, no un backfill a medio hacer.

---

## 12. El NRC del cliente en los CCF: el aviso del portal es más pesimista que la realidad

La pestaña de Contribuyentes avisa que *«el portal todavía no captura el receptor
del DTE: el libro se puede revisar, pero no presentar»*. La primera mitad es
cierta —`sales_invoices` guarda `cliente` (el nombre) y **ninguna columna de NRC o
NIT del receptor**—. La segunda ya no.

Medido el 2026-08-03 sobre junio y julio: los nombres de cliente distintos que
aparecen en CCF son **29**, y los **29 resuelven contra `customers` a exactamente
una ficha con NRC**. Cero ambiguos, cero sin match. O sea que el dato que el Art.
85 exige **ya está en la base**; lo que falta es el vínculo.

### Por qué esto NO se resolvió en el acto

Porque el cruce es **por nombre**, que es exactamente la clase de vínculo contra la
que existe la memoria `feedback_ligar_proveedores_por_nit_no_por_nombre` (Movistar
= TELEFONICA, dos "AGUA FRIA" que son contribuyentes distintos). Que hoy dé 29 de
29 no lo hace seguro para mañana: un nombre escrito distinto no da un match
equivocado, da **ningún** match — y entonces el NRC sale vacío sin que nadie se
entere, que es el modo de falla silencioso de siempre.

La forma correcta es resolver el vínculo **una vez y guardarlo**
(`sales_invoices.customer_id`, o una columna de NRC del receptor poblada por el
sync), no cruzar por nombre en cada lectura del libro. Eso es trabajo de una tarde,
no de una línea, y no entraba en el Bloque C.

### Qué hacer con esto

1. Está medido y escrito, que era lo que faltaba: el blocker es **más chico** de lo
   que el portal declara.
2. Cuando se retome, el orden es: columna en `sales_invoices` → poblarla desde el
   sync o desde un backfill por nombre **verificando la unicidad en el momento** →
   recién ahí cambiar el texto del aviso.
3. **Hasta que eso exista, el aviso se queda como está.** Decir "ya se puede
   presentar" apoyado en un cruce que no está implementado sería exactamente el
   error del §4.3: declarar cerrado algo que no se miró.
