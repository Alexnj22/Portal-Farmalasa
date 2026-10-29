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

## 5. Orden de trabajo

| | qué | listo cuando |
|---|---|---|
| 0 | Destrabar: La Constancia manda DTE; Agua Fría ligada a su proveedor; confirmar los ~90 productos de bebidas en «Por confirmar» | los 5 proveedores con documento y producto |
| 1 | Presentación en el diccionario (`compra_producto_alias.id_presentacion`, aprendida igual que el producto) | ningún renglón de bebidas sin presentación |
| 2 | `compra_carga` + función de envío en simulacro | simulacro verde sobre las facturas de bebidas del mes |
| 3 | Primer envío real, con Bodega mirando | la compra leída de vuelta cuadra |
| 4 | Reparto en la pantalla + `compra_reparto` | se guarda y se valida la suma |
| 5 | Traslados desde el reparto | la sala recibe el lote de la compra |
