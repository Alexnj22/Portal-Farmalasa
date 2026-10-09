// La vista «Vendedores» de Ventas en la app — la pestaña del mismo nombre del
// portal: el ranking del período (cuánto vendió cada quien, cuántas facturas y
// su ticket), con la flecha de cuántos puestos subió o bajó contra el mes
// anterior, y aparte lo que se facturó con un código que no es de nadie.
// La consolidación y los puestos salen del núcleo (`ventasPeriodo`), igual que
// en el portal. Tocar a alguien abre sus ventas día por día.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchResumenDeVendedores, fetchResumenDeVentas, fetchVendorMonthlyStats } from '@nucleo/data/ventas';
import { diasDelRango, horaDeCorte, mesAnteriorDe, montoPrivado, periodoAnterior, puestosDelMesAnterior, rankingDeVendedores, variacionPorDia } from '@nucleo/utils/ventasPeriodo';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';

const conSigno = (pct) => (pct == null ? null : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% por día`);
export const nombreDeVendedor = (v) => v.especial || (v.emp ? shortEmployeeName(v.emp) : v.cod_vendedor);

function Movimiento({ antes, ahora }) {
  if (antes == null) return null;
  const d = antes - ahora;
  if (!d) return <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>=</Text>;
  return <Text style={{ color: d > 0 ? MARCA.verde : MARCA.rojo, fontSize: 12, fontWeight: '800' }}>{`${d > 0 ? '▲' : '▼'}${Math.abs(d)}`}</Text>;
}

export default function Vendedores({ fini, ffin, sala, busqueda, verCifras, privado = false }) {
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const porCodigo = useMemo(() => new Map((empleados || []).map((e) => [e.code, e])), [empleados]);
  const nombreDeSala = useCallback((id) => (sucursales || []).find((b) => Number(b.id) === Number(id))?.name ?? `Sala ${id}`, [sucursales]);
  const [filas, setFilas] = useState(null);
  const [previo, setPrevio] = useState(null);
  const [puestos, setPuestos] = useState(new Map());
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    const branch = sala ? Number(sala) : null;
    const { prevFini, prevFfin } = periodoAnterior(fini, ffin);
    Promise.all([
      fetchResumenDeVendedores({ p_fini: fini, p_ffin: ffin, p_branch_id: branch }),
      fetchResumenDeVentas({ p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branch, p_hora_corte: horaDeCorte(ffin) }),
      fetchVendorMonthlyStats(mesAnteriorDe(fini), branch ?? -1),
    ]).then(([act, ant, mes]) => {
      if (!vivo) return;
      if (act.error) throw act.error;
      setError(null);
      setFilas(act.data || []);
      const p = ant.data?.[0] || {};
      setPrevio({ total: +p.total_sum || 0, facturas: +p.total_count || 0, dias: diasDelRango(prevFini, prevFfin) });
      setPuestos(puestosDelMesAnterior(mes.data));
    }).catch(() => { if (vivo) { setError('No se pudo cargar el ranking.'); setFilas([]); } });
    return () => { vivo = false; };
  }, [fini, ffin, sala]);

  const ranking = useMemo(() => rankingDeVendedores(filas, porCodigo), [filas, porCodigo]);
  const lista = useMemo(() => (busqueda
    ? smartFilter(busqueda, ranking.conocidos, (v) => [v.especial || v.emp?.name || '', v.cod_vendedor]).results
    : ranking.conocidos), [busqueda, ranking]);

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const dias = diasDelRango(fini, ffin);

  return (
    <>
      {verCifras ? (
        <FilaDeKpis>
          <Kpi icono="TrendingUp" rotulo="Total" valor={montoPrivado(formatMoney(ranking.total, { decimales: 0 }), privado)} color={MARCA.verde}
            apoyo={previo ? conSigno(variacionPorDia(ranking.total, dias, previo.total, previo.dias)) : null} />
          <Kpi icono="Users" rotulo="Vendedores" valor={String(ranking.conocidos.length)} color={MARCA.azul}
            apoyo={`${ranking.facturas.toLocaleString('es-SV')} facturas`} />
        </FilaDeKpis>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {lista.map((v) => {
        const puesto = ranking.conocidos.indexOf(v) + 1;
        const parte = ranking.total > 0 ? v.total / ranking.total : 0;
        const base = v.emp?.branch_id ?? v.branchIds[0];
        const otras = v.branchIds.filter((id) => id !== base);
        return (
          <Pressable key={v.cod_vendedor}
            onPress={() => { if (privado) return; Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/vendedor/[cod]', params: { cod: v.cod_vendedor, fini, ffin, nombre: nombreDeVendedor(v), sala: base ?? '' } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo>
              <View style={{ padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <Text style={{ color: puesto <= 3 ? MARCA.ambar : colorSistema.texto2, fontSize: 17, fontWeight: '800' }}>{puesto}</Text>
                    <Movimiento antes={puestos.get(v.cod_vendedor)} ahora={puesto} />
                  </View>
                  <Avatar empleado={v.emp ?? { name: v.especial }} tamano={42} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{nombreDeVendedor(v)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                      {[nombreDeSala(base), otras.length ? `+${otras.length} sala${otras.length > 1 ? 's' : ''}` : null, `${v.count} fact.`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: MARCA.verde, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{montoPrivado(formatMoney(v.total, { decimales: 0 }), privado)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`ticket ${montoPrivado(formatMoney(v.count ? v.total / v.count : 0), privado)}`}</Text>
                  </View>
                </View>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(parte * 1000) / 10}%`, height: 4, backgroundColor: MARCA.azulClaro }} />
                </View>
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {!busqueda && ranking.sinFicha.map((u) => (
        <View key={`u-${u.branch_id}`} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={20} tinte="rgba(247,144,9,0.14)">
            <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '700' }}>{`Código sin ficha · ${nombreDeSala(u.branch_id)}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${u.count} fact. con un vendedor que no existe`}</Text>
              </View>
              <Text style={{ color: MARCA.ambar, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{montoPrivado(formatMoney(u.total, { decimales: 0 }), privado)}</Text>
            </View>
          </Vidrio>
        </View>
      ))}
      {!lista.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Nadie con ese nombre' : 'Sin ventas en este período'}
        </Text>
      ) : null}
    </>
  );
}
