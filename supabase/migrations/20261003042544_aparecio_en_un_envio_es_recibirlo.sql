SET lock_timeout = '5s';

-- «Apareció» en un envío ES recibirlo.
--
-- Un renglón de envío que la sala marca «No llegó» deja su movimiento de ida
-- despachado y sin recibir: salió del estante de una sala y no entró al de la
-- otra. Mientras la caja no esté, eso es la verdad. El hueco estaba en el
-- cierre: `cerrar_faltante('aparecio')` sólo cambiaba el estado del faltante,
-- así que la caja aparecía, quedaba en el estante, y el sistema la seguía
-- teniendo en tránsito — fuera del inventario de las DOS salas, sin poder
-- venderse. Pasó con la bolsa E00212 (Salud 5 → Salud 3, cuatro productos,
-- cerrada como aparecida el 2-oct).
--
-- En una SOLICITUD el hueco no existe: ahí el faltante se declara después de
-- que el sistema ya le puso el producto a la sala que recibe, y «apareció» no
-- tiene nada que mover. Por eso la guarda mira el renglón del envío y no la
-- familia a secas.
--
-- La recepción la hace `enviar-producto-erp` (acción `recibir_aparecido`),
-- que es quien tiene la sesión del sistema y el candado del envío. Esta
-- función sólo se niega a cerrar sin recibir y contesta `RECIBIR_EN_CAJA`, que
-- el núcleo (`cerrarFaltante`) traduce en la llamada a la función.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · Cerrar: «apareció» no cierra un envío que sigue en tránsito
-- ══════════════════════════════════════════════════════════════════════════
-- Partiendo de la definición VIVA del 2026-10-02; el único cambio es la guarda
-- antes del UPDATE.
CREATE OR REPLACE FUNCTION public.cerrar_faltante(p_id uuid, p_estado text, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    bf      public.bolsa_faltante%ROWTYPE;
    v_yo    uuid;
    v_sala  integer;
    v_ok    boolean;
BEGIN
    IF p_estado NOT IN ('aparecio', 'no_aparecio') THEN
        RAISE EXCEPTION 'Un faltante se cierra en aparecio o no_aparecio, no en %.', p_estado;
    END IF;

    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_can_edit_any(ARRAY['traslados']) THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para resolver faltantes de traslado.';
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RAISE EXCEPTION 'No existe ese faltante.';
    END IF;
    -- Ya cerrado: no se vuelve a cerrar ni se cambia el desenlace. Reabrirlo es
    -- una decisión de otra persona y otro momento; pisarlo acá borraría quién
    -- dijo qué.
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'estado', bf.estado);
    END IF;

    SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (
        public.auth_es_supervision()
        OR public.auth_can_edit_scope_all(ARRAY['traslados'])
        OR v_sala IS NOT DISTINCT FROM bf.origen_branch_id
        OR v_sala IS NOT DISTINCT FROM bf.destino_branch_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: este faltante lo resuelven las salas que lo vivieron.';
    END IF;

    -- «No apareció» sin una palabra es el cierre que no dice nada, y es
    -- justamente el que alguien va a tener que leer dentro de un mes.
    IF p_estado = 'no_aparecio' AND nullif(btrim(coalesce(p_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Para cerrarlo como no aparecido hay que escribir qué se hizo.';
    END IF;

    -- «Apareció» en un renglón de envío que sigue en tránsito NO se cierra
    -- acá: primero hay que recibir el movimiento, y eso lo hace la función que
    -- habla con el sistema. Cerrarlo sin recibir era el hueco.
    IF p_estado = 'aparecio' AND bf.familia = 'envio' AND EXISTS (
        SELECT 1 FROM public.envio_linea el
         WHERE el.request_id = bf.request_id
           AND el.posicion   = bf.posicion
           AND el.estado     = 'no_llego'
           AND el.id_traslado IS NOT NULL
    ) THEN
        RETURN json_build_object('ok', false, 'codigo', 'RECIBIR_EN_CAJA',
                                 'request_id', bf.request_id);
    END IF;

    UPDATE public.bolsa_faltante
       SET estado      = p_estado,
           resolucion  = nullif(btrim(coalesce(p_nota, '')), ''),
           resuelto_por = v_yo,
           resuelto_at = now()
     WHERE id = p_id AND estado = 'abierto'
    RETURNING true INTO v_ok;

    RETURN json_build_object('ok', coalesce(v_ok, false), 'estado', p_estado);
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · La lista dice qué sigue en tránsito
-- ══════════════════════════════════════════════════════════════════════════
-- `falta_ingresar`: el faltante es de un envío cuyo renglón sigue «no llegó»
-- con su movimiento sin recibir. Abierto, lo resuelve «Apareció»; cerrado
-- como aparecido —antes de este arreglo—, la pantalla ofrece ingresarlo.
--
-- Y el número de movimiento de un envío vive en su RENGLÓN: cada renglón es su
-- propio traslado. La cabecera sólo lo tiene en las solicitudes.
--
-- Sigue sin parámetros, así que la trampa del plan genérico (regla 4) no aplica.
CREATE OR REPLACE FUNCTION public.get_faltantes_de_bolsa()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.declarado_at DESC), '[]'::json)
    FROM (
      SELECT bf.id, bf.request_id, bf.familia, bf.posicion,
             bf.erp_product_id, bf.descripcion, bf.presentacion_tipo,
             bf.cantidad, bf.nota, bf.estado, bf.resolucion,
             bf.declarado_at, bf.resuelto_at,
             bf.origen_branch_id, bf.destino_branch_id,
             bo.name AS origen_branch_name,
             bd.name AS destino_branch_name,
             ed.name AS declarado_por_nombre,
             er.name AS resuelto_por_nombre,
             r.metadata->>'codigo_bolsa'                  AS codigo_bolsa,
             coalesce(el.id_traslado,
                      r.metadata->'erp_traslado'->>'id_traslado') AS id_traslado,
             coalesce(r.metadata->>'motivo_tipo', '')     AS motivo_tipo,
             (bf.familia = 'envio'
              AND el.estado = 'no_llego'
              AND el.id_traslado IS NOT NULL
              AND bf.estado <> 'no_aparecio')             AS falta_ingresar
        FROM public.bolsa_faltante bf
        LEFT JOIN public.approval_requests r ON r.id = bf.request_id
        LEFT JOIN public.envio_linea el
               ON bf.familia = 'envio'
              AND el.request_id = bf.request_id
              AND el.posicion   = bf.posicion
        LEFT JOIN public.branches  bo ON bo.id = bf.origen_branch_id
        LEFT JOIN public.branches  bd ON bd.id = bf.destino_branch_id
        LEFT JOIN public.employees ed ON ed.id = bf.declarado_por
        LEFT JOIN public.employees er ON er.id = bf.resuelto_por
       WHERE bf.estado = 'abierto'
          OR bf.resuelto_at > now() - interval '30 days'
          -- Lo que sigue en tránsito no se esconde a los 30 días.
          OR (bf.familia = 'envio' AND el.estado = 'no_llego'
              AND el.id_traslado IS NOT NULL AND bf.estado = 'aparecio')
    ) t;
$function$;
