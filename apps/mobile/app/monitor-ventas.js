// Monitor de ventas, NATIVO — el «Monitor de ventas» del portal
// (`FormWfmAnalytics.jsx`, el botón de ampliar del widget «Ventas por día y
// hora»). Pedido del usuario del 2026-10-01: «¿está la opción de abrirlo y
// tener filtros de tiempos y sucursales, así como en el portal? … debe verse
// todo nativo».
//
//   · Sala y período van en el menú de filtros de la barra (con palomitas,
//     como Mail); lo que no está en su valor de entrada se ve en una ficha ✕.
//   · Semana · Por hora es el control segmentado del sistema; en «Por hora»
//     un segundo segmentado elige el día (o toda la semana).
//   · Tocar una barra la elige: vibra, las demás se atenúan y abajo sale su
//     detalle — el «tooltip» del portal, que en un teléfono no existe. En
//     Semana, el detalle trae «Ver sus horas».
//
// El cálculo es el del núcleo (`afluencia`), el mismo del portal, y la
// lectura pagina: «1 año» son ~5,000 filas por sala.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBranchHourlySalesRange } from '@nucleo/data/dashboard';
import { fetchVentasSinProducto } from '@nucleo/data/ventas';
import { BRANCH_A_ERP, ERP_BODEGA, ordenDeSala } from '@nucleo/constants/erp';
import { afluencia } from '@nucleo/utils/afluencia';
import { nivelDeVolumen } from '@nucleo/utils/inicio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { COLOR_VOLUMEN, LeyendaDeVolumen } from '../componentes/inicio/MiniSala';
import { Aviso } from '../componentes/formulario/Piezas';
import Vidrio from '../componentes/Vidrio';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';

const PERIODOS = [
  { id: '0', label: 'Hoy' },
  { id: '30', label: 'Últimos 30 días' },
  { id: '90', label: 'Últimos 3 meses' },
  { id: '180', label: 'Últimos 6 meses' },
  { id: '365', label: 'Último año' },
];
const DIA = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
const DIA_CORTO = { 0: 'Do', 1: 'Lu', 2: 'Ma', 3: 'Mi', 4: 'Ju', 5: 'Vi', 6: 'Sá' };
const PLURAL = { 0: 'domingos', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados' };
const NIVEL = { muerta: 'Muerta', normal: 'Normal', pico: 'Pico', critica: 'Crítica' };
const hora = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
const horaCorta = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

function Barras({ items, elegida, onElegir, rotulo }) {
  const max = Math.max(1, ...items.map((i) => i.tickets));
  const ALTO = 190;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: items.length > 9 ? 3 : 6, height: ALTO + 40 }}>
      {items.map((it) => {
        const clave = it.dia ?? it.hora;
        const activa = elegida === clave;
        const h = it.tickets > 0 ? Math.max((it.tickets / max) * ALTO, ALTO * 0.06) : 3;
        return (
          <Pressable key={clave} accessibilityRole="button" accessibilityLabel={`${rotulo(it, true)}: ${it.tickets} tickets`}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(activa ? null : clave); }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 5, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Text style={{ color: activa ? colorSistema.texto : colorSistema.texto2, fontSize: 11, fontWeight: activa ? '800' : '500', fontVariant: ['tabular-nums'] }}
              numberOfLines={1}>{it.tickets || ''}</Text>
            <View style={{
              width: '100%', height: h, borderRadius: 6,
              backgroundColor: COLOR_VOLUMEN[nivelDeVolumen(it.tickets)],
              opacity: it.tickets <= 0 ? 0.3 : elegida == null || activa ? 1 : 0.4,
            }} />
            <Text style={{ color: activa ? colorSistema.texto : colorSistema.texto2, fontSize: 11, fontWeight: activa ? '700' : '400' }}
              numberOfLines={1}>{rotulo(it, false)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function MonitorDeVentas() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('dash_sales') === 'ALL';
  const { sala: salaPedida } = useLocalSearchParams();
  const salas = useMemo(() => (sucursales || [])
    .filter((b) => BRANCH_A_ERP[Number(b.id)] != null && BRANCH_A_ERP[Number(b.id)] !== ERP_BODEGA)
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const propia = String(salaDelUsuario(user) ?? '');
  const inicial = todas ? String(salaPedida || salas[0]?.id || '') : propia;
  const [sala, setSala] = useState(inicial);
  useEffect(() => { if (!sala && inicial) setSala(inicial); }, [sala, inicial]);
  const [periodo, setPeriodo] = useState('30');
  const [vista, setVista] = useState('semana');   // 'semana' | 'horas'
  const [dia, setDia] = useState('todos');        // en 'horas': 'todos' o '0'..'6'
  const [elegida, setElegida] = useState(null);
  const [filas, setFilas] = useState(null);
  const [sinProducto, setSinProducto] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState(null);

  const hoy = periodo === '0';
  const sucursal = (sucursales || []).find((b) => String(b.id) === sala);

  const cargar = useCallback(async () => {
    if (!sala) return;
    const ffin = hoySV();
    const fini = hoy ? ffin : sumarDias(ffin, -Number(periodo));
    setError(null);
    const { data, error: e } = await fetchBranchHourlySalesRange(sala, fini);
    if (e) { setError('No se pudieron leer las ventas. Desliza hacia abajo para reintentar.'); setFilas([]); return; }
    setFilas(data);
    // El aviso va aparte: si falla, el monitor se pinta igual. Sin el permiso
    // el servidor devuelve null y no se dice nada.
    fetchVentasSinProducto({ fini, ffin, branchId: sala }).then(setSinProducto).catch(() => setSinProducto(null));
  }, [sala, periodo, hoy]);
  useEffect(() => { setFilas(null); setElegida(null); cargar(); }, [cargar]);

  // «Hoy» sólo tiene horas: no hay semana que promediar.
  const vistaReal = hoy ? 'horas' : vista;
  const diaReal = hoy ? 'todos' : dia;
  const r = useMemo(() => (filas ? afluencia(filas, sucursal, {
    vista: vistaReal === 'semana' ? 'dias' : diaReal === 'todos' ? 'horas' : Number(diaReal), hoy,
  }) : null), [filas, sucursal, vistaReal, diaReal, hoy]);
  const items = r?.items ?? [];
  // Las fechas que entran en ESTA vista: en «los jueves», los jueves.
  const medidos = useMemo(() => new Set(items.flatMap((it) => it.fechas)).size, [items]);
  const pico = items.reduce((m, it) => (it.tickets > (m?.tickets ?? 0) ? it : m), null);
  const sel = elegida == null ? null : items.find((it) => (it.dia ?? it.hora) === elegida);

  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: inicial, onCambiar: setSala,
      opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : []),
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: '30', onCambiar: setPeriodo, opciones: PERIODOS },
  ];

  const nombreDe = (it, largo) => (it.dia != null ? (largo ? DIA[it.dia] : DIA_CORTO[it.dia]) : (largo ? hora(it.hora) : horaCorta(it.hora)));
  const deQue = hoy ? 'hoy'
    : vistaReal === 'semana' ? 'un día típico'
      : diaReal === 'todos' ? 'toda la semana' : `los ${PLURAL[diaReal]}`;
  const periodoTexto = PERIODOS.find((p) => p.id === periodo)?.label.toLowerCase();

  const detalle = (it) => {
    const n = it.fechas.length;
    if (hoy) return `Lo registrado hoy (${hoySV()}).`;
    if (n === 1) return `Un solo día con ventas: ${it.fechas[0]}.`;
    if (it.dia != null) return `Promedio de ${n} ${PLURAL[it.dia]}, ${periodoTexto}. Los tickets son los de su hora típica (percentil 75).`;
    return `Promedio de ${n} día${n === 1 ? '' : 's'} con ventas a esa hora, ${periodoTexto}.`;
  };

  return (
    <>
      {/* Regresar sólo desde el borde: el dedo recorre las barras. */}
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Monitor de ventas', headerLargeTitle: true, fullScreenGestureEnabled: false }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 40, gap: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />

        <View style={{ paddingHorizontal: 20 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700' }}>{sucursal?.name ?? '—'}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{PERIODOS.find((p) => p.id === periodo)?.label}</Text>
        </View>

        {!hoy ? (
          <View style={{ gap: 10 }}>
            <Segmentos opciones={[{ id: 'semana', label: 'Semana' }, { id: 'horas', label: 'Por hora' }]} activa={vista}
              onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setVista(v); setElegida(null); }} />
            {vista === 'horas' ? (
              <Segmentos activa={dia} onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setDia(v); setElegida(null); }}
                opciones={[{ id: 'todos', label: 'Todos' }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => ({ id: String(d), label: DIA_CORTO[d] }))]} />
            ) : null}
          </View>
        ) : null}

        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={24}>
            <View style={{ padding: 16, gap: 12 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                Tickets por hora · {deQue}
              </Text>
              {filas == null ? (
                <View style={{ height: 230, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>
              ) : !r?.fechas ? (
                <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{error ?? 'No hay ventas registradas en este período.'}</Text>
                </View>
              ) : (
                <Barras items={items} elegida={elegida} onElegir={setElegida} rotulo={nombreDe} />
              )}
              <LeyendaDeVolumen />
            </View>
          </Vidrio>
        </View>

        {sel ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={22}>
              <View style={{ padding: 16, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR_VOLUMEN[nivelDeVolumen(sel.tickets)] }} />
                  <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '700', flex: 1 }}>
                    {sel.dia != null ? DIA[sel.dia] : `${diaReal !== 'todos' ? `${DIA[diaReal]} · ` : ''}${hora(sel.hora)}`}
                  </Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{NIVEL[nivelDeVolumen(sel.tickets)]}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{sel.tickets}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{hoy ? 'tickets' : 'tickets por hora'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: MARCA.verde, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(sel.ventas)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{sel.dia != null ? 'venta del día' : hoy ? 'vendido' : 'venta de la hora'}</Text>
                  </View>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle(sel)}</Text>
                {sel.dia != null ? (
                  <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVista('horas'); setDia(String(sel.dia)); setElegida(null); }}
                    style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '600' }}>Ver sus horas ›</Text>
                  </Pressable>
                ) : null}
              </View>
            </Vidrio>
          </View>
        ) : r?.fechas ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
            Toca una barra para ver su detalle{vistaReal === 'semana' ? ' y sus horas' : ''}.
          </Text>
        ) : null}

        {r?.fechas ? (
          <FilaDeKpis>
            <Kpi icono="Activity" rotulo={vistaReal === 'semana' ? 'Día más cargado' : 'Hora pico'} color={MARCA.ambar}
              valor={pico ? nombreDe(pico, true) : '—'} apoyo={pico ? `${pico.tickets} tickets por hora` : null} />
            <Kpi icono="Calendar" rotulo="Días medidos" valor={`${medidos}`} apoyo={hoy ? 'hoy' : vistaReal === 'horas' && diaReal !== 'todos' ? `${PLURAL[diaReal]}, ${periodoTexto}` : periodoTexto} color={MARCA.azul} />
          </FilaDeKpis>
        ) : null}

        {sinProducto && Number(sinProducto.facturas ?? sinProducto.no_producto_facturas ?? 0) > 0 && Number(sinProducto.total ?? sinProducto.no_producto ?? 0) > 0 ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono="cuidado" texto={`Lo que se dibuja aquí incluye ${formatMoney(Number(sinProducto.total ?? sinProducto.no_producto))} que no son venta de productos (${Number(sinProducto.facturas ?? sinProducto.no_producto_facturas)} cobros). No cuentan para la meta.`} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
