// Reservar con anticipo en el mostrador, NATIVO — `NuevaReservaSucursal` del
// portal. Un cliente deja un anticipo y se le aparta el producto. Política (la
// misma del portal y de la base, `apartado_cotizar`; reglamento v2): sin monto
// mínimo —se sugieren 50 % y 100 %, y con muy baja rotación viene elegido el
// 100 %— y 7 días para retirarlo. Al guardar se imprime la constancia
// con el código en barras (`construirConstanciaDeReserva` del núcleo, el mismo
// papel del portal) en la caja de la sala.
//
// Desde el 2026-10-20 el anticipo ENTRA A LA CAJA: se cobra como un ingreso
// «Apartar o encargar» (APARTADO) por `operar-caja`, con su forma de pago y la
// foto del comprobante, igual que en Mi caja del portal. Antes la reserva
// guardaba un anticipo que no entraba a ninguna caja. Y si en la sala no hay
// lo que se pide, no se aparta: se ENCARGA sin cobrar, y Compras o
// administración confirma el precio.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { buscarClientes } from '@nucleo/data/customers';
import { crearEncargoEnSucursal, mensajeDeEnlaceDePago, opcionesDeApartado, preciosDeProducto } from '@nucleo/data/reservas';
import { anotarIngreso, enlaceDePagoDeApartado } from '@nucleo/data/bolsas';
import { datosDeFormaDePago, estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { construirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import FormaDePago from '../componentes/formulario/FormaDePago';
import Segmentos from '../componentes/Segmentos';
import { subirFotos } from '../componentes/formulario/Fotos';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

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
  // La sala que se eligió en «Meter dinero» manda; sin ella, la de la ficha.
  const { sala: salaElegida } = useLocalSearchParams();
  const sala = salaElegida ?? user?.branchId ?? user?.branch_id ?? null;
  const nombreSala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(sala))?.name) || '';
  const [cliente, setCliente] = useState(null);
  const [producto, setProducto] = useState(null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [precios, setPrecios] = useState(null);
  const [presentacion, setPresentacion] = useState(null);
  const [cantidad, setCantidad] = useState('1');
  const [anticipo, setAnticipo] = useState('');
  // Cuánto deja (2026-10-20): botones rápidos del 50 % y del total, u otro monto.
  const [cuanto, setCuanto] = useState('mitad');
  const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
  // Reglamento v3 (2026-10-22): se cobra en caja o se le manda un enlace de pago.
  const [cobroEn, setCobroEn] = useState('caja');
  const [opciones, setOpciones] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [clave] = useState(() => `app-apartar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

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

  // ¿Se aparta o se encarga? Lo decide la base con la existencia de la sala.
  useEffect(() => {
    let vivo = true;
    if (!producto || !pres || cant < 1 || !sala) { setOpciones(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al cambiar
    const t = setTimeout(() => {
      opcionesDeApartado(sala, producto.id, pres.factor, cant)
        // Muy baja rotación: viene elegido el total (se puede cambiar).
        .then((o) => { if (vivo) { setOpciones(o); if (o?.baja_rotacion) setCuanto('todo'); } })
        .catch(() => { if (vivo) setOpciones(null); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [producto, pres, cant, sala]);
  const seEncarga = opciones?.modo === 'encargo';
  const total = pres ? redondear(pres.precio * cant) : 0;
  const mitad = redondear(total * 0.5);
  const ant = cuanto === 'mitad' ? mitad : cuanto === 'todo' ? total : (Number(anticipo) || 0);
  const estadoPago = estadoDeFormaDePago(pago, ant);
  const problema = !cliente ? 'Elige el cliente.' : !producto ? 'Elige el producto.' : precios && !pres ? 'Ese producto no tiene precio.'
    : !pres ? null : cant < 1 || cant > 50 ? 'La cantidad va de 1 a 50.' : !opciones ? null : seEncarga ? null
      : ant < 0.01 ? 'Escribe cuánto deja.'
        : ant > total ? 'El anticipo no puede pasar del total.' : cobroEn === 'caja' ? estadoPago.falta : null;
  const listoParaGuardar = !problema && !!pres && !!opciones;
  const nombreDe = () => `${producto.nombre}${pres.tipo ? ` · ${pres.tipo}` : ''}`;

  // Sin existencia: se encarga sin cobrar.
  const encargar = () => {
    if (!listoParaGuardar || guardando) return;
    Alert.alert('¿Registrar el encargo?', `${shortEmployeeName(cliente.name)} encarga ${cant} × ${nombreDe()}. Compras o administración confirma el precio y la fecha; cuando el cliente acepte, se cobra el 100 %.`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Registrar', onPress: async () => {
        setGuardando(true); trabajando('Registrando el encargo…');
        try {
          const r = await crearEncargoEnSucursal({ branchId: sala, customerId: cliente.id, productoId: producto.id,
            productoNombre: nombreDe(), factor: pres.factor, cantidad: cant });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Encargo registrado', `${r.codigo} · se confirma el precio antes de cobrar`);
          router.back();
        } catch (e) { fallo('No se pudo registrar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setGuardando(false); }
      } },
    ]);
  };

  // El enlace de pago: no entra al cajón; al pagarlo se suma solo al anticipo.
  const mandarEnlace = () => {
    if (!listoParaGuardar || guardando) return;
    const nombre = nombreDe();
    Alert.alert(`¿Crear un enlace por ${formatMoney(ant)}?`, `${shortEmployeeName(cliente.name)} aparta ${cant} × ${nombre}. Queda separado 3 días mientras paga; al pagar, el plazo pasa a 7.`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Crear y compartir', onPress: async () => {
        setGuardando(true); trabajando('Creando el enlace…');
        try {
          const r = await enlaceDePagoDeApartado({ sala, monto: ant,
            apartado: { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombre,
              factor: pres.factor, cantidad: cant, precio: pres.precio } });
          if (r?.error) throw r.error;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Enlace creado', `${r.codigo} · ${r.prueba ? 'enlace de PRUEBA' : 'compártelo con el cliente'}`);
          await Share.share({ message: mensajeDeEnlaceDePago(r, nombreSala) }).catch(() => {});
          router.back();
        } catch (e) { fallo('No se pudo crear el enlace', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setGuardando(false); }
      } },
    ]);
  };

  const guardar = () => {
    if (!listoParaGuardar || guardando) return;
    const nombre = nombreDe();
    const metodoTexto = FORMAS_DE_PAGO.find((f) => f.value === pago.forma)?.label ?? 'Efectivo';
    Alert.alert(`¿Cobrar ${formatMoney(ant)}?`, `${shortEmployeeName(cliente.name)} aparta ${cant} × ${nombre}.\nAnticipo ${formatMoney(ant)} (${metodoTexto}) · saldo ${formatMoney(total - ant)} al retirar · 7 días.${estadoPago.noEfectivo ? ' No entra al cajón.' : ` Entra a la caja de ${nombreSala}.`}`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Cobrar e imprimir', onPress: async () => {
        setGuardando(true); trabajando('Cobrando el anticipo…');
        try {
          let fotoUrl = null;
          if (estadoPago.noEfectivo && pago.foto) {
            fotoUrl = (await subirFotos([pago.foto], { bucket: 'payment-proofs', carpeta: `bolsas/${sala}/${user?.id ?? 'anon'}` }))[0] ?? null;
            if (!fotoUrl) throw new Error('No se pudo subir la foto del comprobante. Revisa la conexión y vuelve a intentarlo.');
          }
          // El monto, el precio y la existencia los vuelve a validar el servidor.
          const r = await anotarIngreso({
            sala, monto: ant, clave, tipo: 'APARTADO', concepto: 'Anticipo', fotoUrl, ...datosDeFormaDePago(pago, fotoUrl),
            apartado: { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombre,
              factor: pres.factor, cantidad: cant, precio: pres.precio },
          });
          if (r?.error) throw r.error;
          const a = r?.apartado;
          if (!a) throw new Error('El cobro no quedó ligado a la reserva. Revisa la lista del día.');
          const papel = await imprimirEnLaSala(construirConstanciaDeReserva({
            codigo: a.codigo, cliente: shortEmployeeName(cliente.name), producto: nombre, cantidad: cant, precio: pres.precio,
            anticipo: Number(a.anticipo), metodo: metodoTexto, venceAt: a.vence_at, sala: nombreSala, atendio: shortEmployeeName(user?.name ?? ''),
          }), sala, `Reserva ${a.codigo}`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          if (r.aviso) fallo('Anticipo cobrado, con un pendiente', r.aviso);
          else if (papel.ok) listo('Anticipo cobrado', `${a.codigo} · saldo ${formatMoney(Number(a.saldo))} al retirar`);
          else fallo('Anticipo cobrado, pero la constancia no salió', papel.detalle);
          router.back();
        } catch (e) { fallo('No se pudo cobrar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setGuardando(false); }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Apartar o encargar' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
            {`El cliente deja lo que quiera y tiene 7 días para retirarlo en ${nombreSala || 'la sala'}. Sale la constancia con el código para encontrarla al volver.`}
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
                  {seEncarga ? (
                    <Seccion titulo="Cantidad">
                      <View style={{ width: 90 }}><Campo multiline={false} value={cantidad} keyboardType="number-pad" onChangeText={(v) => setCantidad(v.replace(/\D/g, '').slice(0, 2))} placeholder="Cant." style={{ textAlign: 'center' }} /></View>
                      <Aviso tono="cuidado" texto={`En ${nombreSala || 'la sala'} hay ${Number(opciones.disponibles)} y se piden ${Number(opciones.necesita)}: se encarga sin cobrar. Compras o administración confirma el precio.`} />
                    </Seccion>
                  ) : (<>
                  <Seccion titulo="Cantidad y anticipo" pie={`${formatMoney(pres.precio)} c/u · total ${formatMoney(total)}${opciones?.baja_rotacion ? ' · muy baja rotación: conviene cobrarlo completo' : ''}`}>
                    <View style={{ width: 90 }}><Campo multiline={false} value={cantidad} keyboardType="number-pad" onChangeText={(v) => setCantidad(v.replace(/\D/g, '').slice(0, 2))} placeholder="Cant." style={{ textAlign: 'center' }} /></View>
                    <Segmentos opciones={[{ id: 'mitad', label: `50 % · ${formatMoney(mitad)}` }, { id: 'todo', label: `Todo · ${formatMoney(total)}` }, { id: 'otro', label: 'Otro' }]}
                      activa={cuanto} onCambiar={setCuanto} margen={0} />
                    {cuanto === 'otro' ? (
                      <Campo multiline={false} value={anticipo} keyboardType="decimal-pad" onChangeText={(v) => setAnticipo(dinero(v))} placeholder="Anticipo" style={{ textAlign: 'center', fontWeight: '700' }} autoFocus />
                    ) : null}
                    <Dato rotulo="Saldo al retirar" valor={ant >= 0.01 && ant <= total ? formatMoney(total - ant) : '—'} fuerte />
                  </Seccion>
                  <Seccion titulo="Cómo paga">
                    <Segmentos opciones={[{ id: 'caja', label: 'En caja' }, { id: 'enlace', label: 'Enlace de pago' }]} activa={cobroEn} onCambiar={setCobroEn} margen={0} />
                  </Seccion>
                  {cobroEn === 'caja' ? <FormaDePago valor={pago} onCambiar={setPago} monto={ant || null} /> : null}
                  </>)}
                </>
              ) : null}
              {problema ? <Aviso tono="cuidado" texto={problema} /> : null}
              <BotonGrande texto={guardando ? 'Guardando…' : seEncarga ? 'Registrar encargo' : cobroEn === 'enlace' ? `Crear enlace de pago${ant ? ` ${formatMoney(ant)}` : ''}` : `Cobrar anticipo${ant ? ` ${formatMoney(ant)}` : ''}`}
                color={MARCA.verde} deshabilitado={guardando || !listoParaGuardar} onPress={seEncarga ? encargar : cobroEn === 'enlace' ? mandarEnlace : guardar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
