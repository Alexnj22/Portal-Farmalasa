---
target: Inicio (DashboardView) — revisión de UX por vistas
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-08-09T15-27-18Z
slug: src-views-dashboardview-jsx
---
## Design Health Score

| # | Heurística | Score | Issue clave |
|---|-----------|-------|-------------|
| 1 | Visibilidad del estado | 2 | El gráfico de asistencia dibuja una línea plana en cero con los días rotulados. No dice «sin datos»: dice «nadie asistió en toda la semana» |
| 2 | Lenguaje del mundo real | 3 | Español de negocio en todo. `MUERTA / PICO / CRÍTICA` es vocabulario del dominio pero no se explica |
| 3 | Control y libertad | 3 | Pestañas, selector de sucursal por widget, Personalizar, ⌘K. Sólido |
| 4 | Consistencia | 3 | Vocabulario de tarjeta consistente. Dos afordancias de «expandir» distintas dentro del MISMO widget de ventas |
| 5 | Prevención de error | 3 | Poca superficie destructiva en esta vista |
| 6 | Reconocer en vez de recordar | 2 | El gráfico de ventas no tiene eje Y ni valores: la altura de la barra no se puede leer como número |
| 7 | Flexibilidad y eficiencia | 3 | Personalizar, filtros por widget, ⌘K, segmentación por pestañas |
| 8 | Estético y minimalista | 2 | La fila de cuatro fichas es la plantilla que PRODUCT.md lista como anti-referencia, y tres de cuatro dicen 0. En el teléfono, 5,874px de scroll |
| 9 | Recuperación de error | 3 | Sin errores disparados en la corrida |
| 10 | Ayuda y documentación | 2 | Nada explica los cuatro estados del día de ventas ni qué hace Personalizar la primera vez |
| **Total** | | **26/40** | **Aceptable con problemas serios** |

## Veredicto de anti-patrones

**Evaluación propia.** No parece hecho por IA — el vocabulario visual es propio y coherente, y el material (vidrio con propósito, iconos en cuadro redondeado) está aplicado con consistencia real, no decorativa. Pero **la fila superior de cuatro fichas es exactamente el patrón que el propio PRODUCT.md declara anti-referencia**: icono + rótulo chico + número grande + estadística de apoyo, cuatro veces idénticas. Que sean cuatro iguales es el problema, no que existan: nada dice cuál mirar primero.

**Escaneo determinista.** El detector empaquetado del skill **no está instalado** en este proyecto (falta `scripts/detector/`); se intentó y falló, así que esta mitad se reporta como no disponible. En su lugar valen los gates del propio repo, que cubren buena parte del mismo terreno y hoy están en verde: `gate:design` 0 con baseline vacío, `gate:movil` 0 en sus cuatro categorías, y el barrido de 37 rutas con desbordes, controles chicos, zoom de iOS y acuse del toque en 0.

**Superposiciones visuales.** No hay: la extensión de Chrome no está conectada, así que no se pudo inyectar el overlay. La evidencia es de Playwright — capturas a 1440×900 y 390×844, más el alto real del documento en cada una.

## Impresión general

Es un tablero bien construido que **abre mostrando su peor cara**. Lo primero que se ve son tres ceros y un gráfico plano; hay que scrollear para llegar a lo que sí tiene contenido. El problema no es de estética sino de orden: la vista pone arriba lo que está vacío y abajo lo que informa.

La oportunidad más grande es una sola decisión: **que el tablero no muestre un widget vacío con la misma prominencia que uno con datos.**

## Lo que funciona

- **Los estados vacíos enseñan, no se disculpan.** «Sin solicitudes pendientes» y «Sin ausencias activas» tienen icono, mensaje y un halo que los hace verse deliberados. Es el estándar que la mayoría de los productos no alcanza.
- **La segmentación por pestañas (General / Comercial / RRHH / Operación) es la decisión de arquitectura correcta.** Un tablero de una cadena de farmacias tiene cuatro públicos distintos; dárselos como filtro en vez de como cuatro tableros evita la duplicación.
- **`Personalizar` existe y es honesto.** El botón de tamaño y la píldora de arrastre sólo aparecen con el modo abierto, así que la vista de lectura no tiene ruido de edición.

## Problemas por prioridad

### [P1] Un gráfico vacío que se lee como un dato catastrófico
**Qué**: «Tendencia de Asistencia» dibuja los seis días rotulados y una línea azul plana pegada al eje. No hay ningún indicio de que sea ausencia de datos.
**Por qué importa**: un gerente que abre el portal a primera hora lee «cero asistencia toda la semana». Es la peor confusión posible en una vista cuyo trabajo es dar tranquilidad de un vistazo. Y ocurre en el widget más grande de la primera pantalla.
**Arreglo**: cuando la serie viene vacía, no dibujar la serie. Estado vacío con el motivo: «Sin marcaciones esta semana» y, si aplica, «los datos entran al cerrar cada turno».
**Comando sugerido**: `harden`

### [P1] En el teléfono el tablero son siete pantallas, y la segunda está vacía
**Qué**: 5,874px de alto en 390×844. La primera pantalla es banner + encabezado + pestaña + Personalizar + cuatro fichas; la segunda es, entera, el gráfico vacío de arriba.
**Por qué importa**: PRODUCT.md dice que un supervisor lo consulta entre turnos, en el teléfono. Dos pantallas de scroll antes del primer dato accionable es exactamente la fricción que el producto dice querer evitar.
**Arreglo**: en móvil, orden por contenido y no por rejilla — lo que tiene datos primero, lo vacío colapsado a una línea. Un widget sin datos no puede pagar 350px.
**Comando sugerido**: `adapt`

### [P2] El gráfico de ventas no se puede leer como número
**Qué**: barras naranjas y azules sin eje Y, sin valores y con la leyenda de cuatro estados debajo de las barras.
**Por qué importa**: se ve la forma, no la magnitud. Para comparar el jueves contra el domingo hay que estimar píxeles. Y el color codifica el estado del día (`MUERTA/NORMAL/PICO/CRÍTICA`), que se aprende recién al llegar a la leyenda.
**Arreglo**: valores sobre las barras o eje Y; la leyenda arriba, antes de los datos que explica.
**Comando sugerido**: `clarify`

### [P2] Cuatro fichas idénticas, tres de ellas en cero
**Qué**: Empleados activos 49 · Presentes hoy 0 · Solicitudes pendientes 0 · Sucursales 8. Mismo tamaño, mismo peso, misma composición.
**Por qué importa**: la jerarquía plana obliga a leer las cuatro para descubrir que ninguna pide acción. Y `Presentes hoy 0 · 0% del total` junto a `Empleados activos 49` se lee como un fallo del sistema cuando probablemente es domingo.
**Arreglo**: que el número que **pide acción** sea el dominante y los estructurales (empleados, sucursales) bajen a una línea de contexto. Y que un cero con motivo lo diga: «domingo, sin turnos» en vez de `0% del total`.
**Comando sugerido**: `layout`

### [P2] El aviso de «portal en construcción» es permanente, y en el teléfono está cortado
**Qué**: franja a rayas en el tope de **todas** las vistas: «Portal en construcción visual — algunas pantallas se ven distintas mientras avanza la migración de tema. Tus datos están correctos.» En 390px se corta en «se ven v…».
**Por qué importa**: es una disculpa fija en cada pantalla. Cuesta altura en la vista donde la altura ya escasea, y una disculpa truncada erosiona más confianza que el defecto que anuncia.
**Arreglo**: que se pueda cerrar y no vuelva en la sesión, o que viva en un solo lugar (Ajustes) en vez de en el tope de todo. Si el motivo ya no aplica —la migración de tema terminó—, quitarlo.
**Comando sugerido**: `distill`

## Banderas por persona

**El gerente que mira KPIs a primera hora (de PRODUCT.md).** Abre y ve tres ceros y una línea plana. No hay nada que le diga si eso es normal para un domingo a las 9am o si el sistema dejó de recibir datos. Se va a la sucursal a preguntar por teléfono, que es justo lo que el tablero venía a evitar.

**El supervisor entre turnos, en el teléfono (de PRODUCT.md).** Necesita diez segundos. Paga dos pantallas de scroll —una de ellas un gráfico vacío— antes del primer dato accionable. Con siete pantallas totales, va a dejar de abrir el tablero y va a ir directo a la vista que le importa por el menú.

**Alex (usuario avanzado).** Bien servido: ⌘K, Personalizar, filtros por widget. Su queja es otra: no puede fijar el orden por *contenido*, sólo por posición, así que un widget que hoy tiene datos y mañana no ocupa el mismo lugar prominente.

## Observaciones menores

- Dos controles de «expandir» en el mismo widget de ventas (arriba a la derecha y abajo a la derecha) — una afordancia repetida con dos formas distintas.
- La píldora «VENTAS» flota sobre el borde entre dos tarjetas; parece un tirador de arrastre que se escapó del modo Personalizar.
- El menú lateral se corta a media entrada («Metas» queda atenuado y partido) por encima del bloque fijo de Ajustes. Una lista recortada a media fila se lee como rota, no como scrolleable.
- `HORAS / DÍAS` dentro del widget de ventas usa un lenguaje visual distinto al de las pestañas de arriba, que hacen lo mismo: elegir 1 de N.

## Preguntas que vale la pena hacerse

- Si el tablero pudiera mostrar **una sola cosa**, ¿cuál sería? Ahora mismo muestra doce con el mismo peso.
- ¿Qué pasaría si un widget vacío simplemente **no se dibujara** ese día, en vez de reservar su lugar?
- El cero de «Presentes hoy» ¿es una noticia o es la hora del día? La vista no distingue, y el usuario tampoco puede.

## Alcance de esta revisión

Evidencia real: **cuatro vistas** capturadas en escritorio y teléfono, revisión profunda de **una** (Inicio). Los altos medidos en 390px dan el orden de la deuda para las que siguen:

| Vista | Alto en móvil | Elementos |
|---|---|---|
| Ventas | 6,255px | 1,704 |
| Inicio | 5,874px | 2,428 |
| Pedidos | 4,302px | 1,834 |
| Productos | 3,339px | 1,504 |

Ninguna tiró error de JavaScript en la corrida.
