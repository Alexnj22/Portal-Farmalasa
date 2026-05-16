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
