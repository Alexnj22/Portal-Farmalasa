# Horarios, turnos y vacaciones — la semana, el día, y lo que se copia solo

**Escrito el 2026-08-24**, durante la auditoría completa del portal. Era una de
las once áreas sin documento propio.

Casi todo lo que se rompió acá se rompió por **una convención de calendario que
existía escrita de dos maneras distintas**. Ninguna de las dos daba error.

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

`auto-copy-weekly-roster` corre el sábado y arma la semana que viene a partir de
la actual. El orden importa:

1. Trae los horarios de **esta** semana y los de la **próxima**.
2. Se queda sólo con quien **le falta** el de la próxima — nunca pisa uno ya
   cargado.
3. Busca eventos que **bloqueen**: `VACATION`, `DISABILITY`, `PERMIT` que se
   solapen con la semana entrante.
4. **Copia a quien no tiene conflicto** y lo publica (`status: 'PUBLISHED'`);
   **a los que sí lo tienen NO los copia** y los pone en un aviso.

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
- **el aviso del turno de mañana**.

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

1. **Nunca `new Date('YYYY-MM-DD')`.** Construir con `new Date(y, m-1, d)`.
2. **La clave del día sale de `claveDeDia`.** Domingo es 0. No escribirla a mano
   ni «normalizarla» a 7.
3. **La semana sale de `utils/semana.js`**, y ese archivo se queda sin
   dependencias.
4. **Un horario en borrador no paga.** Si el flujo nuevo tiene que llegar a
   planilla, tiene que terminar en `PUBLISHED`.
5. **Al agregar un tipo de evento que impida trabajar, agregarlo a
   `BLOCKING_EVENT_TYPES`** — si no, la copia del sábado le va a armar la semana
   igual a quien no va a estar.
6. **`npm run gate:bundle`** después de tocar los imports de `scheduleHelpers`.
