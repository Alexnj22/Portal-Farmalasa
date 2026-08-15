-- El folio de una bolsa lleva la sucursal: `S3-1042`.
--
-- Decision del usuario (2026-08-15): «el folio debe llevar la sucursal para
-- saber». La primera version usaba una secuencia pelada (`B-1042`) por miedo a
-- que un prefijo numerico —`B27-`— se leyera como el numero de la sala. Con
-- LETRAS ese riesgo no existe: `S3` es Salud 3 y `LP` es La Popular, no hay
-- ningun numero que confundir.
--
-- El codigo es una COLUMNA de la tabla, no algo derivado del nombre. Derivarlo
-- («Salud 3» → `S3`) seria la trampa de siempre: el dia que alguien renombre la
-- sala, el folio de las bolsas nuevas dejaria de coincidir con el de las viejas
-- y nada avisaria. Ver la memoria `feedback_un_rotulo_no_es_una_clave`.
--
-- Se aplica sin migrar folios viejos porque no hay ninguno: `bolsas` esta en
-- cero (verificado antes de aplicar).

SET lock_timeout = '5s';

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS codigo text;

COMMENT ON COLUMN public.branches.codigo IS
    'Codigo corto de la sucursal para folios y papeles impresos (S1, S3, LP). Es una clave, no un rotulo: no se deriva del nombre.';

-- Unico e insensible a mayusculas: dos sucursales con el mismo codigo darian
-- folios que no identifican a nadie.
CREATE UNIQUE INDEX IF NOT EXISTS branches_codigo_key
    ON public.branches (upper(btrim(codigo))) WHERE codigo IS NOT NULL;

-- Por `id`, que es la clave. Y solo donde falta, para no pisar un codigo que
-- alguien haya corregido a mano.
UPDATE public.branches SET codigo = v.codigo
  FROM (VALUES (2,'LP'), (4,'S1'), (25,'S2'), (27,'S3'), (28,'S4'), (29,'S5'),
               (30,'BOD'), (32,'ADM')) AS v(id, codigo)
 WHERE public.branches.id = v.id AND public.branches.codigo IS NULL;

-- ── El folio ────────────────────────────────────────────────────────────────
--
-- `coalesce(codigo,'B')` y no un error: una sucursal nueva sin codigo no puede
-- impedir que una sala guarde su efectivo. El folio sigue siendo unico —lo
-- garantiza la secuencia— y se nota al primer papel que salga con `B-`.
CREATE OR REPLACE FUNCTION public.cerrar_bolsa_de_corte(
    p_corte_id       bigint,
    p_monto_esperado numeric
)
RETURNS public.bolsas
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_corte  public.cortes_caja;
    v_bolsa  public.bolsas;
    v_scope  text;
    v_monto  numeric;
    v_codigo text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El corte no existe.';
    END IF;

    -- La funcion es DEFINER, asi que no pasa por la policy de la tabla: quien
    -- ve solo su sala no cierra la bolsa de otra.
    v_scope := (SELECT auth_module_scope('bolsas'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no lleva bolsa.';
    END IF;

    -- Un corte sin confirmar puede rehacerse, y entonces su monto cambia. La
    -- bolsa se cierra sobre una cifra firmada.
    IF v_corte.estado <> 'CONFIRMADO' THEN
        RAISE EXCEPTION 'Primero hay que confirmar el corte.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.bolsas b
                WHERE b.corte_id = p_corte_id AND b.estado <> 'ANULADA') THEN
        RAISE EXCEPTION 'Este corte ya tiene su bolsa.';
    END IF;

    v_monto := public.bolsa_sugerida(p_corte_id);

    IF v_monto IS NULL OR v_monto <= 0 THEN
        RAISE EXCEPTION 'No queda efectivo por guardar de este corte: las bolsas de la sala ya cubren lo declarado.';
    END IF;

    IF round(coalesce(p_monto_esperado, -1), 2) <> v_monto THEN
        RAISE EXCEPTION 'El monto cambio mientras estabas en la pantalla: ahora son % y en pantalla decia %. Volve a abrirla.',
            to_char(v_monto, 'FM999999990.00'),
            to_char(round(coalesce(p_monto_esperado, 0), 2), 'FM999999990.00');
    END IF;

    SELECT upper(btrim(coalesce(b.codigo, 'B'))) INTO v_codigo
      FROM public.branches b WHERE b.id = v_corte.branch_id;

    INSERT INTO public.bolsas
        (folio, branch_id, corte_id, origen, monto_inicial, fecha, hora, caja, cerrada_por)
    VALUES
        (coalesce(v_codigo, 'B') || '-' || nextval('public.bolsas_folio_seq'),
         v_corte.branch_id, p_corte_id, 'CORTE', v_monto,
         v_corte.fecha, v_corte.hora, v_corte.empleado_texto,
         (SELECT auth_employee_id()))
    RETURNING * INTO v_bolsa;

    RETURN v_bolsa;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cerrar_bolsa_de_corte(bigint, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_bolsa_de_corte(bigint, numeric) TO authenticated, service_role;
