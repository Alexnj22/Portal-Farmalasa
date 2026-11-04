// Android y la vista previa web: las mismas acciones de fila que
// AccionesFila.ios.js, con piezas de React Native. El «⋯» abre la hoja de
// opciones (en Android, la de componentes/HojasAndroid; en la web, una alerta).
import { Alert, Platform, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { hojaDeOpciones } from './BandejaAvisos';
import { suave, useTema } from '../tema/tema';

export function MenuMas({ opciones, etiqueta, titulo }) {
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    if (Platform.OS === 'web') {
      Alert.alert(titulo ?? etiqueta, undefined, [...opciones.map((o) => ({ text: o.texto, style: o.destructivo ? 'destructive' : 'default', onPress: o.alElegir })),
        { text: 'Cancelar', style: 'cancel' }]);
      return;
    }
    hojaDeOpciones({ titulo: titulo ?? etiqueta, opciones });
  };
  return (
    <Presionable onPress={abrir} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={4}
      style={({ pressed }) => ({ width: 40, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Icono sf="ellipsis.circle" respaldo="⋮" tam={22} color={colorSistema.texto2} />
    </Presionable>
  );
}

export function Capsula({ etiqueta, alTocar, color, prominente = true }) {
  const t = useTema();
  const c = color ?? t.color.magenta;
  return (
    <Presionable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar(); }}
      accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 36, minWidth: 64, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: prominente ? c : suave(c, t.oscuro ? 0.24 : 0.14), transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: prominente ? '#FFFFFF' : colorSistema.texto }}>{etiqueta}</Text>
    </Presionable>
  );
}
