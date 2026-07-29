# Auditoría del módulo Conteo de Inventario — 2026-07-29

Estado: **C1–C7 aplicadas** (v2.183.0, 6 migraciones). Auditoría completa de las
6 capas del módulo (vista lista, vista detalle, modal de alta, slice, capa de
datos, PDF) más las 12 RPCs, 3 tablas y sus policies en producción. Los hallazgos
están verificados contra datos reales, no inferidos de la lectura.

Queda abierto solo lo listado en "Fuera de alcance", que son decisiones de
negocio, no deuda técnica.

## Causa raíz

Tres decisiones tomadas por separado que se contradicen entre sí:

1. **El snapshot y la relectura en vivo no usan la misma identidad de línea.**
   `crear_conteo_inventario` copia una línea por fila de `inventory`; las cuatro
   funciones que releen el stock agrupan por una clave distinta e incompleta.
2. **El "sistema" en vivo pisa el dato del snapshot.** El valor con el que se
   abrió el conteo se destruye en el primer guardado y nunca se archivó.
3. **El módulo produce un número pero no lo cierra contra nada.** Aprobar solo
   sella un estado; la diferencia no ajusta stock ni sale hacia el ERP.

## Hallazgos

| # | Hallazgo | Severidad | Fase | Estado |
|---|---|---|---|---|
| 1 | "Sistema" inflado en 1,243 de 4,782 líneas (26%) — 4,634 u reales vs 12,588 mostradas | 🔴 | C1 | ✅ |
| 2 | Costeo con `MIN(costo)` ignorando presentación — 628 productos, hasta 250x | 🔴 | C3 | ✅ |
| 3 | Lo no contado no entra en diferencias ni en valor | 🔴 | C4 | ✅ |
| 4 | El conteo aprobado no ajusta ni exporta nada | 🔴 | — | fuera de alcance* |
| 5 | Se pierde la existencia inicial del libro | 🟠 | C4 | ✅ |
| 6 | Sin conteo ciego, sin segregación de funciones, sin recuento, cambio de lote sin rastro | 🟠 | C6 | ✅ (recuento no) |
| 7 | Tres huecos de RLS + alta manual sin RPC | 🟠 | C5 | ✅ |
| 8 | Un guardado fallido no avisa — pérdida silenciosa de datos | 🟠 | C2 | ✅ |
| 9 | Huecos funcionales (lote nuevo, SIN_UBICAR, vencidos, conteo duplicado, paginación) | 🟡 | C7 | ✅ |

\* El #4 es una decisión de negocio, no un bug: define si el portal ajusta el
stock o si el ERP sigue siendo la única fuente de escritura. Se documenta y se
deja fuera de esta pasada; lo que sí entra es no perder la trazabilidad para
cuando se decida (C4 archiva la existencia inicial).

## Fases

### C1 — La línea del conteo es una fila del ERP, no un grupo

`inventory.sync_key` (`sucursal|vencidos|producto|lote|detalle|fecha_venc`) es la
identidad real del ERP: única global y estable entre syncs (el upsert va
`ON CONFLICT (sync_key)`). El emparejamiento actual usa `presentacion` — que no
es parte de la identidad, el sync la sobrescribe — y omite `detalle` y
`fecha_vencimiento`, que sí lo son. Está exactamente al revés.

- `source_sync_key` en `conteo_inventario_items`, poblado desde el snapshot.
- Las 4 funciones releen por `sync_key`, 1:1 con la fila del ERP.
- Backfill del conteo abierto por `source_inventory_id`.

### C2 — Un guardado que falla tiene que gritar

`ItemRow.commit()` es `try/finally` sin `catch`: si la RPC falla, el número
queda en pantalla como si se hubiera guardado. En un conteo físico eso es
pérdida de datos que nadie detecta. Se agrega manejo de error, se revierte el
valor visible y se avisa.

### C3 — Un costo por presentación, un solo criterio

`MIN(costo)` sobre todas las presentaciones activas del producto. El 97.8% de
las líneas casan exacto por `product_precios → presentaciones.tipo`. Se costea
por la presentación de la línea, con `MIN` solo como último recurso, y el alta
manual usa el mismo criterio (hoy usa un tercero: `order('id').limit(1)`).

### C4 — Lo no contado es una decisión, no un silencio

- `sistema_inicial` archiva la existencia del libro al abrir el conteo.
- Finalizar reporta los pendientes y exige decidir: tratarlos como cero físico
  (conteo exhaustivo) o dejarlos explícitamente fuera del cálculo.
- `total_pendientes` se persiste y se muestra en resultados y en el PDF.

### C5 — Que la única puerta sea la RPC

- `conteos_update` y `conteo_items_update` no las usa la app (todo va por RPC
  `SECURITY DEFINER`) y permiten saltarse `can_approve` y el historial
  append-only. Se eliminan.
- El alta manual pasa a RPC: costo y autoría server-side.

### C6 — Controles que aguanten una auditoría

- Conteo ciego alcanzable (el PDF ya lo soporta, la UI nunca lo pide) y
  ocultable también en pantalla.
- Aprobar exige que el aprobador no sea quien finalizó el conteo.
- El cambio de lote deja fila de historial.
- `appendAuditLog` en las acciones que faltan.

### C7 — Huecos funcionales

Lote nuevo sobre producto ya presente, `SIN_UBICAR` alcanzable, marca visible de
vencidos, bloqueo de dos conteos abiertos por sucursal, paginación de la lista,
y limpieza de código y estados muertos.

## Verificación

Sobre datos reales de producción, sin escribir nada (la simulación del cierre
corrió dentro de una transacción revertida):

- `source_sync_key` poblado en las 4,782 líneas del conteo abierto, 0 sin clave.
  La reconstrucción se validó exacta contra las 3,612 líneas cuyo
  `source_inventory_id` todavía resolvía: **3,612/3,612 coinciden**, más 320
  huérfanas recuperadas. Las 850 restantes son filas que el ERP ya no tiene:
  sistema 0, que es la respuesta correcta.
- Existencia total del conteo tras C1: **16,498 u** (antes se presentaban 12,588
  solo en el subconjunto duplicado). Un producto de ejemplo con 15 renglones
  hermanos: 15 u reales que el módulo mostraba como 75.
- Las 6 RPCs de lectura responden con la firma intacta; `finalizar` quedó sin
  sobrecarga (PostgREST habría quedado ambiguo).
- 0 líneas sin costo tras el recosteo. Inventario costeado: $110,120.87.
- Policies restantes en las 3 tablas: solo `SELECT`.
- `npm run lint`, `npm run build` y `npm run gate:design` en verde (gate sin
  deuda nueva, 4 hallazgos bajo baseline).

Sin verificar en navegador con sesión real: el camino de escritura
(`guardar_conteo_item`, `agregar_item_conteo`, `finalizar`, `aprobar`) depende de
`auth_employee_id()`, que desde una consulta administrativa es NULL. La lógica
SQL de esas funciones sí se ejecutó contra los datos reales en la transacción
revertida.

## Fase A — El ajuste sale al ERP (decisión tomada 2026-07-29)

**Decisión del usuario:** mientras el portal no sea el sistema completo, los
ajustes se aplican en el ERP. El conteo no escribe stock — pero al finalizar
tiene que dejar **el reporte con el que se hace ese ajuste**, y constancia de que
se aplicó.

Esto cambia el #4 de "pendiente de decidir" a "resuelto en su forma correcta
para hoy". Lo que NO cambia: el portal sigue sin ser fuente de escritura de
inventario, y eso es deliberado.

- **A1** — `conteos_inventario` gana `ajuste_erp_aplicado/_por/_at/_nota`, la RPC
  `marcar_ajuste_erp` (exige `CERRADO`, o sea aprobado) y el payload de impresión
  suma `codigo_barras` y `sistema_inicial`.
- **A2** — Hoja de Ajustes en PDF y CSV, partida en **faltantes** (salidas) y
  **sobrantes** (entradas), que en un ERP son dos transacciones distintas. Cada
  línea trae el código con el que se teclea, el lote, el área (normal/vencidos) y
  la cantidad firmada a aplicar.
- **A3** — Descarga desde el detalle, badge de "ajuste pendiente / aplicado", y
  la señal en la lista para que un conteo aprobado pero sin ajustar no se pierda.

Un conteo aprobado sin ajuste aplicado es trabajo a medias: la diferencia está
medida y firmada, pero el stock del ERP sigue mintiendo. Por eso el estado se
sigue mostrando hasta que alguien registre que lo aplicó.

**Aplicado el 2026-07-29 en v2.188.0** (migraciones `20260729_conteo_a1_*`).
Simulado sobre el conteo real dentro de una transacción revertida: el reporte
sale en dos secciones (3,549 líneas de faltante por −$109,591.04 y 40 de sobrante
por +$834.93 en el escenario de prueba), con 56 líneas correctamente marcadas
como área de vencidos. El payload de impresión trae los 22 campos que el reporte
necesita.

## Fuera de alcance (decisión pendiente del usuario)
- **Corte (cutoff) de movimientos.** Hoy la lectura es en vivo, sin registrar
  las ventas ocurridas durante el conteo. Con 6 sucursales sincronizando cada
  minuto, contar con la sucursal abierta mete ruido irreducible en la
  diferencia. La solución real es operativa (contar cerrado) o un registro de
  movimientos entre el corte y el guardado.
- **Recuento de variaciones** por segunda persona sobre un umbral de
  materialidad.
- **Conteos cíclicos por ABC**, reusando la clasificación que MinMax ya calcula.
