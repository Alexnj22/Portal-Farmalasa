-- El libro mayor del programa de puntos, en el portal.
--
-- Cuatro tablas INERTES: nadie las lee, nadie las escribe y ningún cron las
-- toca. Encender el programa son dos actos explícitos y separados que este
-- archivo NO hace: correr la migración de saldos una vez, y crear el cron de
-- acumulación. Mientras eso no pase, esto no cambia el comportamiento de nada.
--
-- El modelo es un libro de LOTES y no un saldo: el vencimiento es por compra,
-- así que hay que saber de qué compra vino cada punto. Un saldo suelto no puede
-- contestar «¿cuáles se me vencen en marzo?».
--
-- Plan completo: docs/PLAN-PUNTOS-EN-SUPABASE-2026-09-01.md
SET lock_timeout = '5s';

CREATE TABLE public.puntos_cuenta (
  customer_id  bigint PRIMARY KEY REFERENCES public.customers(id) ON DELETE RESTRICT,
  saldo        integer     NOT NULL DEFAULT 0 CHECK (saldo   >= 0),
  ganados      integer     NOT NULL DEFAULT 0 CHECK (ganados >= 0),
  usados       integer     NOT NULL DEFAULT 0 CHECK (usados  >= 0),
  activa       boolean     NOT NULL DEFAULT true,
  migrada_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.puntos_cuenta IS
  'Saldo MANTENIDO por cliente. No derivado: sumar 1.7M de movimientos en cada consulta es lo que haría lenta la pantalla del cliente. Se cuadra contra el libro con puntos_cuadrar().';

CREATE TABLE public.puntos_lote (
  id          bigserial PRIMARY KEY,
  customer_id bigint  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  origen      text    NOT NULL CHECK (origen IN ('venta','ajuste','migracion')),
  invoice_id  bigint  REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  sucursal    text,
  puntos      integer NOT NULL CHECK (puntos > 0),
  restantes   integer NOT NULL CHECK (restantes >= 0),
  ganado_el   date    NOT NULL,
  vence_el    date    NOT NULL,
  motivo      text,
  creado_por  uuid    REFERENCES public.employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puntos_lote_restantes_cabe   CHECK (restantes <= puntos),
  CONSTRAINT puntos_lote_vence_despues    CHECK (vence_el >= ganado_el),
  CONSTRAINT puntos_lote_venta_con_venta  CHECK ((origen = 'venta') = (invoice_id IS NOT NULL)),
  CONSTRAINT puntos_lote_ajuste_con_motivo CHECK (origen <> 'ajuste' OR motivo IS NOT NULL)
);
COMMENT ON TABLE public.puntos_lote IS
  'Cada ENTRADA de puntos, con su fecha de vencimiento propia. Los asientos manuales (cortesías de cumpleaños, promos) entran acá con origen=ajuste y su motivo: así también vencen.';

-- El freno estructural al doble crédito. En la base vieja hay 27 tickets con
-- los puntos cobrados DOS veces, porque 2,142 facturas viven bajo FLP y FLP1 a
-- la vez. Acá eso deja de ser un defecto que haya que salir a cazar.
CREATE UNIQUE INDEX puntos_lote_una_por_venta
  ON public.puntos_lote (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE public.puntos_salida (
  id             bigserial PRIMARY KEY,
  customer_id    bigint  NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  tipo           text    NOT NULL CHECK (tipo IN ('canje','anulacion','vencimiento','ajuste')),
  puntos         integer NOT NULL CHECK (puntos > 0),
  monto          numeric(10,2) CHECK (monto IS NULL OR monto >= 0),
  invoice_id     bigint  REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  sucursal       text,
  motivo         text,
  autorizado_por uuid    REFERENCES public.employees(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puntos_salida_anulacion_con_venta CHECK (tipo <> 'anulacion' OR invoice_id IS NOT NULL),
  CONSTRAINT puntos_salida_ajuste_con_motivo   CHECK (tipo <> 'ajuste'    OR motivo     IS NOT NULL)
);
COMMENT ON TABLE public.puntos_salida IS
  'Cada SALIDA, con su motivo. La resta es una salida y NUNCA un borrado (decisión del usuario, 2026-08-29): el saldo baja y queda una línea que lo explica en el estado de cuenta. El vencimiento también se anota acá.';

CREATE TABLE public.puntos_salida_lote (
  salida_id bigint  NOT NULL REFERENCES public.puntos_salida(id) ON DELETE RESTRICT,
  lote_id   bigint  NOT NULL REFERENCES public.puntos_lote(id)   ON DELETE RESTRICT,
  puntos    integer NOT NULL CHECK (puntos > 0),
  PRIMARY KEY (salida_id, lote_id)
);
COMMENT ON TABLE public.puntos_salida_lote IS
  'Qué lote pagó cuánto de cada salida. Sin esto, «te vencieron 33 puntos» no se puede demostrar: se sabría el número y no de dónde salió.';

-- El primero es EL índice del canje: los lotes vivos de una persona, del más
-- viejo al más nuevo. Sin él, cada canje barre la tabla entera.
CREATE INDEX puntos_lote_fifo       ON public.puntos_lote (customer_id, ganado_el, id) WHERE restantes > 0;
CREATE INDEX puntos_lote_vencen     ON public.puntos_lote (vence_el) WHERE restantes > 0;
CREATE INDEX puntos_lote_cliente    ON public.puntos_lote (customer_id);
CREATE INDEX puntos_lote_creador    ON public.puntos_lote (creado_por) WHERE creado_por IS NOT NULL;
CREATE INDEX puntos_salida_cliente  ON public.puntos_salida (customer_id, created_at DESC);
CREATE INDEX puntos_salida_venta    ON public.puntos_salida (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX puntos_salida_autoriza ON public.puntos_salida (autorizado_por) WHERE autorizado_por IS NOT NULL;
CREATE INDEX puntos_salida_lote_lote ON public.puntos_salida_lote (lote_id);

-- Leer: quien ya puede abrir la ficha de un cliente. No se inventa un permiso
-- nuevo — es la misma decisión que se tomó para `puntos-consulta`.
-- Escribir: NADIE por la API. Todo pasa por las funciones DEFINER, que son las
-- que saben mantener el saldo y el FIFO en la misma transacción.
ALTER TABLE public.puntos_cuenta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_lote        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_salida      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_salida_lote ENABLE ROW LEVEL SECURITY;

-- El wrapper `(SELECT …)` no es estilo: sin él Postgres evalúa la función POR
-- FILA y consulta employees+role_permissions en cada una. Fue la causa del
-- outage del 2026-07-08 (un count de 27K filas: 25,000 ms → 19 ms).
CREATE POLICY leer_cuenta ON public.puntos_cuenta FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_lote ON public.puntos_lote FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_salida ON public.puntos_salida FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));
CREATE POLICY leer_salida_lote ON public.puntos_salida_lote FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('clientes','can_view')));

REVOKE ALL ON public.puntos_cuenta, public.puntos_lote,
              public.puntos_salida, public.puntos_salida_lote FROM anon;
GRANT SELECT ON public.puntos_cuenta, public.puntos_lote,
                public.puntos_salida, public.puntos_salida_lote TO authenticated;
