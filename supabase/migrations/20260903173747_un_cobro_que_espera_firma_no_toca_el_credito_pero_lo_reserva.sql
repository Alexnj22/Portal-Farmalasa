SET lock_timeout = '5s';

/* ── El cobro que espera firma ya no se aplica ─────────────────────────────
 *
 * Decisión del usuario (2026-09-03), sobre la pantalla de Cuentas por cobrar:
 * *«ahorita sale como pagado, ¿no debería quedar como pendiente y con saldo?
 * Cambiaría hasta la aprobación: si se aprueba pasa a pagado, si se descarta
 * continúa con saldo.»*
 *
 * Invierte la decisión del 2-sep —«el abono YA entró y no se hace esperar»—
 * con el motivo enfrente: un abono aplicado deja el crédito en $0.00, y un
 * crédito en cero que todavía puede volver a subir se lee como cobrado. Ahora
 * el cobro se GUARDA y no se aplica: al aprobar se abona de verdad, y al
 * devolverlo no hay nada que deshacer porque el saldo nunca bajó.
 *
 * ── Por qué hace falta esta tabla y no alcanza la solicitud ────────────────
 * Con el modelo viejo el crédito quedaba en cero, así que nadie lo volvía a
 * cobrar. Ahora sigue **con saldo**, y eso abre un agujero que antes no
 * existía: dos personas pueden cobrar el mismo crédito mientras el primero
 * espera firma, y el cliente pagaría dos veces.
 *
 * Los renglones viven dentro de `approval_requests.metadata->'creditos'`, o sea
 * en un array jsonb: ahí no hay índice único posible. Acá sí — uno por
 * (sala, crédito) mientras esté sin resolver—, y además le da a la pantalla
 * algo que leer con su propio permiso: marcar el crédito reservado desde
 * Cuentas por cobrar no puede exigir el permiso de Solicitudes.
 *
 * `ON DELETE CASCADE`: si la solicitud se borra, la reserva se va con ella. Una
 * reserva huérfana bloquearía un crédito para siempre, y el síntoma sería «no
 * me deja cobrar» sin nada que mirar.
 */

CREATE TABLE IF NOT EXISTS public.creditos_cobros_por_aprobar (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    solicitud_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
    branch_id    integer NOT NULL REFERENCES public.branches(id),
    credito_erp  text NOT NULL,
    cliente      text,
    monto        numeric(12,2) NOT NULL CHECK (monto > 0),
    -- Se sella al resolver la solicitud, entre o no entre: lo que libera el
    -- crédito es que ya nadie esté esperando por él.
    resuelto_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- La garantía dura: un crédito no puede tener dos cobros esperando.
CREATE UNIQUE INDEX IF NOT EXISTS creditos_cobros_por_aprobar_uno_vivo
    ON public.creditos_cobros_por_aprobar (branch_id, credito_erp)
    WHERE resuelto_at IS NULL;

-- Las dos lecturas que hace la pantalla: por sala, y por solicitud al resolver.
CREATE INDEX IF NOT EXISTS creditos_cobros_por_aprobar_sala
    ON public.creditos_cobros_por_aprobar (branch_id) WHERE resuelto_at IS NULL;
CREATE INDEX IF NOT EXISTS creditos_cobros_por_aprobar_solicitud
    ON public.creditos_cobros_por_aprobar (solicitud_id);

ALTER TABLE public.creditos_cobros_por_aprobar ENABLE ROW LEVEL SECURITY;

/* Ver la reserva es ver la cartera: mismo permiso que la pantalla donde se
 * muestra. Sin policy de escritura a propósito — sólo la escribe
 * `creditos-erp` con la llave del servidor, que no pasa por RLS. Que el
 * navegador no pueda liberar una reserva es el punto: liberarla es cobrar dos
 * veces. */
DROP POLICY IF EXISTS creditos_cobros_por_aprobar_select ON public.creditos_cobros_por_aprobar;
CREATE POLICY creditos_cobros_por_aprobar_select ON public.creditos_cobros_por_aprobar
FOR SELECT TO authenticated
USING ((SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view')));
