import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders } from "../_shared/security.ts";

const DOC_FIELDS: { id: string; label: string; section: 'legal' | 'rent' }[] = [
  { id: 'srsExpiration',          label: 'Licencia CSSP / DNM',               section: 'legal' },
  { id: 'municipalExpiration',    label: 'Solvencia Municipal',                section: 'legal' },
  { id: 'wasteExpiration',        label: 'Contrato Desechos Bioinfecciosos',   section: 'legal' },
  { id: 'regentCredentialExp',    label: 'Credencial JVQF (Regente)',          section: 'legal' },
  { id: 'pharmacovigilanceExp',   label: 'Autorización Farmacovigilancia',     section: 'legal' },
  { id: 'nursingServicePermitExp',label: 'Permiso Área Inyecciones',           section: 'legal' },
  { id: 'controlledBooksExp',     label: 'Libros Controlados',                 section: 'legal' },
  { id: 'rent_endDate',           label: 'Contrato de Arrendamiento',          section: 'rent'  },
];

interface Threshold {
  days: number;
  label: string;
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  emoji: string;
}

const THRESHOLDS: Threshold[] = [
  { days: 60, label: '60d', priority: 'NORMAL', emoji: '📅' },
  { days: 30, label: '30d', priority: 'HIGH',   emoji: '⚠️' },
  { days: 7,  label: '7d',  priority: 'URGENT', emoji: '🚨' },
];

// El Salvador is UTC-6. Devuelve el mediodía UTC del día CST actual, para que
// la comparación con expDate (parseado como 'YYYY-MM-DDT12:00:00') sea consistente
// y no se corra de día cerca de medianoche.
function todayCST(): Date {
  const cst = new Date(Date.now() - 6 * 3600_000);
  return new Date(`${cst.toISOString().split('T')[0]}T12:00:00`);
}

Deno.serve(async (req) => {
  // Allow manual triggers via POST (no body required)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Auditoría 2026-07: gate obligatorio — cron.job (jobid 17) ya envía
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

    // Fetch recipients: everyone active in the Administracion branch (id = 32)
    const { data: adminEmps, error: adminErr } = await supabase
      .from('employees')
      .select('id')
      .eq('branch_id', 32)
      .neq('status', 'INACTIVO');

    if (adminErr) throw adminErr;

    const adminIds = (adminEmps || []).map(e => String(e.id));
    if (adminIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, created: 0, note: 'No admin employees found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('id, name, settings');

    if (branchErr) throw branchErr;

    const today = todayCST();
    let created = 0;

    for (const branch of branches || []) {
      const legal = branch.settings?.legal || {};
      const rent  = branch.settings?.rent  || {};

      const docs = DOC_FIELDS.map(f => ({
        id:      f.id,
        label:   f.label,
        expDate: f.id === 'rent_endDate'
          ? (rent.contract?.endDate || null)
          : (legal[f.id] || null),
      }));

      for (const doc of docs) {
        if (!doc.expDate) continue;

        const exp      = new Date(doc.expDate + 'T12:00:00');
        const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Already expired
        if (diffDays < 0) {
          const checkKey = `doc_expiry_${branch.id}_${doc.id}_expired`;
          const { data: existing } = await supabase
            .from('announcements')
            .select('id')
            .filter('metadata->>check_key', 'eq', checkKey)
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('announcements').insert([{
              title:        `🚨 Documento Vencido`,
              message:      `${doc.label} de la sucursal "${branch.name}" venció el ${exp.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}. Renuévalo cuanto antes.`,
              target_type:  'EMPLOYEE',
              target_value: adminIds,
              read_by:      [],
              is_archived:  false,
              priority:     'URGENT',
              metadata:     { check_key: checkKey, branch_id: branch.id, doc_id: doc.id, exp_date: doc.expDate },
            }]);
            created++;
          }
          continue; // no need to check warning thresholds for an already-expired doc
        }

        // Warning thresholds — only fire the closest applicable one
        for (const threshold of THRESHOLDS) {
          if (diffDays > threshold.days) continue;

          const checkKey = `doc_expiry_${branch.id}_${doc.id}_${threshold.label}`;
          const { data: existing } = await supabase
            .from('announcements')
            .select('id')
            .filter('metadata->>check_key', 'eq', checkKey)
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('announcements').insert([{
              title:        `${threshold.emoji} Documento por vencer`,
              message:      `${doc.label} de la sucursal "${branch.name}" vence el ${exp.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })} (en ${diffDays} días).`,
              target_type:  'EMPLOYEE',
              target_value: adminIds,
              read_by:      [],
              is_archived:  false,
              priority:     threshold.priority,
              metadata:     { check_key: checkKey, branch_id: branch.id, doc_id: doc.id, exp_date: doc.expDate, days_left: diffDays },
            }]);
            created++;
          }
          break; // only fire the tightest threshold, not all of them
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-doc-expiry error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
