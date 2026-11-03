-- Frases del día cargadas desde el portal (2026-11-03, opción A).
--
-- La app ya trae 299 frases propias (apps/clientes/lib/fraseDelDia.js). Esta
-- tabla las COMPLEMENTA: lo que el equipo carga acá sale primero, y cuando no
-- hay nada para hoy la app usa las suyas. Así nunca falta frase y lo nuevo
-- siempre se ve.
--
-- Dos formas de cargar una frase:
--   · con `fecha`: sale ESE día (el Día de la Madre, una campaña). Una sola por día.
--   · sin fecha: entra a la COLA. Cada día sin frase programada toma la
--     siguiente de la cola, una vez; `mostrada_el` anota qué día salió.
--
-- El día empieza a las 8:00 de El Salvador, igual que en la app.
SET lock_timeout = '5s';

CREATE TABLE public.app_frases (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    texto        text NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 5 AND 120),
    categoria    text NOT NULL DEFAULT 'animo' CHECK (categoria IN ('animo', 'salud', 'calma')),
    fecha        date,
    activa       boolean NOT NULL DEFAULT true,
    mostrada_el  date,
    -- Columna de puro audit en tabla chica: sin FK ni índice (regla 2).
    creada_por   uuid DEFAULT public.auth_employee_id(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    -- Una frase de la cola que ya salió no se programa después para otro día.
    CHECK (fecha IS NULL OR mostrada_el IS NULL)
);

-- Una sola frase programada (activa) por día.
CREATE UNIQUE INDEX app_frases_una_por_dia ON public.app_frases (fecha) WHERE fecha IS NOT NULL AND activa;
-- La cola: lo pendiente, en orden de carga.
CREATE INDEX app_frases_cola ON public.app_frases (id) WHERE fecha IS NULL AND mostrada_el IS NULL AND activa;
CREATE INDEX app_frases_mostrada ON public.app_frases (mostrada_el) WHERE mostrada_el IS NOT NULL;

ALTER TABLE public.app_frases ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_frases_select ON public.app_frases
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
CREATE POLICY app_frases_insert ON public.app_frases
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_frases_update ON public.app_frases
    FOR UPDATE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));
CREATE POLICY app_frases_delete ON public.app_frases
    FOR DELETE TO authenticated USING ((SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes'])));

CREATE FUNCTION public.app_frases_tocar() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_frases_tocar() FROM PUBLIC, anon;
CREATE TRIGGER app_frases_tocar BEFORE UPDATE ON public.app_frases
    FOR EACH ROW EXECUTE FUNCTION public.app_frases_tocar();

-- El día de la frase: la fecha de El Salvador corrida 8 horas.
CREATE FUNCTION public.app_frase_dia() RETURNS date LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT ((now() AT TIME ZONE 'America/El_Salvador') - interval '8 hours')::date;
$$;
REVOKE EXECUTE ON FUNCTION public.app_frase_dia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_frase_dia() TO authenticated, service_role;

-- La frase de hoy, o NULL si no hay ninguna cargada (la app usa las suyas).
-- DEFINER porque anota `mostrada_el`; sólo la llama `app-clientes` con la
-- llave del servidor. El candado evita que dos teléfonos que abren la app al
-- mismo tiempo saquen DOS frases de la cola para el mismo día.
CREATE FUNCTION public.app_frase_del_dia() RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dia date := public.app_frase_dia();
  v_id  bigint;
BEGIN
  SELECT id INTO v_id FROM public.app_frases WHERE fecha = v_dia AND activa;
  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('app_frase_del_dia'));
    SELECT id INTO v_id FROM public.app_frases WHERE mostrada_el = v_dia AND activa ORDER BY id LIMIT 1;
    IF v_id IS NULL THEN
      UPDATE public.app_frases SET mostrada_el = v_dia
       WHERE id = (SELECT id FROM public.app_frases
                    WHERE fecha IS NULL AND mostrada_el IS NULL AND activa ORDER BY id LIMIT 1)
      RETURNING id INTO v_id;
    END IF;
  END IF;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT json_build_object('id', f.id, 'texto', btrim(f.texto), 'categoria', f.categoria, 'fecha', v_dia)
            FROM public.app_frases f WHERE f.id = v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.app_frase_del_dia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_frase_del_dia() TO service_role;
