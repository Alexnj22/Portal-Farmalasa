# Cobro de una preventa en la caja: cómo lo hace el sistema de origen (2026-11-17)

Levantado para conectar el botón **Cobrar** del kiosco de caja (Salud 4).
Fuente: `js/funciones/venta.js?v=1792445123` y `js/funciones/dte_auto.js?v=1783199662`
del sistema de la caja, leídos tras un cobro real de prueba hecho por el usuario
con la cuenta de la jefe de sucursal de Salud 4.

Venta de prueba: `erp_invoice_id 415125`, COF `0000081022_COF`, $0.70, vendedor
203, cliente YNES ANTONIO ARDON, sellada por MH (`recibido_mh` de 40). El
usuario la anula después.

## El cobro lo orquesta el NAVEGADOR, en pasos sueltos

Todo va contra `venta.php` (POST `application/x-www-form-urlencoded`, sesión PHP):

1. **Cargar la preventa** — `process=cargar_data&n_ref=<id preventa>&fecha=<fecha>`.
   Llena la tabla, el cliente, el vendedor y el tipo de documento.
2. **Guardar la factura (F2 Pagar → `senddata`)** — `process=insert` con:
   `cuantos, fecha_movimiento, id_cliente, total, id_vendedor, json_arr, retencion,
   total_percepcion, iva, items, subtotal, sumas, venta_exenta, suma_gravada,
   tipo_impresion, id_factura, id_apertura, turno, caja, credito (=tipo de pago),
   codvende, datos_extras, medico, totalDescuento, aplica_farmalasa`.
   `json_arr` = un objeto por producto: `id_detalle, id, precio, cantidad,
   unidades, subtotal, id_presentacion, exento, id_lote, precio_seleccionado
   (precio|precio1|precio2|…), id_promo, descuento_promo, descuento_tipo`.
   `aplica_farmalasa=1` si algún producto usa `precio`, `precio1` o `precio2`.
   Responde `{typeinfo:'Success', id_factura, ultimo, numdoc, nombre, direccion, nit, nrc}`.
   `id_apertura`, `turno` y `caja` salen de campos ocultos del formulario
   (el servidor los toma del formulario, no de la sesión — ya medido el 28-ago).
3. **Finalizar con el efectivo (Enter en «Efectivo» → `imprimev`)** —
   `process=imprimir_fact&numero_doc&tipo_impresion&num_doc_fact=<id_factura>
   &numero_factura_consumidor&fecha_fact&direccion&nombreape[&nit&nrc si CCF]
   &id_cliente&efectivo`. Responde `{success, facturar, dir_print, sist_ope,
   headers, footers, deshabilitar}`.
4. **DTE** (si se elige «DTE y ticket»), en `dte_auto.js`:
   `_helper_dte_class.php process=creaJsonDTe&id_factura&tipodoc&anula=0` →
   `generar_dte.php process=get_dte` → token (`cnx_mh.php save_token`) →
   `proxydte.php` (envío a MH) → `generar_dte.php process=save_response_mh` →
   `dte_factura_pdf.php` y `updateCorrelativoDTE`.
5. Ticket: POST a la impresora local `http://<dir_print>/printpos1.php`.

## Lo que importa para el portal

- Si el navegador se cierra entre 3 y 4, la factura queda **finalizada sin
  DTE**. Eso ya lo cubre `regularizar-dte` (22:30). El kiosco puede hacer 1–3
  en una edge function y el DTE con el mismo camino que usa `regularizar-dte`,
  en vez de repetir el paso 4.
- El adaptador ya existe: `supabase/functions/_shared/preventaCaja.ts`
  (sesión, buscar, enviar y borrar preventas). El cobro va ahí, como una pieza
  más; `preventa-caja` es el modelo de freno por sucursal.
- Falta medir: qué devuelve `cargar_data` (HTML o JSON) para armar `json_arr`
  sin la pantalla; y si `imprimir_fact` exige que el cliente y el número de
  documento coincidan con lo del paso 2.
