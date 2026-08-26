SET lock_timeout = '5s';

-- ── El depósito dice A QUÉ BANCO va, y el Gerente General se entera ────────
--
-- «al darle en depositar al banco, que llegue una notificación al gerente
-- general con: el monto a depositar, quien y a que banco. el remanente que le
-- queda.» (usuario, 2026-08-26).
--
-- El aviso pide cuatro datos y el depósito sólo guardaba tres: el monto, quién
-- lo lleva y el remanente ya estaban desde v2.739.0 y v2.769.0. **El banco no
-- existía como dato en ninguna parte** — ni columna, ni catálogo, ni campo en
-- la pantalla. O sea que el aviso no se podía escribir sin agregarlo primero,
-- y de paso el archivo de depósitos tampoco podía contestar «¿a cuál banco fue
-- la plata del martes?».
--
-- ── Por qué un catálogo y no un campo de texto ─────────────────────────────
-- Es la regla «una lista de opciones que existe como tabla NO se escribe a
-- mano» de CLAUDE.md, aplicada antes de que exista la lista a mano: escrito
-- libre, el mismo banco termina como «davivienda», «Davivienda» y «BANCO
-- DAVIVIENDA», y sumar por banco deja de ser posible sin adivinar.
--
-- Los tres son los que dijo el usuario, con el nombre de la institución
-- estandarizado («que me acuerde esta el Davivienda, Atlantida y BAC como
-- opciones. estandariza esos 3 nombres como instituciones»).
--
-- ⚠ El `nombre` ES la clave que se muestra: no hay columna de código, así que
-- cambiar un rótulo es cambiar el dato. Agregar un banco es una fila más, y
-- retirarlo es `activo = false` — nunca un DELETE, porque los depósitos viejos
-- lo apuntan.
CREATE TABLE IF NOT EXISTS public.bancos (
    id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre     text     NOT NULL UNIQUE,
    orden      smallint NOT NULL DEFAULT 100,
    activo     boolean  NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bancos ENABLE ROW LEVEL SECURITY;

-- El mismo par que sus dos tablas hermanas (`bolsas_tipos_salida`,
-- `bolsas_entidades`): el bloqueo global RESTRICTIVO y una sola policy de
-- lectura. Sin policy de escritura a propósito — el catálogo se edita por
-- migración, y quien lo escribiera desde el navegador estaría renombrando el
-- banco de depósitos ya cerrados.
CREATE POLICY bloqueo_global ON public.bancos AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));
CREATE POLICY bancos_select ON public.bancos FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('bolsas', 'can_view')));

INSERT INTO public.bancos (nombre, orden) VALUES
    ('Banco Davivienda', 10),
    ('Banco Atlántida',  20),
    ('BAC Credomatic',   30)
ON CONFLICT (nombre) DO NOTHING;

-- ⚠ Y de paso, el vecino que estaba abierto. `bolsas_entidades` es la ÚNICA de
-- las 161 tablas cuyo `bloqueo_global` quedó PERMISIVO (medido hoy: 160
-- restrictivas, 1 permisiva). Una policy permisiva `FOR ALL` no bloquea nada:
-- se suma con OR a las demás, así que cualquier sesión no bloqueada podía
-- INSERT/UPDATE/DELETE el catálogo de remesadoras. Nadie escribe ahí desde el
-- portal —`fetchEntidadesDeSalida` sólo lee—, así que volverla restrictiva no
-- le quita nada a nadie.
DROP POLICY IF EXISTS bloqueo_global ON public.bolsas_entidades;
CREATE POLICY bloqueo_global ON public.bolsas_entidades AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

-- El banco del depósito. Con índice porque es una FK que se va a filtrar («todo
-- lo que fue a Davivienda este mes»), que es la regla 2 de CLAUDE.md — la
-- excepción de ahí es para columnas de puro audit (`*_por`), y ésta no lo es.
ALTER TABLE public.depositos_bancarios ADD COLUMN IF NOT EXISTS banco_id smallint
    REFERENCES public.bancos(id);
CREATE INDEX IF NOT EXISTS idx_depositos_bancarios_banco
    ON public.depositos_bancarios(banco_id);

COMMENT ON TABLE  public.bancos IS
    'Las instituciones a las que se lleva el efectivo. Se retiran con activo=false, nunca con DELETE: los depósitos viejos las apuntan.';
COMMENT ON COLUMN public.depositos_bancarios.banco_id IS
    'A qué banco se llevó. NULL en los depósitos anteriores al 2026-08-26, que se cerraron sin registrarlo.';

-- ── Cerrar el depósito ahora exige el banco, y avisa al Gerente General ─────
--
-- Dos cambios sobre la misma función:
--
-- 1. **El banco es obligatorio.** No tiene default ni «no sé»: un depósito sin
--    banco no se puede cuadrar contra ningún estado de cuenta, que es lo único
--    para lo que este registro existe.
-- 2. **El aviso sale de la BASE, no del navegador.** Es el mismo patrón que
--    `confirmar_conteo`: quien cierra el depósito no puede olvidarse de avisar,
--    ni puede avisar de un monto distinto del que se guardó. Si saliera del
--    `.jsx`, un aviso perdido sería indistinguible de un depósito no hecho.
--
-- El destinatario se resuelve por el CARGO —todos los Gerentes Generales
-- activos— y no por una lista de personas: una lista escrita a mano se queda
-- vieja el día que cambia quien ocupa el puesto, y ese día el efectivo se
-- movería sin que nadie se entere. `notify_employees` ya descarta al propio
-- actor, así que un Gerente General que cierra su propio depósito no se
-- autoavisa.
--
-- Va con `push = true`: es efectivo saliendo del portal y un remanente que le
-- van a poner en la mano. Es exactamente el tipo de evento que la regla de
-- ruido de `notify.js` deja pushear — se entera aunque no tenga el portal
-- abierto, que es el punto.
DROP FUNCTION IF EXISTS public.registrar_deposito_bancario(bigint[], numeric, numeric, text, uuid, text, uuid);

CREATE FUNCTION public.registrar_deposito_bancario(
    p_bolsa_ids bigint[],
    p_monto numeric,
    p_aporte numeric DEFAULT 0,
    p_aporte_nota text DEFAULT NULL,
    p_nota text DEFAULT NULL,
    p_llevado_por uuid DEFAULT NULL,
    p_banco_id smallint DEFAULT NULL)
RETURNS public.depositos_bancarios
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_yo        uuid := (SELECT auth_employee_id());
    v_hoy       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_contado   numeric;
    v_cuantas   integer;
    v_aporte    numeric := round(coalesce(p_aporte, 0), 2);
    v_remanente numeric;
    v_gerente   uuid;
    v_folio     text;
    v_banco     text;
    v_dep       public.depositos_bancarios;
    v_gerentes  uuid[];
    v_quien     text;
    v_cola      text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    PERFORM 1 FROM public.bolsas
      WHERE id = ANY(p_bolsa_ids) AND estado = 'CONTADA' AND deposito_id IS NULL
      FOR UPDATE;

    SELECT coalesce(sum(b.contado), 0), count(*)
      INTO v_contado, v_cuantas
      FROM public.bolsas b
     WHERE b.id = ANY(p_bolsa_ids)
       AND b.estado = 'CONTADA'
       AND b.deposito_id IS NULL;

    IF v_cuantas = 0 THEN
        RAISE EXCEPTION 'No hay bolsas contadas y sin depositar en esa lista.';
    END IF;
    IF v_cuantas <> coalesce(array_length(p_bolsa_ids, 1), 0) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya se depositó o dejó de estar contada. Vuelve a abrir la pantalla.';
    END IF;

    IF p_monto IS NULL OR p_monto <= 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto va al banco.';
    END IF;
    IF v_aporte > 0 AND nullif(btrim(coalesce(p_aporte_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Si entra dinero de afuera hay que decir de dónde salió.';
    END IF;

    -- El banco, resuelto contra el catálogo. Se lee el nombre aquí porque el
    -- aviso lo necesita escrito, y porque un id que no existe tiene que fallar
    -- antes de mover una sola bolsa.
    SELECT b.nombre INTO v_banco FROM public.bancos b
     WHERE b.id = p_banco_id AND b.activo;
    IF v_banco IS NULL THEN
        RAISE EXCEPTION 'Hay que decir a qué banco va el depósito. Si no ves ese campo, recarga la pantalla.';
    END IF;

    v_remanente := round(v_contado + v_aporte - p_monto, 2);
    IF v_remanente < 0 THEN
        RAISE EXCEPTION 'No alcanza: hay % y se quieren llevar %. Faltan %.',
            to_char(v_contado + v_aporte, 'FM999,999,990.00'),
            to_char(round(p_monto, 2), 'FM999,999,990.00'),
            to_char(abs(v_remanente), 'FM999,999,990.00');
    END IF;

    -- El Gerente General activo. Sólo hace falta si hay remanente que entregar.
    IF v_remanente >= 0.01 THEN
        SELECT e.id INTO v_gerente
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO'
         ORDER BY e.name
         LIMIT 1;
        IF v_gerente IS NULL THEN
            RAISE EXCEPTION 'El remanente se le entrega al Gerente General y no hay ninguno activo. Hay que asignar el cargo antes de cerrar el depósito.';
        END IF;
    END IF;

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota, monto_deposito, remanente,
        remanente_entregado_por, remanente_recibido_por, nota, cerrado_por, llevado_por,
        banco_id)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            round(p_monto, 2), v_remanente,
            CASE WHEN v_remanente >= 0.01 THEN v_yo END,
            CASE WHEN v_remanente >= 0.01 THEN v_gerente END,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo, p_llevado_por,
            p_banco_id)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, v_yo,
           'Depositada en el banco · ' || v_dep.folio || ' · ' || v_banco
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    -- ── El aviso ───────────────────────────────────────────────────────────
    --
    -- Quién: el que LLEVA el efectivo, que es el que lo tiene en la mano. Ese
    -- campo es opcional, y cuando no está no se calla — se dice quién cerró,
    -- que es el responsable de que el dinero salga.
    SELECT e.name INTO v_quien FROM public.employees e
     WHERE e.id = coalesce(p_llevado_por, v_yo);
    v_quien := CASE WHEN p_llevado_por IS NOT NULL
                    THEN 'lo lleva '  || coalesce(v_quien, 'alguien sin nombre en el padrón')
                    ELSE 'lo cerró '  || coalesce(v_quien, 'alguien sin nombre en el padrón') END;

    -- El remanente NOMBRA a quien se lo queda, en vez de decir «para ti»: si
    -- algún día hay dos Gerentes Generales activos, el aviso le llega a los dos
    -- y sólo uno recibe el efectivo.
    v_cola := CASE WHEN v_remanente >= 0.01
                   THEN 'Remanente de $' || to_char(v_remanente, 'FM999,999,990.00')
                        || ' para ' || coalesce((SELECT e.name FROM public.employees e WHERE e.id = v_gerente), 'el Gerente General') || '.'
                   ELSE 'Sin remanente.' END;

    SELECT array_agg(e.id ORDER BY e.name) INTO v_gerentes
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id
     WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO';

    IF v_gerentes IS NOT NULL THEN
        PERFORM public.notify_employees(
            v_gerentes,
            'DEPOSITO_BANCO',
            'Depósito al banco · $' || to_char(round(p_monto, 2), 'FM999,999,990.00'),
            v_dep.folio || ' · ' || v_banco || ' · ' || v_quien || '. ' || v_cola,
            '/bolsas?tab=finalizadas',
            jsonb_build_object(
                'deposito_id', v_dep.id,
                'folio',       v_dep.folio,
                'banco',       v_banco,
                'monto',       v_dep.monto_deposito,
                'remanente',   v_dep.remanente,
                'bolsas',      v_cuantas),
            true,
            NULL
        );
    END IF;

    RETURN v_dep;
END;
$function$;

-- El archivo también dice el banco: es la columna que faltaba para cuadrar
-- contra un estado de cuenta, que es para lo que se mira esta lista.
CREATE OR REPLACE FUNCTION public.get_depositos(p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.fecha DESC, t.folio DESC)
      FROM (
        SELECT d.id, d.folio, d.fecha,
               d.total_contado, d.aporte, d.aporte_nota,
               d.monto_deposito, d.remanente, d.nota,
               d.cerrado_at,
               (SELECT b.nombre FROM public.bancos b WHERE b.id = d.banco_id)                  AS banco,
               (SELECT e.name FROM public.employees e WHERE e.id = d.cerrado_por)              AS cerrado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_entregado_por)  AS entregado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_recibido_por)   AS recibido_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.llevado_por)              AS llevado_por,
               (SELECT count(*) FROM public.bolsas b WHERE b.deposito_id = d.id)               AS cuantas,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_hasta,
               -- El desglose POR DÍA, que es como se cuadra: 43 bolsas de a una
               -- no responden «¿cuánto entró del martes?».
               coalesce((
                 SELECT json_agg(json_build_object('fecha', x.fecha, 'cuantas', x.cuantas, 'contado', x.contado)
                                 ORDER BY x.fecha)
                   FROM (SELECT b.fecha, count(*) AS cuantas, sum(b.contado) AS contado
                           FROM public.bolsas b WHERE b.deposito_id = d.id
                          GROUP BY b.fecha) x
               ), '[]'::json) AS por_dia,
               coalesce((
                 SELECT json_agg(json_build_object(
                          'id', b.id, 'folio', b.folio, 'branch_id', b.branch_id,
                          'fecha', b.fecha, 'hora', b.hora, 'contado', b.contado)
                        ORDER BY b.branch_id, b.fecha, b.folio)
                   FROM public.bolsas b WHERE b.deposito_id = d.id
               ), '[]'::json) AS bolsas
          FROM public.depositos_bancarios d
         WHERE (p_desde IS NULL OR d.fecha >= p_desde)
           AND (p_hasta IS NULL OR d.fecha <= p_hasta)
      ) t
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_depositos(date, date)                                                            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_depositos(date, date)                                                            TO authenticated, service_role;

GRANT SELECT ON public.bancos TO authenticated;
REVOKE ALL ON public.bancos FROM anon;
