# Retomar — Widget de Ajuste de Inventario (conectado al ERP)

**Escrito el 2026-08-06.** Cierra la sesión en la que el portal pasó de *pedir*
cambios a *ejecutarlos* en el ERP y ante Hacienda. El próximo widget —**Ajuste
de Inventario**— es el cuarto de la misma familia, y la mitad del trabajo ya
está hecha: existe el patrón, el módulo compartido, los secretos y las
lecciones. Este documento es para no volver a aprenderlas.

---

## 1 · Lo que quedó funcionando (y verificado)

| | |
|---|---|
| Widget «Solicitar Modificación a Facturación» | 4 tipos, los 4 se aplican en el ERP al aprobar |
| Edge Function `aplicar-solicitud-facturacion` | cliente · forma de pago · vendedor · anulación |
| Edge Function `regularizar-dte` | barrido de lo pendiente ante Hacienda |
| Cron `regularizar-dte-2230-sv` | `30 4` UTC = 22:30 SV |
| Cron `alerta-barrido-dte-8am-sv` | `0 14` UTC = 08:00 SV, avisa si falló |
| Widget de Ajuste Min/Max | auditado; su aviso nunca había funcionado |

Verificado de punta a punta contra facturas reales: la 345641 se anuló en el
ERP y ante Hacienda desde el portal (sello `2026A8FEE61FDE644CC8A4C56DB531294EAEF9O6`),
y la 344391 recibió su sello de recepción por el barrido.

---

## 2 · El patrón, en cuatro piezas

Esta es la forma que hay que **repetir**, no rediseñar.

### 2.1 · El widget crea una solicitud, no ejecuta

El navegador nunca habla con el ERP. Escribe una fila (`approval_requests` o
tabla propia) con todo lo que hace falta para aplicarla después.

**Guardá el id del ERP, no solo el del portal.** `sales_invoices.id` (6661122)
y `erp_invoice_id` (345641) son numeraciones distintas y el ERP acepta la
equivocada sin protestar, apuntando a otro documento. Ese fue el error más
peligroso de la sesión y se evitó por poco. Para inventario aplica igual:
`products.id` ≠ `erp_product_id`, y `branch_id` ≠ `erp_sucursal_id`.

### 2.2 · La validación va en la BD, no en la pantalla

El RLS deja ver a cada quien solo sus propias solicitudes, así que el navegador
**no puede** comprobar si otro ya pidió lo mismo. Una validación que no puede
ver el dato no es una validación.

Hoy hay dos, en `approval_requests`:
- trigger `validar_solicitud_facturacion` — no se piden cambios sobre una
  factura anulada;
- índice único parcial `approval_requests_una_pendiente_por_factura` — una sola
  pendiente por documento. **Índice y no trigger**: un índice no pierde una
  carrera entre dos inserts simultáneos, un `SELECT` previo sí.

### 2.3 · La notificación nace con la solicitud

`INSERT` y `notify` como dos llamadas del navegador **no funciona**. Medido dos
veces en esta sesión: `approval_requests` con 0 notificaciones, y
`minmax_change_requests` con **cero en toda su historia** pese a tres
solicitudes. En Min/Max el aviso iba dentro de un `try/catch` no-fatal, o sea
que fallaba en silencio por diseño.

La forma correcta es un trigger `AFTER INSERT` que crea la notificación en la
misma transacción, más otro `AFTER UPDATE OF status` que la marca
`metadata.resuelta` cuando se decide — si no, el aviso sigue ofreciendo
Aprobar/Rechazar sobre algo ya resuelto.

El cuerpo tiene que alcanzar para decidir sin abrir la app: qué, dónde, de→a y
el motivo.

### 2.4 · La Edge Function aplica, y el orden importa

**Primero el ERP, después APPROVED.** Si se marca aprobada antes y el ERP
falla, queda una solicitud que dice «aplicada» sobre algo intacto y nadie
vuelve a mirarla. Al revés, si el ERP no acepta la solicitud sigue PENDING y
quien aprueba ve el motivo.

Identidad **siempre del JWT**, nunca por parámetro; más empleado ACTIVO y el
permiso del módulo.

---

## 3 · El ERP: lo que ya está mapeado

Base: `https://clientesdte3.oss.com.sv/farma_salud`.
Login: `POST login.php` con `username`/`password`/`m=1`; **la cookie viaja en el
Set-Cookie del 302**, así que no hay que seguir el redirect.

Credenciales en el secreto `ERP_FACTURACION_CREDS` (usuario `edwin`). El
responsable de anulaciones ante Hacienda, en `DTE_RESPONSABLE_ANULACION`.

Todo lo de DTE vive en **`supabase/functions/_shared/erp-dte.ts`** —
`login`, `pedir`, `conReintento`, `leerRespuesta`, `estaAnulada`,
`enviarDteAlMH`. **Reusar ese módulo, no copiarlo.**

### Trampas verificadas, que van a volver

1. **El ERP contesta HTTP 200 con `{"typeinfo":"Error"}` cuando rechaza.** Hay
   que leer el cuerpo; un rechazo silencioso se ve igual que un éxito.
2. **El mensaje no distingue la operación.** `cambiar_cod` y `cambiar`
   devuelven el mismo «Numero actualizado». Nunca dar por bueno sin releer y
   comparar.
3. **Un POST parcial borra lo que no mandás** (incidente 6317, ya conocido).
   `cambiar_datos` manda cliente y forma de pago juntos: el campo que no cambia
   viaja con su valor **actual recién leído**, no con el que traía la solicitud.
4. **Nombres de parámetro mentirosos**: el código de vendedor viaja en
   `numero_doc`.
5. **El token del MH se cachea en la sesión PHP** al abrir la pantalla
   (`generar_dte.php` / `anular_dte.php`). Sin ese GET previo, `get_dte`
   responde `"Token no pudo ser cargado"`.
6. **El éxito es el sello, no el 200.** `proxydte.php` contesta 200 igual
   cuando Hacienda rechaza; ahí `selloRecibido` viene nulo.
7. **Hacienda acepta con reparos** («RECIBIDO CON OBSERVACIONES»). Es éxito con
   advertencia: guardarlas y contarlas aparte.
8. **Una sesión sirve para todas las sucursales** — verificado leyendo facturas
   de Salud 1, 3, 4, 5 y La Popular sin `cambio_sesion.php`. **OJO: esto puede
   NO valer para inventario** (ver §5).

### Presupuesto de tiempo

Una Edge Function vive **150 s**. Cada paso contra el ERP tarda ~0.3 s medido;
la llamada al MH es la lenta. `regularizar-dte` usa un presupuesto de 110 s y
se corta **antes** de empezar otro documento, para que siempre alcance a
escribir el registro. Con 300 pendientes drena en tandas y **dice cuántas
quedan** — un tope que no se anuncia se lee como «ya está todo».

---

## 4 · Lo que quedó pendiente de esta sesión

1. **Botón por fila** en las pestañas de Facturación. `regularizar-dte` ya
   acepta `{ alcance:'una', invoice_id }`; falta colgarlo de cada renglón.
2. **Cliente sin número interno.** 102 de 27,769 fichas no tienen `erp_id` y el
   buscador las ofrece igual: la solicitud se crea y recién al aprobarla se
   descubre que no se puede aplicar. Filtrarlas o avisar al elegir.
3. **El plazo de gracia y la regla de CCF se muestran pero no se imponen.**
   `canSubmit` solo exige motivo y, para un CCF de fecha anterior, tildar una
   casilla. Hoy un CCF fuera de ventana se puede aprobar y se manda a Hacienda.
4. **La notificación de "decidida"** (al solicitante) sigue saliendo del
   navegador — el mismo hueco que se cerró para la de creación.
5. **Reintento tras un barrido cortado.** Hay una guarda que relee el estado
   antes de enviar; no está probada contra un corte real.
6. **Seguridad, para reportar a OSS:** `anular_dte.php` sirve en el HTML, en
   claro, el usuario y contraseña de la API del Ministerio de Hacienda y un
   Bearer vivo. Cualquiera con sesión del ERP los ve. Y en el flujo de
   anulación **no se usan** — el JS arma `user=…&pwd=…` y nunca lo manda.

---

## 5 · Cargas y descartes de inventario

> **No es «Ajuste».** Decidido con el usuario el 2026-08-06, ya con el sondeo
> hecho: `ajuste_inventario.php` es el camino complicado —ajusta contra la
> existencia contada, arrastra la matriz de lotes de productos regulados y tiene
> dos armados distintos de su payload—. Las dos operaciones que hacen falta son
> **carga** (`ingreso_inventario.php`) y **descarte** (`descargo_inventario.php`),
> que son más simples y cubren el caso real. El título del archivo quedó viejo.

### 5.1 · Mapeado, con sondeo de solo lectura (2026-08-06)

**Leer el JS que la página carga de verdad.** `ingreso_inventario.php` **no**
carga `funciones_ingreso_inventario.js` —ese archivo existe, está obsoleto y
arma 9 celdas contra un encabezado de 11— sino
**`js/funciones/funciones_inventario.js`**. El del descarte sí es
`funciones_descargo_inventario.js`. Confirmarlo con un grep del `<script>`,
no por el nombre.

| | **carga** | **descarte** |
|---|---|---|
| página | `ingreso_inventario.php` | `descargo_inventario.php` |
| JS real | `js/funciones/funciones_inventario.js` | `js/funciones/funciones_descargo_inventario.js` |
| lookup | `process=consultar_stock` + `tipo`(C\|D) + `id_producto` | idem + `ubicacion` |
| presentación | `process=getpresentacion` + `id_presentacion` | idem |
| escribe | `process=insert` | `process=insert` |
| campos del insert | `datos`, `cuantos`, `total`, `fecha`, `concepto`, `destino` | `datos`, `cuantos`, `total`, `fecha`, `concepto`, `origen`, `iden` |
| `datos`, separado por `#` | `id_prod\|compra\|venta\|cant\|unidad\|vence\|id_presentacion\|numero_lote` | `id_prod\|compra\|venta\|cant\|unidad\|vence(vacío)\|id_presentacion\|id_lote` |

`iden` del descarte es el **Tipo**, y son cuatro exactos:
`VENCIMIENTO`, `DESCARTE`, `PRODUCTO DAÑADO`, `CONSUMO INTERNO`.

Dos detalles del `datos` que no se adivinan: en la carga el lote es **texto
libre** (`numero_lote`), en el descarte es el **id de un lote existente**
(`id_lote`, 0 si el producto no es regulado). Y `vence` viaja con la cadena
literal `'NULL'` cuando el producto no es perecedero, no vacío.

`admin_ingreso.php` y `admin_descargo.php` **no existen** (404 los cuatro
nombres probados). La verificación de que una carga o un descarte entró es el
**kardex** (`reporte_kardex.php`), no un listado propio.

### 5.2 · ⚠️ RESUELTA: la sucursal SÍ es estado de sesión

Era la pregunta bloqueante y la respuesta es **sí**, al revés que en DTE.
Verificado recorriendo las 7 sucursales: `cambio_sesion.php` con
`process=set_sucursal&id_sucursal=N` devuelve `{"success":true}` y **las dos
páginas siguen a la sesión** — cambia el `id_sucursal_dom` y el `<select>` de
ubicación se re-renderiza con la ubicación de esa sucursal y solo esa.

El `$('#sucursal').change(...)` que aparece en los tres JS es **código muerto**:
ninguna de las dos páginas tiene ese `<select>`. La sucursal no es un parámetro
que se pueda mandar; hay que cambiarla en la sesión antes.

Un solo usuario (`edwin`, el de `ERP_FACTURACION_CREDS`) alcanza para las 7.
El patrón ya existe en `sync-erp-purchases` (`SESION_URL`).

**Corolario que hay que respetar: la sucursal es estado global de la sesión
PHP.** Dos operaciones sobre sucursales distintas que compartan cookie se pisan.
Cada aplicación tiene que hacer su propio `login()` —cookie nueva— o serializar.
No reusar un `cookieCache` entre sucursales.

**El mapa de ubicaciones, leído del ERP** (`obtener_ubicaciones.php`), que es lo
que va en `destino`/`origen`. `erp_sucursal_map.inv_ubicaciones` solo lo tiene
para Bodega; las otras seis están en NULL:

| sucursal ERP | branch_id | ubicación |
|---|---|---|
| 1 Salud 1 | 4 | 3 · LOCAL DE VENTA |
| 2 Salud 2 | 25 | 4 · LOCAL DE VENTA |
| 3 Salud 3 | 27 | 5 · LOCAL DE VENTA |
| 4 Salud 4 | 28 | 6 · LOCAL DE VENTA |
| 5 La Popular | 2 | 7 · LOCAL DE VENTA |
| 6 Bodega | 30 | 1 · BODEGA · 2 · BODEGA DE VENCIDOS |
| 7 Salud 5 | 29 | 8 · LOCAL DE VENTA |

### 5.3 · La trampa de la presentación

`consultar_stock` no devuelve las presentaciones como datos: devuelve un
`<select>` **en HTML**. Para el producto 2 en Salud 1 son tres opciones con la
misma etiqueta —`UNIDAD (1)`, ids 8421 / 7213 / 3— y **el orden cambia entre las
dos pantallas**: la carga las manda 8421 primero, el descarte manda 3 primero.
Quien lo hace a mano acepta la primera sin saber que hay tres.

El portal **tiene que mandar `id_presentacion` explícito**, resuelto por dato y
no por posición. Es la misma familia de error que `numero_doc` cargando el
código de vendedor: un nombre que no distingue lo que identifica.

El descarte además devuelve `stock` —27.0000 para ese producto, que cuadra con
`inventory.cantidad`— y un `lotes_select` con `data-regulado`. Para regulados
hay que elegir lote; para el resto viene deshabilitado e `id_lote` va en 0.

Y confirma la trampa 1 de §3: un producto inexistente contesta **HTTP 200** con
`{"typeinfo":"Error","msg":"El codigo ingresado no pertenece a ningun producto"}`.

### 5.4 · Lo que el portal puede hacer mejor que la pantalla del ERP

En el ERP hay que estar en la sesión de esa sucursal, buscar cada producto de a
uno y tipear la cantidad. El portal ya tiene el dato que haría falta buscar:
`inventory` guarda **lote, fecha de vencimiento, cantidad y presentación por
sucursal**. Hoy, con stock a mano:

**347 líneas ya vencidas siguen en las 7 sucursales, fuera de la Bodega de
Vencidos** — 994 unidades. Salud 5 (88), Salud 1 (57), Salud 3 (54), Bodega
(51), Salud 2 (46), La Popular (34), Salud 4 (17). Otras 250 líneas vencen en
los próximos 90 días.

O sea que el portal puede dar vuelta el trabajo: en vez de que alguien busque
producto por producto, **la pantalla propone la lista y el usuario confirma**. Y
como `datos` es una cadena separada por `#`, los N productos entran en **un solo
`process=insert`**.

### 5.5 · Lo construido (2026-08-06, v2.427.1)

Las cuatro piezas, con las decisiones del usuario ya tomadas: **solicitud +
aprobación** (nadie mueve existencias de un clic), **sin tope** de monto ni de
cantidad, y el `concepto` armado con **causa + quién solicita + quién aprueba**.

| pieza | dónde |
|---|---|
| Tipos, validación y aviso | `20260806162302_movimientos_inventario_solicitud_validacion_aviso.sql` |
| La presentación por significado | `20260806163452_movimiento_inventario_presentacion_por_significado.sql` |
| La que aplica | `supabase/functions/aplicar-movimiento-inventario/` |
| Aprobar = aplicar | `requestsSlice.js` → `_aprobarInventario` |
| Datos | `src/data/inventoryMovements.js` |
| Widget | `src/views/dashboard/WidgetInventoryMovement.jsx` |

Se cuelga de `approval_requests` con dos tipos nuevos
(`INVENTORY_LOAD_REQUEST`, `INVENTORY_DISCARD_REQUEST`) en vez de estrenar
tabla: ahí ya viven el RLS, los triggers de aviso, la campana y `/requests`.
**El CHECK `approval_requests_type_check` había que ampliarlo** — sin eso los
dos tipos rebotan, y lo destapó la prueba de inserts reales, no la lectura.

### 5.6 · Lo que falta: la prueba chica

Todo lo anterior está desplegado y verificado *salvo contra un movimiento
real*. Falta lo que el orden sugerido dejaba último, y necesita permiso porque
escribe en producción:

1. Un **descarte de una unidad** de un producto vencido, aprobado desde el
   portal.
2. Confirmarlo en el **kardex** (`reporte_kardex.php`) — no hay
   `admin_descargo.php`, el kardex es la única verificación.
3. **Medir ahí el largo real del `concepto`.** Se recorta a 200 por precaución
   y el código lo avisa, pero el tope verdadero no se conoce: el ERP no lo
   declara y no hay forma de leerlo sin escribir una vez. Si entra completo, se
   sube el `CONCEPTO_MAX`.

Hasta que eso se haga, no soltar nada masivo.

---

## 6 · Reglas de la casa que costaron caro hoy

- **El árbol es compartido.** Otra sesión se llevó mis archivos en su commit
  tres veces, y dos veces el bump de versión. Commitear con paths explícitos,
  `git fetch` antes de pushear, y revisar `git status` después del `add`.
- **`apply_migration` nunca toca el disco.** Cada migración necesita su archivo
  local con la versión de 14 dígitos que devolvió el servidor; el gate
  `--remote` lo detecta y esta sesión lo usó cuatro veces.
- **Probar con `BEGIN … ROLLBACK`.** Todas las reglas nuevas se verificaron con
  inserts reales revertidos. Tres veces la prueba estuvo mal antes que el
  código —dos filas con el mismo `now()`, una fila con fecha vieja, una
  conversión de zona invertida— y las tres se habrían reportado como
  «verificado» sin volver a mirar.
- **Un tope que no se anuncia es un truncamiento silencioso.** Pasó con el
  `.limit(500)` del widget, con el `.limit(1000)` de Min/Max y casi con
  `MAX_POR_CORRIDA`.
