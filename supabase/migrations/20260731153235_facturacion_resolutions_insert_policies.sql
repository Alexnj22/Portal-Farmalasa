SET lock_timeout = '5s';

-- Las tres tablas de resoluciones de Facturación tenían RLS activo con UNA sola
-- policy, de SELECT. Sin policy de INSERT, Postgres rechazaba toda escritura del
-- cliente: los cuatro botones "Solventar" de FacturacionView no escribían nada
-- desde mayo, y dos de los cuatro handlers ni miraban el error (auditaban igual).
--
-- Append-only a propósito: NO se agregan policies de UPDATE ni DELETE. El botón
-- de "cancelar" de la vista solo cierra el formulario, nunca borra la resolución.
--
-- `(SELECT auth_can_edit_any(...))` va envuelto en initplan a propósito (regla 3
-- de CLAUDE.md, incidente 2026-07-08): sin el wrapper Postgres evalúa la función
-- por fila.

CREATE POLICY sales_invoice_resolutions_insert ON public.sales_invoice_resolutions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['facturacion'])));

CREATE POLICY sales_gap_resolutions_insert ON public.sales_gap_resolutions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['facturacion'])));

CREATE POLICY sales_null_resolutions_insert ON public.sales_null_resolutions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['facturacion'])));

-- `anon` no tiene policy, así que hoy el RLS ya lo frena; pero conserva los
-- grants ALL que dejó el baseline sin ACLs. Se los quitamos para que el bloqueo
-- no dependa solo de la ausencia de una policy.
REVOKE ALL ON public.sales_invoice_resolutions FROM anon;
REVOKE ALL ON public.sales_gap_resolutions     FROM anon;
REVOKE ALL ON public.sales_null_resolutions    FROM anon;
