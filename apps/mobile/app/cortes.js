// Cortes de caja, NATIVO: los del día, con los que esperan firma arriba. Lo
// que el portal muestra en Cortes y en el widget de la sala
// (`TarjetaCorte.jsx`): hora, quién lo hizo y a quién se entregó, la cifra del
// TRAMO (`conTramoPorSalaYDia`) con su color y el estado. Tocar uno abre
// `corte/[id]`, donde se confirma o se descarta.
//
// Con alcance de una sala se ven los de esa sala; con alcance todas, todas, y
// la sala se elige en el menú de filtros de la barra.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchCortes } from '@nucleo/data/cortes';
import { conTramoPorSalaYDia, diferenciaDelCorte, noContoEfectivo, severidad } from '@nucleo/utils/cortesDiagnostico';
import { ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const TONO = { ok: MARCA.verde, sobra: MARCA.ambar, falta: MARCA.rojo };
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : n < 0 ? `−${formatMoney(Math.abs(n))}` : formatMoney(0));
const ESTADO = { PENDIENTE: ['Por confirmar', MARCA.ambar], CONFIRMADO: ['Confirmado', MARCA.verde], DESCARTADO: ['Descartado', MARCA.rojo] };

function Tarjeta({ c, sala, conSala }) {
  const sinConteo = noContoEfectivo(c);
  const dif = c.estado === 'DESCARTADO' ? diferenciaDelCorte(c).valor : c.tramo;
  const sev = severidad(dif);
  const [estado, color] = ESTADO[c.estado] ?? [c.estado, MARCA.azulClaro];
  const quien = c.hizo?.name ? shortEmployeeName({ name: c.hizo.name }) : (c.empleado_texto || 'Desde la caja');
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha: c.fecha } }); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
              {conSala ? `${sala} · ` : ''}{hora12(c.hora)}
            </Text>
            {c.tipo === 'Z' || c.tipo === 'X' ? (
              <Pildora texto={c.tipo === 'Z' ? 'Cierre (Z)' : 'Lectura (X)'} color={MARCA.violeta} />
            ) : sinConteo ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 17, fontWeight: '700' }}>Sin conteo</Text>
            ) : (
              <Text style={{ color: TONO[sev], fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{conSigno(dif ?? 0)}</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }} numberOfLines={1}>
              {quien}{c.recibe?.name ? ` → ${shortEmployeeName({ name: c.recibe.name })}` : ''}
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
  const [fecha, setFecha] = useState(hoySV());
  const [salaElegida, setSala] = useState('todas');
  const [vista, setVista] = useState('pendientes');
  const [filas, setFilas] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetchCortes({ desde: fecha, hasta: fecha }).catch(() => null);
    setFilas(conTramoPorSalaYDia(r || []));
  }, [fecha]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const nombre = (id) => (sucursales || []).find((b) => Number(b.id) === Number(id))?.name ?? `Sala ${id}`;
  const deMiAlcance = useMemo(() => (filas || []).filter((c) => (todas ? true : String(c.branch_id) === miSala)), [filas, todas, miSala]);
  const salas = useMemo(() => [...new Set(deMiAlcance.map((c) => String(c.branch_id)))].sort((a, b) => ordenDeSala(a) - ordenDeSala(b)), [deMiAlcance]);
  const visibles = deMiAlcance
    .filter((c) => salaElegida === 'todas' || String(c.branch_id) === salaElegida)
    .filter((c) => vista === 'todos' || (c.estado === 'PENDIENTE' && c.tipo === 'C'))
    .sort((a, b) => ordenDeSala(a.branch_id) - ordenDeSala(b.branch_id) || String(b.hora).localeCompare(String(a.hora)));
  const pendientes = deMiAlcance.filter((c) => c.estado === 'PENDIENTE' && c.tipo === 'C').length;

  const hoy = hoySV();
  const grupos = [
    { id: 'fecha', titulo: 'Día', activa: fecha, porDefecto: hoy, onCambiar: setFecha,
      opciones: [{ id: hoy, label: 'Hoy' }, { id: sumarDias(hoy, -1), label: 'Ayer' }, { id: sumarDias(hoy, -2), label: 'Antier' }] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((s) => ({ id: s, label: nombre(s) }))] }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cortes de caja', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'pendientes', label: pendientes ? `Por confirmar · ${pendientes}` : 'Por confirmar' }, { id: 'todos', label: 'Todos' }]} />
        {filas == null ? null : visibles.length ? visibles.map((c) => (
          <Tarjeta key={c.id} c={c} sala={nombre(c.branch_id)} conSala={todas && salaElegida === 'todas'} />
        )) : (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{vista === 'pendientes' ? 'Nada por confirmar' : 'Sin cortes este día'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Desliza hacia abajo para actualizar.</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}
