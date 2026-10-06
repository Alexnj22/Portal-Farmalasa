// El histórico de metas, NATIVO — `TabHistorico` + `GraficasHistorico` del
// portal: cada mes de cada sala con su meta, lo vendido, el cumplimiento y el
// tramo; arriba dos gráficas (cumplimiento por mes contra el 95% y el 100%, y
// la meta como listón sobre la venta de cada mes). Las gráficas leen las MISMAS
// filas ya filtradas (núcleo: `agruparHistoricoPorMes`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchMetasHistorico } from '@nucleo/data/metas';
import { TRAMO_CFG, agruparHistoricoPorMes, ymLabelCorto } from '@nucleo/utils/metasUtils';
import { formatMoney, formatMoneyCorto, formatPct } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Grafica from './Graficas';
import { COLOR_TRAMO } from './Mes';

const Titulo = ({ children }) => (
  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>{children}</Text>
);

export default function Historico({ sala, soloConMeta, salaNombre, salasVisibles }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try { setRows(await fetchMetasHistorico()); setError(null); }
    catch (e) { setError(mensajeAmigable(e, 'Error al cargar el histórico')); setRows([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => (rows || []).filter((r) => {
    if (salasVisibles && !salasVisibles.has(String(r.branch_id))) return false;
    if (sala && String(r.branch_id) !== String(sala)) return false;
    if (soloConMeta && r.monto_meta == null) return false;
    return true;
  }), [rows, sala, soloConMeta, salasVisibles]);
  const meses = useMemo(() => agruparHistoricoPorMes(filtradas), [filtradas]);

  if (rows == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const pcts = meses.map((m) => m.pct).filter((v) => v != null);
  const mejor = meses.length ? meses.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
  const peor = meses.length ? meses.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;

  return (
    <View style={{ gap: 10 }}>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {meses.length >= 2 ? (
        <>
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 14, gap: 8 }}>
                <Titulo>Cumplimiento por mes</Titulo>
                <Grafica alto={170}
                  datos={meses.map((m) => ({ etiqueta: m.mes, titulo: m.mes, pct: m.pct, meta: m.meta, venta: m.venta }))}
                  series={[{ clave: 'pct', rotulo: 'Cumplimiento', color: MARCA.azulClaro, tipo: 'linea' }]}
                  dominio={[Math.floor(Math.min(...pcts, 95) - 2), Math.ceil(Math.max(...pcts, 100) + 2)]}
                  referencias={[{ valor: 100, color: MARCA.verde, rotulo: 'completa' }, { valor: 95, color: MARCA.ambar, rotulo: '95%' }]}
                  formato={(v) => formatPct(v)} formatoEje={(v) => `${Math.round(v)}%`}
                  detalle={(f) => `Meta ${formatMoney(f.meta)} · vendido ${formatMoney(f.venta)}`}
                  resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${meses.length} meses · el más alto ${mejor.mes} ${formatPct(mejor.pct)} · el más bajo ${peor.mes} ${formatPct(peor.pct)}`}</Text>} />
                <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>El eje arranca cerca del 95%, no en cero: son porcentajes alrededor del 100.</Text>
              </View>
            </Vidrio>
          </View>
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 14, gap: 8 }}>
                <Titulo>Meta y venta</Titulo>
                <Grafica alto={170}
                  datos={meses.map((m) => ({ etiqueta: m.mes, titulo: m.mes, venta: m.venta, meta: m.meta }))}
                  series={[{ clave: 'venta', rotulo: 'Vendido', color: MARCA.azulClaro, tipo: 'barra' }, { clave: 'meta', rotulo: 'Meta', color: '#8E8E93', tipo: 'marca' }]}
                  formato={(v) => formatMoney(v)} formatoEje={(v) => (v ? formatMoneyCorto(v) : '0')}
                  detalle={(f) => (f.venta >= f.meta ? `${formatMoney(f.venta - f.meta)} por encima` : `${formatMoney(f.meta - f.venta)} por debajo`)}
                  resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Lo más lejos ${peor.mes}, ${formatMoney(peor.meta - peor.venta)} por debajo${mejor.venta > mejor.meta ? ` · lo más alto ${mejor.mes}, ${formatMoney(mejor.venta - mejor.meta)} por encima` : ''}`}</Text>} />
              </View>
            </Vidrio>
          </View>
        </>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${filtradas.length} mes${filtradas.length === 1 ? '' : 'es'} de sala`}</Text>
      {filtradas.map((r) => {
        const tramo = TRAMO_CFG[r.bono_tier];
        const color = COLOR_TRAMO[r.bono_tier] ?? colorSistema.texto2;
        return (
          <View key={`${r.year_month}-${r.branch_id}`} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${salaNombre(r.branch_id)} · ${ymLabelCorto(r.year_month)}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {r.monto_meta != null ? `Meta ${formatMoney(r.monto_meta)} · vendido ${formatMoney(r.venta_total)}` : `Vendido ${formatMoney(r.venta_total)}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {r.monto_meta != null ? (
                    <>
                      <Text style={{ color, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatPct(r.pct_cumplimiento)}</Text>
                      {tramo ? <Pildora texto={tramo.label} color={color} /> : null}
                    </>
                  ) : <Pildora texto="Sin meta" color={colorSistema.texto2} />}
                </View>
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!filtradas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 30 }}>Sin meses con ese filtro</Text>
      ) : null}
    </View>
  );
}
