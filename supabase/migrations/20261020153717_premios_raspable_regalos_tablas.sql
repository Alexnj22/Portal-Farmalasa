SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Premios del raspable que NO son puntos (2026-10-19, pedido del usuario).
--
-- Hasta hoy el raspable del mes sólo sorteaba PUNTOS: el día 1 cada cliente del
-- nivel recibe un lote `puntos_lote` con origen 'cupon', y lo que raspa en la
-- app es la revelación de ese lote. Ahora un premio también puede ser:
--
--   · PRODUCTO del inventario — se entrega en la sala y se DESCARTA en el
--     sistema de la caja con el concepto «PREMIO PUNTOS SALUD - código -
--     cliente» (decisión del usuario). No hay factura: es un regalo.
--   · PROMOCIONAL — termos, bolsas, kits: no son inventario de la farmacia, así
--     que llevan su PROPIO inventario por sucursal, con envíos desde Bodega.
--
-- Cada uno con su probabilidad en la misma lista `cupon_premios`, y vencen
-- igual que el raspable: a fin de mes.
--
-- Un premio que no es puntos NO va a `puntos_lote`: un lote de 0 puntos
-- rompería «al canjear se gasta primero el cupón». Vive en `puntos_premios`,
-- uno por cliente por mes —la misma regla que el lote—, y `puntos_dar_cupones`
-- mira las dos tablas para no dar dos raspables en un mes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El catálogo de promocionales ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promocionales (
  id          bigserial PRIMARY KEY,
  nombre      text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 80),
  descripcion text,
  foto_url    text,
  -- Lo que cuesta uno, para saber cuánto cuesta el programa en regalos.
  costo       numeric(10,2) CHECK (costo IS NULL OR costo >= 0),
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cuántos hay en cada sucursal. Bodega es una sucursal más (branch 30).
CREATE TABLE IF NOT EXISTS public.promocionales_existencias (
  promocional_id bigint NOT NULL REFERENCES public.promocionales(id) ON DELETE CASCADE,
  branch_id      integer NOT NULL REFERENCES public.branches(id),
  cantidad       integer NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promocional_id, branch_id)
);
CREATE INDEX IF NOT EXISTS promocionales_existencias_branch ON public.promocionales_existencias (branch_id);

-- Un envío sale de una sucursal y LLEGA cuando la de destino lo confirma: en
-- el medio no está en ninguna de las dos (va en el camión).
CREATE TABLE IF NOT EXISTS public.promocionales_envios (
  id             bigserial PRIMARY KEY,
  promocional_id bigint NOT NULL REFERENCES public.promocionales(id),
  desde_branch   integer NOT NULL REFERENCES public.branches(id),
  hacia_branch   integer NOT NULL REFERENCES public.branches(id),
  cantidad       integer NOT NULL CHECK (cantidad > 0),
  estado         text NOT NULL DEFAULT 'ENVIADO' CHECK (estado IN ('ENVIADO', 'RECIBIDO')),
  enviado_por    uuid,
  enviado_at     timestamptz NOT NULL DEFAULT now(),
  recibido_por   uuid,
  recibido_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (desde_branch <> hacia_branch)
);
CREATE INDEX IF NOT EXISTS promocionales_envios_promocional ON public.promocionales_envios (promocional_id);
CREATE INDEX IF NOT EXISTS promocionales_envios_hacia ON public.promocionales_envios (hacia_branch) WHERE estado = 'ENVIADO';
CREATE INDEX IF NOT EXISTS promocionales_envios_desde ON public.promocionales_envios (desde_branch);

-- Todo lo que mueve una existencia, con quién y por qué. Historial de negocio:
-- no se purga.
CREATE TABLE IF NOT EXISTS public.promocionales_movimientos (
  id             bigserial PRIMARY KEY,
  promocional_id bigint NOT NULL REFERENCES public.promocionales(id),
  branch_id      integer NOT NULL REFERENCES public.branches(id),
  tipo           text NOT NULL CHECK (tipo IN ('ENTRADA', 'AJUSTE', 'ENVIO_SALE', 'ENVIO_LLEGA', 'PREMIO')),
  cantidad       integer NOT NULL,          -- con signo: lo que sumó o restó
  envio_id       bigint,
  premio_id      bigint,
  nota           text,
  employee_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promocionales_movimientos_promocional ON public.promocionales_movimientos (promocional_id, created_at DESC);
CREATE INDEX IF NOT EXISTS promocionales_movimientos_branch ON public.promocionales_movimientos (branch_id);

-- ── El premio que salió en el raspable ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_premios (
  id                bigserial PRIMARY KEY,
  -- Lo que la sala escribe o lee en el teléfono del cliente, y lo que viaja
  -- en el concepto del descarte. Sale del id: único por construcción.
  codigo            text GENERATED ALWAYS AS ('PS-' || lpad(id::text, 6, '0')) STORED UNIQUE,
  customer_id       bigint NOT NULL REFERENCES public.customers(id),
  tipo              text NOT NULL CHECK (tipo IN ('producto', 'promocional')),
  -- La foto del premio TAL COMO SALIÓ: cambiar la lista de premios después no
  -- cambia lo que alguien ya ganó.
  nombre            text NOT NULL,
  product_id        bigint,
  presentacion_tipo text,
  factor            integer,
  cantidad          integer NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 20),
  promocional_id    bigint REFERENCES public.promocionales(id),
  nivel             text,                   -- «Oro», «Rubí»: de qué raspable salió
  mes               date NOT NULL,          -- primer día del mes del raspable
  ganado_el         date NOT NULL,
  vence_el          date NOT NULL,
  raspado_el        timestamptz,
  -- Dónde lo va a retirar: lo elige el cliente en la app.
  branch_id         integer REFERENCES public.branches(id),
  estado            text NOT NULL DEFAULT 'POR_RETIRAR'
                    CHECK (estado IN ('POR_RETIRAR', 'ENTREGANDO', 'ENTREGADO')),
  tomado_at         timestamptz,            -- ENTREGANDO: quién y cuándo lo tomó
  entregado_at      timestamptz,
  entregado_por     uuid,
  entregado_branch  integer REFERENCES public.branches(id),
  -- Lo que el sistema de la caja contestó al descartarlo (sólo producto).
  erp_aplicado      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'producto' AND product_id IS NOT NULL AND presentacion_tipo IS NOT NULL AND factor IS NOT NULL)
      OR (tipo = 'promocional' AND promocional_id IS NOT NULL)),
  UNIQUE (customer_id, mes)
);
CREATE INDEX IF NOT EXISTS puntos_premios_por_retirar ON public.puntos_premios (branch_id) WHERE estado <> 'ENTREGADO';
CREATE INDEX IF NOT EXISTS puntos_premios_promocional ON public.puntos_premios (promocional_id) WHERE promocional_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS puntos_premios_entregado_branch ON public.puntos_premios (entregado_branch) WHERE entregado_branch IS NOT NULL;

-- ── RLS: se lee con el permiso de Puntos; se escribe sólo por funciones ────
ALTER TABLE public.promocionales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocionales_existencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocionales_envios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocionales_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puntos_premios            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promocionales_select ON public.promocionales;
CREATE POLICY promocionales_select ON public.promocionales FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
DROP POLICY IF EXISTS promocionales_existencias_select ON public.promocionales_existencias;
CREATE POLICY promocionales_existencias_select ON public.promocionales_existencias FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
DROP POLICY IF EXISTS promocionales_envios_select ON public.promocionales_envios;
CREATE POLICY promocionales_envios_select ON public.promocionales_envios FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
DROP POLICY IF EXISTS promocionales_movimientos_select ON public.promocionales_movimientos;
CREATE POLICY promocionales_movimientos_select ON public.promocionales_movimientos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
DROP POLICY IF EXISTS puntos_premios_select ON public.puntos_premios;
CREATE POLICY puntos_premios_select ON public.puntos_premios FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));

-- Las cinco se leen sólo con sesión; `anon` no ve nada.
REVOKE ALL ON public.promocionales, public.promocionales_existencias, public.promocionales_envios,
              public.promocionales_movimientos, public.puntos_premios FROM anon;
GRANT SELECT ON public.promocionales, public.promocionales_existencias, public.promocionales_envios,
                public.promocionales_movimientos, public.puntos_premios TO authenticated;
-- Y el servidor (las edge functions) con todo, EXPLÍCITO: medido en el entorno
-- de pruebas, sin esto `app-clientes` daba «permission denied» y el resumen de
-- cualquier cliente sin cupón de puntos se caía entero.
GRANT ALL ON public.promocionales, public.promocionales_existencias, public.promocionales_envios,
             public.promocionales_movimientos, public.puntos_premios TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.promocionales_id_seq, public.promocionales_envios_id_seq,
             public.promocionales_movimientos_id_seq, public.puntos_premios_id_seq TO service_role;

