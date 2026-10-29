// «Hay una versión nueva» (2026-10-29). AVISA, no obliga — decisión del
// usuario: «que avise mas no sea restrictivo». No hay versión mínima ni
// pantalla que trabe: «Más tarde» cierra y la app sigue igual.
//
// La última compilación subida la anotan scripts/subir-ios.mjs y
// subir-android.mjs en `app_version_publicada`; la app la pide con la acción
// pública `version_publicada` y la compara con su número de compilación
// (`versionInstalada`, el mismo que usan las novedades). El enlace de
// «Actualizar» sale de esa fila: hoy TestFlight y la pista interna de Play, y
// al salir a la tienda pública se cambia allá sin compilar nada.
//
// Cuándo pregunta: al abrir y al volver a primer plano, como mucho cada 6
// horas. «Más tarde» calla esa compilación tres días; una compilación más
// nueva vuelve a avisar enseguida.
import { Alert, Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { llamar } from './api';
import { versionInstalada } from './novedades';

const CLAVE = 'puntos_salud_actualizacion_pospuesta';
const CADA = 6 * 60 * 60 * 1000;
const CALLAR = 3 * 24 * 60 * 60 * 1000;
const NATIVA = Platform.OS === 'ios' || Platform.OS === 'android';

let ultima = 0;
let abierta = false;

async function pospuesta(build) {
  try {
    const p = JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null');
    return p?.build === build && Date.now() - Number(p.at) < CALLAR;
  } catch { return false; }
}

const posponer = (build) => SecureStore.setItemAsync(CLAVE, JSON.stringify({ build, at: Date.now() })).catch(() => {});

export async function revisarActualizacion() {
  if (!NATIVA || abierta || Date.now() - ultima < CADA) return;
  ultima = Date.now();
  const r = await llamar('version_publicada', { plataforma: Platform.OS });
  // Sin respuesta se vuelve a intentar en la próxima vuelta a primer plano.
  if (!r?.ok) { ultima = 0; return; }
  const instalada = Number(versionInstalada().build) || 0;
  const nueva = Number(r.build) || 0;
  if (!instalada || !r.enlace || nueva <= instalada) return;
  if (await pospuesta(nueva)) return;
  abierta = true;
  Alert.alert(
    'Hay una versión nueva',
    'Actualiza Puntos Salud para tener las mejoras y arreglos más recientes.',
    [
      { text: 'Más tarde', style: 'cancel', onPress: () => { abierta = false; posponer(nueva); } },
      { text: 'Actualizar', onPress: () => { abierta = false; Linking.openURL(r.enlace).catch(() => {}); } },
    ],
    { cancelable: true, onDismiss: () => { abierta = false; posponer(nueva); } },
  );
}
