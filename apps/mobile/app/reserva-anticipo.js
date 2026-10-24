// Apartar o encargar en el mostrador, NATIVO — gemela de `DialogoApartar` del
// portal, con sus dos partes: «Nuevo» y «Por cobrar» (`componentes/reservas/
// PorCobrar`). Las cuentas y lo que falta para guardar salen del núcleo
// (`planDeApartar` de `utils/apartar`), las mismas del portal; lo que decide de
// verdad es la base (`apartado_*`, `encargo_*`) por `operar-caja`.
//
// Nace de una FICHA del listado de clientes (con el teléfono confirmado: si
// cambió se corrige ahí y la ficha se manda al sistema de la caja) y de un
// producto del CATÁLOGO, con la presentación más chica elegida:
//   · HAY en la sala → se APARTA 7 días con el precio de hoy y se cobra el
//     anticipo (sin monto mínimo: 50 %, todo u otro; con muy baja rotación
//     viene elegido el todo), en caja o con un enlace de pago;
//   · YA VIENE en camino un traslado que nadie apartó → se aparta sobre ése
//     (o varios); si no alcanzan, el resto se encarga a Bodega;
//   · otra sala lo tiene → se pide a esa sala y se aparta en el mismo acto (la
//     reserva queda en camino y se marca lista sola al llegar);
//   · NO hay → se ENCARGA sin cobrar; Compras confirma precio y fecha, y se
//     cobra completo desde «Por cobrar».
// Varios productos: apartados en un solo cobro (un PEDIDO P-) o encargados
// juntos (un encargo y un papel por producto). Un producto que no tenemos va
// a Bodega como consulta, con el SRS y una foto. Todo sale con su papel.
// Guarda borrador.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Share, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  crearEncargoDeProductoNuevo, crearEncargoEnSucursal, crearEncargosEnSucursal, mensajeDeEnlaceDePago, opcionesDeApartado, preciosDeProducto, srsParaEncargo,
} from '@nucleo/data/reservas';
import { enlaceDePagoDeApartado } from '@nucleo/data/bolsas';
import { apartadoDelPedido, clavePresentacion, origenesDelPedido, planDeApartar, redondear } from '@nucleo/utils/apartar';
import { plazoAlApartar } from '@nucleo/utils/reservasDeSala';
import { useReglasDeReserva } from '@nucleo/hooks/useReglasDeReserva';
import { FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import FormaDePago from '../componentes/formulario/FormaDePago';
import { subirFotos } from '../componentes/formulario/Fotos';
import Segmentos from '../componentes/Segmentos';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { Accion, ElegirCliente, Enlace, TelefonoDelCliente } from '../componentes/reservas/piezas';
import { DeOtraSala, YaVieneEnCamino } from '../componentes/reservas/ComoLlega';
import ProductoNuevo from '../componentes/reservas/ProductoNuevo';
import PorCobrar from '../componentes/reservas/PorCobrar';
import { cobrarAnticipoEnLaApp, imprimirEncargoEnLaApp } from '../componentes/reservas/cobrar';

const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');
const llave = (sala) => `app_apartar_${sala ?? 'sin-sala'}`;

/** Lo ya agregado al pedido o al encargo, con «Quitar». */
function Renglones({ titulo, lineas, total, onQuitar }) {
  return (
    <Seccion titulo={`${titulo} · ${lineas.length} · ${formatMoney(total)}`} pie="Con el precio de hoy.">
      {lineas.map((l, i) => (
        <View key={`${l.productoId}-${l.factor}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${l.cantidad} × ${l.productoNombre}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatMoney(redondear(l.precio * l.cantidad))}${l.origen ? ` · viene de ${l.origen}` : ''}`}</Text>
          </View>
          <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => onQuitar(i)} />
        </View>
      ))}
    </Seccion>
  );
}

export default function ApartarOEncargar() {
  const { user } = useAuth();
  // La sala que se eligió en «Meter dinero» manda; sin ella, la de la ficha.
  const { sala: salaElegida } = useLocalSearchParams();
  const sala = salaElegida ?? user?.branchId ?? user?.branch_id ?? null;
  const nombreSala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(sala))?.name) || '';
  const [vista, setVista] = useState('nuevo');
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Apartar o encargar' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {!sala ? <Aviso tono="freno" texto="Las reservas son de una sala de ventas, y tu ficha no tiene sala." /> : (
            <>
              <Segmentos opciones={[{ id: 'nuevo', label: 'Nuevo' }, { id: 'cobrar', label: 'Por cobrar' }]} activa={vista} onCambiar={setVista} margen={0} />
              {vista === 'nuevo' ? <Nuevo sala={sala} nombreSala={nombreSala} user={user} /> : <PorCobrar sala={sala} nombreSala={nombreSala} user={user} />}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Nuevo({ sala, nombreSala, user }) {
  const reglasDeReserva = useReglasDeReserva();
  // El borrador sobrevive al cierre de sesión por inactividad.
  const [guardado] = useState(() => loadDraft(llave(sala)));
  const [cliente, setCliente] = useState(guardado?.cliente ?? null);
  // El teléfono se confirma cada vez: no viaja en el borrador.
  const [telOk, setTelOk] = useState(false);
  const [producto, setProducto] = useState(guardado?.producto ?? null);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [presentaciones, setPresentaciones] = useState(null);
  const [pres, setPres] = useState(guardado?.pres ?? '');
  const [cantidad, setCantidad] = useState(guardado?.cantidad ?? '1');
  const [opciones, setOpciones] = useState(null);
  const [anticipo, setAnticipo] = useState('');
  const [cuanto, setCuanto] = useState('mitad');
  const [nota, setNota] = useState(guardado?.nota ?? '');
  const [sinCatalogo, setSinCatalogo] = useState(guardado?.sinCatalogo ?? false);
  const [nombreNuevo, setNombreNuevo] = useState(guardado?.nombreNuevo ?? '');
  const [srs, setSrs] = useState(guardado?.srs ?? null);
  const [srsNoAparece, setSrsNoAparece] = useState(guardado?.srsNoAparece ?? false);
  const [fotos, setFotos] = useState([]);
  const [traslado, setTraslado] = useState(null);
  const trasladoApi = useRef(null);
  const [vienenElegidos, setVienenElegidos] = useState(null);
  const [lineas, setLineas] = useState(guardado?.lineas ?? []);
  const [apartados, setApartados] = useState(guardado?.apartados ?? []);
  const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
  const [cobroEn, setCobroEn] = useState('caja');
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(() => `app-apartar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    saveDraft(llave(sala), { cliente, producto, pres, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece, lineas, apartados });
  }, [sala, cliente, producto, pres, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece, lineas, apartados]);

  useEffect(() => {
    let vivo = true;
    if (!producto) { setPresentaciones(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al quitar el producto
    preciosDeProducto(producto.id).then((ps) => {
      if (!vivo) return;
      setPresentaciones(ps);
      // La presentación más chica viene elegida: la existencia se ve al momento.
      setPres((actual) => (actual && ps.some((p) => clavePresentacion(p) === actual) ? actual : clavePresentacion(ps[0])));
    }).catch(() => { if (vivo) setPresentaciones([]); });
    return () => { vivo = false; };
  }, [producto]);

  const elegida = useMemo(() => (presentaciones ?? []).find((p) => clavePresentacion(p) === pres) ?? null, [presentaciones, pres]);
  const cant = Math.trunc(Number(cantidad)) || 0;

  // ¿Se aparta, viene en camino o se encarga? Lo decide la base con la existencia de la sala.
  useEffect(() => {
    let vivo = true;
    if (!producto || !elegida || cant < 1) { setOpciones(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al cambiar
    const t = setTimeout(() => {
      opcionesDeApartado(sala, producto.id, elegida.factor, cant)
        .then((o) => { if (vivo) { setOpciones(o); if (o?.baja_rotacion) setCuanto('todo'); } })
        .catch((e) => { if (vivo) { setOpciones(null); fallo('No se pudo revisar la existencia', mensajeAmigable(e, '')); } });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [sala, producto, elegida, cant]);

  const plan = useMemo(() => planDeApartar({
    opciones, producto, elegida, cantidad, lineas, apartados, vienenElegidos, traslado, cuanto, anticipo, pago, cobroEn,
    cliente, telOk, sinCatalogo, nombreNuevo, srs, srsNoAparece,
  }), [opciones, producto, elegida, cantidad, lineas, apartados, vienenElegidos, traslado, cuanto, anticipo, pago, cobroEn,
    cliente, telOk, sinCatalogo, nombreNuevo, srs, srsNoAparece]);
  const { total, soloEncargo, enPedido, vienen, elegidosIds, vieneSel, restoABodega, origenes, modo, totalApartados, totalCobro, mitad,
    conAnticipo, montoAnticipo, estadoPago, nombreProducto, lineaActual, totalLineas, enCamino, puedeAgregar, puedeApartarOtro,
    renglonActual, renglonesDelPedido, falta, deja } = plan;

  const limpiarProducto = () => { setProducto(null); setPres(''); setCantidad('1'); setTraslado(null); setVienenElegidos(null); setOpciones(null); };
  const terminar = () => { clearDraft(llave(sala)); router.back(); };
  const papelDeEncargo = async (codigo, texto, nuevo, cantidadDelPapel) => {
    const r = await imprimirEncargoEnLaApp({ sala, nombreSala, user, codigo, cliente, producto: texto, cantidad: cantidadDelPapel, nuevo });
    if (!r.ok) fallo('No se imprimió la constancia', r.detalle);
  };

  const hacer = async () => {
    setEnviando(true);
    try {
      if (sinCatalogo) {
        trabajando('Enviando la consulta…');
        const fotoUrl = fotos[0] ? (await subirFotos([fotos[0]], { bucket: 'encargos-fotos', carpeta: String(Number(sala)) }))[0] ?? null : null;
        const r = await crearEncargoDeProductoNuevo({ branchId: sala, customerId: cliente.id, nombre: nombreNuevo, cantidad: cant, nota,
          srs: srs ? srsParaEncargo(srs) : null, fotoUrl });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Consulta enviada a Bodega', `${r.codigo} · Bodega responde el precio y para cuándo, o si no se puede conseguir.`);
        await papelDeEncargo(r.codigo, nombreNuevo.trim(), true, cant);
        terminar();
        return;
      }
      if (conAnticipo && cobroEn === 'enlace' && !enPedido) {
        trabajando('Creando el enlace…');
        const desde = modo === 'traslado' ? traslado : null;
        const r = await enlaceDePagoDeApartado({ sala, monto: redondear(montoAnticipo),
          apartado: { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombreProducto,
            factor: elegida.factor, cantidad: cant, precio: elegida.precio, ...enCamino } });
        if (r?.error) throw r.error;
        if (desde) {
          try {
            await trasladoApi.current.enviar(`Reserva ${r.codigo} para ${shortEmployeeName(cliente.name)}`, { reserva_id: r.reserva_id });
          } catch (e) { fallo('El apartado quedó, pero el traslado no se pidió', `${mensajeAmigable(e, '')} Pídelo desde Inventario.`); }
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Enlace creado', `${r.codigo} · ${r.prueba ? 'enlace de PRUEBA: no cobra dinero' : 'queda separado 3 días mientras paga; al pagar, el plazo pasa a 7'}`);
        await Share.share({ message: mensajeDeEnlaceDePago(r, nombreSala) }).catch(() => {});
        terminar();
        return;
      }
      if (conAnticipo) {
        trabajando('Cobrando el anticipo…');
        const desde = !enPedido && modo === 'traslado' ? traslado : null;
        const r = await cobrarAnticipoEnLaApp({
          sala, nombreSala, user, clave, monto: redondear(montoAnticipo), pago,
          apartado: enPedido ? apartadoDelPedido(cliente.id, renglonesDelPedido)
            : { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombreProducto,
              factor: elegida.factor, cantidad: cant, precio: elegida.precio, ...enCamino },
          papel: enPedido
            ? { cliente: cliente.name, telefono: cliente.phone ?? null, enCamino: origenesDelPedido(renglonesDelPedido),
              renglones: renglonesDelPedido.map((l) => ({ producto: l.productoNombre, cantidad: l.cantidad, precio: l.precio })) }
            : { cliente: cliente.name, telefono: cliente.phone ?? null, producto: nombreProducto, cantidad: cant, precio: elegida.precio,
              ...(desde ? { enCamino: desde.sala } : modo === 'viene' ? { enCamino: origenes } : {}) },
        });
        if (!r.ok) throw r.error;
        const a = r.apartado;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (desde) {
          // La reserva ya quedó y el dinero ya entró: si el traslado no sale, se avisa y se pide a mano.
          try {
            await trasladoApi.current.enviar(`Reserva ${a.codigo ?? ''} para ${shortEmployeeName(cliente.name)}`.trim(), a.id ? { reserva_id: a.id } : null);
          } catch (e) {
            fallo('La reserva quedó, pero el traslado no se pidió', `${mensajeAmigable(e, '')} Pídelo desde Inventario.`);
            terminar();
            return;
          }
        }
        if (r.aviso) fallo('Anticipo cobrado, con un pendiente', r.aviso);
        else if (!r.papel?.ok) fallo('Anticipo cobrado, pero la constancia no salió', r.papel?.detalle ?? '');
        else listo('Anticipo cobrado', `${a.codigo} · saldo ${formatMoney(Number(a.saldo ?? 0))} al retirar${desde ? ` · ${desde.sala} lo manda` : ''}`);
        terminar();
        return;
      }
      if (soloEncargo) {
        trabajando('Registrando el encargo…');
        const todas = [...lineas, ...(producto && elegida ? [lineaActual] : [])];
        const r = await crearEncargosEnSucursal({ branchId: sala, customerId: cliente.id, lineas: todas, nota });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo(`Encargo registrado · ${r.length} productos`, `${r.map((e) => e.codigo).join(', ')} · Compras confirma precios y fechas; después se cobra en «Por cobrar».`);
        for (const e of r) await papelDeEncargo(e.codigo, e.producto_nombre, false, e.cantidad);
        terminar();
        return;
      }
      trabajando('Registrando el encargo…');
      const r = await crearEncargoEnSucursal({ branchId: sala, customerId: cliente.id, productoId: producto.id,
        productoNombre: nombreProducto, factor: elegida.factor, cantidad: cant, nota });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo('Encargo registrado', `${r.codigo} · Compras confirma el precio y la fecha; después se cobra en «Por cobrar».`);
      await papelDeEncargo(r.codigo, nombreProducto, false, cant);
      terminar();
    } catch (e) {
      fallo(conAnticipo && !sinCatalogo ? 'No se pudo cobrar' : 'No se pudo registrar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setEnviando(false);
    }
  };

  const etiqueta = sinCatalogo ? 'Enviar consulta a Bodega'
    : enPedido ? `Apartar ${renglonesDelPedido.length} productos · cobrar ${formatMoney(montoAnticipo)}`
      : soloEncargo ? `Registrar encargo · ${lineas.length + (lineaActual ? 1 : 0)} productos`
        : modo === 'encargo' ? 'Registrar encargo'
          : conAnticipo && cobroEn === 'enlace' ? `${modo === 'traslado' ? 'Pedir y crear enlace' : 'Crear enlace de pago'} · ${formatMoney(montoAnticipo)}`
            : `${modo === 'traslado' ? 'Pedir y cobrar' : 'Apartar y cobrar'}${conAnticipo ? ` ${formatMoney(montoAnticipo)}` : ''}`;

  const confirmar = () => {
    if (falta || enviando) return;
    const metodo = FORMAS_DE_PAGO.find((f) => f.value === pago.forma)?.label ?? 'Efectivo';
    const quien = shortEmployeeName(cliente?.name ?? '');
    const texto = sinCatalogo ? `${quien} consulta ${cant} × ${nombreNuevo.trim()}. Bodega responde el precio y para cuándo.`
      : enPedido ? `${quien} aparta ${renglonesDelPedido.length} productos en un pedido.\nTotal ${formatMoney(totalCobro)} · anticipo ${formatMoney(montoAnticipo)} (${metodo}) · falta ${formatMoney(Math.max(totalCobro - montoAnticipo, 0))} al retirar.${estadoPago.noEfectivo ? ' No entra al cajón.' : ` Entra a la caja de ${nombreSala}.`}`
        : !conAnticipo ? `${quien} encarga ${soloEncargo ? `${lineas.length + (lineaActual ? 1 : 0)} productos` : `${cant} × ${nombreProducto}`}. Compras confirma el precio y la fecha; ahora no se cobra nada.`
          : cobroEn === 'enlace' ? `${quien} aparta ${cant} × ${nombreProducto}. Queda separado 3 días mientras paga; al pagar, el plazo pasa a 7.${modo === 'traslado' ? ` Se pide a ${traslado.sala}.` : ''}`
            : `${quien} aparta ${cant} × ${nombreProducto}.\nAnticipo ${formatMoney(montoAnticipo)} (${metodo}) · falta ${formatMoney(Math.max(totalCobro - montoAnticipo, 0))} al retirar.${modo === 'traslado' ? ` Se pide a ${traslado.sala}.` : modo === 'viene' ? ' Queda en camino.' : ' 7 días.'}${estadoPago.noEfectivo ? ' No entra al cajón.' : ` Entra a la caja de ${nombreSala}.`}`;
    Alert.alert(`¿${etiqueta}?`, texto, [{ text: 'Volver', style: 'cancel' }, { text: 'Sí', onPress: hacer }]);
  };

  return (
    <>
      <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
        {`Si hay en ${nombreSala || 'la sala'} se aparta con anticipo y ${plazoAlApartar(reglasDeReserva)} para retirarlo; si no hay, se encarga y Compras confirma el precio. Todo sale con su papel.`}
      </Text>
      <Seccion titulo="Cliente">
        <ElegirCliente cliente={cliente} onElegir={(c) => { setCliente(c); setTelOk(false); }} />
        {cliente ? (
          <TelefonoDelCliente key={cliente.id} cliente={cliente} confirmado={telOk} onConfirmar={() => setTelOk(true)}
            onCambiado={(phone) => { setCliente((c) => ({ ...c, phone })); setTelOk(true); }} />
        ) : null}
      </Seccion>

      {enPedido ? <Renglones titulo="En el pedido" lineas={apartados} total={totalApartados} onQuitar={(i) => setApartados((as) => as.filter((_, j) => j !== i))} /> : null}
      {lineas.length ? <Renglones titulo="En el encargo" lineas={lineas} total={totalLineas} onQuitar={(i) => setLineas((ls) => ls.filter((_, j) => j !== i))} /> : null}

      <Seccion titulo={enPedido || soloEncargo ? 'Otro producto (opcional)' : 'Producto'}>
        {sinCatalogo ? (
          <ProductoNuevo nombre={nombreNuevo} srs={srs} noAparece={srsNoAparece}
            onNombre={(v) => { setNombreNuevo(v); setSrs(null); setSrsNoAparece(false); }}
            onSrs={(r) => { setSrs(r); setSrsNoAparece(false); }} onNoAparece={() => { setSrs(null); setSrsNoAparece(true); }}
            onVolver={() => { setSinCatalogo(false); setSrs(null); setSrsNoAparece(false); setFotos([]); }}
            cantidad={cantidad} onCantidad={setCantidad} fotos={fotos} onFotos={setFotos} nota={nota} onNota={setNota}
            onUsarCatalogo={(p) => { setSinCatalogo(false); setSrs(null); setSrsNoAparece(false); setFotos([]); setProducto({ id: Number(p.id), nombre: p.nombre }); setPres(''); }} />
        ) : buscandoProducto ? (
          <BuscadorProducto onElegir={(p) => { setProducto({ id: Number(p.id), nombre: p.nombre }); setPres(''); setBuscandoProducto(false); }}
            onCancelar={() => setBuscandoProducto(false)} />
        ) : producto ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
              <Enlace texto={soloEncargo || enPedido ? 'Quitar' : 'Cambiar'} onPress={() => { limpiarProducto(); if (!soloEncargo && !enPedido) setBuscandoProducto(true); }} />
            </View>
            {presentaciones == null ? <ActivityIndicator /> : !presentaciones.length ? <Aviso tono="cuidado" texto="Ese producto no tiene precio." /> : (
              presentaciones.length > 1 ? (
                <Opciones opciones={presentaciones.map((p) => ({ id: clavePresentacion(p), label: `${p.tipo} · ${formatMoney(p.precio)}` }))} valor={pres} onCambiar={setPres} />
              ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${presentaciones[0].tipo} · ${formatMoney(presentaciones[0].precio)}`}</Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Cantidad</Text>
              <View style={{ width: 90 }}>
                <Campo multiline={false} value={cantidad} keyboardType="number-pad" onChangeText={(v) => setCantidad(v.replace(/\D/g, '').slice(0, 3))} placeholder="Cant." style={{ textAlign: 'center' }} />
              </View>
            </View>
            {elegida && cant > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${cant} × ${formatMoney(elegida.precio)} = ${formatMoney(total)} con el precio de hoy`}</Text> : null}
          </>
        ) : (
          <>
            <Enlace texto="Buscar el producto a apartar o encargar" onPress={() => setBuscandoProducto(true)} />
            {!soloEncargo && !enPedido ? <Enlace texto="¿No lo tenemos? Consultar un producto nuevo a Bodega" color={MARCA.violetaClaro} onPress={() => setSinCatalogo(true)} /> : null}
          </>
        )}
      </Seccion>

      {!sinCatalogo && producto && elegida && cant > 0 && !opciones ? <ActivityIndicator /> : null}
      {!sinCatalogo && producto && elegida && opciones ? (
        <Seccion titulo={modo === 'reserva' ? 'Disponibilidad' : 'Cómo llega'}>
          {vienen.length ? <YaVieneEnCamino vienen={vienen} factor={elegida.factor} cantidad={cant} elegidos={elegidosIds} onCambiar={setVienenElegidos} /> : null}
          {opciones.modo === 'encargo' && !vieneSel.length && !soloEncargo && !enPedido ? (
            <DeOtraSala producto={producto} factor={elegida.factor} cantidad={cant} disponibles={Number(opciones.disponibles)} apiRef={trasladoApi} onCambio={setTraslado} />
          ) : null}
          {modo === 'viene' ? <Aviso texto={`Queda en camino y se marca lista sola al llegar; ahí empieza su plazo.${restoABodega > 0 ? ` Los ${restoABodega} que faltan se encargan a Bodega con la misma reserva.` : ''}`} />
            : modo === 'reserva' ? <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>{`Hay ${Number(opciones.disponibles)} en esta sala: se aparta ${plazoAlApartar(reglasDeReserva)} con el precio de hoy.`}</Text>
              : modo === 'traslado' ? <Aviso texto={`Se pide a ${traslado.sala}: queda en camino y se marca lista al llegar.`} />
                : modo === 'encargo' ? <Aviso tono="cuidado" texto="Se encarga. Compras confirma precio y fecha; cuando el cliente acepte se cobra completo en «Por cobrar». Ahora no se cobra nada." />
                  : null}
          {conAnticipo && opciones.baja_rotacion ? <Aviso tono="cuidado" texto="Es de muy baja rotación: conviene cobrarlo completo." /> : null}
          {puedeApartarOtro ? (
            <View style={{ flexDirection: 'row' }}>
              <Accion texto={enPedido ? 'Agregar al pedido y elegir otro' : 'Apartar otro producto en el mismo cobro'}
                onPress={() => { setApartados((as) => [...as, renglonActual]); limpiarProducto(); }} />
            </View>
          ) : null}
          {puedeAgregar ? (
            <View style={{ flexDirection: 'row' }}>
              <Accion texto="Agregar al encargo y elegir otro" onPress={() => { setLineas((ls) => [...ls, lineaActual]); limpiarProducto(); }} />
            </View>
          ) : null}
        </Seccion>
      ) : null}

      {!sinCatalogo && conAnticipo && (opciones || (enPedido && !producto)) ? (
        <>
          <Seccion titulo={enPedido ? `Cobro del pedido · ${renglonesDelPedido.length} productos` : 'Cobro'}
            pie={enPedido ? 'Un solo cobro: cada producto queda apartado con su parte y se retira con el código del pedido.' : undefined}>
            <Dato rotulo="Total" valor={formatMoney(totalCobro)} primero />
            <Dato rotulo="Deja hoy" valor={formatMoney(deja)} fuerte />
            <Dato rotulo="Al retirar" valor={formatMoney(Math.max(redondear(totalCobro - deja), 0))} />
            <Segmentos opciones={[{ id: 'mitad', label: `50 % · ${formatMoney(mitad)}` }, { id: 'todo', label: `Todo · ${formatMoney(totalCobro)}` }, { id: 'otro', label: 'Otro' }]}
              activa={cuanto} onCambiar={setCuanto} margen={0} />
            {cuanto === 'otro' ? (
              <Campo multiline={false} value={anticipo} keyboardType="decimal-pad" onChangeText={(v) => setAnticipo(dinero(v))} placeholder={`Anticipo (ej. ${mitad})`} style={{ textAlign: 'center', fontWeight: '700' }} autoFocus />
            ) : null}
          </Seccion>
          {/* El enlace de pago es para un solo producto: un pedido se cobra en caja. */}
          {!enPedido ? (
            <Seccion titulo="Dónde paga">
              <Segmentos opciones={[{ id: 'caja', label: 'En caja' }, { id: 'enlace', label: 'Enlace de pago' }]} activa={cobroEn} onCambiar={setCobroEn} margen={0} />
            </Seccion>
          ) : null}
          {cobroEn === 'caja' || enPedido ? <FormaDePago valor={pago} onCambiar={setPago} monto={montoAnticipo || null} /> : null}
        </>
      ) : null}

      {(modo === 'encargo' || (soloEncargo && !producto)) && !sinCatalogo ? (
        <Seccion titulo="Nota para Compras (opcional)">
          <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder="Lo necesita para el viernes" />
        </Seccion>
      ) : null}

      {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
      <BotonGrande texto={enviando ? 'Guardando…' : etiqueta} color={MARCA.verde} deshabilitado={enviando || !!falta} onPress={confirmar} />
    </>
  );
}
