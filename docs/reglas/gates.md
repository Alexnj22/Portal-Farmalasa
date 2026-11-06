# Los gates y las reglas de estándares: por qué existe cada uno

> **Lo vigente** (2026-11-06): los baselines son trinquetes y su número vive en el archivo, no acá — `scripts/design-gate-baseline.json` ya no está vacío (lo que diga abajo «47 categorías en cero» es de agosto) y `scripts/nucleo-baseline.json` ya llegó a cero (lo de «359 usos en 64 archivos» es la deuda inicial). La impresión desde una pantalla va por `imprimirDiferido.js`, ver CLAUDE.md.
>
> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la tabla única de gates y cada regla en una a tres líneas, en «Estándares del proyecto»; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## Estándares del proyecto
- Ver `DESIGN.md` para patrones de UI (glassmorphism, filter pills, tabs, search)
- Siempre usar `LiquidSelect` en lugar de `<select>` nativo
  - **El placeholder NUNCA va como opción** (2026-10-08). `{ value: '', label: '¿De qué sucursal?' }`
    al tope de `options` es el rótulo del campo copiado en la lista, y salía
    como si se pudiera elegir. El rótulo va en `placeholder`; para volver a
    vacío está `clearable` (o la fila «Todos»). `LiquidSelect` ya descarta la
    opción vacía cuyo texto es IGUAL al `placeholder` y, si el select no es
    `clearable` (los filtros), pone la fila de vuelta. Una opción vacía con
    texto PROPIO («Todas», «Consumidor Final») sí es una elección y se queda.
  - **Un sólido es sólido**: un `Badge tone="solid"` o una pastilla con
    `text-white` no lleva fondo con `/NN` ni borde `transparent` — el anillo
    transparente dejaba ver el borde del campo de atrás y el «-1» de
    recepción se leía translúcido. Y si va montado sobre un campo, lleva
    `z-tabs`: `PortalInput` es `relative z-base`, así que sin eso el borde y
    el relleno del campo se pintan ENCIMA del contador y parece vidrio aunque
    el color sea opaco. Verificar con lupa, no con `getComputedStyle`.
- Badges `es_antibiotico=true` → "Bajo Receta" (NUNCA "Abx")
- Toda acción de usuario → `appendAuditLog` (staffStore → `audit_logs`)
- **Impresión en ticketera: `await imprimirDocumento(ticket)` de
  `src/utils/ticketPrint.js`**, y nada más — intenta el envío sin diálogo y cae al
  diálogo del navegador si esta computadora no lo tiene. **No elegir el camino a
  mano ni escribir un segundo maquetador.** El ancho del rollo NO se pasa: es un
  ajuste de la computadora (`leerAjustesDeImpresion`), porque la ticketera está
  enchufada a un equipo concreto. `ok: true` significa *recibido*, nunca *salió
  papel*: la respuesta del programa de la caja es opaca y no se puede prometer en
  pantalla lo que no se sabe. Cuatro cosas que se rompen solas: **sólo ASCII** (el
  rollo no lee UTF-8 — «NUÑEZ» salió `NUÆEZ`), **54 columnas** en letra chica y 40
  en normal, **alinear rellenando y nunca con `ESC a`** (sus códigos no mandan en
  esa impresora), y **el papel no tiene tema** — sólo negro, sin fondos rellenos,
  sin tokens ni `rounded-*`. La receta completa, campo por campo, en la §5 de
  `docs/IMPRESION-EN-TICKETERA-2026-08-13.md`; la geometría está anclada en
  `tests/unit/ticketPrint.test.js` contra un ticket real. Prueba de papel en
  Sistema → Prueba de impresión.
- Bumpar la versión en cada commit con `npm run version:bump` (la entrada del
  changelog va en `CHANGELOG.md`, nunca en `src/version.js`)
- **Un formulario largo se guarda solo: `npm run gate:borradores`.** El portal
  cierra la sesión sola cuando nadie usa la pantalla, y desde v2.647.0 ese plazo
  se configura por cargo (los de sala están en 5 minutos). Un formulario vive en
  memoria: cuando la sesión se cierra se pierde todo lo escrito y no queda
  rastro. El aviso «¿Sigues ahí?» evita la SORPRESA, no la PÉRDIDA — nadie
  vuelve a tiempo si se fue diez minutos. A partir de **6 controles de captura**,
  el archivo guarda borrador con `saveDraft`/`loadDraft` de
  `src/utils/draftUtils.js`, o va a `EXCEPCIONES` de `scripts/draft-gate.mjs`
  **con su motivo escrito** (el único que hay hoy: el conteo cíclico, que guarda
  renglón por renglón). El baseline es la deuda del día que se escribió el gate
  y **sólo baja**: no se regenera para tapar un hallazgo nuevo.
- **La pestaña activa de una vista vive en la DIRECCIÓN, nunca en `useState`.**
  El hook canónico es `usePestanaEnUrl` (`src/plataforma/usePestanaEnUrl.js`) y vale
  también para las vistas nuevas. Una pestaña en memoria se pierde con cualquier
  recarga: F5 —o volver por el historial, o abrir el enlace que alguien pasó—
  devuelve a la primera sin decir nada, y como no falla nada nadie lo reporta
  como bug sino como «la pantalla se movió sola». Medido el 2026-08-20: de las
  29 vistas con pestañas, **9 lo hacían bien y 20 no**. Lo vigila la categoría
  `pestana-fuera-de-la-url` de `npm run gate:design`, bloqueante en cero. El
  detalle —por qué valida contra las pestañas visibles y no contra la lista
  entera, y cuándo se REEMPLAZA en vez de empujar al historial— en DESIGN.md
  §14 · ViewTabBar.
- **Antes de cerrar trabajo que toque consultas, índices o pantallas de
  consulta: `npm run gate:perf`.** Mide contra producción. Nació el 2026-08-18,
  después de que un reporte de sala («al buscar se traba») destapara **siete**
  problemas de velocidad que llevaban meses vivos: un buscador que salía con la
  primera tecla y traía 16,722 filas, un `Parallel Seq Scan` de 775,868 filas
  para devolver 30, una vista que normalizaba fila por fila **dos veces**, la
  tabla más grande de la base sin VACUUM programado, y tres índices que faltaban.
  Ninguno dio error, ninguno apareció en un log, ninguno falló un gate — porque
  no había ninguno que midiera velocidad. **Se enteró un usuario antes que el
  repo.**

  Tiene cuatro secciones y sólo una mira el reloj: constantes del código,
  existencia de índices/columnas/crons, **forma del plan** (`EXPLAIN` sin
  `ANALYZE`, determinista: ¿entra por índice o barre?) y recién después los
  tiempos. La protección real es la estructural — los tiempos contra producción
  compartida son ruidosos, así que sus techos están ~5× sobre lo medido a
  propósito: vigilan que algo no vuelva a costar 700 ms, no que baje de 10 a 8.
  Un gate que falla al azar se termina ignorando.

  **El presupuesto NO se sube para que calle.** `--update-baseline` sólo BAJA
  números, después de una mejora medida. En el hook de pre-commit corre sólo la
  sección local (`--hook`), y únicamente si el commit toca los tres archivos
  donde viven esas constantes: un gate de commit que necesita red falla sin
  conexión y enseña a usar `--no-verify`.
- **Antes de cerrar trabajo que agregue un cron, cambie una cadencia o toque una
  edge function que habla con el sistema de origen: `npm run gate:eficiencia`.**
  Nació el 2026-08-20 preguntándose si un barrido nuevo saturaba el sistema:
  era 1 disparo al día, y el que pedía de verdad era la vigilancia de los cortes
  —2.863 disparos, 13 peticiones cada uno, ~25.000 al día— que llevaba semanas
  así sin que nadie lo mirara, porque **la cadencia vive en producción y el
  costo por corrida vive en el código, y nada los juntaba**.

  No mide velocidad (eso es `gate:perf`): mide **volumen y silencio**. Su
  manifiesto `CRONS` declara, por cron, cuántas peticiones cuesta una corrida
  **con su motivo escrito**; el gate suma peticiones/día contra el baseline
  —que **sólo baja**—, y contra producción comprueba que ningún cron esté sin
  declarar, que ninguna cadencia se haya apretado, que lo declarado siga vivo
  (`backup-critical-tables` estuvo 17 días muerto) y que las llamadas salientes
  contesten 200 (un redeploy sin `--no-verify-jwt` las deja en 401 **antes de
  ejecutar una línea**, y ya pasó tres veces).

  Un cron que falla se mide por **tasa, no por tropiezo**: un `job startup
  timeout` suelto es un aviso, el 5% es rojo. Y un cron nuevo se mide antes de
  entrar: `sistema: null` es deuda declarada, no un número inventado.
- **Toda salida de datos del portal se ANOTA, y el que exporta no firma.** Desde
  el 2026-08-24 hay `export_log`, y se escribe por `registrar_egreso(modulo,
  formato, filas, detalle)` — nunca con un `INSERT` del cliente. El motivo no es
  estilo: `export_log.employee_id` tiene que ser la **ficha** (`employees.id`) y
  el navegador conoce la **cuenta** (`auth.users.id`); para **33 de las 42
  personas** que usan el portal esos dos ids no son el mismo valor, así que un
  `INSERT` con `session.user.id` lo rechaza la policy **para la mayoría de la
  gente y en silencio**. La firma sale de `auth_employee_id()` adentro de la
  función. En el frente, `registrarEgreso` de `src/data/egreso.js`; **nunca
  lanza** —una descarga no puede fallar porque no se pudo anotar— pero avisa en
  consola. Y `exportCsv` **exige el módulo**: sin él el archivo baja igual pero
  el egreso queda como `sin-declarar`, que es un hallazgo visible en la tabla en
  vez de un hueco. Cuatro salidas no usan el canónico y se armaban el CSV a mano
  —la planilla del banco, el directorio de personal, asistencia y Mín·Máx—: al
  agregar una salida nueva, usar `exportCsv`.
- **Un control de seguridad nuevo se instala UNA vez y se enciende con una fila.**
  `security_config` tiene tres estados —`observar` → `avisar` → `exigir`— y los
  helpers `sec_exige(key)` / `sec_avisa(key)`, los dos `STABLE` para envolverlos
  en `(SELECT …)`. Que el interruptor sea una **fila** y no una policy es el
  punto: cambiar una policy es DDL sobre tabla caliente, o sea el outage del
  2026-07-08, así que **la marcha atrás nunca puede ser una migración**. Su
  default es `false`: si la fila no existe, NO exige — un control mal escrito
  nunca deja a nadie afuera por accidente. Detalle en
  `docs/SEGURIDAD-Y-ACCESO.md`.
- **Antes de cerrar trabajo que toque cortes de caja, cobros de crédito o
  movimientos de caja: `npm run gate:cortes`.** Mide contra producción y
  pregunta una sola cosa: ¿el efectivo que entró al cajón está en el esperado
  de algún corte del día? Nació el 2026-09-02, después de que el portal
  anunciara +$78.40 de sobrante sobre un faltante de $9.85 — ver la sección de
  cuentas por cobrar. **No va en el pre-commit**: necesita red, y un gate de
  commit que falla sin conexión enseña a escribir `--no-verify`.
- **Antes de cerrar trabajo que toque el libro bajo receta, el catálogo de
  antibióticos o `dispensacion_clases`: `npm run gate:receta`.** Mide contra
  producción y pregunta si el libro ve todo lo que la norma manda que vea.
  Nació el 2026-09-03: el contenido del libro lo decide `products
  .es_antibiotico`, una casilla que mantiene el ERP **a mano**, y el día que
  entre una presentación nueva de una molécula controlada sin marcar se
  despacha en el mostrador y no aparece en el libro — sin error y sin fila de
  menos visible.

  **La regla NO es «todo antibiótico».** El RTS 6.4.3 remite «al listado
  emitido oficialmente por SRS», y son **seis moléculas** (cefixima,
  azitromicina, claritromicina, levofloxacina, moxifloxacina, norfloxacina)
  **más todo antibiótico inyectable**. Lo demás —amoxicilina, metronidazol,
  ciprofloxacina oral— es venta libre. Auditar contra ATC J01 da un número
  grande y falso: pasó, y decía que faltaba el 80%.

  **El gate detecta por PRINCIPIO ACTIVO, nunca por marca.** Su primera versión
  tenía un mapa de marcas y acusó a `BACTIVANZ 300` de ser claritromicina —su
  principio activo dice CEFDINIR—. Por eso `products.principio_activo` es
  deuda declarada en `scripts/receta-baseline.json`, con trinquete que **sólo
  baja**: cada producto sin él es uno que el gate no puede mirar. **No va en el
  pre-commit** (necesita red).
- **Antes de cerrar trabajo que toque una tabla, una ficha o un diálogo:
  `npm run gate:movil`** (bloqueante en cero) y el barrido de la ruta que
  tocaste. El canon completo está arriba, en «el teléfono no es la pantalla
  chica»: lo que hay que recordar acá es que **un gate en verde no dice que la
  vista se vea bien** — lee el fuente, y hay filas que desde el fuente son una
  caja cerrada. Eso lo cierra el barrido, y las dos capas juntas no cubren los
  diálogos: ésos los abre `dialogos-movil`.
- **`npm run gate:nombre` — el nombre de una persona sale del canónico.** El
  portal muestra SIEMPRE primer nombre + primer apellido: `shortEmployeeName`
  de `src/utils/nameUtils.js`. Corre en el pre-commit cuando el commit toca un
  `.jsx` y **bloquea en cero**.

  Nació el 2026-09-03 de un reporte de una línea —«¿por qué sale el nombre
  completo? hay reglas ya definidas que lo prohíben»— sobre una tarjeta que
  decía «EDWIN ALEXANDER NUNEZ JOYA» **junto a un avatar que decía «EN»**. Ahí
  está el patrón: los componentes le pasan la persona entera a
  `AvatarConEstado`, que sí llama al canónico para las iniciales, y pintan
  `persona.name` crudo dos píxeles al lado. Eran **ocho** sitios, más **tres
  copias de la regla escritas a mano**, dos de ellas mal: `.split(' ')
  .slice(0, 2)` toma las dos PRIMERAS palabras, o sea dos nombres y ningún
  apellido.

  **El modo de falla es el silencio.** Todos tenían `truncate`: el nombre largo
  no desbordaba nada, se cortaba a la mitad. No hay error ni layout roto — se
  reporta como «se ve raro», meses después.

  Las excepciones son las que `nameUtils` ya declara —Personal, donde el nombre
  completo ES el dato, y todo lo que SALE del portal: CSV, planilla, papel— más
  quien no es un empleado (el receptor de un DTE es un cliente). Van en
  `EXCEPCIONES` de `scripts/nombre-gate.mjs` **con su motivo y su cuenta**: por
  archivo a secas no alcanza, y se comprobó — al fabricarle la regresión, la
  excepción legítima de un archivo se tragó un defecto nuevo en ese mismo
  archivo.

  Tres cosas quedan FUERA a propósito, las tres medidas: `title`/`alt`/
  `aria-label` (el nombre entero ahí COMPLETA al corto, no lo contradice —
  contarlos daba 24 hallazgos de los cuales 5 eran texto), las props de
  componente (el nombre viaja a otro que puede resolverlo, como hace
  `AutorLinea`) y las condiciones `{x.name && …}`. Pero `{x.name || '—'}` SÍ
  cuenta: ahí la izquierda es el valor, no un test. Esa distinción faltaba en
  la primera versión y puso el gate en verde tapando tres sitios reales.

- **«¿Esta factura cuenta como venta?» se contesta con `public.venta_valida(estado)`,
  y «¿entra al libro?» con `public.venta_fiscal(estado, recibido_mh)`** (U2,
  2026-09-26). Nunca `estado NOT IN ('NULA','DTE INVALIDADO EN MH')` ni `estado =
  'FINALIZADA'` a mano: eran tres redacciones en ~100 funciones que coincidían
  por casualidad. Un estado que nadie conoce NO cuenta (decisión del usuario) y
  `avisar_estados_de_venta_desconocidos` le avisa al cargo de alertas técnicas.
  Las dos funciones van **sin `SET search_path` a propósito**: así se inlinean
  y el planificador sigue usando el índice de `estado` (excepción razonada a la
  regla 4). **El pre-commit lo vigila**: `migration-gate` rechaza una migración
  nueva con el filtro a mano, salvo `-- venta-a-mano: <motivo>` (el circuito de
  Hacienda pregunta otra cosa: «¿está anulada?»). Nació de que, el mismo día que
  se migró, otra sesión reaplicó su copia vieja de una función de puntos 38
  segundos después. Al reescribir una función que lee `sales_invoices`, partir
  de su definición VIVA (`pg_get_functiondef`), no de un archivo viejo.
- **`npm run gate:tdz` — leer una variable antes de su `const`.** Corre en el
  pre-commit cuando el commit toca `src/` y **bloquea en cero**. Es hermano de
  `gate:undefinidos`: aquél caza la variable que NO EXISTE, éste la que existe
  pero **todavía no**.

  Nació el 2026-09-02 con Efectivo reventando entera al entrar. Un hook leía
  `nombreSala` **68 líneas antes** de su `const`, y eso **no da `undefined`**
  —que habría pasado inadvertido—: lanza en CADA render. Lo caro no es el
  defecto, es el AVISO: `Cannot access 'E' before initialization`, con el
  nombre **minificado** y la pila apuntando a `react-dom`, porque quien llama
  al componente es React. O sea que no dice ni qué variable ni qué archivo — se
  buscó primero en imports circulares, que eran **cero en todo `src/`**.

  **Encender `no-use-before-define` a secas no sirve: denuncia 241 y sólo una
  puede fallar.** Por eso el gate las separa, y el corte es DECIDIBLE, no una
  corazonada: si entre la lectura y el ámbito que declara la variable **no hay
  ninguna función**, las dos corren en la misma pasada y la lectura llega
  antes — *lanza seguro*. Si hay una función en el medio, lo que corre es su
  definición y no su cuerpo: cuando alguien la llame, el `const` ya está. Sale
  del árbol de ámbitos del propio linter.

  El baseline (`scripts/tdz-baseline.json`) lleva SÓLO las diferidas y **sólo
  baja**. «Diferida» significa *no puede fallar por llegar temprano*, no *está
  bien escrita*. **Al mover un hook o un `useMemo`, comprobar que todo lo que
  lee ya esté declarado.**
- **`npm run gate:nucleo` — la lógica no conoce al navegador.** Corre en el
  pre-commit cuando el commit toca `src/{data,utils,store,hooks,context,constants}`.
  Cuenta `window`/`document.`/`navigator.`/`localStorage`/`import.meta.env` y los
  imports de pantallas o íconos en esa lógica, y **falla si algo sube**. Es la
  preparación para una app nativa: la lógica tiene que poder correr fuera del
  navegador para reutilizarse tal cual. El baseline es la deuda del 2026-09-24
  (359 usos en 64 archivos) y **sólo baja**. Si hace falta el navegador, se
  pide por el adaptador de la plataforma; si hace falta un ícono, la lógica
  devuelve su NOMBRE. Plan y fases en `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`.
  **Al importar el núcleo desde una pantalla, `@nucleo/utils/…`, nunca
  `../../utils/…`; desde el núcleo, la plataforma va por `@plataforma/…`.** Lo
  vigila `npm run gate:alias` en el pre-commit (`--escribir` en
  `scripts/nucleo-alias.mjs` lo corrige solo). Es lo que deja mudar el núcleo a
  `packages/core` sin tocar pantallas.
- **`npm run gate:alcance` — nadie toca lo de otra sucursal cambiando un
  número.** Las edge functions usan la llave del servidor y las funciones
  `SECURITY DEFINER` saltan el RLS: el único freno por sucursal está en su
  código. Nació el 2026-10-02 de `pedir_correccion`, que aceptaba la sala del
  navegador sin compararla, y al buscar el patrón apareció en recibir pedidos,
  anotar vales y despachar desde Bodega, más dos funciones abiertas a internet.
  **Toda edge function nueva, y toda función de la base que reciba una
  sucursal, se declara en `scripts/alcance-manifest.json` con su guarda**
  (`alcance`, `modulo-de-red`, `sin-sala`, `cron`, `publica`, `solo-servidor`);
  sin declarar, el gate falla. `modulo-de-red` significa «no compara la sala
  porque hoy sólo tienen el módulo cargos de toda la red», y el gate lo
  comprueba contra `role_permissions`: **darle ese módulo a un cargo de sala lo
  pone en rojo**. Declarar `alcance` es una afirmación sobre CADA acción — el
  gate lee el archivo entero y no ve una acción sin chequeo al lado de otra que
  sí lo tiene. Las deudas viven en `scripts/alcance-baseline.json` y **sólo
  bajan**. Mira también los **buckets**: uno privado cuya policy de lectura sea
  `bucket_id = '…'` a secas lo lee entero cualquiera con sesión —así estaban los
  2,035 comprobantes de caja de `payment-proofs`— y tiene que estar en
  `buckets_abiertos` con su motivo. En el pre-commit corre la parte local cuando
  el commit toca `supabase/functions/`. Plan:
  `docs/planes-cerrados/PLAN-ALCANCE-POR-SUCURSAL-2026-10-02.md`.
- **`npm run gate:app-nativa` — un módulo nuevo del portal nace también nativo
  en la app.** Al agregar un módulo o vista al portal (`MODULE_MAP`), en el mismo
  trabajo se crea su pantalla nativa en `apps/mobile` (iOS con SwiftUI/`@expo/ui`,
  Android con las piezas Material `.android.js`) y se registra en
  `PANTALLAS_DE_LA_APP`; si de verdad no corresponde, va a `EXCEPCIONES` de
  `scripts/app-nativa-gate.mjs` con su motivo. Sin pantalla nativa el módulo no
  falla: se abre como el portal web dentro de la app, y así entraban las vistas
  nuevas sin que nadie lo notara (2026-10-12). Corre en el pre-commit cuando el
  commit toca `moduleMap.js`, `App.jsx` o `pantallas.js`.
- **`npm run gate:tipos` — la base es un CONTRATO.** `src/types/database.ts`
  son los tipos de producción y el cliente de Supabase se declara con ellos:
  una tabla, columna o parámetro de `.rpc()` que no existe da un aviso de `tsc`
  en vez de un cero en pantalla. Trinquete por archivo del núcleo
  (`scripts/tipos-baseline.json`, **sólo baja**). **Al cambiar la base, correr
  `npm run tipos:base`** y commitear los tipos con la migración; `--remoto`
  compara con producción y falla si quedaron viejos. Tarda ~20 s, así que no va
  en el pre-commit: se corre al cerrar trabajo que toque el núcleo o la base.
- **`npm run gate:tokens` — la paleta de la app sale del CSS.**
  `src/constants/tokens.json` lo genera `npm run tokens:exportar` desde
  `src/index.css`; **no se edita a mano**. Corre en el pre-commit cuando el
  commit toca `index.css` y falla si el JSON quedó viejo, si un token apunta a
  una variable que no existe (el navegador lo calla: así vivió `--chart-8`
  sin color desde v2.139.0) o si aparece una consulta de medios nueva que el
  export no clasifica. Al cambiar un token: editar el CSS y regenerar.
- **Antes de cerrar cualquier trabajo de tema/estandarización visual (colores
  crudos, elementos nativos del navegador), correr `npm run gate:design`.**
  Debe pasar en verde — las excepciones legítimas viven en
  `scripts/design-gate.mjs` (const `EXCEPTIONS`) y en `DESIGN.md` §6/§14. Este
  gate reemplaza los regex ad-hoc de sesiones anteriores que se perdían y
  dejaban huecos reales sin detectar (ver
  `docs/planes-cerrados/AUDITORIA-TEMA-2026-07.md` y memoria
  `project_theme_audit_2026_07_22`).

  **Nunca regenerar el baseline para tapar un hallazgo nuevo** — si una
  categoría subió, es código nuevo que hay que arreglar. El ratchet, el estado
  de las 47 categorías y cuándo sí se regenera: skill **`design-gate`**.

  **El baseline volvió a estar VACÍO el 2026-08-06**: las 47 categorías en cero
  y bloqueantes. Empezó ese día con tres —`vidrio-a-mano` (135),
  `material-a-mano` (18), `carril-pildora` (15)— y las tres se bajaron con la
  receta de §20 de `docs/planes-cerrados/PLAN-MATERIALES-2026-08-02.md`.
  O sea que hoy **cualquier hallazgo nuevo falla el gate**, no suma al ratchet.