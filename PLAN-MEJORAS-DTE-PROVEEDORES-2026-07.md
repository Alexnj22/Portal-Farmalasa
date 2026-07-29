# PLAN DE MEJORA — Auditoría Facturas de Compra (DTE) + Maestro de Proveedores

> **Prompt de ejecución autocontenido.** Resultado de la auditoría del 2026-07-19
> (código + BD + eficiencia + cumplimiento legal contra `docs/legal/`). Ejecutar
> fase por fase, en orden. NO saltar a la siguiente con ítems abiertos. TODO
> write a producción (dato, DDL o registro de migración) requiere OK explícito
> del usuario EN EL MOMENTO. Staging primero (`ewcmerxqjvludtgskuin`) para todo DDL.

**Fecha:** 2026-07-19 · **Alcance auditado:** `sync-purchase-emails`,
`export-purchase-dte-zip`, `backfill-proveedores-dte`, `backfill-dte-related-docs`,
RPCs y migraciones `purchase_dte_*` / `proveedores_maestro`, `FacturasCompraView.jsx`,
`ProveedoresView.jsx`, `FormPurchaseDteViewer.jsx`, capa de datos, y marco legal
(`codigo_tributario.pdf`, `decreto_487_reforma_dte.pdf`, `ley_iva.pdf`,
`dte_guia_tecnica.pdf`).

---

## Resumen ejecutivo

**Lo que está bien** (verificado, no requiere acción):
- Dedupe por `codigo_generacion` UNIQUE + ledger `purchase_dte_processed_messages` — sólido.
- Bucket privado, RLS con `(SELECT auth_*)` en todas las tablas, RPCs con REVOKE/GRANT correctos, 0 upsert incondicional.
- Sin cron de purga sobre `purchase_dte_documents` ni Storage → compatible con la obligación de conservar 10 años (Art. 147 CT).
- `upsert_proveedor_from_dte` condicional, nunca pisa campos manuales (con 2 matices, ver P4/P5).
- Match NC/ND↔CCF (`documento_relacionado_id`) con backfill idempotente.

**Lo crítico** (Fase 1): una pérdida silenciosa de datos activa (invalidaciones),
un flag legal (`invalidado`) que existe en BD pero es invisible para el usuario,
y un filtro roto en Proveedores.

---

## FASE 1 — Bugs críticos (correctitud + legal inmediato)

### 1.1 ⚠️ Invalidaciones "pendientes" se pierden en silencio (BUG ACTIVO)

`sync-purchase-emails/index.ts:630` encola `kind: 'invalidacion_pendiente'`
cuando llega una invalidación cuyo DTE original aún no está capturado. Pero el
CHECK de `purchase_dte_review_queue` (migración `20260717_purchase_dte_review_queue.sql:15`)
solo permite `('orphan_pdf', 'invalid_json')` → el INSERT viola el constraint.
Y el upsert (`index.ts:838`) **no chequea `error`** → la fila nunca se crea y
nadie se entera. Resultado: si el proveedor manda la invalidación ANTES que el
DTE (o el DTE nunca llega), la anulación se pierde para siempre — y el mensaje
ya quedó marcado en `processed_messages`, así que no se reintenta.

- [ ] Verificar en prod si el CHECK fue ampliado por una migración solo-servidor
      (historial server≠git conocido). Si no:
- [ ] Migración: `ALTER TABLE ... DROP CONSTRAINT ... ; ADD CHECK (kind IN
      ('orphan_pdf','invalid_json','invalidacion_pendiente'))` (staging → prod).
- [ ] Chequear `error` en TODOS los upserts/updates de la edge function que hoy
      lo ignoran (regla explícita del proyecto, ya causó bugs de semanas):
      - `index.ts:465` `selectAllMessageIds` (si falla, doneIds vacío → re-escaneo total)
      - `index.ts:482` `markMessageProcessed` (si falla, re-escaneo eterno de ese mensaje — exactamente el bug que esta tabla vino a arreglar)
      - `index.ts:622` update de `invalidado` (si falla, la invalidación se descarta como procesada)
      - `index.ts:740` lookup de supplier (si falla, supplier_id NULL en silencio)
      - `index.ts:815` y `:838` upserts a `review_queue` (el caso de arriba)
      Cualquier error → `warnings.push(...)` como mínimo; para `markMessageProcessed`
      y los upserts de review, NO marcar el mensaje como procesado si falló.
- [ ] Remediación de lo ya perdido: correr `debug_query` sobre el rango completo
      (bypassea `processed_messages`) y contar cuántas invalidaciones pendientes
      existían; re-procesarlas.
- [ ] UI: `TabRevision` muestra todo lo no-orphan como badge "JSON inválido" —
      agregar badge propio "Invalidación pendiente" (con el `reason`, que ya trae
      el código del DTE original).

### 1.2 ⚠️ `invalidado` invisible = riesgo fiscal real

Art. 119-E CT (Decreto 487): *"Los documentos invalidados … no podrán amparar
las deducciones de las erogaciones correspondientes, asimismo, quedarán sin
valor alguno sus representaciones gráficas."* El sync marca
`purchase_dte_documents.invalidado=true` (v2.23.9), pero:
- `get_purchase_dte_documents` (última versión, `20260718150000_...enriquecido.sql`)
  **no selecciona** `invalidado`/`invalidado_motivo`/`invalidado_at`.
- Ningún componente de `src/` lo lee. Un CCF anulado por el proveedor se ve
  idéntico a uno válido → contabilidad podría deducir IVA de un documento sin valor.

- [ ] `CREATE OR REPLACE` del RPC agregando las 3 columnas (staging → prod).
- [ ] `TabDocumentos`: badge rojo "Invalidado" en la columna Tipo (patrón §16
      DESIGN.md: borde + fondo `/10`) + tooltip con motivo/fecha.
- [ ] `FormPurchaseDteViewer`: banner de invalidado en el detalle.
- [ ] Filtro rápido "Invalidados" (o incluirlos en el buscador) para que
      contabilidad pueda revisarlos al cierre del mes.

### 1.3 Filtro "(sin match ERP)" en Proveedores muestra siempre 0 filas

`ProveedoresView.jsx:97-113`: cuando `categoriaId === SIN_MATCH_ERP`, el
`else if (categoriaId)` de la línea 102 lo captura ANTES (es truthy y ≠
SIN_CATEGORia) y compara `r.categoria_id !== '__sin_match__'` → descarta TODAS
las filas. El bloque `if (categoriaId === SIN_MATCH_ERP) { /* manejado abajo */ }`
de la línea 104 es código muerto (nunca se alcanza con efecto).

- [ ] Excluir `SIN_MATCH_ERP` del branch de categoría:
      `else if (categoriaId && categoriaId !== SIN_MATCH_ERP) { ... }`.
- [ ] Verificación visual (regla del proyecto): seleccionar "(sin match ERP)"
      y confirmar que aparecen los proveedores sin `supplier_id`.

### 1.4 ZIP: colisión de nombres para documentos sin JSON

Los documentos "confirmados sin JSON" tienen `codigo_generacion NULL` →
`export-purchase-dte-zip/index.ts:72,77` y `facturasCompra.js:61-75` generan
`null.json`/`null.pdf`/`null.zip`. Con 2+ docs así en la misma descarga masiva,
JSZip los pisa entre sí (se pierden archivos sin aviso).

- [ ] Fallback de nombre: `codigo_generacion ?? `doc-${row.id}`` en ambos lados
      (mismo criterio que ya usa el botón de descarga individual,
      `FacturasCompraView.jsx:294`).
- [ ] `export-purchase-dte-zip`: además chequear `error` de los `.download()`
      (hoy un archivo que falla simplemente falta en el ZIP sin rastro) —
      devolver un `warnings[]` en un `manifest.txt` dentro del ZIP o al menos
      loguearlo.

---

## FASE 2 — Consistencia proveedor (maestro vs ERP)

### 2.1 El filtro "Proveedor" de Facturas de Compra sigue anclado al ERP

`FacturasCompraView.jsx`: el selector usa `fetchSuppliersBasic()` (tabla
`suppliers`, ERP) y filtra por `supplier_id` (`:255-256`), pero desde la Fase 4.4
del plan de proveedores la fuente primaria mostrada es `proveedor_id`
(maestro). Consecuencias reales:
- Un doc con `proveedor_id` pero sin `supplier_id` **muestra** nombre de
  proveedor, pero el filtro "(sin proveedor)" lo incluye igual (contradictorio).
- Proveedores que solo existen en el maestro (sin match ERP) no se pueden
  filtrar en absoluto.

- [ ] Cambiar el selector a `proveedores_maestro` (`fetchProveedoresMaestro()` ya
      existe) y filtrar por `proveedor_id`; "(sin proveedor)" = `!proveedor_id`.
- [ ] `SupplierMatchCell`: el botón "Emparejar" hoy guarda `supplier_id`
      (`set_purchase_dte_supplier`). Decidir con el usuario si el match manual
      debe apuntar al maestro (`proveedor_id`) — recomendado — o mantener ambos.

### 2.2 Match NRC del sync NO normalizado (inconsistente con el RPC)

`sync-purchase-emails/index.ts:740` resuelve `supplier_id` con `.eq('nrc', emisorNrc)`
(match exacto), pero `20260718130000_proveedores_match_erp_nrc_normalizado.sql`
demostró que `suppliers.nrc` a veces trae guión y el DTE nunca → el RPC ya
matchea por dígitos normalizados. El sync quedó con la versión vieja: documentos
de esos proveedores quedan con `supplier_id NULL` aunque el maestro sí matchea.

- [ ] Opción simple (recomendada): eliminar el lookup propio del sync y derivar
      `supplier_id` del maestro — `upsert_proveedor_from_dte` ya calcula el
      match normalizado; basta con que el sync, tras obtener `proveedorId`, lea
      `proveedores_maestro.supplier_id` y lo copie al documento (o que el RPC
      devuelva `(id, supplier_id)`). Una sola fuente de verdad del match.
- [ ] Backfill one-off: `UPDATE purchase_dte_documents d SET supplier_id = p.supplier_id
      FROM proveedores_maestro p WHERE d.proveedor_id = p.id AND d.supplier_id IS NULL
      AND p.supplier_id IS NOT NULL`.

### 2.3 Decisiones menores del maestro (consultar al usuario, 5 min)

- **P4**: las NC/ND (05/06) incrementan `docs_count` y actualizan
  `ultima_vez_visto` — ¿una nota de crédito cuenta como "compra"? Hoy sí.
- **P5**: `percibe_1` — el doc dice "override manual manda", pero el OR del
  upsert (`percibe_1 OR coalesce(...)`) revierte a `true` un override manual
  `false` con el siguiente DTE que traiga `ivaPerci1>0`. Si el override debe
  mandar de verdad, hace falta una columna `percibe_1_override boolean NULL`
  (NULL = automático).

---

## FASE 3 — Cumplimiento legal (docs/legal, verificado contra el texto)

**Base legal confirmada:**
- Art. 147 CT inciso 1: conservar **10 años** desde emisión/recibo.
- Decreto 487 Art. 3 (incisos 5-7 del 147): los DTE se conservan en electrónico
  "garantizando su **consulta e integridad**"; las representaciones gráficas
  (PDF) "en el **mismo formato y medio** en que fueron originalmente expedidas";
  la conservación es responsabilidad **exclusiva del contribuyente** (el MH no
  repone documentos).
- Art. 119-E: invalidados no amparan deducciones (→ Fase 1.2).
- Art. 65/65-A Ley IVA: crédito fiscal solo con CCF que cumpla requisitos.

### 3.1 El JSON guardado NO es el original recibido (integridad)

`sync-purchase-emails/index.ts:711-718`: se sube `JSON.stringify(json)` del
objeto **ya desenvuelto y reparado** (`unwrapDteEnvelope` + `repairMojibakeDeep`),
no los bytes originales del adjunto. Además `repair_stored_json` reescribe
archivos ya guardados (`upsert: true`). Consecuencias:
- Se descarta el **sobre de Hacienda** (`selloRecibido` + `firmaElectronica`)
  cuando el proveedor lo manda (caso farmavalue) — justamente la evidencia
  criptográfica de que el DTE fue recibido por el MH.
- El archivo conservado es una re-serialización nuestra: ante una fiscalización
  no se puede demostrar integridad byte-a-byte contra la firma.

- [ ] Guardar TAMBIÉN el adjunto original intacto: `<yyyy>/<mm>/<codigo>.orig.json`
      (bytes crudos, sin tocar). El normalizado sigue siendo el que lee el portal.
      Costo: ~KB por documento, cero cambio de UI.
- [ ] Capturar `sello_recibido` como columna en `purchase_dte_documents` cuando
      el sobre lo traiga (hoy se tira) — permite además distinguir DTE con/sin
      sello a futuro.
- [ ] Backfill: NO es posible para lo ya sincronizado (los bytes originales solo
      viven en Gmail) — opcional: re-descarga vía `debug_query` para el
      histórico si el usuario lo considera necesario; documentar la decisión.

### 3.2 Documentos "confirmados sin JSON" no cumplen conservación del DTE

`resolve_purchase_dte_review('confirmado')` crea el documento solo con PDF. El
PDF es la representación gráfica; el DTE legal es el JSON. Para el crédito
fiscal de esos CCF no hay documento electrónico conservado.

- [ ] Marcar operativamente estos docs como "pendiente de JSON" (el badge "Sin
      JSON" ya existe — agregar al plan de trabajo del usuario: pedir el JSON al
      proveedor o bajarlo del portal de consulta del MH con el código de
      generación impreso en el PDF).
- [ ] Cuando el JSON aparezca: hoy NO hay flujo para adjuntarlo a un doc
      confirmado (el sync crearía un doc nuevo duplicado sin PDF). Agregar en el
      sync: si un DTE válido nuevo matchea por `numero_control`/monto/fecha a un
      doc `codigo_generacion IS NULL` del mismo emisor → fusionar en vez de
      insertar. (Baja frecuencia; puede ser acción manual "Adjuntar JSON" en la UI.)

### 3.3 Retención de tablas de log (regla del proyecto, no legal)

- [ ] `email_sync_log` no tiene purga (regla CLAUDE.md #7: retención desde el
      día 1). Sumarla al cron `purge-sync-logs-daily` (90 días).
- [ ] `purchase_dte_processed_messages` **NO se purga nunca** (es el ledger
      anti-re-escaneo; borrarlo re-escanearía Gmail completo) — dejar comentario
      `COMMENT ON TABLE` para que nadie lo agregue a una purga futura.
- [ ] Los archivos de `review/` en Storage de filas descartadas se conservan
      (correcto para el Art. 147 — no borrar).

---

## FASE 4 — Búsqueda por contenido del JSON (pedido del usuario)

**Caso real:** COFARSAL vende saldo Claro/Tigo/etc. en sus CCF. Hoy la búsqueda
solo cubre proveedor/NIT/número de control/código — encontrar "el CCF que trae
Claro" obliga a abrir documento por documento. La información SÍ está en el DTE:
`cuerpoDocumento[].descripcion` (estructura oficial, `dte_guia_tecnica.pdf`).

### Diseño

1. **Columna nueva** `items_text text` en `purchase_dte_documents` + generada
   `items_norm text GENERATED ALWAYS AS (norm_search(items_text)) STORED`
   (mismo patrón que `proveedores_maestro.nombre_norm`, migración
   `20260718100000`). Contenido: `cuerpoDocumento[].descripcion` únicas,
   unidas con ` | ` (+ `codigo` del ítem si existe). Cap defensivo ~8KB por doc.
2. **Sync**: al insertar, la edge function arma `items_text` desde el JSON ya
   parseado (1 línea en el `row`). También en el flujo de invalidación no aplica
   (no trae cuerpo).
3. **Backfill**: nuevo modo `backfill_items_text: true` en `sync-purchase-emails`
   (mismo patrón `repair_stored_json`: pagina `purchase_dte_documents` con
   `items_text IS NULL`, baja el JSON de Storage, extrae, UPDATE). Idempotente,
   `hasMore` por presupuesto de tiempo. ~1,100 docs → 2-3 corridas.
4. **Búsqueda** — dos capas, siguiendo `design_search_standard.md`:
   - **Cliente (alcanza para v1)**: exponer `items_text` en
     `get_purchase_dte_documents` y sumarlo al `tokenMatch` de `TabDocumentos`
     (`FacturasCompraView.jsx:257`). Buscar "claro" encuentra el CCF aunque el
     emisor sea COFARSAL. Cuidado con payload: `items_text` puede ser largo —
     medir; si el JSON del rango típico (1 mes ≈ 200-400 docs) supera ~2-3MB,
     pasar a la capa servidor.
   - **Servidor (si el payload crece o se quiere buscar fuera del rango de
     fechas)**: parámetro opcional `p_search` en el RPC con el patrón estándar
     `items_norm LIKE ALL(tokens)` sobre `norm_search(p_search)` — con ~miles de
     filas no necesita ni índice trigram; si algún día duele, GIN pg_trgm.
5. **UX**: cuando el match viene del contenido (y no del proveedor/número),
   mostrar bajo el nombre del proveedor un sub-texto con el fragmento del ítem
   que matcheó (ej. "…SALDO CLARO $5…") para que el usuario entienda por qué
   apareció la fila. En el modal de detalle ya se ven los ítems completos.

- [ ] Migración columna + norm (staging → prod, `lock_timeout='5s'`).
- [ ] Edge function: `items_text` en insert + modo backfill; deploy CLI (workaround `.env`).
- [ ] Correr backfill hasta `hasMore:false`.
- [ ] RPC + vista + verificación visual: buscar "claro" y "tigo" con datos reales.
- [ ] Bump `APP_VERSION` + changelog; migración prod ANTES del push.

---

## FASE 5 — Eficiencia (ninguna urgente; ordenadas por retorno)

| # | Qué | Dónde | Detalle |
|---|---|---|---|
| E1 | `getDoneMessageIds` carga TODA la tabla de procesados en cada corrida | `sync-purchase-emails/index.ts:460-479` | Crece sin tope (hoy ~miles, +cada correo para siempre). Invertir el chequeo: con los `allMessageIds` de la corrida (chico: ventana de 3 días tras el backfill), `SELECT ... WHERE source_message_id IN (...)` en chunks de 500. Corrida diaria pasa de O(historial) a O(ventana). |
| E2 | `markMessageProcessed` = 1 upsert por mensaje | `index.ts:481-484` | Acumular y hacer 1 upsert en lote por corrida (cuidando marcar solo mensajes completados si se corta por presupuesto). |
| E3 | Lookup de supplier 1 query por documento | `index.ts:740` | Desaparece solo si se aplica 2.2 (derivar del maestro). Si no, cachear en un `Map<nrc, id>` por corrida. |
| E4 | `export-purchase-dte-zip` descarga archivos en serie | `index.ts:68-79` | `Promise.all` en tandas de ~8 → una descarga de 300 docs baja de minutos a segundos. |
| E5 | "Sincronizar ahora" pide al usuario re-clickear si `hasMore` | `FacturasCompraView.jsx:727-744` | Auto-reinvocar en loop mientras `hasMore` (con contador visible "tanda 2/…"), tope de seguridad ~10 tandas. |
| E6 | Backfills se atascan si se acumulan filas no-procesables | `backfill-proveedores-dte:52-58`, `backfill-dte-related-docs:48-54` | El batch es siempre "los primeros 200 por id sin FK" — una fila que siempre falla (JSON roto) o NC sin match posible queda en el head para siempre; con ≥200 así, `hasMore` nunca baja y el caller entra en loop infinito re-procesando lo mismo. Agregar marcador de intento (`*_checked_at` o filtro `id > last_id` paginado por cursor). Hoy el volumen es bajo — arreglar antes de programarlos como cron. |
| E7 | Predicado no indexable en el RPC de documentos | `get_purchase_dte_documents` | `coalesce(fecha_emision, created_at::date) BETWEEN ...` no usa `idx_purchase_dte_docs_fecha`. Irrelevante con 1,100 filas; si la tabla llega a decenas de miles, índice de expresión o reescribir como OR. Solo anotar. |
| E8 | `collectLinkAttachments` corre para TODO mensaje | `index.ts:559` | Incluso cuando el correo ya trae adjuntos JSON válidos, se fetchean links externos (hasta 10 por mensaje, 15s timeout c/u). Posible corto-circuito: si los adjuntos ya dieron ≥1 DTE válido y ningún PDF falta, saltar links. Riesgo bajo de perder algo (evaluar contra datos reales antes). |

---

## FASE 7 — Proveedores: hacia un sistema contable completo (auditoría 2026-07-22)

> Contexto: "Tipo de Proveedor" mostraba la clase de gasto/costo de la
> categoría asignada, no una clasificación real del proveedor — corregido en
> v2.27.1 (renombrado a "Categoría Contable" + nuevo campo real "Tipo de
> Proveedor" = régimen fiscal, Contribuyente de IVA vs Sujeto Excluido, Art.
> 119 CT — derivado de `nrc IS NOT NULL`, sin columna nueva). También se
> agregó `alias` (búsqueda alterna). Lo de abajo es lo que falta, según lo
> verificado contra `codigo_tributario.pdf` — **nada de esto se ha
> implementado todavía**, es la lista para cuando se retome.

| # | Qué | Por qué (fundamento legal) | Estado hoy |
|---|---|---|---|
| P1 | Gran Contribuyente explícito por proveedor | Art. 162-163 CT: si Farmalasa es Gran Contribuyente, debe RETENER 1% a proveedores que NO lo sean; si el proveedor SÍ lo es, él nos PERCIBE 1%. Hoy solo se infiere de `percibe_1=true` (19 de 97 proveedores lo tienen) — no hay campo dedicado, y falta el cálculo de la retención que Farmalasa debería aplicar (dirección inversa). | Sin implementar |
| P2 | Retención de Renta accionable | Art. 156 CT: 10% a personas naturales sin relación de dependencia por servicios. `retiene_renta` existe pero es puramente informativo (0 de 97 hoy — ningún Sujeto Excluido aún). El día que aparezca uno prestando un servicio (categorías "Servicios profesionales y honorarios" o "Mantenimiento y reparaciones" ya existen en el catálogo), el sistema debería recordar/generar la obligación de emitir Comprobante de Retención, no solo guardar un booleano. | Sin implementar |
| P3 | Datos bancarios para pago | Estándar de cuentas por pagar — pagar por transferencia, no solo cheque. Solo existe "Nombre para Cheques" hoy. | Sin implementar |
| P4 | Términos de pago / plazo de crédito | Contado / 15 / 30 / 45 días — básico para flujo de caja y antigüedad de saldos. No existe ningún campo. | Sin implementar |
| P5 | Cuentas por pagar / antigüedad de saldos | El módulo trackea documentos RECIBIDOS (facturas), no si están pagados. No hay forma de saber cuánto se le debe a cada proveedor ni desde cuándo (aging). | Sin implementar |
| P6 | Comprobante de Retención emitido por Farmalasa | Cuando aplique P1/P2, ¿dónde queda registrado el DTE tipo 07 que Farmalasa (como retenedor) debe emitirle al proveedor? Confirmar si esto vive en el ERP o es un hueco real del portal. | Sin confirmar — preguntar antes de asumir que falta |

Ver conversación 2026-07-22 para el detalle de cómo se verificaron los
artículos (Art. 119, 156, 162, 163 CT — todos contra el texto real de
`docs/legal/codigo_tributario.pdf`, no de memoria).

---

## FASE 6 — Cierre

- [ ] Security advisor 0 ERRORES tras cada migración (staging y prod).
- [ ] `npm run build` + verificación visual Playwright (login + screenshots de:
      badge Invalidado, filtro sin-match-ERP, búsqueda "claro"/"tigo").
- [ ] Actualizar memoria `project_facturas_compra_email_module.md` +
      `project_proveedores_maestro_module.md` con el estado post-plan.
- [ ] Recordatorio pendiente de la sesión anterior (no de este plan): cron
      `sync-purchase-emails-daily` sigue `active=false` (jobid 183) y correo 3
      sin conectar — sin el cron, TODO lo anterior depende del botón manual.

---

## Orden de prioridad sugerido

1. **Fase 1** completa (1.1 pérdida de datos activa; 1.2 riesgo fiscal; 1.3/1.4 rápidos).
2. **Fase 4** (la feature pedida — valor directo para el usuario).
3. **Fase 2** (consistencia maestro/ERP; 2.2 mejora datos de toda corrida futura).
4. **Fase 3** (legal estructural — 3.1 conviene pronto porque cada corrida sin
   el fix pierde los bytes originales de más documentos).
5. **Fase 5** (cuando toque; E1/E4/E5 son las de mejor retorno).
