// Actualización de datos, NATIVO — `SyncHealthView`: arriba, cada dato que se
// actualiza solo (productos, Min/Max, compras, respaldo) con su última corrida
// y, si falló, desde cuándo no tiene una buena; abajo, las corridas recientes
// con su alcance y el detalle del error. Se refresca sola cada 30 segundos.
//
// Rótulos, alcance y el estado por dominio salen del núcleo (`data/syncHealth`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { alcanceDeCorrida, estadoPorDominio, fetchSyncHealthRecent, ROTULO_DE_DOMINIO, SYNC_HEALTH_DOMAINS } from '@nucleo/data/syncHealth';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { fechaHora12 } from '@nucleo/utils/hora';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const TOPE = 60;

export default function ActualizacionDeDatos() {
  const sucursales = useStaffStore((s) => s.branches);
  const [filas, setFilas] = useState(null);
  const [dominio, setDominio] = useState('todos');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await fetchSyncHealthRecent();
    setFilas(data || []);
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 30_000); return () => clearInterval(t); }, [cargar]);

  const nombreDeSala = useMemo(() => Object.fromEntries((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const estados = useMemo(() => estadoPorDominio(filas), [filas]);
  const visibles = (filas || []).filter((r) => dominio === 'todos' || r.domain === dominio);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Actualización de datos', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {estados.map((e) => {
                const ok = e.ultima?.success;
                return (
                  <View key={e.dominio} style={{ width: '48%' }}>
                    <Vidrio radio={18} tinte={e.ultima && !ok ? 'rgba(240,68,56,0.14)' : undefined}>
                      <View style={{ padding: 12, gap: 4 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{ROTULO_DE_DOMINIO[e.dominio]}</Text>
                        {e.ultima ? <Pildora texto={ok ? 'Al día' : 'Falló'} color={ok ? MARCA.verde : MARCA.rojo} /> : <Pildora texto="Sin datos" color={colorSistema.texto2} />}
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{e.ultima ? fechaHora12(e.ultima.checked_at) : '—'}</Text>
                        {e.ultima && !ok ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{e.ultimaBuena ? `Última buena: ${fechaHora12(e.ultimaBuena.checked_at)}` : 'Sin una corrida buena reciente'}</Text> : null}
                      </View>
                    </Vidrio>
                  </View>
                );
              })}
            </View>
            <Segmentos activa={dominio} onCambiar={setDominio} opciones={[{ id: 'todos', label: 'Todos' }, ...SYNC_HEALTH_DOMAINS.map((d) => ({ id: d, label: ROTULO_DE_DOMINIO[d] }))]} />
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 12, gap: 10 }}>
                  {visibles.slice(0, TOPE).map((r, i) => (
                    <View key={`${r.domain}-${r.checked_at}-${i}`} style={{ gap: 2, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${ROTULO_DE_DOMINIO[r.domain] ?? r.domain} · ${alcanceDeCorrida(r, nombreDeSala, ERP_NAMES)}`}</Text>
                        <Pildora texto={r.success ? 'OK' : 'Falló'} color={r.success ? MARCA.verde : MARCA.rojo} />
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(r.checked_at)}</Text>
                      {r.error_msg ? <Text style={{ color: MARCA.rojo, fontSize: 12 }} numberOfLines={3}>{r.error_msg}</Text> : null}
                    </View>
                  ))}
                  {!visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin actualizaciones registradas.</Text> : null}
                  {visibles.length > TOPE ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Se muestran las ${TOPE} más recientes de ${visibles.length}.`}</Text> : null}
                </View>
              </Vidrio>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
