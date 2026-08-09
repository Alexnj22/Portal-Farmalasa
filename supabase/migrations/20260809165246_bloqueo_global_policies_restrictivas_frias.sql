SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El bloqueo corta POR PETICIÓN, en toda la superficie RLS.
--
-- Al medir el alcance apareció algo más grande que la función pedida: de las 252
-- policies de `public`, **83 no preguntan nada** — ni permiso ni identidad—, y
-- entre ellas están `customers` (fichas con DUI y teléfonos),
-- `employee_documents`, `employee_events`, `timesheets`, `payroll_periods`,
-- `branch_expenses`, `survey_responses` y `audit_logs`. O sea que cualquier
-- persona autenticada podía leer todo eso. El bloqueo no habría cortado ahí.
--
-- ── Por qué RESTRICTIVE y no reescribir las policies ────────────────────────
-- Una policy RESTRICTIVE se combina con AND contra todo lo demás, así que
-- **no hay que tocar ni una sola policy existente**: se agrega una por tabla y
-- el freno aplica a todo — SELECT, INSERT, UPDATE y DELETE. Reescribir 83
-- policies habría sido cambiarles la semántica una por una, con el riesgo que
-- eso trae, para el mismo resultado.
--
-- Sin `WITH CHECK`, Postgres usa la expresión de `USING` también para el INSERT
-- (documentado en CREATE POLICY), así que `FOR ALL` queda cubierto entero.
--
-- ── El `(SELECT …)` no es decorativo ────────────────────────────────────────
-- Es la regla del incidente del 2026-07-08: sin el envoltorio, Postgres evalúa
-- la función POR FILA. Verificado en staging con EXPLAIN — el plan dice
-- `InitPlan 1`, o sea una sola evaluación por consulta.
--
-- ── Esta migración deja fuera las tablas calientes ──────────────────────────
-- `sales_invoices`, `sales_invoice_items`, `inventory`, `products` y
-- `product_stock_params` reciben escrituras de los crons cada minuto, y
-- CREATE POLICY sobre ellas necesita ACCESS EXCLUSIVE — fue exactamente la causa
-- del outage del 2026-07-08. Van en su propia migración, para que un lock
-- timeout ahí no obligue a repetir estas 130.
--
-- Ensayado en staging: el bloqueado lee CERO de roles, branches, employees y
-- customers; el no bloqueado lee normal.
-- ════════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND c.relname <> ALL (ARRAY['sales_invoices','sales_invoice_items','inventory','products','product_stock_params'])
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS bloqueo_global ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY bloqueo_global ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()))',
      t.relname);
  END LOOP;
END
$do$;
