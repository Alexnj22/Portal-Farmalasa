-- Reglamento Puntos Salud v2, cláusula 8.2: cuando se anula una compra cuyos
-- puntos ya se canjearon y no se pueden descontar enteros, la cuenta pasa a
-- OBSERVACIÓN. Decisión del usuario (2026-10-23): sólo marcar al cliente —no
-- se le cobra lo no recuperado de puntos futuros ni se le bloquea el canje—.
--
-- Una fila por compra anulada, y el cliente está en observación mientras tenga
-- alguna abierta. La abre un trigger sobre `puntos_anulacion_gastada`, que
-- `puntos_anular_venta` ya escribe justo en ese caso (`v_falta > 0`): así la
-- marca sale de la MISMA condición que el aviso, sin una segunda copia.
-- La cierra supervisión con una nota (`puntos_observacion_cerrar`).
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.puntos_observacion (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  customer_id  bigint NOT NULL REFERENCES public.customers(id),
  -- Sin FK a `sales_invoices` a propósito: es tabla caliente, y la FK pediría
  -- lock sobre ella. Igual que `puntos_anulacion_gastada`.
  invoice_id   bigint NOT NULL UNIQUE,
  sucursal     text,
  motivo       text NOT NULL,
  no_recuperados integer NOT NULL,
  cerrada_at   timestamptz,
  cerrada_por  uuid REFERENCES public.employees(id),
  nota_cierre  text
);
CREATE INDEX IF NOT EXISTS puntos_observacion_customer_idx ON public.puntos_observacion (customer_id);

ALTER TABLE public.puntos_observacion ENABLE ROW LEVEL SECURITY;
-- Se lee donde se lee la ficha de puntos (`puntos_panel_cliente`). Las
-- escrituras van sólo por el trigger y la RPC DEFINER: sin policy de escritura.
DROP POLICY IF EXISTS puntos_observacion_select ON public.puntos_observacion;
CREATE POLICY puntos_observacion_select ON public.puntos_observacion
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')));
REVOKE ALL ON public.puntos_observacion FROM anon;

CREATE OR REPLACE FUNCTION public.puntos_observacion_abrir()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE v_doc text;
BEGIN
  SELECT correlativo INTO v_doc FROM public.sales_invoices WHERE id = NEW.invoice_id;
  INSERT INTO public.puntos_observacion (customer_id, invoice_id, sucursal, motivo, no_recuperados)
  VALUES (NEW.customer_id, NEW.invoice_id, NEW.sucursal,
          'compra anulada' || coalesce(' · ' || v_doc, '')
            || format(' después de canjear sus puntos: %s de %s no se pudieron descontar',
                      NEW.no_recuperados, NEW.dio),
          NEW.no_recuperados)
  ON CONFLICT (invoice_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_observacion_abrir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS puntos_observacion_abrir ON public.puntos_anulacion_gastada;
CREATE TRIGGER puntos_observacion_abrir
  AFTER INSERT ON public.puntos_anulacion_gastada
  FOR EACH ROW EXECUTE FUNCTION public.puntos_observacion_abrir();

-- Los casos que ya existían (hoy: ninguno).
INSERT INTO public.puntos_observacion (customer_id, invoice_id, sucursal, motivo, no_recuperados, created_at)
SELECT g.customer_id, g.invoice_id, g.sucursal,
       'compra anulada' || coalesce(' · ' || si.correlativo, '')
         || format(' después de canjear sus puntos: %s de %s no se pudieron descontar', g.no_recuperados, g.dio),
       g.no_recuperados, g.created_at
FROM public.puntos_anulacion_gastada g
LEFT JOIN public.sales_invoices si ON si.id = g.invoice_id
ON CONFLICT (invoice_id) DO NOTHING;

-- Cierra TODAS las abiertas del cliente: la observación es sobre la persona.
-- Mismo permiso que dar o quitar puntos.
CREATE OR REPLACE FUNCTION public.puntos_observacion_cerrar(p_customer_id bigint, p_nota text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_n integer;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar la observación.' USING ERRCODE = '42501';
  END IF;
  IF v_nota IS NULL THEN RAISE EXCEPTION 'Falta la nota: qué se revisó.'; END IF;
  UPDATE public.puntos_observacion
     SET cerrada_at = now(), cerrada_por = public.auth_employee_id(), nota_cierre = v_nota
   WHERE customer_id = p_customer_id AND cerrada_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_observacion_cerrar(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_observacion_cerrar(bigint, text) TO authenticated, service_role;
