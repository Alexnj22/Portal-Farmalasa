// `Alert.alert` en el NAVEGADOR (app.farmasalud.lat, 2026-11-14).
//
// En react-native-web `Alert.alert` no hace NADA: ni muestra el mensaje ni
// llama a ningún botón. La app lo usa en ~120 lugares —las confirmaciones
// («¿Quitar de mi lista?»), los errores («No se pudo guardar»)— y en la web
// todo eso desaparecía en silencio: «no me deja quitar de mis tratamientos»
// era la confirmación que nunca salía.
//
// `instalarAlertaWeb()` (la llama entrada.web.js antes de pintar) reemplaza
// `Alert.alert` por una cola, y `<AlertaWeb />` (montado en app/_layout.js)
// la muestra como la alerta del iPhone: tarjeta centrada de vidrio, título,
// mensaje y botones —dos en fila, tres o más en columna—, «cancel» en negrita
// y «destructive» en rojo. Misma firma que la de React Native, así que ninguna
// pantalla cambia.
import { useEffect } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { create } from 'zustand';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

const useCola = create((set) => ({
  cola: [],
  poner: (a) => set((s) => ({ cola: [...s.cola, a] })),
  sacar: () => set((s) => ({ cola: s.cola.slice(1) })),
}));

export function instalarAlertaWeb() {
  if (Platform.OS !== 'web') return;
  Alert.alert = (titulo, mensaje, botones, opciones) => {
    const lista = Array.isArray(botones) && botones.length ? botones : [{ text: 'OK' }];
    useCola.getState().poner({ titulo: titulo ?? '', mensaje: mensaje ?? '', botones: lista, opciones: opciones ?? {} });
  };
}

export default function AlertaWeb() {
  const t = useTema();
  const actual = useCola((s) => s.cola[0]);
  const sacar = useCola((s) => s.sacar);

  const tocar = (b) => {
    sacar();
    // Como en el teléfono: la alerta se cierra y DESPUÉS corre la acción.
    if (b?.onPress) setTimeout(() => b.onPress(), 0);
  };
  const cancelar = () => {
    const c = actual?.botones.find((b) => b.style === 'cancel');
    if (c) tocar(c);
    else if (actual?.opciones?.cancelable) { sacar(); actual.opciones.onDismiss?.(); }
  };

  // Escape = cancelar; Enter = el botón principal (el último que no cancela).
  useEffect(() => {
    if (!actual || typeof window === 'undefined') return undefined;
    const tecla = (e) => {
      if (e.key === 'Escape') cancelar();
      if (e.key === 'Enter') {
        const p = [...actual.botones].reverse().find((b) => b.style !== 'cancel') ?? actual.botones[0];
        tocar(p);
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  if (!actual) return null;
  const { titulo, mensaje, botones } = actual;
  // iOS: con dos botones, el de cancelar va a la izquierda; con más, abajo.
  const enFila = botones.length === 2;
  const ordenados = enFila
    ? [...botones].sort((a, b) => (a.style === 'cancel' ? -1 : 0) - (b.style === 'cancel' ? -1 : 0))
    : [...botones.filter((b) => b.style !== 'cancel'), ...botones.filter((b) => b.style === 'cancel')];
  const linea = t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.22)';
  const azul = t.color.magentaTexto ?? t.color.magenta;

  return (
    <View
      role="alertdialog"
      aria-modal
      aria-label={titulo}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.38)', padding: 24 }}>
      <Pressable accessible={false} onPress={cancelar} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'default' }} />
      <View
        style={{
          width: 280, maxWidth: '100%', borderRadius: 16, overflow: 'hidden',
          backgroundColor: t.oscuro ? 'rgba(44,42,50,0.86)' : 'rgba(246,245,250,0.9)',
          backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}>
        <View style={{ paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18, gap: 4 }}>
          {titulo ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{titulo}</Text> : null}
          {mensaje ? <Text style={{ color: colorSistema.texto, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>{mensaje}</Text> : null}
        </View>
        <View style={{ flexDirection: enFila ? 'row' : 'column', borderTopWidth: 1, borderTopColor: linea }}>
          {ordenados.map((b, i) => (
            <Pressable
              key={`${b.text}-${i}`}
              accessibilityRole="button"
              onPress={() => tocar(b)}
              style={({ pressed, hovered }) => ({
                flex: enFila ? 1 : undefined, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
                borderLeftWidth: enFila && i > 0 ? 1 : 0, borderLeftColor: linea,
                borderTopWidth: !enFila && i > 0 ? 1 : 0, borderTopColor: linea,
                backgroundColor: pressed ? linea : hovered ? (t.oscuro ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)') : 'transparent',
                cursor: 'pointer',
              })}>
              <Text style={{
                fontSize: 17,
                fontWeight: b.style === 'cancel' ? '600' : '400',
                color: b.style === 'destructive' ? colorSistema.rojo : azul,
              }}>
                {b.text}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
