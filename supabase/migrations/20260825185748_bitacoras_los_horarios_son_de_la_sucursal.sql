SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El reloj es de la SUCURSAL, no de cada área.
--
-- ── Qué lo motivó ──────────────────────────────────────────────────────────
-- «las lecturas y limpieza se hace al mismo tiempo en ambas áreas» (usuario,
-- 2026-08-25). Y es obvio en cuanto se dice: la persona camina UNA vez con el
-- termohigrómetro y mira la sala y la bodega en la misma pasada — no hay dos
-- relojes. Configurarlo por área hacía la misma pregunta cuatro veces y
-- permitía cuatro respuestas distintas para un hecho que es uno solo; peor,
-- dos áreas con horarios corridos parten la ronda en dos.
--
-- ── Lo que se comparte es la HORA, no la lista ─────────────────────────────
-- Cada área conserva QUÉ momentos lleva: la sala de ventas se limpia en
-- apertura y cierre, las vitrinas sólo en apertura. Lo que se unifica es a qué
-- hora ocurre cada momento. Por eso esto actualiza los renglones existentes por
-- su clave y NO agrega ni quita ninguno: unificar la lista le habría duplicado
-- la obligación a las vitrinas sin que nadie lo decidiera.
--
-- ── Por qué un RPC y no cuatro UPDATE desde el navegador ───────────────────
-- Son N áreas y tiene que ser todo o nada: con updates sueltos, un fallo a la
-- mitad deja la sucursal con la sala en el horario nuevo y la bodega en el
-- viejo — que es exactamente el estado que este cambio viene a hacer
-- imposible.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.aplicar_horarios_bitacora(
    p_branch_id bigint,
    p_franjas   jsonb DEFAULT '[]'::jsonb,
    p_limpiezas jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_tocadas integer;
BEGIN
    -- La guarda se escribe acá y no con `bitacora_exigir_acceso`, que mira el
    -- módulo `bitacoras`: esto es CONFIGURACIÓN y su permiso es otro.
    IF NOT public.auth_has_module_permission('bitacoras_configurar', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo no puede configurar las bitacoras.' USING ERRCODE = '42501';
    END IF;
    IF public.auth_module_scope('bitacoras_configurar') <> 'ALL'
       AND p_branch_id IS DISTINCT FROM public.auth_employee_branch_id()::bigint THEN
        RAISE EXCEPTION 'Solo podes configurar tu sala.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.bitacora_areas a
       SET franjas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.franjas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           limpiezas = (
               SELECT coalesce(jsonb_agg(
                          CASE WHEN n.clave IS NULL THEN f
                               ELSE f || jsonb_build_object('desde', n.desde, 'hasta', n.hasta) END
                          ORDER BY t.ord), '[]'::jsonb)
                 FROM jsonb_array_elements(a.limpiezas) WITH ORDINALITY AS t(f, ord)
                 LEFT JOIN LATERAL (
                     SELECT x->>'clave' AS clave, x->>'desde' AS desde, x->>'hasta' AS hasta
                       FROM jsonb_array_elements(coalesce(p_limpiezas, '[]'::jsonb)) x
                      WHERE x->>'clave' = f->>'clave'
                      LIMIT 1
                 ) n ON true
           ),
           updated_at = now()
     WHERE a.branch_id = p_branch_id;

    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    RETURN v_tocadas;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_horarios_bitacora(bigint, jsonb, jsonb) TO authenticated, service_role;
