SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Cobro desde el kiosco de caja, etapa 2 (2026-11-18). APAGADO al nacer.
--
-- El kiosco cobra una preventa con los MISMOS pasos que la pantalla de la
-- caja (`process=insert` y `process=imprimir_fact` en `venta.php`), y después
-- la manda a Hacienda con la misma rutina del envío de cada noche
-- (`enviarDteAlMH`). La factura vive en el ERP, igual que si la cobrara la
-- cajera. Lo armó el ensayo en paralelo (`cobro_caja_ensayos`).
--
-- Dos tablas:
--   · `cobro_kiosco_sucursales`: el interruptor, una fila por sucursal. Sin
--     fila o con `encendido = false`, el kiosco NO cobra. Se enciende y se
--     apaga con una fila: la marcha atrás nunca es una migración.
--   · `cobro_kiosco_cobros`: un renglón por preventa cobrada desde el kiosco.
--     Es el CANDADO (`preventa_id` único: dos toques no cobran dos veces) y es
--     el registro de en qué paso quedó. Cada paso que escribe en la caja deja
--     su estado ANTES de seguir: un cobro cortado a la mitad se retoma desde el
--     paso que falta, nunca desde el principio (guardar dos veces sería una
--     factura de más).
--       cobrando   → tomó el candado, no ha escrito nada;
--       guardada   → la caja guardó la factura (falta finalizarla);
--       finalizada → la caja la finalizó con el efectivo;
--       incierta   → la caja contestó algo ilegible al guardar o finalizar: no
--                    se sabe si escribió. NO se reintenta solo; se revisa en la
--                    caja.
--   El envío a Hacienda va en `mh` (sello, o por qué no se mandó): una factura
--   finalizada sin sello la levanta el envío de cada noche, como cualquier otra.
--   Es historial de negocio: no se purga.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cobro_kiosco_sucursales (
  branch_id   bigint PRIMARY KEY REFERENCES public.branches(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  encendido   boolean NOT NULL DEFAULT false,
  nota        text
);
ALTER TABLE public.cobro_kiosco_sucursales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobro_kiosco_sucursales_select ON public.cobro_kiosco_sucursales;
-- La lee la pantalla del kiosco para saber si muestra «Cobrar». No dice nada
-- sensible; escribirla sólo puede el servidor.
CREATE POLICY cobro_kiosco_sucursales_select ON public.cobro_kiosco_sucursales
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.cobro_kiosco_sucursales FROM anon;

CREATE TABLE IF NOT EXISTS public.cobro_kiosco_cobros (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  preventa_id   bigint NOT NULL REFERENCES public.preventas(id),
  branch_id     bigint NOT NULL REFERENCES public.branches(id),
  externo_id    text NOT NULL,
  empleado_id   uuid REFERENCES public.employees(id),
  estado        text NOT NULL DEFAULT 'cobrando'
                CHECK (estado IN ('cobrando', 'guardada', 'finalizada', 'incierta')),
  total         numeric(12,2),
  efectivo      numeric(12,2),
  numero        text,
  respuestas    jsonb NOT NULL DEFAULT '{}'::jsonb,
  mh            jsonb,
  error         text,
  CONSTRAINT cobro_kiosco_cobros_preventa_key UNIQUE (preventa_id)
);
CREATE INDEX IF NOT EXISTS idx_cobro_kiosco_cobros_branch ON public.cobro_kiosco_cobros (branch_id);
CREATE INDEX IF NOT EXISTS idx_cobro_kiosco_cobros_empleado ON public.cobro_kiosco_cobros (empleado_id);
ALTER TABLE public.cobro_kiosco_cobros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobro_kiosco_cobros_select ON public.cobro_kiosco_cobros;
CREATE POLICY cobro_kiosco_cobros_select ON public.cobro_kiosco_cobros
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('caja_vales', 'can_view')));
REVOKE ALL ON public.cobro_kiosco_cobros FROM anon;

-- Salud 4, la del kiosco piloto: con su fila, APAGADA.
INSERT INTO public.cobro_kiosco_sucursales (branch_id, encendido, nota)
SELECT 28, false, 'Piloto. Se enciende para el primer cobro real, con el usuario presente.'
 WHERE EXISTS (SELECT 1 FROM public.branches WHERE id = 28)
ON CONFLICT (branch_id) DO NOTHING;
