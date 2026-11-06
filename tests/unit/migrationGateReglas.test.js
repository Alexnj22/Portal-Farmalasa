// ─────────────────────────────────────────────────────────────────────────────
// Las regresiones que las reglas de migración de `gate:migrations` TIENEN que cazar
// ─────────────────────────────────────────────────────────────────────────────
//
// Las cinco reglas (lock_timeout, auth por fila, DEFINER sin search_path,
// jsonb_agg en payload json, policy de escritura abierta) nacieron el
// 2026-11-06 con CERO hallazgos en las últimas 60 migraciones. Un cero es
// justo el número que no dice nada: igual lo da un detector que funciona y uno
// que no mira. Por eso acá se fabrica cada defecto y se exige que el gate lo
// vea — y se fabrica también el caso correcto que la primera versión acusó mal
// (`(SELECT EXISTS (… auth_x() …))`), para que el arreglo no se pierda.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const GATE = path.join(RAIZ, 'scripts', 'migration-gate.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function revisar(sql) {
  const archivo = path.join(tmp, `m${n++}.sql`);
  fs.writeFileSync(archivo, sql);
  try {
    return { ok: true, salida: execFileSync('node', [GATE, '--revisar', archivo], { cwd: RAIZ, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, salida: String(e.stdout) };
  }
}

const LOCK = "SET lock_timeout = '5s';\n";

describe('lock_timeout', () => {
  it('acusa DDL sin lock_timeout', () => {
    const r = revisar('ALTER TABLE public.inventory ADD COLUMN x int;');
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/lock_timeout/);
  });
  it('acepta DDL con lock_timeout', () => {
    expect(revisar(LOCK + 'CREATE INDEX i ON public.inventory (x);').ok).toBe(true);
  });
  it('acusa DDL dentro de un DO (corre al aplicar)', () => {
    expect(revisar("DO $$ BEGIN CREATE POLICY p ON t FOR SELECT TO authenticated USING (x = 1); END $$;").ok).toBe(false);
  });
  it('no acusa un ALTER TABLE dentro del cuerpo de una función', () => {
    expect(revisar("SELECT 1;\n").ok).toBe(true);
    const r = revisar(LOCK + "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql SET search_path = public AS $f$ BEGIN EXECUTE 'x'; END $f$;");
    expect(r.ok).toBe(true);
  });
  it('respeta el escape con motivo', () => {
    expect(revisar('-- sin-lock-timeout: tabla nueva, nadie la lee todavía\nCREATE TABLE t (id int);').ok).toBe(true);
    expect(revisar('-- sin-lock-timeout:\nCREATE TABLE t (id int);').ok).toBe(false);
  });
});

describe('auth por fila', () => {
  it('acusa auth_*() a secas en USING', () => {
    const r = revisar(LOCK + "CREATE POLICY p ON t FOR SELECT TO authenticated USING (auth_has_module_permission('x','can_view'));");
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/SELECT/);
  });
  it('acusa auth.uid() a secas en WITH CHECK', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());').ok).toBe(false);
  });
  it('acusa auth dentro de un EXISTS correlacionable', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM e WHERE e.id = t.emp AND e.uid = auth.uid()));').ok).toBe(false);
  });
  it('acepta el wrapper (SELECT …)', () => {
    expect(revisar(LOCK + "CREATE POLICY p ON t FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('x','can_view')));").ok).toBe(true);
  });
  it('acepta (SELECT EXISTS (… auth_x() …)) — el caso que la primera versión acusó mal', () => {
    expect(revisar(LOCK + "CREATE POLICY p ON t FOR SELECT TO authenticated USING ((SELECT EXISTS (SELECT 1 FROM unnest(ARRAY['a']) m WHERE public.auth_has_module_permission(m, 'can_view'))));").ok).toBe(true);
  });
});

describe('SECURITY DEFINER sin search_path', () => {
  it('lo acusa', () => {
    const r = revisar(LOCK + 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;');
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/search_path/);
  });
  it('acepta SET search_path', () => {
    expect(revisar(LOCK + 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$ SELECT 1 $$;').ok).toBe(true);
  });
  it('acepta un ALTER FUNCTION … SET search_path en el mismo archivo', () => {
    expect(revisar(LOCK + 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;\nALTER FUNCTION public.f() SET search_path = public;').ok).toBe(true);
  });
});

describe('jsonb_agg en payload json', () => {
  it('lo acusa en RETURNS jsonb', () => {
    const r = revisar(LOCK + 'CREATE FUNCTION f() RETURNS jsonb LANGUAGE sql SET search_path = public AS $$ SELECT jsonb_agg(t) FROM t $$;');
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/jsonb_agg/);
  });
  it('acepta json_agg(to_json(t)) con RETURNS json', () => {
    expect(revisar(LOCK + "CREATE FUNCTION f() RETURNS json LANGUAGE sql SET search_path = public AS $$ SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM t $$;").ok).toBe(true);
  });
  it('no mira funciones que devuelven otra cosa', () => {
    expect(revisar(LOCK + 'CREATE FUNCTION f() RETURNS SETOF t LANGUAGE sql SET search_path = public AS $$ SELECT jsonb_agg(x) FROM t $$;').ok).toBe(true);
  });
  it('respeta el escape', () => {
    expect(revisar(LOCK + '-- jsonb-agg: a lo sumo 7 filas, una por sucursal\nCREATE FUNCTION f() RETURNS jsonb LANGUAGE sql SET search_path = public AS $$ SELECT jsonb_agg(t) FROM t $$;').ok).toBe(true);
  });
});

describe('policy de escritura abierta', () => {
  it('acusa WITH CHECK (true) en INSERT', () => {
    const r = revisar(LOCK + 'CREATE POLICY p ON t FOR INSERT TO authenticated WITH CHECK (true);');
    expect(r.ok).toBe(false);
    expect(r.salida).toMatch(/WITH CHECK \(true\)/);
  });
  it('acusa USING (true) en UPDATE y DELETE', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR UPDATE TO authenticated USING (true);').ok).toBe(false);
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR DELETE TO authenticated USING ((true));').ok).toBe(false);
  });
  it('acusa FOR ALL USING (true)', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t TO authenticated USING (true);').ok).toBe(false);
  });
  it('acepta USING (true) en SELECT', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR SELECT TO authenticated USING (true);').ok).toBe(true);
  });
  it('acepta TO service_role', () => {
    expect(revisar(LOCK + 'CREATE POLICY p ON t FOR ALL TO service_role USING (true) WITH CHECK (true);').ok).toBe(true);
  });
});

describe('el corte', () => {
  it('el gate completo sigue en verde sobre la historia', () => {
    expect(() => execFileSync('node', [GATE], { cwd: RAIZ, encoding: 'utf8' })).not.toThrow();
  });
});
