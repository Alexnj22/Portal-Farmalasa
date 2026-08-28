import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders } from "../_shared/security.ts";

// Event types that block a silent roster copy
const BLOCKING_EVENT_TYPES = ['VACATION', 'DISABILITY', 'PERMIT'];

// Notification priority chain:
//   1. Talento Humano (role_id = 11) — if any are available (not on vacation/disability/permit today)
//   2. Fallback: ADMIN + SUPERADMIN system_role AND Supervisor system_role
const TH_ROLE_ID = 11;
// De supervisión para arriba. Era `['ADMIN','SUPERVISOR']` sobre
// `employees.system_role`, un rango escrito por persona que podía contradecir al
// organigrama; ahora sale del cargo y es un tramo de la escala.
const RANGO_DE_RESPALDO = 3;

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
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Auditoría 2026-07: gate obligatorio — el cron envía x-cron-secret.
  //
  // Eran DOS crons sobre esta misma función (jobid 144 a las 16:00 UTC y 146 a
  // las 06:00), y el de medianoche ganaba siempre: copiaba, y el de las 10:00
  // encontraba todo hecho. O sea que ninguna corrección hecha el sábado se
  // propagaba. Peor: `notify_missing_roster` corre a las 15:00 UTC y pregunta
  // si hay filas para la semana entrante — con la copia de las 06:00 ya hecha,
  // el contador nunca era cero y esa alarma NO PODÍA SONAR NUNCA. El 146 se
  // apagó el 2026-08-27; queda sólo el de las 16:00, después de la alarma.
  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
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

    const todayStr   = toISO(referenceDate);
    const curMonday  = currentMonday(referenceDate);
    const nextMon    = nextMonday(referenceDate);
    const nextSun    = new Date(nextMon);
    nextSun.setUTCDate(nextSun.getUTCDate() + 6);

    const curWeekStr  = toISO(curMonday);
    const nextWeekStr = toISO(nextMon);
    const nextSunStr  = toISO(nextSun);

    console.log(`Reference: ${todayStr}, current week: ${curWeekStr}, next week: ${nextWeekStr}–${nextSunStr}`);

    // 1. Load all rosters for the current week — but only for people who are
    //    still on the payroll.
    //
    //    Antes salía de `employee_rosters` a secas, sin cruzar `employees`:
    //    a quien se fue se le seguía armando la semana para siempre, y a las
    //    fichas que no son personas (la cuenta de pruebas, el contador
    //    externo) también. `tipo_ficha` es la misma pregunta que hace
    //    `esPersonalEnPlanilla` en el navegador; la falla segura apunta a
    //    'empleado', así que una ficha sin marcar SÍ se copia.
    const { data: currentRosters, error: crErr } = await supabase
      .from('employee_rosters')
      .select('employee_id, schedule_data, employees!inner(status, tipo_ficha, branch_id)')
      .eq('week_start_date', curWeekStr)
      .eq('employees.status', 'ACTIVO')
      .or('tipo_ficha.is.null,tipo_ficha.eq.empleado', { referencedTable: 'employees' });
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

    // 3. Check for blocking events that overlap next week (Mon–Sun) for the missing employees
    const { data: blockingEvents, error: evErr } = await supabase
      .from('employee_events')
      .select('employee_id, type, date, note')
      .in('employee_id', missingIds)
      .in('type', BLOCKING_EVENT_TYPES)
      .gte('date', curWeekStr)
      .lte('date', nextSunStr);
    if (evErr) throw evErr;

    const conflictMap = new Map<string, { type: string; date: string; note: string | null }[]>();
    for (const ev of blockingEvents || []) {
      const empId = String(ev.employee_id);
      if (!conflictMap.has(empId)) conflictMap.set(empId, []);
      conflictMap.get(empId)!.push({ type: ev.type, date: ev.date, note: ev.note });
    }

    // 3b. ¿Cae un feriado en la semana que viene?
    //
    // La copia NO se frena por eso —quién trabaja un asueto es una decisión de
    // Talento Humano, no del cron— pero el aviso tiene que decirlo. Antes la
    // tabla `holidays` no se consultaba, así que una semana con feriado
    // nacional se copiaba como una semana normal y nadie se enteraba.
    const diasDeLaSemana: string[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(nextMon);
      d.setUTCDate(d.getUTCDate() + i);
      return toISO(d);
    });

    const { data: feriados, error: fErr } = await supabase
      .from('holidays')
      .select('holiday_date, name, type, municipality, is_recurring');
    if (fErr) throw new Error(`feriados de la semana entrante: ${fErr.message}`);

    // Un feriado recurrente guarda el día y el mes; el año de la fila es el que
    // se cargó y no significa nada. Por eso la comparación es por mes-día.
    const feriadosDeLaSemana = (feriados || [])
      .map(h => {
        const mmdd = String(h.holiday_date).substring(5);
        const cae  = h.is_recurring
          ? diasDeLaSemana.find(d => d.substring(5) === mmdd)
          : (diasDeLaSemana.includes(h.holiday_date) ? h.holiday_date : undefined);
        return cae ? { ...h, cae } : null;
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    // 4. Copy rosters for employees without conflicts; collect conflicted ones
    const toCopy    = missing.filter(r => !conflictMap.has(String(r.employee_id)));
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
        if (!insErr.message.includes('duplicate') && !insErr.message.includes('unique')) {
          console.error(`Failed to copy roster for ${roster.employee_id}:`, insErr.message);
        }
      } else {
        copied++;
      }
    }

    // 5. Notify about conflicts using the priority chain.
    //    También se avisa cuando la semana entrante trae un feriado, aunque no
    //    haya ni un conflicto: la copia le armó a todo el mundo un día normal
    //    sobre un asueto, y eso lo tiene que decidir una persona.
    if (conflicted.length > 0 || feriadosDeLaSemana.length > 0) {
      // Resolve names for conflicted employees
      // Los cuatro queries de este bloque resuelven A QUIÉN se le avisa. Si
      // fallan en silencio, la lista queda vacía, el aviso "se manda" y el
      // conflicto de horarios no lo ve nadie.
      const { data: empRows, error: empRowsErr } = await supabase
        .from('employees')
        .select('id, name, first_names, last_names')
        .in('id', conflicted.map(r => r.employee_id));
      if (empRowsErr) throw new Error(`employees en conflicto: ${empRowsErr.message}`);

      const nameMap = new Map<string, string>();
      for (const emp of empRows || []) {
        const fullName = emp.name || `${emp.first_names || ''} ${emp.last_names || ''}`.trim();
        nameMap.set(String(emp.id), fullName || emp.id);
      }

      // --- Notification recipient resolution ---
      // Step 1: get all active TH employees
      const { data: thEmps, error: thEmpsErr } = await supabase
        .from('employees')
        .select('id')
        .eq('role_id', TH_ROLE_ID)
        .eq('status', 'ACTIVO');
      if (thEmpsErr) throw new Error(`employees de Talento Humano: ${thEmpsErr.message}`);

      const thIds = (thEmps || []).map(e => String(e.id));

      // Step 2: filter out TH employees who are themselves on a blocking event today
      let availableTH: string[] = [];
      if (thIds.length > 0) {
        const { data: thBlocked, error: thBlockedErr } = await supabase
          .from('employee_events')
          .select('employee_id')
          .in('employee_id', thIds)
          .in('type', BLOCKING_EVENT_TYPES)
          .eq('date', todayStr);
        // Tragarse este error invierte el resultado: nadie queda bloqueado y se
        // le avisa a quien está de vacaciones.
        if (thBlockedErr) throw new Error(`employee_events de TH: ${thBlockedErr.message}`);

        const thBlockedSet = new Set((thBlocked || []).map(e => String(e.employee_id)));
        availableTH = thIds.filter(id => !thBlockedSet.has(id));
      }

      // Step 3: if no TH available, fall back to Admin + Supervisor
      let recipientIds: string[];
      let recipientLabel: string;

      if (availableTH.length > 0) {
        recipientIds  = availableTH;
        recipientLabel = 'Talento Humano';
      } else {
        const { data: fallbackIds, error: fallbackErr } = await supabase
          .rpc('empleados_por_rango', { p_min: RANGO_DE_RESPALDO, p_max: 4 });
        if (fallbackErr) throw new Error(`empleados de respaldo: ${fallbackErr.message}`);

        recipientIds  = (fallbackIds || []).map((id: string) => String(id));
        recipientLabel = 'Administración y Supervisión';
      }

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

      const thUnavailableNote = availableTH.length === 0 && thIds.length > 0
        ? ' (Talento Humano no disponible hoy)'
        : '';

      const lineasFeriado = feriadosDeLaSemana.map(h => {
        const donde = h.type === 'MUNICIPAL'
          ? ` (municipal${h.municipality ? ` · ${h.municipality}` : ''})`
          : '';
        return `• ${h.cae}: ${h.name}${donde}`;
      });

      const partes: string[] = [
        `Se copiaron los horarios de esta semana hacia la semana del ${nextWeekStr}.`,
      ];
      if (lines.length > 0) {
        partes.push(
          '',
          'Estas personas tienen algo anotado que puede cambiarles el horario:',
          ...lines,
        );
      }
      if (lineasFeriado.length > 0) {
        partes.push(
          '',
          lineasFeriado.length === 1 ? 'Y esa semana cae un asueto:' : 'Y esa semana caen asuetos:',
          ...lineasFeriado,
          'La copia lo armó como un día normal — hay que decidir quién trabaja.',
        );
      }
      partes.push('', 'Revisa y ajusta en Horarios antes del lunes.');

      const title = feriadosDeLaSemana.length > 0 && conflicted.length === 0
        ? `La semana del ${nextWeekStr} tiene asueto`
        : `Horarios de la próxima semana para revisar (${nextWeekStr})`;
      const message = partes.join('\n');

      await supabase.from('announcements').insert({
        title,
        message,
        target_type:  recipientIds.length > 0 ? 'EMPLOYEE' : 'ALL',
        target_value: recipientIds.length > 0 ? recipientIds : null,
        priority:     'HIGH',
        metadata:     {
          source:            'auto-copy-weekly-roster',
          next_week_start:   nextWeekStr,
          conflicted_count:  conflicted.length,
          feriados:          feriadosDeLaSemana.map(h => `${h.cae} ${h.name}`),
          copied_count:      copied,
          notified_group:    recipientLabel + thUnavailableNote,
          th_available:      availableTH.length,
        },
      });

      console.log(`Notified ${recipientLabel}${thUnavailableNote} about ${conflicted.length} conflicts and ${feriadosDeLaSemana.length} holidays`);
    }

    return new Response(
      JSON.stringify({
        ok:                true,
        cur_week:          curWeekStr,
        next_week:         nextWeekStr,
        evaluated:         missing.length,
        copied,
        conflicts:         conflicted.length,
        feriados:          feriadosDeLaSemana.map(h => `${h.cae} ${h.name}`),
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
