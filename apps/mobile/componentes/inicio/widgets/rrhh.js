// Los widgets de la pestaña RRHH, nativos — los del tablero del portal
// (`PESTANAS_TEMATICAS.rrhh`): la asistencia de la semana, el estado de los
// turnos ahora, quién falta, las solicitudes pendientes, el calendario de
// feriados y los cumpleaños. Más las alertas de sucursales (pestaña General).
//
// Todo lo del personal sale del store (`employees`, con la asistencia de los
// últimos días que ya carga el Inicio) y se recorta a la sala con el alcance
// de cada widget, igual que el portal.
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPendingApprovalRequests } from '@nucleo/data/dashboard';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { getTodayAttendanceStatus } from '@nucleo/utils/helpers';
import { empleadosActivos, presentesEl, problemaDeSucursal } from '@nucleo/utils/inicio';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import Widget, { Chip, Esqueleto, Renglon, Vacio } from '../Widget';
import { useDato, datos } from '../useDato';
import Avatar from '../../Avatar';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../marca';

const deLaSala = (ctx, permiso) => {
  const todos = empleadosActivos(ctx.empleados);
  if (ctx.getScope?.(permiso) === 'ALL' || !ctx.sala) return todos;
  return todos.filter((e) => String(e.branchId ?? e.branch_id ?? '') === String(ctx.sala));
};
const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

// ── Asistencia de la semana ─────────────────────────────────────────────────
// Cuántas personas marcaron cada día de los últimos siete. Hoy va resaltado.
export function Tendencia({ ctx }) {
  const emps = deLaSala(ctx, 'dash_trend');
  const hoy = hoySV();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(hoy, i - 6));
  const cuentas = dias.map((d) => presentesEl(emps, d));
  const max = Math.max(1, ...cuentas, emps.length);
  const vacia = cuentas.every((c) => !c);
  return (
    <Widget titulo="Asistencia de la semana" icono="Activity" color={MARCA.azul} onAbrir={ctx.puede('time_audit') ? () => ctx.abrir('/auditoria-de-tiempos') : null}>
      {vacia ? <Vacio texto="Sin marcaciones esta semana" /> : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 110 }}>
          {dias.map((d, i) => {
            const esHoy = d === hoy;
            return (
              <View key={d} style={{ flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{cuentas[i] || ''}</Text>
                <View style={{ width: '100%', height: Math.max(3, (cuentas[i] / max) * 72), borderRadius: 6,
                  backgroundColor: esHoy ? MARCA.azul : 'rgba(59,130,246,0.45)' }} />
                <Text style={{ color: esHoy ? colorSistema.texto : colorSistema.texto2, fontSize: 12, fontWeight: esHoy ? '800' : '500' }}>
                  {DIAS[new Date(`${d}T12:00:00`).getDay()]}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Widget>
  );
}

// ── Estado de los turnos ahora ──────────────────────────────────────────────
const ESTADOS = [
  { id: 'WORKING', rotulo: 'En labores', color: MARCA.verde },
  { id: 'LUNCH', rotulo: 'Almuerzo', color: MARCA.ambar },
  { id: 'LACTATION', rotulo: 'Lactancia', color: '#E0457B' },
  { id: 'BUSINESS', rotulo: 'Gestión externa', color: MARCA.azul },
  { id: 'OUT', rotulo: 'Salió', color: '#8E8E93' },
  { id: 'ABSENT', rotulo: 'Sin marcar', color: MARCA.rojo },
];

export function Turnos({ ctx }) {
  const turnos = useStaffStore((s) => s.shifts);
  const emps = deLaSala(ctx, 'dash_shifts');
  const grupos = useMemo(() => {
    const g = Object.fromEntries(ESTADOS.map((e) => [e.id, []]));
    emps.forEach((e) => { const s = getTodayAttendanceStatus(e, turnos).status; if (g[s]) g[s].push(e); });
    return g;
  }, [emps, turnos]);
  const [abierto, setAbierto] = useState(null);
  const conGente = ESTADOS.filter((e) => grupos[e.id].length);
  return (
    <Widget titulo="Estado de turnos" icono="Users" color={MARCA.verde} cuenta={grupos.WORKING.length}
      onAbrir={ctx.puede('monitor') ? () => ctx.abrir('/monitor') : null}>
      {conGente.length ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {conGente.map((e) => (
              <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abierto === e.id ? null : e.id); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                  backgroundColor: abierto === e.id ? `${e.color}40` : `${e.color}22` }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: e.color }} />
                <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{e.rotulo}</Text>
                <Text style={{ color: e.color, fontSize: 13, fontWeight: '800' }}>{grupos[e.id].length}</Text>
              </Pressable>
            ))}
          </View>
          {abierto ? grupos[abierto].map((p, i) => (
            <Renglon key={p.id} primero={!i} titulo={shortEmployeeName(p)} izquierda={<Avatar empleado={p} tamano={30} />} />
          )) : <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Toca un estado para ver quiénes</Text>}
        </View>
      ) : <Vacio texto="Nadie en turno hoy" />}
    </Widget>
  );
}

// ── Ausencias de hoy ────────────────────────────────────────────────────────
const TIPO_AUSENCIA = { VACATION: MARCA.ambar, DISABILITY: MARCA.rojo, PERMIT: MARCA.verde };

export function Ausencias({ datos: d, ctx }) {
  const porId = new Map((ctx.empleados || []).map((e) => [String(e.id), e]));
  const alcance = ctx.getScope?.('dash_absences') !== 'ALL';
  const lista = (d.ausencias || []).filter((a) => {
    if (!alcance || !ctx.sala) return true;
    const e = porId.get(String(a.employee_id));
    return e && String(e.branchId ?? e.branch_id ?? '') === String(ctx.sala);
  });
  return (
    <Widget titulo="Ausencias de hoy" icono="UserX" color={MARCA.rojo} cuenta={lista.length} onAbrir={() => ctx.abrir('/solicitudes')}>
      {lista.length ? lista.slice(0, 6).map((a, i) => {
        const e = porId.get(String(a.employee_id));
        const m = a.metadata || {};
        const hasta = m.endDate || (m.permissionDates || []).slice(-1)[0];
        return (
          <Renglon key={a.id} primero={!i} titulo={shortEmployeeName(e)} izquierda={<Avatar empleado={e} tamano={30} />}
            detalle={`${REQUEST_TYPES[a.type]?.label ?? a.type}${hasta ? ` · hasta ${fechaTexto(String(hasta).slice(0, 10))}` : ''}`}
            derecha={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TIPO_AUSENCIA[a.type] ?? '#8E8E93' }} />} />
        );
      }) : <Vacio texto="Nadie falta" bien />}
    </Widget>
  );
}

// ── Solicitudes pendientes ──────────────────────────────────────────────────
export function SolicitudesPendientes({ ctx }) {
  const { dato, cargando } = useDato('pendientes-rrhh', async () => datos(await fetchPendingApprovalRequests()) || []);
  const porId = new Map((ctx.empleados || []).map((e) => [String(e.id), e]));
  const alcance = ctx.getScope?.('dash_requests') !== 'ALL';
  const lista = (dato || []).filter((r) => {
    if (!alcance || !ctx.sala) return true;
    const e = porId.get(String(r.employee_id));
    return e && String(e.branchId ?? e.branch_id ?? '') === String(ctx.sala);
  });
  return (
    <Widget titulo="Solicitudes pendientes" icono="ClipboardList" color={MARCA.ambar} cuenta={lista.length} onAbrir={() => ctx.abrir('/solicitudes')}>
      {cargando && !dato ? <Esqueleto lineas={3} /> : lista.length ? lista.slice(0, 5).map((r, i) => {
        const e = porId.get(String(r.employee_id));
        return (
          <Renglon key={r.id} primero={!i} titulo={shortEmployeeName(e)} detalle={REQUEST_TYPES[r.type]?.label ?? 'Solicitud'}
            izquierda={<Avatar empleado={e} tamano={30} />} derecha={cuandoLlego(r.created_at)}
            onPress={() => ctx.abrirSolicitud(r.id)} />
        );
      }) : <Vacio texto="Sin solicitudes pendientes" bien />}
    </Widget>
  );
}

// ── Calendario de feriados ──────────────────────────────────────────────────
export function Calendario() {
  const feriados = useStaffStore((s) => s.holidays);
  const [mes, setMes] = useState(() => hoySV().slice(0, 7));
  const [elegido, setElegido] = useState(null);
  const [anio, m] = mes.split('-').map(Number);
  const primero = new Date(anio, m - 1, 1).getDay();
  const dias = new Date(anio, m, 0).getDate();
  const hoy = hoySV();
  const deMes = useMemo(() => {
    const r = new Map();
    (feriados || []).forEach((f) => {
      const fecha = String(f.holiday_date).slice(0, 10);
      const clave = f.is_recurring ? `${mes}-${fecha.slice(8, 10)}` : fecha;
      if (f.is_recurring ? fecha.slice(5, 7) === mes.slice(5, 7) : fecha.startsWith(mes)) {
        r.set(clave, [...(r.get(clave) || []), f.name]);
      }
    });
    return r;
  }, [feriados, mes]);
  const mover = (n) => { const d = new Date(anio, m - 1 + n, 1); setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); setElegido(null); };
  const celdas = [...Array(primero).fill(null), ...Array.from({ length: dias }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)];
  const mesLargo = new Date(anio, m - 1, 1).toLocaleDateString('es-SV', { month: 'long' });
  const nombre = `${mesLargo.charAt(0).toUpperCase()}${mesLargo.slice(1)} ${anio}`;
  const proximos = [...deMes.entries()].filter(([f]) => f >= hoy).sort();
  return (
    <Widget titulo="Calendario" icono="CalendarDays" color={MARCA.rojo}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Pressable onPress={() => mover(-1)} hitSlop={10}><Text style={{ color: colorSistema.acento, fontSize: 22, paddingHorizontal: 6 }}>‹</Text></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{nombre}</Text>
        <Pressable onPress={() => mover(1)} hitSlop={10}><Text style={{ color: colorSistema.acento, fontSize: 22, paddingHorizontal: 6 }}>›</Text></Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DIAS.map((d, i) => <Text key={`c${i}`} style={{ width: `${100 / 7}%`, textAlign: 'center', color: colorSistema.texto2, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{d}</Text>)}
        {celdas.map((f, i) => {
          const fer = f && deMes.get(f);
          const esHoy = f === hoy;
          return (
            <Pressable key={f ?? `v${i}`} disabled={!fer} onPress={() => setElegido(elegido === f ? null : f)}
              style={{ width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center' }}>
              {f ? (
                <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: esHoy ? MARCA.azul : fer ? `${MARCA.rojo}33` : 'transparent' }}>
                  <Text style={{ color: esHoy ? '#fff' : fer ? MARCA.rojo : colorSistema.texto, fontSize: 14, fontWeight: esHoy || fer ? '700' : '400' }}>{Number(f.slice(8))}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {(elegido ? [[elegido, deMes.get(elegido)]] : proximos.slice(0, 2)).map(([f, nombres]) => (
        <Text key={f} style={{ color: colorSistema.texto2, fontSize: 13, marginTop: 6 }}>
          <Text style={{ color: MARCA.rojo, fontWeight: '700' }}>{fechaTexto(f)}</Text>  {nombres.join(' · ')}
        </Text>
      ))}
    </Widget>
  );
}

// ── Cumpleaños del mes ──────────────────────────────────────────────────────
export function Cumpleanos({ ctx }) {
  const hoy = hoySV();
  const manana = sumarDias(hoy, 1);
  const lista = deLaSala(ctx, 'dash_birthdays')
    .filter((e) => e.birthDate && String(e.birthDate).slice(5, 7) === hoy.slice(5, 7))
    .map((e) => {
      const md = String(e.birthDate).slice(5, 10);
      return { e, dia: Number(md.slice(3)), md, edad: Number(hoy.slice(0, 4)) - Number(String(e.birthDate).slice(0, 4)) };
    })
    .sort((a, b) => a.dia - b.dia);
  const nombreSala = (e) => (ctx.sucursales || []).find((b) => String(b.id) === String(e.branchId ?? e.branch_id))?.name;
  return (
    <Widget titulo="Cumpleaños del mes" icono="Cake" color="#E0457B" cuenta={lista.filter((x) => x.md === hoy.slice(5)).length}>
      {lista.length ? lista.slice(0, 6).map(({ e, dia, md, edad }, i) => {
        const esHoy = md === hoy.slice(5);
        const esManana = md === manana.slice(5);
        const paso = md < hoy.slice(5);
        return (
          <View key={e.id} style={{ opacity: paso ? 0.45 : 1 }}>
            <Renglon primero={!i} titulo={shortEmployeeName(e)} detalle={[nombreSala(e), `día ${dia}`].filter(Boolean).join(' · ')}
              izquierda={<Avatar empleado={e} tamano={32} />}
              derecha={esHoy ? '🎂 Hoy' : esManana ? 'Mañana' : `${edad} años`}
              colorDerecha={esHoy ? '#E0457B' : esManana ? MARCA.ambar : undefined} />
          </View>
        );
      }) : <Vacio texto="Nadie cumple este mes" />}
    </Widget>
  );
}

// ── Alertas de sucursales ───────────────────────────────────────────────────
export function AlertasSucursales({ ctx }) {
  const alcance = ctx.getScope?.('dash_branches') === 'BRANCH';
  const lista = (ctx.sucursales || [])
    .filter((b) => !alcance || String(b.id) === String(ctx.sala))
    .map((b) => ({ b, problema: problemaDeSucursal(b) }))
    .filter((x) => x.problema);
  const edita = ctx.puede('dash_branches', 'can_edit');
  return (
    <Widget titulo="Alertas de sucursales" icono="Building2" color={lista.length ? MARCA.ambar : MARCA.verde} cuenta={lista.length}
      onAbrir={ctx.puede('branches') ? () => ctx.abrir('/sucursales') : null}>
      {lista.length ? lista.map(({ b, problema }, i) => (
        <Renglon key={b.id} primero={!i} titulo={b.name} detalle={problema}
          izquierda={<Chip icono="AlertTriangle" color={MARCA.ambar} tamano={30} />}
          onPress={edita ? () => ctx.abrir(`/sucursales/${b.id}`) : null} />
      )) : <Vacio texto="Todo en orden" bien />}
    </Widget>
  );
}

