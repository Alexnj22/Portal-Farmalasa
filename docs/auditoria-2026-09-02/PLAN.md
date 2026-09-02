# Auditoría total del portal — plan de ejecución (2026-09-02)

**Para quien lo corre (Opus):** este archivo es el tablero. Se lee entero UNA vez, se
ejecuta lote por lote, y la bitácora del §6 se actualiza al cerrar cada lote. Todo lo
que hace falta está en esta carpeta; no depende de ninguna sesión anterior.

```
docs/auditoria-2026-09-02/
├── PLAN.md              ← este archivo: qué, en qué orden, y la bitácora
├── BRIEF.md             ← reglas duras, checklist y formato del informe (leerlo ANTES de cada lote)
├── 00-LO-YA-MEDIDO.md   ← lo que los gates, tests, lint y crons ya dijeron el 2026-09-01
├── lotes/<lote>.txt     ← la lista exacta de archivos/tablas/crons de cada lote
├── lotes/edge-verify-jwt.txt ← estado VIVO de verify_jwt en producción
└── informes/<lote>.md   ← lo que produce cada lote (incremental, ver BRIEF §«Cómo se escribe»)
```

## 0. Por qué el plan está así (lo que falló dos veces)

El 2026-09-01 se lanzaron 20 agentes en paralelo, cada uno con un lote. Las dos
corridas murieron por límite de tokens y **no quedó ni una línea**, porque cada agente
escribía su informe al terminar. Tres reglas salen de eso y mandan sobre todo lo demás:

1. **Un lote a la vez** (dos como máximo si son chicos). No fan-out.
2. **El informe se escribe archivo por archivo**, no al final. Si el lote se corta,
   el siguiente lo retoma desde el último archivo anotado.
3. **Leer con `sed -n 'a,bp'` en tramos de ≤400 líneas**, no el archivo entero de un
   golpe: un archivo de 1,800 líneas pasado por `cat` cuesta lo mismo que leerlo y
   además vuelve a entrar al contexto en cada turno siguiente.

## 1. Qué se audita y con qué vara

El alcance es el que pidió el usuario: *«archivo por archivo, módulo por módulo:
problemas, fallas de lógica, huecos, código duplicado, errores, mejoras, funciones
nuevas, eficiencia, que lo visual respete lo canónico y DESIGN.md, y la base de datos»*.

La vara son tres documentos que ya existen y NO se reescriben acá:
- `CLAUDE.md` (raíz del repo) — las reglas del proyecto. Las que más se rompen:
  límite de 1000 filas, el tipo de la columna manda, un rótulo no es una clave,
  librerías pesadas por `await import()`, nunca «ERP»/«sync» en pantalla, el
  teléfono no es la pantalla chica, un día de horario se resuelve en `turnoDelDia.js`,
  y la sección «Estructura BD — reglas OBLIGATORIAS».
- `DESIGN.md` — el canon visual. §5 superficies, §14 componentes, §15 controles
  canónicos, §16 badges, §17 FilterBar, §18 StateViews, §26 voz, §29 formularios,
  §31 anti-patrones, §32 móvil, §33 cómo se llama una vista.
- `BRIEF.md` (esta carpeta) — el checklist operativo y el formato del informe.

Severidades (del brief): **G** grave = dato/dinero/seguridad/pérdida de trabajo o algo
que no funciona · **M** medio = regla del repo rota, duplicado divergido, eficiencia
que se nota · **m** menor = higiene · **X** mejora · **N** función nueva.

## 2. Lo que ya está medido (no repetirlo, sí explicarlo)

Está en `00-LO-YA-MEDIDO.md`. Resumen para no abrirlo:

- **5 tests fallan en `main`** (2,424 pasan). Cada uno apunta a un defecto o a un test
  viejo; los lotes correspondientes tienen que decir cuál de los dos:
  `registroDePermisos` (una ruta repetida en `MODULE_MAP`) → lote *plataforma-chasis*;
  `bandejaYCatalogosDeSala` (admin por `system_role`) → *solicitudes-comunicacion*;
  `bitacoraDeAcciones` ×2 (`user_id` de la sesión vs `localStorage`) → *plataforma-chasis*;
  `decisionDiferencia` (`esCargoDeSupervision`) → *pedidos* y *acceso-permisos*.
- **eslint: 222 errores en 88 archivos**. 149 son `setState` síncrono en un efecto
  (React Compiler) — deuda mecánica, va como un solo hallazgo M con la lista. Los que
  son bugs de verdad (variable usada antes de declararse, componente creado en render,
  valor inmutable modificado, reasignación tras render) están listados con
  `archivo:línea` en `00-LO-YA-MEDIDO.md` y el lote dueño del archivo los confirma.
- **`gate:bundle` en rojo**: entry 297 kB sobre 296; CortesView, ConteoDetailView y
  BolsasView sobre su techo; MisPuntosView y PromocionesView sin techo propio.
- **4 crons sin corrida registrada** aunque su hora ya pasó: `inventory-daily-particiones`,
  `refresh-product-last-sale-daily`, `inventory-daily-snapshot`, `promociones-ciclo-diario`.
  → lote *base-de-datos*.
- **Edge functions**: `puntos-motor` y `puntos-traer-saldos` están en el repo y NO en
  producción; `sync-erp-minmax` está en producción y NO en el repo. → lotes *edge-A/B*.
- Los demás gates (design, movil, ux, data, borradores, rutas, undefinidos, permisos,
  doc, version, migrations, perf, eficiencia, auditoria) están en verde. **Verde
  significa que lo mecánico está; no dice nada de la lógica.** Eso es lo que se lee.

## 3. Cómo se corre un lote (el ciclo)

```
1. Leer BRIEF.md (corto; volver a leerlo en cada lote, la memoria no persiste).
2. Leer lotes/<lote>.txt → la lista de archivos.
3. Crear informes/<lote>.md con el encabezado del formato del brief.
4. Por cada archivo de la lista, en orden:
     a. wc -l; leerlo por tramos de ≤400 líneas (sed -n).
     b. Recorrer el checklist del brief + el foco del lote (§4 de este archivo).
     c. Anotar la línea del archivo en «Archivo por archivo» y los hallazgos.
     d. Cada hallazgo: archivo:línea + cita de 2–6 líneas + por qué importa + cómo se arregla
        + «¿ya lo sabía el repo?» (grep en docs/ y CLAUDE.md antes de decir que no).
5. Al terminar la lista: leer las edge functions / tablas / docs que el foco del lote
   nombra, y anotar lo transversal (duplicados entre archivos del lote, lo que falta).
6. Escribir el «Resumen» con conteos y «Lo que está bien».
7. Actualizar la bitácora (§6): estado, conteos, los 3 más graves.
8. Recién ahí, el lote siguiente.
```

Herramientas: `codegraph_*` para «quién llama a X» y «qué rompe cambiar X»
(`codegraph_callers`, `codegraph_impact`); `grep -rn` para texto; `execute_sql` sobre
`sacecdkdmsdvgqnrsett` **sólo SELECT/EXPLAIN** y sólo en los lotes que lo dicen.
Nunca `git`. Nunca editar `src/` ni `supabase/`.

## 4. Los lotes, en orden, con su foco

El orden es por riesgo: primero donde hay dinero, seguridad y datos fiscales; después
lo que multiplica (los canónicos); al final lo transversal, que necesita los otros.
Cada lote lee su `lotes/<lote>.txt`. El foco es ADEMÁS del checklist del brief.

### L01 · base-de-datos  (sin archivos: es SQL contra producción + los advisors)
Cargar la skill `supabase:supabase-postgres-best-practices` primero. Solo SELECT.
1. **Advisors**: `get_advisors` seguridad y rendimiento (son enormes: guardarlos con
   `> informes/advisors-*.json` si la herramienta lo permite, o pedirlos y resumirlos
   con `python3 -c "import json…"` por `name`/`level`; nunca leerlos a mano). Agrupar
   ERROR/WARN/INFO y listar objetos por categoría.
2. **Esquema** (`pg_catalog`): tablas sin RLS o con RLS sin policy o con grant a `anon`;
   policies de escritura con `true` que no sean `TO service_role`; policies que llamen
   `auth_*()`/`auth.uid()` sin `(SELECT …)`; funciones DEFINER sin `SET search_path`;
   funciones ejecutables por `anon`/`PUBLIC` que no estén en `auditoria/superficie-anon.json`;
   sobrecargas duplicadas (la vieja conserva permisos); `LANGUAGE sql` con parámetros
   y `SET` que no estén en `scripts/planes-genericos.json`; vistas sin
   `security_invoker`; mat views con grant a `authenticated`/`anon`; FKs sin índice;
   índices duplicados o con `idx_scan = 0` (con tamaño); tablas sin PK o sin `created_at`;
   columnas `text` con nombre de booleano/fecha (cruzar con `scripts/db/boolean-columns.json`);
   `n_dead_tup` vs `n_live_tup` y `last_autovacuum` de las 20 más grandes; secuencias
   `int4` cerca del tope; triggers deshabilitados y triggers de auditoría INVOKER sobre
   tablas con RLS; buckets públicos (sólo `product-photos`/`photos`) o sin límites;
   extensiones en `public`.
3. **Crons**: comando de cada `cron.job` (¿secreto en el texto en vez de Vault?); por
   qué los 4 crons de §2 no tienen corrida (`cron.job_run_details` con rango amplio,
   `purge-cron-history-daily`, `sync_log`, `job_watermarks`).
4. **`pg_stat_statements`**: top 15 por `total_exec_time` y `mean_exec_time`, marcados
   «por remedir» (un promedio durante saturación dice quién esperó).
5. **Repo vs base**: lista de `.rpc('…')` y `.from('…')` de `src/` y
   `supabase/functions/` cruzada con `pg_proc`/`pg_tables`/`pg_views`: lo que el código
   nombra y no existe, y funciones de `public` que nada nombra (huérfanas).
Guardar cada SQL usado en el informe para que se pueda repetir.

### L02 · edge-A  (`lotes/edge-A.txt`, 39 funciones + `_shared/`)
Leer `_shared/` primero. Por función, una fila en una tabla: verify_jwt (de
`lotes/edge-verify-jwt.txt`) · guarda propia (¿qué secreto compara, viaja en la URL?) ·
`error` ignorado (n) · `fetch` sin timeout · upsert incondicional · deja rastro en
`sync_log`. Además: quién la llama (`SELECT jobname, command FROM cron.job` y grep
`functions.invoke('x'` en src/) y si el `verify_jwt` coincide con eso; loops de
sucursales/meses contra los 150 s; idempotencia ante un 504 del sistema de origen que
sí aplicó; helpers copiados que ya están en `_shared/`; CORS `*`; textos que salgan a
pantalla o a un aviso con «ERP»/«sync».

### L03 · edge-B  (`lotes/edge-B.txt`, 37 funciones)
Mismo formato que L02. Extra: `mis-puntos` es pública (DUI + teléfono, sin sesión):
rate limiting, enumeración de DUIs, qué devuelve. Idempotencia crítica en
`trasladar-pedido-erp`, `enviar-producto-erp`, `operar-caja`, `hacer-corte-caja`,
`regularizar-dte`, `push-cliente-erp`, `sync-puntos`. Las de puntos (`sync-puntos`,
`puntos-consulta`, `puntos-probe`, `puntos-vencer`, `mis-puntos`, más `puntos-motor` y
`puntos-traer-saldos` que están en el repo y no en prod): ¿comparten motor o lo
repiten? Las de IA (`saly-ai`, `wfm-ai-scheduler`, `leer-boleta`, `leer-dui`,
`leer-dte-json`): modelo, qué PII viaja, qué pasa si contesta basura.
`operar-caja` y `puntos-probe` tienen cambios sin commitear de otra sesión: leerlos igual
y marcarlo.

### L04 · cortes-efectivo  (`lotes/cortes-efectivo.txt`, 22 archivos, ~13,400 líneas)
Acá se mueve dinero. `type="number"` está prohibido; redondeo a centavos; `Number('')`
es 0; el esperado del corte sale del tiquete y no del formulario; `total_corte` no es
efectivo esperado. Doble firma del efectivo: la guarda va al ENTREGAR y quien autoriza
no puede ser quien pide (verificar en el código Y en `operar-caja`/`hacer-corte-caja`/
`anotar-vales-caja`). Máquina de estados de la bolsa: transiciones imposibles, contar
dos veces, depósito sin bolsa, vale sin caja abierta. Turno de apertura no fijo.
Selector de sala que se esconde con una sola opción. `diferencia_erp` (inventa
−$10,770) ¿sigue en pantalla? Impresión sólo por `imprimirDocumento`. Doble clic en
operaciones de dinero (botón sin `disabled` durante el `await`). `appendAuditLog` con la
ficha correcta (una persona tiene dos ids). Pantalla compartida que no se refresca sola.
Teléfono. Contexto: `docs/CORTES-DE-CAJA-COMO-FUNCIONA-2026-08-14.md`,
`docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md`, `docs/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md`.
`bolsas.js`, `MiCajaView.jsx`, `DialogoAbono.jsx` tienen cambios sin commitear de otra sesión.

### L05 · facturacion-fiscal  (`lotes/facturacion-dte.txt` + `lotes/fiscal.txt`, 24 archivos)
`recibido_mh` es TEXT (sello de 40 caracteres): buscar TODO uso en `src/` —
`.eq('recibido_mh', true)`, `!!recibido_mh`, `IS NULL`, `.update({recibido_mh})`.
Cliente ligado por número del sistema de origen, nunca por nombre; fusión con freno de
nombres parecidos. Anular / nota de crédito / CCF a no contribuyente: qué se escribe,
dónde, y si pide caja abierta. Libros IVA: columna por columna contra el encabezado que
exige Hacienda (Art. 86); gravadas con/sin percepción; retención Art. 162 y 156;
anexos F-07 (`docs/ANEXOS-HACIENDA-2026-08-11.md`); decir qué columna NO se puede
verificar leyendo. Cierre de período: qué congela, quién reabre, rastro. Cotizaciones:
¿se convierten, vencen? Filtros sobre `sales_invoices`: 1000 filas, `.in()` repetido,
tope antes del filtro. Fechas UTC vs SV. Contexto:
`docs/RETOMAR-FACTURACION-Y-DTE-2026-08-09.md`, `docs/LIBROS-IVA-FORMATO-Y-HALLAZGOS-2026-08-01.md`,
`docs/RETENCION-EN-LOS-LIBROS-2026-08-12.md`, `docs/resumen-dte-el-salvador.md`.

### L06 · pedidos  (`lotes/pedidos.txt`, 38 archivos, ~14,500 líneas)
Dibujar la máquina de estados del pedido Y la de cada sala destino a partir del código;
transiciones sin guarda; sitios que leen `pedido_status` cuando deben leer el de la
sala. Unidad vs paquete (factor) en cada número guardado y comparado. `pedido_items`
requiere paginación. Edge: `trasladar-pedido-erp`, `devolver-pedido-erp`,
`responder-dato-pedido`; crons `continuar-traslados-pedido`, `reintentar-ingreso-pedido`:
¿un pedido puede despacharse dos veces? `pedidoPrint.js`: pdfmake por `await import()`.
Lotes al confirmar. `tests/unit/decisionDiferencia.test.js` falla hoy: test viejo o
código roto. Recepción con el celular: `usarAccionDeFila`, `apilada`, hoja de acciones.
Contexto: `docs/RESOLUCION-DIFERENCIAS-PEDIDOS.md`, `docs/INCIDENTE-RECEPCION-2026-08-14.md`,
`docs/PLAN-SOLICITUD-A-VARIAS-SALAS-2026-08-20.md`.

### L07 · acceso-permisos  (`lotes/acceso.txt` + `lotes/permisos.txt`, 34 archivos)
Para cada acción sensible (login, contraseña, alta de dispositivo, PIN, carné de papel,
autorización de supervisor, cierre de sesión, bloqueo): ¿la guarda vive en el servidor
o sólo en el navegador? Seguir hasta la RPC/edge y leerla (grep en
`supabase/migrations/`). Kiosco entra como `anon` con token de equipo: qué alcanza.
Dos ids por persona: dónde se usa el equivocado. Rate limiting de login y PIN. La
autorización del kiosco no puede aceptar el PIN de quien marca. Permisos:
`permissionModules.js` vs `moduleMap.js` vs `role_permissions` (SELECT): módulos sin
permiso o permisos sin módulo; `can_view` sin `can_edit` con botones visibles. Candado
de mantenimiento (`module_locks`): ¿frena todas las escrituras o sólo la pantalla?
Sesiones: inactividad por cargo, `session_activity`, purga — coherentes.

### L08 · plataforma-common  (`lotes/plataforma-common.txt`, 86 archivos)
Son los canónicos: un defecto acá se multiplica. Por hallazgo, contar importadores
(`codegraph_callers`). Gemelos que divergieron (PortalInput/PortalTextarea,
Modal/ConfirmModal/AlertModal, Button/IconButton, DataTable vs tablas paralelas):
comparar prop por prop. Accesibilidad (foco, teclado, aria). Teléfono (§32): DataTable
→ Ficha, hoja de acciones, `--sa-*`, 44pt. Componentes que nadie importa; dos
implementaciones del mismo patrón. Contra DESIGN.md §14–§18: canónicos en el código
que el doc no documenta, y documentados que ya no existen o cambiaron de firma.

### L09 · plataforma-utils  (`lotes/plataforma-utils.txt`, 101 archivos)
Helpers duplicados (dos de fecha, dos de dinero, dos normalizadores). Zona horaria:
SV es UTC−6 sin verano — `new Date('YYYY-MM-DD')` retrocede un día,
`toISOString().slice(0,10)` sobre hora local, `getDay` vs `getUTCDay`. Dinero:
`toFixed` vs `Math.round(x*100)/100`. `fetchAllRows`: buscar en TODO `src/` los
`.select(`/`.rpc(` sobre products, inventory, dte_sales, product_stock_params,
sales_invoices, pedido_items, sales_invoice_items que no pasen por él ni chunkeen.
Reimplementaciones de `turnoDelDia.js`, `roles.js`, `ticketPrint.js`, `draftUtils.js`,
`storageFiles.js`, `exportCsv`/`egreso` (grep `shiftId`, `customStart`, `roles.find(`,
`localStorage.setItem`, `photo_url`, `text/csv`). Utils muertos; con y sin test.

### L10 · plataforma-chasis  (`lotes/plataforma-chasis.txt`, 53 archivos)
Enrutado: `moduleMap.js` vs `routeImporters.js` vs `App.jsx` vs el menú — encontrar la
ruta repetida que rompe `registroDePermisos.test.js` y decir qué módulo abre el otro.
Sesión y arranque: `arranqueSesion`, hidratación, cierre por inactividad,
`AvisoVersionNueva` (nada recarga salvo un botón), service worker, manifest. Hooks:
cleanup de efectos, realtime sin cerrar, `useMediaQuery` propio donde va
`useExpedienteMovil`, hooks sin uso. Store: derivados que se desincronizan, selectores
sobre claves inexistentes, qué se pierde al cerrar sesión a los 5 min.
`appendAuditLog`: los dos tests de `bitacoraDeAcciones.test.js` — ¿defecto del código o
del test, y qué firma llega hoy a `audit_logs`? `empresa.js`: nombre comercial vs legal
en el sitio correcto. `vite.config`: chunks, qué viaja en el entry. Los errores de lint de
`AuthContext.jsx` (variable antes de declararse ×2, valor inmutable) confirmarlos.

### L11 · tablero  (`lotes/tablero.txt`, 27 archivos, ~15,000 líneas)
Costo de entrar: contar cada `.from(`/`.rpc(`/`fetch` que dispara el montaje, cuáles
se repiten entre widgets, cuáles cargan sin permiso o sin estar visibles. Por widget:
carga/error/vacío; si una consulta falla ¿cae el tablero entero? Números: dos widgets
que calculan «lo mismo» distinto (contrastar con
`docs/VENTAS-DE-DONDE-SALE-CADA-NUMERO-2026-08-24.md`). Preferencias
(`user_dashboard_prefs`): se guardan, se leen antes de pintar. Pestañas en la URL.
Gráficos: import pesado estático, colores desde tokens, legibles en teléfono. Lint:
`DashboardView.jsx` modifica refs durante el render (×2) — confirmar.
Contexto: `docs/TABLERO-DONDE-QUEDA-CADA-WIDGET-2026-08-24.md`.

### L12 · personal  (`lotes/personal.txt`, 27 archivos, ~13,500 líneas)
Formularios largos con borrador; catálogos desde tabla (un `roles.find` que falla y
escribe `null` es G). Datos sensibles (salario, DUI, NIT, ISSS, AFP, cuenta, sanciones):
quién los ve — pantalla o policy (seguir hasta la policy). Expediente según Código de
Trabajo: contrato, documentos con vencimiento, sanciones (Art. 83 RIT, escalera,
reclamo Art. 77), vacaciones, incapacidades — qué falta. Fotos: `photo_url` cruda debe
pasar por `signPhotosDeep`. Relevo/baja/recontratación: `employee_events`,
`disable-employee-auth`, y el kiosco (entra como anon) cuando alguien es dado de baja.
Usuario derivado del nombre (`renombrar-usuario-empleado`). Duplicación entre
`EmployeeFormModal` y los otros formularios de persona. `directorioCsv.js` con
`exportCsv` y módulo. `UnifiedModal.jsx` (lint: `formData` modificado, componente
creado en render) — confirmar. Contexto: `docs/PERSONAL-EL-EXPEDIENTE-Y-LO-QUE-NO-SE-PUBLICA-2026-08-24.md`.

### L13 · asistencia-horarios-nomina  (`lotes/asistencia.txt` + `horarios.txt` + `nomina.txt`, 21 archivos)
Cualquier lógica de turno a mano (`shiftId`, `customStart`, `isOff`, `'LIBRE'`) fuera
de `turnoDelDia.js` es M — buscarla en estas áreas y en todo `src/`. Constantes del
reglamento (44/39/8 h, descanso, 8 h entre jornadas) escritas a mano. Horarios:
guardar una celda no toca publicación; copia del sábado; el horario no dice en qué SALA
(memoria abierta). Asistencia: cómo se cuenta, edición de marcaciones, quién editó.
Nómina: ISSS 3 % tope $1,000, AFP 7.25 %, renta por tramos, séptimo, extras 100 % y
nocturnas 25 %, vacaciones 15 días + 30 %, aguinaldo por antigüedad — ¿están, bien, en
un solo sitio? **Un faltante NUNCA se descuenta del salario**: ningún camino puede
hacerlo. Planilla del banco con `exportCsv`. Edge: `consolidate-timesheets`,
`auto-copy-weekly-roster`, `generate-vacation-plan`, `wfm-ai-scheduler`,
`apply-scheduled-employee-events`. Contexto: los tres `docs/ASISTENCIA-*`,
`docs/HORARIOS-*`, `docs/NOMINA-*` del 2026-08-24.

### L14 · solicitudes-comunicacion  (`lotes/solicitudes.txt` + `comunicacion.txt`, 21 archivos)
Enrutador de aprobadores (`data/requests.js`): CLAUDE.md dice que consulta
`employees.is_admin`, que no existe → qué camino deja una solicitud SIN aprobador hoy;
el test `bandejaYCatalogosDeSala` que falla. `approver_id` escrito al crear con el
primer destinatario. Lista de avisados ≠ permiso: bandeja con botón de decidir para
quien sólo puede ver. Por tipo de solicitud: ¿qué aplica al aprobar y cuáles no hacen
nada? Notificaciones: canales, `send-push-notification`, suscripciones, purga; avisos
que llegan a quien no corresponde. Encuestas: anonimato real (¿guarda `employee_id`?).
Banner: quién edita, XSS. `EncuestaView.jsx` (lint: variable antes de declararse).
Contexto: `docs/SOLICITUDES-QUIEN-DECIDE-Y-QUIEN-LO-VE-2026-08-24.md`,
`docs/AVISOS-Y-PUSH-CUANDO-EL-CANAL-SE-ROMPE-2026-08-24.md`.

### L15 · sucursales-ventas  (`lotes/sucursales.txt` + `ventas.txt`, 26 archivos)
Ventas consulta las tablas más grandes: por consulta, ¿pagina, chunkea o RPC JSON?
`.in()` sobre columna repetida (el filtro «Receta Médica» ya se rompió así — buscar el
mismo patrón en laboratorio, presentación, vendedor, cliente). «Hoy» y «mes» en hora
SV. Total del día calculado en dos sitios; anuladas restadas en todos; comisiones fuera
de la meta. Permiso «facturas de mi sala». CSV sin ids internos. Sucursales: expediente
de sala (licencias, permiso sanitario con vencimiento, regente), dispositivos, cajas,
ticketera; avisos de vencimiento. `VentasView.jsx` (lint: `fetchProductos` antes de
declararse). Contexto: `docs/SUCURSALES-*` y `docs/VENTAS-*` del 2026-08-24.

### L16 · productos-minmax  (`lotes/productos.txt` + `minmax.txt`, 30 archivos)
`products`, `inventory`, `product_stock_params`, `get_stock_analysis` requieren
paginación; `.limit(1000)` es G. Unidad↔paquete: ¿dos conversores? MIN·MAX no lee el
factor (abierto): qué unidad muestra. «Bajo Receta» nunca «Abx»; «vitrina/estante»
nunca «anaquel». Edición manual vs cron del 1 que reescribe todo: ¿el candado protege?
`ConfigPanel`: valores muertos (`cv_max`). Exportación con `exportCsv`. Buscador:
`BuscadorDeProducto` canónico vs propios; debounce. Edge: `sync-products`,
`auto-calculate-minmax`, `notify-new-products-daily`; `sync-erp-minmax` está en prod y
no en el repo. NO reportar la fórmula plana de ABC/XYZ: es decisión (CLAUDE.md).

### L17 · inventario-bitacoras  (`lotes/inventario.txt` + `bitacoras.txt`, 34 archivos)
`inventory`: paginación; ¿lee la mat view o la tabla? Conteo: código de 17 dígitos que
desborda `::int`; código inexistente o repetido en dos productos. Ajuste
(`aplicar-movimiento-inventario`): quién, doble firma, motivo, rastro. Ventas perdidas:
¿alimentan MIN·MAX? Bitácoras SRS son documentos REGULADOS: folio correlativo sin
huecos, firma, no editable tras firmar, rondas, aviso por vencer, impresión para
inspección — qué falta para pasar una inspección. Temperatura 2–8 °C, alarma, acción
correctiva. Dispensaciones controladas: correlativo, receta retenida, médico con JVPM
(`consultar-profesional-cssp`). Teléfono en la sala. Contexto:
`docs/AUDITORIA-BITACORAS-SRS-2026-08-25.md`, `docs/RETOMAR-AJUSTE-INVENTARIO-2026-08-06.md`.

### L18 · traslados-compras  (`lotes/traslados.txt` + `compras.txt`, 33 archivos)
Traslados: `get_traslados_por_recibir` es el modelo — buscar lecturas que bajen la
tabla y filtren en JS o `.range()` con tope. Máquina de estados con respaldo; quién
confirma, quién deshace. Edge: `aplicar-traslado-inventario`, `enviar-producto-erp`,
`barrer-traslados-recibidos`, `avisar-bultos-viejos`; idempotencia ante 504.
Compras: gravadas con la percepción adentro; cuentas por pagar (vencimientos, pagos
parciales, quién marca pagada, rastro); DTE de proveedor sin match; correo con 2 PDF;
backfill ≤10 días desde la pantalla. Textos con «ERP» (ya pasó dos veces acá).
Libro de compras en teléfono (`apilada`). Exportaciones con `registrar_egreso`.
`CrearRutaModal.jsx` (lint: `cumul` reasignado tras render).

### L19 · sistema-impresion-metas-promociones  (`lotes/sistema.txt` + `impresion.txt` + `metas.txt` + `promociones.txt`, 39 archivos)
Sistema: bitácora filtrable sin bajar la tabla; salud de syncs cuando un cron lleva
días sin correr (los 4 de §2); textos «sync»/«ERP»; huérfanos. Impresión: cola por
sala, `imprimirDocumento` único (grep `ticketPrint` en `src/` y listar quién NO lo usa),
ASCII, 54/40 columnas, purga. Metas: mes en curso, propuesta el 28, cierre, gastos, sin
comisiones; sala nueva sin histórico; `TabConfirmacion.jsx` (lint: componente creado en
render ×2). Promociones: lo más nuevo (`docs/PLAN-PROMOCIONES-2026-09-01.md`): vigencia
en hora SV, producto × sala, precio con/sin IVA, solapamiento, cron sin corrida, cómo
llega al sistema de origen; `promociones.js` y `PromocionModal.jsx` tienen cambios sin
commitear de otra sesión. `CierrePeriodoView.jsx` (lint: `entra` reasignado tras render).

### L20 · transversal  (sin lista: el repo entero; va ÚLTIMO)
1. Duplicados medidos: `npx --yes jscpd src supabase/functions --min-tokens 60
   --min-lines 8 --reporters json,console --output docs/auditoria-2026-09-02/informes/jscpd
   --ignore "**/*.test.*"`; los 25 clones más grandes clasificados (extraer a canónico /
   ya existe canónico X / aceptable con motivo); confirmar a mano los 10 mayores.
2. Muertos: exports de `utils/`, `hooks/`, `data/`, `components/common/` con 0
   importadores; vistas no enrutadas (contra `routeImporters.js`); dependencias de
   `package.json` que nadie importa. `npx --yes knip` si funciona en <5 min.
3. Canon vs código: tabla componente · documentado (§) · existe · usos · reimplementado
   a mano (archivos). Qué le falta a DESIGN.md (patrón repetido 3+ veces sin canónico)
   y qué quedó viejo.
4. Textos prohibidos en JSX/`title`/`aria-label`/`placeholder`/`toast(`: `ERP`, `Sync`,
   `sincroniz`, `anaquel`, `Abx`, `Match`, `backend`, `RPC`, `Supabase` — archivo:línea.
5. §33: ruta · título de pestaña · rótulo del menú · encabezado que no coinciden.
6. Áreas de `auditoria/areas.mjs` sin ningún test que importe sus archivos.
7. `npm audit --json` por severidad; librerías duplicadas (dos de fechas, gráficos,
   PDF, QR); ninguna de `PESADAS` (`scripts/bundle-gate.mjs`) con `import` estático.
8. Cruzar los 19 informes anteriores: hallazgos repetidos entre lotes = candidatos a
   regla nueva de CLAUDE.md o a gate nuevo.

## 5. Consolidación (después de L20)

Producir dos archivos en esta carpeta:

**`INFORME.md`** — con la estructura del informe del 2026-08-23
(`docs/AUDITORIA-PORTAL-2026-08-23.md` §1–§5): qué se midió y cómo; el resultado en una
tabla por área (G/M/m/X/N); los hallazgos graves uno por uno con evidencia; los medios
agrupados por regla rota; los menores como lista; lo que está bien; lo que el informe
NO puede afirmar (lo «por confirmar» que necesita correr algo).

**`PLAN-DE-CORRECCION.md`** — el plan para los hallazgos, en este orden y con este
formato por ítem: `[#] título · lote · archivos · qué se hace · cómo se verifica · qué
gate lo vigila después · ¿toca área congelada? · ¿necesita migración? (entonces primero
en el branch de pruebas y en ventana 06:00–11:59 UTC)`.

Orden de prioridad (no negociable):
1. **G que sale dinero o un dato fiscal mal** (cortes, facturación, libros, nómina).
2. **G de seguridad** (guarda sólo en el navegador, `anon` que alcanza de más, secreto expuesto).
3. **G de pérdida de trabajo o de función rota** (tests que fallan por código, lint que
   son bugs, formularios sin borrador, crons que no corren).
4. **M por regla de CLAUDE.md** (1000 filas, tipo de columna, `error` ignorado, `turnoDelDia`,
   textos «ERP», móvil). Estos se agrupan por regla, no por archivo, y cada grupo
   propone o confirma el gate que lo vigila.
5. **M de duplicación** → extraer canónico, un PR por canónico, con la lista de sitios.
6. **m** en tandas por área, junto con el trabajo que ya toque esa área.
7. **X y N** en una lista aparte para que el usuario decida; no se mezclan con defectos.

Cada ítem del plan lleva un tamaño (S: <1 h · M: media jornada · L: un día o más) y si
lo puede hacer Opus solo o necesita a Fable (§7).

## 6. Bitácora de avance (Opus la actualiza al cerrar cada lote)

| # | lote | estado | G | M | m | X | N | los 3 más graves (una línea cada uno) |
|---|---|---|---|---|---|---|---|---|
| L01 | base-de-datos | pendiente | | | | | | |
| L02 | edge-A | pendiente | | | | | | |
| L03 | edge-B | pendiente | | | | | | |
| L04 | cortes-efectivo | pendiente | | | | | | |
| L05 | facturacion-fiscal | pendiente | | | | | | |
| L06 | pedidos | pendiente | | | | | | |
| L07 | acceso-permisos | pendiente | | | | | | |
| L08 | plataforma-common | pendiente | | | | | | |
| L09 | plataforma-utils | pendiente | | | | | | |
| L10 | plataforma-chasis | pendiente | | | | | | |
| L11 | tablero | pendiente | | | | | | |
| L12 | personal | pendiente | | | | | | |
| L13 | asistencia-horarios-nomina | pendiente | | | | | | |
| L14 | solicitudes-comunicacion | pendiente | | | | | | |
| L15 | sucursales-ventas | pendiente | | | | | | |
| L16 | productos-minmax | pendiente | | | | | | |
| L17 | inventario-bitacoras | pendiente | | | | | | |
| L18 | traslados-compras | pendiente | | | | | | |
| L19 | sistema-impresion-metas-promociones | pendiente | | | | | | |
| L20 | transversal | pendiente | | | | | | |
| — | INFORME.md | pendiente | | | | | | |
| — | PLAN-DE-CORRECCION.md | pendiente | | | | | | |

Estados: `pendiente` · `en curso (hasta <archivo>)` · `hecho` · `parcial (motivo)`.
Un lote cortado por límite se deja `en curso (hasta X)` y el siguiente turno lo retoma
leyendo `informes/<lote>.md`.

## 7. Lo que vuelve a Fable (no lo hace Opus)

Opus lee, mide con SELECT y escribe informes. Estas cosas se separan y se le llevan a
Fable con el informe del lote ya escrito:

1. **Confirmar cada G antes de que entre al plan.** Un G falso cuesta un día de trabajo
   en la dirección equivocada. Fable abre el archivo, reproduce el razonamiento y firma
   «confirmado» o lo baja de severidad.
2. **Decisiones sobre la base**: cualquier índice, policy, función o migración que el
   plan proponga. Incluye elegir cuáles de los índices «sin uso» se borran (un índice
   sin uso en `pg_stat` puede ser el de un reporte mensual).
3. **Los 4 crons sin corrida y `sync-erp-minmax` sin fuente en el repo**: decidir si se
   recuperan, se reescriben o se apagan.
4. **Los 5 tests que fallan**: cuando el lote diga «es el test» o «es el código», Fable
   decide y arregla, porque tocar el test para que pase es exactamente lo que no se hace
   sin mirar.
5. **Áreas congeladas**: si un ítem del plan toca un área al 100 % con sello, la
   pregunta al usuario y el `auditoria:desbloquear` los hace Fable.
6. **La priorización final del PLAN-DE-CORRECCION.md** y los ítems X/N: el usuario
   elige, Fable ordena con lo que sabe de las sesiones anteriores (memoria).
7. **Cualquier medición que necesite `EXPLAIN (ANALYZE, TIMING OFF)` contra producción**
   en horario de sala: se hace con cuidado y una a la vez.

## 8. El prompt para arrancar (copiar tal cual en la sesión de Opus)

```
Vas a ejecutar la auditoría total del portal siguiendo docs/auditoria-2026-09-02/PLAN.md.
Leé PLAN.md entero una vez y BRIEF.md antes de cada lote. Reglas que mandan sobre todo:
solo lectura del repo (nunca git, nunca editar src/ ni supabase/), solo SELECT en la
base, UN lote a la vez, archivos leídos por tramos de ≤400 líneas con sed -n, y el
informe de cada lote se escribe archivo por archivo en informes/<lote>.md a medida que
avanzás — nunca al final. Al cerrar un lote actualizás la bitácora del §6 de PLAN.md
y seguís con el siguiente. Empezá por el primer lote que no esté `hecho`; si uno está
`en curso`, retomalo desde el archivo que dice. Los hallazgos marcados G y las decisiones
del §7 no las resolvés: las dejás escritas para Fable.
```
