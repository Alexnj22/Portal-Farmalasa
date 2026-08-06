-- `approval_requests` llevaba DOS CHECK idénticos sobre `status`:
--
--   approval_requests_status_check   ← el original, nace con la tabla
--   chk_approval_requests_status     ← agregado por
--                                      migrations-legacy/20260517_db_audit_cleanup_v2_constraints.sql
--
-- Una auditoría de constraints que agregó la que ya estaba. Los dos evalúan la
-- misma expresión en cada INSERT y UPDATE, así que el duplicado no protege de
-- nada: solo cuesta y confunde a quien lee el catálogo.
--
-- Se conserva el del baseline, que es el que nombra el esquema de referencia.
SET lock_timeout = '5s';

ALTER TABLE public.approval_requests
    DROP CONSTRAINT IF EXISTS chk_approval_requests_status;
