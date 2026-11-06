# El entorno de pruebas: historia y mediciones

> **Lo vigente, antes de leer la historia** (2026-11-06):
> - El branch **se mantiene solo** (`.github/workflows/entorno-pruebas.yml`, todos los días a las 04:30 SV): hace `push` de lo que falta y, si el push falla, lo rehace. Los párrafos de abajo que dicen «ponerlo al día = rehacerlo a mano, no conviene automatizar» son de ANTES del 2026-09-23.
> - El ref del branch **no se copia a ningún documento**: el vigente sale de `VITE_SUPABASE_URL` en `.env.staging` o de `supabase branches list`. Todo ref escrito abajo (incluido el que se da por «vigente») ya es viejo.
> - Las migraciones de semilla son **cuatro** (la tabla de abajo lo dice; el texto que dice «tres» es anterior a la cuarta).
> - El «push» del workflow **no es `supabase db push`**: es la API de administración (`POST /branches/{id}/push`), que no necesita conexión directa a la base y por eso anda desde GitHub Actions. Lo que no llega desde esta Mac (sin IPv6) es la conexión DIRECTA: `psql`, `supabase db push`, `db dump`.
>
> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda cómo se usa hoy, en «Entorno de pruebas»; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

**Probar primero en staging.** Existe un branch de Supabase dedicado para esto:
**`jffhpyutjltvozoyllpj`** (nombre `staging`, persistente, rehecho solo el 2026-09-26). Para DDL sobre las
tablas calientes listadas arriba, probarlo ahí primero, confirmar que no rompe
nada, y sólo entonces aplicar a prod. Ya se usó así para 0B.8 (RPC
`verify_kiosk_device`) y 0B.2 (secretos de Vault en `cron.job.command`) — ambos
sin incidentes.

🔴 **En el branch se prueba con `execute_sql`, NUNCA con `apply_migration`.** Los
dos ejecutan el mismo SQL; la diferencia es que `apply_migration` además escribe
una fila en el `schema_migrations` del branch — y esa fila producción **nunca la
va a tener con ese número**, porque al aplicarla de verdad `apply_migration`
genera una versión nueva.

Con nueve de esas filas huérfanas (medido el 2026-08-24) la historia del branch
deja de ser un prefijo de la de prod y **`rebase_branch` queda muerto para
siempre**: falla con `MIGRATIONS_FAILED` y no dice por qué. Fue exactamente lo
que pasó — 130 migraciones de atraso que sólo se pudieron cerrar rehaciendo el
branch entero.

O sea: **la herramienta que mantiene el branch al día se rompe por usar mal la
herramienta que lo mantiene útil.** `execute_sql` prueba igual de bien y no deja
rastro; si la prueba ensucia el esquema, se limpia a mano o se rehace el branch,
que es barato cuando no hay que rescatar nada.

⚠️ **El ref cambia cada vez que se rehace el branch.** Ya van cinco: el de julio
(`ewcmerxqjvludtgskuin`), el de agosto (`cbnjplmnfmfsambavjce`), el del 24-ago
(`qvctarsqvlhbzgvwbbbt`) y el del 23-sep (`wqmsadndftaudblohgws`) están borrados —
si encontrás alguno de esos en un doc, es viejo. El vigente sale de
`supabase branches list` o del `VITE_SUPABASE_URL` de `.env.staging`. Trae datos
de muestra, cero PII.

✅ **Desde el 2026-09-23 se mantiene solo.** `.github/workflows/entorno-pruebas.yml`
corre `scripts/entorno-pruebas/mantener_al_dia.mjs` todos los días a las 04:30 SV:
compara la lista de migraciones, hace `push` si le faltan, y si el push falla lo
**rehace** (quita «permanente», lo borra y lo crea de nuevo). Después apaga los
crons que llaman a producción, corre las fechas a hoy y los permisos de la cuenta
de pruebas. Necesita el secreto `SUPABASE_ACCESS_TOKEN` en GitHub. Si lo rehizo,
el ref cambió: `npm run pruebas:env` reescribe `.env.staging`, y **el script
apunta solo las variables Preview de Vercel al ref nuevo y recompila
`dev.farmasalud.lat`** (secretos `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
`VERCEL_TEAM_ID`). Sin eso dev queda contra un branch borrado: pasó el
2026-09-26 —el push falló en la migración 12 de 47, se rehízo, y la corrida dio
VERDE con dev roto—. Hoy, sin `VERCEL_TOKEN` la corrida sale en ROJO. A mano:
«Run workflow» con `solo_vercel`.

Tres cosas medidas ese día que explican el diseño:
1. **`reset` no sirve**: reconstruye con la historia PROPIA del branch (quedó en
   546 de 1,001) y deja vivos los objetos creados a mano.
2. **Probar con `execute_sql` también ensucia**: deja tablas y policies que la
   migración real después quiere crear («policy … already exists»). El branch se
   ensucia por usarlo bien; la limpieza completa es rehacerlo, y es barato.
3. **El registro de producción no se podía reproducir**: siete migraciones
   borraban o cambiaban crons que en producción se habían creado a mano
   (`cron.unschedule('x')` lanza si `x` no existe). Un branch nuevo moría en la
   332. Se les agregó «sólo si existe» en `supabase_migrations.schema_migrations`
   (con OK del usuario) y en los archivos locales. **Toda migración nueva que
   toque un cron lleva esa guarda** — `WHERE EXISTS (SELECT 1 FROM cron.job WHERE
   jobname = 'x')` — o rompe el próximo branch.

⚠️ **Antes de eso, su esquema NO se mantenía solo al día, y creer que sí ya costó
una tanda de mediciones.** Acá decía «idéntico al de prod, verificado por huella md5 de
tablas, funciones, policies e índices». Era cierto en julio, el día que se
verificó, y nada lo volvió a mirar. Medido el 2026-08-24:

| | pruebas | producción |
|---|---:|---:|
| migraciones | 413 | **543** |
| tablas | 172 | 181 |
| funciones | 497 | 554 |

**130 migraciones de atraso**, y el modo de falla no es un error claro: es en
pedazos. `/inventario` mostraba «Error al cargar inventario» porque una vista
materializada del branch nunca se pobló; el tema del teléfono pedía
`user_dashboard_prefs.mobile_theme`, que existe en prod y todavía no ahí. Las dos
se leían como defectos del portal y ninguna lo era.

**Antes de creerle a una medición hecha contra el branch, comparar** —
`node scripts/entorno-pruebas/comparar_con_produccion.mjs` dice cómo y qué
significa una diferencia.

⚠️ **Y el `rebase` NO lo va a arreglar, por culpa de este mismo flujo de
trabajo.** Probar el DDL en el branch antes que en prod —que es lo que esta
sección manda hacer, y con razón— deja en su `schema_migrations` filas que
producción nunca tuvo con ese número: al reaplicar en prod, `apply_migration`
genera una versión nueva. Medido el 2026-08-24: **nueve migraciones existen sólo
en el branch** (ocho del 12-ago y una del 14). Con eso su historia deja de ser un
prefijo de la de prod, y `rebase_branch` falla con `MIGRATIONS_FAILED` sin decir
por qué — se probó dos veces y avanzó 8 de 130.

O sea que la deriva **no es un descuido**: es la consecuencia esperable de usar
el branch para lo que existe. Lo que faltaba era saberlo.

**Ponerlo al día = rehacerlo.** Borrar y crear de nuevo: sale con el esquema
completo y sembrado por las tres migraciones de semilla. El costo es real y hay
que tenerlo presente: se pierde la corrida de fechas (se vuelve a correr con
`correr_fechas.sql`), se pierden los permisos de la cuenta de pruebas (ídem con
`permisos_de_la_cuenta_de_pruebas.sql`) y **cambia el ref**, así que hay que
rehacer `.env.staging`. Es una decisión de quien esté trabajando, no algo que
convenga automatizar.

**Cómo levantar el portal contra ese entorno** (ver §«Entorno de pruebas» al
final de este archivo): `npm run dev:staging`.
---

## Entorno de pruebas — probar sin miedo a producción (2026-08-12)

**Por defecto, `npm run dev` y `npm run preview` hablan con PRODUCCIÓN.** El
`.env` del repo apunta al proyecto real, así que cualquier clic en el navegador
local escribe en la base de la que vive la empresa. Eso no cambió: lo que se
agregó es un segundo camino.

```bash
npm run dev:staging      # el portal contra el branch de pruebas
npm run build:staging    # compilar apuntando ahí (sale a dist-staging/)
```

Usuario **`pruebas`**, contraseña **`pruebas2026`** (rol Gerente General). El
portal pinta un marco y una píldora «ENTORNO DE PRUEBAS» — **derivados de la URL
de Supabase**, no de una bandera aparte: una bandera se olvida al armar un
`.env` nuevo, y olvidarla significa creerse en pruebas mientras se escribe en
producción. El aviso vive fuera de `<Routes>` para aparecer también en el login,
antes de que alguien escriba una credencial. Lógica en `src/entorno.js`.

**`.env.staging` está en `.gitignore`** (patrón `.env.*`), así que en un clon
nuevo hay que crearlo: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` del branch
—panel de Supabase, o `supabase branches list`— más `VITE_VAPID_PUBLIC_KEY` y
`VITE_GOOGLE_MAPS_API_KEY` copiadas del `.env`.

### El branch se construye solo

Para uno limpio: borrarlo y crearlo de nuevo. Sale con el esquema completo,
sembrado y con la cuenta puesta. Lo hacen tres migraciones, **las tres no-op en
producción** (verificado ejecutándolas contra prod y comparando conteos):

| migración | qué siembra | por qué en esa posición |
|---|---|---|
| `20260729223031` | `roles`, `branches`, `role_permissions` | 25 migraciones insertan permisos con `role_id` fijos; sin las filas, la FK corta el replay |
| `20260729223032` | los 9 buckets de Storage y sus policies | se crearon desde el panel, no por migración: un `ALTER POLICY` no encontraba qué alterar |
| `20260812160000` | 300 productos con existencias, precios, MIN·MAX + la cuenta de pruebas | va al final: nada depende de productos, y ahí las tablas ya tienen su forma definitiva |
| `20260903185033` | apaga los crons que llaman por HTTP | va **después de todos**: apaga lo que las migraciones anteriores crearon |

**La cuenta de pruebas sólo nace si la base no tiene ni un empleado.** Es lo
único que separa «sembrar un branch» de «abrir un Gerente General en la base
real». No quitar esa guarda.

**Los crons del branch le disparaban a PRODUCCIÓN, y volvían solos cada vez que
se rehacía.** La URL del proyecto real está escrita dentro de la migración que
crea cada cron, así que el replay levanta 13 apuntando allá con la llave del
branch. Producción los rechaza —el vault del branch está vacío, o sea que el
`'Bearer ' || secreto` viaja en NULL— pero medido el 2026-09-03 eran **1,258
llamadas con 401 en un día** sólo de `cortes-caja-30s`, más 111 de
`drain-cliente-erp-queue`: ~1,400 peticiones basura diarias que entierran en el
registro justo la señal que `gate:eficiencia` busca, porque un 401 legítimo —un
redeploy sin `--no-verify-jwt`— se lee igual que estos mil. Los delató el
`user_agent`: prod corre `pg_net/0.20.0` y el que fallaba llegaba con
`pg_net/0.20.4`, la versión del branch.

La semilla los apaga sola, y **la guarda es la ausencia de la llave misma** —no
una bandera de entorno, que se olvida—: sin `admin_invoke_secret` en el vault
esos crons no pueden servir para nada ahí. Pide además que la base tenga ≤2
fichas de empleado (prod tiene 48), porque apagarle los crons a producción por
error la deja sin sincronizar y nadie se entera hasta que falta un dato. Los 17
crons que trabajan contra su propia base no se tocan.

**Al sembrar temprano, la tabla tiene la forma de ESE punto de la historia, no
la de hoy.** Sembrar `role_permissions` con `scope='MINE'` abortó el replay
entero: ese valor lo acepta un CHECK de agosto. Por eso las semillas que nadie
necesita van al final.

### Las edge functions NO están desplegadas ahí, a propósito

Cinco (`sync-dte-sales`, `regularizar-dte`, `push-cliente-erp`,
`sincronizar-fichas-clientes`, `aplicar-solicitud-facturacion`) escriben en el
ERP real y transmiten a Hacienda. Con credenciales de producción convertirían el
entorno seguro en uno capaz de tocar el sistema real. El login por usuario **no
las necesita** (verificado). Si hace falta probar una sin efectos externos, se
despliega esa sola.

### A los branches sólo se llega por el MCP

Sus bases son **solo IPv6 y sin entrada en el pooler**, y esta máquina no tiene
IPv6: ni `psql`, ni `supabase db push`, ni `db dump` llegan. El único canal es
`execute_sql`/`apply_migration`. Para mover SQL grande sin gastarlo en contexto:
generarlo en prod y escribirlo a disco con
`supabase db query --linked -o json | node -e '...' > archivo`, meterlo en
`schema_migrations` con SQL server-side, y **crear el branch de nuevo** — lo
replica solo. Detalle en la memoria `reference_branches_de_supabase_son_solo_ipv6`.