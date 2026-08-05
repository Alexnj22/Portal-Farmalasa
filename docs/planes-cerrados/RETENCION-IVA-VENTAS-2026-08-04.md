# Retención de IVA sobre ventas — cierre

**2026-08-03 / 04.** Arrancó porque soporte del origen agregó `totales.retencion`
al JSON de ventas. Terminó tocando el libro, el Corte Z, el cuadre diario y dos
lecturas del reglamento. Esto es lo que quedó, lo que se decidió y lo único que
sigue abierto.

---

## Qué es esta retención

El 1% que **el cliente nos retiene** al pagarnos y entera él mismo (**Art. 162
CT**). No es una venta menos: es **impuesto ya pagado** que se acredita al
declarar.

Hay **dos fundamentos distintos** para el mismo 1%, y por eso conviven CCF y
facturas de consumidor en la misma lista:

| Inciso | Quién retiene | Documento | En la historia |
|---|---|---|---|
| 1.º | grandes contribuyentes | **CCF** | 27 docs · $117.05 — BANCO PROMERICA, COFARSAL, VIJOSA, OPEN SOLUTIONS |
| 3.º | Órganos del Estado, municipalidades e **instituciones oficiales autónomas**, «aunque no sean contribuyentes de dicho impuesto» | **factura** | 17 docs · $62.31 — solo el ISSS |

Ese «aunque no sean contribuyentes» es la clave: el ISSS no necesita crédito
fiscal, recibe factura, **y retiene igual**. La retención sobre una factura de
consumidor **no es un error**.

Verificado contra las otras dos reglas del mismo artículo, en los 44 documentos
de la historia: **los 44** tienen base ≥ $100 (el piso que fija) y en 40 la
retención es exactamente el 1% de la base **sin IVA**.

## Qué se construyó

| Versión | Qué |
|---|---|
| v2.355.0 | `sales_invoices.retencion`; el sync la guarda y **compara** subtotal/iva/retención; backfill de 44 documentos |
| v2.357.0 | Sección «IVA que nos retuvieron» en Libros IVA, separada del anexo del Art. 162 |
| v2.358.0 | El DTE se abre desde el libro: detalle, PDF y ZIP, como en Facturas de Compra |
| v2.360.3 | Tipo CCF/COF, sucursal y nombre completo del cliente |
| v2.361.2 | El IVA retenido entra al **paquete del mes** |
| v2.365.0 | El cuadre diario **diagnostica la causa** de una diferencia y el Corte Z la muestra |
| v2.365.2 | El cuadre cubre también los **CCF** |

**La corrección de fondo, y la que más importa:** junto con la retención, el
origen empezó a mandar la base gravada y el débito **reales**. Antes repartía el
total NETO entre los dos, así que el portal publicaba en el libro de
contribuyentes una base y un débito **por debajo**. Cuadraba el total —que es la
columna que uno mira— y por eso nadie lo vio. Comparadas las 19 columnas del
archivo de julio de Salud 3, ahora coinciden 17 de 19 (antes 16).

## Las tres decisiones — resueltas

### 1. ¿La retención va en el archivo del libro? → **NO. Cerrado.**

El **Art. 85 RCT** enumera las doce columnas del libro de contribuyentes, y
entre ellas está «**impuesto percibido**» (literal k) — **pero no existe una de
impuesto retenido**. Tampoco en el **Art. 83**, el de consumidor: fecha, del/al,
exentas, gravadas, exportaciones, total del día, terceros.

No era «no supimos en cuál columna». **No hay columna.** La retención va en la
declaración, respaldada por los comprobantes de retención.

Por eso viaja como **CSV aparte en el paquete del mes**
(`iva-retenido-sobre-ventas/<Sucursal>.csv`), que es papel de trabajo para
declarar, con la identidad completa de cada documento y dos filas de cierre:

```
TOTALES                      4427.08  44.27  4958.34
ACREDITABLE (SIN ANULADOS)   4292.57  42.92
```

### 2. ¿El libro lleva el monto cobrado o el valor de la venta? → **ABIERTO**

Es la única que queda, y ahora la pregunta es concreta.

La retención es «en concepto de **anticipo del impuesto**» (Art. 162): se retiene
del **pago**, no de la **venta**. Y el literal l) del Art. 85 pide el «**total de
ventas por documento**», que es la suma de las columnas anteriores —exentas +
gravadas + débito + terceros + percibido—. **La retención no está entre ellas,
así que no se resta.**

El propio DTE distingue los dos valores:

```
montoTotalOperacion: 406.56   ← el valor de la venta
totalPagar:          402.96   ← lo que el cliente pagó
```

**El libro pide el primero. Hoy va el segundo — y el archivo del origen también.
Los dos igual.**

| Mes | CCF | Consumidor | Total |
|---|---|---|---|
| Junio 2026 | $3.82 | $2.21 | **$6.03** |
| Julio 2026 | $3.60 | $39.32 | **$42.92** |
| | | | **$48.95** |

**No se cambió**: mueve números ya declarados y es lectura del contador. Si la
confirma, el cambio es de una línea por libro y queda cuadrando contra el
`montoTotalOperacion` del DTE, que es la fuente que nadie discute.

### 3. Ventas anuladas que nunca se invalidaron ante Hacienda → **Cerrado**

Seis documentos con sello de Hacienda, marcados como anulados en el sistema pero
**ausentes del anexo de anulados** (verificado con ventana de dos meses): para
Hacienda siguen vigentes. El origen los cuenta en su libro; el portal los
excluye porque filtra por FINALIZADA.

**Decisión del usuario (2026-08-04):**

- **Período activo — sin urgencia, quedan a la vista.** Salud 5 `342802` y
  Salud 4 `342407` del 01/08/2026, Salud 1 `343519` del 02/08/2026 · $82.05.
- **Anteriores — se dan por cerradas**, ya no hay forma de corregirlas y
  quedaron solventadas en el sistema de origen. Salud 2 `90369` y `90584` de
  agosto 2025, Salud 1 `228505` de febrero 2026 · $17.75. Además caen fuera del
  alcance del cuadre, que solo mira el mes en curso y el anterior.

## Lo que quedó verificado y antes no se sabía

- **44,239 documentos** cotejados contra el origen en junio y julio, las 7
  sucursales: **una sola diferencia** — la venta que el origen perdió en Salud 1
  (auditoría aparte en `HALLAZGO-VENTA-PERDIDA-SALUD1-2026-07-14.md`). La huella
  de ids coincide en 11 de 12 sucursal-mes.
- **Los créditos fiscales cuadran en todo el período contable.** Nunca se había
  medido: el cuadre solo miraba consumidor hasta v2.365.2.
- **Cero documentos sin sello de más de tres días** dentro del período contable.
- Los DTE de los 10 documentos con retención desde junio coinciden con lo
  guardado en las cuatro cifras.

## Anotado, sin acción

- **10 documentos de 2025** cuyo DTE sellado dice `ivaRete1: 0` mientras el
  registro interno tiene retención ($42.67). Todos CCF de BANCO PROMERICA entre
  mayo y agosto de 2025 — **ninguno cae en el período contable**, donde los 10
  documentos cuadran con su DTE en las cuatro cifras.
- 2 documentos de agosto de 2025 sin sello ($38.00).
- El «Solventar» de Facturación tiene 2 resoluciones, la última de mayo: las
  anulaciones de arriba se solventaron en el sistema de origen, no acá. Si algún
  día conviene que el portal recuerde esa decisión y deje de mostrarlas, es
  media hora de trabajo.
