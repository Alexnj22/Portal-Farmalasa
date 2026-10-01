-- ═══════════════════════════════════════════════════════════════════════════
-- Distribución · 0027 — rutas y visitas del día
-- ═══════════════════════════════════════════════════════════════════════════
-- ── La ruta deja de ser un texto ─────────────────────────────────────────
-- Hasta hoy `dist_clientes.ruta` se escribía a mano en la ficha: «Ruta 1 —
-- Chalatenango centro» en un cliente y «Ruta 1 - Chalatenango Centro» en otro
-- son dos rutas distintas para cualquier reporte, sin error. Es la regla del
-- portal «un rótulo no es una clave» (CLAUDE.md): la lista sale de una TABLA.
--
-- `dist_rutas` es la verdad (nombre, vendedor, días de visita) y el cliente
-- apunta con `ruta_id`. La columna de texto `ruta` se QUEDA, mantenida por
-- trigger con el nombre de la ruta: once funciones y el tablero la leen, y
-- reescribirlas todas por un rótulo sería riesgo sin ganancia.
--
-- ── Las visitas ──────────────────────────────────────────────────────────
-- Cada día, el vendedor ve los clientes de SUS rutas que tocan ese día de la
-- semana, en su orden, con lo que conviene saber antes de entrar (qué debe, si
-- está atrasado, cuándo compró). Registra qué pasó: venta, sin pedido,
-- cerrado, no estaba, sólo cobro. Una venta del día a ese cliente cuenta sola
-- como visita con venta.
--
-- La primera visita con GPS guarda la ubicación del cliente si no la tenía:
-- ninguno la tiene hoy, y escribirla a mano no la va a escribir nadie.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dist_rutas (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emisor_id    smallint NOT NULL REFERENCES public.dist_emisores(id),
    nombre       text NOT NULL CHECK (btrim(nombre) <> ''),
    vendedor_id  uuid REFERENCES public.employees(id),
    -- Días de la semana ISO: 1 lunes … 7 domingo.
    dias         smallint[] NOT NULL DEFAULT '{}' CHECK (dias <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
    activo       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dist_rutas_nombre ON public.dist_rutas (emisor_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS dist_rutas_vendedor ON public.dist_rutas (vendedor_id) WHERE vendedor_id IS NOT NULL;

ALTER TABLE public.dist_clientes ADD COLUMN IF NOT EXISTS ruta_id bigint REFERENCES public.dist_rutas(id);
ALTER TABLE public.dist_clientes ADD COLUMN IF NOT EXISTS orden_ruta integer;
CREATE INDEX IF NOT EXISTS dist_clientes_ruta_id ON public.dist_clientes (ruta_id, orden_ruta);

CREATE TABLE IF NOT EXISTS public.dist_visitas (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id   bigint NOT NULL REFERENCES public.dist_clientes(id),
    vendedor_id  uuid NOT NULL DEFAULT public.auth_employee_id() REFERENCES public.employees(id),
    fecha        date NOT NULL DEFAULT (now() AT TIME ZONE 'America/El_Salvador')::date,
    resultado    text NOT NULL CHECK (resultado IN ('sin_pedido', 'cerrado', 'no_estaba', 'cobro', 'otro')),
    nota         text,
    lat          double precision,
    lng          double precision,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dist_visitas_dia ON public.dist_visitas (vendedor_id, fecha);
CREATE INDEX IF NOT EXISTS dist_visitas_cliente ON public.dist_visitas (cliente_id, fecha DESC);

ALTER TABLE public.dist_rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dist_visitas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dist_rutas_select ON public.dist_rutas;
CREATE POLICY dist_rutas_select ON public.dist_rutas FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('distribucion', 'can_view')));
DROP POLICY IF EXISTS dist_visitas_select ON public.dist_visitas;
CREATE POLICY dist_visitas_select ON public.dist_visitas FOR SELECT TO authenticated
    USING (vendedor_id = (SELECT public.auth_employee_id()) OR (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])));
REVOKE ALL ON public.dist_rutas, public.dist_visitas FROM anon, authenticated;
GRANT SELECT ON public.dist_rutas, public.dist_visitas TO authenticated;
GRANT ALL ON public.dist_rutas, public.dist_visitas TO service_role;

-- ── Las rutas que hoy existen como texto pasan a la tabla ──────────────────
INSERT INTO public.dist_rutas (emisor_id, nombre)
SELECT DISTINCT ON (lower(btrim(c.ruta))) c.emisor_id, btrim(c.ruta)
  FROM public.dist_clientes c
 WHERE btrim(coalesce(c.ruta, '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM public.dist_rutas r WHERE r.emisor_id = c.emisor_id AND lower(btrim(r.nombre)) = lower(btrim(c.ruta)))
 ORDER BY lower(btrim(c.ruta)), c.id;
UPDATE public.dist_clientes c SET ruta_id = r.id
  FROM public.dist_rutas r
 WHERE c.ruta_id IS NULL AND r.emisor_id = c.emisor_id AND lower(btrim(r.nombre)) = lower(btrim(c.ruta));
-- El orden inicial: el alfabético dentro de cada ruta (lo acomoda quien administra).
UPDATE public.dist_clientes c SET orden_ruta = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY ruta_id ORDER BY nombre) AS n FROM public.dist_clientes WHERE ruta_id IS NOT NULL) x
 WHERE c.id = x.id AND c.orden_ruta IS NULL;
-- El vendedor de cada ruta: el que más le vendió a sus clientes.
UPDATE public.dist_rutas r SET vendedor_id = x.vendedor_id
  FROM (SELECT DISTINCT ON (c.ruta_id) c.ruta_id, p.vendedor_id
          FROM public.dist_pedidos p JOIN public.dist_clientes c ON c.id = p.cliente_id
         WHERE c.ruta_id IS NOT NULL AND p.vendedor_id IS NOT NULL
         GROUP BY c.ruta_id, p.vendedor_id ORDER BY c.ruta_id, count(*) DESC) x
 WHERE r.id = x.ruta_id AND r.vendedor_id IS NULL;

-- ── El texto `ruta` sigue a `ruta_id` ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_cliente_ruta_texto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.ruta_id IS NOT NULL THEN
        SELECT nombre INTO NEW.ruta FROM public.dist_rutas WHERE id = NEW.ruta_id;
    ELSIF btrim(coalesce(NEW.ruta, '')) <> '' THEN
        -- Quien todavía escriba el texto (una importación, una versión vieja de
        -- la pantalla) queda ligado si coincide con una ruta existente.
        SELECT id, nombre INTO NEW.ruta_id, NEW.ruta FROM public.dist_rutas
         WHERE emisor_id = NEW.emisor_id AND lower(btrim(nombre)) = lower(btrim(NEW.ruta));
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_cliente_ruta_texto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_cliente_ruta_texto ON public.dist_clientes;
CREATE TRIGGER dist_cliente_ruta_texto BEFORE INSERT OR UPDATE OF ruta_id, ruta ON public.dist_clientes
    FOR EACH ROW EXECUTE FUNCTION public.dist_cliente_ruta_texto();

CREATE OR REPLACE FUNCTION public.dist_ruta_renombrada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.nombre IS DISTINCT FROM OLD.nombre THEN
        UPDATE public.dist_clientes SET ruta = NEW.nombre WHERE ruta_id = NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_ruta_renombrada() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dist_ruta_renombrada ON public.dist_rutas;
CREATE TRIGGER dist_ruta_renombrada AFTER UPDATE OF nombre ON public.dist_rutas
    FOR EACH ROW EXECUTE FUNCTION public.dist_ruta_renombrada();

-- ── Administrar rutas ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_guardar_ruta(p_id bigint, p_nombre text, p_vendedor uuid, p_dias smallint[], p_activo boolean DEFAULT true)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint := p_id; v_emisor smallint;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: las rutas las arma quien administra';
    END IF;
    IF btrim(coalesce(p_nombre, '')) = '' THEN RAISE EXCEPTION 'DIST_RUTA: escribe el nombre de la ruta'; END IF;
    SELECT id INTO v_emisor FROM public.dist_emisores ORDER BY id LIMIT 1;
    IF EXISTS (SELECT 1 FROM public.dist_rutas WHERE emisor_id = v_emisor AND lower(btrim(nombre)) = lower(btrim(p_nombre)) AND id IS DISTINCT FROM p_id) THEN
        RAISE EXCEPTION 'DIST_RUTA: ya hay una ruta con ese nombre';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO public.dist_rutas (emisor_id, nombre, vendedor_id, dias, activo)
        VALUES (v_emisor, btrim(p_nombre), p_vendedor, coalesce(p_dias, '{}'), coalesce(p_activo, true)) RETURNING id INTO v_id;
    ELSE
        UPDATE public.dist_rutas SET nombre = btrim(p_nombre), vendedor_id = p_vendedor, dias = coalesce(p_dias, '{}'),
               activo = coalesce(p_activo, true), updated_at = now() WHERE id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'DIST_RUTA: no existe esa ruta'; END IF;
    END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_guardar_ruta(bigint, text, uuid, smallint[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_guardar_ruta(bigint, text, uuid, smallint[], boolean) TO authenticated, service_role;

-- El orden de visita: la lista de clientes en el orden en que se recorren.
CREATE OR REPLACE FUNCTION public.dist_ordenar_ruta(p_ruta bigint, p_clientes bigint[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: el orden de la ruta lo arma quien administra';
    END IF;
    UPDATE public.dist_clientes c SET orden_ruta = x.ord
      FROM unnest(p_clientes) WITH ORDINALITY AS x(id, ord)
     WHERE c.id = x.id AND c.ruta_id = p_ruta;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_ordenar_ruta(bigint, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_ordenar_ruta(bigint, bigint[]) TO authenticated, service_role;

-- ── La ruta del día de un vendedor ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dist_ruta_del_dia(p_vendedor uuid, p_fecha date)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE v_admin boolean := (SELECT public.auth_can_edit_any(ARRAY['distribucion_config'])); v_res json;
BEGIN
    IF NOT v_admin AND p_vendedor IS DISTINCT FROM (SELECT public.auth_employee_id()) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: cada vendedor ve su propia ruta';
    END IF;
    WITH rutas AS (
        SELECT * FROM public.dist_rutas WHERE vendedor_id = p_vendedor AND activo AND extract(isodow FROM p_fecha)::smallint = ANY (dias)
    ),
    clientes AS (
        SELECT c.*, r.nombre AS ruta_nombre FROM public.dist_clientes c JOIN rutas r ON r.id = c.ruta_id WHERE c.activo
    ),
    ventas AS (
        SELECT p.cliente_id, count(*) AS n, sum(d.total_pagar) AS total
          FROM public.dist_pedidos p JOIN public.dist_dte d ON d.id = p.dte_id
         WHERE d.fec_emi = p_fecha AND p.vendedor_id = p_vendedor AND d.estado NOT IN ('descartado', 'invalidado', 'rechazado')
         GROUP BY p.cliente_id
    ),
    visitas AS (
        SELECT DISTINCT ON (cliente_id) cliente_id, resultado, nota, created_at
          FROM public.dist_visitas WHERE vendedor_id = p_vendedor AND fecha = p_fecha ORDER BY cliente_id, created_at DESC
    ),
    cartera AS (
        SELECT cliente_id, sum(saldo) AS saldo, sum(saldo) FILTER (WHERE vence < p_fecha) AS vencido
          FROM public.dist_cxc WHERE estado = 'abierta' GROUP BY cliente_id
    ),
    ultima AS (
        SELECT p.cliente_id, max(d.fec_emi) AS fecha FROM public.dist_pedidos p JOIN public.dist_dte d ON d.id = p.dte_id
         WHERE d.estado NOT IN ('descartado', 'invalidado', 'rechazado') GROUP BY p.cliente_id
    )
    SELECT json_build_object(
        'fecha', p_fecha,
        'rutas', (SELECT coalesce(json_agg(json_build_object('id', id, 'nombre', nombre) ORDER BY nombre), '[]'::json) FROM rutas),
        'clientes', (SELECT coalesce(json_agg(json_build_object(
                'id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'ruta', c.ruta_nombre, 'orden', c.orden_ruta,
                'direccion', c.complemento, 'telefono', c.telefono, 'lat', c.lat, 'lng', c.lng,
                'saldo', coalesce(ca.saldo, 0), 'vencido', coalesce(ca.vencido, 0), 'ultima_compra', u.fecha,
                'venta', v.total, 'visita', CASE WHEN vi.cliente_id IS NOT NULL THEN json_build_object('resultado', vi.resultado, 'nota', vi.nota, 'hora', vi.created_at) END,
                'estado', CASE WHEN v.cliente_id IS NOT NULL THEN 'venta' WHEN vi.cliente_id IS NOT NULL THEN 'visitado' ELSE 'pendiente' END)
              ORDER BY c.ruta_nombre, c.orden_ruta NULLS LAST, c.nombre), '[]'::json)
              FROM clientes c LEFT JOIN ventas v ON v.cliente_id = c.id LEFT JOIN visitas vi ON vi.cliente_id = c.id
              LEFT JOIN cartera ca ON ca.cliente_id = c.id LEFT JOIN ultima u ON u.cliente_id = c.id),
        -- Ventas del día a clientes FUERA de la ruta: también cuentan, y se dicen.
        'fuera_de_ruta', (SELECT count(*) FROM ventas v WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id = v.cliente_id))
    ) INTO v_res;
    RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_ruta_del_dia(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_ruta_del_dia(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dist_registrar_visita(p_cliente bigint, p_resultado text, p_nota text DEFAULT NULL, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_id bigint;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['distribucion'])) THEN
        RAISE EXCEPTION 'DIST_SIN_PERMISO: no tienes permiso para registrar visitas';
    END IF;
    IF p_resultado NOT IN ('sin_pedido', 'cerrado', 'no_estaba', 'cobro', 'otro') THEN RAISE EXCEPTION 'DIST_VISITA: elige qué pasó'; END IF;
    IF p_resultado = 'otro' AND btrim(coalesce(p_nota, '')) = '' THEN RAISE EXCEPTION 'DIST_VISITA: escribe qué pasó'; END IF;
    INSERT INTO public.dist_visitas (cliente_id, resultado, nota, lat, lng)
    VALUES (p_cliente, p_resultado, nullif(btrim(coalesce(p_nota, '')), ''), p_lat, p_lng) RETURNING id INTO v_id;
    -- La primera ubicación del cliente sale de la primera visita con GPS.
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
        UPDATE public.dist_clientes SET lat = p_lat, lng = p_lng WHERE id = p_cliente AND lat IS NULL;
    END IF;
    RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.dist_registrar_visita(bigint, text, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dist_registrar_visita(bigint, text, text, double precision, double precision) TO authenticated, service_role;
