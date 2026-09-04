SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El aviso del faltante lleva CON QUÉ dibujar su tarjeta.
--
-- Pedido del usuario (2026-09-04): «quiero las notificaciones más modernas, esa
-- nueva no me gustó, la de abajo es más informativa, no sólo texto» — la de
-- abajo es `CIERRE_DEL_DIA`, que dibuja anillo, montos y barras por sala
-- porque su metadata trae con qué.
--
-- Ésta traía sólo `diferencia`, y con un número solo no hay nada que dibujar:
-- la campana no tenía más remedio que caer a su fila de texto.
--
-- ── Las tres que se agregan, y por qué esas ────────────────────────────────
-- · `sala` — el nombre. Estaba SÓLO dentro del cuerpo en prosa, así que
--   pintarlo aparte obligaba a la pantalla a recortar una frase, y una frase
--   que se recorta con una expresión regular se rompe el día que cambie.
-- · `contado` y `esperado` — los dos números que hacen legible la diferencia.
--   Un «faltan $9.85» no dice si es sobre $300 o sobre $3,000.
--
-- **`esperado` se DERIVA de los otros dos** (`declarado - diferencia`) y no se
-- lee de una columna aparte. Es lo que garantiza que los tres cierren en la
-- tarjeta: el esperado crudo del comprobante NO es contra el que se mide —
-- `corte_diferencia` le suma el efectivo de los cobros del portal que el
-- comprobante no contó—, así que pintarlo al lado de la diferencia daría una
-- resta que no da. Es el mismo cuidado que `esperadoUsado` en el detalle del
-- corte.
--
-- ── No expone ningún monto nuevo ───────────────────────────────────────────
-- Se verificó antes de escribirlo: `CorteDetalleModal` ya muestra «Debía haber
-- en caja» y lo declarado sin mirar el alcance, así que la sala ve esos dos
-- números en el corte de todos modos. El conteo a ciegas protege el ANTES de
-- contar, y esto es un corte de ayer, ya confirmado.
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
           c.total_declarado AS contado,
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
        'sala',       v_sala.sala,
        'fecha',      v_fecha,
        'hora',       to_char(v_sala.hora, 'HH24:MI'),
        'diferencia', v_sala.dif,
        'contado',    v_sala.contado,
        -- Derivado, no leído: así los tres números de la tarjeta cierran.
        'esperado',   round(v_sala.contado - v_sala.dif, 2)
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
