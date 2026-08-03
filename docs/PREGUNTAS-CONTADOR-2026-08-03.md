# Preguntas para el contador — estado al 2026-08-03

Cada pregunta lleva el número medido, no una impresión. Los montos salen de la
base al 2026-08-03 y se pueden reproducir con las consultas del final.

---

## A. Cosas que cambian lo que se declara

### A1. Notas de crédito de compras — el libro NO las resta (Art. 62)

Los proveedores mandan notas de crédito por correo y **nunca se capturan** en el
sistema de origen, así que el libro de compras no las descuenta.

| Mes | Notas de crédito | Notas de débito | **Ajuste neto al crédito fiscal** |
|---|---|---|---|
| Mayo 2026 | 2 | 0 | **−$9.53** |
| Junio 2026 | 58 | 1 | **−$986.70** |
| Julio 2026 | 75 | 3 | **−$1,677.61** |

**Preguntas:**
1. ¿Ese ajuste lo viene aplicando a mano al declarar, o el libro que le pasamos
   se presentó sin descontarlo?
2. ¿Quiere que el libro del portal las reste, o prefiere el libro «crudo» y el
   ajuste aparte? (Hoy están en su propia sección, con el total, sin restar.)
3. Las notas nacen en el correo y no se registran en ningún lado. ¿De quién
   debería ser la tarea de capturarlas?

### A2. Crédito fiscal recibido y nunca registrado como compra

Documentos de proveedor (CCF) que llegaron por correo y **no existen como compra**
en el sistema, así que su crédito fiscal no entra al libro del Art. 86:

| Mes | Documentos | Crédito fiscal fuera del libro |
|---|---|---|
| Mayo 2026 | 10 | $26.70 |
| Junio 2026 | 199 | **$2,628.11** |
| Julio 2026 | 253 | **$3,610.64** |

La Ley de IVA da **tres períodos** para reclamarlo.

**Preguntas:**
1. ¿Se reclama ese crédito o se da por perdido?
2. Si se reclama, ¿en qué período lo quiere y quién registra las compras?
3. ¿Hay algún motivo por el que esos documentos NO deban entrar? (Puede haber
   compras personales, muestras, o documentos que no corresponden.)

### A3. Una venta con sello de Hacienda que el sistema de origen no reporta

**Salud 1, 14/07/2026, 08:10:17, $9.00.** Estado FINALIZADA, con sello de
Hacienda de 40 caracteres, y su número interno cae **dentro del rango que el
propio sistema declara ese día**. Aun así no aparece ni en su libro de ventas ni
en su Corte Z: el sistema dice $1,921.40 ese día y el portal $1,930.40.

**Preguntas:**
1. ¿Qué se declaró en julio: el número del sistema o el del portal?
2. Si fue el del sistema, esa venta **no se declaró**. ¿Cómo se corrige?
3. ¿Le preocupa el mecanismo? Son $9.00, pero el defecto no tiene tamaño — puede
   volver a pasar con cualquier monto.

### A4. Retención de Renta (Art. 156) — LA DECISIÓN QUE QUEDÓ PENDIENTE

**Esta es la que estaba esperando su confirmación**, y sigue sin resolverse.

El Art. 156 CT obliga a retener el **10% sobre servicios prestados por personas
naturales**. No tiene modo automático como la percepción: **nada en el documento
dice si lo que se pagó fue un servicio o mercadería**, así que el portal no puede
decidirlo — hay que marcar proveedor por proveedor.

**Hoy hay CERO proveedores marcados.** De 102 con compras entre mayo y julio
2026, **16 tienen forma de persona natural**, por **$8,022.66**. Si todos fueran
servicio, la retención sería **~$710**.

| Proveedor | Documentos | Monto | Retención 10% |
|---|---|---|---|
| ANA FRANCISCA CEDILLOS | 8 | $3,951.64 | $349.70 |
| OMAR ARNULFO SERRANO CRESPIN | 2 | $2,938.00 | $260.00 |
| HENRY EDGARDO LARREYNAGA MATAMOROS | 2 | $289.00 | $25.58 |
| CARMEN ELENA GUARDADO RAMIREZ | 2 | $199.50 | $17.65 |
| BRAULIO ERASMO MENA RIVERA | 2 | $159.98 | $14.16 |
| MARVIN EDMUNDO ESCOBAR ROMERO | 3 | $126.50 | $11.19 |
| ZONIA MARIBEL MARTINEZ NUÑEZ | 3 | $85.04 | $7.53 |
| GLENDA ELIZABETH CARTAGENA PALMA | 2 | $53.80 | $4.76 |
| HAROLD FRANCISCO GONZÁLEZ MEJIA | 1 | $47.40 | $4.19 |
| Alexander Benjamin Vasquez Landaverde | 1 | $43.90 | $3.88 |
| JOSE ELIAS ESCOBAR ROMERO | 1 | $35.01 | $3.10 |
| MARIA SUCIBEL HERNANDEZ DE ALAS | 1 | $26.42 | $2.34 |
| ALAS DERAS, ALVARO ALEXANDER | 2 | $24.95 | $2.21 |
| LEMUS DE ALVARENGA, DIGNA AMERICA | 4 | $22.80 | $2.02 |
| JULIO ROBERTO ROMERO MENDOZA | 2 | $11.00 | $0.97 |
| ANDA (Acueductos y Alcantarillados) | 2 | $7.72 | $0.68 |

La lista sale de una heurística —NIT de 9 dígitos, DUI cargado, o nombre sin
forma societaria—, así que **ANDA está de más** y puede haber otros. Es
justamente el filtro que él tiene que revisar.

**Por qué urge:** si correspondía retener y no se retuvo, **la empresa responde
solidariamente por el impuesto no retenido**. Los dos primeros concentran el 86%
del monto.

**Preguntas:**
1. ¿Cuáles de estos 16 son **servicios** y cuáles mercadería?
2. Los dos grandes —ANA FRANCISCA CEDILLOS ($3,951.64) y OMAR ARNULFO SERRANO
   ($2,938.00)—: ¿qué nos venden?
3. ¿Se venía reteniendo por fuera del sistema? Si sí, ¿dónde está el registro?
4. Si no se retuvo y correspondía, ¿cómo se regulariza?

Una vez marcados, el portal arma el anexo solo: la pantalla ya existe (Libros IVA
→ Renta) y hoy sale vacía porque no hay ninguno marcado.

---

## B. Retención de IVA sobre nuestras ventas

El Corte Z de **Salud 3** declara retención: **$6.03 en junio** y **$42.92 en
julio** (y por eso su total es menor que el del libro; descontada, cuadra al
centavo). Pero el **anexo de retención del Art. 162 sale vacío del sistema de
origen en toda la historia**, y el portal **no tiene dónde guardar** esa
retención: la columna no existe y el sync no la trae.

**Preguntas:**
1. ¿Nos están reteniendo IVA en Salud 3? ¿Quién — un gran contribuyente?
2. ¿Tiene los **comprobantes de retención** de esos meses?
3. ¿Esa retención debería aparecer en el anexo del Art. 162? Porque hoy el anexo
   sale vacío y el Corte Z dice que sí hubo.
4. ¿La necesita en el portal, o alcanza con el Corte Z?

---

## C. Qué documento se presenta

Hoy existen **tres** fuentes que no dicen lo mismo, y las diferencias ya están
identificadas y explicadas:

| | Qué es |
|---|---|
| Libros de IVA del portal | Derivados de las facturas con sello de Hacienda |
| Libros del sistema de origen | Lo que él viene usando |
| Corte Z | El resumen mensual que emite cada sucursal |

**Preguntas:**
1. ¿Cuál de los tres presenta hoy?
2. ¿Quiere que el portal reemplace al del sistema, o que solo sirva para
   cotejar?
3. ¿El Corte Z hay que presentarlo o es de uso interno?

---

## D. Datos que faltan y solo él puede decidir

### D1. Compras sin NRC del proveedor (Art. 86 lo exige)

| Mes | Compras | Monto |
|---|---|---|
| Mayo 2026 | 1 | $47.59 |
| Junio 2026 | 2 | $75.12 |
| Julio 2026 | 1 (PEPSI) | $28.00 |

Son pocas y de monto chico, pero salen en el libro con la casilla vacía.

**Pregunta:** ¿se consiguen los documentos para completar el NRC, o se presentan
así?

### D2. El sello de recepción del proveedor en el libro de compras

El sello **sí está** en el reporte del origen y ya lo guardamos: Bodega al 97-99%
en junio/julio/agosto. Pero en **La Popular, Salud 1, Salud 2 y Salud 4 el origen
manda esa columna vacía** — ahí no hay nada que traer.

**Pregunta:** ¿necesita esa columna en el libro que presenta? Hoy no la emitimos
justamente porque saldría llena en unas sucursales y vacía en otras.

### D3. Meses viejos incompletos

De **mayo 2025 a mayo 2026** el libro de compras no tiene las cuatro columnas
fiscales. Junio y julio 2026 están completos y verificados.

**Pregunta:** ¿necesita esos meses completos, o con junio en adelante alcanza?

---

## E. Alcance — la pregunta de fondo

El portal hoy produce **documentos y libros de IVA**. No hace contabilidad
formal: no hay partida doble, ni catálogo de cuentas, ni estados financieros. Y
**el costo por línea vendida no está y no se puede reconstruir** hacia atrás, así
que el costo de ventas no sale del portal.

**Preguntas:**
1. ¿Qué le entrega hoy la empresa y en qué formato?
2. ¿Qué de eso le gustaría recibir del portal, ya armado?
3. ¿El costo de ventas lo calcula él por fuera? ¿Con qué dato?
4. ¿Hay algún reporte que hoy arma a mano y que podríamos generar?

---

## Nota operativa (no es pregunta para él)

Al 2026-08-03 hay **100 ventas de agosto sin sello de Hacienda** ($1,364.86),
todas con el sello en NULL —o sea pendientes, no rotas—, repartidas entre el 1 y
el 3 de agosto. Es el mes en curso y puede ser normal, pero conviene mirar que se
sellen antes de cerrar el período.

---

## Cómo reproducir estos números

- **A1** — `purchase_dte_documents` con `tipo_dte in ('05','06')` agrupado por mes.
- **A2** — `purchase_dte_documents` tipo 03 sin `purchase_receipts` que le
  corresponda por código de generación.
- **A3** — `sales_invoices` de Salud 1 el 2026-07-14 contra el reporte diario del
  origen (`libro_ventas_consumidor_csv.php`).
- **B** — `corte_z.detalle->'secciones'->…->'retencion'`.
- **D1** — `purchase_receipts` sin NRC en `proveedores_maestro`.
