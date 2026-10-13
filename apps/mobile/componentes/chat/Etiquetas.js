// Las etiquetas de una conversación del chat (medicamento, receta, reserva,
// queja, precio, seguimiento, urgente, frecuente): fichas de color, y en la
// conversación un botón para cambiarlas con `chat_etiquetar` (la misma del
// portal). El catálogo es `ETIQUETAS` de `@nucleo/utils/chatClientes`, el del portal.
import { memo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ETIQUETAS, etiquetasDe } from '@nucleo/utils/chatClientes';
import { alternarEtiqueta } from '@nucleo/utils/chatPersonal';
import { etiquetarConversacion } from '@nucleo/data/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const ANDROID = Platform.OS === 'android';
// El color de cada variante del catálogo (el núcleo da la variante del portal:
// `danger`, `warning`, `chart-N`), en los de la marca.
const COLOR_DE_VARIANTE = {
  danger: MARCA.rojo, warning: MARCA.ambar, 'chart-1': MARCA.azul, 'chart-3': '#981D97', 'chart-4': MARCA.verde,
  'chart-6': MARCA.violeta, 'chart-8': MARCA.azulClaro, 'chart-9': '#0BA5EC',
};
const colorDe = (e) => COLOR_DE_VARIANTE[e.variant] ?? MARCA.azul;
// Las etiquetas como objetos `{ clave, rotulo, variant }`, en el orden del catálogo.
const comoFichas = (claves) => claves.map((k) => ({ clave: k, rotulo: ETIQUETAS[k].label, variant: ETIQUETAS[k].variant }));

function Ficha({ e, elegida, onPress, chica }) {
  const contenido = (
    <Text style={{ color: elegida === false ? colorSistema.texto2 : colorDe(e), fontSize: chica ? 11 : 14, fontWeight: '700' }}>
      {elegida ? `✓ ${e.rotulo}` : e.rotulo}
    </Text>
  );
  const estilo = { paddingHorizontal: chica ? 7 : 12, minHeight: chica ? 20 : 36, borderRadius: chica ? 10 : 18, justifyContent: 'center',
    backgroundColor: elegida === false ? 'rgba(127,127,127,0.12)' : `${colorDe(e)}22`,
    borderWidth: elegida === undefined ? 0 : 1, borderColor: elegida ? colorDe(e) : 'transparent' };
  if (!onPress) return <View style={estilo}>{contenido}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: !!elegida }}
      android_ripple={ANDROID ? { color: `${colorDe(e)}33` } : undefined}
      style={({ pressed }) => [estilo, { transform: [{ scale: !ANDROID && pressed ? 0.95 : 1 }] }]}>
      {contenido}
    </Pressable>
  );
}

/** Las fichas de una conversación (la bandeja): sólo lectura. */
export const FichasDeEtiquetas = memo(function FichasDeEtiquetas({ conversacion }) {
  const lista = comoFichas(etiquetasDe(conversacion));
  if (!lista.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {lista.map((e) => <Ficha key={e.clave} e={e} chica />)}
    </View>
  );
});

/** En la conversación: las fichas y «Etiquetar», que abre el selector. */
export function EtiquetasDeConversacion({ conversacion, puedeEditar, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [elegidas, setElegidas] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const abajo = useSafeAreaInsets().bottom;
  if (!conversacion) return null;
  const actuales = comoFichas(etiquetasDe(conversacion));

  const abrir = () => { setElegidas(actuales.map((e) => e.clave)); setAbierto(true); };
  const guardar = async () => {
    setGuardando(true);
    try {
      await etiquetarConversacion(conversacion.id, elegidas, actuales.map((e) => e.clave));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCambio?.(elegidas);
      listo('Etiquetas guardadas');
      setAbierto(false);
    } catch (e) { fallo('No se pudieron guardar', mensajeAmigable(e)); }
    finally { setGuardando(false); }
  };

  if (!actuales.length && !puedeEditar) return null;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {actuales.map((e) => <Ficha key={e.clave} e={e} />)}
        {puedeEditar ? (
          <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel="Etiquetar la conversación" hitSlop={6}
            android_ripple={ANDROID ? { color: 'rgba(127,127,127,0.2)' } : undefined}
            style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center',
              borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(127,127,127,0.5)', opacity: !ANDROID && pressed ? 0.6 : 1 })}>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>{actuales.length ? 'Cambiar etiquetas' : '+ Etiquetar'}</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={abierto} transparent animationType="slide" onRequestClose={() => setAbierto(false)}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={() => setAbierto(false)} accessibilityLabel="Cerrar" />
        <View style={{ marginTop: 'auto', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colorSistema.fila,
          paddingHorizontal: 20, paddingTop: 10, paddingBottom: abajo + 16, gap: 14 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.4)' }} />
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700' }}>Etiquetas de la conversación</Text>
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {comoFichas(Object.keys(ETIQUETAS)).map((e) => (
              <Ficha key={e.clave} e={e} elegida={elegidas.includes(e.clave)}
                onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegidas((l) => alternarEtiqueta(l, e.clave, ETIQUETAS)); }} />
            ))}
          </ScrollView>
          <Pressable onPress={guardar} disabled={guardando} accessibilityRole="button"
            android_ripple={ANDROID ? { color: 'rgba(255,255,255,0.25)' } : undefined}
            style={({ pressed }) => ({ minHeight: 50, borderRadius: ANDROID ? 25 : 14, alignItems: 'center', justifyContent: 'center',
              backgroundColor: MARCA.azul, opacity: guardando ? 0.6 : !ANDROID && pressed ? 0.85 : 1 })}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{guardando ? 'Guardando…' : 'Guardar'}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
