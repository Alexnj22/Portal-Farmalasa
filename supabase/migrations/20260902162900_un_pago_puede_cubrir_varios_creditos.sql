SET lock_timeout = '5s';

/* ── Un pago es UN documento y puede cubrir VARIOS créditos ────────────────
 *
 * Pregunta del usuario (2-sep): «¿qué pasa si hace una sola transferencia para
 * pagar 3 créditos? ¿cómo se anexan?». Hasta acá no pasaba nada bueno: el abono
 * era de a un crédito con su comprobante, así que el mismo papel se habría
 * anexado tres veces —tres veces $50 en la bitácora para $50 que entraron— y el
 * lector habría RECHAZADO dos de los tres, porque compara el monto del papel
 * contra el saldo de UN crédito.
 *
 * El modelo correcto separa dos cosas que estaban pegadas:
 *
 *   el PAGO      un documento, un monto, una referencia. Es lo que aparece en
 *                el estado de cuenta del banco, y aparece UNA vez.
 *   el ABONO     cuánto de ese pago se aplicó a cada crédito.
 *
 * Sin la separación, cuadrar el banco contra el portal es imposible: la suma de
 * los abonos daría el triple de lo que el banco movió.
 *
 * Y no es un caso raro: medido, **24 de los 43 clientes con saldo tienen más de
 * un crédito** —103 de los 124— y uno tiene once.
 *
 * Vale para el efectivo también, y eso no es un extra: un cliente que llega con
 * $50 en la mano a pagar tres créditos es el mismo caso, y hoy obligaba a
 * inventar tres operaciones.
 */
CREATE TABLE IF NOT EXISTS public.creditos_pagos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       bigint      NOT NULL REFERENCES public.branches(id),

    customer_id     bigint      REFERENCES public.customers(id),
    -- El nombre TAL COMO estaba al cobrar. Si mañana le corrigen la ficha, el
    -- pago tiene que seguir diciendo de quién se recibió.
    cliente         text        NOT NULL,

    forma           text        NOT NULL,
    monto           numeric(12,2) NOT NULL CHECK (monto > 0),
    documento       text,
    -- La fecha del DOCUMENTO, que no es la del registro: una transferencia
    -- hecha el viernes se anota el lunes, y cuadrarla contra el estado de
    -- cuenta exige la primera.
    fecha_documento date,
    pos_proveedor   text        REFERENCES public.pos_proveedores(codigo),

    comprobante_url text,
    lectura         jsonb,

    registrado_por  uuid        NOT NULL REFERENCES public.employees(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creditos_pagos IS
    'El documento con el que un cliente paga: un monto, una referencia, una vez. Los abonos dicen cuánto de él se aplicó a cada crédito.';

CREATE INDEX IF NOT EXISTS creditos_pagos_branch_idx   ON public.creditos_pagos (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creditos_pagos_customer_idx ON public.creditos_pagos (customer_id);
CREATE INDEX IF NOT EXISTS creditos_pagos_quien_idx    ON public.creditos_pagos (registrado_por);
CREATE INDEX IF NOT EXISTS creditos_pagos_pos_idx      ON public.creditos_pagos (pos_proveedor);

/* ── El mismo comprobante no se puede usar dos veces ───────────────────────
 * Una referencia bancaria identifica UNA transferencia en el mundo. Sin esto,
 * nada impide anexar el mismo papel al día siguiente para otro cliente: el
 * portal registraría dinero que nunca entró y el banco no lo desmentiría hasta
 * la conciliación del mes. Global y no por sala a propósito — la referencia no
 * cambia de significado según dónde se cobre.
 *
 * Sólo cuando hay documento y no es efectivo: el efectivo no trae número, y dos
 * pagos en efectivo del mismo día son dos pagos. */
CREATE UNIQUE INDEX IF NOT EXISTS creditos_pagos_documento_unico
    ON public.creditos_pagos (forma, documento)
    WHERE documento IS NOT NULL AND documento <> '' AND forma <> 'Efectivo';

ALTER TABLE public.creditos_pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY creditos_pagos_select ON public.creditos_pagos
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view'))
        AND (
            (SELECT auth_module_scope('cuentas_por_cobrar')) = 'ALL'
            OR branch_id = (SELECT auth_employee_branch_id())
        )
    );

/* Sin INSERT para `authenticated`: lo escribe la edge function con
 * `service_role`, y sólo DESPUÉS de que el abono entró de verdad al sistema de
 * la caja. Una fila escrita desde el navegador diría que se recibió un dinero
 * que nunca se movió. */

CREATE POLICY bloqueo_global ON public.creditos_pagos
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.creditos_pagos TO authenticated;
REVOKE ALL ON public.creditos_pagos FROM anon;


/* Cada abono dice de qué pago salió. Nullable porque los tres abonos que ya se
 * hicieron son de antes de esta tabla — y borrarlos para que el esquema quede
 * bonito sería borrar dinero real que entró. */
ALTER TABLE public.creditos_abonos_portal
    ADD COLUMN IF NOT EXISTS pago_id bigint REFERENCES public.creditos_pagos(id);

CREATE INDEX IF NOT EXISTS creditos_abonos_pago_idx
    ON public.creditos_abonos_portal (pago_id);
