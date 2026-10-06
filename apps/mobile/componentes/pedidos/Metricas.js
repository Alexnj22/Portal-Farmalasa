// Los tiempos del despacho, NATIVO — `TabMetricas` del portal: en 7, 30 o 90
// días, cuánto tarda en promedio cada etapa (preparación neta, pausa, tránsito,
// recuento), por sucursal, y por qué se pausan los pedidos.
//
// Los promedios salen del núcleo (`indicadoresDePedidos`), los mismos de allá.
// La gráfica pinta, por sucursal, una barra apilada de minutos: dónde se va el
// tiempo de un pedido se lee de un vistazo, que es lo que una tabla de siete
// columnas no deja ver en un teléfono.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchIndicadoresDePedidos, fetchRazonesDePausa } from '@nucleo/data/pedidos';
import { indicadoresDePedidos, minutosLegibles } from '@nucleo/utils/tableroDePedidos';
import { ERP_NAMES } from '@nucleo/constants/erp';
import Segmentos from '../Segmentos';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { Aviso } from '../formulario/Piezas';
import { FONDO } from '../avisos/Piezas';
import Vidrio from '../Vidrio';

const RANGOS = [{ id: '7', label: '7 días' }, { id: '30', label: '30 días' }, { id: '90', label: '90 días' }];
const TRAMOS = [
  { k: 'prep', rotulo: 'Preparación', color: MARCA.azulClaro },
  { k: 'pausado', rotulo: 'Pausa', color: MARCA.ambar },
  { k: 'transito', rotulo: 'Tránsito', color: MARCA.violetaClaro },
  { k: 'recuento', rotulo: 'Recuento', color: MARCA.verde },
];
const dia = (d) => d.toISOString().slice(0, 10);

function Tarjeta({ titulo, children }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 14, gap: 12 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{titulo}</Text>
          {children}
        </View>
      </Vidrio>
    </View>
  );
}

export default function Metricas() {
  const [rango, setRango] = useState('30');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async (dias) => {
    setDatos(null);
    const desde = new Date(); desde.setDate(desde.getDate() - dias);
    const [k, r] = await Promise.all([
      fetchIndicadoresDePedidos({ p_desde: dia(desde), p_hasta: dia(new Date()) }),
      fetchRazonesDePausa({ p_desde: dia(desde), p_hasta: dia(new Date()) }),
    ]);
    if (k.error || r.error) { setError('No se pudieron cargar los tiempos.'); setDatos({ ind: indicadoresDePedidos([]), razones: [] }); return; }
    setError(null);
    setDatos({ ind: indicadoresDePedidos(k.data, (id) => ERP_NAMES[id] ?? `Suc. ${id}`), razones: r.data ?? [] });
  }, []);
  useEffect(() => { cargar(Number(rango)); }, [rango, cargar]);

  const ind = datos?.ind;
  const maximo = ind ? Math.max(1, ...ind.porSucursal.map((s) => TRAMOS.reduce((t, x) => t + (s[x.k] ?? 0), 0))) : 1;

  return (
    <View style={{ gap: 12 }}>
      <Segmentos activa={rango} onCambiar={setRango} opciones={RANGOS} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!datos ? <ActivityIndicator style={{ marginTop: 20 }} /> : !ind.pedidos ? (
        <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30, fontSize: 15 }}>Sin tiempos registrados en este rango.</Text>
      ) : (
        <>
          <View style={{ gap: 12 }}>
            <FilaDeKpis>
              <Kpi icono="BarChart2" rotulo="Con datos" valor={String(ind.pedidos)} apoyo="pedidos" color={MARCA.azulClaro} />
              <Kpi icono="Clock" rotulo="Preparación" valor={minutosLegibles(ind.prep)} apoyo="neta, sin pausas" color={MARCA.azulClaro} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Truck" rotulo="Tránsito" valor={minutosLegibles(ind.transito)} apoyo="promedio" color={MARCA.violetaClaro} />
              <Kpi icono="ClipboardCheck" rotulo="Recuento" valor={minutosLegibles(ind.recuento)} apoyo="promedio" color={MARCA.verde} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Hourglass" rotulo="Pausa" valor={minutosLegibles(ind.pausado)} apoyo={`${ind.pausas} pausa${ind.pausas === 1 ? '' : 's'} en total`} color={MARCA.ambar} />
              <View style={{ flex: 1 }} />
            </FilaDeKpis>
          </View>

          <Tarjeta titulo="Dónde se va el tiempo, por sucursal">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }}>
              {TRAMOS.map((t) => (
                <View key={t.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: t.color }} />
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{t.rotulo}</Text>
                </View>
              ))}
            </View>
            {ind.porSucursal.map((s) => {
              const total = TRAMOS.reduce((t, x) => t + (s[x.k] ?? 0), 0);
              return (
                <View key={s.id} style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{s.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${s.pedidos} pedido${s.pedidos === 1 ? '' : 's'}${s.pausas ? ` · ${s.pausas} pausa${s.pausas === 1 ? '' : 's'}` : ''}`}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{minutosLegibles(total)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, backgroundColor: FONDO, overflow: 'hidden' }}>
                    {TRAMOS.map((t) => (s[t.k] ? <View key={t.k} style={{ width: `${(s[t.k] / maximo) * 100}%`, backgroundColor: t.color }} /> : null))}
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {TRAMOS.map((t) => `${t.rotulo} ${minutosLegibles(s[t.k])}`).join(' · ')}
                  </Text>
                </View>
              );
            })}
          </Tarjeta>

          {datos.razones.length ? (
            <Tarjeta titulo="Por qué se pausan">
              {datos.razones.map((r) => (
                <View key={r.razon} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, textTransform: 'capitalize' }}>{r.razon}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{r.conteo}</Text>
                    {r.min_promedio != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`~${minutosLegibles(r.min_promedio)}`}</Text> : null}
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: FONDO, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.min(100, (r.conteo / datos.razones[0].conteo) * 100)}%`, height: 7, borderRadius: 4, backgroundColor: MARCA.ambar }} />
                  </View>
                </View>
              ))}
            </Tarjeta>
          ) : null}
        </>
      )}
    </View>
  );
}
