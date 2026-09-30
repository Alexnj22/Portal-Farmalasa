// El formulario agrupado del sistema — como Ajustes en iPhone —, armado con
// piezas de React Native y los COLORES DEL SISTEMA (`PlatformColor`), no con
// los del portal: fondo agrupado, filas, separadores y texto cambian solos con
// el modo oscuro, igual que cualquier app de iOS.
//
// Por qué no el `FieldGroup` de @expo/ui con campos adentro (medido el
// 2026-09-29): su `TextInput` avisaba el cambio una tecla tarde —el usuario
// salía «prueba» con la pantalla diciendo «pruebas»— y un `TextInput` de
// React Native metido en sus filas no recibía los toques. Acá el campo es el
// `TextInput` de React Native, que ES el campo del sistema (UITextField /
// EditText), y los controles de @expo/ui (botón, selector, interruptor) van en
// su propio `Host`, que es la forma documentada de mezclarlos.
import { Children, forwardRef, isValidElement } from 'react';
import { Platform, PlatformColor, ScrollView, Text, TextInput, View } from 'react-native';
import Vidrio from './Vidrio';

const ios = Platform.OS === 'ios';
export const colorSistema = {
  fondo: ios ? PlatformColor('systemGroupedBackground') : '#F2F2F7',
  fila: ios ? PlatformColor('secondarySystemGroupedBackground') : '#FFFFFF',
  texto: ios ? PlatformColor('label') : '#1C1B1F',
  texto2: ios ? PlatformColor('secondaryLabel') : '#49454F',
  placeholder: ios ? PlatformColor('placeholderText') : '#79747E',
  separador: ios ? PlatformColor('separator') : '#CAC4D0',
  separadorClaro: 'rgba(127,127,127,0.25)',   // para SVG, que no lee colores del sistema
  rojo: ios ? PlatformColor('systemRed') : '#B3261E',
  verde: ios ? PlatformColor('systemGreen') : '#1B873F',
  naranja: ios ? PlatformColor('systemOrange') : '#B26A00',
  acento: ios ? PlatformColor('link') : '#0052CC',
  acentoTinte: 'rgba(0,82,204,0.12)',
};

export function Formulario({ children, contentContainerStyle, ...props }) {
  return (
    <ScrollView style={{ flex: 1 }}
      contentContainerStyle={[{ paddingVertical: 20, gap: 28 }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag"
      contentInsetAdjustmentBehavior="automatic" {...props}>
      {children}
    </ScrollView>
  );
}

/** Un grupo de filas con esquinas redondeadas; `titulo` arriba y `pie` abajo, en gris. */
// `vidrio`: el grupo va sobre la aurora como superficie de vidrio (la entrada).
export function Grupo({ titulo, pie, children, vidrio = false }) {
  const filas = Children.toArray(children).filter(isValidElement);
  const contenido = filas.map((fila, i) => (
    <View key={fila.key ?? i}>
      {fila}
      {i < filas.length - 1 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
    </View>
  ));
  return (
    <View style={{ marginHorizontal: 16 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 }}>{titulo}</Text> : null}
      {vidrio
        ? <Vidrio radio={ios ? 26 : 16}>{contenido}</Vidrio>
        : <View style={{ backgroundColor: colorSistema.fila, borderRadius: ios ? 26 : 16, overflow: 'hidden' }}>{contenido}</View>}
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 16, marginTop: 6 }}>{pie}</Text> : null}
    </View>
  );
}

/** Una fila con un campo de texto del sistema. */
export const FilaCampo = forwardRef(function FilaCampo({ style, ...props }, ref) {
  return (
    <TextInput ref={ref} placeholderTextColor={colorSistema.placeholder}
      style={[{ minHeight: 52, paddingHorizontal: 16, fontSize: 17, color: colorSistema.texto }, style]} {...props} />
  );
});

/** Una fila de texto (una nota, un error). */
export function FilaTexto({ children, color, style }) {
  return (
    <View style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={[{ fontSize: 17, color: color ?? colorSistema.texto }, style]}>{children}</Text>
    </View>
  );
}
