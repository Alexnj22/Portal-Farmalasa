// supabase/functions/recuperar-contrasena/index.ts
//
// «¿Olvidaste tu contraseña?» de la app del personal (2026-11-17, pedido del
// usuario: «que aparezca olvidé la contraseña … si es automático mejor», y
// «algo que sea gratis»).
//
// Sin sesión (la persona no puede entrar), así que va con `--no-verify-jwt` y
// se cuida sola. Dos acciones:
//
//  · `pedir` { usuario }
//      - Con correo válido en la ficha: un código de 6 dígitos al correo
//        (Resend, ya pagado por el plan gratuito). Se guarda SÓLO su hash,
//        vence en 15 minutos y aguanta 5 intentos. El código NUNCA vuelve en
//        la respuesta: quien sabe el usuario de otro no puede entrar con él.
//      - Sin correo: aviso con push a Talento Humano, Administrador y
//        Supervisor/a de Ventas (el usuario sacó al Gerente General). Lo
//        resuelven desde la ficha con «Restablecer contraseña», que da la
//        temporal de un solo uso y ya respeta el rango (`set-employee-password`).
//  · `canjear` { reto, codigo, nueva }
//      - Comprueba el código y pone la contraseña nueva. La app entra después
//        con ella como con cualquier otra.
//
// Frenos: por IP en memoria (barato, no exacto), 3 pedidos por persona cada
// 15 minutos en la base, 5 intentos por código y un aviso por persona por hora.
// Retención: cada pedido borra lo de más de 30 días.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/security.ts";

const MINUTOS_VIGENCIA = 15;
const MAX_INTENTOS = 5;
const MAX_PEDIDOS_15MIN = 3;
// Quién recibe el aviso cuando no hay correo: Administrador (3), Talento
// Humano (11) y Supervisor/a de Ventas (13). Gerente General (2) no, por
// decisión del usuario (2026-11-17).
const CARGOS_QUE_AVISAN = [3, 11, 13];
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const topePorIp = new Map<string, { n: number; desde: number }>();

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function codigoNuevo(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/** «a•••@gmail.com»: lo justo para que la persona sepa dónde mirar. */
function correoTapado(c: string): string {
  const [u, d] = c.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(u.length - 1, 5)))}@${d}`;
}

/** Las mismas reglas que `problemaDeContrasenaNueva` del núcleo. */
function problemaDeClave(c: string): string | null {
  if (c.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Z]/.test(c)) return "La contraseña debe tener al menos una mayúscula.";
  if (!/[0-9]/.test(c)) return "La contraseña debe tener al menos un número.";
  return null;
}

/** Auth contesta en inglés: nada de eso llega a la pantalla. */
function errorDeAuthEnEspanol(m: string): string {
  if (/known to be weak|easy to guess|pwned|leaked/i.test(m)) return "Esa contraseña es muy conocida y no es segura. Elige otra.";
  if (/weak|should (contain|be at least)|characters/i.test(m)) return "La contraseña es muy débil. Mínimo 8 caracteres, con una mayúscula y un número.";
  if (/same_password|different from the old/i.test(m)) return "La contraseña nueva tiene que ser distinta de la anterior.";
  return "No se pudo guardar la contraseña. Intenta de nuevo.";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function correoHtml(nombre: string, codigo: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2433">
<table role="presentation" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px" width="100%"><tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#5b6675">Portal Farmasalud</p>
<h1 style="margin:0 0 16px;font-size:20px">Tu código para cambiar la contraseña</h1>
<p style="margin:0 0 16px;font-size:14px">Hola, ${esc(nombre)}. Escribe este código en la app:</p>
<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px;font-family:monospace">${codigo}</p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6675">Vence en ${MINUTOS_VIGENCIA} minutos y sirve una sola vez.</p>
<p style="margin:16px 0 0;font-size:12px;color:#8a94a3">Si no lo pediste, ignora este correo. Tu contraseña no cambia.</p>
</td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, mensaje: "Método no permitido." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip";

  // Freno por IP: 15 llamadas cada 15 minutos por instancia.
  const ahora = Date.now();
  const t = topePorIp.get(ip);
  if (t && ahora - t.desde < 15 * 60_000) {
    if (t.n >= 15) return json({ ok: false, mensaje: "Demasiados intentos. Espera unos minutos." }, 429);
    t.n++;
  } else {
    if (topePorIp.size > 5000) topePorIp.clear();
    topePorIp.set(ip, { n: 1, desde: ahora });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const accion = body?.accion;

    // ══════════════════════════════════════════════════════════════════
    if (accion === "pedir") {
      const usuario = typeof body?.usuario === "string" ? body.usuario.toLowerCase().trim() : "";
      if (!usuario) return json({ ok: false, mensaje: "Escribe tu usuario." });

      const { data: emp, error: eE } = await admin.from("employees")
        .select("id, name, email, status, branch_id").eq("username", usuario).maybeSingle();
      if (eE) throw eE;
      if (!emp || emp.status !== "ACTIVO") {
        return json({ ok: false, mensaje: "Ese usuario no existe. Revisa cómo lo escribiste." });
      }

      const { error: eDel } = await admin.from("recuperaciones_de_clave").delete()
        .lt("created_at", new Date(ahora - 30 * 86400_000).toISOString());
      if (eDel) console.error("recuperar: limpieza:", eDel.message);

      const { count, error: eC } = await admin.from("recuperaciones_de_clave")
        .select("id", { count: "exact", head: true }).eq("employee_id", emp.id)
        .gte("created_at", new Date(ahora - 15 * 60_000).toISOString());
      if (eC) throw eC;
      if ((count ?? 0) >= MAX_PEDIDOS_15MIN) {
        return json({ ok: false, mensaje: "Ya pediste varios códigos. Espera unos minutos." }, 429);
      }

      // La cuenta tiene que existir: sin ella no hay contraseña que cambiar.
      const { data: cuenta, error: eA } = await admin.auth.admin.getUserById(emp.id);
      if (eA && eA.status !== 404) throw eA;

      const correo = String(emp.email ?? "").trim();
      const llave = Deno.env.get("RESEND_API_KEY");
      const remitente = Deno.env.get("CORREO_REMITENTE_CLIENTES") ?? Deno.env.get("CORREO_REMITENTE");

      if (cuenta?.user && CORREO_VALIDO.test(correo) && llave && remitente) {
        const reto = crypto.randomUUID();
        const codigo = codigoNuevo();
        const { error: eIns } = await admin.from("recuperaciones_de_clave").insert({
          id: reto, employee_id: emp.id, canal: "correo", ip,
          codigo_hash: await sha256(`${reto}:${codigo}`),
          vence_at: new Date(ahora + MINUTOS_VIGENCIA * 60_000).toISOString(),
        });
        if (eIns) throw eIns;
        const primerNombre = String(emp.name ?? "").trim().split(/\s+/)[0] || "";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${llave}`, "Content-Type": "application/json", "Idempotency-Key": `clave-${reto}` },
          body: JSON.stringify({
            from: remitente, to: [correo],
            subject: `Tu código es ${codigo} — Portal Farmasalud`,
            html: correoHtml(primerNombre, codigo),
          }),
          signal: AbortSignal.timeout(20_000),
        }).catch((e) => ({ ok: false, status: 0, text: async () => (e as Error).message }) as unknown as Response);
        if (r.ok) {
          return json({ ok: true, canal: "correo", reto, correo: correoTapado(correo), minutos: MINUTOS_VIGENCIA });
        }
        // Un código que no salió no puede quedar vivo: se borra y se avisa.
        console.error(`recuperar: el correo no salió (${r.status}): ${(await r.text()).slice(0, 300)}`);
        const { error: eB } = await admin.from("recuperaciones_de_clave").delete().eq("id", reto);
        if (eB) console.error("recuperar: no se borró el código sin enviar:", eB.message);
        // Y cae al aviso, para que la persona no quede sin salida.
      }

      // ── Sin correo (o no salió): aviso a quien restablece contraseñas ──
      const { error: eIns } = await admin.from("recuperaciones_de_clave").insert({ employee_id: emp.id, canal: "aviso", ip });
      if (eIns) throw eIns;

      const hora = new Date(ahora).toISOString().slice(0, 13);
      const checkKey = `recuperar_clave:${emp.id}:${hora}`;
      const { data: ya, error: eYa } = await admin.from("notifications").select("id").eq("metadata->>check_key", checkKey).limit(1);
      if (eYa) throw eYa;
      if (!ya?.length) {
        const { data: quienes, error: eQ } = await admin.from("employees").select("id")
          .eq("status", "ACTIVO").in("role_id", CARGOS_QUE_AVISAN).neq("id", emp.id);
        if (eQ) throw eQ;
        const destinatarios = (quienes ?? []).map((q) => q.id);
        if (destinatarios.length) {
          const { error: eN } = await admin.rpc("notify_employees", {
            p_recipients: destinatarios,
            p_type: "RECUPERAR_CONTRASENA",
            p_title: "Olvidó su contraseña",
            p_body: `${emp.name ?? "Alguien"} pide una contraseña nueva. Restablécela desde su perfil y entrégale la temporal.`,
            p_link: `/personal/empleado/${emp.id}`,
            p_metadata: { check_key: checkKey, employee_id: emp.id },
            p_push: true,
          });
          if (eN) throw eN;
        }
      }
      return json({ ok: true, canal: "aviso" });
    }

    // ══════════════════════════════════════════════════════════════════
    if (accion === "canjear") {
      const reto = typeof body?.reto === "string" ? body.reto : "";
      const codigo = typeof body?.codigo === "string" ? body.codigo.replace(/\D/g, "") : "";
      const nueva = typeof body?.nueva === "string" ? body.nueva : "";
      if (!/^[0-9a-f-]{36}$/i.test(reto) || codigo.length !== 6) return json({ ok: false, mensaje: "Escribe los 6 números del código." });
      const problema = problemaDeClave(nueva);
      if (problema) return json({ ok: false, mensaje: problema });

      const { data: fila, error: eF } = await admin.from("recuperaciones_de_clave")
        .select("id, employee_id, codigo_hash, vence_at, intentos, usada_at").eq("id", reto).eq("canal", "correo").maybeSingle();
      if (eF) throw eF;
      const pideOtro = "Ese código ya no sirve. Pide uno nuevo.";
      if (!fila || fila.usada_at || new Date(fila.vence_at).getTime() < ahora || fila.intentos >= MAX_INTENTOS) {
        return json({ ok: false, mensaje: pideOtro, vencido: true });
      }
      // El intento se cuenta ANTES de comparar, y sólo si nadie lo contó en
      // el medio: dos llamadas a la vez no comparten un intento.
      const { data: contado, error: eI } = await admin.from("recuperaciones_de_clave")
        .update({ intentos: fila.intentos + 1 }).eq("id", reto).eq("intentos", fila.intentos).is("usada_at", null).select("id");
      if (eI) throw eI;
      if (!contado?.length) return json({ ok: false, mensaje: "Intenta de nuevo." });

      if ((await sha256(`${reto}:${codigo}`)) !== fila.codigo_hash) {
        const quedan = MAX_INTENTOS - fila.intentos - 1;
        return quedan > 0
          ? json({ ok: false, mensaje: `El código no coincide. Te quedan ${quedan} intento${quedan === 1 ? "" : "s"}.` })
          : json({ ok: false, mensaje: pideOtro, vencido: true });
      }

      const { data: emp, error: eE } = await admin.from("employees").select("id, name, status").eq("id", fila.employee_id).maybeSingle();
      if (eE) throw eE;
      if (!emp || emp.status !== "ACTIVO") return json({ ok: false, mensaje: pideOtro, vencido: true });

      const { data: cuenta, error: eA } = await admin.auth.admin.getUserById(emp.id);
      if (eA) throw eA;
      const meta = (cuenta.user?.user_metadata ?? {}) as Record<string, unknown>;

      // Igual que `set-employee-password`: el permiso de la guardia
      // (`definitiva` = deja pasar UNA escritura) en su propia llamada, antes.
      const { error: ePerm } = await admin.auth.admin.updateUserById(emp.id, { app_metadata: { cambio_de_clave: "definitiva" } });
      if (ePerm) throw ePerm;
      const { error: eUpd } = await admin.auth.admin.updateUserById(emp.id, {
        password: nueva, user_metadata: { ...meta, must_change_password: false },
      });
      if (eUpd) {
        const { error: eRet } = await admin.auth.admin.updateUserById(emp.id, { app_metadata: { cambio_de_clave: null } });
        if (eRet) console.error("recuperar: no se retiró el permiso:", eRet.message);
        console.error("recuperar: updateUser:", eUpd.message);
        return json({ ok: false, mensaje: errorDeAuthEnEspanol(eUpd.message) });
      }

      // Usado éste, y muertos los demás vivos de la misma persona.
      const sello = new Date().toISOString();
      const { error: eU } = await admin.from("recuperaciones_de_clave").update({ usada_at: sello })
        .eq("employee_id", emp.id).is("usada_at", null);
      if (eU) console.error("recuperar: no se marcó usado:", eU.message);

      const { error: eLog } = await admin.from("audit_logs").insert({
        action: "CLAVE_RECUPERADA_POR_CORREO", target_id: emp.id, user_id: emp.id, user_name: emp.name ?? null,
        source: "SYSTEM", severity: "WARNING", details: { ip },
      });
      if (eLog) console.error("recuperar: audit_logs:", eLog.message);
      return json({ ok: true });
    }

    return json({ ok: false, mensaje: "Acción desconocida." }, 400);
  } catch (e) {
    console.error("recuperar-contrasena:", (e as Error)?.message ?? e);
    return json({ ok: false, mensaje: "No se pudo completar. Intenta de nuevo en un momento." }, 500);
  }
});
