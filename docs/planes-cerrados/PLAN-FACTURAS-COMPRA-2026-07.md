# PLAN DE EJECUCIÓN — Módulo "Facturas de Compra" por Correo (DTE)

> **Prompt de ejecución autocontenido.** Cualquier sesión de Claude Code puede retomar
> este plan desde el estado marcado en los checkboxes. Ejecutar fase por fase, en orden.
> NO saltar a la fase siguiente con ítems abiertos en la actual (incluye follow-ups
> externos del usuario). TODO write a producción (dato, DDL o registro de migración)
> requiere OK explícito del usuario EN EL MOMENTO — una aprobación previa no lo cubre.

**Fecha del plan:** 2026-07-17 · **Aprobado por:** usuario (enfoque confirmado)
**Memoria relacionada:** `project_facturas_compra_email_module.md`

> **ESTADO (actualizado 2026-07-18): Fases 1-5 completas y verificadas en
> producción (BD, edge function, cron registrado, UI completa con modal de
> detalle + 3 formas de descarga + cola de revisión con match/descarte). Solo
> quedan diferidos, ninguno bloqueante: correo 3 sin conectar, cuenta 2 sin
> backfill manual (se completa sola cuando se active el cron), y el cron mismo
> registrado pero `active=false` a propósito hasta que el usuario dé el OK
> (Fase 6). Ver checkboxes actualizados abajo por fase.**

---

## 1. Objetivo

Las facturas de compra (DTE de El Salvador: JSON + PDF) llegan como adjuntos a 4
correos de la empresa. Hoy nadie las centraliza. El portal debe:

1. Leer diariamente las bandejas y bajar los adjuntos DTE (JSON y su PDF).
2. Categorizarlos automáticamente por tipo (`identificacion.tipoDte` del propio JSON).
3. Guardarlos en Supabase Storage (privado) + metadatos en BD, con dedupe.
4. Mostrarlos en un módulo nuevo del portal con filtros por fecha, tipo y proveedor,
   búsqueda, y descarga de JSON/PDF.
5. Backfill desde el **1 de junio de 2026** en adelante; luego cron diario.

**Decisión de arquitectura de correo (confirmada por el usuario):** las 3 cuentas
Gmail se conectan por API. La cuenta Outlook NO se conecta por API: se le crea una
regla de reenvío ("tiene datos adjuntos" → reenviar) hacia una de las cuentas Gmail.
El filtro fino no lo hace la regla (Outlook no filtra por extensión de adjunto): lo
hace la edge function, que descarta todo adjunto que no sea un JSON de DTE válido.

**Decisión de descargas + previsualización (confirmada por el usuario, 2026-07-17):**
verificado primero que NO existe en el portal ningún patrón de ZIP/descarga masiva
(sin `jszip`/`archiver` en `package.json`, ningún edge function que empaquete
Storage) — se construye desde cero. Sí existe y se reusa el modal de
previsualización de documentos (`openModal('viewDocument', {url, title})` →
`FormDocumentViewer.jsx`, ya wireado en `UnifiedModal.jsx`).
  - **Descarga individual** (ya estaba): botón JSON y botón PDF por fila, sin cambios.
  - **Descarga "paquete" de un documento** (JSON+PDF juntos): ZIP liviano armado
    **client-side** con `jszip` (dependencia nueva, solo 2 archivos por descarga —
    no amerita ida al servidor).
  - **Descarga masiva** ("todos los del mes" / los que estén filtrados en pantalla):
    **server-side**, edge function nueva (ej. `export-purchase-dte-zip`) que recibe
    los mismos filtros que `get_purchase_dte_documents` (o una lista de IDs), arma
    el ZIP con los archivos de Storage y lo devuelve streameado en la respuesta HTTP
    (sin persistir un zip temporal en Storage que después haya que purgar). Evita
    cargarle al navegador docenas/cientos de descargas simultáneas.
  - **Previsualización**: reusar `openModal('viewDocument', ...)` para el PDF tal
    cual ya funciona en el resto del portal (embebido vía `<object>`/`<iframe>`,
    botón de descarga incluido). Para el JSON, el visor genérico solo lo mostraría
    como texto crudo — no es "mejor vista". Se agrega un modal nuevo específico del
    DTE (parseando la estructura oficial del MH de El Salvador) con: encabezado
    (emisor, receptor, número de control, fecha), tabla de ítems (descripción,
    cantidad, precio, IVA), totales — con pestaña/toggle para alternar a "Ver PDF"
    cuando exista. Mismo shell glassmorphism de `UnifiedModal`/`LiquidModal`.

**Decisión "Sincronizar ahora" (confirmada por el usuario, 2026-07-17):** además del
cron diario, la vista tiene un botón manual que invoca `sync-purchase-emails` bajo
demanda (mismo patrón que `generateBranchAiSummary` en `BranchesView.jsx:218-248`:
un solo booleano `isSyncing`, try/catch/finally, `supabase.functions.invoke(...)`,
resultado/errores en estado local — no hay librería de toasts en este proyecto).
Gateado por `hasPermission('facturas_compra','can_edit')` (dispara una escritura).

**Decisión de PDFs sin JSON o sin match de filename (confirmada por el usuario,
2026-07-17, IMPLEMENTADA y luego generalizada):** en vez de descartarlos en
silencio, se guardan en una cola de revisión manual. **Nombre final de la
tabla: `purchase_dte_review_queue`** (no `purchase_dte_unmatched_pdfs` como
decía la primera versión de este plan — se generalizó tras ver casos reales de
JSON inválido/documentos de "invalidación" DTE que también necesitaban cola de
revisión, no solo PDFs huérfanos). Cubre 3 casos:
  a) **PDF sin JSON en el correo** (`kind='orphan_pdf'`): queda `pendiente`.
     **Decisión final tras medir volumen real (Fase 3.5): NO se construye la
     UI con IA asistida.** 66 de 97 casos eran ruido de un solo remitente
     (Promerica, descartados); el resto es bajo y fragmentado. Alcanza con
     "Descartar" desde la UI.
  b) **Varios DTE en un correo, PDF no matchea por nombre de archivo a
     ninguno** (`kind='orphan_pdf'` también): acción real implementada
     — botón **"Emparejar a documento existente"** en la UI
     (`MatchDocumentAction`), llama a `resolve_purchase_dte_review('emparejado',
     p_matched_document_id)`.
  c) **JSON que no parsea o no valida** (`kind='invalid_json'`, incluye
     documentos de "invalidación" DTE con esquema distinto): mismo estado
     `pendiente`, solo acción "Descartar" disponible (no tiene sentido
     "emparejar" un JSON inválido a un documento).
  Columnas reales: `kind`, `file_path` (URL formato-public, no ruta cruda),
  `filename`, `reason` (solo invalid_json), `account_id`, `source_message_id`,
  `from_email`, `subject`, `received_at`, `status`
  ('pendiente'/'emparejado'/'descartado'), `matched_document_id` (FK nullable),
  `ai_suggested` (jsonb, sin uso — la IA no se construyó), `resolved_by`/
  `resolved_at`. Constraint `UNIQUE(account_id, source_message_id, filename)`
  para idempotencia de reintentos. RLS: SELECT por `auth_has_module_permission`,
  UPDATE por `auth_can_edit_any(['facturas_compra'])`.

**Decisión de matching de proveedor (confirmada por el usuario, 2026-07-17):** cada
documento debe intentar emparejarse contra el catálogo de proveedores existente. La
tabla correcta es `public.suppliers` (catálogo sincronizado desde el ERP vía
`sync-erp-purchases`, 78 filas, `nrc` con formato idéntico al `emisor.nrc` del DTE —
ej. `"1166-5"`), **no** `public.proveedores` (18 filas, tabla curada para reglas de
devolutivo/ND, sin columna NIT/NRC).

**Actualizado (2026-07-17, tras feedback) — APLICADO:** en vez de un `LEFT JOIN`
puro al vuelo, `purchase_dte_documents` tiene una columna real `supplier_id
bigint references suppliers(id)` (migración adicional
`20260717_purchase_dte_email_sync_v2.sql`, aplicada staging+prod). La edge function la llena automáticamente
al insertar (buscando por NRC). Motivo del cambio: se necesita **match manual** para
los casos sin match automático (NRC con formato distinto, proveedor nuevo aún no en
`suppliers`) — botón "Emparejar" en la fila abre un `LiquidSelect` sobre `suppliers`,
guarda vía RPC (con su policy de escritura y su línea en `appendAuditLog`). Filtro
adicional en la vista: opción "(sin proveedor)" en el selector de proveedor, para
encontrar rápido la cola de pendientes de emparejar. El emisor_nombre/nrc crudo del
DTE siempre se guarda tal cual llega (es el documento legal) — `supplier_id` es
metadato adicional, nunca reemplaza el dato crudo.

---

## 2. Resultado esperado final (criterios de aceptación)

- [x] Las facturas de junio 2026 → hoy están en el portal — **cumplido para
      `CORREO_1`** (339 docs). `CORREO_2` diferido (se completa solo vía cron).
      `CORREO_3`/Outlook no verificados por Claude, según lo acordado con el usuario.
- [x] Cada documento aparece UNA sola vez (dedupe por `codigo_generacion` UNIQUE +
      idempotencia de reintentos verificada en la corrida real de 339 documentos).
- [x] Cada fila muestra: tipo legible (badge), número de control, proveedor (nombre +
      match), fecha de emisión, monto total, y descargas (JSON, PDF, paquete) con
      URL firmada (bucket privado) — **más de lo pedido**: también descarga masiva
      y modal de detalle parseado.
- [ ] El cron corre todos los días a las 3:00 AM — **registrado pero inactivo**,
      pendiente del OK del usuario (Fase 6).
- [x] Un correo con adjuntos que NO son DTE se ignora (verificado con los ZIP
      diarios de SERFINSA en datos reales — descartados con warning, sin fila).
- [x] Security advisor de Supabase en 0 ERRORES tras TODAS las migraciones
      (verificado en cada una, no solo al final).
- [x] Solo los roles autorizados ven el módulo — verificado visualmente: un rol
      sin permiso ve "Acceso denegado"; con permiso ve el módulo completo.
- [x] Verificación visual hecha — múltiples rondas con Playwright y datos reales
      (lista, cola de revisión, modal de detalle, descargas).

---

## 3. Variables del plan

| Variable | Valor | Estado |
|---|---|---|
| `SUPABASE_PROD` | `sacecdkdmsdvgqnrsett` | fijo |
| `SUPABASE_STAGING` | `ewcmerxqjvludtgskuin` (branch sin PII) | fijo |
| `MODULE_KEY` | `facturas_compra` | fijo |
| `EDGE_FN` | `sync-purchase-emails` | fijo |
| `BUCKET` | `purchase-dte` (privado, 10 MB, json+pdf) | fijo |
| `TABLA_CUENTAS` | `email_sync_accounts` | fijo |
| `TABLA_DOCS` | `purchase_dte_documents` | fijo |
| `MIGRACION_BASE` | `20260717_purchase_dte_email_sync.sql` | ✅ aplicada staging+prod (v2.19.5). Más migraciones agregadas después (ver §Fase 1) |
| `BACKFILL_FROM` | `2026/06/01` (query Gmail `after:`) | fijo |
| `OVERLAP_DIAS` | 3 (ventana de solape en cada corrida) | fijo |
| `CRON_NAME` / `CRON_SCHEDULE` | `sync-purchase-emails-daily` / `0 9 * * *` UTC (= 3:00 AM SV, UTC-6) | ✅ registrado (jobid 183), **`active=false` a propósito** — reactivar en Fase 6 |
| `RUTA_STORAGE` | `purchase-dte/<YYYY>/<MM>/<codigoGeneracion>.json` (+ `.pdf`) | fijo — BD guarda la URL formato-public completa, no la ruta cruda (ver gotcha en memoria) |
| `GMAIL_SCOPE` | `https://www.googleapis.com/auth/gmail.readonly` | fijo |
| `CORREO_1` (recibe el reenvío del Outlook) | `farmasalud.sv@gmail.com` | ✅ conectado, backfill completo (339 docs) |
| `CORREO_2` | `compraslasalud.sv@gmail.com` | ✅ conectado (credenciales + secrets), **backfill diferido** — se completa solo vía cron cuando se active |
| `CORREO_3` | `<PENDIENTE — usuario>` | ⬜ diferido, no bloqueante |
| `CORREO_OUTLOOK` | reenvía a uno de `CORREO_1`/`CORREO_2` | ✅ según el usuario (no verificado técnicamente por Claude) |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | **Por cuenta, no compartido** — 2 proyectos GCP separados: `GMAIL_CLIENT_ID_1/2` + `GMAIL_CLIENT_SECRET_1/2` | ✅ seteados como secrets de la edge function (Deno.env, no Vault) |
| `GMAIL_RT_1..3` | `GMAIL_RT_1`/`GMAIL_RT_2` seteados; `GMAIL_RT_3` pendiente (correo 3). `email_sync_accounts.vault_secret_name`/`client_id_secret_name`/`client_secret_secret_name` guardan los NOMBRES de los secrets | 2/3 ✅ |
| `ROLES_CON_ACCESO` | Gerente General (`role_id 2`) + Administrador (`role_id 3`) + `role_id 13` (Supervisor de Ventas, cuenta de prueba del usuario, acceso permanente por pedido explícito) | ✅ |

**Mapa `tipoDte` → etiqueta** (constante compartida, `src/utils/dteTypes.js`):
`01` Factura · `03` Crédito Fiscal (CCF) · `04` Nota de Remisión · `05` Nota de
Crédito · `06` Nota de Débito · `07` Comprobante de Retención · `08` Comprobante de
Liquidación · `09` Doc. Contable de Liquidación · `11` Factura de Exportación ·
`14` Factura Sujeto Excluido · `15` Comprobante de Donación. Tipo desconocido →
mostrar el código crudo, nunca ocultar la fila.

---

## 4. Reglas del portal que aplican (recordatorio obligatorio)

1. **Staging primero** para todo DDL: `apply_migration` contra `SUPABASE_STAGING`,
   verificar, y solo entonces prod **con OK humano en el momento**.
2. `SET lock_timeout = '5s';` en TODA migración. (Estas tablas son nuevas — no hay
   riesgo de lock sobre tablas calientes — pero la regla es sin excepción.)
3. El `name` de `apply_migration` = nombre EXACTO del archivo en
   `supabase/migrations/`, creado en la misma sesión. Nunca consolidar/renombrar.
4. Policies: toda llamada `auth_*` envuelta en `(SELECT ...)`. RLS en toda tabla.
   FKs con índice. Vistas nuevas `security_invoker = true`.
5. Edge functions: **jamás ignorar `error`** de un query supabase-js. Prohibido el
   upsert incondicional (usar `ON CONFLICT ... DO NOTHING` — un DTE nunca cambia).
6. Deploy de edge functions: CLI con workaround `.env` (mv antes/después). **NUNCA**
   la MCP `deploy_edge_function`.
7. PostgREST trunca a 1000 filas: la vista carga datos con Patrón C (RPC
   `RETURNS json` + `json_agg(to_json(t))`) o filtro de fecha acotado. Nunca un
   `.select()` plano sobre la tabla completa.
8. Storage: **regla mal citada en la versión original de este plan — corregido.**
   En BD se guarda la URL **formato-public completa**
   (`.../storage/v1/object/public/<bucket>/<path>`), NUNCA la ruta cruda ni una
   URL firmada (la regla real del proyecto, CLAUDE.md #10). Firmar solo al
   mostrar con `getSignedFileUrl`/`openStoredFile`, que esperan esa forma de
   URL para poder parsear bucket+path. `purchase-dte` ya está en
   `PRIVATE_BUCKETS` en `src/utils/storageFiles.js`. Este malentendido causó un
   bug real: la primera corrida guardó rutas crudas, corregido con `publicUrl()`
   en la edge function + backfill de las filas ya insertadas.
9. UI: LiquidSelect (nunca `<select>`), ViewTabBar con búsqueda en el header,
   DataTable estándar (numéricos centrados), filter pill estándar, empty state
   glassmorphism, contraste mínimo `text-slate-600`, PROHIBIDO border-l coloreado.
10. Toda acción de usuario (incluida descarga de factura) → `appendAuditLog`.
11. Checklist de módulo nuevo (5 pasos): vista, ruta, menú, pantalla de permisos, BD.
12. Bumpar `APP_VERSION` + changelog en `src/version.js` en CADA commit; commit+push
    al terminar cada cambio. **Migraciones de prod ANTES del push del frontend**
    (Vercel auto-deploya en segundos).
13. Roles: enrutar por `role_id` directo, nunca por `system_role` genérico.
14. Verificación visual barata obligatoria al cerrar la UI (login + screenshots).

---

## Fase 0 — Prerrequisitos externos (usuario) ✅ (2/3 correos — correo 3 diferido)

- [x] **0.1 Autorizar el MCP de Supabase** en la sesión (OAuth).
- [x] **0.2 Proyecto Google Cloud** — **2 proyectos separados** (uno por cuenta,
      no uno compartido como asumía el plan original), ambos confirmados "En
      producción" por el usuario.
- [x] **0.3 Correr `gmail-refresh-token.mjs`** — hecho para `CORREO_1` y
      `CORREO_2`. **`CORREO_3` diferido**, no bloqueante.
- [x] **0.4 Regla de reenvío en Outlook** — confirmada por el usuario (reenvía
      a uno de los 2 correos ya conectados). No verificada técnicamente por
      Claude, asumida por instrucción explícita del usuario 2026-07-18.
- [x] **0.5 Reenviar a mano correos de junio del Outlook** — según 0.4, el
      dedupe (`ON CONFLICT codigo_generacion`) absorbe cualquier repetido si
      se reenvía después.
- [x] **0.6 `ROLES_CON_ACCESO`** — Gerente General (2) + Administrador (3) +
      role_id 13 (cuenta de prueba, permanente). Editable desde Permisos.

**Resultado:** cumplido para 2 de 3 correos. Correo 3 queda como tarea aparte,
no bloquea nada del resto del plan (reusa cualquiera de las 2 credenciales GCP
ya creadas, o se crea una tercera).

---

## Fase 1 — Base de datos ✅ COMPLETA (staging + prod, 0 errores advisor en cada paso)

- [x] **1.1 / 1.2** `20260717_purchase_dte_email_sync.sql` aplicada en staging y prod.
- [x] **1.3** Seeds (`20260717_purchase_dte_email_seeds.sql`): 2 cuentas
      (`CORREO_1`/`CORREO_2`) + permisos `role_id` 2 y 3.
- [x] **1.4** Security advisor: 0 ERRORES, verificado en cada migración.

**Migraciones adicionales agregadas durante la ejecución** (no estaban en el
plan original, surgieron de la revisión de diseño y de bugs reales encontrados
en la primera corrida — todas aplicadas staging→prod con 0 errores):
- `20260717_purchase_dte_email_sync_v2.sql` — `supplier_id` real en
  `purchase_dte_documents` (no solo JOIN), credenciales Gmail por cuenta
  (`client_id_secret_name`/`client_secret_secret_name`), tabla
  `purchase_dte_unmatched_pdfs` (primera versión).
- `20260717_purchase_dte_review_queue.sql` — **reemplaza**
  `purchase_dte_unmatched_pdfs` por `purchase_dte_review_queue` (generalizada:
  `kind` orphan_pdf/invalid_json, no solo PDFs — cubre también documentos de
  "invalidación" DTE que aparecieron en datos reales).
- `20260717_purchase_dte_review_queue_unique.sql` — constraint de idempotencia
  `UNIQUE(account_id, source_message_id, filename)` (necesario para que los
  reintentos de backfill no dupliquen filas).
- `20260717_email_sync_log.sql` — tabla de log dedicada (patrón bloque7B),
  **no** se usó el `sync_log` genérico que asumía el plan original (está
  acoplado a semántica de ventas DTE).
- `20260717_purchase_dte_rpcs.sql` — las 4 RPCs de la Fase 5 (ver ahí).

**Resultado:** cumplido — `email_sync_accounts` con 2 filas activas, bucket
privado, RLS verificada (un rol sin permiso recibe 0 filas — confirmado
visualmente: role_id 13 sin el seed veía "Acceso denegado").

---

## Fase 2 — Edge function `sync-purchase-emails` ✅ COMPLETA, deployada y probada en prod

- [x] **2.1 Escrita** `supabase/functions/sync-purchase-emails/index.ts`. El diseño
      real terminó divergiendo del pseudocódigo original en varios puntos —
      todos por bugs reales encontrados en la primera corrida (346 documentos):

  - **Credenciales por cuenta**, no un `GMAIL_CLIENT_ID`/`SECRET` global — cada
    cuenta lee su propio `client_id_secret_name`/`client_secret_secret_name`.
  - **Procesa en lotes con presupuesto de tiempo** (`TIME_BUDGET_MS=100_000`),
    no todo el historial de una corrida — un backfill grande (300+ docs)
    excedía el límite de ejecución de la plataforma (HTTP 504). La respuesta
    incluye `hasMore`/`remaining`; el caller debe reinvocar hasta
    `hasMore:false`. Salta mensajes ya resueltos (`getDoneMessageIds`) para
    que los reintentos sean rápidos y no repitan trabajo con Gmail.
  - `sanitizeStorageKey()` — Supabase Storage rechaza rutas con espacios/
    acentos/símbolos (nombres de adjunto libres del proveedor).
  - `publicUrl()` — BD guarda la URL formato-public completa
    (`.../storage/v1/object/public/purchase-dte/...`), no la ruta cruda como
    decía la regla 8 original mal recordada — corregido para cumplir la regla
    real del proyecto (URL formato-public, nunca firmada, nunca cruda).
  - PDFs sin JSON o sin match de nombre de archivo → **no se descartan**, van a
    `purchase_dte_review_queue` (`kind` orphan_pdf/invalid_json) — ver Fase 1.
  - Log en `email_sync_log` (tabla dedicada), no en el `sync_log` genérico.
  - `supplier_id` se resuelve automático (`emisor_nrc = suppliers.nrc`) al insertar.
- [x] **2.2 Secrets configurados**: `GMAIL_CLIENT_ID_1/2`, `GMAIL_CLIENT_SECRET_1/2`,
      `GMAIL_RT_1/2` (edge function secrets / `Deno.env`, no Vault pese al nombre
      de columna `vault_secret_name` — aclarado con `COMMENT ON COLUMN`).
- [x] **2.3 Deploy** con el workaround del `.env` + `--no-verify-jwt` (acepta
      doble vía de invocación: `x-cron-secret` del cron, o JWT real + permiso
      `can_edit` para el botón "Sincronizar ahora").
- [x] **2.4 Prueba manual**: `dry_run:true` → 346 candidatos detectados sobre
      507 correos. Corrida real → **339 documentos insertados** (cuenta 1),
      93 PDFs huérfanos + 4 JSON inválidos a revisión (luego 66 de esos se
      descartaron por ser ruido de Promerica, ver Fase 3.5).

**Resultado:** cumplido y superado — además de lo pedido, quedó resuelto el
caso de reintentos parciales (idempotencia end-to-end).

---

## Fase 3 — Backfill junio → hoy ⚠️ PARCIAL (cuenta 1 completa, cuenta 2 diferida)

- [x] **3.1** 0.5 confirmado por el usuario.
- [x] **3.2 (cuenta 1)** Corrida real completa vía llamadas sucesivas
      (`hasMore` → reinvocar) hasta drenar el backfill: **339 documentos**.
      **Cuenta 2 diferida por decisión del usuario** — no se corrió manualmente;
      `last_synced_date` sigue NULL, así que el cron (cuando se active) va a
      arrancarla desde `BACKFILL_FROM` sola, en lotes diarios, sin intervención.
- [x] **3.3 (cuenta 1)** Verificación indirecta pero sólida: el modal de
      detalle (Fase 5) parsea el JSON real de varios documentos al azar durante
      la verificación visual y los totales coinciden exactamente con lo
      mostrado en la lista (ej. $2.65+$3.54=$7.00). 0 duplicados por diseño
      (`ON CONFLICT codigo_generacion DO NOTHING`, verificado en la corrida:
      ningún error de constraint). No se hizo el muestreo manual de 5 correos
      contra el PDF original — pendiente si se quiere una verificación más
      exhaustiva.

**Resultado:** cumplido para cuenta 1. Cuenta 2 pendiente de decisión del
usuario (correrla ahora a mano, o dejar que el cron la complete sola).

---

## Fase 4 — Cron diario ✅ REGISTRADO, ⚠️ INACTIVO a propósito

- [x] **4.1** Migración `20260717_cron_sync_purchase_emails.sql` aplicada en
      prod (no en staging — el `net.http_post` hardcodea la URL de prod, así
      que probarlo en staging apuntaría por error a la function de prod).
      `x-cron-secret` desde Vault (mismo patrón que `dte-resync-month-*`, no
      `admin_invoke_secret`). **Registrado con `active=false`** — decisión
      explícita del usuario: no quería que corriera solo antes de terminar el
      resto del módulo. `jobid 183`.
- [ ] **4.2** Pendiente — solo se puede verificar después de reactivar el cron
      (Fase 6). Reactivar con:
      `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE
      jobname='sync-purchase-emails-daily'), active := true);`

**Resultado:** cumplido salvo la verificación de corrida real diaria, que
depende de que el usuario dé el OK para activar el cron.

---

## Fase 5 — UI del portal ✅ COMPLETA (incluye extras no listados en el plan original)

- [x] **5.1 Vista** `src/views/purchases/FacturasCompraView.jsx` — construida
      sobre `ComprasView.jsx` como referencia estructural. Diferencias reales
      contra lo planeado:
      - RPC final: `get_purchase_dte_documents(p_desde, p_hasta)` — **sin**
        `p_tipo`/`p_nit` como parámetros del RPC; el filtro por tipo/proveedor
        quedó **client-side** sobre el array ya cargado (search standard:
        filtrar en memoria, no ida y vuelta al servidor por cada cambio de
        filtro). SECURITY INVOKER, Patrón C, tal como estaba planeado.
      - **Match de proveedor cambió de LEFT JOIN puro a columna real**
        `supplier_id` (ver Fase 1) — permite el botón "Emparejar" manual desde
        la UI (`set_purchase_dte_supplier` RPC) para los casos sin match
        automático. Filtro "(sin proveedor)" agregado al selector.
      - ViewTabBar + búsqueda + filter pill + DataTable: tal cual el estándar.
      - Tab **Revisión** (no estaba en el plan original como tab separado):
        cola `purchase_dte_review_queue` con botón **"Descartar"** y botón
        **"Emparejar a documento existente"** (`MatchDocumentAction`, solo para
        `orphan_pdf` — busca entre los documentos ya sincronizados, llama a
        `resolve_purchase_dte_review('emparejado', ...)`; agregado 2026-07-18,
        cierra el último gap conocido de esta fase).
      - Botón **"Sincronizar ahora"** (gateado por `can_edit`) — no estaba en
        el 5.1 original, se agregó como decisión de diseño aparte.
      - **3 formas de descarga** (más de lo planeado en el criterio original
        "botones JSON y PDF"): individual (ya estaba), **paquete** por
        documento (ZIP JSON+PDF client-side con `jszip`), y **masiva**
        ("Descargar filtrados" → edge function `export-purchase-dte-zip`,
        tope 300 documentos, arma el ZIP server-side sin persistirlo —
        `Content-Type: application/octet-stream`, no `application/zip`, porque
        el cliente `supabase-js` solo reconoce octet-stream/pdf como blob).
      - **Modal de detalle DTE** (`FormPurchaseDteViewer.jsx`, tipo
        `viewPurchaseDte` en `UnifiedModal.jsx`) — parsea el JSON real y lo
        muestra como factura (emisor, receptor, ítems, totales), con tab "PDF"
        cuando existe. Verificado con datos reales: totales calculados
        coinciden con la lista.
      - Empty state estándar; sin border-l; contraste mínimo cumplido.
- [x] **5.2 Ruta** `/facturas-compra` en `App.jsx` (con `openModal` pasado como
      prop, mismo patrón que otras vistas con modales). **5.3 Menú** — quedó
      en el grupo **Inventario**, no "Compras" como decía el plan original
      (Compras ya es un módulo separado del ERP; Facturas de Compra es distinto
      dominio, mismo grupo de menú). **5.4 Permisos** — entrada en
      `PermissionsView.jsx` con descripción completa. **5.5 BD** ✅ (Fase 1).
- [x] **5.6** Migraciones de RPC aplicadas a prod antes de cada push del frontend
      correspondiente, en todos los commits de esta fase.
- [x] **5.7 Verificación visual** — múltiples rondas con Playwright + datos
      reales: lista con 338 documentos, badges de tipo, match de proveedor;
      cola de revisión con 31 pendientes tras descartar Promerica; modal de
      detalle con ítems/totales correctos; descarga paquete y masiva
      disparando el evento `download` sin errores; guard de permisos
      confirmado bloqueando un rol sin acceso ("Acceso denegado").

**Resultado:** cumplido y ampliado — los criterios de §2 relativos a la vista
están satisfechos con evidencia real, más funcionalidad de la originalmente
pedida (descargas paquete/masiva, modal de detalle, cola de revisión con
match/descarte).

---

## Code review post-implementación (2026-07-18)

3 agentes independientes (correctness line-scan, removed-behavior auditor,
cross-file tracer) revisaron el diff completo de las 7 fases (2207 líneas).
14 hallazgos reales, **12 corregidos en el momento** (migración
`20260718_purchase_dte_review_fix_and_tracking.sql` + redeploy de
`sync-purchase-emails` + fixes en `FacturasCompraView.jsx`/`facturasCompra.js`):

- Errores de RPC tragados en silencio (`try/finally` sin `catch`) en
  emparejar-proveedor, emparejar-documento y descartar — la UI se cerraba
  como si hubiera guardado aunque fallara.
- Botones de edición no respetaban `canEdit` — un rol solo-lectura los veía
  igual y fallaban en silencio contra el RPC.
- `resolve_purchase_dte_review`: sin validar `kind='orphan_pdf'` antes de
  pisar `pdf_path`; marcaba `'emparejado'` aunque el UPDATE no afectara
  ninguna fila (PDF quedaba huérfano). Ambos con guard + `RAISE EXCEPTION`.
- **Re-escaneo infinito de mensajes duplicados/ZIP**: `getDoneMessageIds`
  solo consideraba "hecho" un mensaje si dejaba fila en `documents` o
  `review_queue` — un DTE duplicado (`ON CONFLICT DO NOTHING`) o un correo
  solo con `.zip` no dejaban ninguna, así que se re-escaneaban desde Gmail
  en CADA corrida del cron, para siempre (confirmado activo: SERFINSA manda
  un zip diario). Fix: tabla `purchase_dte_processed_messages`, marca cada
  mensaje sin importar el resultado.
- Mensajes de error genéricos de `supabase-js` en vez del error real de la
  edge function.
- `fetchSuppliersBasic()` duplicado (padre + tab) → unificado.
- Cola de revisión: abrir archivo sin `appendAuditLog`; selector de
  "emparejar a documento" no se refrescaba al cambiar el rango de fechas.
- `downloadPurchaseDtePackage` armaba un ZIP vacío en silencio si fallaba la
  descarga de algún archivo.

**Actualizado 2026-07-18:** `fetchSuppliersBasic` ignoraba `error` — se había
dejado sin corregir por coincidir con `ComprasView.jsx`, pero el usuario pidió
corregirlo en las dos vistas a la vez (para no dejar 2 estilos distintos de
la misma llamada en el portal). **Ya corregido** (v2.20.4): ambas vistas
loguean el error a consola en vez de mostrar el selector de proveedores
vacío en silencio.

**1 hallazgo que queda sin corregir a propósito — orden de replay de
migraciones:**

`20260717_purchase_dte_email_seeds.sql` (llena datos) necesita 2 columnas que
recién se crean en `20260717_purchase_dte_email_sync_v2.sql` (crea/altera la
tabla). El problema: si alguien alguna vez reconstruye el esquema **desde
cero, aplicando TODOS los archivos de `supabase/migrations/` en orden
alfabético** (no uno por uno a mano como se hizo acá) — por ejemplo para
armar un ambiente de pruebas nuevo — se rompe, porque alfabéticamente
`..._email_seeds.sql` ordena ANTES que `..._email_sync_v2.sql`
(comparando letra por letra: "se" de "seeds" < "sy" de "sync"), aunque
lógicamente necesita correr DESPUÉS.

**Por qué no importa hoy:** en staging y prod cada migración se aplicó a
mano, en el orden lógico correcto (no alfabético) — la base de datos real
está bien. Es un defecto que existe solo en la foto de los archivos
guardados, no en el estado real de la base de datos.

**Por qué no se corrige:** la forma obvia sería renombrar el archivo
`seeds` para que ordene después de `sync_v2` (ej. agregándole la hora al
nombre). Pero la regla del proyecto (CLAUDE.md, nacida de un incidente real)
prohíbe renombrar una migración que ya se aplicó a producción — el `name`
que se le pasa a `apply_migration` debe ser exactamente el nombre del
archivo, para siempre. Como `20260717_purchase_dte_email_seeds` ya está
aplicada en prod con ese nombre exacto, renombrarla ahora violaría esa regla
para resolver algo que no está causando ningún problema real.

**Coincide con una limitación ya conocida y documentada del proyecto en
general** (no específica de este módulo) — ver memoria
[[project_migration_baseline_and_staging]]: el historial completo de
`supabase/migrations/` en este repo no siempre reconstruye fielmente el
estado real de producción, porque durante meses las migraciones no se
guardaron siempre con el mismo nombre/orden con el que se aplicaron. Este
caso puntual (seeds antes que su propia tabla) es una instancia más de esa
misma limitación estructural, no un problema nuevo. Si en algún momento se
hace la tarea más amplia de "consolidar el historial en un set de archivos
reconstruible desde cero", este caso se resuelve solo como parte de eso.

Verificado: 0 errores de seguridad (staging+prod), build limpio,
verificación visual con Playwright sin regresiones.

## Auditoría DESIGN.md (2026-07-18)

Revisión completa de `FacturasCompraView.jsx`/`FormPurchaseDteViewer.jsx`
contra `DESIGN.md` (32 secciones). Un hallazgo real y corregido:

- **§17 Filter Pills, violado**: el pill de fecha/tipo/proveedor estaba en
  `filtersContent` del header de `GlassViewLayout`. La regla es explícita:
  esa slot es SOLO para search/tabs/acciones primarias ("Nuevo X", export) —
  el pill de filtros va en el **body**, junto a la tabla (patrón
  `VentasView`/`FilterControls`, referenciado por nombre en el doc). Movido a
  `TabDocumentos`. `filtersContent` quedó solo con "Sincronizar ahora"
  (acción primaria, sí corresponde ahí), restyleado con la tipografía real de
  botón secundario (`font-black uppercase tracking-widest`, §15) en vez del
  estilo de link que tenía.
- Badges (tipo DTE, PDF-sin-JSON/JSON-inválido) alineados al patrón real de
  "Semantic status badge" (§16: borde + fondo `/10`, no bg sólido). "PDF sin
  JSON" pasó de `sky` (color no documentado en §6) a `blue`/info.

**Resto de la auditoría (§1-§32) sin hallazgos**: sin `border-l` (anti-patrón
prohibido), sin `<select>` nativo, sin `text-slate-300/400`, sin
`active:scale-90/95`, `transition-all` en el botón de descarga JSON coincide
con el ejemplo canónico del Primary CTA en §15 (no es violación pese a lo que
dice §31 — inconsistencia del propio doc, no del código).

**Nota importante**: `ComprasView.jsx` (la vista que usé como referencia
estructural para construir esta) **tiene la misma violación de §17** — su
`filtersContent` también mete el pill de filtros en el header. No se corrigió
en esta sesión (fuera de alcance, es una vista de otro módulo) pero queda
documentado por si se decide auditar `ComprasView` en el futuro.

## Ronda de fixes visuales/funcionales reportados por el usuario (2026-07-18, v2.20.6)

El usuario probó la vista después de la auditoría DESIGN.md y reportó 6
problemas concretos. Los 6 se corrigieron:

1. **Header en 2 filas apiladas**: `<ViewTabBar>` se renderizaba como hermano
   suelto ANTES de `<GlassViewLayout>` (copiado de `ComprasView.jsx`), en vez
   de ser el valor completo de `filtersContent` — el patrón real usado por
   `LaboratoriosView`/`PedidosView`/`PromocionesView`/`SchedulesView` es UNA
   sola fila: `filtersContent = <ViewTabBar .../>`. Corregido. "Sincronizar
   ahora" se movió al body (`TabDocumentos`, junto al pill de filtros) porque
   ningún patrón existente en el portal combina un botón de acción dentro de
   `filtersContent` junto a `ViewTabBar`.
2. Consecuencia directa del fix anterior — el pill de tabs quedó con el
   estilo real de `ViewTabBar` (antes se veía como una fila separada, ahora
   integrada en el mismo header glass que el ícono+título).
3. **`LiquidDatePicker`**: los 2 `<input type="date">` crudos del pill de
   filtros (fecha inicio/fin) se reemplazaron por `LiquidDatePicker` (regla
   global del proyecto, `feedback_liquid_select`-equivalente para fechas).
4. **Paginación**: `TabDocumentos` no paginaba — Patrón C (`RETURNS json`)
   carga TODO el rango filtrado de una vez, client-side. Se agregó
   `TablePagination` con slice de página sobre el array ya filtrado (mismo
   patrón que `TabSinVenta.jsx`: `page`/`pageSize` state, reset a página 1 en
   cada cambio de filtro). Verificado con 338 documentos → 14 páginas de 25.
5. **Bug real en el modal de detalle (el más importante)**: en
   `UnifiedModal.jsx`, `getModalHeightClass()` solo daba altura fija
   (`h-[85vh]`) al tipo `"viewDocument"` — `"viewPurchaseDte"` caía al
   default `max-h-[90vh] h-fit`, sin ancestro de altura definida para el
   `h-full` que usa `FormPurchaseDteViewer` internamente. Corregido para que
   `viewPurchaseDte` reciba el mismo `h-[85vh]`. Además, el embed de PDF pasó
   de `<object>` + `<iframe>` anidado (el patrón que copia `FormDocumentViewer`)
   a un `<iframe>` simple, con un link "Abrir en pestaña nueva" SIEMPRE
   visible (no solo como fallback interno del navegador) — refuerzo
   defensivo para garantizar que el usuario nunca se quede sin forma de ver
   el PDF, independiente de la causa exacta del cierre.
   **Hallazgo de investigación, no resuelto con 100% certeza**: en local
   (`vite dev` y `vite preview`, confirmado con `curl -I http://localhost:4173/`)
   el servidor envía `Cross-Origin-Embedder-Policy: require-corp`
   (`vite.config.js:server.headers`, probablemente para WASM/SharedArrayBuffer
   de `@imgly/background-removal` u ONNX Runtime — no tocado, fuera de
   alcance). Bajo ese header, la navegación del `<iframe>` hacia la signed
   URL de Supabase Storage (que no manda `Cross-Origin-Resource-Policy:
   cross-origin`) aborta (`net::ERR_ABORTED`, frame se desmonta) — el MISMO
   patrón que rompe las fotos de empleado (`<img>`) en local, confirmado en
   esta sesión como un problema PREEXISTENTE y no relacionado. `vercel.json`
   (producción real) **no tiene ese header** — la navegación del iframe no
   debería estar restringida ahí. No se pudo reproducir de forma 100%
   concluyente en Playwright headless que el modal completo se desmonta
   (se pierde `[data-surface="modal"]` del DOM) por esta causa exacta — se
   instrumentó `onClose` de `UnifiedModal` con `console.trace()` y confirmó
   que NO es React (`setModalOpen(false)`) quien lo cierra; tampoco hay
   navegación de main frame, ni error de consola, ni crash de página. Con
   los 2 fixes de arriba (altura + iframe simple + botón "abrir en pestaña
   nueva" siempre visible) el problema queda mitigado incluso si la causa
   exacta no se confirmó al 100%. **Si el usuario lo reproduce en producción
   real después de este deploy, es la señal de que el problema es más
   profundo que COEP/altura y hay que retomar la investigación** — de ser
   así, el botón "abrir en pestaña nueva" sigue siendo la vía de escape
   garantizada mientras tanto.
6. **Sin botón cancelar en "Emparejar"**: `SupplierMatchCell` (Documentos) y
   `MatchDocumentAction` (Revisión) mostraban el `LiquidSelect` de búsqueda
   sin forma de volver atrás salvo eligiendo algo. Se agregó un botón X junto
   al selector en ambos, que restaura el estado de link sin guardar nada.

Verificado con `npm run build` (sin errores) y Playwright contra
`vite preview`: header de una sola fila, date picker con valores/clear
visibles, paginación (338/14 páginas), botón cancelar de `SupplierMatchCell`
— todos confirmados con screenshot. El PDF y el 2° botón cancelar
(`MatchDocumentAction`, sin filas `orphan_pdf` pendientes al momento de
probar) no se pudieron verificar visualmente al 100% por lo explicado en el
punto 5.

### Corrección v2.20.7 (2026-07-18) — causa REAL del cierre de modal

El usuario reportó que, tras el deploy de v2.20.6, el PDF **seguía sin
verse** y el modal seguía cerrándose al tocar la pestaña "PDF", sin error
visible. La hipótesis de COEP del punto 5 era real pero **no era la causa
del cierre** — solo explicaba por qué el iframe no renderiza en local.

**Causa real**: los botones "Detalle"/"PDF"/"JSON" de
`FormPurchaseDteViewer.jsx` viven dentro de
`<form id="unified-modal-form" onSubmit={handleLocalSubmit}>`
(`UnifiedModal.jsx`) y **no tenían `type="button"`** — un `<button>` sin
`type` dentro de un `<form>` es `type="submit"` por defecto en HTML. Tocar
"PDF" disparaba un **submit real** del formulario del modal.
`handleLocalSubmit` no tiene ningún `if (type === "viewPurchaseDte")`, así
que cae al fallback genérico al final de la función:
```js
if (handleSubmit) {
    setIsSaving(true);
    try { await handleSubmit(e); ... } finally { setIsSaving(false); }
}
```
Y `handleSubmit` (`App.jsx`) hace `switch (modalType) { ... }` seguido de
`setModalOpen(false); setFormData({}); ...` **INCONDICIONALMENTE, sin
`default` ni guard** — corre siempre después del switch, exista o no un
`case` para el `type` actual. Como no hay `case "viewPurchaseDte"`, el
switch no hace nada, pero el modal se cierra igual, sin lanzar excepción ni
loggear nada — exactamente el síntoma reportado ("no da error").

**Por qué la investigación anterior no lo encontró**: se había instrumentado
`onClose` de `UnifiedModal` (el callback pasado como prop, que llama a
`setModalOpen(false)` en un solo sitio de `App.jsx`) con `console.trace()`,
pero el cierre real ocurre por una llamada **DIFERENTE** a
`setModalOpen(false)` — la de dentro de `handleSubmit` mismo — que nunca
pasa por el callback `onClose`. Lección: al buscar quién llama a un setter
de estado, hay que grepear TODAS las llamadas directas, no solo las que
pasan por el prop/callback esperado.

**Fix**: `type="button"` en los 3 botones de `FormPurchaseDteViewer.jsx`
("Detalle", "PDF", "JSON"). Confirmado con Playwright: el modal ya no se
desmonta al tocar PDF (`[data-surface="modal"]` pasaba de 2 a 0 antes del
fix; se mantiene en 2 después). `FormDocumentViewer.jsx` (visor de
documentos de empleado, mismo `<form>` contenedor) NO tiene este problema
porque no tiene botones de tab — solo un `<a download>`, sin riesgo de
submit.

**Nota para vistas nuevas dentro de `UnifiedModal`**: cualquier `<button>`
con `onClick` dentro de un componente `Form*` renderizado en
`unified-modal-form` DEBE llevar `type="button"` explícito, salvo que
realmente sea el botón de guardar (`type="submit"`). Vale la pena una
auditoría futura del resto de `src/components/forms/*.jsx` para el mismo
patrón (no hecha en esta sesión, fuera de alcance del reporte puntual).

## Fase 6 — Cierre ⚠️ ÚNICO PASO PENDIENTE

- [x] Advisor de seguridad: 0 ERRORES — verificado en CADA migración aplicada
      durante toda la ejecución (staging y prod), no solo al final.
- [x] Repasar §2 — ver checklist actualizado abajo.
- [x] Memoria `project_facturas_compra_email_module.md` actualizada con el
      estado real, gotchas, y decisiones — pero **no marcada CERRADO todavía**
      porque falta el último paso:
- [ ] **Reactivar el cron** (`cron.alter_job(..., active := true)`) — requiere
      OK explícito del usuario en el momento (es un write a prod recurrente,
      no un one-off). Es literalmente lo único que falta para poder decir que
      el módulo está 100% operativo sin intervención manual diaria.

---

## Decisión Fase 3.5 (post-backfill, 2026-07-18)

Con datos reales de la cuenta 1 (339 documentos, 97 pendientes de revisión):
66 de los 97 (68%) eran PDF-sin-JSON de un solo remitente recurrente,
`comercios@promerica.com.sv`. **Descartados** (`status='descartado'`) por
decisión del usuario — no son facturas de compra reales para el negocio (todo
indica que es tráfico de otra naturaleza, ej. estados de cuenta/comprobantes de
tarjeta). Los 31 restantes están repartidos entre ~15 remitentes distintos sin
ningún patrón dominante (Claro 8, el resto 1-3 cada uno, varios claramente no
relacionados a compras — MTPS, marketing, correos personales).

**Conclusión: NO se construye la Fase 5b (confirmación asistida por IA).** El
volumen real, descontado el ruido de un solo remitente, es bajo y fragmentado —
no justifica la inversión. La cola de revisión con "Descartar" (ya construida)
alcanza. Revisar esta decisión si en producción real (no backfill histórico)
empieza a acumularse volumen sostenido de algún remitente nuevo.

## Riesgos y casos borde conocidos

| Caso | Manejo |
|---|---|
| Mismo DTE llega a 2+ correos / reenviado | `ON CONFLICT (codigo_generacion) DO NOTHING` — la primera copia gana |
| Proveedor manda ZIP con json+pdf adentro | **v1 NO descomprime**: warning en `email_sync_log` con el remitente (verificado en datos reales: SERFINSA manda ZIP diario, correctamente descartado); si aparece seguido de otro remitente, evaluar soporte zip como mejora |
| Solo PDF sin JSON en el correo | Ya NO se ignora: va a `purchase_dte_review_queue` (`kind='orphan_pdf'`, `pendiente`) — medido en datos reales (Fase 3.5), decisión final: solo "Descartar", sin IA asistida |
| Varios DTE en un correo, PDF no matchea por nombre a ningún JSON | Ya NO se pierde: mismo `purchase_dte_review_queue`, con acción "Emparejar a documento existente" — **implementado y verificado** |
| Refresh token revocado (cambio de contraseña de la cuenta, o app dejada en modo Testing) | Corrida marca la cuenta con error en `email_sync_log` sin tumbar las demás cuentas (try/catch por cuenta); alerta al usuario. Prevención: app GCP "En producción" (0.2) |
| Gmail API rate limit en el backfill | Volumen esperado bajo (facturas de compra ≈ cientos/mes); si aparece 429, backoff y continuar en la corrida siguiente (el solape + dedupe lo absorben) |
| Correo del Outlook reenviado pierde remitente original | El `from_email` guardado será el del reenvío; el emisor REAL sale del JSON (`emisor.nombre`/`nit`) — la UI siempre muestra el emisor del JSON |
| JSON con esquema viejo/raro (versiones de DTE) | Validación mínima (codigoGeneracion + tipoDte + emisor.nit); campos opcionales faltantes → NULL, nunca descartar un DTE válido por un campo secundario |

## Fuera de alcance v1 (mejoras futuras)

- **Conciliación contra ERP**: cruzar `purchase_dte_documents` con las compras de
  `sync-erp-purchases` (NIT + fecha + monto) y marcar "llegó por correo pero no está
  en ERP" y viceversa. Es la evolución natural del módulo.
- Conexión directa del Outlook por Microsoft Graph (solo si el reenvío resulta
  insuficiente).
- Soporte de adjuntos ZIP.
- Notificación (campana) cuando llegan facturas nuevas de un proveedor marcado.
