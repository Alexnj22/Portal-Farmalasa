// «Avísame cuando haya» (2026-11-09): en la ficha de un producto sin existencia.
// Se guarda en el servidor y avisos-clientes manda UN aviso cuando vuelve a
// haber en alguna sucursal; la solicitud se cierra sola a los 60 días.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useSesion } from '../lib/sesion';
import { suave, useTema } from '../tema/tema';

export default function BotonAvisame({ productoId, nombre, bloque = false }) {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  // null = todavía no se sabe.
  const [activo, setActivo] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);

  useEffect(() => {
    let vivo = true;
    pedir('avisame_ver', { product_id: productoId }).then((r) => { if (vivo) setActivo(r?.ok ? !!r.activo : false); });
    return () => { vivo = false; };
  }, [pedir, productoId]);

  const tocar = async () => {
    if (enviando.current || activo == null) return;
    enviando.current = true;
    setOcupado(true);
    Haptics.selectionAsync().catch(() => {});
    let r = null;
    try { r = await pedir('avisame', { product_id: productoId, activo: !activo }); } finally { enviando.current = false; setOcupado(false); }
    if (!r?.ok) { Alert.alert('No se pudo guardar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    setActivo(!!r.activo);
    if (r.activo) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert('Te avisaremos', `Recibirás un aviso cuando vuelva a haber ${nombre}.`);
    }
  };

  const etiqueta = activo ? 'Quitar el aviso de existencia' : 'Avísame cuando haya';
  const sf = activo ? 'bell.fill' : 'bell';
  const color = bloque ? (activo ? t.color.magentaTexto : '#FFFFFF') : t.color.magentaTexto;
  const carga = ocupado || activo == null;
  return (
    <Presionable onPress={tocar} disabled={carga} accessibilityRole="button" accessibilityLabel={etiqueta} accessibilityState={{ selected: !!activo, busy: carga }}
      style={({ pressed }) => ({ ...(bloque ? { flex: 1, paddingHorizontal: 14, borderRadius: 999, flexDirection: 'row', gap: 8 } : { width: 54, borderRadius: 27 }), minHeight: 54, alignItems: 'center', justifyContent: 'center',
        backgroundColor: bloque && !activo ? t.color.magenta : (activo ? suave(t.color.magenta, t.oscuro ? 0.4 : 0.22) : (t.oscuro ? '#2A2630' : '#FFFFFF')), transform: [{ scale: pressed ? 0.95 : 1 }],
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } })}>
      {carga ? <ActivityIndicator size="small" color={color} /> : <Icono sf={sf} respaldo="🔔" tam={bloque ? 17 : 21} color={color} />}
      {bloque ? <Text style={{ flexShrink: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: color ?? colorSistema.texto }}>{activo ? 'Te avisaremos' : 'Avísame cuando haya'}</Text> : null}
    </Presionable>
  );
}
