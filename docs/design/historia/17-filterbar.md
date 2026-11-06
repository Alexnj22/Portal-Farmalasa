# Historia — §17 FilterBar, carril de tarjetas y barra flotante

> Narrativa original de DESIGN.md §17 (incluida la «17.0.0 versión anterior», ya retirada:
> `MAX_RANURAS` dejó de existir como constante y el cupo se mide), movida aquí el 2026-11-06.
> Superado desde entonces: el rótulo del clúster ya NO va a dos líneas (una palabra +
> `truncate`); el clúster usa `MATERIAL_CLUSTER` (`card`) y la hoja `MATERIAL_HOJA`
> (`dropdown`); la barra está en `z-tabs` (30); el corte lo decide `useLayoutCompacto`;
> el buscador ya no se estira dentro del clúster: abre una fila propia encima. La categoría
> `carril-pildora` está en cero y es bloqueante.

### 17. Filter Pills — canónico `FilterBar` (2026-07-27)

```jsx
{/* La píldora va a la DERECHA de su fila. El `flex-1` de la izquierda es lo
    que la empuja — con carril, es el `CarrilCards` (§17.0); sin carril, un
    div vacío. Las dos mitades son obligatorias en los dos casos. */}
<div className="flex flex-col lg:flex-row lg:items-center gap-3">
    <div className="flex-1" />
    <div className="flex justify-end min-w-0">
        <FilterBar
            onClear={limpiar}
            activeCount={n}
            acciones={[
                { key: 'nuevo',  icon: Plus,     label: 'Nuevo Empleado', variant: 'primary', onClick: crear },
                { key: 'export', icon: Download, label: 'Exportar', tone: 'success', onClick: exportar },
            ]}
        >
            <FilterBar.Section label="sucursal"><FilterBar.Sucursal value={suc} onChange={setSuc} options={sucs} /></FilterBar.Section>
            <FilterBar.Section label="período"><PeriodPicker value={rango} onChange={setRango} /></FilterBar.Section>
            <FilterBar.Section label="estado"><FilterBar.Opciones value={estado} onChange={setEstado} label="Estado" options={estados} /></FilterBar.Section>
        </FilterBar>
    </div>
</div>
```

> **⚠️ Este ejemplo cambió el 2026-09-05, y el motivo importa.** Hasta esa fecha
> mostraba la `<FilterBar>` **suelta**, sin el envoltorio, y sus ranuras con
> `LiquidSelect` y `SegmentedControl` **crudos**. O sea: enseñaba las dos cosas
> que las subsecciones de más abajo prohíben —la píldora va a la derecha
> (tabla de «Dónde va») y el control lo elige `FilterBar.Opciones` por el número
> de opciones, no la vista—. Quien crea una vista copia lo primero que ve, no
> lee 380 líneas más abajo, así que **el ejemplo ganaba siempre**. Lo pagó
> Promociones: salió con la píldora pegada al borde izquierdo y un segmentado a
> mano, y hubo que corregirla dos veces.
>
> La regla de la derecha **ya estaba escrita** en la tabla de §«Dónde va — resuelto»;
> lo que faltaba era que el ejemplo la cumpliera. Un canon cuyo ejemplo
> contradice a su propio texto se lee por el ejemplo.

**La píldora donde vive TODO el filtro de la vista actual** — fecha, categoría,
sucursal, estado — **y todas sus acciones**. No es una decoración: es el lugar
único donde el usuario mira para saber qué está filtrando, para soltarlo y para
ver qué puede hacer con lo que quedó.

**Un filtro que solo afecta a UNA sección de la vista igual va en la píldora**
(corregido por el usuario, 2026-08-05). En el Tablero de Metas puse un selector
de sala suelto en el encabezado de la sección de gráficas, razonando que era «de
esa sección y no de la vista». Es la excusa exacta que rompe el canon: el usuario
no sabe que hay un filtro puesto hasta que hace scroll hasta ese encabezado, y la
píldora —que es donde mira— dice que no hay ninguno.

Si el recorte de verdad solo tiene sentido para una sección, entonces **que
filtre la vista entera**: en Metas, elegir una sala deja su tarjeta y sus
gráficas, que es más coherente que un recorte a media pantalla. Y si filtrar
todo no tiene sentido, entonces no era un filtro — era un selector de contenido,
y eso se resuelve con pestañas o con un `SegmentedControl` adentro de la tarjeta,
no con un control que parece un filtro y no está donde viven los filtros.

##### Las acciones son DESCRIPTORES, no JSX

`acciones` es un array, no un ReactNode, y eso no es capricho: el mismo botón se
dibuja de dos maneras muy distintas — `TabBarAction size="sm"` en la píldora de
escritorio, botón de clúster en la barra flotante táctil. Con JSX suelto la barra
flotante solo podría re-renderizarlo tal cual, que es como se llegó a tener
controles de 44px fuera del viewport a 390px.

| campo | qué hace |
|---|---|
| `key` `icon` `label` `onClick` | lo obvio |
| `variant` | `'primary'` (una sola por barra) o `'quiet'` |
| `tone` | color del ícono en `quiet` |
| `disabled` | |
| `activo` | es un interruptor: emite `aria-pressed` y se ve encendido en el clúster |
| `principal` | fuerza (o niega) el botón grande del clúster táctil. Por defecto lo es el `variant: 'primary'` |
| `as` `href` `target` `rel` | para la acción que NAVEGA — un enlace tiene que seguir siendo un enlace |
| `soloEscritorio` | no aparece en el teléfono |
| `rotuloFijo` | **opt-in y RARA — leer abajo antes de usarla** |

**`rotuloFijo` invierte quién cede el ancho, y por eso es rara.** Lo normal es
que el TEXTO de la acción sea lo primero que se suelta cuando falta ancho: el
ícono ya identifica y el rótulo sigue en el tooltip. Con `rotuloFijo` el texto
no cede nunca, así que la caja de acciones **se mide siempre con él** y lo que
se estrecha es el cupo de ranuras de filtro.

Sólo se justifica cuando un ícono mudo dejaría a alguien sin saber qué aprieta y
la consecuencia es cara. El caso legítimo del portal es **`MiCajaView`**: sus
cuatro acciones mueven dinero —«Iniciar turno», «Abrir caja»— y un `+` sin texto
no dice cuál es cuál.

**No es un adorno de énfasis.** El 2026-09-05 se lo puse a las DOS acciones de
Promociones «porque son LAS acciones de la pantalla», y el resultado fue una
píldora con dos botones larguísimos que no se compactaban ni faltando ancho.
Copié la forma de `MiCajaView` sin su motivo. Si dudás, no la pongas: la medida
de la fila decide mejor que el llamador.

`accionesExtra` es la escotilla ReactNode para lo que no es un botón: un `Badge`
de estado, un `LiquidSelect` de "copiar desde". Va al final de la píldora y a la
hoja de acciones en táctil.

`soloIcono: true` deja el botón sin texto **en escritorio** (el rótulo sigue vivo
en `label`/`title` para el aria y el tooltip). Es para la acción secundaria y
reconocible —Exportar, con el `Download` que ya es el ícono canónico de exportar
en el portal— que con texto le come a la píldora el ancho que necesitan los
filtros. En el clúster táctil sigue rotulado: ahí hay sitio y no hay hover que lo
revele.

##### `FilterBar.Opciones` — uno de N, sin elegir el control

**Hasta 3 opciones es `SegmentedControl`; de 4 en adelante, `LiquidSelect`.** Los
dos son lo mismo semánticamente y la diferencia es de ancho: un segmentado de 5
se come la píldora entera y deja al resto de las ranuras sin sitio. El umbral es
del canónico y no del llamador por el motivo de siempre — una decisión que se
toma vista por vista se toma distinto en cada vista.

```jsx
<FilterBar.Section active={estado !== ''} onClear={() => setEstado('')} label="estado">
    <FilterBar.Opciones value={estado} onChange={setEstado} label="Estado" icon={FileCheck}
        options={[{ value: '', label: 'Todos' }, …]} />
</FilterBar.Section>
```

Se lleva por delante los apaños de móvil: `ConteoDetailView` y
`ConteoInventarioView` forzaban `layout="block" columns={2}` porque el riel de
cuatro no entraba en la hoja del teléfono y arrastraba scroll horizontal. Y con
listas dinámicas —los subfiltros de "Mis Avisos" van de 2 a 6— el control se
adapta solo. `umbral` baja a 2 si las etiquetas son larguísimas; subirlo, casi
nunca.

**`tone` se reenvía al segmentado (2026-08-17), y esa prop faltante costaba el
canónico entero.** Solicitudes tenía DOS `SegmentedControl` escritos a mano
porque necesitaba `tone="neutro"` y `FilterBar.Opciones` no lo aceptaba. O sea
que una prop de menos empujó a la vista a saltarse el componente **y con él el
umbral**, que es justo lo que el umbral existe para impedir. Antes de escribir un
control a mano, mirar si lo que falta es una prop del canónico.

**Por qué un riel de 3 mide 710px y el mismo texto en select mide ~235.** No es
el texto: `SegmentedControl` pinta `font-black uppercase tracking-widest
whitespace-nowrap` —tres decisiones que multiplican el ancho y ninguna cede— y
`LiquidSelect` compacto pinta `text-body-sm` normal con `truncate`. Al estimar
si un riel entra, contar MAYÚSCULAS con tracking, no caracteres. Los 710 están
medidos sobre una captura del 2026-08-17 (píldora de ~1770); el 235 es estimado.

**Un conteo que vive en una opción APAGADA se pierde al plegar el control a
select.** Un select sólo muestra la opción activa, así que un número que estaba
ahí para avisar de lo que el filtro tapa desaparece justo cuando hace falta. Si
hay que plegarlo, el conteo se muda a la etiqueta de la opción PUESTA — y con una
palabra que diga de qué lado está, porque el mismo `· 5` significa «vas a ver 5»
en una opción y «no vas a ver 5» en la contraria.

> El caso que enseñó las tres cosas —el corte de traslados de Solicitudes— se
> **quitó por decisión del usuario el mismo 2026-08-17**, un día después de
> estrenarlo: la bandeja muestra todas las solicitudes. Las lecciones quedan
> porque son del canónico, no de ese control; el ejemplo ya no está en el código.
> La de fondo es la cuarta: esconder por defecto una familia entera obliga a
> construirle alrededor un conteo de lo tapado, una opción para destaparlo, un
> arranque por sucursal y una excepción en el enlace del aviso. Antes de esconder
> algo por defecto, probar si alcanza con poder filtrarlo.

##### Muchos chips en una ranura: casi siempre son UN select

Cuando una ranura junta media docena de chips, la pregunta previa es si son de
verdad filtros independientes. Casi nunca lo son: si todos contestan **la misma
pregunta** —"¿qué recorte de la lista quiero ver?"— entonces son un
`FilterBar.Opciones` con `umbral={0}`, no seis interruptores.

Se probaron las dos formas en MIN·MAX el 2026-07-30 y la de chips falla en dos
planos a la vez:

* **Rompe el cupo de la píldora.** El reparto cuenta *ranuras*, y ocho chips son
  UNA sola de ~700px: la píldora crecía hasta llenar la fila sin que el desborde
  llegara a activarse. Medido: 809px de píldora contra 1159 de fila.
* **Miente sobre cómo se usan.** Dibujados como ocho interruptores, dicen que se
  combinan; en la práctica nadie mira "excesos" y "sin historial" a la vez, y
  elegir uno apaga a los otros. El select dice eso, y ocupa 185px en vez de 700.

Cada opción lleva **su conteo en la etiqueta** (`261 Excesos`), que es el dato
por el que se elige, y las que dan cero no se listan.

**La acción que solo sirve dentro de una opción se muestra solo ahí.**
"Restaurar ocultos" salía en la píldora siempre que hubiera alguno oculto — o
sea, una acción permanente sobre filas que no están en pantalla, que es un
cambio a ciegas. Ahora aparece cuando la opción "Ocultos" está puesta.

##### `FilterBar.Sucursal` — la ranura de ámbito

La primera del orden y la que más se reescribía: estaba a mano en **9 vistas con
4 textos distintos** ("Todas las Sucursales", "Todas las sucursales", "Todas",
ninguno) y anchos de 150 a 220px, así que la misma ranura se veía diferente en
cada pantalla.

```jsx
<FilterBar.Sucursal value={sucursal} onChange={setSucursal} options={branchOptions} />
```

El texto canónico es **"Sucursales"**: nombra el filtro en vez de describir su
estado vacío, así se lee igual esté puesto o no, y ocupa la mitad — que es el
espacio que la píldora le devuelve a los filtros. **Normaliza también la opción
"todas" que venga dentro de `options`**, que es la mitad del arreglo: casi todas
las vistas la traen ahí con su propio texto, así que el select mostraba ese label
y no el placeholder, y "Todas las Sucursales" en 150px se corta a "Todas las
Suc…". El valor no se toca, solo cómo se lee.

**El divisor las separa de los filtros**, y por eso ahora pueden convivir: lo que
en su día echó a "Publicar" de acá fue que, mezclado entre las ranuras, leía como
un filtro más.

##### Dónde va — resuelto (2026-07-27)

**La barra de filtros va en el CUERPO de la vista, bajo el título. Nunca en el
header.** El header ya tiene su ocupante: la barra de pestañas.

Esto costó una corrección del usuario y vale documentar por qué me equivoqué,
porque la trampa sigue ahí para el próximo:

`GlassViewLayout` tiene una prop llamada **`filtersContent`**, y renderiza su
contenido en la fila del título con `justify-end`. Al ver 37 vistas usándola
concluí que ése era el lugar canónico de los filtros. **Falso**: al mirar qué
le pasan, **22 de ellas le pasan un `ViewTabBar`** — o sea las pestañas de la
vista, no filtros. La prop está mal nombrada, y ese nombre fue exactamente lo
que me hizo leer mal el código.

| ranura | qué va | dónde |
|---|---|---|
| `filtersContent` de `GlassViewLayout` | **`ViewTabBar`** (pestañas) y el buscador | fila del título |
| `FilterBar` | los filtros de la vista | **cuerpo**, bajo el título, a la derecha |

Las 3 vistas que comentaban *"Filter pill — vive en el body, no en el header"*
tenían razón desde el principio. Ventas, Compras, Proveedores y Staff quedaron
bien.

**Filtros sueltos sin contenedor: prohibido.** Son 17 vistas hoy. Sin píldora no
hay orden de ranuras, no hay limpiar-todo y en móvil no hay cuenta de filtros
aplicados.

El divisor también tenía dos escrituras —`h-5 w-px bg-divider` y `w-px h-6
bg-divider`— y por eso una auditoría por grep veía la mitad. Con `FilterBar` el
divisor lo pone el contenedor y esa divergencia deja de ser posible.

#### 17.3 `BarraFlotante` — los controles al alcance del pulgar (solo táctil)

`FilterBar` vive en el cuerpo de la vista, y en una pantalla de captura larga
—el conteo son 2,500 renglones— eso significa que después de tres pantallas de
scroll el filtro y el botón de agregar **dejaron de existir**. Con mouse no pasa:
la píldora está a la vista junto con la tabla.

Un clúster fijo abajo a la derecha con **buscador, acciones y la acción
principal**, que se esconde al bajar y vuelve al subir.

**No se usa a mano, y no hay que cablearle nada.** En táctil `FilterBar` **es**
esta barra — el canónico decide, igual que `LiquidSelect` abre `SelectorTactil`
solo. Los tres elementos aparecen sin que la vista escriba una línea:

| elemento | de dónde sale |
|---|---|
| buscador | lo publica `ViewTabBar` por el canal de `CanalDeVista.js` |
| filtros | los `FilterBar.Section` de la propia píldora |
| acción principal | el `acciones[]` con `variant: 'primary'` |

**El buscador NO se pasa dos veces.** Hasta el 2026-07-30 había que dárselo
también a `FilterBar` con `buscador={{…}}`, y de 22 vistas lo hacía **1**. No fue
descuido: el mismo dato había que escribirlo en dos sitios y la copia que falta no
se ve rota hasta abrir la vista en un teléfono. En las 5 pestañas de Productos era
además **imposible** — el estado del buscador vive en `ProductosView` y las
pestañas solo reciben el término ya rebotado, nunca el setter.

`buscador` sigue existiendo como override explícito, para la vista cuyo buscador
no sea el del header.

##### `CanalDeVista.js` — el cable entre las dos píldoras

Las dos píldoras son **hermanas**, no una descendiente de la otra:
`GlassViewLayout` recibe `ViewTabBar` por `filtersContent` y `FilterBar` por
`children`. Un contexto declarado en cualquiera de las dos no llega a la otra, así
que el proveedor lo monta `GlassViewLayout`, el único ancestro común. Dos canales,
en sentidos opuestos:

- **buscador** — `ViewTabBar` publica → `FilterBar` consume.
- **barra** — `FilterBar` publica → `ViewTabBar` consume, y con eso el header
  **no dibuja su lupa en táctil**. Dos accesos al mismo buscador, uno de ellos
  arriba y que se va con el scroll, es peor que uno solo bien puesto.

Sin proveedor (un `FilterBar` dentro de un modal) los hooks devuelven `null` y
todo se comporta como antes.

Dos trampas del canal, las dos costaron:

- **Un `Map` por publicador, no un `useState`.** `filtersContent` se renderiza
  DOS VECES en `GlassViewLayout` (rama de escritorio y rama de móvil, y está
  bien — ahí está documentado por qué), así que hay **dos `ViewTabBar` montados
  publicando a la vez**. Con un `useState`, desmontar la copia oculta al cruzar
  el breakpoint borraría lo que publicó la copia viva.
- **El alta y la baja van en efectos SEPARADOS.** Juntas, en un efecto sin array
  de dependencias, la limpieza corre en cada render — y borrar del `Map` siempre
  lo cambia, así que siempre notifica. Con dos canales apuntándose entre sí eso
  es un bucle cerrado: React #185 ("Maximum update depth exceeded") y la vista
  entera al ErrorBoundary. La baja lleva deps `[canal, id]` y corre solo al
  desmontar.

`flotante={false}` vuelve al botón + hoja inline. Hace falta si un `FilterBar`
vive DENTRO de un modal: la barra va por portal al `body` en capa 40 y quedaría
detrás del modal (capa 100). Hoy ninguno lo hace — los tres usos en modales son de
`FilterBar.Chip`, no del contenedor.

**Elegida sobre cinco anatomías mockupeadas.** Gana por ser la más compacta (94px
con rótulos, pegada a la derecha) y por lo tanto la que menos lista tapa. Dos
reglas la sacan de ser el antipatrón de "tres íconos iguales":

| | |
|---|---|
| **La principal se ve distinta** | Rellena y más grande. Crea algo; las otras ABREN algo. Dibujarlas iguales las hace leer como pares cuando una es la principal. |
| **Los disclosures llevan su estado** | Un ícono dice dónde está el control, no qué está aplicado. El buscador se estira a campo con el término visible; las acciones llevan `Contador`. Sin esto la barra muestra la puerta y esconde el contenido. |

**Los rótulos bajo el ícono aparecen solos cuando hay más de un botón** — con uno
el ícono no compite con nada y el rótulo es ruido. Van debajo y no en un `title`:
en táctil no hay hover, así que un `title` no existe.

**El buscador se estira, no cambia de modo.** El campo crece en el lugar y los
otros botones se quedan; la alternativa (una fila propia arriba) se descartó por
lo mismo que otra variante: dos anatomías en la misma barra. Medido, el área de
tecleo es **160px a 390px de viewport y 90px a 320px** — los 90 de un iPhone SE
son ~6 caracteres, y es lo que da la física con tres controles rotulados. Alcanza
porque es búsqueda incremental. Y el buscador **no** va en hoja: mientras se
escribe hay que ver la lista filtrarse, o no se sabe cuándo parar de teclear. Los
filtros sí, porque se aplican y se cierran.

Tres cosas que costaron y conviene no re-descubrir:

- **Portal al `body`, obligatorio.** Un `fixed` dentro de un ancestro con
  `transform`, `filter` o `z-index` queda contenido por ese ancestro. El
  comentario de la nav inferior de `AppLayout` ya lo decía: *"hermano directo del
  root … el fixed anidado era lo que standalone no pintaba"*.
- **El corte es 719px, el de `FilterBar`** — no `md` (768). Si divergen queda una
  franja de 50px con las dos cosas visibles, o ninguna.
- **`type="text"` con `inputMode="search"`, nunca `type="search"`:** WebKit le
  dibuja al segundo su propia ✕ y salían **dos** botones de limpiar, el nativo
  gris y el del portal. Es la regla cero-nativo — el cromo del navegador no se
  estiliza, se evita.
- **El material sale de `data-surface`, no de clases Tailwind.** Con
  `bg-surface-card border border-border-card` el clúster salía SIN vidrio en Liquid
  Glass: las clases dan el color, pero el `backdrop-filter` lo aplica
  `data-surface` en index.css. Es la misma lección que ya estaba escrita en
  `GlassViewLayout`.
- **El contenedor `fixed` NO se transforma — era el bug del vidrio (2026-07-30).**
  Animaba su entrada con `translate-y-*`, y un ancestro con `translate` establece
  un *backdrop root*: el `backdrop-filter` del clúster muestreaba un fondo VACÍO y
  no difuminaba nada. El usuario lo reportó como *"el liquidglass del filterpill no
  es liquidglass, no se ve a través de él como el header u otra card"*. Tercera vez
  que el proyecto se tropieza con esta regla — index.css ya la documenta para el
  sidebar móvil, con el mismo síntoma medido en un iPhone 13. La animación se movió
  al elemento que lleva el vidrio: un `transform` **propio** no crea backdrop root,
  solo uno **ancestro**. Es por eso que el vidrio de `ViewTabBar` sí funciona
  teniendo `transform-gpu` en el mismo div que su `data-surface`.
- **Y la superficie es `dropdown`, no `card` — medido, no heredado.** Con el blur
  ya vivo se compararon las tres superficies existentes sobre la lista de empleados
  a 390px, con las filas pasando por detrás:

  | | resultado |
  |---|---|
  | `card` (16%) | "SALUD 2" se lee ENTERO y cae encima de "ACCIONES". Es vidrio, pero ilegible |
  | `dropdown` (72%) | lo de atrás queda fantasma, los rótulos del clúster limpios |
  | `modal` (85%) | ya no deja ver nada; es un panel |

  O sea que `dropdown` era la elección correcta **por la razón equivocada**: se
  había subido a 72% para compensar un blur que no existía. Con el blur andando el
  72% es vidrio esmerilado de verdad —se ve el color y el movimiento de la lista a
  través— y cumple el criterio que index.css ya fija para lo que flota sobre
  contenido: que lo de atrás sea LUZ, no texto. `sheet` (98.5%) no sirve acá:
  **su radio es 0**, está pensada para una hoja que llega a los bordes.

  **No agregar una superficie nueva para esto.** La paleta es CERRADA (§6.0).
- **`transition-transform` va como utilidad de Tailwind.** `dropdown` no declara
  `transition` propia en index.css, así que la utilidad manda sin pelearse con
  nada. Y tiene que ser `transition-transform` y no `transition` a secas: en
  Tailwind v4 esa utilidad cubre `translate` además de `transform` —son
  propiedades CSS independientes y `translate-y-*` compila a la segunda—, así que
  sin ella la barra saltaría en vez de deslizarse.
- **El rótulo del botón va a dos líneas, no `truncate`.** En los 60px de la
  columna, "NUEVO EMPLEADO" salía "NUEVO E…", y un rótulo cortado a la mitad no
  dice qué hace el botón — que es justo para lo que está. `line-clamp-2` acota el
  peor caso.
- **El clúster no crece sin límite.** A 320px entran tres columnas de 60px y poco
  más, así que: la principal se dibuja aparte, UNA acción secundaria puede tener su
  propio botón, y de dos para arriba se agrupan tras un botón "Acciones" que las
  abre en hoja. Máximo cuatro columnas.
- **Una sola barra a la vez.** Los tabs de Productos se montan TODOS y se ocultan
  con `hidden`, así que había **tres** clústeres apilados: el portal al `body` los
  saca del subárbol oculto, que es lo que los volvía visibles. `FilterBar` deja un
  ancla de 1px en el flujo normal y un `IntersectionObserver` decide — un elemento
  en `display:none` no intersecta, y cambiar de tab no desmonta nada, así que hace
  falta enterarse en los dos sentidos.

#### 17.0 Medidas fijas: la tarjeta, el carril y el cupo de ranuras (2026-07-30)

**Aprobado sobre mockup antes de escribir código.** Las tres piezas y su orden
de prioridad salieron de simular la vista más cargada del portal (Personal: 5
tarjetas, 3 filtros, 3 acciones) entre 1024 y 2560px.

| pieza | medida |
|---|---|
| `StatCard` | mínimo **148**, máximo **200**, separación 8, cupo **5** |
| detalle de la tarjeta | cede bajo **176** |
| `CarrilCards` | **una sola fila**, siempre; lo que no entra se desliza |
| ranura de `FilterBar` | 150 (el control) + 8 de relleno |
| píldora | sin techo: **lo que mida mostrando todo** |

**Quién cede el ancho, en orden:**

1. el **detalle** de la tarjeta (dato terciario)
2. el **texto** de las acciones — y solo lo reclama de vuelta si el carril ya
   muestra las cinco
3. el **carril** se desliza
4. las **ranuras vacías** van al control de desborde
5. **nunca** una ranura aplicada

Medido después de implementarlo, en Personal: 1280→2 tarjetas · 1440→3 ·
1512→4 · 1728→5 · 1920→5 con detalle. Monótono: al agrandar la ventana nunca se
ve menos que antes.

##### El carril y la píldora van en UNA fila — y hay un gate (2026-08-05)

```jsx
<div className="flex flex-col lg:flex-row lg:items-center gap-3">
  <CarrilCards className="flex-1" ariaLabel="…">…</CarrilCards>
  <div className="flex justify-end min-w-0"><FilterBar …>…</FilterBar></div>
</div>
```

Canónico: `StaffManagementView.jsx`. Las **dos** mitades son obligatorias — el
`lg:flex-row` del contenedor y el `flex-1` del carril.

**No es estética, y ahí está la trampa.** `useMedidaFila` (`FilterBar.jsx`) mira
al **abuelo** de la píldora y busca el carril con `querySelector('[role="group"]')`.
Con la píldora en su propio renglón lo **encuentra igual** —es hermano dentro del
mismo contenedor— y le descuenta `RESERVA_CARRIL` (2×148+8+10 = **314px**) por un
carril que no está a su lado. O sea: **el layout equivocado no falla, le roba
314px a la píldora en silencio**, y todo el reparto de arriba asume la fila
compartida.

**Una excepción medida NO se copia.** `ClientesView` tiene el carril y la píldora
en renglones separados con un comentario que lo justifica por medición (su
píldora son 975px con tres ranuras y tres chips, y a 1440px no entran junto a
cinco tarjetas). Ese razonamiento vale **para esa píldora**. El 2026-08-05 se
copió ese layout a una pestaña nueva cuya píldora son **dos chips** —entraba de
sobra— y se heredó la excepción sin el motivo. Antes de separarlos hay que
volver a medir *esta* píldora; si no se midió, va el canónico.

**Y verificar a dos anchos, siempre**: a 1280 el carril debe deslizar y la
acción quedar en ícono; a 1600 todo entra. El cambio de layout destapa
truncamientos que antes no se veían, porque la tarjeta se angosta a 148px.

**La píldora NO baja de renglón, nunca — el que cede es el carril** (regla del
usuario, 2026-08-09). Nada de `flex-wrap`/`lg:flex-wrap` en esa fila, y el
carril se queda con `flex-1` (base cero). Si el ancho no alcanza, lo que se
esconde son las **tarjetas**, que para eso el carril desliza. Ese día se probó
lo contrario —`lg:basis-auto` en `CarrilCards` y `lg:flex-wrap` en las 17 filas,
para que el carril arrancara en el ancho de su contenido y los filtros bajaran
cuando no entraban— porque un instrumento contaba 18 «carriles recortados». Un
carril recortado al lado de la píldora **no es un defecto**: su piso real son los
314px que `FilterBar` le reserva, o sea dos tarjetas enteras y la tercera
asomando. Dos consecuencias para quien vuelva a medirlo:

* el detector de `gate:design` daba `lg:flex-row lg:flex-wrap` por buena (la
  primera rama del OR se cumplía y no miraba el wrap) — corregido: `flex-wrap`
  descalifica aunque esté el `lg:flex-row`;
* la regla 2 de `tests/e2e/medicion-escritorio.js` exceptúa al carril que
  comparte fila con `[data-pildora]`, porque su pregunta —«¿habría entrado en la
  ventana?»— siempre da que sí cuando lo que aprieta es la píldora de al lado.

Lo vigila la categoría **`carril-pildora`** de `gate:design`, agregada el
2026-08-05 justamente porque la regla ya estaba escrita en tres lugares —acá, en
la memoria del proyecto y en el comentario de `ConteoInventarioView`— y se
rompió igual. Arrancó con **15 hallazgos en 10 vistas** de deuda preexistente,
así que va por ratchet: no se puede agregar uno nuevo, y los 15 se bajan vista
por vista con verificación visual (cada una necesita sus dos anchos, no es un
cambio mecánico).

##### El cupo es de la VISTA, no del dato (2026-07-31)

Las otras tres medidas de la tabla son de la tarjeta y viven en sus clases
(`basis-[148px]`, `max-w-[200px]`, `gap-2`). **El cupo de 5 no es una medida: es
un presupuesto del llamador**, y por eso era la única que se podía romper sin
que nada avisara — la escribía la vista, no el canónico.

La regla, dicha entera: **cuántas tarjetas hay lo fija la vista, nunca el dato.**
Un carril de largo variable es un desglose por categoría disfrazado de métricas,
y un desglose contesta **una sola pregunta** —qué recorte quiero ver— dibujada
como N preguntas independientes. Su lugar es una ranura de la píldora
(`FilterBar.Opciones`, `umbral={0}`) **con el conteo en cada opción**, que además
le da la función que como tarjeta no tenía: filtrar.

Ya se resolvió así dos veces, y las dos midiendo:

| vista | antes | después |
|---|---|---|
| MIN·MAX (v2.261.0) | 8 chips de estado, ranura de ~700px | select: píldora 809→640, carril 338→474 (2→3 tarjetas visibles) |
| Facturación · Observaciones (v2.314.0) | 1 + una tarjeta por código de anomalía (6, techo abierto) | 2 tarjetas fijas + ranura "Observación" |

Lo vigila un `console.warn` de dev en `CarrilCards` y no el `design-gate`: el
conteo real sólo existe en ejecución — un `.map()` sobre datos no se cuenta
leyendo el JSX. Avisa en vez de recortar; quedarse con las primeras cinco
escondería métricas en silencio.

##### El ancho se MIDE, no se estima

El primer intento modelaba cada acción en 150px y **se equivocaba por 62 en una
sola píldora**: las medidas reales en Personal son "Nuevo Empleado" 166, "Nuevo
Practicante" 186, "Exportar" (solo ícono) 36. El ancho de una acción es el de su
rótulo, así que ninguna constante lo representa.

`FilterBar` mide las piezas reales en un `useLayoutEffect` —que corre **antes**
del pintado, así que el usuario nunca ve el estado sin degradar— y guarda la
medida hasta que cambien los rótulos. Lo único que sí es constante es la forma
degradada: un botón sin rótulo mide `w-9` = 36px siempre.

**Se observa la FILA, no el envoltorio de la píldora.** El padre ajusta al
contenido —o sea a la píldora—, así que medirlo es un bucle: crece, se mide más
grande, entra otra ranura, crece otra vez. Medido con el padre: la píldora
quedaba clavada en 748px y 2 ranuras de 1280 a 2240px.

##### Cuándo lleva color una tarjeta

**Por defecto NO lleva.** Todas las tarjetas del portal comparten el mismo
vidrio: `data-surface="card"`, siempre. Que una fila mezcle fondos hace que se
lea como cinco componentes distintos en vez de una métrica repetida cinco veces.

| pieza | ¿color? | por qué |
|---|---|---|
| el **número** (`valueCls`) | sí | rojo si es pérdida, verde si es meta: ahí el color ES el dato |
| el **ícono** (`iconBg`+`iconCls`) | sí | identifica la categoría de un vistazo |
| el **fondo** y el **borde** | **no** | solo el estado seleccionado, vía `tono` |

`tono` marca la tarjeta SELECCIONADA y nada más. Se dibuja con `data-tono`
(§5.1) — un anillo del color pegado al borde, no un relleno— y su paleta es
cerrada: `brand`, `success`, `warning`, `danger`.

**Se retiraron `activeBg` e `inactiveBg`**, que recibían clases sueltas de cada
vista: 19 call sites, cada uno con su tinte de fondo y de hover. Y cuando una
vista pasaba `inactiveBg` la tarjeta **perdía `data-surface`**, así que en la
misma fila había tarjetas con vidrio y tarjetas casi transparentes.

##### El rótulo: dos palabras, tres a lo sumo

El rótulo nombra la métrica; el matiz va al `sub`. "Modificados este mes" en una
tarjeta de 148px sale "Modificados e…", que no nombra nada — es `Modificados` +
sub `precios o datos cambiados`.

##### El número encoge antes que cortarse

`$249,456.38` no entra a `text-title-sm` en 148px, y truncado queda `$249,4…`.
El cuerpo baja a `text-body-lg` sobre 6 caracteres y a `text-body` sobre 9: el
número se lee **entero** sin que la tarjeta cambie de ancho, que es lo que
mantiene la fila pareja.

##### `CarrilCards`

Las tarjetas vivían en un `flex-wrap` y eso hacía dos cosas mal: envolvían
—Ventas daba 1, 2, 3 y 4 por fila entre 1280 y 1920— y **la huérfana de la
última fila crecía hasta llenarla sola** (en Personal a 1920: cuatro de 172px y
una de **726**).

- El sobrante **no se tira**: la pista ocupa todo el carril, así que lo que queda
  después de las tarjetas enteras se ve como el borde de la próxima. Un asomo
  dice "hay más" mejor que las flechas solas.
- **Las flechas flotan**, no ocupan. En el flujo se comían 64px de los 438
  disponibles a 1512px: media tarjeta.
- Reserva fija de 2 tarjetas: una sola cortada parece un error de maquetación,
  no un carril.

#### 17.0.0 Medidas fijas — versión anterior (2026-07-30)

**La `StatCard` mide 200px SIEMPRE.** Antes era `flex-1 basis-0 min-w-[150px]`,
o sea que se repartía el espacio disponible — y la MISMA tarjeta medía distinto
en cada vista y en cada monitor. Medido antes del cambio:

| ancho | Ventas (4 tarjetas) | Personal (5) |
|---|---|---|
| 1280 | 1 por fila | 2 por fila |
| 1512 | 2 | 2 |
| 1728 | 3 | 3 |
| 1920 | 4 | 4 |
| 2240 | 4 | 5 |

Y la tarjeta **huérfana** de la última fila crecía hasta llenarla sola: en
Personal a 1920px había cuatro de 172px y **una de 726px**. Con ancho fijo, si no
caben envuelven y si sobran deja espacio — pero todas se ven iguales.

**La píldora tiene un cupo fijo de 3 ranuras** (`MAX_RANURAS`); el resto va tras
un `···` que las despliega en un panel anclado. Antes crecía con lo que cada
vista le metiera: medida a 1512px iba de 189px a 782px, así que le robaba a las
tarjetas un ancho distinto en cada pantalla.

**Las ranuras APLICADAS nunca se esconden.** Es lo que hace que el cupo no rompa
la premisa de §17 —"el lugar único donde el usuario mira para saber qué está
filtrando"—: esconder un filtro activo dejaría la vista recortada sin nada
visible que lo explicara. Se esconden las vacías, y el botón lleva un `Contador`
con cuántas de las guardadas están aplicadas.

Y se **eligen** por prioridad pero se **dibujan** en su orden original: el orden
de ranuras (ámbito → entidad → tiempo → estado) es el orden en que una persona lo
diría en voz alta, y reordenarlo al aplicar un filtro haría que la píldora
cambiara de forma con cada clic.

#### 17.0.1 El rango de fechas se escribe compacto

`PeriodPicker` mostraba `01/07/2026 → 30/07/2026`: 23 caracteres, ~250px, para
decir dos días del mismo mes — la ranura más ancha de la vista con más ranuras
del portal. **El año se escribe una vez y solo si hace falta**: dentro del año en
curso no se escribe (nadie lee "2026" para enterarse de que estamos en 2026), en
otro año va corto y una sola vez al final, y solo si el rango cruza de año se
escribe en los dos extremos — que es cuando de verdad desambigua.

| rango | antes | ahora |
|---|---|---|
| dentro del año en curso | `01/07/2026 → 30/07/2026` | `01/07 → 30/07` |
| otro año | `01/03/2025 → 30/06/2025` | `01/03 → 30/06/25` |
| cruza de año | `01/12/2025 → 15/01/2026` | `01/12/25 → 15/01/26` |

Los presets siguen ganando: un rango que coincide con "Este mes" o con un mes
entero se muestra por su nombre, no por sus fechas.

#### 17.1 `PeriodStepper` — correr el período

```jsx
<PeriodStepper
    unit="quincena" label="16 – 31 julio de 2026"
    isCurrent={esActual} nextDisabled={esActual}
    onPrev={anterior} onNext={siguiente} onReset={irAHoy} />
```

Va **dentro de una `FilterBar.Section`** cuando filtra la vista, o en la
cabecera de un widget con `size="sm"`.

Salió de medir, no de una idea previa: el mismo control estaba escrito a mano
**siete veces con cinco anatomías distintas** —quincena, semana (×2), año, y
tres variantes en el Inicio—, cada una con su tamaño de flecha, su ancho de
etiqueta y su forma de contenedor.

| | |
|---|---|
| `unit` | **obligatorio**. Arma el nombre accesible de las dos flechas; sin él un lector de pantalla anuncia "botón, botón". |
| `onReset` + `isCurrent` | **la etiqueta ES el atajo de vuelta**. En las tres vistas donde uno podía alejarse del período actual había tres formas distintas de volver: un botón aparte, una × de reset, y nada. Sin `onReset` el rótulo es un `<span>`, no un botón muerto. |

**No confundir con:** `TablePagination` (paginar es navegar una lista, no
correr el tiempo) ni `PeriodPicker` (elegir un rango arbitrario). Acá el
período dura siempre lo mismo y solo se mueve hacia atrás o hacia adelante.

#### 17.1.1 Escanear un código — `onEscanear`

`ViewTabBar` acepta `onEscanear`, y lo publica junto con el resto del buscador
por el canal de vista. Eso hace que el botón de cámara aparezca **en los dos
lados**: dentro del campo del encabezado en escritorio, y dentro del campo
abierto de la barra flotante en táctil. Publicarlo por el canal y no cablearlo
a mano es lo que evita que escanear exista en la computadora y no en el
teléfono, que es justamente donde se escanea.

El lector es `LectorDeCodigo` (`components/common/`), y va montado **sólo
mientras está abierto**, detrás de `lazy` + `Suspense`: montarlo siempre haría
que `lazy` bajara su trozo al entrar a la vista y no habría diferido nada
—medido: 2 kB del cierre estático de `ConteoDetailView`, que su techo del
`bundle-gate` vio enseguida—.

**Escanear escribe en el buscador, no salta al producto.** Así el resultado se
ve con el mismo filtro que el resto, se puede corregir a mano, y si el código no
está en esa pantalla la vista lo dice en vez de no hacer nada.

**Su vista de cámara es la única excepción de color del portal** (`white` y
`shadow-literal` en `design-gate`): el `<video>` muestra lo que ve la cámara, no
el tema. El fondo tiene que ser negro —cualquier token se lee como un error de
encuadre—, la guía tiene que contrastar contra lo que sea que haya enfrente (una
caja blanca, un estante a contraluz) y no contra el fondo de la aplicación, y la
«sombra» de 9999px no es una sombra sino el anillo que oscurece lo que queda
fuera de la guía. El motivo está escrito también en `EXCEPTIONS`.

#### 17.2 `TablePagination` — paginación

```jsx
<TablePagination page={pagina} totalPages={paginas} onPageChange={setPagina}
    pageSize={tam} onPageSizeChange={setTam} total={1284} unit="ventas" />
```

Existe desde antes y lo usan 17 vistas; se **reescribió el 2026-07-27** sobre
siete problemas medidos:

1. El orden estaba al revés — "¿cuántos hay?" vivía en el extremo derecho.
2. Eran **tres islas** separadas por `justify-between`: en pantalla ancha leían
   como tres controles sin relación.
3. El tamaño de página y la página activa usaban **el mismo `bg-brand`**, así
   que competían por significar "activo".
4. **13 paradas de tabulación** para pasar de página.
5. `framer-motion` (§11 dice "no agregar más"), y su `layoutId="activePage"`
   hacía que la píldora **volara entre dos paginaciones** si había dos en
   pantalla.
6. Sin `<nav>` ni `aria-live`.
7. En móvil se partía en tres filas y empujaba la tabla fuera de la pantalla.

**Ahora:** una sola píldora de 52px, orden de lectura (rango → navegación →
tamaño), **4 controles en vez de 13**, `<nav aria-label>` con `aria-live` en el
rango, y el hover sale de `--lift-hover` — en Solid no se levanta.

- **El rango, no el total.** `1–25 de 1,284` responde "dónde estoy" y "cuánto
  hay" a la vez; el total solo no decía dónde estabas.
- **Sin números de página.** En 52 páginas nadie salta a la 37 mirando. El
  "pág. 1/52" es clickeable y se vuelve un campo — así el viejo "Ir a" deja de
  ocupar espacio permanente para una acción rara.
- **Móvil (<720px):** una fila de ancho completo, flechas de 40px pegadas a los
  bordes donde llega el pulgar, estado al centro en dos líneas. El selector de
  tamaño desaparece: nadie cambia cuántas filas ve desde un teléfono.
- **Primera y última** (2026-08-22, pedido contando inventario). Los dos únicos
  saltos que se hacen sin pensar el número. Escribirlos en el campo obliga a
  saber cuántas páginas hay, y «última» ni siquiera es un número fijo: cambia
  con el filtro. Salen sólo con **más de una** página (en el teléfono, con más
  de dos: con dos, «primera» hace lo mismo que «anterior» y son dos blancos de
  40px comiéndole el ancho al rango del medio).

**Nunca escribir la paginación a mano.** Y no es un `SegmentedControl`: aunque
se comporta como uno-de-N, `role="radiogroup"` es incorrecto para un lector de
pantalla — paginar es navegar, no elegir una opción de un grupo.

