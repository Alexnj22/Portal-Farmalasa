// Widgets de la pestaña General que no son de otra: «Datos que faltan» (el
// correo que Hacienda pide para una venta y que el cliente no dejó).
//
// El correo va a un documento fiscal a nombre de otra persona: se escribe, se
// confirma y queda registrado quién lo contestó. Sin borrador ni
// autocompletado, igual que el portal (`WidgetDatoPedido.jsx`).
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { fetchDatosPedidos, responderDatoPedido } from '@nucleo/data/datosPedidos';
import { fechaTexto } from '@nucleo/utils/fecha';
import Widget, { Esqueleto, Vacio } from '../Widget';
import { useDato } from '../useDato';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../marca';
import { fallo, listo, trabajando } from '../../Progreso';

function Pedido({ p, onListo, primero }) {
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const valido = /\S+@\S+\.\S+/.test(valor.trim());
  const confirmar = async () => {
    setEnviando(true); trabajando('Guardando el correo…');
    const r = await responderDatoPedido(p.id, valor.trim());
    setEnviando(false);
    if (!r?.ok) { fallo('No se pudo guardar', r?.error || 'Intenta de nuevo.'); return; }
    // Se informa lo que pasó de verdad: el reintento puede volver a rechazarse.
    if (r.documento?.entro) listo('Listo', `${p.correlativo || 'La venta'} ya quedó completa.`);
    else listo('Correo guardado', r.documento?.motivo ? `El documento sigue pendiente: ${r.documento.motivo}` : 'El documento se vuelve a intentar esta noche.');
    onListo();
  };
  return (
    <View style={{ gap: 8, paddingTop: primero ? 0 : 12, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{p.cliente || 'Cliente'}</Text>
        <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '700' }}>Falta el correo</Text>
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
        {[p.correlativo, p.fecha ? fechaTexto(String(p.fecha).slice(0, 10)) : null, p.sala].filter(Boolean).join(' · ')}
        {p.valor_actual ? `\nTiene: ${p.valor_actual}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput value={valor} onChangeText={setValor} placeholder="correo@cliente.com" placeholderTextColor={colorSistema.texto2}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress"
          style={{ flex: 1, minHeight: 42, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
        <Pressable disabled={!valido || enviando} onPress={confirmar}
          style={({ pressed }) => ({ minHeight: 42, paddingHorizontal: 14, borderRadius: 21, justifyContent: 'center',
            backgroundColor: MARCA.azul, opacity: !valido || enviando ? 0.4 : pressed ? 0.8 : 1 })}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enviar</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function DatosQueFaltan() {
  const [vuelta, setVuelta] = useState(0);
  const { dato, cargando, error } = useDato(`datos-pedidos:${vuelta}`, fetchDatosPedidos);
  const lista = dato || [];
  if (!cargando && !error && !lista.length) return null;   // sin pedidos no ocupa lugar
  return (
    <Widget titulo="Datos que faltan" icono="Mail" color={MARCA.ambar} cuenta={lista.length}>
      {cargando && !dato ? <Esqueleto lineas={2} /> : error ? <Vacio texto="No se pudo cargar." /> : (
        <View style={{ gap: 4 }}>
          {lista.map((p, i) => <Pedido key={p.id} p={p} primero={!i} onListo={() => setVuelta((n) => n + 1)} />)}
        </View>
      )}
    </Widget>
  );
}
