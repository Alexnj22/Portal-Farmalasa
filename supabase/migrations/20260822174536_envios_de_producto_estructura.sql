SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- ENVIAR PRODUCTO A OTRA SALA — la estructura
--
-- Es el traslado al REVÉS. Hasta hoy el portal sólo sabía PEDIR: la sala que no
-- tiene abre una solicitud y la que tiene confirma. Pero el movimiento más común
-- de una bodega no es ése —es empujar: un producto nuevo que hay que repartir, o
-- uno próximo a vencer que en esta sala no rota y en otra sí—. Eso se hacía por
-- fuera del portal.
--
-- ── Por qué la decisión llega DESPUÉS de que el producto salió ──────────────
-- Porque el producto sale con el motorista, no con un botón. Quien envía arma la
-- caja y despacha; la sala de destino decide cuando la tiene enfrente. Eso
-- invierte el sentido de `status`:
--
--   PENDING  · ya salió y la sala de destino todavía no lo miró
--   APPROVED · aceptó al menos un renglón
--   REJECTED · los devolvió todos
--
-- ── Y por qué la decisión es POR RENGLÓN ───────────────────────────────────
-- Porque en el sistema de origen cada renglón ES SU PROPIO TRASLADO (igual que
-- en el pedido de Bodega desde el 2026-08-11): aceptar uno es recibir el suyo y
-- rechazar otro es devolver el suyo. Con un traslado de N líneas la pantalla de
-- recepción recibe las N juntas —lo dice `aplicar-traslado-inventario`— y un solo
-- producto dañado obligaría a devolver la caja entera.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0 · El tipo entra a la lista de tipos permitidos ───────────────────────
-- El CHECK de `type` es una lista escrita, no una convención: sin esto el
-- `insert` rebota con «violates check constraint» y nada dice cuál es el tipo
-- que falta. Lo descubrió el entorno de pruebas, que es para lo que está.
ALTER TABLE public.approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check
  CHECK (type = ANY (ARRAY['PERMIT','VACATION','SHIFT_CHANGE','OVERTIME','ADVANCE','CERTIFICATE',
                           'DISABILITY','VACATION_CHANGE','SHIFT_EXCEPTION','ANNULMENT_REQUEST',
                           'PAYMENT_CHANGE_REQUEST','VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST',
                           'INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                           'INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH']));

-- ── 1 · El tipo nuevo entra a las listas que ya existen ────────────────────
-- `es_solicitud_operativa` decide a qué pantalla lleva el aviso y qué rama del
-- RLS lo cubre; sin esto el envío caería en la de solicitudes PERSONALES, que es
-- otro permiso y otra bandeja.
CREATE OR REPLACE FUNCTION public.es_solicitud_operativa(p_type text)
 RETURNS boolean LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p_type = ANY (ARRAY[
    'ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
    'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST',
    'INVENTORY_LOAD_REQUEST', 'INVENTORY_DISCARD_REQUEST',
    'INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH'
  ]);
$function$;

-- Los avisos del envío los arma su propia función y salen CUANDO EL PRODUCTO
-- SALIÓ, no al crear la fila. Devolver NULL acá es lo que impide que el aviso
-- genérico busque a «todos los que pueden aprobar el módulo»: los destinatarios
-- de un envío son la sala de destino y nadie más.
CREATE OR REPLACE FUNCTION public.modulo_de_notificacion(p_type text)
 RETURNS text LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_type = ANY (ARRAY['INVENTORY_TRANSFER_REQUEST','INVENTORY_TRANSFER_PUSH']) THEN NULL
    ELSE coalesce(public.modulo_de_aprobacion(p_type), 'requests_personales')
  END;
$function$;

-- ── 2 · Quién ve un envío ──────────────────────────────────────────────────
-- La rama del traslado se copia tal cual y se le agrega la del envío. Son dos
-- ramas y no una sola con `IN (...)` porque la sala que decide es la CONTRARIA:
-- en el traslado el pendiente lo resuelve el ORIGEN (le piden de su sala), y en
-- el envío lo resuelve el DESTINO (le llegó una caja). La cláusula de la sala de
-- respaldo mira, en cada caso, a la sala que tiene que contestar.
--
-- Y el envío pide `can_view` donde el traslado pide `can_approve`: acá ver no es
-- decidir. Quien despacha la caja tiene que poder seguirla aunque no sea quien
-- confirma del otro lado — y el permiso de decidir se cobra en la Edge Function,
-- que es la única que escribe.
DROP POLICY IF EXISTS approval_requests_select ON public.approval_requests;
CREATE POLICY approval_requests_select ON public.approval_requests
FOR SELECT USING (
  (employee_id = (SELECT public.auth_employee_id()))
  OR (public.es_solicitud_operativa(type)
      AND (SELECT public.auth_has_module_permission('requests','can_view'))
      AND CASE (SELECT public.auth_module_scope('requests'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (SELECT 1 FROM public.employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT public.auth_employee_branch_id()))
          END)
  OR ((NOT public.es_solicitud_operativa(type))
      AND (SELECT public.auth_has_module_permission('requests_personales','can_view'))
      AND CASE (SELECT public.auth_module_scope('requests_personales'))
            WHEN 'ALL'  THEN true
            WHEN 'MINE' THEN false
            ELSE EXISTS (SELECT 1 FROM public.employees e
                          WHERE e.id = approval_requests.employee_id
                            AND e.branch_id = (SELECT public.auth_employee_branch_id()))
          END)
  OR (type = 'INVENTORY_TRANSFER_REQUEST'
      AND (SELECT public.auth_has_module_permission('traslados','can_approve'))
      AND ((SELECT public.auth_module_scope('traslados')) = 'ALL'
           OR nullif(metadata->>'origen_branch_id','')::integer = (SELECT public.auth_employee_branch_id())
           OR nullif(metadata->>'branch_id','')::integer        = (SELECT public.auth_employee_branch_id())
           OR (status = 'PENDING'
               AND nullif(metadata->>'origen_branch_id','')::integer
                   = ANY (coalesce((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[])))))
  OR (type = 'INVENTORY_TRANSFER_PUSH'
      AND (SELECT public.auth_has_module_permission('traslados','can_view'))
      AND ((SELECT public.auth_module_scope('traslados')) = 'ALL'
           OR nullif(metadata->>'origen_branch_id','')::integer = (SELECT public.auth_employee_branch_id())
           OR nullif(metadata->>'branch_id','')::integer        = (SELECT public.auth_employee_branch_id())
           OR (status = 'PENDING'
               AND nullif(metadata->>'branch_id','')::integer
                   = ANY (coalesce((SELECT public.salas_que_cubro_ahora()), ARRAY[]::integer[])))))
);

-- ── 3 · Un renglón, un traslado, una decisión ──────────────────────────────
-- La cabecera vive en `approval_requests` —para heredar los avisos, el RLS y la
-- bandeja—, pero el estado no es de la cabecera: cada renglón viaja solo, se
-- acepta solo y se devuelve solo. Guardarlo en el `metadata` sería reescribir el
-- jsonb entero por cada botón, con dos personas de la sala apretando a la vez.
CREATE TABLE IF NOT EXISTS public.envio_linea (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id             uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
    posicion               integer NOT NULL,
    erp_product_id         integer NOT NULL,
    descripcion            text,
    presentacion_tipo      text    NOT NULL,
    factor                 integer NOT NULL CHECK (factor > 0),
    cantidad               numeric NOT NULL CHECK (cantidad > 0),
    unidades               numeric NOT NULL CHECK (unidades > 0),
    lotes                  jsonb,
    estado                 text NOT NULL DEFAULT 'por_enviar'
      CHECK (estado IN ('por_enviar','enviada','error','aceptada',
                        'devuelta','devuelta_recibida')),
    id_traslado            text,
    id_traslado_devolucion text,
    aviso                  text,
    error                  text,
    detalle                jsonb,
    motivo_rechazo         text,
    nota_rechazo           text,
    decidido_por           uuid REFERENCES public.employees(id),
    decidido_at            timestamptz,
    enviado_at             timestamptz,
    recibido_at            timestamptz,
    devuelto_at            timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (request_id, posicion)
);

COMMENT ON TABLE public.envio_linea IS
  'Un renglón de un envío a otra sala. Cada uno es su propio traslado en el sistema de origen, y por eso se acepta o se devuelve solo.';
COMMENT ON COLUMN public.envio_linea.posicion IS
  'Su lugar en metadata.items. Es el nombre del renglón para todo el circuito: deja que la pantalla señale uno sin poder elegir qué producto se mueve.';
COMMENT ON COLUMN public.envio_linea.cantidad IS
  'En PAQUETES de presentacion_tipo. `unidades` es lo mismo en unidades base; factor une las dos escalas.';
COMMENT ON COLUMN public.envio_linea.aviso IS
  'Lo que no frenó el envío pero hay que poder leer después — casi siempre, que el lote despachado no es el que se reservó.';

CREATE INDEX IF NOT EXISTS envio_linea_request_idx  ON public.envio_linea(request_id);
CREATE INDEX IF NOT EXISTS envio_linea_estado_idx   ON public.envio_linea(estado) WHERE estado <> 'aceptada';
CREATE INDEX IF NOT EXISTS envio_linea_decidido_idx ON public.envio_linea(decidido_por) WHERE decidido_por IS NOT NULL;

ALTER TABLE public.envio_linea ENABLE ROW LEVEL SECURITY;

-- Ver un renglón es ver su envío: el criterio no se copia, se DELEGA. Una
-- segunda escritura del mismo criterio es cómo terminan diciendo cosas
-- distintas. Escribir no lo hace nadie desde el navegador — el estado de un
-- renglón sólo lo mueve la Edge Function, que es la que habla con el sistema.
DROP POLICY IF EXISTS envio_linea_select ON public.envio_linea;
CREATE POLICY envio_linea_select ON public.envio_linea
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.id = envio_linea.request_id)
);

DROP TRIGGER IF EXISTS envio_linea_updated_at ON public.envio_linea;
CREATE TRIGGER envio_linea_updated_at BEFORE UPDATE ON public.envio_linea
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
