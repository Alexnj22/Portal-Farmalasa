# Plan — la base sin swap, sin subir de plan (2026-11-10)

**Objetivo.** Que la base deje de congelarse y de reiniciarse **sin subir el
servidor** (Small, 2 GB) y **sin que cambie nada de lo que se ve o se hace**. Cada
cambio se prueba primero en el entorno de pruebas, se compara su resultado contra
el de producción y se puede deshacer en minutos.

## Por qué

- 2026-11-10 16:46 UTC: la base congelada ~60 s (auth en 504, 13 crons sin poder
  arrancar). El 09-11, cinco congelamientos iguales y un reinicio forzado a las
  22:00 UTC. Reinicios: 3, 6, 7 y 9 de noviembre.
- Panel de Supabase: **RAM 2 GB, swap constante de 700–900 MB, Memory commitment
  3,02 GB «SEVERE»**. Disco ocioso (150 de 3000 IOPS) y CPU al 7 %: el límite es
  la memoria.

## Línea de base (antes de tocar nada)

| métrica | valor | de dónde |
|---|---|---|
| swap | 700–900 MB | panel → Memory usage |
| memory commitment | 3,02 GB (SEVERE) | panel → Memory commitment |
| conexiones de la API (PostgREST) | 31, máx. 1 activa en 15 s | `pg_stat_activity` |
| procesos de cron por minuto | ~14 (69 crons, 2.604 corridas en 3 h) | `cron.job_run_details` |
| costo de un cron en proceso nuevo | ~170 ms más que la misma función en caliente (bitácora: 30 ms caliente vs 199 ms en cron) | medido |
| caché de la base | 512 MB, acierto 99,76 % | `pg_stat_database` |
| `inyecciones_para_cobrar` | 639 ms prom., 5,4 s peor, 210 MB por llamada | `pg_stat_statements` |
| `chat_vigilar_espera` (cada minuto) | 222 ms; 120 ms son dos listas de empleados que casi nunca se usan | medido |

## Fases

### Fase 0 — reserva de la API en 15 · HECHO 2026-11-10 17:06 UTC

`db_pool` de `null` (31 conexiones) a `15`. Reinicio de la API: 4 errores en ese
minuto, después normal. Deshacer: `{"db_pool": null}` en `PATCH /v1/projects/<ref>/postgrest`.
**Ahorro:** 16 procesos de la base menos en reposo. **Pendiente:** captura del
panel 1 h después para medir cuánto bajó el swap.

### Fase 1 — dos funciones más baratas · 1a HECHA 2026-11-10 18:03 UTC; 1b descartada

**1a. `chat_vigilar_espera`** (~45 min). Primero busca si hay una conversación
que necesite aviso; las dos listas de empleados (equipo y supervisión, ~120 ms)
se arman **sólo si hay a quién avisar**. Mismos avisos, mismos textos, mismo
orden.
- Prueba: en pruebas, con conversaciones sembradas en cada caso (sin asignar a
  los 15 min, asignada a los 15, asignada a los 20, ya avisada), comparar los
  avisos que emite la vieja y la nueva: tienen que ser idénticos.
- **Ahorro:** ~120 ms × 1.440 corridas/día ≈ 3 min de CPU/día y dos recorridos de
  `employees` por minuto. Pequeño pero gratis.
- **Resultado:** en pruebas, seis casos, avisos/incumplimientos/marcas idénticos por
  md5; sin nadie esperando 28 ms → 1 ms. En producción el cron sigue tardando
  ~170 ms: casi todo es ABRIR el proceso, no la función — que es el argumento de
  la fase 2a. Migración `20261110180350`.

**1b. `inyecciones_para_cobrar`** (~2 h). Medido: la primera mitad (qué facturas
tienen inyección) cuesta 75 ms y 18 k bloques; el resto de los 639 ms está en el
armado de renglones. Se mide nodo por nodo con `EXPLAIN (ANALYZE, BUFFERS)` y se
corrige lo que se separe.
- Prueba: misma sucursal, mismo texto de búsqueda, mismos días → el JSON de la
  función vieja y el de la nueva **idénticos** (comparación por `md5`), en
  pruebas y en producción (es de lectura).
- **Meta:** < 200 ms promedio y < 1 s el peor caso.
- **Descartada (medido 2026-11-10):** sin búsqueda 200–400 ms, buscando un nombre
  ~900 ms; corre ~20 veces por hora (al abrir la pantalla de cobro). El ahorro
  posible son segundos de CPU por hora y nada de memoria. La vía rápida —un índice
  parcial sobre `es_inyectable(descripcion)`— quedaría desactualizada en silencio
  el día que alguien cambie esa regla. Si se retoma, es por la espera en pantalla,
  no por la base.

### Fase 2a — un solo cron por minuto en vez de nueve · hoy por la tarde

Hoy corren cada minuto nueve crons: siete sólo encolan una llamada HTTP
(`net.http_post`, asíncrono) y dos son SQL (`chat_vigilar_espera`,
`sincronizar_bitacora_dispensaciones`). Cada uno abre un **proceso nuevo** de la
base, que tiene que cargar el catálogo de 1.580 funciones y 490 tablas.

Se reemplazan por **un cron `tick-minuto`** que llama a `cron_tick_minuto()`:
- Cada trabajo va en su propio bloque `BEGIN … EXCEPTION`: si uno falla, los
  demás corren igual y el error queda registrado con su nombre.
- Cada trabajo respeta **su horario de hoy** (`* * * * *`, `* 12-23,0-5`,
  `* 13-23,0-3`, `*/2 12-23,0-5`): la función compara la hora y el minuto.
- Las llamadas HTTP salen con el mismo URL, cuerpo y encabezados que hoy.
- Devuelve un JSON con el resultado de cada trabajo (queda en
  `cron.job_run_details.return_message`), para no perder el rastro.
- Los nueve crons viejos se **desactivan** (`active = false`), no se borran,
  durante 48 h; deshacer = reactivarlos y apagar `tick-minuto`.
- Migración con `SET lock_timeout = '5s'` y la guarda «sólo si existe» en cada
  `cron.unschedule`. Se actualizan `CRONS` de `gate:eficiencia` y `areas.mjs`.

Prueba: en pruebas, una hora corriendo; en producción, comparar 1 h antes y 1 h
después las llamadas que llegaron a cada edge function (`function_edge_logs`),
los avisos emitidos y las filas nuevas de la bitácora: **mismas cuentas**.

- **Ahorro:** de ~14 a ~6 procesos nuevos por minuto (~11.500 menos por día).
  Con ~170 ms de arranque cada uno: **~30 min de CPU/día**, y el pico de memoria
  del segundo :00 de cada minuto baja a menos de la mitad.
- Tiempo: ~2,5 h.

### Fase 2b — caché de la base de 512 a 384 MB · esta noche, SÓLO si hace falta

Sólo si 1 h después de la fase 2a el swap sigue por encima de ~300 MB.
- Ventana: 00:00–05:59 SV (crons de sincronización apagados). Reinicia la base
  1–3 min.
- Guardas: el acierto de caché se queda en ≥ 99,5 % y las lecturas de disco por
  debajo de 1.000 IOPS en la siguiente mañana; si no, se vuelve a 512 la noche
  siguiente.
- **Ahorro:** 128 MB comprometidos, seguros.

### Fase 3 — proyectos aparte · sólo si después de las fases 0–2 sigue el swap

- **Avisos en vivo por Broadcast** en lugar de Postgres Changes (91
  suscripciones hoy, 6 tablas). Quita la consulta de cambios que corre ~68 veces
  por minuto (1.019 s de CPU y 1,5 TB leídos desde el reinicio de ayer) y parte de
  las 11 conexiones fijas del tiempo real. Toca portal y app: plan propio.
- **Funciones internas fuera de `public`**: 507 de las 1.580 no las llama ni el
  portal ni la app, pero la API las carga en memoria y las relee en cada cambio
  de la base. Riesgo alto (crons y triggers las nombran). Plan propio.

## Cómo se comprueba que todo sigue igual

1. **Antes de producción**: cada función nueva corre en el entorno de pruebas
   con `execute_sql` (nunca `apply_migration` en el branch) y su resultado se
   compara con el de la vieja sobre las mismas entradas.
2. **En producción**: se parte de la definición VIVA (`pg_get_functiondef`), se
   aplica con `lock_timeout`, y se repite la comparación cuando la función es de
   lectura.
3. **Después**: 24 h vigilando errores 5xx, `job startup timeout`, avisos y
   cuentas por cron; `npm run portal:lento`; y la captura del panel de memoria.
4. Gates al cerrar: `gate:migrations -- --remote`, `gate:eficiencia`,
   `gate:perf`, `gate:auditoria`.

## Tiempos

| cuándo | qué | trabajo | reinicio |
|---|---|---|---|
| hecho | Fase 0 | — | API, segundos |
| hecho | Fase 1a (1b descartada) | — | no |
| hoy por la tarde | Fase 2a | ~2,5 h | no |
| esta noche, si hace falta | Fase 2b | 15 min + vigilar | base, 1–3 min |
| mañana | revisión de 24 h con capturas del panel | 30 min | no |
| si hace falta | Fase 3 | días, plan propio | — |

## Registro de resultados

| fase | fecha | swap antes → después | commitment | notas |
|---|---|---|---|---|
| 0 | 2026-11-10 | 700–900 MB → ? | 3,02 GB → ? | |
