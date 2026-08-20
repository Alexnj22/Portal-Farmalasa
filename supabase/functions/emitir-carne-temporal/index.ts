// supabase/functions/emitir-carne-temporal/index.ts
//
// Emite el carné de papel que vale hasta medianoche (El Salvador) y devuelve su
// secreto UNA vez, para que la pantalla lo mande a la ticketera.
//
// ── Por qué hace falta una edge function y no alcanza el RPC ─────────────────
// El secreto lo sortea la base (`emitir_carne_temporal`), pero ese papel también
// tiene que ABRIR SESIÓN — decisión del usuario el 2026-08-20: el carné de papel
// hace lo mismo que el de plástico. Y para eso hace falta una cuenta de Auth con
// ese secreto por contraseña, que sólo se puede crear con la llave de servicio.
// Postgres no la tiene; esta función sí.
//
// ── Una cuenta por PERSONA, no por papel ────────────────────────────────────
// El correo es determinista: `carne-<id del empleado>@staff.local`. Al reimprimir
// se le cambia la contraseña, así que el papel anterior muere en el acto y no se
// acumulan cuentas muertas en Auth. Es lo mismo que hace la purga de medianoche
// (`purgar_carnes_temporales`), sólo que a mano.
//
// ── El permiso lo decide la BASE, no esta función ───────────────────────────
// El RPC se llama con el JWT de quien apretó el botón, no con la llave de
// servicio: así la regla de permisos vive en un solo lugar
// (`carne_temporal.can_edit`, o `staff_list.can_edit` sobre alguien marcado como
// que todavía no tiene carné) y esta función no puede saltársela ni por error.
//
// ── Y si Auth falla, el carné se anula ──────────────────────────────────────
// Un papel que marca en el kiosco pero no abre el portal es peor que ninguno:
// nadie sabría cuál de las dos mitades tiene. Como la impresión ocurre DESPUÉS
// de que esto conteste, anular acá no rompe nada — simplemente no se imprime.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin       = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

const correoDelCarne = (employeeId: string) => `carne-${employeeId}@staff.local`;

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!admin)                  return json({ ok: false, error: "MISSING_ENV" }, 500);

  const usuario = await requireAuthUser(req);
  if (!usuario) return json({ ok: false, error: "NO_AUTORIZADO" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const employeeId = typeof body?.employee_id === "string" ? body.employee_id.trim() : "";
    const motivo     = typeof body?.motivo === "string" ? body.motivo.trim() : null;
    if (!/^[0-9a-fA-F-]{36}$/.test(employeeId)) {
      return json({ ok: false, error: "EMPLEADO_INVALIDO" });
    }

    // Con el JWT de quien pidió: el permiso lo resuelve el RPC contra su ficha.
    const comoElUsuario = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: emitido, error: errEmitir } = await comoElUsuario.rpc("emitir_carne_temporal", {
      p_employee_id: employeeId,
      p_motivo: motivo,
    });
    if (errEmitir) {
      const msg = String(errEmitir.message || "");
      if (msg.includes("FORBIDDEN")) return json({ ok: false, error: "SIN_PERMISO" }, 403);
      return json({ ok: false, error: "NO_SE_PUDO_EMITIR", details: msg });
    }
    if (!emitido?.ok) return json({ ok: false, error: "NO_SE_PUDO_EMITIR" });

    const secreto: string = emitido.secreto;
    const carneId: number = emitido.id;
    const email = correoDelCarne(employeeId);

    // La cuenta: se busca por correo antes de crearla. `createUser` no dice el
    // id cuando el correo ya existe, así que sin esta consulta habría que
    // listar usuarios de a páginas para encontrarlo.
    const { data: existente } = await admin.rpc("cuenta_de_carne_temporal", { p_email: email });
    let authUserId: string | null = (existente as string | null) ?? null;

    if (authUserId) {
      const { error } = await admin.auth.admin.updateUserById(authUserId, {
        password: secreto,
        user_metadata: { code: null, kiosk: true, carne_temporal: true },
      });
      if (error) return await anular(carneId, "AUTH_UPDATE_ERROR", error.message, json);
    } else {
      const creado = await admin.auth.admin.createUser({
        email,
        password: secreto,
        email_confirm: true,
        user_metadata: { code: null, kiosk: true, carne_temporal: true },
      });
      if (creado.error || !creado.data?.user?.id) {
        return await anular(carneId, "AUTH_CREATE_ERROR", creado.error?.message ?? "sin id", json);
      }
      authUserId = creado.data.user.id;
    }

    // Sin este vínculo la cuenta entra al portal SIN permisos: las funciones
    // `auth_*` resuelven al empleado por acá cuando el uid no es su id.
    const { error: errLink } = await admin
      .from("employee_auth_accounts")
      .upsert({ auth_user_id: authUserId, employee_id: employeeId }, { onConflict: "auth_user_id" });
    if (errLink) return await anular(carneId, "LINK_ERROR", errLink.message, json);

    // Se guarda para que la purga sepa a qué cuenta apagarle la contraseña.
    const { error: errFila } = await admin
      .from("carnes_temporales")
      .update({ auth_user_id: authUserId })
      .eq("id", carneId);
    if (errFila) return await anular(carneId, "FILA_ERROR", errFila.message, json);

    return json({
      ok: true,
      id: carneId,
      secreto,
      vence_el: emitido.vence_el,
      employee_id: employeeId,
      nombre: emitido.nombre,
    });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});

async function anular(
  carneId: number,
  error: string,
  details: string,
  json: (body: unknown, status?: number) => Response,
) {
  // El carné se anula con la llave de servicio y no con el RPC de anular: ése
  // exige el permiso `carne_temporal`, y acá el que falló fue el servidor, no
  // quien pidió. Dejarlo vivo imprimiría un papel a medias.
  await admin?.from("carnes_temporales")
    .update({ anulado_el: new Date().toISOString() })
    .eq("id", carneId);
  return json({ ok: false, error, details });
}
