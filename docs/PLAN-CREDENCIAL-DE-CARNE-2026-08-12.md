# El carné como credencial — hallazgo y plan

**Fecha:** 2026-08-12 · **Estado:** ABIERTO, nada aplicado todavía
**Origen:** pregunta del usuario tras quitar el código del carné de la pantalla
de login (v2.575.3).

---

## 1. En una frase

El número de empleado no es un identificador: **es literalmente la contraseña**
de esa persona, y cualquier empleado con sesión puede leer el de todos los
demás desde la API. Quitarlo del login fue correcto y no alcanza.

---

## 2. El hallazgo, con su evidencia

### 2.1 El código ES la contraseña

`supabase/functions/ensure_user_by_code/index.ts:225-232` crea la cuenta de
Auth así:

```ts
const codeKey = employee.code.trim().toUpperCase();
email = `${codeKey.toLowerCase()}@staff.local`;
createPayload = { email, password: codeKey, email_confirm: true, ... };
```

Y `src/context/AuthContext.jsx:765` completa el login con ese mismo valor:

```js
supabase.auth.signInWithPassword({ email: ensured.user.email, password: cleanId })
```

`cleanId` es el código escaneado. O sea: **correo y contraseña son ambos el
número del empleado**, y el correo es derivable sin preguntarle a nadie
(`<código>@staff.local`).

El `kiosk_pin` es la misma historia por otra puerta: es `SHA-256(code)`
(regla en `CLAUDE.md` §Estructura BD punto 9) y funciona como contraseña de su
propia cuenta `<pin>@staff.local` (`index.ts:213-220`). Un número público,
dos llaves.

### 2.2 El código es público dentro del portal

Medido en producción el 2026-08-12:

- La policy `employees_select` deja a **todo usuario autenticado** leer todas
  las filas de `employees` salvo las de cargos `is_su`.
- Los permisos de columna para `authenticated` incluyen `code`, `kiosk_pin`,
  `username`, `dui` y `base_salary`.

Es decir que un `?select=code,kiosk_pin` devuelve la lista completa de
credenciales del personal a cualquiera que haya entrado. No hace falta ninguna
herramienta: RLS es por fila, no por columna, y el permiso de UI que oculta el
dato no gobierna la API.

Además el código aparece legítimamente impreso en pantalla en varios lugares
—expediente, solicitudes, listados— porque **es** el número del empleado.

### 2.3 La cuenta no necesita existir de antemano

`index.ts:236-243` llama a `createUser` en cada pre-login y se come el error si
ya existe. Consecuencia: el primero que envíe un código **crea** la cuenta con
esa contraseña. No hace falta que la persona haya entrado nunca al portal.

### 2.4 El rate limit no cubre el camino que importa

`index.ts:11-17` y `:193-203`: el freno es de 15 intentos **fallidos** por IP
cada 10 minutos, y sólo cuenta `NOT_FOUND` / `INACTIVE`. Dos huecos:

1. Quien ya vio los códigos en pantalla **no falla nunca**, así que jamás lo
   dispara.
2. Como el correo es derivable, se puede ir directo a `signInWithPassword`
   contra GoTrue y **saltearse la función entera**. Todo freno que pongamos en
   la función es rodeable mientras el código siga siendo una contraseña de Auth.

### 2.5 Alcance medido

| Medición (2026-08-12, producción) | Valor |
|---|---|
| Cuentas `@staff.local` (carné/kiosco) | 49 |
| …cuyo correo es exactamente `<código>@staff.local` | 15 |
| Cuentas `@farmalasa.app` (usuario+contraseña) | 51 |
| Sesiones últimos 45 días vía carné/kiosco | 16 (9 cuentas) |
| Sesiones últimos 45 días vía usuario+contraseña | 366 (8 cuentas) |
| Dispositivos registrados en `kiosk_devices` | 1 activo |
| Filas en `attendance` | 0 |

Las 34 cuentas `@staff.local` restantes corresponden a `kiosk_pin` o quedaron
huérfanas de códigos que cambiaron.

**Advertencia sobre el conteo de sesiones:** `auth.sessions` guarda sólo las
sesiones **vivas** —las vencidas por inactividad se borran, ver
`PLAN-SESIONES-SEGURAS-2026-08-08.md`—, así que subestima el uso histórico y
sesga hacia los días recientes. Sirve para decir «el carné se usa poco», no
para medir volumen.

`attendance` en cero significa que el kiosco no está generando marcaciones
hoy; **no** significa que no las genere nunca. No usar ese cero como evidencia
de nada más.

---

## 3. Lo que NO es la solución

**Seguir escondiendo el código en la UI.** Quitarlo del login estuvo bien
porque esa pantalla se ve sin haber entrado. Pero el código aparece en muchas
pantallas donde es información útil y correcta, y esconderlo en todas rompe
cosas sin cerrar nada: la API lo devuelve igual.

El problema no es que el código se vea. **Es que el código sea una contraseña.**

---

## 4. La estrategia, en tres fases

| Fase | Qué hace | Reimprime carnés |
|---|---|---|
| **1** | El código deja de ser contraseña; el escaneo se ata a un dispositivo registrado | No |
| **2** | El carné lleva su propio secreto aleatorio, hasheado, revocable | Sí (49) |
| **3** | Ciclo de vida: emisión, revocación, pantalla de credenciales | — |

Este documento detalla la **Fase 1**. Las otras dos quedan esbozadas en §10.

---

## 5. Fase 1 en detalle

### 5.1 Qué cambia mecánicamente

**Hoy** — tres viajes al servidor:

1. `ensure_user_by_code {código}` → devuelve el correo; de paso crea la cuenta
   con contraseña = el código
2. `signInWithPassword(correo, código)` → sesión
3. `ensure_user_by_code` con sesión → perfil completo

**Después** — los mismos tres viajes:

1. `ensure_user_by_code {código, device_token}` → verifica y devuelve un
   **token de un solo uso** (`admin.auth.admin.generateLink`, que genera el
   enlace sin enviar correo)
2. `verifyOtp({ token_hash })` → sesión
3. `ensure_user_by_code` con sesión → perfil completo

No se agrega ni se quita un viaje de red.

### 5.2 Qué mejora — y qué NO

**Mejora:**

1. **Deja de haber dos puertas.** Hoy la credencial se acepta en la función
   —con freno, registro y reglas— y también en GoTrue directo, que no tiene
   nada de eso. Después queda **una sola entrada, y es la que controlamos**.
   Éste es el cambio de fondo: no agrega una defensa, hace posible defender.
2. **Invalida lo ya cosechado.** Al rotar las contraseñas de las 49 cuentas a
   un valor aleatorio, cualquier lista de códigos y PIN que alguien haya
   copiado deja de abrir nada.
3. **Corta la llave duplicada**: el `kiosk_pin` deja de ser una segunda
   contraseña del mismo número público.
4. **Lo que viaja al navegador deja de ser reutilizable**: un token de un solo
   uso y vida corta en lugar de una contraseña permanente. Quien intercepte la
   respuesta no se lleva una llave.

**No mejora por sí solo:** que el código, a secas, siga alcanzando para pedir
sesión. Si la función acepta el número pelado como prueba suficiente, el
atacante simplemente pide por la puerta buena. Por eso la Fase 1 **tiene que**
incluir §5.3; sin eso es plomería, no protección.

> Esto corrige lo que dije primero en la conversación —que la Fase 1 «mata el
> ataque de ver el número y entrar»—. Cierra el camino que no controlamos, no
> el ataque.

### 5.3 El freno que la vuelve una mejora real

`kiosk_devices` ya existe y está probado: `device_token uuid`, por sucursal,
con `status`, `revoked_at` y `last_active_at`. Hoy tiene **un** dispositivo.

Regla nueva: **el login por carné sólo se acepta desde una terminal
registrada.** Desde un teléfono en la casa, con el número de otro, la función
responde que no y el intento queda registrado.

Eso reduce el ataque a *estar parado en la terminal de la sala con el número de
otro* — que es el escenario físico que un carné supone de todos modos, y que
ahora deja rastro: qué dispositivo, cuándo, con qué código.

Complementos que entran en la misma fase:

- **Rate limit por código**, no sólo por IP (hoy es sólo por IP).
- **Registrar todo intento** de escaneo con su dispositivo, exitoso o no. Hoy
  sólo se registran los fallidos, y sin dispositivo.

### 5.4 Latencia — expectativa y cómo se mide

Expectativa: **empate o leve mejora**. Tres razones concretas:

- **El paso 2 se abarata.** Verificar una contraseña es deliberadamente caro
  (el hash está diseñado para ser lento, decenas de ms de CPU). Canjear un
  token es una búsqueda por hash.
- **El paso 1 queda igual.** Hoy la función ya hace una llamada de
  administración a Auth en *cada* login (`createUser` incondicional, que para
  las 49 cuentas existentes falla y se ignora). Esa llamada se reemplaza por
  `generateLink`. Es una por una, salvo el primer login de cada persona.
- **No entra correo en el circuito.** `generateLink` genera, no envía.

**Eso es expectativa, no medición.** Se mide en staging, con la misma cuenta,
varias corridas, cronometrando del escaneo al `completeLogin`, **con caché
frío** — medido con caché caliente el instrumento dice lo que uno quiere oír
(ver memoria `feedback_headless_lies_about_performance` y
`feedback_el_primero_del_lote_paga_el_cache_frio`).

### 5.5 Riesgos y qué puede romper

| Riesgo | Por qué | Cómo se controla |
|---|---|---|
| **Nadie entra al portal** | `ensure_user_by_code` no está sólo en el login por carné: la llama `loginWithEmail` (`AuthContext.jsx:808`) y, sobre todo, `procesarSesion` dentro de `onAuthStateChange` (`:678`, con timeout de 5s) — o sea **cada restauración de sesión y cada refresco de token, de cualquier usuario, entró como haya entrado** | Staging primero; en prod los dos caminos conviven antes de apagar el viejo. Probar refresco de sesión, no sólo el login |
| **401 antes de ejecutar una línea** | La llama el navegador **sin sesión**: necesita `--no-verify-jwt` | Verificar el valor vivo con `list_edge_functions` antes y después del deploy |
| **Rotar contraseñas antes de tiempo** | Si el camino nuevo falla y las viejas ya se rotaron, no entra nadie por carné | La rotación es el **último** paso, con el camino nuevo ya confirmado en logs |
| **Se reactiva `must_change_password`** | Las cuentas de carné están exentas del gate en `onAuthStateChange`; el canje por token podría no heredar la exención | Probar refresco de sesión en staging, no sólo el login |
| **Romper pantallas al revocar `kiosk_pin`** | El formulario de empleado lo regenera al cambiar el código | Barrer quién lee la columna **antes** de revocarla; va al final |
| **El CLI se traga el `.env` del repo** | Ya pasó | `mv .env .env.bak` antes de desplegar (memoria `reference_edge_function_deploy_workaround`) |

---

## 6. Plan de ejecución

### Bloque A — no toca producción

- [ ] **A1.** Medir la línea base del login actual en producción: tiempo del
      escaneo al `completeLogin`, 5 corridas, caché frío. Anotar acá.
- [ ] **A2.** Confirmar en staging (`cbnjplmnfmfsambavjce`) que
      `@supabase/supabase-js@2.97` devuelve `properties.hashed_token` en
      `admin.generateLink({ type: 'magiclink', email })` y que
      `auth.verifyOtp({ token_hash, type })` abre sesión. **Si la versión no lo
      soporta, el diseño cambia y hay que revisar este plan antes de seguir.**
- [ ] **A3.** Escribir la versión nueva de `ensure_user_by_code` con los dos
      caminos vivos: si el cuerpo trae `device_token` válido → token de un solo
      uso; si no → comportamiento actual. Desplegar **sólo en staging**.
- [ ] **A4.** Levantar el portal contra staging (`npm run dev:staging`) y
      probar: login por carné, login por usuario+contraseña, refresco de sesión,
      y que el perfil llegue completo.
- [ ] **A5.** Medir de nuevo y comparar contra A1. Anotar los dos números acá.
- [ ] **A6.** Barrer quién lee `employees.kiosk_pin` en `src/` y en
      `supabase/functions/` (para el paso C3).

### Bloque B — producción, en la ventana (§7)

- [ ] **B1.** `mv .env .env.bak`; desplegar `ensure_user_by_code` con
      `--no-verify-jwt`; restaurar el `.env`.
- [ ] **B2.** Verificar el valor vivo de `verify_jwt` con `list_edge_functions`
      — tiene que seguir en `false`.
- [ ] **B3.** Probar en producción, con una cuenta real, los dos caminos de
      login antes de irse. **Si algo falla, revertir por §8 en el momento.**
- [ ] **B4.** Registrar las terminales de sala en `kiosk_devices` y activar la
      exigencia de `device_token` para el login por carné.
- [ ] **B5.** Rate limit por código + registro de todo intento con dispositivo.

### Bloque C — después, con el camino nuevo confirmado

- [ ] **C1.** Revisar los registros unos días: que nadie entre por el camino
      viejo. Es la condición para C2.
- [ ] **C2.** Rotar la contraseña de las 49 cuentas `@staff.local` a un valor
      aleatorio de 32 bytes. **Acá muere el ataque de §2.1.**
- [ ] **C3.** `REVOKE SELECT (kiosk_pin) ON employees FROM authenticated, anon`,
      con el barrido de A6 hecho.
- [ ] **C4.** Cerrar: actualizar este documento y la memoria del proyecto.

Cada bloque va a su propio commit con su bump de versión.

---

## 7. La ventana — medida, no supuesta

La intuición era «un domingo». **Es correcta, pero por poco margen y con una
trampa en el instrumento.**

Contando sesiones de `auth.sessions`, el domingo aparece entre los picos
(24 sesiones a las 11:00, 21 a las 22:00). Eso es un **artefacto**: esa tabla
sólo guarda sesiones vivas, y las del domingo más reciente todavía no
vencieron. Medir uso con una tabla que se poda sola da el día más reciente,
no el más activo.

El instrumento correcto es `audit_logs`, que no se poda. Últimos 45 días, hora
local de El Salvador:

| Día | Acciones |
|---|---|
| Viernes | 2,180 |
| Miércoles | ~2,660 (incluye un proceso masivo de madrugada) |
| Lunes | 538 |
| Martes | 696 |
| Jueves | 526 |
| Sábado | 251 |
| **Domingo** | **72** |

Y dentro del domingo, las horas **00:00 a 07:59 tienen cero acciones** en los
45 días medidos.

Cruzado con los crons de sincronización, que corren `12-23,0-5` UTC — o sea
**06:00–23:00 hora local**, inactivos de 00:00 a 05:59:

> ### Ventana recomendada: **domingo, 01:00–04:00 hora de El Salvador**
>
> Cero actividad de portal medida, cero crons de sincronización corriendo, y
> tres horas de margen antes de que arranque cualquiera de los dos.

Ojo con generalizar: la madrugada **no** está siempre vacía — el miércoles
00:00–02:00 acumuló 1,834 acciones de un proceso masivo. La ventana es del
domingo, no de «la madrugada».

---

## 8. Rollback

El camino viejo sigue vivo hasta C2, así que revertir es volver a desplegar la
versión anterior de la función:

```bash
mv .env .env.bak
supabase functions deploy ensure_user_by_code --no-verify-jwt
mv .env.bak .env
```

**Después de C2 el rollback ya no es simétrico**: las contraseñas viejas dejan
de existir. Si hubiera que volver atrás en ese punto, la salida es regenerar
las cuentas o entrar por usuario+contraseña, que no se toca en ningún momento
de este plan. Por eso C2 va días después de B, no la misma noche.

---

## 9. Cómo sabremos que salió bien

1. Las dos vías de login funcionan en producción — probado a mano, no inferido.
2. El tiempo del escaneo al `completeLogin` no empeoró contra la línea base de
   A1 (número contra número, no impresión).
3. Los registros muestran logins por carné con `device_token`, y ninguno por el
   camino viejo.
4. Después de C2: un intento de `signInWithPassword` con `<código>@staff.local`
   y el código como contraseña **falla**. Ésta es la prueba que cierra el
   hallazgo — hacerla explícitamente, con una cuenta de prueba.
5. Después de C3: `?select=kiosk_pin` sobre `employees` da error de permisos
   para `authenticated`.

---

## 10. Fases 2 y 3, esbozadas

**Fase 2 — el carné lleva su propio secreto.** El barcode deja de codificar el
código del empleado y pasa a llevar un token aleatorio de 128 bits. Vive en
`employee_badge_credentials` (employee_id, token_hash, issued_at, issued_by,
revoked_at), **guardado hasheado** con pepper en Vault, RLS habilitado sin
policies y grants revocados — el patrón que ya usó el kiosco y que exige la
memoria `feedback_client_side_credentials_are_decorative`: una credencial va en
su propia tabla. Si se filtra la tabla, no salen carnés funcionales. Requiere
reimprimir 49 carnés; se puede por tandas, aceptando ambos formatos mientras
dure.

**Fase 3 — ciclo de vida.** Revocar un carné perdido pasa a ser una fila con
`revoked_at`, no cambiar el código del empleado (que es lo único que hay hoy,
arrastra referencias de planilla y deja cuentas huérfanas). Más una pantalla de
credenciales activas —quién tiene carné, desde cuándo, revocar— y el evento
correspondiente en el expediente al emitir o revocar.

**Lo irreducible:** quien roba el carné físico entra. Es inherente a una
credencial de portación. Se controla con revocación rápida y con no dejar que
el carné solo autorice lo sensible — el kiosco ya pide PIN para las excepciones
que tocan planilla.

---

## 11. Bitácora

| Fecha | Qué pasó |
|---|---|
| 2026-08-12 | v2.575.3 — el login deja de mostrar el código del carné en pantalla. Es la rendija, no la puerta. |
| 2026-08-12 | Hallazgo levantado y medido; este documento. **Nada más aplicado.** |
