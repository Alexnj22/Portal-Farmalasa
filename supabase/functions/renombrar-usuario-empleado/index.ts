// supabase/functions/renombrar-usuario-empleado/index.ts
//
// Cambiarle el usuario a alguien NO es cambiar una columna: el usuario ES la
// credencial. La cuenta vive en Auth con el correo `<usuario>@farmalasa.app`
// —así la crea `set-employee-password`, así entra `loginWithUsername`—, o sea
// que escribir sólo `employees.username` deja la ficha diciendo una cosa y la
// puerta pidiendo otra. Sin error, sin fila de menos, sin nada que mirar: la
// persona simplemente no entra, y el motivo no está escrito en ningún lado.
//
// Por eso las dos escrituras viven acá, juntas: o entran las dos o no entra
// ninguna — si la segunda falla, la primera se deshace.
//
// La llama el navegador con la sesión de quien edita, así que va con
// `verify_jwt: true` (el default). Cron NO la llama: ver la regla del flag en
// CLAUDE.md — depende de QUIÉN llama, no de a qué circuito pertenece.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, permisoDeModulo, requireActiveEmployeeUser } from "../_shared/security.ts";

const DOMINIO = "farmalasa.app";

// La misma forma que produce `usuarioDesdeNombre` en el frontend: minúsculas,
// dígitos, y el punto SEPARANDO —nunca al principio, al final, ni doble, que
// darían un correo que Auth rechaza con un mensaje que no habla de esto.
const FORMA = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

Deno.serve(async (req: Request) => {
  const corsHeaders = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!req.headers.get("Authorization"))
      return json({ ok: false, error: "MISSING_AUTH_HEADER", details: "El frontend no envió el JWT." });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey)
      return json({ ok: false, error: "MISSING_ENV", details: "Faltan los Secrets en la nube." });

    const admin = createClient(supabaseUrl, serviceKey);

    // Quién llama y si puede — los dos salen de la base, nunca del token.
    // Mismo par de guardas que `set-employee-password`, y por el mismo motivo:
    // repartir credenciales y renombrarlas son el mismo poder.
    const caller = await requireActiveEmployeeUser(req, admin);
    if (!caller)
      return json({ ok: false, error: "INVALID_TOKEN", details: "El token expiró, es inválido, o el empleado no está activo." });

    const permiso = await permisoDeModulo(admin, caller.id, "staff_list", "can_edit");
    if (permiso.roto)
      return json({ ok: false, error: "PERMISSION_CHECK_FAILED", details: permiso.roto });
    if (!permiso.puede)
      return json({ ok: false, error: "INSUFFICIENT_PERMISSIONS", details: `Acceso denegado para: ${caller.name || caller.code}` });

    const body = await req.json().catch(() => ({}));
    const empleadoId = typeof body?.employee_id === "string" ? body.employee_id.trim() : "";
    const nuevo = typeof body?.username === "string" ? body.username.toLowerCase().trim() : "";

    if (!empleadoId || !nuevo) return json({ ok: false, error: "MISSING_FIELDS" });
    if (nuevo.length < 3 || nuevo.length > 60 || !FORMA.test(nuevo))
      return json({
        ok: false, error: "USERNAME_INVALID",
        details: "El usuario lleva sólo minúsculas, números y puntos entre medio.",
      });

    const { data: rows, error: dbErr } = await admin
      .from("employees").select("id, code, name, username, status").eq("id", empleadoId).limit(1);
    if (dbErr) return json({ ok: false, error: "DB_ERROR", details: dbErr.message });
    if (!rows?.length) return json({ ok: false, error: "EMPLOYEE_NOT_FOUND" });

    const empleado = rows[0];
    const anterior = (empleado.username || "").toLowerCase();
    // Nada que hacer no es un fallo: quien llama pide un estado final, no un acto.
    if (anterior === nuevo) return json({ ok: true, sin_cambio: true, username: nuevo });

    // `employees_username_key` ya lo impediría, pero el error de una unique
    // violation nombra un índice y no a la persona que lo tiene ocupado.
    const { data: ocupado, error: ocupErr } = await admin
      .from("employees").select("id, name").eq("username", nuevo).neq("id", empleadoId).limit(1);
    if (ocupErr) return json({ ok: false, error: "DB_ERROR", details: ocupErr.message });
    if (ocupado?.length)
      return json({ ok: false, error: "USERNAME_TAKEN", details: `El usuario "${nuevo}" ya es de ${ocupado[0].name}.` });

    // La cuenta principal se busca por id —`auth.users.id` = `employees.id`, lo
    // fija `set-employee-password` al crearla—, no por el correo viejo. Las de
    // carné y kiosco (`@staff.local`) NO se tocan: cuelgan del código y del PIN,
    // no del usuario.
    const { data: cuenta } = await admin.auth.admin.getUserById(empleadoId);
    const correoAnterior = cuenta?.user?.email ?? null;
    const metaAnterior = (cuenta?.user?.user_metadata ?? {}) as Record<string, unknown>;

    if (cuenta?.user) {
      const { error: authErr } = await admin.auth.admin.updateUserById(empleadoId, {
        email: `${nuevo}@${DOMINIO}`,
        email_confirm: true,
        user_metadata: { ...metaAnterior, username: nuevo, code: empleado.code },
      });
      if (authErr) return json({ ok: false, error: "AUTH_UPDATE_ERROR", details: authErr.message });
    }

    const { error: updErr } = await admin.from("employees").update({ username: nuevo }).eq("id", empleadoId);
    if (updErr) {
      // Deshacer el correo. Dejarlo cambiado con la ficha en el nombre viejo es
      // EXACTAMENTE el desfase que esta función existe para evitar, y encima al
      // revés: nadie sospecharía de la cuenta mirando una ficha que no cambió.
      //
      // Y el resultado de deshacer SE MIRA: si también falla, la persona queda
      // con la cuenta renombrada y la ficha en el nombre viejo, que es el único
      // desenlace del que nadie sospecharía —la ficha no cambió— y hay que
      // decirlo en la misma respuesta, no dejarlo en un `catch` vacío.
      let deshecho = true;
      if (cuenta?.user && correoAnterior) {
        try {
          const { error: errVuelta } = await admin.auth.admin.updateUserById(empleadoId, {
            email: correoAnterior,
            email_confirm: true,
            user_metadata: metaAnterior,
          });
          deshecho = !errVuelta;
        } catch {
          deshecho = false;
        }
      }
      return json({
        ok: false,
        error: "DB_UPDATE_ERROR",
        desfasado: !deshecho,
        details: deshecho
          ? `No se pudo escribir el usuario en la ficha: ${updErr.message}. Nada cambió.`
          : `No se pudo escribir el usuario en la ficha (${updErr.message}) y tampoco devolver la cuenta a "${correoAnterior}". `
            + `Hasta que se corrija, esa persona entra con "${nuevo}" aunque la ficha diga otra cosa.`,
      });
    }

    // Las sesiones abiertas NO se cierran a propósito: el JWT identifica por
    // uuid y sigue siendo válido, así que la persona no pierde lo que esté
    // haciendo. El usuario nuevo lo necesita recién la próxima vez que entre.
    return json({
      ok: true,
      username: nuevo,
      anterior: anterior || null,
      cuenta_renombrada: !!cuenta?.user,
    });
  } catch (e) {
    return json({ ok: false, error: "UNHANDLED_EXCEPTION", details: String((e as Error)?.message ?? e) });
  }
});
