// Portal Farmalasa — Version control
// Maintainer: Edwin Nunez
// Format: MAJOR.MINOR.PATCH
// - MAJOR: breaking redesigns / architecture changes
// - MINOR: new features / modules
// - PATCH: fixes, tweaks, visual adjustments
//
// EL HISTORICO COMPLETO VIVE EN `CHANGELOG.md`, en la raiz.
// Movido el 2026-07-28: este archivo habia llegado a **805 KB** de changelog,
// y lo importa `AppLayout` para pintar la version en el pie del menu. Los
// comentarios NO llegan al bundle (verificado: 0 coincidencias en dist), asi
// que no era peso para el usuario — pero babel se deoptimizaba en cada build
// ("exceeds the max of 500KB") y eslint lo recorria entero en cada pasada.
//
// Acá quedan las ULTIMAS 6 entradas, que es lo que uno mira al
// retomar. El resto se lee en CHANGELOG.md, que ademas se puede abrir sin
// cargar un modulo de JS.

export const APP_VERSION = '2.154.0';

// v2.154.0 — D3.5 CERRADA. 101 → 1.
//
// El unico que queda es de BranchesView y NO debe migrar: es TEXTO que solo
// toma forma de chip en una de sus tres ramas (cuando la sucursal esta cerrada
// hoy). Pasarlo a `Badge` lo volveria chip siempre, y las otras dos ramas —el
// horario y el "Definir" en rojo— son texto suelto dentro de la fila. Anotado
// en sitio.
//
// ── Lo que se encontro en el camino ──────────────────────────────────────
// El patron era SIEMPRE el mismo: una tabla que guardaba dos o tres clases de
// Tailwind por fila. `SUC_COLORS`, `TIPO_PAGO_COLORS`, `STATUS_META`,
// `EVENT_THEMES`, `getRoleTheme`, `getStatusInfo`, `getSeverityInfo`,
// `scoreBg`, `marginLabel`, `getThemeForAction`… veinte tablas distintas
// reescribiendo la misma paleta SOFT del canonico.
//
// Con `variante` en la tabla, agregar un estado es una linea en vez de tres
// clases. Y el color deja de poder derivar: hoy `chart-2` es `success` en
// todos lados porque la tabla lo NOMBRA, no porque alguien copio el hex bien.
//
// Casos que NO son `Badge` y quedaron documentados:
//   · los contadores (ancho minimo fijo + numero) → `Contador`
//   · el `dot` de un estado y el `bg` de un cuadro de icono → son SUPERFICIE
//   · texto que solo a veces parece chip → texto
//
// El baseline de `chip-a-mano` baja de 45 a 8 (el gate cuenta tambien los de
// `components/common/`, que son los canonicos mismos).

// v2.153.0 — D3.5: cinco chips mas, incluida la severidad de la auditoria.
//
// `getSeverityInfo` devolvia color/bg/border/icon por severidad. El icono se
// queda —es un nodo JSX, no una clase— y se le agrega la variante.
//
// Chips a mano: 14 → 9.

// v2.152.0 — D3.5: seis chips mas.
//
// `EVENT_BADGE` y `VACATION_STATUS` (mi horario), el estado del conteo, el
// puntaje del SRS y los dos deltas de la recepcion.
//
// Los deltas son un caso bonito: un chip flotante en la esquina de un input,
// verde o rojo segun el signo. `Badge` con `tone=solid` y el
// posicionamiento por `className` hace exactamente eso — no hizo falta nada
// nuevo.
//
// Chips a mano: 20 → 14.

// v2.151.0 — D3.5: siete chips mas, y dos que eran contadores.
//
// El del submenu de AppLayout y el ranking de urgencia de TabGenerar tienen
// ancho minimo fijo y numero adentro: eso es `Contador`, no `Badge`. El % de
// urgencia de al lado si es un chip y va a `Badge`. Dos componentes distintos
// pegados, cada uno con el suyo.
//
// Y `TabShifts` usaba `chart-5` para el chip de Saly — retirado; pasa a
// `chart-9`, que es a donde apunta su alias.
//
// Chips a mano: 27 → 20.

// v2.150.0 — D3.5: ocho chips sueltos, y una funcion que devolvia clases.
//
// `scoreBg()` (Encuestas) devolvia dos clases de Tailwind segun el puntaje.
// Ahora es `scoreVariante()` y devuelve el nombre de la severidad — que es lo
// que la funcion de verdad sabe: 85+ bien, 70+ aceptable, 55+ atencion, menos
// mal.
//
// Uno tenia el MISMO color en las dos ramas del ternario
// (`e.isPast ? bg-surface-card-hover : bg-surface-card-hover`): un condicional
// que no condicionaba nada, escrito y nunca releido.
//
// El gate atrapo dos `<Badge>` sin importar. Van tres veces que me salva.
//
// Chips a mano: 36 → 27.

// v2.149.0 — D3.5: las cuatro tablas de Producto.
//
// `ERP_COLORS` (inventario), `meta.badge` (min/max), `st.cls` (solicitudes) y
// el resto. Todas guardaban dos o tres clases de Tailwind por fila; ahora el
// nombre de la variante. Dos de ellas usaban `chart-7` y `chart-5", retirados,
// asi que al pasar por el mapa quedan en `warning` y `chart-9`.
//
// Chips a mano: 39 → 36.

// v2.148.0 — D3.5: `SucPill`, y una tabla que estaba duplicada.
//
// `SUC_COLORS` (color por sucursal) vivia DOS VECES con el mismo contenido:
// en `tabpedidos/constants.js` y otra copia dentro de `TabPedidos.jsx` que ya
// no usaba nadie. Se queda la de constants —la usa `SucPill`, que es quien
// pinta el chip— y guarda el nombre de la variante en vez de tres clases.
//
// `STATUS_BADGE` de rutas estaba en dos archivos (TabRutas y RutaEnCursoCard)
// con el mismo contenido salvo que a uno le falta `con_alerta`. Los dos pasan
// a la misma forma. `en_ruta` deja `chart-5` —retirado— y usa `chart-9`.
//
// Chips a mano: 42 → 38.

// v2.147.0 — D3.4: los ocho campos del modal de promocion.
//
// Se fueron con ellos `inp` y `numInp`: el campo de `PortalInput` reescrito
// clase por clase, y su variante centrada para las celdas numericas.
//
// Todos conservan `type="number"`, `min` y `step` — que es exactamente lo que
// el `...rest` de v2.115.0 vino a permitir. Sin ese arreglo, migrar los bonos
// les habria quitado el `min="0"` y se habrian podido escribir negativos.
//
// Una perdida deliberada: las tres etiquetas de bonificacion tenian color
// propio (verde vendedor, azul admin, ambar bodega). `PortalInput` no tiene
// eje de color en la etiqueta, y el color no aportaba dato: los tres son el
// mismo tipo de campo dentro de un bloque que ya es verde. Anotado en sitio.
//
// Verificado en vivo el primer paso del asistente; los otros siete viven en
// pasos que exigen elegir un producto y quedan verificados por codigo.
//
// Inputs a mano: 93 → 85.

// v2.146.0 — D3.4 arranca: los cuatro campos del proveedor.
//
// El patron clasico: `<div><label sin htmlFor><input className=…></div>`, o
// sea `PortalInput` reconstruido a mano. Las cuatro etiquetas no estaban
// asociadas al campo; ahora lo estan por `<label for>`.
//
// El `title` del Alias —"Nombre alterno para buscarlo (ej. como le dicen de
// palabra en Bodega)"— sobrevive gracias al `...rest` de v2.115.0. Antes de
// ese arreglo, migrarlo lo habria borrado.
//
// Inputs a mano: 97 → 93.

// v2.145.0 — El gate cubre las dos deudas que faltaban: chips e inputs.
//
// Hasta hoy D3.4 y D3.5 se median con scripts sueltos en el scratchpad —
// exactamente lo que la memoria del proyecto dice que NO hay que hacer
// (feedback_structural_grep_over_manual_dictionary). Ahora son categorias del
// gate, versionadas y con el resto.
//
//   chip-a-mano   45  un `<span>` con relleno + radio + texto chico en negrita
//   input-a-mano  97  un `<input>` de texto fuera de `PortalInput`
//
// Van con RATCHET, no en cero: las dos colas son largas y planas (1-2 por
// archivo). Un gate permanentemente rojo no lo mira nadie; lo que importa es
// que **no suban**. Probado con un archivo desechable: 45→46 y 97→98 lo
// marcan como deuda nueva.
//
// Dos exclusiones deliberadas: el chip no marca los que tienen `min-w-[…]`
// (esos son `Contador`, no `Badge`), y el input no mira dentro de
// `components/common/` (ahi viven los canonicos mismos).

// v2.144.0 — D3.5: el tipo de documento, por cuarta vez.
//
// `CCF ? danger : neutral` estaba escrito en cuatro archivos distintos —
// Ventas, Facturacion, WidgetAnnulmentRequest y RequestsView— cada uno con su
// propio ternario y su propio padding. Es el mismo dato del negocio en los
// cuatro. Ahora los cuatro salen de `Badge`.
//
// Y `getThemeForAction` (historial de sucursal): siete ramas devolviendo
// bg/text/border/dot/shadow. El `dot` y el resto se quedan —pintan el punto de
// la linea de tiempo y su halo, que son superficies— y se les agrega la
// variante para el chip.
//
// Chips a mano: 45 → 42.

// v2.143.0 — D3.5: el chip ACTIVO/INACTIVO, tres veces, y cuatro tablas mas.
//
// El mismo chip —mismo texto, misma condicion, mismo color— estaba en
// `SrsBuscadorWidget`, `WidgetInventorySearch` y `WidgetSrsInventory`, con
// tres paddings distintos (`px-2`, `px-1.5`, `px-2`). Nadie lo decidio: se
// copio tres veces y cada copia se fue moviendo.
//
// Y `STATUS_CFG` (Mis Documentos), el `cfg` de una solicitud min/max,
// `ESTADO_CFG` (conteo de inventario).
//
// Chips a mano: 52 → 45.

// v2.142.0 — D3.5: los tres "Urgente" de Mis Avisos, nomina y cotizaciones.
//
// El chip "Urgente" estaba escrito TRES veces en el mismo archivo, y las tres
// distinto: una con `bg-danger-solid` y radio md, otra con radio full y una
// sombra, la tercera con un GRADIENTE `from-danger to-danger/80`. Mismo texto,
// mismo icono, mismo significado, tres formas.
//
// Tambien `STATUS_META` de nomina y los dos de cotizaciones.
//
// Chips a mano: 59 → 52.

// v2.141.0 — D3.5: Facturacion y Catalogo cerrados.
//
// Facturacion: los dos chips de dia (mismo ternario escrito dos veces) y el
// tipo de documento. Catalogo: `CLASIF_STYLE`, `marginLabel().cls`,
// `xk.changesBadge` y el estado activo/inactivo — cuatro paletas mas.
//
// `marginLabel` es un buen ejemplo de por que esto vale: devolvia un `cls` con
// tres clases de Tailwind para decir "Perdida" o "Margen bajo". Ahora devuelve
// el nombre de la severidad, que es lo que la funcion realmente sabe.
//
// Un error mio que atrapo el lint: use `VARIANTE_DOC` en Facturacion, pero esa
// constante vive en VentasView. Son dos archivos sin nada compartido. Cada uno
// tiene el suyo ahora. Lo detecto `eslint | grep problems` — con el `tail -1`
// que usaba antes se me habria pasado, igual que la vez anterior.
//
// Chips a mano: 66 → 59.

// v2.140.0 — D3.5: tres tablas mas, y la consolidacion bajando sola.
//
//   · `BRANCH_TYPE_META` (Sucursales) — cuatro tipos con su trio
//     bg/text/border.
//   · `STATUS_CONFIG` (Inicio, actividad en tiempo real) — seis estados. El
//     `dot` se queda: se usa aparte para el punto.
//   · `ABSENCE_COLORS` (Inicio, ausencias) — el `bg`/`border` se queda porque
//     pinta tambien el cuadro del icono, que es una SUPERFICIE y no un chip.
//
// Dos de ellas usaban `chart-2` para "en labores" y "permiso". Como chart-2 ya
// es `success` desde v2.139.0, pasan a nombrarlo por lo que es. El baseline de
// `chart-retirado` baja **452 → 445 sin tocar un solo color**: es la
// consolidacion resolviendose sola a medida que los sitios se migran.
//
// El gate atrapo un `<Badge>` sin importar en BranchesView — el mismo fallo
// que me tumbo dos vistas ayer. Esta vez lo corri ANTES de la captura.
//
// Chips a mano: 70 → 63.

// v2.139.0 — La paleta: de trece a nueve, y los colores de marca con un rol.
//
// Se midio la distancia perceptual (ΔE, CIELAB) entre los 78 pares posibles y
// CUATRO no eran categorias: eran el mismo color con otro nombre.
//
//   chart-2 → success   ΔE 11.6, y su `-solid` era EL MISMO HEX (#047857)
//   chart-8 → neutral   `Badge` ya usaba chart-8-solid como su neutro
//   chart-5 → chart-9   cian y verde azulado, nunca aparecen juntos
//   chart-7 → warning   dorado y ambar, los dos leen "atencion"
//
// ── Como se hizo, y por que asi ──────────────────────────────────────────
// Mi conteo anterior decia "19 usos". Estaba mal: contaba solo variantes de
// componente. El recuento real es **343 referencias en 88 archivos**, porque
// los tokens tambien se usan en clases crudas (`bg-chart-2/10`, `var(--chart-2)`).
//
// Reescribir 343 sitios habria sido un cambio riesgoso para un resultado
// visual identico. En vez de eso los cuatro se redefinen como ALIAS del
// destino. Los `@theme` de Tailwind ya iban indirectos
// (`--color-chart-2: var(--chart-2)`), asi que el color queda unificado YA,
// ninguna referencia se rompe, y el gate (`chart-retirado`) bloquea usos
// nuevos. Los sitios migran cuando toque tocarlos.
//
// ── Los colores de marca dejan de ser decoracion suelta ──────────────────
// Vivian solo en AppLayout. Ahora tienen un ROL declarado: aparecen donde la
// app habla DE SI MISMA — navegacion activa, brillo del logo, el aro del
// estado vacio y los dos anillos de la espera de la IA, que son literalmente
// los dos arcos del logo (verde arriba, magenta abajo; antes eran chart-3 y
// chart-5, dos categoricos prestados para decorar).
//
// NUNCA en un dato ni en un estado: eso es severidad o categoria. Confundirlos
// es lo que hace que un color deje de significar.
//
// Y un dato que hacia falta: el verde del logo es LIMA — con texto blanco da
// 2.11:1 y no pasa AA. Se agrega `--logo-green-solid` #5c7f0a (4.67:1) para
// cuando haga falta relleno. El magenta si sirve tal cual (7.10:1).
//
// ── Un bug de contraste, encontrado midiendo ────────────────────────────
// De las 32 combinaciones color×tema, 31 pasaban AA y UNA no: `chart-4`
// (naranja) en liquid, 4.32:1. Su `-text` baja de #c2410c a #9a3412.
//
// ── Y la respuesta a "no deberian tener variante por tema" ───────────────
// Solo una de las tres capas la necesita, y ya la tenia:
//   base (tinte 12%) — NO: se compone sobre la superficie, que si cambia
//   `-text`          — SI, y ya tiene su par claro/oscuro
//   `-solid`         — NO: es autocontenido (fondo propio + blanco)
//
// Verificado en vivo en los CUATRO temas: los alias resuelven al mismo valor
// que su destino, el `-text` conserva su par, cero errores.

// v2.138.0 — D3.5: tres chips mas, ya con la paleta cerrada como regla.
//
// Los dos contadores con/sin bodega de TabGenerar y el tipo de sucursal del
// catalogo. Ninguno estrena color: `success`, `danger`, `warning` y `chart-1`
// son los que esos mismos chips ya usaban escritos a mano.
//
// Chips a mano: 73 → 70.

// v2.137.0 — La paleta es CERRADA, y ahora el gate lo verifica.
//
// Regla del usuario: **no se agregan colores ni variantes de color; se usan
// los definidos**. Cuando algo necesita un color que "todavia no existe", la
// respuesta es elegir uno de los que ya estan, no crear el numero siguiente.
//
// Verificado primero que no agregue ninguno en toda la sesion: cero tokens
// nuevos en index.css y cero variantes nuevas en los canonicos. Lo que hice
// fue mapear colores escritos a mano a variantes que YA existian — eso no es
// agregar, es dejar de repetir.
//
// Pero el conteo muestra por que la regla hace falta:
//
//     chart-3 76 · chart-1 43 · chart-4 21 · chart-9 18 · chart-6 12
//     chart-2 7 · chart-5 7 · chart-7 6 · chart-8 4   ← un color por caso
//
// Los cuatro de abajo no son categorias del negocio: son "hacia falta otro
// color" resuelto agregando uno. No se borran —cambiaria el aspecto de varias
// vistas y es decision aparte— pero no se usan para nada nuevo.
//
// La regla queda en DESIGN.md §6 y, sobre todo, en el gate: `paleta-cerrada`
// falla ante cualquier `chart-N` con N fuera de 1..9. Nace en 0 y bloqueante.
// Probado con una copia desechable: reporta `chart-10` y `chart-12`.

// v2.136.0 — D3.5 en VentasView, y dos fallos de verificacion mios.
//
// El tipo de documento se pintaba en DOS tablas de la vista, cada una con su
// propia cascada de ternarios — y una usaba `text-danger` donde la otra usa
// `text-danger-text`. Los siete niveles de precio (`DRILL_TIERS`) igual: un
// `color` con dos clases por fila. Todo pasa a nombre de variante.
//
// ── Fallo 1: inserte una constante con un ancla que ya no existia ────────
// El `s.replace()` buscaba un comentario que YO MISMO habia reescrito en
// v2.120.0. No inserto nada, y mi `print` conto 3 ocurrencias de
// `VARIANTE_DOC` —el comentario mas los dos usos— y lo lei como exito.
// La vista entera cayo en el ErrorBoundary.
//
// Regla: al insertar por ancla, **afirmar que la insercion ocurrio**
// (`assert 'const X = {' in s`), no contar menciones.
//
// ── Fallo 2: `eslint | tail -1` me ocultaba el resumen ───────────────────
// ESLint SI reportaba `'VARIANTE_DOC' is not defined  no-undef`. Pero su
// salida termina en linea vacia, asi que `tail -1` mostraba el vacio en vez
// del "✖ 2 problems". Llevaba varios lotes leyendo mal ese comando.
// Correcto: `npx eslint src/ | grep -E "problems|✖"`.
//
// Chips a mano: 77 → 73.

// v2.135.0 — D3.5: cuatro paletas mas, dos de ellas compartidas.
//
//   · `getRoleTheme` (utils/scheduleHelpers) — la usan TRES vistas. Devolvia
//     `bg`/`text`/`border` por rol; ahora tambien el nombre de la variante.
//   · `getStatusInfo` (Personal) — nueve ramas devolviendo un `className` con
//     las tres clases juntas.
//   · `PRACTICANTE_ESTADO_CFG`, `EVENT_THEMES`, `VAC_STATUS` — lo mismo, una
//     fila por estado.
//
// El `bg`/`text`/`border` NO se borra de ninguna: hay sitios que pintan una
// SUPERFICIE con esos mismos colores (la tarjeta del evento, el punto de la
// linea de tiempo), y eso no es un chip. Lo que se agrega es el nombre para
// los que si lo son.
//
// Verificado en vivo: /dashboard muestra 54 badges y 6 colores — los roles
// (JEFE, SUBJEFE, REG. DE ENF., DEPENDIENTE) y el estado (Activo) con su
// color de categoria.
//
// Chips a mano: 83 → 77.

// v2.134.0 — D3.5: dos paletas mas, y una leccion sobre mi propio proceso.
//
//   · `PCT_COLORS.badge` (EncuestaView) — un `badge:` por color, la paleta
//     SOFT otra vez. Y la nota contextual sacaba su borde con
//     `ctx.badge.replace('text-', 'border-')`: manipular la clase de Tailwind
//     como STRING para inventarle un borde. Ahora usa el `border` que la tabla
//     ya tenia.
//   · `STATUS_META` y `HEADER_STATUS_META` (VacationPlanView) — ocho y tres
//     filas de `bg`/`text`/`border`. El `bar` se queda: ese si se usa aparte,
//     para la barra del Gantt.
//
// ── Y lo que me paso, que vale mas que el refactor ───────────────────────
// Deje `<Badge>` sin importar en VacationPlanView. **El build paso, el lint
// paso, y la vista entera cayo en el ErrorBoundary** — "ALGO SALIO MAL", sin
// contenido. Solo lo vi en la captura.
//
// Lo importante: el gate SI lo detecta, y su mensaje literalmente dice "el
// build NO lo detecta". Existe desde v2.76 justo para esto. Mi fallo fue
// saltarme `gate:design` entre la edicion y la verificacion visual.
//
// Confirmado con una copia de prueba: el gate reporta
// `[import] <Badge> usado sin importar`. Y un barrido sobre los 14 canonicos
// en todo `src/` da 0 usos sin importar.
//
// Chips a mano: 90 → 83.

// v2.133.0 — `Contador`: la tercera familia de badge, que se habia quedado sin
// canonico.
//
// Al medir los 316 "badges" del proyecto (D3.5) salieron TRES familias:
//
//     249  chip inline corto     → `Badge`
//      58  aviso con icono       → `Notice`
//       9  **contador flotante** → sin canonico, hasta hoy
//
// `Badge` no sirve para esto y por eso se dejo fuera en su momento: un chip
// crece con su texto, un contador tiene que ser CIRCULAR con un digito y
// OVALADO con dos — o sea ancho minimo fijo y alto fijo. Meterlo en `Badge`
// habria dado burbujas de anchos distintos segun el numero.
//
// Pero dejarlo sin canonico tampoco era la respuesta: estaba escrito nueve
// veces, y **cuatro de ellas DENTRO de componentes canonicos**
// (`NotificationBell` ×2, `FilterBar`, y el del menu lateral). Ahi es donde
// mas duele: un canonico que reconstruye a mano algo que deberia ser otro
// canonico es como se multiplica la deuda.
//
// Tres cosas que el componente arregla de una vez:
//   · el corte ("9+") lo decide el llamador con `max`, porque el umbral
//     depende de donde vive — en el menu cabe "9+", en la campana "99+".
//   · devuelve `null` cuando el valor es 0, en vez de que cada sitio repita
//     su propio `{n > 0 && …}`.
//   · **nombre accesible obligatorio**: un "3" suelto no le dice nada a un
//     lector de pantalla. Ahora dice "3 notificaciones sin leer".
//
// Verificado en vivo en movil: el contador de `FilterBar` sale 18×18,
// circular, azul de marca, con `aria-label="1 filtro aplicado"`.

// v2.132.0 — D3.5: tres paletas mas que eran la del canonico.
//
//   · `TIPO_PAGO_COLORS` (Facturacion) — una fila por forma de pago,
//     `bg-chart-N/10 text-chart-N-text border-chart-N/30`. Ahora guarda el
//     nombre de la variante.
//   · `xk.statusActive/statusInactive` (Catalogo) — dos entradas de un objeto
//     de tema local que solo existian para pintar un chip.
//   · Estado y tipo de encuesta — DOS cascadas de ternarios dentro del JSX,
//     una rama por valor. Ahora dos tablas al lado de sus etiquetas.
//
// Es el mismo hallazgo por cuarta vez: cuando el color no tiene NOMBRE, se
// vuelve a escribir en cada sitio. Con `variante` en la tabla, agregar un
// estado es una linea.
//
// Verificado en vivo: /facturacion 40 badges y 6 colores (credito, tarjeta,
// transferencia…), /encuesta-admin los de estado y tipo, /productos 39.
//
// Chips a mano: 96 → 90.

// v2.131.0 — D3.5 arranca: la paleta del canonico escrita QUINCE veces.
//
// `EmployeeDetailView` tenia una cascada de quince ramas para el color del
// chip de cada evento del historial, y cada rama escribia
// `bg-X/10 text-X-text border-X/30` a mano. Es la paleta SOFT de `Badge`
// copiada quince veces. Ahora es una tabla que devuelve el NOMBRE de la
// variante y el color lo pone el canonico — mismo cambio que `SUC_COLORS`
// en TabSinVenta.
//
// El criterio de T7 no cambia: los hitos claramente buenos o malos usan
// success/warning/danger; el resto —transferencias, categorias de puesto— es
// categorico puro sin severidad.
//
// ── Y el dato que faltaba, en la fuente ──────────────────────────────────
// `REQUEST_TYPES` y `REQUEST_STATUS` (requestsSlice) ahora llevan `variante`.
// Sin eso, cada vista sacaba el `chart-N` con un REGEX sobre la clase de
// Tailwind — que es adivinar el dato en vez de tenerlo. Yo mismo escribi ese
// regex ayer en EmployeeRequestsView; se va con esto.
//
// Chips a mano: 101 → 96.

// v2.130.0 — D3.3 CERRADA. Los ultimos nueve, y por que seis no se tocan.
//
// Seis interruptores que aun no decian su estado: la celda de la matriz
// ABC×XYZ, los widgets del Inicio, la camara del login, la escala 1-10 de una
// respuesta, el empleado en el alcance de una encuesta y el candidato del SRS.
// Todos con `aria-pressed`; los que ademas eran mudos (la celda de la matriz,
// la escala) con nombre: "AX: 42 productos", "Calificacion 7 de 10".
//
// Dos ganan `disabled` en vez de un onClick condicional que no hacia nada: la
// celda con cero productos y el widget sin permiso. Un control que no responde
// tiene que DECIR que no responde, no simular que si.
//
// ── Y seis que NO llevan estado, anotado en el codigo ────────────────────
// Porque no son interruptores, y confundirlos habria sido peor que no tocarlos:
//   · las cajas y los items de RecepcionModal ABREN otra pantalla
//   · el resultado de busqueda de ScheduleCalendar agrega y cierra la lista
//   · el chevron de AttendanceAuditView es `aria-hidden` a proposito (hay un
//     abridor real arriba)
//   · el de ocultar producto en Ventas: su texto ya depende del modo de la
//     tabla (v2.120.0)
//
// ── Un tropiezo que se repitio tres veces hoy ────────────────────────────
// Un comentario `{/* … */}` NO puede ser lo primero dentro de un `=> (` ni de
// un `&& (`: queda como SEGUNDO hijo y el build falla con "Expected )". Va
// como `//` encima del `return`. Me paso en EncuestaAdminView, ScheduleCalendar
// y RecepcionModal.

// v2.129.0 — La tarjeta de sucursal: cinco bloques que eran dos.
//
// `TarjetaTelefono` estaba escrita DOS veces (fijo y celular) y
// `PanelCompletitud` TRES (legal, local, servicios), identicas salvo el icono,
// la etiqueta y el campo. Extraidas a un componente local cada una.
//
// No pasan por `Button`: son tarjetas con icono, dos lineas de texto y una
// barra de progreso — el canonico no tiene eso y forzarlas las romperia. Lo
// que hacia falta era que existiera UNA definicion.
//
// ── El hallazgo: el WhatsApp era un `<div onClick>` DENTRO del `<button>` ──
// O sea que no lo alcanzaba el teclado (un `div` no recibe foco) y su clic
// disparaba tambien el del padre. Se hizo asi porque un `<button>` dentro de
// otro es HTML invalido — pero la solucion no era degradarlo a `div`, era
// sacarlo. Ahora los dos son hermanos dentro de un contenedor, que es lo que
// siempre fueron. Son 7 botones de WhatsApp, uno por sucursal con celular.
//
// Y de paso ganan nombre: los paneles decian solo "Legal"; ahora dicen
// "Completar datos legales — 0% completo", que es el dato que importa.
//
// ── Un error de mi parte, y como se detecto ──────────────────────────────
// El primer intento uso `s.index('</button>', …)` para encontrar el cierre y
// se paso de largo: se comio 35 lineas de la tarjeta. El build fallo, asi que
// no llego a ningun lado — pero la leccion es la de siempre: para cortar JSX
// no sirve buscar el primer cierre, hay que anclar el bloque COMPLETO.
//
// Verificado en vivo: 8 tarjetas, los telefonos con su nombre
// ("Fijo: 2301-0013"), 7 WhatsApp, los paneles con su porcentaje, 0 botones
// sin nombre y la tarjeta identica a como estaba.

// v2.128.0 — D3.3, familia B: lo que les faltaba no era el componente.
//
// Las 38 "fila o tarjeta" NO son botones en el sentido del canonico: son
// superficies compuestas —avatar, contador, descripcion, barra de progreso—
// que ni `Button` ni `SegmentedControl` cubren. Forzarlas seria romperlas.
//
// Lo que SI les faltaba, a casi todas, es lo mismo: **no decian su estado**.
// Vivia entero en el color del borde y en un chevron girado.
//
// ── Encabezado de seccion plegable (7) ───────────────────────────────────
// FormAnnouncements ×2, RequestsView ×2, TabLaboratorios, SalyCopilot y
// EncuestaView. Todos ganan `aria-expanded`. Antes, si la seccion estaba
// abierta o cerrada solo lo sabia quien veia girar el chevron.
//
// ── Fila/tarjeta seleccionable (8) ───────────────────────────────────────
// El rol elegido en Permisos, la razon de pausa, la tarjeta de estado del
// monitor, la presentacion en Reglas, la sucursal en Generar, el laboratorio
// en LabsPanel y el vendedor en la anulacion. Todos ganan `aria-pressed`.
//
// Dos que NO llevan `aria-pressed`, y la distincion importa:
//   · Los pasos de PromoModal llevan `aria-current="step"` — no son un
//     interruptor, son "donde estas". Y los pasos futuros dejan de ser
//     controles: `disabled`, en vez de un `onClick` que no hacia nada.
//   · El laboratorio de LabsPanel ademas necesitaba nombre: la fila muestra el
//     nombre y un contador, pero el boton no decia que iba a HACER. Ahora dice
//     "Bayer: visible, ocultar".
//
// Verificado en vivo: /monitor 6 tarjetas con `aria-pressed` y "Total" activa,
// /pedidos 7, y 13-17 `aria-expanded` por vista. /permissions no la puede ver
// la cuenta de prueba — queda verificada por codigo.

// v2.127.0 — D3.3: los dos paneles del SRS, la matriz y el selector de mes.
//
//   · SrsEnriquecerModal: "Buscar en SRS" e "Ingresar manualmente" son dos
//     interruptores INDEPENDIENTES (volver a pulsar el activo lo cierra), no
//     un `SegmentedControl`. Llevan `aria-expanded`: antes cual estaba abierto
//     lo decia solo el color del texto. Y el toggle de rechazo de la fila pasa
//     a `Button size="xs" iconOnly`.
//   · AbcXyzMatrix: el "limpiar" → `Button variant="ghost" size="xs"`.
//   · FormAiSchedulerPreview: el toggle de lactancia NO pasa por `Button` —es
//     un segmento pegado a su hermano dentro de un borde comun, separados por
//     un `w-px`— pero le faltaba `aria-pressed`.
//   · El selector de mes del Inicio: el disparador pasa a `Button` con
//     `aria-haspopup="dialog"` y `aria-expanded`.
//
// ── La rejilla de meses NO pasa al canonico, y la razon importa ──────────
// Tiene TRES estados, no dos: el mes elegido, "el mes de hoy" (el aro) y el
// resto. `SegmentedControl` solo distingue activo/inactivo, asi que migrarla
// habria borrado el aro — que es justo la referencia para saber donde estas
// parado cuando navegas hacia atras en el año.
//
// Lo que si le faltaba: cada celda decia solo "Ene", sin el año, y nada
// indicaba cual es hoy. Ahora `aria-label` dice "Enero de 2026" y el mes
// actual lleva `aria-current`.
//
// Verificado en vivo: el disparador dice "julio de 2026" con
// `aria-expanded=false`, la rejilla tiene sus 12 celdas con nombre completo y
// Jul marcado con `aria-current="date"`.
//
// Botones a mano: 67 → 62.

// v2.126.0 — D3.3: cuatro acciones mas.
//
//   · "Imprimir Nuevo Carne" (FormNovedad) — tenia su `bg-chart-8-solid` a
//     mano; ahora es `tone`.
//   · Confirmar archivar/reactivar un turno — el color decia cual de las dos
//     acciones era; sigue diciendolo con `tone` danger/success.
//   · Las cajas de FinalizarCajasModal → `FilterBar.Chip`. Son seleccion
//     MULTIPLE (un pedido puede ir en varias cajas), asi que no es
//     `SegmentedControl`.
//   · El tipo de solicitud ya elegido, en su forma compacta. Llevaba el color
//     del tipo por `${conf.color} ${conf.border}` y un `Badge` adentro; ahora
//     el color sale de `tone` + `soft` y el badge se queda como hijo.
//
// Botones a mano: 71 → 67.

// v2.125.0 — D3.3: siete interruptores y tres grupos de eleccion.
//
// ── Interruptores (7) ────────────────────────────────────────────────────
// Pausar/Reanudar de Facturacion (×2), modo global de pedidos, devolutivo y
// SRS del catalogo, ND de la politica de vencimiento, "ver anteriores" de mis
// solicitudes y el modo edicion de una sucursal. Todos ganan `aria-pressed`:
// antes el estado vivia solo en el color.
//
// En TabGenerar el comentario del codigo documentaba un bug de contraste
// (pastilla blanca con texto invisible en dark, v2.62.4). Ese bug deja de ser
// posible: el color lo pone el tema via `tone`, no un `bg-surface-card` opaco
// escrito a mano.
//
// ── Grupos de eleccion (3) ───────────────────────────────────────────────
//   · presets del catalogo → `SegmentedControl`
//   · sucursales del alcance de una encuesta → `FilterBar.Chip`, porque es
//     seleccion MULTIPLE: un `radiogroup` diria "1 de 6" para algo donde
//     pueden estar las seis.
//   · el selector de tipo de solicitud → `SegmentedControl layout="block"`,
//     que existia justo para estas tarjetas. Falto agregarle `stacked` (icono
//     arriba del texto) para no cambiarles la forma, y el radio de tarjeta:
//     una tarjeta alta con `rounded-btn` sale con forma de pastilla.
//     El color POR TIPO se conserva — `tone` acepta valor por opcion.
//
// ── Un error que solo se vio mirando ─────────────────────────────────────
// Deje el `<div className="grid grid-cols-3">` original envolviendo al
// `SegmentedControl`, que en bloque YA ES una grilla. Resultado: las seis
// tarjetas metidas en una sola celda, a un tercio del ancho y con las
// etiquetas encimadas. Build verde, lint verde, gate verde. Solo aparecio en
// la captura.
//
// Botones a mano: 82 → 71.

// v2.124.0 — Los otros tres destinos que eran botones.
//
// Despues del menu (v2.123.0), un barrido por todo `src/` buscando
// `<button onClick={() => navigate(…)}>` dejo tres mas:
//
//   · **el buscador ⌘K** — cada resultado es un destino. Como `<button>` no se
//     podia abrir en otra pestaña. El teclado (↑↓ + Enter) no cambia: siempre
//     lo manejo el contenedor, no cada fila.
//   · **la tarjeta de sucursal** — su encabezado abre la ficha. El `onClick` se
//     queda solo para dejar la sucursal activa en el store, y para eso hizo
//     falta bajarle el callback a la tarjeta en vez de duplicar el navigate.
//   · **la alerta de sucursal del Inicio** — esta tenia un problema aparte: sin
//     permiso era un `<button>` con `onClick` INDEFINIDO, o sea una parada de
//     tabulacion que no hacia nada. Ahora con permiso es un enlace y sin
//     permiso es un `<div>`, que es lo que de verdad es.
//
// Verificado en vivo: ⌘K da `<a href="/payroll">` y Enter sigue navegando; las
// 8 tarjetas de /branches son enlaces a su ficha y el clic funciona; 0 botones
// sin nombre, 0 errores.
//
// Botones a mano: 85 → 82.

// v2.123.0 — El menu entero eran botones. Navegar no es una accion.
//
// Los 9 `<button>` a mano de `AppLayout` resultaron ser TODOS lo mismo:
// `<button onClick={() => navigate(path)}>`. Y ese es el elemento equivocado
// —un enlace no es un boton— con tres consecuencias que la gente encuentra
// todos los dias:
//
//   · ⌘/Ctrl+clic y el boton del medio NO abrian en otra pestaña
//   · el navegador no mostraba a donde lleva antes de pulsar
//   · un lector de pantalla anunciaba "boton" para los 36 enlaces del menu
//
// Convertidos a `<Link>` de react-router: el item del menu, el submenu, los
// tres accesos al perfil, la barra inferior de movil, los tres flyouts y el
// logo. El aspecto no cambia una linea; el `onClick` se queda solo para lo que
// SI es un efecto secundario (cerrar el panel en movil y el flyout).
//
// Verificado en vivo, escritorio y WebKit movil:
//   · 36 enlaces con `href` real apuntando a su ruta
//   · `aria-current="page"` en el activo
//   · el clic normal sigue siendo SPA — no recarga la pagina
//   · **⌘+clic abre una pestaña nueva**, que es exactamente lo que antes era
//     imposible
//   · en movil el panel se cierra al tocar un item (x pasa de 8 a -288)
//
// Botones a mano: 94 → 85.

// v2.122.0 — D3.3: el caso mas claro de por que existe esta fase.
//
// `EncuestaAdminView` tenia un `SegmentControl` propio —el canonico reescrito
// clase por clase— **en un archivo que YA importaba `SegmentedControl` y lo
// usaba cinco veces**. No es que faltara el componente: es que nadie lo busco
// antes de escribir otro. Sus tres usos migrados, el duplicado borrado.
//
// Tambien:
//   · TabPromos: cuatro filtros excluyentes con su propio activo y su propio
//     contador → `SegmentedControl`, con el contador en el label.
//   · FilterPill (pedidos): `statusBtn` era `FilterBar.Chip` EXACTO — se apaga
//     al volver a pulsarlo, y hasta dibujaba la × cuando esta activo, que es
//     lo ultimo que hacia a mano. El `activeClass` de tres clases pasa a ser
//     un `tone`.
//
// Verificado en vivo: /encuesta-admin muestra los 5 grupos como `radiogroup`
// con su etiqueta y su marcado ("Estado de la encuesta: Borrador | Activa✓ |
// Cerrada | Archivada"), /promociones el suyo, 0 botones sin nombre, 0
// errores.
//
// Botones a mano: 97 → 94.

// v2.121.0 — D3.3: acciones sueltas y la familia "chip que enciende un panel".
//
// Ocho botones mas al canonico, en dos familias:
//
// ── Acciones planas ─────────────────────────────────────────────────────
//   · copiar la contrasena generada (EmployeeDetailView) — era un cuadrado de
//     40px con su propio verde de "copiado"; ahora `tone` lo dice.
//   · "Volver" del modal de cancelar evento. Traia un `hidden` DENTRO del
//     className para desaparecer mientras cancela; ahora lo decide el propio
//     condicional, que es donde va.
//   · "Ver Detalle" de un aviso. Su color codificaba el ESTADO de lectura
//     (urgente sin leer / completo / programado) reescribiendo borde y relleno
//     de cada caso; con `tone` + `soft` eso lo dice el canonico.
//
// ── "Chip que enciende un panel" ────────────────────────────────────────
// Cinco toggles con la misma idea y cinco anatomias distintas: agregar
// feriado, recurrente, personalizar el Inicio, filtrar la linea de tiempo,
// ver todos en la red min/max.
//
// Lo que ganan no es el borde: es que ahora DICEN su estado. Un panel que se
// abre lleva `aria-expanded`, un modo que se prende lleva `aria-pressed`.
// Antes el estado vivia solo en el color de fondo, o sea que no existia para
// quien no lo ve.
//
// Verificado en vivo: Personalizar y Filtrar alternan `aria-expanded`
// false→true con su cambio de color; "Ver todos" arranca en
// `aria-pressed=false` y cambia su texto a "Solo alertas"; "Agregar feriado"
// pasa a "Cancelar".
//
// Botones a mano: 105 → 97.

// v2.120.0 — VentasView: sus tres tablas y sus chips de filtro.
//
// `DataTable` quedo arreglado en v2.119.0, pero esta vista tiene TRES tablas y
// dos son propias:
//   · `SortTh`  ya usaba `<button>` (por eso se descubrio el defecto del
//     canonico), pero le faltaban `aria-sort` y un nombre.
//   · `DH`, el encabezado del drill-down, era un `<th onClick>` pelado —
//     exactamente el defecto que el canonico acababa de perder.
//
// Y los chips de filtro del drill pasan a `FilterBar.Chip`, que YA EXISTIA y
// tenia 4 usos en todo el proyecto. Es el canonico correcto y no
// `SegmentedControl`: varios pueden estar prendidos a la vez, asi que un
// `radiogroup` mentiria diciendo "1 de 3".
//
// ── Y una correccion de algo que hice mal en v2.117.0 ────────────────────
// Al boton de ocultar producto le puse `aria-pressed={!showHidden}` y estaba
// MAL: `showHidden` filtra la tabla entera, o sea que todas las filas dirian
// lo mismo. No es un interruptor de dos estados, es una accion cuyo texto ya
// depende del modo. Se quita; el `aria-label` ya dice que va a pasar.
//
// Verificado en vivo en /ventas: 16 encabezados ordenables entre las dos
// pestañas, los 16 con `<button>` y `aria-sort`, 0 botones sin nombre, 0
// errores. Los chips del drill quedan verificados POR CODIGO: son un cambio
// 1:1 a `FilterBar.Chip`, que renderiza en vivo en esa misma vista (los chips
// "Anuladas" y "Receta Medica"), pero abrir el drill exige un producto con
// lineas en el rango y no se logro en el arnes.

// v2.119.0 — Ordenar una tabla era solo de raton. En las 12 vistas.
//
// Tercera vez esta semana que el defecto esta en el canonico y no en la vista,
// y esta se descubrio de la forma mas ironica posible: migrando los botones a
// mano de VentasView, que tiene su PROPIO encabezado ordenable escrito a
// mano... y ese si usa `<button>`. El canonico era MENOS accesible que lo que
// venia a reemplazar.
//
// `DataTable` ponia el `onClick` en el `<th>` mismo: sin `<button>`, sin
// `tabIndex`, sin manejador de teclas y sin `aria-sort`. O sea:
//
//   · con teclado NO se podia ordenar ninguna tabla del portal
//   · el estado de orden solo existia en la flecha dibujada — un lector de
//     pantalla no tenia forma de saber por que columna esta ordenado
//
// Son **62 columnas ordenables en 12 vistas**, arregladas de una sola vez.
//
// Dos decisiones del arreglo:
//   · `aria-sort` va en el `<th>` (es lo que la norma espera) y el nombre del
//     boton dice que PASARA al pulsar ("Ordenar por Usuario, ascendente"), no
//     el estado actual. Ponerlo en los dos lados lo haria sonar dos veces.
//   · `flex-row-reverse` cuando la columna es de alineado derecho, para que la
//     flecha no se despegue del texto.
//
// Verificado en vivo en /auditview: 3 columnas con `aria-sort`, el foco cae en
// el boton con su aro, Enter alterna descending→ascending, la etiqueta se
// actualiza y la tabla se reordena de verdad.

// v2.118.0 — D3.3: el control unido de Facturacion y cinco grupos uno-de-N.
//
// ── ChipDoc: el mismo control escrito CUATRO veces ────────────────────────
// FacturacionView tenia 9 `<button>` a mano y siete eran el mismo control
// repetido: facturas pendientes, pendientes-MH, saltos de correlativo y
// anuladas con campos nulos. Los cuatro con la misma anatomia —copiar el id │
// etiqueta del medio │ resolver— y la misma cascada de ternarios de color,
// cada copia con un estado de mas o de menos.
//
// NO pasa por `Button` a proposito: son tres segmentos PEGADOS dentro de un
// borde comun (`items-stretch` + `border-r`), y el canonico le daria a cada uno
// su radio y su sombra, rompiendo la union. Lo que se arregla es que exista una
// sola definicion, y que el color deje de ser una cascada de ternarios y pase a
// ser una TABLA. Mismo cambio que `SUC_COLORS` en TabSinVenta: si el estado
// tiene nombre, el color se busca; si no, se reescribe en cada copia.
//
// Un hallazgo al unificar: el chip de los saltos NO tiene boton de copiar —su
// primer segmento es un rango de solo lectura— y estaba igual escrito como
// `<div>`. Ahora `ChipDoc` lo contempla: sin `onCopiar` ese segmento no es un
// boton, asi que un dato de solo lectura no recibe foco ni voz de control.
//
// ── Cinco grupos uno-de-N al canonico ────────────────────────────────────
//   · TabShifts            Activos / Archivo
//   · ScheduleChart        Horas / Dias
//   · FormPurchaseDteViewer Detalle / PDF
//   · EmployeeRequestsView  las 4 pestanas de estado
//   · ConteoDetailView      Todos / Pendientes / Con diferencia
//
// Lo que ganan no es solo la forma: `SegmentedControl` es un `radiogroup` con
// `aria-checked`, asi que un lector de pantalla dice "Estado de las
// solicitudes, Pendientes, seleccionado, 1 de 4". Antes decia "boton" cuatro
// veces y el estado solo existia en el color de fondo.
//
// Verificado en vivo los cinco riel por riel, y las cuatro pestanas de
// Facturacion con sus chips: 0 botones sin nombre, 0 errores.
//
// Botones a mano: 119 → 106.

// v2.117.1 — El mapa de nombres se muda a `common/iconNames.js`. Exportar una
// constante desde un archivo de componente rompe el Fast Refresh de React
// (`react-refresh/only-export-components`): al editar el mapa, Vite recargaba
// la pagina entera en vez de sustituir el componente. Sin cambio de conducta —
// reverificado en vivo, 265 botones, 0 sin nombre.

// v2.117.0 — D3.3, capa de accesibilidad: 109 botones que no decian nada.
//
// Empezo buscando `<button>` de solo icono sin `aria-label`. Contarlos costo
// TRES intentos, y los tres errores son la misma familia de trampa de siempre:
//
//   1º  borrar `{…}` a ciegas → un boton cuyo texto sale de una variable
//       (`{tab.label}`) parecia vacio: 44 falsos positivos.
//   2º  conservar identificadores → la CONDICION de un ternario
//       (`{isSolving ? <X/> : <Check/>}`) parecia contenido: daba 1.
//   3º  quitar condiciones y guardas antes de mirar el residuo → 8, de los
//       cuales 7 son defecto real y 1 es un chevron `aria-hidden` deliberado.
//
// Los 7 eran INTERRUPTORES (resolver una factura, ocultar un producto, el modo
// privacidad). Ademas del nombre les faltaba `aria-pressed`: sin el, el estado
// solo existe en el color del icono.
//
// ── Y entonces el gate encontro lo grande ────────────────────────────────
// Al volverlo categoria del gate aparecieron 7 mas en `components/common/`,
// que mi clasificador excluia. Son los CANONICOS — ViewTabBar (buscar, cerrar
// el buscador, borrar, cerrar filtros), SearchInput (borrar ×2), LiquidSelect.
// Un nombre que falta ahi se multiplica por cada vista del portal.
//
// Y midiendo eso salio lo de verdad grande: **102 de los 194 `iconOnly` del
// proyecto no tenian nombre**. La distribucion decidio el arreglo:
//
//     56 × X   ·   12 × ChevronLeft   ·   9 × ChevronRight   ·   5 × Trash2
//
// 77 de 102 son cuatro iconos cuyo significado no admite duda. Con eso, el
// arreglo correcto es UNO —que `Button` derive el nombre del icono cuando no
// se lo dieron— y no 102 ediciones. No es pereza: un boton cuyo unico
// contenido es una `X` significa "cerrar" en todas partes, y que cada llamador
// tenga que repetirlo es justamente por lo que 102 se lo saltaron. Quien tenga
// algo mas especifico que decir pasa su `aria-label` y gana: es el piso.
//
// Dos casos que el mapa no cubria y se arreglaron a mano:
//   · El boton de contraer el menu pasaba el icono como CHILDREN, no por
//     `icon`, asi que el canonico no lo veia. Ahora dice "Contraer el menu" /
//     "Expandir el menu" / "Cerrar el menu", que es mejor que el automatico.
//   · `StatCard` ponia `aria-label={loading ? undefined : …}` — mientras carga
//     el contenido es un spinner, o sea que se anunciaba como "boton" y nada.
//     Ahora dice "<etiqueta>: cargando" y lleva `aria-busy`.
//
// `button-name` nace en **0 y bloqueante**, igual que `input-label`.
//
// Verificado en vivo: **1,340 botones en 14 vistas, 0 sin nombre accesible.**

// v2.116.0 — D3.4 en el formulario de nomina, que es el de mas riesgo.
//
// `FormEditPayrollEntry` ya sacaba 11 campos de `PortalInput` via `numField`,
// pero tres seguian escritos a mano con `<InputLabel>` + `<input
// className={glassInput}>`. Eso es el canonico reconstruido clase por clase:
// la etiqueta, el alto, el borde, el glow. En el mismo formulario, once campos
// pasaban por el componente y tres no, y se notaba.
//
// Migrados los tres. `InputLabel` y `glassInput` se fueron con ellos.
//
// ── La prueba de por que el arreglo de v2.115.0 tenia que ir primero ──────
// "Dias Trabajados" lleva `min="0" max="16" step="0.5"`. Verificado en vivo en
// el editor: los tres atributos SIGUEN en el DOM despues de migrar. Antes del
// `...rest` el campo habria perdido su tope de 16 dias sin que fallara nada, y
// una quincena mal capturada en nomina no es un detalle visual.
//
// De paso, el asterisco rojo a mano de "Motivo de edicion" era una convencion
// inventada en este archivo; ahora usa el badge "Requerido" del canonico, que
// es lo que muestra el resto del portal.
//
// ── Los cuatro que NO se migran, y por que ───────────────────────────────
// Los del banco de horas. El color del borde no es decoracion: dice de que
// bolsa sale la hora (diurna ambar, nocturna chart-3) y que se hace con ella
// (compensar, chart-1). `PortalInput` no tiene eje de color, asi que migrarlos
// borraria el dato. Queda anotado en el bloque.
//
// Verificado en vivo con un periodo y una entrada SINTETICOS interceptados en
// red — no se escribio nada en la base. Los 14 campos del editor tienen ahora
// etiqueta asociada por `<label for>`; cero errores.
//
// Inputs fuera del canonico: 102 → 99.

// v2.115.0 — D3.4 era una migracion con trampa. Ya no.
//
// `PortalInput` aceptaba una lista FIJA de props y tiraba en silencio todo lo
// demas. Medido sobre los 104 `<input>` que faltan migrar:
//
//     54 de 104 (51%) usan al menos un atributo que el canonico NO acepta
//     min 38 · aria-label 22 · step 18 · max 13 · ref 6 · inputMode 2
//
// Traducido: migrar un campo de cantidad de nomina le habria quitado su rango
// (`min`/`max`/`step`) y alguien habria podido escribir -5 o 3.7 donde no va.
// Y los 22 con `aria-label` habrian PERDIDO su nombre accesible — justo los
// que D3.4 acababa de arreglar. Sin que fallara el build, ni el lint, ni el
// gate. El plan avisaba que "migrar estos a velocidad de script es la forma
// mas rapida de romper la captura de datos de la empresa"; esta es la razon
// concreta, y estaba en el canonico, no en las vistas.
//
// Ahora `PortalInput` y `PortalTextarea` reenvian `...rest`. Va PRIMERO en el
// elemento a proposito: lo que el componente gestiona (id, type, value,
// onChange, className, el estado de error) gana siempre, y lo del llamador
// llena los huecos. Unica excepcion, `aria-describedby`: se fusiona, porque si
// el campo no esta en error el valor del llamador tiene que sobrevivir.
//
// Primera migracion real con esto, en CotizacionesView: Cantidad y P. Unitario
// llevaban un `<label>` suelto SIN `htmlFor` —no estaba asociado al campo, por
// eso el `aria-label` de parche— mas `min`/`step`. Verificado en vivo: los dos
// atributos llegan al DOM y la etiqueta ahora la asocia `<label for>` de
// verdad.
//
// Barrido aparte: de los 38 canonicos de common/, `Badge` era el unico donde
// no reenviar props causaba una perdida real hoy. El resto toma props
// explicitas por diseno (un modal no necesita atributos arbitrarios).

// v2.114.0 — D3.5 `Badge` re-medido, y un componente que tragaba props.
//
// El plan tenia D3.5 como "abierta — el conteo no se re-midio". Medido hoy:
// **110 chips a mano en 51 archivos** (eran 249 en la medicion original), y
// otra vez CUATRO radios para una sola idea: full 62 · md 30 · lg 14 · xl 4.
//
// ── El hallazgo que importa: `Badge` tragaba props ────────────────────────
// No tenia `...rest`. Los chips de TabSinVenta llevaban `title={detalle}` con
// la explicacion de POR QUE el producto cae en esa categoria ("Tiene Min/Max
// asignado pero sin stock fisico — reabastecer"). Al pasarlos al canonico ese
// tooltip habria desaparecido y NADA habria fallado: ni el build, ni el lint,
// ni el gate. Es el mismo tipo de bug que el `presentaciones.descripcion` del
// sync — una perdida silenciosa que vive semanas.
//
// ── TabSinVenta: dos paletas que eran el canonico copiado a mano ──────────
// `SUC_COLORS` y el campo `cls` de `getSuggestion()` mapeaban cada estado a
// TRES clases de Tailwind. Comparadas contra `SOFT` de Badge, eran 1:1 — la
// misma paleta, escrita otra vez. Ahora guardan el NOMBRE de la variante y el
// color lo pone el canonico: agregar una sucursal es una linea, no tres clases.
// (Una de las siete tenia `border-danger/40` donde el resto usa /30. Nadie lo
// habria visto nunca; es exactamente la deriva que el canonico existe para
// eliminar.)
//
// ── Y el conteo de botones estaba inflado ─────────────────────────────────
// El clasificador no blanqueaba comentarios `//`, asi que contaba la palabra
// `<button>` escrita en PROSA. Mismo agujero que ya costo dos conteos en el
// gate de `input-label` (80 → 29 → 22). Corregido: **126 → 120**.
//
// Verificado en vivo en /productos?tab=sinventa: 157 chips, 93 conservan su
// tooltip, 8 colores distintos, cero errores.

// v2.113.0 — La fila clickeable no existia para el teclado.
//
// Salio de migrar los botones de ComprasView: habia un `<button>` SIN onClick.
// Recibia el foco, se anunciaba como boton y al pulsar Enter no pasaba nada.
// Mirando por que, aparecio lo de fondo: `DataRow` es un `<tr onClick>` sin
// `tabIndex` ni manejador de teclas, o sea que la fila clickeable NUNCA fue
// alcanzable por teclado — en ninguna tabla del portal.
//
// Medido antes de tocar nada: 11 filas clickeables en 8 vistas, y **9 no tienen
// un solo elemento interactivo adentro**. No es que fuera incomodo: la accion
// entera (abrir el detalle de una compra, de un conteo, de una promocion) no
// existia sin mouse. WCAG 2.1.1.
//
// El arreglo va en `DataRow` y no vista por vista porque el defecto es del
// componente: `tabIndex={0}` cuando hay onClick, mas Enter/Espacio. El aro de
// foco no hay que declararlo — `[tabindex]:focus-visible` ya lo pinta desde el
// canonico de index.css.
//
// Dos detalles que importan:
//   · La guarda `e.target !== e.currentTarget` — sin ella, el Espacio sobre un
//     boton de adentro dispararia tambien el click de la fila.
//   · NO se le pone `role="button"` al `<tr>`: eso lo sacaria de la estructura
//     de la tabla para un lector de pantalla. Se queda como fila, activable.
//
// El costo honesto es una parada de tabulacion por fila. Es asumible porque
// estas tablas paginan (TablePagination es canonico): son ~15-50 filas, no 200.
// Y la alternativa era que la funcion no existiera.
//
// El chevron de ComprasView vuelve a ser lo que siempre fue: un `<span
// aria-hidden>` que indica el estado. Quien abre es la fila.
//
// Verificado en vivo en /compras: 50 filas enfocables, aro de 2px, Enter
// expande (aria-expanded=true y el detalle se renderiza), el click del raton
// sigue igual y no queda ningun boton muerto en el tbody.

// v2.112.0 — Los 9 "guardar" del formulario lateral, y una familia que no era.
//
// El clasificador los marcaba como "uno de N" y NO lo eran: el ternario que
// leia como estado seleccionado era el del MODO (crear azul / editar ambar /
// confirmar verde). Nueve botones, una sola anatomia repetida a mano:
//
//     w-full py-4 rounded-2xl font-black uppercase tracking-widest
//     + un Loader2 propio + el color segun el modo
//
// El canonico ya cubre las cuatro cosas: `size="lg"` son exactamente los 48px
// que tenian, `tone` da ambar y verde, `loading` reemplaza al Loader2 escrito a
// mano, y `icon` a los <Save/> sueltos. Lo unico que PIERDEN es el
// `uppercase tracking-widest`, que es justo la decision aprobada en T2.3
// ("las mayusculas leian 'dashboard 2016'") — eran los ultimos nueve que
// seguian sin aplicarla.
//
// ── Lo que aparecio al migrarlos ──────────────────────────────────────────
// En RequestsView el "Cancelar" de al lado YA era canonico, asi que los dos
// botones del pie del modal tenian ALTURAS DISTINTAS (40px contra ~44px).
// Ahora los dos miden 40 y comparten linea base. No se veia hasta medirlo.
//
// ── Hallazgo aparte: FormTurnos es inalcanzable ───────────────────────────
// `manageShifts` esta definido en UnifiedModal (titulo, ancho, icono, render)
// y NADA en todo el codigo lo abre. Son 365 lineas que ademas duplican la
// pestana "Catalogo" de Horarios, que si esta viva y es mas completa. El
// CHANGELOG ya lo habia anotado dos veces (v2.17.28 y antes) sin que nadie
// actuara. NO lo borro: `updateShiftFlags` solo existe ahi, o sea que borrarlo
// se lleva la unica UI de esas banderas. Queda migrado y anotado — la decision
// de borrar es del usuario, no mia.
//
// Verificado en vivo 8 de 9 (avisos, cargos, vacaciones, encuestas, turnos y
// los dos del modal de solicitudes, estos con una fila sintetica interceptada
// en red). El CTA "estoy al dia" de Mis Avisos quedo verificado por codigo: sus
// datos vienen en el payload de boot, no en un GET propio que se pueda
// interceptar.

// v2.111.0 — Una casilla simulada con `<button>` y un grupo partido en dos.
//
// `FormPlanificador.BeautifulCheckbox` era una CASILLA ESCRITA A MANO con un
// `<button>`: caja de 16px, un `<Check>` adentro y un `theme` que solo elegia
// entre dos colores de relleno. El canonico `Checkbox` es exactamente eso —y
// ademas renderiza un `<input type="checkbox">` REAL, asi que un lector de
// pantalla lo anuncia como casilla y no como boton, y la barra espaciadora lo
// marca. Antes ninguna de las dos cosas pasaba.
//
// El `theme` se descarta a proposito: las dos instancias (almuerzo naranja,
// lactancia rosa) usaban color solo para diferenciarse entre si, y ya viven
// dentro de secciones con su propio encabezado de color.
//
// ── Y en FormWfmAnalytics, un grupo partido en dos ────────────────────────
// La fila de los 7 dias YA era un `SegmentedControl`; la de arriba
// ("Semana | General (Hr)") seguian siendo dos `<button>` sueltos. **Las dos
// controlan el MISMO `activeView`.** Es el mismo hallazgo que el
// `<button>Todos</button>` suelto de EmployeeProfileView: media opcion de un
// grupo se quedo fuera del grupo.
//
// Se dejan como dos `SegmentedControl` y no como uno solo porque 2 + 7
// opciones no entran en una fila; cada `label` dice cual es cual.

// v2.110.1 — Medida la duplicacion de `filtersContent`: no vale arreglarla, y
// mi anotacion anterior era enganosa.
//
// Preguntado por el usuario: "¿que ganamos al corregir esto?". La respuesta
// honesta, medida y no estimada: **casi nada.** Las cuatro sospechas se
// cayeron una por una:
//
//   accesibilidad  `display:none` SI saca del arbol → 2 en el DOM, 1 alcanzable
//   listeners      `useSearchToggle`/`LiquidSelect` registran solo al ABRIR
//                  (`if (!active) return`) → contados envolviendo
//                  `addEventListener`: CERO de mas
//   rAF            el bucle de posicionamiento depende de `isOpen` → cero de mas
//   estado         con el buscador abierto y "pedialyte" escrito, al achicar a
//                  390px el filtro SIGUE aplicado y la lupa movil muestra su
//                  punto rojo. No se pierde nada
//
// Costo real: DOM duplicado — 14 nodos en /audit, 42 en /requests, 61 en
// /productos, sobre vistas de miles. Unificarlo tocaria las 34 vistas que usan
// la prop para ganar eso.
//
// ── Y lo importante: corrijo lo que YO habia escrito ──────────────────────
// Mi comentario en `GlassViewLayout` decia que "abrir el buscador en
// escritorio y achicar la ventana deja el de movil cerrado". Es LITERALMENTE
// CIERTO Y ENGANOSO: el buscador colapsa, si, pero eso es lo correcto en
// movil, el filtro sigue puesto y hay senal visual.
//
// Lo habia dejado EN EL CODIGO FUENTE, donde el proximo lo iba a leer como un
// defecto conocido y quizas gastar un dia en "arreglarlo". Reemplazado por los
// cuatro numeros de arriba. Una alarma que se investiga y se descarta tambien
// es trabajo — pero hay que descartarla del todo, no dejarla a medias.

// v2.110.0 — Las 5 pestañas de la ficha de empleado, y una alarma que resulto
// infundada.
//
// `EmployeeDetailView` tenia sus 5 pestañas escritas a mano con una PILDORA
// DESLIZANTE propia: un `<div absolute>` cuyo `translateX` salia de una cadena
// de cinco ternarios y cuyo ancho era `w-[calc(20%-2px)]`. O sea que agregar
// una sexta pestaña rompia la aritmetica **en silencio** — el indicador
// quedaria corrido y nadie lo veria hasta mirarlo. Y su fondo era `bg-white`
// FIJO: en los dos temas oscuros, una pildora blanca.
//
// `SegmentedControl` ya modela esto y trae el `role="radiogroup"` que faltaba.
//
// ── Y una alarma que investigue y resulto infundada ───────────────────────
// Al verificar aparecieron DOS `radiogroup` con el mismo nombre, y pense que
// era un bug de accesibilidad: `GlassViewLayout` renderiza `filtersContent`
// dos veces, una rama para escritorio y otra para movil.
//
// Medido antes de "arreglarlo": las ramas se ocultan con `hidden lg:block` /
// `lg:hidden`, y **`display:none` SI saca del arbol de accesibilidad** — 2 en
// el DOM, 1 alcanzable. No hay duplicado para un lector de pantalla.
//
// Lo que si es real, y queda anotado en el propio archivo: son dos INSTANCIAS
// de React con estado propio (abrir el buscador en escritorio y achicar la
// ventana deja el de movil cerrado), y todo el contenido se renderiza dos
// veces por render. Unificarlo toca las 34 vistas que usan la prop.

// v2.109.2 — Tres enlaces de accion de TabCatalogo al canonico.
//
// "Cambiar foto", "Mostrar N inactivas" y "Ver N cambios anteriores" eran
// `<button>` con la MISMA cadena de clases —`text-caption font-bold
// transition-colors text-content-3 hover:text-content-2`— y encima envuelta
// en un template literal con una interpolacion CONSTANTE
// (`${'text-content-3 hover:text-content-2'}`), que es lo que hizo que el
// migrador automatico de v2.76.0 los saltara: veia `${` y se detenia.
//
// Son `Button variant="ghost" size="xs"`. Verificado en vivo expandiendo una
// fila del catalogo.

// v2.109.1 — Los pares OK/Falta de los dos modales de llegada.
//
// `LlegadaModal` y `ReenvioLlegadaModal` tienen, por cada caja especial, un
// par "✓ OK / ✗ Falta" escrito como dos `<button>` con `est === 'ok' ? … : …`.
// Es un uno-de-N: con `SegmentedControl` la caja se lee como UN control con
// dos estados y no como dos acciones sueltas, y el lector de pantalla anuncia
// "1 de 2".
//
// VERIFICADO POR CODIGO, no en vivo: estos modales solo se abren desde un
// pedido en estado "en ruta", y ahora mismo no hay ninguno. El cambio es
// identico —misma forma, mismos dos valores— al de EncuestaAdminView, que si
// se verifico en vivo hoy. Queda anotado como tal, no como "hecho y visto".

// v2.109.0 — Los 7 encabezados de FacturacionView, y como se desbloqueo.
//
// En v2.105.0 migre estos 7 encabezados a `ListRow`, compilaban, pasaban el
// lint — y **los revertí**, porque la cuenta no tiene facturas anuladas en
// ninguna pestaña ni mes y no habia forma de mirarlos en el navegador. Dije
// que hacia falta "una cuenta o un mes con datos".
//
// Estaba equivocado: **hacia falta interceptar la red**. `page.route()` de
// Playwright deja responder la consulta de PostgREST con filas sinteticas, sin
// tocar una linea de codigo de produccion ni escribir en la base. Doce
// facturas en dos sucursales y dos fechas, una con CCF, alcanzan para que las
// cabeceras tengan que pintar su badge, su tono de peligro y su contador.
//
// La leccion no es sobre facturacion: **"no hay datos para verificar" casi
// nunca es el final del camino.** Los datos de una vista entran por HTTP, y
// eso se puede responder.
//
// Migrados: 3 cabeceras de historial (icono en caja + titulo + subtitulo) y 4
// agrupadores de sucursal (icono suelto + nombre + badge + contador). Los 7
// eran `ListRow` con el chevron en `trailing`, escritos a mano con dos
// anatomias y cuatro rellenos distintos.
//
// Verificado contra una captura del ANTES: mismas agrupaciones, mismo badge
// CCF, mismo tono rosado en la sucursal con CCF, mismo contador.

// v2.108.0 — La barra numero 13, y una opcion que estaba fuera de su grupo.
//
// `EmployeeAnnouncementsView` tenia la barra de vista REESCRITA A MANO — la
// treceava. Su propio `useSearchToggle`, sus dos mitades colapsables con
// `inert`, su punto rojo de "hay busqueda activa" y su boton de lupa. Al
// migrarla a `ViewTabBar` quedaron **tres refs huerfanos**, que es la prueba
// de que era duplicado y no personalizacion. Y de regalo gana el colapso
// tactil en hoja inferior, que esta copia no tenia.
//
// Sus subfiltros de "Leidos" —que se deslizaban DENTRO de la misma barra con
// un `max-w-0` que los escondia a medias— son un uno-de-N: ahora van en
// `trailingActions` como `SegmentedControl`.
//
// ── Y en `EmployeeProfileView`, una opcion fuera de su propio grupo ────────
// El filtro de tipo de evento tenia un `<button>Todos</button>` SUELTO al lado
// de un `SegmentedControl` con el resto. Visualmente parecia una opcion mas;
// para un lector de pantalla el grupo decia "1 de 4" cuando hay 5 opciones, y
// "Todos" ni siquiera figuraba como parte del conjunto.
//
// Es un error facil de cometer —la opcion "todos" se siente distinta de las
// demas— y solo se ve preguntando que anuncia el grupo, no mirandolo.

// v2.107.1 — Los 8 bloques de encuesta a `ListRow`.
//
// Las cabeceras de bloque del formulario de respuestas ("G · Datos Generales
// 0/1", "B2 · Liderazgo Directo 0/11") estaban escritas a mano. Son `ListRow`
// con la ranura `leading` — que acepta una LETRA y no solo un icono, y que se
// agrego al canonico precisamente por estos bloques.
//
// Verificado en vivo navegando hasta el formulario: los 8 bloques con su
// letra, su nombre, su contador y su chevron, identicos a antes.

// v2.107.0 — Dos filas del Inicio a `ListRow`, y un detalle que solo el
// canonico arregla.
//
// Las listas de "Solicitudes pendientes" y "Avisos" del Inicio eran la
// anatomia exacta de `ListRow` —caja de icono, titulo, subtitulo y algo al
// final— escrita a mano.
//
// Lo que gana no es solo consistencia: **sin `onClick`, `ListRow` renderiza un
// `<div>`, no un `<button>`**. Esas filas solo navegan si el usuario tiene
// permiso (`canManage`), y cuando no lo tiene el codigo pasaba `onClick =
// undefined` sobre un `<button>`: quedaba una parada de tabulacion que no
// hacia nada. Ahora, sin permiso, la fila directamente no es enfocable.
//
// Es la misma regla que ya trajo `Switch` (sin `onChange`, un `<span>`) y la
// misma clase de bug que el `<button>` anidado de AttendanceAudit: **un
// control que no hace nada no debe ser un control.**

// v2.106.1 — El changelog sale de `src/`: 805 KB → 9 KB.
//
// Este archivo lo importa `AppLayout` para pintar la version en el pie del
// menu, y habia crecido a **805 KB** con 1,012 entradas de changelog. Los
// comentarios NO llegan al bundle —verificado: cero coincidencias en `dist/`—
// asi que no era peso para el usuario. Lo que si costaba:
//
//   · babel se deoptimizaba en CADA build ("exceeds the max of 500KB")
//   · eslint lo recorria entero en cada pasada
//   · y era imposible de leer: para ver la ultima entrada habia que abrir
//     780 KB de JS
//
// Las 1,012 entradas pasan a `CHANGELOG.md` en la raiz, en markdown legible
// (sin el `// ` delante de cada linea). Acá quedan las 6 mas recientes, que es
// lo que uno mira al retomar.
//
// Verificado que no se perdio nada: 1,012 entradas en el original, 1,012 en el
// markdown, y la primera y la ultima presentes. Y el pie del menu sigue
// diciendo la version en vivo.


// v2.106.0 — 22 campos de texto sin nombre accesible, y el gate que los pesca.
//
// Buscando por que empezar D3.4 aparecio algo mas urgente que migrar inputs a
// `PortalInput`: **campos de texto sin NINGUN nombre accesible** — ni
// `aria-label`, ni `aria-labelledby`, ni `id` que un `<label htmlFor>` pueda
// referenciar, ni `placeholder`, ni `title`. Un lector de pantalla anuncia
// "campo de edicion" y nada mas (WCAG 4.1.2 y 3.3.2).
//
// Y los peores estaban donde mas duele: **la nomina** (dias trabajados, horas
// a pagar/compensar), **la recepcion de pedidos** (cantidad facturada,
// recibida, con problema) y **Min/Max** (el valor nuevo de un parametro). Son
// campos que deciden cuanto cobra alguien o cuanto stock se pide, y quien los
// llena con lector de pantalla no sabia cual estaba llenando.
//
// Nota: tienen etiqueta VISUAL al lado; lo que falta es la asociacion
// programatica. Se ve bien y no se puede usar sin ver — que es exactamente el
// tipo de bug que ninguna captura de pantalla revela.
//
// Categoria `input-label` nueva en el gate, en CERO y bloqueante desde el
// primer dia. Y el gate mismo tuvo DOS bugs antes de dar un numero confiable,
// los dos de la misma familia que ya mordieron al clasificador de botones el
// mismo dia:
//
//   80 → 29  `<input\b[^>]*>` cortaba la etiqueta en la flecha de
//            `onChange={e => …}`, asi que el `placeholder` quedaba fuera y
//            reportaba campos que SI tienen nombre. Hay que buscar el `>` de
//            cierre contando llaves.
//   29 → 22  no blanqueaba los comentarios `//`, asi que seis menciones de
//            `<input>` EN PROSA ("reemplaza el <input> que simulaba tecleo")
//            contaban como campos.
//
// Tres veces el mismo dia el mismo par de trampas: **una etiqueta JSX no
// termina en el primer `>`, y un comentario no es codigo.**

// v2.105.1 — EncuestaAdminView: 4 botones que NO eran botones.
//
// "Rol en encuesta" (Empleado/a · Jefe/a de sala) y los dos pares de
// privacidad (Anónima/No anónima, Privado/Públicos) estaban escritos como
// pares de `<button>` con `X ? activo : inactivo` en el className. Son
// uno-de-N: `SegmentedControl`, que agrega el `role="radiogroup"` que un
// lector de pantalla necesita para anunciar "1 de 2" — antes eran dos botones
// sueltos sin relación declarada.
//
// Los dos de privacidad podrían haber sido `Switch`, y no lo son a propósito:
// cada estado tiene NOMBRE PROPIO ("Anónima" vs "No anónima"), y con un
// interruptor la opción apagada se queda sin etiqueta. Un switch dice
// "encendido/apagado"; acá las dos caras son opciones con nombre.
//
// Verificado en vivo: los dos `radiogroup` con sus opciones y el estado
// marcado correcto, y visualmente iguales a los tres segmentados que la vista
// ya tenía (Estado, Tipo de encuesta, Dirigida a).

// v2.105.0 — `StatCard`: las 12 tarjetas de metrica del portal, migradas.
//
// Y una correccion de mi propio conteo. Habia dicho "17 tarjetas de metrica
// escritas a mano"; al abrir las 5 restantes una por una, **ninguna lo era**:
//   · BranchesView ×3 → la cabecera de la tarjeta de sucursal (avatar +
//     nombre) y dos filas de contacto (telefono/celular). Son `ListRow`.
//   · LoginView ×2 → el boton de "ir al kiosco", una fila de accion.
//   · NotificationBell → una fila de notificacion.
//   · DashboardView → un FALSO POSITIVO: mi heuristica leyo un `<button>`
//     que esta dentro de un COMENTARIO JSX. Es exactamente el bug del
//     clasificador de v2.76.0, otra vez.
//
// O sea que eran 12, no 17, y las 12 estan migradas. El patron sigue siendo
// real —12 copias de la misma anatomia justifican el canonico de sobra— pero
// el numero que publique estaba inflado por una heuristica de forma
// ("caja de icono + numero") que no distingue una tarjeta de una fila.
//
// Migradas en esta tanda: TabSinVenta ×2 (los dos grupos de filtro),
// StaffManagementView (su `StaffStatCard` era el canonico con otro nombre —
// queda como envoltorio finito que solo traduce su paleta local) y TabPedidos.
//
// `StatCard` gano `className` y `style`: TabSinVenta escalona la aparicion de
// sus tarjetas con `animationDelay`, y sin eso la migracion habria tenido que
// elegir entre el canonico y la animacion.

// v2.104.0 — D3.8 CERRADA: el baseline del gate en CERO. Las 11 categorias
// quedan bloqueantes.
//
// `inline-color` de 37 a 0. Y como con las otras dos, casi ninguno era deuda
// de estilo — era **codigo que no seguia el tema**, escondido en `style`
// inline donde el barrido de clases no llega:
//
//   18  Min/Max: divisores `rgba(255,255,255,.50)` (blancos fijos: invisibles
//       en claro, una raya luminosa en oscuro), los dos fondos de aviso en
//       amarillo y naranja quemados, y la escala de intensidad de la matriz
//       ABC×XYZ en azul literal. Todo a `color-mix()` sobre el token, que
//       mantiene la escala Y sigue al tema.
//   10  brillos interiores `inset 0 1px 0 rgba(255,255,255,.9)` — blanco fijo
//       otra vez— y sombras sueltas → `--shadow-glass-1` / `--shadow-elevation-*`.
//    2  scrims de modal `rgba(0,0,0,.45)` y `.65` → `--scrim`, que ya existia.
//    3  el fallback de `var(--state-selected-overlay, rgba(0,82,204,.08))` en
//       LiquidDatePicker: **codigo muerto**. El token esta definido en `:root`,
//       asi que el fallback nunca se usaba — y era exactamente el rgba que el
//       token vino a reemplazar. Falseaba el barrido sin pintar nada.
//
// Verificado: 0 superficies casi-blancas en `dark` y `solid-dark` donde antes
// estaban todas, y las 5 rutas tocadas sin errores.
//
// Con esto el gate deja de tener baseline. Las once categorias son cero
// absoluto y bloqueante: cualquier hallazgo nuevo lo frena el gate, no la
// memoria de alguien.

// v2.103.0 — D3.8: `motion` de 5 a CERO. Los cinco eran @keyframes disfrazados.
//
// §11 dice "no agregar mas framer-motion" desde hace tiempo, pero los cinco
// archivos que quedaban no eran casos dificiles: eran animaciones de bucle
// —una moto que avanza, ruedas que giran, cajas que saltan, un escaner que
// baja, un punto que late— escritas con una libreria de 50KB porque estaba a
// mano.
//
// El argumento no es el peso. Es que **framer-motion no pasa por ninguno de
// los dos gates de movimiento**: las reglas de `[data-theme="solid"]` y de
// `prefers-reduced-motion` apagan `animation` por selector de CSS, y una
// animacion imperativa en JS no las ve. O sea que en el tema Solid —donde el
// movimiento esta deliberadamente apagado— la moto seguia andando, el nodo
// seguia latiendo y el panel seguia entrando con escala. Con `@keyframes` se
// apagan solas.
//
//   StageAnims        6 ilustraciones → 7 keyframes (`--hop` para la altura
//                     de cada caja, asi no hay 4 keyframes casi iguales)
//   LifecycleTimeline parpadeo, pulso y halo → 3 keyframes (`--glow` lleva el
//                     color de cada etapa, mismo criterio)
//   ApoioScanModal    aro del escaner → `animate-pulse`; entradas →`animate-in`
//   LabsPanel         entrada de panel → `animate-in`
//   AbcXyzMatrix      whileTap/whileHover → `active:scale` + `--lift-hover`
//
// Verificado en vivo en /pedidos: 42 nodos con `animationName: tlPulse` y
// `tlHalo` corriendo, la linea de tiempo identica a antes.
//
// Con esto `shadow-literal` y `motion` quedan en CERO y bloqueantes. El
// baseline pasa de 5 categorias a 1: solo `inline-color` (37).

// v2.102.1 — Arreglo de un error propio del commit anterior.
//
// Para comprobar que `shadow-literal` habia quedado BLOQUEANTE, le meti una
// sombra literal a proposito a `LiquidToast`, vi al gate fallar (bien) y la
// revertí con `git checkout -- LiquidToast.jsx`. Y ahi estuvo el error: ese
// checkout no deshace la prueba, deshace el archivo al ULTIMO COMMIT — o sea
// que se llevo tambien las dos sombras que YO habia migrado en esa misma
// sesion. Commiteé con el gate en rojo.
//
// La leccion no es "revisar el gate antes de commitear" (ya estaba en la
// lista): es que **una prueba destructiva sobre un archivo con cambios sin
// commitear no se deshace con `checkout`**. O se prueba sobre un archivo
// limpio, o se revierte con la edicion inversa.
//
// Y de rebote lo agarró `gate:doc`: DESIGN.md ENSEÑABA dos sombras literales
// en su ejemplo del squircle de icono (`shadow-[0_4px_12px_rgba(0,82,204,…)]`)
// — invisibles mientras la categoria tenia baseline, imposibles de ignorar
// ahora que esta en cero. Es exactamente para lo que existe ese gate.
