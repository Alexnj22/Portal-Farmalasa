# Cargar compras desde el portal, en Bodega, con reparto a las salas — auditoría (2026-10-29)

Pedido del usuario: «las facturas de bebidas (pepsi, constancia, sarita,
nevería, agua, etc.) se carguen en bodega, pero en la carga se seleccione a qué
sucursal pertenece, así el traslado se hace de un solo… que se pueda splitear…
poder ya cargar las compras desde el portal, para tener mayor control».

Retoma `docs/AUDITORIA-MATCH-DTE-PRODUCTOS-2026-08-16.md` (partes 2, 9, 10 y 12)
y PENDIENTES 8. Todo lo de abajo se midió sin escribir en el sistema de la caja.

## 1. Lo que ya existe

| pieza | estado |
|---|---|
| Compras → Cargar compra (`leer-dte-json` modo `propuesta`) | arma encabezado, renglones, lote y vencimiento desde el DTE. **No escribe en el sistema de la caja.** |
| Diccionario `compra_producto_alias` | 93 llaves confirmadas de 20 proveedores |
| «Por confirmar» (`compra_renglon_pendiente`) | barrido ya corrido: 1,199 documentos leídos, 3,016 llaves pendientes |
| Traslado Bodega → sala en el sistema (`trasladar-pedido-erp`, `_shared/erp-traslado.ts`) | en producción: simulacro por omisión, background, rastro en tabla, reparto por lote |
| Recibir en la sala (`aplicar-traslado-inventario` acción `recibir`) | en producción |
| Facturas de Sala | desde v2.1371.0 sólo Bodega |

Lo que falta es exactamente el eslabón del medio: **el `insert` a `compras.php`**
y **el reparto** que alimenta al traslado.

## 2. Hallazgos medidos hoy

**Cómo se cargan hoy las bebidas (60 días, `purchase_receipts`)**: en las salas,
no en Bodega — La Constancia en Salud 3, La Popular y Salud 1; Nevería en La
Popular y Salud 1; Sarita en Salud 3 y Salud 2; Agua Fría en cuatro salas.
**Y casi sin sello**: La Constancia 0 de 8, Nevería 0 de 8, Sarita 2 de 6. Sin
sello la compra no se cruza con su documento (parte 9: 98% huérfanas).

**Los documentos que tenemos de cada proveedor (60 días):**

| proveedor | DTE en el buzón | productos aprendidos | por confirmar (con sugerencia) |
|---|---:|---:|---:|
| Congelados del Sabor (Sarita) | 7 | 0 | 51 (51) |
| Savona (La Nevería) | 7 | 2 | 30 (28) |
| Steiner (Electrolit) | 3 | 1 | 11 (11) |
| Envasadora Agua Fría | 24 | 1 | 1 (1) |
| **La Constancia (Pepsi)** | **0** | — | — |

Las sugerencias leídas a ojo son correctas («GIGA ALMENDRA (12 U)» → GIGA
ALMENDRA SARITA, «ELECTROLIT MARACUYA 625ML» → ELECTROLIT MARACUYA 625 ML).
Sarita además manda el **código de barras** en cada renglón.

**Tres bloqueos concretos:**

1. **La Constancia no manda su DTE a nuestro buzón**: hay 8 compras cargadas y
   cero documentos. Sin documento no hay nada que armar. Hay que pedirle que
   envíe al correo de compras (como ya hacen los demás).
2. **Agua Fría no está ligada a un proveedor del sistema**
   (`proveedores_maestro.supplier_id` NULL). El documento lo emite ENVASADORA
   AGUA FRIA SA DE CV y en el sistema se carga como «JOSE SALVADOR GUEVARA
   "AGUA FRIA"»: otro contribuyente. 24 documentos y sólo 8 compras cargadas.
3. **El diccionario no guarda la PRESENTACIÓN**, sólo el producto. «CONO
   CAPUCHINO CJA 10 U» es una caja: el `insert` exige `id_presentacion` y
   `unidad` por renglón, y equivocarse multiplica o divide el inventario por 10
   sin error.

## 3. La forma correcta

Seis reglas, cada una con su motivo:

1. **Primero se anota la intención en la base, después se escribe afuera.** Una
   fila `compra_carga` por documento (`preparada → enviada → verificada /
   fallida`), única por sello. Es el patrón de `pedido_traslado_erp`: si el
   proceso se corta, queda escrito dónde.
2. **Simulacro por omisión.** Hace todas las consultas (`validarNumdoc`,
   `consultar_stock` con `tipo=D`, `getpresentacion`) y no envía el `insert`.
   Igual que `trasladar-pedido-erp`.
3. **Sesión fijada en Bodega antes de insertar** (`cambio_sesion.php`): la
   compra entra a la sucursal de la SESIÓN, y la cuenta aterriza en Salud 1.
4. **`venta` nunca vacío**: se manda el precio que el sistema devuelve en
   `consultar_stock`; vacío PISA el precio de venta del producto.
5. **No se da por hecha hasta leerla de vuelta**: después del `insert`, se lee
   la compra en `admin_compras_fecha_dt.php` y se compara total, sello y
   renglones. «success» del sistema no es prueba (ya pasó con el corte X).
6. **El reparto se guarda ANTES del `insert` y el traslado sale DESPUÉS de
   verificar.** `compra_reparto` (renglón, sala, cantidad; la suma ≤ lo
   comprado y lo que sobra se queda en Bodega). Verificada la compra, se arma un
   traslado por sala con la maquinaria de `trasladar-pedido-erp` y **el lote de
   esta compra**. La sala lo recibe como hoy.

Y una que no es de código: **la primera compra real se hace con una factura
chica y alguien de Bodega mirando el sistema**, porque nunca se envió un
`insert`.

## 4. Lo que todavía no se sabe

- **¿El sistema permite anular una compra mal cargada?** El menú tiene «Admin
  Compras» y «Nota crédito compras»; no se leyó si hay anular. Se averigua
  antes del primer envío real (lectura de `admin_compras_fecha.php`, o
  preguntando a Bodega).
- Pepsi: no aparece con ese nombre ni en documentos ni en compras. Hay que saber
  qué empresa factura (¿La Constancia?).

## 4 bis. Lo leído del sistema el 2026-10-29 (sólo GET) y lo que decidió el usuario

**Anular una compra SÍ existe**: `anular_compra.php` (`id`), detrás del menú de
Admin Compras, con el aviso «No podrá deshacer este paso». Y
`actualizar_compra.php` (`process=actualizar`) cambia DESPUÉS la clasificación
fiscal (`tipo_operacion`, `clasificacion`, `tipo_costo_gasto`) sin tocar
renglones. O sea: una compra mal clasificada se corrige; una con renglones mal
se anula y se carga de nuevo.

**La compra admite renglones que NO entran al inventario**: «servicio»
(`bandera = 'SERVICIO'`, `id_producto = 'nuevo_servicio'`, `descripcion_ser`
libre). Con `clasificacion = 2` (Gasto) y `tipo_costo_gasto` 1 ó 2 (gasto de
venta / de administración) entra al libro de compras sin sumar existencias.
`destino` sólo ofrece «LOCAL DE VENTA» (3).

**Crear un producto se puede**: `agregar_producto.php` `process=insert`
devuelve `id_producto`. Pide código de barras, descripción, marca, proveedor,
categoría, laboratorio, composición, exento / perecedero / decimales /
regulado / antibiótico, y la lista de presentaciones (presentación, descripción,
factor, costo, código de barras y 7 precios), más mínimos por ubicación.

**El reparto ya tiene su motor**: `enviar-producto-erp` empuja producto de
Bodega a una sala, un traslado por renglón, y la sala acepta o devuelve
producto por producto. El reparto de la compra lo alimenta; no se escribe otro.

Decisiones del usuario:

1. **La Constancia entrega en papel**: la sala que la recibe la manda a Bodega.
   Hace falta la **carga manual** (sin documento electrónico) en la misma
   pantalla. El papel trae el código QR del DTE: escanearlo da el código de
   generación, que es lo que liga la compra con el libro.
2. **Consumo vs venta**: toda factura de crédito fiscal se registra (libro de
   compras); lo que cambia es la clasificación. Venta → renglones de producto,
   Costo. Consumo → renglón de servicio, Gasto, sin inventario. El IVA de
   alimentos y bebidas para consumo NO es deducible (Art. 65-A LIVA, la misma
   nota que ya tienen esos proveedores en su ficha) — **el contador confirma**.
3. **Presentación y producto nuevo se resuelven en la carga**: la presentación
   se elige en el renglón y se aprende junto al producto; si el producto no
   existe, se crea desde ahí mismo.

## 4 ter. El vencimiento que no trae la factura (usuario, 2026-10-29)

Sarita no manda vencimiento y sus helados son perecederos. Medido en el
sistema (sólo lectura, `admin_lotes.php process=lotes`): **hoy ya se cargan sin
fecha** —los lotes de Barrita Fresa tienen el vencimiento vacío— y **el lote es
uno solo para toda la red** (el 32461 existe en Bodega, Salud 3 y Salud 2, cada
una con su cantidad). La fecha se corrige con `admin_lotes.php
process=actualizar` (`id_lote`, `fecha`).

Decisión: «que las salas de venta pongan el vence, haya una alerta o algo que
recuerde».

- La carga NO frena por un vencimiento faltante: el renglón va vacío y queda
  «vence pendiente». Sólo frena si el producto es **regulado**.
- En el reparto (paso 6), la sala que recibe ese producto ve el campo de
  vencimiento en la misma pantalla de recibir y un aviso en la campana hasta
  ponerlo. Como el lote es de la red, **la primera sala que lo pone lo resuelve
  para todas**; el portal lo escribe en el lote con `actualizar`.

## 5. Orden de trabajo

| | qué | listo cuando |
|---|---|---|
| 1 | Presentación en el diccionario (aprendida con el producto) | ningún renglón confirmado sin presentación |
| 2 | Consumo: marcar el documento (o el renglón) como consumo → servicio + Gasto | el simulacro arma el sobre de una compra de consumo |
| 3 | `compra_carga` + función de envío, **simulacro por omisión**, con lectura de vuelta | simulacro verde sobre las facturas del mes |
| 4 | Producto nuevo desde el renglón (`agregar_producto.php`) | simulacro arma el producto; primer alta real con Bodega mirando |
| 5 | Primer envío real de una compra chica, con Bodega mirando | la compra leída de vuelta cuadra |
| 6 | Reparto por sala en la pantalla → `enviar-producto-erp` | la sala recibe el lote de la compra |
| 7 | Carga manual (papel + QR) para quien no manda el DTE | La Constancia cargada sin teclear el código |

## 4 quater. Comparado contra compras que Bodega cargó a mano (2026-10-29)

Antes del primer envío real se armó, con el portal, la compra de tres facturas
de Steiner que Bodega ya había cargado (compras 5871, 5872 y 6372) y se comparó
con lo que quedó guardado. Sólo lecturas. Tres diferencias, las tres corregidas:

| | Bodega | el portal armaba | ahora |
|---|---|---|---|
| producto de regalo (renglón a $0) | reparte el costo: TODO a $1.6237/$1.6238 | regalo a $0, el resto a $1.7699 | reparte igual (`repartirRegalos`) |
| fecha | la del día de la carga (688 de 710 compras desde agosto, 1–7 días después de la emisión) | la de emisión | la del día |
| número de documento | 20 caracteres (616 de 710; ninguna más larga) | los 36 del código | los primeros 20 |

Y el costo por unidad sale del subtotal que cobró el proveedor
(`ventaGravada`), no de precio × cantidad: en una de las tres daba 2,123.88
donde la factura suma 2,123.89. Con eso, los totales cuadran al centavo en
dos y a un centavo en la tercera.

Coinciden: producto, cantidad, presentación (UNIDAD), percepción, IVA. Bodega
puso a mano vencimiento 2027-12-01 y lote «GENERICO»; el portal deja el
vencimiento a la sala (§4 ter) y el lote vacío, que el sistema guarda como
«GENERICO».

**El envío** (`enviar: true`) está escrito con cinco frenos —revisión sin
problemas, idéntico a lo revisado, un solo envío por documento, POST sin
reintento, y «no se sabe» que NO deja volver a mandar— y lo lee de vuelta en
la lista del día. Queda apagado detrás del secreto `CARGA_COMPRA_ENVIO=on`.
