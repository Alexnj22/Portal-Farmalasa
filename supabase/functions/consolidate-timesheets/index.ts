import { createClient } from "npm:@supabase/supabase-js@2";

// Punch types stored in the attendance table
const ENTRY_TYPES = new Set(['PUNCH_IN', 'IN', 'IN_EARLY', 'IN_EXTRA']);
const EXIT_TYPES  = new Set(['PUNCH_OUT', 'OUT', 'OUT_LATE', 'OUT_EARLY', 'OUT_BUSINESS', 'OUT_EXTRA']);
const LUNCH_OUT   = new Set(['LUNCH_START', 'OUT_LUNCH']);
const LUNCH_IN    = new Set(['LUNCH_END',   'IN_LUNCH']);
const LACTAT_OUT  = new Set(['LACTATION_START', 'OUT_LACTATION']);
const LACTAT_IN   = new Set(['LACTATION_END',   'IN_LACTATION']);

// El Salvador nocturnal boundary: 19:00-06:00 CST (UTC-6)
// In UTC: nocturnal = 01:00 UTC – 12:00 UTC (19:00 CST = 01:00 UTC next UTC-day, 06:00 CST = 12:00 UTC)
const CST_OFFSET_MS = 6 * 60 * 60 * 1000; // 6 hours in ms

interface DayException {
  date: string;
  customStart?: string;
  customEnd?: string;
  lunchTime?: string;
  lactationTime?: string;
  note?: string;
}

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

// Split a work interval into nocturnal (19:00-06:00 CST) and diurnal (06:00-19:00 CST) minutes.
// Uses UTC boundary times: 06:00 CST = 12:00 UTC, 19:00 CST = 01:00 UTC (next UTC-day).
// Works for shifts crossing midnight.
function splitNocturnal(startUTC: Date, endUTC: Date): { diurnalMins: number; nocturnalMins: number } {
  const totalMs = endUTC.getTime() - startUTC.getTime();
  if (totalMs <= 0) return { diurnalMins: 0, nocturnalMins: 0 };

  // Build boundary set: all 12:00 UTC and 01:00 UTC timestamps that fall strictly inside [start, end]
  const boundaries: number[] = [startUTC.getTime(), endUTC.getTime()];

  // Iterate UTC days overlapping the range
  const iterStart = new Date(startUTC); iterStart.setUTCHours(0, 0, 0, 0);
  const iterEnd   = new Date(endUTC);   iterEnd.setUTCDate(iterEnd.getUTCDate() + 1); iterEnd.setUTCHours(0, 0, 0, 0);

  for (let d = new Date(iterStart); d.getTime() < iterEnd.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    // 12:00 UTC = 06:00 CST — start of diurnal window
    const twelveUTC = d.getTime() + 12 * 3600000;
    // 01:00 UTC = 19:00 CST (previous CST-calendar-day) — start of nocturnal window
    const oneUTC    = d.getTime() +  1 * 3600000;

    if (twelveUTC > startUTC.getTime() && twelveUTC < endUTC.getTime()) boundaries.push(twelveUTC);
    if (oneUTC    > startUTC.getTime() && oneUTC    < endUTC.getTime()) boundaries.push(oneUTC);
  }

  boundaries.sort((a, b) => a - b);

  let nocturnalMs = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd   = boundaries[i + 1];
    if (segStart >= segEnd) continue;

    // Classify segment by its midpoint CST hour
    const midCST  = new Date(((segStart + segEnd) / 2) - CST_OFFSET_MS);
    const hourCST = midCST.getUTCHours();
    // Nocturnal: 19:00 <= hour < 24 OR 0 <= hour < 6
    if (hourCST >= 19 || hourCST < 6) nocturnalMs += segEnd - segStart;
  }

  const totalMins     = totalMs / 60000;
  const nocturnalMins = Math.max(0, nocturnalMs / 60000);
  return { diurnalMins: Math.max(0, totalMins - nocturnalMins), nocturnalMins };
}

// Build actual work segments from punches (break periods are excluded).
// Returns [{start, end}] covering only time-at-work.
function getWorkSegments(
  punches: { type: string; timestamp: string }[],
  actualStart: Date,
  actualEnd: Date,
): { start: Date; end: Date }[] {
  const segments: { start: Date; end: Date }[] = [];
  let segStart = new Date(actualStart);

  for (const p of punches) {
    const t = new Date(p.timestamp);
    if (t.getTime() <= actualStart.getTime() || t.getTime() >= actualEnd.getTime()) continue;

    if (LUNCH_OUT.has(p.type) || LACTAT_OUT.has(p.type)) {
      if (segStart < t) segments.push({ start: new Date(segStart), end: t });
      segStart = t; // placeholder — will be replaced by the matching IN
    } else if (LUNCH_IN.has(p.type) || LACTAT_IN.has(p.type)) {
      segStart = t; // resume work after break
    }
  }

  if (segStart < actualEnd) segments.push({ start: segStart, end: new Date(actualEnd) });
  return segments;
}

// Yesterday in El Salvador (UTC-6)
function yesterdayCST(): string {
  const now = new Date();
  const cst = new Date(now.getTime() - CST_OFFSET_MS);
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

    // 3. Load per-employee exceptions for workDate.
    const rosterEmpIds = (rosters || []).map(r => String(r.employee_id));
    const exceptionMap = new Map<string, DayException>();

    if (rosterEmpIds.length > 0) {
      const { data: empRows } = await supabase
        .from('employees')
        .select('id, exceptions')
        .in('id', rosterEmpIds);

      for (const emp of empRows || []) {
        const list: DayException[] = Array.isArray(emp.exceptions) ? emp.exceptions : [];
        const ex = list.find(e => e.date === workDate);
        if (ex) exceptionMap.set(String(emp.id), ex);
      }
    }

    // 4. Load attendance punches in CST day window (UTC-6)
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
      const empId    = String(roster.employee_id);
      const dayData  = roster.schedule_data?.[dayKey];
      const exception = exceptionMap.get(empId);

      const isOffInRoster = !dayData || dayData.isOff;
      if (isOffInRoster && !exception) {
        skipped++;
        continue;
      }

      // Resolve scheduled start/end
      let scheduledStart: string | null = exception?.customStart ?? dayData?.customStart ?? null;
      let scheduledEnd:   string | null = exception?.customEnd   ?? dayData?.customEnd   ?? null;

      const shiftId = (!isOffInRoster && dayData?.shiftId && dayData.shiftId !== 'LIBRE')
        ? parseInt(dayData.shiftId, 10)
        : null;

      if ((!scheduledStart || !scheduledEnd) && shiftId !== null && !isNaN(shiftId)) {
        const shift = shiftMap.get(shiftId);
        if (shift) {
          scheduledStart = scheduledStart ?? shift.start;
          scheduledEnd   = scheduledEnd   ?? shift.end;
        }
      }

      const empPunches = punchMap.get(empId) || [];

      const entryPunch = empPunches.find(p => ENTRY_TYPES.has(p.type));
      const exitPunch  = [...empPunches].reverse().find(p => EXIT_TYPES.has(p.type));

      const isAbsent  = !entryPunch;
      let actualStart = entryPunch ? new Date(entryPunch.timestamp) : null;
      let actualEnd   = exitPunch  ? new Date(exitPunch.timestamp)  : null;

      let regularHours         = 0;
      let overtimeHours        = 0;
      let nocturnalHours       = 0;
      let nocturnalOTHours     = 0;
      let lateMinutes          = 0;
      let autoPunched          = false;

      // Auto-punch: employee checked in but never out
      if (actualStart && !actualEnd && scheduledEnd) {
        const autoEndTime = cstTimeToUTC(workDate, scheduledEnd);
        const punchType   = isOffInRoster ? 'OUT_EXTRA' : 'OUT';
        const { error: autoErr } = await supabase.from('attendance').insert({
          employee_id: empId,
          timestamp:   autoEndTime.toISOString(),
          type:        punchType,
          details:     {
            autoInserted:    true,
            pendingHRReview: true,
            reason:          'Salida no registrada — generada automáticamente',
            isExceptionDay:  !!exception,
          },
        });
        if (!autoErr) {
          actualEnd   = autoEndTime;
          autoPunched = true;
          console.log(`Auto-punch ${punchType} for ${empId} at ${scheduledEnd} CST on ${workDate}${exception ? ' [exception]' : ''}`);
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
          : netMins;

        regularHours  = Math.min(netMins, shiftMins) / 60;
        overtimeHours = Math.max(0, netMins - shiftMins) / 60;

        if (scheduledStart) {
          const expectedUTC = cstTimeToUTC(workDate, scheduledStart);
          lateMinutes = Math.max(0, Math.floor((actualStart.getTime() - expectedUTC.getTime()) / 60000));
        }

        // ── Nocturnal split (Art. 168 & 169, Código de Trabajo SV) ──────────
        // Actual nocturnal: sum nocturnal mins across all real work segments
        const workSegments = getWorkSegments(empPunches, actualStart, actualEnd);
        let actualNocturnalMins = 0;
        for (const seg of workSegments) {
          actualNocturnalMins += splitNocturnal(seg.start, seg.end).nocturnalMins;
        }

        // Scheduled nocturnal: how many nocturnal mins are in the planned shift
        let scheduledNocturnalMins = 0;
        if (scheduledStart && scheduledEnd) {
          const schedStartUTC = cstTimeToUTC(workDate, scheduledStart);
          const schedEndUTC   = cstTimeToUTC(workDate, scheduledEnd);
          scheduledNocturnalMins = splitNocturnal(schedStartUTC, schedEndUTC).nocturnalMins;
        }

        // Regular nocturnal = nocturnal hours within the planned shift cap
        // OT nocturnal = nocturnal hours beyond the planned shift
        const nocturnalRegularMins = Math.min(actualNocturnalMins, scheduledNocturnalMins);
        const nocturnalOTMins      = Math.max(0, actualNocturnalMins - scheduledNocturnalMins);

        nocturnalHours   = parseFloat((nocturnalRegularMins / 60).toFixed(2));
        nocturnalOTHours = parseFloat((nocturnalOTMins      / 60).toFixed(2));
      }

      // Upsert
      const { data: existing } = await supabase
        .from('timesheets')
        .select('id')
        .eq('employee_id', empId)
        .eq('work_date', workDate)
        .limit(1);

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
        is_holiday_worked:         !isAbsent && isHoliday,
        status:                    autoPunched ? 'AUTO_PUNCHED' : 'PENDING',
        updated_at:                new Date().toISOString(),
      };

      if (existing && existing.length > 0) {
        await supabase.from('timesheets').update(payload).eq('id', existing[0].id);
      } else {
        await supabase.from('timesheets').insert([payload]);
      }

      upserted++;
      if (exception) {
        console.log(`Exception applied for ${empId} on ${workDate}: ${scheduledStart}–${scheduledEnd}${isOffInRoster ? ' [was OFF day]' : ' [shift override]'}`);
      }
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
