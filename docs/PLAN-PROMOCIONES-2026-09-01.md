# Plan — Promociones por producto

**Fecha:** 2026-09-01 · **Estado: diseño cerrado con el usuario, cero código.**

Es la **Fase 4** de `docs/planes-cerrados/PLAN-METAS-2026-08-03.md` §9a, que quedó
escrita el 2026-08-04 con las capturas del Excel del usuario y nunca se
construyó. Aquel plan se archivó en `planes-cerrados/` el 2026-08-05 (commit
`832fc75e`) porque las Fases 1-3 estaban hechas — **su propia §10 decía que las
Fases 4 y 5 seguían pendientes**, y así estuvo un mes: otra vez
[[feedback_la_cabecera_de_un_plan_miente_con_mas_autoridad_que_un_checkbox]].

**El usuario las llama PROMOCIONES**, no bonificaciones. En pantalla se dice
promoción (regla del rótulo: el portal habla el idioma de la sala, no el del
documento). «Bonificación» queda para lo que gana cada persona.

Sucesor del módulo Promociones RETIRADO el 2026-07-28
([[project_promotions_module]]): **no se reusa nada de aquel**, sí su lección —
nada de cachés que nunca se llenan, todo se deriva de las ventas reales.

---

## 1. Lo que se midió antes de diseñar

Cinco mediciones contra producción, y **tres de ellas tumbaron un supuesto mío**.

### 1a. Las compras YA vienen en unidades base — se pueden comparar

`purchase_receipt_items.cantidad` no está en cajas: está en la misma unidad que
`sales_invoice_items.cantidad × factor_unidades`.

| | |
|---|---:|
| productos con >100 u. vendidas | 1,265 |
| razón comprado / vendido-en-base | **1.02** |
| ...dentro de la banda 0.5–2.0 | 1,235 (97.6%) |
| razón comprado / cantidad cruda | 2.58 |
| ...dentro de la banda | 957 |

Ejemplo que lo hace obvio: ACETAMINOFEN 500MG CAJA X 100 se compra de a
**5,000 a $0.0621** — seis centavos es una tableta, no una caja de cien.

Importa porque comparar lo comprado con lo vendido sin convertir sería
[[feedback_sumar_presentaciones_distintas_da_un_numero_sin_unidad]]. **No lo es.**

### 1b. Pero «lo comprado» NO se puede derivar de las compras

Ese fue mi error, corregido midiendo. Estos productos se compran **de rutina,
todos los meses**:

| producto | veces (mar–ago) | meses distintos | cantidad media |
|---|---:|---:|---:|
| LORALER 10MG X 100 TAB | 11 | 5 | 1,709 |
| ACETAMINOFEN 500MG CAJA X 100 | 9 | 5 | 5,556 |
| ORFENAFLEX -D DISPENSADOR | 7 | 5 | 2,000 |
| ZORRITONE TRADICIONAL X 100 | 7 | 5 | 2,200 |

Si el lote de la promoción se dedujera de las compras de la ventana, **un
reabastecimiento normal a mitad de promoción sube el techo y la promoción no se
acaba nunca**. O sea que el lote es un **número declarado** — lo que se negoció
con el laboratorio — y las compras reales sólo se muestran al lado, como ayuda
para llenarlo.

### 1c. La presentación se agrupa por FACTOR, nunca por su rótulo

Sobre las 39,329 líneas de venta de agosto 2026:

| | |
|---|---:|
| líneas | 39,329 |
| con `id_presentacion` | **0** |
| sin `factor_unidades` | **0** |
| etiquetas distintas | 283 |
| ...normalizadas (mayúsculas, espacios) | 217 |
| **factores distintos** | **29** |

El id de presentación es **NULL en el 100%** de las líneas: no se puede juntar
por ahí. Y las etiquetas están sucias — el mismo producto se factura como
`CAJA 1x100` y `CAJA 1X100`, y ORFENAFLEX AMPOLLA aparece como `CAJA  1X1` con
dos espacios. **El factor es lo único limpio**, y es lo que ofrece el selector.

Es [[feedback_un_rotulo_no_es_una_clave]] en su forma más pura: agrupar por el
texto habría partido en dos una presentación que es una sola.

### 1d. Las existencias están repartidas — «se acabó» no es una pregunta simple

ORFENAFLEX -D vive hoy en las **7 salas × 3 presentaciones × varios lotes**, con
`inventory.cantidad` en la presentación de cada fila (no en unidades). «Se acabó
en Salud 1» no es «se acabó en Bodega». Por eso el cierre por existencias se
descartó a favor del lote (§3).

### 1e. Los traslados son TRES circuitos, no uno — y su cantidad está en PAQUETES

Medido el 2026-09-01. Lo primero que hay que saber es que «traslado» nombra tres
cosas distintas, con tablas y estados propios:

| | qué es | dónde vive el renglón | dónde se confirma |
|---|---|---|---|
| **A** | Bodega despacha un pedido a una sala | `pedido_traslado_linea` (7,142) | `recibido_at`, escrito por la edge `trasladar-pedido-erp` en **5 sitios** |
| **B** | una sala PIDE a otra | **no hay tabla**: `approval_requests.metadata.items` (jsonb) | `metadata.erp_recibido` |
| **C** | una sala EMPUJA a otra | `envio_linea` (88) | `recibido_at`, edge `enviar-producto-erp` |

**El lote se mueve en los tres o se mueve en un tercio de los casos.**

⚠️ **La cantidad NO está en unidades base.** `pedido_traslado_linea.cantidad`
está en **paquetes comerciales** — verificado sobre las 7,069 líneas recibidas:
coinciden con «paquetes» en el **100%**, y **1,463 (21%) tienen factor > 1**. El
`COMMENT` canónico de `pedido_items` lo dice: *«cantidad_asignada en packs
comerciales»*. La conversión es:

```
unidades_base = pedido_traslado_linea.cantidad × COALESCE(pedido_items.factor, 1)
```

**`dispatch_factor` NO sirve para esto**, aunque se lea igual: la edge function
lo documenta como *«comodidad para armar las cajas —la "CAJA ×12" que se imprime
en la hoja—, no la presentación con la que el producto vive en el sistema.
Confundirlos mueve una cantidad distinta de la despachada.»*

`envio_linea` (flujo C) es el único que guarda **las dos escalas**: `cantidad` en
paquetes y **`unidades`** en base, con `factor` uniéndolas. Ahí se lee directo.

**Dónde colgar el efecto**: `pedido_traslado_linea` hoy tiene **cero triggers** y
está fuera de realtime — un `AFTER UPDATE OF recibido_at` no choca con nada. Y
tiene que ser un trigger y no la UI, porque **dos de los cinco caminos de
recepción entran por cron** (`reintentar-ingreso-pedido`, cada 10 min) sin que
haya un navegador abierto.

---

## 2. La forma de una promoción

Una promoción es **varios renglones**, y cada renglón es un producto con lo suyo:

```
Promoción «Orfenaflex septiembre»          1 sep – 30 sep
└─ Paill
   ├─ ORFENAFLEX -D DISPENSADOR   cualquier presentación   lote 4,500
   │     vendedor $1.00 · admón $0.25 · bodega $0.25
   └─ ORFENAFLEX AMPOLLA          caja ×1                  lote   130
         vendedor $1.50 · admón $0.25 · bodega $0.25
```

- **Se agrupan por laboratorio** en la pantalla. Una promoción casi siempre viene
  de uno; si mezcla dos, se ven como dos grupos. Se pueden agregar de a uno o
  «agregar todo un laboratorio».
- **Los montos son POR RENGLÓN**, no por promoción — productos de precios
  distintos pagan distinto. La promoción tiene un default que se copia al agregar.
- **La presentación hace DOS cosas**: filtra qué ventas cuentan **y** define la
  unidad de pago. «Caja ×100 · $1.50» es un dólar cincuenta **por caja vendida**,
  no por tableta. Con «Cualquiera» se paga por unidad base y cuenta todo.
- El avance contra el lote **siempre se muestra en unidades base**, que es la
  única forma de compararlo con la factura de compra (§1a).

---

## 3. Cuándo termina — las dos causas

Decisión del usuario: una promoción termina por **una de dos**, y hay que decir
cuál fue.

1. **Se vendió el lote.** El lote es lo declarado (§1b), repartido por sala (§4).
   Cuando lo vendido llega a lo asignado, el renglón cierra.
2. **Venció la fecha.** Cada renglón tiene su propio fin (§5).

**Cierra solo, y queda en bitácora** (elección del usuario). Un proceso diario
marca el renglón terminado con su motivo y su fecha, y avisa a Supervisión.
No espera a que alguien mire — [[feedback_una_alarma_que_espera_a_que_alguien_mire_no_cierra_el_circuito]].

**La promoción se finaliza cuando cierra su último renglón.**

Lo que se descartó: cerrar por existencias en 0. Es el estado real de las
bodegas, pero incluye lo que había antes de la promoción y lo que llegue
después, y está repartido en 7 salas (§1d) — daría una fecha de cierre que no
tiene que ver con la promoción.

---

## 4. El lote se reparte por sala

Al crear la promoción se reparte el lote, y **el portal valida que la suma
cuadre**:

```
Lote  500 unidades
  La Popular  120     Salud 3   80
  Salud 1     100     Salud 4   70
  Salud 2      80     Salud 5   50
              ─────
  repartido   500   ✓
```

Es una decisión comercial y queda escrita **antes de que se mueva una caja**. Se
descartó derivarlo de lo que Bodega despachó: hasta que no despacha, la sala no
tendría lote — y un despacho de rutina del mismo producto se contaría como
promoción (§1b otra vez).

**Se guarda el reparto ORIGINAL** aparte del vigente, porque los traslados lo van
a mover (§6) y hay que poder ver la desviación.

---

## 5. La fecha de fin es por producto, y la promoción se extiende

Cada renglón tiene su propio inicio y fin. Y la decisión del usuario sobre el
caso límite: **si un producto se extiende, la promoción se extiende**.

O sea que la vigencia de la promoción **no es un sobre que contiene a los
renglones: se deriva de ellos** — empieza con el primero y termina con el
último. Un renglón que se alarga alarga la promoción.

---

## 6. Los traslados mueven el lote

Cuando una sala le manda producto de la promoción a otra, el lote se mueve:
**baja en la que envía, sube en la que recibe, al CONFIRMAR la llegada** — no al
despachar, porque hasta que no llega la sala no lo puede vender (es lo que ya
hace `recibido_at`).

Son **tres enganches**, uno por circuito (§1e), y en el A y el B hay que
**multiplicar por el factor** antes de tocar el lote: su cantidad está en
paquetes, y compararla cruda contra un lote en unidades subcontaría el 21% de las
líneas.

```
Salud 3 → Salud 1 · 20 u. · confirmado
  Salud 1   100 → 120    (90 vendidas · 75%)
  Salud 3    80 →  60    (20 vendidas · 33%)
  total      500 → 500   (no cambia)
```

**El total de la promoción es invariante.** Queda en bitácora quién lo movió.

**Por qué cualquier traslado del producto mueve el lote, sin marcarlo:** el lote
es una *cuenta*, no un producto aparte. Las cajas de la promoción y las que ya
había en la sala son **físicamente idénticas** — cuando alguien vende una, la
factura dice «Orfenaflex, 1 unidad», no de cuál montón salió. Eso ya se acepta en
las ventas (cualquier venta del producto en la vigencia cuenta contra el lote,
porque no hay forma de distinguirla), así que pedir que alguien marque un
traslado como «de la promoción» sería **pedirle que distinga lo indistinguible**:
va a adivinar, y un olvido deja mal los dos números sin que nadie se entere.

Sin mover el lote, las dos pantallas mienten: la que recibió aparece pasada de su
lote cuando en realidad recibió producto legítimamente, y la que cedió aparece
floja cuando lo que hizo fue ceder.

---

## 7. El aviso: al 80% de SU lote

Cuando una sala vendió el **80% de lo suyo**, le llega el aviso — a la sala y a
Supervisión — y dice las tres cosas que hacen falta para actuar:

```
Salud 4 · te quedan 14 de 70 (80%)
  Orfenaflex septiembre
  Todavía hay en:  La Popular 62 · Salud 1 38
  → Pedir traslado
```

**Cuánto le queda, en qué salas sí hay, y a quién pedirle.** Segundo aviso al
100%. Supervisión los ve todos para poder mover producto a tiempo.

Un aviso que sólo dice «se te acabó» llega cuando ya no hay margen; por eso el
umbral es 80 y no 100.

---

## 8. El excedente NO se paga solo ni se niega solo

Decisión del usuario, y es la parte más fina del diseño: si el lote son 500 y se
venden 520, **esas 20 van a Supervisión**. Si aprueba, se pagan; si no, **queda
constancia del motivo**.

Mientras nadie decide, **se muestran aparte y no suman**:

```
Glenda Anaya
  del lote     398 u.   $398.00   firme
  excedente     12 u.    $12.00   por decidir
                       ────────
  hoy cuenta            $398.00
```

Nadie ve un número que después le baja. Al aprobar se suma; al negar queda el
motivo escrito y visible.

Esto evita el problema de cortar el bono en seco, que era la alternativa: **el
ORDEN de las ventas decidiría quién cobra**, y quien vendió el día 30 perdería
por llegar tarde, no por vender menos.

---

## 9. Lo que se hereda del bono de meta, y no se rediscute

`get_bono_meta_sala` ya resolvió estas preguntas y **se usan los mismos
criterios**, para que dos pantallas del mismo módulo no cuenten distinto:

- **Venta válida**: `estado NOT IN ('NULA','DTE INVALIDADO EN MH')` y
  `NOT EXISTS` en `ventas_sin_producto`.
- **Quién vendió**: `sales_invoices.cod_vendedor` → `employees.code`, ACTIVO.
- **Sin dueño**: si el código no da con nadie activo, esas unidades se muestran
  aparte y **su bono no se paga** — no se reparte entre los demás.
- **Interruptor**: `metas_bono_activo(ym)`. Hoy **apagado** — todo se calcula y
  se muestra como «se habría ganado», sin generar nada para pago.
- **Sin retroactividad**: montos y lista de productos van con fecha; editar
  aplica desde el día del cambio y no reescribe lo ya ganado.

---

## 10. Modelo de datos (borrador)

```sql
promociones (id, nombre, estado, nota, created_by, created_at, updated_at)
  -- estado: borrador | activa | finalizada
  -- la vigencia NO vive acá: se deriva de los renglones (§5)

promocion_renglon (id, promocion_id, erp_product_id,
                   factor_unidades,          -- NULL = cualquier presentación
                   inicio, fin,
                   lote_total,               -- declarado (§1b)
                   estado, cerrado_at, cerrado_motivo)
  -- cerrado_motivo: lote_agotado | fin_de_vigencia

promocion_renglon_tarifa (renglon_id, desde,
                          bono_vendedor, bono_adm, bono_bodega,
                          unidades_por_bono)   -- sin retroactividad (§9)

promocion_reparto (renglon_id, branch_id,
                   asignado_original,        -- lo escrito al crear (§4)
                   asignado_vigente,         -- movido por traslados (§6)
                   avisado_80_at, avisado_100_at)

promocion_reparto_mov (id, renglon_id, branch_id_origen, branch_id_destino,
                       unidades, traslado_linea_id, movido_por, created_at)

promocion_excedente (id, renglon_id, employee_id, unidades, monto,
                     estado, decidido_por, decidido_at, motivo)
  -- estado: por_decidir | aprobado | negado  (§8)
```

Reglas de la casa que aplican: RLS con policy explícita, escrituras por RPC
DEFINER con permiso, autoría server-side (`auth_employee_id()`, nunca la del
cliente), FK con índice, `created_at` en toda tabla.

---

## 11. Orden de construcción

1. **Base**: tablas + RPC de cálculo + el cierre diario. Verificado contra
   ventas reales **antes de mostrar nada**.
2. **Vista** `/promociones` con los canónicos y el contrato de vista completo
   (§12), más su módulo de permisos.
3. **Avisos** (80% y 100%) y el enganche con traslados.
4. **Excedentes**: la cola de Supervisión.

La Fase 5 del plan original —la **liquidación mensual unificada**, que suma por
persona el bono de meta + las promociones— sigue después y no entra acá.

---

## 12. Cómo se verifica (instrucción del usuario, 2026-09-01)

> «aplica a las nuevas vistas todo lo canonico, y design. comprueba siempre que
> sea asi»

`docs/CHECKLIST-VISTA-NUEVA.md` **antes** de escribir la vista. Después:

- **Canónicos de componente**: `GlassViewLayout`, `ViewTabBar`, `DataTable`/
  `DataRow`/`DataCell`, `LiquidModal` o `HojaMovil` (nunca `ModalShell` crudo),
  `LiquidSelect` (nunca `<select>`), `FilterBar`.
- **Contrato de vista** — lo que ningún gate ve, porque es una ausencia
  ([[feedback_canonico_de_componente_no_es_canonico_de_vista]]): ¿se busca? ¿se
  ordena? ¿se pagina? ¿dice que está cargando? ¿el vacío distingue *no hay datos*
  de *falló la consulta* de *tu cargo no tiene el módulo* (`42501`)?
- **La pestaña activa va en la URL** (`usePestanaEnUrl`), nunca en `useState`.
- **Gates**: `gate:design`, `gate:movil`, `gate:permisos`, `gate:borradores`
  (el modal de nueva promoción pasa los 6 controles → guarda borrador),
  `gate:perf`, `gate:eficiencia`, `gate:migrations`.
- **El barrido de `/promociones`** en WebKit iPhone 13, sus pestañas todas, y
  **abrir las capturas** — un cero no dice que se lea bien.
- **Otorgar el módulo** a los cargos que corresponda: que aparezca en el menú no
  significa que la consulta lo acepte.

---

## 13. Lo que este plan NO hace

- **No es el bono por laboratorio** (§9b del plan original: niveles, umbral por
  sala, montos globales). Es otra fase y otra pantalla.
- **No es la liquidación mensual** (Fase 5).
- **No toca MIN·MAX.** La migración `20260901165102` dejó anotado que una
  promoción infla la velocidad y «necesita una lista de campañas declarada a
  mano, que es otra decisión». Esta lista va a existir cuando esto esté
  construido, pero **conectarla al cálculo de MIN·MAX es una decisión aparte** —
  cambiar la fórmula reescribe el MIN/MAX de todo el catálogo a la vez.
