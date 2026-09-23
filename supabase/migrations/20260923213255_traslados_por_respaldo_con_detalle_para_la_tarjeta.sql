SET lock_timeout = '5s';

-- El aviso de «traslados que salieron mientras estaban cerrados» pasa a tarjeta
-- (usuario, 23-sep: «rediseñalas para que sean modernas»). El cuerpo era una
-- lista de destinos repetidos que se cortaba en el tercer renglón —«hacia La
-- Popular, Salud 3, Salud 1, La Popular, Salud 3…»— sin decir QUÉ salió.
--
-- Ahora el metadata lleva cada traslado (qué, cuánto, a dónde, quién y a qué
-- hora) y la tarjeta lo dibuja en renglones. El cuerpo queda corto: es lo que
-- se lee en el push y donde la tarjeta no se sabe pintar. De paso, las tildes
-- que faltaban («Salio», «despacho»).

CREATE OR REPLACE FUNCTION public.avisar_traslados_por_respaldo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   record;
  v_n      integer;
  v_total  integer := 0;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_sala IN
    WITH sin_avisar AS (
      SELECT ar.id,
             (ar.metadata->>'origen_branch_id')::integer AS origen,
             coalesce(nullif(ar.metadata->>'branch_name', ''), 'otra sala') AS destino,
             coalesce(nullif(ar.metadata->'erp_traslado'->>'by_name', ''), 'La sala de al lado') AS quien,
             nullif(ar.metadata->'erp_traslado'->>'by', '') AS quien_id,
             ar.metadata->'erp_traslado'->>'at' AS hora,
             coalesce((ar.metadata->>'total_unidades')::numeric,
                      (ar.metadata->'erp_traslado'->>'unidades')::numeric) AS unidades,
             (ar.metadata->'erp_traslado'->>'total')::numeric AS total,
             ar.metadata->'items'->0->>'descripcion' AS producto,
             greatest(jsonb_array_length(coalesce(ar.metadata->'items', '[]'::jsonb)) - 1, 0) AS mas,
             ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status = 'APPROVED'
         AND (ar.metadata->'erp_traslado'->>'por_respaldo')::boolean IS TRUE
         AND ar.updated_at >= now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                          WHERE a.clave = 'TRASLADO_RESPALDO:' || ar.id::text)
    )
    SELECT origen,
           count(*)                                        AS cuantos,
           to_jsonb(array_agg(id)::text[])                 AS ids,
           count(DISTINCT quien)                           AS n_quienes,
           min(quien)                                      AS un_quien,
           coalesce(sum(unidades), 0)                      AS unidades,
           jsonb_agg(jsonb_build_object(
             'id',       id,
             'destino',  destino,
             'producto', producto,
             'mas',      mas,
             'unidades', unidades,
             'total',    total,
             'quien',    quien,
             'quien_id', quien_id,
             'hora',     hora) ORDER BY updated_at)      AS traslados
      FROM sin_avisar
     WHERE origen IS NOT NULL
     GROUP BY origen
  LOOP
    v_titulo := CASE WHEN v_sala.cuantos = 1
                     THEN 'Salió un traslado mientras estaban cerrados'
                     ELSE v_sala.cuantos || ' traslados salieron mientras estaban cerrados' END;
    v_cuerpo := CASE WHEN v_sala.n_quienes = 1 THEN v_sala.un_quien
                     ELSE v_sala.un_quien || ' y ' || (v_sala.n_quienes - 1)
                          || CASE WHEN v_sala.n_quienes = 2 THEN ' persona más' ELSE ' personas más' END END
             || CASE WHEN v_sala.cuantos = 1 THEN ' lo despachó' ELSE ' los despacharon' END
             || ' por ustedes. Revisen que la existencia cuadre.';

    v_n := public.notify_branch(
             v_sala.origen, 'TRASLADO_RESPALDO', v_titulo, v_cuerpo, '/traslados',
             jsonb_build_object('request_ids', v_sala.ids,
                                'unidades',    v_sala.unidades,
                                'traslados',   v_sala.traslados), true);

    -- Sólo se marca lo que efectivamente salió: si la sala no tenía a quién
    -- avisarle, mañana se reintenta (como antes).
    IF coalesce(v_n, 0) > 0 THEN
      INSERT INTO public.avisos_emitidos (clave, recipient_id)
      SELECT 'TRASLADO_RESPALDO:' || t, NULL::uuid
        FROM jsonb_array_elements_text(v_sala.ids) t
      ON CONFLICT DO NOTHING;
    END IF;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;
