// Las secciones del Inicio nativo. Cada una sabe en qué pestañas va, qué
// permiso pide y cómo se dibuja; el Inicio las ordena por uso
// (`ordenPorUso`) dentro de cada pestaña. «Hoy» va siempre primero: son los
// números del día y no compiten.
import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Host, Icon } from '@expo/ui';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cumplenEl, empleadosActivos, presentesEl, problemaDeSucursal, sumarSalas } from '@nucleo/utils/inicio';
import { Titulo } from './Tarjeta';
import Widget, { Chip, Cuenta, Renglon, Vacio } from './Widget';
import { COLOR_VOLUMEN, RejillaDeSalas } from './MiniSala';
import * as W from './widgets/rrhh';
import * as C from './widgets/comercial';
import * as O from './widgets/operacion';
import * as G from './widgets/general';
import { VentasPorHora } from './widgets/ventasPorHora';
import Kpi, { Avance, Curva, FilaDeKpis } from './Kpi';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

import { MARCA } from './marca';
import { usePorDecidir } from '../porDecidir';

export { MARCA };

const dinero = (v) => formatMoney(v, { decimales: 0 });

// ── Hoy ─────────────────────────────────────────────────────────────────────
export function Hoy({ pestana, datos, ctx }) {
  const { empleados, sala, alcanceSala, sucursales, abrir, puede } = ctx;
  const emps = empleadosActivos(empleados).filter((e) => !alcanceSala || String(e.branchId ?? e.branch_id ?? '') === String(sala));
  const presentes = presentesEl(emps, datos.hoy);
  const deVentas = (datos.ventas || []).filter((v) => !alcanceSala || v.branchId === String(sala));
  const ventasTotal = deVentas.reduce((s, v) => s + v.total, 0);
  const porHora = sumarSalas(deVentas).porHora ?? [];
  const alertas = (sucursales || []).filter((b) => problemaDeSucursal(b)).length;
  const ausentes = (datos.ausencias || []).length;
  const facturado = (datos.facturas || []).reduce((s, f) => s + (Number(f.total) || 0), 0);
  // Lo que falta decidir sale de «Por decidir» (la misma lista de la pestaña
  // Notificaciones): así cuenta también los ajustes de Mín·Máx, que viven en
  // otra tabla y el conteo viejo no veía — decía «Al día» con uno esperando.
  const solicitudes = usePorDecidir((s) => s.items.filter((i) => i.tipo === 'solicitud' || i.tipo === 'minmax').length);

  const K = {
    ventas: <Kpi key="v" icono="TrendingUp" rotulo="Ventas hoy" valor={dinero(ventasTotal)} color={MARCA.verde} onPress={() => abrir('/ventas-hoy')}
      visual={<Curva valores={porHora} color={MARCA.verde} />} />,
    presentes: <Kpi key="p" icono="UserCheck" rotulo="Presentes" valor={`${presentes}`} apoyo={emps.length ? `de ${emps.length}` : null} color={MARCA.azul} onPress={puede('monitor') ? () => abrir('/monitor') : null}
      visual={emps.length ? <Avance parte={presentes} total={emps.length} color={MARCA.azul} /> : null} />,
    solicitudes: <Kpi key="s" icono="ClipboardList" rotulo="Solicitudes" valor={`${solicitudes}`} apoyo={solicitudes ? 'por decidir' : 'Al día'} color={MARCA.ambar} pide={solicitudes > 0} onPress={() => abrir('/solicitudes')} />,
    alertas: <Kpi key="a" icono="Building2" rotulo="Sucursales" valor={alertas ? `${alertas}` : '✓'} apoyo={alertas ? `alerta${alertas > 1 ? 's' : ''}` : 'Sin alertas'} color={alertas ? MARCA.rojo : MARCA.verde} pide={alertas > 0} onPress={puede('branches') ? () => abrir('/sucursales') : null} />,
    activos: <Kpi key="ac" icono="Users" rotulo="Activos" valor={`${emps.length}`} color={MARCA.azul} onPress={puede('staff_list') ? () => abrir('/personal') : null} />,
    ausentes: <Kpi key="au" icono="UserX" rotulo="Ausencias" valor={`${ausentes}`} apoyo={ausentes ? 'hoy' : 'Nadie falta'} color={MARCA.rojo} pide={ausentes > 0} />,
    facturado: <Kpi key="f" icono="BarChart2" rotulo="Facturado hoy" valor={dinero(facturado)} color={MARCA.ambar} onPress={puede('facturacion') ? () => abrir('/facturacion') : null} />,
    documentos: <Kpi key="d" icono="FileText" rotulo="Documentos" valor={`${(datos.facturas || []).length}`} apoyo="hoy" color={MARCA.violeta} />,
    cotizaciones: <Kpi key="c" icono="Receipt" rotulo="Cotizaciones" valor={`${(datos.cotizaciones || []).length}`} apoyo="activas, 30 días" color={MARCA.azul} onPress={puede('cotizaciones') ? () => abrir('/cotizaciones') : null} />,
    traslados: <Kpi key="t" icono="ArrowLeftRight" rotulo="Traslados" valor={`${datos.traslados ?? 0}`} apoyo="por confirmar" color={MARCA.azul} pide={(datos.traslados ?? 0) > 0} onPress={() => abrir('/traslados')} />,
    cortes: <Kpi key="co" icono="Wallet" rotulo="Cortes" valor={`${datos.cortes ?? 0}`} apoyo="por confirmar" color={MARCA.verde} pide={(datos.cortes ?? 0) > 0} onPress={() => abrir('/cortes')} />,
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
  const porDecidir = usePorDecidir((s) => s.items);
  const filas = [
    { id: 'solicitudes', n: porDecidir.filter((i) => i.tipo === 'solicitud' || i.tipo === 'minmax').length, icono: 'ClipboardList', texto: 'Solicitudes por decidir', ruta: '/solicitudes', color: MARCA.ambar },
    { id: 'traslados', n: porDecidir.filter((i) => i.tipo === 'traslado' || i.tipo === 'envio').length, icono: 'ArrowLeftRight', texto: 'Traslados y envíos por contestar', ruta: '/traslados', color: MARCA.azul },
    { id: 'cortes', n: datos.cortes, icono: 'Wallet', texto: 'Cortes por confirmar', ruta: '/cortes', color: MARCA.verde },
  ].filter((f) => f.n > 0);
  const total = filas.reduce((s, f) => s + f.n, 0);
  return (
    <Widget titulo="Pendiente para ti" icono="Bell" color={MARCA.ambar} cuenta={total}>
      {filas.length ? filas.map((f, i) => (
        <Renglon key={f.id} primero={!i} titulo={f.texto} onPress={() => ctx.abrir(f.ruta)}
          izquierda={<Chip icono={f.icono} color={f.color} tamano={30} />}
          derecha={<Cuenta n={f.n} color={f.color} />} />
      )) : <Vacio texto="Todo al día" bien />}
    </Widget>
  );
}

// ── Ventas de hoy ───────────────────────────────────────────────────────────
// Las baldosas del tablero del portal: todas las salas que venden, dos por
// renglón, cada una con su total y sus horas coloreadas por carga. Van sueltas
// sobre la aurora (vidrio dentro de vidrio se enturbia) y cada una abre su sala
// en «Ventas de hoy».
export function Ventas({ datos, ctx }) {
  const salas = (datos.ventas || []).filter((v) => !ctx.alcanceSalaVentas || v.branchId === String(ctx.sala));
  const nombre = (id) => (ctx.sucursales || []).find((b) => String(b.id) === id)?.name ?? `Sala ${id}`;
  const total = salas.reduce((s, v) => s + v.total, 0);
  const abrir = (sala) => ctx.abrir(sala ? `/ventas-hoy?sala=${sala}` : '/ventas-hoy');
  return (
    <View style={{ marginHorizontal: 16, gap: 10 }}>
      <Pressable onPress={() => abrir()} style={{ paddingHorizontal: 4 }}>
        <Titulo texto="Ventas de hoy" icono="TrendingUp" color={MARCA.verde} accion="Ver todo" />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: -4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(total)}</Text>
          <LeyendaCorta />
        </View>
      </Pressable>
      {salas.length ? <RejillaDeSalas salas={salas} nombre={nombre} onElegir={abrir} />
        : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Todavía no hay ventas hoy.</Text>}
    </View>
  );
}

function LeyendaCorta() {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {['normal', 'pico', 'critica'].map((k) => (
        <View key={k} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_VOLUMEN[k] }} />
      ))}
    </View>
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
    <Widget titulo="Meta del mes" icono="Target" color={color} onAbrir={ctx.puede('metas') ? () => ctx.abrir('/metas') : null}>
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
    </Widget>
  );
}

// ── Equipo ahora ────────────────────────────────────────────────────────────
export function Equipo({ datos, ctx }) {
  const emps = empleadosActivos(ctx.empleados).filter((e) => !ctx.alcanceSala || String(e.branchId ?? e.branch_id ?? '') === String(ctx.sala));
  const presentes = emps.filter((e) => (e.attendance || []).some((a) => (a.date || a.timestamp?.split('T')[0]) === datos.hoy));
  const cumple = cumplenEl(emps, datos.hoy);
  const ausentes = (datos.ausencias || []).length;
  return (
    <Widget titulo="Equipo hoy" icono="Users" color={MARCA.azul} cuenta={presentes.length} onAbrir={ctx.puede('monitor') ? () => ctx.abrir('/monitor') : null}>
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
    </Widget>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────
export function Avisos({ ctx }) {
  const a = (ctx.comunicados || []).find((x) => !x.isArchived && (!x.scheduledFor || new Date(x.scheduledFor) <= new Date()));
  if (!a) return null;
  return (
    <Widget titulo="Comunicados" icono="Megaphone" color={MARCA.violeta} onAbrir={() => ctx.abrir('/mis-avisos')}>
      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>{a.title}</Text>
      {a.message || a.body ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 4 }} numberOfLines={2}>{a.message || a.body}</Text> : null}
    </Widget>
  );
}

// El registro: en qué pestañas va cada widget y con qué permiso — el mismo
// reparto y los mismos permisos del tablero del portal
// (`PESTANAS_TEMATICAS` + `WIDGET_DEFS`). General los lleva TODOS, como el
// portal (pedido del usuario del 2026-09-30: «no me salen todos los
// widgets»); el orden por uso sube los que más se abren. `permiso` puede ser
// una lista: basta con uno.
export const SECCIONES = [
  { id: 'pendientes', pestanas: ['general', 'operacion'], visible: (d) => d.solicitudes != null || d.traslados != null || d.cortes != null, Componente: Pendientes },
  { id: 'ventas', pestanas: ['general', 'comercial'], permiso: 'dash_sales', Componente: Ventas },
  { id: 'ventas_hora', pestanas: ['general', 'comercial'], permiso: 'dash_sales', Componente: VentasPorHora },
  { id: 'pedir_ajuste', pestanas: ['general', 'operacion'], permiso: O.PERMISOS_DE_AJUSTE, Componente: O.PedirAjuste },
  { id: 'meta', pestanas: ['general', 'comercial'], permiso: 'dash_meta_sala', visible: (d) => !!d.meta, Componente: Meta },
  { id: 'equipo', pestanas: ['general'], permiso: 'dash_shifts', Componente: Equipo },
  { id: 'sucursales', pestanas: ['general'], permiso: 'dash_branches', Componente: W.AlertasSucursales },
  { id: 'datos_pedidos', pestanas: ['general', 'comercial'], permiso: 'dash_dato_pedido', Componente: G.DatosQueFaltan },
  { id: 'avisos', pestanas: ['general', 'rrhh'], permiso: 'dash_announcements', Componente: Avisos },
  // Comercial
  { id: 'facturacion', pestanas: ['general', 'comercial'], permiso: 'dash_facturacion', Componente: C.Facturacion },
  { id: 'vendedores', pestanas: ['general', 'comercial'], permiso: 'dash_vendedores', Componente: C.Vendedores },
  { id: 'top', pestanas: ['general', 'comercial'], permiso: 'dash_top_productos', Componente: C.TopProductos },
  { id: 'cortes', pestanas: ['general', 'comercial'], permiso: 'dash_cortes_sala', Componente: C.Cortes },
  { id: 'bolsas', pestanas: ['general', 'comercial'], permiso: 'dash_bolsas_sala', Componente: C.Bolsas },
  { id: 'cotizaciones', pestanas: ['general', 'comercial'], permiso: 'dash_cotizaciones', Componente: C.Cotizaciones },
  // RRHH
  { id: 'turnos', pestanas: ['general', 'rrhh'], permiso: 'dash_shifts', Componente: W.Turnos },
  { id: 'tendencia', pestanas: ['general', 'rrhh'], permiso: 'dash_trend', Componente: W.Tendencia },
  { id: 'ausencias', pestanas: ['general', 'rrhh'], permiso: 'dash_absences', Componente: W.Ausencias },
  { id: 'solicitudes', pestanas: ['general', 'rrhh'], permiso: 'dash_requests', Componente: W.SolicitudesPendientes },
  { id: 'cumpleanos', pestanas: ['general', 'rrhh'], permiso: 'dash_birthdays', Componente: W.Cumpleanos },
  { id: 'calendario', pestanas: ['general', 'rrhh'], permiso: 'dash_calendar', Componente: W.Calendario },
  // Operación
  { id: 'consulta', pestanas: ['general', 'operacion'], permiso: 'dash_inv_search', Componente: O.ConsultaInventario },
  { id: 'traslados', pestanas: ['general', 'operacion'], permiso: 'dash_traslados', Componente: O.Traslados },
  { id: 'bitacoras', pestanas: ['general', 'operacion'], permiso: 'dash_bitacoras', Componente: O.Bitacoras },
  { id: 'recetas', pestanas: ['general', 'operacion'], permiso: 'dash_recetas_pendientes', Componente: O.RecetasPendientes },
  { id: 'facturas_sala', pestanas: ['general', 'operacion'], permiso: 'dash_facturas_sala', Componente: O.FacturasSala },
];
