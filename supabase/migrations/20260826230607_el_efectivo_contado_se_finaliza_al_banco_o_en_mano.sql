SET lock_timeout = '5s';

-- ═══ El efectivo contado no siempre va al banco ═════════════════════════════
--
-- «esa bolsa que está pendiente de depósito, fue un dinero que se agarró. que
-- en vez de que sí o sí sea depósito, diga finalizar o algo, y pregunte si es
-- depósito, o entrega en efectivo y a quién (que sólo salga admin)» (usuario,
-- 2026-08-26).
--
-- El circuito tenía UNA salida —el banco— y por eso una bolsa cuyo efectivo se
-- entregó en mano se quedaba para siempre en «pendiente de depósito»: la única
-- forma de sacarla de ahí era registrar un depósito que nunca ocurrió. Un
-- pendiente que no se puede cerrar con la verdad enseña a cerrarlo con mentira.
--
-- `destino` nace en 'BANCO' y las 2 filas que ya existen lo son, así que la
-- columna no reescribe historia.
ALTER TABLE public.depositos_bancarios
    ADD COLUMN IF NOT EXISTS destino text NOT NULL DEFAULT 'BANCO',
    ADD COLUMN IF NOT EXISTS entregado_a uuid REFERENCES public.employees(id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depositos_destino_valido') THEN
        ALTER TABLE public.depositos_bancarios
            ADD CONSTRAINT depositos_destino_valido CHECK (destino IN ('BANCO', 'EFECTIVO'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_depositos_entregado_a ON public.depositos_bancarios(entregado_a);

COMMENT ON COLUMN public.depositos_bancarios.destino IS
    'BANCO (va al banco, exige banco_id) o EFECTIVO (se entrega en mano, exige entregado_a).';


-- ── «Admin» es un ÁREA de cuatro cargos, y se dice UNA vez ──────────────────
--
-- «que sólo salga admin». La lista vive acá y no escrita dos veces —una en el
-- selector y otra en la validación— porque así es como se desincroniza: el
-- servidor aceptaría a alguien que la pantalla no ofrece, o al revés.
--
-- Es la lección de `20260820154925_admin_son_cuatro_cargos_no_uno`: «admin» NO
-- es el rol `Administrador`. Jefe/a de Compras y Logística NO pertenece al
-- área, y ésa fue la corrección explícita del usuario aquella vez.
CREATE OR REPLACE FUNCTION public.cargos_de_administracion()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Gerente General', 'Administrador',
               'Jefe/a de Talento Humano', 'Supervisor/a de Ventas'];
$function$;

REVOKE EXECUTE ON FUNCTION public.cargos_de_administracion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cargos_de_administracion() TO authenticated, service_role;

/** A quién se le puede entregar el efectivo en mano. */
CREATE OR REPLACE FUNCTION public.get_personas_de_administracion()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(json_build_object(
               'id', e.id, 'name', e.name, 'photo_url', e.photo_url, 'cargo', r.name)
             ORDER BY e.name)
        FROM public.employees e
        JOIN public.roles r ON r.id = e.role_id
       WHERE e.status = 'ACTIVO'
         AND r.name = ANY (public.cargos_de_administracion())
    ), '[]'::json)
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_personas_de_administracion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_personas_de_administracion() TO authenticated, service_role;


-- ── Cerrar el efectivo: al banco, o en mano ────────────────────────────────
--
-- Se DROPEA la firma vieja en vez de agregarle parámetros con default. Dos
-- sobrecargas de la misma función es cómo se cuela una puerta sin candado: al
-- revocar o corregir una, la otra se queda con sus permisos y su cuerpo viejo
-- (pasó con `update_proveedor_manual`, ver CLAUDE.md).
DROP FUNCTION IF EXISTS public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint);

CREATE OR REPLACE FUNCTION public.registrar_deposito_bancario(
    p_bolsa_ids  bigint[],
    p_monto      numeric,
    p_aporte     numeric DEFAULT 0,
    p_aporte_nota text   DEFAULT NULL,
    p_nota       text    DEFAULT NULL,
    p_llevado_por uuid   DEFAULT NULL,
    p_banco_id   smallint DEFAULT NULL,
    p_destino    text    DEFAULT 'BANCO',
    p_entregado_a uuid   DEFAULT NULL)
 RETURNS depositos_bancarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
    v_a_quien   text;
    v_dep       public.depositos_bancarios;
    v_gerentes  uuid[];
    v_quien     text;
    v_cola      text;
    v_titulo    text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_destino NOT IN ('BANCO', 'EFECTIVO') THEN
        RAISE EXCEPTION 'Hay que decir si el efectivo va al banco o se entrega en mano.';
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
        RAISE EXCEPTION 'No hay bolsas contadas y sin cerrar en esa lista.';
    END IF;
    IF v_cuantas <> coalesce(array_length(p_bolsa_ids, 1), 0) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya se cerró o dejó de estar contada. Vuelve a abrir la pantalla.';
    END IF;

    -- El monto NUNCA es negativo. Pero el CERO sólo tiene sentido en una
    -- entrega en mano: es el caso de la bolsa cuyo efectivo se retiró antes de
    -- llegar a administración, que hay que poder cerrar diciendo la verdad.
    -- Un depósito de $0 al banco, en cambio, no es ningún hecho.
    IF p_monto IS NULL OR p_monto < 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto sale.';
    END IF;
    IF p_destino = 'BANCO' AND p_monto <= 0 THEN
        RAISE EXCEPTION 'Hay que escribir cuánto va al banco.';
    END IF;

    IF v_aporte > 0 AND nullif(btrim(coalesce(p_aporte_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Si entra dinero de afuera hay que decir de dónde salió.';
    END IF;

    IF p_destino = 'BANCO' THEN
        -- El banco, resuelto contra el catálogo. Se lee el nombre aquí porque el
        -- aviso lo necesita escrito, y porque un id que no existe tiene que
        -- fallar antes de mover una sola bolsa.
        SELECT b.nombre INTO v_banco FROM public.bancos b
         WHERE b.id = p_banco_id AND b.activo;
        IF v_banco IS NULL THEN
            RAISE EXCEPTION 'Hay que decir a qué banco va el depósito. Si no ves ese campo, recarga la pantalla.';
        END IF;
    ELSE
        -- En mano SÓLO a administración, y el servidor lo comprueba contra la
        -- MISMA lista que llena el selector: si se validara distinto, la
        -- pantalla y la base terminarían aceptando gente distinta.
        SELECT e.name INTO v_a_quien
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE e.id = p_entregado_a
           AND e.status = 'ACTIVO'
           AND r.name = ANY (public.cargos_de_administracion());
        IF v_a_quien IS NULL THEN
            RAISE EXCEPTION 'El efectivo en mano sólo se le entrega a administración, y hay que decir a quién.';
        END IF;
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
            RAISE EXCEPTION 'El remanente se le entrega al Gerente General y no hay ninguno activo. Hay que asignar el cargo antes de cerrar.';
        END IF;
    END IF;

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota, monto_deposito, remanente,
        remanente_entregado_por, remanente_recibido_por, nota, cerrado_por, llevado_por,
        banco_id, destino, entregado_a)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            round(p_monto, 2), v_remanente,
            CASE WHEN v_remanente >= 0.01 THEN v_yo END,
            CASE WHEN v_remanente >= 0.01 THEN v_gerente END,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo,
            CASE WHEN p_destino = 'BANCO' THEN p_llevado_por END,
            CASE WHEN p_destino = 'BANCO' THEN p_banco_id END,
            p_destino,
            CASE WHEN p_destino = 'EFECTIVO' THEN p_entregado_a END)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, v_yo,
           CASE WHEN p_destino = 'BANCO'
                THEN 'Depositada en el banco · ' || v_dep.folio || ' · ' || v_banco
                ELSE 'Entregada en efectivo a ' || v_a_quien || ' · ' || v_dep.folio END
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    -- ── El aviso ───────────────────────────────────────────────────────────
    IF p_destino = 'BANCO' THEN
        SELECT e.name INTO v_quien FROM public.employees e
         WHERE e.id = coalesce(p_llevado_por, v_yo);
        v_quien := CASE WHEN p_llevado_por IS NOT NULL
                        THEN 'lo lleva '  || coalesce(v_quien, 'alguien sin nombre en el padrón')
                        ELSE 'lo cerró '  || coalesce(v_quien, 'alguien sin nombre en el padrón') END;
        v_titulo := 'Depósito al banco · $' || to_char(round(p_monto, 2), 'FM999,999,990.00');
    ELSE
        SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = v_yo;
        v_quien := 'se lo entregó ' || coalesce(v_quien, 'alguien sin nombre en el padrón')
                   || ' a ' || v_a_quien;
        v_titulo := 'Efectivo entregado en mano · $' || to_char(round(p_monto, 2), 'FM999,999,990.00');
    END IF;

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
            v_titulo,
            v_dep.folio || ' · ' || coalesce(v_banco || ' · ', '') || v_quien || '. ' || v_cola,
            '/bolsas?tab=finalizadas',
            jsonb_build_object(
                'deposito_id', v_dep.id,
                'folio',       v_dep.folio,
                'destino',     p_destino,
                'banco',       v_banco,
                'entregado_a', v_a_quien,
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

REVOKE EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_deposito_bancario(bigint[], numeric, numeric, text, text, uuid, smallint, text, uuid) TO authenticated, service_role;


-- ── El archivo dice a dónde fue ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_depositos(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN NOT (SELECT auth_has_module_permission('bolsas_conteo', 'can_view')) THEN NULL
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.fecha DESC, t.folio DESC)
      FROM (
        SELECT d.id, d.folio, d.fecha,
               d.total_contado, d.aporte, d.aporte_nota,
               d.monto_deposito, d.remanente, d.nota,
               d.cerrado_at, d.destino,
               (SELECT b.nombre FROM public.bancos b WHERE b.id = d.banco_id)                  AS banco,
               (SELECT e.name FROM public.employees e WHERE e.id = d.cerrado_por)              AS cerrado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_entregado_por)  AS entregado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.remanente_recibido_por)   AS recibido_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.llevado_por)              AS llevado_por,
               (SELECT e.name FROM public.employees e WHERE e.id = d.entregado_a)              AS entregado_a,
               (SELECT count(*) FROM public.bolsas b WHERE b.deposito_id = d.id)               AS cuantas,
               (SELECT min(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_desde,
               (SELECT max(b.fecha) FROM public.bolsas b WHERE b.deposito_id = d.id)           AS dia_hasta,
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

REVOKE EXECUTE ON FUNCTION public.get_depositos(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_depositos(date, date) TO authenticated, service_role;
