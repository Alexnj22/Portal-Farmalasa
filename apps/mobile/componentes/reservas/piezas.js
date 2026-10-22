// Las piezas de Reservas y Apartar en la app del personal: el botón de
// píldora de las tarjetas, el enlace de texto, el color de cada tono del
// núcleo, elegir la ficha del cliente y confirmar su teléfono.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { buscarClientes, mensajeDeError, motivoSinAplicar, pushClienteAlErp, updateCustomerFiscal } from '@nucleo/data/customers';
import { telefonoDeFicha } from '@nucleo/utils/apartar';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso, Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { listo } from '../Progreso';

/** El color de un `tono` del núcleo (info, warning, danger, success). */
export const colorDeTono = (tono) => ({ info: MARCA.azulClaro, warning: MARCA.ambar, danger: MARCA.rojo, success: MARCA.verde }[tono] ?? colorSistema.texto2);

/** El botón de píldora. `relleno`: la acción principal (fondo lleno); `sinFondo`: la menor (sólo texto). */
export function Accion({ texto, color = MARCA.azulClaro, onPress, deshabilitado, relleno = false, sinFondo = false }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} hitSlop={6} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999,
        backgroundColor: relleno ? color : sinFondo ? 'transparent' : `${color}26`, opacity: deshabilitado ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: relleno ? '#fff' : color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export function Enlace({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
      <Text style={{ color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

/** Una opción que se marca (lo que viene en camino, la sala a la que se pide). */
export function Marcable({ titulo, detalle, activa, onPress, primero }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: !!activa }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 6,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: activa ? '700' : '500' }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Text style={{ color: activa ? MARCA.azulClaro : colorSistema.texto2, fontSize: 19, fontWeight: '700' }}>{activa ? '✓' : '○'}</Text>
    </Pressable>
  );
}

/** La ficha del cliente, del listado (nombre, DUI o teléfono). */
export function ElegirCliente({ cliente, onElegir }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  useEffect(() => {
    let vivo = true;
    const q = texto.trim();
    if (cliente || q.length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
    const t = setTimeout(async () => {
      setBuscando(true);
      const { data } = await buscarClientes(q, { select: 'id, name, dui, phone', limite: 6 });
      if (vivo) { setResultados(data ?? []); setBuscando(false); }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [texto, cliente]);

  if (cliente) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(cliente.name)}</Text>
        <Enlace texto="Cambiar" onPress={() => { onElegir(null); setTexto(''); }} />
      </View>
    );
  }
  return (
    <>
      <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Cliente: nombre, DUI o teléfono" autoCorrect={false} />
      {buscando ? <ActivityIndicator /> : resultados.map((c) => (
        <Pressable key={c.id} onPress={() => onElegir(c)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(c.name)}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[c.dui, c.phone].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
        </Pressable>
      ))}
      {texto.trim().length >= 3 && !buscando && !resultados.length ? <Aviso texto={`Ninguna ficha coincide con «${texto.trim()}». Si no tiene ficha, créala primero en Clientes.`} /> : null}
    </>
  );
}

/**
 * El teléfono del cliente se confirma antes de seguir (2026-10-21, como el
 * portal); si cambió, se corrige ahí: `update_customer_fiscal` —el único camino
 * de escritura de la ficha— y después se manda al sistema de la caja. Si ese
 * envío no entra en el momento, queda en cola y se aplica solo.
 */
export function TelefonoDelCliente({ cliente, confirmado, onConfirmar, onCambiado }) {
  const actual = String(cliente.phone ?? '').trim();
  const [editando, setEditando] = useState(!actual);
  const [nuevo, setNuevo] = useState(actual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const tel = telefonoDeFicha(nuevo);

  const guardar = async () => {
    if (!tel) return;
    setGuardando(true); setError('');
    try {
      await updateCustomerFiscal(cliente.id, { phone: tel }, {}, { nombre: cliente.name });
      const r = await pushClienteAlErp(cliente.id);
      listo(r?.empujado ? 'Teléfono actualizado' : 'Teléfono guardado', r?.empujado ? 'Quedó en la ficha del cliente.' : motivoSinAplicar(r));
      setEditando(false);
      onCambiado(tel);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  };

  if (editando) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{actual ? 'Teléfono nuevo' : 'No tiene teléfono: escríbelo'}</Text>
        <Campo multiline={false} value={nuevo} keyboardType="phone-pad" onChangeText={(v) => setNuevo(v.replace(/[^0-9-]/g, ''))} placeholder="7777-7777" autoFocus />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Accion texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.verde} onPress={guardar} deshabilitado={guardando || !tel} />
          {actual ? <Accion texto="Volver" color={colorSistema.texto2} onPress={() => { setEditando(false); setNuevo(actual); setError(''); }} /> : null}
        </View>
        {error ? <Aviso tono="freno" texto={error} /> : null}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Text style={{ flex: 1, minWidth: 120, color: colorSistema.texto, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {`Tel. ${actual}${confirmado ? '  ✓' : ''}`}
      </Text>
      {!confirmado ? <Accion texto="Es correcto" color={MARCA.verde} onPress={onConfirmar} /> : null}
      <Accion texto="Cambiar" onPress={() => setEditando(true)} />
    </View>
  );
}
