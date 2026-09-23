# Plan: verificar y dejar bien lo que quedó de las vacaciones (2026-09-22)

Sale del reporte del 22-sep (del 6 al 22 de septiembre). Cada punto tiene lo
**medido** que lo abre, cómo se **verifica antes** de tocar nada, la
**corrección**, y cómo se **verifica después**. Un punto no se cierra con «compila»:
se cierra con la misma medición que lo abrió, ahora limpia.

**Escrituras en producción** (datos, DDL, anular algo en la caja): cada una se
pide por separado y en el momento, con el alcance exacto. Están marcadas 🔒.

Estado: ⬜ pendiente · 🔎 verificando · 🔧 corrigiendo · ✅ cerrado · ⏸ espera decisión

---

## A. Lo que hoy le falla a alguien

### A1 ✅ Buscar un producto en Ventas con rango de un año se cae

- **Medido:** `get_ventas_con_receta` + `get_ventas_receta_stats` → 500 por
  `statement timeout` (~28 s). 47 pares el 21-sep (10:15–15:30 SV), 16 el 19.
  Búsquedas: EXFORGE HCT, CLOPERA, predial plus, modusi, imot, metglital le.
  Todas con `p_fini=2026-01-01`, `p_ffin=2026-12-31`, todas las salas.
- **Verificar antes:** reproducir con `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS)`
  con esos argumentos; ubicar el nodo donde estimado y real se separan. Mirar
  si es la trampa 1 (genérico a la 6ª), la 4 (`sql`+`SET`) o un `ILIKE` sin
  índice de trigram sobre lo que se busca.
- **Corregir:** la función (🔒 migración) y/o el frontend si pide de más.
- **Verificar después:** las 6 búsquedas reales bajo 2 s; 0 filas de
  diferencia contra el cuerpo viejo en rangos chicos; `gate:perf` la declara.
- **Cerrado (v2.1025.0):** el planificador suponía 1,000 coincidencias y
  barría el año por fecha. `= ANY (ARRAY(…))`: sin coincidencias 4,718 → 9.7 ms,
  9 huellas idénticas antes/después (`20260922145014`). Por decisión del
  usuario la búsqueda encuentra también el producto (`20260922145219`): las 6
  del 21-sep dan 109/8/29/6/6/46 facturas en 5–22 ms. Mínimo de 3 letras en
  pantalla (con 2, la búsqueda sola tarda ~8 s).
- **Reabierto y cerrado otra vez (v2.1025.3):** la medición de arriba era como
  `postgres`. Como usuario la búsqueda seguía en 15 s por el RLS (`textlike` no
  es leakproof y no entra al índice bajo la policy). DEFINER + alcance de la
  policy en `alcance_de_ventas()`: 15,143 → 31 ms. **Lección: medir las
  funciones que llama el portal como `authenticated`, nunca sólo como
  `postgres`.**

### A2 ✅ Llamadas que llegan sin sesión (`permission denied` diario)

- **Medido (21-sep):** `soltar_push_del_equipo` 302, `mis_permisos_heredados`
  97, `employees` 25, `bolsas` 18, `get_cortes_por_embolsar` 16,
  `get_kiosk_auth_code` 9, `get_bitacora_dia` 4, `touch_session` 2, y sueltas.
  Todas son `authenticated`-only: llegan como `anon`.
- **Hipótesis del push:** en `doLogout`, `soltarPushDelEquipoSiEsCompartido`
  espera la suscripción del service worker y recién después llama al RPC;
  para entonces `signOut` ya borró la sesión. Consecuencia: en una computadora
  compartida los avisos de quien salió siguen cayendo ahí.
- **Verificar antes:** contar en `push_subscriptions` los equipos «de
  navegador» ligados a alguien sin sesión viva; leer los otros callers para
  ver si es la misma carrera (logout/vencimiento) u otra.
- **Corregir:** soltar ANTES de `signOut` (esperar el RPC con tope), y que
  los fetch de arranque no salgan sin token.
- **Verificar después:** al día siguiente, los `permission denied` del log
  por función; objetivo ~0.
- **Corregido (v2.1025.1), falta la medición del día siguiente:** confirmado en
  el log — en el minuto de cada cierre, la misma IP manda `soltar_push` y
  `mis_permisos_heredados` con 401. `soltar_push`: 300 de 361 fallaban. El
  token se toma antes del primer `await` y va por `fetch`; el oyente de
  `visibilitychange` espera un tick. **Queda como ruido** (no se tocó): las
  vistas que recargan al volver a la pestaña (bolsas, conteos,
  `get_cortes_por_embolsar`) también salen con 401 cuando esa vuelta cierra la
  sesión — ~50/día, sin daño.
- **Medido el 23-sep (08:30 SV):** `soltar_push_del_equipo` 302 → **61** en 24 h,
  y 44 de esas 61 son de las 3 h antes del despliegue (15:00 UTC); después, 17
  en el resto del día — muy probablemente pestañas con la versión vieja, que no
  se recargan solas. `mis_permisos_heredados` 97 → 16. Falta ver una tarde
  entera de hoy para confirmar el residuo.
- **Cerrado con el día hábil del 23-sep (06:00–18:00 SV):** `soltar_push_del_equipo`
  **0** (302 el 21-sep) y `mis_permisos_heredados` **1** (97). Lo que queda son ~50
  al día, el ruido que ya estaba anotado: vistas que recargan cuando la sesión ya
  se cerró sola (bolsas y conteos, las metas del Inicio, y Solicitudes: el listado
  de `approval_requests` falla por `employees` porque su policy la consulta, y
  `requests.js` busca aprobadores por sala). Todas llegan como `anon` en el mismo
  segundo, y `employees` venía igual antes (25, 38, 18): no lo produjeron las
  tandas de permisos del 22 y el 23.

### A3 ✅ Movimiento de caja duplicado DESPUÉS de los frenos del 17-sep

- **Medido:** `gate:cortes` — Salud 5, 20-sep, «Aplicación de inyección» $1.00,
  filas 1930/1931 a 10.7 s. Los frenos cortan pares a ms; 10.7 s puede ser
  real (dos inyecciones) o un camino nuevo.
- **Verificar antes:** quién, desde qué pantalla, `clave_envio`, foto/boleta,
  si hubo contra-movimiento, y si en la caja hay dos ventas de inyección.
- **Corregir:** si es real → declararlo en el gate con su motivo. Si es un
  camino sin freno → cerrarlo.
- **Cerrado:** son DOS aplicaciones reales. `clave_envio` distinta (dos
  aperturas del diálogo, no el envío doble) y el corte de las 12:55 que las
  abarca cerró en $0.00: los $2 estaban en el cajón. Declarado en
  `DUPLICADOS_YA_PASADOS` con su motivo; `gate:cortes` en verde.

### A4 ✅ Hacienda: dos documentos rechazados que el circuito no arregla

- **Salud 2, CCF 65** (factura 368299, $16.05, **del 7-sep**): crédito fiscal
  a un cliente «Consumidor» sin NRC. El circuito no escribe NRC.
- **La Popular, factura 62982:** `subTotal = 0.050000000000001`, redondeo del
  JSON que arma el origen.
- **Verificar antes:** la ficha del cliente, los renglones de la 62982, y si
  hay más documentos con la misma forma (flotante / CCF sin NRC) en 90 días.
- **Corregir:** decisión del usuario — anular y reemitir, completar el NRC,
  o redondear antes de transmitir. Y que un rechazo que el circuito NO puede
  arreglar **avise**, en vez de quedar 15 días en silencio.
- **Decisión del usuario:** los dos documentos los resuelve él. La 62982 ya
  tiene sello en el origen (reintento del 22-sep 09:40: «ya está validada por
  MH»); falta que el sello llegue al portal con el próximo repaso.
- **Aviso (v2.1026.0):** `avisar_rechazos_sin_arreglo()`, cron
  `avisar-rechazos-mh-8am-sv`, una vez por documento con más de 2 días
  rechazado, a quien edita Facturación. El aviso técnico que existía había
  salido 16 días a una sola persona de vacaciones, 0 leídos.
- **Verificado el 22-sep (tarde):** `dte_rechazos_vigentes` vacía. El CCF 65 de
  Salud 2 (factura 368299) ya tiene sello válido (actualizado 16:00 UTC), y La
  Popular no tiene ni un documento sin sello válido en 90 días (0 de 11,130).

---

## B. Deuda de la caja que quedó abierta

### B1 ✅ Salud 2 (no Salud 1), boleta 000467 (5-sep): $12.30 anotados dos veces

- Dos filas vivas y dos movimientos vivos en la caja (44117 y 44118).
  Anular uno es lo que falta para poner el índice único de boleta.
- **Verificar antes:** que la sala no lo haya cuadrado ya con un
  contra-movimiento (si lo hizo, anular descuadra).
- **Ya estaba resuelto** (v2.1023.15, que corrigió la sala): la sala lo
  compensó el mismo día con una salida de $12.30 y el corte cerró exacto.
  Anular ahora descuadraría la caja; está declarado en el gate. El reporte del
  22-sep lo tomó de un commit anterior a esa corrección.

### B2 ✅ Salud 4, faltante −$41.85 del 8-sep (real, para la sala)

- **Verificar:** que el faltante sea real y no una cuenta del portal (cobros
  de crédito, vales, movimientos borrados ese día). Si es real, sólo se informa.
- **Es real y no es del portal.** El conteo de las 21:00 (confirmado por Kevin
  Zamora) da −$0.25 contra el esperado de la caja; los otros −$41.60 son dos
  cobros de crédito en efectivo de las 14:52 y 14:57 (Jonathan Melgar, $22.85
  y $18.75), vivos en el portal y en la caja, que la caja no suma al esperado
  (regla medida el 2-sep). Ese efectivo no estaba en el cajón, y ningún corte
  del 9 o del 10 muestra un sobrante que lo compense. Pregunta para la sala.

---

## C. Verificar que lo arreglado del 14 al 17 funciona en producción ✅

Medido el 22-sep:

| arreglo | resultado |
|---|---|
| ráfaga al recibir pedido | corregido en código; ya no aparece entre las rutas más pedidas del log |
| índice `puntos_enviados` | `puntos_anotar_aplicado`: 41 ms de media, peor 1.3 s (antes hasta 97 s) ✅ |
| `sync-puntos` en horario | `* 12-23,0-5`, 0 corridas de madrugada desde el 15 ✅ |
| alarma de reinicio | el reinicio del 15-sep 17:47 se avisó (1 destinatario) ✅ |
| borrado de abono | 3 correcciones aprobadas desde el 15; crédito 2405 en $0.00 ✅. La del 19-sep destapó que el abono NUEVO no se anotaba → corregido (v2.1025.2) y la fila faltante agregada con OK del usuario |
| aprobar días en bloque | **no se puede verificar**: horarios y marcaciones nunca arrancaron (0 turnos, 0 horarios, 0 marcaciones, `timesheets` vacía). El arranque estaba previsto para el 31-ago |
| doble toque en caja | 0 ráfagas <1 s en 457 movimientos desde el 17 ✅ |
| boleta repetida | 0 boletas repetidas desde el 17 ✅ |
| lectura de la foto | 286 de 286 movimientos con foto quedaron leídos ✅ |
| costo de IA | 117 llamadas/día, ~117 tokens de pensamiento de promedio (antes ~2,000) ✅ |
| pedidos #121 #133 #174 #178 #180 | los cinco `completado` ✅ |
| «no reenviar» | todavía sin uso |

Cualquier fila que no dé lo esperado se vuelve un punto A.

---

## D. Carga y gates en rojo

### D1 ✅ `gate:perf` — 5 hallazgos, cerrados

- **Cierre de `refresh_primera_venta_producto` (22-sep, decisión del usuario):**
  ni techo más alto ni tabla incremental. La incremental sería INCORRECTA: un
  `LEAST` no sabe mover la primera venta hacia adelante cuando se anula la
  factura que lo era. Lo que estaba mal era la regla: una reconstrucción sobre
  el historial entero crece con él por definición. Las tres que lo son pasaron
  a techo proporcional (`crece_con` + `bloques_por_mil_filas`): la primera venta
  101 (medido 77.3), la última venta 207 y la actividad por cliente 422 (el
  techo fijo que ya tenían, sin aflojar). La ventana fija de 180 días
  (`refresh_product_sales_rollup`) sigue con techo fijo. `gate:perf` en verde y
  las dos regresiones fabricadas (ratio corto, ratio faltante) fallan.
  De paso: `sales_invoice_items` nunca fue analizada (`reltuples` 48,000 filas
  atrás, `n_live_tup` 7,837) — por eso el gate cuenta exacto.

- `get_product_sales_agg_jsonb` 1,535 MB contra techo 914.
- `refresh_primera_venta_producto` 388 contra 359.
- `get_product_sales_total` 315 MB y `get_ventas_con_receta` 198 MB, sin
  declarar (la 2ª se resuelve con A1).
- `donde-hay-un-producto` 30.71 contra 30 ms.
- **Ojo al medir:** la estadística es desde el 17-sep 19:01 y mezcla llamadas
  de antes y después del arreglo del 17. Resetear sólo esas y remedir antes
  de concluir.
- **Estado 22-sep:** `get_product_sales_total` y `get_ventas_con_receta` ya no
  aparecen (A1 + estadística reseteada). Quedan:
  - `get_product_sales_agg_jsonb` — ✅ **aplicada en F5** (v2.1026.6, migración
    `20260922164443`): los renglones del mes en curso se leen una vez. 12/12
    idénticas como usuario; −32% en el caso por defecto (187k → 128k bloques),
    −21% en un año. Quedaba sobre el techo (998 MB contra 914): 54k bloques eran
    leer los renglones del mes factura por factura. **F5b** (v2.1026.7,
    `20260922165346`) los lee por RANGO de `invoice_id` —los ids del mes son
    casi contiguos— y queda en **670 MB**, bajo el techo. 12/12 idénticas otra
    vez. Estadística reseteada el 22-sep 16:54 UTC. ✅ **Confirmado el 23-sep:
    263 MB** de promedio sobre 25 llamadas reales (techo 914). Antes: confirmar el promedio
    con tráfico real en `gate:perf`.
  - `refresh_primera_venta_producto` 388 vs 359 MB — **el único hallazgo de
    `gate:perf` que queda al cierre del 22-sep**, y es previo a este plan.
    Rehace `mv_primera_venta_producto` (primera venta por producto y sala) una
    vez al día sobre el historial entero, así que su costo crece con la historia
    y va a volver a cruzar cualquier techo. No se le sube el techo —el
    manifiesto dice que sólo bajan—: la decisión es del usuario entre dejarlo
    declarado como lo que es (un barrido diario que crece) o pasarlo a una tabla
    mantenida incrementalmente (`LEAST` sobre la primera venta al llegar cada
    factura), que es trabajo de diseño aparte.
  - `get_product_sales_total` — declarada el 22-sep con su medición (55,867
    bloques con alcance total, 13,248 con alcance de sala). **La técnica del
    rango de facturas de F5b la EMPEORA** escrita como subconsultas escalares
    por rama: 55,867 → 375,437 bloques. Si se retoma, hay que copiar la forma
    que funcionó (CTE materializado con las facturas del período y join contra
    él), no el predicado suelto.
  - `donde-hay-un-producto` 30.5 vs 30 ms — ✅ **resuelto en F4** (v2.1026.4):
    casi todo era `traslados_en_vuelo()` (28 ms), que abría el jsonb de TODAS
    las solicitudes de traslado de la historia (1,388, crece sola). Prefiltro
    exacto por `updated_at` (migración `20260922163723`): 32.5 → 2.3 ms, y
    `donde-hay` como usuario 35 → 9 ms.

### D2 ✅ Las más pesadas: `get_product_drill_summary` / `_lines`

- 5.1 y 4.4 GB por llamada, peor 11.7 s. Auditadas el 4-sep con una salida
  que «exige medir un punto de cruce». Medir ese punto y decidir.
- **Cerrado (v2.1025.3):** la auditoría del 4-sep midió con literales; la
  función era `sql`+`SET` (trampa 4). Pasó a plpgsql + force_custom_plan y a
  DEFINER: un año 683,904 → 73,262 bloques, 12/12 idénticas. Techos bajados en
  `bloques-por-llamada.json` y fuera de `planes-genericos.json`.

### D3 ✅ `gate:eficiencia` — escrituras sin inserción 1,380/h (tope 1,240)

- Ubicar la tabla (`n_tup_upd` vs `n_tup_hot_upd` desde el arranque) y el
  writer que reescribe filas sin cambio. Patrón `IS DISTINCT FROM`.
- **Corregido (v2.1025.4), falta que la ventana de 6 h del gate lo mida:**
  `cortes_caja_movimientos` (561/h) — `sync-cortes-caja` refrescaba `visto_at`
  de todo el día en cada repaso. Ahora sólo si tiene más de 30 min.
- **Medido el 23-sep:** el arreglo de cortes funciona (marcas de 4 a 15 min
  de edad, no de 5). Pero el gate sigue en rojo, **2,104/h** sobre 24 h, y ya
  no es por cortes: la ventana larga mete entero el latido de las 6 cajas de
  impresión (hasta 720/h, acotado a uno cada 30 s por diseño; la pantalla
  necesita un latido de menos de 2 min) y los recálculos nocturnos
  (`product_stock_params` 5% HOT, `product_sales_rollup`, `product_last_sale`).
  El gate lo tiene escrito como pendiente: declarar ese churn INTENCIONAL con
  su motivo y bajar el tope a lo que quede. Para eso hace falta que la lectura
  guarde el desglose POR TABLA — hoy guarda sólo el total y no puede decir de
  quién es una subida. ⏸ trabajo del gate, no del portal.
- **Hecho el 23-sep (gate):** la lectura guarda el desglose POR TABLA y el
  desglose que se imprime es el de la ventana juzgada, no el de siete días.
  Seis tablas declaradas en `CHURN_INTENCIONAL`, cada una con un techo
  estructural en vez de un número medido: el latido de las cajas (120 por caja
  por hora), el reloj de repaso de cortes (20 por sala por hora) y los cuatro
  recálculos nocturnos (como mucho una reescritura completa por día). Salen del
  tope; el resto se juzga contra 1,240. Probado con una ventana fabricada de 7 h:
  el latido desbocado y una tabla vigilada reescribiéndose fallan con su motivo,
  el rollup dentro de su techo pasa. Con los números desde el arranque, lo
  vigilado ronda ~280/h sin cortes.
  **Falta la primera ventana real de 6 h** (lectura anotada 14:40 UTC → se
  puede juzgar desde las 20:40 UTC, 14:40 SV). Si da verde, D3 se cierra, y
  bajar el tope a lo que mida el resto queda como mejora aparte.
- **Cerrado el 23-sep (primera ventana real, 6.4 h):** **647/h** contra 1,240,
  y aparte 919/h de churn declarado, todas las tablas dentro de su techo (el
  latido de las cajas, 697/h contra un techo de ~720). Lo que más escribe entre
  lo vigilado: `inventory` 141/h, `session_last_seen` 102/h, `auth.users` 87/h.
  El gate quedó rojo esa tarde por OTRA cosa: «`cierre-automatico-caja` no
  corrió en 24 h», un cron creado ese mismo día a las 12:05 SV cuya ventana
  empieza a las 17:00 SV — falso positivo de un cron con menos de un día de vida.

### D4 ✅ Realtime publica `inventory_sync_log` — NO se saca

- Pendiente del informe del incidente. Verificar si alguna pantalla se
  suscribe; si no, sacarla de la publicación (`lock_timeout`).
- **Verificado: SÍ se suscriben** `SidebarSyncStatus` (INSERT) y `useSyncMonitor`
  (INSERT con success=false). Sacarla los rompe. Lo que sí sobra: la barra
  lateral re-consulta por HTTP en CADA evento (~6/min por pantalla abierta),
  cuando el evento ya trae la fila — ver D5.

### D5 ✅ La barra lateral re-consultaba en cada evento del sync

- 5,763 peticiones en 12 h el 21-sep. Ahora aplica la fila del evento (v2.1026.1).

### D6 ✅ `reclamar_impresion`: 7,400 llamadas/h, 189 bloques cada una — resuelto en F3

- El agente de cada caja pregunta cada ~3 s y el `UPDATE … estado='IMPRIMIENDO'`
  recorre toda la historia de la sala (461 filas, 205 bloques) porque ese
  estado no tiene índice parcial. 1.2 TB tocados en 4.6 días.
- ✅ Aplicado el 22-sep como F3 (v2.1026.5, migración `20260922163913`):
  índice parcial `idx_cola_impresion_imprimiendo`. **206 → 5 bloques** por
  llamada. Lo vigila `plan-cola-impresion-trabada` en la sección C de
  `gate:perf`.

---

## E. Menores

- **E1 ✅** «Esa sala no tiene una caja registrada para imprimir» ~27/día: es
  POR DISEÑO — `encolar_impresion` rechaza y el portal lo toma como «este camino
  no está» y abre el diálogo de impresión. Ruido en el log, no una falla.
- **E2 🔎 (v2.1028.1 + 20260923143322)** — la mitad de «Por revisar» seguía rota; ver abajo:
  Sale de la corrida nocturna de fichas (21:30):
  - **«Por revisar» no guarda NADA desde el 23-ago**: el motivo
    `sin_numero_erp` manda `erp_id: null` y la tabla lo exige NOT NULL con
    clave `(erp_id, motivo)`; esa fila tumba el lote de 25 cada noche
    (`a_revisar_no_guardados` = 25 en todas las corridas). Corrección: aceptar
    `erp_id` nulo con índice único parcial `(customer_id, motivo) WHERE erp_id
    IS NULL`, `upsert_clientes_por_revisar` en dos sentencias, y reintento
    fila por fila en la edge function (como ya hace el espejo).
  - **`fusionar_cliente_duplicado` sólo mueve `sales_invoices`.** Desde el
    17-sep falla cada noche con `creditos_de_clientes_customer_id_fkey`; y de
    las 16 FK a `customers`: créditos/pagos/puntos FRENAN el borrado,
    `cotizaciones` y **`bitacora_dispensaciones`** quedan en NULL, y
    **`consentimientos_cliente`**, `dte_datos_pedidos` y otras se BORRAN en
    cascada. Corrección: mover todas las referencias a la ficha buena antes de
    borrar; si la huérfana tiene puntos, no fusionar y mandarla a «Por revisar».
  - Los 3 `customers_nit_idx` son NIT repetidos: el espejo ya reintenta fila
    por fila y los nombra (no pierde las buenas).
  - `sincronizar-fichas-clientes` ignoraba el `error` de DOS `select` (el de la
    factura y el del dueño del número) — corregido.
  - **Lo aplicado:** `erp_id` nullable + índice único parcial por ficha, upsert
    en dos sentencias, reintento fila por fila en la edge function, la fusión
    mueve las 16 referencias (y no fusiona si hay puntos: `fusion_con_puntos`).
    Probado contra producción con rollback. **Corrida del 22-sep (21:30 SV), medida el 23:** las fusiones entran
    (4, 0 fallidas), pero `a_revisar_no_guardados` siguió en **26 de 26**: el
    vaciado de la temporal era un `DELETE` sin `WHERE` y `safeupdate` lo
    rechaza bajo el API («DELETE requires a WHERE clause»). La prueba «con
    rollback» se hizo como `postgres`, donde `safeupdate` no está — la misma
    lección de A1. Corregido con `TRUNCATE` (`20260923143322`).
    **Falta ver la corrida de esta noche
    (21:30 SV)**: que `a_revisar_no_guardados` sea 0 y que las fusiones entren.
- **E3 ✅** `pedido_traslado_erp_uno_vivo` (5/día): por diseño — el despacho de
  900 productos va en varias corridas y cada una adopta la anterior; la edge
  function trata el 23505 como «retomar», no como error.
- **E4 ✅ (v2.1028.2)** — de los dos avisos, uno era del instrumento:
  - Los «renglones genéricos» eran **canjes de puntos**: 138 de 138 en facturas
    con `has_puntos`, y el `erp_product_id = 0` es la marca que usa el propio
    sync. Debajo el número real es **cero** (ni un id nulo ni uno desconocido).
    El gate ya los separa.
  - Los 47 sin principio activo sí son deuda. La herramienta existía (SRS →
    Enriquecer) pero su cola son 3,676 productos por orden alfabético: ahora
    pone primero los del libro. **Queda correrla** — es trabajo de mostrador,
    no de código.
- **E5 ✅ (v2.1029.0)** — el 0% era el REGISTRO, no las áreas: `puntuar.mjs`
  reventaba con EISDIR al leer un `docs:` que es una carpeta
  (`docs/legal/procedimientos/`), así que nadie podía recalcular desde ese día y
  las dos áreas creadas después quedaron sin puntaje. Arreglado y recalculado:
  **Protección de datos 95%, Promociones 94%, promedio del portal 87% → 94%**.
  Auditando Protección de datos aparecieron tres huecos reales, los tres
  corregidos: el plazo del Art. 20 no avisaba solo (ahora cron a las 08:10 SV
  con marca propia), la cuenta de días hábiles no tenía pruebas (14 casos) y
  `/solicitudes-datos` no estaba en el barrido móvil (agregada, 0 hallazgos).
  **Ojo para la próxima:** el puntaje se deriva de `snapshot-produccion.json`,
  que es del 23-ago — los ejes de servidor (bd, seguridad) miran esa foto, no la
  de hoy.
- **E6 ✅** Pruebas unitarias en rojo en `main`: eran 16 en 8 archivos, las 16
  desactualizadas A PROPÓSITO (cada una tiene el commit que cambió la regla:
  e25fc1b3, 1cf21e39, 74176679, 40b39a3f, 72a85ddd, 2a88fdda, 582aea69).
  Ninguna regresión. Actualizadas conservando lo que cada una vigila, y dos
  quedaron más estrictas (el cargo de supervisión usa el rango real; las rutas
  compartidas deben estar declaradas con su motivo). Suite completa: 2,704/2,704.

---

## F. Eficiencia medida como usuario (22-sep, tarde)

Nace de la lección de A1: la búsqueda se «arregló» midiéndola como `postgres`
y como usuario seguía en 15 s. Instrumento nuevo: **`npm run
medir:como-usuario`** — el ranking real por rol de `pg_stat_statements` y un
manifiesto de 29 llamadas medidas como postgres / usuario de alcance total /
usuario de sala, con huella md5. **Regla de integridad para todo este bloque:**
cada cambio se prueba en `pg_temp` y se aplica sólo si da el MISMO resultado
(md5) que la versión actual con las dos cuentas; después se remide igual.

Aprobado por el usuario el 22-sep («hagámoslo»).

| # | mejora | medido antes | estado |
|---|---|---|---|
| F1 | Envíos · historial y vivos: el JSON por lote (`envios_json(ids[])`), RLS intacto | 1,100 ms / 113 ms como usuario | ✅ v2.1026.2 · **38 ms / 33 ms**, 8 huellas idénticas en dos cuentas |
| F2 | Aprobar traslado: `v_inventario_disponible` calculada una vez | 810 MB, 255 ms | ✅ v2.1026.3 · **7 MB, 36 ms**, 120/120 idénticas; desempate por sala en `alternativas` |
| F3 | Cola de impresión: índice parcial `WHERE estado='IMPRIMIENDO'` | 1.2 TB/semana | ✅ v2.1026.5 · **206 → 5 bloques** por llamada; vigilado en `gate:perf` C |
| F4 | `traslados_en_vuelo`: prefiltro exacto por `updated_at` | 28 ms en cada lectura de disponibilidad | ✅ v2.1026.4 · **2.3 ms**, idéntica en 8 cortes simulados (0 a 1,225 filas en vuelo) |
| F5 | Ventas › Productos: los renglones del mes una sola vez | 1.4 GB por llamada | ✅ v2.1026.6 + v2.1026.7 · **1.46 GB → 670 MB** con alcance total (sala sin cambio), 12/12 idénticas en cada paso |
| F6 | Pendiente MH: índice parcial «sin sello válido» en `sales_invoices` | 818 MB por llamada | ✅ v2.1027.1 · **818 → 7 MB, 409 → 6 ms** como usuario (103,906 → 3 bloques). Aplicado el mismo día: `CREATE INDEX` toma lock SHARE, que no frena lecturas — la ventana sin syncs la pedía la regla por el outage del 7-8 jul, que fue por ACCESS EXCLUSIVE |
| F7 | Puntos cada minuto: sólo lo nuevo + barrido completo cada hora | 4.6 TB/semana | ✅ v2.1027.0 + v2.1027.1 · las tres piezas: **46,149 → 10,796** bloques por minuto, anuladas **13,113 → 5,249**, barrido 92k → 8k por lote |
| F8 | Inicio · faltantes (629 GB/sem) y top productos (197 GB/sem) | — | ✅ medido, **sin cambio**: ver abajo |

Hallazgos que explican F1 y F2, para no redescubrirlos:

- **F1 no es la lectura, es la PLANIFICACIÓN.** `envio_json(id)` lleva `SET` y
  nunca se inlinea: el historial la planificaba 100 veces, y bajo la policy de
  5 ramas de `approval_requests` planificar es caro. Como `postgres` no hay
  policy que expandir y por eso no se veía.
- **F2: pedirle a `v_inventario_disponible` una LISTA de productos cuesta 20×
  más que calcularla entera** (10 productos: 52,179 bloques; la vista entera:
  2,681). El planificador rehace el trabajo por producto.
- **F7 — diseño (22-sep), espera el OK del usuario.** Todo corre como
  `service_role` desde `sync-puntos`, cada minuto; medido como `postgres`, que
  para `service_role` sí es la identidad correcta (salta el RLS igual).

  | pieza | hoy | qué hace de más |
  |---|---|---|
  | `ventas_para_puntos` | 46k bloques/min (2.4 TB/sem) | re-evalúa las ~443 facturas `sin_enviar` de 7 días —que casi nunca cambian— y prueba `puntos_enviados` para las 4,119 facturas de la semana. Medido: **360 MB para mandar 0** |
  | `puntos_marcar_sin_enviar` | 20k bloques/min (1 TB/sem) | el mismo anti-join de 7 días, cada minuto |
  | `puntos_ventas_anuladas` | 13k bloques/min (0.6 TB/sem) | recorre el índice de las 373k facturas para hallar las 1,066 no finalizadas |
  | `puntos_anotar_aplicado` (barrido) | ~100k bloques cada 10 min (0.5 TB/sem) | 23k filas en 5 tandas; cada fila es una búsqueda por índice |

  Propuesta, en tres piezas independientes:
  1. **Ventana corta cada minuto, completa cada hora** (`sync-puntos` +
     parámetro nuevo `p_reevaluar` con default que conserva lo de hoy): cada
     minuto mira 2 días y sólo facturas SIN fila en la bitácora; en el minuto 0
     de cada hora, los 7 días y las `sin_enviar`. **Costo de negocio: una
     factura que entra tarde (fecha de hace 3+ días) o una `sin_enviar` que se
     vuelve elegible se manda en ≤1 h en vez de ≤1 min.** Una venta normal del
     día sigue saliendo al minuto. Estimado: 3.4 → ~0.5 TB/sem.
  2. **Índice parcial `sales_invoices (id) WHERE estado <> 'FINALIZADA'`**
     (1,066 filas) para `puntos_ventas_anuladas`: 13k → ~4.5k bloques, mismo
     resultado. Tabla caliente → misma ventana que F6.
  3. **El barrido de «acumulado» en una sola llamada con hash join**: una
     lectura secuencial de `puntos_enviados` (~8k bloques) en vez de 23k
     búsquedas (~100k). Mismo resultado (el `IS DISTINCT FROM` no cambia).
     Alternativa más simple pero con costo de negocio: barrido cada hora en vez
     de cada 10 min.

  Integridad: (2) y (3) no cambian resultados; (1) no cambia QUÉ se manda, sólo
  CUÁNDO en los casos tardíos — se verifica corriendo la versión nueva en
  modo `simular` contra la vieja sobre la misma ventana.

  **Aplicado el 22-sep (v2.1027.0)**, con las tres piezas aprobadas:
  `ventas_para_puntos` 46,149 → 10,796 bloques por minuto (6/6 idénticas con
  `p_reevaluar = true`), `puntos_marcar_sin_enviar` 20,501 → 12,158, el barrido
  de «acumulado» 92k → 8k por lote. Y una guarda que el diseño no tenía: una
  factura sin renglones NO se sella como «sin enviar» —`sync-dte-sales` la
  escribe en dos sentencias y hay una ventana en la que se ve vacía—, porque con
  la re-evaluación por hora esa factura habría esperado hasta una hora.
  Y la tercera pieza, aplicada el mismo día (v2.1027.1): el índice parcial
  `idx_si_no_finalizada` deja `puntos_ventas_anuladas` en **5,249 bloques y
  11 ms** por corrida (13,113 y 67 ms antes).
- **F8, medido el 22-sep — ninguna de las dos se toca:**
  - `get_faltantes_con_stock_en_otra_sala`: la técnica de F2 (la vista entera
    una vez) la EMPEORA —16–47k bloques y 39–98 ms hoy, 53–60k y 131–183 ms
    entera—, idéntica 14/14 pero sin ganancia. Ya usa `= ANY(ARRAY(…))`, que es
    lo que lleva el filtro al índice. Su promedio histórico (188 MB) mezcla
    llamadas de antes de F4.
  - `get_top_productos_mes`: el rango de facturas (F5b) baja 76% con alcance
    total (55.6k → 13.5k bloques) pero NADA con alcance de sala (13.0k →
    13.7k), y el tiempo no cambia. Su promedio real (86 MB) es el de las cuentas
    de sala: la ganancia sería de pocos. Probado idéntico 12/12, no aplicado.
  - **Lo que sí se generaliza es el rango de `invoice_id`**: los ids de las
    facturas de un período son casi contiguos (13,433 en el rango del mes contra
    13,404 del mes), así que `sii.invoice_id BETWEEN min AND max` convierte
    miles de descensos al índice cubridor en una lectura secuencial de sus
    hojas. Exacto por construcción (el join se mantiene). Candidatos: toda
    función que lea renglones de un período con alcance total.
- Lo más grande de la base no son las pantallas: Realtime decodificando el WAL
  (13.7 TB/semana) y los procesos de cada minuto. Realtime baja sola con cada
  escritura inútil que se elimina (D3).

---

## G · El quiebre de stock se lee como falta de demanda (22-sep)

Salió de una pregunta del usuario sobre la primera venta: si un producto estuvo
agotado, ¿el cálculo lo sabe? **No lo sabía.** `calculate_stock_params` divide lo
vendido entre los días de la ventana (180), así que los días sin producto cuentan
como días sin demanda: el número baja, se pide menos, se vuelve a agotar.

Medido sobre los 21 días de foto diaria (`inventory_daily` arrancó el 1-sep), de
10,589 pares producto·sala con MIN/MAX:

| | |
|---|---:|
| con algún día sin existencia | 2,114 (20%), parejo en las seis salas (18–26%) |
| los 21 días en cero habiendo vendido en 90 días | 331 (133 en Salud 5) |
| venden más rápido de lo que dice su número | 1.68× en promedio |
| venta perdida estimada (21 d) | $8,752 conservador · $19,652 amplio |
| margen bruto de esa venta | 33.4% |
| inversión extra si se corrigiera la fórmula | +$17,403 (70% en clase A y B) |

**Fase 1 — hecha (v2.1028.0), sin tocar ningún cálculo:**
- Pestaña «Agotados» en Min/Max (`get_quiebres_sala`): por sala, qué falta, días
  en cero, última venta, Min/Max y si ya reingresó. Sólo lo que vendió en 90
  días.
- La guarda del auto-aplicar ya no deja bajar solo un producto que estuvo en
  quiebre **aunque hoy tenga existencia** — 1,304 de los 2,114 quedaban fuera.
- Índice `(sala, producto, fecha) INCLUDE (unidades)` en la foto diaria + VACUUM:
  la consulta pasó de 89,716 a 9,141 bloques.

**Fase 2 — diciembre, cuando haya 90 días de foto.** Denominador por días con
existencia, **piso de 30 días y tope al factor (3×)**, y entrando como borrador
para revisión. Los topes no son opcionales: sin ellos, un producto con un solo
día de existencia y una venta grande propone un máximo de **840** contra 33.

**Lo que NO se puede reconstruir hacia atrás, y hay que saberlo:** las compras no
sirven para saber cuándo se agotó una sala —4,927 de 5,691 recibos entran a
Bodega—, y los traslados del portal empiezan el 29-jun. La única verdad de
existencia por día es la foto, y arrancó el 1-sep.

**Aparte del cálculo: Salud 5.** 133 productos que vendieron en 90 días y no
tuvieron existencia ni un día de los 21, contra 31–54 de las demás salas, y con
$7,483 de venta en el período contra $23,000 de las otras. Eso es
reabastecimiento, no fórmula.

---

## Cierre

Todos los gates de producción en verde (`gate:perf`, `gate:eficiencia`,
`gate:cortes`, `gate:receta`, `gate:auditoria`, `gate:migrations --remote`), el
log de un día hábil completo sin 5xx ni `permission denied` repetidos, y este
archivo con cada punto en ✅ o con la decisión escrita.
