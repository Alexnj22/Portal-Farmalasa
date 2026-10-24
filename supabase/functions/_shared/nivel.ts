// El nivel del programa de puntos de un cliente (2026-10-07): Bronce (clave
// 'vip'), Plata, Oro o Platino, según lo comprado en los últimos 12 meses. La
// regla vive en la base (`puntos_niveles` + `puntos_compra_12m`), la misma que
// usa el motor para multiplicar los puntos; acá sólo se lee. Lo usan
// `app-clientes` (la tarjeta, la barra de «te faltan $X» y las ofertas
// anticipadas) y la tarjeta de Wallet.
//
// 2026-10-19 (auditoría de niveles): la compra es la de TODAS las facturas
// válidas (`puntos_compra_12m` cambió en la base), y lo que cada nivel promete
// sale de lo configurado en el portal (pestaña Puntos → Niveles), no de listas
// escritas en la app: `beneficios` lo arma este archivo desde la tabla, así la
// app no puede prometer algo que el programa no da.

export type NivelFila = {
  clave: string; nombre: string; desde: number; factor: number;
  puntos_cumpleanos: number; horas_reserva: number; cupon_mensual: number;
  // Desde el 2026-10-19 un premio también puede ser un producto o un regalo
  // promocional (`tipo`), sin `puntos`.
  cupon_premios: { puntos?: number; peso: number; tipo?: string; nombre?: string }[] | null;
  dias_anticipo_ofertas: number;
};

export type Nivel = {
  clave: string; nombre: string; factor: number; cumpleanos: number; horas_reserva: number;
  /** Puntos del raspable por defecto (0 si el nivel no tiene). */
  cupon_mensual: number;
  /** ¿Este nivel recibe el raspable del mes? */
  raspable: boolean;
  /** Días antes que el resto en que este nivel ve las ofertas (0 = el mismo día). */
  dias_anticipo_ofertas: number;
  /** Lo comprado en 12 meses: TODAS las facturas válidas (la misma cifra del «te faltan»). */
  compra: number;
  /** Lo que el nivel da, en palabras, armado desde la configuración. */
  beneficios: string[];
  siguiente: { clave: string; nombre: string; desde: number; factor: number; falta: number; beneficios: string[] } | null;
  /** false mientras los niveles estén apagados (Reglamento v2 sin publicar). */
  activos: boolean;
  desde: string | null;
  /** Apagados: el nivel que su compra real ya alcanza (se aplica al encenderlos). */
  proyectado: { clave: string; nombre: string } | null;
};

/** Hoy en El Salvador, 'AAAA-MM-DD'. */
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

const factorTexto = (f: number) => (Number(f) === 1 ? "1 punto" : `${Number(f)} puntos`);

/** Lo que promete un nivel, desde su fila. `base` es el nivel de entrada (para no repetir lo que todos tienen). */
export function beneficiosDe(n: NivelFila, base: NivelFila | null): string[] {
  const b = [`${factorTexto(n.factor)} por cada $1`];
  if (Number(n.puntos_cumpleanos) > 0) b.push(`${Number(n.puntos_cumpleanos)} puntos en tu cumpleaños`);
  if (Number(n.cupon_mensual) > 0 || (n.cupon_premios?.length ?? 0) > 0) {
    const conRegalos = (n.cupon_premios ?? []).some((x) => x.tipo === "producto" || x.tipo === "promocional");
    b.push(conRegalos ? "Raspable mensual con puntos y regalos" : "Raspable mensual con premios en puntos");
  }
  // Ver las ofertas antes y reservas de 48 h por nivel se quitaron el
  // 2026-10-24: el reglamento no los tiene. `base` queda en la firma para no
  // romper a los llamadores.
  void base;
  return b;
}

// deno-lint-ignore no-explicit-any
export async function escaleraDeNiveles(admin: any): Promise<{ lista: NivelFila[]; activos: boolean; desde: string | null }> {
  const [{ data: niveles, error: eN }, { data: cfg, error: eF }] = await Promise.all([
    admin.from("puntos_niveles")
      .select("clave, nombre, desde, factor, puntos_cumpleanos, horas_reserva, cupon_mensual, cupon_premios, dias_anticipo_ofertas")
      .order("desde"),
    // Los niveles rigen por FECHA desde el 2026-10-24 (Reglamento v2), no por
    // un interruptor: la misma regla que `puntos_nivel_de` en la base.
    admin.from("puntos_config").select("reglas_v2_desde").limit(1).maybeSingle(),
  ]);
  if (eN) throw eN;
  if (eF) throw eF;
  // deno-lint-ignore no-explicit-any
  const lista: NivelFila[] = (niveles ?? []).map((n: any) => ({
    ...n, desde: Number(n.desde), factor: Number(n.factor), cupon_mensual: Number(n.cupon_mensual ?? 0),
    dias_anticipo_ofertas: 0,
  }));
  const desde: string | null = cfg?.reglas_v2_desde ?? null;
  return { lista, activos: desde != null && hoySV() >= String(desde).slice(0, 10), desde };
}

// deno-lint-ignore no-explicit-any
export async function nivelDeCliente(admin: any, customerId: number): Promise<Nivel> {
  const [{ data: compra, error: eC }, { lista, activos, desde }] = await Promise.all([
    admin.rpc("puntos_compra_12m", { p_customer_id: customerId, p_hasta: hoySV() }),
    escaleraDeNiveles(admin),
  ]);
  if (eC) throw eC;
  // Apagados hasta el Reglamento v2 (2026-10-08): todos en el nivel de entrada,
  // igual que `puntos_nivel_de` en la base.
  const real = Number(compra ?? 0);
  const c = activos ? real : 0;
  const i = Math.max(0, lista.findLastIndex((n) => n.desde <= c));
  const base = lista[0] ?? null;
  const n: NivelFila = lista[i] ?? {
    clave: "vip", nombre: "Bronce", desde: 0, factor: 1, puntos_cumpleanos: 50, horas_reserva: 24,
    cupon_mensual: 0, cupon_premios: null, dias_anticipo_ofertas: 0,
  };
  // Apagados (2026-10-19): sin escalera. Antes se calculaba el «siguiente» con
  // la compra real y la app, con la falta en 0, decía «Estás en el nivel más
  // alto» a quien compraba más de $500 estando en Bronce. Apagados no hay
  // siguiente que prometer: sólo el nivel de entrada y «se activan pronto».
  const s = activos ? lista[i + 1] : undefined;
  const iReal = Math.max(0, lista.findLastIndex((x) => x.desde <= real));
  const proyectado = !activos && lista[iReal] ? { clave: lista[iReal].clave, nombre: lista[iReal].nombre } : null;
  const raspable = Number(n.cupon_mensual) > 0 || (n.cupon_premios?.length ?? 0) > 0;
  return {
    clave: n.clave, nombre: n.nombre, factor: n.factor, cumpleanos: n.puntos_cumpleanos, horas_reserva: n.horas_reserva,
    cupon_mensual: Number(n.cupon_mensual ?? 0),
    raspable,
    dias_anticipo_ofertas: 0,
    compra: Math.round(real * 100) / 100,
    // Apagados, `n` es el nivel de entrada: sólo lo que hoy rige para todos
    // (1 punto por $1 y el cumpleaños). Nada de lo que traen los demás niveles.
    beneficios: beneficiosDe(n, base),
    activos,
    // Desde cuándo rigen (la fecha del Reglamento v2): la app la dice en vez
    // de «pronto».
    desde,
    proyectado,
    siguiente: s ? {
      clave: s.clave, nombre: s.nombre, desde: s.desde, factor: s.factor,
      falta: Math.max(0, Math.round((s.desde - real) * 100) / 100),
      beneficios: beneficiosDe(s, base),
    } : null,
  };
}

/**
 * El programa tal como está configurado (2026-10-19), para la app: la escalera
 * con lo que da cada nivel y los premios del raspable, y los beneficios del
 * Cliente Mayorista por rango. Lo usa el modo de prueba —que antes tenía su
 * propia tabla de premios escrita en `lib/prueba.js`— y la tarjeta del
 * mayorista. Son ocho filas: viaja en el resumen sin costo.
 */
// deno-lint-ignore no-explicit-any
export async function programaParaApp(admin: any) {
  const [{ lista, activos, desde }, { data: rangos, error: eR }] = await Promise.all([
    escaleraDeNiveles(admin),
    admin.from("puntos_mayoreo_beneficios").select("clave, nombre, orden, puntos_cumpleanos, cupon_mensual, cupon_premios").order("orden"),
  ]);
  if (eR) throw eR;
  const base = lista[0] ?? null;
  return {
    activos,
    desde,
    niveles: lista.map((n) => ({
      clave: n.clave, nombre: n.nombre, desde: n.desde, factor: n.factor, cumpleanos: Number(n.puntos_cumpleanos ?? 0),
      raspable: Number(n.cupon_mensual) > 0 || (n.cupon_premios?.length ?? 0) > 0,
      cupon_mensual: Number(n.cupon_mensual ?? 0), premios: n.cupon_premios ?? [],
      beneficios: beneficiosDe(n, base),
    })),
    mayoreo: {
      // Los beneficios del mayorista rigen desde la misma fecha que los niveles.
      activos,
      // deno-lint-ignore no-explicit-any
      rangos: (rangos ?? []).map((r: any) => ({
        clave: r.clave, nombre: r.nombre, cumpleanos: Number(r.puntos_cumpleanos ?? 0),
        raspable: Number(r.cupon_mensual ?? 0) > 0 || (r.cupon_premios?.length ?? 0) > 0,
        cupon_mensual: Number(r.cupon_mensual ?? 0), premios: r.cupon_premios ?? [],
      })),
    },
  };
}
