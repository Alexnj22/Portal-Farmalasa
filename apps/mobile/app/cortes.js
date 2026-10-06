// Cortes de caja, NATIVO — la pestaña «Cortes» de Efectivo del portal
// (`CortesView`):
//
//   · las cuatro métricas del período —Sin confirmar, Cuadraron, Exceso,
//     Faltante (`resumenDeCortes`)— que al tocarlas FILTRAN, como en el portal;
//   · el estado (Todos / Sin confirmar / Confirmados / Descartados) en el
//     control segmentado; la diferencia, la sala y el período en el menú de
//     filtros; el período puede ser cualquiera, con el calendario del sistema;
//   · la búsqueda (sala, quien cortó, monto, n.º de corte) en la barra.
// El filtro es el MISMO del portal (núcleo: `filtrarCortes`).
//
// Cada tarjeta: hora, quién lo hizo y a quién se entregó, la cifra del TRAMO
// (`conTramoPorSalaYDia`) con su color y el estado. Tocar una abre
// `corte/[id]`, donde se lee el detalle y se confirma o se descarta.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchCortes } from '@nucleo/data/cortes';
import { conTramoPorSalaYDia, diferenciaDelCorte, filtrarCortes, noContoEfectivo, resumenDeCortes, severidad } from '@nucleo/utils/cortesDiagnostico';
import { ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto, hoySV, mesSV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const TONO = { ok: MARCA.verde, sobra: MARCA.ambar, falta: MARCA.rojo };
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : n < 0 ? `−${formatMoney(Math.abs(n))}` : formatMoney(0));
const ESTADO = { PENDIENTE: ['Por confirmar', MARCA.ambar], CONFIRMADO: ['Confirmado', MARCA.verde], DESCARTADO: ['Descartado', MARCA.rojo] };
const POR_PAGINA = 40;
const ESTADOS = [
  // Cortos a propósito: cuatro segmentos en el ancho de un teléfono. La cuenta
  // de los pendientes ya la dice la métrica de arriba.
  { id: 'TODOS', label: 'Todos' }, { id: 'PENDIENTE', label: 'Pendientes' },
  { id: 'CONFIRMADO', label: 'Confirmados' }, { id: 'DESCARTADO', label: 'Descartados' },
];

/** El período elegido, como `[desde, hasta]`. */
function rangoDe(periodo, libre) {
  const hoy = hoySV();
  if (periodo === 'hoy') return [hoy, hoy];
  if (periodo === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
  if (periodo === '7') return [sumarDias(hoy, -6), hoy];
  if (periodo === 'mes') return [`${mesSV()}-01`, hoy];
  return libre.desde <= libre.hasta ? [libre.desde, libre.hasta] : [libre.hasta, libre.desde];
}

function Tarjeta({ c, sala, conSala, conFecha }) {
  const sinConteo = noContoEfectivo(c);
  const descartado = c.estado === 'DESCARTADO';
  const dif = descartado ? diferenciaDelCorte(c).valor : c.tramo;
  const sev = severidad(dif);
  const [estado, color] = ESTADO[c.estado] ?? [c.estado, MARCA.azulClaro];
  const quien = c.hizo?.name ? shortEmployeeName({ name: c.hizo.name }) : (c.empleado_texto || 'Desde la caja');
  const encabezado = [conSala ? sala : null, conFecha ? fechaTexto(c.fecha, { weekday: 'short', day: 'numeric', month: 'short' }) : null, hora12(c.hora)].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha: c.fecha } }); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{encabezado}</Text>
            {c.tipo === 'Z' || c.tipo === 'X' ? (
              <Pildora texto={c.tipo === 'Z' ? 'Cierre (Z)' : 'Lectura (X)'} color={MARCA.violeta} />
            ) : sinConteo ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 17, fontWeight: '700' }}>Sin conteo</Text>
            ) : (
              <Text style={{ color: descartado ? colorSistema.texto2 : TONO[sev], fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'],
                textDecorationLine: descartado ? 'line-through' : 'none' }}>{conSigno(dif ?? 0)}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>
              {quien}{c.recibe?.name ? ` → ${shortEmployeeName({ name: c.recibe.name })}` : ''}
              {c.total_declarado != null && c.tipo === 'C' && !sinConteo ? ` · contó ${formatMoney(c.total_declarado)}` : ''}
            </Text>
            <Pildora texto={estado} color={color} />
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Cortes() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('cortes_caja') === 'ALL';
  const miSala = String(salaDelUsuario(user) ?? '');
  const [periodo, setPeriodo] = useState('hoy');
  const [libre, setLibre] = useState(() => ({ desde: sumarDias(hoySV(), -1), hasta: hoySV() }));
  const [salaElegida, setSala] = useState('todas');
  const [estado, setEstado] = useState('PENDIENTE');
  const [diferencia, setDiferencia] = useState('TODAS');
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState(null);
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);
  const [desde, hasta] = rangoDe(periodo, libre);

  const cargar = useCallback(async () => {
    const r = await fetchCortes({ desde, hasta }).catch(() => null);
    setFilas(conTramoPorSalaYDia(r || []));
    setCuantos(POR_PAGINA);
  }, [desde, hasta]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const nombreSala = useMemo(() => Object.fromEntries((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const nombre = (id) => nombreSala[id] ?? `Sala ${id}`;
  const deMiAlcance = useMemo(() => (filas || []).filter((c) => (todas ? true : String(c.branch_id) === miSala)), [filas, todas, miSala]);
  const salas = useMemo(() => [...new Set(deMiAlcance.map((c) => String(c.branch_id)))].sort((a, b) => ordenDeSala(a) - ordenDeSala(b)), [deMiAlcance]);
  const sala = salaElegida === 'todas' ? '' : salaElegida;
  const resumen = useMemo(() => resumenDeCortes(sala ? deMiAlcance.filter((c) => String(c.branch_id) === sala) : deMiAlcance), [deMiAlcance, sala]);
  const visibles = useMemo(() => filtrarCortes(deMiAlcance, { sala, estado, diferencia, busqueda: texto, nombreSala })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || ordenDeSala(a.branch_id) - ordenDeSala(b.branch_id) || String(b.hora).localeCompare(String(a.hora))),
  [deMiAlcance, sala, estado, diferencia, texto, nombreSala]);

  // Tocar una métrica aplica su filtro; tocarla otra vez lo quita.
  const alternarDiferencia = (v) => setDiferencia((d) => (d === v ? 'TODAS' : v));
  const variosDias = desde !== hasta;
  const grupos = [
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: 'hoy', onCambiar: setPeriodo,
      opciones: [{ id: 'hoy', label: 'Hoy' }, { id: 'ayer', label: 'Ayer' }, { id: '7', label: 'Últimos 7 días' }, { id: 'mes', label: 'Este mes' }, { id: 'libre', label: 'Otras fechas' }] },
    { id: 'diferencia', titulo: 'Diferencia', activa: diferencia, porDefecto: 'TODAS', onCambiar: setDiferencia,
      opciones: [{ id: 'TODAS', label: 'Todas' }, { id: 'ok', label: 'Cuadraron' }, { id: 'sobra', label: 'Con exceso' }, { id: 'falta', label: 'Con faltante' }] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((s) => ({ id: s, label: nombre(s) }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cortes de caja', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Sala, quién cortó o monto', hideWhenScrolling: true,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={{ icono: 'banknote', etiqueta: 'Efectivo', onPress: () => router.push('/efectivo') }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {periodo === 'libre' ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, gap: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Del</Text>
                <Fecha valor={libre.desde} hasta={hoySV()} onCambiar={(v) => setLibre((l) => ({ ...l, desde: v }))} />
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>al</Text>
                <Fecha valor={libre.hasta} hasta={hoySV()} onCambiar={(v) => setLibre((l) => ({ ...l, hasta: v }))} />
              </View>
            </Vidrio>
          </View>
        ) : (
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
            {variosDias ? `${fechaTexto(desde, { day: 'numeric', month: 'short' })} – ${fechaTexto(hasta, { day: 'numeric', month: 'short' })}` : fechaTexto(desde, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        )}
        {filas ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Clock" rotulo="Sin confirmar" valor={String(resumen.pendientes)} color={MARCA.azulClaro} pide={resumen.pendientes > 0}
                apoyo={estado === 'PENDIENTE' ? 'filtrando' : 'toca para ver'} onPress={() => setEstado((e) => (e === 'PENDIENTE' ? 'TODOS' : 'PENDIENTE'))} />
              <Kpi icono="ShieldCheck" rotulo="Cuadraron" valor={String(resumen.cuadrados)} color={MARCA.verde}
                apoyo={resumen.vivos ? `${Math.round((resumen.cuadrados / resumen.vivos) * 100)}% de ${resumen.vivos}` : 'sin cortes'} onPress={() => alternarDiferencia('ok')} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="TrendingUp" rotulo="Exceso" valor={String(resumen.exceso)} color={MARCA.ambar} pide={resumen.exceso > 0}
                apoyo={diferencia === 'sobra' ? 'filtrando' : 'con sobrante'} onPress={() => alternarDiferencia('sobra')} />
              <Kpi icono="TrendingDown" rotulo="Faltante" valor={String(resumen.faltante)} color={MARCA.rojo} pide={resumen.faltante > 0}
                apoyo={diferencia === 'falta' ? 'filtrando' : 'con faltante'} onPress={() => alternarDiferencia('falta')} />
            </FilaDeKpis>
            {resumen.descartados || resumen.sinConteo ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
                {[resumen.descartados ? `${resumen.descartados} descartado${resumen.descartados === 1 ? '' : 's'}` : null,
                  resumen.sinConteo ? `${resumen.sinConteo} sin conteo` : null].filter(Boolean).join(' · ')}{' — no entran en el reparto.'}
              </Text>
            ) : null}
          </>
        ) : null}
        <Segmentos activa={estado} onCambiar={setEstado} opciones={ESTADOS} />
        {filas == null ? null : visibles.length ? (
          <>
            {visibles.slice(0, cuantos).map((c) => (
              <Tarjeta key={c.id} c={c} sala={nombre(c.branch_id)} conSala={todas && !sala} conFecha={variosDias} />
            ))}
            {visibles.length > cuantos ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={`Ver más (${visibles.length - cuantos})`} borde onPress={() => setCuantos((n) => n + POR_PAGINA)} />
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ alignItems: 'center', paddingTop: 50, gap: 6, marginHorizontal: 24 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>
              {texto.trim() ? 'Ningún corte con esa búsqueda' : estado === 'PENDIENTE' ? 'Nada por confirmar' : 'Sin cortes con estos filtros'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Desliza hacia abajo para actualizar.</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}
