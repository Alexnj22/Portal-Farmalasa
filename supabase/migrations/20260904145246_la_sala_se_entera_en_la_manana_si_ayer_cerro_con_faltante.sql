SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- A las 8 de la mañana: si ayer la caja cerró con faltante, la sala se entera.
--
-- Pedido del usuario (2026-09-04): «si el día anterior el corte tuvo
-- diferencias, avisa en la mañana a las 8 a la sucursal».
--
-- ── Qué mira: cómo CERRÓ la caja ───────────────────────────────────────────
-- El último corte CONFIRMADO del día, con `corte_diferencia` — el canónico, y
-- exactamente la misma definición que usa `avisar_cierre_del_dia` para decir
-- la diferencia de cada sala. Los cortes del día se suman, así que el último
-- confirmado lleva el acumulado: es «con cuánto cerró la caja», que es la
-- pregunta de la mañana. No es el tramo de un corte suelto, que contesta otra
-- cosa.
--
-- ── El umbral es CUALQUIER cifra negativa (decisión del usuario) ───────────
-- `dif` viene redondeada a dos decimales, así que «negativa» es <= -0.01 — el
-- mismo corte que usa `severidad` para pintar «Faltante» en la tarjeta. La
-- campana y la pantalla no se pueden contradecir.
--
-- ── Este aviso va a sonar MUY poco, y eso está medido ──────────────────────
-- Sobre los 14 días previos: 84 días-sala con corte confirmado, y **uno solo**
-- cerró en negativo (−$0.01). El motivo no es que no pasen faltantes: es que
-- cuando un corte no cuadra, la sala lo DESCARTA y lo vuelve a hacer — 188
-- descartados contra 172 confirmados, y entre los descartados hay 45 con
-- faltante de $1 o más (el peor, −$501.14).
--
-- O sea que el silencio de este aviso es el resultado esperado, no una señal
-- de que esté roto. Se escribe acá porque «no llegó» y «no hay nada que
-- avisar» se ven idénticos, y sin esta nota la primera sospecha —con razón—
-- sería que la función dejó de correr. Si alguna vez se quiere ver el faltante
-- que apareció DURANTE el día aunque después se rehiciera el corte, eso es
-- otra pregunta y otro aviso: hay que mirar los descartados.
--
-- ── Dos frenos, y ninguno sobra ────────────────────────────────────────────
-- · **Ya se resolvió**: si el corte tiene una fila viva en
--   `cortes_caja_diferencias`, alguien ya la registró con su vía y su causa.
--   Volver a pedirlo es la definición de nagging.
-- · **Ya se avisó**: la marca va en `avisos_emitidos` y no en la campana. Un
--   `NOT EXISTS … FROM notifications` pregunta «¿todavía la tiene?», y quien
--   vacía su campana lo recibe de nuevo — es lo que hizo salir dos veces el
--   cierre de agosto. La marca es por SALA (`recipient_id` en NULL, que el
--   índice único trata como un valor): el aviso se manda a la sala entera de
--   una sola vez.
--
-- Sin corte confirmado ayer no se dice nada: `NULL` no es cero, y no saber con
-- cuánto cerró no es haber cerrado en cero. Ese caso ya lo cubre el aviso de
-- las 7:30, que nombra los cortes que quedaron sin confirmar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.avisar_diferencia_de_ayer(p_fecha date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date - 1);
  v_sala  record;
  v_dest  uuid[];
  v_clave text;
  v_monto text;
  v_n     integer := 0;
BEGIN
  FOR v_sala IN
    WITH ult AS (
      -- El último confirmado de la sala ese día. Un descartado no cierra nada:
      -- por eso la condición de estado y no sólo la hora.
      SELECT DISTINCT ON (c.branch_id) c.branch_id, c.id, c.hora
        FROM public.cortes_caja c
       WHERE c.tipo = 'C' AND c.estado = 'CONFIRMADO' AND c.fecha = v_fecha
       ORDER BY c.branch_id, c.hora DESC, c.id DESC
    )
    SELECT u.branch_id, u.id AS corte_id, u.hora, b.name AS sala,
           round(public.corte_diferencia(c.total_declarado, c.diferencia_erp, c.tk_total_caja,
                                         c.tk_subtotal, c.tk_vales, c.tk_cobros_credito,
                                         c.cobros_portal_efectivo), 2) AS dif
      FROM ult u
      JOIN public.cortes_caja c ON c.id = u.id
      JOIN public.branches    b ON b.id = u.branch_id
     ORDER BY b.name
  LOOP
    CONTINUE WHEN v_sala.dif IS NULL OR v_sala.dif >= 0;

    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                           WHERE d.corte_id = v_sala.corte_id AND d.anulada_at IS NULL);

    v_clave := 'CORTE_DIF_AYER:' || v_fecha::text || ':' || v_sala.branch_id;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.avisos_emitidos a
                           WHERE a.clave = v_clave AND a.recipient_id IS NULL);

    -- Los de la sala que tienen el módulo. El mismo helper que usan los otros
    -- dos avisos de cortes: escrito aparte, un día uno alcanza a alguien y el
    -- otro no, sin que nada lo delate.
    v_dest := public.destinatarios_de_cortes(v_sala.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    v_monto := '$' || to_char(abs(v_sala.dif), 'FM999,999,990.00');

    PERFORM public.notify_employees(
      v_dest,
      'CORTE_DIFERENCIA_AYER',
      'Ayer la caja cerró con ' || v_monto || ' de faltante',
      v_sala.sala || ' — el corte de las ' || to_char(v_sala.hora, 'HH24:MI')
        || ' cerró ' || v_monto || ' abajo de lo esperado. Hay que revisarlo y '
        || 'registrar la diferencia.',
      '/cortes',
      jsonb_build_object(
        'corte_id',   v_sala.corte_id,
        'branch_id',  v_sala.branch_id,
        'fecha',      v_fecha,
        'hora',       to_char(v_sala.hora, 'HH24:MI'),
        'diferencia', v_sala.dif
      ),
      true,            -- push: es dinero que falta, no es informativo
      v_sala.branch_id
    );

    INSERT INTO public.avisos_emitidos (clave, recipient_id)
    VALUES (v_clave, NULL)
    ON CONFLICT DO NOTHING;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_diferencia_de_ayer(date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_diferencia_de_ayer(date) TO service_role;

-- 14:00 UTC = 8:00 en El Salvador. Media hora después del aviso de pendientes
-- de las 7:30, y a propósito: primero se nombra lo que quedó SIN CONFIRMAR
-- —que es la mitad de los casos en que no hay cifra que dar— y después lo que
-- cerró con faltante. Al revés, la sala recibiría el segundo aviso sobre un día
-- cuyo corte todavía no firmó.
SELECT cron.schedule(
  'cortes-diferencia-de-ayer-0800-sv',
  '0 14 * * *',
  $$SELECT public.avisar_diferencia_de_ayer()$$
);
