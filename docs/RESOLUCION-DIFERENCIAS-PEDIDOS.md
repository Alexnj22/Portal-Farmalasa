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

## Recomendaciones

1. **Desempate → cerrar sin acuerdo a la segunda vuelta.** El inventario queda
   como está (opción segura) y el desacuerdo queda con los dos motivos, visible
   para quien supervise. — **PROPUESTA, sin confirmar.**
2. **Presentación distinta → no agregar una cuarta decisión.** Es *faltante* de
   lo pedido y *sobrante* de lo llegado a la vez; la pantalla lo parte en esas dos.
   — **PROPUESTA, sin confirmar.**
3. **Dañado y vencido → devolver a bodega. APROBADA el 2026-08-12, con un
   agregado del usuario: el daño exige FOTO.** No es burocracia y el motivo es
   operativo — bodega decide con la foto si el daño amerita la devolución o si el
   producto todavía se puede vender, así que la foto es la única forma de que esa
   decisión no sea a ciegas. Implementado: `danado` sin foto no entra (lo frena la
   RPC con mensaje propio y lo garantiza un CHECK).
4. **Ventana del producto físico → pendiente visible con fecha; a los 7 días se
   convierte en PROPUESTA de devolución** (propuesta, no movimiento).
   — **PROPUESTA, sin confirmar.**
5. **Lote → el aviso se muestra siempre; la confirmación se pide sólo en
   controlados.** No hace falta lista a mano: la pantalla de traslado marca
   `data-regulado='1'`, así que la regla se apoya en ese dato.
   — **PROPUESTA, sin confirmar.** (La devolución ya vuelve con el mismo lote con
   el que llegó, y avisa cuando no puede.)

### Las otras dos decisiones del 2026-08-12

- **La recepción en bodega la confirma SIEMPRE una persona.** Nunca automática.
  Pero la solicitud tiene que **decir si el producto viaja**: si está en la sala,
  bodega confirma cuando lo tenga en la mano; si es sólo un arreglo en el sistema
  —el faltante que nunca salió de bodega—, lo confirma en el momento, sin esperar
  nada. Por eso `pedido_devolucion.viaja` existe y se pinta en la pantalla: sin
  ese dato, bodega espera una caja que no viene, o da por recibida una que
  todavía va en el camión.
- **Todo entra a la ubicación de trabajo de bodega**, también lo dañado y lo
  vencido. Bodega mueve después lo que no sirva. Es además la única entrada
  probada de verdad contra el sistema (el regreso del 2026-08-11 entró ahí).

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
   mercadería varada. **CONSTRUIDO el 2026-08-12; falta su prueba controlada.**
   Ver abajo.
2. El registro de la decisión + el lazo de acuerdo (sobre el molde de MIN·MAX).
3. La pantalla final del conteo.
4. Los tableros de los dos lados.

## Cómo se prueba

Igual que el traslado el 2026-08-11: **provocar cada rama contra inventario real
y comparar contra una foto previa** (existencia, costo, precio y lotes en las dos
salas). Guion en `docs/PRUEBA-TRASLADO-2026-08-11.md`; el regreso en
`scripts/qa/rollback-traslado.mjs`. Nada de esto se da por bueno leyendo código.

---

## Bloque 1 — la devolución (construido el 2026-08-12)

**Nace PAUSADA.** Los interruptores `devolver_enviar` y `devolver_recibir` están
en pausa con motivo «Sin estrenar», y la propia función los lee antes de tocar
nada. El freno vive ahí y no en una constante del navegador porque una pantalla
vieja en la pestaña de alguien seguiría llamando igual. Se levantan desde
Sistema › Mantenimiento cuando la prueba esté hecha.

### Las piezas

| Pieza | Dónde |
|---|---|
| Tabla, una fila por producto | `pedido_devolucion` (migración `20260812031736`) |
| Pedir / decidir | `solicitar_devolucion_pedido`, `decidir_devolucion_pedido` |
| Cerrar el renglón al entrar | `cerrar_item_por_devolucion` (sólo `service_role`) |
| El movimiento y su entrada | `devolver-pedido-erp` (`accion: enviar` / `recibir`) |
| Pantalla de la sala | `DevolverModal` |
| Pantalla de las dos partes | `DevolucionBloque`, dentro de las diferencias |
| Freno | `traslado_interruptor`: `devolver_enviar`, `devolver_recibir` |

Un movimiento **por producto**, con su clave `DEV-P<pedido>-S<sala>-I<renglón>`
primero en el concepto: es lo que permite encontrarlo entre los ~900 del pedido y
lo que se busca antes de reintentar una línea cortada, para no moverla dos veces.

El renglón del pedido se cierra **cuando el producto entró en bodega**, no cuando
la sala lo pide ni cuando bodega acepta. Antes de eso está en tránsito.

### El concepto: qué se escribe en el asiento

Definido el 2026-08-12, después de **medir dónde se lee** en el sistema:

- El detalle del traslado (`ver_traslado.php`) muestra producto, presentación,
  unidad, cantidad y destino. **No muestra el concepto.**
- El reporte imprimible (`reporte_traslado.php`) contesta **500 en todos** los
  traslados, también en los de 2025. Roto de antes, no por nosotros.
- El listado trae fecha, hora, origen, destino, usuario y estado.
- La columna «usuario» es **siempre la misma cuenta** —la del portal—, así que
  **el concepto es el único lugar donde aparece la persona real**.

De ahí la regla: **el concepto no repite nada que el sistema ya muestre.** Queda
`<clave> <qué pasó> <quién>`, en ASCII (el sistema relee los bytes como Latin-1 y
un acento sale partido en dos).

| Momento | Concepto | Largo |
|---|---|---|
| El pedido sale de bodega | `P102-S7-H1-I71445 env DOLORES TEJADA` | 36 |
| El pedido entra a la sala | `P102-S7-H1-I71445 rec Adriana Ramirez` | 37 |
| La devolución sale de la sala | `DEV-P102-S7-I71445 no llego pide Adriana Ramirez ok DOLORES TEJADA` | 66 |
| La devolución entra a bodega | `DEV-P102-S7-I71445 rec DOLORES TEJADA` | 37 |
| Traslado entre salas, sale | `pide Adriana Ramirez env DOLORES TEJADA` | 39 |
| Traslado entre salas, entra | `rec Adriana Ramirez env DOLORES TEJADA` | 38 |

Tres decisiones adentro:

1. **El pedido pasó de 75 a 36 caracteres.** Decía «Pedido 102 Salud 5 hoja 1
   \<producto\>»: el destino está en la pantalla, el producto en el detalle, y el
   pedido y la hoja **van dentro de la clave**. Se repetían 45 de 75 caracteres.
2. **La devolución nombra a las DOS personas** —quien la pidió en la sala y quien
   la autorizó en bodega— porque nada se mueve sin que las dos coincidan y el
   sistema no guarda ninguna de las dos.
3. **El nombre es el mismo que muestra el portal** (primer nombre + primer
   apellido, la regla de `shortEmployeeName`). Recortarlo a la inicial ahorra 8
   caracteres por persona y se puede hacer en una línea (`nombreCorto` en
   `_shared/erp-traslado.ts`), pero con dos «DOLORES» en la misma sala habría que
   abrir el portal para saber quién fue.

### Lo que ya se comprobó (2026-08-12, sin tocar inventario)

- La función está desplegada y exige sesión.
- **El freno frena**: con `simulacro:false` contesta `DEVOLUCIONES_PAUSADAS`
  antes de mirar nada.
- Las guardas de las RPC disparan: `ITEM_NO_EXISTE`, `MOTIVO_INVALIDO`,
  `DEVOLUCION_NO_EXISTE`, y `cerrar_item_por_devolucion` da *permission denied*
  para `authenticated`.
- Advisor de seguridad: **0 errores**.

### Lo que NO se comprobó y hay que provocar

1. **Un movimiento real de punta a punta**, contra una foto previa de existencia,
   costo y lotes en las dos salas. Ninguna escritura contra el sistema se
   ejercitó todavía.
2. **La rama «sólo bodega»**: la cuenta de QA tiene alcance TODOS, así que pasó
   el filtro por derecho propio y esa guarda quedó sin ejercitar. Se prueba
   acotando un rol un momento, como se hizo con el control de sala del traslado
   el 2026-08-11.
3. **La foto**: que se suba, que se firme y que se vea del lado de bodega.
4. **El lote**: que vuelva con el mismo con el que llegó, y que avise cuando no.

### Guion propuesto

Sobre **Salud 5** y **un solo producto**, igual que el 2026-08-11:

1. Foto previa: existencia por lote y costo promedio en Salud 5 y en Bodega.
2. Provocar la diferencia al recibir (contar de menos en un renglón).
3. La sala pide la devolución por «No llegó» → **no viaja nada**.
4. Levantar los dos interruptores.
5. Bodega acepta → el producto sale de la sala. Mirar el movimiento y su clave.
6. Bodega confirma la entrada → comparar contra la foto previa.
7. Repetir con «Dañado» (con foto) para ejercitar la rama que **sí** viaja.
8. Si algo sale mal: pausar `devolver_enviar` y dejar abierta la entrada, para
   poder cerrar lo que ya salió.
