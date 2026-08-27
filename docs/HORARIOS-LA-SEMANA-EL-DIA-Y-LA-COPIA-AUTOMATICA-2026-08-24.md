# Horarios, turnos y vacaciones — la semana, el día, y lo que se copia solo

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio. **Reescrito el 2026-08-27** después de una
auditoría profunda del área: 30 hallazgos, y el más caro no estaba en la
pantalla sino en que la misma pregunta estaba respondida cuatro veces.

Casi todo lo que se rompió acá se rompió por **una convención de calendario que
existía escrita de dos maneras distintas**. Ninguna de las dos daba error.

---

## 0. Un día se resuelve en UN solo sitio

`src/utils/turnoDelDia.js` y su gemelo `public.turno_del_dia(jsonb, jsonb)`.
**No escribir una tercera copia.**

Un día dentro de `employee_rosters.schedule_data` puede traer un turno del
catálogo (`shiftId`), horas propias (`customStart`/`customEnd`), o las dos. Hasta
el 2026-08-27 cada consumidor lo resolvía por su cuenta:

| quién leía | catálogo | horas propias | `isOff` ausente |
|---|---|---|---|
| `consolidate-timesheets` (planilla) | sí | sí | trabaja |
| las 44 h de la pantalla | sí | sí | trabaja |
| `getTodayScheduleConfig` (kiosco) | sí | **NO** | trabaja |
| `empleados_en_turno()` (avisos de sala) | **NO** | sí | **LIBRE** |

Ninguna consecuencia se leía como un defecto de horarios:

- El kiosco exigía `shiftId`, y el editor **deja guardar un día con horas propias
  y sin turno** —la pantalla lo pinta «Manual» y lo cuenta en las 44 h—. Para el
  reloj de la sala esa persona estaba **libre**: pedía autorización de supervisor
  para marcar y la asistencia la daba ausente.
- La función de SQL exigía lo contrario, así que un día asignado desde el
  catálogo no existía para los avisos. Y encima invertía el valor por defecto:
  `coalesce((isOff)::boolean, true) = false` **da por libre al día que no trae la
  clave**, al revés de JavaScript, que es quien escribió el dato.

Dos rastros lo habían anotado sin cerrarlo: `scripts/planes-genericos.json` decía
*«DEVUELVE 0 FILAS incluso [en la sala con más gente] — posible defecto aparte,
verificar»*, y la migración del 17-ago, *«la cascada NUNCA encontró a nadie en
turno, ni una vez»*.

### Las SEIS formas de decir «este día no trabaja»

Y son seis, no una. El resolvedor las conoce todas:

1. `isOff: true` — la canónica, la que escribe el editor.
2. `isOffDay: true` — la vieja, todavía en datos.
3. **`shiftId: 'LIBRE'`** — la escriben marcar incapacidad, marcar vacaciones y
   el regreso anticipado. Sólo `consolidate-timesheets` la conocía, y funcionaba
   *de casualidad*: ningún turno del catálogo tiene ese id.
4. La clave del día **ausente** del `jsonb`.
5. Sin horas: ni propias ni del turno.
6. Entrada igual a salida.

**Y `isOff` se lee con la verdad de JAVASCRIPT**: ausente, `null`, `false`, `0` y
la cadena vacía son todos falsos. Es lo que ya costó `get_traslados_por_recibir`.

### Antes de tocar cualquiera de los dos

Los 55 casos de `tests/unit/turnoDelDia.test.js` valen para los dos, y se
enfrentaron uno contra otro sobre los 16 que importan (**0 distintas**). Si se
cambia uno, se cambia el otro y se vuelve a enfrentar.

---

## 0.b El turno del catálogo trae su pausa

`shifts.lunch_start` y `shifts.lunch_minutes` desde el 2026-08-27. Al asignar el
turno en una celda, la pausa queda puesta sola y se puede mover ese día.

Antes se marcaba **celda por celda** —329 veces por semana— y el editor sólo la
aceptaba **entre las 11:00 y las 14:30**, una ventana escrita a mano en un `.jsx`
sin fuente. El reglamento interno (Art. 18) tiene pausas a las 12:00, 13:00,
**18:00 y 19:00**: o sea que el portal **rechazaba las pausas del propio
reglamento**, y un turno de cierre no podía tener descanso.

Hoy la única regla es que caiga dentro de la jornada.

⚠️ **El catálogo NO son los turnos del reglamento.** El reglamento fija el marco
legal —turnos aprobados por la Dirección General de Trabajo, que rotan cada
quince días— y de ahí sale la frase del contrato, por remisión. El catálogo es
operativo y lo arma Talento Humano. Ver v2.818.1: cargarle las 39 franjas del
reglamento fue un error y se borraron.

---

## 1. Dónde empieza la semana, y por qué está en su propio archivo

La semana empieza el **lunes**. `src/utils/semana.js` es el único lugar donde
eso vive.

Está aparte de `scheduleHelpers.js` desde el 2026-08-21, y no por prolijidad:
ese archivo arrastra `lucide-react` y la matemática de horas de la planilla, y
las tres pantallas que estrenaron filtro de semana —Solicitudes, Traslados y su
capa de datos— no necesitan nada de eso. Importarlo entero les metía ~1 kB gzip
en el cierre estático de una vista que ya estaba sobre su techo
(`npm run gate:bundle`). **Sin dependencias a propósito**: si alguna vez
necesita un ícono, va en otro lado.

### La regla que hay detrás de las cinco funciones

> **Una fecha sin hora se trabaja en hora LOCAL, siempre.**

`new Date('2026-08-18')` la lee como UTC, y en El Salvador (UTC−6) eso
**retrocede un día**: la semana empezaría el domingo por la tarde. Por eso todas
construyen con `new Date(y, m - 1, d)` y ninguna le pasa la cadena al
constructor.

---

## 2. Domingo es 0 — y la convención contraria vivía escrita en seis lugares

`claveDeDia` es la clave del día dentro de `employee_rosters.schedule_data` y de
`schedule_coverage.day_of_week`.

**Domingo es `0`**, que es lo que devuelve `Date.getDay()` y lo que hay
guardado: medido sobre las 103 filas de producción, las únicas claves que
existen son `"0"`..`"6"` y no hay ni una `"7"`.

Existía por escrito la convención contraria —domingo = 7— en **seis** lugares:
el lector del kiosco, el aviso del turno de mañana, la vista de auditoría, el
regreso de vacaciones y el marcado de incapacidad/vacaciones en el horario. El
resultado era que **el domingo era invisible**:

- el kiosco buscaba una clave inexistente, daba el día por libre y pedía
  autorización de supervisor **en cada marcaje dominical**;
- marcar una incapacidad que cae domingo escribía una clave `"7"` que ni la
  pantalla de horarios ni la consolidación de planilla leen jamás.

Hoy `claveDeDia` es el único lugar donde vive la convención, y está anclada en
`tests/unit/kioscoHorario.test.js`. **No escribirla a mano de nuevo.**

---

## 3. El horario se copia solo los sábados

`auto-copy-weekly-roster` corre el sábado **a las 16:00 UTC** y arma la semana que
viene a partir de la actual.

**Eran DOS crons sobre la misma función, y el de más rompía dos cosas.** Hasta el
2026-08-27 existía además `auto-copy-roster-saturday` a las 06:00 UTC —o sea
sábado a medianoche en El Salvador—:

| cron | UTC | hora SV | qué hacía de verdad |
|---|---|---|---|
| `auto-copy-roster-saturday` | 0 6 * * 6 | sáb 00:00 | copiaba |
| `roster-missing-alert-saturday` | 0 15 * * 6 | sáb 09:00 | **no podía avisar nunca** |
| `auto-copy-weekly-roster` | 0 16 * * 6 | sáb 10:00 | no tocaba nada |

El de medianoche ganaba siempre: copiaba, y el de las 10:00 encontraba todo hecho.
O sea que **ninguna corrección hecha el sábado se propagaba**. Y como
`notify_missing_roster` pregunta si hay filas para la semana entrante, con la
copia ya hecha el contador nunca era cero: **la alarma de «faltan horarios» no
podía dispararse**. El orden que el diseño quería era alarma → copia.

El orden importa:

1. Trae los horarios de **esta** semana y los de la **próxima**.
2. Se queda sólo con quien **le falta** el de la próxima — nunca pisa uno ya
   cargado.
3. Busca eventos que **bloqueen**: `VACATION`, `DISABILITY`, `PERMIT` que se
   solapen con la semana entrante.
4. **Copia a quien no tiene conflicto** y lo publica (`status: 'PUBLISHED'`);
   **a los que sí lo tienen NO los copia** y los pone en un aviso.
5. Y mira los **feriados**. No frena la copia —quién trabaja un asueto lo decide
   Talento Humano, no un cron— pero lo dice. Antes `holidays` no se consultaba,
   así que una semana con feriado nacional se copiaba como una semana normal y
   nadie se enteraba.

**Sólo se le copia el horario a quien sigue trabajando.** Salía de
`employee_rosters` a secas, sin cruzar `employees`: a quien se fue se le seguía
armando la semana para siempre, y a las fichas que no son personas también.

**La copia se publica directo.** Es deliberado: un horario en borrador no paga
—`consolidate-timesheets` sólo mira los `PUBLISHED`— así que copiar sin publicar
sería copiar nada.

**Un conflicto no se resuelve solo, se avisa.** La cadena de destinatarios es
Talento Humano primero (los que estén disponibles hoy), y si no hay ninguno,
`ADMIN` + `SUPERADMIN` + Supervisor. Los cuatro queries de ese bloque resuelven
**a quién** se le avisa: si fallaran en silencio, la lista quedaría vacía, el
aviso «se mandaría» y el conflicto no lo vería nadie.

Un `insert` que choca contra la clave única no se reporta como error — significa
que otro camino ya lo creó, que es exactamente lo que se quería.

---

## 4. Lo que un horario publicado decide fuera de esta área

No es sólo una pantalla. De `employee_rosters` dependen:

- **la planilla**, vía `consolidate-timesheets` (horas regulares, extra,
  nocturnas, tardanza);
- **el kiosco**, que decide si un marcaje necesita autorización;
- **el aviso del turno de mañana**;
- **quién está en turno en una sala** (`empleados_en_turno`), que es a quién le
  llegan los avisos de facturas por cargar, de envíos y de traslados.

Por eso una clave de día equivocada no se ve como un bug de horarios: se ve como
«el kiosco pide permiso los domingos» y como horas que no llegan a planilla.

---

## 5. El plan anual de vacaciones

`vacation_plan_headers` (uno por año) y `vacation_plans` (uno por persona), con
estados `DRAFT` → `PRE_APPROVED` → aprobado. La pre-aprobación masiva toca
**sólo** los que están en `DRAFT`: aprobar en bloque no puede pisar una decisión
ya tomada.

Puede generarse con asistencia (`generate-vacation-plan`), y eso queda anotado en
`ai_generated` del encabezado — no para lucirlo, sino porque un plan propuesto y
uno acordado no se revisan igual.

---

## 6. Antes de tocar algo en Horarios

0. **El día lo resuelve `resolverTurnoDelDia` / `turno_del_dia`.** Si estás por
   escribir `dayData.shiftId ? … : …` o `dayData.customStart || shift.start`,
   parate: ya existe, y la última vez que se escribió cuatro veces el kiosco
   pedía autorización de supervisor para marcar.
1. **Nunca `new Date('YYYY-MM-DD')`.** Construir con `new Date(y, m-1, d)`.
2. **La clave del día sale de `claveDeDia`.** Domingo es 0. No escribirla a mano
   ni «normalizarla» a 7.
3. **La semana sale de `utils/semana.js`**, y ese archivo se queda sin
   dependencias.
4. **Un horario en borrador no paga.** Si el flujo nuevo tiene que llegar a
   planilla, tiene que terminar en `PUBLISHED`. Y por eso **guardar una celda NO
   toca el estado**: hasta el 2026-08-27 mandaba `status: 'DRAFT'`, así que
   corregir una semana publicada la devolvía a borrador — y el botón de publicar
   quedaba `disabled`, o sea que esas horas no llegaban a planilla nunca.
   `guardar_dia_de_horario` escribe UN día y no toca `status`; publicar es
   repetible.
4b. **Un día se escribe con `guardar_dia_de_horario`, no reescribiendo el
   roster.** Leer, tocar una clave y reescribir el objeto entero pisa lo que otra
   sesión guardó en otro día de esa misma semana.
5. **Al agregar un tipo de evento que impida trabajar, agregarlo a
   `BLOCKING_EVENT_TYPES`** — si no, la copia del sábado le va a armar la semana
   igual a quien no va a estar.
6. **`npm run gate:bundle`** después de tocar los imports de `scheduleHelpers`.
7. **Las constantes del reglamento salen de `utils/turnoDelDia.js`**, con el
   artículo al lado: 44 h la semana diurna y 39 la nocturna, 8 h la jornada y 7
   la nocturna, un descanso por semana, ocho horas entre jornadas. Estaban
   escritas a mano en seis sitios, con dos umbrales distintos y un badge que
   rotulaba «+8H» sobre un umbral de 9.
8. **Los detectores de `gate:movil` miran filas de `DataTable`, y esta área no
   usa ninguna.** Un verde de ese gate acá no dice nada sobre el teléfono: hay
   que abrirlo. Los tres defectos que destapó la auditoría del 27-ago —el
   catálogo de sólo lectura, el editor que se cerraba con el scroll, las celdas
   que no se anunciaban— pasaban el gate sin un hallazgo.
