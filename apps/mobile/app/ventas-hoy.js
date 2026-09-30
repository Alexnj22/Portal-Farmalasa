// Ventas de hoy, nativa: la sala (o todas), la gráfica por hora que se
// recorre con el dedo, y los números que importan de un vistazo — total,
// tickets, ticket promedio, hora pico y cómo va contra ayer a esta misma hora.
// La abre la sección «Ventas de hoy» del Inicio.
//
// Los datos son los del tablero del portal (`branch_hourly_sales`, por
// `fetchTodayHourlySales`) y la cuenta, la del núcleo (`ventasPorSala`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchTodayHourlySales } from '@nucleo/data/dashboard';
import { hastaLaHora, sumarSalas, ventasPorSala } from '@nucleo/utils/inicio';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import GraficaHoras from '../componentes/GraficaHoras';
import Pestanas from '../componentes/inicio/Pestanas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/Secciones';

const leer = async (fecha) => {
  const { data, error } = await fetchTodayHourlySales(fecha);
  if (error) throw error;
  return ventasPorSala(data || []);
};

export default function VentasHoy() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const soloMiSala = getScope?.('dash_sales') !== 'ALL';
  const miSala = String(salaDelUsuario(user) ?? '');
  const [hoy, setHoy] = useState([]);
  const [ayer, setAyer] = useState([]);
  const [elegida, setElegida] = useState(soloMiSala ? miSala : 'todas');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const f = hoySV();
    const [a, b] = await Promise.all([leer(f).catch(() => []), leer(sumarDias(f, -1)).catch(() => [])]);
    setHoy(a); setAyer(b);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = soloMiSala ? hoy.filter((s) => s.branchId === miSala) : hoy;
  const nombre = (id) => (sucursales || []).find((b) => String(b.id) === id)?.name ?? `Sala ${id}`;
  const opciones = [
    ...(soloMiSala ? [] : [{ id: 'todas', label: 'Todas' }]),
    ...visibles.map((s) => ({ id: s.branchId, label: nombre(s.branchId) })),
  ];

  const s = useMemo(() => (elegida === 'todas' ? sumarSalas(visibles) : visibles.find((x) => x.branchId === elegida)) ?? sumarSalas([]),
    [elegida, visibles]);
  const sAyer = elegida === 'todas' ? sumarSalas(soloMiSala ? ayer.filter((x) => x.branchId === miSala) : ayer) : ayer.find((x) => x.branchId === elegida);

  // Contra ayer A ESTA HORA: comparar el día entero de ayer con medio día de
  // hoy siempre daría «abajo».
  const horaAhora = new Date().getHours();
  const hoyHasta = hastaLaHora(s, horaAhora);
  const ayerHasta = hastaLaHora(sAyer, horaAhora);
  const cambio = ayerHasta > 0 ? Math.round(((hoyHasta - ayerHasta) / ayerHasta) * 100) : null;
  const pico = s.porHora?.length ? s.porHora.indexOf(Math.max(...s.porHora)) : -1;
  const promedio = s.tickets ? s.total / s.tickets : 0;

  return (
    <>
      {/* Regresar sólo desde el borde: en iOS 26 se regresa deslizando desde
          cualquier parte, y eso le ganaba al dedo que recorre la gráfica. */}
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ventas de hoy', fullScreenGestureEnabled: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Pestanas opciones={opciones} activa={elegida} onCambiar={setElegida} />

        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={24}>
            <View style={{ padding: 16 }}>
              <GraficaHoras valores={s.porHora ?? []} color={MARCA.verde} alto={200}
                formato={(v) => formatMoney(v)}
                extra={(s.ticketsPorHora ?? []).map((t) => `${t} ticket${t === 1 ? '' : 's'}`)}
                resumen={(
                  <View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{elegida === 'todas' ? 'Todas las salas' : nombre(elegida)}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 30, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}>{formatMoney(s.total)}</Text>
                  </View>
                )} />
              <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: 8 }}>Desliza el dedo sobre la gráfica para ver cada hora</Text>
            </View>
          </Vidrio>
        </View>

        <FilaDeKpis>
          <Kpi icono="Receipt" rotulo="Tickets" valor={`${s.tickets}`} color={MARCA.azul} />
          <Kpi icono="Wallet" rotulo="Ticket promedio" valor={formatMoney(promedio)} color={MARCA.violeta} />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="Activity" rotulo="Hora pico" valor={pico >= 0 && s.total ? `${7 + pico}:00` : '—'} apoyo={pico >= 0 && s.total ? formatMoney(s.porHora[pico]) : null} color={MARCA.ambar} />
          <Kpi icono="TrendingUp" rotulo="Contra ayer" valor={cambio == null ? '—' : `${cambio > 0 ? '+' : ''}${cambio}%`} apoyo="a esta hora"
            color={cambio == null || cambio >= 0 ? MARCA.verde : MARCA.rojo} pide={cambio != null} />
        </FilaDeKpis>
      </ScrollView>
    </>
  );
}
