-- Clientes a los que su COF de la noche SÍ se les manda a Hacienda (2026-10-19).
--
-- Pedido del usuario: «si es Mapfre o Diócesis, que se reenvíen siempre aunque
-- sean COF y después de las 6». Son clientes institucionales que necesitan el
-- documento fiscal de cada compra.
--
-- Por FICHA, no por nombre (un rótulo no es una clave). Medido antes de
-- escribir esto: las 157 ventas del último año de los dos están amarradas a su
-- ficha —85 de Mapfre a la 1043, 72 de la Diócesis a la 21092—, ninguna suelta
-- con el nombre escrito a mano.
--
-- La regla `cof_no_se_envia_mh` pasa a recibir el cliente. Sus cinco usuarios
-- se reescriben desde su definición VIVA cambiando sólo la llamada, y cada
-- reemplazo se comprueba: si el texto esperado no estuviera, la migración
-- aborta en vez de dejar una función con la regla vieja.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.dte_clientes_siempre_se_envian (
  customer_id bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  motivo      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dte_clientes_siempre_se_envian ENABLE ROW LEVEL SECURITY;

-- Lectura para quien ve Facturación o Ventas: las dos pantallas necesitan la
-- lista para no marcar como «sin enviar» lo que sí se manda. Sin policy de
-- escritura a propósito: agregar un cliente es una decisión, va por migración.
DROP POLICY IF EXISTS dte_clientes_siempre_read ON public.dte_clientes_siempre_se_envian;
CREATE POLICY dte_clientes_siempre_read ON public.dte_clientes_siempre_se_envian
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('facturacion', 'can_view'))
      OR (SELECT public.auth_has_module_permission('ventas', 'can_view')));

INSERT INTO public.dte_clientes_siempre_se_envian (customer_id, motivo) VALUES
  (1043,  'MAPFRE SEGURO EL SALVADOR, S.A.: necesita el DTE de cada compra.'),
  (21092, 'DIOCESIS DE CHALATENANGO: necesita el DTE de cada compra.')
ON CONFLICT (customer_id) DO NOTHING;

-- La regla, ahora con el cliente. STABLE porque lee la lista; sin `SET
-- search_path` a propósito, como `venta_valida`, para que se inlinee.
CREATE OR REPLACE FUNCTION public.cof_no_se_envia_mh(p_tipo text, p_fecha date, p_hora time, p_customer_id bigint)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(
    p_tipo = 'COF' AND p_fecha >= DATE '2026-10-19' AND p_hora >= TIME '18:00'
    AND NOT EXISTS (SELECT 1 FROM public.dte_clientes_siempre_se_envian x
                     WHERE x.customer_id = p_customer_id),
    false)
$$;
COMMENT ON FUNCTION public.cof_no_se_envia_mh(text, date, time, bigint) IS
  'COF emitido desde las 18:00 (a partir del 2026-10-19), salvo los clientes de dte_clientes_siempre_se_envian: no se envia a Hacienda, no es pendiente ni dispara avisos. Gemelas: regularizar-dte (COF_SIN_ENVIO) y src/utils/cofNoche.js.';
REVOKE EXECUTE ON FUNCTION public.cof_no_se_envia_mh(text, date, time, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cof_no_se_envia_mh(text, date, time, bigint) TO authenticated, service_role;

DO $do$
DECLARE
  f record;
  def text;
  nuevo text;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('get_pending_mh_invoices',    'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)', 'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)'),
      ('get_consecutive_mh_alerts',  'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)', 'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)'),
      ('get_cof_sin_envio_mh',       'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)', 'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)'),
      ('get_ventas_fuera_del_libro', 'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)', 'cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora, si.customer_id)'),
      ('alertar_barrido_dte',        'cof_no_se_envia_mh(tipo_documento, fecha, hora)',          'cof_no_se_envia_mh(tipo_documento, fecha, hora, customer_id)')
    ) AS t(nombre, viejo, reemplazo)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f.nombre;
    IF def IS NULL THEN RAISE EXCEPTION 'No existe %', f.nombre; END IF;
    IF position(f.viejo IN def) = 0 THEN
      RAISE EXCEPTION '% no tiene la llamada esperada a la regla', f.nombre;
    END IF;
    nuevo := replace(def, f.viejo, f.reemplazo);
    EXECUTE nuevo;
  END LOOP;
END
$do$;

-- La versión de tres argumentos se queda hasta desplegar las edge functions
-- que la llaman (`aplicar-solicitud-facturacion`); la borra la migración
-- siguiente. Borrarla acá dejaría la anulación rota entre los dos pasos.
