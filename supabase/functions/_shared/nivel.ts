// El nivel del programa de puntos de un cliente (2026-10-07): Cliente VIP,
// Plata, Oro o Platino, según lo comprado en los últimos 12 meses. La regla
// vive en la base (`puntos_niveles` + `puntos_compra_12m`), la misma que usa el
// motor para multiplicar los puntos; acá sólo se lee. Lo usan `app-clientes`
// (la tarjeta y la barra de «te faltan $X») y la tarjeta de Wallet.

export type Nivel = {
  clave: string; nombre: string; factor: number; cumpleanos: number; horas_reserva: number;
  /** Puntos del cupón mensual (Platino: 500 = $5); 0 si el nivel no tiene. */
  cupon_mensual: number;
  compra: number;
  siguiente: { clave: string; nombre: string; desde: number; factor: number; falta: number } | null;
  /** false mientras los niveles estén apagados (Reglamento v2 sin publicar). */
  activos: boolean;
  /** Apagados: el nivel que su compra real ya alcanza (se aplica al encenderlos). */
  proyectado: { clave: string; nombre: string } | null;
};

/** Hoy en El Salvador, 'AAAA-MM-DD'. */
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

// deno-lint-ignore no-explicit-any
export async function nivelDeCliente(admin: any, customerId: number): Promise<Nivel> {
  const [{ data: compra, error: eC }, { data: niveles, error: eN }, { data: cfg, error: eF }] = await Promise.all([
    admin.rpc("puntos_compra_12m", { p_customer_id: customerId, p_hasta: hoySV() }),
    admin.from("puntos_niveles").select("clave, nombre, desde, factor, puntos_cumpleanos, horas_reserva, cupon_mensual").order("desde"),
    admin.from("puntos_config").select("niveles_activos").limit(1).maybeSingle(),
  ]);
  if (eC) throw eC;
  if (eN) throw eN;
  if (eF) throw eF;
  // Apagados hasta el Reglamento v2 (2026-10-08): todos en el nivel de entrada,
  // igual que `puntos_nivel_de` en la base. La app no muestra la escalera.
  const activos = cfg?.niveles_activos === true;
  const real = Number(compra ?? 0);
  const c = activos ? real : 0;
  // deno-lint-ignore no-explicit-any
  const lista = (niveles ?? []).map((n: any) => ({ ...n, desde: Number(n.desde), factor: Number(n.factor) }));
  const i = Math.max(0, lista.findLastIndex((n: any) => n.desde <= c));
  const n = lista[i] ?? { clave: "vip", nombre: "Bronce", factor: 1, puntos_cumpleanos: 50, horas_reserva: 24, cupon_mensual: 0 };
  const s = lista[i + 1];
  // Apagados (2026-10-09): la tarjeta sigue en el de entrada, pero el panel
  // dice cuánto le falta con su compra REAL y qué nivel ya alcanza.
  const iReal = Math.max(0, lista.findLastIndex((x: any) => x.desde <= real));
  const proyectado = !activos && lista[iReal] ? { clave: lista[iReal].clave, nombre: lista[iReal].nombre } : null;
  return {
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.puntos_cumpleanos, horas_reserva: n.horas_reserva,
    cupon_mensual: Number(n.cupon_mensual ?? 0),
    compra: Math.round(Number(compra ?? 0) * 100) / 100,
    activos,
    proyectado,
    siguiente: s ? { clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor, falta: Math.max(0, Math.round((s.desde - real) * 100) / 100) } : null,
  };
}
