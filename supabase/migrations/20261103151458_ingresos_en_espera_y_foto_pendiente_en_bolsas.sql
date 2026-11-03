-- Que la caja o la foto no frenen el registro — segunda tanda (2026-11-03).
--
-- Sigue a 20261103144317 (foto pendiente en Mi caja + vigilar_servicios):
--
--   1. INGRESOS EN ESPERA DE LA CAJA. Si el sistema de la caja no contesta,
--      `operar-caja` anota el ingreso en efectivo igual, sin número de la
--      caja, y el equipo que lo anotó lo reenvía solo. Dos columnas:
--        · `envio_intentado_at` — un reenvío lo reclama de forma atómica, para
--          que dos equipos (o dos pestañas) no lo manden a la vez: el freno
--          de `resolverSinNumero` mira la caja por `P{id}` antes de mandar,
--          pero dos que miran a la vez ven los dos «no está».
--        · `envio_avisado_at` — `vigilar_servicios()` avisa UNA vez a Alertas
--          Técnicas si un ingreso lleva 20 minutos sin llegar a la caja.
--
--   2. FOTO PENDIENTE EN LAS SALIDAS DE BOLSA. Mismo circuito que Mi caja:
--      `bolsas_operaciones` recibe las dos columnas y el mismo trigger, y
--      `confirmar_foto_pendiente` / `vigilar_servicios` la miran también.
--
--   3. `fallas_de_servicio` acepta el servicio 'caja' (lo anota operar-caja
--      cuando no puede entrar al sistema de la caja), y el aviso lo nombra.

SET lock_timeout = '5s';

-- ── 1. Ingresos en espera ────────────────────────────────────────────────
ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS envio_intentado_at timestamptz,
  ADD COLUMN IF NOT EXISTS envio_avisado_at timestamptz;

COMMENT ON COLUMN public.caja_movimientos_portal.envio_intentado_at IS
  'Último intento de mandar este movimiento a la caja. Un reenvío lo reclama de forma atómica (90 s) para que dos equipos no lo manden a la vez.';
COMMENT ON COLUMN public.caja_movimientos_portal.envio_avisado_at IS
  'vigilar_servicios() ya avisó a Alertas Técnicas que este ingreso no llegó a la caja.';

-- Lo que vigilar_servicios() busca cada 5 minutos: ingresos vivos sin número.
CREATE INDEX IF NOT EXISTS caja_mov_sin_numero_idx
  ON public.caja_movimientos_portal (created_at)
  WHERE erp_movimiento_id IS NULL AND anulado_at IS NULL;

-- ── 2. Foto pendiente en bolsas ──────────────────────────────────────────
ALTER TABLE public.bolsas_operaciones
  ADD COLUMN IF NOT EXISTS foto_pendiente_desde timestamptz,
  ADD COLUMN IF NOT EXISTS foto_pendiente_avisada_at timestamptz;

COMMENT ON COLUMN public.bolsas_operaciones.foto_pendiente_desde IS
  'La foto_url todavía no existe en storage: se sube sola desde el aparato. Mismo circuito que caja_movimientos_portal.';

CREATE INDEX IF NOT EXISTS bolsas_op_foto_pendiente_idx
  ON public.bolsas_operaciones (foto_pendiente_desde)
  WHERE foto_pendiente_desde IS NOT NULL;

-- La función del trigger sólo lee NEW.foto_url y NEW.foto_pendiente_desde:
-- sirve tal cual para cualquier tabla que tenga las dos columnas.
DROP TRIGGER IF EXISTS bolsas_op_marcar_foto_pendiente ON public.bolsas_operaciones;
CREATE TRIGGER bolsas_op_marcar_foto_pendiente
  BEFORE INSERT OR UPDATE OF foto_url ON public.bolsas_operaciones
  FOR EACH ROW EXECUTE FUNCTION public.caja_mov_marcar_foto_pendiente();

CREATE OR REPLACE FUNCTION public.confirmar_foto_pendiente(p_url text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE n integer; m integer;
BEGIN
  -- Sólo quita la marca si la foto de verdad está: llamarla de más no hace nada.
  IF NOT public.foto_esta_guardada(p_url) THEN RETURN 0; END IF;
  UPDATE public.caja_movimientos_portal
     SET foto_pendiente_desde = NULL
   WHERE foto_url = p_url AND foto_pendiente_desde IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.bolsas_operaciones
     SET foto_pendiente_desde = NULL
   WHERE foto_url = p_url AND foto_pendiente_desde IS NOT NULL;
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirmar_foto_pendiente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_foto_pendiente(text) TO authenticated, service_role;

-- ── 3. El servicio 'caja' ───────────────────────────────────────────────
ALTER TABLE public.fallas_de_servicio DROP CONSTRAINT IF EXISTS fallas_de_servicio_servicio_check;
ALTER TABLE public.fallas_de_servicio ADD CONSTRAINT fallas_de_servicio_servicio_check
  CHECK (servicio IN ('archivos', 'base', 'funciones', 'caja'));

-- ── vigilar_servicios(): las dos tablas de fotos y los ingresos en espera ─
CREATE OR REPLACE FUNCTION public.vigilar_servicios()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  ABRIR_CON     constant integer  := 3;
  VENTANA       constant interval := interval '10 minutes';
  CALMA         constant interval := interval '15 minutes';
  FOTO_TARDE    constant interval := interval '2 hours';
  INGRESO_TARDE constant interval := interval '20 minutes';
  NOMBRE        constant jsonb := '{"archivos":"El servicio de archivos","base":"La base de datos","funciones":"Las funciones del servidor","caja":"El sistema de la caja"}';
  v_dest      uuid[];
  r           record;
  v_aviso     record;
  v_n         integer;
BEGIN
  -- 0. Las fotos que ya llegaron dejan de estar pendientes.
  UPDATE public.caja_movimientos_portal m
     SET foto_pendiente_desde = NULL
   WHERE m.foto_pendiente_desde IS NOT NULL
     AND public.foto_esta_guardada(m.foto_url);
  UPDATE public.bolsas_operaciones o
     SET foto_pendiente_desde = NULL
   WHERE o.foto_pendiente_desde IS NOT NULL
     AND public.foto_esta_guardada(o.foto_url);

  SELECT array_agg(DISTINCT e.id) INTO v_dest
    FROM public.employees e
    JOIN public.roles ro ON ro.id IN (e.role_id, e.secondary_role_id)
   WHERE ro.name = 'Sistema — Alertas Técnicas' AND e.status = 'ACTIVO';

  -- 1. Abrir un aviso por servicio con 3+ fallas en 10 minutos.
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

  -- 2. Cerrar el aviso tras 15 minutos sin fallas.
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

  -- 3. Fotos que no llegaron en 2 horas (caja y bolsas), una vez cada una.
  FOR r IN
    SELECT 'caja' AS de, m.id, m.monto, m.numero_boleta, m.foto_pendiente_desde, b.name AS sala
      FROM public.caja_movimientos_portal m
      LEFT JOIN public.branches b ON b.id = m.branch_id
     WHERE m.foto_pendiente_desde < now() - FOTO_TARDE
       AND m.foto_pendiente_avisada_at IS NULL
    UNION ALL
    SELECT 'bolsa', o.id, o.monto, o.numero_boleta, o.foto_pendiente_desde, b.name
      FROM public.bolsas_operaciones o
      LEFT JOIN public.branches b ON b.id = o.branch_id
     WHERE o.foto_pendiente_desde < now() - FOTO_TARDE
       AND o.foto_pendiente_avisada_at IS NULL
  LOOP
    IF r.de = 'caja' THEN
      UPDATE public.caja_movimientos_portal SET foto_pendiente_avisada_at = now() WHERE id = r.id;
    ELSE
      UPDATE public.bolsas_operaciones SET foto_pendiente_avisada_at = now() WHERE id = r.id;
    END IF;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_FOTO_SIN_LLEGAR',
        CASE WHEN r.de = 'caja' THEN 'Una foto de caja no llegó' ELSE 'Una foto de bolsa no llegó' END,
        coalesce(r.sala, 'Una sala') || ': el movimiento de $' || to_char(r.monto, 'FM999990.00')
          || coalesce(' (boleta ' || r.numero_boleta || ')', '')
          || ' se anotó a las ' || to_char(r.foto_pendiente_desde AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')
          || ' y su foto sigue en el equipo donde se tomó. Si ese equipo no vuelve a entrar al portal, la foto no va a llegar.',
        CASE WHEN r.de = 'caja' THEN '/caja' ELSE '/bolsas' END,
        jsonb_build_object(CASE WHEN r.de = 'caja' THEN 'movimiento_id' ELSE 'operacion_id' END, r.id),
        true, NULL);
    END IF;
  END LOOP;

  -- 4. Ingresos en efectivo que llevan 20 minutos sin llegar a la caja.
  --    Normalmente el equipo que lo anotó lo manda solo en cuanto la caja
  --    responde; si no llegó, alguien tiene que mirarlo antes del corte.
  FOR r IN
    SELECT m.id, m.monto, m.concepto, m.created_at, b.name AS sala
      FROM public.caja_movimientos_portal m
      LEFT JOIN public.branches b ON b.id = m.branch_id
     WHERE m.erp_movimiento_id IS NULL AND m.anulado_at IS NULL
       AND m.tipo = 'ENTRADA'
       AND coalesce(m.forma_pago, 'EFECTIVO') = 'EFECTIVO'
       AND m.created_at < now() - INGRESO_TARDE
       AND m.created_at > now() - interval '2 days'
       AND m.envio_avisado_at IS NULL
  LOOP
    UPDATE public.caja_movimientos_portal SET envio_avisado_at = now() WHERE id = r.id;
    IF coalesce(cardinality(v_dest), 0) > 0 THEN
      PERFORM public.notify_employees(
        v_dest, 'SISTEMA_INGRESO_SIN_CAJA',
        'Un ingreso no llegó a la caja',
        coalesce(r.sala, 'Una sala') || ': el ingreso de $' || to_char(r.monto, 'FM999990.00')
          || ' («' || left(coalesce(r.concepto, ''), 40) || '») se anotó a las '
          || to_char(r.created_at AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')
          || ' y todavía no está en la caja. Se puede mandar desde Mi caja con «Mandar a la caja».',
        '/caja',
        jsonb_build_object('movimiento_id', r.id),
        true, NULL);
    END IF;
  END LOOP;

  -- 5. Retención: las fallas son diagnóstico, no historia de negocio.
  DELETE FROM public.fallas_de_servicio WHERE created_at < now() - interval '90 days';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vigilar_servicios() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vigilar_servicios() TO service_role;
