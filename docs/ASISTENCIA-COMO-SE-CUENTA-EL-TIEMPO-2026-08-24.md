# Asistencia — cómo el portal convierte marcaciones en horas de planilla

**Escrito el 2026-08-24**, durante la auditoría completa del portal, porque
Asistencia era una de las once áreas sin un solo documento propio y es de las que
menos perdona un error: lo que sale de acá se paga.

Este documento describe lo que el código **hace hoy**. Cada regla no obvia está
anotada con por qué está así — que es la parte que no se puede leer del código.

---

## 1. Las tres piezas, y quién manda sobre cada número

| pieza | qué hace | dónde vive |
|---|---|---|
| El kiosco | recibe la marcación y la escribe en `attendance` | fuera de estas vistas |
| `consolidate-timesheets` | cada madrugada convierte las marcaciones del día anterior en UNA fila de `timesheets` | `supabase/functions/consolidate-timesheets/index.ts` |
| La auditoría de tiempos | muestra la quincena, deja corregir a mano y manda a planilla | `src/views/AttendanceAuditView.jsx` |
| El monitor | quién está adentro AHORA | `src/views/AttendanceMonitorView.jsx` |

**El número que se paga sale del cron, no de la pantalla.** La pantalla vuelve a
calcular la tardanza para mostrarla, pero `timesheets.late_minutes` ya venía
escrito. Son dos copias de la misma fórmula —una en Deno, otra en el navegador—
y hoy dan lo mismo: se comprobó sobre las 429 filas, todas en 0. Están anotadas
como duplicadas en `src/data/attendanceAudit.js` para que el día que una cambie
se cambie la otra.

---

## 2. El huso horario es el error más caro de esta área

Todo el portal vive en El Salvador (UTC−6) y **nada** en la base guarda esa
hora: `attendance.timestamp` es un instante UTC. Leer ese instante en la hora
local de quien mira mueve turnos de día.

Tres reglas, las tres escritas en el código:

- **`getCSTDateStr`** resta seis horas y recién ahí corta el `YYYY-MM-DD`. Un
  turno que termina a las 22:00 de El Salvador son las 04:00 UTC del día
  siguiente: sin la resta, esa salida se contaría al día siguiente.
- **La quincena se decide con la misma resta** (`src/views/asistencia/quincena.js`).
  El 16 a la medianoche de El Salvador todavía es la primera quincena, y un turno
  de las 20:00 del día 15 no puede saltar al período que viene.
- **Un horario `HH:MM` NO lleva huso.** «08:00» son las ocho de la mañana en la
  sala, no un instante. Restarle seis horas lo correría — está anclado en
  `tests/unit/quincenaDeAsistencia.test.js`.

La semana arranca el **lunes**, y el domingo pertenece a la semana que ya pasó:
`(getUTCDay() + 6) % 7`. Con `getUTCDay()` a secas el domingo saltaría a la
semana siguiente.

---

## 3. Qué hace el cron, paso por paso

Corre `consolidate-timesheets-daily` sobre **el día de ayer en El Salvador**, y
acepta un `work_date` en el cuerpo para rehacer un día puntual.

1. **¿Es asueto?** Una fila en `holidays`. Si esta consulta fallara en silencio,
   el día dejaría de ser asueto y las horas se consolidarían como jornada
   normal — un error de planilla, no de sistema. Por eso el error se lanza.
2. **El horario publicado de esa semana** (`employee_rosters`, `status =
   'PUBLISHED'`, lunes de la semana). Sólo el publicado: un borrador no paga.
3. **Las excepciones del día** (`employees.exceptions`, un `jsonb` por persona).
   Pisan al horario: `customStart`/`customEnd` ganan sobre el turno.
4. **Las ausencias aprobadas** (`approval_requests` de tipo `VACATION`,
   `DISABILITY`, `PERMIT`). Es lo que separa una falta **justificada** de una
   injustificada. Acotada al último año a propósito: sin filtro, el día que la
   tabla cruce las 1000 filas PostgREST corta sin avisar y quien está de
   vacaciones aparece faltando.
5. **Las marcaciones del día**, en una ventana que llega hasta las **08:00 del
   día siguiente** para alcanzar la salida de un turno que cruza la medianoche.
   Pero **la entrada se busca sólo dentro del día**: sin esa distinción, un
   marcaje de madrugada sería tomado como el inicio de la jornada siguiente.

### A quién se le consolida

**A quien tiene horario publicado MÁS a quien marcó.** Antes eran sólo los del
horario, y quien marcara sin horario publicado no recibía fila: sus horas no
llegaban a planilla y nadie se enteraba. Dejó de ser un caso raro cuando el
kiosco empezó a aceptar marcaciones sin horario cargado (2026-08-16) — para la
semana del 17-ago, **41 de 49 empleados activos** no tenían horario publicado.

---

## 4. Cómo se reparten las horas

```
netMins   = (salida − entrada) − almuerzo − lactancia
shiftMins = fin del turno − inicio del turno       (o netMins si no hay turno)

regularHours  = min(netMins, shiftMins) / 60
overtimeHours = max(0, netMins − shiftMins) / 60
```

Cuatro cosas que no se ven en esa fórmula:

- **Los descansos se descuentan por pares** (`LUNCH_START`→`LUNCH_END`,
  `LACTATION_START`→`LACTATION_END`). Una salida sin su regreso no descuenta
  nada — el par incompleto se ignora en vez de restar hasta el fin del día.
- **Sin horario de referencia, el turno ES lo que trabajó.** Se le acreditan sus
  horas y no se le inventa tiempo extra.
- **Un turno que cruza la medianoche** (22:00→06:00) daba `shiftMins = −960`, y
  con eso las horas regulares salían negativas y **todo** lo trabajado se
  facturaba como extra. Hoy ningún turno cruza —el que más tarde termina es a
  las 22:00— pero el `+= 24 * 60` está puesto para que el día que se cree uno no
  se pague mal una quincena.
- **La tardanza nunca es negativa.** Llegar antes es puntual, no «menos veinte
  minutos de tardanza», y un negativo restaría del total de la quincena.

### La jornada nocturna (Art. 168 y 169 del Código de Trabajo)

Nocturno es **de 19:00 a 06:00** de El Salvador. El reparto no se hace por el
turno completo sino **segmento por segmento de trabajo real** (los descansos
quedan afuera), cortando en cada frontera de 19:00 y 06:00 que caiga adentro y
clasificando cada tramo por su punto medio.

Y se parte en dos:

```
nocturna regular = min(nocturna real, nocturna del turno planeado)
nocturna extra   = max(0, nocturna real − nocturna del turno planeado)
```

Con el mismo cuidado del cruce de medianoche: si el fin planeado quedaba antes
del inicio, la parte nocturna del turno planeado daba 0 y **todo** lo nocturno
real se iba a extra nocturna, que se paga más.

---

## 5. La salida que nadie marcó

Si hay entrada y no hay salida, el cron **inserta** una salida a la hora de fin
del turno y marca la fila `AUTO_PUNCHED`. La marcación insertada lleva
`autoInserted: true` y `pendingHRReview: true` en sus `details`.

Dos consecuencias que hay que conocer:

- **Una marcación automática NO espera a que RRHH la revise**, aunque traiga
  `pendingHRReview`. Ya tiene su propio distintivo en pantalla; contarla como
  pendiente inventaría trabajo de revisión que nadie tiene que hacer. Está
  anclado en las pruebas.
- **Sin hora de fin del turno no se genera nada.** Quien marcó sin horario
  publicado y no marcó salida queda con la jornada abierta y en cero horas —
  aparece en la auditoría para corregir a mano.

Una marcación puede ser automática **y** editada a la vez: son excluyentes en la
pantalla, no en el registro, y lo que decide qué distintivo gana es el orden en
que la vista las pregunta.

---

## 6. Qué se puede corregir a mano, y qué queda anotado

La auditoría de tiempos deja editar una marcación. Al hacerlo se escribe en
`details` alguna de `manualAudit`, `editedBy` o `auditedByName` — cualquiera de
las tres alcanza para que la fila salga marcada como editada, porque las tres
convivieron en distintos momentos y ninguna se migró.

Toda edición pasa por `appendAuditLog`. **La marcación original no se
sobrescribe en silencio**: queda la constancia de quién la tocó.

---

## 7. Lo que está probado y lo que no

`tests/unit/quincenaDeAsistencia.test.js` (16 pruebas) ancla los bordes de la
quincena —incluido febrero de un bisiesto, con el último día del mes
*preguntado* y no supuesto—, el lunes de la semana, las 12:00 que no pueden
escribirse «00», y de dónde vino cada marcación.

`src/data/attendanceAudit.js` tiene su matemática expuesta y probada desde el
2026-08-23.

**Sin cobertura automática:** el reparto nocturno del cron. Es la parte con más
aristas de toda el área (segmentos, fronteras, cruce de medianoche) y corre en
Deno, así que la suite del navegador no la alcanza. Hoy se verifica leyendo los
`console.log` de la corrida. Es la deuda más grande del área.

---

## 8. Lo que hay que saber antes de tocar algo acá

1. **Cualquier cambio en la fórmula de la tardanza hay que hacerlo en los dos
   lados** (`consolidate-timesheets/index.ts` y `data/attendanceAudit.js`).
2. **Nunca leer un `timestamp` sin restar las seis horas**, y nunca restárselas
   a un `HH:MM`.
3. **Un turno nuevo que cruce la medianoche** activa tres ramas que hoy nunca se
   ejecutan. Rehacer un día con `work_date` y mirar los números antes de
   publicar ese horario.
4. **Rehacer un día es seguro**: el cron actualiza la fila existente en vez de
   insertar otra. Lo que NO deshace es la salida automática ya insertada en
   `attendance` — ésa queda.
