// «¡Subiste a Oro!» (2026-10-07): la primera vez que la app ve un nivel más
// alto que el último que mostró, una pantalla completa con los colores y el
// acabado del nivel, confeti y lo que gana. El último nivel visto se guarda en
// el teléfono; bajar de nivel no celebra nada (y se anota en silencio).
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORES_NIVEL } from './TarjetaSocio';
import EfectoNivel from './EfectoNivel';
import { BENEFICIOS } from './Nivel';
import { PRECIOS } from './Mayorista';
import { Confeti } from './animacion';
import Icono from './Icono';

// Mayoreo (2026-10-09): la misma pantalla celebra también subir de RANGO
// (Jade → Zafiro → Rubí → Diamante), pasar de precio Mayoreo a Mayoreo Plus
// y la primera vez que se ve aprobado como cliente de mayoreo. Cada cosa
// guarda en el teléfono lo último que vio; bajar no celebra (y se anota en
// silencio). La primera vez que se ve un rango o un precio sólo se anota:
// no se sabe de dónde venía.
const CLAVE = 'puntos_salud_ultimo_nivel';
const CLAVE_RANGO = 'puntos_salud_ultimo_rango';
const CLAVE_PRECIO = 'puntos_salud_ultimo_precio';
const CLAVE_BIENVENIDA = 'puntos_salud_mayoreo_bienvenida';
const ORDEN = { vip: 0, plata: 1, oro: 2, platino: 3 };
const ORDEN_RANGO = { jade: 0, zafiro: 1, rubi: 2, diamante: 3 };
const ORDEN_PRECIO = { mayoreo: 0, mayoreo_plus: 1 };
// La bienvenida es para quien acaban de aprobar: quien instala la app meses
// después de su aprobación no la ve (sin la fecha, se da por reciente).
const DIAS_BIENVENIDA = 45;

const leer = (k) => SecureStore.getItemAsync(k).catch(() => null);
const guardar = (k, v) => { SecureStore.setItemAsync(k, v).catch(() => {}); };
const precioDe = (m) => m?.precioClave ?? (m?.precio === PRECIOS.mayoreo_plus ? 'mayoreo_plus' : 'mayoreo');
const reciente = (f) => !f || (Date.now() - Date.parse(`${String(f).slice(0, 10)}T12:00:00`)) / 86400000 <= DIAS_BIENVENIDA;

const beneficiosRango = (m) => [`${m.puntos} pts por cada $1 a tu precio de mayoreo`, '1 punto por cada $1 a precio Preferente',
  `${m.cumpleanos} puntos en tu cumpleaños`, ...(m.raspable ? [`Raspable mensual ${m.raspable}`] : [])];
const pantallaNivel = (n) => ({ clave: n.clave, etiqueta: '¡SUBISTE DE NIVEL!', titulo: n.nombre, icono: ['crown.fill', '👑'],
  texto: 'Gracias por tu preferencia. Desde ahora ganas más con cada compra:', beneficios: BENEFICIOS[n.clave] ?? [] });
const pantallaRango = (m) => ({ clave: m.clave, etiqueta: '¡SUBISTE DE RANGO!', titulo: m.nombre, subtitulo: 'Cliente de mayoreo', icono: ['diamond.fill', '◆'],
  texto: `Tu compra promedio de los últimos tres meses te llevó a ${m.nombre}. Desde ahora:`, beneficios: beneficiosRango(m) });
const pantallaPrecio = (m) => ({ clave: m.clave, etiqueta: '¡NUEVO PRECIO!', titulo: 'Mayoreo Plus', subtitulo: 'Cliente de mayoreo', icono: ['tag.fill', '🏷️'],
  texto: 'Ahora tienes precio Mayoreo Plus. Muestra tu tarjeta en caja:', beneficios: ['Precio Mayoreo Plus en tus compras', 'En todas las sucursales', `Sigues en tu rango ${m.nombre}`] });
const pantallaBienvenida = (m) => ({ clave: m.clave, etiqueta: '¡BIENVENIDO!', titulo: 'Precio de mayoreo', subtitulo: `Cliente de mayoreo · ${m.nombre}`, icono: ['diamond.fill', '◆'],
  texto: 'Te aprobamos como cliente de mayoreo. Desde ahora:', beneficios: [`Precio ${PRECIOS[precioDe(m)] ?? 'Mayoreo'} en todas las sucursales`,
    `${m.puntos} pts por cada $1 a tu precio de mayoreo`, 'Tu rango sube con tu compra promedio de 3 meses'] });

let siguienteId = 0;

/**
 * `nivel`: el nivel de Puntos Salud. `mayoreo`: el rango del cliente de mayoreo
 * (`rangoReal` o `rangoDePrueba` de Mayorista.js), o null. Los `forzar*` la
 * muestran aunque ya se haya visto (modo de prueba y los avisos que la abren).
 */
export default function SubisteDeNivel({ nivel, forzar = false, mayoreo = null, forzarRango = false, forzarPrecio = false, forzarBienvenida = false }) {
  const [cola, setCola] = useState([]);
  const poner = (p) => setCola((c) => [...c, { ...p, id: ++siguienteId }]);
  // Modo de prueba / los avisos: se muestran aunque ya se hayan visto.
  useEffect(() => { if (forzar && nivel?.clave) poner(pantallaNivel(nivel)); }, [forzar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (forzarRango && mayoreo?.clave) poner(pantallaRango(mayoreo)); }, [forzarRango]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (forzarPrecio && mayoreo?.clave) poner(pantallaPrecio(mayoreo)); }, [forzarPrecio]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (forzarBienvenida && mayoreo?.clave) poner(pantallaBienvenida(mayoreo)); }, [forzarBienvenida]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!nivel?.clave) return;
    let vivo = true;
    leer(CLAVE).then((ultimo) => {
      if (!vivo) return;
      if (ultimo && (ORDEN[nivel.clave] ?? 0) > (ORDEN[ultimo] ?? 0)) poner(pantallaNivel(nivel));
      if (ultimo !== nivel.clave) guardar(CLAVE, nivel.clave);
    });
    return () => { vivo = false; };
  }, [nivel?.clave]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mayoreo: bienvenida la primera vez; después, subir de rango y de precio.
  const precio = mayoreo?.clave ? precioDe(mayoreo) : null;
  useEffect(() => {
    if (!mayoreo?.clave) return;
    let vivo = true;
    Promise.all([leer(CLAVE_BIENVENIDA), leer(CLAVE_RANGO), leer(CLAVE_PRECIO)]).then(([vista, ultRango, ultPrecio]) => {
      if (!vivo) return;
      if (!vista) {
        // La bienvenida ya cuenta el rango y el precio: no se celebran aparte.
        if (reciente(mayoreo.aprobadoDesde)) poner(pantallaBienvenida(mayoreo));
        guardar(CLAVE_BIENVENIDA, '1');
      } else {
        if (ultRango && (ORDEN_RANGO[mayoreo.clave] ?? 0) > (ORDEN_RANGO[ultRango] ?? 0)) poner(pantallaRango(mayoreo));
        if (ultPrecio && (ORDEN_PRECIO[precio] ?? 0) > (ORDEN_PRECIO[ultPrecio] ?? 0)) poner(pantallaPrecio(mayoreo));
      }
      if (ultRango !== mayoreo.clave) guardar(CLAVE_RANGO, mayoreo.clave);
      if (ultPrecio !== precio) guardar(CLAVE_PRECIO, precio);
    });
    return () => { vivo = false; };
  }, [mayoreo?.clave, precio]); // eslint-disable-line react-hooks/exhaustive-deps
  const actual = cola[0];
  if (!actual) return null;
  // Un solo Modal para toda la cola: cerrar uno y abrir otro en el mismo
  // instante falla en iOS. El `key` reinicia la animación de cada pantalla.
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setCola((c) => c.slice(1))} statusBarTranslucent>
      <Celebracion key={actual.id} p={actual} alCerrar={() => setCola((c) => c.slice(1))} />
    </Modal>
  );
}

function Celebracion({ p, alCerrar }) {
  const ins = useSafeAreaInsets();
  const { height: alto } = useWindowDimensions();
  const paleta = COLORES_NIVEL[p.clave] ?? COLORES_NIVEL.vip;
  const corona = useSharedValue(0);
  const texto = useSharedValue(0);
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    corona.value = withSequence(withSpring(1.15, { damping: 10, stiffness: 120 }), withSpring(1, { damping: 14 }));
    texto.value = withDelay(350, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [corona, texto]);
  const eCorona = useAnimatedStyle(() => ({ transform: [{ scale: corona.value }, { rotate: `${(1 - Math.min(1, corona.value)) * -20}deg` }] }));
  const eTexto = useAnimatedStyle(() => ({ opacity: texto.value, transform: [{ translateY: (1 - texto.value) * 20 }] }));
  const colores = p.clave === 'oro' ? ['#FFD45E', '#FFF6D5', '#E5AE34', '#FFFFFF']
    : p.clave === 'platino' ? ['#7DF9FF', '#FF6EC7', '#B4FF7D', '#FFFFFF']
      // Las piedras del mayoreo: el confeti con el color de la piedra.
      : ORDEN_RANGO[p.clave] !== undefined ? [paleta.acento, '#FFFFFF', paleta.frente[1], paleta.acento]
        : ['#FFFFFF', '#C3CAD4', '#8EC30F', '#E5E9EF'];
  // Medidas (2026-10-09, «el contenido no cabe en la card y se sale»): el
  // bloque de texto ocupa TODO el ancho útil —antes se medía por su contenido
  // y la fila de beneficios crecía sin tope hacia los lados—, el contenido va
  // en un ScrollView por si el texto del sistema está muy grande, y en
  // pantallas bajas (iPhone SE) todo se achica un poco. El botón queda fijo
  // abajo, siempre a la vista.
  const compacta = alto < 720;
  const disco = compacta ? 88 : 120;
  return (
      <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
        <EfectoNivel nivel={p.clave} activa x={null} />
        {/* Un velo oscuro para que el texto blanco se lea sobre plata y oro. */}
        <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <ScrollView style={{ flex: 1 }} bounces={false} showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: compacta ? 12 : 18,
            paddingTop: ins.top + (compacta ? 16 : 24), paddingBottom: 16, paddingLeft: Math.max(24, ins.left + 16), paddingRight: Math.max(24, ins.right + 16) }}>
          {/* Margen para el rebote del disco (escala 1.15): no se recorta. */}
          <View style={{ padding: disco * 0.08 }}>
            <Animated.View style={[{ width: disco, height: disco, borderRadius: disco / 2, alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' }, eCorona]}>
              <Icono sf={p.icono[0]} respaldo={p.icono[1]} tam={Math.round(disco * 0.46)} color="#FFFFFF" />
            </Animated.View>
          </View>
          <Animated.View style={[{ alignSelf: 'stretch', alignItems: 'center', gap: compacta ? 8 : 10, maxWidth: 440, width: '100%' }, eTexto]}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: paleta.acento ?? '#FFFFFF', fontSize: compacta ? 13 : 15, fontWeight: '900', letterSpacing: compacta ? 2 : 3, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 }}>{p.etiqueta}</Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.5} numberOfLines={1} maxFontSizeMultiplier={1.2}
              style={{ alignSelf: 'stretch', textAlign: 'center', color: '#FFFFFF', fontSize: compacta ? 36 : 44, fontWeight: '900', letterSpacing: -1, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 12 }}>{p.titulo}</Text>
            {p.subtitulo ? (
              <Text maxFontSizeMultiplier={1.3} style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', opacity: 0.9, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 }}>{p.subtitulo}</Text>
            ) : null}
            <Text maxFontSizeMultiplier={1.3} style={{ color: '#FFFFFF', fontSize: compacta ? 15 : 16, lineHeight: compacta ? 20 : 22, textAlign: 'center', maxWidth: 320, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 }}>
              {p.texto}
            </Text>
            <View style={{ gap: compacta ? 8 : 10, marginTop: 6, alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20,
              paddingHorizontal: 16, paddingVertical: compacta ? 12 : 16 }}>
              {p.beneficios.map((b) => (
                <View key={b} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ paddingTop: 2 }}>
                    <Icono sf="checkmark.seal.fill" respaldo="✓" tam={16} color={paleta.acento ?? '#FFFFFF'} />
                  </View>
                  <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, flexShrink: 1, color: '#FFFFFF', fontSize: compacta ? 14 : 15, lineHeight: compacta ? 19 : 20, fontWeight: '600' }}>{b}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
        </ScrollView>
        <Pressable onPress={alCerrar} accessibilityRole="button"
          style={({ pressed }) => ({ marginHorizontal: Math.max(24, ins.left + 16), marginTop: 8, marginBottom: Math.max(ins.bottom, 12) + (compacta ? 12 : 20),
            minHeight: compacta ? 50 : 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#FFFFFF', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: '#1A1320', fontSize: 17, fontWeight: '900' }}>¡Genial!</Text>
        </Pressable>
        <Confeti colores={colores} alTerminar={() => {}} />
      </LinearGradient>
  );
}
