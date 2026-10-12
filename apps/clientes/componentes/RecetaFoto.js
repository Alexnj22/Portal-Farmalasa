// «Foto de tu receta» (2026-10-12): el paso que aparece ANTES de confirmar una
// reserva o un pedido con un producto bajo receta. Se toma o se elige la foto
// (lib/fotos.js la achica), se revisa en grande con zoom antes de aceptarla
// (componentes/VistaPreviaFoto, 2026-10-12) y queda en miniatura; se sube
// recién al confirmar, cuando ya existe la reserva a la que pertenece.
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { PISTA_RECETA, usarVistaPreviaFoto } from './VistaPreviaFoto';
import { suave, useTema } from '../tema/tema';

export default function RecetaFoto({ foto, alCambiar, superficie }) {
  const t = useTema();
  const vistaPrevia = usarVistaPreviaFoto();
  const elegir = async () => {
    Haptics.selectionAsync().catch(() => {});
    const r = await vistaPrevia.elegir({
      titulo: 'Foto de tu receta', mensaje: 'Que se lean bien el nombre del medicamento, la firma y el sello del médico.', pista: PISTA_RECETA,
    });
    if (r) alCambiar(r);
  };
  return (
    <View style={{ backgroundColor: superficie ?? (t.oscuro ? 'rgba(255,255,255,0.08)' : '#FFFFFF'), borderRadius: 18, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
          <Icono sf="doc.text.viewfinder" respaldo="📄" tam={18} color={t.color.magentaTexto} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colorSistema.texto }}>Foto de tu receta</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
            Es un producto bajo receta. La sucursal la revisa y, cuando la aprueba, tu reserva queda confirmada.
          </Text>
        </View>
      </View>
      {foto?.uri ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image source={{ uri: foto.uri }} style={{ width: 72, height: 96, borderRadius: 10, backgroundColor: colorSistema.separador }} contentFit="cover"
            accessibilityLabel="Foto de tu receta" />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icono sf="checkmark.circle.fill" respaldo="✓" tam={15} color={t.color.exitoTexto} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.exitoTexto }}>Lista para enviar</Text>
            </View>
            <Pressable onPress={elegir} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Cambiar foto</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={elegir} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 14,
            borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.color.magenta, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Icono sf="camera.fill" respaldo="📷" tam={17} color={t.color.magentaTexto} />
          <Text style={{ fontSize: 16, fontWeight: '800', color: t.color.magentaTexto }}>Tomar o elegir la foto</Text>
        </Pressable>
      )}
      {vistaPrevia.vista}
    </View>
  );
}
