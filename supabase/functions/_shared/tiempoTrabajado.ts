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

  for (let d = new Date(iterStart); d.getTime() < iterEnd.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
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

/** Los tramos efectivamente trabajados: la jornada menos almuerzo y lactancia. */
export function getWorkSegments(punches: Marcacion[], actualStart: Date, actualEnd: Date): { start: Date; end: Date }[] {
  const segments: { start: Date; end: Date }[] = [];
  let segStart = new Date(actualStart);

  for (const p of punches) {
    const t = new Date(p.timestamp);
    if (t.getTime() <= actualStart.getTime() || t.getTime() >= actualEnd.getTime()) continue;

    if (LUNCH_OUT.has(p.type) || LACTAT_OUT.has(p.type)) {
      if (segStart < t) segments.push({ start: new Date(segStart), end: t });
      segStart = t; // se reemplaza con el regreso
    } else if (LUNCH_IN.has(p.type) || LACTAT_IN.has(p.type)) {
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
