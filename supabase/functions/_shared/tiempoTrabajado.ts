// La matemática del tiempo trabajado: UNA sola copia (2026-10-28).
//
// Vivía adentro de `consolidate-timesheets/index.ts`, que es lo que llena
// `timesheets` y por lo tanto lo que se PAGA, y no tenía ni una prueba: corre en
// Deno y la suite del navegador no la alcanzaba. Hoy se verificaba leyendo los
// `console.log` de la corrida (ASISTENCIA §7, «la deuda más grande del área»).
//
// Además la tardanza estaba escrita dos veces —acá y en
// `src/data/attendanceAudit.js`, que la recalcula para mostrarla— con la misma
// regla por casualidad. Ahora las dos leen `minutosDeTardanza` de este archivo,
// y `tests/unit/tiempoTrabajado.test.js` lo prueba desde vitest, igual que
// `selloDeCompra.ts`.
//
// Sólo funciones puras: nada de Deno, nada de red. Si hace falta algo de eso,
// va en quien llama.

// El Salvador no cambia de hora: UTC−6 todo el año.
export const CST_OFFSET_MS = 6 * 60 * 60 * 1000;

export const LUNCH_OUT  = new Set(['LUNCH_START', 'OUT_LUNCH']);
export const LUNCH_IN   = new Set(['LUNCH_END',   'IN_LUNCH']);
export const LACTAT_OUT = new Set(['LACTATION_START', 'OUT_LACTATION']);
export const LACTAT_IN  = new Set(['LACTATION_END',   'IN_LACTATION']);

export type Marcacion = { type: string; timestamp: string };

/** «HH:MM» → minutos desde la medianoche. */
export function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Suma los descansos emparejados (salida → regreso), en minutos. */
export function calcBreakMinutes(punches: Marcacion[], outSet: Set<string>, inSet: Set<string>): number {
  let total = 0;
  let outAt: Date | null = null;
  for (const p of punches) {
    if (outSet.has(p.type)) {
      outAt = new Date(p.timestamp);
    } else if (inSet.has(p.type) && outAt) {
      total += (new Date(p.timestamp).getTime() - outAt.getTime()) / 60000;
      outAt = null;
    }
  }
  return Math.max(0, total);
}

/**
 * Reparte un tramo trabajado en minutos diurnos (06:00–19:00 SV) y nocturnos
 * (19:00–06:00 SV) (Código de Trabajo). En UTC las fronteras son las
 * 12:00 (06:00 SV) y la 01:00 (19:00 SV del día anterior). Vale para tramos que
 * cruzan la medianoche.
 */
export function splitNocturnal(startUTC: Date, endUTC: Date): { diurnalMins: number; nocturnalMins: number } {
  const totalMs = endUTC.getTime() - startUTC.getTime();
  if (totalMs <= 0) return { diurnalMins: 0, nocturnalMins: 0 };

  // Las fronteras que caen estrictamente adentro del tramo, más sus dos puntas.
  const boundaries: number[] = [startUTC.getTime(), endUTC.getTime()];

  const iterStart = new Date(startUTC); iterStart.setUTCHours(0, 0, 0, 0);
  const iterEnd   = new Date(endUTC);   iterEnd.setUTCDate(iterEnd.getUTCDate() + 1); iterEnd.setUTCHours(0, 0, 0, 0);

  for (const d = new Date(iterStart); d.getTime() < iterEnd.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const twelveUTC = d.getTime() + 12 * 3600000; // 06:00 SV — empieza el día
    const oneUTC    = d.getTime() +  1 * 3600000; // 19:00 SV — empieza la noche
    if (twelveUTC > startUTC.getTime() && twelveUTC < endUTC.getTime()) boundaries.push(twelveUTC);
    if (oneUTC    > startUTC.getTime() && oneUTC    < endUTC.getTime()) boundaries.push(oneUTC);
  }

  boundaries.sort((a, b) => a - b);

  let nocturnalMs = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd   = boundaries[i + 1];
    if (segStart >= segEnd) continue;
    // Cada pedazo es todo diurno o todo nocturno: se clasifica por su punto medio.
    const hourCST = new Date(((segStart + segEnd) / 2) - CST_OFFSET_MS).getUTCHours();
    if (hourCST >= 19 || hourCST < 6) nocturnalMs += segEnd - segStart;
  }

  const totalMins     = totalMs / 60000;
  const nocturnalMins = Math.max(0, nocturnalMs / 60000);
  return { diurnalMins: Math.max(0, totalMins - nocturnalMins), nocturnalMins };
}

/**
 * Los tramos efectivamente trabajados: la jornada menos el ALMUERZO.
 *
 * La lactancia NO parte la jornada (2026-10-28): el RIT, Art. 61, dice que esas
 * interrupciones «serán contadas como hora efectiva de trabajo y remunerada como
 * tal». Hasta hoy se restaban igual que el almuerzo —también de las horas
 * nocturnas—, o sea que se le descontaba a la madre el tiempo que la ley le
 * paga. Nunca se marcó una lactancia (0 marcaciones), así que no hubo nadie
 * mal pagado; el almuerzo sí se descuenta porque el horario del RIT lo pone
 * fuera de la jornada («pausa alimenticia» entre dos tramos, Art. 18).
 */
export function getWorkSegments(punches: Marcacion[], actualStart: Date, actualEnd: Date): { start: Date; end: Date }[] {
  const segments: { start: Date; end: Date }[] = [];
  let segStart = new Date(actualStart);

  for (const p of punches) {
    const t = new Date(p.timestamp);
    if (t.getTime() <= actualStart.getTime() || t.getTime() >= actualEnd.getTime()) continue;

    if (LUNCH_OUT.has(p.type)) {
      if (segStart < t) segments.push({ start: new Date(segStart), end: t });
      segStart = t; // se reemplaza con el regreso
    } else if (LUNCH_IN.has(p.type)) {
      segStart = t;
    }
  }

  if (segStart < actualEnd) segments.push({ start: segStart, end: new Date(actualEnd) });
  return segments;
}

/** Una fecha `YYYY-MM-DD` y una hora «HH:MM» de El Salvador, como instante. */
export function cstTimeToUTC(workDate: string, timeStr: string): Date {
  return new Date(`${workDate}T${timeStr}:00-06:00`);
}

/** El lunes (`YYYY-MM-DD`) de la semana de `workDate`. */
export function mondayOfWeek(workDate: string): string {
  const d = new Date(workDate + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=domingo … 6=sábado
  d.setUTCDate(d.getUTCDate() - (dow + 6) % 7);
  return d.toISOString().split('T')[0];
}

/**
 * Cuántos minutos tarde entró alguien. LA regla, para el cron y para la pantalla.
 *
 * Nunca negativo: llegar antes es puntual, no «menos veinte minutos de
 * tardanza». Se cuentan minutos ENTEROS cumplidos (las 8:00:59 son puntual).
 * Sin marcación o sin turno devuelve 0 — no hay contra qué medir, y un `null`
 * se sumaría como NaN en el total de la quincena.
 */
export function minutosDeTardanza(
  marcacion: string | Date | null | undefined,
  inicioEsperado: string | Date | null | undefined,
): number {
  if (!marcacion || !inicioEsperado) return 0;
  const real     = marcacion instanceof Date ? marcacion.getTime() : new Date(marcacion).getTime();
  const esperado = inicioEsperado instanceof Date ? inicioEsperado.getTime() : new Date(inicioEsperado).getTime();
  if (Number.isNaN(real) || Number.isNaN(esperado)) return 0;
  return Math.max(0, Math.floor((real - esperado) / 60000));
}

// ─────────────────────────────────────────────────────────────────────────────
// El día consolidado POR TRAMOS (2026-11-23, jornada partida).
//
// Hasta hoy el día era «primera entrada → última salida, menos los pares
// OUT_LUNCH→IN_LUNCH», y el tope de horas regulares era fin − inicio del
// horario. Con la jornada partida (7–12 y 16–19, guardada como 7–19 con una
// pausa de 240 min) eso daba 12 h regulares a quien marcaba SALIDA a las 12 y
// ENTRADA a las 4, y escondía hasta 4 h extra a quien sí marcaba la pausa.
// Ahora:
//
//   · se suman los TRAMOS trabajados: cada marca que abre (entrada, regreso de
//     la pausa, regreso de un permiso) con la siguiente que cierra (salida,
//     salida a la pausa, salida con permiso). La lactancia y la gestión
//     externa NO cierran: son tiempo trabajado (RIT Art. 61 / jornada completa);
//   · la lactancia del horario que no cae dentro de un tramo (pegada a la
//     entrada, a la salida o a la pausa) se acredita igual (RIT Art. 61);
//   · si el horario tiene pausa y no se marcó ninguna, se descuenta la pausa
//     del horario (salvo «Omisión de almuerzo»), y queda dicho;
//   · el tope de horas regulares son las horas PAGADAS del horario
//     (`turno_del_dia.minutos_pagados`, con la pausa descontada), nunca más de
//     8 h diurnas ni 7 nocturnas (RIT Art. 16; CT Art. 161);
//   · quien no marcó la entrada pero tiene otras marcas NO está ausente: queda
//     «marcación incompleta» para Talento Humano.
// ─────────────────────────────────────────────────────────────────────────────

/** Marcas que ABREN un tramo trabajado. */
export const ABRE_TRAMO = new Set([
  'PUNCH_IN', 'IN', 'IN_EARLY', 'IN_EXTRA', 'IN_AFTER_SHIFT',
  'IN_LUNCH', 'LUNCH_END', 'IN_RETURN', 'IN_LACTATION', 'LACTATION_END',
]);
/** Marcas que CIERRAN un tramo trabajado. */
export const CIERRA_TRAMO = new Set([
  'PUNCH_OUT', 'OUT', 'OUT_LATE', 'OUT_EARLY', 'OUT_EXTRA', 'OUT_LUNCH', 'LUNCH_START',
]);
/** Marcas de ENTRADA de verdad (la tardanza se mide sólo contra éstas). */
export const ENTRADAS = new Set(['PUNCH_IN', 'IN', 'IN_EARLY', 'IN_EXTRA', 'IN_AFTER_SHIFT']);
// OUT_LACTATION / OUT_BUSINESS no abren ni cierran: la persona sigue en jornada.

/** Jornada ordinaria máxima, en minutos (RIT Art. 16; CT Art. 161). */
export const TOPE_DIURNO_MIN = 8 * 60;
export const TOPE_NOCTURNO_MIN = 7 * 60;

export type MarcaConDetalle = Marcacion & { details?: Record<string, unknown> | null };
type Intervalo = [number, number];

/** El horario de UN día, ya resuelto por `turno_del_dia`, en instantes. */
export type TurnoResuelto = {
  inicio: Date;
  fin: Date;                                   // ya corrido al día siguiente si cruza
  minutosPagados: number;                      // turno_del_dia.minutos_pagados
  pausa: { inicio: Date; fin: Date } | null;
  lactancias: { inicio: Date; fin: Date }[];
};

const largo = (xs: Intervalo[]) => xs.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) / 60000;

function unir(xs: Intervalo[]): Intervalo[] {
  const ord = xs.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Intervalo[] = [];
  for (const [a, b] of ord) {
    const u = out[out.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b);
    else out.push([a, b]);
  }
  return out;
}

function restar(xs: Intervalo[], [c, d]: Intervalo): Intervalo[] {
  const out: Intervalo[] = [];
  for (const [a, b] of xs) {
    if (d <= a || c >= b) { out.push([a, b]); continue; }
    if (a < c) out.push([a, c]);
    if (d < b) out.push([d, b]);
  }
  return out;
}

const solapa = (xs: Intervalo[], [c, d]: Intervalo) =>
  xs.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, d) - Math.max(a, c)), 0) / 60000;

const nocturnosDe = (xs: Intervalo[]) =>
  xs.reduce((s, [a, b]) => s + splitNocturnal(new Date(a), new Date(b)).nocturnalMins, 0);

export type DiaConsolidado = {
  sinMarcas: boolean;          // ninguna marca del día → ausente
  incompleta: boolean;         // faltó una marca (entrada, regreso…) → Talento Humano
  abierta: boolean;            // terminó dentro de un tramo: falta la salida
  inicioReal: Date | null;
  finReal: Date | null;
  primeraEntrada: Date | null; // sólo una ENTRADA de verdad
  pausaSinMarcar: boolean;
  minutosNetos: number;
  minutosTope: number;
  minutosRegulares: number;
  minutosExtra: number;
  minutosNocturnos: number;
  minutosNocturnosExtra: number;
  minutosTardanza: number;
};

/**
 * Consolida un día. `marcas` en orden cronológico, de la ventana del día
 * (00:00 → 08:00 del día siguiente). `inicioDelDia` / `finDelDia` acotan dónde
 * puede ABRIRSE un tramo: lo que cierra antes de la primera apertura y cae en
 * las primeras 8 h es la cola del turno nocturno de ayer y no cuenta.
 */
export function consolidarDia(
  marcas: MarcaConDetalle[],
  opts: { inicioDelDia: Date; finDelDia: Date; turno: TurnoResuelto | null; salidaAutomatica?: Date | null },
): DiaConsolidado {
  const { turno } = opts;
  const ini0 = opts.inicioDelDia.getTime();
  const fin0 = opts.finDelDia.getTime();
  const colaDeAyer = ini0 + 8 * 3600000;

  const tramos: Intervalo[] = [];
  let abiertoDesde: number | null = null;
  let incompleta = false;
  let algunaMarca = false;
  let primeraEntrada: Date | null = null;
  let omitioPausa = false;

  for (const m of marcas) {
    const t = new Date(m.timestamp).getTime();
    const abre = ABRE_TRAMO.has(m.type);
    const cierra = CIERRA_TRAMO.has(m.type);
    if (!abre && !cierra && !(m.type === 'OUT_LACTATION' || m.type === 'LACTATION_START' || m.type === 'OUT_BUSINESS')) continue;

    if (abiertoDesde === null && !algunaMarca && cierra && t < colaDeAyer) continue; // la noche de ayer
    // Pasada la medianoche sólo sigue el turno de HOY: el regreso de su pausa
    // y su salida. Una entrada nueva ya es el día siguiente.
    if (t > fin0 && ENTRADAS.has(m.type)) break;
    if (t > fin0 && abiertoDesde === null && cierra) break;

    algunaMarca = true;
    if ((m.details as Record<string, unknown> | null | undefined)?.skippedLunch) omitioPausa = true;

    if (abre) {
      if (abiertoDesde === null) abiertoDesde = t;
      if (!primeraEntrada && ENTRADAS.has(m.type)) primeraEntrada = new Date(t);
    } else if (cierra) {
      if (abiertoDesde === null) { incompleta = true; continue; }      // cerró sin haber abierto
      tramos.push([abiertoDesde, t]);
      abiertoDesde = null;
    }
  }

  let abierta = abiertoDesde !== null;
  if (abierta && opts.salidaAutomatica && opts.salidaAutomatica.getTime() > (abiertoDesde as number)) {
    tramos.push([abiertoDesde as number, opts.salidaAutomatica.getTime()]);
    abierta = false;
    abiertoDesde = null;
  }
  if (abierta) incompleta = true;
  // Salió a la pausa y nunca volvió ni marcó la salida.
  const ultima = [...marcas].reverse().find(m => ABRE_TRAMO.has(m.type) || CIERRA_TRAMO.has(m.type));
  if (!abierta && ultima && LUNCH_OUT.has(ultima.type) && tramos.length > 0) incompleta = true;
  if (algunaMarca && !primeraEntrada) incompleta = true;

  let efectivos = unir(tramos);
  let pausaSinMarcar = false;

  if (turno && efectivos.length > 0) {
    // La pausa del horario que nadie marcó: si ningún hueco entre tramos toca
    // la ventana de la pausa, se descuenta la pausa programada (la persona la
    // tomó sin marcarla). «Omisión de almuerzo» dice lo contrario: no se toca.
    if (turno.pausa && !omitioPausa) {
      const ventana: Intervalo = [turno.pausa.inicio.getTime(), turno.pausa.fin.getTime()];
      const enLaPausa = solapa(efectivos, ventana);
      const largoVentana = (ventana[1] - ventana[0]) / 60000;
      if (enLaPausa >= largoVentana - 0.01 && enLaPausa > 0) {
        efectivos = restar(efectivos, ventana);
        pausaSinMarcar = true;
      }
    }
    // La lactancia del horario es tiempo trabajado (RIT Art. 61) aunque la
    // persona esté fuera: pegada a la entrada, a la salida o a la pausa, el
    // kiosco no la marca aparte.
    const desde = Math.min(efectivos[0][0], turno.inicio.getTime());
    const hasta = Math.max(efectivos[efectivos.length - 1][1], turno.fin.getTime());
    for (const l of turno.lactancias) {
      const a = Math.max(l.inicio.getTime(), desde, turno.inicio.getTime());
      const b = Math.min(l.fin.getTime(), hasta, turno.fin.getTime());
      if (b > a) efectivos = unir([...efectivos, [a, b]]);
    }
  }

  const minutosNetos = largo(efectivos);
  const nocturnosReales = nocturnosDe(efectivos);

  // El tope del día: lo PAGADO del horario (la pausa ya descontada) y nunca
  // más que la jornada legal (RIT Art. 16; CT Art. 161). Sin horario —día de
  // descanso trabajado o sin horario publicado— el tope es la jornada legal:
  // lo que pase de 8 h (7 si fue nocturna) es extra (CT Art. 169; en descanso,
  // CT Art. 175 inciso 2) y queda por decidir como cualquier otra.
  let nocturnosProgramados = nocturnosReales;
  let minutosTope: number;
  if (turno) {
    let programado: Intervalo[] = [[turno.inicio.getTime(), turno.fin.getTime()]];
    if (turno.pausa) programado = restar(programado, [turno.pausa.inicio.getTime(), turno.pausa.fin.getTime()]);
    nocturnosProgramados = nocturnosDe(programado);
    const esNocturna = nocturnosProgramados > 4 * 60;      // RIT Art. 16
    minutosTope = Math.min(Math.max(0, turno.minutosPagados), esNocturna ? TOPE_NOCTURNO_MIN : TOPE_DIURNO_MIN);
  } else {
    minutosTope = nocturnosReales > 4 * 60 ? TOPE_NOCTURNO_MIN : TOPE_DIURNO_MIN;
  }

  const minutosRegulares = Math.min(minutosNetos, minutosTope);
  const minutosExtra = Math.max(0, minutosNetos - minutosTope);
  // Lo nocturno se reparte DENTRO de lo regular y lo extra: nunca más horas
  // nocturnas extra que horas extra.
  const minutosNocturnosExtra = Math.min(minutosExtra, Math.max(0, nocturnosReales - nocturnosProgramados));
  const minutosNocturnos = Math.min(minutosRegulares, nocturnosReales - minutosNocturnosExtra);

  // Tardanza: contra el inicio del horario, o contra el fin de la lactancia si
  // va pegada a la entrada (entra después, con derecho).
  let minutosTardanza = 0;
  if (turno && primeraEntrada) {
    let esperado = turno.inicio;
    const pegada = turno.lactancias.find(l => l.inicio.getTime() === turno.inicio.getTime());
    if (pegada) esperado = pegada.fin;
    minutosTardanza = minutosDeTardanza(primeraEntrada, esperado);
  }

  return {
    sinMarcas: !algunaMarca,
    incompleta,
    abierta,
    inicioReal: tramos.length ? new Date(Math.min(...tramos.map(t => t[0]))) : (primeraEntrada ?? null),
    finReal: tramos.length ? new Date(Math.max(...tramos.map(t => t[1]))) : null,
    primeraEntrada,
    pausaSinMarcar,
    minutosNetos,
    minutosTope,
    minutosRegulares,
    minutosExtra,
    minutosNocturnos,
    minutosNocturnosExtra,
    minutosTardanza,
  };
}

/** De la respuesta de `turno_del_dia` (más la lactancia del día crudo) a
 *  instantes concretos de `workDate`. */
export function turnoEnInstantes(
  workDate: string,
  r: Record<string, unknown> | null,
  diaCrudo: Record<string, unknown> | null,
): TurnoResuelto | null {
  if (!r || r.trabaja !== true) return null;
  const inicio = cstTimeToUTC(workDate, String(r.inicio).padStart(5, '0'));
  let fin = cstTimeToUTC(workDate, String(r.fin).padStart(5, '0'));
  if (fin.getTime() <= inicio.getTime()) fin = new Date(fin.getTime() + 24 * 3600000);
  const enLaJornada = (hora: string) => {
    let d = cstTimeToUTC(workDate, hora.substring(0, 5).padStart(5, '0'));
    if (d.getTime() < inicio.getTime()) d = new Date(d.getTime() + 24 * 3600000);
    return d;
  };
  let pausa: TurnoResuelto['pausa'] = null;
  if (r.pausa_inicio && Number(r.pausa_minutos) > 0) {
    const p = enLaJornada(String(r.pausa_inicio));
    pausa = { inicio: p, fin: new Date(p.getTime() + Number(r.pausa_minutos) * 60000) };
  }
  // La lactancia: el gemelo de JS (`resolverTurnoDelDia`) la lee del día así.
  const lactancias: TurnoResuelto['lactancias'] = [];
  const d = diaCrudo || {};
  if (d.hasLactation) {
    const h1 = (d.lactationStart || d.lactation_start) as string | undefined;
    if (h1) {
      const a = enLaJornada(String(h1));
      lactancias.push({ inicio: a, fin: new Date(a.getTime() + Number(d.lactationMinutes ?? 60) * 60000) });
      const h2 = d.lactation2Start as string | undefined;
      if (h2) {
        const b = enLaJornada(String(h2));
        lactancias.push({ inicio: b, fin: new Date(b.getTime() + Number(d.lactation2Minutes ?? 30) * 60000) });
      }
    }
  }
  return { inicio, fin, minutosPagados: Number(r.minutos_pagados) || 0, pausa, lactancias };
}
