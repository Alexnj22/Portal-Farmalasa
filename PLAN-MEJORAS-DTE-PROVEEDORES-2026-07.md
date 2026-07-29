# PLAN — Facturas de Compra (DTE) + Maestro de Proveedores

> **Prompt de ejecución autocontenido.** Reemplaza el plan del 2026-07-19, que
> quedó ejecutado (ver §0). Esta versión es el resultado de una **auditoría
> completa del módulo del 2026-07-29**: código (vistas, capa de datos, 4 edge
> functions), BD de producción (RPCs, RLS, índices, advisors) y **datos reales**
> — cada hallazgo de abajo se verificó contra prod, no se dedujo del código.
> Ejecutar fase por fase, en orden. NO saltar con ítems abiertos. Todo write a
> producción (dato, DDL o registro de migración) requiere OK explícito del
> usuario EN EL MOMENTO. Staging primero (`ewcmerxqjvludtgskuin`) para todo DDL.

**Fecha:** 2026-07-29 · **Versión al auditar:** v2.188.0
**Alcance:** `FacturasCompraView.jsx` (1215), `ProveedoresView.jsx` (264),
`FormProveedorDetail.jsx` (322), `FormPurchaseDteViewer.jsx` (346),
`data/facturasCompra.js` (254), `data/proveedores.js` (38),
`sync-purchase-emails` (1685), `export-purchase-dte-zip` (183),
`backfill-proveedores-dte` (140), `backfill-dte-related-docs` (126),
`_shared/proveedorFromDte.ts`, 36 migraciones `purchase_dte_*`/`proveedores_*`,
y el marco legal en `docs/legal/`.

---

## §0 — Lo que el plan anterior dejó cerrado (verificado, no tocar)

El plan del 2026-07-19 se ejecutó completo entre v2.23.11 y v2.25.2. Verificado
contra código y BD el 2026-07-29:

| Ítem | Cómo se comprobó |
|---|---|
| 1.1 invalidaciones perdidas | CHECK en prod = `('orphan_pdf','invalid_json','invalidacion_pendiente','orphan_zip')`; los 5 `error` ignorados hoy se chequean (2 lanzan, 3 van a `warnings`) |
| 1.2 `invalidado` invisible | RPC expone las 3 columnas; badge `danger` + tooltip Art. 119-E; card-filtro; **excluido de los totales monetarios** |
| 1.3 filtro sin-match-ERP | `ProveedoresView.jsx:129` |
| 1.4 colisión ZIP | `doc-${row.id}`, `error` de `.download()` chequeado, `manifest-errores.txt` |
| 2.1 filtro anclado al ERP | `fetchProveedoresMaestro` + `set_purchase_dte_proveedor` |
| 2.2 match NRC sin normalizar | lookup propio eliminado; el RPC devuelve `{id, supplier_id}`. **Backfill: 0 filas pendientes** |
| 2.3 P4/P5 | `v_es_nc_nd` en el RPC; columna `percibe_1_override` (pero ver **H2**) |
| 3.1 integridad del JSON | `sello_recibido` + `orig_json_path`; `selloRecibido` capturado antes del unwrap |
| 3.2 confirmados sin JSON | `merge_purchase_dte_documents` + "Adjuntar JSON". **0 docs con `codigo_generacion` NULL** |
| 3.3 retención de logs | `email_sync_log` en `purge-sync-logs-daily` (90d); `COMMENT ON TABLE` en el ledger |
| Fase 4 búsqueda por ítem | `items_text`/`items_norm`, backfill, RPC, `findItemMatchSnippet` (pero ver **H7**) |
| Fase 5 E1-E6 | lote de 500, cursor `after_id`, `Promise.all`, auto-reinvocación |

**Dos datos del plan viejo que ya no eran ciertos:** el cron
`sync-purchase-emails-daily` (jobid 183) está **activo** desde entonces
(`0 9 * * *`, corrió hoy 09:00).

**El "tercer correo" YA NO EXISTE (confirmado por el usuario, 2026-07-29).**
Arrastraba como pendiente desde el plan original. No hay tercera casilla que
conectar: las cuentas del módulo son **dos**, `farmasalud.sv@gmail.com` y
`compraslasalud.sv@gmail.com`, ambas activas y sincronizando. Queda anotado
acá para que nadie lo vuelva a levantar como ítem abierto.

**Salud estructural (verificada, sin acción):** security advisors en **0 ERRORES**;
RLS con `(SELECT auth_*)` en las 7 tablas del módulo; sin policies de escritura
en `purchase_dte_documents` (todo por RPC DEFINER, correcto); índices sobre
todas las FK; sin cron de purga sobre documentos ni Storage (Art. 147 CT).

---

## §1 — Estado real de los datos (2026-07-29)

Medido en prod. Es el contexto que ordena las prioridades de abajo.

| Métrica | Valor | Lectura |
|---|---|---|
| Documentos | 1,343 | 22 (may) · 633 (jun) · 688 (jul) → **~660/mes** |
| Por tipo | 03=1055 · 05=126 · 09=143 · 01=15 · 06=4 | el 79% son CCF |
| Sin PDF / sin JSON | 0 / 0 | conservación completa |
| `orig_json_path` NULL | 1,169 de 1,343 | pre-3.1, **no backfilleable** (los bytes solo viven en Gmail) |
| Invalidados | 2 | |
| Sin `proveedor_id` | 143 | **todos tipo 09, el 100% de ese tipo** → **H4** |
| Proveedores en el maestro | 99 | 46 sin match ERP · 0 inactivos |
| **Proveedores sin categoría** | **99 de 99** | **→ H5** |
| `percibe_1` / `retiene_renta` | 19 / 0 | |
| Payload del RPC, 1 mes | **1.01 MB** (688 docs), de los cuales `items_text` 0.24 MB | **cierra la pregunta abierta de Fase 4** — ver **H12** |
| Cola de revisión | 2 pendientes, 9 descartadas, 2 emparejadas | sana |

---

## FASE A — Bugs vivos ✅ APLICADA (v2.192.0, 2026-07-29)

Migración `20260729120000_proveedor_percibe1_override_tristate` en prod
(advisors 0 ERRORES tras aplicar). **Staging no pudo validarla: está
desactualizado** — le faltan `alias` y `percibe_1_override`. Es la deriva ya
conocida (`project_migration_baseline_and_staging`); anotado como riesgo, no
resuelto acá.

| # | Estado |
|---|---|
| H1 tooltips | ✅ las 3 a `title={…}` |
| H2 `percibe_1` congelado | ✅ tri-estado; RPC deriva `percibe_1`; **las 2 filas dañadas de vuelta en NULL** |
| H3 `canEdit` ignorado | ✅ los 8 controles + botón Guardar gateados |
| H4 tarea imposible | ✅ `dteAdmiteProveedor()` en card, filtro y celda → "No aplica" |
| H6 cross-link vacío | ✅ el link lleva `?desde/&hasta` del mes de la última compra |
| H8 overload duplicado | ✅ `DROP` (quedó 1 de 2) |
| H9 función huérfana | ✅ `DROP set_purchase_dte_supplier` |
| H14 filtro no contaba | ✅ `filterInvalidados` en `activeCount` y `onClear` |
| H17 selector muerto | ✅ `.catch()` + libera el flag para reintento |

**Bug evitado en el camino:** `get_proveedores_maestro` no devolvía
`percibe_1_override`. Sin agregarlo, el form nuevo habría mostrado "Automático"
siempre y el primer guardado habría borrado un override real en silencio — el
mismo bug que H2 venía a arreglar, en la dirección contraria. Se agregó en la
misma migración.

**Pendiente de Fase A:** H5 (categorías) — ver decisiones tomadas abajo.

---

## FASE A (detalle original)

### H1 · Tres tooltips muestran el código fuente en pantalla

`FacturasCompraView.jsx:885,886,1035` tienen la expresión JS **dentro de la
cadena**, así que el navegador muestra literalmente `row.json_path ? 'Descargar
JSON' : 'Sin JSON'` al pasar el mouse:

```jsx
title="row.json_path ? 'Descargar JSON' : 'Sin JSON'"   // :885
title="row.pdf_path ? 'Descargar PDF' : 'Sin PDF'"      // :886
title="row.filename"                                     // :1035
```

Es la clase de regresión del migrador de botones (memoria
`feedback_jsx_migrator_needs_exercise`): build, lint y `gate:design` pasan en
verde porque la forma es válida. Barrido global: **son los únicos 3 del
repo**.

- [ ] Cambiar las 3 a `title={…}`.
- [ ] Regla de lint que prohíba `title="` conteniendo `?`, `.` seguido de
      identificador, o `${` — hoy nada lo detecta.

### H2 · Guardar un proveedor congela `percibe_1` para siempre

`update_proveedor_manual` escribe **`percibe_1_override = p_percibe_1` en cada
guardado**, sin importar si el usuario tocó ese campo. El propósito de la
columna (plan viejo §2.3-P5) era el tri-estado `NULL = automático`.

Consecuencia real: abrir un proveedor, corregirle **solo el teléfono**, apretar
Guardar → `percibe_1_override` queda fijado, y `upsert_proveedor_from_dte`
(que sí lo respeta) deja de actualizar ese proveedor desde sus DTE. **Para
siempre, y sin forma de volver a "automático" desde la UI.** Hay 2 filas ya
con override no-nulo.

- [ ] `FormProveedorDetail`: el select "Percibe 1%" pasa a tri-estado
      — `Automático (según sus DTE)` / `Sí` / `No`.
- [ ] `update_proveedor_manual`: parámetro `p_percibe_1_override boolean`
      propio (nullable), y `percibe_1` deja de recibirse del cliente — se
      deriva (`coalesce(override, observado)`).
- [ ] Revisar a mano las 2 filas con override: confirmar si fue intencional o
      efecto colateral de este bug; si fue colateral, volverlas a NULL.

### H3 · El detalle de proveedor ignora `canEdit`

`ProveedoresView.jsx:148` pasa `canEdit` en `formData`, y `FormProveedorDetail`
**nunca lo lee**. Un usuario con solo `can_view` sobre `proveedores` ve los
selects de Categoría y Match ERP habilitados, los campos de texto editables y
el botón "Guardar Cambios".

**No es un hueco de seguridad** — los 4 RPCs (`update_proveedor_manual`,
`set_proveedor_categoria`, `set_proveedor_supplier`, `set_purchase_dte_proveedor`)
validan `auth_can_edit_any` y lanzan `FORBIDDEN`. Es UI que promete lo que no
puede cumplir: el usuario escribe, guarda y recibe un error crudo.

- [ ] Gatear los 3 controles + el botón con `formData.canEdit`
      (mismo patrón que `SupplierMatchCell`, que sí lo hace bien).

### H4 · "Sin Proveedor" es una lista de tareas imposible

La card muestra 143 documentos "pendiente de emparejar", y `SupplierMatchCell`
pinta ⚠️ + botón "Emparejar" en cada uno. **Los 143 son tipo 09** (Documento
Contable de Liquidación — Banco Promerica y Servicios Financieros), y
`_shared/proveedorFromDte.ts:35` los excluye **a propósito y con fundamento**
(el emisor es un intermediario financiero, no un proveedor; corregido el
2026-07-18 tras un error previo).

O sea: el sistema marca como pendiente algo que él mismo decidió que nunca se
va a resolver, y crece ~2/día.

- [ ] Exportar `TIPOS_DTE_CON_PROVEEDOR` al front (o exponer un
      `proveedor_no_aplica` desde el RPC) y **excluir esos tipos** del conteo
      de la card.
- [ ] `SupplierMatchCell`: para esos tipos, "No aplica" en gris — sin ⚠️ ni
      botón.

### H5 · ✅ CERRADO (v2.198.0) — 68 de 99 clasificados

BD en v2.196.1, UI en v2.198.0 (aprobada por mockup antes de construirla), y
las sugerencias **aplicadas en prod**: 68 proveedores clasificados, 31 sin
categoría esperando criterio del usuario (los ambiguos).

Verificado en la app: el filtro **Clase=Costo → 45** y **Gasto Operativo → 20**
(coincide exacto con la BD). **Antes devolvían 0 filas siempre.**

Reparto final:

| categoría | clase | proveedores | docs |
|---|---|---|---|
| Mercadería para reventa | costo | 45 | 1,505 |
| Servicios financieros/bancarios | gasto_admin | 3 | 259 |
| Telecomunicaciones | gasto_operativo | 4 | 59 |
| Combustible y transporte | gasto_operativo | 6 | 54 |
| Agua | gasto_operativo | 2 | 44 |
| Mantenimiento y reparaciones | gasto_operativo | 5 | 26 |
| Alquileres | gasto_operativo | 2 | 10 |
| Energía eléctrica | gasto_operativo | 1 | 1 |
| **sin categoría** | — | **31** | 234 |

**Deshacer**, si hiciera falta: todos estaban en NULL antes, así que
`UPDATE proveedores_maestro SET categoria_id = NULL;` revierte la tanda entera.

**Hallazgo lateral (abierto):** la tabla de Proveedores **ya desbordaba** su
contenedor antes de este cambio — 1,276px de contenido en 1,044px disponibles
(por eso v2.27.4 le quitó la columna Giro). La columna de selección y el
subtexto la dejaron en 1,302px (+26 netos, acotados con `truncate`+`title`).
El desborde de fondo es anterior y no se tocó.

### H5 (diseño original) — BD aplicada (v2.196.1), UI en mockup

Migración `20260729140000_proveedor_categoria_sugerida` en prod:
`suggest_proveedor_categoria_id()` (14 patrones sobre el giro, 68/99 = 89% de
los docs), la sugerencia expuesta en `get_proveedores_maestro`, y dos RPC de
escritura — `set_proveedores_categoria_bulk` (todos la misma) y
`apply_proveedores_categoria_sugerida` (cada uno la suya). Ambas devuelven el
conteo real de filas cambiadas.

Los ~11 ambiguos no reciben sugerencia a propósito (ver H5b).

**UI pendiente de tu OK** — no hay patrón canónico de selección múltiple en el
proyecto, así que va mockup primero (regla del proyecto). Mockup publicado con
los 3 estados: reposo con sugerencia visible, selección con barra de acciones,
y resultado.

### H5 (diagnóstico original) · El maestro no clasifica nada: 99 de 99 sin categoría

Existen 16 categorías seed, un filtro "Categoría", un filtro "Clase"
(costo / gasto operativo / gasto admin / otro), una columna en la tabla y la
derivación de "Categoría Contable" en el detalle. **Ninguna está poblada**, así
que:

- filtrar por cualquiera de las 16 categorías devuelve **0 filas**;
- el filtro "Clase" devuelve **0 filas** siempre;
- las 99 filas muestran "Sin categoría" en ámbar;
- "Categoría Contable" dice "Sin categoría asignada" en los 99 detalles.

Es el hallazgo de mayor valor de la auditoría: la razón de ser del maestro para
contabilidad (separar costo de inventario vs. gasto) está construida y sin
usar. Clasificar 99 proveedores de a uno, desde un modal, es la razón por la
que nadie lo hizo.

- [ ] **Decisión del usuario** (ver §Preguntas): asignación masiva desde la
      tabla (selección múltiple → "Asignar categoría") vs. sugerencia
      automática por `desc_actividad`/`cod_actividad` del DTE, que ya viene en
      los 99 registros.
- [ ] Los ~15 proveedores que concentran el 80% de los documentos primero —
      con eso el filtro deja de estar vacío desde el día 1.

### H6 · "Ver documentos" desde un proveedor cae casi siempre en vacío

`FormProveedorDetail.jsx:155` navega a `?tab=documentos&q=<NIT>` **sin rango de
fechas**, así que la vista abre en el mes actual. Cualquier proveedor cuya
última compra no sea de este mes muestra "Sin facturas de compra en el
período" — el usuario acaba de ver "Última: 12/06/2026" en el mismo modal.

- [ ] Pasar el rango en la URL, derivado de `ultima_vez_visto` (mes de esa
      fecha, o `primera_vez_visto → ultima_vez_visto` si se quiere todo).
- [ ] `FacturasCompraView` ya lee `?q=`; agregar lectura de `?desde/?hasta`.

---

## FASE B — Deuda que se rehace sola ✅ H7 y H10 APLICADOS (v2.196.0)

Edge function `sync-purchase-emails` **v47** desplegada con `--no-verify-jwt`
(esa función tenía `verify_jwt=false`; un redeploy sin el flag lo resetea).
Verificado con `dry_run` real: las 2 cuentas en **una sola invocación, 5.6s**,
`hasMore=false`, sin errores. Las 21 filas con `items_text` NULL pasaron a `''`
(quedan 0).

H10 se hizo para desbloquear el "tercer correo", que **resultó no existir**
(ver arriba). El arreglo igual vale por sí solo: el presupuesto era por cuenta
en un loop serial, así que con 2 cuentas una invocación podía llegar a ~200s
sin necesidad de una tercera.

**H11 (E8) se descarta** — ver el encuadre corregido: el comportamiento
conservador es el correcto para un módulo cuyo trabajo es capturar.
H8/H9 se hicieron en Fase A.

---

## FASE B (detalle original)

### H7 · `items_text`: el sync escribe NULL donde el backfill escribe `''`

`sync-purchase-emails/index.ts:970` inserta `extractItemsText(json)`, que
devuelve `null` cuando el DTE no trae `cuerpoDocumento`. El backfill
(`:1409`) escribe `''` **a propósito**, con un comentario explicando por qué.
El camino del sync no aplica ese criterio.

Hoy: 21 filas en NULL, todas tipo 09, +2/día. No se pierde búsqueda (el tipo 09
genuinamente no tiene ítems: 0 de 143 con contenido). El costo es que cada
corrida futura del backfill re-descarga de Storage todo lo acumulado desde la
anterior.

- [ ] `items_text: extractItemsText(json) ?? ''` (un carácter).
- [ ] `UPDATE ... SET items_text = '' WHERE items_text IS NULL` para las 21.

### H8 · Dos overloads de `update_proveedor_manual` en producción

Existen la de 7 argumentos y la de 8 (con `p_alias`). La migración usó
`CREATE OR REPLACE` agregando un parámetro con default, lo que **crea una
función nueva** en vez de reemplazar. El cliente pega en la de 8; la de 7 es
superficie muerta con `GRANT` a `authenticated`, y las sobrecargas son una
fuente conocida de ambigüedad en PostgREST.

- [ ] `DROP FUNCTION public.update_proveedor_manual(bigint,text,text,text,text,boolean,boolean)`.
- [ ] Hacerlo en la misma migración que **H2**, que la reescribe igual.

### H9 · `set_purchase_dte_supplier` quedó huérfana

Sin llamadores en `src/` desde que la Fase 2.1 movió el match manual al maestro
— solo existe en su migración original. Sigue siendo un `SECURITY DEFINER` de
escritura con `GRANT` a `authenticated`.

- [ ] `DROP FUNCTION`. Verificar antes que ninguna edge function la use
      (`grep -rn set_purchase_dte_supplier supabase/functions/` → hoy: nada).

### H10 · El presupuesto de tiempo es por cuenta, y bloquea el tercer correo

`TIME_BUDGET_MS = 100_000` vive **dentro de `processAccount`**, y las cuentas se
recorren en un `for` **serial**. Con 2 cuentas, una invocación puede llegar a
~200s; con el tercer correo (pendiente conocido) serían ~300s, contra el límite
de wall-clock de la plataforma para una sola invocación.

Si la invocación se corta, la cuenta 1 está a salvo (marca sus mensajes dentro
de `processAccount`), pero el trabajo de la última cuenta se pierde y se
re-escanea. No hay pérdida de datos — sí trabajo desperdiciado y un `hasMore`
que nunca llega al cliente.

- [ ] Presupuesto **global** de la invocación: pasar un `deadline` absoluto a
      `processAccount` en vez de un budget propio por cuenta.
- [ ] Resolver **antes** de conectar el tercer correo.

### H11 · E8 del plan viejo: los links externos se buscan siempre

`collectLinkAttachments` corre para todo mensaje (`index.ts:751`), incluso
cuando los adjuntos ya dieron un DTE válido y no falta ningún PDF (hasta 10
links, 15s de timeout cada uno). La etiqueta "E8" se reutilizó en v2.25.2 para
otra optimización, así que este quedó sin hacer.

Mitigado en la práctica: solo hace fetch si el cuerpo trae links con keyword.
Prioridad baja, pero sigue vivo.

- [ ] Corto-circuito: si los adjuntos ya produjeron ≥1 DTE válido y ningún PDF
      falta, saltar los links. **Evaluar contra datos reales antes** — el
      riesgo es perder un documento que solo venía por link.

---

## FASE C — Escala y simplificación ✅ CERRADA (v2.202.0)

| # | Estado |
|---|---|
| H12 | ✅ medido — payload de 1 mes = 1.01 MB; **la búsqueda server-side queda descartada, no pendiente** |
| H13 | ✅ el visor usa `invalidacion_source` de la fila; el RPC queda de respaldo |
| H14 | ✅ (en Fase A) |
| H15 | ✅ sección propia de FilterBar. "Sin match" = 46 (exacto vs BD) y **ya se combina con una categoría** — antes imposible |
| H16 | ✅ ordenable por Proveedor / Categoría / Docs / Última compra, con desempate estable |

**Ancho de la tabla — mejorado, NO resuelto.** Primer intento fue ocultar Match
ERP con `xl`; medido, la escondía hasta en 1440px (la pantalla donde se
trabaja) y **aun así desbordaba** — mal negocio, revertido a `lg`. Con los
recortes de `max-w` quedó en **1,288px** con las 8 columnas visibles, contra
**1,276px** originales: se sumó una columna entera de selección más el
ordenamiento por **+12px netos**.

El desborde de fondo (1,288 en 1,044 disponibles) **no se puede arreglar sin
sacar una columna**, y eso es decisión del usuario — como lo fue quitar Giro en
v2.27.4. Candidatas, en orden: `Tipo` (175px, el régimen fiscal ya se ve en el
detalle) y `NIT / NRC` (132px).

---

## FASE C (detalle original)

### H12 · Medición que cierra la pregunta abierta de Fase 4

El plan viejo pedía "medir; si el payload de 1 mes supera ~2-3MB, pasar la
búsqueda a la capa servidor". **Medido: 1.01 MB para los 688 documentos de
julio**, de los cuales `items_text` aporta 0.24 MB (el más largo, 2.7 KB).

→ **La capa servidor de Fase 4 §4 no hace falta. Queda descartada, no
pendiente.** La búsqueda cliente se queda como está.

El límite real aparece en otro lado: a ~660 docs/mes, un **rango anual**
(~8,000 docs, ~12 MB) es lo que rompe — y es exactamente lo que va a pedir
contabilidad al cierre del ejercicio.

- [ ] Cuando aparezca el pedido de "todo el año": paginar server-side por
      rango, no agregar búsqueda server-side.

### H13 · `invalidacion_source` se pide dos veces

`get_purchase_dte_documents` ya devuelve `invalidacion_source` por fila, pero
`FormPurchaseDteViewer.jsx:212` vuelve a pedirlo con
`fetchPurchaseDteReviewSource(document.id)` cada vez que se abre el modal.

- [ ] Usar `document.invalidacion_source` de la fila; mantener el RPC solo
      como respaldo si el modal se abre sin pasar por la lista.

### H14 · El filtro "Invalidados" no cuenta como filtro

`FacturasCompraView.jsx:801-802`: `activeCount` y `onClear` de `FilterBar`
contemplan `dateDirty` y `filterSinProveedor`, **pero no `filterInvalidados`**.
Con la card de Invalidados activa, la barra dice que no hay filtros y "Limpiar"
no la apaga — el usuario ve una tabla recortada sin señal de por qué.

- [ ] Sumar `filterInvalidados` a ambos.

### H15 · "(sin match ERP)" está escondido dentro del filtro de Categoría

`ProveedoresView.jsx:154` mete la opción en el select de **Categoría**, y para
que funcione hace falta un segundo filtrado aparte (`filteredSinMatch`, :136).
No es una categoría, y no se puede combinar con una categoría real.

- [ ] Sección propia de `FilterBar` ("Match ERP": todos / con match / sin
      match), y borrar el doble filtrado.

### H16 · La tabla de Proveedores no ordena

`COLS` no declara ningún `sortable` — contra el estándar del proyecto
(`feedback_datatable_standard`), y "Docs" y "Última compra" son justo las dos
columnas por las que uno querría ordenar. Hoy el orden es alfabético fijo.

- [ ] `sortable` en proveedor / docs / última compra, con el patrón
      client-side de `FacturasCompraView`.

### H17 · Un fallo en el selector de Revisión es permanente y silencioso

`FacturasCompraView.jsx:926-930`: `loadDocuments` marca `documentsLoaded = true`
**antes** de que el fetch resuelva, y no tiene `.catch()`. Si falla, el
selector de "Emparejar"/"Clasificar" queda vacío para el resto de la sesión,
sin aviso ni reintento — y con una promesa rechazada sin manejar.

- [ ] `.catch()` con toast + `setDocumentsLoaded(false)` para permitir reintento.

---

## ⚠️ ENCUADRE CORREGIDO (2026-07-29) — leer antes que la Fase D

**Este módulo captura y conserva correos DTE. No los procesa.** El
procesamiento (ingresar las compras, generar cuentas por pagar, aplicar
retenciones) es trabajo posterior, atado al sistema de ventas que todavía no
existe.

Eso corrige un error de encuadre de la auditoría original, que presentó la
Fase D como *"la mitad faltante de este módulo"*. No lo es: pagos, saldos y
retenciones **pertenecen a otro módulo que aún no se construyó a propósito**.
El módulo actual hace lo que le toca, y lo hace completo — 1,343 documentos,
0 sin PDF, 0 sin JSON.

Consecuencias de esta corrección:

- **La Fase D (P1-P6) sale del alcance de este plan.** No es deuda; es scope de
  un módulo futuro. Se conserva abajo como referencia legal ya verificada para
  cuando se retome, no como pendiente.
- **H5b (categoría por documento) queda PREMATURO.** Se justificaba como
  prerrequisito de cuentas por pagar. Construirlo ahora sería adivinar
  requisitos que el módulo de procesamiento no definió. Esperar.
- **H11 (E8) cambia de signo: NO hacerlo.** Es saltarse la búsqueda de links
  externos cuando los adjuntos ya trajeron un DTE válido. Si la captura es
  *todo* el trabajo del módulo, ahorrar segundos a cambio de cualquier riesgo
  de perder un documento que solo venía por link es mal negocio. El
  comportamiento conservador actual es el correcto.
- **Gana peso la fidelidad del archivo:** 1,169 de 1,343 documentos no tienen
  el JSON original crudo (`orig_json_path` NULL). Se arregló el 2026-07-22, así
  que de ahí en adelante sí se guarda; lo anterior solo vive en Gmail y es
  recuperable mientras esos correos sigan ahí. **Decisión abierta.**

### Estado del almacenamiento (medido 2026-07-29)

Bucket `purchase-dte`: **339 MB en 3,163 archivos**. Todos los buckets del
proyecto suman ~374 MB.

| tipo | archivos | tamaño | % |
|---|---|---|---|
| PDF | 1,462 | 313 MB | 92.2% |
| JSON normalizado | 1,409 | 17 MB | 5.1% |
| `review/` (huérfanos) | 118 | 7 MB | 2.0% |
| JSON original (`.orig.json`) | 174 | 2 MB | 0.6% |

Crecimiento ≈ **130 MB/mes** al ritmo actual (~660 docs/mes) → ~1.5 GB/año.

**La descarga NO comprime, y está bien así.** `export-purchase-dte-zip` usa
`STORE` deliberadamente: se midió que DEFLATE reducía <5% sobre PDFs (que ya
vienen comprimidos internamente) y a escala rompía el edge function por CPU.
Como el 92% del bucket son PDFs, no hay ahorro real disponible: comprimir los
17 MB de JSON ahorraría ~14 MB del total. Además, el Decreto 487 Art. 3 exige
conservar las representaciones gráficas "en el mismo formato y medio en que
fueron originalmente expedidas" — recomprimir el PDF sería legalmente dudoso.

---

## FASE D — Proveedores: cuentas por pagar (FUERA DE ALCANCE — módulo futuro)

Verificado en BD el 2026-07-29: `proveedores_maestro` **no tiene** columnas de
gran contribuyente, datos bancarios ni plazo de crédito, y **no existe ninguna
tabla** de pagos, cuentas por pagar ni retenciones. Todo lo de abajo sigue
entero. Los artículos se verificaron contra el texto real de
`docs/legal/codigo_tributario.pdf`.

| # | Qué | Fundamento |
|---|---|---|
| P1 | Gran Contribuyente explícito | Art. 162-163 CT: si Farmalasa es GC, **retiene** 1% a quien no lo sea; si el proveedor lo es, él nos **percibe** 1%. Hoy solo se infiere de `percibe_1` (19 de 99) y falta la dirección inversa (la retención que Farmalasa debe aplicar) |
| P2 | Retención de Renta accionable | Art. 156 CT: 10% a persona natural sin relación de dependencia por servicios. `retiene_renta` existe pero es informativo (0 de 99 — ningún Sujeto Excluido todavía) |
| P3 | Datos bancarios | Pagar por transferencia. Hoy solo "Nombre para Cheques" |
| P4 | Términos de pago | Contado / 15 / 30 / 45 días. No existe el campo |
| P5 | Cuentas por pagar / aging | El módulo registra documentos **recibidos**, no si están **pagados**. No hay forma de saber cuánto se le debe a cada proveedor ni desde cuándo |
| P6 | Comprobante de Retención (DTE 07) emitido por Farmalasa | ¿Vive en el ERP o es un hueco del portal? **Confirmar antes de asumir** |

**H5 es el prerrequisito de toda esta fase**: sin categoría contable poblada no
hay clasificación de gasto, y sin eso P5 no tiene de dónde agrupar.

---

## Decisiones tomadas (2026-07-29)

1. **H5 — sugerir + confirmar.** El sistema propone categoría por giro del DTE
   y el usuario acepta/corrige en lote desde la tabla. Nada se escribe sin
   confirmación. Cobertura medida de la regla por palabra clave sobre
   `desc_actividad`: **68 de 99 proveedores = 1,958 de 2,192 documentos (89%)**.
   Los 31 sin sugerencia suman apenas 234 docs.
2. **H2 — las 2 filas eran daño colateral del bug.** CAESS y CTE/Claro, ambas
   editadas cuando se agregó el campo Alias, ambas en `false` (que además es
   probablemente incorrecto: las dos son empresas grandes que sí percibirían).
   **Reseteadas a NULL** en la migración de Fase A.
3. **H5b — la categoría es del documento, no del proveedor** (decisión nueva,
   ver abajo).

### H5b · La categoría contable pertenece a la transacción

Al revisar los ~11 proveedores ambiguos (PriceSmart, Calleja, DIHARE, Steiner,
Congelados del Sabor, Comercializadora Interamericana) el usuario señaló que
**no son una cosa ni la otra**: en PriceSmart se compra tanto mercadería para
reventa como insumos de uso interno. Eso desarma el modelo actual, donde la
categoría cuelga del proveedor.

Es correcto: la clase de gasto es un hecho de la **factura**, no del
proveedor. El proveedor solo puede aportar un **default**.

- [ ] `purchase_dte_documents.categoria_id` (nullable, FK a
      `proveedores_categorias`, con índice). NULL = heredar la del proveedor.
- [ ] El RPC de documentos devuelve la efectiva
      (`coalesce(d.categoria_id, p.categoria_id)`) y una marca de si vino
      heredada o fijada, para poder mostrarlo distinto.
- [ ] UI: cambiar la categoría de un documento suelto sin tocar al proveedor.
- [ ] Sugerencia por contenido: `items_text` ya existe — una factura de
      PriceSmart que dice "ACETAMINOFEN" se puede proponer como reventa, y una
      que dice "PAPEL TOALLA" como gasto.
- [ ] Para los mixtos, el proveedor lleva el **predominante** y solo se tocan
      las excepciones.

**H5b es además el prerrequisito real de P5** (cuentas por pagar / aging):
agrupar deuda por clase de gasto necesita clasificación por documento.

## Preguntas abiertas

1. **P6 — ¿los Comprobantes de Retención (DTE 07) que emite Farmalasa se
   registran hoy en el ERP?** Determina si es un hueco del portal o no aplica.
   Bloquea la Fase D, no la A.

---

## Orden de ejecución

1. **Fase A** — H1 (3 líneas), H4, H3, H6, H2 (necesita migración), H5 (necesita
   la decisión de arriba). Son los que el usuario ve.
2. **Fase B** — H7 y H8/H9 son de minutos. **H10 antes de conectar el tercer
   correo.** H11 al final, con datos reales.
3. **Fase C** — H14/H17 con Fase A (misma vista, mismo commit). H13/H15/H16
   cuando toque.
4. **Fase D** — proyecto aparte, después de H5.

## Cierre de cada tanda

- [ ] Security advisor en **0 ERRORES** tras cada migración (staging y prod).
- [ ] `npm run build` + `npm run gate:design`.
- [ ] Verificación visual (regla del proyecto): login + screenshots de lo tocado.
- [ ] Bump `APP_VERSION` + changelog; **migración a prod ANTES del push** de
      frontend si este depende de columnas/RPCs nuevos.
- [ ] Toda `apply_migration` con su archivo local del **mismo nombre** en el
      mismo commit, y `SET lock_timeout = '5s'`.
- [ ] Actualizar las memorias `project_facturas_compra_email_module.md` y
      `project_proveedores_maestro_module.md`.
