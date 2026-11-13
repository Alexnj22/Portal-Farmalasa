// El encabezado de TODA hoja que se abre con <Modal presentationStyle="pageSheet">
// (2026-11-12, usuario: «que nada se vea en un lado de una forma y en otro de
// otra»). Antes cada hoja dibujaba su propio renglón: un título grande que se
// iba con el contenido y un «Cerrar» o «Cancelar» en texto. La forma del
// sistema en iOS 26 es una barra FIJA: el botón de cerrar de vidrio (✕) a la
// izquierda, el título centrado y, si la hoja confirma algo, la palomita a la
// derecha.
//
// Va FUERA del ScrollView, como primer hijo de <ConAurora>: así no se desplaza
// (y la capa SwiftUI de los botones no se despega de su lugar, ver IconoFijo).
//
//   titulo, subtitulo
//   onCerrar        → el ✕ (no se dibuja sin él)
//   atras           → en vez del ✕, la flecha ‹: la hoja vuelve a otra hoja
//                     (el día dentro de la semana), no se cierra
//   ocupado         → apaga los botones mientras se guarda
//   accion          → { onPress, deshabilitada, etiqueta } — la palomita
import { Text, View } from 'react-native';
import { Button, Host } from '@expo/ui/swift-ui';
import { buttonBorderShape, buttonStyle, controlSize, disabled, labelStyle } from '@expo/ui/swift-ui/modifiers';
import { colorSistema } from './Formulario';

const LADO = 48;

export default function EncabezadoDeHoja({ titulo, subtitulo, onCerrar, atras = false, ocupado = false, accion }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 8 }}>
      <View style={{ width: LADO, height: LADO, justifyContent: 'center' }}>
        {onCerrar ? (
          <Host style={{ width: LADO, height: LADO }}>
            {atras
              ? <Button label="Volver" systemImage="chevron.left" onPress={onCerrar} modifiers={[buttonStyle('glass'), controlSize('large'), buttonBorderShape('circle'), labelStyle('iconOnly'), disabled(!!ocupado)]} />
              : <Button label="Cerrar" systemImage="xmark" onPress={onCerrar} modifiers={[buttonStyle('glass'), controlSize('large'), buttonBorderShape('circle'), labelStyle('iconOnly'), disabled(!!ocupado)]} />}
          </Host>
        ) : null}
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }} numberOfLines={1} accessibilityRole="header">{titulo}</Text>
        {subtitulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }} numberOfLines={1}>{subtitulo}</Text> : null}
      </View>
      <View style={{ width: LADO, height: LADO, justifyContent: 'center' }}>
        {accion ? (
          <Host style={{ width: LADO, height: LADO }}>
            <Button label={accion.etiqueta ?? 'Listo'} systemImage="checkmark" onPress={accion.onPress}
              modifiers={[buttonStyle('glassProminent'), controlSize('large'), buttonBorderShape('circle'), labelStyle('iconOnly'), disabled(!!ocupado || !!accion.deshabilitada)]} />
          </Host>
        ) : null}
      </View>
    </View>
  );
}
