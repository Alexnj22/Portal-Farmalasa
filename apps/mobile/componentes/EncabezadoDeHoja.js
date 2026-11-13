// Gemelo Android de EncabezadoDeHoja.ios.js (leer ése primero). En Android la
// hoja de pantalla completa lleva la barra superior de Material: ✕ a la
// izquierda, el título alineado a la izquierda y la acción en texto a la
// derecha. Misma firma que el de iOS.
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IconoFijo from './IconoFijo';
import { iconoDe } from '../tema/iconos';
import { colorSistema } from './Formulario';

const FLECHA = require('@expo/material-symbols/arrow_back.xml');

export default function EncabezadoDeHoja({ titulo, subtitulo, onCerrar, atras = false, ocupado = false, accion }) {
  const apagada = !!ocupado || !!accion?.deshabilitada;
  // La hoja de Android ocupa la pantalla entera, también detrás de la barra de
  // estado (de borde a borde): sin esto el ✕ quedaba bajo la hora.
  const { top } = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 4, paddingTop: 8 + top, gap: 4 }}>
      {onCerrar ? (
        <Pressable onPress={onCerrar} disabled={!!ocupado} accessibilityRole="button" accessibilityLabel={atras ? 'Volver' : 'Cerrar'}
          android_ripple={{ color: colorSistema.separador, borderless: true, radius: 24 }}
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: ocupado ? 0.4 : 1 }}>
          <IconoFijo name={atras ? FLECHA : iconoDe('X')} size={24} color={colorSistema.texto} />
        </Pressable>
      ) : <View style={{ width: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 22 }} numberOfLines={1} accessibilityRole="header">{titulo}</Text>
        {subtitulo ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={1}>{subtitulo}</Text> : null}
      </View>
      {accion ? (
        <Pressable onPress={accion.onPress} disabled={apagada} accessibilityRole="button"
          android_ripple={{ color: colorSistema.separador }}
          style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 24, opacity: apagada ? 0.4 : 1 }}>
          <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{accion.etiqueta ?? 'Listo'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
