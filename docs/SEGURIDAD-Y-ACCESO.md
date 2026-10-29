# Seguridad y acceso — quién entra, con qué, y qué falta

**Fecha:** 2026-10-28 · **Reemplaza a:** el plan del carné como credencial
(2026-08-12), el del carné sólo en turno y sala (2026-08-11) y el blindaje ante
terceros (2026-08-13). Los tres pasan a `docs/planes-cerrados/` — ver §6.

Cada afirmación de estado se contrastó contra el repositorio el 2026-10-28
(`CHANGELOG.md`, `supabase/migrations/`, `supabase/functions/`, `src/`). **No se
consultó producción**: los conteos con fecha son de la medición que se cita, no
de hoy. Lo que dependa de un número vivo —terminales registradas, cuentas
huérfanas— se remide antes de actuar.

---

## 1. El modelo de amenaza, en una frase larga

Damos por hecho que un tercero consigue **una credencial válida de un empleado
cualquiera** —un carné prestado, alguien que se fue, una contraseña compartida
entre turnos, o el número de empleado, que es público porque es el código de
vendedor impreso en cientos de miles de facturas—, que tiene **la llave anónima**
(viaja en el bundle, no es secreto), y que tiene **tiempo y velocidad** (una IA
no se aburre en la fila 3,000); no asumimos acceso al panel de Supabase, a la
llave de servicio ni a la máquina de quien administra, porque contra eso no hay
RLS que valga. El perímetro es **RLS + la autorización dentro de las edge
functions y de las funciones `SECURITY DEFINER`**; la interfaz no es un control,
porque PostgREST se llama con `curl` sin abrir el portal. Y el principio que
ordena todo: **contener sin frenar el trabajo diario** — ningún control nace
bloqueando, la marcha atrás es un `UPDATE` de una fila y nunca una migración, y lo
que no se puede probar sin gente esperando en la puerta se enciende primero en
modo aviso.

---

## 2. Estado en una pantalla

### Cerrado

| qué | cuándo / versión | dónde |
|---|---|---|
| Los permisos dejan de salir de `user_metadata` (lo escribe el navegador); la identidad sale de `auth.uid()` + `employee_auth_accounts` | v2.371.0 (2026-08-04) | `20260804170358`, `20260804170500` |
| Las edge functions de contraseña y baja autorizan contra la base, no contra el token (blindaje Fase 0) | 2026-08-24 · `set-employee-password` v35, `disable-employee-auth` v10 | `_shared/security.ts` |
| Sesiones: token de 15 min, rotación con detección de reuso, inactividad decidida por el servidor (hook), vista Conexiones | v2.527.0 → v2.532.0 (2026-08-09) | `docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md` |
| Bloquear a una persona corta el acceso de verdad, y cerrar todas sus sesiones es una acción (`revoke_person_sessions`) | v2.535.0 (2026-08-09) | `20260809164849`, `20260809151155` |
| `code` y `kiosk_pin` dejan de ser legibles con la sesión (privilegio por columna); quien administra Personal los pide por `get_employee_credenciales` | v2.625.0 (2026-08-16), reforzado en v2.781.3 | `20260816014507`, `20260826202621` |
| El escaneo de carné en Pedidos/Novedades se resuelve sin entregar el mapa (`identificar_por_carne`: sólo la propia sala, registra cada intento, corta a los 20 fallos) | v2.625.0 | `20260816014507` |
| El carné de papel del día: secreto propio, vale hasta medianoche, sólo lo imprime administración | v2.677.0 (2026-08-20) | `20260820153307`, `emitir-carne-temporal` |
| Interruptores `security_config` + `sec_exige`/`sec_avisa` + registro de egreso `export_log` (blindaje Fase 1) | v2.752.0 (2026-08-24) | `20260825033558`, `20260825034152` |
| Superficie de `anon` declarada y vigilada; diez funciones revocadas (hoy declaradas: 19 funciones + 1 tabla) | v2.751.0 (2026-08-25) | `auditoria/superficie-anon.json`, `npm run gate:auditoria` |
| Lectura masiva cerrada por cargo y por sala, costos por columna (blindaje Fase 2, hecha por otro plan) | v2.1034.0 → 2026-09-23 | `cerrar_lectura_tanda1..3` y siguientes |
| Techo de exportación **descartado**; en su lugar, aviso de toda descarga de más de 5,000 filas | v2.1114.0 (2026-10-01) | `20261001151451` |
| Nadie toca lo de otra sucursal cambiando un número; deuda en cero | v2.1159.0 → 2026-10-02 | `npm run gate:alcance` |
| El número de empleado ya no abre sesión; 26 cuentas `<número>@staff.local` bloqueadas | v2.1288.1 (2026-10-14) | `ensure_user_by_code` |
| Rango protegido (nadie le cambia la clave o bloquea a un cargo superior), cambio de clave obligatorio en `app_metadata`, IP real en el tope de intentos, 30 días de sesión sólo para teléfono/app según el servidor | v2.1290.1 (2026-10-14) | `20261014191057` |

### Abierto

| qué | estado |
|---|---|
| La contraseña de Auth de la cuenta del carné **sigue siendo el PIN**, y el PIN se deriva del número con una fórmula sin secreto | etapa 1 (pase de un solo uso) hecha y probada en pruebas — v2.1357.46; falta subirla y la etapa 2 — §3.1 |
| Login por token de un solo uso (B1) y rotación de contraseñas (C2) | no construido |
| Login por carné atado a terminal registrada; tope de intentos por código | no construido |
| PIN al azar / secreto propio del carné plástico (reimprimir) | postergado por decisión del usuario (v2.1288.1) |
| Carné sólo en su turno y en su sala (`OUT_OF_SHIFT` / `WRONG_BRANCH`) | nunca construido |
| Segundo humano en lo irreversible (3.1) | interruptor en `observar`, **ningún código lo consulta** |
| Dispositivo conocido (3.2) | interruptor en `observar`, **ningún código lo consulta** |
| Vigilancia continua (Fase 4) y `gate:seguridad` | sin rastro en el repo |
| 8 cuentas huérfanas en `auth.users`; la UI todavía lee `user_metadata` | dos decisiones pendientes |

---

## 3. Lo que falta, ordenado por riesgo

Una sola lista, deduplicada entre los tres planes. El orden es por **qué tan
fácil y qué tan grave** es lo que deja hacer hoy, no por esfuerzo.

### 3.1 · Que la contraseña de la cuenta del carné deje de ser el PIN

- **Qué.** `ensure_user_by_code` crea la cuenta `<pin>@staff.local` con
  `password: employee.kiosk_pin`, y el navegador completa el login con
  `signInWithPassword` usando ese mismo valor. Se reemplaza por un **token de un
  solo uso** (`admin.auth.admin.generateLink` → `verifyOtp({ token_hash })`) y,
  días después, se rotan las contraseñas de esas cuentas a un valor aleatorio.
  Es el B1 + C2 del plan del carné; su §5–§8 (latencia, riesgos, rollback,
  ventana) siguen siendo el procedimiento.
- **Por qué es lo primero.** v2.1288.1 cerró la puerta del **número**, pero dejó
  escrito su propio límite: el PIN sale del número por una fórmula sin secreto
  (trigger `derivar_kiosk_pin`, `20260903233831`), y la fórmula está escrita en
  la documentación del repo. Con el correo derivable y la contraseña igual al
  PIN, se puede ir **directo a GoTrue** y saltearse la función entera: su tope de
  intentos, su registro y cualquier regla futura (§3.2, §3.5) quedan del otro
  lado de una puerta que no se usa. Es tomar la cuenta de cualquiera conociendo
  su número de vendedor. **No agrega una defensa: hace posible defender**, porque
  deja una sola entrada y es la que controlamos.
- **Prerrequisitos.** En el entorno de pruebas: confirmar que la versión de
  `supabase-js` de la función devuelve `properties.hashed_token` y que
  `verifyOtp` abre sesión (si no, el diseño cambia); los dos caminos vivos a la
  vez; probar **el refresco de sesión y no sólo el login** —`procesarSesion` en
  `src/context/AuthContext.jsx` llama a `ensure_user_by_code` en cada
  restauración—; medir del escaneo al `completeLogin` con caché frío antes y
  después. Despliegue con `--no-verify-jwt` y verificar el valor vivo. La
  rotación (C2) va **días después**, con los registros mostrando que nadie entra
  por el camino viejo: después de C2 el rollback deja de ser simétrico.
- **Quién decide.** El usuario: la ventana (medida: **domingo 01:00–04:00 hora
  de El Salvador**, cero actividad en 45 días y sin crons de sincronización) y el
  momento de la rotación.
- **Evidencia.** `supabase/functions/ensure_user_by_code/index.ts` (bloque «Se
  encontró por PIN»: `email` y `password` salen ambos de `kiosk_pin`);
  CHANGELOG v2.1288.1 («Límite conocido…»); la prueba que cierra el hallazgo es
  un `signInWithPassword` con `<pin>@staff.local` que **falle**, hecho a
  propósito con una cuenta de prueba.

### 3.2 · El login por carné, sólo desde una terminal registrada

- **Qué.** `ensure_user_by_code` exige un `device_token` válido de
  `kiosk_devices` para aceptar un carné; tope de intentos **por código** además
  de por IP; registrar **todo** intento (exitoso o no) con su dispositivo. Es el
  B4 + B5.
- **Por qué.** Con §3.1 hecho, el PIN deja de ser una contraseña de Auth pero
  **sigue alcanzando para pedir sesión** por la puerta buena: si la función
  acepta el PIN pelado, el atacante pide por ahí. El freno de dispositivo reduce
  el ataque a *estar parado en la terminal de la sala con el número de otro*, que
  es el escenario físico que un carné supone de todos modos, y que ahora deja
  rastro. Hoy el tope es de 15 fallos por IP en 10 minutos y sólo cuenta
  `NOT_FOUND`/`INACTIVE`: quien ya tiene el PIN correcto no falla nunca.
- **Prerrequisitos.** §3.1; una terminal registrada **por sala** (medido el
  2026-08-24: 1 de 7 — remedir); decidir qué pasa con quien entra por carné
  desde el teléfono (hoy la app y la PWA lo usan). Encender en modo aviso
  primero, con la clave en `security_config`.
- **Quién decide.** El usuario, sala por sala: cuándo una sala tiene su
  terminal y se le puede exigir.
- **Evidencia.** `ensure_user_by_code/index.ts` (`isRateLimited`,
  `recordFailure`: sólo IP, sólo fallos); `kiosk_devices` y
  `verify_kiosk_device` ya probados en el kiosco de marcación
  (`20260816203652`).

### 3.3 · Que el carné plástico lleve su propio secreto

- **Qué.** El código de barras deja de codificar un valor derivado del número y
  pasa a llevar un token aleatorio, guardado **hasheado** en su propia tabla
  (RLS sin policies, grants revocados). Mientras dure la reimpresión se aceptan
  los dos formatos. Es la Fase 2 del plan del carné y el punto 1 del orden del
  plan de turno y sala.
- **Por qué.** §3.1 y §3.2 contienen; esto **quita la causa**: mientras el PIN
  se pueda calcular, cualquiera que esté en la terminal con el número de otro
  entra como ese otro.
- **Prerrequisitos.** Reimprimir los carnés (49 al 2026-08-12), por tandas. El
  modelo ya existe: el carné de papel del día (`emitir-carne-temporal`,
  `resolver_carne_temporal`) tiene secreto propio y la base sólo dice si lo
  reconoce. Las tres funciones de la base que leen un carné tienen que aceptar
  el formato nuevo a la vez.
- **Quién decide.** El usuario. **Decidió posponerlo** (v2.1288.1: «exige
  reimprimir carnés»).
- **Evidencia.** Trigger `derivar_kiosk_pin` (`20260903233831`, su
  `COMMENT ON FUNCTION` describe la derivación); CHANGELOG v2.1288.1.

### 3.4 · Segundo humano en lo irreversible

- **Qué.** Que escribir al ERP, transmitir a Hacienda, anular facturas, cambiar
  la contraseña de otro y exportar masivo pidan la confirmación de **cualquiera
  de N personas** con el permiso —nunca de una persona concreta, para que nadie
  espere a que alguien vuelva de almorzar—.
- **Por qué.** Es lo que limita el daño de una credencial robada que ya pasó
  todo lo anterior: una IA con una credencial hace una acción; no se convierte en
  dos personas.
- **Prerrequisitos.** Elegir la lista de acciones y, por cada una, quiénes son
  los N. La fila `segundo_humano` existe en `security_config` en `observar`,
  pero **ninguna función llama a `sec_exige('segundo_humano')`**: el interruptor
  está instalado y no está conectado a nada. v2.1290.1 ya cubre un caso vecino
  (nadie actúa sobre un cargo de rango superior).
- **Quién decide.** El usuario, acción por acción — agrega fricción a gente
  trabajando.
- **Evidencia.** `20260825033558` (las cuatro filas); búsqueda de
  `sec_exige`/`sec_avisa` en `supabase/migrations/`: sólo aparecen en la
  migración que las crea.

### 3.5 · El carné, sólo en su turno y en su sala

- **Qué.** `ensure_user_by_code`, cuando el match es por carné, evalúa turno +
  lugar y contesta `OUT_OF_SHIFT` o `WRONG_BRANCH` con un mensaje que diga qué
  pasó («Tu carné funciona sólo durante tu turno», «Este carné no es de esta
  sala»), y registra cada rechazo con quién, dónde y cuándo. Fuera de eso,
  usuario y contraseña.
- **Por qué está acá y no más arriba.** Convierte una credencial que sirve en
  cualquier lugar y hora en una que sirve *acá y ahora*, que es mucho contra un
  ex empleado o alguien de afuera. **Contra el atacante realista —un compañero de
  la misma sala en el mismo turno— agrega casi nada.** Es una capa encima de
  §3.1–§3.3, nunca en lugar de ellas.
- **Prerrequisitos** (medidos el 2026-08-11, ninguno remedido): contraseña
  propia para todos (entonces 17 de 50; 33 con temporal — sin esto la regla es un
  candado, no una restricción); horarios publicados todas las semanas (entonces 8
  de 50); §3.2 hecho (es el que dice *dónde* está quien escanea); y cuatro
  decisiones escritas:
  1. «De turno» = el horario publicado, con la marcación como **ampliación**
     (marcó entrada y no salida → está de turno), nunca exigir las dos.
  2. Tolerancias: las del motor de marcaje (`src/utils/timeClock.helpers.js`,
     30 min antes y 15 después), no unas nuevas.
  3. La sucursal **no existe en el turno** (`employee_rosters.schedule_data` no
     la guarda): agregarla (recomendado: deja cubrir en otra sala) o usar
     `employees.branch_id` (más barato, deja afuera a quien cubre).
  4. Excepciones con respuesta antes de encender: jefaturas que visitan salas,
     administración y Bodega sin turno de sala, días de inventario.

  La hora la pone el servidor; el turno que cruza la medianoche pertenece al día
  en que empezó (`src/utils/turnoDelDia.js` y `public.turno_del_dia` son el único
  sitio que resuelve un día de horario). Dos semanas en modo aviso antes de
  exigir, y el interruptor **por sala**.
- **Quién decide.** El usuario: la sucursal del turno y las excepciones.
- **Evidencia.** `docs/planes-cerrados/PLAN-CARNE-TURNO-Y-SALA.md` §3–§6; no hay
  `OUT_OF_SHIFT` ni `WRONG_BRANCH` en `src/` ni en `supabase/functions/`.

### 3.6 · Dispositivo conocido en el portal

- **Qué.** Entrar desde un equipo nunca visto anota en la bitácora y avisa a
  administración (`avisar` para todos); **exigir** sólo para los cargos de alto
  privilegio (superusuario, quien tenga `staff_list.can_edit`), con un camino de
  aprobación de un minuto.
- **Por qué.** La cuenta que puede hacer daño de verdad queda atada a un aparato
  sin dejar afuera a la dependiente que cambió de teléfono un sábado.
- **Prerrequisitos.** La fila `dispositivo_conocido` está en `observar` y, como
  §3.4, **nada la consulta**. Hay que decidir qué es «el mismo equipo»: la
  `device_class` la declara el cliente, y desde v2.1290.1 el servidor sólo le
  cree «app» a un user-agent de teléfono — sirve de ejemplo de lo que se puede
  y no se puede verificar.
- **Quién decide.** El usuario: qué cargos van a `exigir`.
- **Evidencia.** `20260825033558`; patrón del kiosco (`verify_kiosk_device` +
  `device_token`).

### 3.7 · Vigilancia continua y `gate:seguridad`

> ✅ **Hecho el 2026-10-28** (migración `20261029023934`). Decisión del usuario:
> los avisos van **sólo a Edwin Núñez** («solo a edwin. nadie mas»;
> `20261029025157`). Primero se pusieron a Gerente General y Jefe/a de TH; el
> usuario lo corrigió el mismo día. Como es el único destinatario, el aviso de
> cambio de control le llega **aunque el cambio lo haya hecho él** — si no,
> una sesión suya robada apagaría un control sin que nadie se enterara.
>
> - **Al momento**: el trigger `seguridad_aviso_cambio` sobre `security_config`
>   avisa cualquier alta, baja o cambio de estado (no de la nota), con quién lo
>   hizo — o «alguien sin sesión del portal» si fue por la base directa.
> - **Cada mañana a las 7:00 SV** (`seguridad-vigilancia-diaria` →
>   `vigilar_seguridad()`): cuenta de persona activa 60+ días sin entrar y
>   abierta; cuenta sin bloquear cuyo dueño no está activo o que no es de nadie;
>   entrada entre 22:00 y 05:00 SV en las últimas 24 h. Cada hallazgo se avisa
>   una vez (`avisos_emitidos`).
> - **`npm run gate:seguridad`**: policy de escritura con `true` que no sea sólo
>   de `service_role`; `user_metadata` en una policy o función de la base; una
>   edge function que autorice leyendo `user_metadata` (esto último también en
>   el pre-commit); y que el trigger y el cron sigan vivos.
>
> Quedó afuera, a propósito: «sesiones que leen tablas fuera de sus módulos» y
> «dispositivos nuevos en cuentas de alto privilegio». La primera no tiene
> fuente (no hay registro de lecturas por tabla); la segunda es §3.6, en espera
> por decisión del usuario. La entrada «fuera del horario» se mide contra la
> noche (22:00–05:00) y no contra el turno de cada quien, porque los horarios
> todavía no están cargados (ítem 14).
>
> Medido al aplicarlo: 2 personas activas sin entrar en 60 días, 0 cuentas
> sueltas abiertas (las 8 sin dueño están bloqueadas), 0 entradas de noche en
> 30 días.

- **Qué.** Un cron diario que **avisa, nunca bloquea**: cuentas activas sin uso
  en 60 días, sesiones que leen tablas fuera de sus módulos, dispositivos nuevos
  en cuentas de alto privilegio, actividad fuera del horario de la sala y —el que
  más importa— **cualquier cambio en `security_config`**: si alguien apaga un
  control, eso mismo es la alerta. Y un `npm run gate:seguridad` que falle ante
  una policy nueva con `USING (true)` para `authenticated` o una edge function
  que autorice leyendo `user_metadata`.
- **Por qué.** Lo que no verifica una máquina se rompe solo. Una parte ya la
  cubren otros: `gate:auditoria` (superficie `anon`), `gate:alcance` (sala), el
  aviso de descargas grandes y el criterio de salida del plan de autorización
  (una tabla nueva sin `auth_` en su policy «nació abierta»). Falta lo que mira
  **el comportamiento**, no el código.
- **Prerrequisitos.** Ninguno técnico. La regla 7 de `CLAUDE.md` (retención
  desde el día uno) si escribe en una tabla.
- **Quién decide.** Quién recibe los avisos.
- **Evidencia.** No existe `gate:seguridad` en `package.json`; ningún cron ni
  trigger lee `security_config` salvo el recordatorio del techo, ya apagado.

### 3.8 · Ciclo de vida del carné

- **Qué.** Revocar un carné perdido = una fila con `revoked_at`, no cambiarle el
  número al empleado (que arrastra planilla y deja cuentas huérfanas); una
  pantalla de credenciales activas (quién tiene carné, desde cuándo, revocar) y
  el evento en el expediente al emitir o revocar. Fase 3 del plan del carné.
- **Por qué.** Lo irreducible de una credencial de portación es que quien roba el
  carné entra; se controla con revocación rápida. Hoy la salida es bloquear a la
  persona entera (v2.535.0).
- **Prerrequisitos.** §3.3: sin secreto propio no hay nada que revocar aparte del
  número.
- **Quién decide.** El usuario, junto con §3.3.
- **Evidencia.** Plan del carné §10.

### 3.9 · Decisiones chicas que siguen abiertas

Ninguna es un agujero activo; las cuatro son «decidir y cerrar».

1. **Ocho cuentas huérfanas en `auth.users`** (6 `@staff.local` de pruebas de
   marzo/mayo y 2 `@farmalasa.app`, medido el 2026-08-05). No resuelven a ningún
   empleado y por eso no tienen permisos, pero pueden autenticarse. v2.1290.1
   cerró «7 cuentas sin ficha» con clave trivial: **remedir cuáles de las ocho
   siguen vivas** antes de decidir si se borran.
2. **La UI todavía lee `user_metadata`** para derivar el código con el que
   llama a `ensure_user_by_code` (`src/context/AuthContext.jsx`, en
   `procesarSesion` y en el login por usuario). Cosmético: la base y la función
   ya lo ignoran con sesión. Conviene que la pantalla se pinte con lo que
   devuelve la función.
3. **`lectura_masiva` es una fila muerta.** La Fase 2 se hizo con policies
   directas por cargo, sin el `OR NOT sec_exige(...)` que el blindaje proponía.
   Borrarla o anotarla como histórica, para que nadie crea que apagarla reabre
   algo.
4. **`inyecciones_pendientes`** quedó declarada `cruza-por-diseno` en
   `gate:alcance` y falta que el usuario lo confirme.

Y de la lista del blindaje, **MFA** sólo para roles de alto privilegio: nadie lo
pidió (0 factores en 86 usuarios al 2026-08-08). Queda como decisión de
producto, no como deuda.

---

## 4. Cómo está hoy

### 4.1 Entrar al portal

Tres puertas, y las tres terminan en una sesión de Supabase Auth:

| puerta | cuenta | qué la protege |
|---|---|---|
| Usuario y contraseña | la del portal, con `id = employees.id` | contraseña propia; cambio obligatorio decidido por `app_metadata` (v2.1290.1) |
| Carné plástico | `<pin>@staff.local`, ligada a la ficha en `employee_auth_accounts` | el PIN, que **es también su contraseña** (§3.1) |
| Carné de papel del día | `carne-<id de la ficha>@staff.local` | secreto propio, vale hasta medianoche, lo emite administración; la baja lo anula |

El flujo del carné: el lector manda el valor a `ensure_user_by_code` **sin
sesión**; la función busca **sólo por `kiosk_pin`** (desde v2.1288.1 el número a
secas contesta «no encontrado»), y si no, prueba el carné de papel; si la
persona no está `ACTIVO`, rechaza. Crea la cuenta si no existe, la liga en
`employee_auth_accounts` (idempotente) y devuelve el correo; el navegador hace
`signInWithPassword`. Con sesión, la función **ignora** el código del cuerpo y
resuelve por el token (v2.371.0).

El `kiosk_pin` lo mantiene el trigger `derivar_kiosk_pin`: nadie lo escribe a
mano, y la baja lo pone en `NULL` a propósito para que la persona no pueda
marcar. La lectura de `code` y `kiosk_pin` está **revocada** para
`authenticated` por privilegio de columna desde v2.625.0: la lista de columnas
legibles la declara la vista `employees_safe` (`regrant_employees_columns()`), y
quien administra Personal los pide por `get_employee_credenciales`, con
`staff_list.can_edit` y su alcance de sala. Ojo: esconder la columna **no vuelve
secreto el número** — es el código de vendedor, y el mapa vuelve por
`get_vendedores` detrás de `ventas.can_view`.

Tope de intentos: 15 fallos por IP cada 10 minutos (`login_rate_limit`), con la
IP que pone el borde de la red y no la que manda el cliente (v2.1290.1).

### 4.2 Sesiones

Token de acceso de 15 minutos, rotación con detección de reuso, inactividad de
30 días y techo de 90 en Supabase; el límite estricto por cargo (5 minutos en
sala, 12 horas en gestión, 30 días sólo teléfono/app) lo hace cumplir el hook de
emisión de token contra `session_activity`, y el hook firma su trabajo en el
token (`idle_limit_min`). Cerrar por inactividad cierra **ese** dispositivo, no
todos. Conexiones (módulo `sesiones`) muestra y cierra sesiones; cerrar una no
corta al instante —el token ya emitido vive hasta 15 minutos— y la pantalla lo
dice. Detalle: `docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md`.

### 4.3 Autorización en la base

- **Identidad:** `auth_employee_id()` resuelve por `auth.uid()` y, para las
  cuentas de carné, por `employee_auth_accounts` (sólo la escribe
  `service_role`). **`user_metadata` puede pintar la pantalla; nunca autoriza
  una escritura.**
- **Permiso:** `auth_has_module_permission` / `auth_can_edit_any` leen
  `role_permissions` y reconocen al superusuario por las dos vías (`system_role`
  y `roles.is_su`). En policies, siempre envueltas en `(SELECT …)`.
- **Lectura:** cada cargo lee sólo las tablas de sus pantallas, con recorte por
  sala donde la pantalla lo recorta; el costo vive por columna. Las 26 policies
  que no preguntan por `auth_` están enumeradas con su motivo en
  `docs/planes-cerrados/PLAN-CERRAR-AUTORIZACION-2026-08-09.md`: una nueva en esa
  consulta es una tabla que nació abierta.
- **Bloqueo:** policy `RESTRICTIVE` `bloqueo_global` en todas las tablas y el
  hook que rechaza bloqueados (v2.535.0).

### 4.4 Los interruptores: `security_config`

```
observar  →  avisar  →  exigir
```

Una fila por control; `sec_exige(key)` y `sec_avisa(key)` son `STABLE` para ir
en `(SELECT …)`. **Si la fila no existe, no exige**: un control mal escrito
nunca deja a nadie afuera por accidente. Instalar un control es una migración en
ventana; encenderlo o apagarlo es un `UPDATE` a cualquier hora — porque cambiar
una policy es DDL sobre tabla caliente, que es el outage del 2026-07-08.

| clave | estado | conectada a algo |
|---|---|---|
| `techo_exportacion` | `observar`, **decidida** (firmada el 2026-10-01) | no hace falta: la reemplazó el aviso de >5,000 filas |
| `segundo_humano` | `observar` | **no** — §3.4 |
| `dispositivo_conocido` | `observar` | **no** — §3.6 |
| `lectura_masiva` | `observar` | **no**, y no lo va a estar — §3.9.3 |

### 4.5 Lo que sale del portal

Toda exportación se anota por `registrar_egreso(modulo, formato, filas,
detalle)` —nunca con un `INSERT` del cliente, porque la ficha y la cuenta son
ids distintos para la mayoría de la gente— y `exportCsv` exige el módulo (sin él
el archivo baja igual, anotado como `sin-declarar`). Toda descarga de más de
5,000 filas avisa a quien edita `sesiones` (trigger
`export_log_avisar_descarga_grande`). Límite: sólo ve lo que pasa por los botones;
una lectura directa a la API con una sesión válida la acota el RLS de §4.3, no
este registro. Frente: `src/data/egreso.js`.

### 4.6 Alcance por sucursal

Las edge functions usan la llave del servidor y las `SECURITY DEFINER` saltan el
RLS: el único freno por sala está en su código. `scripts/alcance-manifest.json`
declara cada una con su guarda (`alcance`, `modulo-de-red`, `sin-sala`, `cron`,
`publica`, `solo-servidor`, `cruza-por-diseno`); `npm run gate:alcance` falla
ante una sin declarar, una `alcance` que perdió su chequeo, un cron sin secreto,
**un módulo de red que se le da a un cargo de sala**, o un bucket privado que lee
cualquiera con sesión. La deuda (`scripts/alcance-baseline.json`) está en
**cero** y sólo baja. Declarar `alcance` es una afirmación sobre **cada** acción
de la función. Detalle: `docs/planes-cerrados/PLAN-ALCANCE-POR-SUCURSAL-2026-10-02.md`.

### 4.7 Lo que alcanza `anon`

No vive en prosa: vive en `auditoria/superficie-anon.json` —hoy 19 funciones y
1 tabla (`branches`, para que el kiosco ofrezca las salas antes de iniciar
sesión)—, cada una con su guarda y su motivo: el kiosco por `device_token`, la
impresora por dispositivo + token o código de un solo uso, la captura de fotos y
las encuestas públicas por el secreto de su QR. `npm run gate:auditoria` falla si
producción expone algo que no está declarado. Al agregar algo para `anon` se
declara ahí; si no tiene motivo, se le revoca el `EXECUTE`. Al cambiarle la firma
a una función, la sobrecarga vieja se queda con sus permisos: revisar las dos.

---

## 5. Qué NO se va a hacer, y por qué

| descartado | motivo |
|---|---|
| Bloquear por «puntaje de anomalía» | falsos positivos sobre gente trabajando; el costo cae en quien atiende al cliente |
| Límite duro de filas en PostgREST | el propio portal pagina 20,000+ filas con `fetchAllRows` como comportamiento normal: se apagaría solo |
| Techo de exportación con confirmación | decidido el 2026-10-01 con un mes de línea base (78 descargas, la mayor de 3,972 filas): quien se lleva los datos aprieta «sí», y lo útil —que quede anotado— ya lo hace `export_log` |
| MFA en cada ingreso | 7 sucursales, turnos rotativos, teléfonos compartidos. Si alguna vez, sólo para alto privilegio |
| Lista blanca de IPs | hay trabajo desde casa y por datos móviles; deja gente afuera sin avisar. Por lo mismo, la sala de un carné se sabe por **dispositivo registrado**, no por IP |
| Detectar «si es una IA» | presenta el mismo token que la persona; no hay señal fiable, y creer que la hay es peor que no tenerla |
| CAPTCHA | un agente moderno lo resuelve; sólo molesta a la persona |
| Seguir escondiendo el número en la UI | aparece con razón en expedientes, solicitudes y facturas; esconderlo rompe pantallas y no cierra nada mientras el número (o lo que se deriva de él) sea una contraseña |
| Cerrar los catálogos compartidos (`branches`, `roles`, `presentaciones`, `laboratorios`…) | los necesita medio portal para pintar un selector y no son sensibles: puro costo |

Y un canal que **ninguno** de estos controles cubre, dicho para que no se
olvide: el trabajo con IA sobre la base va por MCP con `service_role`, fuera de
RLS. Su protección es que la llave vive en una sola máquina.

---

## 6. Fuentes

- `docs/planes-cerrados/PLAN-CREDENCIAL-DE-CARNE-2026-08-12.md` — el hallazgo «el código es la contraseña», la Fase 1 en bloques A/B/C, la ventana del domingo y el rollback.
- `docs/planes-cerrados/PLAN-CARNE-TURNO-Y-SALA.md` — la regla de turno y sala, sus ocho decisiones y por qué no protege contra el compañero de turno.
- `docs/planes-cerrados/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md` — modelo de amenaza, `observar → avisar → exigir`, Fases 0 y 1 con sus pruebas, y lo descartado.
- `docs/planes-cerrados/SEGURIDAD-AUTORIZACION-2026-08-04.md` — el fin de `user_metadata` como autoridad, el barrido de RPC por identidad y las cuentas huérfanas.
- `docs/planes-cerrados/PLAN-CERRAR-AUTORIZACION-2026-08-09.md` — de 83 policies sin `auth_` a 26 enumeradas; las reglas 1–6 de la lectura por cargo y sala.
- `docs/planes-cerrados/PLAN-ALCANCE-POR-SUCURSAL-2026-10-02.md` — el patrón «otra sala cambiando un número», sus cuatro fases y `gate:alcance`.
- `docs/planes-cerrados/PLAN-SESIONES-SEGURAS-2026-08-08.md` — CSP, vida del token, hook de inactividad y Conexiones.
- `docs/planes-cerrados/AUDITORIA-SUPABASE-2026-07-29.md` — §S1-bis (el carné sin secreto) y §S1-ter (la autorización de excepciones de planilla, hoy del lado del servidor).
- `CLAUDE.md` — `security_config`, `gate:alcance` y la regla 4 (superficie de `anon`).
