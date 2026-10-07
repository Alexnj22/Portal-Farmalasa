// Las hojas de la venta (la «ventana» del portal, como hoja del sistema):
// elegir el cliente y las preventas pendientes de finalizar.
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { totalDePedido } from '@nucleo/utils/distribucionMotor';
import ConAurora from '../../ConAurora';
import { colorSistema } from '../../Formulario';
import { Campo } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { PETROLEO } from './Piezas';

/** El marco de una hoja: título, «Cerrar» y el contenido. */
export function Hoja({ visible = true, titulo, subtitulo, onCerrar, cerrarTexto = 'Cerrar', bloqueada = false, children }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={bloqueada ? undefined : onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{titulo}</Text>
              {subtitulo ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={2}>{subtitulo}</Text> : null}
            </View>
            <Pressable onPress={onCerrar} disabled={bloqueada} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center', opacity: bloqueada ? 0.4 : 1 }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>{cerrarTexto}</Text>
            </Pressable>
          </View>
          {children}
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

function Fila({ titulo, detalle, derecha, onPress, elegida }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, paddingHorizontal: 20,
        borderBottomWidth: 0.5, borderBottomColor: colorSistema.separador, opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }} numberOfLines={2}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle}</Text> : null}
      </View>
      {derecha ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{derecha}</Text> : null}
      {elegida ? <Text style={{ color: PETROLEO, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
    </Pressable>
  );
}

/** Elegir el cliente: los activos (y el elegido), con el mismo detalle que el portal. */
export function ElegirCliente({ clientes, clienteId, onElegir, onCerrar }) {
  const [q, setQ] = useState('');
  const filas = useMemo(() => {
    const t = q.trim();
    return clientes
      .filter(c => c.activo || String(c.id) === String(clienteId))
      .filter(c => !t || tokenMatch(t, c.nombre, c.ruta, c.nit, c.nrc));
  }, [clientes, clienteId, q]);
  return (
    <Hoja titulo="Cliente" subtitulo="Lo que se le puede vender depende de él." onCerrar={onCerrar}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <Campo multiline={false} value={q} onChangeText={setQ} placeholder="Nombre, ruta, NIT o NRC" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
      </View>
      <FlatList data={filas} keyExtractor={c => String(c.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        ListEmptyComponent={<Text style={{ color: colorSistema.texto2, padding: 20 }}>Ningún cliente coincide.</Text>}
        renderItem={({ item: c }) => (
          <Fila titulo={c.nombre} elegida={String(c.id) === String(clienteId)} onPress={() => onElegir(String(c.id))}
            detalle={`${rotuloTipoCliente(c.tipo)} · ${c.contribuyente ? 'Crédito Fiscal' : 'Factura'}${!c.licencia_srs ? ' · sin licencia SRS' : ''}${c.ruta ? ` · ${c.ruta}` : ''}`} />
        )} />
    </Hoja>
  );
}

/** Las preventas por finalizar (las de los últimos 60 días). */
export function Pendientes({ pendientes, onElegir, onCerrar }) {
  const [q, setQ] = useState('');
  const t = q.trim();
  const filas = (pendientes ?? []).filter(p => !t || tokenMatch(t, p.dist_clientes?.nombre, String(p.id)));
  return (
    <Hoja titulo="Pendientes de finalizar" subtitulo={`${pendientes?.length ?? 0} preventa${pendientes?.length === 1 ? '' : 's'}`} onCerrar={onCerrar}>
      {(pendientes?.length ?? 0) > 4 ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Campo multiline={false} value={q} onChangeText={setQ} placeholder="Cliente o número…" autoCorrect={false} clearButtonMode="while-editing" />
        </View>
      ) : null}
      <FlatList data={filas} keyExtractor={p => String(p.id)} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={{ color: colorSistema.texto2, padding: 20 }}>Ninguna coincide.</Text>}
        renderItem={({ item: p }) => (
          <Fila titulo={p.dist_clientes?.nombre ?? `Venta ${p.id}`} derecha={formatMoney(totalDePedido(p))} onPress={() => onElegir(p.id)}
            detalle={`Venta ${p.id} · ${fechaHora12(p.created_at)} · ${shortEmployeeName(p.employees) || '—'}${p.descuento_solicitud_id ? ' · descuento por aprobar' : ''}`} />
        )} />
    </Hoja>
  );
}
