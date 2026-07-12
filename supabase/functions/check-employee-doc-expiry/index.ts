import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders } from "../_shared/security.ts";

// Vencimiento de documentos del EXPEDIENTE de cada empleado (employees.employee_documents,
// JSONB) — cualquier categoría (DUI, licencias, Carné JVPQF/Regente, Carné JVPE/Enfermería,
// etc.), no solo las de Regente/Enfermería (RTS 11.02.04:24 §6.3.1 exige acreditación vigente
// para TODO el personal). Complementa a check-doc-expiry, que es a nivel de SUCURSAL
// (branches.settings.legal/rent) y no toca datos de empleados individuales.
const WARN_DAYS = 60;
const DANGER_DAYS = 30;
const URGENT_DAYS = 7;

// El Salvador es UTC-6. Mismo patrón que check-doc-expiry para no correr de día cerca de medianoche.
function todayCST(): Date {
  const cst = new Date(Date.now() - 6 * 3600_000);
  return new Date(`${cst.toISOString().split('T')[0]}T12:00:00`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Auditoría 2026-07: gate obligatorio — cron.job (jobid 177) ya envía
  // x-cron-secret, confirmado. Ver AUDITORIA-2026-07.md.
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

    // Destinatarios fijos: Talento Humano (o RRHH como fallback de nombre), igual
    // que findByRoleName en requestsSlice.js pero para TODOS los activos del rol,
    // no solo el primero disponible.
    const { data: hrRoles, error: hrRoleErr } = await supabase
      .from('roles')
      .select('id')
      .or('name.ilike.%Talento Humano%,name.ilike.%RRHH%');
    if (hrRoleErr) throw hrRoleErr;
    const hrRoleIds = (hrRoles || []).map((r) => r.id);

    let hrIds: string[] = [];
    if (hrRoleIds.length > 0) {
      const { data: hrEmps, error: hrEmpErr } = await supabase
        .from('employees')
        .select('id')
        .in('role_id', hrRoleIds)
        .eq('status', 'ACTIVO');
      if (hrEmpErr) throw hrEmpErr;
      hrIds = (hrEmps || []).map((e) => String(e.id));
    }

    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('id, name, first_names, last_names, branch_id, status, employee_documents')
      .neq('status', 'INACTIVO');
    if (empErr) throw empErr;

    const today = todayCST();
    let created = 0;

    for (const emp of employees || []) {
      const docs: any[] = Array.isArray(emp.employee_documents) ? emp.employee_documents : [];
      if (docs.length === 0) continue;

      const empName = `${emp.first_names || ''} ${emp.last_names || ''}`.trim() || emp.name || 'Un empleado';

      for (const doc of docs) {
        if (!doc?.url || !doc?.expiry_date) continue;
        const exp = new Date(doc.expiry_date + 'T12:00:00');
        if (isNaN(exp.getTime())) continue;

        const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const label = doc.title || doc.category || 'Documento';
        const expDateStr = exp.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });

        let checkKey: string;
        let title: string;
        let body: string;

        if (diffDays < 0) {
          checkKey = `emp_doc_${emp.id}_${doc.category}_expired`;
          title = '🚨 Documento vencido';
          body = `${label} de ${empName} venció el ${expDateStr}. Renuévalo cuanto antes.`;
        } else if (diffDays <= URGENT_DAYS) {
          checkKey = `emp_doc_${emp.id}_${doc.category}_7d`;
          title = '🚨 Documento por vencer';
          body = `${label} de ${empName} vence el ${expDateStr} (en ${diffDays} días).`;
        } else if (diffDays <= DANGER_DAYS) {
          checkKey = `emp_doc_${emp.id}_${doc.category}_30d`;
          title = '⚠️ Documento por vencer';
          body = `${label} de ${empName} vence el ${expDateStr} (en ${diffDays} días).`;
        } else if (diffDays <= WARN_DAYS) {
          checkKey = `emp_doc_${emp.id}_${doc.category}_60d`;
          title = '📅 Documento por vencer';
          body = `${label} de ${empName} vence el ${expDateStr} (en ${diffDays} días).`;
        } else {
          continue;
        }

        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .filter('metadata->>check_key', 'eq', checkKey)
          .limit(1);
        if (existing && existing.length > 0) continue;

        const recipients = Array.from(new Set([String(emp.id), ...hrIds]));

        const { error: notifyErr } = await supabase.rpc('notify_employees', {
          p_recipients: recipients,
          p_type: 'DOCUMENT_EXPIRY',
          p_title: title,
          p_body: body,
          p_link: '/personal',
          p_metadata: {
            check_key: checkKey,
            employee_id: emp.id,
            doc_category: doc.category,
            exp_date: doc.expiry_date,
            days_left: diffDays,
          },
          p_push: true,
          p_branch_id: emp.branch_id ?? null,
        });
        if (notifyErr) throw notifyErr;
        created++;
      }
    }

    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-employee-doc-expiry error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
