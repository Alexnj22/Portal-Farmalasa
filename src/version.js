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

export const APP_VERSION = '2.118.0';

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
