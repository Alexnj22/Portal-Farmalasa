// Las piezas CANÓNICAS del sistema, las mismas de la app del personal
// (apps/mobile/componentes/Formulario.js): formulario agrupado como Ajustes,
// colores del sistema (`PlatformColor`) que siguen solos el modo oscuro, el
// campo de texto del sistema (UITextField) y el botón nativo de @expo/ui.
//
// Por qué el `TextInput` de React Native y no el de @expo/ui: medido en la app
// del personal el 2026-09-29, el de @expo/ui avisaba el cambio una tecla tarde.
// El de React Native ES el UITextField del sistema.
import { Children, forwardRef, isValidElement } from 'react';
import { Appearance, KeyboardAvoidingView, Platform, PlatformColor, ScrollView, Text, TextInput, View } from 'react-native';
import { Host, Switch } from '@expo/ui';
import BotonNativo from './BotonNativo';
import Vidrio from './Vidrio';

const ios = Platform.OS === 'ios';
const oscuro = () => Appearance.getColorScheme() === 'dark';

// En iPhone, los colores del sistema (`PlatformColor`) cambian solos con el
// modo oscuro. Fuera de iPhone no hay un equivalente que sirva en web, así que
// se leen como GETTERS: cada render pide el del modo actual (antes eran fijos
// de modo claro y el título salía negro sobre la aurora oscura).
const respaldo = (claro, noche) => () => (oscuro() ? noche : claro);
// `texto2` y `texto3` NO usan `secondaryLabel`/`tertiaryLabel`: ésos son
// TRANSLÚCIDOS (60% y 30% de opacidad), pensados para fondo liso. Sobre vidrio
// y aurora de color se lavaban hasta no leerse (probado en TestFlight el
// 2026-10-06: «muchos textos cuesta verlos»). Sólidos y más oscuros, con
// contraste ≥ 4.5:1 sobre el vidrio en los dos modos.
const COLORES = {
  texto: ['label', respaldo('#1C1B1F', '#F2F2F7')],
  texto2: [null, respaldo('#2E2A33', '#E4E2EA')],
  texto3: [null, respaldo('#4A4552', '#BDB9C6')],
  placeholder: ['placeholderText', respaldo('#79747E', 'rgba(235,235,245,0.36)')],
  separador: ['separator', respaldo('rgba(60,60,67,0.29)', 'rgba(84,84,88,0.6)')],
  rojo: ['systemRed', respaldo('#B3261E', '#FF453A')],
  naranja: ['systemOrange', respaldo('#B26A00', '#FF9F0A')],
};
export const colorSistema = {};
for (const [k, [nativo, web]] of Object.entries(COLORES)) {
  Object.defineProperty(colorSistema, k, { enumerable: true, get: ios && nativo ? () => PlatformColor(nativo) : web });
}

// El teclado se acomoda ENCOGIENDO la vista (KeyboardAvoidingView), no con
// `automaticallyAdjustKeyboardInsets`: ése reemplaza el margen de arriba que
// pone la barra transparente, y al tocar el primer campo todo el formulario
// subía y quedaba escondido bajo el título (Unirme y Entrar, 2026-10-06).
export function Formulario({ children, contentContainerStyle, ...props }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={[{ paddingVertical: 20, gap: 24, width: '100%', maxWidth: 560, alignSelf: 'center' }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
        contentInsetAdjustmentBehavior="automatic" {...props}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Grupo de filas como en Ajustes: título arriba y pie abajo, en gris; vidrio sobre la aurora. */
export function Grupo({ titulo, pie, children }) {
  const filas = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ marginHorizontal: 16 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textTransform: 'uppercase', marginLeft: 16, marginBottom: 6 }}>{titulo}</Text> : null}
      <Vidrio radio={ios ? 26 : 16}>
        {filas.map((fila, i) => (
          <View key={fila.key ?? i}>
            {fila}
            {i < filas.length - 1 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
          </View>
        ))}
      </Vidrio>
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 16, marginTop: 6 }}>{pie}</Text> : null}
    </View>
  );
}

/** Una fila con el campo de texto del sistema. */
export const FilaCampo = forwardRef(function FilaCampo({ style, ...props }, ref) {
  return (
    <TextInput ref={ref} placeholderTextColor={colorSistema.placeholder}
      style={[{ minHeight: 52, paddingHorizontal: 16, fontSize: 17, color: colorSistema.texto },
        Platform.OS === 'web' && { outlineStyle: 'none' }, style]} {...props} />
  );
});

/** Una fila de texto. */
export function FilaTexto({ children, color, style }) {
  return (
    <View style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={[{ fontSize: 17, color: color ?? colorSistema.texto }, style]}>{children}</Text>
    </View>
  );
}

/** El botón del sistema, a lo ancho del grupo. `color` es el tinte (el magenta del logo). */
export function BotonSistema({ etiqueta, alTocar, variante = 'filled', deshabilitado = false, color }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <BotonNativo etiqueta={etiqueta} alTocar={alTocar} variante={variante} deshabilitado={deshabilitado} color={color} />
    </View>
  );
}

/**
 * Una fila con interruptor del sistema, como las de Ajustes. iOS no tiene
 * casillas de verificación: un «sí / no» es un interruptor.
 */
export function FilaInterruptor({ titulo, detalle, valor, alCambiar, color }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 17, color: colorSistema.texto }}>{titulo}</Text>
        {detalle ? <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{detalle}</Text> : null}
      </View>
      <Host matchContents seedColor={color}>
        <Switch value={!!valor} onValueChange={alCambiar} />
      </Host>
    </View>
  );
}
