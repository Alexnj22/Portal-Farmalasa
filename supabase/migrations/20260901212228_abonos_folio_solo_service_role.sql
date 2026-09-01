SET lock_timeout = '5s';

-- `siguiente_folio_de_abono` NO es para el navegador: la llama la edge function
-- con `service_role`, después de que el dinero entró de verdad a la caja. El
-- REVOKE de su migración le quitaba el EXECUTE a PUBLIC y a anon, y eso NO
-- alcanza — Supabase se lo concede a `authenticated` aparte, así que cualquier
-- sesión del portal podía quemar folios de la secuencia con una llamada suelta.
-- No es un agujero de datos (la fila la escribe la function igual), pero deja
-- huecos en la serie de un comprobante, y un correlativo con huecos es
-- exactamente lo que nadie puede explicar después.
REVOKE EXECUTE ON FUNCTION public.siguiente_folio_de_abono(integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siguiente_folio_de_abono(integer) TO service_role;
