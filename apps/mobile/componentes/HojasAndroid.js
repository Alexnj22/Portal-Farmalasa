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
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';

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
}

export default function HojasAndroid() {
  const [hoja, setHoja] = useState(null);
  const [texto, setTexto] = useState('');
  const oscuro = useColorScheme() === 'dark';
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    mostrar = (h) => { setTexto(h.valor ?? ''); setHoja(h); };
    if (cola.length) mostrar(cola.shift());
    return () => { mostrar = null; };
  }, []);
  if (Platform.OS !== 'android' || !hoja) return null;

  const fondo = oscuro ? '#2C2C2E' : '#FFFFFF';
  const tinta = oscuro ? '#FFFFFF' : '#000000';
  const tenue = oscuro ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
  const cerrar = (despues) => {
    setHoja(null);
    // La siguiente de la cola, y la acción DESPUÉS de cerrar: si abre otra hoja
    // (elegir sala → elegir motivo) tiene que encontrar el host libre.
    setTimeout(() => { despues?.(); if (cola.length && mostrar) mostrar(cola.shift()); }, 0);
  };
  const cancelar = () => {
    if (hoja.tipo === 'opciones') cerrar(() => hoja.alElegir(null));
    else { const b = hoja.botones.find((x) => x.style === 'cancel'); cerrar(() => b?.onPress?.()); }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={cancelar} statusBarTranslucent>
      <Pressable onPress={cancelar} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: hoja.tipo === 'opciones' ? 'flex-end' : 'center', padding: 16 }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: fondo, borderRadius: 24, paddingVertical: 12, maxHeight: '80%' }}>
          {hoja.titulo ? <Text style={{ color: tinta, fontSize: 18, fontWeight: '700', paddingHorizontal: 20, paddingTop: 8 }}>{hoja.titulo}</Text> : null}
          {hoja.mensaje ? <Text style={{ color: tenue, fontSize: 14, paddingHorizontal: 20, paddingTop: 6 }}>{hoja.mensaje}</Text> : null}
          {hoja.tipo === 'opciones' ? (
            <ScrollView style={{ marginTop: 8 }}>
              {hoja.opciones.filter((o) => !o.cancelar).map((o) => (
                <Pressable key={o.i} disabled={o.apagado} onPress={() => cerrar(() => hoja.alElegir(o.i))} accessibilityRole="button"
                  style={({ pressed }) => ({ minHeight: 52, justifyContent: 'center', paddingHorizontal: 20, opacity: o.apagado ? 0.4 : 1, backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
                  <Text style={{ fontSize: 16, color: o.destructivo ? '#FF3B30' : tinta }}>{o.texto}</Text>
                </Pressable>
              ))}
              {hoja.opciones.some((o) => o.cancelar) ? (
                <Pressable onPress={cancelar} accessibilityRole="button"
                  style={({ pressed }) => ({ minHeight: 52, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: tenue }}>{hoja.opciones.find((o) => o.cancelar).texto}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 12 }}>
              <TextInput value={texto} onChangeText={setTexto} autoFocus secureTextEntry={hoja.secreto} keyboardType={hoja.teclado}
                multiline={!hoja.secreto} placeholderTextColor={tenue}
                style={{ minHeight: 48, maxHeight: 140, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: tinta, backgroundColor: 'rgba(127,127,127,0.16)' }} />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                {hoja.botones.map((b, i) => (
                  <Pressable key={i} accessibilityRole="button" onPress={() => cerrar(() => b.onPress?.(texto))}
                    style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 12, backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
                    <Text style={{ fontSize: 16, fontWeight: b.style === 'cancel' ? '500' : '700', color: b.style === 'destructive' ? '#FF3B30' : b.style === 'cancel' ? tenue : '#8E1F8F' }}>{b.text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
