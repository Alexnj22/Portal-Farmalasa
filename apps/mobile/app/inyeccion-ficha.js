// Ponerle la ficha a una aplicación que se cobró sin ella, NATIVO —
// `AsignarFichaModal` del portal (2026-10-17, «que salgan» en la app del
// cliente). La app de puntos muestra las inyecciones por ficha, así que una
// cobrada sólo con el nombre escrito no la veía nadie.
//
// La ficha la elige una persona —nunca se adivina por el nombre escrito, que
// sale de cómo se tecleó—. Se asignan también las demás aplicaciones del mismo
// cobro sin ficha: un cobro es un cliente. Lo hace `inyeccion_asignar_ficha`,
// la misma función del portal; queda en la bitácora.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { asignarFichaAAplicacion } from '@nucleo/data/inyecciones';
import { buscarClientes } from '@nucleo/data/customers';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

export default function InyeccionFicha() {
  const fila = useMemo(() => leer('inyeccion-ficha'), []);
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 300);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [ficha, setFicha] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (ficha || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
    setBuscando(true);
    Promise.resolve(buscarClientes(q, { select: 'id, name, dui, phone', limite: 6 }))
      .then(({ data }) => { if (vivo) setResultados(data ?? []); })
      .catch(() => { if (vivo) setResultados([]); })
      .finally(() => { if (vivo) setBuscando(false); });
    return () => { vivo = false; };
  }, [q, ficha]);

  const asignar = () => Alert.alert('Asignar a un cliente', `La aplicación queda en el historial de ${ficha.name} y la ve en su app. También las demás del mismo cobro sin ficha.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Asignar', onPress: async () => {
      if (enviando) return;
      setEnviando(true); trabajando('Asignando…');
      try {
        const n = await asignarFichaAAplicacion({ aplicacionId: fila.id, customerId: ficha.id });
        useStaffStore.getState().appendAuditLog('INYECCION_FICHA_ASIGNADA', String(fila.id), { cobro: fila.cobro_id, ficha: ficha.id, aplicaciones: n, desde: 'app' });
        listo('Cliente asignado', n === 1 ? 'Ya la ve en su app.' : `${n} aplicaciones; ya las ve en su app.`);
        volver('/inyecciones');
      } catch (e) { fallo('No se pudo asignar', mensajeAmigable(e)); }
      setEnviando(false);
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Asignar a un cliente', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {!fila ? <Aviso tono="freno" texto="Vuelve a la Bitácora y elige la aplicación otra vez." /> : (
          <>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{fila.producto}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Cobrada a nombre de «${fila.cliente || 'sin nombre'}»`}</Text>
            {ficha ? (
              <Seccion titulo="Queda en el historial de">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{ficha.name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[ficha.dui, ficha.phone].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
                  </View>
                  <Pressable onPress={() => { setFicha(null); setTexto(''); }} hitSlop={8} accessibilityRole="button" style={{ minHeight: 40, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cambiar</Text>
                  </Pressable>
                </View>
              </Seccion>
            ) : (
              <Seccion titulo="Cliente" pie="Con su ficha, la aplicación queda en su historial y la ve en su app.">
                <Campo multiline={false} autoFocus value={texto} onChangeText={setTexto} placeholder="Nombre, DUI o teléfono" accessibilityLabel="Buscar la ficha del cliente" />
                {buscando ? <ActivityIndicator /> : null}
                {!buscando && q.trim().length >= 3 && !resultados.length ? <Aviso texto="Ninguna ficha coincide." /> : null}
                {resultados.map((c, i) => (
                  <Pressable key={c.id} accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); setFicha(c); }}
                    style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[c.dui, c.phone].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
                  </Pressable>
                ))}
              </Seccion>
            )}
            <BotonGrande texto={enviando ? 'Asignando…' : 'Asignar'} color={MARCA.azul} deshabilitado={!ficha || enviando} onPress={asignar} />
          </>
        )}
      </ScrollView>
    </>
  );
}
