---
name: design-gate
description: Historia y reglas de operación de `npm run gate:design` — cómo funciona el ratchet contra `scripts/design-gate-baseline.json`, por qué hoy el baseline está VACÍO (las 47 categorías en cero y bloqueantes desde el 2026-08-06), cómo se bajaron los 168 hallazgos que tenía, por qué cinco de ellos eran excepciones medidas mal clasificadas como deuda, la trampa de claves duplicadas en `EXCEPTIONS`, y cuándo se regenera el baseline. Cargar al trabajar en tema, estandarización visual, colores crudos, elementos nativos del navegador, o al tocar `scripts/design-gate.mjs` / el baseline.
---

# Gate de diseño — cómo opera y por qué

El disparador vive en `CLAUDE.md` («Estándares del proyecto»): antes de cerrar
cualquier trabajo de tema o estandarización visual, correr `npm run gate:design`
y que pase en verde. Las excepciones legítimas viven en `scripts/design-gate.mjs`
(const `EXCEPTIONS`) y en `DESIGN.md` §6/§14. Este archivo es el resto: la
historia que explica por qué el gate está configurado como está.

## El ratchet

**Desde D0 de la auditoría de diseño (2026-07-26) el gate funciona por
ratchet, no por cero absoluto**
(`docs/planes-cerrados/AUDITORIA-DISENO-2026-07-26.md`): falla si
una categoría SUBE respecto a `scripts/design-gate-baseline.json`, no por
tenerla en rojo. Un gate permanentemente rojo no lo mira nadie — que es
exactamente cómo se acumuló esta deuda.

## Estado actual

**Estado al cierre del 2026-08-06 — el baseline VOLVIÓ A ESTAR VACÍO.**

`"categories": {}`. Las **47 categorías en cero y bloqueantes**: cualquier
hallazgo nuevo falla el gate, ninguno suma al ratchet.

Ese mismo día arrancó con tres categorías y **168 hallazgos tolerados**
(`vidrio-a-mano` 135, `material-a-mano` 18, `carril-pildora` 15). Se bajaron con
la receta de `PLAN-MATERIALES` §20, en siete tandas **por criterio y no por
vista** — el error caro de esa bajada era clasificar mal, no editar mal.

Cómo se bajó, porque el reparto sorprende:

| vía | cuántos |
|---|---|
| conversión real (a `data-surface`, a tinta, a un rol nuevo) | la gran mayoría |
| **excepciones MEDIDAS que estaban mal clasificadas como deuda** | 5 |
| falsos positivos de un detector que medía la letra de la regla | 4 |
| bespoke legítimo (`TimeClockView`, el kiosco fuera del shell) | 1 |

**Las cinco excepciones medidas importan más de lo que parece.** `ClientesView`,
`TabCatalogo`, `TabSinVenta`, `AttendanceAuditView` y `TabInventario` tienen el
carril y la píldora en dos renglones **a propósito y con el número escrito**: no
entran juntos ni a 1600px. Tenerlas en el ratchet decía «esto hay que bajarlo» de
un layout que **no hay que bajar**. Un ratchet no distingue deuda de decisión —
eso lo tiene que hacer quien lo lee.

Tres roles de material nacieron en esa bajada —`data-pegajoso`,
`data-cobertura`, `data-velo`— los tres por la misma causa: había superficies con
la obligación de **tapar** que la cumplían por accidente, con un desenfoque.

---

**Estado anterior, al 2026-07-29** (cierre de `PLAN-CIERRE-DISENO-2026-07-29.md`):
el baseline estaba VACÍO y las 24 categorías de entonces eran bloqueantes en
cero absoluto.
Las cinco que arrancaron con deuda en D0 (`white` 1094, `typography` 4490,
`z-index` 552, `hex` 32, `motion` 30) se cerraron en D1/D2; la última con
ratchet era `input-a-mano`, cerrada al pasar sus 3 archivos —login, kiosco y
el campo del ⌘K, todas superficies bespoke de DESIGN.md §25.4— a `EXCEPTIONS`
**con su motivo escrito**, que es más fuerte que tolerarlos por número: ahora
un `<input>` a mano en cualquier OTRO archivo falla el gate.

Categoría nueva del mismo cierre: **`celda-a-mano`** (un `<td>` crudo dentro
de un `<DataRow>` — saltea `DataCell` y con él la densidad de fila).

**2026-08-05 — el baseline dejó de estar vacío**: entró `carril-pildora` con
**15 hallazgos en 10 vistas**. Detecta el carril de tarjetas y la píldora en
renglones separados (falta `lg:flex-row` en el contenedor, o `flex-1` en el
carril). No es estética: `useMedidaFila` busca el carril en el ABUELO de la
píldora, en renglones separados lo encuentra igual y le descuenta 314px por un
carril que no tiene al lado — el layout equivocado no falla, roba ancho en
silencio.

Nació con deuda, así que va por **ratchet** y no bloqueante en cero: 15
hallazgos preexistentes que se bajan vista por vista. Bajarlos NO es mecánico —
§17.0 pide verificar a dos anchos (1280 y 1600) porque angostar la tarjeta a
148px destapa truncamientos.

Se agregó porque la regla **ya estaba escrita en tres lugares** —DESIGN.md
§17.0, la memoria `feedback_la_pildora_va_en_la_fila_de_las_tarjetas` y el
comentario de `ConteoInventarioView`— y se rompió igual: se copió el layout de
`ClientesView`, que tiene la excepción MEDIDA, a una pestaña cuya píldora era
mucho más chica. Una excepción medida no se hereda; es el caso de manual de
[[feedback_la_regla_que_solo_vive_en_prosa_se_rompe]].

**Cuidado con `EXCEPTIONS`:** es un objeto literal, así que una clave repetida
hace que la segunda pise a la primera **en silencio**. Había 4 duplicados sin
detectar. Lo verifica `assertSinClavesDuplicadas` al arrancar el gate: cada
archivo va en UNA entrada con todas sus categorías.

`chart-retirado` y `chip-a-mano` llegaron a **0 el 2026-07-28** y quedaron
bloqueantes: los 3 categóricos retirados se migraron a su destino (424
referencias en 51 archivos) y los 7 chips restantes se resolvieron uno por
uno. `chart-8` salió de la lista de retirados porque no lo estaba: es el
NEUTRO de la paleta y está vivo (`--chart-8-solid` tiene valor propio, el
`neutral` de `Badge` se apoya en él, y tiene familia completa de glows).

Las tres bloqueantes agregadas en D3/D4 — `button-name`, `paleta-cerrada`,
`input-sin-nombre` — no van al baseline: una categoría que no figura en el
JSON arranca bloqueante sola (`baseline[c] ?? 0`).

## `prop-inexistente` y `segmentado-a-mano` (2026-08-14)

Dos categorías nuevas, las dos **bloqueantes en cero** desde el día uno porque
se limpió toda la deuda que encontraron en la misma sesión. Las pidió el usuario
después de que el gate diera verde sobre una pantalla que sí violaba el
estándar: *«mejorá el gate para que compruebe todo lo de diseño y no tengamos de
nuevo este fallo»*.

### `prop-inexistente` — el prop que el canónico NO acepta

**React no valida props: uno con el nombre equivocado se ignora en silencio.**
El disparador fue `EmptyState` recibiendo `message`/`subtext` donde espera
`title`/`subtitle`: pintaba el ícono con 400px de alto y **cero texto**, en dos
pantallas de Cortes de caja, sin un error y sin que ningún gate lo viera. Se
reportó como «el estado vacío se ve cortado».

**La firma sale del componente, no de una tabla escrita a mano**
(`firmaDeComponente` lee los nombres destructurados de la firma real). Un
componente con `...rest` queda fuera: acepta cualquier cosa a propósito.

El barrido inicial encontró **29**, y los otros dos no se estaban buscando:

| hallazgo | qué pasaba de verdad |
|---|---|
| `LiquidDatePicker placeholder` × 28 | prop muerto en 28 sitios — el campo trae su DD/MM/AAAA escrito adentro |
| `ConfirmModal hideCancel` en `TabStaff` | el diálogo que dice «Entendido» mostraba además un «Cancelar» que nadie quiso; se pasó a `AlertModal`, que es el canónico de un solo botón (§14) |

Dos trampas del detector, y las dos costaron una vuelta:
1. **Los atributos se leen al NIVEL 0 del tag.** `action={<Button onClick=…/>}`
   mete props de OTRO componente en el mismo texto — contarlos acusa al inocente
   (150 «hallazgos» que eran 31).
2. **El archivo se lee sin comentarios.** La firma de `EmptyState` tiene párrafos
   enteros de prosa entre los props; parsearla con los comentarios adentro
   devuelve nombres inventados.

### `segmentado-a-mano` — una-de-N escrita con botones (§15.3)

*«Si el estilo depende de `X === valor`, no es un botón con estado: es
`SegmentedControl`.»* El detector busca la forma exacta de la regla — un `.map()`
sobre las opciones cuyo `<Button>` decide `variant`/`tone` comparando contra el
**parámetro del map**.

Mirar sólo `variant={… === …}` no alcanza **y acusa al inocente**: un botón
suelto que se pone rojo cuando la acción es destructiva
(`tone={modo === 'approve' ? 'success' : 'danger'}`) es correcto, y hay tres en
el portal (`TarjetaSolicitud`, `AnnouncementsView`, `TabShifts`). Lo que delata
al selector es la comparación contra la variable que el map va repartiendo: ahí
hay N botones y uno está «activo».

## Regenerar el baseline

Al BAJAR deuda (cada fase del plan baja la suya), regenerar con
`npm run gate:design -- --update-baseline` y commitear el JSON. **Nunca
regenerarlo para tapar un hallazgo nuevo**: si una categoría subió, es
código nuevo que hay que arreglar. Cuando una categoría llega a 0 queda
bloqueante para siempre.


## Los cuatro gates de material y movimiento (agosto 2026)

Salieron de `PLAN-MATERIALES-2026-08-02.md` §8.2. Tres cosas que aprendieron y
valen para cualquier categoría nueva:

**1 · Un detector tiene que enmascarar los comentarios.** `vidrio-a-mano` contaba
un `backdrop-filter` escrito dentro de un comentario de `StatCard` —un archivo
sin vidrio a mano— y, peor, **el número se movía al editar cualquier otra parte
del archivo**: el match caía en otra posición y el resolvedor de tags devolvía
otro tag. Un ratchet que se mueve solo deja de ser un ratchet. Usar
`sinComentarios()`, que reemplaza por **espacios** para no correr los offsets.
Al aplicarlo, 12 de 150 "hallazgos" resultaron ser prosa.

**2 · Un detector tiene que mirar el CUERPO, no la referencia.** La primera
versión de `puntero-lista` marcaba cualquier mención de `pointermove`: tres de
sus cuatro hallazgos eran `removeEventListener` de limpieza. Acusaba a quien
desmonta el listener igual que a quien lo escribe mal.

**3 · Un tag JSX no se extrae con `[^>]*`.** Se corta en el primer `>`, y `=>`
vive adentro de casi todo `onClick`. Usar `tagQueContiene()`, que cuenta llaves
y comillas.

**Y `tema-incompleto` tiene una condición que parece un detalle y no lo es:**
sólo marca un token si **Solid lo redefine**. Sin esa condición marcaba 28
tokens, casi todos radios y desenfoques que *deben* compartirse entre claro y
oscuro. Lo que delata a un token de color es que alguien ya decidió que su valor
depende del material.
