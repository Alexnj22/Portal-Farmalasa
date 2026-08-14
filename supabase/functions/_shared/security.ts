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
