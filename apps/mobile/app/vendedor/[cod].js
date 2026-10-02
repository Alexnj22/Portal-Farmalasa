// Las ventas de un vendedor día por día, NATIVO — lo que el portal muestra al
// expandir a alguien en la pestaña Vendedores: cuánto vendió y cuántas
// facturas cada día del período, y en ámbar los días que vendió en OTRA sala
// que la suya, con cuánto en cada una. El agrupado sale del núcleo
// (`ventasDiariasDelVendedor`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchVendedorPorDia } from '@nucleo/data/ventas';
import { ventasDiariasDelVendedor } from '@nucleo/utils/ventasPeriodo';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';

const conMayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export default function Vendedor() {
  const { cod, fini, ffin, nombre, sala } = useLocalSearchParams();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const emp = useMemo(() => (empleados || []).find((e) => e.code === cod), [empleados, cod]);
  const nombreDeSala = (id) => (sucursales || []).find((b) => Number(b.id) === Number(id))?.name ?? `Sala ${id}`;
  const [dias, setDias] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchVendedorPorDia({ p_cod_vendedor: cod, p_fini: fini, p_ffin: ffin });
    if (e) { setError('No se pudieron cargar sus ventas.'); setDias([]); return; }
    setError(null);
    setDias(ventasDiariasDelVendedor(data).sort((a, b) => b.fecha.localeCompare(a.fecha)));
  }, [cod, fini, ffin]);
  useEffect(() => { cargar(); }, [cargar]);

  const total = (dias || []).reduce((s, d) => s + d.total, 0);
  const facturas = (dias || []).reduce((s, d) => s + d.count, 0);
  const rango = fini === ffin ? fechaTexto(fini, { day: 'numeric', month: 'long' })
    : `${fechaTexto(fini, { day: 'numeric', month: 'short' })} – ${fechaTexto(ffin, { day: 'numeric', month: 'short' })}`;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Ventas por día' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 20 }}>
          <Avatar empleado={emp ?? { name: nombre }} tamano={56} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[sala ? nombreDeSala(sala) : null, rango].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
        {dias ? (
          <FilaDeKpis>
            <Kpi icono="TrendingUp" rotulo="Vendió" valor={formatMoney(total, { decimales: 0 })} color={MARCA.verde}
              apoyo={dias.length ? `${formatMoney(total / dias.length, { decimales: 0 })} por día` : null} />
            <Kpi icono="Receipt" rotulo="Facturas" valor={facturas.toLocaleString('es-SV')} color={MARCA.azul}
              apoyo={facturas ? `ticket ${formatMoney(total / facturas)}` : null} />
          </FilaDeKpis>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {(dias || []).map((d) => {
          const fuera = d.branches.filter((b) => sala && Number(b.branch_id) !== Number(sala));
          return (
            <View key={d.fecha} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} tinte={fuera.length ? 'rgba(247,144,9,0.14)' : undefined}>
                <View style={{ padding: 14, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>
                      {conMayuscula(fechaTexto(d.fecha, { weekday: 'short', day: 'numeric', month: 'short' }))}
                    </Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.total)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${d.count} factura${d.count === 1 ? '' : 's'}`}</Text>
                  {fuera.map((b) => (
                    <Text key={b.branch_id} style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`En ${nombreDeSala(b.branch_id)}: ${formatMoney(b.total)}`}</Text>
                  ))}
                </View>
              </Vidrio>
            </View>
          );
        })}
        {dias && !dias.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin ventas en este período</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
