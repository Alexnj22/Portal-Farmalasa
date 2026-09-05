# Descuentos en la venta — auditoría del origen y cómo se configura desde el portal

**2026-09-04.** El sistema de la caja tiene una pantalla para descontar en la
venta y nadie del portal la veía. Este documento es lo que se midió de ella
antes de escribir una línea, y las decisiones que salieron de esa medición.

---

## 1 · Qué es, medido

Tres páginas del origen: la lista (`admin_promocion.php`, datos en
`admin_promocion_dt.php`), el alta/edición/borrado (`promocion.php`) y el JS que
las mueve (`js/funciones/funciones_promocion.js`).

Un descuento son **siete campos y una lista de productos**: descripción, tipo
(`%` o `$`), monto, fecha de inicio, fecha de fin, si vale en todas las salas o
en una, y los productos.

Al 2026-09-04 había **13 descuentos** históricos y **los 13 eran de todas las
salas**.

### Cómo descuenta de verdad

**Por RENGLÓN, no sobre el total de la venta.** Al agregar un producto,
`venta.php` devuelve el renglón ya con `descuento_monto`, `descuento_tipo` e
`id_promo`; si no hay descuento vigente devuelve `-1` en los tres.

| tipo | lo que hace `actualiza_subtotal` |
|---|---|
| `%` | `descuento = monto% × subtotal del renglón` |
| `$` | `subtotal -= monto × cantidad` → **monto por CADA UNIDAD** |

Ese segundo caso es la trampa del módulo. «Promoción Arginina Vijosa 1+1,
$10.04» descuenta **$10.04 por cada unidad**: sobre tres, son $30.12. Por eso el
portal rotula la opción «Monto por cada unidad» y no «Monto», y pinta el ejemplo
de una venta de 3 debajo del campo.

**Comprobado punta a punta** con Omega 3 (descuento 14, 29.67 %):
2 × $13.50 = $27.00 → −$8.01 → **$18.99**, que es exactamente el `total_linea`
que `sales_invoice_items` ya tenía sincronizado. Y las fechas se respetan: un
producto de un descuento vencido vuelve con `-1`.

---

## 2 · Lo que el portal NO puede ver de esto, y sigue sin poder

`sales_invoice_items` **no tiene columna de descuento**. Llega el
`precio_unitario` crudo ($13.50) y el `total_linea` ya descontado ($18.99).

O sea que **un descuento de campaña es indistinguible de un precio cambiado a
mano**. No hay forma de reportar cuánto descontó cada campaña ni cuánto vendió,
salvo derivándolo (`precio_unitario × cantidad ≠ total_linea`), que también
capturaría los cambios manuales de precio.

**Queda abierto.** Cerrarlo exige que `sync-dte-sales` traiga el
`descuento_promo` del renglón, si el ERP lo expone en el JSON de la factura —
no se verificó. Es otra tanda de trabajo y no era lo que se pidió.

---

## 3 · Nueve hallazgos del origen

1. **La sala sale del POST, no de la sesión.** Medido: con la sesión abierta en
   Salud 1 y `id_sucursal=3` en el cuerpo, quedó registrado en Salud 3. O sea
   que un descuento de una sola sala NO exige `cambio_sesion.php` — una petición
   alcanza, sea de una sala o de todas. Es lo que hizo barata la decisión de
   soportar descuentos por sala desde el día uno.
2. **Su propio formulario deja un producto fantasma.** Manda la lista con un `#`
   al final (`87#84#79#`) y el servidor guarda la cadena vacía como producto 0:
   **11 de los 13** lo arrastran. El portal manda sin el separador final —
   comprobado que así no aparece— y además **descarta el 0 al leer**, para no
   pintar un producto que no existe en la pantalla con la que se decide.
3. **Borrar NO es el enlace que el propio menú muestra.**
   `?process=delete&id_promocion=N` por GET devuelve el formulario de alta y no
   borra nada. El borrado real es un POST con `process=delete` y **`id=N`** —
   otro nombre para el mismo número, la familia de `id_factura` llevando el id
   del crédito.
4. **El origen contesta «Promocion guardada correctamente» también al borrar.**
   Su mensaje es genérico, así que el portal **relee la lista** para confirmar
   que ya no está, igual que el abono de un crédito relee el saldo.
5. **No hay estado activo/inactivo.** Sólo fechas y borrar. «Apagar» un
   descuento es moverle la fecha de fin o borrarlo, y el portal lo dice con esas
   palabras en vez de prometer un interruptor que no existe.
6. **`promocion.php?id=<inexistente>` no da error**: devuelve el formulario en
   modo edición con todo vacío. El portal traduce la ausencia de `id_promocion`
   a «ese descuento ya no existe», que es lo que en realidad pasó.
7. **Nada impide dos descuentos vigentes sobre el mismo producto**, y cuando
   pasa el origen aplica **uno solo y no dice cuál**.
8. **Sin tope al monto** (el campo es texto libre) y **sin CSRF**.
9. **La autoría se pierde.** `id_usuario` sale de la sesión del origen, así que
   todo lo que escriba el portal queda a nombre de una sola cuenta.

---

## 4 · Lo que el portal agrega, y por qué ahí

| lo que agrega | por qué no puede vivir en el origen |
|---|---|
| **En cuánto queda el precio**, y en rojo el que caería bajo el costo | el origen no conoce `product_precios`; un 60 % se teclea igual de rápido que un 25 % y sólo el precio resultante distingue una campaña de una venta a pérdida |
| **Aviso de solape** con otro descuento vigente sobre los mismos productos | el origen no lo mira, y cuando pasa aplica uno solo sin decir cuál |
| **Quién lo hizo** (`audit_logs`) | allá todo queda a nombre de la cuenta con la que el portal entra |
| **Alcance por sala** | el portal ya tiene permisos con alcance; el origen no |

**Los avisos NO bloquean: se confirman.** Un candado que espera a un tercero
produce el atajo (ver `feedback_una_verificacion_que_traba_la_accion_no_se_hace`),
así que quien decide confirma y sigue — y `confirmo_avisos: true` queda escrito
en la bitácora.

**Las tres verificaciones se cobran del lado del servidor**, no en el
formulario: un formulario se saltea cambiando el cuerpo de la petición. El
precio resultante se muestra además en vivo mientras se arma, porque verlo antes
es lo que evita el error; el que decide es el del servidor.

**El precio que se mira es el MÁS BAJO de las presentaciones del producto y el
costo el MÁS ALTO.** El peor caso es el que decide: un promedio escondería justo
la presentación que se vendería perdiendo.

---

## 5 · Cómo está armado

| pieza | qué hace |
|---|---|
| `supabase/functions/_shared/descuentos.ts` | el único sitio que habla con el origen: login, lista, detalle, guardar, borrar |
| `supabase/functions/descuentos-erp/index.ts` | permiso, alcance, las dos verificaciones y la bitácora |
| `src/data/descuentos.js` | la capa de datos del navegador |
| `src/views/promociones/TabDescuentos.jsx` | la lista, en tarjetas |
| `src/views/promociones/DescuentoModal.jsx` | alta y corrección, con el precio resultante en vivo |
| `get_precios_para_descuento(int[])` | precio y costo por producto, `RETURNS json` |

**Nada se lee de un rótulo.** El mapa `sala → id` se le pregunta al propio origen
(`cambio_sesion.php`) en cada corrida en vez de escribirlo a mano — es
`feedback_un_rotulo_no_es_una_clave` aplicado a un catálogo ajeno, que además
puede cambiar sin avisarnos. Y el tipo de descuento no sale de la columna
«Porcentaje»/«Descuento» sino del símbolo `%`/`$` del monto, que es el valor que
la base guarda.

**La pestaña carga sólo al abrirse.** Cada visita son varias peticiones a un
sistema ajeno, y quien entra a mirar el avance de una promoción de laboratorio
no tiene por qué pagarlas.

---

## 6 · La cuenta del origen — lo que costó descubrir

`descuentos-erp` empezó usando `ERP_PRODUCTS_CREDS` (las promociones viven en el
menú «Productos» del origen). **La lista funcionaba y el formulario no**: esa
cuenta puede leer `admin_promocion_dt.php` pero el origen NO le dibuja el
formulario — 16,056 caracteres contra ~33,000, con `promocionForm` ausente.

O sea que el módulo habría salido **medio funcionando**: ver sí, guardar no. Y
el modo de falla no habría nombrado la causa, porque `promocion.php?id=N` con esa
cuenta devuelve un 200 con título «Editar promocion» — que sin mirar el largo se
lee como la página correcta.

Por eso el código **distingue «no existe» de «no pude leer la pantalla»** y el
segundo mensaje dice cuántos caracteres vinieron y si el formulario estaba. Un
«ese descuento ya no existe» sobre un descuento que sí existe manda a buscar
donde no está.

El secreto correcto es **`ERP_PROMOS_CREDS`**, con una cuenta que tenga la
pantalla de promociones (la que se usó para auditar es `admin=1`, `id_usuario=32`).
`getPromosCreds` lo lee primero y cae a `ERP_PRODUCTS_CREDS` sólo para no romper
en un entorno donde no esté configurado.
