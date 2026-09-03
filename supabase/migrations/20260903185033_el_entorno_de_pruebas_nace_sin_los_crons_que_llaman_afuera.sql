-- El entorno de pruebas nace SIN los crons que llaman afuera.
--
-- ── El defecto que cierra ───────────────────────────────────────────────────
-- Medido el 2026-09-03 en los registros de producción: **1,258 llamadas con
-- 401 en un solo día** a `sync-cortes-caja`, más 111 a `push-cliente-erp` y
-- una decena repartida. Ninguna venía del portal.
--
-- Venían del BRANCH DE PRUEBAS. La firma que lo delató está en el `user_agent`:
-- producción corre `pg_net/0.20.0` y contesta 200; el que recibía 401 llegaba
-- con `pg_net/0.20.4`, que es la versión del branch (verificado en las dos
-- bases).
--
-- El motivo es estructural y vuelve solo: los crons se crean POR MIGRACIÓN y
-- la URL de producción está escrita adentro. Al rehacer el branch —ya van
-- tres veces— las migraciones se replican enteras y nacen 13 crons apuntando
-- al proyecto real, disparando con la llave del branch. Producción los rechaza
-- con 401, así que **nunca hicieron daño**; el costo es otro: ~1,400
-- peticiones basura por día enterrando en el registro justo la señal que
-- `gate:eficiencia` busca, porque un 401 legítimo —un redeploy sin
-- `--no-verify-jwt`, que ya pasó tres veces— se lee igual que estos mil.
--
-- ── Por qué el 401, y por qué eso mismo es la guarda ────────────────────────
-- El branch NO tiene ni un secreto en su vault (medido: la vista vuelve
-- vacía). El cron arma `'Bearer ' || (SELECT decrypted_secret ...)`, y con el
-- secreto ausente esa concatenación es NULL: la petición sale sin credencial.
--
-- O sea que la pregunta «¿esta base puede llamar afuera?» ya tiene una
-- respuesta exacta en la base misma, y no hace falta adivinar el entorno ni
-- escribir el ref de producción en ningún lado: **si no está la llave, esos
-- crons no pueden servir para nada acá**. Un cron nuevo que alguien agregue
-- mañana queda cubierto por la misma regla, sin tocar este archivo.
--
-- ── Dos condiciones, no una, y a propósito ─────────────────────────────────
-- Apagar los crons de producción por error deja el portal sin sincronizar y
-- nadie se entera hasta que falta un dato. Por eso hacen falta LAS DOS:
--
--   1. que no exista `admin_invoke_secret` en el vault, y
--   2. que la base tenga como mucho 2 fichas de empleado.
--
-- Medido hoy en producción: el secreto existe y hay **48 fichas**; en el
-- branch recién sembrado hay **una** (la cuenta de pruebas) y el vault está
-- vacío. Cualquiera de las dos alcanzaría; las dos juntas hacen falta el día
-- que una cambie por un motivo que nadie previó. Y si no se puede mirar el
-- vault, NO SE TOCA NADA: la falla segura es dejar los crons como están.
--
-- Es no-op en producción por construcción, no por suerte — la primera
-- condición corta antes de mirar un solo cron.
--
-- Los 17 crons que trabajan contra su propia base (purgas, refrescos, VACUUM)
-- no se tocan: ésos sí sirven en el branch.

--
-- Probado en el branch con `execute_sql` antes de aplicarlo acá: se volvió a
-- encender `cortes-caja-30s` a mano, corrió el bloque y quedó apagado otra vez
-- (13 apagados / 17 activos, los mismos de antes).

SET lock_timeout = '5s';

DO $$
DECLARE
    v_hay_llave boolean;
    v_fichas    bigint;
    v_apagados  bigint;
BEGIN
    IF to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE NOTICE 'crons: no se puede leer el vault — no se toca ninguno (falla segura).';
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
         WHERE name = 'admin_invoke_secret'
           AND coalesce(length(decrypted_secret), 0) > 20
    ) INTO v_hay_llave;

    IF v_hay_llave THEN
        RAISE NOTICE 'crons: esta base tiene la llave para llamar afuera — se quedan como están.';
        RETURN;
    END IF;

    SELECT count(*) INTO v_fichas FROM public.employees;
    IF v_fichas > 2 THEN
        RAISE NOTICE 'crons: sin llave pero con % fichas — no parece un entorno de pruebas, no se toca ninguno.', v_fichas;
        RETURN;
    END IF;

    SELECT count(*) INTO v_apagados FROM (
        SELECT cron.alter_job(jobid, active := false)
          FROM cron.job
         WHERE active AND command ILIKE '%net.http_post%'
    ) t;

    RAISE NOTICE 'crons: sin llave y % ficha(s) — apagados % cron(s) que llaman afuera.', v_fichas, v_apagados;
END $$;
