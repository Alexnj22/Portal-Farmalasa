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

export const APP_VERSION = '2.185.0';

// v2.185.0 — la autorizacion del kiosco se movio al servidor.
//
// Cierra las fases 1, 2 y 4 del rediseno de credenciales abierto en v2.184.0.
//
// **El problema.** Los tres caminos de autorizacion del kiosco se resolvian en
// el navegador y ninguno tenia un secreto detras: getHourlyCode() y
// getSuPinSuffix() eran Math.sin() del reloj, y el kiosk_pin del supervisor era
// SHA-256(code). La comparacion tambien era client-side. Cualquiera con el
// bundle publico —que es publico por definicion— calculaba el codigo de la hora
// y se autorizaba sus propias horas extra. Y get_kiosk_boot_payload repartia los
// PIN en claro al rol anon, con systemSlice cacheando los de supervisores en
// localStorage: cada tablet tenia las credenciales de su sucursal en disco.
//
// **Ahora.** El codigo sale de un HMAC con pepper en Vault, rota cada hora, es
// distinto por sucursal, y lo verifica verify_kiosk_authorization con rate limit
// de 10 fallos / 5 min por dispositivo. El boot payload paso de 2 referencias a
// kiosk_pin a 0. localStorage ya no guarda credenciales: la ventana de gracia de
// utils/kioskGrace.js solo persiste ids y fechas.
//
// **Offline.** Sin red no se puede verificar, asi que quien ya se autorizo en
// ESE kiosco dentro de la ventana pasa normal, y el resto se acepta como
// PENDIENTE —nunca como OK— con la marca viajando hasta la BD en el metadata del
// marcaje. No se guarda el codigo tecleado: una credencial que no se puede
// verificar tampoco se debe almacenar.
//
// De paso: audit_logs ya no registra el valor tecleado en un intento fallido
// (era legible por cualquier autenticado, y un dedazo metia ahi el PIN real de
// quien lo escribio); guarda su longitud y el motivo.
//
// La prueba contra un kiosco de test encontro un bug real de shadowing en
// PL/pgSQL —`record "r" is not assigned yet`, la variable de bucle colisionaba
// con un alias de tabla— que habria hecho fallar TODA autorizacion de excepcion
// en produccion.
//
// **Bloqueado**: la rotacion a PIN aleatorio. EmployeeFormModal dice que el
// kiosk_pin es "el valor del codigo de barras del carne", pero el kiosco
// identifica por employees.code y nunca por el PIN. Si la leyenda es literal,
// rotar cuesta reimprimir 46 carnes. Hay que mirar un carne fisico.

// v2.184.0 — auditoria de Supabase: `employees` se leia SIN autenticacion.
//
// Auditoria completa de la BD (AUDITORIA-SUPABASE-2026-07-29.md): 106 tablas,
// 165 funciones, 234 policies, 51 crons, 35 edge functions.
//
// **La fuga.** La policy `employees_select` se creo sin clausula TO, que en
// Postgres es TO PUBLIC — incluye `anon`. Su USING solo excluia superusuarios,
// sin ningun gate de autenticacion. Verificado contra la API REST publica con
// la sola anon key (que viaja en el bundle JS, es publica por diseno):
// `GET /rest/v1/employees?select=id&limit=0` devolvia HTTP 206 con
// `content-range: */50`. Exponia 50 empleados, incluidos **46 kiosk_pin** —que
// no es privacidad sino bypass de autenticacion del kiosco de marcaje—, DUI,
// telefonos, direcciones y fechas de nacimiento. `base_salary` y
// `account_number` estaban vacias pero eran seleccionables.
// Ahora: `*/0`. `employees_update` y `employees_delete` tenian el mismo defecto
// (fallaban cerrado por accidente, no por diseno) y tambien se corrigieron.
//
// **El PIN no era una credencial.** `generateHashCorto` = SHA-256(code) sin
// secreto: quien conoce el codigo de un empleado —el identificador visible en
// todo el portal— derivaba su PIN. Y `get_kiosk_boot_payload` los repartia en
// claro al rol `anon`, con comparacion client-side y cache en localStorage.
// Fase 1 del rediseno (aditiva, el kiosco sigue igual): `kiosk_credentials` con
// hash bcrypt fuera de `employees`, `kiosk_pin_attempts` con rate limit de
// 10/5min por dispositivo, y las RPC `verify_kiosk_pin` / `set_kiosk_pin`.
// La verificacion recibe al empleado ya identificado por carne: una sola
// comparacion bcrypt (~80 ms) en vez de las ~50 que harian falta si el PIN
// tuviera que identificar.
//
// Las tablas nuevas necesitaron un REVOKE aparte: las default privileges de
// Supabase le dan a anon/authenticated privilegios COMPLETOS sobre toda tabla
// nueva —incluido TRUNCATE—, y solo RLS las frenaba.
//
// Pendiente y mas grave que lo anterior: `getHourlyCode()` (helpers.js:180) es
// Math.sin() del reloj, calculado en el navegador y comparado client-side, asi
// que cualquiera que abra el bundle publico **se autoriza sus propias horas
// extra**. Las reglas que protege estan bien (timeClock.helpers.js:130-259, 6
// casos que afectan planilla); lo que falla es que la credencial no es secreta.

// v2.183.0 — auditoria del modulo Conteo de Inventario (AUDITORIA-CONTEO-2026-07-29.md).
//
// **El "Sistema" estaba inflado en el 26% de las lineas.** El snapshot copiaba
// una linea por fila de `inventory`, pero la relectura en vivo agrupaba por
// (producto, presentacion, lote, is_vencidos): una clave que INCLUYE
// `presentacion` — que el sync sobrescribe, no es identidad — y OMITE `detalle`
// y `fecha_vencimiento`, que si lo son. 1,354 de los 1,375 grupos duplicados de
// prod difieren solo en la fecha de vencimiento: mismo lote, distintas fechas.
// Cada linea hermana mostraba el total del grupo. Medido sobre el conteo
// abierto: 1,243 de 4,782 lineas, 4,634 unidades reales presentadas como 12,588.
// Todas iban a registrar un faltante fantasma.
//
// Ahora la linea se ata a `inventory.sync_key`, que es la identidad real del ERP
// (UNIQUE global, estable entre syncs). `source_inventory_id` no servia: 1,170
// de las 4,782 lineas ya apuntaban a filas borradas y reinsertadas por el sync.
//
// Lo demas de la misma pasada:
// - Costeo por presentacion, no MIN(costo) del producto (628 productos con
//   varios costos activos, razon max/min hasta 250x). Un solo criterio para
//   snapshot y alta manual: `conteo_costo_unitario()`.
// - Los renglones sin contar ya no desaparecen del calculo: al finalizar hay
//   que decidir si son "no ubicados" (fisico 0, faltante real) o si el conteo
//   fue parcial — y el numero queda persistido, en pantalla y en el PDF.
// - `sistema_inicial` archiva la existencia del libro al abrir el conteo, que
//   antes se destruia en el primer guardado.
// - Conteo ciego alcanzable: `printHojaConteo` ya lo soportaba desde el dia uno
//   pero la vista siempre le pasaba `{ ciego: false }`. Ahora tambien oculta
//   sistema Y diferencia en pantalla (ocultar una sola es un ciego de mentira).
// - Segregacion de funciones: no se puede aprobar un conteo que uno mismo
//   finalizo.
// - RLS: se eliminan `conteos_update` (permitia saltarse can_approve por
//   PostgREST directo) y `conteo_items_update` (permitia escribir sin dejar
//   historial). El alta manual pasa a RPC con costo y autoria server-side.
// - Un guardado que falla ya no deja el numero en pantalla como si se hubiera
//   guardado (try/finally sin catch).
// - SIN_UBICAR alcanzable, marca del area de vencidos, lote nuevo sobre
//   producto ya presente, y bloqueo de dos conteos abiertos por sucursal.

// v2.182.0 — el mismo regex se habia comido cuatro props mas.
//
// Tras la regresion de min/max, barri TODAS las migraciones de la auditoria
// comparando el conjunto de props de comportamiento antes/despues, commit por
// commit. Aparecieron cuatro perdidas mas, todas silenciosas:
//
//   · RecepcionModal — la navegacion ^/v entre filas de cantidad. Perdio el
//     `onKeyDown` Y los `data-qty-row`/`data-qty-col` que el selector busca,
//     asi que quedo solo el comentario describiendo un mecanismo inexistente.
//   · TabMinMax — el `onBlur` de la celda MAX (guardar el par al salir).
//   · DifSection — `onKeyDown` (Enter rechaza / Esc cierra) + `autoFocus` del
//     campo "Razon del rechazo".
//   · SrsBuscadorWidget — `autoComplete="off"`. Resuelto en el CANONICO: es el
//     default correcto de todo buscador de app, no algo que cada llamador pase.
//
// De paso, `SearchInput` tenia `aria-label` DUPLICADO (dos veces la misma
// linea, mal indentada) de una insercion automatica anterior.
//
// Verificado que no queda nada mas: arbol actual vs. 7055b4c4 (anterior a D0)
// por conteo de props de comportamiento. Los 3 hallazgos restantes son falsos
// positivos — `autoFocus` que hoy provee el canonico al expandirse
// (SearchInput expandable, ViewTabBar) y texto del changelog.


// v2.181.0 — auditoria, pasada B: teclado en controles que no son <button>.
//
// `clickable()` (src/utils/clickable.js) en 29 sitios: filas, celdas y tarjetas
// con `onClick` sobre un <div>, sin tabIndex ni onKeyDown y sin nada enfocable
// adentro. Con mouse andaban; con teclado no existian.
//
// **Y tres regresiones que introdujo esta misma auditoria, ya corregidas.** Las
// tres del mismo molde: una migracion automatica de JSX que quedo verde en
// build + lint + gate y aun asi cambio lo que el control hacia.
//
//   1. `clickable()` devolvia el contrato de teclado pero NO `onClick`, y el
//      migrador reemplazo el `onClick` original por el spread: los 34 sitios
//      quedaron accesibles con teclado y MUERTOS con mouse.
//   2. 5 de esos sitios eran `onClick={e => e.stopPropagation()}` — barreras de
//      evento, no controles. Revertidos: un `role="button"` que no hace nada es
//      una parada de tabulacion falsa.
//   3. El migrador de PortalInput descarto en silencio los dos `onKeyDown` de
//      la grilla min/max (su regex de props soporta 2 niveles de llaves; esos
//      handlers anidan mas). Ahi vivia la navegacion tipo hoja de calculo:
//      `->` de MIN a MAX, `Enter`/`v` guarda el par y salta al siguiente
//      producto, `<-` vuelve, `Esc` cancela. Recuperados de `aca2ef0f^`.
//
// Lo reporto el usuario, no el gate. Documentado en DESIGN.md §25.8.

// v2.180.0 — auditoria, pasada A: codigo muerto.
//
// 34 exports que no importaba nadie, en 13 archivos. Verificado uno por uno:
// cada nombre aparecia UNA sola vez en todo `src/` — su propia definicion.
//
// **Borrar codigo muerto destapa mas codigo muerto.** Al sacar
// `buildKioskAttendanceDetails` quedaron huerfanos `compactIfTooLarge` y
// `pickEnum`; al sacar esos, `isPlainObject` y `jsonSizeBytes`. Hizo falta
// iterar hasta punto fijo (3 vueltas).
//
// **Dos guardias que hicieron falta y valen para la proxima:**
//   1. Que el archivo siga pasando el lint NO alcanza. Al quitar
//      `ERP_BODEGA_ID` mi extractor se llevo tambien `SUCURSALES` — el archivo
//      quedaba valido y el BUILD reventaba. Hay que comparar el set de exports
//      antes/despues y exigir que solo desaparezca el buscado.
//   2. `export const X = ({...}) => ({...});` termina en `});`, no en `};`.
//      Buscar el cierre por texto falla; hay que balancear por lineas.
//
// Keyframes CSS huerfanos: 0 de 32. Dependencias sin usar: solo
// `@capacitor/android` e `@capacitor/ios`, que son plataformas nativas y no se
// importan desde JS — NO son muertas.

// v2.179.0 — auditoria visual: contraste del texto terciario + 8 archivos
// muertos.
//
// **La etiqueta de tab inactiva fallaba AA en dos temas**, y esta en TODA
// vista con tabs. La causa: `--text-tertiary` se habia calibrado en T2 contra
// `surface-card` (blanco puro) y daba 4.76:1 — pero el riel de `ViewTabBar` es
// TRANSPARENTE, asi que el texto compone contra la PAGINA, que es mas oscura.
//
//     solid       4.40 → 4.97   #64748b → #5b6b80
//     dark        4.21 → 5.16   white/50 → white/58
//     liquid      5.53 ✅ · solid-dark 5.86 ✅ (ya pasaban)
//
// **Y una leccion de metodo que costo tres intentos:** medir contraste con
// `getComputedStyle().color` MIENTE. Tailwind v4 envuelve los colores en
// `color-mix(in oklab, …)`, asi que el navegador reporta un RGB que no es el
// declarado — subir el alfa de white/50 a white/58 "empeoraba" el numero
// calculado mientras mejoraba de verdad. La unica medicion confiable es
// **muestrear el pixel renderizado** de una captura.
//
// De paso, el barrido de contraste tampoco vale si no descarta los ancestros
// con `background-image`: un boton con degradado da 1:1 y son todos falsos
// positivos (ya estaba anotado en memoria y volvi a tropezar).
//
// **8 archivos que no importa nadie, 1,830 lineas:** LiquidWeekPicker,
// BranchChips, SyncHealthBanner, _StatCardPreview, EmployeeScheduleView,
// TabEnCurso, RutaEnCursoCard, SalyCopilot. Verificado uno por uno: sus unicas
// menciones estaban en COMENTARIOS, ninguno esta ruteado ni se carga con lazy.

// v2.178.0 — auditoria: los selectores de fecha tampoco tenian teclado.
//
// Buscando la familia del bug de `LiquidSelect` (v2.157.0) aparecieron **39
// controles reales sin acceso por teclado**: un `<div onClick>` sin `tabIndex`
// ni `onKeyDown`, y sin ningun control enfocable adentro por el que llegar.
// (De los 70 candidatos crudos, 23 eran envoltorios con un boton adentro y 8
// overlays de "clic afuera para cerrar" — esos no cuentan.)
//
// Los CUATRO primeros son canonicos, o sea que multiplican:
//
//   LiquidDatePicker   32 archivos   el boton de BORRAR la fecha era un
//                                    `<div role="button">` — el rol prometia
//                                    el contrato y no habia nada detras
//   PeriodPicker        5 archivos   el disparador, sin teclado
//   RangeDatePicker     6 archivos   idem
//   LiquidWeekPicker    0 archivos   ← nadie lo usa (ver abajo)
//
// El de `LiquidDatePicker` pasa a ser un `<button type="button">` de verdad,
// que da el contrato gratis. Los otros dos llevan el mismo patron que
// `LiquidSelect`: `tabIndex`, Enter/Espacio/Flecha-abajo, la guardia
// `e.target !== e.currentTarget` y el aro con `outline-solid`.
//
// Verificado en vivo: los disparadores de /ventas y /facturas-compra ahora son
// alcanzables, y todo boton de borrar fecha es un `<button>`.
//
// Quedan 35 controles de vista (celdas de calendario, tarjetas KPI clicables,
// filas expandibles). Van en la proxima tanda.

// v2.177.0 — DESIGN.md cierra la estandarizacion.
//
// §15.11 gana la tabla de RANURAS con lo que rescato cada una. Es la lectura
// util del trabajo: cada ranura existe porque su ausencia mando campos a
// escribirse a mano.
//
//     label OPCIONAL   43 campos   ← era lo UNICO que los dejaba fuera
//     tono             33
//     labelAction      37
//     onDark            1 (kiosco)
//     className         celdas de ancho fijo
//
// §15.12 pasa de "61 celdas de grilla" a **4 excepciones reales**, nombradas
// con su motivo. La version vieja afirmaba un criterio —"el contenedor ya
// dibuja la caja"— que al verificarlo ancestro por ancestro no aguantaba en 4
// de 7 casos.
//
// §5 gana la tabla de superficies al dia (`sidebar-popover` nuevo) y §5.1
// `data-tono`, con la medicion de por que la tarjeta era indecorable y la
// regla de no anidar tarjetas.
//
// Verificado antes de escribirlo: el baseline real dice `input-a-mano: 4` y
// los 4 son exactamente los que el doc nombra — LoginView x2, AuthPromptPanel
// y MenuSearchModal.

// v2.176.0 — input-a-mano 15 → 4, y mi criterio de "excepcion" no aguanto.
//
// Preguntado por el usuario: *"por que esos 9 son excepcion? que criterio
// tomaste?"*. El criterio que yo habia dado era "el contenedor ya dibuja la
// caja". Al ir a verificarlo ancestro por ancestro, **4 de 7 no lo cumplian**:
//
//   FormRehireEmployee x2  el contenedor SI dibuja la caja… pero es
//                          `PortalInput` reconstruido a mano: etiqueta, caja,
//                          icono e input suelto. No es excepcion, es el
//                          canonico copiado.
//   EmployeeDetailView     buscador expandible a mano (contenedor con toggle
//                          propio, boton lupa/X, input suelto) → ya existe
//                          `SearchInput expandable`.
//   TabExpediente          lo mismo, mas un envoltorio que OCULTABA los demas
//                          botones al abrir. Con el canonico no hace falta:
//                          crece hacia el espacio vacio (DESIGN.md §24).
//
// Los tres traian ademas su propio `useSearchToggle` cableado a mano — el
// contrato de Escape/clic-afuera que el canonico ya trae adentro.
//
// **Las 4 que SI son excepcion**, con su motivo:
//   LoginView x2       superficie bespoke (fuerza claro, sin sesion)
//   AuthPromptPanel    el PIN del kiosco: su borde lleva el caret virtual
//                      animado y el canonico dibuja la caja en el contenedor,
//                      asi que la animacion quedaria invisible
//   MenuSearchModal    la barra de busqueda del encabezado de ⌘K: no es un
//                      campo en una caja, es una fila con divisor abajo
//
// Verificado en vivo: el buscador del expediente colapsa (ancho 0, tabIndex
// -1), abre a 190px con foco, y los botones se quedan visibles.

// v2.175.0 — 13 inputs mas al canonico. input-a-mano 28 → 15.
//
// Las celdas de RecepcionModal (4) y TabCatalogo (4) tenian el tinte por
// estado escrito en un ternario dentro del className; ahora sale de `tono`.
// Las de ancho fijo (ConfigPanel `w-16`, WidgetInventorySearch `w-10`,
// LlegadaModal `w-32`) usan `className` en el contenedor, que es para lo que
// se agrego.
//
// Dos variables quedaron muertas al migrar y las agarro el lint: `inp` de
// TabCatalogo —era la paleta de la celda escrita a mano, que el canonico ya
// trae— y el `rowIdx` de RecepcionModal.

// v2.174.0 — `tarjeta-a-mano` en CERO, y el porque de las ultimas 10.
//
// **La tarjeta canonica era INDECORABLE.** Las 10 que quedaban compartian
// forma: la superficie es siempre la tarjeta y solo cambia el BORDE por
// estado (en edicion, con error, urgente). Al intentar migrarlas quedo a la
// vista por que habian quedado a mano — medido en el navegador:
//
//     data-surface="card"                        → borde blanco 0.72
//     + border-warning/40                        → borde blanco 0.72  ❌
//     + border-2 border-warning/40               → borde blanco 0.72  ❌
//     + ring-2 ring-warning/40                   → sin cambio        ❌
//
// `index.css` va sin @layer, asi que `[data-surface="card"]` le gana a toda
// utilidad de Tailwind. Y el ring tampoco entra porque es un `box-shadow` y
// ahi ya se declara uno. O sea: para marcar una tarjeta en edicion no quedaba
// mas que renunciar al canonico y pintarla entera a mano. No era descuido.
//
// **`data-tono` nuevo.** Con un atributo la especificidad sube sola
// ([data-surface][data-tono] es (0,2,0) contra (0,1,0)) y el estado se lee en
// el marcado en vez de en una ristra de clases condicionales:
//
//     <div data-surface="card" data-tono={editando ? 'warning' : undefined}>
//
// Valores: warning · danger · success · brand · dashed. El ultimo es la
// tarjeta VACIA que invita a llenarla (documento faltante) — no es severidad,
// es ausencia, por eso no lleva color.
//
// **Un anidado que el cambio dejo ver:** el pie de la tarjeta de rol tambien
// era "tarjeta", y al darle tono quedaban dos anillos naranjas concentricos.
// No es una tarjeta: es una franja DENTRO de una. Vuelve a superficie de
// realce con relleno suave.
//
// **Y un bug en mi propia regla del gate:** `bg-surface-card\b` tambien
// matchea `bg-surface-card-hover`, que es OTRO token. Corregido a
// `bg-surface-card(?!-)`.
//
// Verificado en vivo: 12 vistas sin errores, y el tono naranja renderizado de
// verdad al entrar en edicion de un rol.

// v2.173.0 — 38 tarjetas mas y 20 inputs al canonico.
//
// **Tarjetas 31 → 10.** Las de plantilla se migraron limpiando solo los trozos
// ESTATICOS del template literal. Las que tienen la superficie DENTRO de un
// condicional usan ahora el mismo idioma que `PortalInput` con `tono`: cuando
// hay tinte no se emite `data-surface`, porque la regla de index.css va sin
// @layer y le ganaria a la clase tintada.
//
//     data-surface={d.isToday ? undefined : 'card'}
//     className={`… ${d.isToday ? 'bg-brand/5 border-brand/30' : ''}`}
//
// **Inputs 48 → 28.** El migrador parte el className en tres: lo que el
// canonico ya dibuja (caja, borde, radio, foco, transicion) se descarta; lo
// que afecta al TEXTO (alineacion, peso, mono) va a `inputClassName`; lo que
// define ANCHO (flex-1, w-24) va a `className`, que ahora es del contenedor.
// El `tono` sale del borde tintado y `compact` del alto.
//
// Los `data-qty-*` NO se tocan: son las celdas con navegacion por flechas.
//
// Verificado en vivo sobre 14 vistas: cero rotas, cero tarjetas sin fondo,
// cero campos anonimos, cero errores.

// v2.172.0 — 150 tarjetas dibujadas a mano pasan al canonico.
//
// Lo que se recupera no es solo dejar de repetir seis clases: **la forma
// vuelve a ser del TEMA**. Medido en /my-requests, /cotizaciones y /monitor,
// el radio de la tarjeta ahora da 28px en Liquid Glass y 12px en Solido —
// antes eran 24px fijos (`rounded-3xl`) en los cuatro temas. Lo mismo con el
// `backdrop-filter`, que quedaba escrito aunque Solido prometa cero blur.
//
// El migrador quita solo lo que `data-surface="card"` ya provee: superficie,
// borde, radio, sombra y material. El padding y el layout se quedan. Tambien
// se va el hover duplicado (`hover:shadow-*` y `hover:-translate-y-*`): el
// canonico ya trae sombra y lift de -2px, y tenerlo dos veces era como se
// habian ido separando unas tarjetas de otras.
//
// Verificado en vivo sobre 18 vistas: cero rotas, cero errores, y ninguna
// tarjeta quedo sin fondo (que es como se veria una superficie que no
// resolvio).
//
// tarjeta-a-mano: 184 → 31. Las 31 que quedan usan plantilla en el className
// —el migrador solo toca literales a proposito— y van una por una.

// v2.171.0 — el kiosco entra al canonico, y aparece `tarjeta-a-mano`.
//
// **`PortalInput` gana `onDark`**, la misma prop que ya tienen `ListRow` y
// `Badge` por el mismo motivo: la ANATOMIA es la del canonico (alto, radio,
// aro de foco, area tocable) y lo unico bespoke es la paleta. Con eso el campo
// del kiosco deja de reconstruir `bg-black/30 border-white/10` a mano.
//
// El PIN de `AuthPromptPanel` NO migra y es deliberado: su borde lleva el
// caret virtual animado —el indicador anti-fraude— y el canonico dibuja la
// caja en el contenedor, no en el `<input>`, asi que la animacion quedaria
// invisible. Ahi la excepcion es real, no comodidad.
//
// **Los 6 "sin caja" resultaron ser 5 con caja.** Solo usaban `flex-1` en vez
// de `w-full`, que es lo que los separaba en mi agrupacion. Migrados con
// `className="flex-1"`. El sexto —`EmployeeFormModal`— era el UNICO campo
// subrayado del portal: el subrayado evitaba anidar caja dentro de caja, pero
// una tarjeta que contiene campos es lo normal en todas las demas vistas, y un
// patron que existe una sola vez no es un patron.
//
// **`GlassInput` de TabLaboratorios pierde `accent`.** Solo tenia ambar/teal en
// el borde AL ENFOCAR; el canonico enfoca con el azul de marca en todo el
// portal. Que dos campos se enfoquen de distinto color segun la columna es la
// divergencia por vista que esta auditoria vino a quitar.
//
// **El hallazgo grande vino de una pregunta del usuario:** *"eso de dibujar la
// tarjeta no es canonico"*. Tenia razon — canonizar un campo y dejar su
// contenedor a mano es arreglar la mitad. Medido: **184 tarjetas dibujadas a
// mano en 64 archivos**, todas reconstruyendo `data-surface="card"`. Lo que se
// pierde no es solo repeticion: el radio queda FIJO (`rounded-3xl` = 24px)
// cuando `--card-radius` cambia por tema, y el `backdrop-filter` queda escrito
// aunque Solid prometa cero blur. Categoria `tarjeta-a-mano` nueva en el gate
// con ratchet, para que no crezcan mientras se migran.
//
// input-a-mano: 60 → 48.

// v2.170.0 — `PortalInput` acepta no tener etiqueta.
//
// Preguntado por el usuario: 43 de los 56 inputs a mano son el MISMO campo del
// canonico; solo 2 son celdas tipo hoja de calculo. Lo unico que los dejaba
// fuera era que `label` se dibujaba siempre. No hacia falta otro canonico:
// hacia falta la ranura. Sin `label` el nombre va en `aria-label` y el error
// pasa a `sr-only` (la senal visible es el borde rojo, que ya estaba).
// Prop `className` nueva para el CONTENEDOR (celdas de ancho fijo).
// Migrados: banco de horas de nomina (4) y feriados (2). input-a-mano 60 → 54.

// v2.169.0 — `chart-retirado` y `chip-a-mano` a CERO, y el lint tambien.
//
// **chart-retirado 430 → 0.** Migrados los tres categoricos retirados
// (chart-2/5/7 → success/chart-9/warning): 424 referencias en 51 archivos.
// Verificado POR TOKEN en los cuatro temas: los seis alias resuelven identico
// a su destino, asi que es pixel-igual.
//
// **`chart-8` no estaba retirado.** Al ir a migrar sus 107 referencias quedo a
// la vista que es el NEUTRO de la paleta y esta vivo: `--chart-8-solid` tiene
// valor propio (#64748b, no alias), el `neutral` de `Badge` se apoya en el, y
// tiene familia completa de glows. Marcarlo retirado obligaba a mapearlo a
// `content-3`, que es un color de TEXTO — usarlo de fondo habria sido cambiar
// el significado para callar al gate. Sale de la lista.
//
// **El renombrado colapso claves en 7 archivos y eslint lo atrapo.** Los
// canonicos listaban `chart-N` y el semantico por separado; al renombrar
// quedaron duplicados, y la entrada ex-chart GANABA por venir ultima. Tres
// valores no eran equivalentes:
//   · Badge      warning  /[0.14] → /[0.12]
//   · SegmentedControl  success y warning perdian su variante `-solid`
//   · Switch            idem
// Al quitar las redundantes mandan otra vez los semanticos. El resto eran
// byte-identicas.
//
// **chip-a-mano 7 → 0.** `getExpiryBadge` devuelve la VARIANTE en vez de
// clases sueltas —dos call sites la pegaban dentro de un `<span>` propio, dos
// chips a mano del mismo estado—; RangeDatePicker, VacationPlan, TabMinMax x3
// y BranchesView al canonico. En BranchesView el ternario tenia dos ramas de
// TEXTO y una de chip: separadas, cada una es lo que es.
//
// **Lint en CERO** (estaba en 2, preexistentes):
//   · `useThemeSync` — `ready` se DERIVA de para que usuario se cargo el tema,
//     en vez de un setState sincrono en el effect. Cierra ademas una carrera
//     real: con un fetch en vuelo y cambio de usuario, la respuesta vieja
//     aplicaba el tema del anterior.
//   · `MenuSearchModal` — la expresion del array de dependencias extraida a
//     `claveSeleccion`.
//
// Verificado en vivo: 16 vistas sin errores ni fondos sin resolver, el tema
// persiste tras recargar (probado por la UI, no por atributo), y ⌘K filtra.

// v2.168.0 — el modulo Promociones se retira tambien de la BD y del servidor.
//
// Aplicado tras confirmar que lo unico almacenado era 1 promocion de PRUEBA:
// "OMEGA 3 1000MG", creada el 8 de junio con un rango del 1 al 15 de enero
// —ya vencido al crearla— y sin `stock_inicial`, mas su producto y las 6
// sucursales. `promotion_sales_cache` nunca tuvo una fila: sin promos activas
// la funcion salia antes de consultar ventas. 8 filas en total.
//
// Migracion `20260728_drop_promotions_module`:
//   1. `cron.unschedule('sync-promo-sales-daily')` — ANTES de tocar tablas
//   2. `backup_dump_table` sin las 5 tablas de su lista blanca (si no, el
//      backup nocturno reportaria 5 fallos por noche — los captura por tabla
//      y sigue, asi que no se rompia, pero era ruido permanente)
//   3. DROP de las 6 tablas, hijas primero
//
// Verificado ANTES de aplicar: cero FKs entrantes desde fuera del modulo y
// cero tipos enum propios. Y verificado DESPUES: 0 tablas, 0 crons, la funcion
// de backup responde (23 roles).
//
// **`employee_timeline` menciona 'promotion' y NO se toco**: ahi es un
// `event_type` de RRHH — "Ascenso / Cambio de cargo"—, otra cosa por completo.
// Comprobado despues del drop: la vista devuelve 74 filas, una de ellas de
// tipo PROMOTION. Son dos conceptos con el mismo nombre.
//
// Edge function `sync-promo-sales` eliminada del servidor (estaba ACTIVE v6)
// y su carpeta local borrada.
//
// Bonificaciones se construira despues con su propio esquema. Ojo que
// `promotion_bonifications` y `promotion_payments` existian vacias: parte de
// ese modelo ya estaba pensado y se fue con el drop.

// v2.167.0 — se retira la vista de Promociones; queda el slot de
// Bonificaciones para construirla despues.
//
// Frontend borrado (1,563 lineas, autocontenido — nadie fuera lo importaba):
//   src/views/PromocionesView.jsx        67
//   src/views/promociones/PromoModal.jsx        578
//   src/views/promociones/TabPromos.jsx         376
//   src/views/promociones/TabBonificaciones.jsx 248
//   src/views/promociones/TabHistorial.jsx      187
//   src/data/promotions.js                      107
// Mas la ruta, el import perezoso, el breadcrumb, el modulo del menu y su
// entrada en la pantalla de permisos (con sus 3 tabs).
//
// **El backend NO se toco y es deliberado:** la edge function
// `sync-promo-sales` (cron 4:30am) y las 6 tablas del modulo siguen ahi con
// sus datos. Borrar tablas de produccion no estaba en el pedido y no es
// reversible como un archivo; queda como decision aparte.
//
// El grupo del menu pasa a llamarse Bonificaciones con ese unico modulo. Ojo:
// `bonificaciones` esta marcado `comingSoon`, y la regla anti-grupos-muertos
// del menu (un grupo que solo contiene "Proximamente" no se muestra) hace que
// el grupo quede OCULTO hasta que exista la vista real. Es el comportamiento
// que ya tenia el sistema, no algo nuevo.

// v2.166.0 — el sidebar en CUATRO perillas, y el movimiento como eje del tema.
//
// **1 · El badge ⌘K no se leía, y no lo habia validado.** Medido: liquid
// **1.58:1**, solid-dark 3.57:1. Causa: un `Badge` con tokens de tema sobre la
// superficie bespoke oscura — el mismo bug del panel WFM, invertido. En liquid
// el `neutral` resolvia a un celeste palido al 26% sobre navy (= gris medio)
// con texto slate oscuro: el chip se veia, el texto no. `Badge` gana `onDark`,
// la misma prop que `ListRow` ya tenia por el mismo motivo. Ahora 5.24:1.
//
// **2 · Movimiento por tema.** D2.4 separaba lo decorativo de lo funcional
// pero las DURACIONES y la CURVA eran las mismas en los cuatro: Solid Modern
// —el tema de los equipos viejos— heredaba 200ms y una curva de RESORTE, que
// se demora al final a proposito. Ahora solid usa 90/120/180ms y una curva sin
// rebote. Ademas el barrido especular (700ms de transform por hover) no se
// ejecuta en solid: no comunica estado, es brillo de vidrio.
//   · el sidebar codificaba sus duraciones a mano — 30 `duration-N` a token
//   · 25 `transition-all` → `transition` (vigilar TODA propiedad animable es
//     caro justo en la maquina que menos puede)
//   · el indicador del item activo SALTABA entre items; ahora desliza
//
// **3 · Sidebar compacto:** los iconos estaban 5px a la izquierda del centro
// —el item conservaba padding y gap horizontales aunque la etiqueta no se
// renderice—. 14 elementos, ahora 0 descentrados.
//
// **4 · El hover estaba pensado para el material contrario:**
// `--shadow-glass-2` es linea blanca al 90% arriba + sombra negra al 6% abajo,
// o sea una sombra para superficie CLARA. Sobre navy: filo duro y sombra
// invisible. Sombra propia del sidebar.
//
// **5 · El flyout del menu compacto** estaba pintado con hexes crudos
// (#0D2040, #1A3560, #4D94FF) y su propio blur, que corria tambien en solid.
// Ahora usa la superficie `sidebar-popover`, igual que el menu de Ajustes.
//
// **6 · Nada hardcodeado (pedido del usuario).** El navy estaba como literal
// en cinco lugares por tema, y en solido las dos superficies ya se habian
// desincronizado: #0B1020 el panel y #111A2E el popover, dos azules que nadie
// decidio que fueran distintos. Todo el sidebar sale ahora de cuatro perillas:
//
//     --sidebar-tint      el color, en canales sueltos
//     --sidebar-fill      cuanto rellena el panel      · 1 = opaco
//     --sidebar-pop-fill  cuanto rellena el popover    · 1 = opaco
//     --sidebar-rim       cuanta luz tiene el canto    · 0 = sin borde
//
// Cambiar el color del sidebar, o como se ve en movil, es UNA linea. Movil
// pasa de repetir declaraciones a `--sidebar-fill: 1`.
//
// **7 · Menu de Ajustes:** `bg-[#0A1628]/92 backdrop-blur-2xl` a mano (blur
// que corria en solid) → superficie por token. Tres textos bajo AA medidos y
// subidos: encabezados 3.63:1, etiqueta del codigo 4.21:1, chevron 3.13:1.
// Su entrada usa `useMotionConfig` en vez de una curva de resorte escrita a
// mano en los cuatro temas.

// v2.165.0 — el sidebar usa el vidrio de la tarjeta, y el dedo tiene piso.
//
// Pedido del usuario: los tres bespoke (sidebar, kiosco, login) se quedan y se
// documentan, pero el sidebar tiene que SENTIRSE integrado en liquid glass.
//
// **Bespoke en COLOR no es bespoke en MATERIAL.** El sidebar tenía las dos
// cosas: relleno 80% con blur de 28px y borde 0.10, al lado de tarjetas de 16%
// con blur de 44px y borde 0.72. Ahora hereda `--backdrop-card` — el vidrio del
// sidebar ES el de la tarjeta— y toma su sombra.
//
// El relleno baja a 0.72 y ese numero es un LIMITE MEDIDO: con el punto mas
// claro del degradado detras, el `white/60` que es el 90% del texto del menu
// queda en 4.61:1 (AA); a 0.66 cae a 3.94:1 y ya no pasa. Bajar mas obliga a
// subir el texto casi a blanco y se aplana la jerarquia activo/inactivo.
// Borde a 0.42, elegido comparando 0.10/0.28/0.42/0.60 a 3x contra la tarjeta
// vecina: en 0.10 el canto derecho no existe, en 0.42 responde a la luz igual.
// En movil sigue opaco — el transform del drawer mata el backdrop-filter.
//
// **Movil, medido en iPhone 13 (WebKit): 20 de 87 controles bajo 44px → 0.**
// La causa de fondo: `--control-h` sube a 44 en tactil, pero `sm` y `xs` se
// derivan RESTANDOLE 6 y 12 — daban 38px y 32px, aunque el comentario del
// componente afirmara lo contrario. Token `--tap-min` nuevo (0 en escritorio,
// 44 en tactil) DENTRO del max(). Va por puntero, no por viewport: una laptop
// tactil tambien tiene dedos.
//
// Tres hallazgos al arreglarlo:
//   · `iconOnly` NO TENIA ALTURA. ICON_ONLY_SIZE reemplaza a SIZE_CLASSES y
//     solo traia `w-`; donde el padre no estiraba quedaba 44x15. Afectaba a
//     los 194 iconOnly del portal.
//   · el boton de ordenar de DataTable media el alto del texto (15px).
//   · el chevron de LiquidSelect no puede crecer sin comerse el campo: se le
//     agranda solo el area tocable con un pseudo-elemento.
//
// **Texto cortado en movil:** `StatCard` forzaba `whitespace-nowrap` con el
// razonamiento de que la tarjeta crece en vez de truncar. Vale mientras la FILA
// tenga de donde; en un telefono no la tiene y pasaba a cortar a mitad de
// palabra. Bajo 560px envuelve. El valor mantiene nowrap: un numero partido no
// comunica nada.
//
// DESIGN.md §25.4-25.7 nuevas. Y §25 decia que el minimo de 44px "sigue WCAG
// 2.5.8 (AA)" — no: 2.5.8 es 24x24 y es AA; 44x44 es 2.5.5, AAA. El proyecto
// sostiene 44 a proposito, que es mas alto que lo exigido.

// v2.164.0 — todo elemento del CUERPO sigue el tema. Cero excepciones.
//
// Decidido por el usuario sobre el panel WFM (opcion B) y extendido a regla
// general: "todos los modals y elementos deben seguir al tema".
//
// **Los modales ya cumplian.** Auditados los 40+ que pasan por ModalShell /
// LiquidModal / UnifiedModal: el unico con superficie de color fijo es
// `KioskConfigModal`, que es chrome del kiosco.
//
// Lo que si estaba mal, y era el mismo bug en todos: superficie pintada con un
// color FIJO, con texto adentro usando tokens que si siguen el tema. En tema
// claro eso deja texto gris oscuro sobre casi negro.
//
//   TabStaff        panel "Motor de Sincronizacion WFM"  2.88:1 / 3.75:1
//   TabShifts       SuggestionCard + el panel de la IA   bg-slate-900/80
//   SalyCopilot     el panel sin alertas                 bg-slate-900/80
//   ScheduleChart   la tarjeta del grafico               bg-white/[0.14]
//   FormWfmAnalytics  el divisor                         border-slate-700
//   AttendanceMonitor los 3 chips de estado              bg-black/[0.06]
//   TabStaff        la pildora "Asignar"                 bg-white
//
// El panel WFM ademas gana un `Notice` de tono warning: la senal de "esto
// reescribe el historico" pasa a color CON significado, que el tema sabe
// adaptar, en vez de un rectangulo negro que encima no se leia. Y la barra de
// progreso gana `role="progressbar"` con sus valores.
//
// La consola del log se queda oscura a proposito: ahi lo oscuro no es
// decoracion, es lo que la hace leerse como salida de terminal.
//
// Verificado en vivo: 18 vistas en tema claro, **cero superficies oscuras en
// el cuerpo**. (El unico hallazgo del barrido fue un falso positivo mio:
// `oklab(0.9999 …)` es blanco, y mi calculo de luminancia lo leyo como RGB.)
//
// Pendiente de decision: el chrome siempre-oscuro — sidebar, kiosco y login —
// que son decisiones de diseno previas y explicitas, no descuidos.

// v2.163.0 — el "pendiente" de §25 no era un pendiente, y al ir a verificarlo
// apareció uno de verdad al lado.
//
// §25 llevaba meses diciendo que los campos glass tienen un hueco: su anillo
// de foco usa `focus-within` y no `focus-visible`, o sea "se dispara también
// con clic de mouse". Medido: **no cambiaría un solo píxel**. Un
// `<input type="text">` matchea `:focus-visible` aunque lo enfoques con el
// mouse — está en la especificación, no es del portal: hiciste clic ahí, lo
// siguiente que va a pasar es que escribas. Un `<button>` y un checkbox sí
// distinguen; un campo de texto no. Comprobado en pagina aislada y sobre el
// campo real: las capturas con clic y con Tab son el mismo archivo byte por
// byte (6.212 bytes).
//
// Lo que `focus-within` sí haría distinto es si hubiera OTRO control enfocable
// dentro del contenedor del campo. Hoy no lo hay, y §15.11 fija que la accion
// va afuera. Queda anotado por si algún día se rompe esa regla.
//
// Y el mismo párrafo decía que `.virtual-caret-blue/orange` "suprimen el
// anillo por completo". Tampoco: ese `outline: none` era letra muerta, la
// regla global `input:not(.outline-none):focus-visible` le out-especifica.
//
// **El bug real que apareció al verificar:** el pulso del borde del campo de
// PIN del kiosco es un bucle infinito de 1.5s y estaba FUERA de la lista de
// `prefers-reduced-motion` — seguía corriendo con la preferencia puesta,
// aunque §11 dice que los bucles infinitos se apagan. No se puede apagar a
// secas: ahí la animación ES el indicador de foco (el cursor nativo está
// oculto con `caret-transparent`). Se congela en el estado encendido: borde
// marcado, sin movimiento. Verificado con `reducedMotion: 'reduce'` —
// `animationName` pasa de `border-pulse-orange` a `none`.
//
// De paso: `.virtual-caret-blue` y su `@keyframes border-pulse-blue` no los
// usaba nadie. Eliminados.

// v2.162.0 — D4: DESIGN.md se pone al dia con lo que la auditoria encontro.
//
// Un documento de diseno desactualizado no es neutral: ENSENA la deuda. Dos
// secciones estaban diciendo activamente que se escribiera a mano lo que ya
// tiene canonico, y una tercera afirmaba algo que no era cierto.
//
//   §16.2  decia "el unico caso que se escribe inline" y mostraba el <span>
//          del contador para copiar. Se copio nueve veces — cuatro de ellas
//          DENTRO de componentes canonicos. Ahora documenta `Contador`.
//   §25    afirmaba que `LiquidSelect` tenia el patron combobox completo.
//          Tenia los roles; el teclado no. Corregido, con la leccion: poner
//          el `role` es la mitad facil — promete un contrato de teclado que
//          el navegador solo cumple gratis con el elemento nativo.
//   §30    la tabla extend-vs-create no listaba campo, buscador, boton,
//          badge ni fecha. Justo las cinco familias que mas se reescribieron.
//
// Secciones nuevas: §15.11 `PortalInput` (con `tono` y la regla de que la
// accion va AFUERA del campo), §15.12 cuando un `<input>` a mano es correcto,
// §25.1 nombre accesible, §25.2 que atributo de estado y cuando, §25.3 teclado
// en tablas.
//
// Verificado: las 9 reglas del gate que el doc menciona disparan de verdad
// (probadas con un archivo sonda), y las cifras que el doc afirma se
// re-midieron — dos estaban mal y se corrigieron (botones 276→60, no →178;
// LiquidSelect en 70 archivos, no 74).
//
// CLAUDE.md tambien: describia el gate como "cinco categorias arrancan con
// deuda". Las cinco llegaron a 0 en D1/D2. Hoy son 20 de 23 en cero absoluto
// y tres con ratchet, las tres deliberadas.

// v2.161.0 — el gate blinda el resultado: `input-sin-nombre`, cero absoluto.
//
// Arreglar los 45 campos anonimos de v2.160.0 no sirve de nada si el 46o
// entra la semana que viene. Categoria nueva, hermana de `button-name`: un
// `<input>` sin `aria-label` y sin un `<label htmlFor>` que lo apunte.
//
// El `placeholder` NO cuenta y la regla no lo mira. Desaparece apenas el
// campo tiene contenido — justo cuando alguien vuelve a revisar lo que
// escribio — y varios lectores de pantalla no lo exponen como nombre.
//
// Nota sobre el ratchet: una categoria que no figura en el JSON arranca
// bloqueante sola (`baseline[c] ?? 0`). Agregarla al baseline es una decision
// explicita, no el default — que es como tiene que ser.
//
// La regla encontro uno mas que mi barrido manual no vio: `LazyInput` de
// BranchHelpers, un helper compartido. Ese es exactamente el caso que un
// grep a ojo se pierde y un gate no.

// v2.160.0 — D3.4 cierra: los 45 campos que no tenian nombre accesible.
//
// De los 61 `<input>` que quedaban a mano, **45 no tenian NI `aria-label` NI
// un `<label for>` asociado**: para un lector de pantalla eran "cuadro de
// edicion, en blanco". Las horas a pagar de nomina, la cantidad fisica de un
// conteo, el numero de caja de una llegada, las notas de un renglon, la
// ubicacion de un producto en sala y en bodega, el multiplo de despacho.
//
// La mayoria NO debe migrar a `PortalInput` y por eso seguian a mano: son
// celdas de una grilla densa, no campos de formulario. No tienen etiqueta
// visible porque el encabezado de su columna ya dice que son, y `PortalInput`
// siempre dibuja un `<label>` arriba. Lo que les faltaba no era el canonico:
// era el nombre. Ahora lo llevan en `aria-label`.
//
// Otros dos canonicos tampoco daban nombre a su campo interno: el buscador de
// `LiquidSelect` (el que se superpone al abrirse) y `CatalogOtherInput`.
//
// Verificado en vivo sobre 12 vistas + el login: **0 campos anonimos**.
//
// D3.4 CERRADO. Quedan 61 inputs a mano, todos deliberados y con nombre.

// v2.159.0 — cuatro buscadores a mano, y tres canonicos que dejaban campos
// sin nombre.
//
// FormLeadership, EncuestaAdminView, LabsPanel y SrsBuscadorWidget eran
// `SearchInput` reescrito: lupa en absoluto + input + un boton de limpiar
// propio. Los cuatro al canonico; el boton de limpiar ya lo trae.
//
// Al medir despues quedo a la vista lo que faltaba mas arriba. Contando los
// `<input>` sin `aria-label` NI `<label for>` asociado:
//
//   /encuesta-admin  6 anonimos  → los tres segmentos DD/MM/AAAA de
//                                  `LiquidDatePicker`, x2 fechas
//   /productos       2 anonimos  → el buscador del header de vista
//                                  (`ViewTabBar`), en TODA vista con buscador
//
// Los tres canonicos se apoyaban solo en el `placeholder`. Un placeholder no
// es un nombre accesible: desaparece apenas el campo tiene contenido, y varios
// lectores de pantalla no lo exponen. `SearchInput` gana prop `ariaLabel`
// (default: el placeholder), `ViewTabBar` lo pone siempre, y los segmentos de
// fecha se anuncian "Dia" / "Mes" / "Ano".
//
// Verificado en vivo: /encuesta-admin y /productos, cero campos anonimos.
//
// Inputs a mano: 65 → 61.

// v2.158.0 — D3.4: los ocho campos de formulario que quedaban con etiqueta.
//
// SRS, turnos, avisos, cotizaciones, documento personalizado, monto y dias de
// solicitud, y el codigo de empleado. Todos eran `PortalInput` reescrito a
// mano; ninguno asociaba su `<label>` con el campo (`<label>` suelto, sin
// `htmlFor`), asi que hacer clic en la etiqueta no enfocaba nada y el lector
// de pantalla anunciaba el campo sin nombre.
//
// Dos cosas dejan de estar encimadas sobre el campo y pasan a ser hermanas
// suyas, como el ojo de contraseña en v2.156.0: el `$` del monto (ahora
// `prefix` del canonico) y el boton de regenerar codigo, que ademas gana
// nombre accesible ("Generar un codigo nuevo").
//
// `EmployeeRequestsView` tenia DOS `<PortalInput>` sin importar — el build no
// lo detecta (solo revienta en runtime dentro del ErrorBoundary). Es el mismo
// tropiezo del `<Badge>` de v2.14x; la unica red que lo agarra es el lint.
//
// Inputs a mano: 72 → 65.

// v2.157.0 — el canonico aprende a tintarse, y NINGUN desplegable se podia
// abrir con el teclado.
//
// D3.4 seguia encontrando inputs a mano que no eran descuido: **33 en 16
// archivos** estaban tintados con un color semantico o de categoria (el
// salario nuevo en verde, el MIN propuesto en naranja y el MAX en azul, las
// cantidades recibidas en el color de su fila) y `PortalInput` solo sabia
// pintarse neutro. Prop `tono` nueva, con los nueve colores de la paleta
// CERRADA — no agrega ninguno, solo los hace alcanzables desde el canonico.
// Detalle: la regla `[data-surface="input"]` de index.css va SIN @layer, asi
// que le gana a cualquier utilidad de Tailwind; con `tono` el atributo no se
// emite y el contenedor se pinta entero en el componente.
//
// Y buscando por que Playwright no lograba abrir un combo, el hallazgo real:
// el disparador de `LiquidSelect` es un `<div role="combobox">` con `onClick`
// y **sin `tabIndex` ni `onKeyDown`**. Medido en /staff: 2 combobox en la
// vista, **0 alcanzables con Tab**. Como LiquidSelect reemplaza a TODO
// `<select>` nativo del portal (74 archivos), eso significaba que ningun
// desplegable — filtros, formularios, modales — se podia usar sin mouse.
// Ahora: Tab llega, Enter/Espacio/Flecha-abajo abren, las flechas y Enter
// eligen (eso ya lo hacia el buscador interno), y al cerrarse el foco VUELVE
// al disparador en vez de caer al <body>. Anillo de foco con
// `outline-solid` — sin el, en Tailwind v4 no pinta nada.
//
// Verificado en vivo el ciclo completo de teclado y el campo verde renderizado
// en Accion RRHH > Ajuste Salarial.
//
// Inputs a mano: 85 → 72.

// v2.156.0 — D3.4: los formularios de contrasena y contacto.
//
// `FormSetPassword` (2), `FormChangeOwnPassword` (2), `FormEditContact` (3) y
// dos de encuestas. Los tres traian el mismo patron: un icono posicionado en
// absoluto sobre un `<input>` con `pl-10` a mano. `PortalInput` tiene ranura
// `icon` — es literalmente para eso.
//
// El ojo de ver/ocultar pasa a ser HERMANO del canonico en vez de un hijo
// encimado, y gana nombre accesible ("Mostrar la contrasena" / "Ocultar…") —
// antes era un boton de icono mudo.
//
// Verificado en vivo: los dos campos con `<label for>` asociado y el ojo con
// su nombre.
//
// Inputs a mano: 83 → 76.

// v2.155.0 — D3.4 sigue, y un error mio de 80 archivos.
//
// `FormServicePayment` migra sus dos campos con etiqueta. Y los siete de
// `RecepcionModal` quedan documentados como NO migrables: son celdas de una
// grilla densa, no campos de formulario — sin etiqueta visible (usan
// `aria-label`), con `data-qty-row`/`data-qty-col` y un `onKeyDown` propio
// para moverse con las flechas como en una hoja de calculo, y con el borde
// cambiando de color segun la diferencia contra lo facturado. Mismo criterio
// que el banco de horas de nomina (v2.116.0).
//
// ── El error, y las dos lecciones ────────────────────────────────────────
// Al agregar imports automaticos fui calculando la ruta relativa a mano, con
// una cuenta de `../` por profundidad. Estaba mal, y un intento de
// "arreglarla" en lote la rompio en **80 archivos** — quedaron imports como
// `from 'common/Button'`, sin ningun `../`.
//
//   1. Para una ruta relativa se usa `os.path.relpath`, no una cuenta a ojo.
//      El arreglo final calcula la ruta Y **verifica que el archivo destino
//      exista** antes de dejarla; asi aparecieron 100 imports que no
//      resolvian, incluidos varios anteriores a este lote.
//
//   2. Mi chequeo de build era `grep -E "ERROR|✓ built"`, y rollup dice
//      "Could not resolve" en minuscula. El build llevaba varios comandos
//      fallando sin que yo lo viera. Ahora: `grep -iE "could not resolve|
//      error during|✓ built"`.
//
// Verificado en vivo tras el arreglo: 780 botones en 14 vistas, 0 errores.
//
// Inputs a mano: 85 → 83.

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
