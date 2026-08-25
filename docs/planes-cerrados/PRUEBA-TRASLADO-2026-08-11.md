# Prueba real controlada del traslado automático — Salud 5

**Estado: TODO CONSTRUIDO Y VERIFICADO. Falta únicamente ejecutar esta prueba.**

Al cerrar el 2026-08-11 (v2.569.2) el circuito completo está en producción pero
**nunca se escribió de verdad en el sistema de origen**: todo lo verificado fue
con guardas que cortan antes o con transacciones revertidas. Esta es esa prueba.

El detalle de qué se construyó y por qué está en la memoria
`project_traslado_pedido_erp_2026_08_11`. Este documento es sólo el guion.

---

## Lo que se va a probar

1. Que al finalizar un pedido salga **un traslado por producto**, con su clave.
2. Que **recibir un producto suelto** lo mueva sólo a él y deje los otros en camino.
3. Que **recibir el resto** cierre el pedido.
4. Que el **regreso a Bodega** funcione y deje las existencias como estaban.

## Alcance acordado con el usuario

- Sucursal **Salud 5** (`erp_sucursal_id = 7`, ubicación 8, `branch_id = 29`).
- **3 productos**, no más.
- Se anota **existencia y costo antes y después** de cada uno.
- Al terminar, **rollback**: todo vuelve a Bodega.

---

## Antes de tocar nada

**Foto inicial.** Para los 3 productos elegidos, anotar en Bodega y en Salud 5:
existencia por lote y **costo promedio**. Sin esta foto el rollback no se puede
verificar — sólo se sabría que el producto volvió, no que volvió igual.

El costo importa por una razón concreta: **no está confirmado si el sistema
recalcula el costo promedio al recibir un traslado.** Si lo hace, el rollback
devuelve las unidades pero puede no devolver el costo. Hay que mirarlo.

## Lo que el rollback NO deshace

Decirlo antes, no después:

1. **El rastro queda.** Los dos traslados —ida y vuelta— quedan en el libro de
   movimientos y en el kardex para siempre. No se borran.
2. **El costo promedio puede no volver** (ver arriba).
3. **Si la vuelta se corta a la mitad**, el producto queda repartido entre las
   dos salas. Por eso el guion de vuelta se escribió *antes* de mover nada.

---

## El guion

### 1. Generar el pedido

Desde el portal, como Bodega, generar el pedido de Salud 5 **e imprimirlo** —la
impresión es lo que captura las hojas, y las hojas son la verdad de qué producto
va en cuál. Un pedido sin hojas confiables no despacha: el guardián lo frena.

### 2. Verificar las hojas

```sql
SELECT * FROM verificar_hojas_pedido('<pedido_id>', 7);
```

Tiene que dar confiable. Si no, **parar acá** — el problema es de la captura, no
del traslado.

### 3. Dejar sólo 3 productos

En la pantalla de finalizar, tercera hoja, poner en cero todo menos los 3
elegidos. Eso además ejercita el camino de «no se envía», que es el que Bodega
va a usar todos los días.

### 4. Finalizar

Salen 3 traslados, uno por producto. Seguirlos:

```sql
SELECT estado, clave, erp_traslado_id, aviso
FROM pedido_traslado_linea
WHERE pedido_id = '<pedido_id>' ORDER BY creado_at;
```

Cotejar en el sistema que la **clave** aparezca en el concepto de cada traslado.

### 5. Recibir UNO solo

Desde Salud 5, recibir un producto suelto. Verificar que:
- ese producto entra a Salud 5;
- **los otros dos siguen en camino**, no se recibieron de arriba.

Esto es lo que pidió el jefe del usuario y es el corazón de la prueba.

### 6. Recibir los otros dos

Confirmar la caja completa. El pedido cierra.

### 7. Volver todo a Bodega

```bash
node scripts/qa/rollback-traslado.mjs <pedido_id> 7            # muestra qué haría
node scripts/qa/rollback-traslado.mjs <pedido_id> 7 --ejecutar  # lo hace
```

Lee las líneas reales que se movieron —presentación, lote y cantidad— y arma el
traslado inverso. **No inventa nada**: revierte exactamente lo que salió, y lo
recibe en Bodega para que no quede en tránsito.

### 8. Comparar contra la foto inicial

Existencias **y costos**, en las dos salas.

---

## El freno de emergencia

Si algo sale mal a mitad de camino, poner la corrida en error detiene el cron
que la retomaría:

```sql
UPDATE pedido_traslado_erp SET estado = 'error'
WHERE pedido_id = '<pedido_id>' AND estado <> 'error';
```

Después se revisa con calma. El cron `continuar-traslados-pedido` corre cada
minuto y sólo adopta corridas que llevan 5 minutos quietas — ese umbral existe
para que no haya dos trabajadores a la vez, porque el id del traslado se deduce
comparando la lista de pendientes antes y después.

---

## Contexto que conviene tener a mano

- **La cantidad viaja con `erp_presentacion_id` y `factor`**, nunca con
  `dispatch_tipo`/`dispatch_factor` — esos son la comodidad para armar cajas.
- **Los pedidos #91–#97 no se reparan** (decisión del usuario): ya se generaron,
  imprimieron y enviaron. Ninguno pasa el guardián, así que terminan a mano.
- **Si un lote reservado ya no está**, se despacha con el que vence primero y
  queda anotado en `pedido_traslado_linea.aviso`. Es la decisión del usuario:
  quien levanta toma lo del estante, no consulta la reserva.
- **La repartición de lotes vive dos veces** (simulacro y despacho) y tienen que
  dar el mismo resultado. Si se toca una, se toca la otra.
