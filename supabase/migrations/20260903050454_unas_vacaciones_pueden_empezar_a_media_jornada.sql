SET lock_timeout = '5s';

-- ── Unas vacaciones pueden empezar a media jornada ─────────────────────────
--
-- `vacation_plans` guardaba sólo `start_date` y `end_date`, o sea días
-- completos. Pedido del usuario: asentar las del supervisor «desde el sábado a
-- las 12 pm al 21 del mes a las 8 am» — un rango que la tabla no podía
-- expresar, y que se venía redondeando a día entero por los dos lados.
--
-- NULL = día completo. Es lo que son todas las filas que ya existen, así que no
-- hay que tocar ninguna ni inventarles una hora que nadie escribió.
--
-- ── La hora CAMBIA la cuenta de días, y ése es el punto ────────────────────
-- La pantalla contaba `end - start + 1`. Del 5 al 21 de septiembre eso da 17,
-- y el saldo vacacional del año son 15 — o sea que asentar el rango real
-- pasaba el tope por dos días que la persona sí trabaja.
--
-- Con las horas la cuenta cierra sola: sale el sábado 5 al mediodía y vuelve el
-- 21 a las 8, así que los días enteros libres son del 6 al 20 = **15**. La
-- regla es esa y no una fórmula aparte: **un extremo con hora no es un día
-- completo, así que no se cuenta**. Sin horas, nada cambia.
--
-- No se toca `payroll.js`, que cruza por solapamiento de fechas y le da igual
-- la hora, ni `days`, que se sigue guardando desde la pantalla.
ALTER TABLE public.vacation_plans
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

COMMENT ON COLUMN public.vacation_plans.start_time IS
  'Hora en que ARRANCAN las vacaciones el día `start_date`. NULL = día completo. Con hora, ese día no cuenta como día de vacación: la persona trabajó parte de él.';
COMMENT ON COLUMN public.vacation_plans.end_time IS
  'Hora en que TERMINAN las vacaciones el día `end_date` — o sea a qué hora se reincorpora. NULL = día completo. Con hora, ese día tampoco cuenta.';
