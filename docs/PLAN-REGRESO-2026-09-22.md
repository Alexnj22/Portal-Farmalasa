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

### A4 ⏸ Hacienda: dos documentos rechazados que el circuito no arregla

- **Salud 2, CCF 65** (factura 368299, $16.05, **del 7-sep**): crédito fiscal
  a un cliente «Consumidor» sin NRC. El circuito no escribe NRC.
- **La Popular, factura 62982:** `subTotal = 0.050000000000001`, redondeo del
  JSON que arma el origen.
- **Verificar antes:** la ficha del cliente, los renglones de la 62982, y si
  hay más documentos con la misma forma (flotante / CCF sin NRC) en 90 días.
- **Corregir:** decisión del usuario — anular y reemitir, completar el NRC,
  o redondear antes de transmitir. Y que un rechazo que el circuito NO puede
  arreglar **avise**, en vez de quedar 15 días en silencio.

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

## C. Verificar que lo arreglado del 14 al 17 funciona en producción

| arreglo | cómo se comprueba con datos reales |
|---|---|
| ráfaga al recibir pedido | lecturas de `pedido_items` por minuto e IP desde el 17 (antes 144–415/min) |
| índice `puntos_enviados` | `puntos_anotar_aplicado` en `pg_stat_statements`: bloques y peor |
| `sync-puntos` en horario | sin corridas 00:00–05:59 SV |
| alarma de reinicio | el aviso del 15-sep llegó (`destinatarios: 1`) |
| borrado de abono | `ABONO_CREDITO_CHANGE` aprobadas desde el 15 y su saldo en el espejo |
| aprobar días en bloque | `TIMESHEETS_BULK_APPROVED` desde el 15 y `timesheets.status` |
| doble toque en caja | ráfagas <1 s desde el 17 = 0 |
| boleta repetida | intentos frenados (log de `operar-caja`) |
| lectura de la foto | movimientos con foto desde el 17 y con monto leído |
| costo de IA | tokens por llamada en el registro de `gemini.ts` |
| pedidos #121 #133 #174 #178 #180 | estado final de cada uno |
| «no reenviar» | usos y estado de las líneas |

Cualquier fila que no dé lo esperado se vuelve un punto A.

---

## D. Carga y gates en rojo

### D1 ⬜ `gate:perf` — 5 hallazgos

- `get_product_sales_agg_jsonb` 1,535 MB contra techo 914.
- `refresh_primera_venta_producto` 388 contra 359.
- `get_product_sales_total` 315 MB y `get_ventas_con_receta` 198 MB, sin
  declarar (la 2ª se resuelve con A1).
- `donde-hay-un-producto` 30.71 contra 30 ms.
- **Ojo al medir:** la estadística es desde el 17-sep 19:01 y mezcla llamadas
  de antes y después del arreglo del 17. Resetear sólo esas y remedir antes
  de concluir.

### D2 ⬜ Las más pesadas: `get_product_drill_summary` / `_lines`

- 5.1 y 4.4 GB por llamada, peor 11.7 s. Auditadas el 4-sep con una salida
  que «exige medir un punto de cruce». Medir ese punto y decidir.

### D3 ⬜ `gate:eficiencia` — escrituras sin inserción 1,380/h (tope 1,240)

- Ubicar la tabla (`n_tup_upd` vs `n_tup_hot_upd` desde el arranque) y el
  writer que reescribe filas sin cambio. Patrón `IS DISTINCT FROM`.

### D4 ⬜ Realtime publica `inventory_sync_log` 🔒

- Pendiente del informe del incidente. Verificar si alguna pantalla se
  suscribe; si no, sacarla de la publicación (`lock_timeout`).

---

## E. Menores

- **E1 ⬜** «Esa sala no tiene una caja registrada para imprimir» ~27/día:
  qué sala/equipo y si es configuración o código.
- **E2 ⬜** `customers_nit_idx` duplicado (4/día) y `clientes_por_revisar.erp_id`
  nulo (1): quién escribe y si pierde algo.
- **E3 ⬜** `pedido_traslado_erp_uno_vivo` (5/día): confirmar que es el freno
  haciendo su trabajo y que el llamador lo trata como tal.
- **E4 ⬜** `gate:receta`: 47 productos sin principio activo y 137 renglones
  de venta genéricos — deuda de catálogo, se reporta con la lista.
- **E5 ⬜** Auditoría: «Promociones» y «Protección de datos» en 0%.
- **E6 ⬜** Pruebas unitarias en rojo en `main`: 16 en 8 archivos
  (`ajusteAMano` 5, `bitacorasLogica` 4, `bitacoraDeAcciones` 2,
  `bandejaYCatalogosDeSala`, `capasDeLecturaYMarcado`, `capturaDeFoto`,
  `decisionDiferencia`, `registroDePermisos`). Una prueba roja tapa a las que
  vienen detrás (así se escondió el defecto de la foto del 17-sep).

---

## Cierre

Todos los gates de producción en verde (`gate:perf`, `gate:eficiencia`,
`gate:cortes`, `gate:receta`, `gate:auditoria`, `gate:migrations --remote`), el
log de un día hábil completo sin 5xx ni `permission denied` repetidos, y este
archivo con cada punto en ✅ o con la decisión escrita.
