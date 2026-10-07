// La ficha de una sucursal, NATIVA — `BranchDetailView` en cuatro pestañas:
//   · Resumen   — alertas, dirección completa (Mapas · compartir), teléfonos
//                 (llamar · WhatsApp), kioscos N/3, horario de la semana, la
//                 gente asignada y la completitud del perfil en barras.
//   · Expediente — los documentos que le tocan a ESTA sala (permisos, personal,
//                 infraestructura y los propios), cada uno con su estado: falta,
//                 vencido, vence en N días o al día (`expedienteDeSucursal`).
//   · Gastos    — arrendamiento y servicios con su estado y día de pago, el
//                 total operativo y la tendencia de los últimos seis meses en
//                 barras (`gastosDeSucursal`).
//   · Historial — lo que se registró de la sala, con antes → nuevo y quién
//                 (`historialDeSucursal`), filtrable por dimensión.
// Todo lo que decide sale del núcleo, el mismo del portal. La ficha se edita
// en `sucursal/editar`; registrar un pago o subir un documento sigue en el portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchBranchExpensesHistory, fetchBranchKiosks } from '@nucleo/data/branches';
import { abiertaAhora, ahoraEnSV, alertasDeSucursal, completitudDelPerfil, TIPOS_DE_SUCURSAL } from '@nucleo/utils/sucursales';
import { documentosDeSucursal, estadoDeDocumento, vencimientoEfectivo } from '@nucleo/utils/expedienteDeSucursal';
import { gastosPorMes, serviciosDeSucursal, totalOperativo, variacionDeGastos } from '@nucleo/utils/gastosDeSucursal';
import { DIMENSIONES_DEL_HISTORIAL, dimensionDelRegistro, historialConApertura, lecturaDelRegistro, rotuloDelRegistro } from '@nucleo/utils/historialDeSucursal';
import { CATEGORIAS_DOCUMENTO } from '@nucleo/data/constants';
import { formatTime12h } from '@nucleo/utils/helpers';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Avatar from '../../componentes/Avatar';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Grafica from '../../componentes/metas/Graficas';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { MARCA } from '../../componentes/inicio/marca';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const corta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : null);

function Boton({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} hitSlop={6}
      style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${color}2E`, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

// Una barra de avance para la completitud del perfil.
function Barra({ rotulo, pct }) {
  const color = pct >= 100 ? MARCA.verde : pct >= 60 ? MARCA.azulClaro : MARCA.ambar;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row' }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
        <Text style={{ color, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`${pct}%`}</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 6, backgroundColor: color }} />
      </View>
    </View>
  );
}

function Resumen({ b, gente, kioscos }) {
  const { dia, hora } = ahoraEnSV();
  const alertas = alertasDeSucursal(b, Date.now(), gente);
  const comp = completitudDelPerfil(b);
  const semana = b.weeklyHours || b.weekly_hours || {};
  const tipo = b.type || 'FARMACIA';
  const ubicacion = [b.address, b.settings?.location?.municipality, b.settings?.location?.department].filter(Boolean).join(', ');
  const mapas = b.settings?.location?.mapsUrl || `https://maps.apple.com/?q=${encodeURIComponent(ubicacion || b.name)}`;
  const llamar = (n) => Linking.openURL(`tel:${String(n).replace(/[^\d+]/g, '')}`).catch(() => {});
  const whatsapp = (n) => {
    let limpio = String(n).replace(/\D/g, '');
    if (limpio.length === 8) limpio = `503${limpio}`;
    Linking.openURL(`https://wa.me/${limpio}`).catch(() => {});
  };
  return (
    <>
      {alertas.hasAlerts ? (
        <Seccion titulo={`Alertas · ${alertas.list.length}`}>
          {alertas.list.map((a, i) => (
            <Text key={i} style={{ color: a.level === 'critical' ? MARCA.rojo : MARCA.ambar, fontSize: 15, fontWeight: '600' }}>{`• ${a.message}`}</Text>
          ))}
        </Seccion>
      ) : <Aviso texto="Operativa: sin alertas." />}
      <Seccion titulo="Dónde está">
        <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{ubicacion || 'Dirección no registrada'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Boton texto="Abrir en Mapas" onPress={() => Linking.openURL(mapas).catch(() => {})} />
          {ubicacion ? <Boton texto="Compartir dirección" onPress={() => Share.share({ message: `${b.name}: ${ubicacion}` })} /> : null}
        </View>
      </Seccion>
      <Seccion titulo="Contacto">
        {[['Teléfono', b.phone], ['Celular', b.cell]].filter(([, n]) => n).map(([r, n], i) => (
          <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{r}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{n}</Text>
            </View>
            <Boton texto="Llamar" onPress={() => llamar(n)} color={MARCA.verde} />
            {r === 'Celular' ? <Boton texto="WhatsApp" onPress={() => whatsapp(n)} color={MARCA.verde} /> : null}
          </View>
        ))}
        {!b.phone && !b.cell ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin teléfonos registrados.</Text> : null}
      </Seccion>
      <FilaDeKpis>
        <Kpi icono="Monitor" rotulo="Kioscos" valor={kioscos == null ? '…' : `${kioscos} / 3`} color={kioscos ? MARCA.violetaClaro : colorSistema.texto2} apoyo="activos para marcar" />
        <Kpi icono="Users" rotulo="Personal" valor={String(gente.length)} color={MARCA.azulClaro} apoyo={gente.length ? 'asignados' : 'nadie asignado'} />
      </FilaDeKpis>
      {tipo === 'FARMACIA' ? (
        <Seccion titulo={`Horario · ${abiertaAhora(b, dia, hora).label}`}>
          {ORDEN_DIAS.map((d, i) => {
            const x = semana[String(d)];
            const v = !x || x.isOpen === false ? 'Cerrado' : x.start && x.end ? `${formatTime12h(x.start)} – ${formatTime12h(x.end)}` : 'No definido';
            return <Dato key={d} primero={i === 0} rotulo={d === dia ? `${DIAS[d]} (hoy)` : DIAS[d]} valor={v} fuerte={d === dia} />;
          })}
        </Seccion>
      ) : null}
      <Seccion titulo={`Personal · ${gente.length}`}>
        {gente.length ? gente.map((e, i) => (
          <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
            <Avatar empleado={e} tamano={32} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[e.role, e.secondary_role].filter(Boolean).join(' · ') || '—'}</Text>
            </View>
          </View>
        )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie asignado.</Text>}
      </Seccion>
      <Seccion titulo="Perfil completo">
        <Barra rotulo="Legal" pct={comp.legal} />
        <Barra rotulo="Inmueble" pct={comp.property} />
        <Barra rotulo="Servicios" pct={comp.services} />
      </Seccion>
    </>
  );
}

function Documento({ d, primero }) {
  const e = estadoDeDocumento(d.url, vencimientoEfectivo(d));
  const color = colorDeVariante(e.variant);
  const fecha = d.hasIssueDate && d.issueDate ? `emitido ${corta(d.issueDate)}` : vencimientoEfectivo(d) ? `vence ${corta(d.expDate)}` : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 9 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{d.title}</Text>
        {fecha ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fecha}</Text> : null}
      </View>
      <Pildora texto={e.label} color={color} />
      {d.url ? <Boton texto="Ver" onPress={() => Linking.openURL(d.url).catch(() => {})} /> : null}
    </View>
  );
}

function Expediente({ b }) {
  const [todos, setTodos] = useState(false);
  const exp = useMemo(() => documentosDeSucursal(b), [b]);
  // Como el portal: de arranque sólo lo que pide atención (falta, vence, vencido).
  const filtrar = (l) => (todos ? l : l.filter((d) => estadoDeDocumento(d.url, vencimientoEfectivo(d)).type !== 'OK'));
  const grupos = [
    ['Permisos y licencias', [...exp.permisos, ...exp.propios.filter((d) => d.category === 'PERMISOS')]],
    ['Personal técnico', [...exp.personal, ...exp.propios.filter((d) => d.category === 'RRHH')]],
    ['Infraestructura y operación', [...exp.infra, ...exp.propios.filter((d) => d.category === 'OPERATIVO')]],
    ...Object.entries(CATEGORIAS_DOCUMENTO).filter(([k]) => !['PERMISOS', 'RRHH', 'OPERATIVO'].includes(k))
      .map(([k, { label }]) => [label, exp.propios.filter((d) => d.category === k)]),
  ].map(([t, l]) => [t, filtrar(l)]).filter(([, l]) => l.length);
  return (
    <>
      <Seccion titulo="Expediente">
        <Barra rotulo={`${exp.subidos} de ${exp.total} documentos`} pct={exp.avance} />
      </Seccion>
      <Segmentos activa={todos ? 'todos' : 'atencion'} onCambiar={(v) => setTodos(v === 'todos')}
        opciones={[{ id: 'atencion', label: 'Piden atención' }, { id: 'todos', label: 'Todos' }]} />
      {grupos.map(([titulo, lista]) => (
        <Seccion key={titulo} titulo={`${titulo} · ${lista.length}`}>
          {lista.map((d, i) => <Documento key={d.id} d={d} primero={i === 0} />)}
        </Seccion>
      ))}
      {!grupos.length ? <Aviso texto={todos ? 'Esta sucursal no tiene documentos configurados.' : 'Todo el expediente está al día.'} /> : null}
    </>
  );
}

function Gastos({ b }) {
  const [historial, setHistorial] = useState(null);
  useEffect(() => {
    fetchBranchExpensesHistory(b.id).then(({ data, error }) => setHistorial(error ? [] : gastosPorMes(data))).catch(() => setHistorial([]));
  }, [b.id]);
  const servicios = serviciosDeSucursal(b);
  const total = totalOperativo(b);
  const v = historial ? variacionDeGastos(historial, b) : null;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="DollarSign" rotulo="Total operativo" valor={formatMoney(total)} color={MARCA.azulClaro} apoyo="al mes, aproximado" />
        <Kpi icono={v?.isUp ? 'TrendingUp' : 'TrendingDown'} rotulo="Contra el mes pasado" valor={v ? `${v.variation > 0 ? '+' : ''}${v.variation.toFixed(1)}%` : '…'}
          color={v?.isUp ? MARCA.ambar : MARCA.verde} apoyo={v ? `más caro: ${v.highestService}` : null} />
      </FilaDeKpis>
      <Seccion titulo="Tendencia de gastos · 6 meses">
        {historial == null ? <ActivityIndicator /> : historial.length ? (
          <Grafica datos={historial.map((m) => ({ etiqueta: m.name, total: m.total }))}
            series={[{ clave: 'total', rotulo: 'Pagado', color: MARCA.azulClaro, tipo: 'barra' }]}
            formato={(x) => formatMoney(x)} formatoEje={(x) => (x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : `$${Math.round(x)}`)}
            resumen={`${formatMoney(historial[historial.length - 1].total)} el último mes`} />
        ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Todavía no hay pagos registrados.</Text>}
      </Seccion>
      <Seccion titulo="Servicios">
        {servicios.map((s, i) => (
          <View key={s.clave} style={{ gap: 3, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{s.titulo}</Text>
              <Pildora texto={s.estado.label} color={colorDeVariante(s.estado.variant)} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[s.provider || 'Sin proveedor', s.amount != null ? formatMoney(s.amount) : null, s.estado.state === 'pending_receipt' ? `pagado hasta ${s.paidThrough}` : s.dueDay ? `paga el día ${s.dueDay}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}
      </Seccion>
    </>
  );
}

function Historial({ b, empleados }) {
  const traer = useStaffStore((s) => s.getBranchHistory);
  const [lista, setLista] = useState(null);
  const [dim, setDim] = useState('ALL');
  const [cuantos, setCuantos] = useState(40);
  useEffect(() => { traer?.(b.id).then((d) => setLista(d || [])).catch(() => setLista([])); }, [b.id, traer]);
  const porNombre = useMemo(() => new Map((empleados || []).map((e) => [String(e.name || '').toLowerCase(), e])), [empleados]);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const todos = useMemo(() => historialConApertura(lista, b.opening_date || b.openingDate), [lista, b]);
  const visibles = dim === 'ALL' ? todos : todos.filter((i) => dimensionDelRegistro(i) === dim);
  if (lista == null) return <ActivityIndicator style={{ marginTop: 20 }} />;
  return (
    <>
      <Segmentos activa={dim} onCambiar={(v) => { setDim(v); setCuantos(40); }}
        opciones={[{ id: 'ALL', label: 'Todo' }, ...DIMENSIONES_DEL_HISTORIAL.slice(0, 4).map((d) => ({ id: d.value, label: d.label }))]} />
      {visibles.slice(0, cuantos).map((item, i) => {
        const l = lecturaDelRegistro(item);
        const persona = l.actor ? (porId.get(String(l.actor.id)) ?? porNombre.get(String(l.actor.name).toLowerCase()) ?? { name: l.actor.name }) : null;
        const f = item.sortDate instanceof Date ? item.sortDate : new Date(item.sortDate);
        return (
          <Seccion key={item.id ?? i}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${corta(f.toISOString())}${!item.isSynthetic ? `, ${hora12(f)}` : ''}`}</Text>
              <Pildora texto={rotuloDelRegistro(item)} color={MARCA.azulClaro} />
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{l.titulo}</Text>
            {l.antes ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textDecorationLine: 'line-through' }}>{`Antes: ${l.antes}`}</Text> : null}
            {l.nuevo ? <Text style={{ color: l.critico ? MARCA.rojo : MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>{`Nuevo: ${l.nuevo}`}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {persona ? <Avatar empleado={persona} tamano={22} /> : null}
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{persona ? shortEmployeeName(persona) : 'Sistema'}</Text>
              {l.archivo ? <Boton texto="Ver documento" onPress={() => Linking.openURL(l.archivo).catch(() => {})} /> : null}
            </View>
          </Seccion>
        );
      })}
      {visibles.length > cuantos ? <Boton texto={`Ver ${Math.min(40, visibles.length - cuantos)} más`} onPress={() => setCuantos((n) => n + 40)} /> : null}
      {!visibles.length ? <Aviso texto="Nada registrado en este grupo." /> : null}
    </>
  );
}

export default function Sucursal() {
  const { id } = useLocalSearchParams();
  const puedeEditar = useAuth().hasPermission('branches', 'can_edit');
  const branches = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const b = useMemo(() => (branches || []).find((x) => String(x.id) === String(id)), [branches, id]);
  const gente = useMemo(() => (empleados || []).filter((e) => String(e.branchId ?? e.branch_id) === String(id) && (e.status || '').toUpperCase() !== 'INACTIVO'), [empleados, id]);
  const [pestana, setPestana] = useState('resumen');
  const [kioscos, setKioscos] = useState(null);
  useEffect(() => {
    fetchBranchKiosks(id).then(({ data }) => setKioscos((data || []).filter((k) => k.status === 'ACTIVE').length)).catch(() => setKioscos(0));
  }, [id]);
  if (!b) return <Aviso tono="freno" texto="No se encontró la sucursal." />;
  const tipo = b.type || 'FARMACIA';
  const { dia, hora } = ahoraEnSV();
  const abierta = abiertaAhora(b, dia, hora);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: b.name, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: 6, marginHorizontal: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800' }}>{b.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pildora texto={TIPOS_DE_SUCURSAL[tipo]?.label ?? tipo} color={MARCA.azulClaro} />
            {tipo === 'FARMACIA' ? <Pildora texto={abierta.label} color={abierta.status === 'OPEN' ? MARCA.verde : abierta.status === 'UNKNOWN' ? MARCA.ambar : colorSistema.texto2} /> : null}
            {(b.settings?.propertyType || b.propertyType) === 'RENTED' ? <Pildora texto="Alquilada" color={colorSistema.texto2} /> : (b.settings?.propertyType || b.propertyType) === 'OWNED' ? <Pildora texto="Propia" color={colorSistema.texto2} /> : null}
          </View>
        </View>
        <Segmentos activa={pestana} onCambiar={setPestana}
          opciones={[{ id: 'resumen', label: 'Resumen' }, { id: 'expediente', label: 'Expediente' }, { id: 'gastos', label: 'Gastos' }, { id: 'historial', label: 'Historial' }]} />
        {pestana === 'resumen' ? <Resumen b={b} gente={gente} kioscos={kioscos} /> : null}
        {pestana === 'expediente' ? <Expediente b={b} /> : null}
        {pestana === 'gastos' ? <Gastos b={b} /> : null}
        {pestana === 'historial' ? <Historial b={b} empleados={empleados} /> : null}
        {puedeEditar ? (
          <Seccion titulo="Editar">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[['horarios', 'Horarios'], ['legal', 'Legal'], ['inmueble', 'Inmueble'], ['servicios', 'Servicios']].map(([k, t]) => (
                <Boton key={k} texto={t} onPress={() => router.push({ pathname: '/sucursal/editar', params: { id: String(b.id), seccion: k } })} />
              ))}
            </View>
          </Seccion>
        ) : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center', marginTop: 4 }}>Registrar un pago o subir un documento: en el portal.</Text>
      </ScrollView>
    </>
  );
}
