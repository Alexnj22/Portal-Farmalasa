import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders } from "../_shared/security.ts";
import {
  CST_OFFSET_MS, mondayOfWeek,
  consolidarDia, turnoEnInstantes, type MarcaConDetalle,
} from "../_shared/tiempoTrabajado.ts";

// La matemática pura (descansos, reparto nocturno, tramos, tardanza) vive en
// `_shared/tiempoTrabajado.ts`, con pruebas, y la pantalla de auditoría usa la
// MISMA tardanza. Acá queda sólo lo que habla con la base.

interface DayException {
  date: string;
  customStart?: string;
  customEnd?: string;
  lunchTime?: string;
  lactationTime?: string;
  note?: string;
}

// Yesterday in El Salvador (UTC-6)
function yesterdayCST(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - CST_OFFSET_MS);
  cst.setUTCDate(cst.getUTCDate() - 1);
  return cst.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Auditoría 2026-07: gate obligatorio — cron.job (jobid 148) ya envía
  // x-cron-secret, confirmado. Ver AUDITORIA-2026-07.md, sección Remediado.
  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let workDate: string;
    try {
      const body = await req.json();
      workDate = body?.work_date || yesterdayCST();
    } catch {
      workDate = yesterdayCST();
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Day of week key: JS Date.getDay() — 0=Sun, 1=Mon … 6=Sat
    const dayKey = String(new Date(workDate + 'T12:00:00').getDay());

    // 1. Holiday check
    // Si esto falla en silencio, el día deja de ser asueto y las horas se
    // consolidan como jornada normal — un error de planilla, no de sistema.
    const { data: holidayRows, error: holidayErr } = await supabase
      .from('holidays')
      .select('id')
      .eq('holiday_date', workDate)
      .limit(1);
    // El `error` se desestructuraba y nunca se miraba (auditoría 2026-10-21):
    // si la lectura fallaba el 15-sep, el día se consolidaba sin recargo.
    if (holidayErr) throw holidayErr;
    const isHoliday = (holidayRows?.length ?? 0) > 0;

    // 2. Load PUBLISHED rosters for this exact week + shifts in parallel
    const weekStart = mondayOfWeek(workDate);
    console.log(`Consolidating ${workDate} (week: ${weekStart})`);
    const [{ data: rosters, error: rosterErr }, { data: shiftsData, error: shiftErr }] =
      await Promise.all([
        supabase.from('employee_rosters')
          .select('employee_id, schedule_data')
          .eq('week_start_date', weekStart)
          .eq('status', 'PUBLISHED'),
        supabase.from('shifts').select('id, start_time, end_time, lunch_start, lunch_minutes'),
      ]);
    if (rosterErr) throw rosterErr;
    if (shiftErr)  throw shiftErr;

    // El catálogo tal cual, para `turno_del_dia` (lee start_time, end_time,
    // lunch_start y lunch_minutes del turno).
    const shiftMap = new Map<number, Record<string, unknown>>();
    for (const s of shiftsData || []) shiftMap.set(s.id, s as Record<string, unknown>);

    // 3. Load per-employee exceptions for workDate.
    const rosterEmpIds = (rosters || []).map(r => String(r.employee_id));
    const exceptionMap = new Map<string, DayException>();

    if (rosterEmpIds.length > 0) {
      const { data: empRows, error: empRowsErr } = await supabase
        .from('employees')
        .select('id, exceptions')
        .in('id', rosterEmpIds);
      // Sin excepciones cargadas, todas se aplican como si no existieran.
      if (empRowsErr) throw new Error(`employees(exceptions): ${empRowsErr.message}`);

      for (const emp of empRows || []) {
        const list: DayException[] = Array.isArray(emp.exceptions) ? emp.exceptions : [];
        const ex = list.find(e => e.date === workDate);
        if (ex) exceptionMap.set(String(emp.id), ex);
      }
    }

    // 4a. Load approved absence requests to classify justified absences
    // El error acá convierte una ausencia JUSTIFICADA en injustificada.
    //
    // Acotado a las solicitudes creadas en el último año: sin filtro esto crece
    // sin techo y PostgREST corta en 1000 filas SIN avisar, así que el día que
    // se cruce ese número las ausencias más viejas desaparecen del Map y las de
    // gente que sí está de vacaciones se consolidan como injustificadas.
    const haceUnAnio = new Date(workDate + 'T12:00:00Z');
    haceUnAnio.setUTCFullYear(haceUnAnio.getUTCFullYear() - 1);
    // El `.in('type', …)` va sobre una columna que se repite, así que acotar la
    // entrada no acota la salida (detector `in-columna-repetida`). Lo que la
    // acota son los OTROS dos filtros: aprobadas y del último año. Medido el
    // 2026-08-17 sobre prod: 0 filas. `approval_requests` tiene 36 en total.
    // El día que el expediente crezca de verdad, esto pagina.
    const { data: absenceRequests, error: absenceErr } = await supabase
      .from('approval_requests')
      .select('employee_id, type, metadata')
      .in('type', ['VACATION', 'DISABILITY', 'PERMIT'])
      .eq('status', 'APPROVED')
      .gte('created_at', haceUnAnio.toISOString());
    if (absenceErr) throw new Error(`approval_requests aprobadas: ${absenceErr.message}`);

    const absenceTypeMap = new Map<string, string>();
    for (const req of absenceRequests || []) {
      const meta   = (typeof req.metadata === 'object' && req.metadata) ? req.metadata as Record<string, unknown> : {};
      const empId  = String(req.employee_id);
      const type   = req.type as string;
      if (type === 'PERMIT') {
        const dates = Array.isArray(meta.permissionDates) ? meta.permissionDates as string[] : [];
        if (dates.includes(workDate)) absenceTypeMap.set(empId, 'PERMIT');
      } else {
        const startDate = ((meta.startDate || meta.date) as string | undefined);
        const endDate   = ((meta.endDate   || startDate) as string | undefined);
        if (startDate && endDate && startDate <= workDate && endDate >= workDate) {
          absenceTypeMap.set(empId, type);
        }
      }
    }

    // 4a-bis. Suspendidos del RIT Art. 83.
    //
    // No es una ausencia SOLICITADA sino IMPUESTA, así que no vive en
    // `approval_requests` como vacación, incapacidad y permiso: vive en
    // `employee_events`. Y gana sobre las otras tres — una vacación aprobada no
    // convierte en pagado un día que una sanción dejó sin goce de salario.
    //
    // Sale de `suspendidos_en()` y NO de una consulta armada acá: la regla «sin
    // `endDate` la suspensión es de UN día» tiene que estar escrita una sola
    // vez. Dos lugares respondiendo lo mismo es como se rompió `turno_del_dia`.
    const { data: suspData, error: suspErr } = await supabase.rpc('suspendidos_en', { p_fecha: workDate });
    if (suspErr) throw new Error(`suspendidos_en: ${suspErr.message}`);
    const suspendidos = new Set<string>(((suspData as string[] | null) || []).map(String));
    for (const empId of suspendidos) absenceTypeMap.set(empId, 'SUSPENSION');

    // 4b. Load attendance punches in CST day window (UTC-6)
    //
    // La ventana llega hasta las 08:00 del día siguiente para alcanzar la
    // salida de un turno que cruza la medianoche. La ENTRADA se sigue buscando
    // sólo dentro del día, así que un marcaje de madrugada no puede ser tomado
    // como el inicio de la jornada siguiente.
    const dayStart    = workDate + 'T00:00:00-06:00';
    const dayEnd      = workDate + 'T23:59:59-06:00';
    const ventanaFin  = new Date(new Date(dayEnd).getTime() + 8 * 3600000).toISOString();
    const { data: punches, error: punchErr } = await supabase
      .from('attendance')
      .select('employee_id, type, timestamp, details')
      .gte('timestamp', dayStart)
      .lte('timestamp', ventanaFin)
      .order('timestamp', { ascending: true });
    if (punchErr) throw punchErr;
    const finDelDia = new Date(dayEnd).getTime();

    // Index punches by employee_id
    const punchMap = new Map<string, MarcaConDetalle[]>();
    for (const p of punches || []) {
      const key = String(p.employee_id);
      if (!punchMap.has(key)) punchMap.set(key, []);
      punchMap.get(key)!.push(p);
    }

    // Quién se consolida: quien tiene horario publicado MÁS quien marcó ese día.
    //
    // Antes sólo entraban los del roster, y quien no tuviera horario publicado
    // no recibía timesheet aunque hubiera marcado entrada y salida — sus horas
    // no llegaban a planilla y nadie se enteraba. Deja de ser un caso raro
    // desde que el kiosco acepta marcar sin horario cargado (decisión del
    // 2026-08-16): para la semana del 17-ago, 41 de 49 empleados activos no
    // tenían horario publicado.
    const rosterPorEmpleado = new Map<string, Record<string, unknown>>();
    for (const r of rosters || []) rosterPorEmpleado.set(String(r.employee_id), r.schedule_data);

    const aConsolidar = new Set<string>(rosterEmpIds);
    for (const empId of punchMap.keys()) aConsolidar.add(empId);
    const idsAConsolidar = [...aConsolidar];

    // Pre-cargar timesheets existentes del día en un Map (evita un SELECT por empleado)
    const timesheetIdMap = new Map<string, number>();
    if (idsAConsolidar.length > 0) {
      // ACOTADA POR EL DATO: `employee_id` se repite en `timesheets` (una fila
      // por persona y día), pero el `.eq('work_date', …)` fija UN día, así que
      // el techo es la plantilla entera. Medido el 2026-08-17: 49 empleados y
      // un máximo de 7 marcaciones en un mismo día.
      const { data: existingTs, error: existingTsErr } = await supabase
        .from('timesheets')
        .select('id, employee_id')
        .eq('work_date', workDate)
        .in('employee_id', idsAConsolidar);
      // El Map vacío hace creer que no hay timesheet previo y se duplica el día.
      if (existingTsErr) throw new Error(`timesheets del ${workDate}: ${existingTsErr.message}`);
      for (const t of existingTs || []) timesheetIdMap.set(String(t.employee_id), t.id);
    }

    let upserted = 0;
    let skipped  = 0;
    let failed   = 0;

    for (const empId of idsAConsolidar) {
      const scheduleData = rosterPorEmpleado.get(empId) as Record<string, { isOff?: boolean; isOffDay?: boolean; shiftId?: string; shift_id?: string; customStart?: string; customEnd?: string }> | undefined;
      const dayData   = scheduleData?.[dayKey];
      const exception = exceptionMap.get(empId);
      const marcoHoy  = (punchMap.get(empId) || []).length > 0;

      // Las formas de «no trabaja» del canónico (`src/utils/turnoDelDia.js` /
      // `public.turno_del_dia`), auditoría 2026-10-21: acá sólo se miraba
      // `isOff`, así que un `isOffDay` sin marcaciones salía como AUSENCIA, y la
      // clave `shift_id` no se leía. Hasta que esta función llame al gemelo de
      // SQL, las reglas se copian de ahí y se mueven juntas.
      const rawShiftId = dayData?.shiftId ?? dayData?.shift_id ?? null;
      const isOffInRoster = !dayData || !!dayData.isOff || !!dayData.isOffDay
        || String(rawShiftId).toUpperCase() === 'LIBRE';
      // Sin turno y sin marcar: no hay nada que consolidar. Pero si marcó, sí
      // hay — y ahí se consolida lo que efectivamente trabajó.
      if (isOffInRoster && !exception && !marcoHoy) {
        skipped++;
        continue;
      }

      // El horario del día lo resuelve EL canónico, `public.turno_del_dia`
      // (2026-11-23): hasta hoy esto leía customStart/customEnd/shiftId a mano
      // y nunca leía la pausa, así que el tope era fin − inicio (9 h en un
      // turno de 8 con almuerzo; 12 h en la jornada partida).
      // La excepción del día (Talento Humano) manda sobre las horas y la pausa.
      const shiftId = (!isOffInRoster && rawShiftId != null && rawShiftId !== '')
        ? parseInt(String(rawShiftId), 10)
        : null;
      let diaParaResolver: Record<string, unknown> | null = isOffInRoster ? null : { ...(dayData as Record<string, unknown>) };
      if (exception?.customStart && exception?.customEnd) {
        diaParaResolver = {
          ...(diaParaResolver || {}),
          isOff: false, isOffDay: false,
          customStart: exception.customStart, customEnd: exception.customEnd,
          ...(exception.lunchTime ? { hasLunch: true, lunchStart: exception.lunchTime } : (isOffInRoster ? { hasLunch: false } : {})),
          ...(exception.lactationTime ? { hasLactation: true, lactationStart: exception.lactationTime } : {}),
        };
      }
      let resuelto: Record<string, unknown> | null = null;
      if (diaParaResolver) {
        const { data: r, error: rErr } = await supabase.rpc('turno_del_dia', {
          p_dia: diaParaResolver,
          p_turno: shiftId !== null && !isNaN(shiftId) ? (shiftMap.get(shiftId) ?? null) : null,
        });
        if (rErr) throw new Error(`turno_del_dia(${empId}): ${rErr.message}`);
        resuelto = r as Record<string, unknown>;
      }
      const turno = turnoEnInstantes(workDate, resuelto, diaParaResolver);
      const scheduledStart = turno ? String(resuelto!.inicio) : null;
      const scheduledEnd   = turno ? String(resuelto!.fin) : null;

      const empPunches = punchMap.get(empId) || [];
      const ventanaDelDia = { inicioDelDia: new Date(dayStart), finDelDia: new Date(finDelDia) };

      let dia = consolidarDia(empPunches, { ...ventanaDelDia, turno });
      let autoPunched = false;

      // Terminó dentro de un tramo: se le genera la salida a la hora de fin del
      // horario (como siempre), y queda para revisión de Talento Humano.
      // A un suspendido NO se le genera la salida. Marcar no puede —el kiosco lo
      // frena— así que si llegó hasta acá con una entrada es porque marcó ANTES
      // de que se registrara la sanción; fabricarle además una salida
      // convertiría ese resto en una jornada completa que nadie trabajó.
      if (dia.abierta && turno && !suspendidos.has(empId)) {
        const autoEndTime = turno.fin;
        const punchType   = isOffInRoster ? 'OUT_EXTRA' : 'OUT';
        const { error: autoErr } = await supabase.from('attendance').insert({
          employee_id: empId,
          timestamp:   autoEndTime.toISOString(),
          type:        punchType,
          details:     {
            autoInserted:    true,
            pendingHRReview: true,
            reason:          'Salida no registrada. Se generó sola.',
            isExceptionDay:  !!exception,
          },
        });
        if (!autoErr) {
          dia = consolidarDia(empPunches, { ...ventanaDelDia, turno, salidaAutomatica: autoEndTime });
          autoPunched = true;
          console.log(`Auto-punch ${punchType} for ${empId} at ${scheduledEnd} CST on ${workDate}${exception ? ' [exception]' : ''}`);
        } else {
          console.error(`Auto-punch failed for ${empId}:`, autoErr.message);
        }
      }

      // Ausente = ninguna marca. Quien olvidó la entrada pero marcó otras
      // cosas NO es ausente (no se le descuenta el día): queda INCOMPLETE.
      const isAbsent    = dia.sinMarcas;
      const actualStart = dia.inicioReal;
      const actualEnd   = dia.finReal;
      const regularHours     = dia.minutosRegulares / 60;
      const overtimeHours    = dia.minutosExtra / 60;
      const nocturnalHours   = parseFloat((dia.minutosNocturnos / 60).toFixed(2));
      const nocturnalOTHours = parseFloat((dia.minutosNocturnosExtra / 60).toFixed(2));
      const lateMinutes      = dia.minutosTardanza;
      if (dia.pausaSinMarcar) console.log(`Pausa sin marcar para ${empId} el ${workDate}: se descontó la del horario`);

      // Upsert (id existente resuelto desde el Map pre-cargado)
      const existingId = timesheetIdMap.get(empId);

      const payload = {
        employee_id:               empId,
        work_date:                 workDate,
        scheduled_shift_id:        shiftId !== null && !isNaN(shiftId) ? shiftId : null,
        actual_start_time:         actualStart?.toISOString() ?? null,
        actual_end_time:           actualEnd?.toISOString()   ?? null,
        regular_hours:             parseFloat(regularHours.toFixed(2)),
        overtime_hours:            parseFloat(overtimeHours.toFixed(2)),
        nocturnal_hours:           nocturnalHours,
        nocturnal_overtime_hours:  nocturnalOTHours,
        late_minutes:              lateMinutes,
        is_absent:                 isAbsent,
        // La suspensión se anota AUNQUE la persona no figure ausente. Suena
        // contradictorio y por eso mismo se escribe: alguien suspendido que
        // igual tiene marcajes es justo lo que quien revisa la planilla tiene
        // que ver. Si se guardara `null` —porque `isAbsent` es false— el día se
        // pagaría como cualquier otro y nadie se enteraría.
        absence_type:              suspendidos.has(empId)
                                     ? 'SUSPENSION'
                                     : (isAbsent ? (absenceTypeMap.get(empId) || null) : null),
        is_holiday_worked:         !isAbsent && isHoliday,
        // INCOMPLETE gana: una salida generada sobre un día al que además le
        // falta la entrada sigue siendo un día por revisar.
        status:                    dia.incompleta ? 'INCOMPLETE' : (autoPunched ? 'AUTO_PUNCHED' : 'PENDING'),
        updated_at:                new Date().toISOString(),
      };

      const { error: upsertErr } = existingId
        ? await supabase.from('timesheets').update(payload).eq('id', existingId)
        : await supabase.from('timesheets').insert([payload]);

      if (upsertErr) {
        console.error(`Timesheet upsert failed for ${empId} on ${workDate}:`, upsertErr.message);
        failed++;
        continue;
      }

      upserted++;
      if (exception) {
        console.log(`Exception applied for ${empId} on ${workDate}: ${scheduledStart}–${scheduledEnd}${isOffInRoster ? ' [was OFF day]' : ' [shift override]'}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, work_date: workDate, upserted, skipped, failed }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('consolidate-timesheets error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
