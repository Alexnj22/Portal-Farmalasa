SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- La limpieza se puede corregir y se puede quitar.
--
-- Pedido del usuario: «permite editar / quitar limpieza». Hasta hoy, marcarla
-- por error era definitivo — y un libro que no se puede corregir termina
-- diciendo algo falso, que es peor que un hueco.
--
--   · CORREGIR guarda el motivo y quién lo hizo, como la lectura: el registro
--     sigue siendo el mismo y queda dicho que se tocó.
--   · QUITAR borra la fila y el hueco vuelve solo. El rastro va a `audit_logs`
--     con su motivo —es el canon del portal para toda acción de usuario— y ahí
--     es consultable. Marcar la fila como anulada en vez de borrarla obligaría
--     a filtrarla en las tres funciones que la leen (el día, el resumen del mes
--     y el mes impreso), y una de las tres se olvida: el mes seguiría contando
--     como hecha una limpieza que nadie hizo.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bitacora_limpiezas
    ADD COLUMN IF NOT EXISTS corregida_at    timestamptz,
    ADD COLUMN IF NOT EXISTS corregida_por   uuid REFERENCES public.employees(id),
    ADD COLUMN IF NOT EXISTS correccion_motivo text;

CREATE OR REPLACE FUNCTION public.corregir_limpieza_bitacora(
    p_limpieza_id   bigint,
    p_puntos        jsonb DEFAULT '[]'::jsonb,
    p_observaciones text  DEFAULT NULL,
    p_motivo        text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_area public.bitacora_areas%ROWTYPE;
    v_lim  public.bitacora_limpiezas%ROWTYPE;
    v_puntos jsonb;
BEGIN
    SELECT * INTO v_lim FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese registro de limpieza no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_lim.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_lim.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder corregir.' USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Hay que decir por que se corrige.' USING ERRCODE = 'P0001';
    END IF;

    -- Igual que al registrar: el detalle se arma contra la lista del área, no
    -- se copia lo que manda el navegador.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'clave', p->>'clave',
               'hecho', coalesce((
                   SELECT (m->>'hecho')::boolean
                     FROM jsonb_array_elements(coalesce(p_puntos, '[]'::jsonb)) m
                    WHERE m->>'clave' = p->>'clave'
                    LIMIT 1), false)
           )), '[]'::jsonb)
      INTO v_puntos
      FROM jsonb_array_elements(coalesce(v_area.puntos, '[]'::jsonb)) p;

    UPDATE public.bitacora_limpiezas
       SET puntos = v_puntos,
           observaciones = nullif(btrim(p_observaciones), ''),
           corregida_at = now(),
           corregida_por = public.auth_employee_id(),
           correccion_motivo = btrim(p_motivo)
     WHERE id = p_limpieza_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.anular_limpieza_bitacora(
    p_limpieza_id bigint,
    p_motivo      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_area public.bitacora_areas%ROWTYPE;
    v_lim  public.bitacora_limpiezas%ROWTYPE;
BEGIN
    SELECT * INTO v_lim FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese registro de limpieza no existe.' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_area FROM public.bitacora_areas WHERE id = v_lim.area_id;
    PERFORM public.bitacora_exigir_acceso(v_area.branch_id, 'can_edit');

    IF public.bitacora_periodo_cerrado(v_area.branch_id, to_char(v_lim.fecha, 'YYYY-MM')) THEN
        RAISE EXCEPTION 'Ese mes ya esta cerrado. Hay que reabrirlo para poder quitarlo.' USING ERRCODE = 'P0001';
    END IF;

    IF coalesce(btrim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Hay que decir por que se quita.' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.bitacora_limpiezas WHERE id = p_limpieza_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corregir_limpieza_bitacora(bigint, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.corregir_limpieza_bitacora(bigint, jsonb, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.anular_limpieza_bitacora(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_limpieza_bitacora(bigint, text) TO authenticated, service_role;
