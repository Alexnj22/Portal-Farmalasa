# Plan — convertir el portal en contador interno

Fecha: 2026-08-12. Nace de `AUDITORIA-CONTABLE-COMPLETA-2026-08-12.md`, que midió
qué hay y qué falta. Esto es el cómo.

**La idea de fondo, y es lo que hace posible el resto:** el criterio contable no
se aplica documento por documento, se aplica **una vez por proveedor** y el
sistema lo replica para siempre. Medido: **1,291 CCF desde junio, de 99
proveedores distintos.** Son 99 decisiones que cubren 1,291 documentos y todos
los que vengan después.

---

## Paso 1 — La clasificación fiscal del proveedor · **LISTO, falta aplicar**

### Qué problema resuelve

Dos, con el mismo dato:

1. **La deducibilidad del Art. 65 LIVA.** No todo CCF da crédito fiscal: la
   compra tiene que caer en una de las cuatro categorías del artículo y ser
   indispensable para el giro.
2. **Las cuatro columnas de Renta del anexo de compras.** Hoy salen fijas en
   `1;1;2;5` (gravada, costo, comercio, costo de artículos comprados) en **todas**
   las filas. Es correcto para la mercadería y **falso para el teléfono, el banco
   y el alquiler**, que son *gasto*, no costo.

### La propuesta no la escribí yo: sale del CIIU

`proveedores_maestro.cod_actividad` está poblado en **los 104 proveedores con
documentos** (41 códigos distintos). La clasificación se deriva de ahí, con el
artículo que la respalda en cada regla — no es una lista escrita a mano, que es
justamente lo que `CLAUDE.md` prohíbe para un catálogo que ya existe como tabla.

| regla | códigos CIIU | propuesta | base legal |
|---|---|---|---|
| Mercadería | 46484, 46491, 46482, 46595, 46900, 47739, 47190, 21001 | deducible · costo · comercio · tipo 5 | **Art. 65 nº1** — activo realizable |
| Teléfono | 61101, 61201, 61900 | deducible · gasto · servicios · tipo 2 | **Art. 65 nº4** — la ley nombra «teléfono» |
| Energía eléctrica | 35103 | ídem | **Art. 65 nº4** — nombra «energía eléctrica» |
| Agua (suministro público) | 36000 | ídem | **Art. 65 nº4** — nombra «agua» |
| Servicios financieros | 64190, 64199, 66190 | deducible · gasto · servicios · tipo 3 | **Art. 65 nº3** |
| Alquiler del local | 68109, 68200 | deducible · gasto · servicios · tipo 1 | **Art. 65 nº3** |
| Otros servicios del giro | 01612 (fumigación), 62090 (TI) | deducible · gasto · servicios · tipo 2 | **Art. 65 nº3** |

### Lo que la ley excluye o condiciona **queda pendiente, con el motivo escrito**

Esto es lo importante del diseño: el sistema **no propone como deducible** nada
que la ley condicione. Lo deja en `pendiente` con el artículo y la razón, para
que el contador decida sabiendo qué está decidiendo.

| códigos | motivo |
|---|---|
| 47300, 45301, 45402 (combustible y repuestos) | **Art. 65-A c)** — sólo si el vehículo es *estrictamente indispensable* para el giro |
| 47522, 46632, 47523, 23990 (ferretería, pinturas) | **Art. 65 nº3** *excluye expresamente* construcción, remodelación o modificación de inmuebles |
| 46301, 46375, 10799, 47223, 47224, 56101, 47111, 11042 (alimentos, bebidas, agua envasada) | **Art. 65-A a)** — no deducible si el giro no es la venta de víveres; deducible sólo si se revenden |
| 47411 (computadoras) | **Art. 65 nº2** — activo fijo, sólo si conserva su individualidad |
| 96092, 86100, 60299 | el CIIU es demasiado genérico para derivarlo |

> **Corrección a lo que se dijo en la conversación.** ENVASADORA AGUA FRIA
> (código 11042, *fabricación y envasado de agua*) se había puesto como «Art. 65
> nº4 — agua, literal». **Es falso.** El «agua» del numeral 4 es el suministro
> público —ANDA, código 36000—, no el agua embotellada, que es mercadería o
> víveres según se revenda o no. Quedó en pendiente con el Art. 65-A a).

### Resultado, medido con la migración corrida y revertida

| estado | proveedores | deducibles | con motivo escrito |
|---|---|---|---|
| `propuesta` | **67** | 67 | — |
| `pendiente` | **95** | 0 | **36** |

Los 95 pendientes son los 36 que la ley condiciona más **58 fichas sin código de
actividad** (proveedores que llegan del sistema de origen y nunca recibieron un
DTE por correo, así que no tienen actividad registrada) y una sin ficha.

### El diseño, y por qué así

- **`iva_deducible` nace NULL y `clasificacion_estado` nace `'pendiente'`.** Un
  proveedor sin clasificar **no entra al libro** ni como deducible ni como no
  deducible: entra a la lista de pendientes, visible. Es la regla del `? :` que
  convierte «no encontré» en un default silencioso.
- **Tres estados: `pendiente` → `propuesta` → `confirmada`.** El libro sólo usa
  `confirmada`. Que el sistema proponga no es que el sistema decida.
- **La matriz del manual del F-07 (p. 21) la hace cumplir un CHECK**: con
  *Costo* sólo se admiten los tipos 4-7 y con *Gasto* sólo 1-3. Antes vivía en
  prosa, y una regla que sólo vive en prosa se rompe.
- **Un CHECK impide confirmar sin decidir**: `estado = 'confirmada'` exige
  `iva_deducible IS NOT NULL`.
- La siembra **sólo toca filas en `pendiente`**, así que volver a correrla nunca
  pisa una confirmación.

### Lo que atrapó la prueba de ROLLBACK

`clasificado_por` se escribió `bigint` y `employees.id` es **uuid**. La
migración entera falla al crear la FK. Lo agarró correr todo dentro de una
transacción antes de aplicar — no una lectura del código.

### Cómo se aplica

El flujo canónico es `apply_migration` por MCP, que **no está disponible en esta
sesión**. El equivalente —aplicar y registrar la versión en
`supabase_migrations.schema_migrations`— quedó en un script del scratchpad:

```
! bash /private/tmp/claude-501/-Users-alexnunez-Documents-Portal-Farmalasa/29331c72-4c42-4510-8112-a7f0664a8670/scratchpad/aplicar.sh
```

Versión asignada: **20260813041109** · nombre `clasificacion_fiscal_del_proveedor`.
**Después de aplicar** hay que copiar el SQL a
`supabase/migrations/20260813041109_clasificacion_fiscal_del_proveedor.sql` y
correr `npm run gate:migrations` y `-- --remote`.

---

## Paso 2 — El libro de compras unificado

**Qué cambia:** hoy `get_libro_compras` lee sólo `purchase_receipts` (lo que
registra el sistema de origen). Pasa a leer la **unión** de esa tabla con
`purchase_dte_documents` (los DTE que llegan por correo), deduplicada.

**La clave del cruce es el código de generación, no el sello.** Medido en julio:
el sello sólo está en el 31% de los documentos del correo, y en el portal hay
sellos repetidos entre proveedores distintos. El código de generación aparea
limpio —407 documentos en julio, 295 en junio— aun estando truncado a 20
caracteres por el origen: bastan los primeros 16 hexadecimales.

**Lo que suma:** en julio, 265 CCF y 3 notas de débito que el origen no registra
(+$6,096.95 de crédito fiscal) y 75 notas de crédito que hoy no se restan
(−$1,745.73). Neto **+$4,351.22**. En junio, **+$1,575.71**.

**Reglas que hay que respetar:**

- Sólo entran los proveedores con `clasificacion_estado = 'confirmada'` e
  `iva_deducible = true`. El resto va a una sección de **pendientes con su
  monto**, visible en pantalla — nunca descartados en silencio.
- Las notas de crédito **restan** y las de débito **suman** (Art. 62 LIVA), en el
  período en que se reciben.
- Los tipos `01` (factura) y `09` (documento contable de liquidación) **no dan
  crédito fiscal**: entran al libro como compra sin crédito, no se omiten.
- Art. 63 LIVA: se admiten documentos de hasta **3 períodos anteriores**.
  Verificado que hoy no hay ninguno fuera de plazo.

---

## Paso 3 — Cierre de período

Sin esto la declaración de agosto ya nace mal: julio cerró con remanente a favor
y **nadie lo está arrastrando** (Art. 67 LIVA).

Una tabla por período con lo declarado congelado —débito, crédito, percepción,
retención, remanente que entra y remanente que sale— y el mes siguiente arranca
del remanente del anterior.

Y resuelve un segundo problema que ya pasó dos veces: **el libro cambia después
de declarado y nadie se entera.** Los sellos que llegaron el 2026-08-02 subieron
el débito de mayo $27.23 y el de junio $5.29, después de presentadas. Con el
período congelado, esa diferencia se ve.

---

## Paso 4 — El registro de control de inventarios (Art. 142-A CT)

Es requisito de deducibilidad del propio Art. 65: para bienes muebles corporales,
la compra tiene que estar asentada en este registro, con referencia al documento
legal. O sea que **sin kardex, el crédito fiscal de la mercadería es objetable**.

El Art. 142-A lista sus campos mínimos. Contra lo que el portal ya tiene:

| pide el artículo | estado |
|---|---|
| fecha, número de documento, proveedor | ✅ `purchase_receipt_items` |
| descripción individualizada | ✅ con lote y vencimiento |
| nacionalidad del proveedor | ✅ `proveedores_maestro.pais` (102 de 162) |
| unidades que entran e importe | ✅ 39,963 líneas con costo |
| unidades que salen | ✅ 593,895 líneas |
| **importe de las que salen** | ⚠️ **sólo desde el 2026-08-05** |
| saldo en unidades | ⚠️ hay existencia actual, no saldo histórico |
| encabezado del registro y correlativo | ❌ |

**El portal tiene cerca del 80% del kardex legal.** Lo que falta es un correlativo,
el encabezado, el saldo corrido y el costo de salida.

**Con reloj:** las 6,436 líneas del 1 al 4 de agosto todavía se pueden rellenar
—el precio existe en `product_precios` para 7,856 de ellas— con cuatro días de
deriva. Cada día que pasa, la aproximación empeora.

---

## Paso 5 — Planilla y gastos operativos

`payroll_entries`, `payroll_periods` y `branch_expenses` están en **cero filas**.
Son **$7,012.65 de la cuota de junio, el 57%**. No falta un cálculo: falta el dato.

Y una tabla vacía es peor que no tenerla: un reporte que la consulte devuelve
cero, y cero se lee como «no hubo gastos», no como «nadie lo cargó».

---

## Paso 6 — Contabilidad formal

Catálogo de cuentas → Libro Diario → Libro Mayor → Estados Financieros. Es lo que
pide el **Art. 435 del Código de Comercio**, y hoy no existe **ni una tabla**.

**No arranca sin los pasos 4 y 5**: sin costo de venta y sin planilla no hay
Estado de Resultados que emitir.

Y una exigencia del **Art. 139 CT** que cambia cómo se programa desde el primer
día: *«no podrá modificarse un asiento o un registro de manera que no sea
determinable su contenido primitivo»*. **Un asiento no se edita, se corrige con
otro asiento.** Es lo contrario de un `UPDATE`, y hay que diseñarlo así desde el
principio o se rehace entero.

El mismo artículo fija el otro requisito estructural: **el atraso máximo es de
dos meses.** Un módulo contable que se llena «cuando se puede» incumple por
diseño.

---

## Lo que hay que preguntarle a la contadora

Ninguna de estas es de sistema; las cinco cambian el resultado.

1. **Las 36 fichas condicionadas por la ley** (combustible, ferretería,
   alimentos, cómputo): ¿cuáles aplican? Es la única entrada humana del paso 1.
2. **Junio se pagó $1,077.16 que no correspondía** y julio arrastra remanente.
   ¿Se presentan modificatorias? El Art. 104 CT las condiciona: 2 años,
   verificación de auditores, y no surten efecto hasta que Hacienda se pronuncie.
3. **La percepción anterior a junio-2026** (~$12,000 estimados) — mismo camino.
4. **La base del pago a cuenta**: declaró $3,991.48 en junio y el 1.75% de las
   ventas da $3,484.93. Las dos fuentes del portal coinciden, así que los $506.55
   son otro componente de esa línea. Hace falta su papel de trabajo.
5. **¿Se están presentando el F-983 y el F-987?** La empresa cruza el umbral de
   los Arts. 125 y 142 CT con holgura.
