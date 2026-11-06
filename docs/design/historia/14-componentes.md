# §14 Componentes — historia

## ViewTabBar

**Tokens (Fase T2, 2026-07-23).** El pill activo era blanco puro sobre vidrio
oscuro; se corrigió con el token `--surface-tab-active`.

**Responsive (2026-07-23, v2.35.0).** La fila de pestañas pasó a ser sólo de
escritorio y en móvil un `LiquidSelect` compacto: 4-5 pestañas (o rótulos como
"Reglas de despacho" en Pedidos a Sucursales) competían por el ancho.

**La barra existe sólo si tiene algo adentro (2026-08-09, v2.546.1).**
`showSearch` vale `true` por defecto, así que una vista que sólo quería pestañas
dibujaba igual la lupa, y esa lupa no filtraba nada. Quedó a la vista en Corte Z
— una píldora de 70px con un botón que no hacía nada, y una pestaña única que
repetía el título. 16 vistas montaban `ViewTabBar` sin una sola pestaña, sólo por
el buscador; cuando el buscador bajaba al clúster flotante quedaba un vidrio
vacío de 48px.

**El buscador baja al clúster aunque no haya `FilterBar` (2026-08-09).** Medido
en WebKit iPhone 13, 5 vistas se quedaban con la lupa arriba —donde se va con el
scroll—: Pedidos, Laboratorios, Roles, Avisos y Mantenimiento. Desde el respaldo
de `GlassViewLayout`: sobre 28 rutas, 25 con buscador lo tienen abajo, 0
duplicados, y 0 barras flotantes en escritorio en las 8 rutas comprobadas. El
bucle evitado (leer lo que el propio respaldo publica) es la misma forma del que
ya tiró la vista al ErrorBoundary una vez (React #185).

**Ancho del selector.** Era `w-[150px] sm:w-[190px]`; los 150 fijos dejaban al
título de Pedidos con 75px.

**Duplicado resuelto (2026-07-24).** `VentasView.jsx` tenía su propia copia del
pill; consolidada al componente real, sus pestañas pasaron de 36/40px a 44px. Su
toggle de privacidad pasó a un descriptor de `FilterBar.acciones` con `activo`
(2026-07-30).

## `cuenta` en la pestaña (2026-08-24)

Nació en Bolsas de efectivo: el usuario reportó «me estoy perdiendo en los pasos,
al tener tantos, me pierdo y no sé dónde está qué». Separar en pestañas arregló el
perderse y creó otro problema: una bolsa trabada seis días detrás de una pestaña
que nadie abre, sin error y sin fila de menos visible. `Contador` en el chunk de
`ViewTabBar` costó 117 bytes gzip, que en `ConteoDetailView` cruzaron un borde de
redondeo del `bundle-gate` (68.46 → 68.57 kB) y se firmaron en `_motivos`.

## `usePestanaEnUrl` (2026-08-20)

Medido: de las 29 vistas con pestañas, 9 guardaban la pestaña en la dirección y
20 no, cada una con el mismo bloque de cinco líneas copiado o ausente. No fallaba
nada: se reportaba como «la pantalla se movió sola».

## `usePaginaEnUrl` (2026-08-22)

Lo pidió el usuario contando inventario: *«imagina que estoy haciendo el conteo y
estoy en la página 50, y se me actualiza, me devuelve a la página 1»*. La sesión
de sala se cierra sola a los 5 minutos (v2.647.0), el service worker recarga al
publicar una versión, y F5 existe: cualquiera de las tres dejaba a alguien frente
al estante buscando dónde iba entre 1,400 productos. Anclado en
`tests/unit/paginaEnUrl.test.jsx` (11 casos; la prueba de «atrás» se verificó
contra un `push` deliberado y falla).

## DataTable

**Doble tarjeta.** `StaffManagementView` v2.4.2 había crecido un envoltorio
`data-surface="card"` con su propio `overflow-y-auto`, que además peleaba con el
scroll de `GlassViewLayout`.

**La sub-tabla `plano` (2026-08-09).** Reemplazó la regla del 2026-07-29 («una
tabla dentro de una tarjeta no puede ser `DataTable`») que daba una receta de
`<th>` a mano: esas tablas no heredaban nada (ni modo ficha, ni alto por
densidad, ni teclado del encabezado ordenable). Las cinco sub-tablas a mano
—ubicaciones de Inventario, tres historiales de Catálogo, resumen por sucursal
de Pedidos— pasaron al canónico y `tabla-a-mano` llegó a 0 ese día.

**El ancla de la fila (2026-08-09).** En Ventas, a 1440×900 con el menú abierto
quedan ~1080px útiles; las ocho columnas pedían más y la que se salía era
**Total**: se leía `$3.`, `$28.`, cortado. Legible en el celular, ilegible en la
computadora. El peldaño `1440` de `HIDE_BELOW` (`min-[1440px]:table-cell`) se
cumple a 1440 y a ese ancho exacto no oculta nada; ya costó una iteración con una
medición propia que decía «entra» mientras la captura mostraba lo contrario.

## SelectorTactil (2026-07-30)

Medido en WebKit con perfil de iPhone sobre el filtro de laboratorio del conteo
(220 opciones):

| | |
|---|---|
| el dropdown hereda el ancho del trigger | **190 × 216px** → ~4 opciones visibles de 220 |
| se abre pegado al trigger | si el trigger está abajo, **el teclado del sistema lo tapa** |
| pasado `searchThreshold` la lista arranca vacía | "Escribe para buscar" con el campo invisible |

En el catálogo real 71 de 356 laboratorios traen prefijo del ERP
(`1-ABBOTT NUTRICIONAL`, `3-*BONIN`, `1.1-INSUMOS`): agrupar por el primer
carácter mandaba a Abbott al cajón "1".

Dos cosas que costaron encontrar: el riel tiene que apuntar a la `<section>` y
no al encabezado `sticky` (pinchado arriba su rect coincide con el contenedor y
el delta sale 0), y el desplazamiento va por `getBoundingClientRect`, no por
`offsetTop` (que mide contra el ancestro posicionado). Y `LiquidSelect` no puede
registrar su click-afuera cuando usa la hoja: la hoja va por portal al `body`,
fuera de `selectRef`, y arrastrar el índice cerraba el selector.

## ModalShell — un solo diálogo a la vista (2026-08-09)

Reportado sobre Conexiones, con el diálogo de bloqueo abierto sobre el detalle
de la persona: dos paneles del mismo vidrio no se distinguen, y el de abajo se
leía entero a través del de encima.

## LiquidModal — dos superficies apiladas

Dos `data-surface="modal"` apilados multiplican lo que dejan pasar: a 0.51 daban
≈0.76, un modal casi opaco. El encabezado con anatomía propia nació el
2026-10-29 de la regla del usuario: *«nada debe estar a mano, todo debe ser
canónico»*.
