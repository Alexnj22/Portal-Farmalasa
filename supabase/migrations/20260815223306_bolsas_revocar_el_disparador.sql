-- El disparador de la bolsa no tiene por que ser una RPC.
--
-- `crear_bolsa_al_confirmar()` quedo ejecutable por `anon` y por `authenticated`
-- —o sea, expuesto en `/rest/v1/rpc/`— porque al crearlo no se le hizo el REVOKE
-- que la regla 4 de CLAUDE.md exige para TODA funcion. Lo levanto el advisor de
-- seguridad, y rompia el invariante del proyecto: «ninguna otra funcion es
-- ejecutable por anon» fuera de las cinco del kiosco.
--
-- El riesgo real era bajo —devuelve `trigger`, asi que una llamada por REST
-- falla con «trigger functions can only be called as triggers»— pero la regla no
-- distingue, y una funcion DEFINER colgada de la API publica no se deja ahi
-- porque hoy no se pueda llamar.
--
-- Postgres NO comprueba el permiso EXECUTE al disparar un trigger: revocar no lo
-- apaga. Verificado en el branch de staging con una transaccion revertida —
-- despues del REVOKE, confirmar un corte siguio creando su bolsa (S3-1010 por
-- 123.45).

SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.crear_bolsa_al_confirmar() FROM PUBLIC, anon, authenticated;

-- `nuevo_folio_de_bolsa` tampoco: consume un valor de la secuencia cada vez que
-- se la llama, asi que expuesta deja que cualquiera queme folios. Solo la usan
-- el disparador y `cerrar_bolsa_de_corte`, las dos DEFINER.
REVOKE EXECUTE ON FUNCTION public.nuevo_folio_de_bolsa(bigint) FROM PUBLIC, anon, authenticated;
