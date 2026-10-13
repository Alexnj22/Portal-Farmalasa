// Mantener presionado un mensaje: como en iMessage o WhatsApp, el fondo se
// atenúa, el mensaje queda al frente, ENCIMA una barra horizontal con las seis
// reacciones y DEBAJO un menú corto (Responder, Copiar). Antes era la hoja de
// opciones del sistema con los seis emojis en columna — el «listado vertical»
// que reportó el usuario.
//
// Los seis emojis son los de `chat_reaccionar` (EMOJIS_DE_REACCION). Tocar el
// que ya es mío lo quita (`p_emoji: null`), igual que el portal.
//
// En iPhone el fondo es desenfoque del sistema y las piezas, vidrio; en
// Android, una capa oscura y superficies de Material con onda.
import { useEffect, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { EMOJIS_DE_REACCION } from '@nucleo/data/chatClientes';
import { recorteDeMensaje } from '@nucleo/utils/chatClientes';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';

const ANDROID = Platform.OS === 'android';

function Accion({ icono, texto, onPress, primero }) {
  // Los íconos de @expo/ui no aceptan el color dinámico del sistema: hex por modo.
  const tinta = useColorScheme() === 'dark' ? '#F2F2F7' : '#1C1B1F';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" android_ripple={ANDROID ? { color: 'rgba(127,127,127,0.2)' } : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48,
        borderTopWidth: primero ? 0 : StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador,
        backgroundColor: !ANDROID && pressed ? 'rgba(127,127,127,0.15)' : 'transparent' })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17 }}>{texto}</Text>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color={tinta} /></Host>
    </Pressable>
  );
}

// La superficie de cada pieza: vidrio en iPhone, tarjeta elevada de Material en Android.
// (sobre el desenfoque, el vidrio solo no se distingue: va la superficie del
// sistema, como el menú contextual de iOS).
function Superficie({ children, radio }) {
  return (
    <View style={{ borderRadius: radio, backgroundColor: colorSistema.fila, overflow: 'hidden',
      ...(ANDROID ? { elevation: 8 } : { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }) }}>
      {children}
    </View>
  );
}

/**
 * @param {{ mensaje: object|null, delEquipo: boolean, mia: string|null, puedeResponder: boolean,
 *   onReaccionar: (emoji: string|null) => void, onResponder: () => void, onCopiar: () => void, onCerrar: () => void }} props
 */
export default function MenuDeMensaje({ mensaje, delEquipo, mia, puedeResponder, onReaccionar, onResponder, onCopiar, onCerrar }) {
  const [entra] = useState(() => new Animated.Value(0));
  const visible = !!mensaje;
  useEffect(() => {
    if (!visible) { entra.setValue(0); return; }
    Animated.spring(entra, { toValue: 1, useNativeDriver: true, bounciness: 7, speed: 16 }).start();
  }, [visible, entra]);
  if (!mensaje) return null;

  const escala = entra.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const alinear = delEquipo ? 'flex-end' : 'flex-start';
  const texto = mensaje.texto || recorteDeMensaje(mensaje);
  const elegir = (e) => { Haptics.selectionAsync().catch(() => {}); onReaccionar(e === mia ? null : e); onCerrar(); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCerrar} accessibilityLabel="Cerrar">
        {ANDROID ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
          : <BlurView intensity={40} tint="systemThinMaterialDark" style={StyleSheet.absoluteFill} />}
      </Pressable>
      <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16 }}>
        <Animated.View style={{ alignItems: alinear, gap: 10, opacity: entra, transform: [{ scale: escala }] }}>
          {puedeResponder ? (
            <Superficie radio={28}>
              <View style={{ flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 4 }} accessibilityRole="toolbar">
                {EMOJIS_DE_REACCION.map((e) => (
                  <Pressable key={e} onPress={() => elegir(e)} accessibilityRole="button" accessibilityLabel={`Reaccionar con ${e}`}
                    accessibilityState={{ selected: e === mia }}
                    android_ripple={ANDROID ? { color: 'rgba(127,127,127,0.25)', borderless: true, radius: 22 } : undefined}
                    style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: e === mia ? 'rgba(59,130,246,0.28)' : 'transparent', transform: [{ scale: pressed ? 1.25 : 1 }] })}>
                    <Text style={{ fontSize: 26 }}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            </Superficie>
          ) : null}
          <View style={{ maxWidth: '86%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
            backgroundColor: delEquipo ? MARCA.azul : (ANDROID ? '#FFFFFF' : 'rgba(255,255,255,0.92)') }}>
            <Text style={{ color: delEquipo ? '#fff' : '#111', fontSize: 16 }} numberOfLines={8}>{texto}</Text>
          </View>
          <View style={{ width: 230 }}>
            <Superficie radio={ANDROID ? 12 : 16}>
              {puedeResponder ? <Accion primero icono="Responder" texto="Responder" onPress={() => { onResponder(); onCerrar(); }} /> : null}
              {mensaje.texto ? <Accion primero={!puedeResponder} icono="Copiar" texto="Copiar" onPress={() => { onCopiar(); onCerrar(); }} /> : null}
            </Superficie>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
