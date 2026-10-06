// Android: el selector de hora de Material 3, en un diálogo. Entra y sale como
// «HH:MM» de 24 horas; se muestra con `hora12`. La de iPhone es `Hora.ios.js`.
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Host, DateTimePicker } from '@expo/ui/jetpack-compose';
import { hora12 } from '@nucleo/utils/hora';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

const aFecha = (h) => {
  const [hh, mm] = String(h || '08:00').split(':').map(Number);
  return new Date(2000, 0, 1, hh || 0, mm || 0, 0);
};
const aTexto = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function Hora({ valor, onCambiar }) {
  const [abierto, setAbierto] = useState(false);
  const [elegida, setElegida] = useState(null);
  return (
    <>
      <Pressable onPress={() => { setElegida(null); setAbierto(true); }} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 44, minWidth: 110, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12,
          backgroundColor: 'rgba(127,127,127,0.16)', opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: valor ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>{valor ? hora12(valor) : 'Elegir hora'}</Text>
      </Pressable>
      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 }} onPress={() => setAbierto(false)}>
          <Pressable style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: '#1E1B2E', paddingBottom: 8 }} onPress={() => {}}>
            <Host matchContents={{ vertical: true }}>
              <DateTimePicker initialDate={aFecha(valor).toISOString()} displayedComponents="hourAndMinute" is24Hour={false}
                color={MARCA.azulClaro} onDateSelected={(d) => setElegida(d)} />
            </Host>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16 }}>
              <Pressable onPress={() => setAbierto(false)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={() => { if (elegida) onCambiar(aTexto(new Date(elegida))); setAbierto(false); }}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Aceptar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
