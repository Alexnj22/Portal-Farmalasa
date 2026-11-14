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
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { instalarAlertaWeb } from './componentes/AlertaWeb';

// `Alert.alert` no hace nada en el navegador: se reemplaza antes de pintar.
instalarAlertaWeb();

LoadSkiaWeb({ locateFile: (archivo) => `/${archivo}` })
  .catch((e) => { console.error('No se pudo cargar CanvasKit', e); })
  .then(() => renderRootComponent(App));
