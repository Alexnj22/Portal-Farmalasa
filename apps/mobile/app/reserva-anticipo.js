// Reservar con anticipo en el mostrador, NATIVO — `NuevaReservaSucursal` del
// portal. Un cliente deja un anticipo y se le aparta el producto. Política (la
// misma del portal y de la base, `reserva_en_sucursal_crear`): anticipo de al
// menos el 50 % y 7 días para retirarlo. Al guardar se imprime la constancia
// con el código en barras (`construirConstanciaDeReserva` del núcleo, el mismo
// papel del portal) en la caja de la sala.
//
// NO es el «Abono para apartar» (`abono-apartado`): aquél es dinero que entra
// a la caja por un vale, a 15 días y con precio libre; esto es una RESERVA de
// la app de clientes, que aparece en Reservas de mi sala y se retira con su
// código.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarClientes } from '@nucleo/data/customers';
import { codigoDeReserva, crearReservaEnSucursal, preciosDeProducto } from '@nucleo/data/reservas';
import { construirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

const METODOS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'transferencia', label: 'Transferencia' },
];
const redondear = (n) => Math.round(Number(n) * 100) / 100;
const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');

function Enlace({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
      <Text style={{ color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function ElegirCliente({ cliente, onElegir }) {
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
      {texto.trim().length >= 3 && !buscando && !resultados.length ? <Aviso texto={`Ninguna ficha coincide con «${texto.trim()}».`} /> : null}
    </>
  );
}

export default function ReservaConAnticipo() {
  const { user } = useAuth();
  const sala = user?.branchId ?? user?.branch_id ?? null;
  const nombreSala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(sala))?.name) || '';
  const [cliente, setCliente] = useState(null);
  const [producto, setProducto] = useState(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [precios, setPrecios] = useState(null);
  const [presentacion, setPresentacion] = useState(null);
  const [cantidad, setCantidad] = useState('1');
  const [anticipo, setAnticipo] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    if (!producto) { setPrecios(null); setPresentacion(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al quitar el producto
    preciosDeProducto(producto.id).then((ps) => {
      if (!vivo) return;
      setPrecios(ps);
      setPresentacion(ps.length ? String(ps.length - 1) : null);
    }).catch(() => { if (vivo) setPrecios([]); });
    return () => { vivo = false; };
  }, [producto]);

  const pres = presentacion != null ? precios?.[Number(presentacion)] : null;
  const cant = Math.trunc(Number(cantidad)) || 0;
  const total = pres ? redondear(pres.precio * cant) : 0;
  const minimo = redondear(total * 0.5);
  const ant = Number(anticipo) || 0;
  const problema = !cliente ? 'Elige el cliente.' : !producto ? 'Elige el producto.' : precios && !pres ? 'Ese producto no tiene precio.'
    : !pres ? null : cant < 1 || cant > 50 ? 'La cantidad va de 1 a 50.' : ant < minimo ? `El anticipo mínimo es ${formatMoney(minimo)} (50 %).`
      : ant > total ? 'El anticipo no puede pasar del total.' : null;
  const listoParaGuardar = !problema && !!pres;

  const guardar = () => {
    if (!listoParaGuardar || guardando) return;
    const nombre = `${producto.nombre}${pres.tipo ? ` · ${pres.tipo}` : ''}`;
    const metodoTexto = METODOS.find((m) => m.id === metodo)?.label ?? metodo;
    Alert.alert('¿Guardar la reserva?', `${shortEmployeeName(cliente.name)} aparta ${cant} × ${nombre}.\nAnticipo ${formatMoney(ant)} (${metodoTexto}) · saldo ${formatMoney(total - ant)} al retirar · 7 días.`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Guardar e imprimir', onPress: async () => {
        setGuardando(true); trabajando('Guardando la reserva…');
        try {
          const r = await crearReservaEnSucursal({
            branchId: sala, customerId: cliente.id, productoId: producto.id, productoNombre: nombre,
            cantidad: cant, precio: pres.precio, anticipo: ant, metodo,
          });
          useStaffStore.getState().appendAuditLog?.('RESERVA_EN_SUCURSAL', String(r.id), { anticipo: ant, total, metodo, cliente: cliente.id, desde: 'app' })?.catch?.(() => {});
          const codigo = codigoDeReserva(r.id);
          const papel = await imprimirEnLaSala(construirConstanciaDeReserva({
            codigo, cliente: shortEmployeeName(cliente.name), producto: nombre, cantidad: cant, precio: pres.precio,
            anticipo: ant, metodo: metodoTexto, venceAt: r.vence_at, sala: nombreSala, atendio: shortEmployeeName(user?.name ?? ''),
          }), sala, `Reserva ${codigo}`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          if (papel.ok) listo('Reserva guardada', `${codigo} · saldo ${formatMoney(total - ant)} al retirar`);
          else fallo('Reserva guardada, pero la constancia no salió', papel.detalle);
          router.back();
        } catch (e) { fallo('No se pudo reservar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setGuardando(false); }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reservar con anticipo' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
            {`El cliente deja al menos el 50 % y tiene 7 días para retirarlo en ${nombreSala || 'la sala'}. Sale la constancia con el código para encontrarla al volver.`}
          </Text>
          {!sala ? <Aviso tono="freno" texto="Las reservas son de una sala de ventas, y tu ficha no tiene sala." /> : (
            <>
              <Seccion titulo="Cliente"><ElegirCliente cliente={cliente} onElegir={setCliente} /></Seccion>
              <Seccion titulo="Producto">
                {buscandoProducto ? (
                  <BuscadorProducto onElegir={(p) => { setProducto(p); setBuscandoProducto(false); }} onCancelar={() => setBuscandoProducto(false)} />
                ) : producto ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
                    <Enlace texto="Cambiar" onPress={() => { setProducto(null); setBuscandoProducto(true); }} />
                  </View>
                ) : <Enlace texto="Buscar el producto que se aparta" onPress={() => setBuscandoProducto(true)} />}
                {producto && precios == null ? <ActivityIndicator /> : null}
                {precios && precios.length > 1 ? (
                  <Opciones opciones={precios.map((p, i) => ({ id: String(i), label: `${p.tipo} · ${formatMoney(p.precio)}` }))} valor={presentacion} onCambiar={setPresentacion} />
                ) : null}
              </Seccion>
              {pres ? (
                <>
                  <Seccion titulo="Cantidad y anticipo" pie={`${formatMoney(pres.precio)} c/u · total ${formatMoney(total)} · mínimo ${formatMoney(minimo)}`}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ width: 90 }}><Campo multiline={false} value={cantidad} keyboardType="number-pad" onChangeText={(v) => setCantidad(v.replace(/\D/g, '').slice(0, 2))} placeholder="Cant." style={{ textAlign: 'center' }} /></View>
                      <View style={{ flex: 1 }}><Campo multiline={false} value={anticipo} keyboardType="decimal-pad" onChangeText={(v) => setAnticipo(dinero(v))} placeholder="Anticipo $0.00" style={{ textAlign: 'center', fontWeight: '700' }} /></View>
                    </View>
                    <Dato rotulo="Saldo al retirar" valor={ant >= minimo && ant <= total ? formatMoney(total - ant) : '—'} fuerte />
                  </Seccion>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Cómo dejó el anticipo</Text>
                  <Segmentos opciones={METODOS} activa={metodo} onCambiar={setMetodo} margen={0} />
                </>
              ) : null}
              {problema ? <Aviso tono="cuidado" texto={problema} /> : null}
              <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !listoParaGuardar} onPress={guardar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
