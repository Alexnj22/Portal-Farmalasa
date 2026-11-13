// La hoja de opciones y el «escribe el motivo» de iOS, en Android (2026-10-08).
//
// La app usa `ActionSheetIOS.showActionSheetWithOptions` en ~45 pantallas y
// `Alert.prompt` en ~25. En Android ninguna de las dos existe: la hoja REVIENTA
// («ActionSheetManager doesn't exist») y el prompt NO HACE NADA — sin error, la
// acción (rechazar con motivo, cerrar la quincena, aprobar un conteo) se pierde
// en silencio. Y el reemplazo obvio, `Alert.alert` con una opción por botón,
// tampoco sirve: Android dibuja como mucho TRES botones y descarta el resto.
//
// En vez de bifurcar setenta llamadas, esto le da a Android las dos funciones
// con la MISMA firma, dibujadas por <HojasAndroid /> (montado una vez en la
// raíz). En iOS no se toca nada: `instalarHojasAndroid` no hace nada.
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, useColorScheme } from 'react-native';
import HojaDeOpciones from './HojaDeOpciones';
import DialogoAndroid from './DialogoAndroid';
import { usePaleta } from '../tema/material';

let mostrar = null;          // lo registra el host montado
const cola = [];             // lo que se pidió antes de que el host montara

function pedir(hoja) {
  if (mostrar) mostrar(hoja); else cola.push(hoja);
}

export function instalarHojasAndroid() {
  if (Platform.OS !== 'android' || ActionSheetIOS.__hojasAndroid) return;
  ActionSheetIOS.showActionSheetWithOptions = (opciones, alElegir) => {
    const destructivos = [].concat(opciones.destructiveButtonIndex ?? []);
    pedir({
      tipo: 'opciones', titulo: opciones.title, mensaje: opciones.message,
      opciones: (opciones.options ?? []).map((texto, i) => ({
        texto: String(texto), i,
        cancelar: i === opciones.cancelButtonIndex,
        destructivo: destructivos.includes(i),
        apagado: (opciones.disabledButtonIndices ?? []).includes(i),
      })),
      alElegir: (i) => alElegir?.(i ?? opciones.cancelButtonIndex),
    });
  };
  ActionSheetIOS.__hojasAndroid = true;
  // Alert.prompt(titulo, mensaje, botonesOFuncion, tipo, valorInicial, teclado)
  Alert.prompt = (titulo, mensaje, botones, tipo = 'plain-text', valor = '', teclado) => {
    const lista = typeof botones === 'function'
      ? [{ text: 'Cancelar', style: 'cancel' }, { text: 'Aceptar', onPress: botones }]
      : botones?.length ? botones : [{ text: 'Aceptar' }];
    pedir({ tipo: 'texto', titulo, mensaje, botones: lista, valor: String(valor ?? ''), secreto: tipo === 'secure-text', teclado });
  };
  // Alert.alert(titulo, mensaje, botones, { cancelable, onDismiss }): el
  // diálogo de Material 3 (DialogoAndroid.android.js) en vez del viejo de la
  // plataforma, con la misma firma. React Native en Android no deja cerrarlo
  // tocando afuera salvo `cancelable: true`; se respeta.
  Alert.alert = (titulo, mensaje, botones, opciones) => {
    pedir({ tipo: 'aviso', titulo, mensaje, botones: botones?.length ? botones : [{ text: 'Aceptar' }],
      cancelable: !!opciones?.cancelable, alDescartar: opciones?.onDismiss });
  };
}

export default function HojasAndroid() {
  const [hoja, setHoja] = useState(null);
  const texto = useRef('');
  const oscuro = useColorScheme() === 'dark';
  const paleta = usePaleta();
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    mostrar = (h) => { texto.current = h.valor ?? ''; setHoja(h); };
    if (cola.length) mostrar(cola.shift());
    return () => { mostrar = null; };
  }, []);
  if (Platform.OS !== 'android' || !hoja) return null;

  // La paleta del sistema en vivo (tema/material.js); sin ella, los tonos base de Material 3.
  const fondo = paleta?.surfaceContainerLow ?? (oscuro ? '#2B2930' : '#F7F2FA');
  const tinta = paleta?.onSurface ?? (oscuro ? '#FFFFFF' : '#000000');
  const tenue = paleta?.onSurfaceVariant ?? (oscuro ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)');
  const cerrar = (despues) => {
    setHoja(null);
    // La siguiente de la cola, y la acción DESPUÉS de cerrar: si abre otra hoja
    // (elegir sala → elegir motivo) tiene que encontrar el host libre.
    setTimeout(() => { despues?.(); if (cola.length && mostrar) mostrar(cola.shift()); }, 0);
  };
  const cancelar = () => {
    if (hoja.tipo === 'opciones') cerrar(() => hoja.alElegir(null));
    else if (hoja.tipo === 'aviso') cerrar(() => hoja.alDescartar?.());
    else { const b = hoja.botones.find((x) => x.style === 'cancel'); cerrar(() => b?.onPress?.()); }
  };

  // Las opciones: la hoja inferior de Material 3 (`HojaDeOpciones.android.js`).
  if (hoja.tipo === 'opciones') return <HojaDeOpciones hoja={hoja} fondo={fondo} tinta={tinta} tenue={tenue} cerrar={cerrar} cancelar={cancelar} error={paleta?.error} />;

  // Avisos y «escribe el motivo»: el diálogo de Material 3.
  return <DialogoAndroid hoja={{ ...hoja, texto: () => texto.current }} cerrar={cerrar} cancelar={cancelar}
    alEscribir={(t) => { texto.current = t; }} />;
}
