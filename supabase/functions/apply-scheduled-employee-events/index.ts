// supabase/functions/apply-scheduled-employee-events/index.ts
// Aplica al expediente los eventos RRHH programados (metadata.applyStatus =
// 'SCHEDULED') cuya fecha efectiva ya llegó. Lo invoca pg_cron a diario a las
// 5:00 a.m. hora de El Salvador con el ADMIN_INVOKE_SECRET.
// Tipos soportados: TERMINATION, TRANSFER, PROMOTION, SALARY, CODE_CHANGE
// (mismo mapeo que registerEmployeeEvent en el frontend).

import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const secret = Deno.env.get("ADMIN_INVOKE_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "MISSING_ENV" });
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // Fecha local El Salvador (UTC-6, sin DST)
    const today = new Date(Date.now() - 6 * 3600 * 1000).toISOString().split("T")[0];

    const { data: events, error: evErr } = await admin
      .from("employee_events")
      .select("id, employee_id, type, date, metadata")
      .lte("date", today)
      .eq("metadata->>applyStatus", "SCHEDULED")
      .order("date", { ascending: true });
    if (evErr) return json({ ok: false, error: "DB_ERROR", details: evErr.message });
    if (!events?.length) return json({ ok: true, applied: 0, failed: 0, skipped: 0 });

    const { data: roles } = await admin.from("roles").select("id, name, max_limit, scope");

    let applied = 0, failed = 0, skipped = 0;
    const results: unknown[] = [];

    for (const ev of events) {
      const meta = (typeof ev.metadata === "string" ? JSON.parse(ev.metadata) : (ev.metadata || {})) as Record<string, unknown>;

      const setEventMeta = async (patch: Record<string, unknown>) => {
        await admin.from("employee_events").update({ metadata: { ...meta, ...patch } }).eq("id", ev.id);
      };

      // Cancelados/reemplazados no se aplican (defensa extra; el filtro principal es applyStatus)
      if (meta.status === "CANCELLED" || meta.status === "SUPERSEDED") {
        skipped++;
        await setEventMeta({ applyStatus: "SKIPPED", applySkippedReason: String(meta.status) });
        continue;
      }

      const { data: emp, error: empErr } = await admin.from("employees").select("*").eq("id", ev.employee_id).single();
      if (empErr || !emp) {
        failed++;
        await setEventMeta({ applyStatus: "FAILED", applyError: "EMPLOYEE_NOT_FOUND" });
        continue;
      }

      // Re-validar headcount en el momento de aplicar (el organigrama pudo cambiar
      // entre el registro y la fecha efectiva)
      const headcountOk = async (roleId: unknown, branchId: unknown) => {
        const role = (roles || []).find(r => String(r.id) === String(roleId));
        if (!role || role.max_limit >= 99) return true;
        let q = admin.from("employees").select("id", { count: "exact", head: true })
          .eq("status", "ACTIVO").eq("role_id", roleId).neq("id", ev.employee_id);
        if (role.scope === "BRANCH") q = q.eq("branch_id", branchId);
        const { count } = await q;
        return (count ?? 0) < role.max_limit;
      };

      const updates: Record<string, unknown> = {};
      let applyError: string | null = null;

      if (ev.type === "TERMINATION") {
        Object.assign(updates, {
          status: "INACTIVO",
          branch_id: null,
          role_id: null,
          secondary_role_id: null,
          shift_id: null,
          kiosk_pin: null,
          contract_end_date: ev.date,
        });
      } else if (ev.type === "TRANSFER" && meta.targetBranchId) {
        const b = parseInt(String(meta.targetBranchId), 10);
        if (emp.role_id && !(await headcountOk(emp.role_id, b))) applyError = "HEADCOUNT_LIMIT";
        else updates.branch_id = b;
      } else if (ev.type === "PROMOTION" && meta.newRole) {
        const role = (roles || []).find(r => r.name === meta.newRole);
        if (!role) applyError = "ROLE_NOT_FOUND";
        else {
          const movesBranch = meta.isTransferAndPromotion && meta.targetBranchId;
          const b = movesBranch ? parseInt(String(meta.targetBranchId), 10) : emp.branch_id;
          if (!(await headcountOk(role.id, b))) applyError = "HEADCOUNT_LIMIT";
          else {
            updates.role_id = role.id;
            if (movesBranch) updates.branch_id = b;
          }
        }
      } else if (ev.type === "SALARY") {
        const s = parseFloat(String(meta.newSalary));
        if (!Number.isNaN(s)) updates.base_salary = s;
        else applyError = "INVALID_SALARY";
      } else if (ev.type === "CODE_CHANGE") {
        const c = String(meta.newCode ?? "").trim();
        if (!c) applyError = "MISSING_CODE";
        else {
          updates.code = c;
          if (meta.newKioskPin) updates.kiosk_pin = meta.newKioskPin;
        }
      } else {
        skipped++;
        await setEventMeta({ applyStatus: "SKIPPED", applySkippedReason: "UNSUPPORTED_TYPE" });
        continue;
      }

      if (applyError) {
        failed++;
        await setEventMeta({ applyStatus: "FAILED", applyError });
        results.push({ id: ev.id, type: ev.type, error: applyError });
        continue;
      }

      // Snapshot previo para poder revertir al cancelar (mismo formato que el frontend)
      const previousValues: Record<string, unknown> = {};
      Object.keys(updates).forEach(k => { previousValues[k] = emp[k] ?? null; });
      if (ev.type === "TERMINATION") {
        const { data: eb } = await admin.from("employee_branches").select("branch_id").eq("employee_id", ev.employee_id);
        previousValues._employee_branches = (eb || []).map((r: { branch_id: number }) => r.branch_id);
      }

      const { error: updErr } = await admin.from("employees").update(updates).eq("id", ev.employee_id);
      if (updErr) {
        failed++;
        await setEventMeta({ applyStatus: "FAILED", applyError: updErr.message });
        results.push({ id: ev.id, type: ev.type, error: updErr.message });
        continue;
      }

      if (ev.type === "TERMINATION") {
        await admin.from("employee_branches").delete().eq("employee_id", ev.employee_id);
        // Revocar cuentas Auth (principal + carné @staff.local) vía la función dedicada
        try {
          await fetch(`${supabaseUrl}/functions/v1/disable-employee-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
            body: JSON.stringify({ employeeId: ev.employee_id, action: "disable" }),
          });
        } catch { /* best-effort */ }
      }

      await setEventMeta({
        applyStatus: "APPLIED",
        appliedAt: new Date().toISOString(),
        appliedChanges: updates,
        previousValues,
      });
      applied++;
      results.push({ id: ev.id, type: ev.type, applied: true });
    }

    return json({ ok: true, applied, failed, skipped, results });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
