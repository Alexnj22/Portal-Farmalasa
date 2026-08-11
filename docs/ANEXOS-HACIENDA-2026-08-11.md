# Qué se le manda a Hacienda como "anexos", cómo es cada archivo y qué campos lleva

Fecha: 2026-08-11. Investigación, no implementación.

Fuente principal: **Manual de usuario para carga de archivo de los anexos de la
declaración F-07 v14, Ministerio de Hacienda, ENERO 2025** (75 páginas,
`700-DGII-MN-2021-26031.pdf` en transparenciafiscal.gob.sv). Todas las tablas de
campos de abajo están transcritas de ahí, no deducidas. El Código Tributario
citado es el PDF de `docs/legal/codigo_tributario.pdf`.

---

## 0. "Anexos contables" son dos cosas distintas

| | Mensual | Anual |
|---|---|---|
| **Qué** | Anexos del **F-07** (IVA) y del **F-14** (pago a cuenta y retenciones de Renta) | **F-971** — Balance General, Estado de Resultados y conciliaciones fiscales, junto a la declaración de Renta (F-11) |
| **Forma** | Archivos **CSV** que se suben a la declaración en línea | Formulario en línea con las cifras de los estados financieros |
| **De dónde sale** | De los documentos: DTE emitidos y recibidos | De la **contabilidad formal** (Libro Diario, Mayor, Estados Financieros) |
| **Base legal** | Art. 141 CT (libros) + la declaración misma | **Art. 91 CT**, inciso 2 |
| **¿El portal lo puede producir?** | Casi — ver §3 | **No.** Ver `docs/CONTABILIDAD-ALCANCE-2026-08-01.md`: el portal cubre documentos y libros fiscales, no contabilidad |

Y aparte están los **informes periódicos** (F-910, F-915, F-983, F-987…), §5.

---

## 1. Los anexos del F-07 — reglas comunes del archivo

Del manual, §II "Aspectos generales":

| Regla | Valor |
|---|---|
| Formato | CSV |
| Separador | **punto y coma `;`** (el manual hace configurar el separador de listas de Windows a `;`) |
| Encabezados | **ninguno** — ni títulos ni celdas combinadas |
| Nombre del archivo | máximo **25 caracteres** |
| Formato de celda | **Texto** (todas) |
| Fecha | `DD/MM/AAAA` |
| Decimales | punto, **máximo 2** (el sistema trunca a 2 si vienen más) |
| Miles | **sin separador** |
| Vacíos | los montos van `0.00`, **nunca en blanco** |
| Negativos | prohibidos, salvo documentos anulados/invalidados (Art. 111 CT) |
| NIT / NRC / DUI | **sin guiones ni pleca** |

**Los 12 anexos del F-07** (el número va en la última columna de cada archivo):

| # | Anexo | Casilla |
|---|---|---|
| 1 | Detalle de ventas a contribuyentes | — |
| 2 | Detalle de ventas a consumidor final | — |
| 3 | Detalle de compras | — |
| 4 | Ventas gravadas por cuenta de terceros domiciliados | 108 |
| 5 | Compras a sujetos excluidos | 66 |
| 6 | Anticipo a cuenta IVA 2% efectuado **al** declarante | 161 |
| 7 | Retención IVA 1% efectuada **al** declarante | 162 |
| 8 | Percepción IVA 1% efectuada **al** declarante | 163 |
| 9 | Percepción IVA 1% efectuada **por** el declarante | 169 |
| 10 | Retención 1% IVA a terceros domiciliados efectuada por el declarante | 170 |
| 11 | Anticipo a cuenta 2% efectuado por el declarante | 171 |
| 12 | Retención 13% IVA a terceros domiciliados efectuada por el declarante | 172 |

Más el **anexo de documentos anulados, extraviados e invalidados**, que va en su
propia pestaña ("Documentos Emitidos, Anulados y Extraviados"), y anexos
especiales de combustibles y del Decreto 357 que no aplican acá.

**Para esta farmacia aplican hoy: 1, 2, 3, el de anulados**, y el **8**
(percepción que le hacen los proveedores, ej. LETERAGO). El 5 aplicaría si se
compra a sujetos excluidos.

### Reglas específicas de DTE (§XV del manual)

- **Clase de documento = `4`** en todos los anexos.
- **Desde noviembre 2022**: donde se pide *Número de Resolución* va el **número
  de control** del DTE sin guiones, y donde se pide *Número de Documento* va el
  **código de generación** sin guiones. **Para períodos anteriores a noviembre
  2022 los dos están invertidos.** Importa si alguna vez se rehacen períodos
  viejos.
- Donde se pide *Número de Serie del Documento* va el **sello de recepción de
  Hacienda** (40 caracteres).
- *Número de Control Interno*: **en blanco** para DTE.
- Los datos cargados deben corresponder a los **documentos emitidos, sin incluir
  anulados ni extraviados** — esos van en su propio anexo.

---

## 2. Los campos, anexo por anexo

### Anexo 1 — Ventas a contribuyentes (CCF) · 20 columnas

Una fila **por documento**.

| Col | Campo | Máx | Qué va en un DTE |
|---|---|---|---|
| A | Fecha de emisión | 10 | `DD/MM/AAAA` |
| B | Clase de documento | 1 | `4` |
| C | Tipo de documento | 2 | `03` CCF · `05` NC · `06` ND |
| D | Número de resolución | 100 | número de control, sin guiones |
| E | Número de serie | 100 | **sello de recepción** (40) |
| F | Número de documento | 100 | código de generación, sin guiones |
| G | Número de control interno | 100 | **vacío** |
| H | NIT o NRC del cliente | 14 | sin guiones. Si es persona natural y se llena Q (DUI), **este debe ir completamente vacío** |
| I | Nombre / razón social | s/l | |
| J | Ventas exentas | 10 | `0.00` si no hay |
| K | Ventas no sujetas | 10 | |
| L | Ventas gravadas locales | 10 | |
| M | Débito fiscal | 10 | |
| N | Ventas a cuenta de terceros no domiciliados | 10 | |
| O | Débito fiscal por venta a cuenta de terceros | 10 | |
| P | Total ventas | 10 | |
| Q | DUI del cliente | 9 | sólo personas naturales, períodos ≥ enero 2022; excluyente con H |
| R | **Tipo de operación (Renta)** | 2 | **nuevo desde enero 2025** |
| S | **Tipo de ingreso (Renta)** | 2 | **nuevo desde enero 2025** |
| T | Número de anexo | 1 | `1` |

### Anexo 2 — Ventas a consumidor final · 23 columnas

Una fila **por día y tipo de documento** (no por documento): el consumidor final
no se identifica, así que Hacienda sólo pide el resumen diario y el rango
emitido.

| Col | Campo | Qué va en un DTE |
|---|---|---|
| A | Fecha de emisión | `DD/MM/AAAA` |
| B | Clase de documento | `4` |
| C | Tipo de documento | `01` factura · `02` venta simplificada · `10` tiquetes · `11` exportación |
| D | Número de resolución | **`N/A`** (porque se agrupa por día) |
| E | Serie de documento | **`N/A`** |
| F | Número de control interno (del) | **`N/A`** |
| G | Número de control interno (al) | **`N/A`** |
| H | Número de documento (**del**) | **código de generación del PRIMER DTE del día** |
| I | Número de documento (**al**) | **código de generación del ÚLTIMO DTE del día** |
| J | Nº de máquina registradora | **en blanco** (ni siquiera cero) |
| K | Ventas exentas | |
| L | Ventas internas exentas no sujetas a proporcionalidad | |
| M | Ventas no sujetas | |
| N | Ventas gravadas locales | **con IVA incluido** |
| O | Exportaciones dentro del área centroamericana | |
| P | Exportaciones fuera del área centroamericana | |
| Q | Exportaciones de servicios | |
| R | Ventas a zonas francas y DPA (tasa cero) | |
| S | Venta a cuenta de terceros no domiciliados | |
| T | Total ventas | |
| U | **Tipo de operación (Renta)** | **nuevo desde enero 2025** |
| V | **Tipo de ingreso (Renta)** | **nuevo desde enero 2025** |
| W | Número de anexo | `2` |

Nota del manual: las exportaciones se **cruzan contra lo que reporta la
Dirección General de Aduanas**.

### Anexo 3 — Compras · 21 columnas

| Col | Campo | Qué va |
|---|---|---|
| A | Fecha de emisión | del documento del proveedor. Se admiten documentos de **3 períodos anteriores** (Art. 63 Ley IVA) |
| B | Clase de documento | `4` para DTE · `3` para tipos 12 y 13 |
| C | **Tipo de documento** | `03` CCF · `05` NC · `06` ND · `11` exportación · `12` Declaración de Mercancías · `13` Mandamiento de Ingreso |
| D | Número de documento | código de generación sin guiones |
| E | NIT o NRC del proveedor | excluyente con P (DUI) |
| F | Nombre del proveedor | |
| G | Compras internas exentas y/o no sujetas | |
| H | Internaciones exentas y/o no sujetas | |
| I | Importaciones exentas y/o no sujetas | |
| J | Compras internas gravadas | |
| K | Internaciones gravadas de bienes | |
| L | Importaciones gravadas de bienes | |
| M | Importaciones gravadas de servicios | |
| N | Crédito fiscal | 13% del total de J a M |
| O | Total de compras | suma de G a M, **sumando ND y restando NC** |
| P | DUI del proveedor | |
| Q | **Tipo de operación** | desde febrero 2024 |
| R | **Clasificación** | costo o gasto |
| S | **Sector** | |
| T | **Tipo de costo / gasto** | |
| U | Número de anexo | `3` |

### Anexo 5 — Compras a sujetos excluidos (casilla 66) · 13 columnas

| Col | Campo | Qué va |
|---|---|---|
| A | Tipo de documento de identidad | `1` NIT · `2` DUI · `3` otro |
| B | Número de NIT/DUI/otro | 14 / 9 / máx 14, sin guiones |
| C | Nombre del sujeto excluido | |
| D | Fecha de emisión | |
| E | Número de serie | **sello de recepción del DTE** |
| F | Número de documento | código de generación sin guiones |
| G | Monto de la operación | |
| H | Monto de la retención IVA 13% | `0.00` si no hubo |
| I–L | Tipo de operación · Clasificación · Sector · Tipo de costo/gasto | desde febrero 2024 |
| M | Número de anexo | `5` |

### Anexo de documentos anulados, extraviados e invalidados · 10 columnas

| Col | Campo | Qué va en un DTE |
|---|---|---|
| A | Número de resolución | número de control (desde oct-2022; antes, código de generación) |
| B | Clase de documento | `4` |
| C | Desde (preimpreso) | `0` |
| D | Hasta (preimpreso) | `0` |
| E | Tipo de documento | `01`…`14` |
| F | **Tipo de detalle** | `A` anulado/invalidado · `X` extraviado · **`D` DTE invalidado** |
| G | Serie | **sello de recepción de 40 caracteres** |
| H | Desde | `0` |
| I | Hasta | `0` |
| J | Código de generación | **36 caracteres** (o sea, **con** guiones) |

---

## 3. Los catálogos nuevos (las columnas que el sistema NO puede deducir)

Éstas son las que el manual dice expresamente que **las define el contador**, no
el documento. Son la razón por la que un anexo no se genera solo.

**Tipo de operación (Renta)** — anexos 1 y 2, col. R/U:
`1` Gravada · `2` No gravada o exenta · `3` Excluido o no constituye renta ·
`4` Mixta (un mismo documento con operación gravada y exenta) ·
`12` Ingresos que ya fueron sujetos de retención informados en el F-14 y consolidados en F-910 ·
`13` Sujetos pasivos excluidos (art. 6 LISR) e ingresos que no constituyen hecho generador del ISR.

**Tipo de ingreso (Renta)** — anexos 1 y 2, col. S/V:
`1` Profesiones, artes y oficios · `2` Actividades de servicios ·
**`3` Actividades comerciales** ← el de una farmacia · `4` Industriales ·
`5` Agropecuarias · `6` Utilidades y dividendos · `7` Exportaciones de bienes ·
`8` Servicios realizados en el exterior y utilizados en El Salvador ·
`9` Exportaciones de servicios · `10` Otras rentas gravables · `12` · `13`.

**Compras (anexos 3 y 5)** — cuatro columnas:
- *Tipo de operación*: `1` gravada · `2` no gravada · `3` excluido o no constituye renta · `4` mixta.
- *Clasificación*: `1` Costo · `2` Gasto.
- *Sector*: `1` Industria · **`2` Comercio** · `3` Agropecuaria · `4` Servicios, profesiones, artes y oficios.
- *Tipo de costo/gasto*: `1` Gastos de venta sin donación · `2` Gastos de administración sin donación · `3` Gastos financieros sin donación · `4` Costo artículos producidos/comprados importaciones/internaciones · **`5` Costo artículos producidos/comprados interno** · `6` Costos indirectos de fabricación · `7` Mano de obra.

Dos códigos comodín, y son importantes:
- **`8` = "operación informada en más de 1 anexo"** — para no contarla dos veces
  en la suma de costos y gastos de la declaración de Renta.
- **`9`** — instituciones públicas, municipalidades y operaciones no deducibles
  para Renta vía costo o gasto.

El manual trae una matriz de combinaciones válidas (p. 21): con *Clasificación =
Costo* sólo se admiten tipos 4-7, y con *Gasto* sólo 1-3.

---

## 4. Qué produce el portal hoy y en qué NO coincide

El portal ya genera CSVs con `generar_csv_libro` (verificado contra el catálogo
de prod el 2026-08-11). Son **réplicas del libro del sistema de origen**, y
resulta que ese formato es el del anexo — pero no en todos los casos está al día.

| Archivo | Columnas que emite el portal | Columnas del anexo F-07 v14 | Estado |
|---|---|---|---|
| Anulados | 10 | 10 | **coincide**, salvo un detalle (ver abajo) |
| Compras | 23 | 21 | A–U alineado; **col. C sale vacía** y sobran 2 columnas al final |
| Ventas a contribuyentes | 19 | 20 | **no coinciden** |
| Ventas a consumidor final | 22 | 23 | **no coinciden** |

Hallazgos concretos, todos verificables abriendo el archivo:

1. **Faltan las dos columnas de Renta de enero 2025** en los dos anexos de
   ventas (`R`/`S` y `U`/`V`). El archivo de ventas sale corto. Son justamente
   las que el manual dice que las define el contador — el sistema no las puede
   inventar, pero sí podría dejarlas configuradas (para esta farmacia serían
   fijas: tipo de operación `1` gravada, tipo de ingreso `3` comerciales).
2. **En compras, la columna C (tipo de documento) sale vacía.** El anexo la pide
   con 2 caracteres (`03`/`05`/`06`…). Es un campo obligatorio.
3. **En compras, `Q;R;S;T;U` van fijos en `1;1;2;5;3`** para toda fila: gravada,
   costo, comercio, costo de artículos comprados interno. Para la mercadería es
   correcto; para un proveedor de servicios o un gasto administrativo **no** —
   ahí tendría que ser gasto (`2`) y sector `4`. Hoy nadie lo distingue.
4. **En compras sobran dos columnas** al final (percepción con 4 decimales y
   sello). Son del libro, no del anexo.
5. **En consumidor final, las columnas D-E-F-G llevan datos** (número de
   control, sello, ids internos) donde el manual pide literalmente `N/A` por
   tratarse de DTE agrupados por día.
6. **En anulados, el código de generación va sin guiones (32 caracteres)** y el
   manual pide **36**.
7. **En contribuyentes, el NIT va en la penúltima columna**, que en el anexo es
   el **DUI** (9 caracteres, sólo personas naturales, y excluyente con el
   NIT/NRC de la columna H).

**Lo que hay que confirmar antes de tocar nada: qué archivo sube realmente el
contador.** Puede que tome estos CSV y los ajuste, o que use la plantilla Excel
con macros del Ministerio y los llene aparte. Comparar un archivo real subido
contra estas tablas es media hora y despeja los 7 puntos de arriba.

---

## 5. Los anexos contables anuales, y los informes por tamaño

### F-971 — Balance General y Estado de Resultados (Art. 91 CT)

> «Los contribuyentes del impuesto sobre la renta **que estén obligados a llevar
> contabilidad** deberán presentar, dentro del plazo que la ley prevé para la
> presentación de la declaración del referido impuesto, el **balance general**
> del cierre del ejercicio, el **estado de resultados**, así como las
> **conciliaciones fiscales** o justificaciones de los rubros consignados en la
> declaración y en el balance general.»

- **Plazo**: el mismo de la declaración de Renta — **dentro de los cuatro meses
  siguientes al cierre del ejercicio** (hasta el 30 de abril).
- **Contenido**: activo corriente y no corriente, pasivo corriente y no
  corriente, patrimonio, estado de resultados, y la **conciliación entre la
  utilidad contable y la renta imponible**.
- **Quedan excluidos**: quienes tengan rentas sólo de salarios, las personas
  naturales con rentas diversas ≤ $30,000, y **quienes hayan nombrado e
  informado auditor fiscal** (a ésos los cubre el dictamen fiscal).
- Se presenta **en línea** desde abril 2020.
- Art. 91 exige además que **las cifras coincidan** con los estados financieros
  entregados a bancos y con los inscritos en registros públicos, y con los
  asientos de los libros legalizados.

**Esto el portal no lo puede producir y no está cerca**: exige contabilidad
formal (catálogo de cuentas, Diario, Mayor) y **costo de ventas**, que hoy no
existe — `sales_invoice_items` guarda precio pero no costo. Ver
`docs/CONTABILIDAD-ALCANCE-2026-08-01.md` §4.

### Informes que dependen del tamaño — y esta farmacia los cruza

El umbral de los Arts. 125 y 142 CT es **2,753 salarios mínimos mensuales**. Con
el salario mínimo de comercio vigente (**$408.80** desde junio 2025; antes $365)
eso son **$1,125,426** ($1,004,845 con el anterior).

Ventas con sello válido en el portal, medidas hoy:

| Año | Documentos | Total con IVA | Neto |
|---|---|---|---|
| 2025 | 180,661 | $1,724,541.63 | $1,526,153.12 |
| 2026 (al 11-ago) | 164,488 | $1,701,781.85 | $1,506,050.87 |

**El umbral se cruza con holgura, en cualquier lectura** (con o sin IVA). O sea
que aplican:

| Informe | Qué es | Cuándo | Base |
|---|---|---|---|
| **F-983** | Informe de **inventario físico**: el detalle de cada bien inventariado y su valuación, en medio electrónico, con formulario firmado por el contribuyente y el contador | **primeros dos meses del año** | Art. 142 CT |
| **F-987** | Proveedores, clientes, acreedores y deudores: identificación, concepto, **valor acumulado mensual** y crédito/débito fiscal, más fecha, número y clase de documento | **semestral, enero y julio** | Art. 125 CT |

El F-983 es el único de los dos donde el portal ya tiene la materia prima
(`inventory`, `conteos_inventario`) — pero el Art. 142 pide **precio unitario
neto de IVA y valor total**, con referencia al libro de costos o de compras, y
un **acta firmada**. El F-987 pide acumulados por contraparte, que sí se pueden
derivar de `sales_invoices` y `purchase_receipts`.

Otros, para tener el mapa completo:

| Informe | Qué | Cuándo |
|---|---|---|
| **F-910** | Informe anual de **retenciones de ISR** | enero (hasta el 31), Art. 123 CT |
| **F-915** | Distribución o capitalización de **utilidades/dividendos** y nómina de accionistas | enero, Art. 124 CT |
| **F-982** | Operaciones con **sujetos relacionados** | con la declaración de Renta, Art. 124-A CT |
| **F-14** | Pago a cuenta y retenciones de Renta — **con su propio anexo CSV**, que desde enero 2025 también lleva las 4 columnas nuevas (naturaleza de la operación, costo/gasto, sector, tipo) | mensual |

---

## 6. Qué falta exactamente, y cómo se arregla con lo que ya hay

Medido contra prod el 2026-08-11. Separado por **qué tipo de problema es**,
porque el costo de cada grupo es distinto en un orden de magnitud.

### Grupo A — sólo hay que reordenar columnas (no falta ningún dato)

Los tres archivos de ventas. Todo el dato existe y está bien; el archivo está
armado con el layout viejo.

| Qué | Arreglo |
|---|---|
| Anexo 1: faltan `R` y `S` | son **constantes** para esta farmacia: `1` (gravada) y `3` (actividades comerciales) |
| Anexo 2: faltan `U` y `V` | las mismas dos constantes |
| Anexo 1 col. `G` (control interno) lleva el `erp_invoice_id` | debe ir **vacío** en DTE |
| Anexo 1: `H` lleva el NRC y `Q` el NIT | `Q` es el **DUI** (9 caracteres, sólo personas naturales) y es **excluyente** con `H`. `customers` ya tiene las tres columnas: de los 313 CCF de 2026, 312 tienen NRC y NIT, y 141 tienen DUI |
| Anexo 2: `D`,`E`,`F`,`G` llevan número de control, sello e ids internos | el manual pide literalmente `N/A` en las cuatro |
| Sobra una columna en cada archivo de ventas | (`'0'` en contribuyentes, `'0.0000'` en consumidor) |
| Anulados: código de generación sin guiones (32) | el manual pide **36**, o sea **con** guiones |

**Todo esto es una sola migración de `generar_csv_libro`.** Sin datos nuevos, sin
pantalla, sin tocar el sync. Es el arreglo más barato y el que más cierra.

### Grupo B — falta el dato, y una parte se recupera de lo que ya tenemos

El anexo 3 (compras). Sobre los **2,714 recibos de 2026**:

1. **Tipo de documento (columna C, obligatoria): sólo 1,133 de 2,714 lo tienen**
   — el 58% viene NULL desde el origen. `purchase_dte_documents.tipo_dte` sí lo
   tiene, con los seis tipos reales: `03` (1,237), `09` (210), `05` (142), `01`
   (20), `06` (4), `07` (1). **Se recupera cruzando contra esa tabla.**
2. **El número de documento viene TRUNCADO a 20 caracteres.** El anexo pide el
   código de generación completo (32 sin guiones); lo que hay es
   `C7980C1F-7494-4A20-B` — un UUID cortado a la mitad. La columna en la base es
   `text`, o sea que **la mutilación viene del sistema de origen**, no del
   portal. Hoy **ninguna** fila del anexo de compras puede identificar su
   documento. **766 de 1,133 (68%) se recuperan por prefijo** contra
   `purchase_dte_documents.codigo_generacion` (los DTE que llegan por correo).
   El resto necesita que el origen mande el campo entero.
3. **`Q;R;S;T` van fijos en `1;1;2;5`** para toda fila. Correcto para mercadería,
   equivocado para servicios y gastos. Se resuelve con **columnas nuevas en
   `proveedores_maestro`** (clasificación costo/gasto, sector, tipo de
   costo/gasto): son **162 proveedores**, 104 ya con código de actividad para
   proponer el valor por defecto. Es una tabla chica que se clasifica una vez.
4. Sobran las dos columnas finales (percepción y sello): son del libro, no del
   anexo.

### Grupo C — el archivo hay que rehacerlo entero

**Anexo 8 — percepción del 1% que le hacen a la farmacia (casilla 163).** No es
cosmético: son **540 compras y $3,588.22 en 2026**, dinero que se acredita.

Lo que produce el portal hoy tiene 9 columnas, igual que el anexo, pero **no son
las mismas**: lleva correlativo y nombre del proveedor (que el anexo no pide), le
faltan el DUI del agente y el número de anexo, el sello sale vacío y los montos
van con 4 decimales donde Hacienda toma 2.

El anexo 8 pide: `A` NIT del agente · `B` fecha · `C` tipo (`03`/`05`/`06`/`12`)
· `D` **sello de recepción** · `E` código de generación sin guiones · `F` monto
sujeto · `G` percepción · `H` DUI del agente · `I` `8`.

Depende de los mismos dos datos del grupo B: el sello (hoy 791 de 2,714) y el
código de generación completo.

**Anexo 7 — retención del 1% que le hacen a la farmacia (casilla 162).** Cero
compras con retención en 2026, pero hay un pendiente abierto de **$48.95 sobre
ventas** (memoria `project_retencion_iva_ventas_art162`). Si a la farmacia le
retienen sobre una venta, va acá, con el NIT del **cliente que retuvo** como
agente. Hoy existe un CSV de retención sobre ventas que no replica ningún archivo
del origen; hay que ver si ése es el insumo de este anexo.

**Anexo 5 — sujetos excluidos.** Existe `get_libro_sujeto_excluido`, pero el
endpoint del origen nunca se encontró (9 nombres probados). Preguntar al contador
si la farmacia compra a sujetos excluidos; si compra, hoy eso no se ve.

### El orden

1. **Pedirle al contador un anexo real ya subido** y cotejarlo contra §2. Media
   hora, y decide si los grupos A y B son problemas de verdad o si él ya los
   corrige a mano. **Nada más debería empezar antes de esto.**
2. **Grupo A**: una migración de `generar_csv_libro`.
3. **Grupo B.1 y B.2**: recuperar tipo y código de generación desde
   `purchase_dte_documents` — un backfill del histórico y el mismo cruce en el
   sync de aquí en adelante. Y **pedirle al proveedor del sistema de origen el
   número de documento completo**, que es la única solución de fondo del 32%
   restante.
4. **Grupo B.3**: clasificar los 162 proveedores.
5. **Grupo C**: rehacer el anexo 8.

### Aparte, y más grande

- **Confirmar si ya se presentan el F-983 y el F-987.** Si el umbral se cruza y
  no se están presentando, es una omisión con multa — no es un tema de sistema.
- **El F-971 no es alcanzable sin contabilidad formal.** El orden está en
  `CONTABILIDAD-ALCANCE-2026-08-01.md` §5: primero el costo por línea vendida.
  Sin eso no hay estado de resultados.

---

## Fuentes

- Ministerio de Hacienda — *Manual de usuario para carga de archivo de los anexos
  de la declaración F-07 v14*, enero 2025:
  https://www.transparenciafiscal.gob.sv/downloads/pdf/700-DGII-MN-2021-26031.pdf
- Ministerio de Hacienda — *Modificación a los anexos de los formularios de IVA
  (F07) y pago a cuenta (F14) a partir del período tributario de enero 2025*:
  https://www.mh.gob.sv/modificacion-a-los-anexos-de-los-formularios-de-iva-f07-y-pago-a-cuenta-f14-a-partir-del-periodo-tributario-de-enero-2025/
- Código Tributario, Arts. 91, 123, 124, 125, 141, 142 y 142-A —
  `docs/legal/codigo_tributario.pdf`
- `generar_csv_libro` (catálogo de producción, leído el 2026-08-11) y
  `docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md`
