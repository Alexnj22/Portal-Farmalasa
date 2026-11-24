# Reglas de pago de las horas

Decididas por el usuario el 2026-11-23. Base legal: Código de Trabajo (CT,
`docs/legal/normativa/laboral/codigo_de_trabajo_2025-08.txt`) y Reglamento
Interno de Trabajo (RIT, `docs/legal/empresa/reglamento_interno_de_trabajo.txt`).

El código vive en tres sitios y cada regla lleva su artículo al lado:

| pieza | archivo |
|---|---|
| consolidar el día (tramos, tope, descanso trabajado) | `supabase/functions/_shared/tiempoTrabajado.ts` (`consolidarDia`) y `consolidate-timesheets/index.ts` |
| qué paga cada día y qué semanas quedan en duda | `src/utils/reglasDePago.js` |
| la planilla | `src/store/slices/payrollSlice.js` (`generatePayroll`) |
| lo que decide Talento Humano | Auditoría de tiempos → panel «Por decidir» (`src/components/asistencia/PorDecidirPanel.jsx`); en la base, `decidir_horas_extra` y `decidir_descanso_semanal` |

## La jornada y el tope del día

- **RIT Art. 16 / CT Art. 161**: jornada ordinaria de 8 h diurnas o 7 nocturnas
  (más de 4 h nocturnas vuelven nocturna la jornada). El tope de horas regulares
  de un día son las horas PAGADAS del horario (`turno_del_dia.minutos_pagados`,
  con la pausa descontada), nunca más de 8 / 7. Sin horario (descanso trabajado
  o sin horario publicado) el tope es la jornada legal.
- **RIT Art. 61**: la lactancia es tiempo trabajado y pagado. No parte la
  jornada, aunque vaya pegada a la entrada, a la salida o a la pausa.
- La jornada partida (7–12 y 16–19) es una jornada con una pausa larga: se suman
  los tramos trabajados, nunca primera entrada → última salida.

## 1. Horas de más — CT Arts. 169 y 170

- Art. 169: recargo del 100 % sobre el salario básico por hora (× 2). De noche,
  el 25 % del Art. 168 se calcula sobre la hora extra: **× 2,5**, pagado en dos
  renglones como en la boleta de la empresa: «horas noct. extraordinarias
  (50 %)» × 0,5 y «horas extra nocturnas» × 2. Hasta el 2026-11-23 era × 2,25
  en un solo renglón (le faltaba 0,25 por hora).
- Art. 170: sólo ocasionales.
- **Talento Humano decide en CADA caso** si van a PAGO o al BANCO de horas
  (`timesheets.extra_decision`). Mientras no decide, la planilla no las paga ni
  las banca y no se puede aprobar (`payroll_entries.extras_por_decidir_horas`).
  Hasta el 2026-11-23 iban al banco solas.
- Si una reconsolidación cambia las horas de más de un día, la decisión vuelve a
  «por decidir»: era sobre otras horas.

## 2. Descanso, asueto y nocturno

- **Día de descanso trabajado — CT Art. 175 / RIT Art. 30**: salario básico más
  un mínimo de 50 % por las horas trabajadas (× 1,5), y un día de descanso
  compensatorio remunerado en la misma semana o la siguiente (**CT Art. 176**;
  `payroll_entries.descansos_compensatorios` los cuenta). La consolidación lo
  marca en `timesheets.is_rest_day_worked` cuando la persona tenía horario
  publicado, ese día no trabajaba y marcó.
- **Asueto trabajado — CT Art. 192**: salario ordinario más 100 % (× 2).
- **Nocturno — CT Art. 168**: un mínimo de 25 % desde las 19:00.
- **Extra o nocturno en descanso o asueto — CT Arts. 175 y 192, inciso 2**: el
  recargo se calcula sobre el salario extraordinario de ese día (× 1,5 o × 2).
- Interpretación escrita (para revisar con el contador): el sueldo es mensual y
  ya incluye el pago del descanso y del asueto (CT Arts. 174 y 190). Trabajarlos
  agrega encima el salario de esas horas con su recargo; en la planilla va en
  `holiday_surcharge`.

## 3. Tardanza — RIT Arts. 23, 25 y 26; CT Art. 171

- Se suman los minutos tarde de la SEMANA (lunes a domingo), con **10 minutos de
  tolerancia semanal** (RIT Art. 26).
- Si pasa de 10, o la semana no se completó sin causa justificada (ausencia sin
  tipo; RIT Art. 25, CT Art. 171), la planilla PROPONE «pierde el pago del
  descanso semanal». Talento Humano lo confirma o lo justifica
  (`descanso_semanal_decisiones`) antes de que cuente: sólo lo confirmado resta
  un día. La semana se juzga en la quincena donde cae su domingo.
- **Nunca se descuentan minutos ni horas de tardanza.**
- Las amonestaciones (**RIT Art. 82**) no son automáticas y no las genera el
  portal.

## 4. El cierre de la quincena — freno y aviso (2026-11-23)

«Talento Humano debe confirmar todo eso antes de cada 15 o fin de mes.»

- **Freno**: mientras quede algo por resolver en la quincena, no se cierra:
  horas de más sin decidir, semanas con el descanso en duda y **marcaciones
  incompletas**. La cuenta es UNA, en la base: `pendientes_de_quincena(desde,
  hasta, personas)`. La consultan Auditoría de tiempos (portal) y la Quincena
  de la app antes de cerrar o de aprobar a una persona, y el trigger de
  sentencia `timesheets_freno_de_cierre` rechaza cualquier UPDATE que apruebe
  días con pendientes (o una marcación incompleta tal cual). La regla del
  descanso es la de `semanasConDescansoEnDuda`: si se cambia una, se cambia la
  otra.
- **Aviso**: el cron `avisar-cierre-quincena-8am-sv` (08:00 SV, todos los días)
  llama a `avisar_cierre_de_quincena()`, que sólo avisa 3 días antes del 15 y
  del último día del mes, y otra vez el mismo día del cierre, si queda algo.
  Le llega a quien edita la auditoría de tiempos. Sin pendientes, no avisa.

## 5. La boleta de pago, renglón por renglón (2026-11-23)

Comparada con la boleta de la empresa (estructura y tasas; los datos de la
persona no se copian):

| renglón | regla | portal |
|---|---|---|
| sueldo diario / por hora | mensual / 30; diario / 8 con 4 decimales | coincide (la boleta del portal mostraba la hora con 2: corregido) |
| salario ordinario | días (admite 0,5) × diario | coincide |
| nocturnas ordinarias | sólo el recargo, × 0,25 | coincide |
| nocturnas extraordinarias | × 0,5, renglón aparte | corregido: la planilla no lo llenaba |
| extra diurna / extra nocturna | × 2 cada una (la nocturna suma 2,5 con la anterior) | corregido: era × 2,25 |
| recargo de asuetos | monto aparte, encima del salario ordinario | coincide (aquí cae también el descanso trabajado) |
| bonificaciones | monto con su concepto (el bono por venta) | corregido: faltaba el concepto (`bonificaciones_detalle`) |
| bono vacacional | 30 % sobre el salario de las vacaciones | coincide |
| viáticos | monto con su concepto | coincide |
| ISSS / AFP / renta | sólo sobre el salario ordinario; renta con la tabla quincenal | coincide; redondeo a centavos mitad hacia arriba (corregido) |
| orden de descuento, otros, adelanto | descuentos | coincide |
| líquido | (A − C) + B | coincide |

Para el contador (no se cambió): la boleta trata las extras, los recargos, el
bono vacacional y los viáticos como «no sujetos a retención». El portal lo
replica tal cual. Que las horas extra y los recargos no coticen ISSS/AFP ni
paguen renta es un criterio de la empresa que conviene confirmar.
