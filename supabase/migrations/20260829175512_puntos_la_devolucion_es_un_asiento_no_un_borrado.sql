SET lock_timeout = '5s';

-- ── Cómo se devuelve un punto, y por qué así ─────────────────────────────────
-- Se investigó el sistema de puntos buscando si alguna vez se había restado
-- (2026-08-29, a pedido del usuario). El resultado, medido:
--
--   · CERO ventas con puntos negativos, en tres años.
--   · CERO saldos negativos.
--   · CERO asientos que mencionen resta, anulación, corrección o devolución.
--
-- O sea que restar nunca se hizo. Pero la convención para un asiento MANUAL sí
-- existe y está bien establecida: `TicketFactura` en `Ventas` y `TKT` en
-- `Canjes` —que normalmente llevan el número del ticket— guardan el motivo EN
-- TEXTO cuando la línea se carga a mano. Así se registraron 4,772 «Cortesía
-- cumpleaños» (238,600 puntos), las promos de Navidad y varias «Autorizado.
-- Carlos R.».
--
-- ⚠️ NOTA del mismo día: la primera versión de este comentario decía que la
-- devolución se haría con una fila de `Ventas` en NEGATIVO. El usuario lo
-- corrigió — «verifica el canje de puntos, así se usa eso, y el motivo es por
-- anulación»— y tiene razón por tres motivos que se comprobaron en la base:
-- el saldo sale de `registrados − redimidos`, así que un CANJE lo baja por el
-- camino previsto; `PuntosCanjeados` es UNSIGNED, o sea que un negativo ni
-- cabría; y no hay un solo número negativo en esa base en tres años. El SQL de
-- esta migración no cambia —son columnas de la bitácora del portal—: lo que
-- cambió es qué escribe `sync-puntos` del otro lado.
--
-- Entonces la devolución es: un `Canjes` con el motivo («Anul <correlativo>»),
-- bajar `Clientes.Puntos` (caché mantenida, no derivado) y quitar la fila de
-- `admin_factura` para que el ticket no se re-canjee. La venta original queda
-- intacta y el cliente ve la baja como una línea propia en su estado de cuenta
-- (`VW_CardexPuntos`, que une compras y canjes), en vez de que sus puntos se
-- esfumen sin explicación — que es lo que hacía la primera versión al borrar.

-- ── Y nadie queda debiendo puntos ────────────────────────────────────────────
-- Decisión del usuario: si el cliente ya gastó esos puntos, se resta HASTA CERO
-- y se anota lo que no se pudo recuperar. Un saldo negativo le cobraría al
-- cliente un error que no cometió, y además nunca existió uno en esta base.
ALTER TABLE public.puntos_enviados
  ADD COLUMN IF NOT EXISTS puntos_devueltos      integer,
  ADD COLUMN IF NOT EXISTS puntos_no_recuperados integer;

COMMENT ON COLUMN public.puntos_enviados.puntos_devueltos IS
  'Cuántos puntos se le restaron al cliente al anularse la venta.';
COMMENT ON COLUMN public.puntos_enviados.puntos_no_recuperados IS
  'Cuántos NO se pudieron restar porque el cliente ya no tenía saldo. > 0 pide que alguien lo mire.';

CREATE OR REPLACE FUNCTION public.puntos_anotar_devolucion(
  p_invoice_id       bigint,
  p_devueltos        integer,
  p_no_recuperados   integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
BEGIN
  UPDATE public.puntos_enviados
     SET reversion             = 'RESTADA',
         revertida_at          = now(),
         puntos_devueltos      = p_devueltos,
         puntos_no_recuperados = p_no_recuperados
   WHERE invoice_id = p_invoice_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_anotar_devolucion(bigint, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_anotar_devolucion(bigint, integer, integer) TO service_role;
