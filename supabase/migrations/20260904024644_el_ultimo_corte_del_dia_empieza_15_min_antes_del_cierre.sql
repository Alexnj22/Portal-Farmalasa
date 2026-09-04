SET lock_timeout = '5s';

-- ── EL ÚLTIMO CORTE DEL DÍA EMPIEZA ANTES DE LA HORA DE CIERRE ─────────────
--
-- Regla del usuario (3-sep): «si hacen corte 15 min antes del cierre y lo
-- confirman, no pide a quién entrega».
--
-- La condición era `hora >= cierre`, o sea el instante exacto. Y nadie corta a
-- las 21:00 en punto: se corta un rato antes, mientras se cuenta el efectivo y
-- se cierra la sala. Con el corte de las 20:50, el portal pedía una firma de
-- entrega que ya no tiene a quién nombrar —no queda nadie a quien entregarle la
-- caja— y la salida era declarar «no hay quien reciba», que ensucia el registro
-- con un motivo escrito para un caso que no es una excepción sino lo normal.
--
-- ── POR QUÉ NO SE LE AGREGA UN PARÁMETRO ──────────────────────────────────
-- El margen va DENTRO y la firma no se toca. Agregarlo como parámetro con
-- default crearía una SOBRECARGA —la de dos argumentos seguiría existiendo— y
-- el llamador del navegador manda uno solo: quedaría resolviendo a la vieja sin
-- que nada avise. Es lo que ya costó `update_proveedor_manual`, que tiene dos
-- firmas y la revocación de permisos alcanzó a una sola.
--
-- ── Y SIGUE SIENDO UN SOLO JUEZ ───────────────────────────────────────────
-- La pantalla y el servidor le preguntan a ESTA función, no cada uno a su
-- cuenta. Por eso el margen se cambia acá y en ningún otro lado: calculado en
-- los dos lados, un día la pantalla no pide la firma y el servidor anota que
-- nadie recibió.
--
-- El nombre se queda: lo que se le pregunta es «¿es este el último corte del
-- día?», y la respuesta ahora incluye los últimos 15 minutos de la jornada.
--
-- Medido al aplicarla, con Salud 4 (cierra 21:00): a las 20:44 todavía pregunta,
-- a las 20:45 ya no; Salud 1 (cierra 22:00) a las 20:46 sigue preguntando.
CREATE OR REPLACE FUNCTION public.sala_ya_cerro(
    p_branch  bigint,
    p_momento timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Cuánto antes del cierre ya cuenta como el último corte del día.
    c_margen constant interval := interval '15 minutes';
    v_local  timestamp;
    v_dia    jsonb;
    v_abre   text;
    v_cierra text;
BEGIN
    -- La sala vive en hora de El Salvador; `now()` viene en UTC.
    v_local := p_momento AT TIME ZONE 'America/El_Salvador';

    SELECT b.weekly_hours -> (extract(dow from v_local)::int::text)
      INTO v_dia
      FROM public.branches b
     WHERE b.id = p_branch;

    IF v_dia IS NULL THEN RETURN NULL; END IF;

    -- Una sala marcada cerrada hoy que igual cortó es una contradiccion del
    -- dato, no una respuesta: no se contesta.
    IF coalesce((v_dia->>'isOpen')::boolean, false) IS NOT TRUE THEN RETURN NULL; END IF;

    v_abre   := substring(btrim(coalesce(v_dia->>'start','')) from '^[0-9]{1,2}:[0-9]{2}');
    v_cierra := substring(btrim(coalesce(v_dia->>'end',''))   from '^[0-9]{1,2}:[0-9]{2}');
    IF v_abre IS NULL OR v_cierra IS NULL THEN RETURN NULL; END IF;

    v_abre   := lpad(v_abre, 5, '0');
    v_cierra := lpad(v_cierra, 5, '0');

    -- Cierra antes de abrir = cruza la medianoche. No se adivina.
    IF v_cierra <= v_abre THEN RETURN NULL; END IF;

    -- La comparación pasa a ser de INSTANTES y no de texto: restarle 15 minutos
    -- a «21:00» como cadena no se puede, y hacerlo a mano cruzando la hora
    -- («19:05» − 15 min) es de las cuentas que se escriben mal una vez y no se
    -- vuelven a mirar.
    RETURN v_local >= (v_local::date + v_cierra::time - c_margen);
END $function$;

REVOKE EXECUTE ON FUNCTION public.sala_ya_cerro(bigint, timestamp with time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sala_ya_cerro(bigint, timestamp with time zone) TO authenticated, service_role;
