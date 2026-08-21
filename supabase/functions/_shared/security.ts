// Shared security utilities for all Edge Functions

// ── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  Deno.env.get("PORTAL_ORIGIN") ?? "",
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean);

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── ADMIN INVOKE SECRET (for cron / internal calls without user session) ─────
export function requireInvokeSecret(req: Request): boolean {
  const secret = Deno.env.get("ADMIN_INVOKE_SECRET");
  if (!secret) return false; // secret not set → deny
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

// ── JWT user validation (for calls from authenticated frontend users) ─────────
import { createClient } from "npm:@supabase/supabase-js@2";

export async function requireAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const client = createClient(url, anon);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// ── CRON INVOKE SECRET (auditoría 2026-07: gate dedicado para funciones
// cron/internas que hasta ahora no validaban nada). Header propio
// (`x-cron-secret`, no Authorization) y secreto propio (`CRON_INVOKE_SECRET`,
// distinto de ADMIN_INVOKE_SECRET — ese ya está expuesto en texto plano en
// ~25 cron.job.command, ver AUDITORIA-2026-07.md) para no heredar esa
// exposición en el nuevo gate. ─────────────────────────────────────────────
export function checkCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_INVOKE_SECRET");
  if (!secret) return false; // secret not set → deny
  const header = req.headers.get("x-cron-secret") ?? "";
  return header === secret;
}

// ── Empleado activo real (auditoría 2026-07: requireAuthUser solo confirma
// que el JWT es válido, no que el empleado sigue activo — una cuenta dada
// de baja pero con un access token todavía no expirado pasaba igual).
// Requiere el cliente admin/service_role del caller para poder leer
// `employees` sin depender de sus policies RLS. ────────────────────────────
export interface ActiveEmployee {
  id: string;
  status: string;
  code: string;
  name: string;
}

export async function requireActiveEmployeeUser(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<ActiveEmployee | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const employee = await resolverEmpleadoPorCuenta(admin, user.id);
  if (!employee) return null;
  if (employee.status !== "ACTIVO") return null;

  return employee;
}

// ── Una persona, DOS identificadores (medido el 2026-08-14) ────────────────
// `employees.id` es la ficha; `auth.users.id` es la cuenta con la que entra, y
// para la mayoría del personal NO son el mismo valor: entran por una cuenta
// ligada en `employee_auth_accounts` —las `*@staff.local` que nacieron con el
// acceso por carné—. Buscar la ficha con `employees.id = auth.uid()` a secas
// devolvía cero filas para 33 de las 42 personas que usan el portal, y cada
// función traducía ese cero a «Sesión inválida o empleado inactivo»: un 401
// que culpa a la sesión cuando la sesión está bien y el empleado activo.
//
// Le pasaba a TODA función que valida con `requireActiveEmployeeUser` —envío y
// devolución de pedidos, traslados y movimientos de inventario, facturación,
// exportar compras—, y no se vio antes porque la única cuenta con la que se
// probó (QA Testing) es de las pocas donde los dos ids coinciden.
//
// Esto es lo mismo que hace `auth_employee_id()` en la base, incluido el orden:
// gana la ficha cuyo id ES el de la cuenta, y sólo si no hay se resuelve por la
// liga. Ver la regla «el portal tiene dos identidades por persona».
async function resolverEmpleadoPorCuenta(
  admin: ReturnType<typeof createClient>,
  authUserId: string,
): Promise<ActiveEmployee | null> {
  const directo = await admin
    .from("employees")
    .select("id, status, code, name")
    .eq("id", authUserId)
    .limit(1);
  if (directo.error) return null;
  if (directo.data?.length) return directo.data[0] as ActiveEmployee;

  const liga = await admin
    .from("employee_auth_accounts")
    .select("employee_id")
    .eq("auth_user_id", authUserId)
    .limit(1);
  if (liga.error || !liga.data?.length) return null;

  const empleadoId = (liga.data[0] as { employee_id: string }).employee_id;
  const ligado = await admin
    .from("employees")
    .select("id, status, code, name")
    .eq("id", empleadoId)
    .limit(1);
  if (ligado.error || !ligado.data?.length) return null;

  return ligado.data[0] as ActiveEmployee;
}

// ── ERP Credentials (from Supabase Secrets, never hardcoded) ─────────────────
export interface ErpBranchEntry {
  branchId: number;
  erpId: number;
  username: string;
  password: string;
}

export interface ErpInvEntry {
  erpId: number;
  username: string;
  password: string;
  ubicaciones: { id: number; isVencidos: boolean }[];
}

export function getErpBranchMap(): ErpBranchEntry[] {
  const raw = Deno.env.get("ERP_BRANCH_MAP");
  if (!raw) throw new Error("ERP_BRANCH_MAP secret not configured in Supabase.");
  return JSON.parse(raw);
}

export function getErpInvMap(): ErpInvEntry[] {
  const raw = Deno.env.get("ERP_INV_BRANCH_MAP");
  if (!raw) throw new Error("ERP_INV_BRANCH_MAP secret not configured in Supabase.");
  return JSON.parse(raw);
}

export function getErpCredsByBranch(branchId: number): ErpBranchEntry | null {
  const map = getErpBranchMap();
  return map.find((e) => e.branchId === branchId) ?? null;
}

// ── El permiso de un módulo, leído UNA vez y bien ────────────────────────────
//
// Catorce edge functions repetían la misma pareja de consultas —`employees` para
// el rol, `role_permissions` para el módulo— y las veintidós descartaban el
// error. Todas terminaban igual:
//
//     const { data: perm } = await admin.from("role_permissions")…
//     if (perm?.can_edit !== true) return 403 "No tienes permiso"
//
// O sea que **una consulta que falla contesta «no tenés permiso»** a alguien que
// sí lo tiene. Y eso no es un mensaje aproximado: un permiso denegado se lee
// como una decisión —pedirlo, avisarle al jefe, esperar— y no como una falla que
// se reintenta, así que el mensaje equivocado manda a la persona por el camino
// equivocado y el problema real no se reporta nunca.
//
// Acá se lee una sola vez, y `roto` separa los dos casos. Quien llama contesta
// 503 si está roto y 403 sólo cuando de verdad no puede.
//
// Cubre las seis variantes que había: una acción o la otra, con o sin
// `secondary_role_id`, con o sin `system_role === "SUPERADMIN"`, y con o sin
// `scope === "ALL"`. Ninguna function necesita ya escribir la pareja a mano.
export interface PermisoModulo {
  /** Si puede hacer la acción pedida. `false` cuando de verdad no puede. */
  puede: boolean;
  /** Si su alcance es TODAS las sucursales (SUPERADMIN o `scope = 'ALL'`). */
  alcanceTodo: boolean;
  /** La ficha, para el nombre del concepto y la sucursal propia. */
  emp: {
    role_id: number | null;
    secondary_role_id: number | null;
    system_role: string | null;
    branch_id: number | null;
    first_names?: string | null;
    last_names?: string | null;
  } | null;
  /**
   * Por qué no se pudo AVERIGUAR. Distinto de `puede: false`, que es una
   * respuesta. Si viene con texto, la function tiene que contestar 503 y no 403.
   */
  roto: string | null;
}

export async function permisoDeModulo(
  admin: { from: (t: string) => any },
  employeeId: string,
  modulo: string,
  accion: "can_view" | "can_edit" | "can_approve",
): Promise<PermisoModulo> {
  const vacio = { puede: false, alcanceTodo: false, emp: null };

  const { data: emp, error: empErr } = await admin
    .from("employees")
    .select("role_id, secondary_role_id, system_role, branch_id, first_names, last_names")
    .eq("id", employeeId).maybeSingle();
  if (empErr) {
    console.error(`[permisoDeModulo] employees (${modulo}/${accion}): ${empErr.message}`);
    return { ...vacio, roto: "No se pudo leer tu ficha de empleado." };
  }

  /* Los DOS roles: el principal y el secundario.
   *
   * ⚠️ CAMBIO DE COMPORTAMIENTO, y deliberado. Seis de las funciones que ahora
   * usan este helper miraban SÓLO `role_id`: wfm-ai-scheduler,
   * export-purchase-dte-zip, los dos backfill, regularizar-dte y
   * sincronizar-fichas-clientes. O sea que a quien cubría otro puesto le
   * negaban lo que el resto del portal ya le concedía.
   *
   * El canon no es una opinión: `auth_has_module_permission` —la función que
   * usan TODAS las policies de RLS— concede por SUPERADMIN, por rol principal,
   * por rol secundario y por herencia de ausencia. Esas seis eran más estrictas
   * que la base, así que alinearlas es corregir la excepción, no ampliar el
   * permiso.
   *
   * Lo que este helper NO replica del canon es la cuarta rama,
   * `auth_hereda_por_ausencia`: quien cubre a alguien de vacaciones hereda su
   * permiso en la base y acá todavía no. Sigue siendo más estricto que el
   * canon, que es el lado seguro para equivocarse — pero está anotado porque es
   * una diferencia real y alguien la va a encontrar.
   */
  const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
  const { data: permisos, error: permErr } = await admin
    .from("role_permissions")
    .select("can_view, can_edit, can_approve, scope")
    .in("role_id", roles.length ? roles : [-1])
    .eq("module_key", modulo);
  if (permErr) {
    console.error(`[permisoDeModulo] role_permissions (${modulo}/${accion}): ${permErr.message}`);
    return { ...vacio, emp: emp ?? null, roto: "No se pudieron leer tus permisos." };
  }

  const filas = (permisos ?? []) as Record<string, unknown>[];
  const su = emp?.system_role === "SUPERADMIN";
  return {
    puede: su || filas.some((p) => p[accion] === true),
    alcanceTodo: su || filas.some((p) => p[accion] === true && p.scope === "ALL"),
    emp: (emp ?? null) as PermisoModulo["emp"],
    roto: null,
  };
}
