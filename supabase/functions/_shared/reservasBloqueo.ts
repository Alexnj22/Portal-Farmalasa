// Reglamento de reservas 3.7: «si en treinta (30) días deja vencer tres (3)
// reservas sin retirarlas, no podrá reservar sin pago durante los treinta (30)
// días SIGUIENTES». O sea que el bloqueo dura 30 días contados desde la
// TERCERA, no mientras queden tres dentro de una ventana móvil — así, con
// vencidas el 16-nov, 17-nov y 14-dic, duraba dos días (auditoría 2026-11-03).
// Un pedido de varios productos cuenta como una sola. Devuelve hasta cuándo
// está bloqueado, o null. Antes del v2 (`v2 = false`) sigue la regla vieja:
// tres en los últimos 30 días. Lo prueba `tests/unit/bloqueoPorVencidas.test.js`.
export function bloqueoPorVencidas(vencidas: any[], v2: boolean, ahora = Date.now()): Date | null {
  const DIA = 86400_000;
  const porPedido = new Map<string, number>();
  for (const r of vencidas) {
    const t = Date.parse(r.cerrada_at);
    if (!Number.isFinite(t)) continue;
    const k = r.pedido ?? `r${r.id}`;
    porPedido.set(k, Math.min(porPedido.get(k) ?? Infinity, t));
  }
  const ts = [...porPedido.values()].sort((a, b) => a - b);
  if (!v2) {
    const recientes = ts.filter((t) => t >= ahora - 30 * DIA);
    return recientes.length >= 3 ? new Date(recientes[recientes.length - 1] + 30 * DIA) : null;
  }
  let hasta = 0;
  for (let i = 2; i < ts.length; i++) {
    if (ts[i] - ts[i - 2] <= 30 * DIA) hasta = Math.max(hasta, ts[i] + 30 * DIA);
  }
  return hasta > ahora ? new Date(hasta) : null;
}

export const fechaCorta = (d: Date) => new Intl.DateTimeFormat("es-SV", { timeZone: "America/El_Salvador", day: "numeric", month: "long" }).format(d);
