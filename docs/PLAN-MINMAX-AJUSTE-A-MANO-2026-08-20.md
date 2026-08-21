# Que el recálculo mensual no pise el ajuste a mano — hallazgo y plan (2026-08-20)

**Estado: fase 1 APLICADA** (2026-08-21, migración `20260821041336`). El resto
sigue sin tocarse. Las mediciones de §2 son lecturas contra producción anteriores
a cualquier cambio.

**Prueba de salida de la fase 1, cumplida:** las 19,041 filas conservan
`min_units`/`max_units` **byte por byte** — huella `6c5bd0fe6b7f323dfdf3d41a6532da5e`
idéntica antes y después, suma MIN 246,533 y suma MAX 379,537 sin variar, y 0
filas con motivo. No cambió un solo número, que era la condición.

El MIN·MAX es el inventario y el capital de la empresa. El criterio de este plan
no es «agregar una función»: es que **ninguna fase pueda cambiar un número que
hoy nadie pidió cambiar**, y que la única fase que sí toca la fórmula quede
separada, medida, y sea opcional.

---

## 1. En cinco líneas

Cuando alguien corrige un MIN o un MAX a mano, el portal escribe el número
**directo sobre `min_units`/`max_units` y no deja ninguna marca** de que fue una
decisión humana. El recálculo mensual propone su propio número y al publicarlo lo
sobrescribe. Medido: de 969 pares producto·sala ajustados a mano antes del
recálculo del 1-ago y nunca vueltos a tocar, **567 (59%) ya no tienen el valor
que se les puso**. En 143 de esos casos alguien había **bajado** el MAX y el
cálculo se lo **volvió a subir**, devolviendo **1,340 unidades**.

---

## 2. Lo medido

### 2.1 El trabajo manual que se pierde

| | |
|---|---|
| ediciones a mano registradas desde el 2026-06-11 | **7,590** (6,927 sobre borrador + 663 sobre el valor vigente) |
| pares producto·sala ajustados antes del 1-ago y **no vueltos a tocar** | **969** |
| de esos, con un valor distinto del que se puso | **567 (59%)** |
| «lo bajé y el cálculo me lo volvió a subir» | **143** |
| unidades de MAX que ese rebote devolvió | **1,340** (+11.3 por caso) |

**Salvedad del método:** 3,316 de las 6,927 ediciones sobre borrador son de un
formato de bitácora anterior y no guardan el antes/después, así que no son
comparables. Los porcentajes de arriba salen de las que sí lo traen. Y «pisado»
no distingue con total certeza el recálculo de una publicación posterior, aunque
se excluyó todo par que alguien volvió a tocar a mano después del 1-ago.

### 2.2 La dirección dominante NO es la que se supone

De 3,600 ediciones con antes/después comparable:

| | MAX |
|---|---|
| lo **subieron** | **2,747** |
| lo bajaron | 390 |
| lo dejaron igual | 463 |

El reclamo más frecuente contra el cálculo no es que infle: es que **se queda
corto**. Cualquier cambio que sólo apunte a «bajar lo inflado» estaría
optimizando el caso minoritario.

### 2.3 Hay DOS motivos para bajar un MAX, y hoy se ven idénticos

Mirando la venta real mes a mes de los casos con más unidades en juego, aparecen
dos poblaciones que no tienen nada que ver entre sí:

| Producto · sala | Cálculo | A mano | Le devolvió | Venta por mes |
|---|---|---|---|---|
| BENZOCLID DUO · Salud 1 | 262 | 100 | 260 | 51·226·231·346·277·194·148·50 |
| ESPASMO DIGESTOMEN · La Popular | 136 | 0 | 133 | 20·170·164·133·142·125·81·60 |
| **OMEPRAZOL BALAXI · Salud 1** | 33 | 30 | **289** | **Jun:430 Jul:110 — nada más** |
| **JERINGA INSULINA · La Popular** | 100 | 25 | 28 | **Mar:13 Abr:87 — y se acabó** |
| **LUBRICANTE VIVE · Salud 1** | 14 | 8 | 14 | **Feb:6 Abr:5 May:53 Jun:21** |
| **NUTRILON PEPTI JUNIOR · Salud 5** | 4 | 2 | 5 | **Abr:9 May:8 — y se acabó** |

Los dos primeros **venden todos los meses, sostenido**. Ahí la persona no
discute la demanda: pone un tope de cuánto quiere tener en sala, y el cálculo
tiene razón sobre la demanda. Los cuatro resaltados son un **episodio que se
apagó** —una fórmula infantil que el paciente dejó de consumir, un lote de
jeringas, un mes de promoción— y el promedio de 180 días lo sigue tratando como
demanda viva. El OMEPRAZOL es el más grosero: vendió en junio y julio, nada
desde entonces, y el sistema quiere 289 unidades en sala.

De los 143 casos de rebote, **35 no han vendido ni una unidad en los últimos 30
días**. Ése es el tamaño real del caso «ya no rota»; el resto son topes
operativos.

### 2.4 El contexto general

De 10,194 pares producto·sala con MIN·MAX vigente en salas, **3,713 (36%) no
vendieron ni una unidad en los últimos 30 días** y sostienen **15,311 unidades de
MAX**; 1,231 de ellos son clase A/B. No todos son demanda muerta —hay
estacionalidad y venta esporádica legítima— pero es el orden de magnitud.

### 2.5 El campo del motivo YA EXISTE y ya se usa bien

`minmax_change_requests.reason` está escrito en **16 de 17** solicitudes. El
problema no es que falte el campo: es que ese flujo se usó **17 veces contra
7,590 ediciones directas**. Quien tiene permiso de editar lo hace en la celda,
sin motivo, y nadie se lo pide.

Las 16 razones reales se agrupan solas. Éstas son sus propias palabras:

| Grupo | Lo que escribieron |
|---|---|
| Ya no rota / sólo por encargo | *«Se dejo de vender, se traera solo por encargo»* · *«PORQUE SOLO SE TRAE POR ENCARGO»* · *«Cliente ya no la compra»* · *«No tiene rotacion en sala»* · *«Bajo su venta»* · *«No se venden»* |
| Lo están buscando | *«CLIENTE HA BUSCADO POR SEGUNDA OCASIÓN»* · *«producto buscado y no lo teniamos»* · *«lo estas buscando seguido»* · *«lo esta buscando»* |
| Cliente fijo | *«ajustar ya que un cliente compra 20 cada 2 meses»* · *«CLIENTE DISMINUYO COMPRA»* |
| Por presentación | *«PREFIERO QUE VENGAN LAS CAJAS COMPLETAS QUE SOLO BLISTERS. POR LA DIFERENCIAS DE LOTES»* |
| Más rotación / sustitución | *«POR MAS ROTACION»* · *«POR MAS ROTACION EN LUGAR DE LA BINOTAL»* |

**La lista de motivos sale del uso real, no de la cabeza de quien diseña.** Es la
misma regla que CLAUDE.md aplica a los catálogos: una lista que ya existe no se
escribe a mano.

---

## 3. Por qué el cálculo no puede ver esto solo

`stock_config` hoy: `analysis_days = 180`, `cycle_days = 35`, `reorder_*_days =
25` plano, `outlier_percentile = 92`. La fórmula es
`MIN = floor(velocidad × 25)`, `MAX = ceil(velocidad × 35)`, con la velocidad
calculada sobre unidades **winsorizadas al percentil 92**.

Esa winsorización **recorta el pico de un DÍA, no un episodio**. Si un cliente
compró 40 unidades cada mes durante cuatro meses y se fue, esos cuatro días no
son raros entre sí: entran enteros al promedio y lo siguen inflando los 180 días
completos desde la última compra. Y en el otro sentido, un producto que la gente
pide pero que nunca hubo en sala tiene historial **cero**: el cálculo jamás va a
proponer existencia para él, por diseño, porque la venta no ocurrió.

Ninguno de los dos casos es un error de la fórmula. Son datos que el historial
**no contiene** y que sólo sabe la persona que atiende el mostrador.

---

## 4. El diseño

### 4.1 La decisión humana se guarda aparte del cálculo

Las columnas ya existen a medias: `manual_min`/`manual_max` están en la tabla
pero **sólo las usa Bodega** (54 filas, todas de `erp_sucursal_id = 6`, donde
guardan un excedente sobre la suma de las salas). En salas hay **cero**.
`calc_min`/`calc_max` existen y están **vacías**.

El modelo queda así, y es lo que hace imposible perder un número:

| columna | qué guarda |
|---|---|
| `min_units` / `max_units` | lo **vigente**, lo que manda el pedido — no cambia de significado |
| `manual_min` / `manual_max` | lo que **puso una persona** (pasa a usarse también en salas) |
| `manual_motivo` | **por qué** — uno de la lista de §4.2 |
| `manual_nota` | el texto libre, como el `reason` de hoy |
| `manual_por`, `manual_at` | quién y cuándo — `manual_at` es además la **fecha de corte** |
| `manual_cliente_unidades`, `manual_cliente_dias` | sólo para «cliente fijo»: *20 cada 60 días* |
| `calc_min` / `calc_max` | lo que el **cálculo propone**, siempre, aunque no se aplique |

Los dos números conviven. Hoy uno tapa al otro y no queda rastro.

### 4.2 Los motivos, y qué hace el cálculo con cada uno

Un motivo que no cambia nada es decoración. Cada uno tiene que tener una
consecuencia, o no entra:

| Motivo | Qué dice la persona | Qué hace el recálculo |
|---|---|---|
| **Ya no rota / sólo por encargo** | se dejó de vender | **ignora la venta anterior a `manual_at`** para ese producto·sala — el promedio deja de arrastrar el episodio, sin esperar 6 meses |
| **Lo están buscando** | hay demanda que el historial no puede ver | el valor es **piso**: el cálculo no propone por debajo |
| **Cliente fijo** | *«compra 20 cada 2 meses»* | la velocidad es **unidades ÷ días declarados**, no el promedio de 180 días |
| **Por presentación** | tiene que venir en caja completa | redondea el MAX al múltiplo del empaque — **fuera de alcance, ver §6** |

**«Tope de sala» quedó deliberadamente fuera** (decisión del 2026-08-20). Es el
caso mayoritario de §2.3 —BENZOCLID, ESPASMO: productos que rotan y alguien igual
baja el MAX— y la decisión fue **no respetarlo automáticamente**. Esas filas van
a quedar marcadas **«En conflicto»**: ni se respetan solas ni se pisan en
silencio. Alguien las mira.

### 4.3 La categoría nueva en pantalla

Una píldora **«Ajustado a mano»** en MIN·MAX, con tres estados filtrables:

- **Respetado** — el cálculo coincide con el ajuste o quedó dentro de él.
- **En conflicto** — el cálculo propone algo que lo contradice. Son los 143 casos
  de §2.1, y es la lista que hay que revisar.
- **Volvió a moverse** — el motivo era «ya no rota» y el producto volvió a
  vender. El ajuste dejó de ser cierto.

### 4.4 Vigencia: vence solo si el producto se mueve

Decisión del 2026-08-20. El ajuste vale indefinidamente —nadie tiene que
acordarse de renovar nada— pero **no es ciego**: si un «ya no rota» vuelve a
registrar venta, la fila cae sola en «Volvió a moverse» y entra a revisión. Un
ajuste de hace un año no puede seguir tapando un producto que resucitó.

---

## 5. Las fases, y la prueba que cada una tiene que pasar

El orden está elegido por **riesgo**, no por comodidad: primero todo lo que no
puede alterar un número, y al final lo único que sí.

### Fase 1 · Las columnas — *no puede cambiar ningún MIN ni ningún MAX* — **APLICADA**

Una migración: `ADD COLUMN` de las siete columnas de §4.1, todas **nullable y sin
default**, más un `CHECK` sobre `manual_motivo`.

**Por qué no puede romper nada:** en PostgreSQL 11+ un `ADD COLUMN` nullable sin
default no reescribe la tabla — es un cambio de catálogo, instantáneo. Y como
las 19,041 filas nacen con `manual_motivo = NULL`, **toda la lógica nueva de las
fases siguientes queda inerte por construcción**: no hay ni una fila a la que
aplicarse.

**Prueba de salida:** las 19,041 filas conservan `min_units`/`max_units` byte por
byte. Foto antes y después, comparación exacta.

**Reglas obligatorias:** `SET lock_timeout = '5s'` al inicio (CLAUDE.md), archivo
local en el mismo commit con la versión de 14 dígitos que devuelva el servidor.

**Lo que encontró la prueba en staging, y que la vuelve a justificar.** El freno
`psp_cliente_fijo_completo` escrito de la forma obvia —`CASE WHEN motivo =
'cliente_fijo' THEN unidades > 0 AND dias > 0 …`— **no frenaba**: con las
columnas en `NULL` la expresión da `NULL`, y un `CHECK` sólo rechaza con `FALSE`,
nunca con `NULL`. O sea que un «cliente fijo» sin su ritmo habría entrado sin
error, y el cálculo de la fase 5 se habría quedado sin el número que necesita
para funcionar. Se corrigió con `(… ) IS TRUE`, que convierte el `NULL` en
`FALSE`. Los diez casos de borde se probaron en staging antes de tocar
producción; nueve pasaron a la primera y éste no.

### Fase 2 · Pedir el motivo al editar — *no cambia ninguna fórmula*

La celda de MIN·MAX deja de guardar en silencio: pide el motivo con la lista de
§4.2 más nota libre, exactamente como ya lo pide el flujo de solicitud. El valor
sigue yendo a donde va hoy, y además queda en `manual_*`.

**Prueba de salida:** editar un valor deja la fila con `manual_motivo` escrito y
`min_units`/`max_units` con el mismo número que habría quedado antes del cambio.

### Fase 3 · Publicar deja de pisar — *quita una pérdida, no agrega riesgo*

`publish_stock_params` excluye del barrido las filas con ajuste vigente y las
aparta para revisión con los tres números y el motivo a la vista.

Esta fase hace el sistema **más conservador que hoy**: en vez de sobrescribir 567
decisiones humanas, las deja quietas hasta que alguien decida.

**Prueba de salida:** correr la publicación en staging sobre una copia con
ajustes sembrados y verificar que (a) las filas con motivo conservan su valor,
(b) las filas sin motivo se publican **idénticas** a como se publican hoy.

### Fase 4 · La categoría en pantalla — *sólo lectura*

La píldora y los tres estados de §4.3. No escribe nada.

### Fase 5 · El cálculo lee el motivo — *la única que mueve números*

`calculate_stock_params` aplica lo de §4.2. **Puede quedar sin hacer
indefinidamente**: sin ella, las fases 1-4 ya resuelven lo principal —que el
trabajo manual deje de perderse.

**Condición de entrada, innegociable:** correr el cálculo viejo y el nuevo sobre
las mismas 19,041 filas en el branch de staging (`cbnjplmnfmfsambavjce`) y
comparar una por una. **Si no da 0 diferencias en las filas sin motivo, no se
aplica.** Es el estándar que este proyecto ya usó dos veces: la optimización del
1-ago (13,526 productos, 0 diferencias) y el matcher de distritos (25,946 casos,
0 distintas).

**Cuidado adicional:** `calculate_stock_params` es la función más pesada del
proyecto — es la que reventó por `statement timeout` el 2026-08-01. Cualquier
cambio en su SQL se mide con `EXPLAIN (ANALYZE, TIMING OFF)` y se ejecuta seis
veces, por el cambio a plan genérico (CLAUDE.md).

---

## 6. Lo que queda FUERA, y por qué

**«Por presentación» (redondear al múltiplo de la caja).** Depende del factor de
empaque, y el factor tiene un problema abierto y medido:
`calculate_stock_params` **no lee el catálogo** — saca el factor de un regex
sobre el texto de la presentación, hay 21 renglones donde no concuerda y 3 con
factor 0 (`docs/PLAN-FACTOR-Y-MINMAX-2026-08-13.md`). `mv_product_factor` cubre
5,680 productos de los ~19,000 con parámetros. Redondear al múltiplo encima de
un factor que en 21 casos está mal multiplicaría el error en vez de corregirlo.
**Entra después de cerrar el plan del factor, no antes.**

**«Tope de sala».** Fuera por decisión, ver §4.2. Esas filas quedan «En
conflicto».

**«Más rotación / sustitución»** (*«POR MAS ROTACION EN LUGAR DE LA BINOTAL»*).
Aparece dos veces en las razones reales y describe demanda **mudándose de un
producto a otro**. Es un problema distinto —dos productos, no uno— y no tiene
solución dentro de este modelo. Queda anotado, sin plan.

---

## 7. Los frenos

1. **Nada escribe directo sobre `min_units`/`max_units` sin pasar por un humano.**
   El recálculo ya deja borradores que alguien publica; todo lo nuevo respeta ese
   embudo.
2. **Apagado instantáneo.** Si algo sale raro, ignorar `manual_motivo` devuelve
   el comportamiento de hoy sin revertir ninguna migración ni perder un dato: las
   columnas se quedan donde están, calladas.
3. **Foto antes de cada fase.** `product_stock_params_history` ya existe; además,
   copia de las 19,041 filas antes de tocar nada, para comparar y para volver.
4. **Staging primero** para todo lo que toque `calculate_stock_params` o
   `publish_stock_params`.
5. **Nada entra cerca del 1-sep.** El recálculo mensual corre `0 9 1 * *`: o esto
   está probado y cerrado antes, o espera a que pase.

---

## 8. El plazo real

El próximo recálculo es el **1-sep-2026**. Cada ajuste a mano que se haga de acá
a esa fecha corre el mismo riesgo que corrieron los 567: desaparecer sin que
nadie se entere. Eso no es un argumento para apurar el plan — es el motivo por el
que las fases 1-4, que no tocan ninguna fórmula, valen por sí solas aunque la 5
nunca se haga.

---

## 9. Decisiones tomadas (2026-08-21)

Las tres se resolvieron por el lado conservador, que es el que pidió el dueño:
«que no se arruine nada; los MIN y MAX son el inventario y el capital de toda la
empresa».

1. **«En conflicto» FRENA la publicación, no sólo avisa.** Las filas con ajuste
   vigente salen del barrido de publicar y se revisan aparte. Publicar deja de
   poder sobrescribir una decisión humana sin que alguien la vea.
2. **Los 143 casos ya rebotados NO se restauran a granel.** Se listan en «En
   conflicto» con el valor original a la vista y un botón para devolverlo uno por
   uno. El motivo es medido: **108 de los 143 tienen venta reciente**, así que
   devolver el número bajo a ciegas dejaría sin existencia productos que sí rotan
   — se cambiaría un error automático por otro. Un ajuste de junio no es
   necesariamente cierto en agosto, y la única forma de saberlo es mirarlo.
3. **«Ya no rota» queda restringido** a quien ya aprueba solicitudes de MIN·MAX.
   Es el único motivo que borra historial de demanda: no puede quedar a un clic
   de distancia para cualquiera que edite una celda.

### Lo que sigue abierto

- **Un quinto motivo, `otro`, entró en la fase 1** y no estaba en el diseño
  original. Hacía falta un cajón: sin él, quien baja un MAX por tope de sala
  elegiría mal alguno de los tres motivos que **sí** cambian el cálculo, que es
  peor que no declarar nada. `otro` exige nota escrita, no toca el cálculo y deja
  la fila «En conflicto».
