import { createClient } from "npm:@supabase/supabase-js@2";

// Punch types stored in the attendance table
const ENTRY_TYPES = new Set(['PUNCH_IN', 'IN', 'IN_EARLY']);
const EXIT_TYPES  = new Set(['PUNCH_OUT', 'OUT', 'OUT_LATE', 'OUT_EARLY', 'OUT_BUSINESS']);
const LUNCH_OUT   = new Set(['LUNCH_START', 'OUT_LUNCH']);
const LUNCH_IN    = new Set(['LUNCH_END',   'IN_LUNCH']);
const LACTAT_OUT  = new Set(['LACTATION_START', 'OUT_LACTATION']);
const LACTAT_IN   = new Set(['LACTATION_END',   'IN_LACTATION']);

function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Sum up paired break intervals (out → in). Returns minutes.
function calcBreakMinutes(
  punches: { type: string; timestamp: string }[],
  outSet: Set<string>,
  inSet: Set<string>,
): number {
  let total = 0;
  let outAt: Date | null = null;
  for (const p of punches) {
    if (outSet.has(p.type)) {
      outAt = new Date(p.timestamp);
    } else if (inSet.has(p.type) && outAt) {
      total += (new Date(p.timestamp).getTime() - outAt.getTime()) / 60000;
      outAt = null;
    }
  }
  return Math.max(0, total);
}

// Yesterday in El Salvador (UTC-6)
function yesterdayCST(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  cst.setUTCDate(cst.getUTCDate() - 1);
  return cst.toISOString().split('T')[0];
}

// Build a UTC Date from a workDate string and a "HH:MM" time in CST (UTC-6)
function cstTimeToUTC(workDate: string, timeStr: string): Date {
  return new Date(`${workDate}T${timeStr}:00-06:00`);
}

// ISO date of the Monday of the week containing workDate
function mondayOfWeek(workDate: string): string {
  const d = new Date(workDate + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  d.setUTCDate(d.getUTCDate() - (dow + 6) % 7);
  return d.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
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
    const { data: holidayRows } = await supabase
      .from('holidays')
      .select('id')
      .eq('holiday_date', workDate)
      .limit(1);
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
        supabase.from('shifts').select('id, start_time, end_time'),
      ]);
    if (rosterErr) throw rosterErr;
    if (shiftErr)  throw shiftErr;

    // Build shift lookup: id → { start: 'HH:MM', end: 'HH:MM' }
    const shiftMap = new Map<number, { start: string; end: string }>();
    for (const s of shiftsData || []) {
      shiftMap.set(s.id, {
        start: String(s.start_time).substring(0, 5),
        end:   String(s.end_time).substring(0, 5),
      });
    }

    // 3. Load attendance punches in CST day window (UTC-6)
    const dayStart = workDate + 'T00:00:00-06:00';
    const dayEnd   = workDate + 'T23:59:59-06:00';
    const { data: punches, error: punchErr } = await supabase
      .from('attendance')
      .select('employee_id, type, timestamp')
      .gte('timestamp', dayStart)
      .lte('timestamp', dayEnd)
      .order('timestamp', { ascending: true });
    if (punchErr) throw punchErr;

    // Index punches by employee_id
    const punchMap = new Map<string, { type: string; timestamp: string }[]>();
    for (const p of punches || []) {
      const key = String(p.employee_id);
      if (!punchMap.has(key)) punchMap.set(key, []);
      punchMap.get(key)!.push(p);
    }

    let upserted = 0;
    let skipped  = 0;

    for (const roster of rosters || []) {
      const empId   = String(roster.employee_id);
      const dayData = roster.schedule_data?.[dayKey];

      if (!dayData || dayData.isOff) { skipped++; continue; }

      // Resolve scheduled start/end:
      // 1. Prefer customStart/customEnd set directly on the day
      // 2. Fall back to shift table lookup via shiftId
      let scheduledStart: string | null = dayData.customStart ?? null;
      let scheduledEnd:   string | null = dayData.customEnd   ?? null;

      const shiftId = dayData.shiftId && dayData.shiftId !== 'LIBRE'
        ? parseInt(dayData.shiftId, 10) : null;

      if ((!scheduledStart || !scheduledEnd) && shiftId !== null && !isNaN(shiftId)) {
        const shift = shiftMap.get(shiftId);
        if (shift) {
          scheduledStart = scheduledStart ?? shift.start;
          scheduledEnd   = scheduledEnd   ?? shift.end;
        }
      }

      const empPunches = punchMap.get(empId) || [];

      // Entry = first IN-type; exit = last EXIT-type
      const entryPunch = empPunches.find(p => ENTRY_TYPES.has(p.type));
      const exitPunch  = [...empPunches].reverse().find(p => EXIT_TYPES.has(p.type));

      const isAbsent  = !entryPunch;
      let actualStart = entryPunch ? new Date(entryPunch.timestamp) : null;
      let actualEnd   = exitPunch  ? new Date(exitPunch.timestamp)  : null;

      let regularHours  = 0;
      let overtimeHours = 0;
      let lateMinutes   = 0;
      let autoPunched   = false;

      // Auto-punch: employee checked in but never out — insert scheduled end as OUT
      if (actualStart && !actualEnd && scheduledEnd) {
        const autoEndTime = cstTimeToUTC(workDate, scheduledEnd);
        const { error: autoErr } = await supabase.from('attendance').insert({
          employee_id: empId,
          timestamp:   autoEndTime.toISOString(),
          type:        'OUT',
          details:     {
            autoInserted:    true,
            pendingHRReview: true,
            reason:          'Salida no registrada — generada automáticamente',
          },
        });
        if (!autoErr) {
          actualEnd   = autoEndTime;
          autoPunched = true;
          console.log(`Auto-punch OUT for ${empId} at ${scheduledEnd} CST on ${workDate}`);
        } else {
          console.error(`Auto-punch failed for ${empId}:`, autoErr.message);
        }
      }

      if (actualStart && actualEnd) {
        const grossMins  = (actualEnd.getTime() - actualStart.getTime()) / 60000;
        const lunchMins  = calcBreakMinutes(empPunches, LUNCH_OUT,  LUNCH_IN);
        const lactatMins = calcBreakMinutes(empPunches, LACTAT_OUT, LACTAT_IN);
        const netMins    = Math.max(0, grossMins - lunchMins - lactatMins);

        const shiftMins = scheduledStart && scheduledEnd
          ? toMinutes(scheduledEnd) - toMinutes(scheduledStart)
          : netMins; // no schedule → all hours are regular

        regularHours  = Math.min(netMins, shiftMins) / 60;
        overtimeHours = Math.max(0, netMins - shiftMins) / 60;

        if (scheduledStart) {
          // Build expected entry time in CST, then compare against actual UTC timestamp
          const expectedUTC = cstTimeToUTC(workDate, scheduledStart);
          lateMinutes = Math.max(0, Math.floor((actualStart.getTime() - expectedUTC.getTime()) / 60000));
        }
      }

      // Upsert
      const { data: existing } = await supabase
        .from('timesheets')
        .select('id')
        .eq('employee_id', empId)
        .eq('work_date', workDate)
        .limit(1);

      const payload = {
        employee_id:        empId,
        work_date:          workDate,
        scheduled_shift_id: shiftId !== null && !isNaN(shiftId) ? shiftId : null,
        actual_start_time:  actualStart?.toISOString() ?? null,
        actual_end_time:    actualEnd?.toISOString()   ?? null,
        regular_hours:      parseFloat(regularHours.toFixed(2)),
        overtime_hours:     parseFloat(overtimeHours.toFixed(2)),
        late_minutes:       lateMinutes,
        is_absent:          isAbsent,
        is_holiday_worked:  !isAbsent && isHoliday,
        status:             autoPunched ? 'AUTO_PUNCHED' : 'PENDING',
        updated_at:         new Date().toISOString(),
      };

      if (existing && existing.length > 0) {
        await supabase.from('timesheets').update(payload).eq('id', existing[0].id);
      } else {
        await supabase.from('timesheets').insert([payload]);
      }

      upserted++;
    }

    return new Response(
      JSON.stringify({ ok: true, work_date: workDate, upserted, skipped }),
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
