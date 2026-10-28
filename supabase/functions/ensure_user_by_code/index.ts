// supabase/functions/ensure_user_by_code/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireAuthUser } from "../_shared/security.ts";

// ─── Admin client a nivel de módulo para reutilizar conexiones entre invocaciones cálidas ───
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin       = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

// ── Rate limit anti fuerza-bruta: el password de login es lo que trae el carné
// (ver AuthContext.jsx signInWithPassword), así que este endpoint es el único
// oráculo que distingue un carné válido/activo de uno inválido. Solo se cuentan
// intentos FALLIDOS (NOT_FOUND/INACTIVE) por IP — un login exitoso nunca suma,
// así que un kiosco con tráfico real de múltiples empleados jamás lo dispara.
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX_FAILURES = 15;

const SELECT_COLS = `
    id,
    code,
    kiosk_pin,
    name,
    role_id,
    secondary_role_id,
    branch_id,
    photo_url,
    username,
    phone,
    status,
    role:roles!employees_role_id_fkey ( name, rango ),
    sec_role:roles!employees_secondary_role_id_fkey ( rango )
  `;

// El correo de un carné de papel es `carne-<uuid del empleado>@staff.local`.
// Reconocerlo por el correo y no por el metadata es a propósito: el metadata lo
// puede reescribir cualquier actualización de la cuenta, el correo no.
const esCorreoDeCarneTemporal = (email: string | undefined | null) =>
  typeof email === "string" && email.startsWith("carne-") && email.endsWith("@staff.local");

// La IP la pone el borde de la red, no quien llama (2026-10-14). El PRIMER
// valor de `x-forwarded-for` lo escribe el cliente si quiere: cambiándolo en
// cada intento, el tope de 15 fallos no se llenaba nunca. `cf-connecting-ip`
// lo sobrescribe Cloudflare y `x-real-ip` el proxy; el último salto del
// `x-forwarded-for` es el que agregó el proxy, no el cliente.
function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",").map((x) => x.trim()).filter(Boolean).pop() ?? "unknown";
  return "unknown";
}

async function isRateLimited(ip: string): Promise<boolean> {
  if (!admin) return false;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count, error } = await admin
    .from("login_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("client_ip", ip)
    .gte("created_at", since);
  if (error) return false; // fail-open: no bloquear login real por un error de la tabla de rate-limit
  return (count ?? 0) >= RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(ip: string): void {
  if (!admin) return;
  // Sin `await` a propósito (no demora la respuesta), pero el error se dice:
  // un tope que no anota es un tope que no existe.
  admin.from("login_rate_limit").insert({ client_ip: ip })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[ensure_user_by_code] login_rate_limit:", error.message);
    });
}

// ── Identidad de quien ya tiene sesión ───────────────────────────────────────
// Espejo exacto de auth_employee_id() en la BD: el uid del JWT es el id del
// empleado (las cuentas del portal se crean con `id: employee.id`), y si no,
// el vínculo explícito de employee_auth_accounts cubre las del kiosco/carné.
// El `code` que venga en el cuerpo del pedido NO participa: hasta el 2026-08-04
// esta función tomaba ese código y devolvía el perfil de CUALQUIER empleado a
// cualquier sesión válida — y además copiaba su roleId/systemRole/branchId al
// metadata de quien preguntaba, que era una escalada directa a SUPERADMIN.
async function resolveEmployeeFromSession(uid: string) {
  if (!admin) return null;

  const direct = await admin.from("employees").select(SELECT_COLS).eq("id", uid).limit(1);
  if (direct.error) throw new Error(`employees por uid: ${direct.error.message}`);
  if (direct.data?.length) return direct.data[0];

  const link = await admin
    .from("employee_auth_accounts")
    .select("employee_id")
    .eq("auth_user_id", uid)
    .limit(1);
  if (link.error) throw new Error(`employee_auth_accounts: ${link.error.message}`);
  if (!link.data?.length) return null;

  const byLink = await admin
    .from("employees").select(SELECT_COLS).eq("id", link.data[0].employee_id).limit(1);
  if (byLink.error) throw new Error(`employees por vínculo: ${byLink.error.message}`);
  return byLink.data?.[0] ?? null;
}

// ── Por qué falló un login con usuario y contraseña (2026-09-28) ─────────────
// Auth contesta lo mismo —`invalid_credentials`— para un usuario que no existe
// y para una contraseña equivocada, y el portal decía «usuario no encontrado o
// contraseña incorrecta». El 28-sep eso costó un restablecimiento: una persona
// con la contraseña intacta no sabía si había escrito mal el usuario o la clave.
//
// Contestarlo revela qué usuarios existen, y acá se adivinan (`nombre.apellido`).
// Decisión del usuario: se contesta, con dos frenos. El portal sólo pregunta
// DESPUÉS de un intento fallido, y cada pregunta cuenta como un fallo en el
// mismo tope por IP que el login por código (15 en 10 minutos): alcanza para
// quien se equivocó, no para barrer la lista.
//
// Nunca dice nada de la contraseña más allá de «el usuario existe y está en
// regla»: la clave la sigue juzgando Auth, no esta función.
async function diagnosticarUsuario(entrada: string, ip: string) {
  if (!admin) return { ok: false, error: "MISSING_ENV" };
  if (await isRateLimited(ip)) return { ok: true, estado: "DEMASIADOS_INTENTOS" };
  recordFailure(ip);

  const usuario = entrada.trim().toLowerCase();
  // Sin `%` ni `_`: el `ilike` de abajo los leería como comodines.
  if (!usuario || !/^[a-z0-9.\-]+$/.test(usuario)) return { ok: true, estado: "NO_EXISTE" };

  const { data: filas, error } = await admin
    .from("employees").select("id, status").ilike("username", usuario).limit(1);
  if (error) return { ok: false, error: "DB_ERROR" };
  const emp = filas?.[0];
  if (!emp) return { ok: true, estado: "NO_EXISTE" };
  if (emp.status && emp.status !== "ACTIVO") return { ok: true, estado: "INACTIVO" };

  // La cuenta del portal se crea con `id: employee.id` (set-employee-password).
  const { data: cuenta } = await admin.auth.admin.getUserById(emp.id);
  const u = cuenta?.user;
  if (!u) return { ok: true, estado: "SIN_ACCESO" };
  // El login arma el correo con lo que se escribió; si la cuenta tiene otro, esa
  // persona no puede entrar con ninguna contraseña — es un renombre a medias.
  if ((u.email ?? "").toLowerCase() !== `${usuario}@farmalasa.app`) {
    return { ok: true, estado: "CUENTA_DESALINEADA" };
  }
  const baneada = (u as { banned_until?: string | null }).banned_until;
  if (baneada && new Date(baneada).getTime() > Date.now()) return { ok: true, estado: "BLOQUEADO" };
  return { ok: true, estado: "CONTRASENA" };
}

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

  const authenticatedUser = await requireAuthUser(req);
  const clientIp = getClientIp(req);

  try {
    // ═══ Con sesión: devuelve el perfil de QUIEN PREGUNTA, y de nadie más ═══
    if (authenticatedUser) {
      // El carné de papel vale hasta medianoche, y una sesión abierta con él no
      // puede sobrevivirlo: la purga le cambia la contraseña a esa cuenta, pero
      // eso sólo corta el refresco del token, no la sesión que ya está en un
      // navegador. Acá se contesta explícito para que el portal cierre la
      // sesión — y sólo acá, porque esta función corre en CADA refresco de
      // token de TODOS: la consulta se hace únicamente si el correo es de un
      // carné de papel.
      if (esCorreoDeCarneTemporal(authenticatedUser.email)) {
        const { data: vivos, error: errCarne } = await admin
          .from("carnes_temporales")
          .select("id")
          .eq("auth_user_id", authenticatedUser.id)
          .is("anulado_el", null)
          .gt("vence_el", new Date().toISOString())
          .limit(1);
        // Un error de la consulta NO cierra la sesión: se falla del lado de no
        // echar a nadie por un problema de la base.
        if (!errCarne && !vivos?.length) {
          return json({ ok: false, error: "CARNE_VENCIDO" });
        }
      }

      const employee = await resolveEmployeeFromSession(authenticatedUser.id);
      if (!employee) return json({ ok: false, error: "NOT_FOUND" });
      if (employee.status && employee.status !== "ACTIVO") {
        return json({ ok: false, error: "INACTIVE" });
      }

      // El metadata del JWT ya no decide permisos (lo hacen las funciones auth_*
      // contra la tabla), pero el frontend lo lee para pintar la UI: se mantiene
      // al día con el empleado real, no con lo que pidió el cliente.
      const newRoleId = employee.role_id ?? null;
      // El escalón sale del CARGO —el propio y el secundario, el mayor de los
      // dos—, que es la misma regla que `rango_de_empleado()` en la base.
      // Reemplaza a `systemRole`, que era un rango escrito por persona.
      const newRango = Math.max(
        Number((employee.role as { rango?: number } | null)?.rango ?? 0),
        Number((employee.sec_role as { rango?: number } | null)?.rango ?? 0),
      );
      const newBranchId   = employee.branch_id ?? null;
      const curMeta       = authenticatedUser.user_metadata || {};

      const metaChanged =
        curMeta.roleId               !== newRoleId   ||
        curMeta.rango                !== newRango    ||
        curMeta.systemRole           !== undefined   ||
        curMeta.branchId             !== newBranchId ||
        curMeta.code                 !== employee.code ||
        curMeta.must_change_password !== false;

      if (metaChanged) {
        // `systemRole` se borra del metadata en vez de dejarse envejecer: un
        // valor viejo que ya no significa nada es peor que uno ausente, porque
        // el próximo que lo lea va a creerle.
        //
        // Se borra mandándolo en `null`, NO omitiéndolo: Auth COMBINA el
        // `user_metadata` recibido con el guardado, así que una clave ausente
        // sobrevive, y sólo un `null` la elimina. Hasta el 2026-09-28 se omitía:
        // `systemRole` nunca se iba, `metaChanged` daba siempre verdadero y cada
        // renovación de sesión de cada persona reescribía su cuenta.
        const { systemRole: _viejo, ...metaSinSystemRole } = curMeta;
        await admin.auth.admin.updateUserById(authenticatedUser.id, {
          user_metadata: {
            ...metaSinSystemRole,
            systemRole:           null,
            code:                 employee.code,
            roleId:               newRoleId,
            rango:                newRango,
            branchId:             newBranchId,
            must_change_password: false,
          },
        });
      }

      return json({
        ok: true,
        isNewUser: false,
        user: {
          id:              employee.id,
          name:            employee.name,
          code:            employee.code,
          username:        employee.username ?? null,
          role:            (employee.role as { name?: string } | null)?.name || "Sin Cargo",
          roleId:          newRoleId,
          secondaryRoleId: employee.secondary_role_id ?? null,
          branchId:        newBranchId,
          photo:           employee.photo_url,
          email:           authenticatedUser.email,
          phone:           employee.phone,
          rango:           newRango,
        },
      });
    }

    // ═══ Pre-login: sin sesión, el código es lo único que hay. Solo devuelve
    // el correo con el que completar el signIn — nunca datos del empleado. ═══
    const body = await req.json().catch(() => ({}));

    // ═══ Diagnóstico de un login fallido ═══
    if (typeof body?.diagnosticar_usuario === "string") {
      return json(await diagnosticarUsuario(body.diagnosticar_usuario, clientIp));
    }

    const raw  = typeof body?.code === "string" ? body.code.trim() : "";

    // ── Validación de input: solo caracteres seguros (excluye % _ para evitar inyección ILIKE) ──
    if (!raw || !/^[a-zA-Z0-9.\-]+$/.test(raw)) {
      return json({ ok: false, error: "CODE_INVALID" });
    }

    if (await isRateLimited(clientIp)) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429);
    }

    const clean = raw.toUpperCase();

    // ── Sólo el PIN del carné, NUNCA el número de empleado (2026-10-14) ──
    //
    // Antes se buscaba primero por `code` y, si no, por `kiosk_pin`. O sea que
    // el número a secas —el mismo que es código de vendedor, impreso en las
    // facturas y repartido a todo el que ve Ventas— abría la sesión de esa
    // persona: alcanzaba con llamar a esta función con `125`. La pantalla de
    // inicio ya rechazaba teclearlo (exige velocidad de lector), pero ese freno
    // vive en el navegador y quien llama directo se lo salta.
    //
    // Medido antes de cerrarlo: las 26 cuentas `<número>@staff.local` no se
    // usaban desde el 2026-07-11, y las 36 personas de la última semana
    // entraron con el PIN. Esas cuentas quedaron además bloqueadas: con la
    // contraseña igual al número se entraba sin pasar por acá.
    //
    // Límite conocido: el PIN se DERIVA del número con una fórmula sin secreto
    // (`derivar_kiosk_pin`). El arreglo de fondo es un PIN al azar, y exige
    // reimprimir los carnés — decisión del usuario: por ahora no.
    let { data: rows, error: dbError } = await admin
      .from("employees")
      .select(SELECT_COLS)
      .eq("kiosk_pin", clean)
      .limit(1);

    // Tercero, el carné de PAPEL del día. Va al final porque es la excepción
    // —dura hasta medianoche y hay pocos vivos a la vez—, igual que en las tres
    // funciones de la base que leen un carné. Lo resuelve la base: acá no se
    // sabe ni se puede saber cuál es el secreto, sólo si alguien lo reconoce.
    let porCarneTemporal = false;
    if (!dbError && !rows?.length) {
      const { data: quien, error: errCarne } = await admin.rpc("resolver_carne_temporal", { p_valor: raw });
      // Una falla de la base NO es un carné inválido: contestar NOT_FOUND la
      // disfrazaba de «escaneaste mal» y además sumaba un intento fallido.
      if (errCarne) return json({ ok: false, error: "DB_ERROR", details: errCarne.message });
      if (quien) {
        porCarneTemporal = true;
        ({ data: rows, error: dbError } = await admin
          .from("employees")
          .select(SELECT_COLS)
          .eq("id", quien as string)
          .limit(1));
      }
    }

    if (dbError) return json({ ok: false, error: "DB_ERROR", details: dbError.message });
    if (!rows?.length) {
      recordFailure(clientIp);
      return json({ ok: false, error: "NOT_FOUND" });
    }

    const employee = rows[0];

    if (employee.status && employee.status !== "ACTIVO") {
      recordFailure(clientIp);
      return json({ ok: false, error: "INACTIVE" });
    }

    // La cuenta del carné de papel la creó `emitir-carne-temporal` cuando se
    // imprimió, con el secreto por contraseña. Acá NO se crea: si no existe, el
    // papel no vale — crearla con lo que se acaba de escanear convertiría este
    // endpoint en una fábrica de cuentas.
    if (porCarneTemporal) {
      const email = `carne-${employee.id}@staff.local`;
      const { data: cuenta, error: errCuenta } = await admin.rpc("cuenta_de_carne_temporal", { p_email: email });
      if (errCuenta) return json({ ok: false, error: "DB_ERROR", details: errCuenta.message });
      if (!cuenta) {
        recordFailure(clientIp);
        return json({ ok: false, error: "NOT_FOUND" });
      }
      return json({ ok: true, isNewUser: false, user: { email, isKiosk: true } });
    }

    // Se encontró por PIN (es la única búsqueda que queda), así que la cuenta es
    // siempre la del PIN. Ya no se crea la `<número>@staff.local`.
    const email = `${employee.kiosk_pin.toLowerCase()}@staff.local`;
    const createPayload: Record<string, unknown> = {
      email,
      password: employee.kiosk_pin,
      email_confirm: true,
      user_metadata: { code: employee.code, kiosk: true },
    };

    // ── Crear usuario Auth solo si no existe ──
    const createRes = await admin.auth.admin.createUser(createPayload);
    const isNewUser = !createRes.error;
    if (createRes.error) {
      const msg        = (createRes.error.message || "").toLowerCase();
      const isExisting = msg.includes("already") || msg.includes("exists") ||
                         msg.includes("registered") || msg.includes("duplicate");
      if (!isExisting) return json({ ok: false, error: "AUTH_CREATE_ERROR", details: createRes.error.message });
    }

    // El uid de estas cuentas lo genera Auth, así que no coincide con employees.id:
    // sin esta fila, las funciones auth_* no pueden resolver al empleado y la cuenta
    // queda sin permisos. Falla cerrada, nunca abierta.
    //
    // Y también cuando la cuenta YA existía (2026-10-14): si la primera vez el
    // `createUser` entró pero el enlace falló, el reintento caía en «already
    // exists», se saltaba esto y la persona entraba SIN permisos para siempre.
    // El upsert es idempotente, así que repetirlo no cuesta nada.
    let authId: string | null = createRes.data?.user?.id ?? null;
    if (!authId) {
      const { data: existente, error: errExiste } = await admin.rpc("cuenta_de_carne_temporal", { p_email: email });
      if (errExiste) return json({ ok: false, error: "DB_ERROR", details: errExiste.message });
      authId = (existente as string | null) ?? null;
    }
    if (authId) {
      const { error: linkErr } = await admin
        .from("employee_auth_accounts")
        .upsert({ auth_user_id: authId, employee_id: employee.id },
                { onConflict: "auth_user_id" });
      if (linkErr) return json({ ok: false, error: "LINK_ERROR", details: linkErr.message });
    }

    // ── El pase de un solo uso (2026-10-28, SEGURIDAD-Y-ACCESO §3.1) ──
    //
    // La contraseña de esta cuenta ES el PIN, y el PIN sale del número con una
    // fórmula sin secreto: con el número de alguien se podía ir directo a Auth
    // —sin pasar por esta función, su tope ni su registro— y abrir su sesión.
    // El navegador entra ahora con este pase (`verifyOtp({ token_hash })`), que
    // sólo esta función puede emitir y que vale una vez. Así la única puerta
    // del carné es ésta, que es la que se puede vigilar (horario, sala, tope).
    //
    // Etapa 1: el pase CONVIVE con la contraseña. Si no se pudo emitir, el
    // navegador entra como antes. Cuando los registros muestren que nadie usa
    // el camino viejo, las contraseñas de estas cuentas se cambian a un valor
    // al azar (etapa 2) y la puerta de atrás queda cerrada.
    const { data: pase, error: errPase } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (errPase) console.error("[ensure_user_by_code] generateLink:", errPase.message);
    const tokenHash = (pase?.properties as { hashed_token?: string } | undefined)?.hashed_token ?? null;

    return json({ ok: true, isNewUser, user: { email, isKiosk: true, token_hash: tokenHash } });

  } catch (e) {
    return json({ ok: false, error: "UNHANDLED", details: String((e as Error)?.message ?? e) });
  }
});
