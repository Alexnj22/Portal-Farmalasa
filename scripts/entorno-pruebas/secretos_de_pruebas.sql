-- Los secretos de la bóveda que el portal necesita para funcionar en pruebas.
--
-- La bóveda del branch nace VACÍA: los secretos no viajan con las migraciones.
-- Sin `kiosk_auth_pepper`, `get_kiosk_auth_code` lanza KIOSK_PEPPER_MISSING y
-- cada pantalla del portal que muestra el código del kiosco recibía un 400 al
-- entrar (medido el 2026-10-21 con la cuenta de pruebas). En producción la
-- misma función contesta 200.
--
-- El valor se genera ACÁ, al azar: nunca se copia el de producción. Con el de
-- producción, un código calculado en pruebas valdría en un kiosco real.
--
-- No se agregan los secretos que llaman a producción (`admin_invoke_secret` y
-- compañía): su ausencia es justamente la guarda que deja mudos a los crons del
-- branch (ver CLAUDE.md, «Entorno de pruebas»).
--
-- Lo corre `mantener_al_dia.mjs` en cada vuelta. Es idempotente.
DO $$
BEGIN
  -- Mismo freno que `sembrar_datos_de_prueba.sql`: no por fichas de empleado,
  -- que la siembra ya sube a más de diez.
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE username = 'pruebas') THEN
    RAISE EXCEPTION 'Sólo en el branch de pruebas: no se encontró la cuenta `pruebas`.';
  END IF;
  IF (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'Esta base parece PRODUCCIÓN. Abortado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'kiosk_auth_pepper') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'kiosk_auth_pepper',
      'Sólo del entorno de pruebas: generado al azar, no es el de producción.');
  END IF;
END $$;
