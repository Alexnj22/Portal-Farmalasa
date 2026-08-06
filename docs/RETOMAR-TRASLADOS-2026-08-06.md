# Retomar — Solicitud y traslado entre sucursales

**Escrito el 2026-08-06.** El sondeo está hecho y el bloqueante resuelto. Falta
construir. Este documento tiene todo lo necesario para empezar sin volver a
investigar.

---

## 1 · Qué se quiere

Una sala pide un producto que no tiene. La sala que lo tiene confirma. El
traslado se aplica. Es la cuarta operación de la familia que ya funciona
(solicitud → aprobación → aplicación), con una diferencia de fondo que cambia
el diseño — está en §3.

El punto de entrada natural ya existe: la lista **«Sin existencia, puedes
solicitar en estas sucursales»** de Consulta de Inventario (v2.443.0). Cada
renglón ya trae el producto, cuánto hay y en qué salas. Falta colgarle el botón.

---

## 2 · El ERP, mapeado

`traslado_producto.php`, JS en `js/funciones/funciones_traslado.js` (22 KB).

| `process=` | qué hace |
|---|---|
| `traerdatos` | trae un traslado guardado |
| `getpresentacion` | igual que en carga y descarte |
| `saving` | guarda un borrador y devuelve `id_traslado` |
| `insert` | **lo crea de verdad** |

Payload del `insert`:

```
process              insert
datos                id_prod|compra|venta|cant|unidad|vence|id_presentacion|id_lote#
id_traslado_guardado 0 si no viene de un borrador
cuantos, total, fecha, concepto
origen               la UBICACIÓN de donde sale (3 para Salud 1, etc.)
id_suc_destino       la sucursal que recibe
id_ubicacion_destino 0
numero_vale          obligatorio — ver abajo
```

El `datos` es el mismo formato de carga y descarte, así que sirve todo lo ya
aprendido: la presentación se resuelve por etiqueta «TIPO (FACTOR)», el costo y
el factor salen de `getpresentacion` y no de `consultar_stock`, y el lote va por
número + fecha.

### ⚠️ `numero_vale` — el bloqueante, ya resuelto

Es un `uniqid()` que **el servidor pre-rellena en el HTML** de cada carga:

```
vale 1 : 6a74d99cc0665
vale 2 : 6a74d99ce042b
vale 3 : 6a74d99d0ae2c
```

El JS lo valida y rechaza si viene vacío, pero nunca lo genera: lo lee del
campo. Así que **hay que hacer un GET de `traslado_producto.php` y sacarlo del
HTML antes de enviar** — exactamente el mismo patrón que el token del MH, que
tampoco se inventa: se lee de la pantalla que lo cachea.

No inventarlo. Un `uniqid()` propio puede colisionar con la numeración del ERP
y no hay forma de saberlo desde afuera.

### La segunda mitad

`recibir_traslado.php` existe: **el traslado se crea en origen y se recibe en
destino**. Falta mapear su payload — es lo único del ERP que queda por leer.

---

## 3 · La diferencia que cambia el diseño

En las tres operaciones anteriores, **quien pide es quien tiene el problema y
quien aprueba decide**. Acá no: quien pide es la sala que NO tiene, y el
traslado lo crea la sala que SÍ tiene.

Consecuencias concretas:

1. **La Edge Function cambia la sesión a la sala de ORIGEN**, no a la que pide.
   Es al revés de lo que uno escribe por inercia. Y como la sucursal es estado
   global de la sesión PHP (ver `RETOMAR-AJUSTE-INVENTARIO`), sigue valiendo:
   cada aplicación con su propio `login()`.
2. **Quien aprueba es la sala de origen, no Supervisión.** Es la única que
   puede decir "sí, me sobra". Es la primera de la familia donde el aprobador
   se resuelve por el DATO de la solicitud y no por un rol fijo.
3. **Son dos escrituras**: crear en origen y recibir en destino. Si la segunda
   falla, el producto queda en tránsito. Primero el ERP y después APPROVED
   sigue valiendo, pero «el ERP» ahora son dos pasos y hay que decidir si
   APPROVED exige los dos o solo el primero.

---

## 4 · Lo que ya está y se reusa

- `_shared/erp-dte.ts` — `login`, `pedir`, `conReintento`, `leerRespuesta`.
- `aplicar-movimiento-inventario` — el `cambio_sesion.php`, la resolución de
  presentación por etiqueta, la de lote por número + fecha, el presupuesto de
  110 s y la transcripción a ASCII del concepto. **Casi todo el cuerpo sirve.**
- `approval_requests` + sus triggers de aviso y validación: alcanza con un tipo
  nuevo y su rama.
- `get_faltantes_con_stock_en_otra_sala` — de dónde sale la solicitud.
- El mapa de ubicaciones por sucursal (§5.2 del otro traspaso).

---

## 5 · Orden sugerido

1. Leer `recibir_traslado.php` y su JS — es lo único que falta del ERP.
2. Tipo `INVENTORY_TRANSFER_REQUEST` en el CHECK de `approval_requests`, su
   validación (producto, cantidad, sala origen ≠ destino, y que la de origen
   siga por encima de su mínimo) y su rama en el aviso.
3. El aprobador: la jefatura de la sala de ORIGEN. Es lo nuevo — el resto de
   la familia usa un rol fijo.
4. Edge Function `aplicar-traslado-inventario`, partiendo de una copia de
   `aplicar-movimiento-inventario`: GET de la página para el vale, sesión en
   origen, insert, y después la recepción.
5. El botón en la lista de faltantes de Consulta de Inventario.
6. Una prueba con **una unidad**, ida y vuelta, confirmada en el kardex de las
   dos salas.

---

## 6 · Lo que no hay que repetir

Todo lo de `RETOMAR-AJUSTE-INVENTARIO-2026-08-06.md` §5 vale igual acá, y en
particular las tres que costaron caro:

- **`consultar_stock` devuelve el costo y el factor de la presentación POR
  DEFECTO.** Un traslado de «1 unidad» mandaría 100.
- **El stock viene en unidades base y la cantidad en la presentación elegida.**
  Compararlos crudos deja pasar imposibles.
- **El concepto viaja en ASCII.** El ERP relee los bytes como Latin-1 y un `·`
  sale como `Â·`.
