-- Cortes de caja: captura desde el sistema de origen.
--
-- POR QUÉ SE GUARDAN DOS NÚMEROS Y NO UNO
-- El origen calcula la diferencia EN EL NAVEGADOR del dependiente
-- (funciones_corte_caja.js):
--     total_corte = efectivo + tarjeta + cheque      <- lo que teclea
--     diferencia  = total_corte - total_sistema
-- y la manda como un parámetro más. Nada la recalcula del otro lado, así que
-- vale lo que valga lo tecleado: inflar `tarjeta` deja la diferencia en cero y
-- el efectivo se va. Por eso el control vive acá y no allá.
--
-- Y OJO CON EL ROTULO: la línea `EFECTIVO $:` del ticket NO es efectivo — es
-- efectivo+tarjeta+cheque. En el corte 13783 dice 1593.68 con 202.55 de tarjeta
-- adentro. Es `total_declarado`, no dinero contado.
--
-- EL ANCLA QUE NO SE MUEVE
-- El ticket reimpreso mezcla líneas del corte (INGRESOS, VENTA) con líneas del
-- DÍA EN VIVO (VALES, COBROS CREDITO, TARJETA): recalcularlo después da otro
-- número. Medido en el corte 13734 — el origen guardó 1155.18/0.10 y hoy el
-- ticket da -20.45, corrido 20.55 por movimientos posteriores. Por eso
-- `esperado` es GENERATED sobre los dos valores guardados
-- (total_declarado - diferencia_erp): no puede derivar ni escribirse mal.
-- Verificado: 1593.68 - 3.39 = 1590.29, idéntico al TOTAL CAJA de ese momento.
--
-- Los campos `tk_*` se guardan igual, con `capturado_at` y `desfase_seg` al
-- lado, porque capturados cerca del corte SÍ valen — y sin la hora de captura
-- no hay forma de saber cuáles creerle.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cortes_caja (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id         integer NOT NULL REFERENCES public.branches(id),
  erp_corte_id      integer NOT NULL,
  tipo              text    NOT NULL CHECK (tipo IN ('C','Z')),
  fecha             date    NOT NULL,
  hora              time    NOT NULL,
  turno             smallint,
  caja_erp          integer,

  empleado_texto    text,
  employee_id       uuid REFERENCES public.employees(id),

  -- Del listado: los dos únicos números que el origen GUARDA.
  total_declarado   numeric(12,2) NOT NULL,
  diferencia_erp    numeric(12,2) NOT NULL,
  esperado          numeric(12,2)
                    GENERATED ALWAYS AS (total_declarado - diferencia_erp) STORED,

  -- Del ticket. Mezcla foto y vivo: leer junto a `desfase_seg`.
  tk_saldo_inicial    numeric(12,2),
  tk_saldo_caja_chica numeric(12,2),
  tk_ingresos         numeric(12,2),
  tk_venta            numeric(12,2),
  tk_subtotal         numeric(12,2),
  tk_vales            numeric(12,2),
  tk_cobros_credito   numeric(12,2),
  tk_total_caja       numeric(12,2),
  tk_retencion        numeric(12,2),
  tk_devoluciones     numeric(12,2),
  tk_efectivo         numeric(12,2),
  tk_tarjeta          numeric(12,2),
  tk_credito          numeric(12,2),

  -- Del desglose impreso.
  pdf_doc_tiquete   numeric(12,2),
  pdf_doc_factura   numeric(12,2),
  pdf_doc_ccf       numeric(12,2),
  pdf_doc_total     numeric(12,2),

  ticket            text,
  pdf_texto         text,

  capturado_at      timestamptz NOT NULL DEFAULT now(),
  desfase_seg       integer,

  estado            text NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','CONFIRMADO','DESCARTADO')),
  motivo_descarte   text,
  observaciones     text,
  resuelto_por      uuid REFERENCES public.employees(id),
  resuelto_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cortes_caja_erp_unico UNIQUE (branch_id, erp_corte_id),

  CONSTRAINT cortes_caja_descarte_con_motivo
    CHECK (estado <> 'DESCARTADO'
           OR (motivo_descarte IS NOT NULL AND btrim(motivo_descarte) <> '')),

  CONSTRAINT cortes_caja_resuelto_con_responsable
    CHECK (estado = 'PENDIENTE'
           OR (resuelto_por IS NOT NULL AND resuelto_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS cortes_caja_branch_fecha_idx
  ON public.cortes_caja (branch_id, fecha DESC, hora DESC);
CREATE INDEX IF NOT EXISTS cortes_caja_pendientes_idx
  ON public.cortes_caja (branch_id, fecha) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS cortes_caja_employee_idx
  ON public.cortes_caja (employee_id);
CREATE INDEX IF NOT EXISTS cortes_caja_resuelto_por_idx
  ON public.cortes_caja (resuelto_por);

COMMENT ON COLUMN public.cortes_caja.total_declarado IS
  'efectivo+tarjeta+cheque tecleado por el dependiente. NO es efectivo.';
COMMENT ON COLUMN public.cortes_caja.diferencia_erp IS
  'Diferencia calculada en el navegador del origen y enviada como parametro. No verificada del lado del servidor.';
COMMENT ON COLUMN public.cortes_caja.esperado IS
  'total_declarado - diferencia_erp. El esperado del sistema AL MOMENTO del corte; no deriva.';
COMMENT ON COLUMN public.cortes_caja.desfase_seg IS
  'Segundos entre el corte y su captura. Los campos tk_* solo son fiables con desfase chico.';

-- Movimientos de caja (vales e ingresos).
-- El origen los sirve con FECHA PERO SIN HORA, asi que no se le puede atribuir
-- con certeza a un corte de media manana cuales ya habian ocurrido. Para el
-- corte definitivo del dia no estorba; para los intermedios, si.
CREATE TABLE IF NOT EXISTS public.cortes_caja_movimientos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id         integer NOT NULL REFERENCES public.branches(id),
  erp_movimiento_id integer NOT NULL,
  fecha             date    NOT NULL,
  concepto          text,
  monto             numeric(12,2) NOT NULL,
  tipo              text    NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA')),
  capturado_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cortes_caja_mov_erp_unico UNIQUE (branch_id, erp_movimiento_id)
);

CREATE INDEX IF NOT EXISTS cortes_caja_mov_branch_fecha_idx
  ON public.cortes_caja_movimientos (branch_id, fecha DESC);

ALTER TABLE public.cortes_caja             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cortes_caja_movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY bloqueo_global ON public.cortes_caja
  FOR ALL USING ((SELECT auth_no_bloqueado()));
CREATE POLICY bloqueo_global ON public.cortes_caja_movimientos
  FOR ALL USING ((SELECT auth_no_bloqueado()));

CREATE POLICY cortes_caja_select ON public.cortes_caja
  FOR SELECT TO authenticated
  USING (
    (SELECT auth_has_module_permission('cortes_caja','can_view'))
    AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
         OR branch_id = (SELECT auth_employee_branch_id()))
  );

CREATE POLICY cortes_caja_mov_select ON public.cortes_caja_movimientos
  FOR SELECT TO authenticated
  USING (
    (SELECT auth_has_module_permission('cortes_caja','can_view'))
    AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
         OR branch_id = (SELECT auth_employee_branch_id()))
  );

-- Sin policy de INSERT/UPDATE/DELETE a propósito: hoy sólo escribe la captura
-- con service_role. Confirmar y descartar entrarán por un RPC SECURITY DEFINER
-- que valida permiso y deja bitácora — no por un UPDATE suelto desde el
-- navegador, que dejaría el estado sin autor verificable.
