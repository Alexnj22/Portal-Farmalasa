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
//
// La hoja es la NATIVA de SwiftUI (`BottomSheet`), no una de la app: en iOS 26
// lleva el vidrio del sistema sola (usuario, 2026-11-12: «es negro en iOS, ¿así
// es el canónico? ¿no tiene vidrio?» — la primera versión era un `Modal` con
// fondo sólido). Su `Host` no ocupa lugar en el renglón: sólo presenta la hoja.
import { useState } from 'react';
import { Text } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import * as Haptics from 'expo-haptics';
import { Host, BottomSheet, Button, DatePicker, HStack, Spacer, VStack } from '@expo/ui/swift-ui';
import { datePickerStyle, padding } from '@expo/ui/swift-ui/modifiers';
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
      <Host style={{ position: 'absolute', width: 0, height: 0 }} pointerEvents="none">
        <BottomSheet isPresented={abierta} onIsPresentedChange={(v) => { if (!v) listo(); }} fitToContents>
          <VStack spacing={8} modifiers={[padding({ horizontal: 16, top: 20, bottom: 12 })]}>
            <HStack><Spacer /><Button label="Listo" onPress={listo} /></HStack>
            <DatePicker selection={borrador} displayedComponents={componentes} range={range}
              modifiers={[datePickerStyle(estilo)]} onDateChange={setBorrador} />
          </VStack>
        </BottomSheet>
      </Host>
    </>
  );
}
