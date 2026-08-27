SET lock_timeout = '5s';

-- ═══ 1. El cierre lleva su comprobante del banco ════════════════════════════
--
-- «que se pueda anexar el comprobante del banco» (usuario, 2026-08-26).
--
-- Hasta hoy el registro decía cuánto y a qué banco, y la boleta que lo prueba
-- vivía en un papel sobre un escritorio. Cuadrar contra el estado de cuenta —lo
-- único para lo que este registro existe— es justamente el momento en que hace
-- falta la boleta.
--
-- Se guarda la URL en formato PÚBLICO, que es el identificador; la firmada
-- expira (regla 10 de CLAUDE.md). Mismo bucket privado que el respaldo de una
-- diferencia y que la foto de un vale.
ALTER TABLE public.depositos_bancarios
    ADD COLUMN IF NOT EXISTS comprobante_url text;

COMMENT ON COLUMN public.depositos_bancarios.comprobante_url IS
    'Boleta del banco, en formato-public. Se firma al mostrarla: el bucket es privado.';


-- ═══ 2. Lo anterior al circuito queda CERRADO, y deja de esconderse ═════════
--
-- «esas bolsas son anteriores, aún no se finalizaba el proceso, así que
-- márcalas como finalizadas» (usuario, 2026-08-26).
--
-- Son 54 bolsas por $32,006.16 contadas entre el 14 y el 20 de agosto, antes de
-- que existiera el paso de cierre. `get_por_depositar` las escondía con un
-- corte de fecha, y eso era peor que tenerlas a la vista: la pantalla decía
-- «0 pendientes» sobre 54 que sí lo estaban.
--
-- `ANTERIOR` es su propio destino y NO se disfraza de ninguno de los otros dos.
-- Decir «al banco» o «en mano» sería inventar un hecho que nadie registró; lo
-- único cierto es que el efectivo se manejó fuera del portal, antes de que este
-- proceso existiera. Su `remanente` es el total y va SIN receptor: significa
-- «no se registró a dónde fue», no «se lo quedó alguien» — por eso la pantalla
-- lo excluye del acumulado de remanentes.
ALTER TABLE public.depositos_bancarios DROP CONSTRAINT IF EXISTS depositos_destino_valido;
ALTER TABLE public.depositos_bancarios
    ADD CONSTRAINT depositos_destino_valido
    CHECK (destino IN ('BANCO', 'EFECTIVO', 'MIXTO', 'ANTERIOR'));

DO $$
DECLARE
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_contado numeric;
    v_cuantas integer;
    v_folio   text;
    v_dep     public.depositos_bancarios;
BEGIN
    SELECT coalesce(sum(b.contado), 0), count(*) INTO v_contado, v_cuantas
      FROM public.bolsas b
     WHERE b.estado = 'CONTADA' AND b.deposito_id IS NULL AND b.contado IS NOT NULL
       AND b.contado_at < timestamptz '2026-08-24 18:15:52+00';

    IF v_cuantas = 0 THEN
        RAISE NOTICE 'No quedaban bolsas anteriores al circuito. No se toco nada.';
        RETURN;
    END IF;

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, monto_deposito, monto_efectivo, remanente,
        destino, cerrado_por, nota)
    VALUES (v_folio, v_hoy, round(v_contado, 2), 0, 0, 0, round(v_contado, 2),
            'ANTERIOR', NULL,
            'Bolsas anteriores al circuito de cierre: se contaron antes de que este paso '
            || 'existiera y su efectivo se manejo fuera del portal. Se marcan como finalizadas '
            || 'para que dejen de figurar como pendientes; no se les inventa un destino porque '
            || 'nadie lo registro.')
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE estado = 'CONTADA' AND deposito_id IS NULL AND contado IS NOT NULL
       AND contado_at < timestamptz '2026-08-24 18:15:52+00';

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, NULL,
           'Efectivo cerrado · ' || v_folio || ' · anterior al circuito de cierre'
      FROM public.bolsas b WHERE b.deposito_id = v_dep.id;

    RAISE NOTICE 'Cerradas % bolsas anteriores por % con %', v_cuantas, v_contado, v_folio;
END $$;

-- Y el corte se va. Existía para tapar esas 54; con ellas cerradas, dejarlo
-- puesto significa que la proxima bolsa vieja se esconde igual y en silencio.
-- Lo que la pantalla no muestra no se puede resolver.
CREATE OR REPLACE FUNCTION public.get_por_depositar()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.fecha, t.folio), '[]'::json)
  FROM (
    SELECT b.id, b.folio, b.branch_id, b.fecha, b.hora, b.contado
      FROM public.bolsas b
     WHERE b.estado = 'CONTADA'
       AND b.deposito_id IS NULL
       AND b.contado IS NOT NULL
  ) t;
$function$;


-- ═══ 3. Un cierre se puede corregir ═════════════════════════════════════════
--
-- Era el único paso del circuito con dinero, cuatro campos donde equivocarse
-- —banco, persona, reparto, comprobante— y ninguna marcha atrás. Un banco mal
-- elegido quedaba mal para siempre.
--
-- No borra: devuelve las bolsas a pendiente y deja el cierre anulado con su
-- motivo, igual que se anula un vale. Y no toca un cierre `ANTERIOR`: ése no
-- registra ningún movimiento que corregir.
ALTER TABLE public.depositos_bancarios
    ADD COLUMN IF NOT EXISTS anulado_at timestamptz,
    ADD COLUMN IF NOT EXISTS anulado_por uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS anulado_motivo text;

CREATE OR REPLACE FUNCTION public.anular_deposito(p_id bigint, p_motivo text)
 RETURNS depositos_bancarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo  uuid := (SELECT auth_employee_id());
    v_dep public.depositos_bancarios;
    v_n   integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Corregir un cierre exige decir por qué.';
    END IF;

    SELECT * INTO v_dep FROM public.depositos_bancarios WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese cierre no existe.'; END IF;
    IF v_dep.anulado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese cierre ya se habia corregido.';
    END IF;
    IF v_dep.destino = 'ANTERIOR' THEN
        RAISE EXCEPTION 'Ese cierre no registra ningun movimiento: es el de las bolsas anteriores al circuito.';
    END IF;

    UPDATE public.depositos_bancarios
       SET anulado_at = now(), anulado_por = v_yo, anulado_motivo = btrim(p_motivo)
     WHERE id = p_id
     RETURNING * INTO v_dep;

    -- Las bolsas vuelven a estar por cerrar. Su bitacora lo dice: sin esto, el
    -- renglon del cierre anterior se quedaria como ultima palabra.
    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, motivo, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', btrim(p_motivo), b.contado, v_yo,
           'Se corrigio el cierre ' || v_dep.folio || ': la bolsa vuelve a estar por cerrar.'
      FROM public.bolsas b WHERE b.deposito_id = p_id;

    UPDATE public.bolsas SET deposito_id = NULL, updated_at = now() WHERE deposito_id = p_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    RAISE NOTICE 'Cierre % corregido: % bolsas vuelven a pendiente.', v_dep.folio, v_n;
    RETURN v_dep;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_deposito(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_deposito(bigint, text) TO authenticated, service_role;

-- Un cierre corregido no vuelve a contar como cierre de sus bolsas.
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
               d.monto_deposito, d.monto_efectivo, d.remanente, d.nota,
               d.cerrado_at, d.destino, d.comprobante_url,
               d.anulado_at, d.anulado_motivo,
               (SELECT e.name FROM public.employees e WHERE e.id = d.anulado_por)              AS anulado_por,
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


-- ═══ 4. El comprobante se anexa después de cerrar ═══════════════════════════
--
-- La boleta del banco casi nunca está en la mano en el momento de cerrar: sale
-- al volver de la ventanilla. Exigirla al cerrar sería empujar a cerrar tarde,
-- que es peor — el registro del efectivo no puede esperar a un papel.
CREATE OR REPLACE FUNCTION public.adjuntar_comprobante_deposito(p_id bigint, p_url text)
 RETURNS depositos_bancarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dep public.depositos_bancarios;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.depositos_bancarios
       SET comprobante_url = nullif(btrim(coalesce(p_url, '')), '')
     WHERE id = p_id AND anulado_at IS NULL
     RETURNING * INTO v_dep;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese cierre no existe o ya se corrigio.';
    END IF;

    INSERT INTO public.bolsas_eventos
        (bolsa_id, accion, estado_antes, estado_despues, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', (SELECT auth_employee_id()),
           CASE WHEN v_dep.comprobante_url IS NULL
                THEN 'Se quito el comprobante del cierre ' || v_dep.folio || '.'
                ELSE 'Se anexo el comprobante del banco al cierre ' || v_dep.folio || '.' END
      FROM public.bolsas b WHERE b.deposito_id = p_id;

    RETURN v_dep;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adjuntar_comprobante_deposito(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.adjuntar_comprobante_deposito(bigint, text) TO authenticated, service_role;


-- ═══ 5. La función muerta del conteo viejo ══════════════════════════════════
--
-- `contar_bolsa` es de antes del 2026-08-24, cuando contar CERRABA la bolsa.
-- Desde que contar sólo la marca, la reemplazó `marcar_conteo_bolsa` y nadie la
-- llama — ni `src/`, ni las edge functions, ni un cron. Dos funciones con el
-- mismo trabajo y una sola viva es cómo alguien termina llamando a la que ya no
-- sabe del circuito.
DROP FUNCTION IF EXISTS public.contar_bolsa(bigint, numeric, numeric);
