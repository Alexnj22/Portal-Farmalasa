SET lock_timeout = '5s';

-- ── EL ESTADO DE LA CAJA SE CONTESTA SIN SALIR DEL PORTAL ────────────────────
--
-- Entrar a /caja costaba una raspada al sistema de la caja ANTES de pintar un
-- solo dato: login → fijar sucursal → la pantalla de cajas → un panel por cada
-- caja, todo en serie. Medido sobre 813 llamadas: p50 815 ms, p90 1,427 ms,
-- p99 6,903 ms — y hasta que contestaba, la pantalla era un spinner.
--
-- Lo que iba a buscar allá ya estaba acá. De los diez campos que devuelve:
--
--   dia, cortes, quien, efectivo   ya salían de la base (la propia función los
--                                  leía de acá después de raspar el panel)
--   abierta, caja, turno,          `cortes_caja_aperturas`, que el cron de
--   apertura, desde                aperturas escribe con lo que ve en ese
--                                  mismo panel
--   registrado                     DERIVABLE — ver abajo
--   turno_corriendo                el único que no estaba, y no lo lee nadie
--
-- ── «Monto Registrado» = apertura + ventas FINALIZADAS del día ──────────────
--
-- Medido contra el espejo con las ventas cortadas a la hora del snapshot
-- (`vista_at`), 3-sep 12:30:10 SV: SEIS DE SEIS exacto al centavo.
--
--     sala 2  670.60 = 670.60      sala 27  649.54 = 649.54
--     sala 4  423.40 = 423.40      sala 28  354.65 = 354.65
--     sala 25 465.80 = 465.80      sala 29  131.05 = 131.05
--
-- Tres cosas que la medición decidió y no se pueden invertir sin volver a medir:
--
-- 1. **Las entradas y salidas NO entran.** El comentario de `operar-caja` dice
--    que `total_corte` las incluye; el residuo de las seis salas dio
--    exactamente `entradas − salidas` (sala 2: +131.00 con 131.00 de entradas;
--    sala 4: −51.03 con 45.60 y 96.63). O sea que el panel las excluye.
--
-- 2. **Sólo las FINALIZADAS**, y ése es el caso que separa las dos fórmulas.
--    El 3-sep no había ninguna anulada, así que ese día las dos daban igual.
--    Sobre los días de agosto que sí tienen una: sumando todas, la diferencia
--    es el monto de la anulada (sala 4 el 31-ago: +7.10 = la factura de 7.10;
--    sala 25 el 29-ago: +13.70); filtrando por FINALIZADA, **0.00 exacto**.
--    Es el mismo filtro que ya usa `caja_efectivo_piezas`.
--
-- 3. **El total es del DÍA, no del turno.** Verificado en aperturas de turno 2,
--    4 y 6: `monto_registrado` cuadra con las ventas de toda la fecha.
--
-- Y el número derivado es MÁS FRESCO que el que traía el panel: sale de
-- `sales_invoices`, que sincroniza cada minuto, contra los 30 del cron de
-- aperturas.

-- ── 1. «Apertura vigente» y «turno corriendo» son dos estados ───────────────
--
-- El enlace del corte sólo está mientras el turno corre; sin él el panel
-- muestra «Apertura Vigente» y un botón «Iniciar Turno». `operar-caja` ya lo
-- distinguía y era el único campo que el espejo no guardaba. Se guarda acá
-- para que la respuesta local diga lo mismo que decía la raspada.
ALTER TABLE public.cortes_caja_aperturas
  ADD COLUMN IF NOT EXISTS turno_corriendo boolean;

COMMENT ON COLUMN public.cortes_caja_aperturas.turno_corriendo IS
  'Si el turno está corriendo (hay enlace de corte en el panel) o sólo hay una apertura vigente sin turno iniciado. NULL = todavía no observado.';

-- ── 2. El estado, armado con lo que el portal ya tiene ──────────────────────
CREATE OR REPLACE FUNCTION public.caja_estado(p_branch_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ap     public.cortes_caja_aperturas%ROWTYPE;
  v_dia    date;
  v_reg    numeric;
  v_quien  text;
  v_cortes json;
  v_pz     json;
  v_efvo   numeric;
BEGIN
  -- Los MISMOS dos frenos que `operar-caja` aplica a la acción `estado`:
  -- mirar la caja es `caja_vales can_view`, y sin alcance ALL sólo la propia.
  -- Van acá dentro porque la función es DEFINER: sin ellos, cualquiera con
  -- sesión leería el efectivo de las seis salas.
  IF NOT public.auth_has_module_permission('caja_vales', 'can_view') THEN
    RETURN json_build_object('ok', false,
      'error', 'No tienes permiso para mirar la caja desde el portal.');
  END IF;
  IF public.auth_module_scope('caja_vales') IS DISTINCT FROM 'ALL'
     AND public.auth_employee_branch_id() IS DISTINCT FROM p_branch_id THEN
    RETURN json_build_object('ok', false,
      'error', 'Solo puedes mirar la caja de tu propia sala.');
  END IF;

  -- La apertura VIVA. Una sala puede llevar varios turnos en el día (se han
  -- visto seis), así que se elige por `cerrada_at is null` y no «la última»:
  -- la última cerrada es la del turno anterior y diría que la caja está abierta
  -- cuando ya no lo está.
  SELECT * INTO v_ap
    FROM public.cortes_caja_aperturas a
   WHERE a.branch_id = p_branch_id AND a.cerrada_at IS NULL
   ORDER BY a.abierta_el DESC, a.turno DESC
   LIMIT 1;

  -- El día que la caja tiene abierto, no el del reloj: a las once de la noche
  -- con la caja sin cerrar el calendario ya cambió de día y la caja no. Es la
  -- misma regla —y el mismo respaldo— que traía `operar-caja`.
  v_dia := coalesce(v_ap.abierta_el, (now() - interval '6 hours')::date);

  -- Los cortes del día. Van igual que antes: la pantalla los necesita para no
  -- ofrecer el cierre cuando no hay ninguno.
  SELECT coalesce(json_agg(to_json(c) ORDER BY c.hora), '[]'::json) INTO v_cortes
    FROM (SELECT id, tipo, hora, total_declarado, esperado, diferencia_erp, estado
            FROM public.cortes_caja
           WHERE branch_id = p_branch_id AND fecha = v_dia) c;

  IF v_ap.branch_id IS NULL THEN
    -- Sin apertura viva no hay monto que informar. `null` y no `0`: cero sería
    -- «la caja está vacía», y la respuesta es «no hay caja abierta».
    RETURN json_build_object(
      'ok', true, 'abierta', false, 'caja', NULL, 'turno', NULL,
      'turno_corriendo', false, 'registrado', NULL, 'apertura', NULL,
      'quien', NULL, 'desde', NULL, 'dia', v_dia, 'cortes', v_cortes,
      'efectivo', NULL, 'frescura_seg', NULL);
  END IF;

  -- QUIÉN ABRIÓ sale del portal y de ningún otro lado. El panel del origen da
  -- el nombre de la CUENTA con la que la sala abre siempre —«MI CAJA LA
  -- POPULAR»— y firmaría el acto con el nombre de alguien que no lo hizo. Se
  -- amarra por la apertura concreta, nunca por «la última de la sala».
  SELECT e.name INTO v_quien
    FROM public.caja_aperturas_del_portal p
    JOIN public.employees e ON e.id = p.abierta_por
   WHERE p.branch_id = p_branch_id AND p.erp_apertura_id = v_ap.erp_apertura_id;

  -- El «Monto Registrado» del panel, derivado. Ver el encabezado: apertura más
  -- las ventas FINALIZADAS de la fecha, sin entradas ni salidas.
  SELECT round(coalesce(v_ap.monto_apertura, 0)
              + coalesce(sum(s.total), 0), 2) INTO v_reg
    FROM public.sales_invoices s
   WHERE s.branch_id = p_branch_id AND s.fecha = v_dia AND s.estado = 'FINALIZADA';

  -- Cuánto de eso son BILLETES. El mismo canónico que usaba la Edge Function:
  -- se le quitan las ventas que no fueron en efectivo y lo ya embolsado, y se
  -- le devuelve lo que ya se anotó como vale para no restarlo dos veces.
  v_pz := public.caja_efectivo_piezas(p_branch_id, v_dia);
  v_efvo := round(greatest(0, v_reg
              - (v_pz->>'ventas_no_efectivo')::numeric
              - (v_pz->>'embolsado_hoy')::numeric
              + (v_pz->>'vales_ya_anotados')::numeric), 2);

  RETURN json_build_object(
    'ok', true,
    'abierta', true,
    'caja', v_ap.caja_erp,
    'turno', v_ap.turno,
    -- Sin observación todavía se responde `true`, que es el mismo respaldo que
    -- traía `operar-caja` (`turnoCorriendo ?? true`).
    'turno_corriendo', coalesce(v_ap.turno_corriendo, true),
    'registrado', v_reg,
    'apertura', v_ap.monto_apertura,
    'quien', v_quien,
    'desde', v_ap.abierta_a,
    'dia', v_dia,
    'cortes', v_cortes,
    'efectivo', v_efvo,
    'efectivo_piezas', json_build_object(
      'registrado', v_reg,
      'ventas_no_efectivo', (v_pz->>'ventas_no_efectivo')::numeric,
      'embolsado_hoy',      (v_pz->>'embolsado_hoy')::numeric,
      'vales_ya_anotados',  (v_pz->>'vales_ya_anotados')::numeric),
    -- Cuántos segundos hace que alguien MIRÓ el panel. Es lo que le deja al
    -- llamador decidir si le alcanza con esta respuesta o si además pregunta al
    -- origen: los campos derivados de ventas están al minuto, pero que la caja
    -- siga abierta sólo lo sabe quien vio el panel.
    'frescura_seg', round(extract(epoch FROM now() - v_ap.vista_at)));
END;
$$;

COMMENT ON FUNCTION public.caja_estado(integer) IS
  'El estado de la caja de una sala armado con datos del portal, sin raspar el sistema de la caja. Reemplaza la acción `estado` de `operar-caja` en el camino crítico de /caja.';

REVOKE EXECUTE ON FUNCTION public.caja_estado(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.caja_estado(integer) TO authenticated, service_role;
