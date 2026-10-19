SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Recetas de la app: una sola regla y un permiso propio (2026-10-19).
--
-- Decisión del dueño tras la auditoría del 2026-10-19:
--   1. La app pide receta para TODO producto bajo receta con la MISMA regla del
--      libro: `clase_de_dispensacion()`. Hasta hoy la app decía
--      `es_antibiotico OR requiere_receta`, que no ve lo que la sala marcó a mano
--      en `dispensacion_clases` (clase 'bajo_receta'): ese producto se vendía por
--      la app sin receta mientras el libro lo exigía en el mostrador.
--      `app_productos_bajo_receta(ids)` es el único sitio que lo contesta para la
--      app (reservar, carrito, encargos, existencias), y el trigger
--      `app_reservas_guardas` lo vuelve a decidir al insertar: la app no puede
--      saltárselo mandando otra cosa.
--   3. Aprobar una receta deja de ser «cualquiera que maneje reservas»: pide el
--      permiso `recetas_app` (can_approve). Alcance BRANCH = su sala; ALL = todas.
--      Lo reciben los cuatro cargos admin (ALL) y los cargos que hoy manejan
--      reservas con `dash_reservas` (con su mismo alcance).
--
-- Columnas nuevas de `app_reservas` (no hay datos reales: 9 filas, todas
-- canceladas y de prueba):
--   bajo_receta    — este renglón es de un producto bajo receta (lo decide el
--                    trigger). Un pedido mixto tiene renglones con y sin.
--   factor         — unidades por presentación reservada: lo apartado se cuenta
--                    en unidades (`app_existencias_netas`).
--   pendiente_at   — desde cuándo está «pendiente» (48 h para prepararla).
--   pago_prueba    — se pagó con un cobro de PRUEBA: no es dinero, en caja se cobra.
--   vencida_motivo — por qué venció. Las que vencen por la sala (receta sin
--                    revisar, sin preparar) no le cuentan al cliente en el tope de
--                    «3 vencidas en 30 días».
--   saldo_favor_origen / _usado_branch / _devuelto_* — el saldo a favor nace
--                    también de lo pagado en línea y cancelado (punto 6), se usa
--                    en cualquier sala y sólo un admin lo devuelve en dinero.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_reservas
  ADD COLUMN IF NOT EXISTS bajo_receta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS factor integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pendiente_at timestamptz,
  ADD COLUMN IF NOT EXISTS pago_prueba boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vencida_motivo text,
  ADD COLUMN IF NOT EXISTS saldo_favor_origen text,
  ADD COLUMN IF NOT EXISTS saldo_incluye_envio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS saldo_favor_usado_branch bigint REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS saldo_favor_devuelto_at timestamptz,
  ADD COLUMN IF NOT EXISTS saldo_favor_devuelto_por uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS saldo_favor_devuelto_monto numeric,
  ADD COLUMN IF NOT EXISTS saldo_favor_devuelto_motivo text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_reservas_factor_check') THEN
    ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_factor_check CHECK (factor >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_reservas_vencida_motivo_check') THEN
    ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_vencida_motivo_check CHECK (vencida_motivo IS NULL OR vencida_motivo IN
      ('sin_receta', 'receta_sin_revisar', 'sin_preparar', 'sin_retirar', 'oferta_terminada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_reservas_saldo_origen_check') THEN
    ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_saldo_origen_check CHECK (saldo_favor_origen IS NULL OR saldo_favor_origen IN
      ('anticipo', 'pago_en_linea', 'pago_tardio', 'pago_duplicado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_reservas_devuelto_motivo_check') THEN
    ALTER TABLE public.app_reservas ADD CONSTRAINT app_reservas_devuelto_motivo_check
      CHECK (saldo_favor_devuelto_at IS NULL OR (length(btrim(coalesce(saldo_favor_devuelto_motivo, ''))) BETWEEN 3 AND 300));
  END IF;
END $$;

-- Lo apartado se suma por producto y sala sobre las abiertas.
CREATE INDEX IF NOT EXISTS app_reservas_abiertas_por_producto
  ON public.app_reservas (producto_id, branch_id) WHERE estado IN ('en_revision', 'pendiente', 'lista');
CREATE INDEX IF NOT EXISTS app_reservas_saldo_usado_branch ON public.app_reservas (saldo_favor_usado_branch);

-- Del cobro: si el enlace se creó en modo de PRUEBA (para devolverlo igual al
-- reutilizar un enlace vigente) y QUÉ renglones cubre (los abiertos al crearlo):
-- un renglón que se cierra después y recibe el pago queda a favor; uno que ya
-- estaba cerrado no entró en el monto y no se toca.
ALTER TABLE public.app_reservas_pagos
  ADD COLUMN IF NOT EXISTS enlace_prueba boolean,
  ADD COLUMN IF NOT EXISTS reservas_ids bigint[];

-- Backfill (9 filas de prueba): la regla nueva sobre lo que ya hay.
UPDATE public.app_reservas
   SET bajo_receta = (public.clase_de_dispensacion(producto_id::int) IS NOT NULL),
       pendiente_at = CASE WHEN estado = 'pendiente' THEN coalesce(receta_revisada_at, created_at) END
 WHERE bajo_receta IS DISTINCT FROM (public.clase_de_dispensacion(producto_id::int) IS NOT NULL)
    OR (estado = 'pendiente' AND pendiente_at IS NULL);

-- ── La regla, en un solo sitio ────────────────────────────────────────────
-- Cuáles de estos productos son bajo receta, con la misma función del libro.
-- La app nunca manda más de 20 ids: `clase_de_dispensacion` por id basta.
CREATE OR REPLACE FUNCTION public.app_productos_bajo_receta(p_ids integer[])
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}'::integer[])
    FROM unnest(p_ids) AS x
   WHERE public.clase_de_dispensacion(x) IS NOT NULL;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_productos_bajo_receta(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_productos_bajo_receta(integer[]) TO authenticated, service_role;

-- ── Quién aprueba una receta de la app ────────────────────────────────────
-- `recetas_app` con can_approve; con alcance ALL, de cualquier sala; si no, de
-- la propia. El superusuario pasa por `auth_has_module_permission`.
CREATE OR REPLACE FUNCTION public.receta_app_puede_aprobar(p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.auth_has_module_permission('recetas_app', 'can_approve')
     AND (public.auth_module_scope('recetas_app') = 'ALL' OR p_branch_id = public.auth_employee_branch_id());
$function$;
REVOKE EXECUTE ON FUNCTION public.receta_app_puede_aprobar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receta_app_puede_aprobar(bigint) TO authenticated, service_role;

-- El permiso: los cuatro cargos admin para todas las salas, y los cargos que
-- hoy manejan las reservas de su sala (`dash_reservas`) con su mismo alcance.
-- El de Canales Digitales (edita Ofertas para clientes) NO lo recibe: atender
-- el chat no es revisar una receta. Idempotente.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT r.id, 'recetas_app', true, false, true, 'ALL', now()
  FROM public.roles r WHERE r.id IN (2, 3, 11, 13)
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, can_approve = true, scope = 'ALL', updated_at = now();
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT rp.role_id, 'recetas_app', true, false, true, coalesce(rp.scope, 'BRANCH'), now()
  FROM public.role_permissions rp
 WHERE rp.module_key = 'dash_reservas' AND rp.can_view AND rp.role_id NOT IN (2, 3, 11, 13)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Devolver en dinero un saldo a favor: sólo admin (capacidad de `dash_reservas`).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT r.id, 'dash_reservas_devolver_saldo', true, false, false, 'ALL', now()
  FROM public.roles r WHERE r.id IN (2, 3, 11, 13)
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── Las guardas de la fila ────────────────────────────────────────────────
-- BEFORE INSERT OR UPDATE. Viven en la tabla y no en cada función para que
-- ningún camino (la app, el portal, el pago que llega, el cron) las salte.
CREATE OR REPLACE FUNCTION public.app_reservas_guardas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cerradas constant text[] := ARRAY['cancelada', 'vencida'];
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- La regla del libro, decidida acá: lo que mande la app no cuenta.
    NEW.bajo_receta := public.clase_de_dispensacion(NEW.producto_id::int) IS NOT NULL;
    IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado = 'pendiente' THEN
      NEW.estado := 'en_revision';
    END IF;
  END IF;

  -- Desde cuándo espera que la preparen (48 h, `reservas_vencer`).
  IF NEW.estado = 'pendiente' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'pendiente') THEN
    NEW.pendiente_at := now();
  END IF;

  -- Sin la receta aprobada no se prepara, no se marca lista ni se entrega.
  -- (El pago no se frena acá: un cobro que llega nunca se puede perder.)
  IF NEW.origen = 'app' AND NEW.bajo_receta AND NEW.estado IN ('pendiente', 'lista', 'retirada')
     AND NEW.receta_estado IS DISTINCT FROM 'aprobada'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado) THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;

  -- Lo pagado en línea que se cierra (la sala la cancela, vence, o el pago
  -- llega cuando ya estaba cerrada) queda A FAVOR del cliente (punto 6). El
  -- envío, si el pedido entero se cerró, lo suma `app_reservas_saldo_envio`.
  -- Un cobro de PRUEBA no es dinero: no deja saldo.
  IF TG_OP = 'UPDATE' AND NEW.estado = ANY (v_cerradas) AND NEW.pago_estado = 'pagado'
     AND NEW.pago_metodo = 'en_linea' AND NOT NEW.pago_prueba AND NEW.saldo_favor IS NULL
     AND (NOT (OLD.estado = ANY (v_cerradas)) OR OLD.pago_estado IS DISTINCT FROM 'pagado') THEN
    NEW.saldo_favor := round(coalesce(NEW.precio_unitario, 0) * NEW.cantidad, 2);
    NEW.saldo_favor_vence := v_hoy + 90;
    NEW.saldo_favor_origen := CASE WHEN OLD.estado = ANY (v_cerradas) THEN 'pago_tardio' ELSE 'pago_en_linea' END;
    IF NEW.saldo_favor <= 0 THEN
      NEW.saldo_favor := NULL; NEW.saldo_favor_vence := NULL; NEW.saldo_favor_origen := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_guardas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_reservas_guardas ON public.app_reservas;
CREATE TRIGGER app_reservas_guardas BEFORE INSERT OR UPDATE ON public.app_reservas
  FOR EACH ROW EXECUTE FUNCTION public.app_reservas_guardas();

-- El envío de un pedido pagado en línea vuelve a favor UNA vez, cuando ya no
-- queda ningún renglón abierto ni entregado (si se entregó algo, el envío se
-- usó). AFTER: ve todos los renglones que cerró la misma sentencia.
CREATE OR REPLACE FUNCTION public.app_reservas_saldo_envio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.pedido IS NOT NULL AND coalesce(NEW.saldo_favor, 0) > 0 AND NOT NEW.saldo_incluye_envio
     AND coalesce(NEW.costo_envio, 0) > 0 AND NEW.saldo_favor_origen IN ('pago_en_linea', 'pago_tardio')
     AND NEW.saldo_favor_usado_at IS NULL AND NEW.saldo_favor_devuelto_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.app_reservas x WHERE x.pedido = NEW.pedido
                      AND (x.estado IN ('en_revision', 'pendiente', 'lista', 'retirada') OR x.saldo_incluye_envio)) THEN
    UPDATE public.app_reservas SET saldo_favor = saldo_favor + NEW.costo_envio, saldo_incluye_envio = true
     WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_saldo_envio() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_reservas_saldo_envio ON public.app_reservas;
CREATE TRIGGER app_reservas_saldo_envio AFTER UPDATE OF estado, pago_estado, saldo_favor ON public.app_reservas
  FOR EACH ROW EXECUTE FUNCTION public.app_reservas_saldo_envio();

-- ── El aviso de «receta por revisar» va a quien la puede aprobar ──────────
CREATE OR REPLACE FUNCTION public.app_reservas_avisar_receta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_dest uuid[]; v_n integer;
BEGIN
  IF NEW.estado = 'en_revision' AND NEW.receta_estado = 'pendiente'
     AND NEW.receta_subida_at IS DISTINCT FROM OLD.receta_subida_at THEN
    IF NEW.pedido IS NOT NULL AND EXISTS (SELECT 1 FROM public.app_reservas x
        WHERE x.pedido = NEW.pedido AND x.id < NEW.id AND x.estado = 'en_revision') THEN
      RETURN NEW;
    END IF;
    SELECT count(*) INTO v_n FROM public.app_reservas x
     WHERE (CASE WHEN NEW.pedido IS NULL THEN x.id = NEW.id ELSE x.pedido = NEW.pedido END) AND x.estado = 'en_revision';
    -- (2026-10-19) Antes: todo el que ve `dash_reservas` en la sala. Ahora:
    -- quien de esa sala puede APROBARLA (`recetas_app`).
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.branch_id = NEW.branch_id
       AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = 'recetas_app'
                   AND rp.can_approve AND rp.role_id IN (e.role_id, e.secondary_role_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RECETA_APP', 'Receta por revisar',
        CASE WHEN v_n > 1 THEN 'Pedido ' || NEW.pedido || ' (' || v_n || ' productos)'
             ELSE NEW.producto_nombre || ' · ' || coalesce(NEW.pedido, 'R-' || lpad(NEW.id::text, 6, '0')) END
          || '. Revísala antes de confirmar la reserva.',
        '/', jsonb_build_object('check_key', 'receta:' || coalesce(NEW.pedido, NEW.id::text) || ':' || NEW.receta_fotos, 'reserva_id', NEW.id), true, NEW.branch_id::int);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── La foto de la receta la ve quien la puede aprobar ─────────────────────
DROP POLICY IF EXISTS app_clientes_archivos_select ON storage.objects;
CREATE POLICY app_clientes_archivos_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'app-clientes-archivos' AND (
    ((storage.foldername(name))[1] = 'recetas'
      AND (storage.foldername(name))[2] ~ '^[0-9]+$'
      AND public.receta_app_puede_aprobar(((storage.foldername(name))[2])::bigint))
    OR ((storage.foldername(name))[1] = ANY (ARRAY['chat', 'perfil'])
      AND (SELECT public.auth_has_module_permission('chat_clientes', 'can_view')))
  )
);
