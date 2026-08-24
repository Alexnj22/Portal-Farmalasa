# Tablero de inicio — dónde queda cada widget, y por qué esa regla y no otra

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Es la primera pantalla del portal: 28 widgets acomodables, sus lanzadores de
solicitud y las baldosas de instrumento. Y es el área donde una decisión de
diseño se tomó **midiendo** en vez de opinando — que es lo que vale la pena
dejar escrito.

---

## 1. Dónde queda cada widget al soltar uno encima de otro

La regla salió de **tres reportes del usuario**, cada uno destapando lo que el
anterior no cubría:

1. *«el movimiento se siente torpe, desordena todo lo que había ordenado»* — la
   regla original mandaba a cada desplazado a la primera celda libre barriendo
   desde la fila 1, así que uno de la fila 8 aparecía arriba de todo.
2. Se agregó un intercambio, pero **sólo entre dos widgets del mismo tamaño**.
3. *«si muevo un widget de 2×2 y hay 2 ahí de 1×1 intercambian puesto… No deben
   haber espacios en blanco si alguno cabe»*.

Hoy se calculan **dos** acomodos y se elige el que deja menos huecos:

| acomodo | qué hace | a quién mueve |
|---|---|---|
| **Intercambio y empuje** | los widgets bajo el destino se mudan al hueco que deja el arrastrado si caben ahí (un 2×2 sobre dos 1×1 los manda a su hueco de 2×2); el resto se empuja **hacia abajo**, nunca hacia arriba | a poca gente |
| **Reempaque** | el arrastrado se clava donde se soltó y **todos** los demás se recolocan en orden de lectura, cada uno al primer hueco libre | a mucha, pero cierra huecos que el otro no puede |

Los dos terminan con una **compactación**: cada widget flota hacia arriba en su
columna mientras quepa.

### Elegir entre los dos está medido

3,000 movimientos al azar sobre tableros **compactos** —los que arma
`empacarFilas`, que son los reales—:

| estrategia | huecos que deja |
|---|---:|
| intercambio | 0.55 |
| reempaque | 2.01 |
| **elegir el mejor de los dos** | **0.27** |

> **Medir sobre tableros compactos y medir sobre tableros al azar invierte el
> resultado.** La medición correcta era la primera, porque los tableros al azar
> no existen: el portal siempre los compacta.

Es el ejemplo canónico de una lección que se repite en todo el portal: **antes de
creerle un número a una medición, comprobar que midió el caso real.**

---

## 2. Las preferencias son por persona

`user_dashboard_prefs` guarda el acomodo, las pestañas y el tema de cada quien.
`dashboard_canon` es el acomodo de fábrica.

**El tema es un valor VIVO.** Consultar `user_dashboard_prefs` dice cuál se
guardó, no cuál está puesto — y esa distinción costó un diagnóstico entero: el
2026-08-07 la consulta decía `solid` (sin vidrio) y se descartó una hipótesis por
eso; **un día después la sonda leyó el DOM en el teléfono y salió `liquid`**.

Se lee de `document.documentElement`, y hay una trampa: **`liquid` es el único
tema que NO estampa `data-theme`**, así que un `null` significa «con vidrio», no
«sin dato».

---

## 3. Un widget vacío no vacía el tablero

El detector de vistas vacías del barrido móvil clasificó mal el tablero: con
**13 fichas visibles** lo contó como vacío porque **un** widget estaba sin datos.

La regla que quedó: **`data-vacio` clasifica, nunca veta.** Una vista con
contenido propio tiene contenido aunque una de sus partes esté vacía.

---

## 4. Las pestañas: una lista, dos pantallas

`src/constants/dashboardTabs.js` dice qué widget vive en qué pestaña. Vive ahí
—y no dentro de `DashboardView`— porque lo necesitan **dos** pantallas: el
tablero, para armar cada pestaña y decidir cuáles salen, y **Permisos**, para
agrupar los widgets en vez de listar veinticuatro seguidos.

> Dos listas a mano que dicen lo mismo se desincronizan siempre.

Son tres temáticas —`comercial`, `rrhh`, `operacion`— y **`general` no se
declara**: es todo el catálogo.

### Tres reglas que no se ven en la lista

- **`kpi` aparece en dos pestañas a propósito.** No es un widget de la rejilla:
  se pinta aparte, arriba de todo. Por eso `tematicaDe` lo trata como si no
  tuviera pestaña propia — no puede pertenecer a una sola.
- **Las baldosas por sucursal (`sales_branch_*`) son ids dinámicos**, uno por
  sucursal con ventas, así que no pueden estar en una lista fija. Van **donde va
  el widget del que dependen** (`sales`), que además les presta el permiso
  (`dash_sales`). El día que `sales` cambie de categoría, las baldosas lo siguen
  sin que nadie tenga que acordarse. Reportado por el usuario: *«¿por qué los de
  ventas por sucursal no salen? ¿ni en comercial?»*.
- **Una temática sin ningún widget visible no se muestra.** Reportado el
  2026-08-07: *«si un rol no tiene widgets activados de una categoría, la pestaña
  no debe salir»*.

### Por qué General sale siempre

Tuvo una regla propia que la escondía cuando «sería un duplicado» —si todo lo
que el cargo ve cae en una sola temática, las dos pestañas dicen lo mismo—, y era
correcta **mientras las cuatro se comportaban igual**.

Dejó de serlo el 2026-08-07, cuando las temáticas pasaron a mostrar el acomodo
publicado por el superusuario: desde entonces General no es una vista repetida
sino **la única superficie que cada quien puede acomodar**. Esconderla le quita
esa libertad justo a los cargos más acotados, que son los que la tendrían más a
mano.

> Un tablero repetido se ignora; uno que no se puede tocar, no.

---

## 5. La baldosa es una puerta, no un formulario

Los widgets de solicitud —Ajuste de Inventario, Modificación a Facturación,
Ajuste de Min·Máx, Traslados y Consulta de Inventario— son **formularios
largos**: buscar, elegir, completar y escribir un motivo. Metidos en una baldosa
no entraban. En el Ajuste de Inventario se veía claro: con un solo producto
agregado, la lista de resultados quedaba en una franja de dos centímetros y no
había forma de darse cuenta de que se podían agregar más.

Entonces la baldosa **ocupa 1×1, dice qué hay esperando, y el trabajo pasa a un
modal con espacio**.

**El número no es decoración.** Una baldosa que sólo dice su nombre no da ningún
motivo para abrirla, y lo que hay adentro deja de mirarse.

**La anatomía del modal vive en `LanzadorSolicitud`.** `LiquidModal` ya era el
canónico, pero se usaba sólo como envase: los cinco widgets le pasaban un `<div>`
suelto y se dibujaban su propio encabezado a mano — cuatro versiones distintas
del mismo renglón, dos sin ninguno.

---

## 6. El instrumento: la forma distingue, el color no

Las seis baldosas de Operación compartían la anatomía completa —chip, título y un
renglón—. La única diferencia era el texto, así que **había que leer para
distinguirlas**, y el 55% derecho de la baldosa no decía nada.

`InstrumentoBaldosa` agrega una figura entre el título y el renglón. **Lo que
distingue a una baldosa de otra es la FORMA de esa figura** —barras verticales
para «quién», barra segmentada para «de qué», dos pistas opuestas para «en qué
sentido»— y **nunca el color**: el instrumento se dibuja con la misma tinta que
el texto secundario, y lo único con color sigue siendo el renglón del contador.
Es la decisión que ya estaba tomada en los lanzadores: *«los widget no quiero que
tengan color especial»*.

### Por qué mide 14px y ni uno más

La fila de la retícula mide 120px (`ROW_H`). Descontado el padding quedan 94, y
chip (36) + título (15) + renglón (13) + los gaps ya se comen 80. **La franja
entra en los 14 que sobran**, y por eso todas miden lo mismo: una que midiera más
empujaría su contador fuera de la baldosa.

---

## 7. Antes de tocar algo en el Tablero

1. **Una regla de acomodo nueva se mide sobre tableros compactos**, con muchos
   movimientos, y se compara contra la actual. No se cambia por intuición.
2. **Nada se empuja hacia arriba.** Fue el primer reporte y sigue valiendo.
3. **El tema se lee del DOM.** Y `null` es `liquid`.
4. **Un widget nuevo declara su tamaño mínimo**: el acomodo necesita saber si
   cabe en un hueco, y sin eso la compactación lo deja flotando mal.
5. **`npm run gate:movil`** — el tablero es la primera pantalla también en el
   teléfono.
