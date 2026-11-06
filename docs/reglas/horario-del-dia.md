# Un día de horario se resuelve en un solo sitio

> Movido desde `CLAUDE.md` el 2026-11-06 sin cambiar el contenido. Allá queda la regla corta; acá, el detalle, las mediciones y la historia. Las cifras de este archivo son de la fecha en que se escribieron: la verdad vigente vive en el archivo o la tabla que cada párrafo nombra.

## REGLA: un día de horario se resuelve en UN solo sitio (2026-08-27)

`src/utils/turnoDelDia.js` y su gemelo `public.turno_del_dia(jsonb, jsonb)`. Si
estás por escribir `dayData.shiftId ? … : …` o
`dayData.customStart || shift.start_time`, **ya existe**.

Un día de `employee_rosters.schedule_data` puede traer un turno del catálogo, o
horas propias, o las dos. Estaba respondido **cuatro veces con cuatro reglas
distintas**, y ninguna consecuencia se leía como un defecto de horarios:

| quién leía | catálogo | horas propias | `isOff` ausente |
|---|---|---|---|
| `consolidate-timesheets` (planilla) | sí | sí | trabaja |
| las 44 h de la pantalla | sí | sí | trabaja |
| `getTodayScheduleConfig` (kiosco) | sí | **NO** | trabaja |
| `empleados_en_turno()` (avisos de sala) | **NO** | sí | **LIBRE** |

El editor **deja guardar un día con horas propias y sin turno** —la pantalla lo
pinta «Manual» y lo cuenta en las 44 h—, así que para el kiosco esa persona
estaba libre: pedía autorización de supervisor para marcar y la asistencia la
daba ausente. Y la función de SQL invertía el default con
`coalesce((isOff)::boolean, true) = false`: **el día sin la clave contaba como
libre**, al revés de JavaScript, que es quien escribió el dato. Es exactamente lo
que ya costó `get_traslados_por_recibir`.

**Y son SEIS las formas de decir «no trabaja»**, no una: `isOff`, `isOffDay`,
**`shiftId: 'LIBRE'`** (la escriben incapacidad, vacaciones y el regreso
anticipado, y sólo la planilla la conocía), la clave del día ausente, sin horas,
y entrada igual a salida.

Los 55 casos de `tests/unit/turnoDelDia.test.js` valen para los dos gemelos, y se
enfrentaron uno contra otro sobre los 16 que importan — **0 distintas**. Cambiar
uno exige cambiar el otro y volver a enfrentarlos.

**Dos rastros lo habían anotado sin cerrarlo:** el manifiesto de planes decía
«DEVUELVE 0 FILAS incluso [en la sala con más gente] — posible defecto aparte,
verificar», y una migración de agosto, «la cascada NUNCA encontró a nadie en
turno, ni una vez». Una nota que dice «verificar» y nadie verifica es una nota
que ya avisó.

**Las constantes del reglamento también viven ahí**, con su artículo: 44 h la
semana diurna y 39 la nocturna, 8 h la jornada y 7 la nocturna (Art. 16), un
descanso por semana (Art. 19), ocho horas entre jornadas (Art. 21). Estaban
escritas a mano en seis sitios, con dos umbrales distintos y un badge que
rotulaba «+8H» sobre un umbral de 9.

**Guardar una celda NO toca el estado de publicación.** `guardar_dia_de_horario`
escribe un día con `||` sobre el `jsonb`. Antes mandaba `status: 'DRAFT'` y el
roster entero: corregir una semana publicada la devolvía a borrador, el botón
quedaba `disabled`, y como `consolidate-timesheets` sólo lee los `PUBLISHED`,
**esas horas no llegaban a planilla** mientras la pantalla decía «Publicado».

El detalle —la copia del sábado, el cron duplicado que dejaba muda a su propia
alarma, y por qué el catálogo del módulo NO son los turnos del reglamento— en
`docs/HORARIOS-LA-SEMANA-EL-DIA-Y-LA-COPIA-AUTOMATICA-2026-08-24.md`.