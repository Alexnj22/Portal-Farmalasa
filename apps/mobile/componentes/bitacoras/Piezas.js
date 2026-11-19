// Piezas comunes de las pantallas nativas de Bitácoras (antibióticos, lotes por
// revisar y regencia): la hoja que sube desde abajo con su encabezado, el
// botón chico de texto, la sala elegible y pedir un motivo escrito.
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Presionable as Pressable } from '../Tocable';
import Aurora from '../Aurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL, MARCA } from '../inicio/marca';

/** Una hoja de pantalla (pageSheet) con su encabezado y el pie fijo abajo. */
export function Hoja({ titulo, subtitulo, onCerrar, ocupado = false, pie = null, children }) {
  return (
    <Modal visible animationType="slide" onRequestClose={ocupado ? () => {} : onCerrar} presentationStyle="pageSheet" allowSwipeDismissal={!ocupado}>
      <View style={{ flex: 1 }}>
        <Aurora />
        <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
          <EncabezadoDeHoja titulo={titulo} subtitulo={subtitulo} onCerrar={onCerrar} ocupado={ocupado} />
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
              {children}
            </ScrollView>
            {pie ? <View style={{ padding: 16, gap: 8 }}>{pie}</View> : null}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** Un botón chico de texto, con blanco de dedo de 44. */
export function BotonChico({ texto, onPress, color = MARCA.azulClaro, deshabilitado = false, relleno = false }) {
  return (
    <Pressable disabled={deshabilitado} accessibilityRole="button" hitSlop={6}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
        backgroundColor: relleno ? color : FONDO_CONTROL, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: relleno ? '#fff' : color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

/** Un rótulo chico sobre un campo. */
export function Rotulo({ children }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{children}</Text>;
}

/**
 * Pedir un texto obligatorio (el motivo de anular, devolver o sacar del
 * libro). `Alert.prompt` es de iOS; en Android lo instala `HojasAndroid`.
 * Devuelve el texto o null si se canceló o quedó vacío.
 */
export function pedirMotivo({ titulo, mensaje, confirmar = 'Aceptar', destructivo = false }) {
  return new Promise((ok) => Alert.prompt(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => ok(null) },
    { text: confirmar, style: destructivo ? 'destructive' : 'default', onPress: (v) => ok(String(v ?? '').trim() || null) },
  ], 'plain-text'));
}
