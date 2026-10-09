// Los depósitos al banco, NATIVO — `DepositosAlBanco` del circuito de bolsas:
// cada cierre del efectivo con su cuenta (contado, lo que entró de afuera, al
// banco, en mano, remanente), sus días y sus bolsas. Tocar uno abre su detalle,
// donde se anexa la boleta del banco y se corrige el cierre.
//
// La sección entera va detrás de `bolsas_ver_montos`, como en el portal: un
// depósito sin sus montos no contesta ninguna de las preguntas por las que
// existe (cuadrar contra el estado de cuenta, seguir el remanente).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchDepositos } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { rangoDeDiasDelDeposito } from '@nucleo/utils/depositoDeEfectivo';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { recordarDeposito } from '../componentes/caja/depositoElegido';

const RANGOS = [{ id: '30', label: '30 días' }, { id: '90', label: '90 días' }, { id: 'todo', label: 'Todo' }];
const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');

export default function DepositosBanco() {
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('bolsas_ver_montos');
  const [rango, setRango] = useState('30');
  const [lista, setLista] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const desde = rango === 'todo' ? null : sumarDias(hoySV(), -Number(rango));
    const filas = await Promise.resolve(fetchDepositos({ desde, hasta: null })).catch(() => []);
    setLista(filas || []);
  }, [rango]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  if (!verMontos) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Depósitos' }} />
      <View style={{ padding: 20 }}><Aviso tono="freno" texto="Los depósitos se ven con el permiso de ver los montos de las bolsas." /></View></>);
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Depósitos', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos opciones={RANGOS} activa={rango} onCambiar={(v) => { setLista(null); setRango(v); }} />
        <View style={{ marginHorizontal: 16, gap: 10 }}>
          {lista == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : !lista.length ? (
            <Aviso texto="Sin depósitos en estas fechas." />
          ) : lista.map((d) => {
            const anulado = !!d.anulado_at;
            return (
              <Pressable key={d.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); recordarDeposito(d); router.push({ pathname: '/deposito/[id]', params: { id: String(d.id) } }); }}>
                {({ pressed }) => (
                  <Vidrio radio={18} interactivo>
                    <View style={{ padding: 14, gap: 6, opacity: anulado ? 0.55 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{d.folio}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.monto_deposito)}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {[corta(d.fecha), `días ${rangoDeDiasDelDeposito(d, corta)}`, `${d.cuantas} ${Number(d.cuantas) === 1 ? 'bolsa' : 'bolsas'}`, d.banco || d.entregado_a].filter(Boolean).join(' · ')}
                      </Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                        {`Contado ${formatMoney(d.total_contado)}${Number(d.monto_efectivo) > 0 ? ` · en mano ${formatMoney(d.monto_efectivo)}` : ''} · remanente ${formatMoney(d.remanente)}`}
                      </Text>
                      {anulado ? <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Corregido</Text>
                        : Number(d.monto_deposito) > 0 && !d.comprobante_url && d.destino !== 'ANTERIOR'
                          ? <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>Falta la boleta del banco</Text> : null}
                    </View>
                  </Vidrio>
                )}
              </Pressable>
            );
          })}
          {lista?.length ? <BotonGrande texto="Finalizar el efectivo" borde onPress={() => router.push('/finalizar-efectivo')} /> : null}
        </View>
      </ScrollView>
    </>
  );
}
