// La cobertura del día de una sala: cuánta gente hay a cada hora, y quién queda
// sola. Vivía dentro de `ScheduleCalendar`; se mudó al núcleo el 2026-10-06
// para que la app (Horarios) avise lo MISMO que la grilla del portal.
import { resolverTurnoDelDia, aMinutos as timeToMins } from './turnoDelDia';
import { hora12 } from './hora';

const formatMins12h = (mins) => hora12(`${Math.floor(mins / 60) % 24}:${String(mins % 60).padStart(2, '0')}`);
const formatHourCompact = (h) => hora12(`${h % 24}:00`);

const formatNames = (setOfNames) => {
    const arr = Array.from(setOfNames);
    if (arr.length === 0) return '';
    if (arr.length === 1) return arr[0];
    const last = arr.pop();
    return arr.join(', ') + ' y ' + last;
};

// ============================================================================
// COBERTURA DEL DÍA — cuánta gente hay a cada hora, y quién queda solo
// ============================================================================
//
// Se reescribió el 2026-08-27 con aritmética de intervalos. Antes reservaba dos
// arreglos de 1.440 `Set` por día —2.880 × 7 = **20.160 `Set` por semana**— y
// recorría minuto a minuto el turno de cada persona. Y dependía de
// `weeklyRosters`, o sea que el cálculo entero se rehacía **en cada celda que
// se guardaba**.
//
// La cuenta es la misma: se ordenan los bordes de cada tramo y se barren. Lo
// que sale de acá son dos cosas distintas:
//
//   · `huecosCriticos` — horas de mucha venta con menos de tres personas.
//   · `avisos` — el almuerzo que deja la sala vacía o a una sola persona. Se
//     calculaba desde siempre y **la vista lo tiraba** (`onSalyAlertsUpdate`
//     era `() => {}`), así que era trabajo perdido y una función construida que
//     nadie veía.
export const evaluarCoberturaDelDia = (dNum, horarios, turnos, ventasDelDia) => {
    // Un tramo por persona: cuándo entra, cuándo sale, y cuándo se va a comer.
    const tramos = [];
    horarios.forEach(horarioSemanal => {
        const r = resolverTurnoDelDia(horarioSemanal[dNum], turnos);
        if (!r.trabaja) return;
        const nombre = horarioSemanal.name || 'Personal';
        let ini = timeToMins(r.inicio);
        let fin = timeToMins(r.fin);
        if (fin < ini) fin += 1440;
        const t = { nombre, ini, fin, pausaIni: null, pausaFin: null };
        if (r.pausa) {
            let p = timeToMins(r.pausa.inicio);
            if (p < ini) p += 1440;
            t.pausaIni = p;
            t.pausaFin = p + r.pausa.minutos;
        }
        tramos.push(t);
    });

    if (tramos.length === 0) return { huecosCriticos: [], avisos: [] };

    // Cuántas personas hay ACTIVAS (dentro del turno y fuera de su pausa) en un
    // minuto dado, y quiénes están comiendo.
    const enElMinuto = (m) => {
        const activos = [], comiendo = [];
        for (const t of tramos) {
            for (const desfase of [0, 1440]) {       // el tramo puede haber cruzado
                const mm = m + desfase;
                if (mm < t.ini || mm >= t.fin) continue;
                if (t.pausaIni !== null && mm >= t.pausaIni && mm < t.pausaFin) comiendo.push(t.nombre);
                else activos.push(t.nombre);
            }
        }
        return { activos, comiendo };
    };

    // Los bordes: sólo ahí puede cambiar la cuenta. Con 10 personas son ~40
    // instantes, no 1.440.
    const bordes = new Set([0, 1440]);
    tramos.forEach(t => {
        [t.ini, t.fin, t.pausaIni, t.pausaFin].forEach(b => {
            if (b === null) return;
            bordes.add(((b % 1440) + 1440) % 1440);
        });
    });
    const instantes = [...bordes].sort((a, b) => a - b);

    // ── Huecos en las horas de más venta ────────────────────────────────────
    const huecosCriticos = [];
    (ventasDelDia || []).forEach(stat => {
        if (stat.color !== 'var(--txvol-critica)') return;
        const desde = stat.hour * 60, hasta = desde + 60;
        let minimo = Infinity;
        for (const m of instantes) {
            if (m < desde || m >= hasta) continue;
            minimo = Math.min(minimo, enElMinuto(m).activos.length);
        }
        minimo = Math.min(minimo, enElMinuto(desde).activos.length);
        if (minimo < 3) huecosCriticos.push({ time: formatHourCompact(stat.hour) });
    });

    // ── El almuerzo que deja la sala corta ──────────────────────────────────
    const avisos = [];
    for (let i = 0; i < instantes.length; i++) {
        const desde = instantes[i];
        const hasta = i + 1 < instantes.length ? instantes[i + 1] : 1440;
        if (hasta <= desde) continue;
        const { activos, comiendo } = enElMinuto(desde);
        if (comiendo.length === 0) continue;
        const duracion = hasta - desde;

        if (activos.length === 0) {
            avisos.push({
                tipo: 'danger',
                texto: `El almuerzo de ${formatNames(new Set(comiendo))} a las ${formatMins12h(desde)} deja la sala SIN NADIE por ${duracion} min.`,
            });
        } else if (activos.length === 1 && duracion >= 30) {
            avisos.push({
                tipo: 'warning',
                texto: `El almuerzo de ${formatNames(new Set(comiendo))} a las ${formatMins12h(desde)} deja a ${activos[0]} atendiendo solo por ${duracion} min. Conviene escalonarlo.`,
            });
        }
    }

    return { huecosCriticos, avisos };
};
