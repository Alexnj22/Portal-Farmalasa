// Nuestras sucursales (antes «salas»; rediseño pedido por el usuario,
// 2026-10-06). Cada una es una tarjeta con su color: el barrio en grande, si
// está abierta AHORA con la hora de cierre, la dirección, y tres acciones de un
// toque — cómo llegar (Mapas en iPhone, Google Maps en Android), WhatsApp y
// llamar —. El horario de la semana se despliega con resorte. Pública: se ve
// sin cuenta.
//
// Los nombres los da el servidor ya traducidos («Salud - San Antonio»): acá se
// parten en «Farmacia Salud» + «San Antonio» para el título.
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla } from '../componentes/ui';
import { Entrada, Latido } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { llamar } from '../lib/api';
import { useTema } from '../tema/tema';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
// Un par de colores por tarjeta, siempre de la marca (magenta, violeta, verde).
const DEGRADADOS = [
  ['#7A1A80', '#B0309E'], ['#4B1E8C', '#7B3FC4'], ['#3D6B0A', '#7FB212'],
  ['#8C1F5E', '#C2408A'], ['#2E2A7A', '#5B4FD0'], ['#5E1470', '#9C2D9C'],
];
const hora = (h) => {
  const m = String(h ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');
const partes = (nombre) => {
  const m = String(nombre).match(/^Salud\s*-\s*(.+)$/);
  return m ? ['Farmacia Salud', m[1]] : ['Farmacia', nombre];
};

export default function Sucursales() {
  const [datos, setDatos] = useState(null);
  useEffect(() => { llamar('salas').then(setDatos); }, []);

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false}><Aviso>No se pudieron cargar las sucursales.</Aviso></Pantalla>;
  const abiertas = datos.salas.filter((s) => s.abierta).length;

  return (
    <Pantalla conPestanas={false}>
      <Entrada indice={0}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto2, marginLeft: 4 }}>
          {abiertas ? `${abiertas} de ${datos.salas.length} abiertas ahora` : 'Todas cerradas en este momento'}
        </Text>
      </Entrada>
      {datos.salas.map((s, i) => (
        <Entrada key={s.id} indice={i + 1}>
          <TarjetaSucursal s={s} colores={DEGRADADOS[i % DEGRADADOS.length]} />
        </Entrada>
      ))}
    </Pantalla>
  );
}

function TarjetaSucursal({ s, colores }) {
  const t = useTema();
  const [abierta, setAbierta] = useState(false);
  const [ceja, titulo] = partes(s.nombre);
  const hoy = new Date(Date.now() - 6 * 3600_000).getUTCDay();
  const abrir = (url) => { Haptics.selectionAsync().catch(() => {}); Linking.openURL(url).catch(() => {}); };
  const mapa = () => {
    const q = encodeURIComponent(`Farmacia ${s.nombre}, ${s.direccion}, Chalatenango, El Salvador`);
    return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  };

  return (
    <Animated.View layout={LinearTransition.springify().damping(18)}
      style={{ borderRadius: 26, overflow: 'hidden', backgroundColor: t.oscuro ? '#1E1B24' : '#FFFFFF',
        shadowColor: colores[0], shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
      {/* La cabecera de color, con el barrio en grande. */}
      <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, paddingBottom: 16, gap: 6 }}>
        <Text style={{ position: 'absolute', right: -6, top: -18, fontSize: 120, fontWeight: '900', color: 'rgba(255,255,255,0.08)' }}>+</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(255,255,255,0.8)' }}>{ceja.toUpperCase()}</Text>
          <Estado abierta={s.abierta} />
        </View>
        <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 }}>{titulo}</Text>
        <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>
          {s.abierta ? `Abierta · cierra a las ${hora(s.cierra_hoy)}` : s.abre_hoy ? `Cerrada · abre a las ${hora(s.abre_hoy)}` : 'Cerrada hoy'}
        </Text>
      </LinearGradient>

      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Text style={{ fontSize: 16 }}>📍</Text>
          <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>{s.direccion}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Accion icono="🧭" texto="Cómo llegar" color={colores[0]} alTocar={() => abrir(mapa())} />
          {s.celular ? <Accion icono="💬" texto="WhatsApp" color="#1FA855" alTocar={() => abrir(`https://wa.me/503${soloDigitos(s.celular)}`)} /> : null}
          {s.telefono || s.celular ? <Accion icono="📞" texto="Llamar" color={colores[1]} alTocar={() => abrir(`tel:${soloDigitos(s.celular ?? s.telefono)}`)} /> : null}
        </View>

        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta((x) => !x); }} accessibilityRole="button"
          style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Horario de la semana</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>{abierta ? '▲' : '▼'}</Text>
        </Pressable>
        {abierta ? (
          <Animated.View entering={FadeIn.duration(220)} style={{ gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const h = s.horario.find((x) => x.dia === d);
              const esHoy = d === hoy;
              return (
                <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2,
                  ...(esHoy ? { backgroundColor: `${colores[0]}22`, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 8 } : null) }}>
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
    </Animated.View>
  );
}

function Estado({ abierta }) {
  const pill = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: abierta ? '#4CD964' : '#FF6B6B' }} />
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>{abierta ? 'ABIERTA' : 'CERRADA'}</Text>
    </View>
  );
  return abierta ? <Latido escala={1.04}>{pill}</Latido> : pill;
}

function Accion({ icono, texto, color, alTocar }) {
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({
        flex: 1, minHeight: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 4,
        backgroundColor: `${color}1F`, borderWidth: 1, borderColor: `${color}40`, transform: [{ scale: pressed ? 0.95 : 1 }],
      })}>
      <Text style={{ fontSize: 22 }}>{icono}</Text>
      <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}
