// La hoja de opciones en el NAVEGADOR (app.farmasalud.lat, 2026-11-14): la
// hoja de acciones del iPhone — un grupo de vidrio abajo con las opciones y,
// separado, el botón de cancelar en negrita. La pide `ActionSheetIOS` (que en
// la web agrega entrada.web.js) a través de <HojasAndroid />, igual que en
// Android.
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

export default function HojaDeOpciones({ hoja, cerrar, cancelar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') cancelar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });
  const vidrio = {
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: t.oscuro ? 'rgba(44,42,50,0.88)' : 'rgba(246,245,250,0.92)',
    backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)',
  };
  const linea = t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.22)';
  const azul = t.color.magentaTexto ?? t.color.magenta;
  const cancel = hoja.opciones.find((o) => o.cancelar);
  const fila = (pressed) => ({ minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, cursor: 'pointer', backgroundColor: pressed ? linea : 'transparent' });
  return (
    <View role="dialog" aria-modal aria-label={hoja.titulo || 'Opciones'}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.38)' }}>
      <Pressable accessibilityLabel="Cerrar" onPress={cancelar} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'default' }} />
      <View style={{ width: '100%', maxWidth: 520, paddingHorizontal: 8, paddingBottom: Math.max(ins.bottom, 8), gap: 8 }}>
        <View style={vidrio}>
          {hoja.titulo || hoja.mensaje ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 4, borderBottomWidth: 1, borderBottomColor: linea }}>
              {hoja.titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{hoja.titulo}</Text> : null}
              {hoja.mensaje ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>{hoja.mensaje}</Text> : null}
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 420 }}>
            {hoja.opciones.filter((o) => !o.cancelar).map((o, n) => (
              <Pressable key={o.i} disabled={o.apagado} accessibilityRole="button" onPress={() => cerrar(() => hoja.alElegir(o.i))}
                style={({ pressed }) => ({ ...fila(pressed), opacity: o.apagado ? 0.4 : 1, borderTopWidth: n ? 1 : 0, borderTopColor: linea })}>
                <Text style={{ fontSize: 19, textAlign: 'center', color: o.destructivo ? colorSistema.rojo : azul }}>{o.texto}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={vidrio}>
          <Pressable accessibilityRole="button" onPress={cancelar} style={({ pressed }) => fila(pressed)}>
            <Text style={{ fontSize: 19, fontWeight: '600', color: azul }}>{cancel?.texto ?? 'Cancelar'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
