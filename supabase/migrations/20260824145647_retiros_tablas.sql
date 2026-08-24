SET lock_timeout = '5s';

-- ─── El retiro: quién carga las bolsas y responde por ellas ─────────────────
--
-- Hasta hoy el circuito tenía DOS estados —despachada (`erp_traslado`) y
-- recibida (`erp_recibido`)— y entre los dos la bolsa no tenía dueño. Estas dos
-- tablas son el tercero: entre que sale y llega, hay una persona con nombre.
--
-- Van en tablas y no en el `metadata` de la solicitud porque las preguntas que
-- hay que contestar son ENTRE FILAS —«¿qué lleva Francisco encima?», «¿qué
-- lleva tres días sin entregarse?»— y adentro de un jsonb por solicitud las dos
-- son un barrido de la tabla entera. Es el mismo motivo que ya obligó a escribir
-- `get_traslados_por_recibir` como función.

CREATE TABLE IF NOT EXISTS public.retiros (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retirador_id  uuid NOT NULL REFERENCES public.employees(id),
  abierto_at    timestamptz NOT NULL DEFAULT now(),
  -- `NULL` = en curso. Un retiro NO se puede cerrar con bultos encima
  -- (decisión del usuario: «si lo sobró se debe entregar»), y por eso el aviso
  -- de los tres días no es opcional: es lo único que impide que uno quede
  -- abierto para siempre.
  cerrado_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Una persona no puede estar haciendo dos recorridos a la vez. Índice parcial y
-- no un CHECK: es la base la que tiene que impedirlo aunque dos pestañas
-- aprieten el botón en el mismo segundo.
CREATE UNIQUE INDEX IF NOT EXISTS retiros_uno_abierto_por_persona
  ON public.retiros (retirador_id) WHERE cerrado_at IS NULL;
CREATE INDEX IF NOT EXISTS retiros_retirador_idx ON public.retiros (retirador_id);

CREATE TABLE IF NOT EXISTS public.retiro_bultos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retiro_id         uuid NOT NULL REFERENCES public.retiros(id) ON DELETE CASCADE,
  request_id        uuid NOT NULL REFERENCES public.approval_requests(id),
  -- DÓNDE ESTABA la bolsa, que con `por_respaldo` NO es quien la despachó:
  -- Salud 3 entra a Bodega y despacha, pero la bolsa se queda en Bodega.
  origen_branch_id  bigint REFERENCES public.branches(id),
  cargado_at        timestamptz NOT NULL DEFAULT now(),
  -- Quién de esa sala la entregó. `NULL` cuando el retirador es de la sala —o
  -- la cubre—, porque ahí la firma sería la suya.
  entrego_id        uuid REFERENCES public.employees(id),
  -- Cuándo dejó de estar encima. Lo estampa el trigger cuando la sala de
  -- destino recibe, venga por donde venga la recepción.
  entregado_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Una bolsa no puede ir en dos retiros a la vez mientras nadie la entregue. Y
-- al ser parcial, una que ya se entregó puede volver a cargarse — que es lo que
-- pasa con una devolución.
CREATE UNIQUE INDEX IF NOT EXISTS retiro_bultos_uno_en_vuelo
  ON public.retiro_bultos (request_id) WHERE entregado_at IS NULL;
CREATE INDEX IF NOT EXISTS retiro_bultos_retiro_idx  ON public.retiro_bultos (retiro_id);
CREATE INDEX IF NOT EXISTS retiro_bultos_entrego_idx ON public.retiro_bultos (entrego_id);
CREATE INDEX IF NOT EXISTS retiro_bultos_origen_idx  ON public.retiro_bultos (origen_branch_id);
CREATE INDEX IF NOT EXISTS retiro_bultos_request_idx ON public.retiro_bultos (request_id);

ALTER TABLE public.retiros        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retiro_bultos  ENABLE ROW LEVEL SECURITY;

-- Sólo LECTURA por policy. Todo lo que escribe pasa por funciones DEFINER, que
-- son las que verifican las reglas — así no hay forma de insertar un bulto
-- saltándose la validación de quién entrega. `(SELECT …)` alrededor de la
-- función de permiso es obligatorio: sin el initplan, Postgres la evalúa POR
-- FILA (incidente 2026-07-08).
DROP POLICY IF EXISTS retiros_select ON public.retiros;
CREATE POLICY retiros_select ON public.retiros FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('traslados', 'can_view')));

DROP POLICY IF EXISTS retiro_bultos_select ON public.retiro_bultos;
CREATE POLICY retiro_bultos_select ON public.retiro_bultos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('traslados', 'can_view')));
