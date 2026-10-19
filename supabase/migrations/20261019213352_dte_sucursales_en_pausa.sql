-- Pausa por SUCURSAL del envío a Hacienda (2026-10-19).
--
-- Se van a hacer pruebas fiscales en Salud 1 y sus facturas tienen que quedar
-- tal cual, sin sello, mientras duren. `dte_excluidas_del_barrido` es por
-- factura y no alcanza: las facturas de prueba de mañana todavía no existen.
--
-- `regularizar-dte` lee esta tabla en los tres alcances (todas, sucursal y
-- una): ni el cron de las 22:30 ni los botones mandan una factura de una sala
-- en pausa. Si la lectura falla, la función no envía nada.
--
-- Para levantar la pausa:  DELETE FROM public.dte_sucursales_en_pausa WHERE branch_id = 4;
--
-- Sin policy de escritura a propósito, igual que la lista negra por factura:
-- pausar una sala es una decisión, no algo que se haga desde la pantalla.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_sucursales_en_pausa (
  branch_id   integer PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  motivo      text NOT NULL,
  pausada_por text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dte_sucursales_en_pausa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dte_sucursales_en_pausa_read ON public.dte_sucursales_en_pausa;
CREATE POLICY dte_sucursales_en_pausa_read ON public.dte_sucursales_en_pausa
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view')));

COMMENT ON TABLE public.dte_sucursales_en_pausa IS
  'Sucursales cuyas facturas regularizar-dte NO envia a Hacienda (ningun alcance). Para levantar la pausa: DELETE de la fila.';

INSERT INTO public.dte_sucursales_en_pausa (branch_id, motivo, pausada_por)
VALUES (4, 'Pruebas fiscales en curso: las facturas quedan tal cual, sin enviar a Hacienda.', 'Alex Nunez')
ON CONFLICT (branch_id) DO NOTHING;
