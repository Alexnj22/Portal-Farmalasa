# Resolución de diferencias del pedido — diseño para construir

Estado: **diseñado, sin construir.** Sale de la auditoría completa del módulo del
2026-08-11 (documento visual:
`https://claude.ai/code/artifact/fcb9c249-108c-4849-9a43-caf4ffc5c5b6`).

---

## El problema

El traslado es **todo o nada**: no existe recibir la mitad y volver después por el
resto. Así que la recepción ingresa la cantidad completa que salió de bodega, y
eso está bien — es la única forma de que ninguna unidad quede sin dueño.

Lo que falta es el paso siguiente. Hoy la diferencia se guarda en el portal y ahí
se queda: **nunca toca el inventario** (verificado: no hay ni una escritura hacia
el sistema desde `error_tipo` / `con_diferencia`). Si la sala contó 28 de 30, el
sistema sigue diciendo 30.

**Y casi siempre esos 2 están en bodega**: un faltante suele ser que se empacó
menos de lo que decía el papel, no que la mercadería se perdió. Por eso la salida
NO es recibir menos —eso haría desaparecer las unidades de los dos lados— sino
decidir, producto por producto, qué se hace con la diferencia.

> Una versión anterior de este análisis proponía pasarle al sistema la cantidad
> contada. Es técnicamente posible pero está mal, y lo corrigió el usuario.

---

## Los dos principios

1. **Nada se mueve sin acuerdo.** Un movimiento sin que las dos partes coincidan
   es peor que una discrepancia anotada: después hay que ir a buscar mercadería.
2. **Un pedido que no cierra es peor que una diferencia registrada.** Ya es la
   regla del módulo (cuando bodega manda menos, el ítem se cierra y el MIN·MAX lo
   vuelve a pedir). Se respeta en todo lo demás.

---

## El flujo (definido por el usuario)

La sala confirma **caja por caja** sin interrumpirse a discutir. Las diferencias
se acumulan. Al terminar todas las cajas aparece **una última pantalla** con todo
lo que no cuadró, y la sala decide por producto:

| Decisión | Cuándo | Movimiento |
|---|---|---|
| **Mantener lo que llegó de más** | La hoja decía 1, llegaron 2 | Traslado nuevo bodega → sala por la diferencia |
| **Pedir el producto físico** | Llegó en papel y sistema, no en la caja | Ninguno todavía; queda pendiente |
| **Devolver en el sistema** | No llegó y no lo van a mandar | Traslado de devolución sala → bodega |

Las tres salen como **solicitud a bodega**. Bodega acepta —y el movimiento se
hace— o rechaza con motivo. No se cierra hasta que las dos partes coincidan.

---

## Los seis flujos que faltaban

**Los dos primeros hacen daño; los otros cuatro son decisiones.**

1. **La devolución hay que recibirla en bodega.** Crea un traslado sala → bodega
   que también hay que recibir. Sin eso el producto queda en tránsito: fuera de
   la sala y todavía no en bodega. Es exactamente el error que tuvo el guion de
   rollback hasta que se le agregó la recepción.
2. **Sin desempate el pedido no cierra nunca.** «Hasta que ambos acepten» puede
   ciclar para siempre.
3. **La presentación distinta** no tiene salida definida.
4. **Dañado y vencido** existen en la pantalla pero no en las decisiones.
5. **«Pedir el producto físico» deja una ventana** donde el sistema dice que hay
   algo que no está.
6. **El lote puede no ser el de la hoja** (nuevo: desde que el traslado sale solo,
   si el lote reservado no está se despacha el que vence primero y queda `aviso`).

---

## Recomendaciones — PROPUESTAS, el usuario aún no las confirmó

**No construir sobre esto sin que las apruebe.**

1. **Desempate → cerrar sin acuerdo a la segunda vuelta.** El inventario queda
   como está (opción segura) y el desacuerdo queda con los dos motivos, visible
   para quien supervise.
2. **Presentación distinta → no agregar una cuarta decisión.** Es *faltante* de
   lo pedido y *sobrante* de lo llegado a la vez; la pantalla lo parte en esas dos.
3. **Dañado y vencido → devolver a bodega.** Argumento concreto: **bodega ya
   tiene ubicación de vencidos** (`inv_ubicaciones` de Bodega incluye
   `{"id":2,"isVencidos":true}`), y el movimiento es el traslado ya probado. Dar
   de baja en la sala necesitaría un motivo de ajuste que no existe, y el reclamo
   al laboratorio se hace desde bodega, que es donde entran las compras.
4. **Ventana del producto físico → pendiente visible con fecha; a los 7 días se
   convierte en PROPUESTA de devolución** (propuesta, no movimiento).
5. **Lote → el aviso se muestra siempre; la confirmación se pide sólo en
   controlados.** No hace falta lista a mano: la pantalla de traslado marca
   `data-regulado='1'`, así que la regla se apoya en ese dato.

---

## Qué hay ya (no reconstruirlo)

| Pieza | Estado |
|---|---|
| Mover mercadería entre salas | **Probado contra inventario real** (ida y vuelta idénticas) |
| Elegir presentación y lote | Existe — resuelve por factor, no por etiqueta |
| Recibir un traslado (suelto o por hoja) | Existe, con control de sala verificado |
| Interruptor de pausa | Existe (`traslado_interruptor`, v2.570.0) |
| Anotar la diferencia | Existe (`error_tipo`, `cantidad_problema`, `nota_diferencia`) |
| Pedir/aprobar con motivo de rechazo | **Existe el molde**: `minmax_change_requests` |

**La mayor economía: no inventar el mecanismo de aprobación.**
`minmax_change_requests` ya tiene la forma exacta —`requested_by`, `reason`,
`status`, `decided_by`, `decided_at`, `decision_note`—. Lo único que le falta es
la segunda vuelta, porque hoy es de una sola.

**Falta construir:** la pantalla de decisión al final del conteo, la ida y vuelta
entre sala y bodega, y que la devolución dispare su recepción en bodega.

---

## Los dos huecos por lado

- **Sala:** hoy termina de recibir y no tiene dónde ver qué quedó abierto ni qué
  contestó bodega.
- **Bodega:** no tiene dónde le lleguen estas solicitudes, y sobre todo **no tiene
  dónde ver las devoluciones que debe recibir**. Sin eso, la mercadería devuelta
  se queda en tránsito y nadie se entera.

---

## Orden sugerido

1. **La devolución con su recepción en bodega** — es lo único que hoy dejaría
   mercadería varada.
2. El registro de la decisión + el lazo de acuerdo (sobre el molde de MIN·MAX).
3. La pantalla final del conteo.
4. Los tableros de los dos lados.

## Cómo se prueba

Igual que el traslado el 2026-08-11: **provocar cada rama contra inventario real
y comparar contra una foto previa** (existencia, costo, precio y lotes en las dos
salas). Guion en `docs/PRUEBA-TRASLADO-2026-08-11.md`; el regreso en
`scripts/qa/rollback-traslado.mjs`. Nada de esto se da por bueno leyendo código.
