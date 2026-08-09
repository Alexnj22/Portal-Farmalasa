# Plan — sesiones seguras (2026-08-08)

Auditoría del manejo de sesiones del portal y plan para cerrarlo. Las decisiones
de alcance las tomó el usuario el 2026-08-08:

- **Alcance: todo, incluido el enforcement del lado del servidor** (F3).
- **«Móvil» pasa a significar PWA instalada o build nativo**, no cualquier
  user-agent de teléfono.
- **Google Maps se queda** permitido en la CSP; se cierran unpkg y jsdelivr.

---

## 0. La foto de partida, medida hoy

Todo lo de esta sección está verificado contra el código instalado y contra
producción — no es lectura de documentación.

| Qué | Estado real |
|---|---|
| Dónde vive el token | `localStorage`, clave `sb-sacecdkdmsdvgqnrsett-auth-token`, JSON plano con `access_token` **y** `refresh_token` |
| Vida del access token | **1 hora** — medido sobre 113 rotaciones reales de `auth.refresh_tokens`: mínimo 3,480s, mediana 4,019s |
| Caducidad de la sesión en el servidor | **Ninguna.** `not_after IS NULL` en las 3,585 filas de `auth.sessions` |
| Límite por inactividad | Sólo en el navegador: `localStorage.sb_last_activity_at` |
| CSP | `Content-Security-Policy-Report-Only`, sin `report-uri` → **no bloquea ni reporta** |
| MFA | 0 factores verificados sobre 86 usuarios |
| Acumulación | 3,580 sesiones vivas para 51 usuarios del portal (~70 c/u), sin purga |

Los límites por inactividad de `AuthContext.jsx`:

```
IDLE_EMP_MS    =  5 minutos
IDLE_ADMIN_MS  = 12 horas      (SU o con permiso de vista en módulos de gestión)
IDLE_MOBILE_MS = 30 días       (hoy: cualquier user-agent móvil)
```

### Lo que está bien y no hay que tocar

Cero `dangerouslySetInnerHTML` con datos de usuario. Cero `eval`/`new Function`.
El `safePin` del carné va filtrado a `[A-Z0-9]` y el `safeName` escapado.
`public/sw.js` sólo cachea la página de «sin conexión» y su ícono — no toca
respuestas de la API. `timeClock.audit.js:92-93` borra `access_token` y
`refresh_token` antes de auditar. La higiene propia del código está bien.

---

## 1. Los tres hallazgos que no son teóricos

### H1 · JavaScript de terceros corriendo dentro del origen del portal

Tres cargas en runtime, ninguna con `integrity`:

| Dónde | Qué |
|---|---|
| `src/utils/routeOptimizer.js:217` | `unpkg.com/leaflet@1.9.4/dist/leaflet.js` |
| `src/utils/routeOptimizer.js:213` | `unpkg.com/leaflet@1.9.4/dist/leaflet.css` |
| `src/utils/routeOptimizer.js:87` | `maps.googleapis.com/maps/api/js` |
| `src/components/forms/FormNovedad.jsx:613` | `cdn.jsdelivr.net/npm/jsbarcode@3` |

La de jsdelivr es la peor y conviene entender por qué: se inyecta con
`window.open()` + `document.write()`, y **un documento abierto así hereda el
origen del portal**. Ese script ve el `localStorage` completo, incluido el token.

O sea que el «tercero» que preocupa no necesita atacar al portal: le alcanza con
que comprometan un paquete en unpkg o en jsdelivr. Y la defensa que debería
frenarlo está apagada — la CSP es `Report-Only`.

### H2 · El cierre por inactividad se deshace solo, sin atacante

En `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:1594-1601`, si la
llamada de revocación falla por red con algo que no sea 401/403/404, `signOut()`
**retorna antes de `_removeSession()`**: el token **no se borra** de
`localStorage`. Y `doLogout()` lo llama con `.catch(() => {})`.

Encadenado con `isExpiredByIdle`:

```js
const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
if (!last || last > Date.now()) return false;   // sin sello → NO vencido
```

`clearAuthCache()` borra `sb_last_activity_at`. Entonces, tras un cierre por
inactividad sin red: el token sigue puesto, el sello no está, y la próxima carga
pregunta «¿venció?» y le contestan que no. **Recargás y volvés adentro.** Es el
escenario de la laptop que se durmió, no un caso de laboratorio.

### H3 · Cerrar por inactividad en la computadora cierra el teléfono

`supabase.auth.signOut()` sin argumentos usa `scope: 'global'`
(`GoTrueClient.js:1578`): revoca **todas** las sesiones del usuario en todos sus
dispositivos. Cada timeout de 5 minutos en el escritorio mata la sesión larga del
celular — exactamente lo contrario de lo que se quiere.

---

## 2. El principio que ordena el plan

**Mientras `supabase-js` corra en el navegador, el token tiene que estar al
alcance del JavaScript de la página.** No hay configuración que lo evite; lo
único que lo evitaría es un BFF que proxee *todas* las llamadas (cientos de
sitios, más Realtime y Storage) y eso no se justifica acá.

Entonces «que un tercero no acceda al token» se consigue por dos vías a la vez:

1. **Que no haya terceros corriendo en el origen** → F0.
2. **Que un token robado sirva poco tiempo y su uso se detecte** → F1.

Y hay una restricción dura que define la forma de F3: **el *inactivity timeout*
de Supabase es un solo número global.** No se le puede pedir 5 minutos para el
empleado de escritorio y 30 días para la PWA. El de Supabase tiene que ser el
**más largo**, y el estricto se enforcea en el hook de emisión de token.

---

## F0 · Sacar a los terceros del origen

### F0.1 — Leaflet empaquetado

`npm i leaflet`, y `loadLeaflet()` pasa a `await import('leaflet')` + el CSS
importado desde el bundle. Es el patrón que CLAUDE.md ya exige para librerías
pesadas y que el repo usa con `pdfmake`, `@zxing` y `@imgly`.

Leaflet es el **fallback** de Google Maps, no el camino principal: lo consumen
`CrearRutaModal.jsx:201` y `RutaMapModal.jsx:339`, ambos después de que Google
falle. Como sólo hace falta al abrir un mapa, va por `await import()` y **hay que
agregarlo a la constante `PESADAS` de `scripts/bundle-gate.mjs` con su motivo
escrito** — si no, el día que alguien lo importe estático nadie se entera.

### F0.2 — El carné sin script externo

`npm i jsbarcode`. En `FormNovedad.jsx`, generar el SVG del código de barras
**en la app** (import dinámico) y serializarlo; el `document.write` de la ventana
de impresión pasa a llevar sólo markup, sin ningún `<script>`. Se va el único
script de tercero que hoy corre en un documento del mismo origen.

### F0.3 — CSP en enforce, en dos pasos

**Paso A (el que cierra el robo de token).** En `vercel.json`, cambiar
`Content-Security-Policy-Report-Only` por `Content-Security-Policy` y sacar
`https://unpkg.com` y `https://cdn.jsdelivr.net` de `script-src` y `style-src`.
Se mantiene `'unsafe-inline'` **por ahora**, y `https://maps.googleapis.com`
queda permitido por decisión del 2026-08-08.

Riesgo bajo y beneficio inmediato: sin unpkg ni jsdelivr, el camino de H1 se
cierra aunque el paquete se comprometa.

**Paso B (endurecer contra XSS).** Sacar `'unsafe-inline'` de `script-src`.
Requiere trabajo porque `index.html` tiene **cinco bloques inline** (líneas 10,
81, 131, 558 y 594) y Vite además inyecta su polyfill de `modulepreload` inline.
Dos caminos: mover los bloques propios a un `/boot.js` servido desde `self` —un
`<script src>` sin `defer` sigue corriendo sincrónico antes de React, que es lo
que el bloque del viewport necesita— y resolver el de Vite con hashes calculados
en build.

**Cómo se despliega sin romper nada:** enforce la política del Paso A y, en
paralelo, `Content-Security-Policy-Report-Only` con la del Paso B. Así se ven las
violaciones de la estricta sin que rompan a nadie. Hoy el `Report-Only` no tiene
`report-uri`, así que sólo avisa por consola — vale agregar uno.

---

## F1 · Que un token robado muera (sólo panel, sin código)

En **Authentication → Sessions / JWT** del proyecto `sacecdkdmsdvgqnrsett`:

| Ajuste | Hoy | Propuesto | Por qué |
|---|---|---|---|
| Access token (JWT) expiry | 3600s | **900s** | Un access token robado sirve 15 min en vez de 1 hora |
| Refresh token rotation | activa | **activa + reuse interval 10s** | Detección de reuso: cuando el ladrón usa el token, el refresh del cliente legítimo delata el robo y Supabase revoca **toda la familia** |
| Inactivity timeout | ninguno | **30 días** | El más largo que necesitamos (PWA/nativo). Los límites estrictos los pone F3 |
| Session timebox | ninguno | **90 días** | Techo absoluto: nada vive para siempre, ni siquiera la PWA |

Bajar el JWT a 900s cuadruplica los refrescos. Con 51 usuarios activos es
irrelevante en costo, y es lo que le da al hook de F3 su resolución: **el
enforcement server-side sólo puede actuar cuando se emite un token**, así que la
holgura máxima del «5 minutos» es un ciclo de token.

### La acumulación de `auth.sessions`: de dónde sale de verdad

Medido el 2026-08-08, porque «la tabla crece sin limpiarse» era cierto pero
señalaba al culpable equivocado:

| Cuenta | Sesiones | Refrescadas alguna vez |
|---|---|---|
| `qa.test` | **3,338** | 1 |
| `edwin.nunez` | 205 | 5 |
| `qa.e2e.test` | 32 | 0 |
| `celina.escobar` | 2 | 2 |
| resto | 3 | — |

**El 93% es `qa.test`**, o sea el Playwright de las sesiones de trabajo. El
**99.7% de todas las sesiones nunca se refrescó**: entran, hacen lo suyo en menos
de una hora y el contexto del navegador se tira. El uso real de los últimos 7
días son **5 usuarios distintos**. Entre el 26-jul y el 8-ago hubo días de 170 a
278 sesiones nuevas generadas por **una sola cuenta**.

Consecuencias para el plan:

- El *inactivity timeout* y el *timebox* **limpian solos** `auth.sessions` —como
  esas sesiones nunca se refrescan, quedan obsoletas de inmediato. **No hace
  falta un cron de purga propio para `auth.sessions`.**
- Pero el estado estable pasa a ser «lo generado en los últimos 30 días», y al
  ritmo de QA de estas dos semanas eso siguen siendo miles. **El timeout acota el
  crecimiento; no baja el número mientras las pruebas sigan logueando así.** La
  palanca real es que los tests reusen el estado de sesión (`storageState` de
  Playwright) en vez de hacer login en cada archivo.
- **`scope: 'local'` (F2.3) empeora un poco la acumulación**, porque `global`
  borraba todas las sesiones del usuario cada vez que corría. Es el precio
  correcto por que cerrar en el escritorio no cierre el teléfono.
- **`session_activity` (F3) sí necesita su propia purga desde el día uno** —
  regla 7 de CLAUDE.md. Cron diario que borra las filas cuya sesión ya no existe
  en `auth.sessions`.

---

## F2 · Los tres bugs (chico, entra ya)

Cuatro ediciones en `src/context/AuthContext.jsx`:

1. **`doLogout()` no puede confiar en `signOut()`.** Borrar
   `sb-<ref>-auth-token` de `localStorage` explícitamente, pase lo que pase con
   la llamada de red. Hoy un fallo de red deja el token puesto (H2).
2. **`isExpiredByIdle`: sin sello y con usuario en caché = vencido.** El estado
   «hay `sb_user` pero no hay `sb_last_activity_at`» sólo se produce después de un
   `clearAuthCache()`, o sea después de un cierre — tratarlo como sesión viva es
   justo el agujero. Ojo al primer arranque limpio: ahí no hay usuario en caché y
   este camino no se consulta.
3. **`signOut({ scope: 'local' })`.** Cerrar por inactividad en un dispositivo no
   puede cerrar los demás (H3).
4. **`IS_MOBILE_SESSION` deja de mirar el user-agent, y deja de ser una
   pregunta que se hace cada vez.** La detección pasa a ser
   `display-mode: standalone` + `navigator.standalone` + `window.Capacitor` —la
   misma que `index.html` ya hace para el zoom— pero **se evalúa UNA sola vez, al
   iniciar sesión**, y el resultado se guarda en `sb_device_class` junto al resto
   del caché de auth. El vigilante de inactividad lo lee de ahí. Ver
   «la clase es de la sesión» más abajo, que es el motivo de fondo.

---

## La clase del dispositivo es de la SESIÓN, no de la ventana

Esto salió de una pregunta del usuario el 2026-08-08 —«si estoy en escritorio y
tengo otra sesión en una PWA, ¿funcionará bien con los tiempos en cada
dispositivo?»— y corrige un defecto del diseño original.

**Dispositivos distintos funcionan bien y no hace falta nada especial**: cada uno
tiene su propio `session_id`, su propia familia de refresh tokens, su propio
`sb_last_activity_at` y su propia fila en `session_activity`. Con `scope: 'local'`
(F2.3), cerrar uno ya no cierra el otro.

**El caso que rompía es la PWA instalada en la MISMA computadora.** Una PWA de
escritorio corre en el mismo perfil y el mismo origen que el navegador, así que
**comparte `localStorage`**: no son dos sesiones, es una. Con la clase evaluada
por ventana, las dos ventanas contestaban distinto —`display-mode: standalone`
es falso en la pestaña y verdadero en la PWA— mientras escribían el mismo sello
de actividad y usaban el mismo token. El vigilante de la pestaña cerraría la
sesión que la PWA está usando. Y el `device_class` «congelado en el INSERT»
quedaba a suerte de cuál ventana latió primero.

**La regla, entonces: la clase se decide una vez al iniciar sesión, se guarda
con la sesión, y ni el cliente ni `touch_session` vuelven a preguntarle al
`display-mode` de la ventana actual.** Las dos ventanas coinciden siempre porque
coinciden en la sesión: si entraste desde la PWA las dos tienen la ventana larga;
si entraste desde la pestaña, las dos tienen la corta.

En teléfono, cuánto comparten la app de pantalla de inicio y el navegador varía
según la plataforma. Con esta regla **deja de importar cuál sea**, que es
justamente por qué se prefiere a averiguarlo.

---

## F3 · Que los 5 minutos y las 12 horas sean del servidor

### Las piezas

**Tabla `public.session_activity`** — `session_id uuid PK`, `user_id uuid`,
`device_class text`, `last_seen_at timestamptz`, `created_at timestamptz`.
Con RLS y policy explícita, índice sobre `user_id`, y `GRANT SELECT` a
`supabase_auth_admin` (el hook corre con ese rol).

**RPC `touch_session(p_device_class text)`** — SECURITY DEFINER,
`SET search_path = public, extensions`. **El `session_id` sale de
`auth.jwt() ->> 'session_id'`, nunca de un parámetro** — es la regla del repo
sobre autoría (`feedback_rpc_authorship_never_trust_client_param`).
`INSERT ... ON CONFLICT (session_id) DO UPDATE SET last_seen_at = now()`:
**`device_class` se fija sólo en el INSERT y no se puede cambiar después.** El
cliente lo manda desde `sb_device_class`, que se calculó al iniciar sesión — no
lo recalcula por ventana (ver «la clase del dispositivo es de la sesión»).

**Función `session_idle_limit_minutes(p_user_id uuid, p_device_class text)`** —
espeja `getIdleLimitMs` de `AuthContext.jsx`. No puede usar `auth_employee_id()`:
esa resuelve por `auth.uid()`, y **dentro del hook no hay JWT de usuario**. Tiene
que recibir el `user_id` del evento y resolver el empleado con la misma lógica
que `auth_employee_id()` tiene en el catálogo (por `employees.id` y, si no,
por `employee_auth_accounts.auth_user_id`).

**Hook `public.custom_access_token_hook(event jsonb)`** — corre en cada emisión
de token (login y cada refresh). Saca `session_id` de `event->'claims'` y
`user_id` de `event->>'user_id'`, compara `now() - last_seen_at` contra el
límite, y si venció devuelve el objeto de error que hace fallar la emisión.
`REVOKE EXECUTE FROM public, anon, authenticated` + `GRANT EXECUTE TO
supabase_auth_admin`. Se activa en **Authentication → Hooks**.

**Cliente** — un latido que llama a `touch_session` con throttle de 60s,
enganchado al `onActivity` que ya existe y sólo con la pestaña visible. El
`device_class` se lee de `sb_device_class`, que se fijó al iniciar sesión (F2.4).

### Reglas de seguridad de la construcción

Son las de CLAUDE.md, aplicadas acá: RLS con policy explícita, `INSERT` con
`WITH CHECK` real (nunca `true`), FK con índice, `SET search_path` en toda
función, y **si el hook llamara a un `auth_*` desde una policy, envuelto en
`(SELECT ...)`**.

### Tres cosas que hay que decir en voz alta

**El `device_class` lo declara el cliente y el servidor no puede verificarlo.**
No existe forma de que Postgres sepa si el navegador es una PWA instalada. La
mitigación es que se fija en el INSERT y queda congelado para esa sesión, así que
un token robado **no puede ascenderse** a la ventana larga; pero quien logre
iniciar sesión desde un cliente que miente sí la obtiene. El techo real de ese
caso es el *timebox* de F1. Es una comodidad, no una frontera de seguridad, y
conviene que quede escrito.

**El hook es un punto único de fallo del login.** Si explota, nadie refresca su
token. Por eso: **fail-open ante una excepción inesperada, fail-closed sólo ante
un veredicto claro de «vencido»**. Y se prueba primero en el branch de staging
(`ewcmerxqjvludtgskuin`), como exige CLAUDE.md.

**La holgura es de un ciclo de token.** Con el JWT en 900s, el «5 minutos» del
empleado se cumple con hasta 15 minutos de retraso. Bajar más el JWT reduce la
holgura y sube los refrescos; 900s es el punto razonable.

---

## F4 · La vista de Conexiones, en Sistema

Pedida por el usuario el 2026-08-08: ver las sesiones, cerrar una desde ahí, ver
las últimas conexiones y lo que se pueda saber de cada una.

### Dónde vive

Módulo nuevo `sesiones` en el grupo **Sistema** (`AppLayout.jsx:98`, junto a
`permissions`, `maintenance`, `auditview`, `sync_health`, `orphan_objects`).
Ruta con `PermissionGuard moduleKey="sesiones"` en `App.jsx`, entrada `lazy` en
`IMPORTADORES`, y la clave dada de alta en `permissionModules.js` — si no, no se
puede repartir a ningún cargo. Se abre `docs/CHECKLIST-VISTA-NUEVA.md` **antes**
de escribirla, no después.

### Qué se puede mostrar — verificado, no supuesto

`auth.sessions` tiene 15 columnas. Coberturas medidas hoy sobre las 3,585 filas:

| Columna | Cobertura | Qué aporta |
|---|---|---|
| `created_at` | 3,585 | Cuándo empezó la sesión |
| `user_agent` | 3,585 | Con qué dispositivo y navegador |
| `ip` | 3,585 (279 distintas) | Desde dónde |
| `refreshed_at` | **10** | Última renovación. Hoy casi siempre vacío; con el JWT en 900s (F1) pasa a ser un pulso de 15 min |
| `not_after` | **0** | Caducidad. Se empieza a llenar recién con el *timebox* de F1 |
| `aal` | 3,585 (0 en `aal2`) | Si la sesión pasó por MFA |

Y de F3: **`session_activity.last_seen_at` y `device_class`**. Ésas son las que
hacen útil la pantalla — «último uso» de verdad y qué límite le aplica a esa
sesión. Sin F3, `refreshed_at` es lo único parecido y se mueve cada 15 minutos.

**Trampa de tipo, para no repetir la de `recibido_mh`:** `refreshed_at` es
`timestamp **without** time zone` mientras que `created_at` y `not_after` son
`with time zone`. Hay que tratarla como UTC explícitamente o la columna miente
por 6 horas y nadie lo nota.

### Las dos RPC

`auth.sessions` **no está expuesta a PostgREST** (vive en el esquema `auth`), así
que todo pasa por función. Las dos SECURITY DEFINER, con
`SET search_path = public, extensions`, `REVOKE EXECUTE FROM PUBLIC, anon` y
`GRANT ... TO authenticated`.

**`list_sessions(p_user_id uuid default null)`** — join de `auth.sessions` con
`auth.users`, `employees` y `session_activity`. **Nunca devuelve material de
credencial**: fuera `refresh_token_hmac_key`, `refresh_token_counter` y
cualquier token. Devuelve id de sesión, empleado, inicio, último uso, clase de
dispositivo, dispositivo, IP y caducidad.

**`revoke_session(p_session_id uuid)`** — `DELETE FROM auth.sessions WHERE
id = ...` (cae en cascada sobre `auth.refresh_tokens`) más el borrado de su fila
en `session_activity`.

### Autorización — dos niveles, y la identidad nunca del parámetro

Ver las sesiones de todos es ver dónde y a qué hora se conecta cada empleado.
Es dato sensible y no puede ir junto con el resto de Sistema sin distinguir:

- `sesiones` · `can_view` → **sólo las propias**. Cualquiera debería poder ver
  dónde tiene sesión abierta y cerrarla.
- `sesiones` · scope `all` → las de todos, y cerrarlas.

El chequeo va **dentro** de la función, no sólo en la ruta, con
`auth_has_module_permission('sesiones', ...)` **envuelto en `(SELECT ...)`** —
regla del incidente 2026-07-08. Y **`p_user_id` no decide identidad**: si quien
llama no tiene scope `all`, el parámetro se ignora y se fuerza
`auth_employee_id()`. Cerrar una sesión ajena va a `appendAuditLog`.

### Cinco cosas que hay que resolver en el diseño de la pantalla

1. **`qa.test` va a tapar la vista.** Son 3,338 de las 3,585 filas. Necesita
   filtro por empleado y **ocultar las cuentas de prueba por defecto**, o al
   abrirla no se ve nada útil.
2. **Cerrar una sesión no corta al instante.** Borra la fila y el refresh token,
   pero **el access token ya emitido sigue valiendo hasta que expire** — con F1,
   hasta 15 minutos. La pantalla lo tiene que decir con esas palabras, no
   prometer un corte inmediato.
3. **`user_agent` e `ip` son lo que declaró el cliente y lo que vio el proxy.**
   Sirven para que alguien reconozca «esto no fui yo»; no son prueba de nada.
4. **La pantalla habla del portal.** Nada de «JWT», «token», «session_id» ni
   «user agent» a la vista: **Conexiones**, **Último uso**, **Dispositivo**,
   **Cerrar esta sesión**. Y se verifica abriendo la vista y barriendo el DOM
   pintado más `title`/`aria-label`/`placeholder` — grepear el fuente no alcanza.
5. **Es una lista de registros** → `DataTable` + `DataRow`/`DataCell`, que cae
   solo a fichas bajo `lg:`. No se escribe una lista aparte para el teléfono.

### Por qué va después de F3

Las dos columnas que hacen útil la pantalla —último uso real y clase de
dispositivo— **las produce F3**. Se puede entregar antes en versión reducida
(inicio, dispositivo, IP y cerrar), pero entonces «último uso» no existe y
`not_after` sale vacío hasta que F1 esté aplicado.

---

## F5 · Lo que queda anotado y no entra ahora

- **MFA**: 0 de 86 usuarios. Vale al menos para las cuentas SU, pero es una
  decisión de producto aparte y no la pidió nadie.
- **La contraseña del carné es el código del empleado.** Está documentado en el
  encabezado de `ensure_user_by_code/index.ts` y mitigado con rate-limit por IP
  (15 fallos en 10 min, contando sólo `NOT_FOUND`/`INACTIVE`). Se deja como está.

---

## Orden de ejecución, y por qué ése

1. **F2** primero: son cuatro ediciones chicas, arreglan un agujero que ya está
   abierto, y no dependen de nada.
2. **F0** después: cierra H1, que es el camino concreto de robo de token. El Paso
   A de la CSP puede ir en el mismo commit; el Paso B va aparte.
3. **F1** cuando F0 esté en producción: si algo del panel rompe un cliente viejo,
   conviene tener el frontend ya corregido.
4. **F3** después, y **en staging primero**. Es lo único que agrega una pieza
   nueva al camino crítico del login.
5. **F4** al final: sus dos columnas más útiles las produce F3, y `not_after`
   sale vacío hasta que F1 esté aplicado.

## Verificación — la lista de columnas

No se declara ninguna fase cerrada sin esto, y lo que no se pueda verificar se
dice, no se omite:

- **F0**: `npm run build` + `npm run gate:bundle` en verde, y en el navegador la
  pestaña de red sin **ninguna** petición a unpkg o jsdelivr al abrir un mapa y
  al imprimir un carné. La consola sin violaciones de CSP.
- **F1**: decodificar un access token nuevo y confirmar `exp - iat = 900`.
  Confirmar que aparece `not_after` en las filas nuevas de `auth.sessions`.
- **F2**: con la red cortada, forzar el cierre por inactividad y confirmar que
  `sb-<ref>-auth-token` **desapareció** de `localStorage` y que recargar deja en
  la pantalla de login. Confirmar que cerrar en escritorio **no** cierra el
  teléfono.
- **F3**: en staging, un empleado sin actividad por más de su límite recibe un
  fallo al refrescar; el mismo empleado activo no. Y un `curl` con un access
  token robado deja de funcionar al vencer los 900s sin poder refrescar.
- **F4**: `gate:movil`, `gate:design` y `gate:permisos` en verde, y la vista
  abierta en el teléfono con `desbordan`/`chicos`/`zoomIOS` en 0 y **las
  capturas miradas**. Que un usuario sin scope `all` vea **sólo las suyas**
  —probado con dos cuentas, no razonado—. Que cerrar una sesión desde la vista
  la haga desaparecer de `auth.sessions` y que ese dispositivo quede afuera al
  vencer su access token. Y el barrido del DOM pintado más
  `title`/`aria-label`/`placeholder` sin una sola palabra de la tubería.
