// Android: el selector de fecha de Material 3. Se ve como un campo con la
// fecha; al tocarlo se abre el calendario del sistema, como en cualquier app
// de Android. Entra y sale como texto AAAA-MM-DD, que es como la guarda el
// núcleo. La de iPhone es `Fecha.ios.js` (el compacto de iOS).
// La ventana toma la superficie del tema (`colorSistema.fila`: blanca de día,
// oscura de noche), como el diálogo de Material 3. Hasta el 2026-11-12 era un
// oscuro fijo (#1E1B2E) y se veía negra también con el teléfono en claro.
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Host, DateTimePicker } from '@expo/ui/jetpack-compose';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { MARCA, FONDO_CONTROL } from '../inicio/marca';

const aFecha = (s) => (s ? new Date(`${s}T12:00:00`) : undefined);
const aTexto = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Fecha({ valor, onCambiar, desde, hasta }) {
  const [abierto, setAbierto] = useState(false);
  const [elegida, setElegida] = useState(null);
  return (
    <>
      <Pressable onPress={() => { setElegida(null); setAbierto(true); }} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 44, minWidth: 130, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12,
          backgroundColor: FONDO_CONTROL, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ color: valor ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>
          {valor ? fechaTexto(valor, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Elegir fecha'}
        </Text>
      </Pressable>
      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 }} onPress={() => setAbierto(false)}>
          <Pressable style={{ borderRadius: 28, overflow: 'hidden', backgroundColor: colorSistema.fila, paddingBottom: 8 }} onPress={() => {}}>
            <Host matchContents={{ vertical: true }}>
              <DateTimePicker initialDate={valor ? aFecha(valor).toISOString() : null} displayedComponents="date" variant="picker"
                color={MARCA.azulClaro} elementColors={{ containerColor: colorSistema.fila }}
                selectableDates={{ start: aFecha(desde), end: aFecha(hasta) }}
                onDateSelected={(d) => setElegida(d)} />
            </Host>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16 }}>
              <Pressable onPress={() => setAbierto(false)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={() => { if (elegida) onCambiar(aTexto(elegida)); setAbierto(false); }}
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
