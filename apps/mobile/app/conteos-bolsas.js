// Los conteos de bolsas por tanda, NATIVO — `ConteosDeBolsas` del circuito:
// qué tandas se firmaron, con qué cuadre (debía haber, contado, justificado,
// sin resolver) y quién las contó. Tocar una tanda la abre por sala, con cada
// bolsa y su diferencia. Sólo lectura, detrás de `bolsas_ver_montos` como en el
// portal: «CNT-260826-1 · 43 bolsas» sin montos no contesta nada.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchConteos } from '@nucleo/data/bolsas';
import { rangoDeDiasDelDeposito, totalesDeConteos } from '@nucleo/utils/depositoDeEfectivo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useMasAlFinal } from '../componentes/ListaPaginada';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const RANGOS = [{ id: '30', label: '30 días' }, { id: '90', label: '90 días' }, { id: 'todo', label: 'Todo' }];
// «Todo» crece con cada tanda: se pinta de a 30.
const POR_PAGINA = 30;
const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');
const nombre = (p) => { const n = p?.name ?? p?.nombre; return n ? shortEmployeeName({ ...p, name: n }) : null; };

function Tanda({ c }) {
  const [abierta, setAbierta] = useState(false);
  const pendiente = Number(c.pendiente ?? c.diferencia ?? 0);
  const quienes = (c.contaron || []).map(nombre).filter(Boolean);
  return (
    <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta((a) => !a); }}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{c.folio}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(c.total_contado)}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[c.cerrado_at ? fechaHora12(c.cerrado_at) : corta(c.fecha), `días ${rangoDeDiasDelDeposito(c, corta)}`, `${c.cuantas} ${Number(c.cuantas) === 1 ? 'bolsa' : 'bolsas'}`].join(' · ')}
          </Text>
          <Text style={{ color: Math.abs(pendiente) >= 0.01 ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '600' }}>
            {Number(c.descuadradas) ? `${c.descuadradas} sin cuadrar · ${c.resueltas || 0} resueltas · sin resolver ${formatMoney(pendiente)}` : 'Cuadró'}
          </Text>
          {abierta ? (
            <View style={{ gap: 12, marginTop: 6 }}>
              <View>
                <Dato primero rotulo="Debía haber" valor={formatMoney(c.total_esperado)} />
                <Dato rotulo="Contado" valor={formatMoney(c.total_contado)} />
                <Dato rotulo="Justificado" valor={formatMoney(c.justificado)} />
                <Dato rotulo="Sin resolver" valor={formatMoney(pendiente)} fuerte />
                <Dato rotulo={quienes.length === 1 ? 'La contó' : 'La contaron'} valor={quienes.join(', ') || '—'} />
                <Dato rotulo="La cerró" valor={nombre({ name: c.cerrado_por }) || '—'} />
              </View>
              {(c.por_sala || []).map((s) => (
                <View key={s.branch_id} style={{ gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                    {`${s.sala} · ${s.cuantas} ${Number(s.cuantas) === 1 ? 'bolsa' : 'bolsas'} · ${formatMoney(s.contado)}`}
                  </Text>
                  {(s.bolsas || []).map((b, i) => {
                    const dif = Math.round((Number(b.contado || 0) - Number(b.esperado || 0)) * 100) / 100;
                    return (
                      <View key={b.id} style={{ paddingTop: i ? 6 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{`${b.folio} · ${corta(b.fecha)} ${b.hora ? hora12(b.hora) : ''}`}</Text>
                          <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>{formatMoney(b.contado)}</Text>
                        </View>
                        {Math.abs(dif) >= 0.01 ? (
                          <Text style={{ color: MARCA.ambar, fontSize: 12 }}>
                            {`${dif > 0 ? 'Sobró' : 'Faltó'} ${formatMoney(Math.abs(dif))}${b.dif_causa ? ` · ${b.dif_causa}` : ''}${b.dif_por ? ` · ${b.dif_por}` : ''}`}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function ConteosBolsas() {
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('bolsas_ver_montos');
  const [rango, setRango] = useState('30');
  const [lista, setLista] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const totales = useMemo(() => totalesDeConteos(lista), [lista]);
  // La página siguiente se pinta sola al acercarse al final (el botón queda de respaldo).
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  const cargar = useCallback(async () => {
    const desde = rango === 'todo' ? null : sumarDias(hoySV(), -Number(rango));
    setLista((await Promise.resolve(fetchConteos({ desde, hasta: null })).catch(() => [])) || []);
  }, [rango]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  if (!verMontos) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Conteos' }} />
      <View style={{ padding: 20 }}><Aviso tono="freno" texto="Los conteos se ven con el permiso de ver los montos de las bolsas." /></View></>);
  }
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Conteos', headerLargeTitle: true }} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos opciones={RANGOS} activa={rango} onCambiar={(v) => { setLista(null); setCuantos(POR_PAGINA); setRango(v); }} />
        <View style={{ marginHorizontal: 16, gap: 10 }}>
          {lista == null ? <ActivityIndicator style={{ marginTop: 30 }} />
            : !lista.length ? <Aviso texto="Sin conteos en estas fechas." />
              : (<>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4, fontVariant: ['tabular-nums'] }}>
                  {`${lista.length} ${lista.length === 1 ? 'conteo' : 'conteos'} · ${formatMoney(totales.contado)} contado${totales.abiertas ? ` · ${totales.abiertas} sin resolver` : ''}`}
                </Text>
                {lista.slice(0, cuantos).map((c) => <Tanda key={c.id} c={c} />)}
                {lista.length > cuantos ? <BotonGrande borde texto={`Ver ${Math.min(POR_PAGINA, lista.length - cuantos)} más · quedan ${lista.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} /> : null}
              </>)}
        </View>
      </ScrollView>
    </>
  );
}
