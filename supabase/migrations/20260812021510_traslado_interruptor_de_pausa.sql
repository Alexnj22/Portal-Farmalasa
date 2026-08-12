SET lock_timeout = '5s';

-- Interruptor de pausa del traslado automático.
--
-- El candado de mantenimiento (`module_locks`) NO sirve para esto: frena las
-- policies de RLS, y el despacho corre con service_role y desde el cron, así
-- que pasaría igual. Este lo consulta la propia edge function.
--
-- Dos interruptores separados a propósito. Pausar el ENVÍO y la RECEPCIÓN a la
-- vez dejaría varado lo que ya salió de Bodega y todavía no llegó: fuera de una
-- sala y sin poder entrar en la otra. Ante un problema se pausa el envío
-- primero, y la recepción se deja abierta para poder cerrar lo que está en
-- camino.
CREATE TABLE IF NOT EXISTS public.traslado_interruptor (
    accion       text PRIMARY KEY CHECK (accion IN ('enviar', 'recibir')),
    pausado      boolean     NOT NULL DEFAULT false,
    motivo       text,
    cambiado_por uuid REFERENCES public.employees(id),
    cambiado_at  timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS traslado_interruptor_cambiado_por_idx
    ON public.traslado_interruptor(cambiado_por);

INSERT INTO public.traslado_interruptor (accion, pausado)
VALUES ('enviar', false), ('recibir', false)
ON CONFLICT (accion) DO NOTHING;

ALTER TABLE public.traslado_interruptor ENABLE ROW LEVEL SECURITY;

-- Verlo puede cualquiera que vea pedidos: es información de operación, y la
-- pantalla necesita poder avisar "los traslados están pausados".
DROP POLICY IF EXISTS traslado_interruptor_select ON public.traslado_interruptor;
CREATE POLICY traslado_interruptor_select ON public.traslado_interruptor
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('pedidos', 'can_view')));

-- Escribir SOLO por la RPC. Sin policy de INSERT/UPDATE/DELETE: nadie toca la
-- tabla directo, ni siquiera con can_edit.
