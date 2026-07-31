SET lock_timeout = '5s';

-- `CREATE TABLE` deja los default privileges del esquema, que dan ALL a
-- `authenticated` — un GRANT SELECT, INSERT posterior NO los quita (suma).
-- Quedaban UPDATE, DELETE, TRUNCATE, REFERENCES y TRIGGER: RLS tapa UPDATE y
-- DELETE (no hay policy), pero TRUNCATE **no pasa por RLS**, así que cualquier
-- usuario autenticado podía vaciar la tabla. Se revoca y se vuelve a otorgar
-- solo lo que la app usa. Ver memoria "un baseline sin ACLs reabre el agujero".
REVOKE ALL ON public.sales_observation_resolutions FROM authenticated;
GRANT SELECT, INSERT ON public.sales_observation_resolutions TO authenticated;
