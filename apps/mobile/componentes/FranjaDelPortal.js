// La franja de aviso del portal (`BannerPortal.jsx`) en la app: el mismo
// aviso que se enciende desde Sistema › Mantenimiento, en vivo
// (`useBannerPortal`, del núcleo, escucha la tabla por tiempo real).
//
// En el portal es una franja fija arriba de TODAS las vistas. En el teléfono
// esa franja taparía la barra de navegación del sistema, así que va como una
// tarjeta al tope de Inicio y del Menú —las dos pantallas por las que se
// entra—, con el texto corto como en la pantalla chica del portal y el largo
// al tocarla. Si la base no contesta, no se pinta nada (como allá).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Host, Icon } from '@expo/ui';
import { useBannerPortal } from '@nucleo/hooks/useBannerPortal';
import { iconoDe } from '../tema/iconos';
import { MARCA } from './inicio/marca';

// Las cinco apariencias del portal. `obra` es su naranja de obra con texto
// oscuro; las otras, el tono de su variante.
const APARIENCIA = {
  obra: { fondo: '#F2A93B', texto: '#2B1C02', icono: 'AlertTriangle' },
  aviso: { fondo: MARCA.ambar, texto: '#FFFFFF', icono: 'AlertTriangle' },
  problema: { fondo: MARCA.rojo, texto: '#FFFFFF', icono: 'AlertTriangle' },
  info: { fondo: MARCA.azul, texto: '#FFFFFF', icono: 'Bell' },
  bien: { fondo: MARCA.verde, texto: '#FFFFFF', icono: 'Bell' },
};

export default function FranjaDelPortal({ margen = 16 }) {
  const { banner } = useBannerPortal();
  const [largo, setLargo] = useState(false);
  const texto = String(banner?.texto || '').trim();
  if (!banner?.activo || !texto) return null;
  const corto = String(banner.texto_corto || '').trim() || texto;
  const a = APARIENCIA[banner.variante] || APARIENCIA.obra;
  const hayMas = corto !== texto;
  return (
    <Pressable accessibilityRole="text" disabled={!hayMas} onPress={() => setLargo((v) => !v)}
      style={{ marginHorizontal: margen }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11,
        borderRadius: 16, backgroundColor: a.fondo }}>
        <Host matchContents><Icon name={iconoDe(a.icono)} size={18} color={a.texto} /></Host>
        <Text style={{ flex: 1, color: a.texto, fontSize: 15, fontWeight: '700', lineHeight: 20 }}>{largo ? texto : corto}</Text>
      </View>
    </Pressable>
  );
}
