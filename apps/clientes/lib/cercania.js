// Dónde está la persona, SÓLO para «Nuestras sucursales» (2026-10-08).
//
// Reglas, las tres pedidas:
//  - el permiso es «mientras se usa», nunca en segundo plano (app.json lo deja
//    así en iOS y Android);
//  - se pregunta únicamente cuando la persona toca «Ver las más cercanas»: al
//    abrir la pantalla sólo se MIRA si ya lo había dado;
//  - la posición no sale del teléfono: la distancia se calcula acá.
// Sin permiso, `posicion` queda en null y la lista se ve como siempre.
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

let Location = null;
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try { Location = require('expo-location'); } catch { Location = null; }
}

async function posicionActual() {
  // La última conocida contesta al instante; si es vieja (o no hay), una nueva
  // con precisión equilibrada: para ordenar seis sucursales sobran 100 metros.
  const ultima = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1000 }).catch(() => null);
  const p = ultima ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: p.coords.latitude, lng: p.coords.longitude };
}

export function useUbicacionMientrasSeUsa() {
  const [posicion, setPosicion] = useState(null);
  const [puedePedir, setPuedePedir] = useState(false);
  const [buscando, setBuscando] = useState(false);

  const ubicar = useCallback(async () => {
    setBuscando(true);
    try { setPosicion(await posicionActual()); } catch { /* sin señal: la lista queda sin ordenar */ }
    setBuscando(false);
  }, []);

  // Al entrar: si ya lo dio, se ordena solo; si nunca se preguntó (o se puede
  // volver a preguntar), se ofrece el botón. Nunca se abre el diálogo acá.
  useFocusEffect(useCallback(() => {
    if (!Location) return;
    Location.getForegroundPermissionsAsync().then((p) => {
      if (p.granted) { setPuedePedir(false); ubicar(); } else setPuedePedir(p.canAskAgain !== false);
    }).catch(() => {});
  }, [ubicar]));

  const pedir = useCallback(async () => {
    if (!Location) return;
    const p = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (p?.granted) { setPuedePedir(false); await ubicar(); } else setPuedePedir(false);   // dijo que no: no se insiste
  }, [ubicar]);

  return { posicion, puedePedir, buscando, pedir };
}

/** Kilómetros en línea recta (haversine). null si falta alguna de las dos puntas. */
export function distanciaKm(desde, sala) {
  if (!desde || sala?.lat == null || sala?.lng == null) return null;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(sala.lat - desde.lat), dLng = rad(sala.lng - desde.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(desde.lat)) * Math.cos(rad(sala.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function textoDistancia(km) {
  if (km < 1) return `a ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  return `a ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}
