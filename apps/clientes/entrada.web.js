// La entrada en el NAVEGADOR (app.farmasalud.lat, 2026-11-14).
//
// Lo que la app dibuja con Skia —la tarjeta y sus minerales, el logo en
// relieve, el cupón, los juegos de Bienestar— en el teléfono lo pinta el motor
// nativo; en la web lo pinta CanvasKit, un .wasm que hay que cargar ANTES de
// que se evalúe cualquier módulo que use Skia (varios arman trazos al
// importarse). Sin esto el Inicio lanzaba «CanvasKit is not defined» y la
// tarjeta salía sin sus piezas.
//
// El .wasm lo copia scripts/subir-web-clientes.mjs a la raíz del sitio
// (`/canvaskit.wasm`); es el de `canvaskit-wasm/bin/full`, el mismo que pide
// LoadSkiaWeb.
// Es `expo-router/entry-classic` con la carga en el medio: `App` arma las
// rutas pero no evalúa ninguna pantalla hasta pintar, así que importarlo
// antes de que exista CanvasKit no rompe nada. (Un `import()` de
// `expo-router/entry` en cambio no anda con el empaquetado diferido de Metro.)
import '@expo/metro-runtime';
import * as RN from 'react-native';
import { Alert, Share } from 'react-native';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { instalarAlertaWeb } from './componentes/AlertaWeb';
import ExpoSecureStore from 'expo-secure-store/build/ExpoSecureStore';

// expo-secure-store no tiene nada en la web (su módulo es `{}`): cada lectura
// y escritura fallaba, así que nada se recordaba al recargar — un dispositivo
// nuevo en cada visita (el código de WhatsApp otra vez), los términos de la
// reserva cada vez, los récords de los juegos. Acá se le da localStorage, con
// la misma firma, para las ~70 llamadas de la app (2026-11-14). La sesión ya
// iba a localStorage en la web (lib/sesion.js).
const CLAVE_SS = (k) => `ss:${k}`;
Object.assign(ExpoSecureStore, {
  getValueWithKeyAsync: async (k) => { try { return localStorage.getItem(CLAVE_SS(k)); } catch { return null; } },
  setValueWithKeyAsync: async (v, k) => { localStorage.setItem(CLAVE_SS(k), v); },
  deleteValueWithKeyAsync: async (k) => { try { localStorage.removeItem(CLAVE_SS(k)); } catch { /* nada */ } },
  getValueWithKeySync: (k) => { try { return localStorage.getItem(CLAVE_SS(k)); } catch { return null; } },
  setValueWithKeySync: (v, k) => { localStorage.setItem(CLAVE_SS(k), v); },
  canUseBiometricAuthentication: () => false,
});

// `Alert.alert` no hace nada en el navegador: se reemplaza antes de pintar.
instalarAlertaWeb();

// `ActionSheetIOS` no existe en react-native-web: `import { ActionSheetIOS }
// from 'react-native'` daba `undefined` y cada `showActionSheetWithOptions`
// lanzaba dentro del toque — el «…» de Facturas, el «+» del chat, cambiar la
// foto de perfil, apartar un premio no hacían nada. Se agrega al módulo antes
// de que cargue cualquier pantalla (los import leen la propiedad al usarla), y
// componentes/HojasAndroid.js le pone la hoja de verdad, la misma de Android
// (dibujada por HojaDeOpciones.web.js).
if (!RN.ActionSheetIOS) {
  RN.ActionSheetIOS = {
    showActionSheetWithOptions(opciones, alElegir) { alElegir?.(opciones?.cancelButtonIndex); },
    showShareActionSheetWithOptions(_o, alFallar) { alFallar?.(new Error('No disponible')); },
    dismissActionSheet() {},
  };
}

// Compartir: react-native-web usa `navigator.share`, que no existe en varios
// navegadores de computadora — ahí fallaba en silencio (invitar, el código de
// la reserva, el comprobante). Sin él, el texto se copia y se avisa.
const compartirOriginal = Share.share.bind(Share);
Share.share = async (contenido, opciones) => {
  if (typeof navigator !== 'undefined' && navigator.share) return compartirOriginal(contenido, opciones);
  const texto = [contenido?.message, contenido?.url && !String(contenido.message ?? '').includes(contenido.url) ? contenido.url : null].filter(Boolean).join(' ');
  await navigator.clipboard.writeText(texto);
  Alert.alert('Copiado', 'Pégalo donde quieras compartirlo.');
  return { action: Share.sharedAction };
};

LoadSkiaWeb({ locateFile: (archivo) => `/${archivo}` })
  .catch((e) => { console.error('No se pudo cargar CanvasKit', e); })
  .then(() => renderRootComponent(App));
