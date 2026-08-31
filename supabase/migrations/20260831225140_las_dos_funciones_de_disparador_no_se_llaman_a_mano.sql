-- El advisor lista DIECINUEVE funciones ejecutables por `anon`; el manifiesto
-- de `auditoria/superficie-anon.json` declara DIECISIETE. La diferencia son
-- éstas dos, y no son puertas: una devuelve `trigger` y la otra `event_trigger`.
--
-- Llamarlas por `/rest/v1/rpc/...` no hace nada — sin `NEW` ni contexto de
-- disparador, PostgreSQL las rechaza— así que no había un agujero. Lo que había
-- era un GRANT que nadie decidió: son los permisos por defecto que Supabase le
-- pone a toda función nueva del esquema público.
--
-- Se revocan por la misma razón que se revocó la escritura de `branches`: un
-- permiso que nadie necesita no debería estar puesto, y así el advisor deja de
-- listar dos avisos que hay que descartar a mano cada vez.
--
-- Los disparadores siguen funcionando: Postgres comprueba el EXECUTE al CREAR
-- el disparador, no al dispararlo. `frenar_ajuste_si_hay_conteo_abierto` tiene
-- uno activo sobre `approval_requests` —verificado después: sigue habilitado— y
-- la de `event_trigger` no pasa por GRANT nunca.
SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.frenar_ajuste_si_hay_conteo_abierto()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.regrant_al_cambiar_employees_safe()
  FROM PUBLIC, anon, authenticated;
