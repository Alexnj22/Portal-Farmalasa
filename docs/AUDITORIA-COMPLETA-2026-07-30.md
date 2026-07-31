# Auditoría completa — 2026-07-30

**Documento único.** Reemplaza y absorbe a `AUDITORIA-ARRANQUE-2026-07-30.md`
(retirado en el mismo commit): aquella auditó **un camino** —el arranque a
`/overview`— con **caché caliente** y sin capítulo de seguridad ni de fallos.
Todo lo que midió y sigue vigente está acá, en el §7, con sus tres errores ya
corregidos en el texto:

- la atribución de los 706 ms de Pedidos (eran 809 kB de fuentes PDF, no el
  throttle de Suspense) → §1 y §7.3;
- la medición con caché caliente ("42 peticiones de JS · 7 kB" eran 42
  respuestas de caché) → §1;
- el orden de prioridades → §10.

**Método.** Nada acá es lectura de código a ojo: cada hallazgo sale de un
analizador que quedó versionado en `scripts/`, del build de producción, o de una
consulta contra prod. Los números son reproducibles (Anexo).

| # | Dimensión | Herramienta | Resultado |
|---|---|---|---|
| 1 | Peso por vista | `scripts/bundle-gate.mjs` (grafo de chunks) | 1 hallazgo crítico, **corregido** |
| 2 | Librerías pesadas | grafo estático vs dinámico | 2 vistas, **corregidas** |
| 3 | Capa de datos | `scripts/data-gate.mjs` | 45 hallazgos, 5 son bugs vivos |
| 4 | Tipos contra el esquema real | `scripts/db/boolean-columns.json` | **2 bugs de datos fiscales** |
| 5 | Realtime | escáner de canales | ✅ 0 fugas |
| 6 | Seguridad | advisors + `pg_policies` | 0 ERRORES, 3 huecos reales |
| 7 | Arranque y tablero | Playwright + CDP, build de prod | 4 abiertos |
| 8 | Sesión y caminos de fallo | lectura dirigida de `AuthContext` | 4 huecos |

---

## 0. Lo más importante, en una pantalla

**Corregido y en producción** (v2.283.0):

- **Pedidos bajaba 809 kB gzip de fuentes PDF al entrar.** `pedidoPrint.js`
  importaba `pdfmake` + `vfs_fonts` de forma estática. Entrar a Pedidos costaba
  **939 kB gzip** — 4× el tablero entero — aunque nadie imprimiera. Igual
  ConteoDetalle (865 kB). Ahora se cargan con `await import()` al apretar
  imprimir. **PedidosView 939 → 131 kB. ConteoDetailView 865 → ~56 kB.**

**Bugs vivos encontrados, pendientes de decisión** (§3 y §4):

1. **`employees.is_admin` no existe** — la columna fue eliminada, pero
   `src/data/requests.js` la consulta en 3 funciones. Son **la red de seguridad
   del enrutador de aprobadores**: cuando la jerarquía de roles no encuentra a
   nadie, el fallback falla siempre y la solicitud queda **sin aprobador**.
2. **`sales_invoices.recibido_mh` es TEXT, no boolean** — guarda el sello de
   recepción de Hacienda (40 caracteres). El frontend lo trata como booleano:
   la lista "confirmadas por MH" devuelve **0 filas desde siempre**, y el botón
   de confirmar **escribiría la cadena `'true'` encima de un sello fiscal**.
3. **Cualquier usuario autenticado puede insertar en `attendance` y en
   `audit_logs`** — las dos policies son `WITH CHECK (true)`. Se puede fabricar
   una marcación y falsificar la bitácora de auditoría.

**Reglas nuevas, ya en verde**: `npm run gate:data` y `npm run gate:bundle`.

---

## 1. Peso por vista — el número que faltaba

La auditoría anterior reportó "44 peticiones · 207 kB" para el tablero. Ese es
un número de **caché caliente**: "JS de la app: 42 peticiones · 7 kB" son 42
respuestas de caché, no 42 descargas.

Lo que el usuario baja de verdad, medido sobre el cierre **estático** de cada
ruta lazy (`scripts/bundle-gate.mjs`):

| | antes | después |
|---|---|---|
| PedidosView | **939 kB** | **131 kB** |
| ConteoDetailView | **865 kB** | ~56 kB |
| FacturasCompraView | 201 kB | 201 kB |
| DashboardView | 170 kB | 170 kB |
| BranchDetailView | 167 kB | 167 kB |
| Entry (frío / tras cada deploy) | 261 kB | 261 kB |
| Total del bundle | 2,416 kB gzip · 225 chunks | — |

**Esto explica un número que la auditoría anterior dejó sin explicar.** Su §3.1
dice que el prefetch bajó Pedidos de 1,947 a 1,241 ms — 706 ms, más del doble
del throttle de Suspense de 291 ms que propone como causa. Con 70 ms de
latencia, 706 ms es el tiempo de bajar ~800 kB. El prefetch no arregló Suspense:
**adelantó las fuentes**. El hallazgo estaba en sus propios datos.

**El entry son 261 kB gzip en UN solo chunk** con React, supabase, react-router
y todo el código compartido. Como el hash cambia en cada deploy, **todos los
usuarios lo rebajan después de cada deploy** — React incluido. Separar vendors
en su propio chunk lo volvería cacheable entre deploys. No aplicado: es un
cambio en `vite.config` que merece su propia medición.

---

## 2. Librerías pesadas: la regla que faltaba

El proyecto ya conocía el patrón correcto — lo usa en dos sitios:

```js
const { BrowserMultiFormatReader } = await import('@zxing/browser');   // LoginView
const { removeBackground } = await import('@imgly/background-removal'); // PhotoEditorModal
```

Pero no estaba escrito en ningún lado, así que no se aplicó al resto:

| librería | dónde | era | ahora |
|---|---|---|---|
| `pdfmake` + `vfs_fonts` | `pedidoPrint.js`, `conteoInventarioPrint.js` | estático | **dinámico** ✅ |
| `@zxing/*` | `LoginView` | dinámico ✅ | — |
| `@imgly/background-removal` | `PhotoEditorModal` | dinámico ✅ | — |
| `pdfjs-dist` | `dtePdfCodigo.js` → FacturasCompra | estático | pendiente |
| `jszip` | `data/facturasCompra.js` | estático | pendiente |
| `recharts` | `ChartContainer` (95 kB) | estático | correcto (es el gráfico) |

`pdfjs` y `jszip` son los 201 kB de FacturasCompraView. Están **por debajo del
techo de 250 kB**, así que el gate no los bloquea — quedan anotados, no urgentes.

**Detalle que hacía el costo peor**: `pedidoPrint.js` exporta además matemática
pura (`getPageGroups`, `getExactPageGroups`, `buildPedidoCodigo`, `fefoProject`).
**3 de sus 4 importadores** sólo usan eso y no imprimen nada — y pagaban las
fuentes igual.

---

## 3. Capa de datos — 328 archivos, escaneados

`scripts/data-gate.mjs`, sobre `src/` y `supabase/functions/`:

| categoría | n | gravedad |
|---|---|---|
| `tipo-booleano` | 5 | **bugs vivos** (§4) |
| `cap-1000` | 3 | latente |
| `sin-paginar` | 9 | latente, verificado contra prod |
| `error-ignorado` | 28 | riesgo de fallo mudo |

### 3.1 El cap de 1000, verificado contra los conteos reales

No alcanza con marcar el patrón: hay que saber si la tabla ya cruzó el límite.
Conteos de prod al 2026-07-30:

| query | filas hoy | veredicto |
|---|---|---|
| `pedido_items` por pedido+sucursal | **1,108** (máx) | ⚠️ **ya cruzó** — 1 grupo |
| `pedido_items` pendientes por pedido+suc | 877 (máx) | 12% de margen |
| `products` | 5,200 | `.eq('es_antibiotico')` → 79, seguro |
| `sales_invoices` | 338,013 | filtrado por fecha, seguro |
| `timesheets` últimos 30d | 158 | seguro |
| `inventory` lotes por prod+suc | 24 (máx) | seguro |
| `audit_logs` | 12,077 | — |

`fetchPedidoItemsAll` **sí** pagina (usa `fetchAllRows`) — el comentario del
código dice "Pedidos con >1000 items existen en producción" y tenía razón. Los
9 hallazgos de `sin-paginar` son todos consultas donde el filtro mantiene el
resultado bajo 1000 **hoy**; ninguno está roto ahora mismo. Por eso van a
baseline y no a corrección inmediata: lo que importa es que **no crezcan**.

`.limit(1000)` (3 sitios) es el cap exacto: el día que la tabla lo cruce trunca
en silencio, sin error. `fetchAllRows` es el helper canónico y ya lo usan 15
archivos.

### 3.2 Los 28 errores descartados

`const { data } = await supabase...` sin mirar `error`. 25 de los 28 están en
`supabase/functions/` — que es donde CLAUDE.md ya lo prohíbe explícitamente,
porque ya costó un mes de fallo mudo con `presentaciones.descripcion`.

---

## 4. Tipos contra el esquema real — los dos bugs fiscales

Esta dimensión no existía antes y es la que más devolvió. La idea: versionar un
snapshot de las columnas `boolean` de prod (`scripts/db/boolean-columns.json`) y
cruzarlo contra cada `.eq('col', true)` y cada `{col: true}` del código.

### 4.1 `employees.is_admin` — la red de aprobadores está muerta

La columna **no existe** (`information_schema` → 0 filas; CLAUDE.md ya la
menciona como resto del esquema de abril). Pero se consulta en tres funciones de
`src/data/requests.js`:

```
requests.js:50  fetchBranchAdmins()    → .eq('is_admin', true)
requests.js:55  fetchGlobalAdmins()    → .eq('is_admin', true)
requests.js:59  fetchAnyActiveAdmin()  → .eq('is_admin', true)
```

PostgREST devuelve error 42703 (`column does not exist`) en las tres. Y son
exactamente los fallbacks del enrutador de aprobadores
(`store/slices/requestsSlice.js:129, 135, 215`):

```js
// Fallback: cualquier admin activo en la sucursal
const { data: admins, error: adminsErr } = await fetchBranchAdmins(...);   // ← siempre error
if (admins?.[0]?.id) return admins[0].id;
// Último fallback: cualquier admin global
const { data: globalAdmins } = await fetchGlobalAdmins(...);               // ← siempre error
return globalAdmins?.[0]?.id || null;                                      // → null
```

**Consecuencia:** cuando el recorrido por jerarquía de roles no encuentra
aprobador, los dos fallbacks fallan y `resolveApprover` devuelve `null`. La
solicitud queda sin aprobador. El error **sí** se loguea en consola, pero es
invisible para el usuario.

**Decisión pendiente:** con qué se reemplaza. Los candidatos que existen hoy son
`employees.system_role IN ('ADMIN','SUPERADMIN')` o `roles.is_su = true`. No lo
cambié porque altera a quién le llegan las aprobaciones — es una decisión tuya.

### 4.2 `sales_invoices.recibido_mh` — un sello fiscal tratado como booleano

La columna es **`text`** y guarda el sello de recepción del Ministerio de
Hacienda. Distribución real de las 338,013 filas:

| valor | filas |
|---|---|
| sello válido (40 caracteres) | **337,815** |
| `NULL` | 174 |
| la cadena `'undefined'` | 23 |
| la cadena `'true'` | **0** |

El frontend la trata como booleana en dos sitios:

```js
// facturacion.js:48 — LECTURA
.eq('recibido_mh', true)          // compara text = 'true' → 0 filas, SIEMPRE
// facturacion.js:56 — ESCRITURA
.update({ recibido_mh: true })    // escribe la cadena 'true' SOBRE el sello
```

- **La lectura**: `fetchConfirmedMhInvoices` (usada en `FacturacionView.jsx:787`)
  devuelve vacío desde siempre. La lista de "confirmadas por Hacienda" nunca
  mostró nada.
- **La escritura**: `updateInvoiceReceivedMh` está conectada a una acción de
  usuario (`FacturacionView.jsx:841`). Escribe `'true'` encima del sello fiscal.
  Que hoy haya **0 filas con `'true'`** indica que `sync-dte-sales` lo sobrescribe
  con el sello real del ERP en el siguiente ciclo (corre cada minuto) — o sea que
  el daño se cura solo, pero es real mientras dura, y en el medio el changelog
  de `sales_invoice_changelog` registra un cambio falso.

Las 23 filas con la cadena `'undefined'` son el mismo tipo de confusión, desde
otro camino.

Hay una pista de que alguien ya lo intuía, en `VentasView.jsx:54`:

```js
if (campo === 'recibido_mh') return val === true || val === 'true' ? 'Recibido' : `Recibido (${val})`;
```

trata el sello como booleano y, si no lo es, lo imprime entre paréntesis. Es el
síntoma, no la causa.

**Decisión pendiente:** casi seguro `recibido_mh IS NOT NULL` para leer, y para
escribir, o guardar el sello real o usar otra columna. Requiere confirmar la
semántica fiscal — por eso no lo cambié.

---

## 5. Realtime — limpio

Escaneados los 328 archivos por `supabase.channel(` vs `removeChannel(`:
**0 fugas**. Los 6 canales permanentes de una sesión normal
(`module_locks_global`, `role_perms_*`, `announcements-live`,
`notifications-live`, `vp-badge`, `sidebar-sync-status`) tienen todos su
`removeChannel` en el cleanup del efecto.

Vale la nota de la auditoría anterior: cada tabla suscrita es WAL que Realtime
decodifica. Ninguna de las 6 es caliente hoy. Mirar antes de suscribir la séptima.

---

## 6. Seguridad

### 6.1 Lo que está bien, y conviene decirlo

- **Advisor de Supabase: 0 ERRORES** (81 avisos, todos WARN/INFO). Lo que dice
  CLAUDE.md se sostiene.
- Las 5 funciones ejecutables por `anon` son exactamente las 5 del pre-login del
  kiosco documentadas. Ninguna otra.
- Cabeceras en `vercel.json`: HSTS con preload, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`.
- El service worker **no cachea el bundle** a propósito, para no servir código
  viejo tras un deploy. Es la decisión correcta y está comentada.

### 6.2 Los tres huecos reales

**a) `attendance` y `audit_logs` aceptan cualquier INSERT de cualquier usuario.**

```
attendance.attendance_insert  INSERT  {authenticated}  WITH CHECK: true
audit_logs.admin_insert       INSERT  {authenticated}  WITH CHECK: true
```

Un usuario autenticado puede insertar una marcación de asistencia para
**cualquier empleado, a cualquier hora**, y puede insertar entradas arbitrarias
en la bitácora de auditoría. Dado que el proyecto apoya el anti-fraude en la
marcación física y la regla "toda acción → `appendAuditLog`", una bitácora que
cualquiera puede escribir vale menos de lo que parece.

La regla 3 de CLAUDE.md dice "NUNCA `USING (true)` para UPDATE/DELETE en tablas
sensibles" — **no menciona INSERT**, y ese es justo el hueco. Corregido en el
texto de la regla (§8).

**b) No hay `Content-Security-Policy`.** `X-XSS-Protection` está presente pero es
un no-op en navegadores modernos (Chrome lo removió). Con CSP ausente, cualquier
XSS tiene ejecución libre. Es la cabecera que más devuelve de las que faltan.

**c) El gate de permisos del cliente es decorativo, por diseño — pero conviene
saberlo.** `AuthContext` levanta `user` desde `localStorage` en el arranque
(`:352-376`) y `hasPermission` devuelve `true` para todo si `isSU` (`:722-730`).
Editar `sb_user` en localStorage abre la UI entera. Esto es **aceptable** porque
el RLS del servidor es real (`auth_can_edit_any`, políticas por módulo), y esa es
la defensa que cuenta. Pero:
- `getIdleLimitMs` (`:260-272`) lee `sb_role_perms` de localStorage para elegir
  entre 5 minutos y 12 horas de sesión. Un usuario puede darse la sesión larga.
- La conclusión operativa es que **toda escritura nueva necesita su policy**, sin
  excepción: es el único gate que existe.

**d) Menores**: `photos` y `product-photos` son públicos y permiten *listar* todo
el bucket; la protección de contraseñas filtradas (HaveIBeenPwned) está
desactivada en Supabase Auth — un toggle.

---

## 7. Arranque: login, sesión y tablero

Absorbido de la auditoría de arranque (documento retirado). Medido sobre el
**build de producción** (`vite build` + `vite preview`), nunca en dev — en dev
StrictMode duplica efectos y los módulos no están empaquetados, así que miente
en las dos direcciones. Playwright + CDP, con throttling de CPU ×4 para móvil.

Las tres correcciones que esta auditoría le hizo a ese documento ya están
aplicadas abajo: la atribución de los 706 ms de Pedidos (era §1 de acá, no
Suspense), la medición con caché caliente (§1) y el orden de prioridades (§10).

### 7.1 Lo que está sano, y acota dónde buscar

| | escritorio | móvil (CPU ×4) |
|---|---|---|
| Login: submit → aterrizaje | 1,489 ms | — |
| Recarga: primer contenido | 107 ms | 249 ms |
| Entrada a un módulo (spinner) | 291 ms | 291 ms + render |
| 30 s en reposo | 0 peticiones | 0 peticiones |
| Volver a la pestaña | 2 peticiones | 2 peticiones |

**No hay polling** (30 s en reposo = 0 peticiones), **no hay bucle de
`requestAnimationFrame`**, el hilo principal **nunca se bloquea** (cero long
tasks), y las versiones están al día (React 19.2, supabase-js 2.97, React
Router 7.13, Vite 7.3).

Ojo con el alcance de ese "0 peticiones en reposo": la prueba duró 30 segundos y
el ciclo de refresco del token dura ~50 minutos (§8a).

### 7.2 El login son dos viajes en serie (~1.1 s)

```
    0 ms  click en "Entrar"
   38 ms  POST /auth/v1/token              ─┐ dos viajes SERIE
  624 ms  GET employees_safe ?username=eq.… ─┘ ~1.1 s sin poder hacer nada
 1106 ms  arranca fetchBoot (10 consultas en paralelo)
 1489 ms  aterrizaje en /overview
 ~2.5 s   tablero completo
```

`loginWithUsername` hace `signInWithPassword` y **después** consulta
`employees_safe` para el perfil. El segundo no puede salir antes: necesita la
sesión para pasar RLS. Es correcto, pero es el tramo más lento del camino.

**Observación:** ese perfil es el mismo que la edge function
`ensure_user_by_code` devuelve en la recarga. Hay **dos caminos distintos para
obtener lo mismo** — uno por tabla en el login, otro por edge function en la
restauración. Un campo agregado a uno no llega al otro.

### 7.3 Los 291 ms de spinner por módulo (throttle de Suspense)

Con el chunk ya precargado, un clic en un módulo tarda 291 ms en los que **no
pasa nada**: no es descarga (el clic pide 0 chunks), no es CPU (93 ms de JS en
3 s, cero long tasks), no es evaluar el módulo (la segunda entrada tarda igual).

Es un **plazo fijo**: el scheduler de React re-arma un `setTimeout` una vez por
frame con retardo decreciente —292, 278, 261, 244… 61— todos apuntando al mismo
instante absoluto. Es el throttle de Suspense: mostrado el fallback, React lo
sostiene ~300 ms para que no parpadee. Verificado midiendo el spinner en el DOM.

**Dirección de arreglo (no aplicada):** que la ruta no suspenda — guardar el
módulo ya resuelto por el prefetch y renderizarlo directo en vez de pasar por
`React.lazy`. **Baja prioridad:** toca 44 rutas y cambia el comportamiento ante
deploys, porque hoy `vite:preloadError` (`main.jsx`) depende de que `React.lazy`
tire cuando el chunk viejo ya no existe.

### 7.4 El tablero baja el catálogo completo de productos (104 kB)

`WidgetMinMaxRequest` baja **todos los productos activos** en su `useEffect` de
montaje, paginado en 5 chunks, para alimentar un `smartFilter` en memoria. El
buscador no hace nada hasta que alguien escribe 2 caracteres — pero el catálogo
baja **siempre**, aunque nadie toque el widget, **y en el teléfono también**.

Es la mitad del peso de datos del tablero, y contradice el estándar de búsqueda
del propio proyecto, que ya resuelve esto server-side con `norm_search` /
columnas `*_norm`.

### 7.5 Dos escrituras por carga del tablero que no guardan nada

- `useThemeSync` lee el tema, lo aplica con `setTheme(...)`, eso cambia la
  dependencia `theme` del efecto de guardado, y **a los 800 ms lo reescribe**.
- `DashboardView` hace lo mismo con el layout: `setPrefsReady(true)` está
  comentado como *"flip → triggers save effect below"*, y el efecto dispara a
  los 1.5 s del montaje. El payload incluye `updated_at: new Date()`.

Es el mismo antipatrón que el proyecto ya prohíbe para los syncs: un upsert
incondicional que reescribe una fila idéntica, más un `updated_at` puesto por el
cliente que hace que la fila "cambie" siempre. Cada carga del tablero de cada
usuario = 2 escrituras y su WAL, a cambio de cero información.

### 7.6 Una consulta de permisos que ya está en `localStorage`

`fetchBoot` arranca el grupo de empleados consultando `role_permissions` por
`can_view` de `staff_list`, y **espera esa respuesta** antes de lanzar las 5
consultas de empleados. Pero `AuthContext` ya tiene el mapa completo en memoria y
en `localStorage` (`sb_role_perms`, 95 módulos). Es un viaje de red extra que
además **serializa** el tramo más pesado del arranque detrás suyo.

### 7.7 Móvil: misma carga de datos que escritorio

Viewport 390×844, touch, CPU ×4. Primer contenido 249 ms contra 107 ms —
proporción sana, el arranque no es CPU-bound. Pero **45 peticiones, las mismas
que escritorio**: el teléfono baja el mismo catálogo, las mismas fotos y los
mismos widgets. `DashboardView` distingue `mobile_layout` / `mobile_sizes` para
*dibujar*, pero los widgets montados traen su propio dato igual.

*Nota de método:* esto es Chromium con throttling, correcto para rendimiento.
Para bugs de **layout** móvil sigue haciendo falta WebKit — no son la misma prueba.

### 7.8 Cerrado durante aquella auditoría

- **v2.272.0** — cada recarga procesaba la sesión **dos veces**:
  `onAuthStateChange` entrega `SIGNED_IN` y, ~130 ms después, `INITIAL_SESSION`
  con idéntico `access_token`. Filtrado por token (`TOKEN_REFRESHED` trae uno
  nuevo y sí se reprocesa). Peticiones por recarga: 83 → 76.
- **v2.274.0** — las fotos se bajaban dos veces: una firma de storage vale 12 h
  pero se regeneraba en cada arranque, y como el token va en la query string,
  **una firma nueva es una URL nueva**. 53 fotos / 588 kB → 28 / 60 kB.

### 7.9 Patrones viejos anotados entonces, revisados ahora

| qué | dónde | estado hoy |
|---|---|---|
| `.limit(1000)` a mano | 3 sitios | vigilado por `gate:data` (§3) |
| Dos caminos para el mismo perfil | login vs recarga | abierto (§7.2) |
| `updated_at` del cliente | `DashboardView.jsx:647` | abierto (§7.5) |
| Catálogo completo en memoria | `WidgetMinMaxRequest.jsx` | abierto (§7.4) |

---

## 8. Sesión y caminos de fallo

Lo que la auditoría anterior no cubrió, y es la mitad de "estable".

**a) La prueba de reposo duró 30 s; el ciclo del token dura ~50 min.**
`autoRefreshToken: true`. El filtro de deduplicación deja pasar `TOKEN_REFRESHED`
a propósito (`AuthContext.jsx:499-502`), así que cada refresco dispara
`procesarSesion` → edge function `ensure_user_by_code` + refirmado de foto +
`setUser(objeto nuevo)` → cambia el valor del contexto → **re-render de toda la
app**. "0 peticiones en reposo" es cierto a 30 segundos y falso en una jornada.

**b) Si el bundle de entrada da 404, el preloader gira para siempre.** El manejo
de `vite:preloadError` en `main.jsx` cubre los chunks lazy (`React.lazy`), no el
script de entrada. Tras un deploy, una pestaña que recarga en el momento justo
puede quedarse en la animación sin ningún mensaje.

**c) `ensure_user_by_code` corta a los 5 s con `catch {}` silencioso**
(`AuthContext.jsx:444-467`). El usuario se queda con el perfil cacheado y ningún
indicio de que el refresco falló.

**d) El preloader es invisible para los instrumentos que se usaron.** `index.html`
anima 5 orbes de 85-90vw con `filter: blur(65-75px)`, 13 elementos con
`backdrop-filter`, 4 anillos SVG y 3 ripples durante todo el arranque. Las
animaciones CSS corren en el compositor: **no producen callbacks de rAF ni long
tasks**, que es exactamente lo que se midió para declarar el arranque limpio. En
un teléfono de gama media eso es presión de GPU compitiendo con el montaje de
React. Requiere perfil de *paint*, no de JS.

---

## 9. Las reglas nuevas

Tres gates versionados, en la misma filosofía que `gate:design`: **ratchet, no
cero absoluto** — un gate permanentemente rojo no lo mira nadie.

### `npm run gate:data` — local, sin red, ~1 s

Corre solo en el pre-commit cuando el commit toca `src/` o
`supabase/functions/`. Baseline: `scripts/data-gate-baseline.json`.

| categoría | tope hoy | qué detecta |
|---|---|---|
| `tipo-booleano` | 5 | `.eq('col', true)` sobre columna que no es boolean |
| `cap-1000` | 3 | `.limit(1000)`, el cap exacto de PostgREST |
| `sin-paginar` | 9 | select sobre tabla grande sin `fetchAllRows` |
| `error-ignorado` | 28 | `const { data } = await supabase` sin mirar `error` |

`tipo-booleano` se apoya en `scripts/db/boolean-columns.json`, un snapshot del
catálogo de prod. **Hay que regenerarlo cuando se agrega o cambia una columna
booleana** — el SQL está en el encabezado del JSON.

Dos decisiones de implementación que valen la pena:
- **Ignora comentarios y cadenas.** La primera corrida dio 2 falsos positivos
  por matchear queries citadas dentro de comentarios explicativos. Un gate que
  se delata a sí mismo deja de mirarse.
- **`EXCEPTIONS` con motivo escrito**, una entrada por archivo, y
  `assertSinClavesDuplicadas` al arrancar — misma trampa que ya mordió en
  `design-gate` (una clave repetida pisa a la anterior en silencio).

### `npm run gate:bundle` — necesita `npm run build`

No va en el pre-commit a propósito: un hook que obliga a buildear en cada commit
se termina salteando con `--no-verify`. Va antes de cerrar un trabajo, junto a
`gate:design`.

1. **Librerías pesadas sólo por `await import()`** — lista con motivo escrito en
   `PESADAS`. Sin baseline: es una regla absoluta.
2. **Presupuesto por vista** (cierre estático, gzip), con 15% de holgura para no
   fallar por ruido.
3. **Presupuesto del entry** — lo que se baja en frío y tras cada deploy.

### Regla corregida en CLAUDE.md

La regla 3 de "Estructura BD" decía `USING (true)` sólo para UPDATE/DELETE. Se
extiende a **INSERT con `WITH CHECK (true)`**, que es por donde se colaron
`attendance` y `audit_logs`.

---

## 10. Qué haría, en orden

### Fase A — bugs vivos (§4, §6.2a)

Los tres corrompen o pierden datos hoy. Los dos primeros **necesitan una
decisión de negocio**, no sólo código.

| # | qué | dónde | decisión que falta |
|---|---|---|---|
| A1 | `employees.is_admin` no existe → solicitudes sin aprobador | `data/requests.js:50,55,59` | quién es "admin" ahora: `system_role IN ('ADMIN','SUPERADMIN')` o `roles.is_su` |
| A2 | `recibido_mh` leído/escrito como booleano | `data/facturacion.js:48,56` | leer con `IS NOT NULL`; qué debe hacer el botón "confirmar" |
| A3 | `attendance` y `audit_logs` con `WITH CHECK (true)` | policies | ninguna — es migración directa |

A3 no necesita decisión, pero **sí** el cuidado de CLAUDE.md: `attendance` no es
tabla caliente, pero la migración lleva `SET lock_timeout = '5s'` igual, y
conviene probarla en el branch de staging (`ewcmerxqjvludtgskuin`) antes de prod.

### Fase B — rendimiento (§1, §7)

| # | qué | ganancia | riesgo |
|---|---|---|---|
| B1 | CSP en `vercel.json` | cierra el único hueco de cabeceras | medio: una CSP mal armada rompe la app; arrancar en `Report-Only` |
| B2 | Separar vendors del entry (`vite.config`) | 261 kB dejan de rebajarse en **cada** deploy | bajo, pero **medir**: partir mal empeora el arranque en frío |
| B3 | Catálogo de productos del widget → server-side (§7.4) | ~104 kB por carga del tablero, también en móvil | bajo: el proyecto ya tiene `norm_search` |
| B4 | No reescribir prefs que nadie cambió (§7.5) | 2 escrituras por carga de cada usuario | bajo |
| B5 | `staff_list` desde `localStorage` en `fetchBoot` (§7.6) | un viaje menos y **destraba** el tramo más pesado | bajo |
| B6 | Que la ruta no suspenda (§7.3) | 291 ms por entrada a módulo | **alto**: 44 rutas y cambia el manejo de chunks viejos tras deploy |

Orden sugerido dentro de B: **B4 y B5 primero** (baratos, sin decisión), después
B3, después B1 en `Report-Only`, y B2/B6 sólo con medición antes y después.

### Fase C — higiene (§3.2, §8)

| # | qué |
|---|---|
| C1 | Bajar `error-ignorado` de 28, empezando por `supabase/functions/` (25 de los 28) |
| C2 | Un camino único para el perfil (§7.2): hoy login y recarga usan fuentes distintas |
| C3 | Medir el preloader con perfil de **paint** en un teléfono real (§8d) |
| C4 | Ventana mínima en el refresco por `visibilitychange` (§7.1) |

Cada fase cierra con `npm run gate:data`, `gate:bundle` y `gate:design` en verde,
y baja el baseline correspondiente si tocó deuda contada.

---

## Anexo — reproducir

```bash
npm run build
npm run gate:bundle          # peso por vista, librerías pesadas
npm run gate:data            # capa de datos, tipos, errores
npm run gate:design          # el que ya existía
```

Al bajar deuda: `-- --update-baseline` y commitear el JSON. **Nunca regenerar
para tapar un hallazgo nuevo**: si una categoría subió, es código nuevo que hay
que arreglar.
