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
import { Appearance, Platform, PlatformColor, ScrollView, Text, TextInput, View } from 'react-native';
import Vidrio from './Vidrio';

const ios = Platform.OS === 'ios';
// Fuera de iPhone, cada color se lee como GETTER y devuelve el del modo ACTUAL
// del teléfono (claro u oscuro) — lo mismo que hace Puntos Salud
// (apps/clientes/componentes/sistema.js). Medido en el emulador el 2026-10-08:
//  - hex fijos (hasta entonces) eran de modo claro: en oscuro, texto casi
//    negro sobre la aurora oscura;
//  - `PlatformColor('?android:attr/…')` dejó el login SIN texto;
//  - y `PlatformColor` en general no sirve en Android porque los componentes
//    nativos de @expo/ui (Icon, Switch…) no aceptan ese objeto como color.
// Con un hex por modo, cualquier componente lo entiende.
const oscuro = () => Appearance.getColorScheme() === 'dark';
const COLORES = {
  // nombre: [color de iOS, claro, oscuro]
  fondo: ['systemGroupedBackground', '#F2F2F7', '#000000'],
  fila: ['secondarySystemGroupedBackground', '#FFFFFF', '#1C1C1E'],
  texto: ['label', '#1C1B1F', '#F2F2F7'],
  texto2: ['secondaryLabel', '#49454F', '#CAC4D0'],
  placeholder: ['placeholderText', '#79747E', '#938F99'],
  separador: ['separator', 'rgba(60,60,67,0.29)', 'rgba(84,84,88,0.6)'],
  rojo: ['systemRed', '#B3261E', '#FF453A'],
  verde: ['systemGreen', '#1B873F', '#30D158'],
  naranja: ['systemOrange', '#B26A00', '#FF9F0A'],
  acento: ['link', '#0052CC', '#0A84FF'],
};
export const colorSistema = {
  separadorClaro: 'rgba(127,127,127,0.25)',   // para SVG, que no lee colores del sistema
  acentoTinte: 'rgba(0,82,204,0.12)',
};
for (const [k, [nativo, claro, noche]] of Object.entries(COLORES)) {
  Object.defineProperty(colorSistema, k, { enumerable: true, get: ios ? () => PlatformColor(nativo) : () => (oscuro() ? noche : claro) });
}

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
// `vidrio`: el grupo va sobre la aurora como superficie de vidrio. Es el
// default desde el 2026-10-01 (usuario: «si usamos canónico y vidrio, ¿por qué
// poner sólidos?»): todas las pantallas van sobre la aurora.
export function Grupo({ titulo, pie, children, vidrio = true }) {
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
