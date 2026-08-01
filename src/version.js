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

export const APP_VERSION = '2.317.0';

// v2.317.0 — Migración de fichas de clientes: la herramienta, y el espacio en
// blanco que un `.strip()` puede abrir.
//
// La herramienta (`scripts/migracion-clientes/`) completa y corrige las fichas
// del ERP por bloques y las espeja a `customers`. 92 fichas procesadas, portadas
// 93 → 179, con cero campos perdidos y cero alterados. El estado vive en
// `checkpoint.json`, así que retomar es volver a correr.
//
// El hallazgo que justifica el resto: **una ficha se negaba a guardar y creímos
// que era el distrito.** Perseguimos el valor, el departamento, un checkbox y la
// cascada de AJAX. Ninguna. El ERP nos venía dando el motivo en cada intento y
// nunca leímos el cuerpo de la respuesta:
//
//     {"typeinfo":"Error","msg":"Ya se registro un cliente con estos datos!"}
//
// Nuestro parser hacía `.strip()` a cada valor antes de reenviarlo. El nombre de
// esa ficha era `' NURIA ROXANA VILLANUEVA'` y ese espacio inicial es LO ÚNICO
// que la distingue de otra ficha con el mismo nombre. Al recortarlo colisionaban
// y el ERP rechazaba el guardado **entero** — por eso tampoco se podía cambiar
// `apunte`. Ahora los valores viajan crudos y se lee siempre el JSON de
// respuesta. Un rechazo se ve en pantalla y va a la lista de purga en vez de
// perderse.
//
// De ahí salieron tres cosas más. **Los ids de distrito del ERP no son
// globales**: van por (departamento, municipio), y el `8` es MEJICANOS en San
// Salvador y DULCE NOM MARÍA en Chalatenango — en el portal se guarda el nombre,
// nunca el id. **El checkpoint tenía versión de reglas ausente**, así que una
// regla nueva no se habría aplicado nunca a lo ya procesado. Y **el DUI inválido
// dejó de borrarse**: al simular 500 fichas aparecieron 10 y, a diferencia del
// relleno tipo `00000003-0`, todos tenían estructura de DUI real en fichas de
// personas con nombre y apellido. Son DUI buenos con un dígito mal tecleado;
// borrarlos —~690 en todo el catálogo— destruía un dato recuperable. Ahora se
// reportan a `revision_manual.json`.
//
// RPC nuevo `aplicar_espejo_erp` (20260801044543): `customers` no tenía NINGUNA
// policy de escritura, así que el espejo entra por una función DEFINER que
// empareja por `search_name`, nunca inserta y omite los nombres repetidos. Se
// eligió sobre la service-role key por ser el único camino de escritura en vez
// de una llave que puede todo.

// v2.316.0 — `customers` deja de ser un catálogo de nombres.
//
// La tabla tenía 24,482 filas y CERO datos en `nit`, `dui`, `email`, `phone` y
// `erp_id`: el sync sólo escribe `venta.cliente`. Ahora tiene la ficha que el
// ERP guarda de verdad — 9 columnas nuevas (`telefono2`, `direccion`,
// `departamento`, `municipio`, `distrito`, `categoria`, `giro`, `pasaporte`,
// `retencion_pct`) más un índice único parcial sobre `erp_id`.
//
// Y los 93 clientes que facturan CCF quedan poblados desde el ERP: **93 con
// `erp_id`** (la llave que faltaba: sin ella todo cruce era por nombre), 80 con
// NRC y NIT, 92 con teléfono, 85 con dirección, 81 con correo y giro.
//
// **El índice único de `nit` atajó un problema real**: dos pares resultaron ser
// la misma persona con el nombre invertido, duplicada en los DOS sistemas
// (494≡17015, 7414≡21268). Abortó en vez de escribir basura. Los
// identificadores fiscales van al registro con más facturas; el gemelo queda
// marcado para fusionar — fusionarlos es decisión aparte, hay facturas
// colgando de los dos.
//
// Los 11 sin NRC no son un hueco del cruce: en el ERP están como categoría
// "Consumidor", o sea que se les emitió un CCF a alguien sin registro de
// contribuyente. El libro los muestra con la marca "Falta".
//
// `distrito` queda en 0 a propósito: **el ERP no lo tiene** — de 87 clientes
// medidos, 76 sin distrito, y DTE 2.0 lo exige junto con departamento y
// municipio. Es el trabajo que sigue.

// v2.315.0 — Datos Contables: los libros de IVA se generan desde el portal.
//
// Grupo nuevo en el menú con **Facturas de Compra** —que sale de "Compras":
// ese documento se sincroniza para contabilidad, no para decidir qué reponer—
// y el módulo nuevo **Libros IVA**. El grupo de la pantalla de permisos se mueve
// igual: si el permiso vive en "Inventario" y el menú lo muestra en "Datos
// Contables", quien reparte accesos lo busca donde no está.
//
// Tres libros, tres RPC (20260731211927): consumidor final (Art. 83 RCT, una
// fila por día con el rango de correlativos del→al), contribuyentes (Art. 85,
// una fila por documento) y el anexo de anulados. Las columnas y su orden salen
// del Reglamento y no del CSV del ERP: es la referencia con autoridad y no
// depende de que un proveedor no cambie su exportador.
//
// **El filtro es el sello**: `estado='FINALIZADA' AND length(recibido_mh)=40`.
// Verificado el 2026-07-31 contra el ERP, 7 sucursales × 3 meses: CCF y
// consumidor 18/18 branch-meses exactos, y los 204 anulados con el md5 del
// conjunto de `codigo_generacion` idéntico. Sin ese filtro sobraban $282.58.
//
// Los RPC son DEFINER **con gate adentro**: la policy de `sales_invoices` pide
// `ventas.can_view`, así que un contador con permiso de Libros IVA y nada más
// leería cero filas siendo INVOKER. El gate replica permiso + scope y va en
// `(SELECT ...)` para que no se evalúe por fila.
//
// **Hallazgo que limita el alcance: falta el NRC del cliente.** El Art. 85 lo
// exige en cada fila del libro de contribuyentes y el portal no lo guarda —
// `customers` tiene `nit` y `dui` y las dos están VACÍAS: 0 de los 49 CCF de
// junio. La verificación contra el ERP cuadró en conteo y monto, que era lo que
// se comparó; la columna de identificación no entraba ahí. La columna `nrc` se
// crea igual (20260731211852) para que el libro nazca con su forma definitiva,
// y la vista marca los documentos sin NRC en vez de dejarlos en blanco: un
// libro que parece completo y no lo está es peor que uno que avisa.
//
// De paso, encontrado probando el grupo nuevo: **cada hover sobre un ítem del
// menú con el sidebar abierto tiraba `handleMouseEnter is not a function`**.
// La función es `undefined` a propósito cuando el flyout no corresponde, y el
// envoltorio que agregó el prefetch en v2.57.0 la llamaba sin `?.`.
//
// Verificado en navegador contra junio 2026: 21,604 documentos y $222,822.64 de
// consumidor con $25,634.46 de débito calculado, 49 CCF por $2,157.80 y 80
// anulados por $1,925.53 — los mismos números que devuelve el SQL directo. El
// CSV baja con BOM, `;`, fecha DD/MM/YYYY y su fila de TOTALES.

// v2.314.0 — el carril lo dibuja la VISTA, no el dato (y la marca de copiado).
//
// De las cuatro medidas canónicas de `StatCard` en §17.0 —148, 200, 8 y cinco—
// las tres primeras viven en clases y la cuarta vivía sólo en prosa. Era la
// única que se podía romper sin que nada avisara, y se rompió: Observaciones
// dibujaba 1 tarjeta + una POR CÓDIGO de anomalía, o sea un carril cuyo largo
// lo decidía el dato. Seis ese día, con techo abierto (`metaObs` muestra crudo
// cualquier código nuevo, que es a propósito).
//
// **El cupo se queda, pero dicho por lo que es: un presupuesto de la vista.**
// Un desglose por categoría contesta UNA pregunta —qué recorte quiero ver—
// dibujada como N métricas, y su lugar es una ranura de la píldora. Es
// exactamente lo que hizo MIN·MAX en v2.261.0 con sus 8 chips de estado.
//
// Observaciones queda con dos tarjetas fijas —"Facturas" y "Más antigua", que
// es dato nuevo: la más vieja sin solventar tiene 441 días— y el desglose pasa
// a la ranura "Observación", con el conteo dentro de cada opción ("23 Sello
// inválido"). De paso gana lo que como tarjeta no tenía: filtra.
//
// Lo vigila un `console.warn` de dev en `CarrilCards`, no el `design-gate`: el
// conteo real sólo existe en ejecución, un `.map()` sobre datos no se cuenta
// leyendo el JSX. Avisa en vez de recortar — quedarse con las primeras cinco
// escondería métricas en silencio.
//
// **Y la marca de copiado llega a Observaciones** (pedido del usuario). Había
// nacido sin ella con el argumento de que acá se puede solventar; el argumento
// estaba mal: solventar es "ya se revisó y queda constancia", la marca es "de
// éste ya me llevé el id", que es lo que hace falta mientras se recorre la
// lista. Con eso eran tres copias del mismo bloque de localStorage, así que
// sale un `useVisitados()`: una clave para las tres pestañas, porque la marca
// es del DOCUMENTO y no de la lista donde se lo encontró.
//
// Verificado en navegador (1512px): carril de 2 tarjetas → 3 al marcar, ranura
// con ["23 Sello inválido","1 Tipo inválido","1 Sin correlativo"], el filtro
// deja "23 en el filtro", la fila marcada se apaga y 0 errores de consola.

// v2.313.0 — la misma factura estaba en dos pestañas: la frontera es la CAUSA.
//
// Reportado: las facturas que la detección nueva levanta salían TAMBIÉN en
// Pendiente MH. Medido en prod: 185 pendientes, 27 observaciones y **25 en las
// dos listas**. No era casualidad — dos de los códigos ERAN la condición de
// Pendiente MH mirada desde el otro lado.
//
// La frontera queda en por qué está mal, no en qué lista la agarró primero:
//
//   · falta el sello y se espera a Hacienda → **Pendiente MH** (la cola tiene
//     la cuenta regresiva del plazo fiscal, que es lo que hay que mirar)
//   · el dato está mal escrito              → **Observaciones** (no se arregla
//     esperando: hay que corregirlo en el ERP)
//
// Tres cortes, uno por lado de la frontera:
//
// **Pendiente MH deja de listar sellos corruptos.** El filtro era "sin sello
// VÁLIDO" (`recibido_mh IS NULL OR NOT LIKE 40 chars`), así que los 23
// `'undefined'` engordaban una cola de espera de la que nunca iban a salir
// solos. Ahora es `recibido_mh IS NULL`: esperando, punto. 185 → 157.
//
// **`SIN_SELLO_VENCIDO` sale del catálogo del RPC** (20260731203801). Era un
// subconjunto exacto de Pendiente MH —que ya lista TODAS las facturas sin
// sello, viejas incluidas—, y como cada pestaña tiene su propia tabla de
// resoluciones, la misma factura pedía solventarse dos veces. Ya había pasado:
// de las 3, una estaba solventada en Pendiente MH y seguía apareciendo acá.
//
// **`SIN_CODIGO_VENCIDO` ahora exige que el sello SÍ haya llegado**
// (20260731203846). Sin esa condición quedaba 1 factura en las dos pestañas por
// el mismo hecho: Hacienda emite sello y código juntos —por eso comparten
// `p_dias_gracia_sello`—, así que "sin ninguno de los dos" es la espera, no una
// anomalía. La anomalía es la asimetría: llegó el sello y el código no. Hoy son
// 0 facturas, que es la respuesta correcta y no una clase muerta.
//
// Lo que `SIN_SELLO_VENCIDO` sí aportaba —"ya pasó la ventana de 2 días"— no se
// pierde: la fila de fecha de Pendiente MH pasa a `warning` cuando el grupo
// pasó la gracia. El aviso queda en la pestaña que puede hacer algo con él.
//
// Verificado contra prod después de aplicar: 157 · 24 · **0 en ambas**.

// v2.312.0 — Observaciones: copiar el id y solventar, y al lado de Pendiente MH.
//
// Faltaban las dos manos de la pestaña. Se veía el problema pero no se podía
// hacer nada con él: ni llevarse el id al ERP ni dejar constancia de haberlo
// revisado. Ahora la hoja usa el MISMO `ChipDoc` de Pendiente MH —copiar
// #erp_invoice_id │ tipo │ ✓— y el ✓ abre el formulario de comentario debajo
// del grupo de la fecha, igual que allá. El botón de solventar solo se dibuja
// con `can_edit` en Facturación, que es lo que exige el RLS.
//
// Las resoluciones NO van a `sales_invoice_resolutions`: esa tabla es la cola
// de Hacienda. Una factura observada suele estar ADEMÁS pendiente de sello, y
// compartir la tabla haría que "ya revisé la suma" la sacara de una cola con
// fecha límite fiscal. Tabla propia: `sales_observation_resolutions`
// (migración 20260731193337), append-only, RLS con INSERT por can_edit.
//
// De paso: `CREATE TABLE` deja los default privileges del esquema, que dan ALL
// a `authenticated` — y un `GRANT SELECT, INSERT` posterior SUMA, no acota.
// RLS tapa UPDATE y DELETE, pero TRUNCATE no pasa por RLS. Revocado en
// 20260731193824. Las otras tres tablas de resoluciones del módulo tienen el
// mismo grant ancho de origen; queda anotado, no tocado.
//
// La pestaña se movió al tercer lugar, pegada a Pendiente MH: las dos miran el
// mismo documento en la misma ventana y uno salta entre ellas.

// v2.311.0 — Observaciones toma la anatomia de Pendiente MH: sucursal y fecha.
//
// La tabla plana ordenaba bien pero no respondia la pregunta con la que uno
// abre esta pantalla — "que sucursal tiene problemas y de que dias" — porque
// mezclaba las 7 sucursales en una sola lista paginada. Pendiente MH ya tenia
// resuelto ese agrupado, asi que se reusa en vez de inventar otro.
//
// Sucursal colapsable (con su contador y su badge CCF) → fecha (con "hace 41d")
// → documentos. Lo unico que cambia es la hoja: donde Pendiente MH pone una
// pildora `ChipDoc`, acá va el documento con SUS observaciones, que es el dato
// de esta pestaña. Se fue la paginacion y el orden por columna: con 31 filas
// agrupadas no aportaban, y el agrupado ya da la jerarquia.
//
// Se mantiene el valor CRUDO del sello cuando no es un sello (`sello:
// "undefined"`), que es lo que permite reconocer el caso de un vistazo.

// v2.310.0 — Observaciones era 84% ruido: el sello tarda hasta 2 dias en llegar.
//
// La captura de la pestaña recien hecha mostro lo que ni el build ni el lint
// podian: de 180 filas, 151 eran facturas de HOY y AYER sin sello. Eso no es
// una anomalia, es el estado normal de una factura recien emitida — y para eso
// ya existe la pestaña "Pendiente MH". El ruido tapaba los 42 casos reales.
//
// 1 · **El umbral se MIDIO, no se estimo.** La distribucion de facturas sin
//     sello tiene un corte limpio en 2 dias: hoy 27, 1 dia 124, **2 dias CERO**,
//     3 dias 1, 5 dias 1, 336 dias 2. O sea el sello siempre llega dentro de 2
//     dias; lo que pasa de ahi esta varado. `p_dias_gracia_sello` es parametro
//     con default 2, no constante, para que ajustarlo no pida otra migracion.
//
// 2 · **El codigo de generacion tenia el MISMO corte** (hoy 4, 1 dia 12, 2 dias
//     cero, 3 dias 1) porque llega junto con el sello. Comparte el parametro:
//     es el mismo hecho fisico, no dos umbrales que coinciden de casualidad.
//     Renombrados a SIN_SELLO_VENCIDO y SIN_CODIGO_VENCIDO — el nombre dice lo
//     que la condicion hace.
//
// 3 · **Las otras clases NO llevan gracia, y eso tambien se verifico**:
//     SELLO_INVALIDO va de 41 a 450 dias de antiguedad, y SIN_CORRELATIVO con
//     TIPO_DOC_DESCONOCIDO son la misma factura de hace 266 dias. Ninguna es
//     transitoria, asi que darles ventana solo las habria escondido.
//
// De 180 filas a 31, todas accionables. Y las etiquetas se acortaron: `StatCard`
// corta cerca de los 14 caracteres y "Sin codigo ge…" no le dice nada a nadie.
//
// Nota de metodo: el bug lo encontro una captura de pantalla, no una prueba.
// Un gate verde no ve que una lista este llena de lo que no deberia estar ahi.

// v2.309.0 — La gota es de TÁCTIL: escritorio recupera su entrada.
//
// Reportado: "¿por que en escritorio se ve la animacion? eso solo era para
// movil". Tenia razon, y la compuerta nunca existio — no es algo que se rompio,
// es que entro asi. `useGotaApertura` se llamaba con
// `activo: !animacionPropia && !sinMovimiento`, sin preguntar por el dispositivo
// de entrada, desde v2.279.0 ("la gota para TODO dialogo"). Ese commit la subio
// de `HojaMovil` a `ModalShell` para que la heredaran las alertas y el ⌘K, y de
// paso se la llevo al escritorio.
//
// La gota dice "esto nacio del control que TOCASTE". En escritorio no hay tal
// toque: hay un clic con un puntero que ya esta donde apunta, asi que la premisa
// del gesto no existe. Ahora se pide `sinHover`, el mismo criterio con el que
// `ModalShell` ya decide hoja-contra-centrado.
//
// Y escritorio recupera su entrada, porque apagar la gota a secas lo dejaba
// apareciendo de golpe — que es justo lo que la nota de motion del proyecto
// llama "se lee como roto". Es la que tenia antes de v2.279.0
// (`animate-in fade-in zoom-in-95`) con una resta deliberada: **sin `fade-in`**.
// La opacidad por debajo de 1 hace que el panel componga como grupo y su propio
// `backdrop-filter` deje de muestrear el fondo, asi que el vidrio aparecia
// recien al terminar — el mismo defecto que este proyecto ya documento tres
// veces. Escalar al 95% no lo tiene: el blur pasa de 24px a ~23, que no se ve. Y
// el velo ya aporta el desvanecido por su lado.
//
// Verificado en los dos dispositivos de entrada:
//   escritorio (mouse)  hover:none=false  gota=false  clases=[animate-in, zoom-in-95]
//   tactil     (dedo)   hover:none=true   gota=true   clases=[]
//
// v2.308.0 — Facturación gana la pestaña que faltaba: Observaciones.
//
// v2.307.0 arreglo el bug y dejo el RPC `get_invoice_observations` listo, pero
// sin pantalla que lo consumiera. Esta entrada le pone la superficie.
//
// 1 · **Una pestaña que no mira UN problema, sino cualquiera.** Las otras cuatro
//     tienen su defecto conocido cada una; esta lista toda factura con algo
//     fuera de lo esperado, y el catalogo vive en el servidor en vez de estar
//     repartido en filtros de PostgREST. Tarjetas por tipo de observacion,
//     tabla ordenable y paginada, y el valor CRUDO del sello cuando no es un
//     sello — que es el dato que delata el bug, asi que se muestra.
//
// 2 · **Un codigo desconocido NO se oculta.** `metaObs()` cae en mostrar el
//     codigo tal cual si el mapa no lo tiene. Es la contraparte en el frontend
//     de los catch-alls del RPC: si el servidor empieza a reportar una clase
//     nueva, llega a la pantalla aunque nadie haya tocado esta vista. Ocultarla
//     seria repetir el defecto original con otra ropa.
//
// 3 · **El permiso, en las DOS capas** (migracion 20260731174500). Una pestaña
//     sin fila en `role_permissions` no la ve nadie: `allowedTabs` filtra por
//     `hasPermission('facturacion_tab_*')`, asi que la funcionalidad habria
//     quedado escrita y muerta. Espeja los 21 roles que ya ven Anuladas, con
//     `can_edit` en false: una observacion se corrige arreglando el dato de
//     origen, no marcandola como vista.
//
// Sin sondeo automatico, a diferencia de Anuladas y Pendiente MH: es una
// superficie de revision, no una cola en vivo, y el RPC recorre la tabla entera.

// v2.307.0 — "No es NULL" no es "tiene sello": 24 facturas contadas como buenas.
//
// Salio cuadrando `sales_invoices` contra el libro IVA del ERP: sobraban $282.58
// en 6 sucursal-meses. No era redondeo — era exactamente la suma de las facturas
// cuyo `recibido_mh` tiene basura en vez del sello de Hacienda.
//
// 1 · **El sync guardaba la CADENA "undefined".** `venta.recibido_mh ?? …`
//     atrapa el *valor* `undefined`, pero no el string, que ademas es truthy y
//     pasaba derecho. Llegaron 23 asi a produccion (mas un `''`), 21 de ellas el
//     mismo dia —7 de mayo de 2026, correlativos consecutivos en Salud 3 y
//     Salud 4—, o sea una falla de sync puntual, no goteo. Ahora hay
//     `selloValido()`: un sello son 40 caracteres, y cualquier otra cosa se
//     guarda NULL. Validado de los dos lados, asi que una fila con basura se
//     sana sola la proxima vez que el sync la toque.
//
// 2 · **El modulo las reportaba como CONFIRMADAS.** `facturacion.js` partia el
//     universo en `recibido_mh IS NULL` (pendiente) vs `IS NOT NULL`
//     (confirmada). 'undefined' no es NULL, asi que caian del lado bueno: no es
//     que no las detectara, las daba por selladas. Este filtro ya iba por su
//     segunda version mala — antes era `.eq('recibido_mh', true)`, que sobre una
//     columna `text` compara contra 'true' y devolvia CERO filas siempre. Las
//     dos fallaban en silencio porque una query que devuelve 0 no es un error.
//     Ahora exige la FORMA del dato: `like` con 40 `_`, que es como se expresa
//     `length()=40` en PostgREST (verificado contra prod: misma cuenta que
//     `length(...)=40`, y el parseo del filtro confirmado contra la API).
//
// 3 · **RPC `get_invoice_observations`** (migracion 20260731172746). Es la parte
//     que evita el proximo caso, no este: un solo catalogo de anomalias del lado
//     del servidor, con `observaciones` como array porque una factura puede
//     tener varias. Lo importante son los catch-alls — ESTADO_DESCONOCIDO y
//     TIPO_DOC_DESCONOCIDO — que hacen que un valor que el sync todavia no
//     escribe aparezca solo el dia que aparezca, en vez de repartirse en silencio
//     entre los buckets existentes.
//
//     Al correrlo aparecieron tres clases que nadie estaba mirando: 16
//     finalizadas SIN codigo de generacion, 1 sin correlativo y 1 con
//     tipo de documento fuera de CCF/COF.
//
// Los 24 registros historicos NO se tocaron: son datos fiscales y que pasó con
// ellos en Hacienda no se decide desde el portal. Con el filtro corregido ya
// aparecen solos en pendientes, asi que no hacia falta escribirles nada.

// v2.306.0 — El blur que costaba el scroll, y el pie que se comia el panel.
//
// 1 · **El scroll lento era un `backdrop-filter` que no se veia.** El cuerpo de
//     `GlassViewLayout` es `data-surface="card"` y envuelve la lista entera, asi
//     que mide MUCHO mas que la pantalla: medido, **4.8× en /minmax** (2197px de
//     alto) y 3.1× en /staff. Un `backdrop-filter` cuesta en proporcion al AREA
//     del elemento, no a lo que se ve de el, asi que ese blur se recalculaba
//     sobre ~2 millones de pixeles en cada cuadro del scroll.
//
//     Y no compraba nada: lo unico que tiene detras es `--bg-page`, que es un
//     degradado radial — difuminar un degradado suave devuelve el mismo
//     degradado. **Comprobado con un A/B**: las dos capturas de /minmax, con y
//     sin ese blur, son indistinguibles.
//
//     Se apaga con `data-vidrio="no"`, un opt-out EXPLICITO y no automatico.
//     "Es mas grande que la pantalla" no alcanza como criterio: una hoja a
//     pantalla completa SI tiene contenido detras que vale difuminar. Lo que
//     decide es si hay algo atras que mirar, y eso lo sabe quien conoce el
//     contexto. Se conserva fondo, borde, radio y sombra.
//
// 2 · **El pie de `ConfigPanel`/`LabsPanel` se comia el 40% del panel**, y la
//     causa la introduje yo en v2.304.0: para pasar el pie por la ranura de
//     `HojaMovil` lo envolvi en un div con `display: contents`. Pero `HojaMovil`
//     estila `[&>*]` —los hijos DIRECTOS del pie— para repartirlos a ancho
//     completo, y un div en el medio se come esa seleccion. `display: contents`
//     no ayuda: cambia como se dibuja, no quien es hijo directo para el
//     selector. Los botones perdian `flex-1 basis-36`, se apilaban en dos filas
//     y el cuerpo quedaba con dos campos a la vista.
//
//     Ahora las acciones van SUELTAS (un Fragment) en tactil, y el envoltorio
//     con su caja lo pone `envolver()` solo en escritorio. Y "Guardar
//     configuracion" pasa a "Guardar": en un panel de 420px el rotulo largo era
//     lo que forzaba el salto.
//
//     Verificado acostado: el pie es UNA fila y el cuerpo muestra 5 campos en
//     vez de 2; los rotulos dejaron de partirse en tres lineas.
//
// v2.305.0 — El material se parte en dos: el cluster vuelve a su vidrio.
//
// Correccion de v2.304.0, que se paso de alcance. Ahi se cambio `MATERIAL_HOJA`
// de `card` (16%) a `dropdown` (72%) para que la hoja dejara de dejar ver la
// tabla de atras — y esa parte estaba bien—, pero esa constante la comparten
// TRES superficies, y una es el **cluster flotante**. O sea que se le cambio el
// vidrio a una pieza que el usuario habia pedido explicitamente que fuera
// vidrio ("el liquidglass del filterpill no es liquidglass"), sin mostrarlo.
//
// Dos aclaraciones sobre lo que SI y lo que NO se hizo:
//
// · **No se invento ningun valor.** `MATERIAL_*` elige CUAL token usar, y los
//   dos —`--surface-card` y `--surface-dropdown`— ya existian. La paleta sigue
//   cerrada.
// · **No se quito el efecto glass.** Las dos superficies conservan
//   `backdrop-filter: blur(24px) saturate(1.6)` identico. Lo que cambia es la
//   opacidad del velo DETRAS del blur.
//
// Ahora son dos constantes, porque son dos trabajos distintos:
//
//   MATERIAL_CLUSTER = 'card'      16%  — FLOTA sobre la vista. Que se vea la
//                                         lista pasar por detras es la gracia.
//   MATERIAL_HOJA    = 'dropdown'  72%  — es donde se LEE y se decide. Ahi lo de
//                                         atras no es ambiente, es ruido encima
//                                         del texto.
//
// La medicion que ya estaba escrita en `BarraFlotante` decia esto mismo y se
// habia leido como si valiera para las dos: "vidrio pero ilegible" es un buen
// trato para el cluster y uno malo para un formulario.
//
// Verificado: cluster `card` rgba(230,245,255,0.16) + blur(24px); hoja
// `dropdown` rgba(240,248,255,0.72) + blur(24px).
//
// Y se corrigieron los dos comentarios que quedaron diciendo lo contrario del
// codigo ("el material es uno solo y vive en un solo sitio").
//
// v2.304.0 — Los paneles de MinMax al canonico, y la hoja deja de ser traslucida.
//
// 1 · **`ConfigPanel` y `LabsPanel` no eran canonicos, y se podia senalar donde.**
//     Pasaban `animacionPropia={enTactil}` a `ModalShell`. Eso significa "el hijo
//     se anima solo" — pero ninguno de los dos se animaba: solo APAGABAN la del
//     canonico. Resultado: aparecian de golpe, y como `useGotaApertura` es quien
//     cuelga `__gota`, el asa tampoco arrastraba. Reportado como "no tienen la
//     animacion". Se quita la prop y los dos heredan gota y arrastre.
//
// 2 · **El pie iba como `children`, y en una hoja los children caen DENTRO del
//     cuerpo scrolleable.** Asi que el pie se iba con el scroll en vez de quedar
//     anclado: acostado quedaba debajo del pliegue y se veia cortado —"Guardar
//     configuracion" a medias, en la captura del usuario—. `HojaMovil` ya tiene
//     la ranura `pie`, que lo ancla y le pone el area segura; `envolver()` ahora
//     recibe cuerpo y pie por separado.
//
// 3 · **El scroll malo era un scroll ANIDADO.** El cuerpo traia
//     `max-h-[70vh] overflow-y-auto` propio, dentro del cuerpo que `HojaMovil` ya
//     hace scrollear: el dedo movia uno u otro segun donde cayera. En tactil se
//     quita el tope propio; en escritorio se conserva, porque ahi el panel no
//     tiene alto propio y el tope si hace falta.
//
// 4 · **"¿Que es ese recuadro en los botones?" — no habia ningun recuadro.**
//     Eran los bordes de las celdas de la tabla de atras ATRAVESANDO la hoja.
//     `MATERIAL_HOJA` estaba en `card` (16% de opacidad), puesto "EN PRUEBA" el
//     2026-07-30 para que el cluster se leyera como vidrio. La nota de
//     `BarraFlotante` ya dejaba escrita la medicion que lo condenaba: con `card`
//     *"SALUD 2 se lee ENTERO y cae encima de ACCIONES. Es vidrio, pero
//     ilegible"*; con `dropdown` (72%) *"lo de atras queda como un fantasma"*.
//     Vuelve a `dropdown`. Verificado en la captura: "MIN · MAX" paso de leerse
//     entero a ser un fantasma.
//
// ── Y el desborde de 5px que quedo pendiente: NO existia ──────────────────
// Era un falso positivo de MI metrica de auditoria. Medido: el span mide 41px
// dentro de un boton de 77 (`seSaleDelBoton: -10`, `cortado: false`); lo que se
// salia era la capa decorativa del `Button`, deliberadamente mas grande y
// RECORTADA por el `overflow-hidden` del propio boton — el boton termina en 838
// y el panel en 844, o sea que nada se pinta fuera. La metrica comparaba cajas
// de layout ignorando el recorte de los ancestros. El defecto estaba en la
// medicion, no en la app.
//
// v2.303.0 — El hueco del borde, el asa que no arrastraba, y el blur duplicado.
//
// Tres cosas reportadas sobre el panel lateral, y las tres tenian causa distinta.
//
// 1 · **El hueco a la derecha era mio.** Puse el area segura como `pr-` del
//     ENVOLTORIO, y ese envoltorio es transparente —la superficie la pinta el
//     hijo—, asi que el relleno no corria el contenido: encogia el panel y
//     dejaba una franja por la que se veia la lista de atras contra el filo de
//     la pantalla. Es exactamente lo que se ve en la captura. El area segura va
//     sobre el CONTENIDO, adentro de la hoja, para que el material siga llegando
//     al borde. Medido despues: hueco 0px.
//
// 2 · **El asa de `LiquidModal` era decoracion.** Se rendeaba sin las props del
//     gesto, asi que TODOS los modales de ese canonico —y por el pasa
//     `UnifiedModal`, o sea casi todos los formularios del portal— dibujaban un
//     asa que prometia "esto se cierra arrastrando" y no cumplia. Ahora llama a
//     `useArrastreHoja` con `onClose` (no por contexto: el proveedor vive DENTRO
//     de `ModalShell`, asi que un `useContext` ahi arriba leeria el default).
//
//     Y no alcanzaba con pasarle el gesto: el asa quedaba DEBAJO del contenido
//     —los dos con `z-base`, gana el que va despues en el DOM— asi que el dedo
//     tocaba el formulario. Medido: el `pointerdown` aterrizaba en
//     `flex flex-col w-full min-h-full px-6`. Se le reserva el carril (`pl-6`) y
//     se le saca el margen negativo al asa vertical, que la sacaba fuera de la
//     caja donde el `overflow-hidden` la recorta.
//
// 3 · **Lo "lento/trabado" no era el modal: era la lista.** `GlassViewLayout`
//     pinta el cuerpo como `data-surface="card"` y `DataTable` pinta OTRA card
//     adentro, las dos con `blur(44px) saturate(2)`. Medido en un 17 Pro Max
//     acostado (956x440):
//
//       /minmax   4.8x la pantalla (2197px de alto) + 4.2x ANIDADA adentro
//       /staff    3.1x la pantalla (1408px de alto) + 2.4x ANIDADA adentro
//
//     O sea ~2 millones de pixeles difuminados DOS VECES, de forma permanente y
//     no solo con un modal abierto. Un `backdrop-filter` dentro de otro muestrea
//     una imagen ya difuminada: el aporte visual es casi nulo y el costo es una
//     segunda pasada completa. Regla nueva en index.css:
//
//       [data-surface="card"] [data-surface="card"] { backdrop-filter: none }
//
//     Se apaga SOLO el blur —fondo, borde, radio y sombra siguen, asi que el
//     apilado intencional de superficies se ve igual— y se limita a `card`
//     dentro de `card`: un `dropdown` o un `modal` sobre una card SI flotan
//     sobre contenido propio y su vidrio se gana. Verificado: las capas
//     anidadas desaparecieron, la mitad del area difuminada se fue.
//
// Auditoria re-corrida: 12 casos (6 modales x 2 orientaciones) en verde salvo un
// desborde de 5px en "Personal · Nuevo" acostado, que queda recortado por el
// `overflow-hidden` del panel y no se ve. ANOTADO, sin perseguir.
//
// PENDIENTE de esta tanda: la card exterior sigue difuminando 4.8x la pantalla.
// Bajarla es una decision de identidad visual (es el vidrio de Liquid Glass
// sobre la lista), no una correccion — se deja planteada.
//
// v2.302.0 — No Efectivo al canonico: una tabla que ordena y una paginacion que se ve.
//
// Opcion A del mockup aprobado. Se conserva la separacion por forma de pago —no
// es decorativa: tarjeta se concilia con el banco y credito se cobra al cliente—
// y se corrige todo lo demas.
//
// - `TablePagination` en los TRES sitios. El `Pagination` local pintaba todos los
//   numeros con variant="primary" sin compararlos nunca contra `page`, o sea que
//   LA PAGINA ACTUAL NO SE DISTINGUIA (verificado en vivo: cinco botones con la
//   misma clase, ninguno con aria-current). El canonico dice el rango, ofrece
//   tamano de pagina, es un <nav> con aria-live y baja de 7 tab stops a 3.
//   `PAGE_SIZE = 10` fijo se va: lo elige el usuario.
// - Las cabeceras de bloque dejan de ser un relleno saturado con texto blanco:
//   el color vive en el icono y en el monto (regla de §17.0).
// - La tabla de pendientes ORDENA. No se podia; la del historial si.
// - `useExpandStyle` en la fila de confirmar — el canonico exporta ese hook para
//   filas expandidas de <tr> crudo y no lo usaba NADIE.
// - Los filtros del historial van a `toolbar` de DataTable, no a la pildora:
//   §17 la reserva para lo que filtra la VISTA, y esos filtran una sub-tabla.
// - Un solo `BloqueFormaPago`: inmediatos y credito eran el mismo bloque escrito
//   dos veces, y por eso habian divergido.
//
// Efecto lateral: al simplificarse, TabNoEfectivo paso a ser analizable por el
// React Compiler y afloraron tres set-state-in-effect que YA estaban (la version
// anterior daba 0 porque el linter no llegaba a verlos). Anotados con su motivo.
//
// v2.301.0 — El cluster se apaga bajo una hoja, y LiquidModal aprende el costado.
//
// 1 · **El clúster flotante se apaga con un dialogo encima.** Reportado con el
//     panel lateral acostado: quedaba debajo del vidrio y se transparentaba a
//     traves del panel. Pasa igual de pie —la hoja inferior tambien lo tapa—
//     pero acostado se nota mas porque el panel cae justo encima.
//
//     Se CUENTA en vez de encender un booleano (`dialogosAbiertos.js`): los
//     dialogos se anidan —una hoja de filtros abre un `SelectorTactil`, una
//     confirmacion se abre sobre un formulario— y con un booleano, cerrar el de
//     adentro encenderia la barra estando el de afuera todavia abierto.
//
//     Y la variable `--barra-flotante-display` sigue teniendo UN solo escritor.
//     `AppLayout` ya la escribia para el menu; ahora mira las dos señales. Con
//     dos efectos escribiendola, gana el que corra segundo y cual es depende del
//     orden de render.
//
// 2 · **`LiquidModal` no sabia del panel lateral.** Fijaba
//     `max-h-[88dvh] rounded-t-modal rounded-b-none!` en cuanto el dispositivo
//     era tactil, sin mirar la orientacion: acostado calculaba su alto contra
//     `88dvh` DENTRO de un panel que ya mide 100%, y ponia el radio arriba en un
//     panel cuyo unico borde a la vista es el izquierdo. Importa mas de lo que
//     suena porque por ahi pasa `UnifiedModal`, o sea casi todos los formularios
//     del portal. Ahora recibe el mismo trato que `HojaMovil`: alto completo,
//     radio a la izquierda y asa vertical.
//
// ── Auditoria de modales (pedida) ─────────────────────────────────────────
// 6 modales abiertos en vertical y acostado, midiendo posicion, tamaño,
// desborde interno y si el pie queda dentro de la pantalla. Los 12 casos en
// verde: canonicos, sin desborde, sin botones fuera de cuadro.
//
//   MinMax Calcular · MinMax Filtros · Personal Filtros/Acciones/Nuevo ·
//   Sucursales Nueva
//
// Cadena de canonicos verificada: `UnifiedModal` → `LiquidModal` → `ModalShell`,
// y `ConfirmModal`/`PromptModal` → `HojaMovil` → `ModalShell`. Todos heredan.
//
// **Lo que NO es canonico** (4 dialogos que arman su propio overlay con
// `createPortal` + `fixed inset-0` y nunca tocan `ModalShell`, asi que no
// reciben hoja en tactil, ni gota, ni panel lateral, ni arrastre, ni el bloqueo
// de scroll de iOS):
//
//   src/components/common/RangeDatePicker.jsx        (popover anclado)
//   src/components/common/PeriodPicker.jsx           (popover anclado)
//   src/components/common/PhotoLightbox.jsx          (visor a pantalla completa)
//   src/views/schedule-tabs/components/InlineDayEditor.jsx  (editor anclado)
//
// Quedan ANOTADOS y sin tocar: los cuatro son popovers anclados o visores, o
// sea un patron distinto del modal, y convertirlos es un rediseño de cada uno.
//
// v2.300.0 — Acostado, la hoja entra de COSTADO (opcion B de los mockups).
//
// La hoja inferior es la gramatica correcta de pie. Acostada deja de serlo, y
// se puede medir: en un iPhone 13 (844 x 390) la hoja de filtros ocupaba el
// **63% del alto** —247 de 390px— para mostrar dos controles en una columna de
// 150px, con **694px de vacio al lado**. El alto es el recurso escaso acostado
// y la hoja inferior gasta justo ese.
//
// Se presentaron tres formas con mockups a escala (hoja en columnas, panel
// lateral, dialogo centrado). El usuario eligio el **panel lateral**:
//
//   · usa el alto COMPLETO (390 contra 247)
//   · deja la lista entera visible en la otra mitad, asi que se la ve filtrarse
//   · ningun modal rediseña su cuerpo: el contenido apilado de vertical entra tal cual
//
// Va pegado al borde DERECHO: es donde vive el clúster flotante —o sea donde
// esta el pulgar que lo abrio— y ademas el notch, cuando cae a la izquierda,
// dejaria el asa debajo del hardware.
//
// ── El eje viaja por el DOM, no por props ─────────────────────────────────
// `ModalShell` estampa `data-eje="x"|"y"` en el envoltorio y lo leen
// `useGotaApertura` y `useArrastreHoja`. Es la misma tecnica que
// `data-sombra-hoja`: `ModalShell` es el unico que posiciona paneles, asi que
// lo escribe una vez y los dos lo encuentran. Los 18 llamadores no se enteran —
// una prop de reenvio es una prop que alguien olvida.
//
// Lo que el eje cambia:
//   · `deslizamientoDe` (temas solidos) sale por X y el recorrido es el ANCHO
//   · `useArrastreHoja` mide el dedo en X, con el ancho como recorrido util
//   · `AsaHoja` se para: dibujo 4x36 y zona agarrable `px-2 -mx-2`
//   · el radio y la sombra se mudan al borde izquierdo (`--shadow-hoja-lateral`,
//     la misma sombra girada 90°: mismo desenfoque, misma opacidad)
//
// La gota (`clip-path`) NO necesito cambios: el recorte sale del rectangulo del
// control, este donde este. Solo el ARRASTRE necesitaba saber el eje.
//
// Solo afecta a lo que YA seria hoja. `align="top"` (el ⌘K) y las alertas
// centradas siguen donde estaban: su posicion dice de que tipo de cosa se
// trata, y eso no cambia al girar el telefono.
//
// Verificado en WebKit, los dos temas y las dos orientaciones:
//   acostado 844x390   lateral  397x390  47%x100%  eje x  asa vertical
//   acostado 932x430   lateral  420x430  45%x100%  eje x  asa vertical
//   vertical 390x844   inferior 390x247  100%x29%  eje y  asa horizontal
//   iPad 1133x744      escritorio, sin cambio
// En liquid la gota crece desde el control —inset(294 151 36 186) → none a los
// 414ms— con `blur(44px)` vivo todo el recorrido; el dedo la maneja en X
// (`inset(190 98 23 120)`) y soltar pasado el umbral cierra. En solid entra con
// `translate3d` en X a 200ms y el dedo deja `translate3d(154px, 0, 0)`.
//
// v2.299.0 — La barra de Facturacion, al canonico: tarjetas, pildora y pausa.
//
// Seis correcciones del usuario sobre la pasada de diseno anterior, que habia
// dado la vista por buena mirando el gate y no los componentes. `gate:design`
// pasaba —y sigue pasando— porque ninguna es una clase suelta: son piezas
// escritas a mano donde ya existe un canonico, y eso el gate no lo ve.
//
// - Tarjetas al canonico: las 4 pestanas dibujaban su resumen con <div> a mano
//   (cuadrito con degradado, fondo y borde tenidos por estado). Ahora `StatCard`
//   dentro de `CarrilCards`, con la regla de §17.0 — el color va en el NUMERO y
//   el ICONO, que es donde el color ES el dato; el fondo, nunca.
// - La pildora, a la fila de las tarjetas: ocupaba un renglon entero para si
//   sola. El nodo se construye una vez en el padre y se le entrega a la pestana
//   activa, asi que sigue habiendo UNA sola FilterBar montada.
// - Pausar/Reanudar es un descriptor de la pildora (`activo` → aria-pressed);
//   era un <Button> suelto escrito dos veces. `paused` subio al padre.
// - El limpiador de marcadores es una tarjeta (tono warning + active).
// - Fuera "Admin Facturas" y fuera el sello `Act. hh:mm` con su `lastRefresh`.
// - El filtro de mes de No Efectivo entro a la pildora, ranura "periodo".
//
// De paso salen `AuditThead` y `SolveRow`, definidos y nunca usados; el primero
// reintroducia el <th onClick> sin tabIndex/onKeyDown/aria-sort que DataTable
// arreglo el 2026-07-28.
//
// Verificado en Chromium a 1512px sobre las 4 pestanas: 0px de desborde y cero
// errores de consola.
//
// v2.298.0 — El corte por dispositivo, a los 5 sitios; y el notch acostado.
//
// Continuacion de v2.296.0, que arreglo el telefono acostado en `BarraFlotante`,
// `FilterBar` y `ConteoDetailView` pero dejo dos sitios con el literal viejo a
// proposito. El usuario pidio aplicarlo tambien ahi, asi que `TablePagination` y
// `AbcXyzMatrix` pasan a `useLayoutCompacto`: acostado ya no reciben la version
// de escritorio. Con esto los CINCO consumidores del corte salen del mismo hook
// y no queda ninguna copia del `(max-width: 719px)` a mano.
//
// Y el NOTCH. `viewport-fit=cover` ya estaba puesto —la app dibuja debajo del
// notch a proposito— pero en todo el codigo habia **una sola** referencia a
// `safe-area-inset-left` (el sidebar de escritorio) y **ninguna** a `-right`.
// De pie no importa: esos valores son 0. Acostado valen ~59px, y medido sobre
// /staff a 844x390 se metian en la banda del notch:
//
//   boton de menu (☰)       izquierda   43px
//   Mi Perfil               derecha     43px
//   celdas de la tabla      derecha     51px
//   clúster flotante        derecha     40px
//   tarjetas de metricas    ambos       18-30px
//
// Acá se corrige el clúster, que es el que se reporto: su contenedor pasa de
// `px-3` fijo a `pl/pr-[max(12px, env(safe-area-inset-left/right))]`. Con
// `max()` y no a secas, para que donde el inset es 0 quede el margen de siempre.
// El resto de la lista (encabezado, tabla, metricas) queda anotado y sin tocar:
// es la misma correccion pero en superficies que no se pidieron.
//
// v2.297.0 — Solventar no escribia nada, y dos de cuatro lo auditaban igual.
//
// Las tres tablas de resoluciones de Facturacion tenian RLS activo con UNA sola
// policy, de SELECT. Sin policy de INSERT, Postgres rechazaba toda escritura del
// cliente: los cuatro "Solventar" no guardaban nada, y las tablas no recibian una
// fila desde mayo (12 / 2 / 2).
//
// Nadie lo vio porque la vista no avisaba. El handler de Pendiente MH y el de
// Campos Nulos hacian `await insertX(...)` SIN desestructurar `error`:
// actualizaban el estado local y llamaban `appendAuditLog`, asi que la fila
// desaparecia —volvia al recargar— y la bitacora registraba algo que nunca paso.
// `audit_logs` tiene un SOLVENTAR_PENDIENTE_MH del 25-jun sobre el invoice
// 6616294 con cero filas de resolucion: ese es el CCF que seguia atorado el 31-jul.
//
// - Migracion 20260731153235: INSERT con (SELECT auth_can_edit_any(['facturacion']))
//   en las tres — la misma que ya usaba sales_payment_confirmations, el unico
//   camino de escritura sano de la vista. Append-only: sin UPDATE ni DELETE,
//   porque el boton de cancelar solo cierra el formulario. Probado con
//   BEGIN…ROLLBACK: con can_edit escribe, sin can_edit sigue bloqueado.
// - Los cinco handlers chequean el error y avisan con toast; el audit log se
//   escribe solo si la fila entro.
// - `updateInvoiceReceivedMh` eliminado: escribia la cadena 'true' encima del
//   sello fiscal de 40 caracteres. El sello lo pone Hacienda via sync, y una
//   resolucion manual deja recibido_mh NULL — que es lo que la lectura ya esperaba.
// - `fetchConfirmedMhInvoices` filtraba .eq('recibido_mh', true) sobre una
//   columna text → 0 de 21,666 filas con sello en julio. Ahora .not(..., 'is', null).
// - Gating `can_edit` en `facturacion`: el mismo permiso que exige el RLS, asi que
//   la UI dejo de ofrecer un boton que el servidor iba a rechazar.
//
// v2.296.0 — Un telefono ACOSTADO seguia siendo un telefono.
//
// Reportado: al girar el telefono desaparece el clúster flotante y vuelve la
// barra de filtros de escritorio. El corte era `(max-width: 719px)` a secas, y
// eso da por sentado que un telefono es angosto — acostado no lo es. Medido en
// WebKit sobre /staff:
//
//   iPhone 13 acostado        844 × 390  → clúster NO
//   iPhone 15 Pro Max acost.  932 × 430  → clúster NO
//   Android grande acostado   915 × 412  → clúster NO
//
// O sea que TODO telefono del iPhone 13 en adelante perdia los controles de
// pulgar al girar, y recibia en su lugar objetivos pensados para mouse. El
// único que se salvaba era el iPhone SE (667 acostado), y se salvaba **por
// accidente**: 667 cae debajo de 719. No habia ninguna intencion ahi — los
// telefonos crecieron y se pasaron del numero.
//
// La regla correcta ya estaba escrita en este repo: `useCoarsePointer` dice
// textual *"lo que decide no es cuanto mide la ventana sino con que se
// apunta"*, y `TabBarAction`/`ModalShell` deciden por `(hover: none)` por eso
// mismo. Faltaba aplicarla aca.
//
// Pero `(hover: none)` SOLO tampoco sirve: metería a las tablets en el layout
// del telefono, y ahi sobra sitio para la barra completa — el clúster existe
// para llegar con el pulgar en una pantalla chica, no para toda pantalla
// tactil. Lo que distingue un telefono acostado de una tablet acostada no es el
// ancho, es el **alto**: telefonos 375-430px, tablets 744-834px. 500 cae limpio
// en el medio con mas del doble de margen a cada lado.
//
//   (max-width: 719px), (hover: none) and (max-height: 500px)
//
// Vive en `useLayoutCompacto` y NO en un literal repetido, que es la otra mitad
// del arreglo: `BarraFlotante`, `FilterBar` y `ConteoDetailView` tienen que
// coincidir —lo dice el comentario de las tres— y estaban sincronizados a mano,
// o sea sincronizados hasta que alguien tocara uno. Y eso paso en esta misma
// edicion: al cambiar `FilterBar` y dejar `ConteoDetailView` con su copia, el
// segmentado de esa vista se habria dibujado en riel dentro de la hoja, que es
// EXACTAMENTE lo que su comentario advertia. El hook lo vuelve imposible.
//
// Verificado despues, en las dos orientaciones: los 4 telefonos muestran el
// clúster de pie y acostados, con las 5 columnas a 60px y sin recorte (la barra
// ocupa 111px, 26-30% del alto acostado); y las 2 tablets siguen en escritorio,
// sin cambio.
//
// `TablePagination` y `AbcXyzMatrix` se dejaron con el corte por ancho a
// proposito: ahi la pregunta es "¿entra esto?", que SI es de espacio y no de
// como se apunta — la distincion que el propio `useMediaQuery` documenta.
//
// v2.295.0 — El buscador ALTERNA, y el clúster cierra con LIMPIAR.
//
// Tres cosas pedidas sobre el clúster móvil, y una cuarta que apareció al medir.
//
// 1 · **Buscar alterna.** Antes solo abría: el campo quedaba abierto para
//     siempre mientras tuviera texto (`campoAbierto = buscando || conTexto`), o
//     sea que la única forma de dejar de verlo era borrar el término — cerrar el
//     campo costaba perder el filtro. Ahora el mismo botón lo cierra y el
//     término sigue aplicado.
//
//     El estado se anota en `pointerdown` y se lee de un ref, no del render:
//     `blur` llega ANTES que `click`, así que un toggle que mirara el estado
//     actual vería "cerrado" y volvería a abrir — el botón no podría cerrar
//     nunca. Y `onBlur` ahora cierra SOLO si el campo está vacío: con texto,
//     recogerlo por un toque en cualquier otra parte se llevaría de la vista un
//     filtro que sigue vivo.
//
// 2 · **Indicador de término aplicado.** Un PUNTO, no una cuenta: una búsqueda
//     no se cuenta, está o no está, y un `Contador` con un "1" ahí diría "un
//     resultado". Va en el mismo sitio y con el mismo aro que el badge de las
//     acciones, porque es la misma señal —"esto tiene algo aplicado"— dicha sin
//     número.
//
// 3 · **Quinto botón: LIMPIAR.** Ícono ✕, tono destructivo, y **último**. Va al
//     final porque abarca todo lo que tiene a su izquierda —los filtros y la
//     búsqueda—, así que cierra la fila en vez de partirla; entre BUSCAR y
//     FILTROS parecería pertenecer a uno de los dos. Se rotula LIMPIAR y no
//     FILTROS porque también borra el término del buscador: FILTROS prometería
//     menos de lo que hace, y además ya hay un botón con ese rótulo al lado.
//     Solo aparece cuando hay algo que quitar, y decide eso mirando el `badge`
//     que YA se dibuja en el clúster — así no puede contradecir a lo que se ve.
//
// 4 · **Las columnas no entraban.** Medido con cinco botones en WebKit/iPhone:
//     a 320px se cortaban 35px contra el borde de la pantalla y a 280px, 75. Y
//     no era culpa del quinto: con CUATRO, a 280px ya se perdían 9px — el ancho
//     fijo de 60px con `shrink-0` estaba justo desde antes.
//
//     Ahora la columna es elástica entre 60 y 44px (el mínimo táctil): 60 en
//     cuanto hay sitio, y cede solo cuando de verdad no entra. Medido con los
//     cinco: 280→44px, 320→52px, 360 en adelante→60px, sin recorte en ninguno.
//     Se usa `w-[60px] shrink` y no `basis-[60px]`: con `flex-grow: 0` el
//     navegador dimensiona el clúster por el CONTENIDO de cada botón, así que
//     con `basis` las columnas se cerraban al ancho del rótulo más largo —49px
//     incluso a 430px, donde sobra sitio—.
//
//     Y `hyphens-auto` junto a `break-words`: comprimido a 52px, "ACCIONES" se
//     partía en "ACCIONE" + "S", y esa letra suelta en la segunda línea se lee
//     como un error de dibujo. Con separación silábica queda "ACCIO-NES". El
//     documento ya declara `lang="es"`, que es lo que el navegador necesita.
//
// De paso, el ARIA que el toggle volvió obligatorio: el rótulo tiene 60px y por
// eso es un verbo suelto, pero quien no ve el clúster no tiene el contexto que
// hace que ese verbo alcance. `aria` va separado del rótulo visible ("Quitar
// todos los filtros y la búsqueda", "Abrir la búsqueda — filtrando por X") y
// `aria-expanded` marca los botones que abren algo que se queda — el campo y
// las acciones con hoja, no las que disparan y se van.
//
// v2.294.0 — Solid deja de imitar la gota: se desliza, y el asa por fin cierra.
//
// Reportado: en Liquid Glass la animacion y el arrastre funcionan; en Solid "se
// siente mas trabado", cuando deberia ser al reves porque es el tema pensado
// para equipos de pocos recursos. Filmado en WebKit/iPhone con el tema puesto,
// las tres causas resultaron ser una sola decision mal tomada.
//
// La rama sin vidrio era `transform: scale(0.94) → scale(1)`, elegida porque el
// compositor mueve `transform` sin repintar. El razonamiento valia; la eleccion
// no:
//
// · **Escalar SI repinta.** La capa `data-sombra-hoja` es HIJA del panel, asi
//   que el `scale` la deformaba: 18px de difuminado re-rasterizados en cada
//   cuadro. Y sin efecto a cambio — medido, `somTransform` se quedo en `none`
//   los 700ms. El camino "barato" pagaba lo caro del otro sin cobrar lo suyo.
// · **Un zoom del 6% no es una gramatica.** No dice de donde salio (la gota) ni
//   hacia donde se va (el deslizamiento).
// · **El asa no hacia nada.** El arrastre reproduce la animacion de entrada
//   leyendo `__gota`, y `__gota` solo se colgaba en la rama del vidrio: en Solid
//   el dedo no despeinaba un cuadro. Un asa que promete "esto se cierra hacia
//   abajo" y no cumple es peor que no tenerla.
//
// Ahora hay DOS gramaticas, una por material, y el asa cierra en las dos:
//
//   con vidrio  → la gota (`clip-path`): el vidrio es una lente, corresponde
//                 abrir la ventana por la que se mira. Sin cambios.
//   sin vidrio  → deslizamiento (`translate3d`): superficie opaca y recta, una
//                 sola propiedad compuesta, cero repintado. El panel entero y no
//                 la hoja, para que la sombra viaje con ella ya rasterizada.
//
// `__gota` se cuelga en las dos ramas y dice que tecnica esta en juego;
// `arrastreHoja` la lee y alimenta esa, no una tercera. El descriptor se busca
// hacia ARRIBA (`descriptorGota`) en vez de recalcular el elemento: habia dos
// copias de la misma funcion y ya habian divergido —una devolvia `null` donde la
// otra devolvia `el`—, que es exactamente como el arrastre y la animacion
// llegaron a discrepar sobre cual era el elemento.
//
// Y el reloj sale del TEMA: `--gota-entrada`/`--gota-salida` valen 340/240ms en
// liquid y 200/140 en solid —los mismos 340/240 por el 0.6 que ya aplican sus
// `--dur-*` desde el 2026-07-28—. `ModalShell` cuenta el desmontaje desde ese
// token y no desde una constante: con `EXIT_MS` fijo, acortar la animacion
// habria AGREGADO una espera visible (la hoja termina a los 140 y el nodo se
// quedaba 160ms mas en pantalla).
//
// Dos defectos que apagaban todo esto y solo se ven contra el build:
//
// · **`transitionend` BURBUJEA.** El limpiador filtraba por `propertyName` pero
//   no por `ev.target`, y `transform` es la propiedad mas transicionada de la
//   app —cada boton del contenido la lleva—. El primer evento ajeno borraba el
//   desplazamiento: medido, ya estaba en `none` a los 57ms de una animacion de
//   200. Con `clip-path` el filtro por propiedad alcanzaba porque nadie mas la
//   anima; con `transform` no alcanza ni de lejos. Ahora se filtra por objetivo
//   tambien, en las dos ramas.
// · **Lightning CSS minifica `200ms` a `.2s`.** `parseFloat` devolvia 0.2 y la
//   transicion salia de **0.2 milisegundos** — instantanea, indistinguible de no
//   tener animacion. En `npm run dev` no pasa (no hay minificador): solo aparece
//   contra el build. `tiemposGota()` lee la unidad.
//
// Filmado despues, Solid: la entrada va `186 → 138 → 86 → 52 → 30 → 16 → 7.9 →
// 2.8 → 0.4` y limpia a los 254ms; el dedo deja `translate3d(0,144px,0)` con
// `transition: none`; el cierre corre a 140ms. Liquid sin cambios: `.34s/.24s`,
// `blur(24px)` vivo durante toda la gota y la sombra morfando con ella.
//
// De paso, dos correcciones del mismo archivo: la segunda pasada de foco corria
// `EXIT_MS + 40` = 280ms contra un desmontaje a los 300, o sea 20ms ANTES de que
// el panel se fuera —justo lo que su comentario decia estar evitando—; y la
// salida deslizando reusa el recorrido GUARDADO en vez de recalcularlo, por la
// misma razon por la que la gota guarda su recorte.
//
// v2.293.0 — `offsetWidth` fuerza LAYOUT, no estilo: por eso Safari saltaba.
//
// La version llegaba bien al telefono —confirmado— asi que la diferencia era del
// motor. El sospechoso resulto ser el truco de reflujo: se hacia con
// `void el.offsetWidth`, que fuerza *layout*. En Chromium y en el WebKit de
// pruebas eso alcanza para que una transicion fije su punto de partida; **en el
// Safari de iOS no siempre**, porque lo que la transicion necesita es que el
// estilo COMPUTADO este recalculado, y leer una medida geometrica no lo
// garantiza. Sin punto de partida fijado, el navegador junta los dos estados y
// salta al final: la animacion "no se ve, solo desaparece".
//
// `fijarEstilo(el, prop)` lee ADEMAS `getComputedStyle(el)[prop]`, que si obliga
// al recalculo de estilo. Se aplica en los tres sitios donde se sembraba un
// estado inicial.
//
// Y la sombra en la salida ahora siembra su `transform` en identidad antes de
// animarlo: desde `none` Safari no siempre interpola, y encima `transform-origin`
// cambiaba a la vez que el transform —lo que produce un salto en vez de un
// recorrido—.
//
// Filmado despues: el cierre por fondo va `26 14 4 47` → `100 54 15 182` →
// `140 76 21 255` → `156 85 23 285` y desmonta a los 325ms.
//
// v2.292.0 — La barra se esconde por FRACCION de pantalla, no por pixeles fijos.
//
// El umbral estaba en 70px acumulados y la barra se seguia yendo con medio toque
// —reportado dos veces—. El motivo es del telefono, no del numero: ahi un flick
// corto arrastra INERCIA y recorre 150-300px sin que la persona sienta que hizo
// "un scroll grande". Cualquier constante en pixeles queda por debajo del gesto
// minimo del sistema.
//
// Ahora es el 35% del alto de la ventana: en un telefono de 932px son ~325,
// o sea un recorrido que se hizo a proposito. Medido: 40, 120 y 250px la dejan;
// 500 la esconde.
//
// Se revisó tambien si el service worker estaba sirviendo un bundle viejo —seria
// la explicacion mas simple de que varias correcciones "no llegaran"— y NO es
// eso: `public/sw.js` es network-first y solo cachea la pagina offline y el logo.
// La version se muestra en la interfaz, asi que se puede cotejar de un vistazo.
//
// v2.291.0 — El recuadro era el RADIO de la sombra, y el cierre no llegaba a verse.
//
// **El recuadro.** La capa de sombra conserva su `rounded-t-modal` de 32px, y al
// escalarla con `transform` el radio se encoge con ella: sobre una caja del
// tamano de un boton queda casi recta y se lee como un recuadro acompanando a la
// gota. Con `border-radius: 50%` el borde es siempre una elipse, escale lo que
// escale.
//
// **El cierre "solo desaparecia".** Dos causas sumadas: la curva de salida era
// TRASERA —`cubic-bezier(0.3,0,0.8,0.15)` deja el recorrido casi entero para el
// final: medido, a los 224ms de 240 iba por el 53%— y el desmontaje ocurria al
// mismo tiempo que la animacion, asi que el ultimo tramo se cortaba. Ahora la
// curva es la estandar de salida y el desmontaje va 60ms despues. Medido: el
// recorte llega a 156 (completo) a los 279ms y recien se desmonta a los 345.
//
// **La pildora ya no titila.** El umbral era de 8px: medio toque hacia abajo la
// escondia. Ahora hay que acumular 70px de bajada intencional; subir la muestra
// siempre, y cualquier salto grande (una restauracion de scroll) se sigue
// ignorando. Medido: 25px la deja, 100 la esconde.
//
// **Y el filtro unico dice el VALOR, no el nombre.** En Facturas de Compra el
// boton decia "Periodo" y habia que abrirlo para saber cual; ahora dice "Este
// mes". Lo calcula el control (`PeriodPicker.textoRanura`) y no la vista, por lo
// mismo que el icono: un dato que el control ya sabe no se declara dos veces.
//
// v2.290.0 — Tiempos segun la referencia, la sombra deja de repintar, y el recuadro.
//
// **Los tiempos.** Las guias de interfaz coinciden bastante: Material pone las
// transiciones de superficie grande en 200-300ms (225 al entrar, 195 al salir,
// 375 lo "complejo"); las hojas de iOS rondan los 350; y el umbral clasico dice
// que arriba de 400ms una respuesta se lee como espera y no como movimiento.
// Este componente paso por los dos extremos y los dos se reportaron: 520ms con
// curva muy adelantada se sintio APURADA, 560 con curva pareja se sintio LENTA.
// No era el numero solo: era la combinacion. Ahora 340 al entrar y 240 al salir,
// con `cubic-bezier(0.2,0,0,1)` —arranca decidido y se asienta—, que cae dentro
// de la referencia y resuelve las dos quejas. Medido: la gota termina a los
// ~372ms contra 574 antes.
//
// **La sombra SI era la lentitud, y no por existir sino por COMO se movia.** Se
// animaba con `top/right/bottom/left`, que son propiedades de LAYOUT: cada cuadro
// obliga a recalcular posicion y repintar, y esa capa proyecta un `box-shadow` de
// 44px de difuminado sobre 430px de ancho. Repintar eso 60 veces por segundo es
// de lo mas caro que se le puede pedir a un telefono. Ahora se mueve con
// `transform` + `opacity`, las dos unicas propiedades que el compositor mueve sin
// repintar. La capa no lleva vidrio, asi que escalarla no tiene el problema del
// `backdrop-filter`.
//
// **El recuadro: el panel TODAVIA llevaba `shadow-[var(--shadow-hoja)]`.** Una
// edicion anterior no lo quito porque la cadena ya habia cambiado, asi que habia
// dos sombras — la de la capa, que morfa, y una rectangular de ancho completo que
// no se animaba nunca. Al cerrar, la hoja se recogia en pildora y el recuadro
// seguia ahi.
//
// **Y la pildora ya no se esconde al cerrar.** El bloqueo de scroll restaura la
// posicion con `scrollTo`, y eso llegaba al autoocultado de la barra como un
// desplazamiento de cientos de pixeles: lo leia como "el usuario bajo". Un dedo
// produce muchos deltas chicos; un salto produce uno enorme. Arriba de 120px se
// ignora.
//
// v2.289.0 — El dedo maneja LA GOTA, y la apertura deja de sentirse apurada.
//
// **El arrastre ya no usa `transform`.** Movia la hoja con `translateY`, asi que
// al soltar habia dos animaciones sobre el mismo elemento —el transform volviendo
// a cero y el clip cerrando— y lo que se veia era el deslizamiento: *"en vez de
// cerrarse en forma de gota, se desliza el asa con la card para abajo"*. Ahora el
// desplazamiento del dedo se convierte en un AVANCE de 0 a 1 sobre el mismo
// recorte que uso la entrada, asi que arrastrar es previsualizar el cierre.
// Soltar solo decide si ese avance sigue hasta 1 o vuelve a 0.
//
// **Y la salida ya no reinicia el gesto.** Sembraba el recorte abierto antes de
// transicionar —necesario cuando se cierra por el fondo, porque ahi no hay
// ninguna forma de la que partir— pero eso descartaba lo que el dedo habia
// avanzado: filmado, el gesto llevaba la hoja a `inset(139 76 20 254)` y a los
// 165ms SALTABA a `5 3 1 10` para recomenzar. Ahora se siembra solo si el recorte
// esta en `none`. Filmado despues: `139 76 20 254` → `146` → `151` → `156`, sin
// corte.
//
// **La apertura pasa de 520 a 560ms y cambia de curva.** No era la duracion: era
// que `cubic-bezier(0.22,1,0.36,1)` hace el 46% del recorrido en los primeros
// 110ms, asi que aunque durara medio segundo se SENTIA apurada. `(0.32,0.72,0,1)`
// reparte el movimiento parejo y llega igual de suave.
//
// v2.288.0 — La gota, filmada cuadro a cuadro: dos defectos que los estilos
// computados no podian mostrar.
//
// Se dejo de muestrear a mano y se GRABO la animacion desde dentro de la pagina
// con `requestAnimationFrame`. Recien ahi aparecieron los dos:
//
// **1. `transitionend` escucha CUALQUIER propiedad.** La hoja lleva
// `data-surface`, y en `index.css` esa superficie declara
// `transition: transform, …` con varias. Al abrirse, la primera de ELLAS en
// terminar disparaba el handler que retira el recorte, y la gota se cortaba a
// los pocos milisegundos. Se veia como que solo la sombra hacia el efecto —
// porque la sombra es otro elemento y no tiene transiciones que compitan. Ahora
// se filtra por `propertyName === 'clip-path'`. Filmado: la apertura pasa de
// `inset(156 85 23 285)` a `0 0 0 0` en 520ms, los cuatro lados interpolando.
//
// **2. El cierre recalculaba el recorte y le daba otro.** Medido: la entrada
// arrancaba en `156 85 23 285` y la salida terminaba en `0 80 22 268` — sin
// encogerse verticalmente, o sea una rendija en vez de una gota. Entre abrir y
// cerrar cambia lo que hay alrededor, asi que dos calculos separados no
// coinciden. Ahora la salida **reproduce la cadena exacta que uso la entrada**:
// la simetria queda garantizada por construccion y no por que dos cuentas den lo
// mismo. Filmado: el cierre va `10 6 2 19` → `62 34 9 114` → `147 80 22 268`,
// que es el camino de la apertura al reves.
//
// v2.287.0 — Los tres del iPhone: el scroll, la sombra y el cierre. Tres causas
// distintas, y ninguna se veia con estilos computados.
//
// **1. `overflow: hidden` NO bloquea el scroll en Safari de iOS.** Es un
// comportamiento viejo y conocido; el documento sigue moviendose con el dedo.
// Ahora el bloqueo saca el documento del flujo —`position: fixed` con el
// desplazamiento como `top` negativo— y al cerrar restaura la posicion. Sin lo
// segundo, cerrar devolveria al principio de la lista, que es peor que el
// problema. Medido: fondo en 270 antes y despues de arrastrarlo, y 270 otra vez
// al cerrar.
//
// **2. La capa de sombra llevaba `-z-base`, una clase QUE NO EXISTE.** `z-base`
// esta definida como utilidad, su negativo no. O sea que era una clase escrita
// que nunca pinto nada. Se retira: la capa va antes que el contenido en el DOM y
// eso ya la deja debajo.
//
// **3. El cierre saltaba porque no habia nada que interpolar.** Al terminar la
// entrada el recorte se retira (`clipPath = ''`), asi que al cerrar la transicion
// iba de `none` a `inset(...)` — y `none` no es una forma. El navegador salta al
// valor final: exactamente "se cierra de golpe y se siente torpe". Ahora se
// SIEMBRA el recorte abierto, se fuerza el reflujo y recien ahi se transiciona.
// Y los dos extremos llevan los CUATRO radios: con `round 9999px` de un lado y
// cuatro valores del otro, Safari tampoco interpola.
//
// De paso, `prefers-reduced-motion` caia en `animate-out slide-out-to-bottom`:
// quien pidio MENOS movimiento recibia el unico deslizamiento del portal. Sin
// movimiento es sin movimiento.
//
// Medido en WebKit sobre el ciclo completo: al abrir, recorte a los 80ms
// (`inset(67 36 9 122)`) y a los 320 (`inset(2.4 1.3 0.3 4.4)`); al cerrar, a los
// 90 (`l35`) y a los 240 (`l203`), con la capa de sombra siguiendolo exacto.
//
// v2.286.0 — El cierre ahora SI es la gota, y la sombra hace el recorrido.
//
// Tres causas, las tres mias.
//
// **La sombra no se movia con el dedo: se buscaba en el sitio equivocado.** El
// arrastre hacia `panel.querySelector('[data-sombra-hoja]')`, pero la capa es
// HERMANA de la hoja —vive en el panel de `ModalShell`—, asi que nunca la
// encontraba. Ahora se busca en el padre. (El nombre `refPanel` venia de antes de
// que la capa existiera y ayudo a la confusion.)
//
// **El cierre duraba 180ms contra los 520 de la entrada.** Casi 3× mas rapido: a
// esa velocidad el recorrido no se LEE, la hoja parpadea y desaparece. Ahora son
// 380 — cerrar sigue siendo mas rapido que abrir, porque abrir es una invitacion
// y cerrar una respuesta, pero la diferencia es de un tercio y no de tres veces.
//
// **Y la sombra solo se desvanecia.** No se puede recortar con la forma: un
// `clip-path` se comeria justamente lo que cae fuera de la caja, que es toda la
// sombra. Lo que se anima es su CAJA — la capa se encoge hasta el rectangulo del
// control y su `box-shadow` se dibuja alrededor de eso—, asi que ahora crece y
// se encoge CON la gota en vez de aparecer y desaparecer encima.
//
// Medido en WebKit: al cerrar por el fondo y por el asa, el recorte va al
// rectangulo del boton y la capa de sombra lo acompana (lados 0,43 y 0,71 con el
// radio subiendo a pildora); durante el arrastre la sombra lleva `translateY`,
// que antes era `none` — esa era la prueba del bug de la hermana.
//
// v2.285.0 — Auditado EN WEBKIT: la gota no corria, y el fondo no estaba bloqueado.
//
// Las tres cosas reportadas tenian dos causas, y las dos las introduje yo.
//
// **La gota no corria: el detector de vidrio miraba solo el PRIMER hijo.** Al
// agregar la capa de sombra quedo ella primera, `objetivoVidrio()` devolvia
// `null`, y TODO modal se iba por el camino de `transform` — que ademas, siendo
// ancestro del vidrio, lo mata. De ahi los tres sintomas juntos: sin gota al
// abrir, sin gota al cerrar, y la sombra al 100% desde el primer cuadro porque
// su codigo vive en la rama del recorte. Ahora busca entre TODOS los hijos: un
// detector que mira "el primer hijo" asume un orden que nadie prometio.
//
// **El fondo scrolleaba porque el contenedor sin velo llevaba
// `pointer-events: none`.** Los toques lo atravesaban y la lista de atras se
// movia con la hoja abierta. Invisible no es ausente: el contenedor sigue
// capturando, solo que sin pintar nada. Medido: un gesto real sobre el fondo deja
// `scrollY` en 0.
//
// **Y por que no se vio antes: las pruebas corrian en Chromium.** Es la segunda
// vez en esta tanda —la primera fue el arrastre de las tarjetas—, y las dos veces
// el motor que importa es WebKit. Esta verificacion se corrio ahi: en liquid,
// recorte al abrir con la sombra entrando en 0.55, recorte al cerrar por fondo y
// por arrastre, y `backdrop-filter` vivo en todos los cuadros; en solido, el
// camino de `transform`.
//
// v2.284.0 — Se recupera el arrastre de las tarjetas, y la sombra acompana al gesto.
//
// **1. Volvio el deslizamiento horizontal de las tarjetas.** v2.278.0 le puso
// `pointer-events: none` a la pista para que el aire de la sombra no robara
// clics, y eso rompio el arrastre tactil: **WebKit no desplaza un contenedor con
// scroll que no es alcanzable por el puntero**. Quedaban solo las flechas.
// Chromium SI lo arrastra, asi que la prueba automatizada no lo vio — el mismo
// motivo por el que el QA movil de este proyecto va en WebKit.
//
// Ahora el reparto es por entrada, y es el correcto para cada una:
// `[@media(hover:hover)]` apaga los eventos solo donde hay mouse —ahi manda no
// robar clics, y hay flechas y rueda para desplazar—; con dedo manda poder
// arrastrar, que es la unica forma natural de moverlas.
//
// **2a/2b. La sombra pasa a ser una CAPA propia.** Era el `box-shadow` del
// envoltorio, y eso la dejaba clavada mientras el dedo bajaba la hoja: quedaba
// una banda de sombra en el sitio viejo, o sea un corte a la vista. Y al abrir
// aparecia de golpe al final, porque no habia como animarla con la forma. Como
// capa, la gota la desvanece CON la forma y el arrastre la mueve y la apaga
// segun cuanto bajo la hoja — a media altura, una sombra al 100% se lee como una
// sombra flotando sola.
//
// **2c. Al soltar para cerrar, cierra con LA GOTA.** Antes deslizaba hacia abajo,
// que es otra animacion que la de entrada: dos gramaticas para el mismo objeto
// hacen que el cierre se lea como de otra pieza. Ahora se suelta el `transform`
// con una transicion corta y `useGotaApertura` hace el recorrido inverso — el
// mismo camino que la hoja hizo al abrirse, de vuelta al control que la abrio.
//
// v2.283.0 — Auditoria completa: Pedidos pesaba 939 kB por unas fuentes que nadie
// pidio, y dos columnas se estaban leyendo con el tipo equivocado.
//
// **809 kB de fuentes PDF que se bajaban al ENTRAR.** `pedidoPrint.js` importaba
// `pdfmake` + `vfs_fonts` de forma ESTATICA, asi que abrir Pedidos costaba 939 kB
// gzip —4x el tablero entero— imprimiera el usuario o no. Igual ConteoDetalle
// (865 kB). Peor: ese archivo tambien exporta matematica pura (`getPageGroups`,
// `buildPedidoCodigo`, `fefoProject`) y **3 de sus 4 importadores solo usan eso**
// — pagaban las fuentes sin tocar un PDF. Ahora se cargan con `await import()` al
// apretar imprimir. **PedidosView 939 → 131 kB. ConteoDetailView 865 → ~56 kB.**
//
// Esto explica un numero que la auditoria de arranque dejo sin explicar: decia que
// el prefetch bajo Pedidos de 1,947 a 1,241 ms y lo atribuia al throttle de
// Suspense (291 ms). Pero 706 ms con 70 ms de latencia es el tiempo de bajar
// ~800 kB. El prefetch no arreglo Suspense: adelantaba las fuentes.
//
// **El tipo de la columna manda, no el nombre.** `sales_invoices.recibido_mh` es
// `text` —guarda el sello de Hacienda, 40 caracteres, 337,815 filas lo tienen—
// pero el frontend lo trata como booleano: `.eq('recibido_mh', true)` compara
// `text = 'true'` y devuelve CERO filas **desde siempre** (la lista "confirmadas
// por MH" nunca mostro nada), y `.update({recibido_mh: true})` escribiria la
// cadena 'true' ENCIMA del sello fiscal. Y `employees.is_admin` **ya no existe**:
// tres funciones de `requests.js` la siguen consultando, y son los fallbacks del
// enrutador de aprobadores — cuando la jerarquia no encuentra a nadie, fallan las
// dos y la solicitud queda SIN APROBADOR. Los dos quedan documentados con su
// decision pendiente: cambiarlos altera semantica fiscal y ruteo de aprobaciones.
//
// **Dos gates nuevos, versionados.** `gate:data` (local, ~1s, corre en pre-commit
// cuando el commit toca `src/` o `supabase/functions/`) cruza cada `.eq(col,true)`
// contra un snapshot real del catalogo — es el que encontro los dos bugs de
// arriba. `gate:bundle` (necesita build) mide el cierre ESTATICO de cada ruta
// lazy, que es el peso real de entrar a una vista y justo lo que una medicion con
// cache caliente no puede ver. Ambos con ratchet y baseline, como `gate:design`.
//
// Tambien: la regla 3 de CLAUDE.md decia `USING(true)` solo para UPDATE/DELETE —
// por el hueco del INSERT se colaron `attendance` y `audit_logs` con
// `WITH CHECK (true)`, o sea que hoy cualquier autenticado puede fabricar una
// marcacion y falsificar la bitacora. Regla corregida; la migracion queda abierta.
//
// v2.282.0 — Cerrados los 7 pendientes y el editor de foto: no queda ningun modal
// fuera del canonico.
//
// **Los dos ultimos cuerpos.** "Agregar producto al conteo" tenia su propio
// envoltorio de hoja —`max-h`, `rounded-t-modal`, area segura y el asa suelta—,
// o sea todo lo que `HojaMovil` ya hace, y sin el arrastre. El historial de
// MIN·MAX traia su fila de titulo con la ✕; ahora el cierre es un boton
// explicito en el pie, que en un telefono importa: no hay `Escape` y el fondo no
// se ve.
//
// **A4: el editor de foto va a PANTALLA COMPLETA en tactil.** No es una hoja y no
// deberia serlo — recortar necesita AREA, y cuanto mas grande la foto mas preciso
// el encuadre. Una hoja le quita la mitad de la pantalla justo a lo unico que
// importa ahi. Es el caso donde el canonico de hoja seria peor, no mejor; pero el
// panel de escritorio metido en un telefono tampoco servia. En escritorio queda
// como estaba.
//
// Estado final, contado con el detector: **12 dialogos con el cuerpo canonico**,
// 3 fuera a proposito (la alerta centrada, el ⌘K arriba, el editor a pantalla
// completa) y ninguno con cuerpo de escritorio sin querer.
//
// v2.281.0 — El asa ARRASTRA, y cuatro dialogos mas al canonico.
//
// **El asa cumple lo que promete.** Decia "esto se cierra hacia abajo" y despues
// no hacia nada: una afordancia que miente es peor que ninguna, porque ensena a
// no confiar en las demas. Ahora la hoja sigue al dedo cuadro a cuadro y decide
// al soltar — cierra si paso 1/4 de su alto **o** si iba a mas de 0.5 px/ms.
// Solo por distancia, un tiron corto y rapido —que es como la gente cierra de
// verdad— no alcanzaba y la hoja volvia sola, que se lee como gesto fallido.
//
// Se arrastra el elemento del VIDRIO, no el envoltorio: `transform` en un
// ancestro crea backdrop root, asi que la hoja habria perdido el material justo
// mientras el dedo la mueve, que es cuando mas se mira. Medido en los dos temas:
// `translateY(40px)` con `blur(24px)` vivo. Y durante el arrastre no hay
// transicion — una transicion ahi se lee como lag.
//
// Hacia arriba se permite un poco con resistencia (raiz del desplazamiento): un
// tope duro se siente roto. El area agarrable es de 20px y no de 4: `py-2 -my-2`
// sin mover el layout, mas `touch-none`, sin el cual el navegador se queda el
// gesto vertical para hacer scroll y el arrastre nunca llega.
//
// **`CuerpoDialogo` en cuatro dialogos mas**: correccion de marcaje, aprobar y
// rechazar solicitud, y nueva solicitud. Los tres traian su material escrito en
// clases (`bg-surface-card backdrop-blur-2xl`) en vez de `data-surface`, su
// propia fila de titulo y sus botones en fila fija.
//
// v2.280.0 — `clip-path` en un ANCESTRO tambien mata el vidrio. Regresion corregida.
//
// v2.279.0 subio la gota a `ModalShell`, que recorta su ENVOLTORIO. Eso rompio
// el efecto: **`clip-path` en un ancestro crea un backdrop root**, igual que
// `transform` y que `opacity`. Medido a mitad de la apertura: el texto de la
// lista se leia NITIDO a traves de la hoja y el vidrio aparecia al terminar —
// exactamente el sintoma que v2.276.0 habia arreglado.
//
// El clip PROPIO no rompe nada, y por eso la primera version —dentro de
// `HojaMovil`— funcionaba: el defecto aparecio justo al generalizarla. Ahora
// `objetivoVidrio()` devuelve el elemento con `backdrop-filter` y se recorta ESE.
// La sombra vive en el envoltorio y no se recorta, asi que se apaga mientras dura
// la gota: si no, la hoja proyectaba su sombra entera siendo todavia una gota.
//
// Septima vez que esta familia de reglas muerde, primera por `clip-path`. La
// forma de no volver a pisarla queda escrita: animar siempre el elemento que
// TIENE el material, nunca uno que lo contenga.
//
// **`CuerpoDialogo`** (nuevo): elige entre la anatomia de hoja y la de escritorio.
// Faltaba esa pieza, y sin ella cada llamador escribia el `useMediaQuery` y las
// dos ramas a mano — asi terminaron `ConfirmModal`, `PromptModal`, `ConfigPanel`
// y `LabsPanel` con cuatro copias del mismo condicional. Migrados los dos
// dialogos de `EmployeeDetailView`.
//
// v2.279.0 — La base de la decision sobre los 12 modales: asa canonica, gota para
// TODO dialogo, y el pie que decide solo.
//
// **`AsaHoja`.** El tirador estaba a mano en SEIS sitios y en dos variantes
// (`w-9`/`.40` y `w-10`/`.30`), asi que dos hojas del mismo portal tenian
// tiradores distintos. No es decoracion: es la unica senal de que eso se cierra
// hacia abajo, porque el fondo no se ve y `Escape` en un telefono no existe.
//
// **La gota sube a `ModalShell`.** El gesto no es de las hojas sino de cualquier
// cosa que se abra por un toque —una alerta centrada, el ⌘K—, asi que ahora lo
// hereda todo el portal. Dos defectos que solo aparecieron al subirla:
//
// · **El origen se lee AL ABRIR, no al montar.** `ModalShell` no se desmonta
//   entre aperturas, asi que congelarlo en el primer render lo dejaba en `null`
//   para siempre. En `HojaMovil` no se notaba porque esa si se remonta.
// · **`hayVidrio()` mira el elemento Y su primer hijo.** `ModalShell` anima su
//   envoltorio, que no lleva material propio; preguntandole solo a el, todo
//   modal parecia no tener vidrio y se llevaba el camino de `transform` — o sea
//   un transform ANCESTRO del hijo, o sea el vidrio muerto.
//
// **El pie decide solo.** Apilar cuesta ~52px, el 11% del area util con el
// teclado abierto — justo donde mas falta hace. Pero en fila, tres acciones o un
// rotulo largo se aprietan. `flex-wrap` con `basis-36` resuelve cada caso sin
// que nadie elija, y `flex-row-reverse` deja la principal a la derecha en fila y
// ARRIBA al envolver.
//
// Aplicado: `SelectorTactil` y `LiquidDatePicker` (A3) reciben asa y sombra;
// `AlertModal` y el ⌘K (A1/A2) heredan la gota sin moverse de sitio. Medido en
// los dos temas: liquid usa `clip-path` con el blur vivo, solido usa `transform`.
//
// v2.278.0 — Auditoria completa: 29 rutas × 6 resoluciones, y el ultimo hueco.
//
// **Runtime, 174 muestras** (390/430/768/1280/1512/1920 × 29 rutas):
// cero ErrorBoundary, cero desborde horizontal, cero rutas rotas. La pildora
// aparece en 20-22 vistas de escritorio y la barra flotante en 19 de telefono.
//
// **El unico hueco real: `AttendanceAuditView`** tenia cuatro tarjetas de
// metrica a mano —grilla propia de 2×4, `p-4` propio, squircle propio y un
// `text-[1.85rem]` que no esta en ninguna rampa—. Migradas a `StatCard` dentro
// de `CarrilCards`: 148px en telefono, 200 en escritorio, sin desborde.
//
// **Y por que el barrido anterior no las vio**: buscaba las clases canonicas de
// tipografia (`text-title`, `text-body-lg`). Estas eran MAS a mano de lo que el
// detector asumia, asi que se colaron por el hueco de su propia hipotesis. El
// detector nuevo busca cualquier tamano, incluido el arbitrario. Queda como
// leccion: un detector escrito a partir del canonico solo encuentra lo que casi
// cumple el canonico.
//
// Los `text-[Nrem]` que quedan son los digitos del reloj del kiosco
// (`TimeClockView`), superficie bespoke de DESIGN.md §25.4.
//
// v2.277.0 — Un solo material para la capa movil, sombra hacia arriba, y en solido
// otra animacion.
//
// **"Calcular" y "Parametros" no se veian igual que la hoja de la barra."** Era
// literal, y por dos motivos distintos: esas usaban `modal` (85%) contra `card`
// (16%) de la barra, y `ConfigPanel`/`LabsPanel` ni siquiera pasaban por
// `HojaMovil` —eran su cuerpo de escritorio metido en una hoja—. Ahora el
// material lo define `MATERIAL_HOJA` en `HojaMovil` y lo importa
// `BarraFlotante`: la barra y lo que la barra despliega son la misma capa. Un
// canonico con dos materiales no es un canonico.
//
// **Sombra hacia ARRIBA** (`--shadow-hoja`). La escala `--shadow-elevation-*`
// baja siempre, y una hoja inferior tiene UN borde visible —el de arriba—
// contra una lista que sigue viva detras; sin sombra ahi el corte se lee plano.
// Va en el ENVOLTORIO y no en la hoja porque `data-surface` fija el `box-shadow`
// y le ganaria por orden de hoja, y cuelga de `esHoja` y no de `autoHoja`: las
// hojas que ya pedian `align="bottom"` no pasan por la conversion automatica.
//
// **En solido, otra animacion.** `clip-path` existe solo para preservar el
// `backdrop-filter`; sin vidrio esa razon desaparece y queda el costo. Ahi se
// usa `transform` + `opacity`, que el compositor mueve sin repintar. La
// condicion NO es el nombre del tema sino si el elemento TIENE vidrio, asi no
// hay lista de temas que actualizar cuando aparezca el quinto.
//
// `ConfigPanel`/`LabsPanel` esconden su encabezado de escritorio en tactil —dos
// encabezados apilados se leen como un error de maquetado— y el envoltorio es
// una FUNCION que devuelve JSX, no un componente definido en el render: eso
// ultimo lo re-crea en cada pasada y React remonta el subarbol, perdiendo el
// estado del formulario.
//
// v2.276.0 — El vidrio ya vive DURANTE la animacion, y la hoja cierra en gota.
//
// **La causa del vidrio tardio no era la escala: era la OPACIDAD del ancestro.**
// El contenedor de `ModalShell` lleva `animate-in fade-in duration-500`, o sea
// `opacity` entre 0 y 1 durante medio segundo — y un ancestro con opacidad < 1
// es un backdrop root igual que uno con `transform`. Medido mientras la hoja se
// abria: 0 → 0.29 → 0.68 → 0.90. El `backdrop-filter` estaba muerto toda la
// entrada y aparecia de golpe al terminar, que es exactamente lo reportado.
// Sin velo no hay nada que desvanecer: la animacion del contenedor no solo
// sobraba, era la que rompia el efecto. Sexta vez que esta regla aparece.
//
// **La salida es la gota al reves**, y mas rapida (180ms contra 520): abrir es
// una invitacion y admite demorarse, cerrar es una respuesta. El contenido se va
// primero para no verse aplastado. El aviso de cierre viaja por
// `EstadoDialogoCtx`, en su propio `.js` porque un modulo que exporta un
// componente y ademas otra cosa rompe el fast-refresh.
//
// **El origen se congela en el primer render**: al cerrar hay que volver al
// mismo sitio del que se salio, y para entonces `leerUltimoToque()` ya devuelve
// el toque que CERRO, no el que abrio.
//
// **El radio del recorte se lee del elemento.** Estaba quemado en 28px y eso
// solo es cierto en los temas de vidrio: en `solid` el token baja a 12.
//
// **En los temas solidos el gesto se queda y el material no.** La animacion es
// informacion —de donde salio esto— y el vidrio es material; un tema puede
// renunciar al segundo sin renunciar al primero. Verificado en los cuatro.
//
// v2.275.0 — La gota se RECORTA en vez de escalarse, y es canonica.
//
// Dos correcciones sobre la apertura en gota.
//
// **1. El vidrio llegaba tarde.** El FLIP anterior usaba `transform: scale()`, y
// **el `backdrop-filter` se escala con el elemento**: a `scale(0.14)` los 24px
// de blur valen ~3, asi que la hoja arrancaba casi transparente y ganaba el
// efecto recien al llegar a su tamano. Ahora lo que se anima es
// `clip-path: inset()`: la hoja esta SIEMPRE a tamano real —blur a 24px desde el
// primer cuadro— y lo unico que crece es la ventana por la que se la ve. Medido:
// `transform: none` y `blur(24px)` en todos los cuadros. De paso el contenido
// nunca se deforma, porque nunca se escala.
//
// **2. La gota era opt-in.** Se pedia el rectangulo por prop, asi que solo la
// tenian las hojas de `BarraFlotante` y el resto de los modales se abrian sin
// ella. Ahora, sin `origen`, `HojaMovil` lo toma de `leerUltimoToque()` —un
// listener de `pointerdown` en fase de CAPTURA, con vigencia de 1.2s— y TODA
// hoja del portal nace del control que se toco. Verificado con `ConfirmModal`,
// que no pasa nada y aun asi sale del boton correcto.
//
// Captura y no `click` porque para cuando el click llega al handler que abre el
// modal, React ya pudo re-renderizar y el boton haber cambiado de sitio. Y solo
// puntero: con teclado no hay un "de donde" fisico, asi que ahi no hay gota.
//
// El clip se retira al terminar: dejarlo puesto recortaria cualquier sombra o
// popover que la hoja quiera sacar fuera de su caja.
//
// v2.274.0 — Una firma nueva es una URL nueva, y el cache del navegador no acierta ni una.
//
// Hallazgo que salio midiendo el arranque en v2.272.0: las 26 fotos de perfil se
// bajaban DOS veces en la MISMA recarga. No era la vista pidiendolas dos veces.
//
// Una firma de storage vale 12h, pero se regeneraba en cada arranque. Y el token
// va en la query string, asi que **una firma nueva es una URL nueva**: primero se
// pintaban los avatares con las firmas que ya traia el cache de datos (26
// descargas), despues el boot re-firmaba todo, React veia un `src` distinto y el
// navegador —que tenia esos bytes— los volvia a pedir enteros (26 mas).
//
// `signStorageUrls` ahora guarda firma + vencimiento en `sb_signed_urls` y reusa
// la firma mientras le quede mas de 1h de vida. La URL es estable, el `src` no
// cambia, y el cache HTTP acierta.
//
// Medido en `vite preview`, mismo build, A/B borrando el cache de firmas para
// reproducir el comportamiento viejo — una recarga de /dashboard:
//
//                        sin cache   con cache
//   fotos pedidas               53          28
//   bytes de red            588 kB       60 kB
//   POST object/sign             3           2
//
// La primera recarga tras un login limpio sigue pagando la descarga completa
// (~590 kB): ahi no hay firma previa que reusar. El ahorro es de la segunda en
// adelante, que es como se usa el portal.
//
// **La firma es un token portador**: da acceso a ese archivo por 12h a quien
// tenga la URL, sin sesion. En el kiosco el dispositivo es compartido, asi que
// `clearAuthCache` la borra junto con el resto del cache al cerrar sesion.
//
// v2.273.0 — El modal de MOVIL como canonico propio: sin velo, y la gota.
//
// No es una adaptacion del de escritorio: son dos piezas con reglas propias,
// porque el tamano de pantalla y la forma de tocar son otras.
//
// **Sin velo.** El scrim es convencion de escritorio —ahi el dialogo flota sobre
// un lienzo grande y hay que decir cual manda—. En un telefono la hoja ya ocupa
// el borde inferior entero y llega desde el control que la abrio: se entiende
// sin atenuar nada, y oscurecer la vista la hace leerse como OTRA PANTALLA en
// vez de como la misma que se desplego. Sigue siendo modal: el fondo es un
// objetivo de cierre invisible, no ausente.
//
// **La gota: es un FLIP, no un keyframe.** El `@keyframes` anterior solo sabia
// escalar un poco desde abajo —no conoce ni la posicion ni el tamano del
// boton—, asi que se leia como "algo entro". Ahora `HojaMovil` recibe el
// RECTANGULO del control, mide la hoja ya colocada, la manda de vuelta a ese
// rectangulo (translate + scale por eje, radio de pildora) y la suelta: el
// navegador interpola el camino entero y la pildora se CONVIERTE en el panel.
// Medido a 40ms: la hoja mide 60×61 en la x/y exactas del boton, radio 9999px.
//
// El contenido entra despues (150ms de retraso): durante la primera mitad la
// hoja esta aplastada a la altura de un boton y el texto se veria deformado.
//
// `useLayoutEffect` y no `useEffect` —el estado inicial tiene que estar antes
// del primer pintado— y el `void el.offsetWidth` no es supersticion: sin ese
// reflujo el navegador junta los dos estados en uno y no hay que interpolar.
//
// v2.272.0 — Una recarga entregaba DOS sesiones, y todo el arranque se hacia dos veces.
//
// Se investigaba por que `roles` y `role_permissions` se pedian 4 veces al
// recargar. Medido en el build de PRODUCCION (no en dev: lo primero que hubo que
// descartar era StrictMode, y se reproduce igual sin el), la causa no estaba en
// ninguna de las dos tablas.
//
// `onAuthStateChange` recibe DOS eventos por recarga: `SIGNED_IN` y, ~130 ms
// despues, `INITIAL_SESSION` — con **identico access_token, expires_at y
// user.id**. Es la misma sesion anunciada dos veces. El listener los trataba
// como dos, asi que cada recarga corria el arranque completo por duplicado:
//
// · **`ensure_user_by_code` 2x** — una edge function, el duplicado mas caro.
// · **perfil + permisos 2x** — de ahi los pares de `role_permissions` + `roles`.
// · **refirmado de fotos de mas.**
//
// El filtro compara el **token**, no el usuario: `TOKEN_REFRESHED` trae uno
// nuevo y si tiene que reprocesarse.
//
// Y se saco la llamada explicita a `refreshPermissions(u)` de `procesarSesion`.
// El efecto de `[user?.id, user?.roleId, user?.secondaryRoleId]` ya cubre los dos
// casos: si el rol cambio en el servidor esos ids cambian y dispara solo; si no
// cambio, el arranque desde el cache local ya trajo los permisos frescos de red
// ~70 ms antes.
//
// Medido en `vite preview`, una recarga en /dashboard:
//
//                          antes  despues
//   peticiones a Supabase      83       76
//   ensure_user_by_code         2        1
//   role_permissions (perms)    3        1
//   roles (price/is_su)         3        1
//
// Verificado ademas que no rompe nada: login desde cero (contexto limpio, sin
// localStorage) aterriza en /overview con los 95 modulos de permisos y 36
// enlaces de menu, y la recarga los conserva.
//
// **Queda anotado un hallazgo del mismo arranque, sin resolver:** las fotos de
// los 26 empleados se descargan DOS veces (~500 kB de mas). No es la vista
// pidiendolas dos veces — es que se re-firman en cada boot aunque la firma
// cacheada siga viva, y el token nuevo cambia la URL, asi que el cache del
// navegador no acierta ni una.
//
// v2.271.0 — La hoja de la barra NACE del boton que se toco, y comparte material.
//
// La barra flotante y sus hojas son UNA sola pieza: la hoja es la barra
// desplegandose, no un dialogo aparte. Faltaban las dos cosas que lo dicen.
//
// · **Mismo material.** El cluster y sus hojas leen el mismo `data-surface`
//   desde una constante unica (`MATERIAL`). Con dos superficies distintas se
//   leian como dos piezas apiladas — y en un solo sitio, cambiarlo (o revertir
//   la prueba de `card`) es UNA linea.
// · **Animacion de origen.** `HojaMovil` recibe `origenX` —la x real del boton
//   tocado, medida del DOM— y se despliega desde ahi con
//   `@keyframes hoja-desde-origen`. Lo que se lee es "este boton se abrio", no
//   "algo entro por abajo". Medido: origen 249px para Filtros, 315px para
//   Acciones, que son las x exactas de esos botones.
//
// La animacion va EN LA HOJA y no en el envoltorio, y por eso `ModalShell`
// acepta `animacionPropia`: un `transform` propio no rompe el `backdrop-filter`
// del elemento, uno ANCESTRO si. Con la animacion en el panel, la hoja perderia
// el vidrio justo mientras se abre. Quinta vez que esta regla aparece.
//
// De paso, la hoja de la barra dejo de estar escrita a mano: era la unica que
// seguia con su asa, su titulo y su area segura duplicados, **siendo el modelo
// del que salio `HojaMovil`**. Si el canonico nacio de copiar esto, esto tiene
// que ser lo primero en usarlo.
//
// v2.270.0 — La hoja canonica llega a los envoltorios que faltaban.
//
// v2.267.0 dejo `HojaMovil` usado solo por `ConfirmModal`. Ahora tambien:
//
// · **`PromptModal`** pasa a `HojaMovil`. Aca el centrado pesaba el doble que en
//   `ConfirmModal`: este dialogo ABRE TECLADO, asi que el panel quedaba empujado
//   hacia arriba y con los botones fuera de alcance justo cuando hay que tocarlos.
// · **`LiquidModal`** (6 archivos) recibe la anatomia de hoja POR DENTRO: asa,
//   esquinas rectas contra el filo, tope de 88dvh y pie apilado con area segura.
//   No se reescribe sobre `HojaMovil` porque es un canonico de COMPOSICION
//   —Header/Body/Footer con JSX arbitrario— y convertirlo obligaria a reescribir
//   sus 6 llamadores. Las dos formas producen la misma hoja.
//
// El pie apila con `flex-col-reverse`: en escritorio la principal va a la
// derecha, o sea que es la ultima del DOM, y en orden natural quedaba abajo del
// todo contra el filo con "Cancelar" arriba.
//
// **`LiquidModal.Footer` adopto la forma que sus consumidores ya tenian a mano.**
// El canonico existia y lo usaba 1 de 6; los otros 5 repetian el mismo div
// caracter por caracter. Se adopto la forma real en vez de imponer otra y
// romperlos, y se migraron los 5. Un canonico que nadie usa no es un canonico.
//
// **Regresion encontrada y corregida en la misma pasada:** el `pb-14` que
// v2.264.0 le dio al carril para la sombra extendia su caja 56px hacia abajo y
// **se comia los clics** de lo que quedara ahi. Medido en Conteo de Inventario:
// el boton "Nuevo Conteo" era inalcanzable. `pointer-events-none` en la pista y
// `auto` en las tarjetas deja el aire de la sombra como lo que es: aire.
//
// v2.269.0 — EN PRUEBA: el cluster de la barra flotante pasa a `card` (16%).
//
// El usuario reporto que no se ve que sea liquidglass, y tiene fundamento: el
// 72% de `dropdown` se subio para tapar un blur que estaba MUERTO por el bug del
// ancestro con `transform`, y una vez arreglado el blur nadie volvio a bajar la
// opacidad. O sea que el valor actual compensa un problema que ya no existe.
//
// **Para revertir: una linea** — `data-surface` del cluster, de `card` a
// `dropdown`. El campo de busqueda NO se toco: es texto editable sobre la lista
// y ahi la legibilidad no se negocia.
//
// Lo que la medicion dice, para que la decision se tome con el dato: con `card`
// sobre la lista de productos, un nombre en mayusculas pasando por detras SE LEE
// y choca con los rotulos "ACCIONES"/"BUSCAR". Es el mismo hallazgo que en su
// momento eligio `dropdown` sobre la lista de empleados. El A/B se corrio en
// Chromium: **headless WebKit no rasteriza `backdrop-filter`**, asi que ahi la
// comparacion visual no vale nada.
//
// v2.268.0 — El filtro unico con la anatomia del cluster, y la pagina termina
// donde termina el contenido.
//
// **El filtro unico ya no es un select embebido.** En la barra todo lo demas es
// un circulo con su rotulo debajo; un select estirado ahi adentro era la unica
// pieza con otra anatomia. Ahora es un boton del cluster que se anuncia POR SU
// NOMBRE —"Sucursal", no "Filtros"— y lleva el icono de ese control, asi que se
// sabe que hay adentro sin abrirlo.
//
// El icono se lee del propio control y no de una prop nueva en cada vista:
// `FilterBar.Opciones` ya recibe el suyo y `FilterBar.Sucursal` lo publica como
// estatico. Una prop opcional es una prop que alguien va a olvidar — la misma
// leccion del `buscador` que solo 1 de 22 vistas pasaba.
//
// **Y la pagina termina donde termina el contenido.** v2.267.0 sumo el alto de
// la barra a los 40px que ya habia: quedaban 50px de vacio despues del
// paginador, que se lee como que la vista siguiera. Ahora es
// `max(2.5rem, alto-barra + 0.75rem)` — el `max` deja intacto el relleno de
// escritorio donde la barra no existe. Medido a 430×932: relleno 139→111px,
// hueco visible 50→22px.
//
// v2.267.0 — `HojaMovil`: el cuerpo canonico de un modal en el telefono.
//
// v2.265.0 resolvio COMO ENTRA un modal en tactil (desde abajo). Faltaba como se
// ve POR DENTRO: cada uno seguia rendeando el cuerpo escrito para un panel
// centrado de escritorio, y en una hoja eso falla por tres razones concretas —
// el titulo centrado no tiene con que alinearse, los botones en fila quedan en
// dos blancos de ~180px con el texto apretado, y el icono de 64px centrado se
// come la mitad del alto util. `HojaMovil` es asa + titulo a la izquierda con su
// icono en linea + cuerpo scrollable + pie con los botones APILADOS a ancho
// completo (medido: 356px) y area segura. Solo el cuerpo scrollea.
//
// El material sale de `data-surface="modal"`, no de clases sueltas: medido,
// `blur(24px)` real y el fondo pasa de `rgba(240,248,255,.85)` a
// `rgba(12,17,43,.9)` con el tema sin tocar nada.
//
// Lo usa `ConfirmModal`, que esta en **19 archivos**. El cuerpo de escritorio se
// queda como estaba: un panel centrado de 384px SI quiere su icono grande.
//
// **Una sola ranura no merece una hoja.** Si la vista tiene exactamente un
// filtro, ese control va DENTRO del cluster y el boton "Filtros" no existe.
// Tocar "Filtros", esperar la hoja, ver un control y cerrarla son tres gestos
// para lo que cabe en la barra.
//
// **Y la barra avisa cuanto ocupa.** Esta en `fixed`, asi que no empuja nada: el
// final de la lista quedaba DEBAJO del cluster y las ultimas filas eran
// inalcanzables. Publica `--alto-barra-flotante` con `ResizeObserver` —el alto
// cambia con los rotulos, con el campo abierto y con el area segura— y el
// contenedor de scroll lo suma a su relleno. Medido: barra 107px, relleno 147px.
//
// v2.266.0 — Hojas para TODOS los modales menos las alertas, y se cierran 3 huecos.
//
// Al comprobar el alcance de v2.265.0 aparecieron tres cosas que NO pasaban por
// el canonico y por lo tanto se quedaban centradas en el telefono:
//
// 1. **`ConfigPanel` y `LabsPanel` tenian `align="top"`**, que `ModalShell`
//    respeta siempre por ser el gesto del ⌘K. En un telefono eso deja el panel
//    flotando a 10vh del borde de arriba — el antipatron que el paso a hojas
//    vino a quitar. No son paletas de comandos, son formularios: se les saco.
// 2. **El historial de MIN·MAX era el ultimo modal escrito a mano** del
//    proyecto: `fixed inset-0` propio, scrim propio, `backdrop-filter` en
//    `style` y `rounded-3xl` fijo, sin `role="dialog"`, sin Escape, sin atrapar
//    el foco y sin bloquear el scroll de atras. Ahora es `ModalShell`.
// 3. **`hojaEnTactil={false}`**, la unica salida, para las ALERTAS. Un aviso
//    corto con un boton no es un panel con el que se trabaja, es una
//    interrupcion: centrado se lee como tal, subiendo desde abajo se confunde
//    con la hoja de filtros. El gesto de entrada dice de que tipo de cosa se
//    trata.
//
// Dos trampas del camino, las dos ya conocidas y las dos invisibles al build:
// **`<ModalShell>` sin su `import`** (compila y revienta en runtime — el barrido
// ahora cubre los 17 llamadores) y **los children de JSX se evaluan al crear el
// elemento**, asi que `open={!!historyRow}` no protege un cuerpo que
// dereferencia `historyRow`. El guard va AFUERA.
//
// v2.265.0 — Movil: los modales son hojas, y el buscador sube encima de la barra.
//
// **Todo modal entra como hoja en tactil.** Centrado y con zoom es la gramatica
// del escritorio: en un telefono deja los botones a media pantalla, lejos del
// pulgar, y cuando abre el teclado el panel sube y se recorta. Ademas la hoja de
// filtros y la de acciones YA entraban desde abajo, asi que dos cosas que hacen
// lo mismo —tapar la vista hasta cerrarlas— entraban distinto.
//
// `ModalShell` resuelve `align="center"` a `"bottom"` con `(hover: none)`, mismo
// criterio que `soloIcono`. `align="top"` se respeta siempre: es el ⌘K, que
// quiere estar bajo los ojos y no bajo el pulgar. Las dos correcciones del
// contenido van al hijo con variantes de descendiente —esquinas de abajo rectas
// y area segura— para no editar los 18 llamadores: lo que cada uno rendea fue
// escrito para un panel centrado. Medido: "Cancelar" quedaba bajo el indicador
// de inicio.
//
// **La barra flotante cambia de orden: `principal · acciones · buscador`.** Lo
// que mas se toca queda bajo el pulgar; lo que abre teclado se va al extremo.
//
// **Y el campo sube ENCIMA del cluster**, como fila propia, con los cuatro
// botones intactos. Antes se estiraba DENTRO y expulsaba a los otros, asi que
// buscar y filtrar eran excluyentes. Elegido sobre cuatro variantes con maqueta;
// la descartada de cerca era el campo pegado al encabezado de la pantalla: el
// teclado ocupa la mitad de abajo, asi que el dedo teclea abajo y el ojo salta
// ~500px en cada letra, justo a la zona que el pulgar no alcanza.
//
// Medido en WebKit a 390px: orden CALCULAR/FILTROS/ACCIONES/BUSCAR, el campo a
// y=710 sobre el cluster en y=754, y los 4 botones siguen ahi.
//
// v2.264.0 — La sombra seguia cortada: el aire hay que MEDIRLO.
//
// v2.262.0 le puso 10px de aire a la pista del carril y la sombra siguio
// saliendo con un canto recto. La sombra real es `0 8px 32px`: baja **40px** por
// debajo de la tarjeta y sube 24 — y al pasar el mouse crece a `0 16px 40px`,
// que son 56. Diez no alcanzaba ni de lejos. `pt-6 pb-14` cubre los dos casos y
// `-mt-6 -mb-14` se los devuelve al layout.
//
// Y habia un SEGUNDO recorte, el que hacia el canto mas visible: **`mask-image`
// recorta al border-box**, igual que un `overflow: hidden`. Todo lo que la
// sombra pintaba fuera de la caja de la pista desaparecia de golpe, asi que la
// linea cruzaba el ancho entero de la fila y no solo el de una tarjeta. Con
// padding suficiente el recorte cae donde ya no hay sombra.
//
// **A los lados no se agranda la caja: se deja de recortar.** Agrandarla hacia
// la derecha la meteria por debajo de la pildora y le robaria los clics del
// borde. Si todo entra, la pista va `overflow-visible` y las sombras respiran;
// el clip solo existe cuando hay algo que deslizar, y justo entonces la mascara
// ya desvanece los dos bordes. Por eso la medicion paso a `useLayoutEffect`:
// decide el `overflow` del primer pintado.
//
// v2.263.1 — Tener un solo modulo no era tener acceso: el aterrizaje ignoraba 24 de 35.
//
// La pantalla de aterrizaje se elegia con una cascada escrita a mano de **11
// modulos**, y terminaba en `/no-access`. Pero modulos navegables hay **35**.
// Los 24 que no estaban en la lista no eran destino posible: un rol cuyos
// modulos cayeran todos fuera entraba, y aterrizaba en "Sin acceso" — que vive
// FUERA del `AppLayout`, o sea pantalla completa, sin menu y sin salida salvo
// "Cerrar sesion". El modulo funcionaba perfecto escribiendo la URL a mano; lo
// unico que faltaba era la forma de llegar.
//
// Le pasaba a **Contador Externo** (unico modulo: `facturas_compra`) y a
// **Sistema — Alertas Tecnicas** (`sync_health`). El primero tiene un empleado
// activo que ya habia iniciado sesion y visto la pantalla de "Sin acceso".
//
// Ahora la lista es la PREFERENCIA (las vistas que sirven de inicio) y, si
// ninguna aplica, cae al primer modulo del `MODULE_MAP` con `can_view`. Se
// excluyen los `comingSoon` — no tienen `<Route>`, aterrizar ahi seria el 404.
// `/no-access` queda para quien de verdad no tiene ningun modulo navegable,
// que es lo que la pantalla dice.
//
// **Para los demas no cambia nada**: los 11 conservan su prioridad, asi que
// nadie que hoy aterriza en una pantalla cambia de destino. Verificado contra
// los 23 roles: los 12 que aterrizan hoy aterrizan igual. Los paths salen del
// `MODULE_MAP` y coinciden uno a uno con los que estaban escritos a mano
// (`staff_list` → `/dashboard`, `emp_requests` → `/my-requests`, etc.).
//
// Lo que esto NO arregla, porque es configuracion y no codigo: **10 roles solo
// tienen permisos de PESTANA** (`facturacion_tab_*`, `productos_tab_*`,
// `ventas_tab_*`) sin el modulo padre. No aterrizan ni ven nada en el menu — el
// sidebar arma los grupos con las keys padre. Nueve no tienen empleados
// activos; el decimo, "Agente de Atencion de Canales Digitales", tiene uno. Se
// arregla dandoles `ventas` / `productos` / `facturacion` desde Permisos.
//
// v2.263.0 — En tactil un boton de solo-icono no tiene nombre: ahora lleva texto.
//
// Un boton sin rotulo apuesta todo su significado al `LiquidTooltip`, y un
// tooltip **se abre con el mouse encima**: en un telefono no hay "encima". Ahi
// el rotulo no es un lujo, es el unico nombre que el boton llega a tener.
//
// Dos causas, las dos en `TabBarAction`:
//
// 1. **El rotulo llevaba `hidden sm:inline`**, o sea que se escondia bajo 640px
//    — justo donde mas falta hace. En la hoja de filtros del telefono los
//    botones son de ancho completo: salian con un icono suelto y ~300px de vacio
//    al lado. Y arriba de 720px, el unico sitio donde la pildora de escritorio
//    se dibuja, la clase no llegaba a aplicarse nunca. Solo hacia dano.
// 2. **`soloIcono` se aplicaba tambien en tactil.** Ahora se ignora cuando
//    `(hover: none)` se cumple. Se decide por dispositivo de ENTRADA y no por
//    ancho: una tablet ancha tampoco tiene hover, y una ventana angosta de
//    escritorio si lo tiene.
//
// Medido en WebKit a 390px: la hoja de Acciones de MIN·MAX pasa de tres botones
// mudos a "DESCARGAR", "CONFIGURAR PARAMETROS" y "LABORATORIOS OCULTOS".
//
// **Auditoria de los dos canonicos** (pedida en la misma vuelta): 13 vistas
// tienen tarjetas de metrica y **las 13** usan `StatCard` dentro de
// `CarrilCards`; el barrido estructural por la forma "superficie card + numero
// tabular + etiqueta chica" no encontro **ninguna** tarjeta a mano. 22 vistas
// montan `FilterBar`. Queda UN hueco: `TabNoEfectivo` de Facturacion tiene tres
// filtros propios fuera de la pildora —el mes, y una fila "Filtrar:" con dos
// selects y su Limpiar, que es una pildora reescrita a mano—. No se toco: el
// estado y las opciones se calculan dentro de la pestana y la pildora vive dos
// componentes mas arriba, asi que no es un cambio mecanico.
//
// v2.262.0 — La sombra de las tarjetas ya no se corta, y `soloIcono` cumple.
//
// **`overflow-x: auto` no es un eje.** En cuanto un eje deja de ser `visible` el
// otro pasa a `auto` solo, asi que la pista del carril tambien recortaba ARRIBA
// y ABAJO: con `py-0.5` la sombra de la tarjeta —y su `-translate-y-px` al pasar
// el mouse— quedaban cortadas con un canto recto, y las tarjetas se veian
// metidas en una caja. `py-2.5` le da los 10px que la sombra necesita y `-my-2`
// se los devuelve al layout: la fila mide igual, medido 77px antes y despues.
//
// **`soloIcono` ahora ESCONDE el rotulo.** Solo cambiaba el relleno y el tamano
// del icono; el texto se seguia pintando, asi que cada llamador tenia que
// acordarse de pasar `children={null}` ADEMAS de la prop. `FilterBar` lo hacia
// en su renderer de acciones; nadie mas lo sabia porque no estaba escrito. El
// primer llamador directo que no lo supo —restaurar ocultos— dibujo "RESTAURAR
// 10 OCULTOS" encima del select de al lado. Una prop que promete "sin rotulo"
// tiene que ser la que lo quite: si no, es una convencion, y las convenciones se
// olvidan. Los 4 llamadores que quedan pasan por `acciones`, donde ya iba null.
//
// **Restaurar ocultos se muda al lado del select de estado.** Es lo unico que se
// puede HACER con la opcion "Ocultos", y a 300px de distancia, en el grupo de
// acciones, no se leia como parte de ella.
//
// **La tarjeta del rango muestra solo el MAX.** `MIN → MAX` en una cadena
// tampoco entraba en 200px: se leia `$15.9k → …`, o sea el segundo monto —el que
// importa— cortado. El MAX es el techo de la inversion, que es la pregunta que
// se le hace a esa tarjeta. Y el select de estado baja de 185 a 150px.
//
// v2.261.0 — El borde del carril se desvanece; los ocho estados son UN select.
//
// **La tarjeta que asoma ya no queda rebanada.** Terminaba en un canto recto,
// como si la vista se hubiera roto ahi. Se descartaron dos caminos antes del que
// quedo: una cortina de color no sirve —el fondo del portal es un gradiente, asi
// que tendria que adivinar que color tapar—, y una franja con `backdrop-filter`
// se escribio, se midio y **no pinta nada**: `div.group/table`, que envuelve
// toda vista, tiene `transform`, y un ancestro con transform mata el
// `backdrop-filter` de todo lo que cuelga. Cuarta vez que muerde.
//
// Queda la mascara sobre la propia pista. Normalmente no se puede —`mask-image`
// crea un backdrop root y deja sin vidrio a lo de adentro— pero aca no cuesta
// nada: las tarjetas del carril **no tienen `backdrop-filter`** (medido: `none`
// en las cuatro vistas con carril), y bajo ese `transform` tampoco podrian. La
// rampa es de 56px con la mitad todavia casi opaca, para que el desvanecido se
// concentre en el corte en vez de aclarar la tarjeta entera. Solo el lado que
// tiene algo cortado.
//
// **Los ocho filtros de estado de MIN·MAX pasan a un select.** Eran chips en
// linea, y antes una tira suelta de 44px. Las dos formas fallan en lo mismo:
// contestan UNA pregunta —que recorte de la lista quiero ver— y estaban
// dibujadas como ocho preguntas independientes. Como chips ademas rompian el
// cupo de la pildora, porque el reparto cuenta RANURAS y ocho chips son una sola
// de ~700px. Con el select la pildora bajo de 809 a 640px y el carril paso de
// 338 a 474 (de 2 tarjetas visibles a 3). Cada opcion lleva su conteo, que es el
// dato por el que se elige.
//
// **"Restaurar ocultos" solo aparece con la opcion "Ocultos" puesta.** Antes
// salia siempre que hubiera alguno oculto: una accion permanente en la pildora
// sobre filas que no estan en pantalla, o sea un cambio a ciegas.
//
// `FilterBar.Chips` se retira: nacio en v2.260.0 y el select lo reemplaza.
//
// v2.260.0 — Min/Max: la fila de controles, canonica de verdad.
//
// Dos cosas reportadas sobre la vista, y la segunda tenia una causa que no
// estaba donde se veia.
//
// **1. Se va la tarjeta "Formula actual".** Repetia la config —MAX objetivo,
// MIN por clase, ventana, cortes de ABC y XYZ— en una caja fija al costado. Es
// un dato que se consulta al configurar, no al revisar la lista, y vivia en la
// vista entera ocupando ancho. La config se edita en su panel, que es donde
// esos numeros SI se pueden cambiar.
//
// **2. La pildora no estaba a la derecha ni escondia nada.** El sintoma se veia
// en la pildora, pero la causa estaban las TARJETAS: nunca pasaron al canonico.
// Seguian escritas a mano —`rounded-2xl` en vez del token, tipografia propia,
// su propio `flex-wrap`— y como cada componente traia su propio envoltorio, la
// fila de controles tenia que ser `flex-wrap`. Con eso la pildora saltaba a su
// propia linea, y ahi `shrink-0` la dejaba estirarse de borde a borde: se veia
// pegada a la izquierda y su cupo de ranuras no se agotaba nunca, asi que el
// desborde no aparecia jamas. `CostCards`, `DraftCostCard` y `CardSkeletons`
// devuelven ahora `StatCard` sueltas y la fila es `CarrilCards` + pildora.
// Medido a 1280/1512/1920: el borde derecho de la pildora coincide con el de la
// fila en los tres, y las tarjetas miden 148 parejo (antes la huerfana crecia).
//
// **`FilterBar.Chips`** (nuevo, §17). Seis chips en una ranura rompian el cupo:
// el reparto cuenta RANURAS, y seis chips son una sola de ~700px. Aca el
// desborde es por CHIP y con la misma regla de un nivel mas arriba: los
// aplicados se quedan en linea, el resto se guarda tras un `+N`. En el telefono
// no hay `+N` — la ranura ya vive dentro de la hoja de filtros.
//
// De paso las etiquetas se acortan a una o dos palabras: con la tarjeta topada
// en 200px, "Capital excedente" se leia "Capital exce…", que no dice nada.
//
// v2.259.0 — Min/Max: la matriz y los filtros pasan a ser RANURAS de la pildora.
//
// **La matriz ABC × XYZ era un bloque de 124px** entre la pildora y la tabla, y
// la tira de filtros de estado otros 44: **168px de cromo** antes del primer
// producto. Una matriz 3×3 es la forma correcta cuando se comparan celdas entre
// si, y aca casi nunca — se mira "cuantos A tengo" y "cuantos son erraticos".
// Peor: se mira para DECIDIR un filtro, no para vigilarla. Elegida la clase, lo
// que importa es la lista, y la matriz seguia ocupando alto sin que nadie la
// releyera.
//
// Ahora es una ranura que resume lo aplicado ("ABC · A") y se abre en un popover
// con **barras apiladas por clase**, interactivas: contestan las dos preguntas de
// un vistazo y conservan las nueve zonas de clic. Aprobado sobre mockup.
//
// **Los seis filtros de estado** pasan a la ranura "estado". Estaban en una tira
// aparte, asi que para saber que recortaba la lista habia que mirar en DOS
// sitios. Su `onClear` usa `clearAllFilters` del hook y no una lista propia: el
// hook ya sabe cuales son todos los filtros, incluidos los que no tienen ranura
// visible (borrador, solo-cambios).
//
// **"Restaurar ocultos" era un boton DENTRO de un chip de filtro** — dos cosas en
// el mismo control. Pasa a ser una accion, y solo existe cuando hay algo que
// restaurar.
//
// **La tabla pedia `minWidth: 860px`** y en un telefono habia que arrastrarla de
// lado: se veia el nombre del producto y para leer su MIN/MAX habia que
// desplazar. Sus seis columnas no declaraban **ninguna** `hideBelow`, que es la
// estrategia que §32 fija para pantallas angostas. Con laboratorio/clase/
// presentacion marcadas, en un telefono quedan Producto · MIN·MAX · Acciones.
// Medido a 390px: `scrollWidth` 390, cero desborde horizontal.
//
// En el telefono el ABC no abre popover: esa ranura ya vive dentro de la hoja de
// filtros, y una capa encima de otra seria una hoja dentro de una hoja.

// v2.258.0 — Min/Max: las acciones a la pildora, y sus dos paneles a `ModalShell`.
//
// **Cinco controles sueltos al lado de la pildora**, cada uno con su forma: "CSV"
// con rotulo, dos iconos pelados y DOS botones de calcular. Ahora son `acciones`
// del canonico: la pildora paso de 553 a **425px** y quedan CERO sueltos.
//
// **"Calcular" era dos botones gemelos** —"Todas las sucursales" y "Calcular"—
// que son la MISMA accion con distinto alcance. Dos botones asi obligan a leerlos
// enteros para ver en que se diferencian, y el mas destructivo quedaba a un clic
// sin confirmar cual se apreto. Ahora el alcance se elige DENTRO del modal, que
// es donde ya se explica que va a pasar. El progreso ("Bayer 3/7") vive en el
// rotulo de la accion: es la unica senal de que sigue trabajando.
//
// **`ConfigPanel` y `LabsPanel` no eran modales**, eran `fixed inset-0` con
// `pointer-events-none`: sin scrim, sin `role="dialog"`, sin Escape y sin atrapar
// el foco — o sea que para un lector de pantalla no eran un dialogo, y con el
// teclado se seguia tabulando por la tabla de atras. Y su `rounded-2xl` era un
// radio fijo contra el token del tema. Los dos pasan a `ModalShell`.
//
// El gate atrapo lo que el build no puede ver: `ConfigPanel` usaba `<ModalShell>`
// **sin importarlo**. Un componente indefinido en JSX no rompe el build, revienta
// en runtime al abrirlo.

// v2.257.0 — las tarjetas, todas iguales; y el tooltip dejo de correrse.
//
// **La regla de color, escrita en el canonico.** Por defecto una tarjeta NO
// lleva color: todas comparten `data-surface="card"`. Lo que si lleva color es
// el NUMERO y el ICONO —ahi el color ES el dato—; el fondo y el borde no. El
// estado seleccionado va por `tono` (`data-tono`, paleta cerrada), que es un
// anillo sobre el MISMO material y no otro material.
//
// Se retiraron `activeBg` e `inactiveBg`: **19 call sites**, cada uno con su
// tinte propio. Y cuando una vista pasaba `inactiveBg` la tarjeta **perdia
// `data-surface`** — por eso en la misma fila habia tarjetas con vidrio y
// tarjetas casi transparentes, que es lo que el usuario reporto ("hay uno que no
// tiene fondo", "lo veo mas transparente"). Medido despues: **un solo fondo por
// fila** en Productos, Facturas de Compra, Personal y Ventas.
//
// **El numero encoge antes que cortarse.** `$249,456.38` salia `$249,4…`. El
// cuerpo baja a `text-body-lg` sobre 6 caracteres y a `text-body` sobre 9: se lee
// entero sin que la tarjeta cambie de ancho. Cero truncados medidos.
//
// **Rotulos de dos palabras.** "Modificados este mes" en 148px salia
// "Modificados e…", que no nombra nada. El matiz baja al `sub`.
//
// **El tooltip se recortaba contra un ancho SUPUESTO.** 140px de medio-ancho para
// el de texto, sin importar cuanto midiera de verdad. Uno corto cerca del borde
// derecho se corria **mas de 100px** y quedaba con la flecha apuntando al aire.
// Ahora se mide ya montado: desfase medido **0px**, 9px debajo del boton.

// v2.256.0 — nada a mano: los ultimos bloques y el ultimo pill legacy, al canonico.
//
// **El radio salia de un numero, no del token.** `StatCard` usaba `rounded-2xl`
// (1rem fijo) mientras cualquier bloque con `data-surface="card"` toma
// `--card-radius` (1.75rem en vidrio, 0.75 en solido). En la MISMA fila convivian
// dos formas y se veia — el usuario lo señalo. Ahora `rounded-card`, que es lo que
// §8 manda: el radio lo decide el TEMA.
//
// **Nada se sale de la tarjeta.** Los tres textos truncan. Iban con
// `whitespace-nowrap` a secas, o sea que EMPUJABAN el ancho, y con la tarjeta
// topada en 200px lo que hacian era desbordar y montarse sobre la de al lado. El
// `aria-label` lleva el texto entero, asi que a un lector no le falta nada.
//
// **Cinco bloques "a mano" que eran `StatCard` reescrito** —Catalogo, Inventario,
// Reglas, Pedidos y los tres de Gestion de Stock— reemplazados por el canonico,
// cada uno con su propio `rounded-2xl`, su propio `min-w` y su propia estructura.
// Y fuera los dos divisores que quedaban dentro de los carriles: el carril ya
// separa por espacio, y un divisor adentro se lee como una tarjeta mas.
//
// **`FilterPill` de Pedidos era el ULTIMO resto del pill legacy** —el que §17 dice
// haber reemplazado— y seguia armando el contenedor a mano: su `h-14 rounded-2xl
// border bg-surface-card`, sus divisores y un boton de limpiar por ranura. Ahora
// es un `FilterBar`, con lo que gana el orden de ranuras, el colapso a barra
// flotante en el telefono, el cupo por ancho y el control de desborde.
//
// **Facturas de Compra tenia "Descargar" y "Sincronizar" FUERA de la pildora**,
// que era la regla anterior de §17. Al moverlas a `acciones` se arreglo de paso lo
// que el usuario pidio: la pildora no quedaba justificada a la derecha porque
// habia otro bloque disputandole el borde.
//
// Verificado en las 12 vistas con tarjetas a 1512px: **pildora a ras del borde en
// todas, cero desbordes de texto y un solo radio por vista**.

// v2.255.0 — el canonico de medidas, aplicado a TODAS las vistas con tarjetas.
//
// Migradas al carril: Facturas de Compra, Productos·Inventario, Ventas (sus tres
// pestanas), Pedidos·Metricas y Pedidos·Reglas. Ya lo estaban Personal, Conteo y
// Productos·Catalogo.
//
// **Dos `StatCard` duplicados menos.** `TabReglas` tenia una copia con las MISMAS
// props que el canonico (solo cambiaban `Icon`→`icon` y `countCls`→`valueCls`) y
// `TabMetricas` otra con un eje `color` propio; las dos se reemplazaron por el
// canonico. Queda una sola copia viva, la de Ventas, y no por descuido: tiene el
// delta contra el periodo anterior, el desenfoque del modo privacidad y el
// tooltip de IVA, que el canonico no tiene. Adopta las MEDIDAS (148/200 y el
// detalle que cede) sin fusionarse — fusionarlas es un trabajo aparte.
//
// **Bug propio del carril:** `cloneElement` le inyectaba `compacta` a CUALQUIER
// hijo, incluidos los que son elementos del DOM —el divisor de Catalogo—, y React
// avisa de prop desconocida. Ahora solo se le pasa a componentes.
//
// Pendiente: `TabSinVenta`, cuya fila mezcla tarjetas, un divisor y fragmentos
// condicionales; envolverla necesita mano y no un reemplazo mecanico.

// v2.254.0 — el canonico de medidas, aprobado sobre mockup e implementado.
//
// v2.253.0 fue el primer intento (tarjeta de 200px fija y cupo de 3 ranuras);
// esto lo reemplaza con lo que el usuario aprobo mirando el mockup interactivo.
//
// **`StatCard`**: minimo 148, maximo 200, el detalle cede bajo 176.
// **`CarrilCards`** (nuevo): las tarjetas van en UNA fila y lo que no entra se
// desliza. El sobrante queda como asomo de la siguiente, y las flechas FLOTAN:
// en el flujo se comian 64px de los 438 disponibles a 1512, media tarjeta.
// **`FilterBar`**: el cupo de ranuras es el que entre en el ancho REAL, no 3
// fijo — con 3 fijo se escondian filtros en un 27" teniendo 1.400px libres. El
// control de desborde toma la forma de una ranura, no de un cuadrito aparte.
//
// **El ancho se MIDE, no se estima.** Modelar cada accion en 150px erraba por 62
// en una sola pildora: las reales son 166, 186 y 36 segun su rotulo. Se miden las
// piezas en un `useLayoutEffect` —corre antes del pintado, sin parpadeo— y se
// observa la FILA, no el envoltorio de la pildora: el padre ajusta al contenido,
// o sea a la pildora, asi que medirlo es un bucle. Medido con el padre, quedaba
// clavada en 748px y 2 ranuras de 1280 a 2240.
//
// Prioridad: detalle de tarjeta → texto de acciones → el carril desliza →
// ranuras vacias. NUNCA una ranura aplicada. Y el texto de las acciones solo se
// reclama de vuelta si el carril ya muestra las cinco; sin esa regla el carril
// RETROCEDIA al agrandar la ventana.
//
// Medido en Personal: 1280→2 tarjetas · 1440→3 · 1512→4 · 1728→5 · 1920→5 con
// detalle. Monotono.

// v2.253.0 — medidas FIJAS: la tarjeta y el cupo de ranuras.
//
// **`StatCard` mide 200px siempre.** Era `flex-1 basis-0 min-w-[150px]`: se
// repartia el espacio, asi que la MISMA tarjeta media distinto en cada vista y
// en cada monitor. Medido antes: Ventas daba 1/2/3/4/4 tarjetas por fila a
// 1280/1440/1512/1728/1920px, y Personal 2/2/2/3/4. Y la tarjeta HUERFANA de la
// ultima fila crecia hasta llenarla sola — en Personal a 1920px habia cuatro de
// 172px y **una de 726px**.
//
// **La pildora tiene cupo de 3 ranuras**; el resto va tras un `···` que las
// despliega en un panel anclado. Antes crecia con lo que cada vista le metiera:
// de 189 a 782px a 1512, robandole a las tarjetas un ancho distinto en cada
// pantalla. Proveedores paso de 718 a 618.
//
// **Las ranuras APLICADAS nunca se esconden** — esconder un filtro activo
// dejaria la vista recortada sin nada visible que lo explicara, que es
// exactamente lo que §17 existe para evitar. Se esconden las vacias y el boton
// lleva `Contador`. Y se ELIGEN por prioridad pero se DIBUJAN en su orden
// original: reordenarlas al aplicar un filtro haria que la pildora cambiara de
// forma con cada clic.
//
// El gate atrapo un `size={17}` fuera de la rampa de iconos de §12; va en 18.

// v2.252.2 — la pildora de Ventas no estaba justificada a la derecha.
//
// Medidas las 14 vistas con pildora a 1512px comparando su borde derecho con el
// del contenido: 10 estaban a ras y **Ventas se quedaba a 534px del borde** —
// su fila era un `flex-wrap` a secas, asi que la pildora caia donde terminaran
// las tarjetas. Sus tres pestanas (Ventas, Vendedores, Productos) comparten el
// mismo contenedor, asi que las tres tenian el mismo defecto.
//
// Pasa al patron de dos columnas que ya usa el Listado: `flex-1` en la columna
// de tarjetas empuja la pildora al fondo.

// v2.252.1 — la pildora de Ventas, de 852 a 609px. Y el ojo se ve.
//
// **El icono aplastado era un bug, no un tamano mal elegido.** `soloIcono` se
// habia implementado como un `className` con `px-0 w-9` desde `FilterBar`, y ese
// `px-0` **perdia contra el `px-3.5` del tamano**: entre dos utilidades de
// Tailwind el ganador lo decide el orden de la HOJA DE ESTILOS, no el del
// atributo `class`. Medido: boton de 36px con 28 de relleno y el SVG en **6×18**
// en vez de 18×18. Ahora `soloIcono` es una prop que REEMPLAZA el tamano
// (`w-9 h-9 px-0`) — la misma leccion que `Button` ya tenia escrita para su
// `iconOnly` — y el icono sube de 14 a 18px, que es la proporcion de un boton
// sin rotulo. El `<svg>` lleva `shrink-0`: es un elemento flex mas.
//
// **El rango de fechas, compacto.** `01/07/2026 → 30/07/2026` eran 23
// caracteres y ~250px para decir dos dias del mismo mes. El ano se escribe UNA
// vez y solo si hace falta: dentro del ano en curso no se escribe, en otro ano
// va corto al final, y en los dos extremos solo si el rango cruza de ano.
//
// **Menos aire entre ranuras**: `px-2`→`px-1` en la ranura, `gap-1.5`→`gap-1`
// y `px-1`→`px-0.5` adentro.
//
// Medido en Ventas (la vista con mas ranuras): **852 → 609px**. Personal
// 778 → 748, Auditoria 812 → 782.

// v2.252.0 — `TONO_POR_ICONO` aplicado a TODO el proyecto.
//
// En v2.251.0 el mapa existia pero lo consumia solo `TabBarAction`. Ahora
// tambien `Button`, que es donde viven los 193 `iconOnly` auditados.
//
// **Se tine el ICONO, no el relleno.** `TONE_CLASSES` de `Button` es relleno
// solido con texto blanco: aplicar el tono como fondo habria convertido cada
// fila de acciones discretas en una hilera de bloques de color. En superficie
// neutra el color identifica la categoria sin gritar — la misma regla que
// `TabBarAction quiet` ya seguia.
//
// Tres desactivadores, los tres a proposito: `tone` explicito (el llamador
// manda), variante RELLENA (`primary`/`destructive`: el fondo ya es del color y
// el icono va en blanco — es lo que preserva el `Check` rojo de un "confirmar
// borrado"), y boton CON texto (ahi el color sale del papel del boton, no de su
// icono).
//
// Medido: **20 botones pasaron a llevar color, 172 quedaron igual** — 41 de
// ellos por decision explicita. Verificado en el navegador: los `Copy` de
// Sucursales pasaron de neutro a rgb(29,78,216), el mismo azul que el ojo de la
// pildora de Ventas.
//
// El tono explicito suele codificar la ACCION y no el icono, y eso es correcto:
// `Eye`+`success` es "restaurar sugerencia", `RefreshCw`+`success` es
// "recontratar", `RotateCcw`+`chart-3` es "regenerar con IA".
//
// De paso, `TabBarAction` deja de duplicar su tabla de clases de texto:
// `CLASE_TEXTO_POR_TONO` vive en `iconNames.js` y la comparten los dos.

// v2.251.0 — el mismo icono, el mismo color. Y el ojo, solo el ojo.
//
// Auditados los **193 botones `iconOnly`** del proyecto: **18 iconos se dibujan
// con 2 a 4 colores distintos**. El ojo aparece sin tono, `chart-1`, `success` y
// `secondary`; `Download` es `success` en Personal y `chart-1` en Facturas de
// Compra. El mismo icono significa lo mismo y se ve distinto segun la pantalla.
//
// `TONO_POR_ICONO` en `iconNames.js`, al lado de `NOMBRE_POR_ICONO` y por el
// mismo principio: si el llamador no dice de que color es, lo dice el icono.
// Es el PISO, no el techo — quien pase `tone` gana el suyo, y hace falta: un
// `Check` dentro de un "confirmar borrado" va en `destructive` a proposito, y
// los clusteres de accion por fila (Facturas de Compra pinta
// Eye/Download/FileJson/Archive de `chart-1` a la vez) tienen coherencia local.
// Por eso hoy lo consume SOLO `TabBarAction` — el boton de accion de una vista.
// Extenderlo a `Button` tocaria los 193 de una vez; queda como decision aparte.
//
// **El ojo de Ventas pasa a `soloIcono`.** Con rotulo en mayusculas se comia
// media pildora en la vista con MAS ranuras del portal (sucursal, laboratorio,
// fecha y cuatro chips): la pildora bajo de 852 a 722px.
//
// **Y `soloIcono` lleva `LiquidTooltip`, no `title`.** Un boton sin texto
// necesita que su rotulo sea descubrible, y el `title` del navegador es cromo
// nativo: no se estiliza, tarda un segundo largo y en tactil no existe — justo
// lo que la regla cero-nativo evita. Va con `side="bottom"` para no tapar la
// fila de arriba.

// v2.250.0 — la pildora, corregida sobre la revision del usuario.
//
// **`FilterBar.Opciones`** — hasta 3 opciones es `SegmentedControl`; de 4 en
// adelante, `LiquidSelect`. Los dos son uno-de-N y la diferencia es de ancho: un
// segmentado de 5 se come la pildora entera. El umbral es del canonico, no del
// llamador. Se lleva por delante los apanos de movil: Conteo y ConteoDetail
// forzaban `layout="block" columns={2}` porque el riel de cuatro no entraba en la
// hoja del telefono. Aplicado tambien a "Mis Avisos", cuyos subfiltros son
// dinamicos (de 2 a 6) y ahora eligen control solos.
//
// **`FilterBar.Sucursal`** — estaba a mano en 9 vistas con 4 textos distintos
// ("Todas las Sucursales", "Todas las sucursales", "Todas", ninguno) y anchos de
// 150 a 220px. El texto canonico es "Sucursales": nombra el filtro en vez de
// describir su estado vacio. Normaliza ademas la opcion "todas" que viene DENTRO
// de `options` —que es la mitad del arreglo—: el select mostraba ese label y no
// el placeholder, y en 150px se cortaba a "Todas las Suc…".
//
// **`soloIcono`** en un descriptor de accion. Exportar en el Listado; `Download`
// ya era el icono canonico de exportar en el portal.
//
// **Listado en dos columnas**: tarjetas a la izquierda, pildora a la derecha.
// Medido a 1512px: la columna de tarjetas quedaba en 310px y las 5 caian en
// vertical, una por fila, porque dos necesitan 312 (2×150 + gap). Con
// `min-w-[312px]` entran de a dos y la pildora envuelve sus dos bloques
// —filtros arriba, acciones abajo— en vez de desbordar.
//
// **El z-index de la barra flotante NO se arreglaba con z-index.** Con el menu
// abierto el cluster quedaba encima del sidebar. El sidebar es `z-sidebar` (50) y
// la barra `z-tabs` (30), y aun asi ganaba la barra: el z del sidebar vive dentro
// del contexto de apilamiento del layout, y la barra —colgada del `body` por
// portal— compite en el contexto raiz. Comparar los dos numeros no significa
// nada. Asi que no se apila: se apaga con `--barra-flotante-display`. Por la
// misma via se aparta de la nav inferior de autogestion
// (`--alto-nav-inferior`), que ocupa el mismo sitio en "Mis Documentos".
//
// **Mis Documentos**: el rango de fechas pasa a `PeriodPicker` (trae "este mes",
// "mes anterior", "ultimos 3 y 6 meses") en vez de dos `LiquidDatePicker`
// coordinados a mano.

// v2.249.3 — dos vistas crasheaban al ABRIRLAS, y las dos por el mismo motivo.
//
// `Gestion de Solicitudes` (reportada por el usuario) y `EmployeeDetailView`:
// "TypeError: null is not an object (evaluating 'c.mode')" y la vista entera al
// ErrorBoundary. **Los hijos de un elemento JSX se evaluan al CREARLO, no cuando
// el padre decide pintarlos**, asi que `actionModal.mode` / `resetResult.password`
// corrian en cada render, incluido el primero, con la variable en `null`.
//
// `<ModalShell open={!!actionModal}>` LEE como si condicionara sus hijos y no los
// condiciona. Los modales escritos a mano que habia antes SI traian el
// `{actionModal && (...)}`; la guarda se perdio al pasarlos a `ModalShell` en
// v2.183.0. Barrido el patron en las 30 vistas que usan `ModalShell`: eran
// exactamente estas dos.

// v2.249.2 — DESIGN.md al dia con el canonico nuevo.
//
// §16.9 (las dos pildoras), §17 (los descriptores de `acciones`), §17.3 (el canal
// de `CanalDeVista.js`, el bug del `transform` ancestro y la medicion de las tres
// superficies), §15.5 (`TabBarAction` ya no se instancia a mano, y el tamano `sm`)
// y la ficha de `ViewTabBar` en §14, que seguia documentando `trailingActions`
// como prop viva.
//
// No es tramite: en este proyecto un doc desactualizado ENSENA la deuda — el
// snippet viejo de §16.2 se copio 9 veces antes de que alguien lo notara.

// v2.249.1 — la superficie de la barra flotante se MIDIO, y el rotulo dejo de
// cortarse.
//
// v2.249.0 cambio el cluster a `data-surface="card"` razonando que, con el blur
// ya arreglado, el 16% seria el vidrio "del header y de cualquier card" que se
// pidio. Medido en WebKit a 390px sobre la lista de empleados, con las filas
// pasando por detras: **falso**. Comparadas las tres superficies existentes,
//
//     card (16%)      "SALUD 2" se lee ENTERO y cae encima de "ACCIONES"
//     dropdown (72%)  lo de atras queda fantasma, los rotulos limpios
//     modal (85%)     ya no deja ver nada, es un panel
//
// asi que `dropdown` era la eleccion correcta por la razon equivocada: se habia
// subido a 72% para tapar un blur que no existia. Con el blur vivo, el 72% ES
// vidrio esmerilado —se ve el color y el movimiento de la lista a traves— y
// ademas cumple el criterio que index.css ya fija para lo que flota sobre
// contenido: que lo de atras sea LUZ, no texto. Vuelve a `dropdown`.
//
// **`index.css` queda byte a byte igual que antes de la sesion.** v2.249.0 le
// habia agregado `translate` a la transicion de `[data-surface="card"]`; con el
// cluster en `dropdown` —que no declara `transition` propia— alcanza la utilidad
// `transition-transform` de Tailwind v4, que en v4 ya cubre `translate` ademas de
// `transform`. Cero tokens nuevos: la paleta es CERRADA.
//
// Y el rotulo del boton del cluster pasa de `truncate` a dos lineas: en los 60px
// de la columna "NUEVO EMPLEADO" salia "NUEVO E…", que no dice que hace el boton.

// v2.249.0 — FilterBar es filtros Y acciones, y el vidrio de la barra flotante
// estaba roto por un `transform` ancestro.
//
// **La auditoria.** 22 vistas usan `FilterBar`. Pasandole el buscador y la accion
// principal para la barra flotante tactil: **1**. No fue descuido — el mismo dato
// habia que escribirlo dos veces (una en `ViewTabBar`, otra en `FilterBar`) y la
// copia que falta no se ve rota hasta abrir la vista en un telefono. En las 5
// pestanas de Productos era ademas imposible: el estado del buscador vive en
// `ProductosView` y las pestanas solo reciben el termino ya rebotado.
//
// **`trailingActions` se retiro.** Era un cajon de sastre: acciones de verdad
// ("Nuevo Empleado", "Publicar", "Exportar"), pero tambien FILTROS — el rango de
// fechas y el tipo de `TabHistory`, el `SegmentedControl` de
// `EmployeeAnnouncementsView`—. O sea que la pildora del HEADER estaba filtrando,
// justo lo que §17 dice que no hace. Y en tactil eran dos botones
// `SlidersHorizontal`: uno arriba abria "Filtros y acciones", otro abajo abria
// "Filtros". Dos puertas, el mismo icono, contenidos distintos.
//
// Ahora: header = navegacion + buscador. `FilterBar` = filtros + acciones, como
// DESCRIPTORES y no JSX (el mismo boton se dibuja `TabBarAction` en escritorio y
// boton de clusteren el telefono; con JSX suelto la barra flotante solo podia
// re-renderizarlo tal cual).
//
// **El canal.** Las dos pildoras son HERMANAS —`ViewTabBar` llega por
// `filtersContent`, `FilterBar` por `children`—, asi que un contexto declarado en
// una no llega a la otra. `CanalDeVista.js` publica en los dos sentidos desde
// `GlassViewLayout`, que es el unico ancestro comun: `ViewTabBar` publica su
// buscador y `FilterBar` anuncia que existe la barra flotante para que el header
// suelte su lupa. Cero cableado por vista.
//
// **El vidrio.** El contenedor `fixed` animaba con `translate-y-*`, y un ancestro
// con `translate` establece un *backdrop root*: el `backdrop-filter` del cluster
// muestreaba un fondo VACIO. Tercera vez que este proyecto se tropieza con la
// misma regla. Explica el rodeo anterior: `card` (16%) dejaba leer el nombre del
// producto a traves —claro, sin blur el 16% es ver el texto— y se subio a
// `dropdown` (72%), que es un panel opaco. La animacion se movio al elemento que
// lleva el vidrio (un `transform` PROPIO no rompe nada) y la superficie volvio a
// `card`. De paso: `transition: transform` NO anima la propiedad `translate` —son
// independientes—, asi que index.css la nombra aparte.
//
// **Dos `activeCount` que mentian.** FacturasCompra contaba `sinProveedor` e
// `invalidados`, StaffManagement contaba `activeStatFilter`: controles que no
// estaban en la pildora. En el telefono la hoja decia "3 filtros" y ofrecia uno.

// v2.243.0 — F4 de identidad: la rampa de iconos se habia medido MAL, y el trazo
// tenia 14 valores contra un doc que declaraba uno.
//
// **El numero del doc estaba mal.** §12 decia "1,287 iconos, 33 tamanos". La
// medicion contaba props `size` de componentes que NO son iconos:
// `<VendorAvatar size={5}>` es una clave de escala (`5 → w-5 h-5`), no pixeles, y
// `<PersonAvatar size={34}>` tampoco es un icono. De ahi salian los `5`, `30` y
// `34` "fuera de rampa" que nunca existieron. Contando solo `lucide-react`:
// **1,249 iconos, 24 tamanos**.
//
// (Bug propio en la medicion nueva, del mismo tipo: mi primer filtro solo aceptaba
// `from 'lucide-react'` con comillas SIMPLES, y 4 archivos las usan dobles — asi
// se me escaparon Clock, Building2 y Check como "no iconos".)
//
// **La rampa:** 8·9·10·11·12·13·14·15·16·18·20·22·24·26·28·32·36·40·48. Entran `9`
// (61 usos) y `15` (55): la version anterior los excluia sin decir por que,
// dejando 116 iconos reales fuera de una escala escrita el mismo dia. Sale `56`
// (cero usos). Migrados: 17→16 y 42→40 (6, los paneles del kiosco).
//
// **El trazo va con el tamano, y el doc decia lo contrario.** §12 declaraba `1.5`
// de reposo; en el tramo 15-20px el `2.5` gana **146 a 12**. Lo que si es un
// sistema —optica, no gusto— es que el trazo se afina cuando el icono crece:
//     interfaz 8-28px  → 2 · **2.5 default** · 3
//     despliegue 29-48 → 1 · 1.5
//     ilustracion ≥49  → lo que pida la caja
// 28 sitios migrados al vecino de SU banda (1.8→2, 2.2→2, 2.25→2.5, 2.75→2.5,
// 1.75→2, 1.2→1.5, 1.6→1.5). Los canonicos primero, que es donde mas pesa: Button,
// ListRow, FileField y MenuSearchModal estaban en 2.25 y FilterBar y TabBarAction
// en 2.75 — el peso optico del portal cambiaba segun que componente te tocara.
//
// **Arriba de 48px son DOS cosas, no una.** El doc decia "tres marcas de agua:
// 100, 80, 64". Marcas de agua hay dos (FormWfmAnalytics 100 con `/15`,
// EmployeeDetailView 80 con `opacity-10`); el 96 del kiosco, el 70 del wallboard y
// el 64 de FormLeadership son iconos de DESPLIEGUE — el 64 es la ilustracion de
// "Esperando candidato", con titulo y subtitulo, sin opacidad propia.
//
// Gates nuevos `icono-rampa` e `icono-stroke`, bloqueantes en cero (30
// categorias). Dos excepciones con motivo: el `4` del Checkbox (un check de 2.5
// dentro de una caja de 16px se pierde, y ese glifo ES el estado del control) y el
// `0.5` de la marca de agua.
//
// Cuarta fase de `docs/PLAN-IDENTIDAD-2026-07-29.md`.

// v2.241.0 — F3 de identidad: los 50 `title=` sobre elementos no interactivos eran
// CUATRO patrones, no uno. Y 22 puntos de estado que ningun lector de pantalla
// anunciaba.
//
// El plan decia "los 50 son el caso 'explicar' y van a LiquidTooltip". Al medirlos
// por tipo de elemento, falso:
//
//   (A) 12 = el escape del TRUNCADO. El texto visible esta cortado y el `title`
//       tiene el completo. LiquidTooltip envuelve en `inline-block`, que rompe
//       justo el truncado que el title existe para salvar. Se quedan.
//   (B) 22 = el nombre de un GRAFICO: punto de estado, avatar en pila, dot por
//       sucursal, burbuja del cumpleanos. Un `<span className="rounded-full
//       bg-success" title="Disponible">` no lo anuncia NADA: sin `role`, el lector
//       de pantalla salta el elemento y ese title no existe para quien no usa
//       mouse. Con `role="img"` el MISMO title pasa a ser su nombre accesible.
//       Un atributo, cero riesgo de layout, el hover intacto.
//   (C) 1 = un contenedor de controles con nombre → `role="group"`.
//   (D) 15 = prosa suplementaria → esos si fueron a LiquidTooltip (de 4 archivos
//       usandolo a 12).
//
// **Lo que LiquidTooltip NO arregla**, y por eso no lo prometo: su wrapper es un
// `<span>` sin tabIndex, o sea NO es focusable. Sus onFocus/onBlur solo disparan
// si el hijo lo es. Sobre texto o un grafico, el tooltip queda igual de
// inalcanzable por teclado que el `title`, y en tactil tampoco hay mouseenter.
// Compra consistencia visual, no accesibilidad. Si la info importa y solo vive en
// hover, la respuesta es un boton de info o texto visible — anotado como deuda.
//
// Un `title` que repetia exacto el texto visible (RolesView) se borro: sobraba.
//
// Bug encontrado y no resuelto: `CajaFecha` de ConteoDetailView explica en su
// `title` POR QUE la caja esta inerte, y cuando lo esta lleva
// `pointer-events-none` — el hover esta muerto justo en el estado que explica.
// `role="group"` al menos se lo da al lector de pantalla.
//
// Gate nuevo `tooltip-no-control`, bloqueante en cero (28 categorias): permite (A)
// por el truncado y (B)/(C) por el rol; todo lo demas es (D) y va a LiquidTooltip.
// §15.10 y §16.3 documentan los cuatro patrones.
//
// Tercera fase de `docs/PLAN-IDENTIDAD-2026-07-29.md`.

// v2.239.0 — F2 de identidad: la Voz. DESIGN.md tenia 3,370 lineas sobre la forma
// y CERO sobre la palabra.
//
// Era la unica primitiva del sistema sin doc, y se notaba: en el mismo hueco —el
// mensaje de vacio— convivian cuatro gramaticas. `Sin resultados` /
// `Sin facturas en el periodo.` (con punto) / `No hay registros` /
// `Aun no hay cotizaciones`. Mas Title Case suelto (`Sin Horarios`,
// `Datos Incompletos`) y tuteo mezclado con voseo.
//
// Nueva §26 con nueve reglas. La decision de fondo: **el portal usa tuteo**, que
// ademas era lo que ya dominaba (89 usos contra 22 de voseo). Unificar hacia el
// mayoritario costo 22 strings en vez de 89.
//
// Tres reglas salieron de aplicarlas, no de escribirlas:
//
//  - **El vacio feliz es una tercera forma (§26.3).** Forzar `Sin X` en
//    `Todo esta al dia` o `Expediente impecable` tira informacion al piso: ahi
//    "no hay nada" es una BUENA noticia y hay que decirsela.
//  - **Los `¡...!` se prohiben en el feedback del sistema, no en los momentos
//    humanos (§26.7).** La primera version los prohibia a secas y el codigo tenia
//    razon en violarla tres veces: el cumpleanos en el kiosco, `¡Acceso
//    concedido!` al escanear el carne, y `¡Hoy! 🎉`. Un `¡Guardado!` en un boton
//    es la app festejando su propio CRUD; un cumpleanos no.
//  - **El punto final no depende de cuantas oraciones hay sino de si es etiqueta
//    o prosa (§26.5).** Mi primer gate marcaba `subtitle="Crea el primero con el
//    boton de arriba."` — contradiciendo el doc que acababa de escribir, porque un
//    subtitulo ES oracion completa y lleva punto.
//
// Dos gates nuevos, `copy-vacio` y `copy-trato`, bloqueantes en cero (27
// categorias). Y acotarlos fue el trabajo real: la primera version miraba todo
// `title=` y devolvio 123 hallazgos casi todos falsos —
// `<GlassViewLayout title="Facturas de Compra">` es el NOMBRE de un modulo y ahi
// el Title Case es correcto—. Ahora solo mira `message:` y los atributos DENTRO
// de un `<EmptyState>`, y el Title Case solo en etiquetas de ≤4 palabras.
//
// Bug propio que vale registrar: **en JS `\b` es ASCII**, asi que `\bTené\b`
// matchea DENTRO de `Tenés` (la `é` cuenta como no-palabra, y entre `é` y `s` hay
// frontera). Lo delato el gate reportando `Tené` en "Tenés un borrador". Van
// lookarounds explicitos de letra con acentos.
//
// Segunda fase de `docs/PLAN-IDENTIDAD-2026-07-29.md`.

// v2.237.0 — F1 de identidad: toda cifra pasa por `formatNumber`, y el Dashboard
// dejo de mostrar `$1234,56`.
//
// El defecto real: seis lugares del Dashboard (incluidos los KPI "Monto cotizado"
// y "Facturado hoy") formateaban con `toLocaleString('es')`, que da coma decimal
// y SIN separador de miles → `$1234,56`. EmployeeAnnouncementsView usaba `es-VE`
// → `$1.234,56`. El resto del portal mostraba `$1,234.56`. Mismo monto, tres
// caras segun la pantalla.
//
// Nuevo canonico `src/utils/formatNumber.js` con locale FIJO `es-SV` (no se
// hereda del navegador: un navegador en `es-ES` no deberia cambiarle los
// separadores al ERP). Cuatro funciones: `formatMoney`, `formatQty`,
// `formatPct`, `formatMoneyCorto`. Nulo → `—`, nunca `$NaN`.
//
// Lo que se encontro migrando, que no estaba en el plan:
//  - `formatMoneyCorto` existia DOS veces y distinto: TabSinVenta y
//    tabminmax/helpers tenian la misma escalera copiada, pero a la de
//    TabSinVenta le faltaba el peldano de los miles. $5,400 salia `$5.4k` en
//    MIN·MAX y `$5,400.00` en Sin Venta. Queda la escalera completa.
//  - `svToday()` de WidgetAnnulmentRequest usaba `toLocaleString('en-US')`
//    reparseado con `new Date()`. NO es formato: es leer el reloj en la zona de
//    El Salvador, y funcionaba de casualidad (con `es-SV` da **Invalid Date**).
//    Pasa al idiom `en-CA` que ya usaba `useTimeClockEngine.js`.
//  - El reloj del kiosco mostraba `03:30 PM` (en-US) contra el `p. m.` del resto.
//
// 47 sitios de fecha en 18 archivos pasan a `es-SV`. Con `hour12: true` explicito
// `es-ES` renderiza IGUAL que `es-SV`, asi que ese barrido es de consistencia, no
// de correccion — lo que si elimina es la trampa de que `es-ES` cae a 24 h si
// alguien omite `hour12`.
//
// Gate nuevo `formato-cifra`, bloqueante en cero (25 categorias). Penaliza locale
// distinto de `es-SV` y la plantilla `` `$${x.toFixed(2)}` ``. `toFixed()` a secas
// no: redondear es calculo, no formato. `en-CA` se excluye EN EL REGEX y no como
// excepcion por archivo, para que la categoria siga viva en esos 5 archivos.
// Excepciones con motivo: la boleta/planilla de PayrollView (documento legal + el
// CSV del banco, donde un separador de miles rompe la carga) y el PDF del conteo.
//
// Primera fase de `docs/PLAN-IDENTIDAD-2026-07-29.md`.

// v2.236.0 — prefetch del menú: la vista se carga al pasar el mouse, no al hacer clic.
//
// Segunda entrega de la tarea de rendimiento, y la parte mas util fue MEDIR bien
// antes de creerme el resultado:
//
//  1. La primera medicion decia 820 ms por navegacion. Falso: ~470 ms de eso era
//     el propio `click()` de Playwright esperando que el item del menu dejara de
//     animarse. Con un cronometro DENTRO de la pagina (listener de click real →
//     MutationObserver del <h2>) la navegacion real es ~350 ms.
//  2. En localhost el prefetch no mejoraba NADA (351 → 349 ms). Tampoco era
//     falso: bajar 8 archivos desde el disco local no cuesta. Con 70 ms de
//     latencia emulada, que es lo que hay contra el CDN de Vercel:
//         Nomina  (9 chunks)   356 → 337 ms
//         Personal (22 chunks) 366 → 363 ms
//         Pedidos (16 chunks) 1947 → 1241 ms   ← -706 ms
//         media                 890 → 647 ms   (-27%)
//     O sea: sirve en las vistas pesadas, que son las que se sienten lentas.
//  3. Verificado que el prefetch corre de verdad: al pasar el mouse por Nomina se
//     piden 8 archivos JS (incluido PayrollView) y el clic posterior pide CERO.
//
// Como esta hecho: los `import()` de las 44 vistas dejan de estar sueltos en cada
// `lazy()` y viven en constants/routeImporters.js, asi el prefetch reusa
// exactamente la misma funcion (import() cachea la promesa: pasar el mouse veinte
// veces no descarga dos). El mapa ruta → vista se genero leyendo las <Route> de
// App.jsx, no a mano; si una vista se renombra y el mapa queda viejo, el prefetch
// no encuentra la clave y no hace nada — nunca rompe la navegacion.
// Va en onMouseEnter, onFocus (teclado) y onTouchStart (en tactil no hay hover).
//
// Lo que NO arregla, y queda medido: hay un piso de ~350 ms de React montando la
// vista que el prefetch no toca — el modulo ya esta resuelto y evaluado. Volver a
// un modulo ya visitado son 60 ms.

// v2.235.1 — el borrador de una migracion va al scratchpad, no a migrations/.
//
// Aclaracion de la regla, salida de un caso real: otra sesion dejo
// `supabase/migrations/20260729_conteo_v5_filtro_lab_y_orden.sql` (nombre viejo de
// 8 digitos) y el gate lo marco — correctamente, pero la migracion todavia no esta
// aplicada en prod, asi que el nombre valido no existe aun: la version la asigna el
// servidor al aplicar. Entonces el borrador no va dentro de `supabase/migrations/`.
// Primero `apply_migration`, despues el archivo con la version que devolvio.

// v2.235.0 — hook de pre-commit, y la regla de que este arbol es compartido.
//
// EL HOOK vive en `.githooks/pre-commit` (versionado a proposito: `.git/hooks/` no
// viaja con el repo, asi que un clon nuevo se quedaria sin gate). Se habilita una
// vez por clon con `npm run hooks:install`, que setea `core.hooksPath`. Tres
// chequeos, ninguno con red: bloquea si un archivo esta preparado Y modificado
// despues de prepararlo, corre `version-gate` siempre, y `migration-gate` solo si
// el commit toca `supabase/migrations` — acotado ahi para no bloquear a una sesion
// por el arbol a medio editar de otra.
//
// LA REGLA NUEVA en CLAUDE.md sale de medirlo en esta misma sesion: el `git status`
// paso de 2 a 8 archivos modificados en 40 minutos sin que esta sesion tocara
// ninguno de los 6 nuevos, y otra sesion commiteo y pusheo v2.234.0 en el medio.
// De ahi: leer `git status` antes de editar un archivo que no tocaste (un `Write`
// encima de cambios ajenos los borra y no estan en ningun commit); prohibido
// `git add -A`/`commit -a`/`stash`/`checkout .`/`reset --hard`; `fetch` antes de
// pushear; y leer `APP_VERSION` del disco en el momento en vez de asumir "el
// anterior + 1" — que es exactamente lo que iba a pasar aca.
//
// El hook se ejercito en los cuatro caminos antes de confiar en el (preparado y
// modificado despues, resuelto con re-add, migracion con nombre viejo, y src/
// preparado sin bump). Los cuatro dan el mensaje correcto y salida 1 donde toca.

// v2.234.0 — Personal › Listado bajaba 4.1 MB en fotos. Ahora baja 534 kB.
//
// Primera entrega de la tarea de rendimiento. Medido con el navegador: al abrir
// Personal › Listado se descargaban **25 fotos de perfil de 168 a 199 kB cada
// una — 4,143 kB de 4,163 kB del total de la vista** para pintarlas en circulos
// de 36 px. Era, de lejos, la carga mas pesada del portal.
//
// Correccion de un diagnostico previo mio: habia reportado esas 25 peticiones
// como "N+1 de firmas de storage". NO lo eran. Una URL firmada VIVE en la ruta
// /object/sign/..., asi que al clasificar por ruta confundi las descargas de las
// imagenes (GET) con llamadas de firma (POST). El firmado ya era en lote y
// estaba bien; el problema eran los bytes.
//
// La solucion no cuesta ni una peticion extra: se sigue firmando en lote (UNA
// llamada) y se reescribe la URL al endpoint de render, que convierte a WEBP
// segun el Accept del navegador. 168 kB PNG → 20 kB WEBP.
//
// Lo que NO funciona, probado contra prod antes de elegir:
//   · `transform` en el cuerpo del firmado EN LOTE: el servidor lo ignora,
//     responde 200 y devuelve la URL sin transformar (168 kB).
//   · `width` / `height` / `resize` / `quality` en la URL firmada: TAMBIEN se
//     ignoran. Las cuatro combinaciones devuelven exactamente 20 kB a 400×400,
//     igual que sin parametros. Redimensionar de verdad exige firmar de a una
//     (`createSignedUrl(..., { transform })`) y eso son otra vez 25 peticiones
//     para ahorrar unos pocos kB — no vale la pena, las fotos ya se suben a
//     400×400.
//
// Va en LiquidAvatar (canonico, 11 vistas) y en las 4 fotos de usuario del
// sidebar, que se cargan en TODAS las pantallas. Si el render fallara, el avatar
// reintenta con la URL original antes de caer a iniciales.
//
// Verificado: 27 de 27 fotos cargan, las 27 por el endpoint de render, cero
// fallos; /dashboard, /minmax y /payroll siguen abriendo.
//
// Pendiente de la misma tarea: los 9-22 archivos JS por primera entrada a cada
// modulo (prefetch al pasar el mouse), y `roles` + `role_permissions` pedidas 4
// veces cada una al recargar la pagina.

// v2.233.0 — la convencion de migraciones deja de ser prosa: `gate:migrations`.
//
// C2 del plan de cierre de Supabase dejo `supabase/migrations/` describiendo prod
// otra vez (un baseline generado del catalogo, verificado 15/15 contra la huella,
// mas las 339 heredadas en `migrations-legacy/`). Pero nada impedia que la deriva
// volviera a acumularse: `apply_migration` escribe SOLO en el servidor, y ni
// olvidar el archivo ni nombrarlo `YYYYMMDD_nombre` dan error. Es el mismo
// mecanismo que produjo 731 filas contra 339 archivos, con solo 14 de 699
// versiones coincidiendo.
//
// Y el detector natural quedo ciego: `supabase migration list` y `db push
// --dry-run` arrancan listando las 731 versiones pre-baseline sin archivo local,
// asi que una migracion nueva sin archivo seria la fila 732 de una lista de ruido.
//
// `npm run gate:migrations` corre sin red ni credenciales: nombres
// `<version-de-14-digitos>_<name>.sql` (el viejo de 8 digitos falla), version que
// sea un timestamp real, sin duplicados, baseline presente y ordenando primero,
// nada pre-corte en `migrations/` y nada post-corte archivado en
// `migrations-legacy/`. Con `-- --remote` cruza contra el registro de prod y, si
// encuentra una migracion aplicada sin archivo, imprime el `select` sobre la
// columna `statements` para recuperarla.
//
// La frontera es una constante —`CORTE = 20260729223030`, la primera migracion
// post-baseline— y no la version del baseline: el baseline es `20260101000000` a
// proposito, para ordenar primero, pero las 731 viejas van de 20260404 a 20260729,
// o sea son MAYORES. Comparar contra el baseline no separaria nada.
//
// Ejercitado contra un arbol falso antes de confiar en el: los cuatro chequeos
// locales disparan y la deteccion remota encuentra la migracion sin archivo. Sin
// credenciales degrada a los chequeos locales con un aviso, no a verde. El `.env`
// se mueve y se restaura en `finally` + SIGINT (el CLI lo lee y aborta), y si
// quedo colgado de una corrida interrumpida lo restaura al arrancar.
//
// CLAUDE.md queda al dia. Decia solo que el `name` del `apply_migration`
// coincidiera con el archivo: un agente que leyera eso hoy escribiria
// `20260730_mi_cambio.sql` y estaria cumpliendo la regla escrita.

// v2.232.0 — Mantenimiento en tarjetas, y el aviso del candado se muda al
// encabezado (opcion B, elegida por Alex).
//
// TARJETAS. La lista pasa a rejilla (3 columnas en escritorio, 1 en telefono),
// agrupada como en Permisos. La tarjeta activa tiene cuerpo propio: COMENTARIO y
// DURACION con etiqueta y ancho de verdad, mas la linea de titular/vencimiento —
// en fila iban apretados contra el switch. `items-start` y sin `h-full` a
// proposito: si no, las tarjetas libres se estiran al alto de la activa y la
// rejilla queda con huecos enormes (se vio en la primera captura).
//
// EL AVISO SE VA AL ENCABEZADO. Antes era un bloque en el cuerpo. El encabezado
// es sticky, asi que el estado ya no se va de pantalla al bajar por una tabla
// larga — que era el caso feo: botones de guardar apagados y ninguna explicacion
// a la vista. Ahora son dos piezas: la ficha "Solo lectura" al lado del titulo y
// una linea con quien, por que y hasta cuando (con Terminar si el candado es
// tuyo). Las dos las monta GlassViewLayout, cubren las 37 vistas y devuelven null
// si no hay candado. Montadas tambien en el encabezado movil.
//
// Lo que NO se hizo de la opcion B: el candadito en cada boton apagado. Eso
// exige que `Button` sepa de la ruta y del candado, o sea un useAuth() +
// useLocation() en CADA boton de la app — justo despues de un reporte de
// lentitud, no. Queda como pendiente por vista si hace falta.
//
// Verificado en navegador con lock_module/unlock_module interceptadas (sin
// escribir candados en prod): 27 tarjetas, la ficha y la linea salen en el
// encabezado de /payroll y NO en el cuerpo, el switch llama a la RPC, el
// comentario vuelve a llamarla con el motivo, y apagar libera. El buscador
// filtra: "nomina" deja 1 tarjeta, "sucursal" deja 6. Cero errores de consola.

// v2.231.0 — el conteo ciego era un interruptor, y un click de más inventaba
// faltantes.
//
// 1. EL CIEGO NO ERA CIEGO. Era `useState(true)` + un `<Switch>`: cualquiera con
//    can_edit lo apagaba, y el número del sistema viajaba en la respuesta de
//    todos modos. Ahora NO SALE DE LA BASE. Permiso `conteo_ver_sistema` y el
//    predicado `conteo_puede_ver_sistema`: se ve si el conteo ya está cerrado
//    —ahí los números SON el resultado— o si tenés el permiso. Son CINCO
//    caminos y los cinco lo respetan; tapar solo la tabla dejaba tres puertas
//    abiertas, entre ellas el JSON de los PDF (la hoja se imprimía con
//    `{ciego:false}` FIJO, o sea que el papel revelaba lo que la pantalla
//    tapaba) y los `*_count`, porque filtrar por "con diferencia" señala
//    exactamente las líneas que descuadran sin mostrar un número.
//
// 2. UN GUARDADO SIN CAMBIOS MOVÍA LA EXISTENCIA. `guardar_conteo_item` releía
//    `inventory` en TODA llamada: abrir una línea confirmada y salir sin tocar
//    nada le reasignaba el sistema de ese instante, y si entre el conteo y ese
//    click hubo una venta la línea pasaba de cuadrada a faltante sin que nadie
//    contara. Verificado con ROLLBACK: inventory 25, captura 7 (dif -18) → la
//    venta baja a 22 → re-guardar el mismo 7 devuelve SIN_CAMBIO y la fila
//    sigue en 25/-18 → guardar 9 sí relee (22/-13). El no-op no escribe ni
//    historial.
//
// 3. `hideBelow="xl"` DE `DataTable` OCULTABA LA COLUMNA PARA SIEMPRE. La clase
//    se armaba en runtime y Tailwind escanea el fuente: funcionaba de prestado
//    porque otras vistas escriben `md:`/`lg:` literales, y `xl:` no lo había
//    escrito nadie. Cuarta vez con una clase que no existe. Ahora es un mapa.
//
// Lo que se ve: nada se contrae (las líneas de los 25 productos de la página en
// UNA llamada); confirmada = BLOQUEADA con un lápiz como único camino de vuelta;
// quién puso la cantidad EN la línea (foto, nombre corto, hora, contador de
// ediciones) y un historial que dice QUÉ pasó (columna `evento`); y en el
// TELÉFONO una tarjeta por PRODUCTO con sus lotes adentro, campo de 56px con
// teclado numérico y Enter al siguiente pendiente — verificado en WebKit y
// Chromium a 320/375/390/430/768/1024/1440 en los tres estados de línea: cero
// scroll horizontal, cero recorte, tap ≥44px, fuente ≥16px. `PortalInput` gana
// `alto` y pierde los spinners nativos de `input[type=number]`.

// v2.227.0 — se cierran los pendientes, y DOS de los tres "fallos" que
// quedaban eran de mi medidor, no del portal.
//
// Contraste: 23 -> **0**. Lo que se corrigio de verdad fue uno solo:
// `--danger-text` #f87171 media 4.43:1 sobre el TINTE del badge danger
// (#462e3a = tarjeta + danger/12), justo bajo AA. Sobre la tarjeta plana daba
// 5.29 y por eso habia pasado siempre. Ahora #fb9a9a: 5.95 sobre el tinte, 7.1
// sobre la tarjeta, 8.66 sobre la pagina. Mas 17 `text-danger|success|warning`
// de AttendanceAuditView que seguian usando el token de RELLENO como color de
// texto.
//
// Los otros dos NO eran defectos:
//   · Los 6 nodos de "General" a 2.51:1 eran la etiqueta de un tab inactivo de
//     `ViewTabBar` medida **a mitad de su transicion de 700ms**. El alfa de
//     0.97 y un color que no correspondia a ningun token lo delataron. Con la
//     espera correcta: 0.
//   · Los 2 targets de 36px del kiosco eran mi contexto de Playwright sin
//     `hasTouch`. El kiosco REAL es una pantalla tactil: con `pointer: coarse`
//     los mismos botones miden 44 y quedan en 0.
//
// Pendientes que se cierran:
//   · KIOSCO — fuerza `data-theme="dark"` como esta documentado, 0 nodos bajo
//     AA, 0 targets bajo 44 (tactil), 0 errores de pagina.
//   · LOGIN — 0 targets bajo 44 y **0 controles sin indicador de foco**.
//   · ESTADOS DE ERROR de formulario — validacion disparada con el formulario
//     vacio (la escritura la aborta un guardia de red): 4 marcas de error
//     renderizadas, 210 nodos medidos, 0 bajo AA.
//   · FIREFOX — **no se pudo verificar**: no arranca en este entorno (el
//     sandbox de macOS le bloquea `plugin-container`). Lo que si se verifico es
//     el riesgo concreto que este proyecto ya sufrio ahi: que Lightning CSS
//     descarte la propiedad estandar y deje solo `-webkit-backdrop-filter`.
//     En el bundle: 37 estandar / 37 con prefijo, **0 reglas con solo el
//     prefijo**. El vidrio le llega a Firefox.
//
// Con los modales abiertos: 31 modales, 1,507 nodos de texto, 0 bajo AA.
// Foco: 8 dialogos, entra / atrapa / devuelve, 0 fallos.
// Targets: 1,003 controles, 7 bajo 44 y son las barras del grafico.
// gate:design 0/25 · gate:doc y eslint limpios.

// v2.226.0 — Mantenimiento: lista completa con switch, y el aviso que no se leia.
//
// 1. BUG DEL CANONICO `Notice`, reportado por Alex sobre un aviso ilegible.
//    `warning` y `success` pintaban el texto con el color de acento CRUDO
//    mientras `info` y `danger` si usaban su token `-text`. Medido sobre el fondo
//    efectivo del propio aviso (bg-warning/10 sobre tarjeta clara = #fef4e6):
//        text-warning      #F79009 → 2.16:1   ✗ (WCAG AA pide 4.5:1)
//        text-warning-text #9a4507 → 5.98:1   ✓
//    Los dos tokens ya existian (y con override por tema), asi que el arreglo va
//    en el canonico: cubre los 22 avisos warning de la app, no solo el que se vio.
//    Verificado en el navegador: el texto sale rgb(154, 69, 7).
//
// 2. Fuera el boton "Poner en mantenimiento" y fuera el modal. Ahora se listan
//    LOS 27 modulos bloqueables con un switch cada uno; al encenderlo el candado
//    queda puesto y la fila revela sus DOS CUADROS (motivo y duracion), que son el
//    estado del candado y se editan en vivo sobre el candado ya tomado — el motivo
//    guarda al salir del campo o con Enter, la duracion al cambiarla. El switch ES
//    la accion.
//
// 3. Lupa canonica: el buscador va en el ViewTabBar del encabezado, como en el
//    resto de las vistas. Filtra por nombre, descripcion y key (smartFilter).
//    Verificado: "nomina" deja 1 modulo, "sucursal" deja 6.
//
// 4. Los nombres salen del registro de PERMISOS, no del menu. Se extrajo
//    MODULE_GROUPS de PermissionsView a constants/permissionModules.js con un mapa
//    plano MODULE_INFO (label + desc + grupo + icono, incluidas las pestañas). El
//    menu dice "Listado"; Permisos dice "Listado de Personal", y ahora esta vista
//    tambien. Los 27 bloqueables tienen etiqueta y descripcion — verificado.
//
// Se muestran TODOS los modulos, tambien los que uno no puede editar (switch
// deshabilitado): saber que existen y quien los tiene tomados es parte de
// responder "¿que hay bloqueado?".
//
// Verificado en navegador con lock_module/unlock_module INTERCEPTADAS — no se
// escribio ningun candado en prod: encender llama lock_module(payroll, null, 4),
// aparecen los dos cuadros, escribir el motivo vuelve a llamar con
// reason="cierre de quincena", el banner sale en /payroll, y apagar llama
// unlock_module. Cero errores de consola.

// v2.225.0 — el candado de mantenimiento sale de MIN·MAX: panel en Sistema y
// banner en las 37 vistas.
//
// Cuatro problemas del estado anterior:
//  1. El banner estaba montado A MANO y solo en MinMaxView, asi que un candado
//     sobre cualquier otro modulo era INVISIBLE: la gente veia los botones de
//     guardar apagados y ningun cartel que lo explicara.
//  2. Solo se podia soltar desde el modulo bloqueado. La RPC ya permitia que otro
//     admin liberara, pero no habia pantalla donde hacerlo.
//  3. No habia forma de responder "¿que hay bloqueado ahora?".
//  4. Se podia tomar un candado INUTIL. El candado vive dentro de
//     auth_can_edit_any(ARRAY[...]), asi que bloquear un modulo que ninguna policy
//     consulta no frena nada — y lock_module aceptaba cualquiera de los 93 de
//     role_permissions. Se podia bloquear conteo_inventario, ver el banner puesto
//     y seguir guardando. Un candado que miente es peor que no tenerlo.
//
// Ahora:
// - get_lockable_modules() DERIVA la lista de pg_policies + los cuerpos de las
//   funciones: hoy 27 de 93. No es un diccionario a mano — cuando alguien agregue
//   una policy con auth_can_edit_any(ARRAY['x']), x aparece sola. lock_module
//   valida contra esa lista.
// - Vista nueva Sistema › Mantenimiento (module_key `maintenance`, permiso copiado
//   de orphan_objects: mismo publico que las otras vistas de infra). Lista los
//   candados activos con titular, motivo, desde/vence y cuanto falta; cualquiera
//   con permiso puede terminar uno ajeno. El limite de los crons se dice ahi, que
//   es donde se toma la decision.
// - El banner se monta UNA vez en GlassViewLayout y resuelve su modulo desde la
//   ruta, asi que cubre las 37 vistas que usan ese layout sin que ninguna tenga
//   que acordarse. Devuelve null si no hay candado.
// - TOMAR el candado ya no esta en el banner: 37 vistas con un boton de bloquear
//   es superficie de bloqueo accidental. Terminar SI sigue ahi — el titular tiene
//   que poder soltarlo donde esta trabajando.
// - MODULE_MAP se extrajo de AppLayout a constants/moduleMap.js con el helper
//   moduleKeyForPath(): un componente de common/ no puede importar el layout.
//
// Verificado en el navegador (candado sintetico via page.route, sin escribir en
// prod): la vista carga con su estado vacio y el aviso, el modal abre, el banner
// aparece en /payroll con el titular y el motivo, /minmax sin candado no muestra
// nada, y cero errores de consola.

// v2.224.0 — el foco de los modales, y 421 fallos de contraste que ningun
// escaner anterior podia ver.
//
// FOCO. `ModalShell` no manejaba foco: no lo movia al abrir, no lo atrapaba, y
// **no lo devolvia al cerrar**. Medido antes del cambio: activeElement quedaba
// en BODY, o sea que la siguiente tabulacion arrancaba desde el principio de la
// pagina, pasando otra vez por todo el menu. Afectaba a TODOS los modales.
// Ahora: entra al primer enfocable, Tab no puede salir (Escape es la salida), y
// al cerrar vuelve al disparador — con respaldo al <main> si ese disparador no
// sobrevivio al re-render, para no dejar nunca el foco en el body.
// Verificado en 8 dialogos: 0 fallos en los tres criterios.
// El fondo pasa a `aria-hidden` + `tabIndex={-1}`: duplica lo que Escape ya
// hace, y como parada de foco era una invisible antes del contenido.
//
// CONTRASTE — 421 nodos bajo AA, y el motivo por el que nunca se habian visto.
// El escaner de D1 leia los colores con un regex `rgba?(...)`. Chrome devuelve
// `oklab(...)` para cualquier color con alfa de Tailwind, asi que los saltaba:
// en los temas de vidrio media 63 de 3,698 nodos y reportaba "0 bajo AA".
// Reescrito para que el color lo convierta el navegador (canvas de 1px) y para
// COMPONER el alfa sobre el fondo. Con eso, en los temas Solid —donde los
// fondos son opacos y todo es medible— aparecieron 421 nodos en 28
// combinaciones. **421 -> 23.**
//
// La causa dominante era una sola idea, y es la otra mitad de §25.5: una
// superficie SIEMPRE-OSCURA (sidebar, tooltip) hereda los tokens de TEXTO del
// tema activo. En liquid/dark no se nota porque ya son claros; en Solid, que es
// un tema CLARO, resolvian a valores oscuros sobre fondo oscuro:
//   · badge "Proximamente" del menu: 2.39:1
//   · tooltip "Clic para ver horas": 2.07:1
// Se fijan ahi los tokens del tema oscuro.
//
// Lo demas:
//   · `--text-secondary`/`--text-tertiary` de solid-dark median 4.92:1 sobre la
//     TARJETA (por eso pasaron T2) pero 3.58:1 sobre superficies ELEVADAS
//     —chips, filas resaltadas—. 191 nodos, el grupo mas grande. Suben a
//     valores que pasan sobre las tres superficies, y sin alfa: la
//     transparencia era justo lo que hacia depender el resultado del fondo.
//   · 133 usos de `text-success|warning|danger` como color de TEXTO -> variante
//     `-text`. Son tokens de RELLENO: en blanco dan 2.35-3.76:1, sus `-text`
//     dan 5.4-7.1. Es la regla de N2, que nadie verificaba.
//   · etiqueta de version del sidebar: `text-white/20` = 1.83:1 -> /55 = 6.24.
//
// Zoom 200% y reflow a 320px (WCAG 1.4.4 y 1.4.10, nunca probados): 0 rutas con
// desborde horizontal. Impresion: 0 nodos bajo AA.
//
// QUEDAN 23 nodos en 4 combinaciones, todos en los temas Solid y documentados
// en el plan: 16 de un `text-danger` en un tooltip del Inicio, 6 del valor de un
// `LiquidSelect` en modo `bare` que hereda color (un intento de arreglo lo
// empeoro a 1.8:1 y se revirtio), y 1 a 4.45:1 (0.05 del minimo).

// v2.223.0 — MIN·MAX F4: el candado por sucursal existia SOLO en el cliente.
//
// F4.1 — psp_insert/psp_update usaban auth_can_edit_any(['minmax','pedidos'])
// sin mirar erp_sucursal_id: con can_edit en CUALQUIERA de los dos modulos se
// podia escribir el MIN/MAX de CUALQUIER sucursal por PostgREST. Lo unico que lo
// impedia era `lockedErpId` en el frontend.
//
// El plan hablaba del rol 12 (1 empleado). Medido en prod son 27: rol 12 (minmax
// BRANCH), rol 19 Jefe/a de Sala (pedidos BRANCH, 6) y rol 30 Dependiente de
// Farmacia (pedidos BRANCH, 20). Los dos ultimos no tienen can_edit en minmax,
// pero auth_can_edit_any es un OR sobre el array: les alcanzaba con pedidos.
//
// El scope se expresa con un helper nuevo, auth_can_edit_scope_all, y NO con
// `auth_module_scope(...) = 'ALL'`: auth_module_scope devuelve 'ALL' por defecto
// cuando el rol no tiene fila para ese modulo, asi que habria dado acceso total a
// quien solo tiene minmax BRANCH. El helper exige can_edit Y scope='ALL' en la
// MISMA fila. Todas las llamadas auth_* envueltas en (SELECT ...) — sin el
// initplan se evaluan por fila, que es el outage del 2026-07-08.
//
// Y el trigger de Bodega pasa a SECURITY DEFINER. Sin eso el scope rompia el
// guardado de esas 27 personas: escribir su propia sucursal dispara el trigger,
// el trigger escribe la fila de la sucursal 6 — que no es la de nadie — y la
// policy lo rechazaba con "new row violates row-level security policy". La fila
// de Bodega no es un dato del usuario: es una suma que mantiene el sistema.
// Probado con el empleado real de cada caso: su sucursal 1 fila, otra sucursal 0,
// Bodega a mano 0.
//
// Un detalle que aparecio probando: scope_all(['minmax']) es FALSE para el rol 12
// (su minmax es BRANCH) y su branch mapea a Bodega, asi que el guard con el array
// corto lo dejaba descartando borradores unicamente de Bodega — que ni se calcula
// ahi. El array correcto es el de las policies, ['minmax','pedidos'].
// Con ese array el guard de las RPCs es INERTE hoy (los 6 roles con can_edit en
// minmax resuelven todos a ALL); se agrega igual porque son SECURITY DEFINER y
// saltean las policies por completo.
//
// F4.2 — decided_by venia del navegador mientras published_by, en la misma tabla,
// ya se resolvia con auth.email(). Ahora las dos salen del token. El parametro
// p_decided_by se recibe e IGNORA: cambiar la firma antes de que el frontend deje
// de mandarlo rompe la aprobacion entre el deploy de BD y el de Vercel — el
// cliente deja de mandarlo en este commit y la firma se limpia despues.
// zero_out_product_all_branches deja de hardcodear VALUES (1)…(7) y lee
// erp_sucursal_map (con el hardcode, sumar una sucursal dejaba el producto
// retirado "en todas las salas" menos en la nueva, en silencio).
//
// F4.3 — la decision de ABC/XYZ documentada en CLAUDE.md: son SOLO clasificacion
// (reorder plano en 25 dias, buffers en 0, lead_time NULL en las 18,364 filas),
// no mueven ningun numero, y no hay que "arreglarlo".
//
// F4.4 — el recalculo mensual disparaba a las 15:00 UTC, en plena ventana de los
// syncs por minuto (12-23,0-5). Movido a 09:00 UTC: dentro de 06:00-11:59 y
// despues del refresh del rollup de ventas (06:30), asi arranca con las unidades
// reconciliadas.

// v2.222.0 — MIN·MAX F3: la carga baja de 932 ms a 287 ms en Bodega.
//
// F3.1 — el CTE `live_sales` de get_stock_analysis escaneaba 574,848 lineas de
// sales_invoice_items + 133,260 facturas EN CADA CARGA (983 ms de 1,085 ms
// medidos) y todo para pisar dos columnas. Ahora sale de product_sales_rollup:
// ~16 K filas, sumadas en vivo por el mismo trigger que ya mantiene
// product_last_sale y reconciliadas por un job diario a las 06:30 UTC (la cola
// de la ventana movil no la puede recortar un trigger de INSERT, y ahi tambien
// se corrigen las anulaciones y los resyncs mensuales).
//
// Medido: Salud 1 472 → 186 ms, Bodega 932 → 287 ms. Verificado fila por fila
// ANTES de tocar la funcion, como pedia el plan: 2,416 filas en Salud 1 y 3,548
// en Bodega, 0 diferencias en unidades y en velocidad de 30 dias — ni en el
// texto.
//
// Ojo con la verificacion: comparar un hash de la salida antes/despues NO sirve
// en esta tabla. inventory se sincroniza cada minuto (crecio 70 filas y entraron
// 2 facturas mientras yo media), asi que el baseline se mueve solo. Hay que
// comparar las piezas dentro de un MISMO snapshot.
//
// F3.2:
// - inventory se escaneaba dos veces por llamada (inv_base + inv_all_pres). Una
//   sola pasada. Al compararlas aparecio un no-determinismo PREEXISTENTE: el
//   `jsonb_agg(... ORDER BY factor DESC)` de `presentations` no desempata, asi
//   que cuando dos presentaciones comparten factor ("CAJA " y "CAJA X 3", ambas
//   factor 3) el orden depende del orden de lectura. 8 productos de Bodega. Las
//   unidades son identicas; es cosmetico y queda anotado.
// - El indice (erp_sucursal_id, updated_at, erp_product_id) que el comentario de
//   fetchStockParamsUpdates ya daba por hecho y no existia. El polling de Bodega
//   corre cada 5 s por pestaña: leia las 2,501 filas de la sucursal y las
//   descartaba todas por filtro. Buffers 245 → 10.
// - El bloque de Bodega de publish_stock_params reescribia ~3,385 filas por
//   publicacion cambiaran o no (prohibido por CLAUDE.md). Con el guard
//   IS DISTINCT FROM: una publicacion sin cambios reales escribe 0. Y quedo a la
//   vista que ese bloque es casi siempre redundante — el trigger de Bodega ya
//   habia escrito los mismos valores durante el UPDATE de la sucursal
//   (verificado: Bodega 101/150 → 104/153 con bodega_updated = 0).
// - Los dos RPC de costo se disparaban en CADA celda guardada (~200 ms de BD por
//   edicion, y con Enter se edita en rafaga). Debounced a 900 ms: los dos
//   calculan un total de la sucursal, solo importa el ultimo.
//
// Lo que NO se hizo de F3.2, con motivo:
// - `activo = true` en el CTE pres_factors: seria un BUG. pres_factors no es un
//   catalogo de opciones (ese es catalog_pres, y ahi el filtro si va): es la
//   tabla de CONVERSION de unidades. Filtrarla haria que una presentacion
//   desactivada con existencia caiga en COALESCE(factor,1) y una caja de 100 se
//   cuente como 1 unidad — stock subcontado en silencio. Medido: de 23,675 filas
//   de inventario, 0 perderian factor hoy, o sea que no arregla nada y deja la
//   trampa armada.
// - No devolver las filas is_catalog_only: el cliente NO las descarta siempre
//   (useMinMaxData:825 las muestra con el filtro "no_data" y al buscar), asi que
//   excluirlas obliga a re-consultar al filtrar o al teclear una busqueda. No
//   vale cambiar una busqueda instantanea por 1.5 MB menos en la primera carga.


// v2.221.0 — MIN·MAX: el par invalido ya no llega al publish (F1 del
// PLAN-MINMAX-Y-CANDADO), y el candado tapa su ultimo agujero (cierre de F0).
//
// F0 (cierre): calculate_stock_params era la unica de las 23 RPCs que exime a
// service_role, porque la llama el cron auto-calculate-minmax el dia 1. Con el
// modulo en mantenimiento, ese recalculo reescribia el catalogo entero por
// debajo de quien estaba trabajando. Ahora chequea el candado ANTES de todo y
// aplica tambien a service_role: para el cron devuelve
// { skipped:true, reason:'module_locked' } — el contrato que la edge function ya
// sabe registrar como sucursal SALTADA — y para una persona lanza MODULE_LOCKED
// con el nombre del titular, en vez del PERMISSION_DENIED generico que mentia
// ("se requiere permiso de edicion" cuando el permiso existe).
//
// F1.1: ArrowLeft desde MAX era el UNICO de los 5 caminos de guardado sin
// validacion, y como hay preventDefault() nunca mueve el cursor dentro del
// numero: siempre salta de celda y guarda. Ahora valida como sus hermanos.
//
// F1.2: la defensa en los 3 lugares donde se escribe el par.
// - psp_draft_pair_valid reemplaza a psp_draft_max_gte_min (que dejaba pasar
//   max = min). El plan decia "hoy 0 filas lo violarian": eran 4 (residuo de
//   borrador descartado en Salud 1), anuladas aca.
// - El trigger de Bodega clampeaba el MIN hacia arriba pero no el MAX: si la Σ
//   de MAX quedaba <= la Σ de MIN, el UPSERT violaba el CHECK y abortaba la
//   escritura DE LA SUCURSAL que lo disparo.
// - publish_stock_params derivaba MIN y MAX con dos reglas incompatibles (una
//   bajaba el MIN, la otra subia el MAX). Con (12,12) daba (12,12) y ABORTABA EL
//   LOTE ENTERO. Ahora un solo CTE ordena el par y lo separa. Verificado sobre
//   los 81 pares posibles: identico en los 61 que hoy dan resultado valido,
//   distinto solo en los 20 que hoy se caen.
//
// F1.3: mmcr_pair_valid alinea las solicitudes con el invariante real (antes
// (0,5) pasaba la constraint de la solicitud y explotaba al aprobarla), y
// approve_minmax_requests_bulk deja de meter las violaciones de constraint en
// skipped_not_found — la UI las traducia como "ya decidida por otra persona",
// o sea una carrera entre aprobadores, cuando era una solicitud inaplicable.
//
// F1.4: translateDbError pasa a helpers.js (lo usan dos vistas) y cubre los 7
// toasts de guardado que mostraban el texto crudo de Postgres.
//
// Y las 3 filas de La Popular con MAX sin MIN (ACIDO BORICO, LEVUSOL, TEGADERM):
// nunca publicadas, 0 ventas en 6 meses, MAX tecleado a mano el 18-jun con el
// MIN vacio porque la UI guarda celda por celda. Su par efectivo se lee (0,3) y
// habria hecho fallar "descartar borrador". MIN=1 por decision de Alex, que es
// el mismo min-lift que ya aplican el publish y el trigger.

// v2.220.0 — el arreglo del select, cerrado como canonico de verdad.
//
// v2.219.0 lo arreglo en 35 sitios, pero eso no era "canonico": nada impedia
// que volviera y DESIGN.md no lo decia. Ahora:
//
// - Regla `select-con-envoltorio` en el gate, en CERO y bloqueante. Detecta por
//   la FORMA (div con alto fijo que contiene un LiquidSelect), no por la clase.
//   **Encontro 11 sitios mas que mi grep manual no vio** — entre ellos el
//   canonico `CatalogSelect`, `RolesView` con h-[44px] y `BranchTabLegal` con
//   h-[42px]. Ninguno tenia la cadena que yo habia buscado.
// - DESIGN.md §15.13 con los numeros medidos y el contraejemplo.
//
// Y un error propio que vale registrar: el script de migracion desenvolvia por
// la clase del div sin mirar el contenido, y se llevo 3 `LiquidDatePicker` —
// ese SI necesita envoltorio porque usa `h-full` (toma la altura del padre) y
// sin el se colapsa. No lo detecto el gate (su regla exige LiquidSelect
// adentro, correctamente): lo detecto leer el diff. Revertido y rehecho.


// v2.218.0 — candado de mantenimiento por modulo (ver commit cb497d40).

// v2.219.0 — el select se veia cortado dentro de una caja que no era la suya.
//
// 35 sitios en 5 formularios envolvian LiquidSelect en un
// `<div className={`rounded-2xl h-[40px] ${inputHoverClass}`}>` para pintarle
// borde y estado de error. Pero LiquidSelect YA se pinta entero: lleva
// `data-surface="input"` (fondo, borde, radio, sombra) y `min-h-[max(40px,
// var(--tap-min))]`. Medido en el navegador:
//
//   envoltorio  40px de alto · radio 10px · fondo rojo 10% (estado error)
//   select      46px de alto · radio  8px · fondo blanco opaco
//
// El control es 6px mas alto que su caja y con otro radio, asi que el fondo del
// envoltorio asomaba alrededor — eso es el "recorte" que se ve en la captura.
// Y el `hover:border-brand/40` del envoltorio pintaba color sobre un borde de
// ancho cero: nunca se vio.
//
// Arreglo: prop `invalid` en el canonico, que pinta el error CON OUTLINE sobre
// el mismo elemento (border/bg pierden contra data-surface por cascade layers,
// igual que el foco — ver inputStyles.js) y agrega `aria-invalid`. Fuera los 35
// envoltorios. El foco/apertura gana sobre el error: mientras se elige manda el
// anillo azul, el rojo vuelve al cerrar si sigue vacio.
//
// Verificado en navegador: 0 envoltorios en pantalla, alturas 46/39/25 (normal,
// compact, nano) y el contorno rojo siguiendo la forma del control, tanto en el
// modal de conteo como en Nuevo Empleado.


// v2.217.0 — rotado ADMIN_INVOKE_SECRET, la credencial que quedo en claro.
//
// Contexto (PLAN-SUPABASE-CIERRE.md, hallazgo lateral de C2): el secreto de
// invocacion de crons vive en texto plano dentro de 7 migraciones viejas en
// supabase_migrations.schema_migrations. La migracion 0B.2 lo movio a Vault,
// pero MOVER UN SECRETO A VAULT NO LO ROTA — el valor seguia siendo el mismo.
// Es la credencial que 13 edge functions validan como Authorization: Bearer y
// que ~25 cron.job.command leen de Vault.
//
// Rotado a 96 caracteres (openssl rand -hex 48), aplicado a los dos lados con
// el mismo valor: `supabase secrets set` (lo que validan las funciones) y
// `vault.update_secret` (lo que mandan los crons).
//
// El valor nuevo NUNCA paso por el contexto del agente ni quedo en el
// transcript: vivio solo en una variable de shell, y los comandos llevan la
// referencia a la variable, no el valor. Rotar un secreto imprimiendolo en un
// log seria cambiar una exposicion por otra.
//
// update_secret se llamo con 2 argumentos a proposito: su cuerpo usa
// coalesce(new_name, s.name) y coalesce(new_description, s.description), asi
// que nombre y descripcion se preservan — verificado leyendo la definicion
// antes de tocar produccion, no asumido.
//
// Verificacion medida: las 14 respuestas HTTP posteriores a la rotacion fueron
// 200, CERO 401 — no hubo ni ventana de fallo, las funciones tomaron el valor
// nuevo de inmediato. Y no solo respondieron: 6 corridas de dte y 8 de
// inventory posteriores escribieron datos con success=true.
//
// Rollback: el valor viejo quedo respaldado dentro de Vault como
// `admin_invoke_secret_prev_20260729`, copiado de decrypted_secrets sin salir
// nunca de la BD. BORRARLO tras un dia sin incidentes.
//
// Lo que sigue en claro en schema_migrations es el valor VIEJO, que ya no
// autoriza nada. CRON_INVOKE_SECRET no se roto y no hace falta: se creo
// justamente para no heredar esta exposicion.

// v2.216.0 — los 6 crons horarios de DTE, consolidados en uno.
//
// Continuacion de v2.209.0, que consolido los 13 de cada minuto. Quedaban 6
// compartiendo el horario EXACTO '0 12-23,0-5 * * *' — y encima caen en el
// minuto :00, el mismo en que dispara el consolidado de cada minuto, asi que el
// pico real al tope de cada hora era ~10 conexiones simultaneas.
//
// Los 6 llaman a la MISMA edge function (sync-dte-sales) con el MISMO rango
// —del 1 del mes hasta ayer, que es el resync de arrastre— y solo cambia
// branchId (2, 4, 25, 27, 28, 29). Se consolidan igual: net.http_post es
// asincrono, asi que los 6 encolados salen en una sesion con UNA conexion.
// Payloads verificados identicos a los originales antes de aplicar.
//
// Colisiones restantes: solo las 6 mensuales (1 vez al mes, dia 1) y 2 cada
// 10 min. El pico al tope de hora bajo de ~10 a ~4.
//
// v2.215.0 — (ver entrada anterior)

// v2.214.0 — el portal tardaba 5 SEGUNDOS en hacer su primera peticion.
//
// En cada carga de pagina, para todos los usuarios. La UI se pintaba a los
// 324 ms y la primera llamada a Supabase salia a los **5,145 ms**. Todo lo que
// la app pedia en el medio quedaba encolado.
//
// **Causa: el callback de `onAuthStateChange` llamaba a supabase.** auth-js
// espera a que cada suscriptor termine antes de dar por inicializado el
// cliente, y toda llamada a supabase espera esa inicializacion — pedir algo
// desde adentro del callback es un bloqueo mutuo consigo mismo. Medido:
//   139 ms  SIGNED_IN -> el callback invoca ensure_user_by_code -> se cuelga
//  5139 ms  salta el timeout de 5000 ms de withTimeout -> se destraba
//  5145 ms  INITIAL_SESSION -> recien ahora sale TODA la red encolada
// Los 5,000 ms exactos entre un evento y otro eran la firma del timeout.
//
// El arreglo: el callback queda SINCRONO y el trabajo async se dispara con
// setTimeout(0) sin await, para que retorne de inmediato.
//
//   primera peticion   5,145 ms -> **150 ms**   (34x)
//   sorteo del ciclico  ~5,000 ms -> **785 ms**
//   login 2.1 s · permisos OK · 0 errores JS
//
// Seis hipotesis descartadas antes con medicion, y vale anotarlas porque cada
// una parecia la buena: la base (35 ms), CPU (sin long tasks), la carrera de
// Web Locks (0-3 ms), el service worker (identico con y sin, en navegador
// real), `validateSession()` (se quito y no cambio), y varios clientes de
// supabase (hay uno solo). El A/B del service worker daba 152 ms sin el —
// pero solo en headless: en navegador real era igual de lento.


// v2.213.0 — el backup semanal llevaba 17 dias sin correr, en silencio.
//
// Lo encontro la alerta que se acababa de arreglar en v2.211.0: backup_sync_log
// tenia 0 filas. No era ruido, era cierto.
//
// Causa: `backup-critical-tables` quedo con verify_jwt=true. Su cron le manda
// el secreto de Vault como Bearer, que NO es un JWT, asi que la plataforma lo
// rechazaba con 401 ANTES de ejecutar una linea de la funcion — y la funcion ya
// tiene su propio control de acceso adentro (compara contra ADMIN_INVOKE_SECRET),
// que nunca llegaba a correr. Es exactamente la trampa documentada en la memoria
// reference_edge_function_deploy_workaround: un redeploy sin repetir
// --no-verify-jwt resetea el flag al default de Supabase.
//
// Timeline reconstruido:
//   2026-07-12  ultimo backup exitoso (carpeta en el bucket, 28 archivos)
//   2026-07-16 17:09 UTC  redeploy de la funcion sin el flag → verify_jwt=true
//   2026-07-19 y 07-26    domingos sin backup, sin aviso
//   2026-07-29  redeploy con --no-verify-jwt + corrida manual de verificacion
//
// Verificado de punta a punta, no solo desplegado: se disparo con el mismo
// mecanismo del cron (net.http_post leyendo el secreto de Vault dentro de la BD)
// y devolvio HTTP 200 con success=true, tables_ok=23, tables_failed=0,
// total_kb=1317, y 23 archivos nuevos en el bucket privado `backups`.
//
// Se reviso si habia mas victimas del mismo dia cruzando los 29 crons que
// invocan edge functions contra su verify_jwt. `auto-copy-weekly-roster` salio
// como candidato (verify_jwt=true + cron con secreto), pero NO esta roto: ese
// cron manda la anon key como Authorization —un JWT valido— y valida el secreto
// aparte en el header x-cron-secret. Los horarios se siguen copiando cada
// sabado, confirmado en employee_rosters. backup-critical-tables era el unico.
//
// Sin cambio de codigo: la funcion estaba bien, lo que estaba mal era el flag
// del deploy. Por eso el arreglo no aparece en el diff.

// v2.212.0 — auditoria CON LOS MODALES ABIERTOS: seis capas que no eran dialogos.
//
// Al confirmar el cierre anterior quedo claro que todo lo medido hasta ahi era
// lo que se renderiza al CARGAR una ruta. El bug de contraste de `Button` ya
// habia mostrado el hueco: el escaner vio 2 de 82 usos porque los otros 80
// viven en modales cerrados. Esta pasada los abre — 26 modales en escritorio y
// 14 capas en movil, con guardia de red que aborta toda escritura a Supabase
// para que ningun clic pueda tocar datos de produccion (81 abortadas).
//
// SEIS CAPAS SE MONTABAN A MANO Y NINGUNA ERA UN DIALOGO. Tres ya se habian
// corregido en v2.204.0; faltaban tres, y la peor es la mas usada:
//
//   · `ConfirmModal` — el dialogo que pregunta antes de BORRAR. Sin
//     `role="dialog"`, sin `aria-modal` y **sin Escape**: una confirmacion de
//     borrado que solo se podia cancelar con el mouse. Ademas su boton de
//     confirmar era `text-white` sobre `bg-danger` (3.76:1, AA pide 4.5).
//     Componerlo sobre `ModalShell` + `Button` arregla los tres de una vez.
//   · La hoja de filtros de `ViewTabBar` — en 28 vistas.
//   · La hoja de fecha de `LiquidDatePicker`.
//
// `ModalShell` gana `align="bottom"` para las hojas tactiles (entran
// deslizando, llegan a los bordes). El gate atrapo un import faltante de
// `ModalShell` que el build NO detecta y habria reventado en runtime.
//
// TRES CANONICOS TENIAN LA ALTURA ESCRITA A MANO y quedaban bajo el piso del
// dedo en tactil: `SegmentedControl` (h-7/h-9), `LiquidSelect` (40px) y
// `PortalInput` (40px). Ahora `max(<diseno>, var(--tap-min))`, que es 0 en
// escritorio: no cambia nada ahi. Las variantes densas se quedan a proposito.
//
// Y el gate `relleno-sin-solid` tuvo que endurecerse dos veces: no veia los
// `className` con ternario (por eso `ConfirmModal` se le escapo), y al
// arreglarlo empezo a cruzar las dos ramas del ternario entre si. Ahora evalua
// «lo literal + UNA rama», que es lo que se renderiza de verdad. Probado con
// fixture: 1 hallazgo real, 4 patrones correctos que pasan.
//
// Un hallazgo que NO era: el <input> de `PortalInput` medido en 42px con su
// contenedor en 44. No se resolvio bajando el umbral sino con una prueba de
// impacto — `elementFromPoint` sobre el borde devuelve el propio input, o sea
// que los 44px son zona viva. El target es el CONTROL, no su elemento interno.
//
// Verificado: gate:design 0/25 · eslint y build limpios · contraste 29/29
// rutas en 0 · 892 controles tactiles medidos, 7 bajo 44 (las barras del
// grafico) · dentro de los modales: 1,427 nodos de texto y 234 controles, 0 y 0.

// v2.211.0 — dte e inventario entran a las alertas de sync, y se apaga una
// falsa alarma diaria que llevaba dos semanas.
//
// Contexto: al revisar si algo avisaba cuando un sync se caia, la respuesta era
// NO para los 13 syncs por minuto. check-sync-health-alerts los excluia a
// proposito "porque ya tenian lo suyo", pero eso no se sostiene:
//   - dte tenia check-sales-alerts, que alerta de NEGOCIO (ventas sin confirmar
//     por Hacienda). Si el sync deja de correr no entran ventas, no hay nada
//     pendiente que detectar, y la alerta se queda MUDA.
//   - inventory tenia useSyncMonitor, un toast del navegador: solo salta si
//     alguien tiene el portal abierto, no queda registrado, y necesita una fila
//     con success=false.
// El modo de falla real — el cron no consigue conexion y la funcion NUNCA se
// ejecuta — no escribe ninguna fila, asi que no disparaba nada. Paso 375 veces
// en dos semanas sin que nadie se enterara.
//
// Lo aplicado en check-sync-health-alerts:
// - dte e inventory con umbral de 15 min, medido en minutos ACTIVOS. Sus crons
//   duermen 06:00-11:59 UTC (verificado: esas horas tienen CERO filas en
//   v_sync_health, el resto ~480/hora), asi que con reloj de pared habrian
//   marcado 6h de antiguedad a las 12:00 y gritado en falso cada mañana.
//   activeMinutesBetween() descuenta ese hueco: probado con 6 casos, la
//   reanudacion de las 12:00 da 1 minuto activo (no alerta) y un caido real de
//   20 min da 20 (alerta).
// - Los fallos de dte/inventory vienen en RAFAGAS (en 24h: los 47 de dte en 1
//   sola hora, los 72 de inventory en 2; 0.7% y 0.85% de las corridas), y un
//   blip suelto se cura al minuto siguiente. Se exigen 2 fallos seguidos.
//
// BUG PREEXISTENTE ARREGLADO de paso: la funcion pedia las ultimas 1000 filas
// de TODOS los dominios juntos, y los ruidosos ahogaban a los tranquilos. Las 7
// filas de minmax (ultima: 17-jul) caian fuera del corte y el bloque de "ningun
// registro" concluia "minmax nunca ha corrido" — una falsa alarma DIARIA desde
// el 16-jul (12 de minmax y 14 de backup en sync_alert_log). Ahora es una
// consulta por dominio. Verificado en la corrida de las 16:40: alerts=1, no 2.
//
// Queda una alerta legitima: backup_sync_log tiene 0 filas desde siempre. El
// cron backup-critical-tables-weekly corre los domingos y reporta "succeeded"
// (solo encola el HTTP), pero la funcion tiene verify_jwt=true y el cron manda
// el secreto como Bearer, no un JWT — el mismo 401 que ya mordio a
// auto-calculate-minmax. Sin tocar: arreglarlo hace que empiecen a correr
// backups reales, y eso es decision del usuario.
//
// v2.210.0 — el modal solo ofrece sucursales con inventario.
//
// Administracion aparecia en la lista y no tiene inventario: elegirla llevaba a
// que crear_conteo_inventario reventara con SUCURSAL_SIN_MAPEO_ERP. El filtro
// va por el mapeo al ERP (erp_sucursal_map) y no por el `type` de la sucursal,
// que es exactamente el criterio que exige la RPC — filtrar por otra cosa
// dejaria opciones que revientan al elegirlas. Quedan las 7 con inventario.
//
// Medido de paso, buscando por que el sorteo tardaba ~5s:
//   · seleccionar/preview_muestra_ciclica en BD: **35 ms** (EXPLAIN ANALYZE)
//   · ida y vuelta HTTP: ~230 ms
//   · abrir el modal + elegir sucursal: solo 2 peticiones
// El sorteo NO es lento. Lo lento es que el portal entero se re-arranca solo:
// 24 peticiones en 8 segundos con la pestana QUIETA, incluida
// `ensure_user_by_code` (la edge function de auth) repetida. El preview salia
// dentro de esa rafaga y esperaba detras. Es un problema del arranque global,
// no del conteo — anotado, sin tocar.


// v2.209.0 — los dos hallazgos laterales de C4, corregidos y medidos.
//
// 1. SLOTS DE CONEXION. Los 13 crons de sync por minuto compartian el horario
// EXACTO '* 12-23,0-5 * * *', sin desfase, y cron.max_running_jobs=32, asi que
// pg_cron los lanzaba a los 13 a la vez — cada job es un background worker con
// su propia conexion. Con max_connections=60 y 52 ya en uso (42 IDLE: Storage
// API retiene 15, PostgREST 13), los ~8 libres se agotaban y el que llegaba
// tarde recibia "FATAL: remaining connection slots are reserved...". Esa era la
// causa medida de los 375 fallos de cron.
// Los 13 llamaban a la MISMA edge function, solo cambiaba el body, asi que se
// consolidaron en un job que hace los 13 net.http_post en una sesion. Funciona
// porque net.http_post es asincrono: encola en net.http_request_queue y retorna,
// y el worker de pg_net hace el HTTP. Medido: succeeded, 13 rows en 53 ms, UNA
// conexion. La frecuencia no cambio.
// Conexiones libres 8 → 18; crons fallando en una ventana de 15 min: 0.
//
// 2. COLLATION VERSION MISMATCH. datcollversion 153.120 contra glibc real
// 153.121 — Supabase actualizo la imagen base y con ella glibc. Emitia un
// WARNING en CADA conexion nueva (log inservible) y dejaba en duda el orden de
// los indices de texto: si el salto cambio el orden de alguna cadena, un indice
// puede devolver resultados INCOMPLETOS en comparaciones de rango, sin error.
// Corregido en tres pasos, en este orden — invertirlo apaga el aviso sin
// arreglar nada: REINDEX CONCURRENTLY de los 71 indices colacionables (151 MB
// en 37 tablas) → verificar que ninguno quedo invalido (un CONCURRENTLY
// interrumpido deja un indice que Postgres deja de usar EN SILENCIO) → ALTER
// DATABASE REFRESH COLLATION VERSION. Los tres trigram _norm de sales_invoices
// se dejaron para el final.
// Medido: 153.121 = 153.121, 0 indices invalidos de 71, y la busqueda de
// facturas sigue sobre el trigram reconstruido (84 ms en caliente).
//
// Sigue pendiente y NO es de codigo: los pools idle de Storage/PostgREST son
// internos de Supabase; se atacan con Supavisor en modo transaccion (dashboard).
//
// v2.208.0 — el modal de nuevo conteo estaba aplastado a un cuarto de su ancho.
//
// El SegmentedControl del alcance iba envuelto en un `md:grid-cols-2`. Pero en
// `layout="block"` ese control YA arma su propia grilla: el wrapper lo metia en
// media pantalla y el adentro partia esa mitad en dos, asi que cada pildora
// terminaba con ~25% del ancho del modal y el texto en TRES lineas sobre una
// pildora de alto fijo (h-11). Se ve en la captura del usuario.
//
// - Fuera el wrapper. Las 5 pildoras quedan de 269x44 uniformes, una linea cada
//   una (medido en Chromium contra el build de produccion).
// - Etiquetas de una linea: van en text-caption uppercase con tracking-widest,
//   que ensancha mucho — "Solo Bajo Receta (antibioticos)" no cabia ni cerca.
//   El parentesis explicativo se movio al aviso.
// - El aviso azul eran cuatro renglones en negrita. Queda la regla en el Notice
//   y la letra chica debajo en tono normal, que es lo que la hace legible.
// - La vista previa ya no es una isla dentro de otra isla (doble borde, doble
//   radio): recuadro liviano.
// - Los badges salian en el orden de claves del JSON del servidor ("B, C, Bajo
//   Receta, A"). Ahora en el orden en que se sortean.
// - El estado de carga vive en la MISMA caja que despues muestra los datos, asi
//   el modal no salta a los ~5s que tarda el sorteo. Con texto y no con
//   SkeletonText: medido acá, sus barras no contrastan contra
//   `surface-card-hover` y la caja se leia vacia.
//
// Verificado con Playwright contra `vite preview`: capturas de los tres estados
// y medicion de las pildoras.


// v2.207.0 — se recuperaron los JSON originales que se creian perdidos.
//
// Hasta Fase 3.1 (2026-07-22) el sync guardaba solo el JSON normalizado
// (unwrapDteEnvelope + repairMojibakeDeep), descartando los bytes crudos del
// adjunto — y con ellos el sobre de Hacienda (selloRecibido + firmaElectronica)
// cuando el proveedor lo mandaba. La auditoria lo dio por NO backfilleable
// ("los bytes originales solo viven en Gmail"). Era falso: viven en Gmail, si,
// pero cada documento conserva su `source_message_id`, asi que se pueden
// volver a pedir.
//
// Nuevo modo `backfill_orig_json`. Resultado sobre los 1,169 pendientes:
// **1,336 de 1,343 documentos con original = 99.5% de cobertura**, cero
// errores. Los 7 que faltan son todos de Movistar, que manda el DTE como LINK
// y no como adjunto — no hay adjunto que recuperar, y el modo los cuenta
// aparte (`sinAdjunto`) en vez de tratarlos como falla.
//
// Verificado antes de correr los 1,169: muestra de 8, y los originales pesan
// consistentemente MAS que el normalizado (de 3 a 1,066 bytes) — o sea que son
// archivos genuinamente distintos y no una copia; los de +800 bytes son los que
// traen el sobre. Se compara `codigoGeneracion` del adjunto contra el del
// documento antes de guardar, asi que un correo con varios DTE no cruza
// archivos.
//
// Cursor `after_id` obligatorio (no filtrar por "sigue en NULL"): los 7 de
// Movistar fallan SIEMPRE, y sin cursor se quedan en la cabeza de la cola y el
// backfill no converge nunca. Es el mismo bug de E6 y H7, que ya mordio dos
// veces en este archivo.
//
// Costo: +17 MB de storage (339 -> 356 MB). El bucket sigue en 0.36% de los
// 100 GB que incluye el plan Pro — verificado contra la documentacion, no de
// memoria. El limite real del proyecto no es el storage sino la BASE (8 GB
// incluidos por proyecto, hoy ~1 GB).
//
// Ademas: se quito la columna "Tipo" (regimen fiscal) de la tabla de
// Proveedores. Mostraba el MISMO badge "Contribuyente IVA" en los 99 —
// verificado, 99 de 99 tienen NRC—, o sea informacion cero por 175px en una
// tabla que ya desbordaba. Segunda columna que sale por lo mismo, despues de
// Giro en v2.27.4; el dato sigue en el detalle, donde ademas explica la
// consecuencia fiscal. La tabla paso de 1,288px a 1,113px contra 1,044
// disponibles: practicamente entra, y son 163px MENOS que al empezar la
// sesion, habiendo sumado una columna de seleccion y el ordenamiento.

// v2.206.0 — el aviso del recalculo mensual ya no miente cuando no calculo nada.
//
// calculate_stock_params devuelve { ok:false, skipped:true, reason } cuando se
// salta una sucursal. auto-calculate-minmax lo trataba como exito con rows=0,
// asi que el push a los supervisores decia "Recalculo mensual completado.
// 0 productos actualizados automaticamente. No hay borradores pendientes."
// — exactamente lo contrario de lo que habia pasado. Por eso el recalculo
// llevaba desde junio sin correr en las 6 sucursales sin que nadie se enterara.
//
// Ahora:
// - Las saltadas se cuentan aparte de las calculadas y el mensaje las NOMBRA
//   con su motivo ("La Popular (tiene borradores pendientes de revisar)").
// - Si no se calculo NINGUNA: "NO se recalculo ninguna sucursal… El MIN/MAX
//   quedo igual que el mes pasado", con push urgente y anuncio en HIGH — igual
//   que un error, porque el efecto es el mismo.
// - En minmax_sync_log una saltada va con success=false y "SALTADA: motivo":
//   desde "se recalculo esta sucursal?", saltada es un no, y asi la ve
//   cualquier consulta al log.
// - El resumen dice siempre cuantas de cuantas se calcularon.
//
// Desplegada con --no-verify-jwt (esta funcion se autentica con su propio
// secreto como Bearer, no con un JWT; sin el flag el redeploy la resetea a
// verify_jwt=true y su cron empieza a fallar con 401).


// v2.205.0 — C3 y C4 del plan de cierre Supabase: 11 funciones SECURITY DEFINER
// dejaron de saltarse el RLS, y el 18% de rollbacks resulto ser historico.
//
// C3 — De las 69 funciones SECURITY DEFINER que `authenticated` podia llamar,
// 24 no tenian ningun gate `auth_*`. Clasificadas una por una:
//   * 8 RPCs de pedidos → pasadas a SECURITY INVOKER. La policy de `pedidos`
//     exige modulo `pedidos.can_view` + scope de sucursal, y estas la saltaban
//     entera. Probado en prod dentro de BEGIN..ROLLBACK con un empleado real
//     (Regente de Enfermeria, SIN permiso de pedidos): get_pedidos_en_curso()
//     devolvia 46 filas y get_pausa_razones_stats() 7 — ahora 0 y 0. Con
//     permiso: Bodega (ALL) 46 y sucursal (BRANCH) 8, que es el scoping
//     funcionando. Afecta a 26 empleados con scope=BRANCH, que pasan a ver
//     solo su sucursal; los 12 con ALL no cambian.
//   * 3 revocadas de authenticated (solo cron/edge las llaman):
//     notify_missing_roster, upsert_proveedor_from_dte, validate_role_headcount.
//   * BUG encontrado de paso: notify_missing_roster filtraba empleados por
//     status='ACTIVE', valor que no existe en la tabla (los 50 son 'ACTIVO'),
//     asi que el aviso de horario sin configurar iba a target_type='ALL' — a
//     toda la empresa — en vez de solo a Talento Humano.
//   * Las 13 que quedan sin gate estan justificadas: 5 del kiosco (validan
//     device_token), 3 triggers (Postgres no deja invocarlos directo) y 5 que
//     solo leen tablas con policy USING(true), asi que no saltan nada.
//   Resultado medido: definer-para-authenticated 69 → 58; sin gate 24 → 13.
//
// C4 — El "18% de rollbacks" no es un problema activo. La tasa actual es
// 3 rollbacks / 1,941 commits = 0.15%. El 17.4% es acumulado de toda la vida
// del cluster (stats_reset nunca se corrio) y esta dominado por incidentes ya
// cerrados, como el outage del 2026-07-08. Los crons tampoco son la causa:
// 375 fallos sobre 108,895 corridas = 0.34%.
//
// v2.204.0 — cierre del sistema de diseno: los 4 residuos, y uno que nadie
// habia visto.
//
// F0 — 223 animaciones que no existian. `animate-in fade-in zoom-in-95` esta
// escrito en 73 archivos, incluidos los canonicos `ModalShell` y
// `LiquidModal`, y compilaba a CERO CSS: son clases del plugin
// `tailwindcss-animate` (Tailwind v3), que nunca estuvo instalado. Todo modal,
// dropdown y panel del portal aparecia de golpe — justo lo que D2.4 declara
// movimiento FUNCIONAL que se queda. Verificado contra el bundle, que es la
// unica prueba valida: `duration-500` y `animate-pulse` existian, `animate-in`
// daba 0. Resuelto con `tw-animate-css` (sucesor para v4, mismo API): no hubo
// que tocar un solo JSX y la duracion sale del `duration-*` ya escrito al lado.
// Atado a los dos gates de movimiento — en Solid 130ms lineales, y con
// prefers-reduced-motion se anulan las variables de geometria y queda el fade.
// Medido en /ventas: liquid 105 animaciones, solid 12, con `reduce` 0 y 0.
//
// F1 — `MenuSearchModal`, `PromptModal` y `PhotoEditorModal` montaban su propio
// portal: sin `role="dialog"`, sin `aria-modal` y dos sin cierre con Escape.
// Para un lector de pantalla no eran dialogos. Pasan a `ModalShell`, al que le
// faltaban cuatro cosas que se le agregaron a EL y no inline: `align="top"`,
// `closeOnBackdrop`, `surface`/`panelClassName` y la animacion de SALIDA (sin
// ella, migrar los dos que si la tenian habria sido una regresion).
//
// F2 — el contrato "Solid no tiene vidrio" solo se cumplia donde el autor
// combinaba `bg-surface-*` con `backdrop-blur` en la misma clase: 66 apagados,
// 82 siguiendo con blur. Se invierte — se apaga por defecto y la excepcion es
// explicita (`data-bespoke-glass` en el sidebar). Login y kiosco no la
// necesitan: uno quita `data-theme` y el otro fuerza `dark`. Medido en el
// navegador: 0 elementos con backdrop-filter vivo fuera del sidebar.
//
// F3 — `input-a-mano` pasa de ratchet a excepcion nombrada y el baseline del
// gate queda VACIO: las 25 categorias bloqueantes en cero. De paso aparecio que
// `EXCEPTIONS` tenia 4 claves repetidas — un objeto literal deja que la segunda
// pise a la primera en silencio, o sea 4 excepciones que no se aplicaban. Lo
// vigila `assertSinClavesDuplicadas`.
//
// F4 — "la densidad no comprime filas" estaba mal enunciado: comprime, salvo
// donde la celda apila dos o tres datos, y ahi no puede (el `height` de un
// `<td>` es un minimo por spec). Dos causas reales: interlineado de lectura en
// modo denso, y 5 `<td>` a mano dentro de un `<DataRow>` que traian su propio
// `py-3`. /ventas 52→42px, /pedidos 71→41px. Categoria nueva `celda-a-mano`.
//
// F5 — de "224 targets tacticos sin clasificar" a **989 controles medidos y 7
// con motivo**. La mayoria no eran targets: 50 chevrons `aria-hidden` que
// duplican una fila ya clicable, 26 inputs `sr-only` cuyo target es su etiqueta
// visible, y botones de 44px declarados que el rect reportaba en 42 por un
// `scale` de ancestro. Deuda real corregida en `SegmentedControl`,
// `LiquidSelect` y `PeriodStepper` — los tres canonicos, asi que vale para todo
// el portal. Los 7 restantes son las barras del grafico: ahi el ancho ES el
// dato (WCAG 2.5.5 tiene excepcion para presentacion esencial).
//
// Y lo que encontro la auditoria final: `Button.TONE_CLASSES` usaba
// `bg-chart-N` CRUDO con texto blanco para las seis tonalidades de grafico
// (4.23:1 contra el 4.5 que pide AA), y `SegmentedControl` estaba migrado a
// medias. 82 usos de `tone="chart-N"` renderizaban blanco bajo AA. Los tokens
// `-solid` de N2 existian desde hace semanas; los canonicos no los usaban.
// Gate nuevo `relleno-sin-solid`, que evalua el par POR VARIANTE (el primer
// intento miraba la cadena entera y dio 15 falsos positivos).
//
// Cierre verificado: gate:design 0 en 25 categorias · gate:doc limpio · eslint
// limpio · escaner de contraste de D1 en las 29 rutas: 0 superficies blancas y
// 0 nodos bajo AA.

// v2.203.0 — ocultar en MIN/MAX dejaba la sucursal sin recalcular desde junio.
//
// El recalculo mensual no corre desde el 14-jun en NINGUNA sucursal, y la causa
// es una cadena de tres piezas que por separado se ven razonables:
//
//   1. Ocultar un producto escribia draft_min=0, draft_max=0, status='pending'
//      — la propuesta de dejarlo en cero.
//   2. Esa propuesta era INALCANZABLE: la tabla no lista ocultos y el contador
//      de borradores los saltea a proposito (useMinMaxData.js:298), asi que
//      nadie podia verla ni publicarla. Tampoco la limpia calculate_stock_params:
//      su upsert lleva `WHERE is_hidden IS NOT TRUE`.
//   3. calculate_stock_params se salta la sucursal ENTERA ante un solo
//      'pending', y esa guarda NO excluia los ocultos.
//
// Resultado: 32 pendientes invisibles e inlimpiables (11 en La Popular, todas
// ocultas, cero visibles) bloqueando las 6 sucursales para siempre. Eran
// servicios y no-inventario ocultados el 17-jul: APLICACION DE INYECCION,
// SERVICIO A DOMICILIO, COMISIONES POR CORRESPONSAL, DIETAS COFARSAL, AQUA ECO.
// Los updated_at coinciden exactamente con los MINMAX_HIDE de ese dia.
//
// Arreglo, por decision del usuario: **un producto oculto va en -/- publicado**,
// no en un borrador de 0/0. Ocultar (individual y masivo) ahora escribe
// min/max NULL y draft_status 'none'. Se normalizaron las 41 filas ocultas que
// arrastraban valores — incluidas 3 con cantidades reales (PRUEBA DE EMBARAZO
// ADVIN 21/34, DOLO ESPASMON 8/13, ELECTROLIT JAMAICA 6/17): un producto que se
// decidio no gestionar no deberia seguir pesando en el pedido sugerido.
// La guarda tambien ignora ocultos, como defensa.
//
// Verificado: 0 pendientes en las 6 sucursales. El 1 de agosto ya calcula.


// v2.202.0 — cierre de los pendientes chicos de la auditoria DTE.
//
// H15 — "(sin match ERP)" vivia como una opcion DENTRO del select de Categoria,
// y para que funcionara hacia falta un segundo filtrado aparte. No es una
// categoria, y metida ahi no se podia combinar con una categoria real. Ahora
// es su propia seccion del FilterBar (Con / Sin match) y el doble filtrado
// desaparece. Medido: "sin match" da 46, que es el numero exacto de la BD, y
// combinarlo con "Mercaderia para reventa" da 3 — antes era imposible.
//
// H16 — la tabla no ordenaba por ninguna columna: orden alfabetico fijo, contra
// el estandar del proyecto, y justo en las dos columnas donde mas importa
// (cuantos documentos trae cada proveedor y hace cuanto que no le compramos).
// Ordenable por Proveedor / Categoria / Docs / Ultima compra, con desempate
// estable por nombre — sin eso, dos proveedores con el mismo docs_count
// bailaban de lugar entre renders.
//
// H13 — `get_purchase_dte_documents` YA devuelve `invalidacion_source` en cada
// fila, pero el visor lo volvia a pedir al servidor cada vez que se abria el
// modal. El RPC queda de respaldo para cuando el modal se abre sin pasar por
// la lista.
//
// Ancho de la tabla: seguia el hallazgo de que YA desbordaba antes de todo esto
// (1,276px de contenido en 1,044 disponibles — por eso v2.27.4 le quito la
// columna Giro). Primer intento fue ocultar Match ERP con `xl`, y medido
// resulto que la escondia hasta en 1440px: o sea, quitaba una columna en la
// pantalla donde se trabaja, y AUN ASI desbordaba. Mal negocio. Quedo en `lg`
// (desaparece solo donde ya no cabia) mas recorte de los max-w. Resultado:
// 1,288px con las 8 columnas visibles, contra los 1,276 originales — se sumo
// una columna entera de seleccion y el ordenamiento por +12px netos.
//
// El desborde de fondo NO se arreglo y no se puede sin sacar una columna, que
// es decision del usuario (como lo fue Giro). Queda anotado en el plan.

// v2.201.0 — el ciclico se programa solo el 15, y la lista filtra por sucursal.
//
// **Un CHECK bloqueaba TODO el ciclico.** conteos_inventario_scope_type_check
// nunca incluyo 'CICLICO', asi que cualquier intento de crear ese conteo —el
// programado y el de la vista— reventaba al insertar. No lo detecte en v2.194.0
// porque solo habia probado el sorteo de la muestra, nunca la creacion. Lo
// encontro el primer test real de la funcion programada, en transaccion
// revertida. De paso sale 'APROBADO' del CHECK de status: nadie lo escribe,
// aprobar_conteo_inventario pone 'CERRADO'.
//
// - `crear_conteos_ciclicos_programados()` + cron `0 15 15 * *` (15 de cada mes,
//   9am El Salvador). El 15 y no el 1 porque ese dia ya corren el recalculo de
//   MIN/MAX y el cierre de ventas.
// - Que sucursales entran lo decide `branches.conteo_ciclico_activo`, no el
//   codigo: las 6 de venta en true, Bodega en false (ellos llevan su control).
//   Cambiarlo es un UPDATE, no un deploy. El tamano tambien es por sucursal.
// - Salta la sucursal que ya tenga un conteo abierto y lo registra, en vez de
//   romper la corrida. Avisa a la sucursal con notify_branch.
// - El guard interno era `auth.role() = 'service_role'`, que habria roto el cron
//   en silencio (pg_cron no tiene contexto de request, auth.role() es NULL). El
//   control lo hacen los GRANT.
// - La lista de conteos gana selector de sucursal. Con scope BRANCH queda fijado
//   y deshabilitado en la propia, para que se vea de que sucursal son los datos.


// v2.200.0 — 17 cuentas auth duplicadas borradas, FK sin indice, bucket sin limites.
//
// La auditoria decia "42 cuentas huerfanas". Eran 10: tanto el informe como la
// primera consulta ignoraron que auth_employee_id resuelve tambien por `code`
// del user_metadata. Actuar sobre el numero del informe habria revocado 32
// cuentas de empleados ACTIVOS, una de ellas con login del dia anterior.
//
// Lo que si habia es duplicacion sistemica: casi todo empleado tenia 2-3 cuentas,
// en tres oleadas — nombre.apellido@farmalasa.app (marzo), <codigo>@staff.local
// (1-2 de julio) y <random>@staff.local (las del escaneo de carne, que son las
// que se usan). Se borraron 17, todas de la oleada de julio y todas sin ningun
// login, con dos guardas: nunca borrar la ultima cuenta de una clave, y nunca
// borrar una cuyo id sea el de un empleado. La segunda guarda importo: filtro
// varias nombre.apellido@ que nunca entraron pero cuyo id ES employees.id.
// 92 -> 76 cuentas.
//
// Ademas: indice para sales_invoices.customer_id (unica FK sin indice que no es
// columna de auditoria, 336K filas) creado CONCURRENTLY para no bloquear los
// inserts del sync; y el bucket `backups` gano file_size_limit y
// allowed_mime_types, que le faltaban contra la regla #10.
//
// HIBP (proteccion de contraseñas filtradas) queda DESACTIVADO por decision
// explicita del usuario, no por olvido.

// v2.199.0 — se cerro a anon toda la superficie de funciones de negocio.
//
// La regla #4 de CLAUDE.md (REVOKE ... FROM PUBLIC, anon) nunca se aplico
// retroactivamente: ~28 funciones de negocio tenian EXECUTE para PUBLIC, entre
// ellas close_ventas_month, upsert_customers, generate_wfm_snapshot,
// get_ventas_stats y get_vendedores_resumen. Ninguna filtraba —son INVOKER, RLS
// sigue aplicando— pero cualquiera en internet podia invocarlas en bucle sin
// autenticarse, y cada llamada consume una de las 60 conexiones.
//
// CORRECCION a la auditoria: decia "5 funciones SECURITY DEFINER con anon, solo
// dos justificadas". Las cinco son el set pre-login del kiosco y las cinco son
// deliberadas — las tres que CLAUDE.md no lista (verify_kiosk_device,
// verify_kiosk_pin, verify_kiosk_authorization) son justamente las que
// construimos para reemplazar la comparacion client-side. Lo desactualizado es
// el doc, no los permisos.
//
// Quedan 31 funciones de pg_trgm/pg_net accesibles por anon: son internas de
// extension (revocarlas rompe los indices de trigram) y salen del namespace
// publico moviendo la extension, que es otro trabajo.

// v2.198.1 — se borra el conteo abandonado de Bodega (migracion, sin cambios de UI).
//
// Conteo TOTAL abierto el 10-jul: 4,782 lineas y CERO contadas en 19 dias. No es
// un registro de trabajo, es ruido — y con la regla de un solo conteo abierto
// por sucursal (C4) bloqueaba crear el ciclico en Bodega. Borrado autorizado por
// el usuario; va como migracion porque el modulo no tiene ruta de borrado
// (append-only a proposito), con guarda que aborta si alguien alcanzo a contar.


// v2.198.0 — H5, segunda mitad: la UI para clasificar 99 proveedores sin
// hacerlo de a uno. Aprobada por mockup antes de construirla.
//
// Es el PRIMER patron de seleccion multiple en tabla del proyecto — no habia
// canonico que copiar, por eso paso por mockup. Si otra vista lo necesita,
// copiar de ProveedoresView: Checkbox canonico (nunca el input nativo), el
// "seleccionar todo" opera sobre la PAGINA visible y no sobre los 99 (marcar
// una casilla no deberia alcanzar filas que nadie esta viendo), y la barra de
// acciones existe solo mientras haya seleccion.
//
// Dos acciones separadas porque hacen cosas distintas: "Aceptar sugerencia" le
// da a cada proveedor LA SUYA (calculada desde su propio giro); el select le da
// a todos LA MISMA. El contador del boton cuenta solo los seleccionados que
// TIENEN sugerencia: con los 25 de la primera pagina marcados dice
// "Aceptar sugerencia (13)", asi que se ve solo que los otros 12 no la tienen.
//
// El aviso reporta lo que devuelve el RPC (filas que cambiaron de verdad), no
// cuantas se seleccionaron — si ya tenian esa categoria, dice que no cambio
// ninguna en vez de mentir.
//
// El gate:design cazo la barra: la habia escrito a mano en vez de usar
// `data-surface="card"`. Existe `data-tono="brand"` justo para esto.
//
// Medido al ejercitarla: la tabla YA desbordaba antes de este cambio (1276px
// de contenido en un contenedor de 1044 — de ahi que v2.27.4 le quitara la
// columna Giro). Se acoto el subtexto de la sugerencia con truncate + title
// para no empeorarlo: quedo en 1302, o sea +26px netos sobre lo que ya habia.
// El desborde de fondo sigue abierto, es anterior y aparte.

// v2.197.0 — se cerraron 24 de las 26 policies de escritura abierta.
//
// El hardening del 2026-07-02 cubrio las LECTURAS pero dejo INSERT/UPDATE en
// `true`: cualquier empleado con el rol mas bajo podia escribir 18 tablas.
// Ahora quedan 2, las dos a proposito.
//
// Dos trampas que esto evito:
//
//  1. product_locations y schedule_coverage tenian UNA sola policy, ALL con
//     `true` — y ALL cubre tambien SELECT. Reemplazarla por una gateada con
//     can_edit habria dejado SIN LECTURA a todo el que solo puede ver. Se
//     partieron: SELECT permisivo + escritura gateada.
//  2. user_dashboard_prefs se llamaba "owner_*" pero era TO public con `true`:
//     cualquiera leia y escribia las preferencias de cualquiera. Ahi el gate
//     correcto es dueño real (user_id = auth.uid()), no modulo.
//
// attendance.INSERT queda abierta a proposito: el kiosco marca por esa via y
// marca por OTROS empleados (tablet compartida), asi que ni gate por modulo ni
// por dueño sirven — cualquiera de los dos rompe el marcaje. Necesita una RPC
// que valide el device token, igual que audit_logs necesita logging server-side.
// Es arquitectura, no una linea de policy.

// v2.196.1 — H5, primera mitad: la regla que sabe clasificar proveedores.
//
// 99 de 99 proveedores estan sin categoria, asi que las 16 categorias, el
// filtro Categoria, el filtro Clase y la derivacion costo/gasto del detalle
// estan construidos y sin usar: filtrar por cualquier categoria devuelve 0
// filas, siempre. Clasificar 99 de a uno desde un modal es por que nadie lo
// hizo.
//
// Solo BD en este commit — la UI de asignacion masiva va con mockup aprobado
// antes (no hay patron canonico de seleccion multiple en el proyecto, asi que
// construirla de una seria inventar uno sin que nadie lo vea primero).
//
// `suggest_proveedor_categoria_id(desc_actividad)`: 14 patrones sobre el giro
// fiscal que ya viene en los 99 registros desde el propio DTE. Cubre 68 de 99
// proveedores = 1,958 de 2,192 documentos (89%), medido contra prod antes de
// escribirla. Case/acento-insensible porque el mismo giro convive hoy como
// "VENTA DE PRODUCTOS FARMACEUTICOS" y "Venta de productos farmacéuticos".
//
// Los ~11 ambiguos (supermercados, alimentos, lacteos, bebidas, abarrotes) NO
// reciben sugerencia A PROPOSITO. En una farmacia pueden ser mercaderia para
// reventa o insumo interno, y PriceSmart es literalmente las dos segun la
// factura — lo trajo el usuario. Sugerir ahi seria adivinar. La solucion de
// fondo es H5b: categoria a nivel de DOCUMENTO con el proveedor como default.
//
// La sugerencia viaja en get_proveedores_maestro (informativa, no se aplica
// sola) y hay dos RPC de escritura: set_proveedores_categoria_bulk (todos la
// MISMA) y apply_proveedores_categoria_sugerida (cada uno la SUYA). Las dos
// devuelven cuantas filas cambiaron de verdad, para que la UI no reporte el
// numero de seleccionados como si fuera el de aplicados.

// v2.196.0 — Fase B de la auditoria DTE: dos cosas del sync que se rehacian
// solas. Cambio de edge function, sin efecto visual.
//
// H10 — `TIME_BUDGET_MS` (100s) era el presupuesto de UNA CUENTA, y las
// cuentas se recorren en serie. El wall-clock real de una invocacion era
// N x 100s: con 2 correos ya daban ~200s, y conectar el tercero (pendiente
// conocido) lo llevaba a ~300s contra el limite de la plataforma. Si la
// invocacion se cortaba ahi, la ultima cuenta perdia su trabajo y se
// re-escaneaba entera. No habia perdida de datos — markMessagesProcessed
// corre dentro de processAccount y solo con mensajes ya completados — pero si
// trabajo tirado y un hasMore que nunca llegaba al cliente. Ahora el deadline
// es absoluto y se reparte entre las cuentas: la que no alcanza devuelve
// hasMore y el boton reintenta solo (E5 ya hacia eso). Esto DESBLOQUEA
// conectar el tercer correo.
//
// H7 — el insert guardaba `items_text: extractItemsText(json)`, que es null
// cuando el DTE no trae cuerpoDocumento (tipo 09, FSE tipo 14). El backfill ya
// usaba '' a proposito, con un comentario explicando que dejarlo en NULL hace
// que la fila se re-procese; el insert no seguia ese criterio. Cada corrida
// futura del backfill re-descargaba de Storage todos los tipo 09 acumulados
// desde la anterior (~2/dia) para volver a concluir lo mismo. Convergia, pero
// la deuda se rehacia sola todos los dias. Ahora los dos caminos usan el mismo
// criterio; las 21 filas en NULL pasaron a ''.
//
// Verificado en prod: edge function v47 desplegada con --no-verify-jwt (esa
// funcion tenia verify_jwt=false y un redeploy sin el flag lo resetea a true,
// trampa ya documentada), y dry_run real contra las 2 cuentas en UNA sola
// invocacion: 5.6s, sin errores, hasMore=false.

// v2.195.0 — tres suscripciones de Realtime estaban muertas en silencio.
//
// La auditoria (P6) proponia SACAR tablas de la publicacion. Medido, eso era
// incorrecto en dos puntos: role_permissions SI se usa (AuthContext refresca
// permisos en vivo), y el costo no es decodificar sino el POLL — 651,041
// llamadas de la funcion de sondeo a 8.9 ms, corra o no un cambio; las 10
// tablas publicadas suman 241 escrituras en total.
//
// Lo que si estaba mal es lo contrario: el frontend se suscribia a tres tablas
// que no estaban en la publicacion, asi que esos eventos nunca llegaban.
//   inventory_sync_log  toast + notificacion ante sync fallido (AppLayout)
//   pedido_items        refresco de items del pedido activo
//   ventas_perdidas     badge de pendientes
// No era lento: no funcionaba. Ahora 12 de 12 tablas alineadas.
//
// Ademas, primer lote de policies de escritura abierta (F2.1): products,
// kiosk_devices, timesheets y employee_events pasaron de `true` a
// auth_can_edit_any con el wrapper (SELECT ...) obligatorio. 26 -> 20.

// v2.194.0 — conteo ciclico mensual: 200 productos por sucursal.
//
// En vez de un evento anual de ~4,800 lineas, una muestra chica todos los meses.
// El ERP nunca se aleja mucho y las diferencias aparecen cuando todavia se
// pueden investigar.
//
// Reparto de los 200:
//   BAJO RECETA  100%   — control sanitario, van TODOS (23-54 segun sucursal)
//   del resto:   60% A · 25% B · 15% C
//
// Con eso cada clase A cae cada ~4-5 meses y cada B ~1 vez al ano. La clase C no
// se cubre por ciclo — eso lo cubre el conteo TOTAL anual, que sigue existiendo.
//
// **No es azar puro.** Prioriza lo que lleva mas tiempo sin contarse (nunca
// contado primero) y desempata al azar: asi nada queda sin contarse jamas y a la
// vez nadie puede predecir que cae este mes. La muestra se sortea EN EL
// SERVIDOR — si la eligiera el cliente, elegir que se cuenta dejaria de ser un
// control y pasaria a ser una preferencia. La composicion sorteada queda
// guardada en scope_filter: un ciclico que no dice como se armo no se audita.
//
// **Solo cuenta el ABC publicado, no el borrador de MinMax.** Decidir que se
// audita con numeros que nadie aprobo convierte un control en una corazonada.
// Medido: Bodega tiene 0 publicadas y 2,540 en borrador. Ahi la muestra pasa a
// ser "bajo receta 100% + rotacion por antiguedad", que es lo correcto para un
// almacen sin ABC — y respeta que Bodega no se maneje por ABC ni por obligacion
// mensual.


// v2.193.0 — la grilla del conteo se ordena como esta el anaquel.
//
// En las sucursales el producto esta acomodado POR LABORATORIO. La grilla
// ordenaba por nombre de producto — y con el filtro de diferencias, por valor
// del desvio (v2.190.0) — lo que obliga a zigzaguear la farmacia entera para
// contar o recontar. Gana la razon fisica: laboratorio primero, producto
// alfabetico adentro, los sin laboratorio al final.
//
// Verificado que el orden alfabetico ya reproduce el numerico: de 356
// laboratorios, 57 tienen prefijo numerico y NINGUNO pasa de un digito, asi que
// no aparece el clasico "10- antes que 2-".
//
// Ademas, entrar al modo recuento deja la vista filtrada en "Con diferencia",
// que es lo que se recuenta. Queda como filtro y no como candado: verificar
// unas lineas que cuadraron es lo que detecta al que copio el numero del
// sistema en vez de contar.


// v2.192.0 — Fase A de la auditoria DTE+Proveedores: seis cosas que la vista
// prometia y no cumplia.
//
// La mas cara de las seis no se ve en pantalla. `update_proveedor_manual`
// escribia `percibe_1_override = p_percibe_1` en CADA guardado, tocara o no el
// usuario ese campo. La columna existia justo para el tri-estado (NULL =
// automatico), y `upsert_proveedor_from_dte` SI la respeta — o sea que
// entrarle a un proveedor a corregirle el telefono congelaba su percibe_1
// contra sus propios DTE, para siempre, sin forma de volver a automatico desde
// la UI. Dos filas ya habian caido (CAESS y CTE, ambas editadas cuando se
// agrego el campo Alias). Ahora el cliente manda solo el override tri-estado y
// `percibe_1` lo deriva el RPC; las 2 filas volvieron a NULL.
//
// Casi se colo un bug nuevo al arreglarlo: `get_proveedores_maestro` NO
// devolvia `percibe_1_override`, asi que el form flamante habria mostrado
// "Automatico" siempre y el primer guardado habria borrado un override real
// sin avisar. Se agrego la columna al RPC en la misma migracion.
//
// Las otras cinco:
// - Tres tooltips mostraban el codigo fuente en pantalla: `title="row.json_path
//   ? 'Descargar JSON' : 'Sin JSON'"` — la expresion quedo DENTRO de la cadena.
//   Build, lint y gate:design pasan en verde porque la forma es valida. Son los
//   unicos 3 del repo (barrido global).
// - La card "Sin Proveedor" contaba 143 documentos como "pendiente de
//   emparejar". Los 143 eran tipo 09, que el sync excluye A PROPOSITO
//   (_shared/proveedorFromDte.ts: el emisor es un banco, no un proveedor). Una
//   lista de tareas imposibles que crecia ~2/dia, con boton de "Emparejar" que
//   no podia resolver nada. Ahora dicen "No aplica".
// - "Ver documentos" desde un proveedor navegaba sin rango de fechas, asi que
//   caia en el mes actual: el usuario acababa de leer "Ultima compra:
//   12/06/2026" y aterrizaba en "Sin facturas en el periodo". Ahora el link
//   lleva el mes de esa ultima compra.
// - El detalle de proveedor ignoraba el `canEdit` que la vista ya le pasaba:
//   un usuario de solo lectura veia todo editable, escribia, y recibia el
//   FORBIDDEN crudo del RPC (que si valida). La UI prometia lo que el servidor
//   rechaza.
// - Los filtros de las cards no contaban como filtros: con "Invalidados"
//   activo, la barra decia que no habia ninguno y "Limpiar" no lo apagaba.
//
// Ademas: el selector de Emparejar/Clasificar en Revision marcaba
// documentsLoaded ANTES de que resolviera el fetch y sin catch — si fallaba,
// quedaba vacio el resto de la sesion, sin aviso ni reintento. Y se borraron
// dos funciones muertas de la BD: el overload de 7 args de
// update_proveedor_manual (el CREATE OR REPLACE del alias habia creado una
// funcion NUEVA en vez de reemplazar) y set_purchase_dte_supplier, sin
// llamadores desde que la Fase 2.1 movio el match al maestro. Ambas eran
// SECURITY DEFINER de escritura con GRANT vivo.

// v2.191.0 — buscar una factura tardaba 7.5 segundos.
//
// La auditoria reporto esto como dos hallazgos separados: "6 GIN de trigram
// muertos, dropearlos" y "RPC de analitica lenta, 7,669 ms". Era el MISMO bug:
// los indices estaban muertos PORQUE la query no podia usarlos. Seguir la
// recomendacion al pie de la letra habria dejado la busqueda rota para siempre.
//
// search_ventas_ids filtraba con `norm_search(si.cliente) LIKE ALL (v_pats)`.
// LIKE ALL(array) es un ScalarArrayOpExpr y el opclass gin_trgm_ops solo
// resuelve LIKE contra un patron ESCALAR; encima los patrones venian de un CTE
// unido por producto cartesiano. Seq scan sobre 336,592 filas evaluando
// norm_search() tres veces por fila. Ahora es plpgsql con los patrones en
// variables locales: llegan al plan como parametros y el indice si matchea.
//
//   7,494 ms -> 313 ms en produccion, mismas 2,072 filas.
//   equivalencia probada por diferencia de conjuntos en 7 casos: 0 diferencias.
//
// Se dropearon solo los 4 indices realmente redundantes (64 MB): los 3 trigram
// sobre la columna cruda, superados por sus gemelos _norm que son los que la
// RPC consulta, y un prefijo estricto de idx_si_branch_fecha_full.

// v2.190.0 — recuento de variaciones por supervisor.
//
// La causa mas comun de una diferencia grande no es robo ni merma: es un error
// de conteo (se salto una caja, conto blisters en vez de unidades, leyo mal el
// lote). Ajustar el ERP con eso mete el error en el sistema y encima "explica"
// una merma que nunca ocurrio.
//
// El recuento vive **entre finalizar y aprobar**: antes es el conteo normal,
// despues ya esta firmado y el ajuste salio al ERP.
//
// - Gated por `can_approve`, que es el nivel de supervisor del modulo y se
//   asigna por rol desde la pantalla de permisos. Sin columna nueva en
//   role_permissions.
// - **No puede recontar quien conto esa linea** — un recuento hecho por la misma
//   persona no es un recuento (RECUENTO_MISMO_CONTADOR).
// - **Ciego al primer conteo**: el campo arranca vacio y no se ve ni el sistema
//   ni lo que conto el primero hasta registrar el propio. Si el supervisor ve
//   que decia 12, escribe 12.
// - `fisico_primer_conteo` preserva el original; al destapar se muestra si
//   coincidio o no, que es la metrica de calidad del conteo de base.
// - Con el filtro "Con diferencia" los productos salen ordenados por el VALOR
//   absoluto del desvio, no alfabeticos: se recuenta la plata primero.
// - `recalcular_totales_conteo()` extraido: finalizar lo calculaba inline y un
//   recuento cambia cantidades despues, asi que la cabecera quedaba mintiendo
//   respecto de sus propias lineas.
//
// Sigue abierto: el corte de movimientos (es operativo, no de software) y los
// conteos ciclicos por ABC.

// v2.189.0 — el 26.5% del CPU de la base era un INSERT que no insertaba nada.
//
// La query #1 de pg_stat_statements (127K llamadas, 8,281 s) era un
// `ON CONFLICT DO NOTHING` sobre products que escribia CERO filas. El costo no
// era escribir: era la insercion especulativa: Postgres arma el tuple y sondea
// products_pkey por CADA fila del payload aunque todas existan (142M idx_scan
// acumulados). Medido: 84.3 ms con DO NOTHING vs 6.3 ms filtrando primero con
// un anti-join. Verificado en prod tras el deploy: 65.1 ms -> 4.2 ms.
//
// La auditoria atribuia esto a sync-erp-purchases. Era sync-dte-sales, que
// corre cada minuto por 6 sucursales. Se migraron los 6 upserts incondicionales
// de los tres syncs a RPC con IS DISTINCT FROM / anti-join, se saco el
// updated_at de los payloads (hacia que toda fila "cambiara" siempre) y se
// dejaron de tragar los error de supabase-js en esas llamadas.
//
// Ademas: la auditoria decia que cron.job_run_details no se purgaba. Si se
// purgaba, a 14 dias — pero borrando por igual los 217K exitos (99 MB de ruido)
// y los 345 fallos (163 kB, la evidencia que hace falta para diagnosticar los
// errores de cron). Ahora es asimetrica: exitos 7 dias, fallos 90.
// Con VACUUM FULL de esa tabla y de net._http_response (2,203 filas vivas en
// 205 MB de hinchazon), la base bajo de 1,463 MB a 1,134 MB.

// v2.188.0 — el conteo termina en un ajuste, no en un numero.
//
// Decision del usuario: mientras el portal no sea el sistema completo, los
// ajustes de inventario se aplican en el ERP. El portal NO escribe stock — eso
// no cambia y es deliberado — pero el conteo ahora entrega el documento con el
// que se hace ese ajuste, y registra si ya se aplico.
//
// Antes, aprobar solo sellaba el estado: la diferencia quedaba medida y firmada
// y ahi moria. Un conteo aprobado y uno ya reflejado en el ERP se veian
// identicos, asi que nadie sabia si el stock del ERP todavia mentia.
//
// - **Hoja de Ajustes** (PDF apaisado) y **CSV**, partidos en FALTANTES (ajuste
//   de salida) y SOBRANTES (ajuste de entrada), que en un ERP son dos
//   transacciones distintas. Ordenados por codigo ERP, que es como se teclea.
//   Cada linea trae codigo, codigo de barras, lote, vencimiento, area
//   (normal/vencidos) y la cantidad firmada a aplicar, con totales por seccion.
//   Los renglones agregados a mano salen marcados **ALTA DE LOTE**: en el ERP
//   no es ajustar una cantidad, es dar de alta un lote que no existe.
// - `marcar_ajuste_erp` deja constancia de quien lo aplico y cuando. Exige el
//   conteo **aprobado** (CERRADO): ajustar el ERP con un conteo que nadie firmo
//   es justo lo que el paso de aprobacion existe para impedir.
// - Aviso persistente en el detalle y badge "Falta ajuste ERP" en la lista
//   mientras siga pendiente.
// - El payload de impresion suma `codigo_barras` y `sistema_inicial`.
//
// Sigue abierto y documentado en AUDITORIA-CONTEO-2026-07-29.md: el corte de
// movimientos, el recuento de variaciones y los conteos ciclicos por ABC.

// v2.187.0 - auditoria de puntos ciegos, P3 + dos reglas nuevas en el gate.
//
//   11. prefers-reduced-motion apagaba `animation` clase por clase y NO tocaba
//       una sola `transition`: ~150 elementos seguian moviendose de verdad (el
//       barrido de 0.7s de los botones, el -translate-y del hover de cada
//       tarjeta, el scale de las fotos). Ahora 0. NO se apaga `transition` a
//       secas: una transicion de COLOR no es movimiento y quitarla empeora la
//       interfaz - el estado cambiaria de golpe, justo el salto que la
//       preferencia quiere evitar. Se neutraliza la geometria.
//   12. 15 iconos en tamanos arbitrarios al escalon de la rampa. Otros 3 se
//       REVIRTIERON: son marcas de agua decorativas (opacidad <=15%, detras del
//       contenido) y encogerlas cambiaba un peso visual deliberado.
//   13/14. 4 `title` que repetian el aria-label. Y la regla que faltaba en
//       15.10: title NOMBRA un control de solo icono, LiquidTooltip EXPLICA.
//       Los 208 title del portal no eran deuda - 204 son el unico nombre
//       accesible del control.
//
// DOS CATEGORIAS NUEVAS EN EL GATE, ambas bloqueantes en cero:
// `try-finally-mudo` y `title-redundante`. Encontraron 3 casos que se me
// habian pasado (NotificationBell, FacturasCompraView, TabInventario).
//
// Queda abierto y medido: 224 targets tactiles bajo 44px en 11 de 33 rutas. No
// se tocan a ciegas - el grueso son barras de grafico clickeables y celdas de
// grilla densa, donde 44px es incorrecto y WCAG 2.5.5 tiene excepcion. Es una
// pasada aparte, caso por caso.

// v2.186.0 - auditoria de los PUNTOS CIEGOS del gate: P1 y P2.
//
// Reglas que DESIGN.md manda y design-gate.mjs no mide. 308 archivos + 33
// rutas reales en Chromium + 14 en WebKit iPhone. De 503 hallazgos en bruto
// quedaron ~40 reales; el resto eran detectores mintiendo (ver abajo).
//
// P1 - lo que rompe o engana al usuario
//   1. try/finally sin catch, 7 de 19. Si la RPC tira, el spinner se apaga y
//      la lista queda vacia: el usuario lee "no hay datos" cuando en realidad
//      fallo. Ahora los 7 avisan con toast.
//   2. Cuatro modales a mano -> ModalShell (EmployeeDetailView x2,
//      RequestsView x2): sin foco atrapado, sin Escape, sin role="dialog".
//   3. TRES visores de foto distintos y DOS sin Escape -> common/PhotoLightbox
//      (promovido del de TabCatalogo, que era el completo). `alt` obligatorio:
//      los tres traian alt="" para una imagen que el usuario abrio a proposito.
//   4. SearchInput: el boton de limpiar medía 20x20 en tactil (piso 25.6 = 44).
//      Vive en el canonico, o sea que era asi en TODA vista con buscador.
//   5. COEP del dev server bloqueaba 58 fotos de empleados por sesion. Solo
//      dev - vercel.json nunca mando COEP - pero significa que meses de
//      verificacion visual local corrieron con las fotos rotas.
//   6. LiquidDatePicker: los 3 segmentos DD/MM/AAAA eran outline-none y ningun
//      ancestro pintaba el foco. Unico hallazgo real de la pasada de foco.
//
// P2 - no sigue el canonico
//   7. Seis estados vacios a mano -> EmptyState. El de TabExpediente ya
//      distinguia "tu filtro no encontro" de "no hay nada que atender", que es
//      justo lo que 18.1 pide; le faltaba el canonico y la salida.
//   8. Tres spinners de seccion -> LoadingState / Skeleton / AiThinkingState.
//   9. Paginacion a mano de AnnouncementsView -> TablePagination.
//  10. Las 7 tablas dentro de tarjeta NO pueden ser DataTable (el propio doc
//      prohibe doble-tarjeta). El defecto real era que el doc no decia que
//      hacer con ellas, asi que cada una invento su encabezado: seis <th>
//      distintos para lo mismo. Unificados + regla nueva en DESIGN.md 14.
//
// Descartado tras verificar - los detectores mienten:
//   foco visible 1006 -> 0 (el .focus() programatico no dispara :focus-visible;
//   con Tab de verdad y contando :focus-within del contenedor, solo el
//   datepicker), apilamiento 36 rutas -> 0 (los z vivos son exactamente la
//   escala 9), button-sin-type 5 -> 0 (el type estaba en la linea siguiente),
//   title= 278 -> 4 (70 son prop de componente; de los 208 que llegan al DOM,
//   204 son el UNICO nombre accesible y Button documenta title como fuente
//   valida), iconos 613 -> 26 (12 documenta 5 tamanos y el codigo usa 33: el
//   doc esta mal, no el codigo), scroll horizontal movil 0, img sin alt 0.
//
// Mi lista de rutas estaba en espanol y App.jsx las tiene en ingles: 17 de 36
// caian al fallback, asi que las primeras pasadas midieron media app. Rehecho.


// v2.185.1 — se cierran las escrituras abiertas de `roles` y su lectura anonima.
//
// `roles` tenia INSERT y UPDATE con `true`: cualquier autenticado, incluido el
// rol mas bajo, podia crear o modificar roles. Como los permisos del portal se
// resuelven contra role_permissions a partir del rol del empleado, eso es
// escalada de privilegios por la via de los datos — sin necesidad de ninguna
// vulnerabilidad de codigo, bastaba un PostgREST directo. El gate correcto ya
// existia en la MISMA tabla (roles_delete): ahora INSERT/UPDATE se alinean con
// el.
//
// Ademas `read_all` era TO {anon, authenticated}: el catalogo de roles, con
// `is_su` incluido, se leia sin login. Verificado que ningun flujo pre-login
// consulta roles (refreshPermissions sale temprano sin usuario; el kiosco los
// recibe resueltos dentro de get_kiosk_boot_payload, que es DEFINER).
//
// Barrido final con la anon key publica: employees, employees_safe, roles,
// customers y products devuelven 0 filas; kiosk_credentials, kiosk_pin_attempts
// y sales_invoices dan 401. Solo `branches` sigue abierta (kiosk_read
// intencional del kiosco pre-login), anotado en el informe.
//
// audit_logs sigue con INSERT `true` A PROPOSITO: user_id lo pone el cliente y
// puede ser null, y el kiosco escribe desde un contexto de auth que no se pudo
// verificar sin el dispositivo. Un WITH CHECK mal calibrado ahi rompe la
// bitacora entera. El fix real es mover el logging al servidor, dentro de las
// RPC que ejecutan cada accion — es arquitectura, no una linea de policy.

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
