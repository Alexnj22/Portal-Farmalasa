# Qué cubre el portal en materia contable, y qué no

Fecha: 2026-08-01. Escrito para responder una pregunta concreta: *«¿el portal ya
tiene toda la información contable, si tenemos compras en Facturas de Compra y
ventas en la información de ventas?»*

La respuesta es **no**, y el motivo no es que falten datos: es que **documentos,
libros fiscales y contabilidad son tres cosas distintas**. El portal cubre la
primera, ahora cubre la segunda, y no toca la tercera.

---

## 1. Los tres niveles

```
NIVEL 1 — DOCUMENTOS            NIVEL 2 — LIBROS FISCALES      NIVEL 3 — CONTABILIDAD
la materia prima                 el resumen para el impuesto     el patrimonio completo

DTE emitidos y recibidos    →    Libros de IVA             →     Libro Diario
inventario, planilla             (ventas, compras, anexos)       Libro Mayor
                                                                 Estados Financieros

Art. 114-119 CT                  Art. 141 CT                     Art. 435 C.Com · Art. 139 CT
✅ el portal lo tiene            ✅ el portal lo hace            ❌ el portal NO lo hace
```

**El error natural es pensar que el nivel 3 sale solo del nivel 1.** No sale: un
documento dice *cuánto se vendió*; la contabilidad tiene que decir además *contra
qué* — si entró efectivo o quedó una cuenta por cobrar, cuánto costó lo que se
vendió, y cómo quedó el inventario después.

### La misma venta, en los tres niveles

Una venta de $113 (IVA incluido) de mercadería que costó $70:

| Nivel | Qué registra |
|---|---|
| **Documento** | DTE tipo 01, total $113 |
| **Libro de IVA** | ventas gravadas $100 · débito fiscal $13 |
| **Contabilidad** | Caja $113 ⟋ Ventas $100 · IVA débito $13 **y además** Costo de venta $70 ⟋ Inventario $70 |

Las dos últimas líneas son las que el portal **no puede producir hoy**, y son las
que determinan si el negocio gana o pierde. El libro de IVA nunca lo dice: no
está hecho para eso.

---

## 2. La ley, y en qué orden aplica

**Código de Comercio, Art. 435** — la obligación de fondo:

> El comerciante está obligado a llevar contabilidad debidamente organizada […]
> El comerciante debe llevar los siguientes registros contables: **Estados
> Financieros, Diario y Mayor**, y los demás que sean necesarios por exigencias
> contables o por Ley.

**Art. 437** — quién puede llevarla: con activo en giro **≥ $12,000**, la
contabilidad debe llevarla un contador titulado o empresa autorizada. Una cadena
de 7 farmacias está muy por encima de ese umbral.

**Art. 438** — los libros deben estar **foliados y autorizados** por un Contador
Público Autorizado; si es sociedad, por el **auditor externo**. Un sistema que
genera reportes no reemplaza esa legalización.

**Art. 439** — las operaciones se asientan **diariamente** y en orden
cronológico, sin borrones ni alteraciones.

**Código Tributario, Art. 139** — la versión fiscal, que *remite* al Código de
Comercio:

> Se entiende por contabilidad formal la que […] es llevada en libros
> **autorizados en legal forma**. Están obligados a llevar contabilidad formal
> los sujetos pasivos que de conformidad a lo establecido en el **Código de
> Comercio** […] están obligados a ello.
>
> Las operaciones serán asentadas a medida que se vayan efectuando, y **sólo
> podrá permitirse un atraso de dos meses** para efectos tributarios.
>
> No podrá modificarse un asiento o un registro de manera que no sea
> determinable su contenido primitivo.

Dos consecuencias prácticas para cualquier sistema que quiera hacer esto:

1. **El atraso máximo es de dos meses.** Un módulo contable que se llena "cuando
   se puede" incumple por diseño.
2. **Los asientos no se editan, se corrigen con otro asiento.** Es lo contrario
   a un `UPDATE`: en contabilidad, un error se arregla con una partida de ajuste
   que deja rastro de las dos.

**Art. 141 CT** — los libros de IVA (lo que el portal ya produce) son una
obligación **distinta y adicional** a la contabilidad. Cumplir con los libros de
IVA no cumple con el Art. 435.

---

## 3. Los documentos, separados por tipo

Catálogo de DTE (Ministerio de Hacienda) y qué mueve cada uno.

### Que la farmacia EMITE

| Código | Documento | Volumen | Efecto contable |
|---|---|---|---|
| **01** | Factura (consumidor final) | 338,904 | Ingreso + débito fiscal |
| **03** | Comprobante de Crédito Fiscal | 604 | Ingreso + débito fiscal, a contribuyente |
| 05 | Nota de Crédito | **0** | *(reduciría ingreso y débito)* |
| 06 | Nota de Débito | **0** | *(aumentaría ingreso y débito)* |
| 11 | Factura de Exportación | **0** | — |
| 14 | Factura de Sujeto Excluido | **0** | — |

*(Hay 1 documento con tipo `UNKNOWN`, del 2025-11-07.)*

### Que la farmacia RECIBE de proveedores

| Código | Documento | Volumen | Efecto contable |
|---|---|---|---|
| **03** | Comprobante de Crédito Fiscal | 1,172 | Compra + **crédito fiscal** |
| **09** | Documento Contable de Liquidación | 180 | Liquidación de operaciones |
| **05** | Nota de Crédito | 135 | **Reduce** el crédito fiscal |
| **01** | Factura | 19 | Gasto **sin** crédito fiscal |
| **06** | Nota de Débito | 4 | **Aumenta** el crédito fiscal |
| **07** | Comprobante de Retención | 1 | Retención de IVA |

**Las 05 y 06 son el hallazgo abierto**: ajustan crédito fiscal por **$2,673.84
netos** y hoy no entran a ningún libro. El **Art. 62 de la Ley de IVA** obliga a
hacer ese ajuste en el período en que se reciben. Ver
`docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md` §4.2.

---

## 4. Qué hay en la base, verificado

### Sirve como soporte contable

| Dato | Tabla | Estado |
|---|---|---|
| Ventas (cabecera) | `sales_invoices` | ✅ 339,509 documentos |
| Ventas (detalle) | `sales_invoice_items` | ✅ con precio, **sin costo** |
| Compras (cabecera) | `purchase_receipts` | ✅ 5,127 documentos |
| Compras (detalle) | `purchase_receipt_items` | ✅ 39,501 líneas **con costo** |
| DTE de compra | `purchase_dte_documents` | ✅ 1,511, con JSON y PDF |
| Inventario | `inventory`, `conteos_inventario` | ✅ existencias y conteos físicos |
| Clientes / proveedores | `customers`, `proveedores_maestro` | ✅ con NRC y NIT |

### Existe la tabla pero está VACÍA

| Dato | Tabla | Filas |
|---|---|---|
| Gastos operativos | `branch_expenses` | **0** |
| Planilla | `payroll_entries`, `payroll_periods` | **0** |

Que la tabla exista y esté vacía es peor que no tenerla: un reporte que la
consulte va a devolver cero y **cero se lee como "no hubo gastos"**, no como
"nadie lo cargó".

### No existe

| Falta | Para qué hace falta |
|---|---|
| **Costo por línea vendida** | sin esto **no hay costo de ventas ni margen real** |
| Catálogo de cuentas | la base de cualquier asiento |
| Libro Diario / partidas | Art. 435 C.Com |
| Libro Mayor | Art. 435 C.Com |
| Estados Financieros | Art. 435 C.Com y Art. 441 (balance anual) |
| Caja y arqueos | conciliar lo vendido contra lo cobrado |
| Bancos y conciliación | — |
| Cuentas por cobrar | ventas al crédito |
| Cuentas por pagar | deuda con proveedores |
| Activo fijo y depreciación | — |

**El costo de ventas es el hueco más caro.** `sales_invoice_items` guarda
`precio_unitario` pero ningún costo, y `product_precios` sólo tiene el costo
**actual** — no el que tenía el producto el día que se vendió. Sin eso, el
margen real de un período no se puede calcular hacia atrás, ni siquiera con los
datos completos: el dato se perdió en el momento de la venta.

---

## 5. Qué significa esto en la práctica

**El portal es un excelente sistema de información y el soporte documental de la
contabilidad — no es el sistema contable.** Hoy alguien tiene que tomar estos
datos y armar la contabilidad formal aparte, en libros legalizados.

Tres caminos posibles, de menor a mayor:

1. **Dejarlo como está.** El portal produce los libros de IVA (que es una
   obligación real y ya se cumple) y sirve de respaldo documental. La
   contabilidad formal la lleva el contador con su propio sistema. **Es lo que
   pasa hoy y es perfectamente válido.**
2. **Cerrar los huecos de datos** sin construir contabilidad: capturar el costo
   por línea vendida, cargar gastos y planilla, registrar caja y bancos. Con eso
   el portal podría mostrar **margen real** y un flujo de caja — información de
   gestión, no contabilidad legal.
3. **Construir el módulo contable**: catálogo de cuentas, partidas, mayor y
   estados financieros. Es un módulo grande y con requisitos que el resto del
   portal no tiene (asientos inmutables, cierre de períodos, legalización de
   libros por un CPA).

**La recomendación, como criterio:** el paso 2 antes que el 3. El costo de ventas
da valor de negocio inmediato y además es un requisito previo del paso 3 — sin él
un módulo contable no podría emitir un Estado de Resultados. Y el paso 1 no
bloquea nada mientras tanto.

**Lo urgente no es ninguno de los tres**, sino capturar las notas de crédito de
compras: eso es plata mal declarada hoy, todos los meses.
