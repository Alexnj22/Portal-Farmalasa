// Mis tratamientos (2026-10-07): lo que el cliente compra con regularidad, con
// cuándo se le acaba. «Reservar» lleva al producto; «Ya no lo tomo» apaga el
// recordatorio con un motivo (si vuelve a comprarlo, se reactiva solo).
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { fecha, nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';

const MOTIVOS = ['Terminé el tratamiento', 'El médico me lo cambió', 'Lo compro en otro lugar', 'Otro motivo'];
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const diasHasta = (f) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${hoySV()}T12:00:00Z`)) / 86400_000);

export default function Tratamientos() {
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const cargar = useCallback(async () => { const r = await pedir('mis_tratamientos'); setD((a) => (r?.ok || !a?.ok ? r : a)); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const cambiar = async (t, activo, motivo) => {
    const r = await pedir('tratamiento_cambiar', { id: t.id, activo, motivo });
    if (!r?.ok) { Alert.alert('No se pudo guardar', r?.mensaje ?? 'Revisa tu conexión.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    cargar();
  };
  const yaNo = (t) => {
    const elegir = (i) => {
      if (i == null || i >= MOTIVOS.length) return;
      if (MOTIVOS[i] === 'Otro motivo' && Platform.OS === 'ios') {
        Alert.prompt('¿Por qué ya no lo tomas?', 'Nos ayuda a no molestarte.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Guardar', onPress: (x) => cambiar(t, false, (x ?? '').trim() || 'Otro motivo') },
        ]);
        return;
      }
      cambiar(t, false, MOTIVOS[i]);
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Ya no lo tomo', message: 'Dejamos de recordártelo. ¿Por qué?',
        options: [...MOTIVOS, 'Cancelar'], cancelButtonIndex: MOTIVOS.length }, elegir);
    } else {
      Alert.alert('Ya no lo tomo', '¿Por qué?', [...MOTIVOS.map((m, i) => ({ text: m, onPress: () => elegir(i) })), { text: 'Cancelar', style: 'cancel' }]);
    }
  };

  if (!d) return <Cargando />;
  const activos = d.ok ? d.tratamientos.filter((t) => t.estado === 'activo') : [];
  const apagados = d.ok ? d.tratamientos.filter((t) => t.estado !== 'activo') : [];
  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>
        Lo que compras con regularidad. Te avisamos unos días antes de que se te acabe.
      </Text>
      {!activos.length && !apagados.length ? (
        <Vacio titulo="Aún no hay recordatorios">Cuando compres un medicamento con regularidad, aparecerá aquí.</Vacio>
      ) : null}
      {activos.map((t) => <Fila key={t.id} t={t} alReservar={() => navegar(`/producto/${t.product_id}`)} alApagar={() => yaNo(t)} />)}
      {apagados.length ? <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2, marginTop: 8, marginLeft: 4 }}>YA NO LO TOMO</Text> : null}
      {apagados.map((t) => <Fila key={t.id} t={t} apagado alEncender={() => cambiar(t, true, null)} />)}
    </Pantalla>
  );
}

function Fila({ t, apagado, alReservar, alApagar, alEncender }) {
  const tema = useTema();
  const dias = diasHasta(t.se_acaba);
  const urgente = !apagado && dias <= 3;
  const cuando = dias < 0 ? `Se te acabó hace ${-dias} día${dias === -1 ? '' : 's'}` : dias === 0 ? 'Se te acaba hoy' : `Se te acaba en ${dias} día${dias === 1 ? '' : 's'}`;
  const color = urgente ? tema.color.magenta : tema.color.verde;
  return (
    <Tarjeta estilo={{ gap: 12, opacity: apagado ? 0.65 : 1 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(color, tema.oscuro ? 0.26 : 0.15) }}>
          <Icono sf="pills.fill" respaldo="💊" tam={19} color={urgente ? tema.color.magentaTexto : tema.color.verdeTexto} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={2}>{nombrePropio(t.nombre)}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
            {apagado ? t.motivo : `Cada ${t.intervalo} días · última compra ${fecha(t.ultima)}`}
          </Text>
          {!apagado ? <Text style={{ fontSize: 13, fontWeight: '700', color: urgente ? tema.color.magentaTexto : colorSistema.texto2 }}>{cuando}</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {apagado ? <Boton texto="Volver a recordarme" alTocar={alEncender} /> : (
          <>
            <Boton texto="Reservar" principal alTocar={alReservar} />
            <Boton texto="Ya no lo tomo" alTocar={alApagar} />
          </>
        )}
      </View>
    </Tarjeta>
  );
}

function Boton({ texto, alTocar, principal }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: principal ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: principal ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}
