// Nuestras sucursales (2026-10-06). Todas en el mismo vidrio del sistema (el
// usuario pidió quitar los colores distintos): el nombre («La Salud - San
// Antonio», ya traducido por el servidor), si está abierta AHORA con la hora
// de cierre, la dirección y tres acciones de un toque — cómo llegar (Mapas en
// iPhone, Google Maps en Android), WhatsApp y llamar —. El horario de la
// semana se despliega con una animación corta y sin rebote (con resorte se
// veía raro). Pública.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Vidrio from '../componentes/Vidrio';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla } from '../componentes/ui';
import Icono from '../componentes/Icono';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { llamar } from '../lib/api';
import { useTema } from '../tema/tema';

// Fotos de stock (Unsplash, licencia libre) mientras cada sucursal no tenga la
// suya en `branches.settings.foto_app`. Se alternan para que no se vean iguales.
const STOCK = [require('../assets/sucursal-1.jpg'), require('../assets/sucursal-2.jpg')];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const hora = (h) => {
  const m = String(h ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');

export default function Sucursales() {
  const [datos, setDatos] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  // Al volver a la pantalla se pide de nuevo («abierta» cambia con la hora), y
  // un fallo de red no borra lo que ya se veía.
  const cargar = useCallback(async () => { const r = await llamar('salas'); setDatos((ant) => (r?.ok || !ant?.ok ? r : ant)); }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Aviso>No se pudieron cargar las sucursales. Desliza hacia abajo para reintentar.</Aviso></Pantalla>;
  const abiertas = datos.salas.filter((s) => s.abierta).length;

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Entrada indice={0}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto2, marginLeft: 4 }}>
          {abiertas ? `${abiertas} de ${datos.salas.length} abiertas ahora` : 'Todas cerradas en este momento'}
        </Text>
      </Entrada>
      {datos.salas.map((s, i) => (
        <Entrada key={s.id} indice={i + 1}>
          <TarjetaSucursal s={s} indice={i} />
        </Entrada>
      ))}
    </Pantalla>
  );
}

function TarjetaSucursal({ s, indice }) {
  const t = useTema();
  const [abierta, setAbierta] = useState(false);
  const rotacion = useSharedValue(0);
  useEffect(() => { rotacion.value = withTiming(abierta ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) }); }, [abierta, rotacion]);
  const giro = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotacion.value * 180}deg` }] }));
  const hoy = new Date(Date.now() - 6 * 3600_000).getUTCDay();
  const abrir = (url) => { Haptics.selectionAsync().catch(() => {}); Linking.openURL(url).catch(() => {}); };
  const mapa = () => {
    const q = encodeURIComponent(`Farmacia ${s.nombre}, ${s.direccion}, Chalatenango, El Salvador`);
    return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  };

  return (
    // La tarjeta acompaña el cambio de alto con una curva corta (220 ms, sin
    // rebote) y el horario aparece con un fundido suave. La primera versión
    // usaba un resorte sobre la tarjeta entera y se veía raro.
    <Animated.View layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}>
    <Vidrio radio={26}>
      {/* La foto: la real de la sucursal cuando se suba; mientras, una de stock. */}
      <View style={{ height: 150, overflow: 'hidden' }}>
        <ImagenCache source={s.foto ? { uri: s.foto, cacheKey: s.foto_clave ?? undefined } : STOCK[indice % STOCK.length]}
          cachePolicy="memory-disk" contentFit="cover" transition={200} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ position: 'absolute', top: 12, right: 12 }}><Estado abierta={s.abierta} /></View>
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 12, gap: 2 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 }} numberOfLines={1}>{s.nombre}</Text>
          <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>
            {s.abierta ? `Cierra a las ${hora(s.cierra_hoy)}` : s.abre_hoy ? `Abre a las ${hora(s.abre_hoy)}` : 'Cerrada hoy'}
          </Text>
        </View>
      </View>
    <View style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <Icono sf="mappin.and.ellipse" respaldo="📍" tam={16} color={colorSistema.texto2} />
        <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>{s.direccion}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Accion sf="map.fill" respaldo="🧭" texto="Cómo llegar" alTocar={() => abrir(mapa())} />
        {s.celular ? <Accion sf="message.fill" respaldo="💬" texto="WhatsApp" alTocar={() => abrir(`https://wa.me/503${soloDigitos(s.celular)}`)} /> : null}
        {s.telefono || s.celular ? <Accion sf="phone.fill" respaldo="📞" texto="Llamar" alTocar={() => abrir(`tel:${soloDigitos(s.celular ?? s.telefono)}`)} /> : null}
      </View>

      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta((x) => !x); }} accessibilityRole="button"
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Horario de la semana</Text>
        <Animated.View style={giro}>
          <Icono sf="chevron.down" respaldo="▼" tam={14} color={t.color.magentaTexto} />
        </Animated.View>
      </Pressable>
      {abierta ? (
        <Animated.View entering={FadeIn.duration(220).delay(60)} exiting={FadeOut.duration(120)} style={{ gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const h = s.horario.find((x) => x.dia === d);
            const esHoy = d === hoy;
            return (
              <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: esHoy ? '800' : '500', color: colorSistema.texto }}>{esHoy ? `${DIAS[d]} · hoy` : DIAS[d]}</Text>
                <Text style={{ fontSize: 15, fontWeight: esHoy ? '800' : '500', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>
                  {h?.abre ? `${hora(h.abre)} – ${hora(h.cierra)}` : 'Cerrado'}
                </Text>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
    </Vidrio>
    </Animated.View>
  );
}

function Estado({ abierta }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: abierta ? '#34C759' : '#FF453A' }} />
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>{abierta ? 'Abierta' : 'Cerrada'}</Text>
    </View>
  );
}

function Accion({ sf, respaldo, texto, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({
        flex: 1, minHeight: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 5,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', transform: [{ scale: pressed ? 0.96 : 1 }],
      })}>
      <Icono sf={sf} respaldo={respaldo} tam={20} color={t.color.magentaTexto} />
      <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}
