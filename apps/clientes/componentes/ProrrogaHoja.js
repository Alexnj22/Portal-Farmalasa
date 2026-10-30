// Pedir una prórroga para retirar (2026-10-30, reglamento de reservas v2,
// cláusula 6.4). El plazo no se alarga solo: el cliente pide los días que
// necesita y dice por qué, y la Empresa la autoriza (una vez) o no. Mientras
// la revisa, la reserva sigue separada — eso lo sostiene la base, no la app.
//
// La acción es `pedir_prorroga` de `app-clientes`; la base valida que sea del
// cliente, que esté lista y que no tenga ya una prórroga.
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colorSistema } from './sistema';
import { Boton, Seccion } from './ui';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import { fecha } from '../lib/formato';

const OPCIONES = [7, 15, 30];

/** `tipo`: 'reserva' | 'encargo'; `ids`: los renglones que se prorrogan juntos; `vence`: hasta cuándo puede retirar hoy. */
export default function ProrrogaHoja({ tipo, ids, titulo, vence, alCerrar, alPedir }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [dias, setDias] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const n = Number(dias);
  const diasOk = Number.isInteger(n) && n >= 1 && n <= 365;
  const valido = diasOk && motivo.trim().length >= 3;
  const quedaria = diasOk && vence ? new Date(new Date(vence).getTime() + n * 86400000).toISOString() : null;

  const enviar = async () => {
    if (enviando || !valido) return;
    setEnviando(true); setError(null);
    const r = await pedir('pedir_prorroga', { tipo, ids, dias: n, motivo: motivo.trim() });
    setEnviando(false);
    if (!r?.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    alPedir?.(r);
  };

  const campo = { minHeight: 52, borderRadius: 16, paddingHorizontal: 14, fontSize: 16, color: colorSistema.texto, backgroundColor: superficie };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: fondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>Pedir más tiempo</Text>
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cancelar</Text>
          </Presionable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{titulo}</Text>
            {vence ? <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Hoy puedes retirarla hasta el {fecha(vence)}.</Text> : null}
            <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto3, marginTop: 4 }}>
              La prórroga se pide una sola vez. La revisamos y te avisamos lo que decidamos; mientras tanto, tu {tipo === 'encargo' ? 'encargo sigue' : 'reserva sigue'} separada.
            </Text>
          </View>

          <Seccion>¿Cuántos días más necesitas?</Seccion>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {OPCIONES.map((o) => {
              const activo = n === o;
              return (
                <Presionable key={o} onPress={() => { Haptics.selectionAsync().catch(() => {}); setDias(String(o)); }}
                  accessibilityRole="radio" accessibilityState={{ selected: activo }}
                  style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: activo ? t.color.magenta : superficie, opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: activo ? '#FFFFFF' : colorSistema.texto }}>{o} días</Text>
                </Presionable>
              );
            })}
          </View>
          <TextInput value={dias} onChangeText={(v) => { setDias(v.replace(/\D/g, '').slice(0, 3)); setError(null); }}
            placeholder="U otro número de días" placeholderTextColor={colorSistema.texto3} keyboardType="number-pad" maxLength={3}
            accessibilityLabel="Días que necesitas" style={campo} />
          {quedaria ? <Text style={{ fontSize: 13, color: colorSistema.texto3, marginLeft: 4 }}>Si la autorizamos, podrías retirarla hasta el {fecha(quedaria)}.</Text> : null}

          <Seccion>¿Por qué lo necesitas?</Seccion>
          <TextInput value={motivo} onChangeText={(v) => { setMotivo(v); setError(null); }} multiline maxLength={300}
            placeholder="Por ejemplo: estoy fuera del país hasta el día 20" placeholderTextColor={colorSistema.texto3}
            accessibilityLabel="Motivo de la prórroga" style={{ ...campo, minHeight: 96, paddingTop: 14, textAlignVertical: 'top' }} />

          {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
          {enviando ? <ActivityIndicator style={{ marginVertical: 8 }} />
            : <Boton alTocar={enviar} deshabilitado={!valido}>Pedir prórroga</Boton>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
