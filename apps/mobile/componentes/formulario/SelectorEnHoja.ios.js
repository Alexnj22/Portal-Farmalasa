// La fecha o la hora de un formulario, en iPhone (2026-11-12). En el renglón
// va un botón COMÚN con el valor («12 nov 2026», «8:00 a. m.»), con la forma
// del compacto del sistema; al tocarlo, el selector del sistema se abre en una
// hoja desde abajo.
//
// Por qué no el compacto de SwiftUI en el renglón, como hasta hoy: es una capa
// SwiftUI (`Host`) y, dentro de un formulario que se desplaza, esas capas no
// siguen a su lugar — es lo que dejaba flotando los íconos de Personal (ver
// componentes/IconoFijo.ios.js). En la hoja nada se desplaza: ahí el selector
// del sistema sí es seguro.
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, DatePicker } from '@expo/ui/swift-ui';
import { datePickerStyle } from '@expo/ui/swift-ui/modifiers';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL } from '../inicio/marca';

export default function SelectorEnHoja({ texto, fecha, componentes, estilo, range, onElegir }) {
  const [abierta, setAbierta] = useState(false);
  const [borrador, setBorrador] = useState(fecha);
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); setBorrador(fecha); setAbierta(true); };
  const listo = () => { setAbierta(false); if (borrador && borrador.getTime() !== fecha.getTime()) onElegir(borrador); };
  return (
    <>
      <Pressable onPress={abrir} hitSlop={6} accessibilityRole="button" accessibilityHint="Abre el selector"
        style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 8, justifyContent: 'center', backgroundColor: FONDO_CONTROL, opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ color: colorSistema.texto, fontSize: 17 }}>{texto}</Text>
      </Pressable>
      <Modal visible={abierta} transparent animationType="slide" onRequestClose={listo}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={listo} accessibilityLabel="Cerrar" />
        <View style={{ backgroundColor: colorSistema.fila, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 34, paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingVertical: 8 }}>
            <Pressable onPress={listo} hitSlop={10} accessibilityRole="button">
              <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: '600' }}>Listo</Text>
            </Pressable>
          </View>
          <Host matchContents={{ vertical: true }} style={{ marginHorizontal: 12 }}>
            <DatePicker selection={borrador} displayedComponents={componentes} range={range}
              modifiers={[datePickerStyle(estilo)]} onDateChange={setBorrador} />
          </Host>
        </View>
      </Modal>
    </>
  );
}
