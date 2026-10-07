// Pedir por encargo (2026-10-07): el producto no está en ninguna sucursal. Se
// elige cantidad, dónde retirarlo y una nota; la sala y Bodega reciben la
// solicitud y confirman precio y fecha. El cliente paga el anticipo después,
// cuando ya sabe cuánto cuesta y cuándo llega.
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton } from './ui';
import { useSesion } from '../lib/sesion';
import { nombreProducto } from '../lib/catalogo';
import { suave, useTema } from '../tema/tema';

export default function EncargoHoja({ producto, presentacion, salas, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const token = useSesion((s) => s.token);
  const [cant, setCant] = useState(1);
  const [sala, setSala] = useState(salas?.[0]?.id ?? null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const [error, setError] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  const enviar = async () => {
    if (enviando || !sala) return;
    setEnviando(true); setError(null);
    const r = await pedir('encargar', { product_id: producto.id, factor: presentacion?.factor ?? 1, cantidad: cant, branch_id: sala, nota: nota.trim() || null });
    setEnviando(false);
    if (!r?.ok) { setError(r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setHecho(r.codigo);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={alCerrar}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>{hecho ? '¡Solicitud enviada!' : 'Pedir por encargo'}</Text>
          <Pressable onPress={alCerrar} hitSlop={12} accessibilityRole="button"><Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text></Pressable>
        </View>
        {!token ? (
          <Text style={{ padding: 18, fontSize: 15, color: colorSistema.texto2 }}>Entra con tu cuenta de Puntos Salud para pedir por encargo.</Text>
        ) : hecho ? (
          <View style={{ padding: 18, gap: 14, alignItems: 'center' }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.verde, 0.25) }}>
              <Icono sf="paperplane.fill" respaldo="✓" tam={26} color={t.color.verdeTexto} />
            </View>
            <Text style={{ fontSize: 22, fontWeight: '900', color: colorSistema.texto, letterSpacing: 2 }}>{hecho}</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2, textAlign: 'center' }}>
              La sucursal y Bodega revisan si lo pueden conseguir. Te avisamos con el precio y la fecha estimada; ahí decides si lo confirmas pagando el anticipo.
            </Text>
            <View style={{ alignSelf: 'stretch' }}><Boton alTocar={alCerrar}>Listo</Boton></View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 16 }}>
            <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{nombreProducto(producto.nombre)}</Text>
              {presentacion ? <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>{nombreProducto(presentacion.tipo)}</Text> : null}
              <Text style={{ fontSize: 13, color: colorSistema.texto3, marginTop: 4 }}>Hoy no hay en ninguna sucursal. Pídelo y te lo conseguimos.</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: 18, padding: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Cantidad</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Paso sf="minus" etiqueta="Menos" habilitado={cant > 1} alTocar={() => setCant((c) => c - 1)} />
                <Text style={{ fontSize: 18, fontWeight: '900', color: colorSistema.texto, minWidth: 22, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{cant}</Text>
                <Paso sf="plus" etiqueta="Más" habilitado={cant < 20} alTocar={() => setCant((c) => c + 1)} />
              </View>
            </View>

            <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>Retirar en</Text>
            <View style={{ backgroundColor: superficie, borderRadius: 18, overflow: 'hidden' }}>
              {(salas ?? []).map((s, i) => {
                const elegida = s.id === sala;
                return (
                  <Pressable key={s.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setSala(s.id); }} accessibilityRole="radio" accessibilityState={{ selected: elegida }}>
                    {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 50 }} /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                      <Icono sf={elegida ? 'checkmark.circle.fill' : 'circle'} respaldo="" tam={22} color={elegida ? t.color.magenta : colorSistema.texto3} />
                      <Text style={{ fontSize: 15, fontWeight: elegida ? '700' : '500', color: colorSistema.texto }}>{s.sala}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <TextInput value={nota} onChangeText={setNota} placeholder="Nota para la sucursal (opcional)" placeholderTextColor={colorSistema.texto3}
              multiline maxLength={300}
              style={{ minHeight: 70, borderRadius: 16, padding: 14, fontSize: 15, color: colorSistema.texto, backgroundColor: superficie }} />

            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Icono sf="info.circle" respaldo="i" tam={15} color={colorSistema.texto3} />
              <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: colorSistema.texto3 }}>
                No pagas nada ahora. Cuando confirmemos precio y fecha, el encargo se asegura pagando el 100 % por adelantado (es un pedido especial para ti).
              </Text>
            </View>
            {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
            {enviando ? <ActivityIndicator /> : <Boton alTocar={enviar} deshabilitado={!sala}>Enviar solicitud</Boton>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Paso({ sf, etiqueta, habilitado, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { if (!habilitado) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }} disabled={!habilitado}
      accessibilityRole="button" accessibilityLabel={etiqueta}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: habilitado ? 1 : 0.3,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }}>
      <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={14} color={colorSistema.texto} />
    </Pressable>
  );
}
