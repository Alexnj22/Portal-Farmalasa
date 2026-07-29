-- ═══════════════════════════════════════════════════════════════════════════
-- MÓDULO PROMOCIONES
-- employees.id = uuid, branches.id = bigint
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE public.promotions (
    id              bigserial PRIMARY KEY,
    nombre          text NOT NULL,
    laboratorio_id  bigint REFERENCES public.laboratorios(id) ON DELETE SET NULL,
    estado          text NOT NULL DEFAULT 'draft'
                        CHECK (estado IN ('draft', 'active', 'paused', 'closed')),
    fecha_inicio    date,
    fecha_fin       date,
    end_condition   text NOT NULL DEFAULT 'date'
                        CHECK (end_condition IN ('date', 'stock', 'both')),
    notas           text,
    created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT NOW(),
    updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE public.promotion_branches (
    promotion_id  bigint NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    branch_id     bigint NOT NULL REFERENCES public.branches(id)   ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, branch_id)
);

CREATE TABLE public.promotion_products (
    id                  bigserial PRIMARY KEY,
    promotion_id        bigint  NOT NULL REFERENCES public.promotions(id)   ON DELETE CASCADE,
    product_id          bigint  NOT NULL REFERENCES public.products(id)     ON DELETE CASCADE,
    factor_descripcion  text,
    factor_denominador  integer NOT NULL DEFAULT 1 CHECK (factor_denominador >= 1),
    precio_promo        numeric(12,4),
    stock_inicial       integer CHECK (stock_inicial >= 0),
    receipt_id          bigint REFERENCES public.purchase_receipts(id) ON DELETE SET NULL,
    bono_vendedor       numeric(10,2) NOT NULL DEFAULT 0 CHECK (bono_vendedor >= 0),
    bono_admin_pool     numeric(10,2) NOT NULL DEFAULT 0 CHECK (bono_admin_pool >= 0),
    bono_bodega_pool    numeric(10,2) NOT NULL DEFAULT 0 CHECK (bono_bodega_pool >= 0),
    created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE public.promotion_bonifications (
    id                    bigserial PRIMARY KEY,
    promotion_product_id  bigint NOT NULL REFERENCES public.promotion_products(id) ON DELETE CASCADE,
    employee_id           uuid   NOT NULL REFERENCES public.employees(id)          ON DELETE CASCADE,
    role                  text   NOT NULL CHECK (role IN ('vendedor', 'admin', 'bodega')),
    units_credited        integer     NOT NULL DEFAULT 0 CHECK (units_credited >= 0),
    amount_earned         numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_earned >= 0),
    amount_paid           numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    updated_at            timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (promotion_product_id, employee_id, role)
);

CREATE TABLE public.promotion_payments (
    id            bigserial PRIMARY KEY,
    promotion_id  bigint NOT NULL REFERENCES public.promotions(id)  ON DELETE CASCADE,
    employee_id   uuid   NOT NULL REFERENCES public.employees(id)   ON DELETE CASCADE,
    amount        numeric(10,2) NOT NULL CHECK (amount > 0),
    notes         text,
    paid_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    paid_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE public.promotion_sales_cache (
    promotion_product_id  bigint NOT NULL REFERENCES public.promotion_products(id) ON DELETE CASCADE,
    fecha                 date   NOT NULL,
    branch_id             bigint NOT NULL REFERENCES public.branches(id)           ON DELETE CASCADE,
    units_sold            integer NOT NULL DEFAULT 0 CHECK (units_sold >= 0),
    PRIMARY KEY (promotion_product_id, fecha, branch_id)
);

CREATE INDEX idx_promotions_estado        ON public.promotions(estado);
CREATE INDEX idx_promo_products_promo_id  ON public.promotion_products(promotion_id);
CREATE INDEX idx_promo_products_product   ON public.promotion_products(product_id);
CREATE INDEX idx_promo_bonif_emp          ON public.promotion_bonifications(employee_id);
CREATE INDEX idx_promo_sales_cache_pp     ON public.promotion_sales_cache(promotion_product_id);
CREATE INDEX idx_promo_payments_emp       ON public.promotion_payments(employee_id);

ALTER TABLE public.promotions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_branches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_bonifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_sales_cache    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON public.promotions              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.promotion_branches      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.promotion_products      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.promotion_bonifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.promotion_payments      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.promotion_sales_cache   FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_promotions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_promotions_updated_at
BEFORE UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public.touch_promotions_updated_at();
