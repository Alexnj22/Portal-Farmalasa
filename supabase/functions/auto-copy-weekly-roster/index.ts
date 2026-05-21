import { createClient } from "npm:@supabase/supabase-js@2";

// HR role ids that receive roster conflict notifications
const HR_ROLE_IDS = [11, 2, 3]; // Jefe TH, Gerente General, Administrador

// Event types that block a silent roster copy
const BLOCKING_EVENT_TYPES = ['VACATION', 'DISABILITY', 'PERMIT'];

/** Next Monday from a given Saturday (CST) */
function nextMonday(saturdayDate: Date): Date {
  const d = new Date(saturdayDate);
  d.setUTCDate(d.getUTCDate() + 2); // Sat → Mon
  return d;
}

/** Current Monday (5 days before Saturday) */
function currentMonday(saturdayDate: Date): Date {
  const d = new Date(saturdayDate);
  d.setUTCDate(d.getUTCDate() - 5); // Sat → Mon
  return d;
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Today in CST (UTC-6) */
function todayCST(): Date {
  const now = new Date();
  return new Date(now.getTime() - 6 * 60 * 60 * 1000);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Allow manual override of the reference date (for testing)
    let referenceDate: Date;
    try {
      const body = await req.json();
      referenceDate = body?.reference_date
        ? new Date(body.reference_date + 'T12:00:00')
        : todayCST();
    } catch {
      referenceDate = todayCST();
    }

    const curMonday  = currentMonday(referenceDate);
    const nextMon    = nextMonday(referenceDate);
    const nextSun    = new Date(nextMon);
    nextSun.setUTCDate(nextSun.getUTCDate() + 6);

    const curWeekStr  = toISO(curMonday);
    const nextWeekStr = toISO(nextMon);
    const nextSunStr  = toISO(nextSun);

    console.log(`Reference: ${toISO(referenceDate)}, current week: ${curWeekStr}, next week: ${nextWeekStr}–${nextSunStr}`);

    // 1. Load all rosters for the current week
    const { data: currentRosters, error: crErr } = await supabase
      .from('employee_rosters')
      .select('employee_id, schedule_data')
      .eq('week_start_date', curWeekStr);
    if (crErr) throw crErr;

    if (!currentRosters || currentRosters.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No current-week rosters to copy', copied: 0, conflicts: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Load all rosters for the next week (to know who already has one)
    const { data: nextRosters, error: nrErr } = await supabase
      .from('employee_rosters')
      .select('employee_id')
      .eq('week_start_date', nextWeekStr);
    if (nrErr) throw nrErr;

    const alreadyScheduled = new Set((nextRosters || []).map(r => String(r.employee_id)));

    // Only process employees who are missing a next-week roster
    const missing = currentRosters.filter(r => !alreadyScheduled.has(String(r.employee_id)));

    if (missing.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'All employees already have next-week rosters', copied: 0, conflicts: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const missingIds = missing.map(r => r.employee_id);

    // 3. Check for active blocking events that overlap next week (Mon–Sun)
    const { data: blockingEvents, error: evErr } = await supabase
      .from('employee_events')
      .select('employee_id, type, date, note')
      .in('employee_id', missingIds)
      .in('type', BLOCKING_EVENT_TYPES)
      .gte('date', curWeekStr)   // event date >= today to catch upcoming ones
      .lte('date', nextSunStr);  // event date <= next Sunday
    if (evErr) throw evErr;

    // Build a set of employees with conflicts and a map for details
    const conflictMap = new Map<string, { type: string; date: string; note: string | null }[]>();
    for (const ev of blockingEvents || []) {
      const empId = String(ev.employee_id);
      if (!conflictMap.has(empId)) conflictMap.set(empId, []);
      conflictMap.get(empId)!.push({ type: ev.type, date: ev.date, note: ev.note });
    }

    // 4. Copy rosters for employees without conflicts; collect conflicted ones
    const toCopy   = missing.filter(r => !conflictMap.has(String(r.employee_id)));
    const conflicted = missing.filter(r =>  conflictMap.has(String(r.employee_id)));

    let copied = 0;
    for (const roster of toCopy) {
      const { error: insErr } = await supabase
        .from('employee_rosters')
        .insert({
          employee_id:     roster.employee_id,
          week_start_date: nextWeekStr,
          schedule_data:   roster.schedule_data,
          status:          'PUBLISHED',
        });
      if (insErr) {
        // If it already exists (race condition), skip silently
        if (!insErr.message.includes('duplicate') && !insErr.message.includes('unique')) {
          console.error(`Failed to copy roster for ${roster.employee_id}:`, insErr.message);
        }
      } else {
        copied++;
      }
    }

    // 5. If there are conflicted employees, notify HR via announcement
    if (conflicted.length > 0) {
      // Resolve employee names
      const { data: empRows } = await supabase
        .from('employees')
        .select('id, name, first_names, last_names')
        .in('id', conflicted.map(r => r.employee_id));

      const nameMap = new Map<string, string>();
      for (const emp of empRows || []) {
        const fullName = emp.name || `${emp.first_names || ''} ${emp.last_names || ''}`.trim();
        nameMap.set(String(emp.id), fullName || emp.id);
      }

      // Resolve HR recipient IDs
      const { data: hrEmps } = await supabase
        .from('employees')
        .select('id')
        .in('role_id', HR_ROLE_IDS)
        .eq('status', 'ACTIVE');

      const hrIds = (hrEmps || []).map(e => e.id);

      const EVENT_LABELS: Record<string, string> = {
        VACATION:   'Vacaciones',
        DISABILITY: 'Incapacidad Médica',
        PERMIT:     'Permiso Especial',
      };

      const lines = conflicted.map(r => {
        const empId   = String(r.employee_id);
        const empName = nameMap.get(empId) || empId;
        const events  = conflictMap.get(empId) || [];
        const evDesc  = events.map(ev => `${EVENT_LABELS[ev.type] || ev.type} (${ev.date})`).join(', ');
        return `• ${empName}: ${evDesc}`;
      });

      const title   = `⚠️ Turnos próxima semana requieren revisión (${nextWeekStr})`;
      const message =
        `El sistema copió automáticamente los turnos de la semana actual hacia la semana del ${nextWeekStr}, ` +
        `pero los siguientes empleados tienen eventos activos que podrían requerir ajustes:\n\n` +
        lines.join('\n') +
        `\n\nPor favor verifique y realice las modificaciones necesarias en el módulo de Turnos.`;

      await supabase.from('announcements').insert({
        title,
        message,
        target_type:  hrIds.length > 0 ? 'EMPLOYEE' : 'ALL',
        target_value: hrIds.length > 0 ? hrIds : null,
        priority:     'HIGH',
        metadata:     {
          source:          'auto-copy-weekly-roster',
          next_week_start: nextWeekStr,
          conflicted_count: conflicted.length,
          copied_count:    copied,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok:        true,
        cur_week:  curWeekStr,
        next_week: nextWeekStr,
        evaluated: missing.length,
        copied,
        conflicts: conflicted.length,
        conflict_employees: conflicted.map(r => String(r.employee_id)),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('auto-copy-weekly-roster error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
