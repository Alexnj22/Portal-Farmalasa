// El nivel del programa de puntos de un cliente (2026-10-07): Cliente VIP,
// Plata, Oro o Platino, según lo comprado en los últimos 12 meses. La regla
// vive en la base (`puntos_niveles` + `puntos_compra_12m`), la misma que usa el
// motor para multiplicar los puntos; acá sólo se lee. Lo usan `app-clientes`
// (la tarjeta y la barra de «te faltan $X») y la tarjeta de Wallet.

export type Nivel = {
  clave: string; nombre: string; factor: number; cumpleanos: number; horas_reserva: number;
  compra: number;
  siguiente: { clave: string; nombre: string; desde: number; factor: number; falta: number } | null;
};

/** Hoy en El Salvador, 'AAAA-MM-DD'. */
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

// deno-lint-ignore no-explicit-any
export async function nivelDeCliente(admin: any, customerId: number): Promise<Nivel> {
  const [{ data: compra, error: eC }, { data: niveles, error: eN }] = await Promise.all([
    admin.rpc("puntos_compra_12m", { p_customer_id: customerId, p_hasta: hoySV() }),
    admin.from("puntos_niveles").select("clave, nombre, desde, factor, puntos_cumpleanos, horas_reserva").order("desde"),
  ]);
  if (eC) throw eC;
  if (eN) throw eN;
  const c = Number(compra ?? 0);
  // deno-lint-ignore no-explicit-any
  const lista = (niveles ?? []).map((n: any) => ({ ...n, desde: Number(n.desde), factor: Number(n.factor) }));
  const i = Math.max(0, lista.findLastIndex((n: any) => n.desde <= c));
  const n = lista[i] ?? { clave: "vip", nombre: "Cliente VIP", factor: 1, puntos_cumpleanos: 50, horas_reserva: 24 };
  const s = lista[i + 1];
  return {
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.puntos_cumpleanos, horas_reserva: n.horas_reserva,
    compra: Math.round(c * 100) / 100,
    siguiente: s ? { clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor, falta: Math.max(0, Math.round((s.desde - c) * 100) / 100) } : null,
  };
}
