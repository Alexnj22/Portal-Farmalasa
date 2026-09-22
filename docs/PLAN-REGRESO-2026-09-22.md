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

### A2 🔎 Llamadas que llegan sin sesión (`permission denied` diario)

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

### D1 ⏸ `gate:perf` — 5 hallazgos (quedan 3)

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
  - `get_product_sales_agg_jsonb` — **reescritura preparada y NO aplicada**
    (el usuario la dejó para después): `get_product_sales_agg` leía dos veces
    los renglones del mes en curso (`pres_live` y `last_sale_live`); un CTE
    `lineas_mes AS MATERIALIZED` los lee una vez. Idéntica en 6/6 casos (md5),
    −30% en el caso por defecto, −23% en un año. El SQL está en el historial de
    `docs/PLAN-REGRESO-2026-09-22-borradores/productos_leer_el_mes_una_vez.sql`;
    se rearma sobre la definición viva de
    `20260918015225_get_product_sales_agg_entra_al_cache_de_planes.sql`.
    Ojo al fijar el techo: la parte del mes en curso crece con el DÍA del mes
    (el techo actual se midió el 4-sep, con 4 días de datos).
  - `refresh_primera_venta_producto` 388 vs 359 MB — rollup diario, deuda
    declarada; crece con la historia.
  - `donde-hay-un-producto` 30.5 vs 30 ms — **causa encontrada, borrador sin
    aplicar (espera OK)**: casi todo es `traslados_en_vuelo()` (28 ms), que abre
    el jsonb de TODAS las solicitudes de traslado de la historia (1,383, crece
    sola). Prefiltro exacto por `updated_at`: 28.2 → 1.7 ms.
    `docs/PLAN-REGRESO-2026-09-22-borradores/traslados_en_vuelo_prefiltro.sql`.

### D2 ✅ Las más pesadas: `get_product_drill_summary` / `_lines`

- 5.1 y 4.4 GB por llamada, peor 11.7 s. Auditadas el 4-sep con una salida
  que «exige medir un punto de cruce». Medir ese punto y decidir.
- **Cerrado (v2.1025.3):** la auditoría del 4-sep midió con literales; la
  función era `sql`+`SET` (trampa 4). Pasó a plpgsql + force_custom_plan y a
  DEFINER: un año 683,904 → 73,262 bloques, 12/12 idénticas. Techos bajados en
  `bloques-por-llamada.json` y fuera de `planes-genericos.json`.

### D3 🔎 `gate:eficiencia` — escrituras sin inserción 1,380/h (tope 1,240)

- Ubicar la tabla (`n_tup_upd` vs `n_tup_hot_upd` desde el arranque) y el
  writer que reescribe filas sin cambio. Patrón `IS DISTINCT FROM`.
- **Corregido (v2.1025.4), falta que la ventana de 6 h del gate lo mida:**
  `cortes_caja_movimientos` (561/h) — `sync-cortes-caja` refrescaba `visto_at`
  de todo el día en cada repaso. Ahora sólo si tiene más de 30 min.

### D4 ✅ Realtime publica `inventory_sync_log` — NO se saca

- Pendiente del informe del incidente. Verificar si alguna pantalla se
  suscribe; si no, sacarla de la publicación (`lock_timeout`).
- **Verificado: SÍ se suscriben** `SidebarSyncStatus` (INSERT) y `useSyncMonitor`
  (INSERT con success=false). Sacarla los rompe. Lo que sí sobra: la barra
  lateral re-consulta por HTTP en CADA evento (~6/min por pantalla abierta),
  cuando el evento ya trae la fila — ver D5.

### D5 ✅ La barra lateral re-consultaba en cada evento del sync

- 5,763 peticiones en 12 h el 21-sep. Ahora aplica la fila del evento (v2.1026.1).

### D6 ⏸ `reclamar_impresion`: 7,400 llamadas/h, 189 bloques cada una 🔒

- El agente de cada caja pregunta cada ~3 s y el `UPDATE … estado='IMPRIMIENDO'`
  recorre toda la historia de la sala (461 filas, 205 bloques) porque ese
  estado no tiene índice parcial. 1.2 TB tocados en 4.6 días.
- **Preparado, NO aplicado (el usuario lo dejó para después):**
  `CREATE INDEX ON cola_impresion (branch_id) WHERE estado = 'IMPRIMIENDO'` —
  la tabla pesa 2 MB. Medir antes/después con `EXPLAIN` del UPDATE. SQL en
  `docs/PLAN-REGRESO-2026-09-22-borradores/cola_impresion_indice_imprimiendo.sql`.

---

## E. Menores

- **E1 ✅** «Esa sala no tiene una caja registrada para imprimir» ~27/día: es
  POR DISEÑO — `encolar_impresion` rechaza y el portal lo toma como «este camino
  no está» y abre el diálogo de impresión. Ruido en el log, no una falla.
- **E2 ⏸ (grave, preparado y NO aplicado — el usuario lo dejó para después) 🔒**
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
  - `sincronizar-fichas-clientes` línea ~313 ignora el `error` del `select`
    (regla de CLAUDE.md).
- **E3 ✅** `pedido_traslado_erp_uno_vivo` (5/día): por diseño — el despacho de
  900 productos va en varias corridas y cada una adopta la anterior; la edge
  function trata el 23505 como «retomar», no como error.
- **E4 ⬜** `gate:receta`: 47 productos sin principio activo y 137 renglones
  de venta genéricos — deuda de catálogo, se reporta con la lista.
- **E5 ⬜** Auditoría: «Promociones» y «Protección de datos» en 0%.
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
| F2 | Aprobar traslado: `v_inventario_disponible` calculada una vez | 810 MB, 255 ms | ⬜ |
| F3 | Cola de impresión: índice parcial `WHERE estado='IMPRIMIENDO'` | 1.2 TB/semana | ⬜ |
| F4 | `traslados_en_vuelo`: prefiltro exacto por `updated_at` | 28 ms en cada lectura de disponibilidad | ⬜ |
| F5 | Ventas › Productos: los renglones del mes una sola vez | 1.4 GB por llamada | ⬜ |
| F6 | Pendiente MH: índice parcial «sin sello válido» en `sales_invoices` | 818 MB por llamada | ⬜ tabla caliente: `CONCURRENTLY` y fuera de horario |
| F7 | Puntos cada minuto: sólo lo nuevo + barrido completo cada hora | 4.6 TB/semana | ⬜ diseñar antes de tocar |
| F8 | Inicio · faltantes (629 GB/sem) y top productos (197 GB/sem) | — | ⬜ medir con la técnica de F2 |

Hallazgos que explican F1 y F2, para no redescubrirlos:

- **F1 no es la lectura, es la PLANIFICACIÓN.** `envio_json(id)` lleva `SET` y
  nunca se inlinea: el historial la planificaba 100 veces, y bajo la policy de
  5 ramas de `approval_requests` planificar es caro. Como `postgres` no hay
  policy que expandir y por eso no se veía.
- **F2: pedirle a `v_inventario_disponible` una LISTA de productos cuesta 20×
  más que calcularla entera** (10 productos: 52,179 bloques; la vista entera:
  2,681). El planificador rehace el trabajo por producto.
- Lo más grande de la base no son las pantallas: Realtime decodificando el WAL
  (13.7 TB/semana) y los procesos de cada minuto. Realtime baja sola con cada
  escritura inútil que se elimina (D3).

---

## Cierre

Todos los gates de producción en verde (`gate:perf`, `gate:eficiencia`,
`gate:cortes`, `gate:receta`, `gate:auditoria`, `gate:migrations --remote`), el
log de un día hábil completo sin 5xx ni `permission denied` repetidos, y este
archivo con cada punto en ✅ o con la decisión escrita.
