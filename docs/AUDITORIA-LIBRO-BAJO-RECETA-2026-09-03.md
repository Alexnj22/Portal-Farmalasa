# El libro «Bajo receta» — revisión de arranque para el 1 de octubre

**2026-09-03** · `/bitacoras?tab=libro` · portal v2.970.x
**Estado:** el módulo está construido y **todavía no se usa**. La sala empieza a
llenarlo el **1 de octubre de 2026**. Esto es una revisión de *alistamiento*, no
un informe de incumplimiento.

> ### ⚠️ Corrección de la primera versión de este documento
>
> La versión anterior (commit `c48ebe56`) decía que el libro «ve el 19.6% de los
> antibióticos» porque `products.es_antibiotico` deja fuera la amoxicilina, la
> ciprofloxacina, el metronidazol y compañía. **Eso estaba mal, y el error era
> mío al elegir la vara.**
>
> Medí contra **ATC J01 — antibacterianos para uso sistémico**, dando por hecho
> que en El Salvador todo antibiótico se dispensa con receta. **No es así**: el
> país exige receta para una lista **corta y nombrada**, y el resto de los
> antibióticos orales son de **venta libre**. Lo corrigió el usuario y la norma
> le da la razón — el detalle está abajo.
>
> Con la vara correcta, la lista del ERP **está bien**: cubre el 100% de las
> moléculas controladas activas y le falta **un** producto. Lo que sigue en pie
> no es la lista, es que **nada la vigila**.
>
> La lección es la del repo: *un criterio medido contra la vara equivocada
> produce un número grande, convincente y falso.* Antes de reportar que el 80%
> falta, hay que probar que ese 80% **debía** estar.

---

## 0 · Lo que ya se aplicó (misma sesión, 3-sep)

El usuario autorizó tocar todo: *«no hay problema con la bitácora, esa aún no es
oficial, así que mejorémosla y aplica todos los cambios necesarios»*. Seis
migraciones y el frente. Lo que queda abierto está marcado como tal más abajo.

| | qué se hizo |
|---|---|
| **Dos libros** | `dispensacion_clases` decide de qué libro es cada producto, **con el motivo escrito**, y manda sobre `products.es_antibiotico` — que el ERP reescribe en cada sync. `bitacora_dispensaciones.clase` y **serie de folio propia** (`disp` / `disp_rx`): el segundo libro numera `2026-R-00001`. El único único pasó a `(branch_id, anio, clase, folio)` |
| **La ranitidina** | fuera del libro de antibióticos, al suyo. Ya no rompe el cuadre del ítem 3.4 |
| **La gentamicina** | `GENTAMICINA 160MG X 2 ML VIJOSA` entra al de antibióticos, y los tres inactivos controlados también — para que no entren invisibles el día que se reactiven |
| **El cierre mira el libro** | `cerrar_mes_bitacora` cuenta los pendientes y **exige un motivo escrito** (≥15 caracteres) para cerrar con renglones sin completar; el número queda sellado dentro del resumen del cierre. `bitacora_libro_pendientes` es la única cuenta, y la pantalla del cierre le pregunta a ella |
| **Los 421 folios de práctica** | borrados, contadores en 0. El 1 de octubre el primer renglón real es el `2026-00001` |
| **Fecha de apertura** | `branches.libro_receta_desde = 2026-10-01` en las 6 salas. Sin esto el libro volvía a llenarse solo durante septiembre y estrenaba con un mes de pendientes — el mismo problema, de vuelta por no haber puesto la fecha. NULL = no abrió, que es la falla segura |
| **El repaso** | de 45 a **120 días**: lo que llegaba más tarde no entraba nunca, y sin error |
| **El papel** | **dos hojas**, una por libro. La de antibióticos sale siempre aunque venga vacía —una hoja ausente se lee como «no la llevan»—; la otra sólo si tiene renglones |
| **El respaldo** | `recetas`, `receta_items`, `medicos` y `dispensacion_clases` entran a `backup-critical-tables` **y a la lista blanca de `backup_dump_table`**, que son la misma lista dicha dos veces |
| **El pendiente que envejecía** | el widget del Inicio miraba 30 días y a los 31 el renglón desaparecía para siempre. Ya no se recorta por antigüedad |
| **La descarga** | el libro se saca solo desde su pestaña, en el orden de sus folios, por `exportCsv` con su módulo — o sea que el egreso queda anotado |

**Lo que NO se hizo, y por qué:** los 48 productos con `(R)` en el nombre **no**
se sumaron al segundo libro. Duplicarían el trabajo de la sala (~380 ventas en
dos meses) y **ningún ítem de la Guía los exige** — es una decisión de la
empresa, no de la norma. El mecanismo está listo: es un `INSERT` en
`dispensacion_clases` el día que se decida.

---

## 1 · La regla real: seis moléculas, más todo lo inyectable

**RTS 11.02.04:24 §6.4.3** — «La dispensación de antibióticos se debe realizar
solamente si se presenta una receta médica, **según el listado emitido
oficialmente por SRS**». La norma no dice «todo antibiótico»: dice *el listado*.
Y ese listado se armó en dos tandas:

| | qué exige receta | fuente |
|---|---|---|
| **2015** | **todo antibiótico inyectable**, cualquiera sea la molécula. La DNM verificó en inspección que las farmacias **se quedan con una copia de la receta** | resolución DNM, jul-2015 |
| **2018** | seis moléculas, **cualquiera sea la vía de administración**: **cefixima, azitromicina, claritromicina, levofloxacina, moxifloxacina, norfloxacina** | medida DNM 2018, recogida por OPS |

Todo lo demás —amoxicilina, ampicilina, cefalexina, cefadroxilo, tetraciclina,
doxiciclina, metronidazol, trimetoprim-sulfa, nitrofurantoína oral,
ciprofloxacina oral— es **venta libre** en El Salvador. No entran al libro, y no
tenían por qué entrar.

### Y la lista del ERP encaja con esa regla casi exacta

Los 79 productos con `es_antibiotico = true` son, uno por uno, **o** una de las
seis moléculas (AZITRO DENK, AZTHOMAC, ZIBAC, ZITREX, KOPTIN, KLARICID, QUOTAL,
ELEQUINE, FLOXALEV, LEVODEL, AVELOX, VIGAMOX, UROXANET, QUINOEFEX URO, DENVAR,
FIXIM, CEFICID, DENFIX, MAXILOSPORIN, CEFIBAC, BACTIVANZ, BACLOSEF y sus
genéricos MK/SAIMED/ECOMED) **o** un antibiótico inyectable (AXTAR, ROCEFORT,
CEFTRIAXONA, PEN DI BEN, UNICIL, BIOGENTA, GARAXIL, ANDIGENT, BIOMIKIN, EUROCLIN,
IMATION, TERABIOL) **o** un pack que contiene claritromicina (METIOM H. PYLORI,
LANZOPRAL HELIPACK, ESOPRASEK PLUS, FLOXA PACK).

**No era una lista escrita a ojo. Codifica la regla.** Eso hay que decirlo,
porque el próximo que la audite va a sospechar de ella igual que yo.

---

## 2 · Lo que sí hay que corregir en el catálogo

### 2.1 · Un inyectable sin marcar

| producto | estado | ventas 1-jul → 3-sep | marcado |
|---|---|---:|---|
| **GENTAMICINA 160MG X 2 ML VIJOSA** | activo | **30** | ❌ |
| BIOGENTA 160MG/2ML X 1 AMP. | activo | — | ✅ |
| GARAXIL 160MG AMP X 2 ML | activo | — | ✅ |
| ANDIGENT A 160 X 3 AMPOLLAS 2ML | activo | — | ✅ |

Misma molécula, misma vía, misma regla — y la marca genérica quedó afuera. Son
**30 dispensaciones** que el libro no va a ver. Es el modo de falla real de una
lista a mano: no se equivoca en grande, se saltea uno.

### 2.2 · Un producto bajo receta que NO es antibiótico, en el libro equivocado

**RANITIDINA 50MG AMPOLLA X 2 ML VIJOSA** tiene `es_antibiotico = true` y hoy
está adentro del libro de antibióticos: **21 renglones foliados** entre el 3-jul
y el 30-ago, el **5%** del libro.

No es un error de criterio de la sala — **es bajo receta**, y por eso está
marcada. Lo que falla es que hay **un solo cajón para dos cosas distintas**.
Decisión del usuario (3-sep):

> «Ranitidina estaría en su propio registro; no es antibiótico pero es bajo
> receta.»

Y la norma empuja en la misma dirección: la **Guía 3.4 (CRÍTICO)** pide que «las
existencias físicas **de antibióticos** concuerden con las detalladas en el
registro». Con una ranitidina adentro, ese cuadre **no puede cerrar por
construcción** — no porque falte un dato, sino porque el registro contiene algo
que el inventario de antibióticos no tiene. Lo mismo al revés: si el libro de
antibióticos lleva 21 renglones que no son antibióticos, el inspector encuentra
una diferencia del 5% que no existe.

**Son dos registros, y el §3 de este documento dice cómo se separan.**

### 2.3 · Tres inactivos que van a morder si se reactivan

`AVELOX 400MG X 20 COMP.`, `AZITROMICINA 200MG X 30 ML SM` y
`CLARITROMICINA 125 MG X 60 ML MK` son moléculas controladas y están **sin
marcar**. Hoy no se venden. El día que alguien reactive uno en el ERP, entra al
mostrador **invisible para el libro** y nadie se entera.

### 2.4 · Quiénes son los «otros bajo receta» — y dónde están escritos hoy

**50 productos llevan `| (R)` dentro del NOMBRE** —EPIVAL, DEPAKENE, QUETIDIN,
LUVOX, DULVANEX, NEUROIPRAN, MIMETIX, BELLAFACE, MIA, DIXI 35, BLOPRESS, ISOPTIN,
PROGENDO, DUSPATALIN, BETASERC…— y de esos sólo **dos** tienen `es_antibiotico`:
los dos KLARICID, que llevan `(R) (A)`.

Ésa es, hoy, la lista de «bajo receta que no es antibiótico»: la ranitidina
inyectable más esos 48. Uno de ellos es antibacteriano — **UVAMIN RETARD
(nitrofurantoína), 140 ventas**: no es de las seis moléculas ni es inyectable,
así que **no** va al libro de antibióticos, pero el propio ERP dice que se
despacha con receta. Va al segundo registro.

**El problema es dónde vive el marcador: dentro del nombre.** Es exactamente la
trampa de «un rótulo no es una clave» del CLAUDE.md — el día que alguien corrija
el nombre del producto, el `(R)` se va con él, sin error y sin dejar rastro. Un
registro sanitario no se puede apoyar en eso.

**Y la columna correcta ya existe y está vacía:** `products.requiere_receta` es
booleana, está **en `false` en las 5,219 filas**, y ya tiene su insignia
«Receta» pintada en el catálogo (`TabCatalogo.jsx:1972`). No la escribe nadie:
`sync-products` no la trae del ERP y el portal no la deja editar. Es una columna
cableada a la pantalla que nunca se llenó.

---

## 3 · Dos registros, no uno — la decisión y cómo se implementa

**Decisión tomada (3-sep):** el libro de **antibióticos** y el de **otros
productos bajo receta** son **dos registros separados**. La ranitidina
inyectable, el UVAMIN y los 48 productos con `(R)` van al segundo, no al primero.

**Por qué es lo correcto y no una preferencia:**

- La **Guía 3.4 (CRÍTICO)** cuadra existencias **de antibióticos** contra el
  registro. Un registro mezclado no puede cuadrar: hoy son 21 renglones de 421
  —el **5%**— que el inventario de antibióticos nunca va a tener.
- La **Guía 3.3 (CRÍTICO)** pide el registro trazable **de antibióticos**. Un
  libro que trae otras cosas no es más completo, es menos preciso.
- Y al revés: el segundo registro **no lo exige ningún ítem de la Guía**. Los
  únicos productos bajo receta con registro obligatorio propio son los
  **estupefacientes y psicotrópicos** (sección 4), y ésos van en el sistema que
  **facilita la DNM** (RTS 6.5.2), no en uno nuestro. O sea que el segundo libro
  es una **decisión de la empresa** — buena, pero conviene saber que es
  voluntaria, porque eso define cuánto rigor pedirle.

### 3.1 · Los tres criterios, escritos

| registro | qué entra | de dónde sale hoy |
|---|---|---|
| **Antibióticos bajo receta** | las 6 moléculas (cefixima, azitromicina, claritromicina, levofloxacina, moxifloxacina, norfloxacina) **+ todo antibiótico inyectable** | `products.es_antibiotico` — **quitando la ranitidina**, sumando la GENTAMICINA VIJOSA |
| **Otros bajo receta** | lo que la farmacia despacha con receta y no es antibiótico | el `(R)` del nombre + la ranitidina — **hay que mudarlo a `products.requiere_receta`** |
| **Estupefacientes y psicotrópicos** | tramadol, pregabalina, quetiapina, carbamazepina… | **no existe** — y el sistema lo da la DNM, ver §8 |

### 3.2 · El cambio de modelo, que es chico

`bitacora_dispensaciones` no necesita una tabla gemela: necesita **saber de qué
libro es cada renglón**.

1. **Columna `clase`** en `bitacora_dispensaciones` (`'antibiotico'` /
   `'bajo_receta'`), con su CHECK. Una tabla gemela duplicaría el RPC, el
   formulario, el papel y las policies — y el día que una de las dos copias
   cambie, la otra se queda vieja.
2. **Serie de folio propia.** `bitacora_folios` ya tiene la columna `serie` (hoy
   usa `'disp'` y `'receta'`): el segundo libro toma `'disp_rx'` y arranca en 1.
   **Los folios no se comparten** — si se comparten, cada libro tiene huecos
   donde está el otro, y un folio faltante en un libro foliado es exactamente lo
   que un inspector persigue.
3. **`products.requiere_receta` se llena.** Está en `false` en las 5,219 filas y
   ya tiene su insignia en el catálogo. Se siembra de los 50 `(R)` más la
   ranitidina, y **se hace editable** — hoy no lo escribe ni el ERP ni el portal,
   así que un producto nuevo bajo receta nace invisible para el segundo libro.
4. **El filtro del sync** pasa de `WHERE p.es_antibiotico` a
   `WHERE p.es_antibiotico OR p.requiere_receta`, escribiendo `clase` según cuál
   de las dos lo trajo. Un producto marcado con las dos va a **antibiótico**: es
   el libro que se inspecciona.
5. **El papel sale en dos hojas**, una por libro, cada una con su serie de folio.
   La hoja de antibióticos es la que se le pone enfrente al inspector.

### 3.3 · Y los 21 renglones de ranitidina que ya están adentro

Como todo esto es anterior al arranque del 1-oct, **no hay que migrarlos**: se
van con el resto de los renglones de práctica (§4). Si en cambio se decidiera
conservar el histórico, esos 21 hay que **moverlos de libro y renumerarlos**, que
es más trabajo y menos limpio que empezar los dos libros en `00001`.

## 4 · Lo que hay que decidir sobre los 421 renglones de práctica

Del **3-jul al 3-sep** el sync ya cargó **421 renglones foliados**, ninguno
completo (414 pendientes, 7 anulados por DTE invalidado). Son de la etapa de
construcción: no existen recetas ni fotos para completarlos, y ya no se pueden
conseguir.

**Si el 1 de octubre arrancan sobre esto, el libro nace con 414 renglones que
dicen «se dispensó un antibiótico y no hay constancia de receta».** Eso es peor
que empezar en cero: un inspector no lee «era la prueba», lee el folio.

Los contadores están en `bitacora_folios` y hoy van así:

| sala | último folio |
|---|---:|
| Salud 1 | 100 |
| La Popular | 99 |
| Salud 3 | 90 |
| Salud 2 | 61 |
| Salud 4 | 40 |
| Salud 5 | 31 |

**Recomendación:** borrar los renglones anteriores al 1-oct y **poner los
contadores en 0**, para que el 1 de octubre el folio `2026-00001` de cada sala
sea la primera dispensación real. Es borrado de datos de producción, así que
**no lo hago sin que lo pidas**; queda como propuesta.

**Beneficio extra:** eso disuelve solo el defecto de folios que sigue. Hoy, en
cada sala, el folio **retrocede una vez** —el 21 es del 16-ago y el 22 del
3-jul—, artefacto de los dos backfills del 17-ago. Un libro foliado **no se
renumera**; pero si estos folios nunca fueron reales, no hay nada que renumerar.

---

## 5 · Lo que hay que construir antes del 1 de octubre

Ordenado por lo que más duele si falta el día del arranque.

### 5.1 · El cierre de mes tiene que exigir el libro completo — y hoy hace lo contrario

`cerrar_mes_bitacora` **no menciona `bitacora_dispensaciones` ni una vez**. Pero
`completar_dispensacion` **sí** rechaza escribir en un mes cerrado.

Las dos mitades juntas producen esto, y ya pasó — medido hoy:

> **La Popular cerró agosto el 3-sep a las 16:23 con 39 renglones pendientes.**
> Esos 39 ya no se pueden completar sin reabrir el mes.

O sea que la única puerta capaz de exigir el libro completo es justamente la que
lo sella incompleto. **Es el arreglo número uno**: `cerrar_mes_bitacora` tiene
que negarse —o al menos exigir motivo escrito— si quedan renglones pendientes
del período.

### 5.2 · El pendiente que envejece desaparece en vez de escalar

`WidgetRecetasPendientes.jsx` mira **30 días** (`DIAS_ATRAS = 30`). Un renglón
que cumple 31 días sale de la pantalla y no vuelve nunca. Al revés de lo que
tiene que pasar: cuanto más viejo, más visible.

Hace falta, además, **algo que escale** — aviso al jefe de sala a los 2 días y
al regente a los 7. Hoy no hay nada; el único recordatorio es que alguien entre
a la pestaña.

### 5.3 · La gentamicina genérica y los tres inactivos

Marcar `GENTAMICINA 160MG X 2 ML VIJOSA` y los tres inactivos en el ERP, y
**re-sincronizar desde el 1-oct** cuando arranque.

Y **quitarle `es_antibiotico` a la RANITIDINA 50MG AMPOLLA**: no sale del
circuito, se muda al segundo libro por `requiere_receta` (§3). Hacer las dos
cosas juntas y en ese orden — quitarle la marca sin haber llenado
`requiere_receta` la deja fuera de los dos registros, que es peor que estar en el
equivocado.

### 5.4 · Un gate que vigile la lista, porque el ERP no avisa

La regla es corta y se puede escribir: *seis moléculas por principio activo, más
todo antibiótico inyectable*. Con eso, un chequeo en `npm run gate:data` que
falle cuando aparezca en el catálogo un producto que cumple la regla y no está
marcado. Es lo que hoy no existe: la lista está bien **y nada garantiza que siga
estándolo**.

Para poder cruzarla hace falta el principio activo, y ahí sí hay un hueco:
**sólo 18 de los 79 productos marcados tienen `principio_activo` cargado**. Los
otros 61 son marcas (AXTAR, DENVAR, KOPTIN, ZIBAC…). Sin eso, el cruce hay que
hacerlo por nombre comercial, que es exactamente lo frágil.

### 5.5 · El listado de antibióticos con clasificación AWaRe — ítem 1.13, hoy en cero

> **Guía 1.13 (MAYOR)** · «¿Se dispone del listado de antibióticos que maneja el
> servicio farmacéutico e **incluye la clasificación AWaRe** recomendada por OMS
> (Reserva, Vigilancia y Acceso) para cada antibiótico?»
>
> **RTS 6.1.13** · «El establecimiento debe disponer del **acceso al listado de
> antibióticos** de acuerdo al reconocimiento de la clasificación de antibióticos
> por parte de la Autoridad Reguladora.»

Esto es **independiente** de qué se dispensa con receta: pide el listado de
**todos** los antibióticos que la farmacia maneja —venta libre incluida— con su
grupo AWaRe. Hoy no existe en ninguna parte del portal.

Y no hay que inventarlo: el **Listado Oficial de Medicamentos 2025** de la SRS
(`srs.gob.sv/wp-content/uploads/2025/03/…`), capítulo **J01 · ANTIBACTERIANOS
PARA USO SISTÉMICO**, trae 40 entradas con su ATC y **el grupo AWaRe metido
dentro del código**: `*(1)` = **Acceso**, `*(2)` = **Precaución (Watch)**.

- **Acceso `*(1)`** — doxiciclina, amoxicilina (± clavulánico), ampicilina
  (± sulbactam), penicilina, cefazolina, TMP-SMX, clindamicina, gentamicina,
  amikacina, metronidazol, nitrofurantoína, fosfomicina, cloranfenicol.
- **Precaución `*(2)`** — ceftriaxona, claritromicina, ciprofloxacino,
  vancomicina, piperacilina + tazobactam.

Nótese que **casi todo lo de venta libre es grupo Acceso y casi todo lo
controlado es Precaución**: la regla salvadoreña y la de la OMS apuntan al mismo
lado. Es un buen argumento para el regente y una buena pantalla: «Antibióticos
que manejamos», con su grupo, exportable.

### 5.6 · El libro no se puede sacar solo

No hay botón de imprimir ni de exportar en la pestaña «Bajo receta»: el libro
sale únicamente dentro del mes completo, desde Cierre, pegado a las hojas de
temperatura y limpieza. Un inspector pide **el libro de antibióticos de octubre**
y hay que darle otras tres hojas encima.

Cuando se agregue, va por `exportCsv` **con su módulo** para que quede el egreso
anotado (`registrar_egreso`) — regla del proyecto.

### 5.7 · No hay una persona con el rol Regente

El rol **`Regente`** existe, con todos los permisos, y tiene **0 empleados**.
(`Regente de Enfermería`, 7 personas, es otra cosa.) El regente farmacéutico es
quien firma los procedimientos (**RTS 6.1.12**, Guía 1.12 MAYOR), quien debería
cerrar el mes y quien autoriza el manejo digital. Antes del 1-oct necesita
cuenta.

### 5.8 · Los dos documentos que hacen legal el libro digital

Sin ellos, **llevar el libro en digital no está autorizado**, por bien construido
que esté:

- **Procedimiento de manejo de documentación digital** — RTS 6.1.14.
- **Protocolo de supervisión del sistema electrónico** — RTS 6.1.15 / Guía 3.6
  (MAYOR): nivel de acceso, resguardo, forma de registro, respaldo y evaluación
  periódica.

Los dos los firma y sella el regente. Están en borrador en
`docs/legal/procedimientos/` y el detalle de qué debe decir cada uno está en
`docs/BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md`.

Falta además el del **RTS 6.4.1 / Guía 3.1 (MAYOR)**: procedimiento de
adquisición, suministro, dispensación, devolución y disposición final de
antibióticos.

### 5.9 · El respaldo llega al renglón y no a la receta

Hoy (v2.967.5) entraron las 7 tablas `bitacora_*` a `backup-critical-tables`.
**No entraron `recetas`, `receta_items` ni `medicos`** — donde viven el paciente,
el prescriptor y la URL de la foto, que es la mitad exacta que le importa a la
**Guía 3.5** y a la **3.12**. Respaldar el renglón sin la receta respalda lo que
se puede reconstruir del ERP y deja fuera lo que no.

Dos cosas más del mismo párrafo:

- El **bucket `recetas` no se respalda** (Storage no entra en ese cron), y la
  3.12 pide la copia de la receta **≥ 1 año**.
- `RETENTION_DAYS = 60`. Como respaldo está bien; **como control declarado en el
  protocolo del 6.1.15, 60 días no es un año**. El documento tiene que decir que
  la retención la da la base (nada la purga) y que el respaldo es una ventana
  rodante de 60 días.
- La corrección es de **hoy** y el cron corre los domingos: la última corrida fue
  el **30-ago**. A esta hora las bitácoras **todavía no tienen ni un respaldo
  hecho**. Declarado ≠ demostrado, hasta el 6-sep.

---

## 6 · Dos defectos de datos que conviene arreglar antes de arrancar

### 6.1 · 50 renglones (12%) traen dos lotes fundidos en un campo

`lote = '2412183_2411613'`, con **una sola** `fecha_vencimiento`. La **Guía 3.5**
pide lote y expiración *de lo dispensado*; con dos lotes fundidos el libro no
puede decir cuál se llevó el paciente, y la **3.4** (cuadrar existencias por
lote) no cierra.

De ahí sale el segundo síntoma: **2 renglones muestran lote vencido al momento de
vender** (ROCEFORT 1 GR IV, vence 1-mar-2026, despachado el 3-ago y el 25-ago).
O se dispensó producto vencido —**RTS 6.6.6**, grave— o el libro está mostrando
el vencimiento del lote equivocado. Hoy la fila sólo se pinta en rojo y nadie la
persigue. Con datos reales desde octubre, esto **necesita un destino**: quién lo
mira y qué hace.

### 6.2 · El repaso diario sólo mira 45 días

El cron `bitacora-dispensaciones-repaso-diario` re-sincroniza `hoy − 45 … hoy`.
Una venta que llegue del ERP más tarde que eso **no entra nunca**, y no da error.
Con el libro en marcha, ese hueco es un renglón que falta y nadie puede notar.

---

## 7 · Lo que ya está bien, y conviene no romper

Vale decirlo porque es la mitad más difícil y está resuelta:

| ítem | cómo se cumple |
|---|---|
| **Guía 3.5** — lote, expiración, fecha y cantidad dispensada, laboratorio, presentación | **421/421 completos**, tomados de la venta. Nadie los teclea |
| **3.5** — nombre de quien realizó | `vendedor_nombre` en 420/421; `completada_por` al completar |
| **3.13** — datos del prescriptor | el médico **sólo** se puede tomar del registro del CSSP; la base rechaza uno inventado |
| **3.17 / 3.21** — cantidad dispensada y **pendiente**, con correlativo | `prescrito` / `entregado_total` por renglón, más el folio `2026-00007` |
| **3.19** — pendientes por agotamiento | `motivo_pendiente`, y la receta queda `abierta` |
| **3.7 espejo** — control de correcciones | anular deja el renglón con motivo y firma; **nunca se borra** |
| **3.6** — nivel de acceso | RLS en las 7 tablas, escritura sólo por RPC, `bitacora_exigir_acceso` en cada lectura |
| **3.12** — resguardo de la copia | bucket `recetas` **privado**, mime restringido, 10 MB |
| **RTS 6.1.14** — contemporáneo | la hora sale de la base contra El Salvador, nunca del navegador |
| **RTS 6.1.14** — preferencia por el papel | el mes sale impreso, acostado, formulario `FLS-BIT-03` |
| — | ningún cron purga las bitácoras: el dato primario no se pierde |

Un detalle de permisos que no es un defecto pero conviene saber:
`bitacoras_tab_libro.can_edit` está otorgado a tres roles y **nunca se lee** — el
botón «Completar» y el RPC miran `bitacoras.can_edit`, que lo tienen los 21
Dependientes de Farmacia, los 6 Jefes de Sala y los 7 Regentes de Enfermería. La
grilla de permisos muestra un candado que no cierra nada. Antes del 1-oct hay que
decidir cuál de las dos es la buena.

---

## 8 · Aparte del libro: la sección 4 de la Guía no tiene módulo

**Estupefacientes y psicotrópicos**, tres ítems CRÍTICOS:

> **4.1** control verificado por el regente · **4.2** sistema de control
> **trazable y aprobado por la DNM** · **4.3** área restringida bajo llave ·
> **4.4** facturas que amparen la adquisición.
>
> **RTS 6.5.2** — «Debe implementarse el sistema de control … **facilitado por la
> Autoridad Reguladora**.»

El catálogo tiene producto de esa familia sin marcar: carbamazepina, pregabalina
(7 presentaciones), quetiapina, risperidona, sertralina, amitriptilina y
**tramadol en 8 presentaciones**.

**No van al libro de antibióticos.** Y su sistema de control **lo facilita la
DNM**, no se construye: la acción es preguntarle a la DNM cuál es y cuáles de
estos productos están en su listado, antes de escribir una línea de código.

---

## 9 · Lo que esta revisión no pudo ver

- **La pantalla.** La extensión de Chrome no estaba conectada; no se abrió
  `/bitacoras?tab=libro` en el navegador. Falta el barrido visual y el de
  teléfono (`gate:movil` + `barrido-total-movil`) sobre esa ruta.
- **El listado oficial firmado.** La regla de las seis moléculas + inyectables
  está confirmada por la OPS y por el reporte de la propia DNM de 2015, pero
  **no conseguí el PDF de la resolución**. Antes del 1-oct conviene pedírselo a
  la DNM y guardarlo en `docs/legal/` — es el documento que justifica, ante un
  inspector, por qué la amoxicilina no está en el libro.

---

**Fuentes** · `docs/legal/rts_11020424_bpadyt.txt` (RTS 11.02.04:24 §6) ·
`docs/legal/srs_guia_verificacion_bpad.txt` (Guía de Verificación BPAD — se
volvió a bajar de srs.gob.sv el 3-sep y es **byte por byte idéntica** a la copia
del repo, md5 `8e10db10…`) · Listado Oficial de Medicamentos 2025 (SRS) ·
OPS, «El Salvador's experience controlling the sale of antimicrobials» ·
Boletín Fármacos, ago-2015 (resolución DNM sobre inyectables) ·
Ley de Medicamentos Art. 19.
**Ver también** · `docs/AUDITORIA-BITACORAS-SRS-2026-08-25.md` (ambiente y
limpieza) · `docs/BITACORAS-SOLO-DIGITAL-QUE-PIDE-LA-SRS-2026-09-03.md`.
