# Auditoría completa de lo contable — 2026-08-12

Todo lo de acá se midió contra **producción** el 2026-08-12, no se dedujo de los
documentos anteriores. Donde una cifra es estimación y no medición, lo dice.

Patrón de comparación: Código Tributario (Arts. 62, 63, 67, 91, 101, 104, 125,
139, 141, 142, 162, 163), Reglamento (Arts. 83, 85, 86), Manual del F-07 v14, y
Código de Comercio (Arts. 435-441). Los PDF están en `docs/legal/`.

---

## El veredicto en una línea

**Los libros de VENTAS están sanos y verificados. El de COMPRAS replica al
origen al centavo — y ese es el problema, porque al origen le faltan cientos de
documentos fiscales y la empresa está pagando IVA de más. Contabilidad formal no
hay: no existe ni una tabla.**

> **Corrección a la primera versión de este documento (misma fecha).** La primera
> pasada dijo que las notas de crédito no restadas hacían **declarar el impuesto
> de menos**. Es cierto de esa pieza sola, pero **el neto va al revés**: los CCF
> que el origen no registra son mucho más grandes que las notas de crédito, y
> **al sumar todo la empresa pagó de más**. El §2.1 está reescrito con la
> medición contra el libro del origen, que en la primera pasada no se tenía.

| Capa | Estado |
|---|---|
| Documentos (DTE emitidos y recibidos) | ✅ completo |
| Libros de IVA — ventas | ✅ verificado al centavo contra el origen |
| Libros de IVA — compras | ⚠️ **tres defectos con monto** |
| Anexos del F-07 | ⚠️ ventas alineados; compras y percepción no |
| Declaración (cadena de períodos) | ❌ no existe el arrastre |
| Contabilidad formal (Art. 435 C.Com) | ❌ **cero tablas** |

---

## Parte 1 — Lo que está bien y no hay que rehacer

Lo verifiqué de nuevo por mi cuenta; no lo estoy copiando de los documentos
previos.

1. **El libro de ventas reproduce el del origen.** Junio 2026, consumidor final:
   el archivo del contador dice **$222,824.24** y el portal **$222,868.62**. Los
   $44.38 de diferencia son **tres documentos con nombre**, no un margen:

   | documento | sucursal | fecha | monto | causa |
   |---|---|---|---|---|
   | 311737 | Salud 1 | 20-jun | +45.98 | el origen entregó el sello como `undefined`; resellada el 02-ago |
   | 315442 | La Popular | 25-jun | +4.85 | mismo patrón, 31-jul |
   | 315202 | Salud 2 | 25-jun | −6.45 | invalidada en Hacienda, registrada el 31-jul |

   45.98 + 4.85 − 6.45 = 44.38 exacto.

2. **El IVA de junio se reproduce a $7.59.** Declarado $1,077.16; reconstruido
   desde la base $1,069.57. Reconstruir por otro camino un número calculado
   aparte y quedar a 0.7% es prueba de que las dos fuentes dicen lo mismo.

3. **El filtro del sello es correcto y es legal, no de diseño.** Art. 119-D: el
   documento adquiere carácter de DTE **cuando obtiene el sello**. `length(recibido_mh) = 40`
   es esa definición escrita en SQL.

4. **El incidente de sellos está cerrado.** Hoy quedan **5 ventas** sin sello
   válido, todas de agosto, la más nueva de **1 día** ($10.51 de IVA). Las tres
   colgadas desde 2025 y las 13 de agosto ya se resolvieron.

5. **La retención del Art. 162 ya se trata bien en los dos libros** (corregido
   hoy, v2.571.x). El libro registra el **valor de la venta**, no lo cobrado.

6. **Los anexos de ventas tienen su forma correcta**: contribuyentes 20 columnas,
   consumidor 23, con las dos columnas de Renta de enero-2025.

7. **El «del/al» del anexo de consumidor sale por correlativo**, que es lo
   correcto. El archivo del origen usa el mínimo y máximo **alfabéticos** del
   código de generación — o sea documentos del medio del día. El portal **no
   replica ese error**.

8. **Art. 63 LIVA (crédito fiscal de hasta 3 períodos anteriores): 0 documentos
   fuera de plazo** entre junio y agosto.

---

## Parte 2 — Los hallazgos que mueven plata

Ordenados por monto. Los cuatro primeros son **recurrentes**: pasan todos los meses.

### 2.1 · El libro de compras ignora cientos de documentos fiscales — la empresa **paga IVA de más**

Se bajó el **libro de compras del propio origen** de junio y julio, las 7
sucursales (14 archivos), y se cruzó contra las dos fuentes del portal por
código de generación.

**Primer resultado: el portal replica al origen exactamente.**

| | documentos | gravadas | crédito fiscal | total | percepción |
|---|---|---|---|---|---|
| **junio** — origen | 389 | 179,129.19 | 23,286.48 | 203,947.07 | 1,531.44 |
| **junio** — portal | 389 | 179,129.19 | 23,286.48 | 203,947.07 | 1,531.44 |
| **julio** — origen | 467 | 201,839.90 | 26,239.31 | 229,742.05 | 1,662.92 |
| **julio** — portal | 467 | 201,839.90 | 26,239.31 | 229,742.05 | 1,662.92 |

Cero diferencia, los dos meses. El libro del portal **no tiene ningún defecto
propio**: transcribe fielmente el del origen.

**Segundo resultado, y es el hallazgo: al origen le faltan cientos de
documentos.** Cruzado por código de generación contra los DTE que llegan por
correo:

| | junio | julio |
|---|---|---|
| en las dos fuentes | 295 | 407 |
| sólo en el origen | 47 | 15 |
| **sólo en el correo** | **337** | **452** |

Y lo que hay en esos documentos que el libro no lleva:

| | junio | julio |
|---|---|---|
| CCF y notas de débito **no registrados** (crédito fiscal a favor) | +$2,567.85 | +$6,096.95 |
| Notas de crédito **no restadas** (Art. 62 LIVA, en contra) | −$992.14 | −$1,745.73 |
| **ajuste neto al crédito fiscal** | **+$1,575.71** | **+$4,351.22** |

Los proveedores que el origen no registra tienen un patrón claro: **BANCO
PROMERICA (46 CCF en julio), Servicios Financieros (31), telefonía (14), agua
(14)**. Son **servicios**, no mercadería — y un sistema de inventario de farmacia
no los registra porque no entran al stock. Pero llevan IVA y son crédito fiscal.

### La prueba de que esto llegó a la declaración

Junio es el único mes cuyo IVA declarado se conoce: **$1,077.16**.

| escenario | IVA que da |
|---|---|
| **con el libro tal cual (origen y portal)** | **$1,069.57** ← cae a $7.59 de lo declarado |
| con los documentos completos | **−$506.14** (remanente a favor, cero a pagar) |

**La contadora declaró junio con el libro del origen sin ajustar nada.** No
anexó los CCF que faltaban ni restó las notas de crédito — lo que se había
registrado el 2026-08-05 (que ella los anexa a mano) **no ocurrió en junio**.

**El costo concreto de junio: se pagaron $1,077.16 que no correspondían, y se
perdió un remanente de $506.14** que debía arrastrarse a julio. Julio, con el
libro tal cual, da −$112.55; con los documentos completos, **−$4,463.77**.

**Dos meses, unos $5,900 de crédito fiscal no aprovechado.** Y es recurrente.

**La salvedad, y hay que resolverla antes de reclamar nada:** que un CCF exista
no lo hace deducible. El **Art. 65 LIVA** exige que la compra esté vinculada a la
actividad gravada. De los 265 CCF de julio, los de banco, telefonía y agua lo
están con claridad; **la lista completa la tiene que revisar la contadora**. Aun
descontando lo que no aplique, la dirección no cambia.

### 2.2 · La percepción no se capturó antes de junio-2026 — estimado **~$12,000 sin reclamar**

Esta pregunta estaba abierta desde el 2026-08-06 («¿empezaron a percibir, o
empezamos a capturarlo?»). **Queda resuelta, y es lo segundo.**

La prueba es LETERAGO, que es agente de percepción designado y percibe el 1% en
cada operación:

| período | documentos | compras | con percepción | tasa |
|---|---|---|---|---|
| sep-2025 → may-2026 (9 meses) | 56 | $22,645 | **0** | 0.000% |
| jun-2026 → ago-2026 | 15 | $6,382 | **11** | **~1.000%** |

LETERAGO no dejó de percibir durante nueve meses para retomar en junio. **El
campo empezó a leerse en junio.**

La percepción es un **anticipo** (Art. 163 CT) que se descuenta en la
declaración. No registrarla significa **haber pagado IVA de más**.

**Estimación del monto — es extrapolación, no medición:** aplicando la tasa
medida de junio-julio (0.84% de las compras netas) a las compras de agosto-2025 a
mayo-2026 ($1,464,676), la percepción del período habría sido **~$12,300**
contra los **$217.95** registrados. **≈ $12,000 que no se descontaron.**

Antes de mover un centavo esto se verifica contra los documentos archivados. Y
recuperarlo exige modificatorias que **reducen** el impuesto: Art. 104 CT — 2
años de plazo, verificación por auditores de Hacienda, y no surten efecto hasta
que Hacienda se pronuncie. Es un proceso, no un trámite.

### 2.3 · Las dos fuentes de compras no coinciden — **$2,912 sólo en julio**

El portal tiene las compras **dos veces**: las que registra bodega en el sistema
(`purchase_receipts`) y los DTE que llegan por correo (`purchase_dte_documents`).
El crédito fiscal de cada una, ya restando notas de crédito:

| mes | por correo | del sistema | diferencia |
|---|---|---|---|
| junio | $21,982.22 | $23,286.48 | el sistema, **$1,304.26 de más** |
| julio | $29,122.06 | $26,210.24 | el correo, **$2,911.82 de más** |
| agosto (al 12) | $5,603.42 | $4,266.85 | el correo, **$1,336.57 de más** |

Si fuera siempre para el mismo lado sería desfase de captura. **Junio va al
revés**, así que cada mes hay documentos que están en una fuente y no en la otra,
en ambos sentidos.

**RESUELTO con el libro del origen (ver §2.1).** La respuesta no era «una de las
dos»: **ninguna de las dos está completa por sí sola.**

- El **origen** registra compras cuyo DTE nunca llegó por correo (47 en junio,
  15 en julio) — son reales y tienen que quedarse.
- El **correo** tiene los documentos que el origen no registra (337 y 452), que
  son sobre todo **servicios**: banco, telefonía, agua.

**El libro de compras tiene que ser la UNIÓN de las dos, deduplicada por código
de generación.** Eso es exactamente lo que hay que construir, y el cruce ya está
probado: 295 y 407 documentos aparean limpio.

**Ojo con la clave.** El sello no sirve como clave única: el correo sólo lo trae
en el 31% de julio, y en el portal hay sellos repetidos entre proveedores
distintos (§2.5). El **código de generación** sí aparea —aun truncado a 20
caracteres por el origen, los primeros 16 hexadecimales bastan— y es el que
debe usarse.

### 2.4 · El remanente de crédito fiscal no se arrastra

Julio 2026 cerró con crédito **a favor** (−$81.24 con la fuente del sistema; más
negativo con la del correo). El **Art. 67 LIVA** manda arrastrarlo al período
siguiente.

Hoy nada guarda lo declarado: `Resumen Fiscal` recalcula el mes desde cero cada
vez que se abre. No hay tabla de cierre de período, así que **el saldo de julio
no existe en ningún lado** y agosto arranca de cero.

Consecuencia doble:

- **Agosto pagaría de más** por el remanente no aplicado.
- **El libro cambia después de declarado y nadie se entera.** Ya pasó dos veces
  medibles: los sellos que llegaron el 2026-08-02 subieron el débito de mayo
  $27.23 y el de junio $5.29, después de declarados.

### 2.5 · Una compra duplicada — $8.46

COFARSAL, `erp_purchase_id` 4986 y 5059: mismo sello, mismo documento, mismos
$73.52, cargadas con fecha 6 y 8 de julio. Infla el crédito fiscal en **$8.46**.

Poco dinero, pero prueba que el defecto **existe** — y en un mes cuyo IVA ronda
cero, alcanza para cambiar el signo.

**Además el sello no es único**: `202618E24BCE84144FEBB01C103AAF77E3E77D7M` está
en una compra de LETERAGO y en otra de COFARSAL. Un sello de recepción identifica
un documento y no puede repetirse: el campo se está llenando mal. Importa porque
el libro de compras **cruza por sello** para resolver el número de control.

---

## Parte 3 — Los archivos que se suben a Hacienda

No mueven el impuesto, pero son la forma del archivo que se presenta.

| # | Hallazgo | Estado |
|---|---|---|
| 3.1 | **Anexo 3 (compras) emite 23 columnas; el anexo pide 21.** Sobran la percepción y una vacía al final | abierto |
| 3.2 | **Columna C (tipo de documento) sale vacía** y es obligatoria. El origen la manda NULL en **1,581 de 2,722** compras de 2026 (58%). Se recupera cruzando contra `purchase_dte_documents.tipo_dte` | abierto |
| 3.3 | **El número de documento viene truncado a 20 caracteres** — `49F0A53C-F80B-4294-`. 1,252 filas miden exactamente 20. El anexo pide el código de generación completo. Hoy **ninguna fila del anexo de compras identifica su documento**. Se recupera ~68% por prefijo; el resto lo tiene que mandar el origen | abierto |
| 3.4 | **`Q;R;S;T` van fijos en `1;1;2;5`** (gravada, costo, comercio, costo de artículos comprados). Correcto para mercadería, **equivocado para servicios y gastos**. Se resuelve clasificando los 162 proveedores una vez | abierto |
| 3.5 | **El sello en compras está incompleto**: julio 56.7%, junio y agosto 0%. Emitirlo hoy daría un archivo que lo trae en unos meses y no en otros. Falta el backfill en ventanas de ≤10 días | abierto |
| 3.6 | **Anexo 8 (percepción) con el formato equivocado**: lleva correlativo y nombre del proveedor que el anexo no pide, le faltan sello, DUI y número de anexo, y los montos van con 4 decimales donde Hacienda toma 2 | abierto |
| 3.7 | **Anulados: el código de generación va sin guiones (32)**; el manual pide **36** | abierto |
| 3.8 | **Anexo 1, columna G** lleva el id interno; en DTE debe ir **vacía** | abierto |

### 3.9 · Una trampa silenciosa en el generador

`generar_csv_libro(..., p_branch_id => NULL)` devuelve **cero filas**, sin error:
el filtro es `branch_id = p_branch_id` y con NULL no coincide con nada. Medido:
con NULL 0 filas, con la sucursal 27 devuelve 14.

Hoy nadie la llama así —la vista arma el archivo por su cuenta y el verificador
va sucursal por sucursal— pero es exactamente la forma que produce **un archivo
fiscal vacío que parece correcto**. Debería devolver todas las sucursales o
fallar.

---

## Parte 4 — Qué le falta para ser un sistema contable

Acá cambia la pregunta. Lo anterior es *arreglar lo que hay*; esto es *lo que no
existe*.

### 4.1 · La ley pide tres cosas y el portal cubre dos

```
DOCUMENTOS          →   LIBROS DE IVA        →   CONTABILIDAD FORMAL
Art. 114-119 CT         Art. 141 CT              Art. 435 C.Com · Art. 139 CT
✅ lo tiene             ✅ lo hace               ❌ cero tablas
```

**Cumplir con los libros de IVA no cumple con el Art. 435.** Son obligaciones
distintas y adicionales.

### 4.2 · Lo que se buscó en la base y no existe

Consultado el catálogo de producción: **no hay ni una tabla** de catálogo de
cuentas, asientos, libro diario, libro mayor, caja, bancos, activo fijo,
depreciación ni cierre de período. Cero.

### 4.3 · Las tablas que existen y están vacías

| tabla | filas | qué significa |
|---|---|---|
| `payroll_entries` | **0** | |
| `payroll_periods` | **0** | ISSS + AFP + cuota ISR = **$7,012.65 de junio**, el **57%** de la cuota del mes |
| `branch_expenses` | **0** | ningún gasto operativo; ahí irían los honorarios |
| `conteos_inventario` | **1** | el F-983 exige inventario físico valuado |

Una tabla vacía es **peor que no tenerla**: un reporte que la consulte devuelve
cero, y cero se lee como «no hubo gastos», no como «nadie lo cargó».

### 4.4 · El costo de venta: existe desde hace 8 días

Es el dato más caro de todos y **acaba de empezar a capturarse**.

| fecha | líneas | con costo |
|---|---|---|
| 1 al 4 de agosto | 5,214 | **0** |
| 5 de agosto | 1,229 | 186 |
| 6 al 12 de agosto | 8,881 | **~97% por día** |

Arrancó el **2026-08-05**. Antes de esa fecha **no hay ni una línea con costo**,
y el dato no se puede reconstruir hacia atrás: `product_precios` guarda el costo
**actual**, no el que tenía el producto el día que se vendió.

**Consecuencia concreta: no existe Estado de Resultados de ningún mes anterior a
agosto de 2026, ni se puede fabricar.** El margen real del año pasado se perdió
en el momento de cada venta.

Lo barato ahora: las **6,436 líneas del 1 al 4 de agosto** sí se pueden rellenar
—el precio existe en `product_precios` para 7,856 de ellas— con cuatro días de
deriva en el costo. Es aproximación, pero es mejor que el hueco, y **la ventana se
cierra cada día que pasa**.

### 4.5 · El mapa completo de lo que falta

| Falta | Para qué | Tamaño |
|---|---|---|
| **Cierre de período** | arrastrar el remanente, congelar lo declarado, detectar la deriva | chico, y desbloquea la declaración |
| **Planilla** | ISSS, AFP, cuota ISR — el 57% de la cuota mensual | módulo mediano |
| **Gastos operativos** | honorarios, alquileres, servicios | chico |
| **Catálogo de cuentas** | base de cualquier asiento | chico |
| **Libro Diario y Mayor** | Art. 435 C.Com · asientos **inmutables** (Art. 139: no se edita, se corrige con otro asiento) | grande |
| **Estados Financieros** | Art. 441 C.Com y **F-971** (Art. 91 CT), con la declaración de Renta | grande |
| **Caja y arqueos** | conciliar lo vendido contra lo cobrado | mediano |
| **Bancos y conciliación** | — | mediano |
| **Cuentas por cobrar / por pagar** | ventas al crédito y deuda con proveedores | mediano |
| **Activo fijo y depreciación** | — | mediano |

### 4.6 · Dos obligaciones por tamaño que la empresa cruza

El umbral de los Arts. 125 y 142 CT es **2,753 salarios mínimos** = **$1,125,426**.
Las ventas selladas fueron **$1,724,541** en 2025 y **$1,701,781** en 2026 al
11-ago. **Se cruza con holgura en cualquier lectura.**

| informe | qué | cuándo |
|---|---|---|
| **F-983** | inventario físico valuado, con acta firmada | primeros dos meses del año |
| **F-987** | proveedores, clientes, acreedores y deudores, acumulado | **semestral — enero y julio** |

El F-987 es derivable hoy de `sales_invoices` y `purchase_receipts`. El F-983
necesita el inventario valuado, y `conteos_inventario` tiene **1 fila**.

**Hay que confirmar con la contadora si se están presentando.** Si el umbral se
cruza y no se presentan, es omisión con multa — y no es un problema de sistema.

---

## Parte 5 — El orden que recomiendo

**Primero lo que cuesta plata cada mes, después la forma de los archivos, después
el sistema contable.**

### Punto 0 — **HECHO** (2026-08-12)

Se bajó el libro de compras del origen de junio y julio, las 7 sucursales, y se
cruzó contra las dos fuentes. Resultado en §2.1 y §2.3. Los archivos quedaron en
el scratchpad de la sesión, **fuera del repo** (llevan nombres de proveedores).

### Bloque 1 — plata (recurrente)

1. **El libro de compras pasa a ser la unión origen + correo, deduplicada por
   código de generación.** Es el hallazgo de ~$5,900 en dos meses, y arregla de
   una vez los CCF que faltan **y** las notas de crédito que no se restan.
   Antes: que la contadora marque cuáles de los CCF de servicios son deducibles
   (Art. 65 LIVA).
2. **Llevarle a la contadora la reconstrucción de junio y julio.** Junio se pagó
   $1,077.16 de más y julio arrastra remanente. La modificatoria que *reduce* el
   impuesto cae bajo el Art. 104 CT: 2 años de plazo, verificación de auditores,
   y no surte efecto hasta que Hacienda se pronuncie. **Es decisión de ella, no
   del sistema.**
3. **Verificar la percepción histórica** contra los documentos archivados. Si se
   confirma, ~$12,000 más, por el mismo camino del Art. 104.
4. **Cierre de período** — arrastrar el remanente y congelar lo declarado.
   Sin esto la declaración de agosto ya nace mal, y el remanente de julio se
   pierde igual que se perdió el de junio.
5. **Deduplicar compras por sello** y arreglar el llenado del sello (§2.5).

### Bloque 2 — los archivos (una migración cada uno)

5. Anexo 3: columna C desde `tipo_dte`, código de generación por prefijo, quitar
   las dos columnas de más.
6. Backfill del sello en compras de junio y agosto, en ventanas de ≤10 días.
7. Clasificar los 162 proveedores (costo/gasto, sector, tipo).
8. Anexo 8, anulados con 36 caracteres, anexo 1 columna G vacía.
9. `generar_csv_libro` con branch NULL: que devuelva todo o que falle.

### Bloque 3 — el sistema contable

10. **Rellenar el costo del 1 al 4 de agosto ya** — la ventana se cierra sola.
11. **Planilla** — es el 57% de la cuota del mes y es un módulo, no un cálculo.
12. **Gastos operativos** — chico y desbloquea el margen real.
13. Catálogo de cuentas → Diario → Mayor → Estados Financieros. Es el proyecto
    grande, y **no arranca sin el 10 y el 11**: sin costo de venta y sin planilla
    no hay Estado de Resultados que emitir.

---

## Anexo — cómo reproducir cada cifra

```sql
-- 2.1 · las notas de crédito de compras no están en el libro
select coalesce(documento_tipo,'(null)') tipo, count(*), sum(total)
from purchase_receipts where fecha >= '2026-01-01' group by 1;

select tipo_dte, count(*), sum(monto_total), sum(total_iva)
from purchase_dte_documents
where fecha_emision >= '2026-01-01' and coalesce(invalidado,false) = false
  and tipo_dte in ('05','06') group by 1;

-- 2.2 · LETERAGO percibe siempre; el campo empezó a leerse en junio
select to_char(fecha,'YYYY-MM') mes, count(*),
       count(*) filter (where coalesce(percepcion_iva,0) > 0) con_percep,
       sum(percepcion_iva)
from purchase_receipts
where proveedor ilike '%LETERAGO%' and fecha >= '2025-09-01'
  and coalesce(estado,'') <> 'anulada'
group by 1 order by 1;

-- 2.3 · las dos fuentes de compras, crédito fiscal comparable
with dte as (
  select to_char(fecha_emision,'YYYY-MM') mes,
         sum(case when tipo_dte in ('03','06') then total_iva
                  when tipo_dte = '05' then -total_iva else 0 end) credito
  from purchase_dte_documents
  where fecha_emision >= '2026-06-01' and coalesce(invalidado,false) = false
  group by 1),
erp as (
  select to_char(fecha,'YYYY-MM') mes, sum(iva) credito
  from purchase_receipts
  where fecha >= '2026-06-01' and coalesce(estado,'') <> 'anulada' group by 1)
select d.mes, d.credito correo, e.credito sistema, d.credito - e.credito dif
from dte d join erp e using (mes) order by 1;

-- 2.5 · compras que comparten sello
select sello_recibido, count(*), array_agg(erp_purchase_id), array_agg(proveedor)
from purchase_receipts
where fecha >= '2026-06-01' and coalesce(estado,'') <> 'anulada'
  and sello_recibido is not null
group by 1 having count(*) > 1;

-- 3.3 · el número de documento truncado
select length(documento_numero), count(*) from purchase_receipts
where documento_numero is not null group by 1 order by 1 desc;

-- 3.9 · el generador con sucursal NULL
select (select count(*) from generar_csv_libro('contribuyente','2026-07-01','2026-07-31',NULL)) con_null,
       (select count(*) from generar_csv_libro('contribuyente','2026-07-01','2026-07-31',27))   con_branch;

-- 4.4 · desde cuándo hay costo de venta
select si.fecha, count(*) lineas,
       count(*) filter (where i.costo_unitario is not null) con_costo
from sales_invoice_items i join sales_invoices si on si.id = i.invoice_id
where si.fecha >= '2026-08-01' group by 1 order by 1;
```

**Nota de acceso.** Los `get_libro_*` son SECURITY DEFINER con
`auth_has_module_permission('libros_iva','can_view')` **adentro del WHERE**: desde
una sesión que no es de un empleado devuelven **cero filas, sin error**. Para
auditarlos hay que consultar las tablas base, no los RPC. Es la misma trampa de
`feedback_cero_hallazgos_y_cero_datos_se_ven_igual`.

---

## Lo que esta auditoría NO pudo determinar

- ~~Cuál de las dos fuentes de compras es la correcta.~~ **Resuelto el 2026-08-12
  con el libro del origen: ninguna de las dos sola. Ver §2.1 y §2.3.**
- **Cuáles de los CCF que el origen no registra son deducibles** (Art. 65 LIVA).
  Son 265 en julio; los de banco, telefonía y agua lo son con claridad, el resto
  lo tiene que revisar la contadora. Es el único dato que falta para poner número
  final al hallazgo de §2.1.
- **Si la percepción anterior a junio existía realmente en los documentos.** La
  prueba de LETERAGO es fuerte pero indirecta; lo directo es abrir los DTE
  archivados, que existen desde el 2026-05-13.
- **La base del pago a cuenta.** Declarado $3,991.48 en junio; el 1.75% de las
  ventas da $3,484.93 según el portal y $3,484.29 según el archivo del contador.
  Las dos fuentes coinciden, así que **los $506.55 de diferencia no son un
  problema de datos**: es otro componente de esa línea, probablemente el ISR
  retenido del mismo F-14. Hay que pedirle el papel de trabajo.
- **Si el F-983 y el F-987 se están presentando.**
- **Qué archivo sube realmente la contadora** — si toma estos CSV o usa la
  plantilla del Ministerio y los llena aparte. Cambia la prioridad de toda la
  Parte 3.
</content>
</invoke>
