// Nuestras salas: dirección, horario de hoy (y si está abierta AHORA), y tres
// acciones de un toque: llamar, escribir por WhatsApp y cómo llegar (abre
// Mapas de Apple en iPhone, Google Maps en Android). Pública: se ve sin cuenta.
//
// «Cómo llegar» busca por la DIRECCIÓN escrita: la tabla de salas no guarda
// coordenadas. Si algún día las tiene, la búsqueda se cambia por el punto.
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Aviso, Cargando, Pantalla, Tarjeta } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { llamar } from '../lib/api';
import { suave, useTema } from '../tema/tema';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const hora = (h) => {
  const m = String(h ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');

export default function Salas() {
  const t = useTema();
  const [datos, setDatos] = useState(null);
  const [abierta, setAbierta] = useState(null);
  useEffect(() => { llamar('salas').then(setDatos); }, []);

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false}><Aviso>No se pudieron cargar las salas.</Aviso></Pantalla>;
  const hoy = new Date(Date.now() - 6 * 3600_000).getUTCDay();

  const abrir = (url) => { Haptics.selectionAsync().catch(() => {}); Linking.openURL(url).catch(() => {}); };
  const mapa = (s) => {
    const q = encodeURIComponent(`Farmacia ${s.nombre}, ${s.direccion}, Chalatenango, El Salvador`);
    return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  };

  return (
    <Pantalla conPestanas={false}>
      {datos.salas.map((s, i) => (
        <Entrada key={s.id} indice={i}>
          <Tarjeta estilo={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>{s.nombre}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: suave(s.abierta ? '#34C759' : '#FF3B30', 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.abierta ? '#34C759' : '#FF3B30' }} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: s.abierta ? (t.oscuro ? '#7EE08F' : '#1E7B34') : (t.oscuro ? '#FF8A80' : '#B3261E') }}>
                  {s.abierta ? `Abierta · cierra ${hora(s.cierra_hoy)}` : s.abre_hoy ? `Cerrada · abre ${hora(s.abre_hoy)}` : 'Cerrada hoy'}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>{s.direccion}</Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Accion icono="📍" texto="Cómo llegar" color={t.color.magenta} alTocar={() => abrir(mapa(s))} />
              {s.celular ? <Accion icono="💬" texto="WhatsApp" color="#25D366" alTocar={() => abrir(`https://wa.me/503${soloDigitos(s.celular)}`)} /> : null}
              {s.telefono || s.celular ? <Accion icono="📞" texto="Llamar" color={t.color.verde} alTocar={() => abrir(`tel:${soloDigitos(s.celular ?? s.telefono)}`)} /> : null}
            </View>

            <Pressable onPress={() => setAbierta(abierta === s.id ? null : s.id)} accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>
                {abierta === s.id ? 'Ocultar horario' : 'Ver horario de la semana'}
              </Text>
            </Pressable>
            {abierta === s.id ? (
              <View style={{ gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const h = s.horario.find((x) => x.dia === d);
                  return (
                    <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 15, fontWeight: d === hoy ? '800' : '500', color: colorSistema.texto }}>{DIAS[d]}</Text>
                      <Text style={{ fontSize: 15, fontWeight: d === hoy ? '800' : '500', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>
                        {h?.abre ? `${hora(h.abre)} – ${hora(h.cierra)}` : 'Cerrado'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </Tarjeta>
        </Entrada>
      ))}
    </Pantalla>
  );
}

function Accion({ icono, texto, color, alTocar }) {
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({
        flex: 1, minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2,
        backgroundColor: suave(color, 0.16), transform: [{ scale: pressed ? 0.96 : 1 }],
      })}>
      <Text style={{ fontSize: 18 }}>{icono}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}
