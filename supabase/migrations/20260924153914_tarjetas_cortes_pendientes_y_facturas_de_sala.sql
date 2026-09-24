SET lock_timeout = '5s';

-- Tercera tanda de tarjetas de la campana (usuario, 24-sep): cortes sin
-- confirmar y facturas de sala. Los dos llevan la sala en el título y mandan
-- en el metadata la lista que dibuja la tarjeta. El cuerpo de la factura de
-- sala agrupa las iguales en vez de repetir la misma línea; el de cortes dice
-- la hora en 12 horas.

CREATE OR REPLACE FUNCTION public.avisar_cortes_pendientes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_sala   record;
  v_dest   uuid[];
  v_meta   jsonb;
  v_titulo text;
  v_cuerpo text;
  v_n      integer;
  v_total  integer := 0;
BEGIN
  FOR v_sala IN
    WITH pendientes AS (
      -- Sólo tipo `C`: el cierre del día (Z) nace PENDIENTE y muere PENDIENTE
      -- —no se confirma ni se descarta—, así que contarlo sería inventar
      -- trabajo que nadie puede hacer. Son 6 por día, uno por sala: sin este
      -- filtro el aviso saldría todas las mañanas para siempre.
      SELECT c.id, c.branch_id, c.fecha, c.hora, c.employee_id, c.total_declarado,
             c.diferencia_erp, c.tk_total_caja, c.tipo
        FROM public.cortes_caja c
       WHERE c.tipo   = 'C'
         AND c.estado = 'PENDIENTE'
         AND c.fecha BETWEEN v_hoy - 7 AND v_hoy - 1
    ),
    detalle AS (
      -- Cuántos de cada día, para que el cuerpo diga si es lo de anoche o una
      -- pila de tres días.
      SELECT branch_id,
             string_agg(txt, ', ' ORDER BY fecha DESC) AS txt
        FROM (SELECT branch_id, fecha,
                     count(*) || ' del ' || to_char(fecha, 'DD/MM') AS txt
                FROM pendientes
               GROUP BY branch_id, fecha) d
       GROUP BY branch_id
    )
    -- Un aviso por sala, no uno por corte: seis pings a las 7:30 son el ruido
    -- que enseña a ignorar la campana.
    SELECT p.branch_id,
           b.name                                   AS sala,
           count(*)::int                            AS cuantas,
           array_agg(p.id ORDER BY p.fecha, p.hora) AS ids,
           min(p.fecha)                             AS fecha_unica,
           max(to_char(p.hora, 'HH24:MI'))          AS hora_unica,
           d.txt                                    AS detalle,
           -- Cada corte, para la tarjeta (24-sep): quién, cuándo y cuánto.
           jsonb_agg(jsonb_build_object(
             'id',       p.id,
             'fecha',    p.fecha,
             'hora',     to_char(p.hora, 'HH24:MI'),
             'quien',    e.name,
             'quien_id', p.employee_id,
             'quien_foto', e.photo_url,
             'tramo',    CASE WHEN public.corte_no_conto_efectivo(p.tipo, p.total_declarado,
                                                               p.diferencia_erp, p.tk_total_caja)
                              THEN NULL ELSE public.corte_tramo(p.id) END)
             ORDER BY p.fecha, p.hora)              AS lista
      FROM pendientes p
      LEFT JOIN public.employees e ON e.id = p.employee_id
      JOIN public.branches b ON b.id = p.branch_id
      JOIN detalle       d ON d.branch_id = p.branch_id
     GROUP BY p.branch_id, b.name, d.txt
     ORDER BY p.branch_id
  LOOP
    -- Uno por sala y por día, aunque el trabajo se corra dos veces. La marca es
    -- el propio aviso: no hace falta una tabla para recordar que ya se mandó.
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.type = 'CORTE_PENDIENTE'
         AND n.created_at >= now() - interval '20 hours'
         AND n.metadata->>'check_key' = v_sala.branch_id || ':' || v_hoy
    ) THEN
      CONTINUE;
    END IF;

    v_dest := public.destinatarios_de_cortes(v_sala.branch_id);
    CONTINUE WHEN v_dest IS NULL;

    -- La sala va en el título, como en el aviso de corte (24-sep).
    v_titulo := v_sala.sala || ' · '
             || CASE WHEN v_sala.cuantas = 1
                     THEN 'Quedó un corte sin confirmar'
                     ELSE 'Quedaron ' || v_sala.cuantas || ' cortes sin confirmar' END;

    v_cuerpo := v_sala.sala || ' — '
             || CASE WHEN v_sala.cuantas = 1
                     THEN 'el de las ' || public.hora_12(v_sala.hora_unica::time)
                          || ' del ' || to_char(v_sala.fecha_unica, 'DD/MM')
                          || '. Hay que confirmarlo o descartarlo.'
                     ELSE v_sala.detalle
                          || '. Hay que confirmarlos o descartarlos.' END;

    -- `corte_id` sólo cuando hay uno: es lo que hace que la campana ofrezca
    -- «Confirmar» ahí mismo. Con varios el aviso lleva a la pantalla a
    -- propósito — el tramo de cada corte es la resta contra el confirmado
    -- anterior, así que resolverlos sueltos y en desorden es justo lo que no
    -- hay que hacer.
    v_meta := jsonb_build_object(
      'check_key', v_sala.branch_id || ':' || v_hoy,
      'branch_id', v_sala.branch_id,
      'cuantas',   v_sala.cuantas,
      'corte_ids', to_jsonb(v_sala.ids),
      'sala',      v_sala.sala,
      'lista',     v_sala.lista
    );
    IF v_sala.cuantas = 1 THEN
      v_meta := v_meta || jsonb_build_object(
        'corte_id', v_sala.ids[1],
        'fecha',    v_sala.fecha_unica,
        'hora',     v_sala.hora_unica
      );
    END IF;

    v_n := public.notify_employees(
      v_dest,
      'CORTE_PENDIENTE',
      v_titulo,
      v_cuerpo,
      '/cortes',
      v_meta,
      true,            -- push: es una tarea sin hacer, no una noticia
      v_sala.branch_id
    );

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_facturas_de_sala()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala     record;
  v_destinos uuid[];
  v_n        integer;
  v_titulo   text;
  v_cuerpo   text;
  v_total    integer := 0;
BEGIN
  FOR v_sala IN
    WITH nuevas AS (
      -- `DISTINCT ON (d.id)`: si dos reglas por línea llegaran a casar con el
      -- mismo documento, avisarlo dos veces sería avisar de más — y la marca
      -- es por documento, no por regla.
      SELECT DISTINCT ON (d.id)
             d.id, d.monto_total, d.fecha_emision, r.etiqueta, l.branch_id
        FROM public.purchase_dte_documents d
        JOIN public.purchase_claim_rules r
          ON r.activo AND r.asignacion = 'linea'
         AND (r.emisor_nit  IS NULL OR d.emisor_nit = r.emisor_nit)
         AND (r.item_patron IS NULL OR d.items_norm ILIKE '%' || r.item_patron || '%')
        JOIN public.purchase_claim_lines l
          ON l.rule_id = r.id
         AND l.linea   = public.linea_telefonica_de(d.items_text)
       WHERE NOT d.invalidado
         -- Ventana corta: la marca evita repetir, pero sin ventana el PRIMER
         -- barrido avisaría toda la historia de una vez.
         AND d.created_at >= now() - interval '7 days'
         -- Si alguien ya la tomó, no hay nada que avisar.
         AND NOT EXISTS (SELECT 1 FROM public.purchase_dte_claims c
                          WHERE c.document_id = d.id AND c.released_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.purchase_claim_avisos a
                          WHERE a.document_id = d.id)
       ORDER BY d.id, r.orden, r.id
    )
    -- Agrupado por sala: dos facturas el mismo día son UN aviso, no dos pings.
    SELECT n.branch_id,
           (SELECT b.name FROM public.branches b WHERE b.id = n.branch_id) AS sala,
           count(*)            AS cuantas,
           sum(monto_total)    AS total,
           -- Cada factura, para la tarjeta (24-sep): qué, de qué fecha y cuánto.
           jsonb_agg(jsonb_build_object('etiqueta', etiqueta, 'monto', monto_total,
                                        'fecha', fecha_emision) ORDER BY fecha_emision DESC) AS lista,
           -- El cuerpo agrupa las iguales: «2 × Recarga Movistar · $199.98», y
           -- no la misma línea repetida.
           (SELECT string_agg(CASE WHEN g.n > 1 THEN g.n || ' × ' ELSE '' END
                              || g.etiqueta || ' · $' || to_char(g.monto, 'FM999,999,990.00'), '  ·  ')
              FROM (SELECT x.etiqueta, count(*) AS n, sum(x.monto_total) AS monto
                      FROM nuevas x WHERE x.branch_id = n.branch_id GROUP BY x.etiqueta) g) AS agrupado,
           array_agg(id)       AS ids,
           string_agg(etiqueta || ' · $' || to_char(monto_total, 'FM999999990.00'),
                      '  ·  ' ORDER BY fecha_emision DESC) AS detalle
      FROM nuevas n
     GROUP BY n.branch_id
  LOOP
    SELECT array_agg(t.employee_id) INTO v_destinos
      FROM public.empleados_en_turno(v_sala.branch_id::integer) t;

    v_titulo := coalesce(v_sala.sala || ' · ', '')
             || CASE WHEN v_sala.cuantas = 1
                     THEN 'Llegó una factura para cargar'
                     ELSE v_sala.cuantas || ' facturas llegaron para cargar' END;
    v_cuerpo := v_sala.agrupado || ' — tomala desde Facturas de mi sala.';

    IF v_destinos IS NULL THEN
      -- Nadie en turno (feriado, antes de abrir, roster sin publicar). Va a la
      -- sala entera: un aviso que no le llega a nadie es peor que no mandarlo.
      v_n := public.notify_branch(
        v_sala.branch_id::integer, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', false,
                           'sala', v_sala.sala, 'total', v_sala.total, 'lista', v_sala.lista), true);
    ELSE
      v_n := public.notify_employees(
        v_destinos, 'FACTURA_SALA', v_titulo, v_cuerpo, '/home',
        jsonb_build_object('document_ids', v_sala.ids, 'en_turno', true,
                           'sala', v_sala.sala, 'total', v_sala.total, 'lista', v_sala.lista), true,
        v_sala.branch_id::integer);
    END IF;

    -- La marca se escribe SIEMPRE, aunque no le haya llegado a nadie: si no,
    -- una sala sin personal activo haría reintentar el mismo aviso cada día
    -- para siempre. Cuántos lo recibieron queda guardado, que es lo que permite
    -- notar el caso en vez de suponerlo.
    INSERT INTO public.purchase_claim_avisos (document_id, branch_id, destinatarios)
    SELECT t.id, v_sala.branch_id, COALESCE(v_n, 0)
      FROM unnest(v_sala.ids) AS t(id)
    ON CONFLICT (document_id) DO NOTHING;

    v_total := v_total + COALESCE(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;
