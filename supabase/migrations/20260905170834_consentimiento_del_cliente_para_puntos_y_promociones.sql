SET lock_timeout = '5s';

-- ── El cliente decide, y la Empresa decide: son dos decisiones ───────────────
-- `acumula_puntos = false` ya existía y quiere decir «esta ficha no acumula».
-- Hasta hoy la única razón era de la Empresa: MAPFRE, un convenio, una ficha
-- que no es una persona que vaya a llegar a canjear. Y `sync-puntos` barre esos
-- tickets y los BORRA del sistema de puntos, porque una exclusión que sólo vale
-- hacia adelante deja el pasado contradiciendo la regla.
--
-- Ahora entra una segunda razón, la del propio cliente, y el barrido no puede
-- alcanzarla: si alguien declina desde `/mis-puntos` y eso le borra los tickets
-- pendientes, un toque en un teléfono destruye un saldo sin vuelta atrás. La
-- decisión tiene que ser reversible, porque esa puerta se abre con DUI y
-- teléfono, que —dice su propio encabezado— los sabe la familia y salen en
-- papeles.
--
-- Por eso la columna nueva no reemplaza a la vieja: la CALIFICA.
--
--   acumula_puntos = false, acepta_programa_puntos IS NULL   → convenio: se retiran
--   acumula_puntos = false, acepta_programa_puntos = false    → el cliente: congelado
--
-- El saldo queda donde está, sin acumular y sin canjear, hasta que vuelva a
-- entrar y acepte.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS acepta_programa_puntos boolean,
  ADD COLUMN IF NOT EXISTS acepta_promociones     boolean;

COMMENT ON COLUMN public.customers.acepta_programa_puntos IS
  'Decisión del CLIENTE sobre el programa de puntos (Art. 27 LPDP). NULL = nunca se le preguntó; false = declinó y su saldo queda congelado, no retirado. No confundir con acumula_puntos, que es la decisión de la Empresa.';
COMMENT ON COLUMN public.customers.acepta_promociones IS
  'Decisión del CLIENTE sobre recibir promociones y descuentos (Art. 27 LPDP). NULL = nunca se le preguntó. Finalidad distinta a la del programa de puntos, por eso columna aparte: el Art. 27 letra b) exige un consentimiento por finalidad.';


-- ── La prueba, que es lo que pide el Art. 54 ────────────────────────────────
-- «Para efectos de demostrar la obtención del consentimiento … la carga de la
-- prueba recaerá específicamente en el responsable.» Un booleano en `true` no
-- demuestra nada: no dice cuándo, ni qué leyó la persona, ni cómo se identificó.
--
-- Por eso cada respuesta deja una fila, y las filas no se borran ni se editan.
-- Revocar es una fila nueva que dice `otorgado = false`, nunca un UPDATE sobre
-- la anterior: el historial ES la prueba, y una prueba que se puede reescribir
-- no es una prueba.
CREATE TABLE IF NOT EXISTS public.consentimientos_cliente (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    finalidad    text NOT NULL CHECK (finalidad IN ('programa_puntos', 'promociones')),
    otorgado     boolean NOT NULL,
    -- El texto EXACTO que la persona tenía delante al responder. Si mañana se
    -- reescribe la pantalla, esta fila sigue diciendo qué se aceptó aquel día;
    -- sin él, el Art. 27 letra c) («informado») no se puede sostener.
    texto        text NOT NULL,
    version_aviso text,
    -- Ni el DUI ni el teléfono: sólo CÓMO se identificó. Un registro que archiva
    -- documentos de identidad es una filtración esperando, y la edge function de
    -- puntos ya tomó esa misma decisión con la huella de sus intentos.
    identificado_por text NOT NULL CHECK (identificado_por IN ('codigo', 'dui_telefono', 'sala_de_ventas')),
    origen       text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consentimientos_cliente_customer_idx
    ON public.consentimientos_cliente (customer_id, finalidad, created_at DESC);

ALTER TABLE public.consentimientos_cliente ENABLE ROW LEVEL SECURITY;

-- Lo lee quien atiende las solicitudes de datos personales: es la evidencia que
-- hay que poder mostrar cuando alguien pregunta qué se guarda de él. Nadie
-- escribe desde el navegador — la fila la pone la función de más abajo.
DROP POLICY IF EXISTS consentimientos_cliente_select ON public.consentimientos_cliente;
CREATE POLICY consentimientos_cliente_select ON public.consentimientos_cliente
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('datos_personales', 'can_view')));


-- ── Guardar la respuesta ────────────────────────────────────────────────────
-- DEFINER y sólo para `service_role`: la llama la edge function `mis-puntos`
-- con su cliente administrador, ya después de haber verificado la identidad y
-- de haber pasado el freno por IP. El navegador nunca la alcanza.
--
-- Cada parámetro de respuesta admite NULL, que significa «no me estás
-- contestando esto». Así una pantalla puede preguntar por las dos finalidades o
-- por una sola, y la que no vino no se toca ni deja fila.
CREATE OR REPLACE FUNCTION public.puntos_guardar_consentimiento(
    p_customer_id      bigint,
    p_programa         boolean DEFAULT NULL,
    p_promociones      boolean DEFAULT NULL,
    p_texto_programa   text    DEFAULT NULL,
    p_texto_promos     text    DEFAULT NULL,
    p_version_aviso    text    DEFAULT NULL,
    p_identificado_por text    DEFAULT 'dui_telefono',
    p_origen           text    DEFAULT 'mis-puntos')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE v_fila public.customers%ROWTYPE;
BEGIN
    IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'FALTA_FICHA' USING errcode = '22023';
    END IF;
    IF p_programa IS NULL AND p_promociones IS NULL THEN
        RAISE EXCEPTION 'SIN_RESPUESTA' USING errcode = '22023';
    END IF;

    -- La prueba primero. Si algo falla después, la fila de evidencia no queda
    -- sola: las dos escrituras están en la misma transacción.
    IF p_programa IS NOT NULL THEN
        INSERT INTO public.consentimientos_cliente
               (customer_id, finalidad, otorgado, texto, version_aviso, identificado_por, origen)
        VALUES (p_customer_id, 'programa_puntos', p_programa,
                coalesce(p_texto_programa, '(sin texto registrado)'),
                p_version_aviso, p_identificado_por, p_origen);
    END IF;

    IF p_promociones IS NOT NULL THEN
        INSERT INTO public.consentimientos_cliente
               (customer_id, finalidad, otorgado, texto, version_aviso, identificado_por, origen)
        VALUES (p_customer_id, 'promociones', p_promociones,
                coalesce(p_texto_promos, '(sin texto registrado)'),
                p_version_aviso, p_identificado_por, p_origen);
    END IF;

    UPDATE public.customers c SET
        acepta_programa_puntos = coalesce(p_programa,    c.acepta_programa_puntos),
        acepta_promociones     = coalesce(p_promociones, c.acepta_promociones),
        acumula_puntos = CASE
            WHEN p_programa IS NULL      THEN c.acumula_puntos
            WHEN p_programa = false      THEN false
            -- Aceptar reactiva SÓLO lo que el propio cliente había apagado.
            -- Una ficha excluida por la Empresa (un convenio) no se enciende
            -- porque alguien conteste que sí: esa decisión no era suya.
            WHEN c.acepta_programa_puntos = false THEN true
            ELSE c.acumula_puntos
        END
    WHERE c.id = p_customer_id
    RETURNING c.* INTO v_fila;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FICHA_NO_EXISTE' USING errcode = '22023';
    END IF;

    RETURN json_build_object(
        'acepta_programa_puntos', v_fila.acepta_programa_puntos,
        'acepta_promociones',     v_fila.acepta_promociones,
        'acumula_puntos',         v_fila.acumula_puntos);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_guardar_consentimiento(bigint, boolean, boolean, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_guardar_consentimiento(bigint, boolean, boolean, text, text, text, text, text) TO service_role;


-- ── El barrido deja de alcanzar al que declinó ──────────────────────────────
-- Único cambio: `acepta_programa_puntos IS DISTINCT FROM false`. Sin esa línea
-- todo lo de arriba es decorado — la corrida siguiente de `sync-puntos` le
-- borraría los tickets pendientes al cliente que declinó, y «congelado» sería
-- mentira. `IS DISTINCT FROM` y no `<>` porque el caso normal es NULL.
CREATE OR REPLACE FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(p_tope integer DEFAULT 500)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $fn$
DECLARE v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT pe.invoice_id, pe.sucursal, pe.erp_invoice_id, pe.correlativo,
           pe.cliente, pe.total, pe.fecha, pe.aplicado
    FROM public.puntos_enviados pe
    JOIN public.sales_invoices si ON si.id = pe.invoice_id
    JOIN public.customers      cu ON cu.id = si.customer_id
    WHERE cu.acumula_puntos = false
      AND cu.acepta_programa_puntos IS DISTINCT FROM false
      AND pe.reversion IS NULL
      AND pe.aplicado IS NOT NULL      -- se llegó a enviar; lo que nunca salió no hay que retirarlo
    ORDER BY pe.fecha, pe.invoice_id
    LIMIT p_tope
  ) t;
  RETURN v;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(integer) TO service_role;
