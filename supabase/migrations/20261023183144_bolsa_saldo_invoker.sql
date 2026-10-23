-- `bolsa_saldo` era SECURITY DEFINER sin guarda: cualquiera con sesión leía el
-- saldo de cualquier bolsa por id. Pasa a INVOKER: la policy de movimientos es
-- «la bolsa es visible», así que quien ve una bolsa obtiene el mismo saldo y
-- quien no la ve recibe NULL. Sus otros 10 llamadores son DEFINER (corren como
-- su dueño) y no cambian. Medido en prod (2026-10-23, 14 cargos simulados):
-- mismo conjunto y mismo md5 id:saldo antes y después.
SET lock_timeout = '5s';
ALTER FUNCTION public.bolsa_saldo(bigint) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.bolsa_saldo(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bolsa_saldo(bigint) TO authenticated, service_role;
