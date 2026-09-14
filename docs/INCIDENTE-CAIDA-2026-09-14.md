# Incidente: el portal se cayó el 14-sep-2026 (y no fue la primera vez esa semana)

Auditoría hecha el mismo día, con los registros de Supabase (del 1 al 14 de
septiembre), las métricas de la instancia, `pg_stat_statements` y el código.
Horas en **El Salvador (UTC−6)** salvo que diga UTC.

## Resumen

- **14-sep, 16:25–17:03: portal inutilizable.** No se podía entrar, y lo que
  cargaba tardaba 10–20 s o daba 504. Lo resolvió un reinicio ordenado de la
  base a las 17:00:53. A las 17:03:20 volvió a responder sin errores.
- **10-sep, 14:31: la base se cayó de golpe y nadie lo reportó.** Postgres
  registró «database system was not properly shut down; automatic recovery in
  progress»: estuvo ~2.5 min abajo y dio timeouts hasta las 14:40.
- **8-sep, 15:05–15:11: un aviso.** 31 consultas cortadas por timeout y 31
  errores 5xx, y se recuperó sola.
- **Durante las vacaciones no cambió nada en el portal.** El último commit, el
  último despliegue y la última migración son del 6-sep por la noche.
- **La causa es de capacidad, no un cambio.** La base corre en una instancia de
  **~900 MB de RAM** que vive usando swap. Encima trabajan procesos de fondo que
  leen cientos de MB por minuto, las 24 horas. El detonante del lunes fue el día
  de más tráfico de la semana, sumado a un defecto viejo: recibir un pedido
  dispara ráfagas de ~1,000 peticiones por minuto.

## Qué NO cambió (descartado)

| | último | fuente |
|---|---|---|
| commit en `main` | 6-sep 20:39 (`ef7539bf`) | `git log origin/main` |
| despliegue del portal | 6-sep 20:40 | Vercel |
| migración aplicada | 6-sep 20:18 (`20260907021824`) | `list_migrations` |

La lista de crons sigue siendo la del 6-sep. En resumen: ni código, ni esquema,
ni tareas nuevas.

## Los días, uno por uno

| día | 5xx | timeouts de consulta | consultas >10 s | arranques de Postgres |
|---|---:|---:|---:|---:|
| mar 1-sep | 595 | 27 | 145 | 1 (incidente conocido) |
| mié 2 | 3 | 1 | 26 | 0 |
| jue 3 | 4 | 1 | 20 | 0 |
| vie 4 | 6 | 9 | 32 | 0 |
| sáb 5 | 4 | 2 | 14 | 0 |
| dom 6 | 0 | 0 | 3 | 0 |
| lun 7 | 14 | 0 | 15 | 0 |
| **mar 8** | **31** | **31** | 14 | 0 |
| mié 9 | 3 | 0 | 21 | 0 |
| **jue 10** | **72** | **43** | 16 | **1 — caída sin apagado** |
| vie 11 | 3 | 1 | 5 | 0 |
| sáb 12 | 0 | 0 | 16 | 0 |
| dom 13 | 2 | 1 | 1 | 0 |
| **lun 14** | **~1,735** | **109** | **265** | **1 — reinicio** |

(Día UTC. «Consultas >10 s» es lo que registra `auto_explain`, cuyo umbral es
10,000 ms.)

El 14 no fue un pico repentino, fue un deterioro que se acumuló durante el día.
Consultas de más de 10 s por hora: 10:00 → 12 · 13:00 → 16 · 14:00 → 20 ·
15:00 → 35 · **16:00 → 168**.

## Cronología del 14-sep

| hora | qué pasó |
|---|---|
| 14:00 | la hora con más tráfico de la semana: **28,399 peticiones** (lo normal es 20–24 mil) |
| 14:47, 15:59, 16:16 | ráfagas de recepción de pedido (ver §Detonante) |
| 15:00 | PostgREST corta 582 hilos por timeout en la hora, el máximo de la semana |
| 15:12 | `sync_inventory_batch` 75 s, `upsert_product_precios_batch` 74 s, `puntos_anotar_aplicado` 97 s |
| 16:25 | se acelera el corte de hilos |
| 16:29 | una sala recibe un pedido de 206 renglones: **~1,040 peticiones en un minuto** desde un solo navegador |
| 16:38 | caen por timeout hasta las escrituras de una fila (`touch_session`, `reclamar_impresion`) y leer `roles` (<30 filas) tarda 15 s. Nadie espera por un bloqueo: es falta de recursos |
| 16:39–16:57 | el login da 504. `custom_access_token_hook` corre en la base y también se corta por timeout, así que «no puedo entrar» es un síntoma más de la base |
| 17:00:53 | **apagado ordenado** de Postgres: fue un reinicio pedido, no un choque |
| 17:02:50 | Postgres acepta conexiones |
| 17:03:20 | API sin errores, respuestas de ~50 ms |

**Pregunta abierta:** el reinicio de las 17:00 fue ordenado, así que lo pidió
alguien desde el panel o la recuperación automática de Supabase. Desde acá no
se ve quién.

## Causa 1 — la instancia no tiene memoria para lo que corre

Métricas de la propia instancia, leídas justo después del reinicio:

| | 17:05 | 17:13 |
|---|---:|---:|
| RAM total | 904 MB | 904 MB |
| RAM disponible | 216 MB | 271 MB |
| **swap en uso** | **500 MB** | **612 MB** |

- **Ya había 500 MB en swap a los tres minutos de arrancar, con tráfico
  moderado.**
- En esa misma instancia corren Postgres (`shared_buffers` 320 MB,
  `work_mem` 3.5 MB), PostgREST, Auth, Realtime y Storage.
- Cuando el sistema pagina, **todo** se vuelve lento por igual, sin bloqueos y
  sin que ninguna consulta sea la culpable. Es exactamente lo que se vio:
  consultas triviales de 15 s y escrituras de una fila cortadas por timeout.

**Límite de esta auditoría:** no hay historia de memoria. Las métricas son
contadores desde el arranque y el reinicio los puso en cero, así que no se
puede probar que el 10-sep fue una muerte por falta de memoria. La gráfica está
en Supabase → Observability (memoria y swap del 10 y del 14).

## Causa 2 — procesos de fondo que leen mucho, cada minuto, las 24 horas

> **Corrección (mismo día, al remedir).** Los MB de las dos tablas de abajo son
> bloques **tocados**, y casi todos salieron de la memoria, no del disco.
> Medido en los 30 minutos siguientes al reinicio: `ventas_para_puntos` tocó
> 11,924 MB desde memoria y sólo 11.5 MB desde disco, en 31 corridas.
> Remedido su plan, tarda **80 ms** y entra por índice en todos los nodos, que
> es lo mismo que ya había concluido la auditoría del 2-sep
> (`scripts/bloques-por-llamada.json`). O sea que **no es lo que satura la
> memoria ni el disco**: gasta procesador, ~200 ms por minuto. Sus 47 s del 14
> fueron de víctima de la lentitud general, no de culpable, y **no se
> reescribe**.
>
> Lo que sí lee del disco son otras cosas: `VACUUM ANALYZE sales_invoices` lee
> 180 MB por corrida (cron de cada hora) y `v_sync_health` 20 MB por consulta.
> Lo de `puntos_anotar_aplicado` sí era un defecto real (barría las 380 mil
> filas en cada llamada) y quedó corregido el mismo día con un índice.

Qué leyó la base en los primeros 10 minutos después del reinicio
(`pg_stat_statements`, bloques leídos, que no dependen de la carga del momento):

| quién | llamadas | MB por llamada | GB en 10 min |
|---|---:|---:|---:|
| Realtime: sondeo de cambios (`SELECT wal->>…`) | 1,272 | 18 | **22.6** |
| `ventas_para_puntos` | 11 | **384** | 4.1 |
| `sync_inventory_batch` | 18 | 170 | 3.0 |
| `reclamar_impresion` (agentes de impresión) | 1,622 | 1.3 | 2.1 |
| `get_faltantes_con_stock_en_otra_sala` | 11 | 162 | 1.7 |
| `puntos_marcar_sin_enviar` | 11 | 160 | 1.7 |
| `get_traslado_disponibilidad` | 2 | **809** | 1.6 |
| `puntos_ventas_anuladas` | 11 | 95 | 1.0 |
| `puntos_anotar_aplicado` | 10 | 61 | 0.6 |

Y los cuatro días anteriores (del arranque del 10-sep a las 16:51 del 14, antes
de que el reinicio borrara la estadística):

| quién | llamadas | MB por llamada | peor | leído en total |
|---|---:|---:|---:|---:|
| `ventas_para_puntos` | 5,851 | 362 | 24.4 s | **2.1 TB** |
| `upsert_product_precios_batch` | 587 | 318 | 74.1 s | 186 GB |
| `get_traslado_disponibilidad` | 196 | 834 | 8.9 s | 163 GB |
| `get_product_drill_summary` | 13 | 1,613 | 13.2 s | 21 GB |

### La sincronización de puntos es la carga fija más grande

`sync-puntos-1min` existe desde el 28-ago y corre **`* * * * *`**: cada minuto,
también de noche. Cada corrida llama a `ventas_para_puntos` (384 MB),
`puntos_marcar_sin_enviar` (160 MB), `puntos_ventas_anuladas` (95 MB) y
`puntos_anotar_aplicado`. Son ~700 MB de bloques tocados por minuto para
mandar ~600 ventas al día, casi todos desde memoria (ver la corrección de
arriba).

`puntos_anotar_aplicado` además barre la tabla entera. Su `UPDATE` cruza por
`(sucursal, erp_invoice_id)` y `puntos_enviados` **no tiene índice sobre ese
par**:

```
Hash Join  (Hash Cond: pe.sucursal = … AND pe.erp_invoice_id = …)
  ->  Seq Scan on puntos_enviados pe   (rows=380390)
```

Cada 10 minutos el barrido de «aplicados» la llama 5 veces con 5,000 filas, o
sea 5 barridas completas de 380 mil filas. El 14-sep hubo **42 llamadas de más
de 10 s, la peor de 97 s**. Estuvo entre las lentas los tres días con problema
(8, 10 y 14).

### Realtime decodifica cambios dos veces por segundo

El sondeo de Realtime es lo que más bloques lee (18 MB por sondeo). La
publicación `supabase_realtime` lleva 16 tablas, entre ellas
`inventory_sync_log`, que las sincronizaciones escriben cada minuto. **Queda
por verificar** si alguna pantalla se suscribe de verdad a esa tabla.

## Detonante — recibir un pedido dispara una ráfaga (defecto desde junio)

1. `receive_pedido_sucursal` actualiza todos los renglones del pedido en
   `pedido_items` con un solo `UPDATE`.
2. Realtime emite **un evento por renglón**.
3. `src/views/pedidos/tabpedidos/usePedidosData.js:302` recarga el detalle
   completo del pedido **por cada evento** (`fetchItems`: `pedido_items`
   paginado, eventos, apoyo, devoluciones y estado). Son 5 peticiones por
   renglón.

El código es del 28-jun (`a6937a4d`). Ráfagas medidas (≥40 lecturas de
`pedido_items` por minuto desde una misma IP):

| día | ráfagas | la mayor |
|---|---:|---:|
| 8-sep | 8 | 415/min |
| 9-sep | 6 | 144/min |
| 10-sep | 8 | 234/min (una a las 14:08, 23 min antes de la caída) |
| 11-sep | 4 | 176/min |
| 12 y 13-sep | 0 | — |
| 14-sep | 9 | 244/min |

Ocurren todos los días hábiles, así que **por sí solas no tumban el portal**.
Lo que hacen es llenar el pool de PostgREST: el 14 a las 16:29 cada lectura de
`pedido_items` tardaba 3.9 s. En un día que ya venía saturado, eso basta para
que el resto de la gente se quede sin conexión.

## Otros hallazgos

- **Nadie se enteró de la caída del 10-sep.** Duró poco y cayó a media tarde, y
  no hay ninguna alarma que vigile que Postgres se reinició.
- **La estadística de consultas se borra con cada reinicio.** La de los cuatro
  días previos se salvó sólo porque `npm run portal:lento` se corrió a las
  16:51, antes del reinicio.
- **«Thread killed by timeout manager» es ruido de fondo.** PostgREST lo
  registra 70–420 veces por hora todos los días, así que no sirve como alarma;
  lo que distingue un incidente son los timeouts de consulta y los 5xx.
- **Queda sin investigar:** errores `permission denied` sobre `bolsas`,
  `get_cortes_por_embolsar`, `employees` y otros, tanto el 10 (14:21) como el
  14 (16:32 en adelante). Pueden ser sesiones vencidas durante la
  degradación, pero no está verificado.

## Qué hacer, en orden de impacto

1. **Subir la instancia de cómputo** (hoy ~1 GB de RAM → 2 o 4 GB). Es lo único
   que ataca el swap directamente y no toca código. Es una decisión de costo.
2. **Aliviar la sincronización de puntos.**
   - Índice `(sucursal, erp_invoice_id)` en `puntos_enviados`: elimina la
     barrida de 380 mil filas.
   - Limitar `sync-puntos-1min` al horario de las salas (como los demás syncs,
     `12-23,0-5`) o espaciarlo.
   - ~~Reescribir `ventas_para_puntos`~~: al remedirla no hace falta. Tarda 80
     ms con un plan correcto y lo que lee sale de memoria (ver la corrección
     de la Causa 2).
3. **Arreglar la ráfaga de recepción.** Juntar los eventos de un mismo pedido en
   una sola recarga cada ~2 s, y sólo si esa tarjeta está abierta.
4. **Revisar la publicación de Realtime** y sacar las tablas a las que nadie se
   suscribe (empezando por `inventory_sync_log`).
5. **Alarma de reinicio.** Que un cron compare `pg_postmaster_start_time()`
   contra la última lectura y avise, para que la próxima caída corta no pase
   inadvertida.
