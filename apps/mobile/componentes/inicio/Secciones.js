// Las secciones del Inicio nativo. Cada una sabe en qué pestañas va, qué
// permiso pide y cómo se dibuja; el Inicio las ordena por uso
// (`ordenPorUso`) dentro de cada pestaña. «Hoy» va siempre primero: son los
// números del día y no compiten.
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Host, Icon } from '@expo/ui';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cumplenEl, empleadosActivos, presentesEl, problemaDeSucursal } from '@nucleo/utils/inicio';
import Tarjeta from './Tarjeta';
import Kpi, { FilaDeKpis } from './Kpi';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

// Los colores de la marca (tokens del portal: --brand, --success, --warning,
// --danger, --brand-purple).
export const MARCA = { azul: '#0052CC', verde: '#12B76A', ambar: '#F79009', rojo: '#F04438', violeta: '#6929C4' };

const dinero = (v) => formatMoney(v, { decimales: 0 });

// ── Hoy ─────────────────────────────────────────────────────────────────────
export function Hoy({ pestana, datos, ctx }) {
  const { empleados, sala, alcanceSala, sucursales, abrir, puede } = ctx;
  const emps = empleadosActivos(empleados).filter((e) => !alcanceSala || String(e.branchId ?? e.branch_id ?? '') === String(sala));
  const presentes = presentesEl(emps, datos.hoy);
  const ventasTotal = (datos.ventas || []).filter((v) => !alcanceSala || v.branchId === String(sala)).reduce((s, v) => s + v.total, 0);
  const alertas = (sucursales || []).filter((b) => problemaDeSucursal(b)).length;
  const ausentes = (datos.ausencias || []).length;
  const facturado = (datos.facturas || []).reduce((s, f) => s + (Number(f.total) || 0), 0);
  const solicitudes = datos.solicitudes ?? 0;

  const K = {
    ventas: <Kpi key="v" icono="TrendingUp" rotulo="Ventas hoy" valor={dinero(ventasTotal)} color={MARCA.verde} onPress={puede('ventas') ? () => abrir('/ventas') : null} />,
    presentes: <Kpi key="p" icono="UserCheck" rotulo="Presentes" valor={`${presentes}`} apoyo={emps.length ? `de ${emps.length}` : null} color={MARCA.azul} onPress={puede('monitor') ? () => abrir('/monitor') : null} />,
    solicitudes: <Kpi key="s" icono="ClipboardList" rotulo="Solicitudes" valor={`${solicitudes}`} apoyo={solicitudes ? 'por decidir' : 'Al día'} color={MARCA.ambar} pide={solicitudes > 0} onPress={() => abrir('/solicitudes')} />,
    alertas: <Kpi key="a" icono="Building2" rotulo="Sucursales" valor={alertas ? `${alertas}` : '✓'} apoyo={alertas ? `alerta${alertas > 1 ? 's' : ''}` : 'Sin alertas'} color={alertas ? MARCA.rojo : MARCA.verde} pide={alertas > 0} onPress={puede('branches') ? () => abrir('/sucursales') : null} />,
    activos: <Kpi key="ac" icono="Users" rotulo="Activos" valor={`${emps.length}`} color={MARCA.azul} onPress={puede('staff_list') ? () => abrir('/personal') : null} />,
    ausentes: <Kpi key="au" icono="UserX" rotulo="Ausencias" valor={`${ausentes}`} apoyo={ausentes ? 'hoy' : 'Nadie falta'} color={MARCA.rojo} pide={ausentes > 0} />,
    facturado: <Kpi key="f" icono="BarChart2" rotulo="Facturado hoy" valor={dinero(facturado)} color={MARCA.ambar} onPress={puede('facturacion') ? () => abrir('/facturacion') : null} />,
    documentos: <Kpi key="d" icono="FileText" rotulo="Documentos" valor={`${(datos.facturas || []).length}`} apoyo="hoy" color={MARCA.violeta} />,
    cotizaciones: <Kpi key="c" icono="Receipt" rotulo="Cotizaciones" valor={`${(datos.cotizaciones || []).length}`} apoyo="activas, 30 días" color={MARCA.azul} onPress={puede('cotizaciones') ? () => abrir('/cotizaciones') : null} />,
    traslados: <Kpi key="t" icono="ArrowLeftRight" rotulo="Traslados" valor={`${datos.traslados ?? 0}`} apoyo="por confirmar" color={MARCA.azul} pide={(datos.traslados ?? 0) > 0} onPress={() => abrir('/traslados')} />,
    cortes: <Kpi key="co" icono="Wallet" rotulo="Cortes" valor={`${datos.cortes ?? 0}`} apoyo="por confirmar" color={MARCA.verde} pide={(datos.cortes ?? 0) > 0} onPress={() => abrir('/caja')} />,
  };
  const PARES = {
    general: [[puede('dash_sales') ? 'ventas' : 'activos', 'presentes'], ['solicitudes', 'alertas']],
    comercial: [['ventas', 'facturado'], ['documentos', 'cotizaciones']],
    rrhh: [['activos', 'presentes'], ['ausentes', 'solicitudes']],
    operacion: [['traslados', 'cortes'], ['solicitudes', 'alertas']],
  }[pestana] ?? [];
  return (
    <View style={{ gap: 12 }}>
      {PARES.map((par, i) => <FilaDeKpis key={i}>{par.map((k) => K[k])}</FilaDeKpis>)}
    </View>
  );
}

// ── Pendiente para ti ───────────────────────────────────────────────────────
export function Pendientes({ datos, ctx }) {
  const filas = [
    { id: 'solicitudes', n: datos.solicitudes, icono: 'ClipboardList', texto: 'Solicitudes por decidir', ruta: '/solicitudes', color: MARCA.ambar },
    { id: 'traslados', n: datos.traslados, icono: 'ArrowLeftRight', texto: 'Traslados por confirmar', ruta: '/traslados', color: MARCA.azul },
    { id: 'cortes', n: datos.cortes, icono: 'Wallet', texto: 'Cortes por confirmar', ruta: '/caja', color: MARCA.verde },
  ].filter((f) => f.n > 0);
  return (
    <Tarjeta titulo="Pendiente para ti" icono="Bell" color={MARCA.ambar}>
      {filas.length ? filas.map((f, i) => (
        <Pressable key={f.id} onPress={() => ctx.abrir(f.ruta)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, opacity: pressed ? 0.6 : 1,
            borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador })}>
          <Host matchContents><Icon name={iconoDe(f.icono)} size={18} color={f.color} /></Host>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{f.texto}</Text>
          <View style={{ minWidth: 26, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: f.color }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' }}>{f.n}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
        </Pressable>
      )) : (
        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Todo al día ✓</Text>
      )}
    </Tarjeta>
  );
}

// ── Ventas de hoy ───────────────────────────────────────────────────────────
function Barras({ valores, color }) {
  const max = Math.max(1, ...valores);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {valores.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (v / max) * 40), borderRadius: 2, backgroundColor: v === max ? color : `${color}66` }} />
      ))}
    </View>
  );
}

export function Ventas({ datos, ctx }) {
  const salas = (datos.ventas || []).filter((v) => !ctx.alcanceSalaVentas || v.branchId === String(ctx.sala));
  const nombre = (id) => (ctx.sucursales || []).find((b) => String(b.id) === id)?.name ?? `Sala ${id}`;
  return (
    <Tarjeta titulo="Ventas de hoy" icono="TrendingUp" color={MARCA.verde} onPress={ctx.puede('ventas') ? () => ctx.abrir('/ventas') : null}>
      {salas.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {salas.map((s) => (
            <View key={s.branchId} style={{ width: 150, gap: 6, padding: 12, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.10)' }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{nombre(s.branchId)}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(s.total)}</Text>
              <Barras valores={s.porHora} color={MARCA.verde} />
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{s.tickets} tickets</Text>
            </View>
          ))}
        </ScrollView>
      ) : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Todavía no hay ventas hoy.</Text>}
    </Tarjeta>
  );
}

// ── Meta del mes ────────────────────────────────────────────────────────────
function Anillo({ pct, color }) {
  const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct / 100));
  return (
    <Svg width={84} height={84} viewBox="0 0 84 84">
      <Circle cx={42} cy={42} r={r} stroke={`${color}33`} strokeWidth={9} fill="none" />
      <Circle cx={42} cy={42} r={r} stroke={color} strokeWidth={9} fill="none" strokeLinecap="round"
        strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 42 42)" />
    </Svg>
  );
}

export function Meta({ datos, ctx }) {
  const m = datos.meta;
  if (!m) return null;
  const pct = Number(m.pct_cumplimiento) || 0;
  const color = pct >= 100 ? MARCA.verde : pct >= 70 ? MARCA.azul : MARCA.ambar;
  return (
    <Tarjeta titulo="Meta del mes" icono="Target" color={color} onPress={ctx.puede('metas') ? () => ctx.abrir('/metas') : null}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View>
          <Anillo pct={pct} color={color} />
          <Text style={{ position: 'absolute', width: 84, top: 30, textAlign: 'center', color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{Math.round(pct)}%</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{formatMoney(m.venta_acumulada, { decimales: 0 })} <Text style={{ color: colorSistema.texto2, fontWeight: '400' }}>de {formatMoney(m.monto_meta, { decimales: 0 })}</Text></Text>
          {Number(m.falta) > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Faltan {formatMoney(m.falta, { decimales: 0 })} · {m.dias_restantes} días</Text> : <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>¡Meta cumplida!</Text>}
          {m.bono_tier ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{m.bono_tier}</Text> : null}
        </View>
      </View>
    </Tarjeta>
  );
}

// ── Equipo ahora ────────────────────────────────────────────────────────────
export function Equipo({ datos, ctx }) {
  const emps = empleadosActivos(ctx.empleados).filter((e) => !ctx.alcanceSala || String(e.branchId ?? e.branch_id ?? '') === String(ctx.sala));
  const presentes = emps.filter((e) => (e.attendance || []).some((a) => (a.date || a.timestamp?.split('T')[0]) === datos.hoy));
  const cumple = cumplenEl(emps, datos.hoy);
  const ausentes = (datos.ausencias || []).length;
  return (
    <Tarjeta titulo="Equipo hoy" icono="Users" color={MARCA.azul} onPress={ctx.puede('monitor') ? () => ctx.abrir('/monitor') : null}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {presentes.slice(0, 6).map((e, i) => (
          <View key={e.id} style={{ marginLeft: i ? -10 : 0, borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' }}>
            {e.photo
              ? <Image source={{ uri: e.photo }} style={{ width: 36, height: 36, borderRadius: 18 }} />
              : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '700' }}>{shortEmployeeName(e).split(' ').map((p) => p[0]).join('').slice(0, 2)}</Text>
                </View>}
          </View>
        ))}
        <Text style={{ marginLeft: presentes.length ? 12 : 0, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>
          {presentes.length ? `${presentes.length} en turno` : 'Nadie ha marcado aún'}
        </Text>
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 10 }}>
        {[ausentes ? `${ausentes} ausente${ausentes > 1 ? 's' : ''}` : 'Nadie falta', cumple.length ? `🎂 ${cumple.map((e) => shortEmployeeName(e).split(' ')[0]).join(', ')} cumple${cumple.length > 1 ? 'n' : ''} hoy` : null].filter(Boolean).join(' · ')}
      </Text>
    </Tarjeta>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────
export function Avisos({ ctx }) {
  const a = (ctx.comunicados || []).find((x) => !x.isArchived && (!x.scheduledFor || new Date(x.scheduledFor) <= new Date()));
  if (!a) return null;
  return (
    <Tarjeta titulo="Comunicados" icono="Megaphone" color={MARCA.violeta} onPress={() => ctx.abrir('/mis-avisos')}>
      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>{a.title}</Text>
      {a.message || a.body ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 4 }} numberOfLines={2}>{a.message || a.body}</Text> : null}
    </Tarjeta>
  );
}

// El registro: en qué pestañas va cada sección y con qué permiso.
export const SECCIONES = [
  { id: 'pendientes', pestanas: ['general', 'operacion'], visible: (d) => d.solicitudes != null || d.traslados != null || d.cortes != null, Componente: Pendientes },
  { id: 'ventas', pestanas: ['general', 'comercial'], permiso: 'dash_sales', Componente: Ventas },
  { id: 'meta', pestanas: ['general', 'comercial'], permiso: 'dash_meta_sala', visible: (d) => !!d.meta, Componente: Meta },
  { id: 'equipo', pestanas: ['general', 'rrhh'], permiso: 'dash_shifts', Componente: Equipo },
  { id: 'avisos', pestanas: ['general', 'rrhh'], permiso: 'dash_announcements', Componente: Avisos },
];
