// Mis tratamientos (2026-10-07): lo que el cliente compra con regularidad, con
// cuándo se le acaba. «Reservar» lleva al producto; «Ya no lo tomo» apaga el
// recordatorio con un motivo (si vuelve a comprarlo, se reactiva solo).
// «Recordarme tomarlo» (2026-10-12): avisos de cada toma, sólo en el teléfono
// (lib/tomas.js, componentes/TomasHoja.js). En la web no aparece.
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { fecha, nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';
import TomasHoja from '../componentes/TomasHoja';
import { DISPONIBLE as TOMAS, quitarRecordatorio, resumenRecordatorio, sincronizarConTratamientos, tomadoHoy, useTomas } from '../lib/tomas';

const MOTIVOS = ['Terminé el tratamiento', 'El médico me lo cambió', 'Lo compro en otro lugar', 'Otro motivo'];
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const diasHasta = (f) => Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${hoySV()}T12:00:00Z`)) / 86400_000);

export default function Tratamientos() {
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const preRegistro = useCuenta((s) => !!s.resumen?.pendiente);
  const [tomas, setTomas] = useState(null); // el tratamiento cuya hoja de tomas está abierta
  const cargar = useCallback(async () => {
    const r = await pedir('mis_tratamientos');
    setD((a) => (r?.ok || !a?.ok ? r : a));
    // Cuándo se le acaba cada uno, para el «Te quedan pocas» del aviso de toma.
    if (r?.ok) sincronizarConTratamientos(r.tratamientos);
  }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const cambiar = async (t, activo, motivo) => {
    const r = await pedir('tratamiento_cambiar', { id: t.id, activo, motivo });
    if (!r?.ok) { Alert.alert('No se pudo guardar', r?.mensaje ?? 'Revisa tu conexión.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // «Ya no lo tomo» también apaga los avisos de cada toma.
    if (!activo) quitarRecordatorio(String(t.product_id));
    cargar();
  };
  const yaNo = (t) => {
    const elegir = (i) => {
      if (i == null || i >= MOTIVOS.length) return;
      if (MOTIVOS[i] === 'Otro motivo' && Platform.OS !== 'web') {
        Alert.prompt('¿Por qué ya no lo tomas?', 'Nos ayuda a no molestarte.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Guardar', onPress: (x) => cambiar(t, false, (x ?? '').trim() || 'Otro motivo') },
        ]);
        return;
      }
      cambiar(t, false, MOTIVOS[i]);
    };
    // En Android, la hoja de componentes/HojasAndroid: su alerta dibuja sólo
    // tres botones y los motivos son cuatro más «Cancelar».
    if (Platform.OS !== 'web') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Ya no lo tomo', message: 'Dejamos de recordártelo. ¿Por qué?',
        options: [...MOTIVOS, 'Cancelar'], cancelButtonIndex: MOTIVOS.length }, elegir);
    } else {
      Alert.alert('Ya no lo tomo', '¿Por qué?', [...MOTIVOS.map((m, i) => ({ text: m, onPress: () => elegir(i) })), { text: 'Cancelar', style: 'cancel' }]);
    }
  };

  if (!d) return <Cargando />;
  // Sin ficha todavía: se explica por qué no hay nada (2026-10-12). Antes salía
  // como lista vacía, o con el mensaje de reservar.
  if (d.pendiente || (!d.ok && preRegistro)) {
    return <Pantalla conPestanas={false}><Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚">Cuando completes tu registro en cualquier sucursal verás aquí lo que compras con regularidad.</Vacio></Pantalla>;
  }
  // Un error no es «no hay recordatorios» (2026-10-12): se dice y se reintenta.
  if (!d.ok) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio>
        <Reintentar alTocar={refrescar} />
      </Pantalla>
    );
  }
  const activos = d.ok ? d.tratamientos.filter((t) => t.estado === 'activo') : [];
  const apagados = d.ok ? d.tratamientos.filter((t) => t.estado !== 'activo') : [];
  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>
        Lo que compras con regularidad. Te avisamos unos días antes de que se te acabe.
      </Text>
      {!activos.length && !apagados.length ? (
        <Vacio titulo="Aún no hay recordatorios" icono="pills.fill" respaldo="✚">Cuando compres un medicamento con regularidad, aparecerá aquí.</Vacio>
      ) : null}
      {activos.map((t) => <Fila key={t.id} t={t} alReservar={() => navegar(`/producto/${t.product_id}`)} alApagar={() => yaNo(t)} alRecordar={() => setTomas(t)}
        alPreguntar={() => navegar(`/chat?producto=${t.product_id}`)} />)}
      {apagados.length ? <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2, marginTop: 8, marginLeft: 4 }}>YA NO LO TOMO</Text> : null}
      {apagados.map((t) => <Fila key={t.id} t={t} apagado alEncender={() => cambiar(t, true, null)} />)}
      {tomas ? <TomasHoja tratamiento={tomas} actual={useTomas.getState().config[String(tomas.product_id)]} alCerrar={() => setTomas(null)} /> : null}
    </Pantalla>
  );
}

function Fila({ t, apagado, alReservar, alApagar, alEncender, alRecordar, alPreguntar }) {
  const tema = useTema();
  const pid = String(t.product_id);
  const recordatorio = useTomas((s) => s.config[pid]);
  const tomado = useTomas((s) => tomadoHoy(s.registro, pid));
  const quitar = () => Alert.alert('Quitar recordatorio', `Dejamos de avisarte las tomas de ${nombrePropio(t.nombre)}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: () => { quitarRecordatorio(pid); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } },
  ]);
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
        {/* Preguntar a la farmacia por este medicamento (2026-10-13): abre el chat con él puesto. */}
        {alPreguntar ? (
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alPreguntar(); }} accessibilityRole="button"
            accessibilityLabel={`Preguntar a la farmacia por ${nombrePropio(t.nombre)}`} hitSlop={4}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: suave(tema.color.magenta, pressed ? 0.3 : (tema.oscuro ? 0.22 : 0.12)) })}>
            <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={18} color={tema.color.magentaTexto} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {apagado ? <Boton texto="Volver a recordarme" alTocar={alEncender} /> : (
          <>
            <Boton texto="Reservar" principal alTocar={alReservar} />
            <Boton texto="Ya no lo tomo" alTocar={alApagar} />
          </>
        )}
      </View>
      {!apagado && TOMAS ? (recordatorio ? (
        <View style={{ gap: 8, borderRadius: 12, padding: 12, backgroundColor: tema.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icono sf="bell.fill" respaldo="🔔" tam={14} color={tema.color.magentaTexto} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto }}>{resumenRecordatorio(recordatorio)}</Text>
              {recordatorio.nota ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{recordatorio.nota}</Text> : null}
              {tomado ? <Text style={{ fontSize: 13, fontWeight: '600', color: tema.color.verdeTexto }}>Tomado hoy a las {tomado}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Boton texto="Editar" alTocar={alRecordar} />
            <Boton texto="Quitar recordatorio" alTocar={quitar} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row' }}><Boton texto="Recordarme tomarlo" alTocar={alRecordar} /></View>
      )) : null}
    </Tarjeta>
  );
}

function Reintentar({ alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: t.color.magentaTexto }}>Reintentar</Text>
    </Pressable>
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
