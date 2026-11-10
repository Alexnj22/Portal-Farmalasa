// El reproductor de la pantalla bloqueada en iPhone, con portada VIVA
// (2026-11-10: «podemos hacer live estas fotos? creo que ios lo acepta»).
// Lo usa lib/ruido.js; si el binario no trae este módulo, `null` y la app
// vuelve al aviso de react-native-audio-api con la portada fija.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export default Platform.OS === 'ios' ? requireOptionalNativeModule('PortadaViva') : null;
