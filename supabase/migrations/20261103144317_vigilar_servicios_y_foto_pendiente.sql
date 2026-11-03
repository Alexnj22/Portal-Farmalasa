SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Que una falla de un servicio no frene a la sala, y que alguien se entere.
--
-- 2026-11-02, Salud 1, 14:57–15:38 SV: el servicio de archivos guardaba cada
-- foto de boleta y contestaba 504 a los 60 s (`canceling statement due to
-- statement timeout` al encolar su propio evento). El portal no registraba el
-- ingreso y la sala no pudo anotar ingresos del POS durante 40 minutos. Nadie
-- del lado técnico se enteró hasta que la sala lo reportó al día siguiente.
--
-- Tres piezas:
--   1. `foto_pendiente_desde` en los movimientos de caja: el ingreso entra con
--      la URL definitiva aunque la foto todavía no esté (se sube sola desde el
--      aparato, ver `src/data/fotosEnEspera.js`). Lo marca la BASE, mirando
--      `storage.objects` — no el navegador —, así que una URL que nunca llega
--      no se esconde.
--   2. `fallas_de_servicio`: el portal anota cada falla de un servicio que
--      sufre (o que esquivó), y `avisos_de_servicio` agrupa una racha en UN
--      aviso con apertura y cierre.
--   3. `vigilar_servicios()` cada 5 min: desmarca fotos que ya llegaron, abre y
--      cierra avisos, avisa de fotos que no llegaron en 2 h, y purga a 90 días.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ── La foto que todavía no llegó ──────────────────────────────────────────

ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS foto_pendiente_desde timestamptz,
  ADD COLUMN IF NOT EXISTS foto_pendiente_avisada_at timestamptz;

COMMENT ON COLUMN public.caja_movimientos_portal.foto_pendiente_desde IS
  'La foto_url todavía no existe en storage: se sube sola desde el aparato. La pone el trigger caja_mov_marcar_foto_pendiente y la quita vigilar_servicios()/confirmar_foto_pendiente() cuando aparece.';

-- Índice parcial: casi siempre vacío, y es lo único que el barrido busca.
CREATE INDEX IF NOT EXISTS caja_mov_foto_pendiente_idx
  ON public.caja_movimientos_portal (foto_pendiente_desde)
  WHERE foto_pendiente_desde IS NOT NULL;

-- ¿Existe en storage el archivo de esta URL formato-público? Lee la tabla de
-- storage directo: no depende de que el servicio de archivos conteste, que es
-- justo lo que no hace cuando hace falta preguntarle.
CREATE OR REPLACE FUNCTION public.foto_esta_guardada(p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  m text[] := regexp_match(coalesce(p_url, ''), '/storage/v1/object/(?:public|sign|authenticated)/([^/]+)/([^?]+)');
BEGIN
  -- Una URL que no es de nuestro storage (externa, vieja) no se juzga: se da por buena.
  IF m IS NULL THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = m[1]
       AND o.name = replace(m[2], '%20', ' ')
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.foto_esta_guardada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.foto_esta_guardada(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.caja_mov_marcar_foto_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.foto_url IS NULL OR btrim(NEW.foto_url) = '' THEN
    NEW.foto_pendiente_desde := NULL;
  ELSIF NOT public.foto_esta_guardada(NEW.foto_url) THEN
    NEW.foto_pendiente_desde := coalesce(
      CASE WHEN TG_OP = 'UPDATE' AND OLD.foto_url IS NOT DISTINCT FROM NEW.foto_url THEN OLD.foto_pendiente_desde END,
      now());
  ELSE
    NEW.foto_pendiente_desde := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS caja_mov_marcar_foto_pendiente ON public.caja_movimientos_portal;
CREATE TRIGGER caja_mov_marcar_foto_pendiente
  BEFORE INSERT OR UPDATE OF foto_url ON public.caja_movimientos_portal
  FOR EACH ROW EXECUTE FUNCTION public.caja_mov_marcar_foto_pendiente();

-- El aparato avisa que la foto ya subió. Sólo desmarca si storage la tiene:
-- llamarla de más no puede afirmar nada falso.
CREATE OR REPLACE FUNCTION public.confirmar_foto_pendiente(p_url text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.foto_esta_guardada(p_url) THEN RETURN 0; END IF;
  UPDATE public.caja_movimientos_portal
     SET foto_pendiente_desde = NULL
   WHERE foto_url = p_url AND foto_pendiente_desde IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirmar_foto_pendiente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_foto_pendiente(text) TO authenticated, service_role;

-- 2 ── Las fallas que el portal ve ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fallas_de_servicio (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio    text NOT NULL CHECK (servicio IN ('archivos', 'base', 'funciones')),
  operacion   text,
  estado      integer,
  detalle     text,
  -- La falla ocurrió pero quien la sufría no se enteró: se verificó, se
  -- reintentó con éxito o la foto quedó esperando en el aparato.
  rescatada   boolean NOT NULL DEFAULT false,
  origen      text NOT NULL DEFAULT 'portal' CHECK (origen IN ('portal', 'sonda')),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  branch_id   integer REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fallas_de_servicio_reciente_idx ON public.fallas_de_servicio (servicio, created_at DESC);
CREATE INDEX IF NOT EXISTS fallas_de_servicio_employee_idx ON public.fallas_de_servicio (employee_id);
CREATE INDEX IF NOT EXISTS fallas_de_servicio_branch_idx ON public.fallas_de_servicio (branch_id);

ALTER TABLE public.fallas_de_servicio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.fallas_de_servicio;
CREATE POLICY bloqueo_global ON public.fallas_de_servicio
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS fallas_de_servicio_select ON public.fallas_de_servicio;
CREATE POLICY fallas_de_servicio_select ON public.fallas_de_servicio
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('sync_health', 'can_view')));
REVOKE ALL ON public.fallas_de_servicio FROM anon;

-- Una racha de fallas es UN aviso, con su apertura y su cierre.
CREATE TABLE IF NOT EXISTS public.avisos_de_servicio (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio      text NOT NULL,
  abierto_at    timestamptz NOT NULL DEFAULT now(),
  cerrado_at    timestamptz,
  fallas        integer NOT NULL DEFAULT 0,
  -- Cuántas personas recibieron el aviso. 0 queda escrito a propósito: sin
  -- nadie en Alertas Técnicas el aviso no llega, y eso tiene que verse.
  destinatarios integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS avisos_de_servicio_uno_abierto
  ON public.avisos_de_servicio (servicio) WHERE cerrado_at IS NULL;

ALTER TABLE public.avisos_de_servicio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.avisos_de_servicio;
CREATE POLICY bloqueo_global ON public.avisos_de_servicio
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS avisos_de_servicio_select ON public.avisos_de_servicio;
CREATE POLICY avisos_de_servicio_select ON public.avisos_de_servicio
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('sync_health', 'can_view')));
REVOKE ALL ON public.avisos_de_servicio FROM anon;

-- El portal anota una falla. La firma sale de la sesión, nunca del navegador.
-- Tope: una por persona, servicio y operación cada 20 s — un aparato en un
-- bucle de reintentos no puede llenar la tabla.
CREATE OR REPLACE FUNCTION public.reportar_falla_de_servicio(
  p_servicio text, p_operacion text, p_estado integer, p_detalle text, p_rescatada boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
BEGIN
  IF p_servicio NOT IN ('archivos', 'base', 'funciones') THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.fallas_de_servicio f
     WHERE f.servicio = p_servicio
       AND f.employee_id IS NOT DISTINCT FROM v_emp
       AND f.operacion IS NOT DISTINCT FROM left(p_operacion, 80)
       AND f.created_at > now() - interval '20 seconds'
  ) THEN RETURN; END IF;

  INSERT INTO public.fallas_de_servicio (servicio, operacion, estado, detalle, rescatada, employee_id, branch_id)
  VALUES (p_servicio, left(p_operacion, 80), p_estado, left(p_detalle, 300), coalesce(p_rescatada, false),
          v_emp, public.auth_employee_branch_id());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reportar_falla_de_servicio(text, text, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reportar_falla_de_servicio(text, text, integer, text, boolean) TO authenticated, service_role;

-- 3 ── El vigía ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vigilar_servicios()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  -- Abrir: 3 fallas en 10 min. Cerrar: 15 min sin ninguna. Medido sobre el
  -- 2-nov: 16 fallas en 40 min, o sea que con 3 en 10 el aviso habría salido
  -- a los ~5 minutos de empezar.
  ABRIR_CON   constant integer  := 3;
  VENTANA     constant interval := interval '10 minutes';
  CALMA       constant interval := interval '15 minutes';
  FOTO_TARDE  constant interval := interval '2 hours';
  NOMBRE      constant jsonb := '{"archivos":"El servicio de archivos","base":"La base de datos","funciones":"Las funciones del servidor"}';
  v_dest      uuid[];
  r           record;
  v_aviso     record;
  v_n         integer;
  v_salas     integer;
  v_salvadas  integer;
BEGIN
  -- a) Fotos que ya llegaron.
  UPDATE public.caja_movimientos_portal m
     SET foto_pendiente_desde = NULL
   WHERE m.foto_pendiente_desde IS NOT NULL
     AND public.foto_esta_guardada(m.foto_url);

  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles ro ON ro.id IN (e.role_id, e.secondary_role_id)
   WHERE ro.name = 'Sistema — Alertas Técnicas' AND e.status = 'ACTIVO';

  -- b) Abrir avisos.
  FOR r IN
    SELECT f.servicio, count(*) AS n, count(DISTINCT f.branch_id) AS salas,
           count(*) FILTER (WHERE f.rescatada) AS salvadas
      FROM public.fallas_de_servicio f
     WHERE f.created_at > now() - VENTANA
     GROUP BY f.servicio
    HAVING count(*) >= ABRIR_CON
  LOOP
    INSERT INTO public.avisos_de_servicio (servicio, fallas, destinatarios)
    VALUES (r.servicio, r.n, coalesce(cardinality(v_dest), 0))
    ON CONFLICT (servicio) WHERE cerrado_at IS NULL DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;   -- ya había uno abierto: no se repite

    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_SERVICIO_FALLANDO',
        (NOMBRE ->> r.servicio) || ' está fallando',
        r.n || ' fallas en los últimos 10 minutos, en ' || r.salas || ' sala(s)'
          || CASE WHEN r.salvadas = r.n THEN '. Hasta ahora el portal las esquivó todas: nadie quedó frenado.'
                  WHEN r.salvadas > 0 THEN '. ' || r.salvadas || ' las esquivó el portal; el resto llegó a la pantalla.'
                  ELSE '. Las salas lo están sufriendo.' END,
        '/actualizacion-de-datos',
        jsonb_build_object('servicio', r.servicio, 'fallas', r.n),
        true, NULL);
    END IF;
  END LOOP;

  -- c) Cerrar avisos en calma.
  FOR v_aviso IN
    SELECT a.* FROM public.avisos_de_servicio a
     WHERE a.cerrado_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.fallas_de_servicio f
                        WHERE f.servicio = a.servicio AND f.created_at > now() - CALMA)
  LOOP
    SELECT count(*) INTO v_n FROM public.fallas_de_servicio f
     WHERE f.servicio = v_aviso.servicio AND f.created_at >= v_aviso.abierto_at - VENTANA;
    UPDATE public.avisos_de_servicio SET cerrado_at = now(), fallas = v_n WHERE id = v_aviso.id;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_SERVICIO_NORMAL',
        (NOMBRE ->> v_aviso.servicio) || ' se normalizó',
        'Lleva 15 minutos sin fallas. En total fueron ' || v_n || ' desde las '
          || to_char(v_aviso.abierto_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM') || '.',
        '/actualizacion-de-datos',
        jsonb_build_object('servicio', v_aviso.servicio, 'fallas', v_n),
        true, NULL);
    END IF;
  END LOOP;

  -- d) Fotos que no llegaron en 2 h: un aviso por foto, una sola vez.
  FOR r IN
    SELECT m.id, m.monto, m.numero_boleta, m.foto_pendiente_desde, b.name AS sala
      FROM public.caja_movimientos_portal m
      LEFT JOIN public.branches b ON b.id = m.branch_id
     WHERE m.foto_pendiente_desde < now() - FOTO_TARDE
       AND m.foto_pendiente_avisada_at IS NULL
  LOOP
    UPDATE public.caja_movimientos_portal SET foto_pendiente_avisada_at = now() WHERE id = r.id;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_FOTO_SIN_LLEGAR',
        'Una foto de caja no llegó',
        coalesce(r.sala, 'Una sala') || ': el movimiento de $' || to_char(r.monto, 'FM999990.00')
          || coalesce(' (boleta ' || r.numero_boleta || ')', '')
          || ' se anotó a las ' || to_char(r.foto_pendiente_desde AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')
          || ' y su foto sigue en el equipo donde se tomó. Si ese equipo no vuelve a entrar al portal, la foto no va a llegar.',
        '/caja',
        jsonb_build_object('movimiento_id', r.id),
        true, NULL);
    END IF;
  END LOOP;

  -- e) Retención: 90 días (regla 7 de CLAUDE.md). Los avisos se quedan: son la historia.
  DELETE FROM public.fallas_de_servicio WHERE created_at < now() - interval '90 days';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vigilar_servicios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vigilar_servicios() TO service_role;

SELECT cron.schedule('vigilar-servicios', '*/5 * * * *', $cron$SELECT public.vigilar_servicios();$cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-servicios');
