# El factor de presentación y el MIN·MAX — hallazgo y plan (2026-08-13)

**Estado: nada aplicado.** Todo lo de abajo son lecturas contra producción. No se
escribió una sola fila ni se aplicó ninguna migración. Queda una decisión abierta
(§7) antes de tocar nada.

---

## 1. En cinco líneas

El MIN·MAX **no lee `product_precios.factor`**. Lo saca de un regex sobre el
texto de cada línea de factura, congelado en la fila cuando entró la venta. Las
existencias y los pedidos **sí** leen el catálogo. Son dos fuentes distintas
contestando la misma pregunta, y cuando no coinciden el producto queda
permanentemente "sobrestockeado" y nunca se repone. Arreglar el factor en el ERP
**mueve una sola de las dos mitades**: si no se reprocesa el histórico primero,
el pedido siguiente pide hasta 10× de más.

---

## 2. El hallazgo central

Medido contando la palabra `factor` en el cuerpo de cada función en producción:

| función | ¿lee `product_precios`? | veces que dice «factor» |
|---|---|---|
| `calculate_stock_params` — **calcula** el MIN·MAX | **no** | **1** (`ii.factor_unidades`) |
| `refresh_product_sales_rollup` | **no** | 2 (las dos, `factor_unidades`) |
| `publish_stock_params` | no | **0** |
| `get_stock_analysis` — **compara** contra existencias | sí | 40 |
| `get_pedido_preview` — **divide** para armar el pedido | sí | 105 |

Las dos funciones que **producen** el MIN·MAX no tocan el catálogo. Las dos que
lo **consumen** viven del catálogo.

`product_stock_params.min_units` / `max_units` son enteros **sin unidad
declarada**. Quién decide qué unidad son: el texto de la factura. Quién la
interpreta después: `product_precios.factor`. Nada obliga a que coincidan.

---

## 3. Los tres caminos del factor

| | de dónde saca el factor | llave del cruce | cuándo se calcula |
|---|---|---|---|
| **Ventas → unidades** | regex `[0-9]+[xX]([0-9]+)` sobre el **texto** `sales_invoice_items.presentacion` (ej. `"CAJA 1X10"`) | ninguna: parseo de texto | **congelado** al insertar la fila, por `trg_set_item_factor_unidades` |
| **Existencias → unidades** | `product_precios.factor` | `UPPER(inventory.detalle)` ↔ `UPPER(product_precios.descripcion)` | al leer, en vivo |
| **Pedidos** | `product_precios.factor` vía `mv_product_factor` | `UPPER(TRIM(inventory.presentacion))` ↔ `presentaciones.tipo`; respaldo `split_part(lower(detalle),'x',2)` | al leer, en vivo |

Tres caminos, tres llaves distintas. El primero viola la regla del proyecto
—«nunca calcular el factor parseando texto, siempre usar
`product_precios.factor`»—. Esa regla ya se aplicó a `get_sucursal_net_stock`,
pero el trigger `fn_set_item_factor_unidades` quedó afuera y sigue con el regex.

El trigger es `BEFORE INSERT OR UPDATE OF presentacion`. Detalle que importa para
el paso 3 del plan: **un `UPDATE` sobre otra columna no lo dispara.**

---

## 4. Qué pasa hoy (medido)

### Cuando el texto y el factor concuerdan, el número es correcto

KETORAL 200MG X 10 (id 4828), factor 10, descripción `1X10`. Ventas ×10,
existencias ×10, y Pedidos divide entre 10 al final. En **Salud 1**: velocidad
0.4178, MIN 10 / MAX 15 tabletas —o sea 1 y 2 cajas— con 2 cajas en existencia.
Está bien calculado. El único defecto es de lectura: la pantalla muestra
tabletas donde uno piensa en cajas.

**Esto vale para 21 de los 25 productos de una sola presentación.** No tienen un
error de cálculo.

### Cuando NO concuerdan, el producto no se repone nunca

| producto | factor | descripción | lo que lee la venta | lo que lee la existencia | efecto |
|---|---|---|---|---|---|
| ENALAM 25MG X 10 (4673) | 10 | `1X1` | **1** | **10** | Salud 1: MIN 0 / MAX 1 (cajas) contra 2 cajas leídas como 20 → sobrestockeado siempre |
| ACETAMINOFEN FORTE X 16 (4324) | 16 | `1X 16` (el espacio rompe el regex) | **1** | **16** | Salud 2: MIN 0 / MAX 1 contra 1 caja leída como 16. Además `ROUND(1/16) = 0` → **queda excluido de Pedidos** |
| TINACTOL X 30 (3862) | 30 | `1X1` | **1** | **30** | mismo patrón |
| PAXIL CR 25 X 30 (4027) | 30 | `1X1` | **1** | **30** | mismo patrón, sin ventas en la ventana |

**El efecto es el contrario al que se teme: hoy no piden de más — no piden
nunca.** Es un error silencioso: un producto que nunca aparece en el pedido se ve
igual que un producto que no hace falta.

---

## 5. El peligro real: arreglar sin reprocesar

Las existencias **se convierten al leer**; el MIN·MAX **está guardado**. Cambiar
el factor en el ERP mueve la primera mitad al instante y deja la segunda intacta.

Con KETORAL en Salud 1, si se pusiera factor 1 sin más:

| | existencia | MAX | falta | pide |
|---|---|---|---|---|
| hoy (factor 10) | 2 × 10 = 20 unidades | 15 | 0 | nada ✓ |
| factor 1, sin reprocesar | 2 × 1 = **2** | **15** (sin tocar) | 13 | **13 cajas** ✗ |

Diez veces de más, en todos los productos y todas las sucursales a la vez.

Dos agravantes:

- El salto supera el 40%, así que `calculate_stock_params` **no lo auto-aplica**:
  queda en borrador `pending`.
- Y mientras una sucursal tenga borradores `pending`, esa sucursal **no se vuelve
  a recalcular** (`branch_has_pending_drafts`). Se traba hasta que alguien los
  cierre a mano.

---

## 6. El orden que lo evita

1. **Candado de mantenimiento** en `minmax` y `pedidos`. `calculate_stock_params`
   lo respeta incluso para `service_role`, así que ningún cron recalcula ni arma
   un pedido a mitad del cambio.
2. **Corregir en el ERP** y dejar entrar el sync: `upsert_product_precios_batch`
   reescribe `factor` y `descripcion`; el de inventario reescribe `detalle`.
3. **Reescribir `factor_unidades` del histórico.** Es el único paso que toca la
   entrada del MIN·MAX, y el que nadie haría por su cuenta.
   - **Trampa:** el trigger recalcula desde el texto `presentacion`, que en las
     facturas viejas sigue diciendo `"CAJA 1X10"` y tampoco se reescribe. Un
     `UPDATE ... SET presentacion = presentacion` **vuelve a dar 10**. Hay que
     escribir `factor_unidades` **directamente** — como el trigger es
     `UPDATE OF presentacion`, no se dispara y no interfiere.
   - `factor_unidades` es derivada del portal. `cantidad` y `total_linea` son las
     fiscales y **no se tocan**.
   - Por tandas y con `lock_timeout`: `sales_invoice_items` la escribe el sync
     cada minuto.
4. **Refrescar** `refresh_product_sales_rollup()` y
   `refresh_primera_venta_producto()`.
   `product_sales_monthly_agg` guarda la cantidad **cruda**, sin multiplicar —
   ese no hay que reconstruirlo.
5. **Recalcular** `calculate_stock_params` por sucursal (1–5 y 7; Bodega se
   deriva sola por `trg_bodega_draft_sync`).
6. **Revisar y publicar los borradores** (`publish_stock_params`). No se van a
   auto-aplicar; hay que cerrarlos o la sucursal queda trabada.
7. **Quitar el candado.** Recién ahí, generar pedido.

Saltarse 3 y 4 hace que el paso 5 recalcule sobre el histórico viejo: el problema
sobrevive al arreglo.

---

## 7. La decisión abierta

Dos arreglos posibles. Cambian el trabajo, no sólo el resultado:

**(A) Arreglar sólo el texto** para que concuerde con el factor (`1X1` → `1X10`,
`1X 16` → `1X16`). Es el arreglo mínimo, alinea los tres caminos y todo sigue
expresado en tabletas. Los 21 productos que ya concuerdan no se tocan.

**(B) Poner factor 1** en los que sólo se venden por caja. Todo el circuito pasa
a hablar de cajas —que es como se leen naturalmente— pero obliga al reproceso
completo (pasos 3–6) de los 25, incluidos los 21 que hoy calculan bien.

Recomendación: **(A) para los renglones desalineados de §8**, porque ahí hay un
bug medido. Los 21 que concuerdan calculan bien; pasarlos a factor 1 es cosmético
y paga el mismo costo de reproceso.

---

## 8. Los datos

### 8.1 Renglones del catálogo donde el texto no concuerda con el factor

21 renglones activos, 19 productos. **Ésta es la lista accionable.**

| id | producto | presentación | descripción | factor | lo que lee la venta |
|---|---|---|---|---|---|
| 1791 | CETAFREN X 200 TABLETAS | CAJA X 200 | `1X 200` | 200 | — |
| 4230 | CILFRIN D X 25 SOBRES X 4 TAB | CAJA | `1X 100` | 100 | — |
| 3806 | DICLOFENACO SODICO 50MG X 100 SAIMED | CAJA X 100 | `DICLOFENACO SODICO S` | 100 | — |
| 4127 | DICLOFENAC SODICO 50MG X 50 MK | CAJA X 50 | `1X 50` | 50 | — |
| 2988 | PERGASTRIC X 36 TAB | CAJA X 36 | `1X12` | **36** | **12** |
| 4027 | PAXIL CR 25 X 30 TABLETAS | CAJA X 30 | `1X1` | 30 | 1 |
| 3862 | TINACTOL X 30 TABLETAS | CAJA X 30 | `1X1` | 30 | 1 |
| 3827 | BOLSA DE AGUA X 500 ML | FARDO X 25 | `X 25` | 25 | — |
| 3827 | BOLSA DE AGUA X 500 ML | FARDO X 24 | `X 24` | 24 | — |
| 3912 | ELEQUINE 750 X 20 TABLETAS | CAJA X 20 | `1` | 20 | — |
| 3940 | MASCARILLA KN95 NEGRA X 20 | CAJA X 20 | `1 X 20` | 20 | — |
| 4314 | PAVERIN COMPUESTO X 20 COMP | CAJA X 20 TAB | `1X 20` | 20 | — |
| 3844 | WINEX 275MG/300MG X 20 TAB | CAJA X 20 | `CAJA X 20` | 20 | — |
| 4324 | ACETAMINOFEN FORTE X 16 MK | CAJA | `1X 16` | 16 | — |
| 987 | BENDRINGESIC X 100 TABLETAS | BLISTER | `1X1` | 10 | 1 |
| 3806 | DICLOFENACO SODICO 50MG X 100 SAIMED | BLISTER X 10 | `DICLOFENACO SODICO S` | 10 | — |
| 4673 | ENALAM 25MG X 10 TABLETAS | CAJA | `1X1` | 10 | 1 |
| 3939 | MASCARILLA KN95 BLANCA X 10 | CAJA X 10 | `1 X 10` | 10 | — |
| 3816 | PROVASTATIN 5MG X 7 TAB | CAJA | `PROVASTATIN 5MG ` | 7 | — |
| 4244 | NIKZON X 40 TABLETAS | CAJA | `1X 4` | 4 | — |
| 2965 | RECARGA SALDO MOVISTAR | UNIDAD | `1x1` | 2 | 1 |

«—» = el regex no puede leer nada y cae a **1**. Son 15 de los 21: casi siempre
por un **espacio** después de la `x`, o porque la descripción trae el nombre del
producto en vez del empaque.

**Impacto por el lado de las ventas:** 5,582 de 230,458 líneas en 180 días
(2.4%). Ese cruce da 20 productos en vez de 19 porque hace `LIKE` contra todos
los renglones de `product_precios`, incluidos los inactivos.

### 8.2 Productos con una sola presentación activa y factor ≠ 1

25 productos, de 2,256 con una sola presentación activa (los otros 2,231 tienen
factor 1, que es lo normal). Lista completa levantada el 2026-08-13; los cuatro
con problema real están en §4 y los demás calculan bien. Factores presentes: 60,
30 (×6), 25, 20, 16, 14 (×2), 12, 10 (×8), 7, 3, y dos con **factor 0**.

### 8.3 Factor 0 — arreglo sin contraparte

3 renglones activos con `factor = 0`: RECARGA TIGO (3856), RECARGA DIGICEL
(3892) y MOVISTAR (2965, factor 2 pero descripción `1x1`).

`get_stock_analysis` hace `cantidad × COALESCE(pf.factor, 1)`. **0 no es NULL**,
así que multiplica por cero: RECARGA TIGO tiene **555 unidades en 3 sucursales y
el portal las ve como 0**. En Pedidos no aparece porque `mv_product_factor`
filtra `factor > 0` y la división usa `NULLIF(factor, 0)`.

Esto no depende de la decisión de §7 y se puede arreglar por separado.

---

## 9. El arreglo de fondo

Lo de §6 corrige los datos una vez. Para que no vuelva a pasar, hay dos caminos —
los dos siguen necesitando el reproceso **una** vez:

- **Que el trigger lea `product_precios.factor`** en vez del regex, con la misma
  llave que usa Pedidos (`presentaciones.tipo`). Los tres caminos coinciden por
  construcción de ahí en adelante.
- **Dejar de guardar `factor_unidades`** y resolver el factor al leer, uniendo al
  catálogo dentro de `calculate_stock_params` y del rollup, igual que hacen las
  otras dos. Con esto, arreglar un factor en el ERP se propaga solo en el
  siguiente recálculo y **nunca más hace falta tocar el histórico**.

La segunda elimina el problema en vez de administrarlo. `factor_unidades` no es
un dato fiscal —lo derivó el portal—, así que resolverlo al leer no altera ningún
registro que deba quedar congelado. Falta medir qué le cuesta ese join al rollup
antes de proponerla en firme.

---

## 10. Qué queda pendiente

- [ ] Decidir §7: arreglar el texto (A) o pasar a factor 1 (B).
- [ ] Corregir los 21 renglones de §8.1 en el ERP.
- [ ] Arreglar los 3 renglones con factor 0 (§8.3).
- [ ] Medir el costo del join del rollup para decidir §9.
- [ ] Escribir el SQL de cada paso de §6 una vez tomada la decisión.

**Sucursales:** 1 Salud 1 · 2 Salud 2 · 3 Salud 3 · 4 Salud 4 · 5 La Popular ·
6 Bodega · 7 Salud 5.
