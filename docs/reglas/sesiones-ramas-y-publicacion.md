# Sesiones concurrentes, ramas, publicación y auditoría

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda cada regla en forma corta; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## REGLA CRÍTICA: hay OTRAS sesiones trabajando en este mismo árbol

No es hipotético ni excepcional. Medido el 2026-07-29 en una sola sesión: el
`git status` pasó de 2 a 8 archivos modificados en 40 minutos sin que esta sesión
tocara ninguno de los 6 nuevos, y otra sesión commiteó **y pusheó** v2.234.0 en el
medio. El árbol de trabajo es compartido y no avisa.

**Antes de editar un archivo que no tocaste en esta sesión**: `git status --short`.
Si aparece modificado y el cambio no es tuyo, es de otra sesión — leerlo antes de
escribirlo. Un `Write` encima de cambios ajenos los borra sin dejar rastro: no
están en ningún commit del que recuperarlos.

**Prohibido barrer el árbol.** Nunca `git add -A` / `git add .` / `git commit -a` /
`git stash` / `git checkout .` / `git restore .` / `git reset --hard`: todos se
llevan trabajo ajeno sin commitear. Siempre paths explícitos, y **verificar
`git status` después del `add`** — un pathspec que falla aborta TODO el add.

**Commitear lo propio en cuanto compila**, con paths explícitos. Es la única
protección real: lo commiteado se recupera, lo demás no. Y `git fetch` antes de
pushear — el remoto puede haberse movido.

**El `main` de este árbol se queda atrás solo, y commitear encima lo empeora**
(2026-10-21). Llevaba seis días sin avanzar: **118 commits atrás y 8 adelante,
los 8 copias**. `git pull` se niega con el árbol sucio —siempre lo está— y
`stash`/`reset --hard` están prohibidos, así que nadie lo ponía al día; cada
sesión commiteaba sobre código viejo, el push rebotaba y repetía el commit
desde un worktree con otro número. Tres piezas lo cierran:
- **`npm run main:al-dia`** (`-- --aplicar` para hacerlo) lo pone al día sin
  perder nada: se niega si un commit local no tiene gemelo arriba o si un
  archivo sucio tiene una línea que no está en ningún commit de arriba,
  respalda todo en `.git/respaldos-main/`, y usa `reset --keep`.
- **El pre-commit bloquea un commit en `main` si está atrás de
  `origin/main`** (sin red: contra el último fetch).
- **`npm run worktree` nace de `origin/main`**, no del HEAD local.

**Al bumpear `APP_VERSION`: `npm run version:bump -- patch|minor|major "Título"`.**
Lee la versión, la sube y deja la entrada empezada en `CHANGELOG.md` de una
sola pasada, y **relee justo antes de escribir** por si otra sesión se llevó ese
número en el medio (pasó tres veces en una sola sesión el 2026-08-01). Nunca
asumir "el anterior + 1", y nunca editar `src/version.js` a mano.

**La entrada del changelog va en `CHANGELOG.md`, NUNCA en `src/version.js`.**
Ese archivo tiene la constante y nada más. La regla vieja —"las últimas 6
entradas en `version.js`"— se rompió sola: nada la verificaba, así que 164 de
268 entradas nunca llegaron a `CHANGELOG.md` y el archivo volvió a 7,330 líneas
en tres semanas. Pero el motivo de fondo no es el peso: con varias sesiones,
todas escribían el mismo bloque al tope del mismo archivo y colisionaban
siempre. Hoy `version-gate` exige las tres cosas — que `version.js` no tenga
entradas, que la versión suba, y que `## v<versión>` exista en `CHANGELOG.md`
**y esté preparado en el mismo commit**.

**Para trabajo largo o riesgoso, un árbol propio**: `npm run worktree -- <nombre>`
crea el worktree en `../Portal-Farmalasa-<nombre>` sobre la rama
`sesion/<nombre>`, con `node_modules` enlazado y `.env` copiado. Deja de
compartir archivos, índice y `dist/`. El costo es que hay que mergear a `main`
en vez de pushear directo, así que para un arreglo corto no vale la pena.

**Y al terminar, el worktree se borra** (2026-10-21): había 22 hermanos y 8 de
agentes en `.claude/worktrees/` (~2.4 GB, rompían `lint` y `test`). Hoy
`npm run limpiar:worktrees` hace el inventario y `-- --borrar` quita los que no
tienen cambios sin commitear, ni commits fuera de `origin/main` (por contenido,
`git cherry`), ni uso en 3 días, ni un proceso adentro. Corre solo en el
`prebuild` y al crear uno nuevo. **Un worktree con trabajo sin commitear nunca
se borra solo**: se commitea o se descarta a propósito.

**El preview de QA es uno solo.** Las edge functions solo aceptan CORS de
`http://localhost:4173`, así que **una sesión a la vez** puede tenerlo
levantado; `npm run preview` lleva `--strictPort` para que un puerto ocupado
falle claro en vez de moverse solo y producir un "error de CORS" que parece otra
cosa. Para compilar sin pisar el `dist/` de otra sesión: `OUT_DIR=dist-<nombre>
npm run build`.

**Y esas carpetas se limpian solas.** Una por sesión y nada las borraba: el
2026-08-23 había **45 carpetas y 1.5 GB**, la más vieja del 1 de agosto. Hoy el
`prebuild` corre `limpiar-dist.mjs --auto`, que borra las `dist-*` sin tocar
hace 3+ días. Nunca toca `dist`/`dist-staging`, ni el `OUT_DIR` en curso, ni una
que nombre un proceso vivo — borrarle el `dist/` a una sesión que está haciendo
QA le deja la pantalla en 404 sin explicación. La edad sale del **contenido** y
no del directorio: `vite build` reescribe adentro y el mtime del padre queda
viejo. A mano: `npm run limpiar:dist` lista, `-- --borrar` borra.

**El hook de pre-commit** (`.githooks/pre-commit`, se habilita una vez por clon con
`npm run hooks:install`) cubre el caso mecánico: **bloquea el commit si un archivo
está preparado y además modificado después de prepararlo** — señal de que alguien
lo siguió editando y el commit se llevaría una foto parcial. Además lista lo que
queda fuera del commit, corre `version-gate` siempre y `migration-gate` cuando el
commit toca `supabase/migrations`. `git commit --no-verify` lo saltea: es para una
emergencia real, no para silenciar un hallazgo.

## REGLA: pushear a `main` NO publica el portal — `npm run publicar` (2026-10-06)

Cada commit a `main` desplegaba portal.farmasalud.lat entero en Vercel: el
2026-10-06 fueron 24 despliegues, ~20 de cambios que ni tocaban la web (apps,
funciones de Supabase), y el ciclo llegó a **$22.92 de minutos de compilación**
con cargos extra. Decisión del usuario: se publica a propósito.

- Producción es la rama **`produccion`**. Se mueve con **`npm run publicar`**
  (`scripts/publicar.mjs`): la adelanta a `origin/main` sólo si hay cambios de
  la web, y no toca el árbol de trabajo. `-- --ver` dice qué saldría.
- **Publicar cuando el cambio de la web tenga que verse** (un arreglo para
  sala, una pantalla terminada), no después de cada commit. Varios commits de
  la web se juntan en un solo despliegue.
- Lo que no es web (`apps/`, `supabase/`, `scripts/`, `docs/`, `auditoria/`,
  `CHANGELOG.md`, `src/version.js`) no se despliega nunca por Vercel: las
  funciones van por `supabase functions deploy` y las apps por `subir-ios`.
- La regla vive en `scripts/vercel-ignorar.sh` (el `ignoreCommand` de
  `vercel.json` no admite más de 256 caracteres — un despliegue falló por eso).

## REGLA CRÍTICA: lo que ya se auditó no se toca sin preguntar (2026-08-23)

El portal está repartido en **25 áreas** (`auditoria/areas.mjs`) y cada una lleva
un % sobre **12 ejes**. Un área que llega a 100 y tiene su sello de sala queda
**CONGELADA**: `npm run gate:auditoria --hook` corre en el pre-commit y **falla**
si el commit la toca.

**Antes de tocar un área congelada: preguntarle al usuario.** No es una
formalidad del gate — es literalmente lo que pidió. Después:

```bash
npm run auditoria:desbloquear -- <area> "por qué se toca"
# … el trabajo …
npm run auditoria:sellar -- <area> "qué se corrió para verificarlo"
```

Mientras el desbloqueo esté abierto, `npm run gate:auditoria` (sin `--hook`)
**falla**. Ésa es la mitad «verificación después»: el commit puntual pasa, el
trabajo no se cierra. Son dos chequeos y no uno a propósito — uno que bloquea
cada commit del trabajo en curso enseña a escribir `--no-verify`, y uno que sólo
avisa se olvida el día que hay prisa.

**El % no se escribe a mano.** Sale de `auditoria/puntuar.mjs`, que tiene las
reglas del cálculo adentro. El gate rechaza un `pct` que no derive de los ejes,
y rechaza un eje en 90 o más **sin evidencia escrita** — un puntaje sin
evidencia es una opinión, y una opinión se hereda de la sesión anterior sin que
nadie pueda volver a mirarla.

**El sello de sala es un TOPE, no un sumando.** Doce ejes en verde topan en 95;
el 100 lo desbloquea una corrida real con datos de producción. Si fuera un
sumando, un área podría compensar la falta de prueba real con puntaje de otro
lado — que es exactamente la confusión entre «construido» y «funciona». Hoy hay
catorce ítems en memoria que dicen «falta probarlo en sala».

**Un archivo, tabla, función o cron sin área hace fallar el gate.** No es
contabilidad: lo que no está mapeado no entra en ningún porcentaje, y el día que
alguien agregue una vista sin mapearla el portal diría «88% auditado» sobre un
denominador viejo. Al crear una vista o una tabla, agregarla a `areas.mjs`.

El informe completo —los 221 hallazgos, qué está bien, y las tres veces que el
instrumento mintió antes de acertar— en `docs/AUDITORIA-PORTAL-2026-08-23.md`.
