# Auditoría de arranque: login, sesión y carga de vista — 2026-07-30

> ⚠️ **SUPERADA por `AUDITORIA-COMPLETA-2026-07-30.md`.** Este documento sigue
> siendo válido en lo que midió, pero midió **un camino** (el arranque a
> `/overview`), **con caché caliente**, y **sin capítulo de seguridad ni de
> caminos de fallo**. Tres correcciones concretas, marcadas abajo en el cuerpo:
>
> 1. **§3.1 atribuye mal los 706 ms de Pedidos.** No eran Suspense: eran 809 kB
>    gzip de fuentes PDF que `pedidoPrint.js` importaba de forma estática.
>    Corregido en v2.283.0 — PedidosView 939 → 131 kB.
> 2. **§3.2 y §0 miden con caché caliente.** "JS de la app: 42 peticiones · 7 kB"
>    son 42 respuestas de caché, no 42 descargas. El costo en frío nunca se midió.
> 3. **El orden del §6 ya no es el correcto.** Su punto 1 (Suspense) no era el
>    número más grande del informe.
>
> Lo que este documento NO cubrió y sí está en el completo: peso real por vista,
> capa de datos (2 bugs vivos: `is_admin`, `recibido_mh`), seguridad (2 policies
> con `WITH CHECK (true)`, sin CSP), y caminos de fallo de la sesión.

Alcance: todo el camino desde que alguien escribe su usuario hasta que un módulo
está en pantalla y operable. Escritorio y móvil. Todo lo que sigue está **medido
sobre el build de producción** (`vite build` + `vite preview`), nunca en dev —
en dev StrictMode duplica efectos y los módulos no están empaquetados, así que
miente en las dos direcciones.

Herramientas: Playwright + CDP (`Network`, `Profiler`, `Emulation`), con
throttling de CPU ×4 para el escenario móvil. Dos hallazgos se arreglaron
durante la propia auditoría (v2.272.0 y v2.274.0) y quedan documentados acá
como cerrados, porque explican de dónde salen los números "después".

---

## 0. Resumen

| | escritorio | móvil (CPU ×4) |
|---|---|---|
| Login: submit → aterrizaje | 1,489 ms | — |
| Recarga: primer contenido | 107 ms | 249 ms |
| Recarga de /overview | 44 peticiones · 207 kB | 45 peticiones |
| Entrada a un módulo (spinner en pantalla) | **291 ms** | ~291 ms + render |
| 30 s en reposo | 0 peticiones | 0 peticiones |
| Volver a la pestaña | 2 peticiones | 2 peticiones |

Lo bueno, y conviene decirlo porque acota dónde buscar: **no hay polling**
(30 s en reposo = cero peticiones), **no hay bucle de `requestAnimationFrame`**
(0 en 4 s de reposo), el hilo principal **nunca se bloquea** (cero long tasks
en toda la navegación), y las versiones están al día (React 19.2, supabase-js
2.97, React Router 7.13, Vite 7.3). No hay `.range(0, 9999)` ni ningún otro
resto del cap silencioso de PostgREST en el camino de arranque.

Lo caro está en tres sitios, y ninguno es el que uno esperaría:

1. **291 ms de spinner en CADA entrada a un módulo**, con el código ya
   descargado y evaluado, y sin que la consulta de la vista haya salido.
2. **El 50% del peso del tablero es un catálogo de productos** que baja un
   widget para un buscador que nadie pidió todavía.
3. **Dos escrituras a la base de datos en cada carga del tablero** que no
   guardan ningún cambio: reescriben lo que se acaba de leer.

---

## 1. Login

### 1.1 La secuencia, medida

```
    0 ms   click en "Entrar"
   38 ms   POST /auth/v1/token                    ─┐ dos viajes SERIE
  624 ms   GET employees_safe ?username=eq.…      ─┘ ~1.1 s antes de empezar
 1106 ms   arranca fetchBoot (10 consultas en paralelo)
 1460 ms   grupo de empleados (5 consultas paginadas)
 1489 ms   aterrizaje en /overview
 ~2.5 s    tablero completo
```

`loginWithUsername` hace `signInWithPassword` y **después** un
`employees_safe ?username=eq.X` para traer el perfil. Son dos viajes
encadenados: el segundo no puede salir antes porque necesita la sesión para
pasar RLS. Es correcto, pero es **~1.1 s de reloj en el que la app no puede
hacer nada más**, y es el tramo más lento de todo el camino.

**Observación, no defecto:** el perfil que devuelve ese segundo viaje es el
mismo que la edge function `ensure_user_by_code` devuelve en la recarga. Hoy
hay dos caminos distintos para obtener lo mismo — uno por tabla en el login,
otro por edge function en la restauración de sesión.

### 1.2 Lo que ya no está

Antes de esta auditoría el login y **cada recarga** procesaban la sesión dos
veces. `onAuthStateChange` entrega **dos eventos por recarga** —`SIGNED_IN` y,
~130 ms después, `INITIAL_SESSION`— con idéntico `access_token`, `expires_at`
y `user.id`: la misma sesión anunciada dos veces. El listener las trataba como
dos, así que corría el arranque completo por duplicado.

Cerrado en **v2.272.0** (filtro por token; `TOKEN_REFRESHED` trae uno nuevo y
sí se reprocesa):

| recarga de /dashboard | antes | después |
|---|---|---|
| peticiones a Supabase | 83 | 76 |
| `ensure_user_by_code` (edge function) | 2 | 1 |
| `role_permissions` | 3 | 1 |
| `roles` | 3 | 1 |

---

## 2. Sesión

### 2.1 En reposo: limpio

30 s con la pestaña abierta y sin tocar nada → **0 peticiones**. No hay
polling, no hay heartbeat, no hay refresco periódico. El vigilante de
inactividad trabaja contra `localStorage`, no contra la red.

### 2.2 Al volver a la pestaña: 2 peticiones

`visibilitychange → visible` dispara `refreshPermissions`, que son dos
consultas (`role_permissions` + `roles`). Es barato y tiene sentido — un
permiso revocado tiene que llegar. Vale la pena tener presente que ocurre en
**cada** vuelta a la pestaña, sin ventana mínima: alt-tab diez veces son veinte
consultas.

### 2.3 Canales de realtime abiertos en una sesión normal

| canal | tabla | dónde |
|---|---|---|
| `module_locks_global` | `module_locks` | AuthContext |
| `role_perms_<rol>_<sec>_<uid>` | `role_permissions` | AuthContext |
| `announcements-live` | `announcements` | systemSlice |
| `notifications-live` | `notifications` | useNotificationsChannel |
| `vp-badge` | `ventas_perdidas` | AppLayout |
| `sidebar-sync-status` | `sync_log` | SidebarSyncStatus |

Seis suscripciones permanentes sobre un único WebSocket. No es un problema de
conexiones, pero **cada tabla suscrita es WAL que Realtime tiene que
decodificar** — que es exactamente el costo que obligó a sacar
`product_stock_params` de la publicación. Ninguna de las seis es una tabla
caliente hoy, así que está bien; queda anotado como algo a mirar antes de
suscribir la séptima.

---

## 3. Carga de la vista

### 3.1 El hallazgo principal: 291 ms de spinner por módulo

Este era el "piso de ~350 ms" que quedaba pendiente. **No es React montando la
vista, y no es la consulta de la vista.**

Línea de tiempo de un clic en "Nómina", con el chunk ya precargado por el
prefetch del menú:

```
    3 ms   history.pushState → /payroll
   40 ms   aparece el spinner del Suspense
           ── 291 ms en los que no pasa NADA ──
  331 ms   desaparece el spinner
  347 ms   React monta la vista
  351 ms   sale la primera consulta (payroll_periods)
```

Lo que dicen las mediciones sobre ese hueco:

- **No es descarga.** El prefetch al pasar el mouse bajó 12 chunks; el clic
  pide **0**.
- **No es CPU.** Perfil de CPU de la ventana: **93 ms de JS en 3 segundos**.
  El resto es hilo ocioso. Cero long tasks.
- **No es evaluar el módulo.** La *segunda* entrada al mismo módulo tarda
  exactamente lo mismo (344 ms), con todo ya evaluado.
- **Es un plazo fijo.** El scheduler de React re-arma un `setTimeout` una vez
  por frame con retardo decreciente —292, 278, 261, 244… 61— todos apuntando
  al **mismo instante absoluto**, ~343 ms. El contenido entra justo ahí.

Esa firma —un plazo absoluto re-armado cada frame, mientras se muestra un
fallback— es el *throttle* de Suspense de React: una vez que mostró el
spinner, React lo sostiene ~300 ms antes de cambiarlo por el contenido, para
que no haya un parpadeo. Verificado midiendo el spinner en el DOM: **está en
pantalla de los 40 a los 331 ms, 291 ms, en toda entrada a un módulo**.

O sea: el prefetch que se agregó en v2.236.0 sirve —elimina la descarga, y con
70 ms de latencia real bajó Pedidos de 1,947 a 1,241 ms— pero **no puede tocar
este piso**, porque el piso no es red. Mientras la ruta suspenda, React va a
cobrar sus ~300 ms.

> ⚠️ **CORRECCIÓN (auditoría completa, v2.283.0).** El piso de 291 ms es real y
> está bien medido. Lo que está mal es la lectura del caso de Pedidos: esos
> 706 ms que el prefetch se ahorró **no** son este throttle — son más del doble.
> Con 70 ms de latencia, 706 ms es el tiempo de bajar **809 kB gzip de fuentes
> PDF** que `pedidoPrint.js` importaba de forma estática. El prefetch no
> adelantaba "el módulo": adelantaba las fuentes. Corregido pasándolas a
> `await import()` — PedidosView 939 → 131 kB, ConteoDetailView 865 → 56 kB.
>
> La lección de método: medir **tiempo con caché caliente** no puede distinguir
> "React esperando" de "el navegador bajando 800 kB". Hay que medir el **cierre
> estático** de cada ruta — `npm run gate:bundle`.

**Dirección de arreglo (no aplicada):** que la navegación no suspenda. El
prefetch ya resolvió el módulo; si se guarda el módulo resuelto en un registro
y la ruta lo renderiza directo en vez de pasar por `React.lazy`, no hay
fallback y no hay throttle. Es el único cambio que ataca los 291 ms.

### 3.2 El tablero pesa 207 kB, y 104 kB son un catálogo

Peso de una recarga de `/overview`, medido por CDP (bytes reales de red):

| endpoint | peticiones | kB |
|---|---|---|
| **`products`** | **5** | **104** |
| `storage render/image` (fotos) | 2 | 40 |
| `branch_hourly_sales` | 4 | 9 |
| `employees_safe` | 1 | 9 |
| JS de la app | 42 | 7 |
| `sales_invoices` | 2 | 5 |
| `user_dashboard_prefs` | 4 | 4 |
| resto (13 endpoints) | — | ~29 |
| **total** | **92** | **207** |

> ⚠️ **CORRECCIÓN: esta tabla es de CACHÉ CALIENTE.** La fila "JS de la app: 42
> peticiones · 7 kB" son 42 respuestas de caché, no 42 descargas — por eso el JS
> parece pesar menos que un par de fotos. El costo real en frío es **261 kB gzip
> sólo el entry**, y como Vercel cambia los hashes en cada deploy, **todos los
> usuarios pagan el camino frío después de cada deploy** (React incluido, porque
> viaja en el mismo chunk que el código de la app). El bundle completo son
> 2,416 kB gzip en 225 chunks. Nada de eso es visible con este método.

`WidgetMinMaxRequest` baja **el catálogo completo de productos activos** en su
`useEffect` de montaje, paginado en 5 chunks, para alimentar un `smartFilter`
en memoria. El buscador no hace nada hasta que alguien escribe 2 caracteres —
pero el catálogo baja **siempre**, aunque nadie toque el widget, y en el
teléfono también.

Además contradice el estándar de búsqueda del propio proyecto, que ya resuelve
esto server-side con `norm_search` / columnas `*_norm`.

### 3.3 Dos escrituras por carga que no guardan nada

En cada visita al tablero salen **dos `POST user_dashboard_prefs`** que no
corresponden a ningún cambio del usuario:

- `useThemeSync` lee el tema, lo aplica con `setTheme(...)`, eso cambia la
  dependencia `theme` del efecto de guardado, y **a los 800 ms lo reescribe**.
- `DashboardView` hace lo mismo con el layout: `setPrefsReady(true)` está
  comentado en el código como *"flip → triggers save effect below to persist
  current state"*, y el efecto de guardado dispara **a los 1,5 s del montaje**.
  El payload incluye `updated_at: new Date().toISOString()`.

Es el mismo antipatrón que el proyecto ya prohibió para los syncs: un upsert
incondicional que reescribe una fila idéntica, más un `updated_at` puesto por
el cliente que hace que la fila "cambie" siempre. Cada carga del tablero de
cada usuario = 2 escrituras y su WAL, a cambio de cero información.

### 3.4 Una consulta de permisos que ya está en `localStorage`

`fetchBoot` arranca el grupo de empleados con:

```js
supabase.from('role_permissions')
  .select('can_view').eq('role_id', myRoleId).eq('module_key', 'staff_list')
  .maybeSingle()
```

y **espera esa respuesta** antes de lanzar las 5 consultas de empleados. Pero
`AuthContext` ya tiene el mapa completo de permisos en memoria y en
`localStorage` (`sb_role_perms`, 95 módulos). Es un viaje de red extra que
además **serializa** el tramo más pesado del arranque detrás suyo.

### 3.5 Las fotos ya no se bajan dos veces

Cerrado en **v2.274.0** durante esta auditoría. Una firma de storage vale 12 h
pero se regeneraba en cada arranque, y como el token va en la query string,
**una firma nueva es una URL nueva**: el navegador tenía los bytes y no podía
reconocerlos.

| recarga de /dashboard | antes | después |
|---|---|---|
| fotos pedidas | 53 | 28 |
| bytes de red | 588 kB | 60 kB |

---

## 4. Móvil

Medido con viewport 390×844, touch, y **CPU ×4** (que es lo que separa un
teléfono de gama media de este Mac).

- Primer contenido: **249 ms** contra 107 ms en escritorio. La proporción es
  sana: el arranque no es CPU-bound.
- **Misma carga de datos que escritorio: 45 peticiones.** El teléfono baja el
  mismo catálogo de 104 kB, las mismas fotos y los mismos widgets. `DashboardView`
  distingue `mobile_layout` / `mobile_sizes` para *dibujar*, pero los widgets
  montados traen su propio dato igual.
- Los 291 ms de spinner por módulo son los mismos, y ahí sí se suma el render
  a ×4.
- Sin bucle de rAF y sin polling también en móvil: en reposo no consume batería
  por red.

**Nota de método:** esto se midió en Chromium con throttling, que es lo
correcto para rendimiento. Para bugs de *layout* móvil sigue haciendo falta
WebKit — no son la misma prueba.

---

## 5. Patrones viejos encontrados

| qué | dónde | riesgo |
|---|---|---|
| `.limit(1000)` a mano | `minmaxRequests.js:34`, `conteoInventario.js:20`, `stockParams.js:69` | Truncado silencioso el día que la tabla pase de 1000. No está roto hoy. |
| Dos caminos para el mismo perfil | tabla en el login, edge function en la recarga | Divergencia: un campo agregado a uno no llega al otro. |
| `updated_at` del cliente en un upsert | `DashboardView.jsx:647` | La fila siempre "cambia". |
| Catálogo completo en memoria para buscar | `WidgetMinMaxRequest.jsx:243` | 104 kB; el proyecto ya tiene búsqueda server-side. |

No se encontró: `.range(0, 9999)`, `select('*')` sobre tablas grandes en el
arranque (los que hay son `head: true` con `count`), ni dependencias
desactualizadas.

---

## 6. Qué haría, en orden

> ⚠️ **ORDEN SUPERADO.** El punto 1 no era "el número más grande del informe":
> las 809 kB de fuentes PDF de Pedidos lo eran, y este informe no las vio porque
> midió tiempo con caché caliente. Ese ítem **ya está cerrado** (v2.283.0). El
> orden vigente está en el §9 de `AUDITORIA-COMPLETA-2026-07-30.md`, y arranca
> por los bugs vivos: `employees.is_admin` (solicitudes sin aprobador),
> `recibido_mh` (sello fiscal leído como booleano) y las dos policies con
> `WITH CHECK (true)`. Los puntos 2 a 5 de abajo siguen vigentes tal cual.

Ordenado por lo que devuelve, no por lo que cuesta:

1. ~~**Que la navegación no suspenda**~~ — 291 ms en cada entrada a cada módulo,
   para todos los usuarios, escritorio y móvil. Sigue siendo cierto que el
   prefetch no puede tocarlo, pero **no** era el número más grande del informe
   (ver la corrección del §3.1). Baja de prioridad: toca 44 rutas y cambia el
   comportamiento ante deploys, porque hoy `vite:preloadError` depende de que
   `React.lazy` tire.
2. **Que el catálogo de productos se cargue cuando alguien escriba**, no al
   montar el widget — la mitad del peso del tablero, en el teléfono también.
3. **No reescribir preferencias que nadie cambió** — dos escrituras por carga,
   de cada usuario, sin información.
4. **Leer el permiso `staff_list` de `localStorage`** en `fetchBoot` — un
   viaje de red menos, y destraba el tramo más pesado del arranque.
5. **Ventana mínima en el refresco por `visibilitychange`** — barato, pero hoy
   no tiene freno.

Los puntos 1 y 2 son los que un usuario nota. El 3 y el 4 son costo de
servidor y de arranque. El 5 es higiene.
