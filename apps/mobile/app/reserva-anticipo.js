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
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Share, Text, View } from 'react-native';
import Indicador from '../componentes/Indicador';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  apartarSinAnticipo, crearEncargoDeProductoNuevo, crearEncargoEnSucursal, crearEncargosEnSucursal, listaDelCliente, mensajeDeEnlaceDePago, opcionesDeApartado,
  preciosDeProducto, srsParaEncargo,
} from '@nucleo/data/reservas';
import { enlaceDePagoDeApartado } from '@nucleo/data/bolsas';
import { apartadoDelPedido, clavePresentacion, listaQueLeToca, origenesDelPedido, planDeApartar, redondear } from '@nucleo/utils/apartar';
import { plazoAlApartar, SI_EL_TRASLADO_NO_SALIO } from '@nucleo/utils/reservasDeSala';
import { useReglasDeReserva } from '@nucleo/hooks/useReglasDeReserva';
import { FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import FormaDePago from '../componentes/formulario/FormaDePago';
import { subirFotos } from '../componentes/formulario/Fotos';
import Segmentos from '../componentes/Segmentos';
import Interruptor from '../componentes/Interruptor';
import FijoArriba from '../componentes/FijoArriba';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { Accion, ElegirCliente, Enlace, TelefonoDelCliente } from '../componentes/reservas/piezas';
import { DeOtraSala, YaVieneEnCamino } from '../componentes/reservas/ComoLlega';
import ProductoNuevo from '../componentes/reservas/ProductoNuevo';
import PorCobrar from '../componentes/reservas/PorCobrar';
import { cobrarAnticipoEnLaApp, imprimirEncargoEnLaApp } from '../componentes/reservas/cobrar';

const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');
// Los mismos rótulos de «Dónde paga» que el portal (`DialogoApartar`).
const ROTULO_DE_COBRO = { caja: 'En caja', enlace: 'Enlace de pago', sin: 'Sin anticipo' };
const llave = (sala) => `app_apartar_${sala ?? 'sin-sala'}`;

/** Lo ya agregado al pedido o al encargo, con «Quitar». */
function Renglones({ titulo, lineas, total, onQuitar }) {
  return (
    <Seccion titulo={`${titulo} · ${lineas.length}${lineas.some((l) => !l.nuevo) ? ` · ${formatMoney(total)}` : ''}`}
      pie={lineas.some((l) => !l.nuevo) ? 'Con el precio de hoy.' : 'Bodega responde el precio de cada uno.'}>
      {lineas.map((l, i) => (
        <View key={`${l.productoId}-${l.factor}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${l.cantidad} × ${l.productoNombre}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{l.nuevo ? 'Producto nuevo · Bodega responde el precio' : `${formatMoney(redondear(l.precio * l.cantidad))}${l.origen ? ` · viene de ${l.origen}` : ''}`}</Text>
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
  // `vista`/`elegir` (2026-11-04): «Cobrar» de un encargo abre «Por cobrar» con él elegido.
  const { sala: salaElegida, vista: vistaInicial, elegir } = useLocalSearchParams();
  const sala = salaElegida ?? user?.branchId ?? user?.branch_id ?? null;
  const nombreSala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(sala))?.name) || '';
  const [vista, setVista] = useState(vistaInicial === 'cobrar' ? 'cobrar' : 'nuevo');
  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Apartar o encargar' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        {sala ? <FijoArriba><Segmentos opciones={[{ id: 'nuevo', label: 'Nuevo' }, { id: 'cobrar', label: 'Por cobrar' }]} activa={vista} onCambiar={setVista} /></FijoArriba> : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {!sala ? <Aviso tono="freno" texto="No tienes sucursal asignada. Las reservas se hacen desde una sucursal." /> : (
            <>
              {vista === 'nuevo' ? <Nuevo sala={sala} nombreSala={nombreSala} user={user} /> : <PorCobrar sala={sala} nombreSala={nombreSala} user={user} elegirClave={elegir ? String(elegir) : null} />}
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
  // La lista de precio con que se aparta, como en el portal: null = la que le
  // toca al cliente según el reglamento (`listaQueLeToca`); si alguien la
  // cambia a mano, queda la elegida.
  const [lista, setLista] = useState(guardado?.lista ?? null);
  const [listaBase, setListaBase] = useState(null);
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
  // En caja, con enlace de pago (un solo producto) o sin anticipo, a
  // responsabilidad de quien lo aparta. Si lo elegido ya no vale, el primero.
  const [cobroElegido, setCobroEn] = useState('caja');
  const [responsableOk, setResponsableOk] = useState(false);
  const formasDeCobro = ['caja', !apartados.length && 'enlace', 'sin'].filter(Boolean);
  const cobroEn = formasDeCobro.includes(cobroElegido) ? cobroElegido : formasDeCobro[0];
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(() => `app-apartar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    saveDraft(llave(sala), { cliente, producto, pres, lista, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece, lineas, apartados });
  }, [sala, cliente, producto, pres, lista, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece, lineas, apartados]);

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

  // La lista del cliente: sin respuesta se queda en Público (`descuento_1`),
  // el que le toca a quien no tiene cuenta. Igual que el portal.
  useEffect(() => {
    let vivo = true;
    if (!cliente?.id) { setListaBase(null); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al quitar el cliente
    listaDelCliente(cliente.id).then((l) => { if (vivo) setListaBase(l ?? 'descuento_1'); })
      .catch(() => { if (vivo) setListaBase('descuento_1'); });
    return () => { vivo = false; };
  }, [cliente?.id]);

  const presElegida = useMemo(() => (presentaciones ?? []).find((p) => clavePresentacion(p) === pres) ?? null, [presentaciones, pres]);
  const listaSugerida = useMemo(() => listaQueLeToca(listaBase, presElegida, presentaciones ?? []), [listaBase, presElegida, presentaciones]);
  // La presentación con el precio de la lista elegida: total, anticipo,
  // renglón del pedido, constancia y lo que va a la base cuentan con ése. Si la
  // presentación no tiene esa lista, vale la viñeta.
  const elegida = useMemo(() => {
    if (!presElegida) return null;
    const l = presElegida.listas?.find((x) => x.key === (lista ?? listaSugerida));
    return l ? { ...presElegida, precio: l.precio, lista: l.key } : { ...presElegida, lista: 'vineta' };
  }, [presElegida, lista, listaSugerida]);
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
    opciones, producto, elegida, cantidad, lineas, apartados, vienenElegidos, traslado, cuanto, anticipo, pago, cobroEn, responsableOk,
    cliente, telOk, sinCatalogo, nombreNuevo, srs, srsNoAparece,
  }), [opciones, producto, elegida, cantidad, lineas, apartados, vienenElegidos, traslado, cuanto, anticipo, pago, cobroEn, responsableOk,
    cliente, telOk, sinCatalogo, nombreNuevo, srs, srsNoAparece]);
  const { total, soloEncargo, enPedido, vienen, elegidosIds, vieneSel, restoABodega, origenes, modo, totalApartados, totalCobro, mitad,
    seCobra, sinAnticipo, conAnticipo, montoAnticipo, estadoPago, nombreProducto, lineaActual, totalLineas, enCamino, puedeAgregar, puedeApartarOtro,
    renglonActual, renglonesDelPedido, falta, deja, nombreNuevoListo, lineaNuevaActual, puedeAgregarNuevo } = plan;
  // Lo que va en el encargo de varios: lo agregado más el producto de la pantalla.
  const renglonDePantalla = sinCatalogo ? lineaNuevaActual : (producto && elegida ? lineaActual : null);
  const productosDelEncargo = lineas.length + (renglonDePantalla ? 1 : 0);

  const limpiarProducto = () => { setProducto(null); setPres(''); setLista(null); setCantidad('1'); setTraslado(null); setVienenElegidos(null); setOpciones(null); };
  const terminar = () => { clearDraft(llave(sala)); router.back(); };
  const papelDeEncargo = async (codigo, texto, nuevo, cantidadDelPapel) => {
    const r = await imprimirEncargoEnLaApp({ sala, nombreSala, user, codigo, cliente, producto: texto, cantidad: cantidadDelPapel, nuevo });
    if (!r.ok) fallo('No se imprimió la constancia', r.detalle);
  };

  // Un papel para todo el encargo (2026-11-24): cada producto con su código y sus barras.
  const papelDeEncargos = async (creados) => {
    const r = await imprimirEncargoEnLaApp({ sala, nombreSala, user, cliente,
      renglones: creados.map((e) => ({ codigo: e.codigo, producto: e.producto_nombre, cantidad: e.cantidad, nuevo: !!e.nuevo })) });
    if (!r.ok) fallo('No se imprimió la constancia', r.detalle);
  };
  // El producto nuevo de la pantalla, listo para la base: el SRS como se
  // guarda, su nota para Bodega y la foto ya subida.
  const renglonNuevoConFoto = async () => ({
    ...lineaNuevaActual, srs: srs ? srsParaEncargo(srs) : null, nota,
    fotoUrl: fotos[0] ? (await subirFotos([fotos[0]], { bucket: 'encargos-fotos', carpeta: String(Number(sala)) }))[0] ?? null : null,
  });
  const [agregandoNuevo, setAgregandoNuevo] = useState(false);
  const agregarNuevo = async () => {
    setAgregandoNuevo(true);
    try {
      const l = await renglonNuevoConFoto();
      setLineas((ls) => [...ls, l]);
      setNombreNuevo(''); setSrs(null); setSrsNoAparece(false); setFotos([]); setCantidad('1'); setNota('');
    } catch (e) {
      fallo('No se pudo agregar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setAgregandoNuevo(false);
    }
  };

  const hacer = async () => {
    setEnviando(true);
    try {
      if (sinCatalogo && !soloEncargo) {
        trabajando('Enviando la consulta…');
        const fotoUrl = fotos[0] ? (await subirFotos([fotos[0]], { bucket: 'encargos-fotos', carpeta: String(Number(sala)) }))[0] ?? null : null;
        const r = await crearEncargoDeProductoNuevo({ branchId: sala, customerId: cliente.id, nombre: nombreNuevoListo, cantidad: cant, nota,
          srs: srs ? srsParaEncargo(srs) : null, fotoUrl });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Consulta enviada a Bodega', `${r.codigo} · Bodega responde el precio y para cuándo, o si no se puede conseguir.`);
        await papelDeEncargo(r.codigo, nombreNuevoListo, true, cant);
        terminar();
        return;
      }
      // Sin anticipo (como el portal): no pasa por la caja ni por el enlace.
      // La base firma la reserva con la sesión: responde quien la pidió.
      if (sinAnticipo) {
        trabajando('Apartando…');
        const r = await apartarSinAnticipo(sala, enPedido
          ? apartadoDelPedido(cliente.id, renglonesDelPedido)
          : { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombreProducto,
            factor: elegida.factor, cantidad: cant, precio: elegida.precio, ...enCamino });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (modo === 'traslado' && traslado && !enPedido) {
          try {
            await trasladoApi.current.enviar(`Reserva ${r.codigo} para ${shortEmployeeName(cliente.name)}`, { reserva_id: r.id });
          } catch (e) {
            fallo('La reserva quedó, pero el traslado no se pidió', `${mensajeAmigable(e, '')} ${SI_EL_TRASLADO_NO_SALIO}`);
            terminar();
            return;
          }
        }
        listo('Apartado sin anticipo', `${r.codigo} · ${shortEmployeeName(cliente.name)} · ${r.vence_at
          ? `vale hasta el ${fechaTexto(r.vence_at, { day: 'numeric', month: 'long' })}`
          : 'el plazo corre cuando llegue'}. Quedas como responsable.`);
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
          } catch (e) { fallo('El apartado quedó, pero el traslado no se pidió', `${mensajeAmigable(e, '')} ${SI_EL_TRASLADO_NO_SALIO}`); }
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
            fallo('La reserva quedó, pero el traslado no se pidió', `${mensajeAmigable(e, '')} ${SI_EL_TRASLADO_NO_SALIO}`);
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
        // Con productos nuevos (2026-11-24): cada uno lleva su nota para
        // Bodega; la nota de la pantalla es la del nuevo, no la del encargo.
        const actual = sinCatalogo ? (lineaNuevaActual ? [await renglonNuevoConFoto()] : []) : (renglonDePantalla ? [renglonDePantalla] : []);
        const r = await crearEncargosEnSucursal({ branchId: sala, customerId: cliente.id, lineas: [...lineas, ...actual], nota: sinCatalogo ? null : nota });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo(`Encargo registrado · ${r.length} productos`, `${r.map((e) => e.codigo).join(', ')} · ${r.some((e) => e.nuevo)
          ? 'Bodega responde precio, fecha y si se pueden conseguir' : 'Compras confirma precios y fechas'}; después se cobra en «Por cobrar».`);
        await papelDeEncargos(r);
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

  const etiqueta = sinCatalogo && !soloEncargo ? 'Enviar consulta a Bodega'
    : sinAnticipo ? (enPedido ? `Apartar ${renglonesDelPedido.length} productos sin anticipo` : modo === 'traslado' ? 'Pedir y apartar sin anticipo' : 'Apartar sin anticipo')
    : enPedido ? `Apartar ${renglonesDelPedido.length} productos · cobrar ${formatMoney(montoAnticipo)}`
      : soloEncargo ? `Registrar encargo · ${productosDelEncargo} productos`
        : modo === 'encargo' ? 'Registrar encargo'
          : conAnticipo && cobroEn === 'enlace' ? `${modo === 'traslado' ? 'Pedir y crear enlace' : 'Crear enlace de pago'} · ${formatMoney(montoAnticipo)}`
            : `${modo === 'traslado' ? 'Pedir y cobrar' : 'Apartar y cobrar'}${conAnticipo ? ` ${formatMoney(montoAnticipo)}` : ''}`;

  const confirmar = () => {
    if (falta || enviando) return;
    const metodo = FORMAS_DE_PAGO.find((f) => f.value === pago.forma)?.label ?? 'Efectivo';
    const quien = shortEmployeeName(cliente?.name ?? '');
    const texto = sinCatalogo && !soloEncargo ? `${quien} consulta ${cant} × ${nombreNuevoListo}. Bodega responde el precio y para cuándo.`
      : sinAnticipo ? `${quien} aparta ${enPedido ? `${renglonesDelPedido.length} productos` : `${cant} × ${nombreProducto}`} sin anticipo.\nNo se cobra nada ahora: paga ${formatMoney(totalCobro)} al retirar. Quedas como responsable.${modo === 'traslado' && !enPedido ? ` Se pide a ${traslado.sala}.` : ''}`
      : enPedido ? `${quien} aparta ${renglonesDelPedido.length} productos en un pedido.\nTotal ${formatMoney(totalCobro)} · anticipo ${formatMoney(montoAnticipo)} (${metodo}) · falta ${formatMoney(Math.max(totalCobro - montoAnticipo, 0))} al retirar.${estadoPago.noEfectivo ? ' No entra a la caja.' : ` Entra a la caja de ${nombreSala}.`}`
        : !conAnticipo ? `${quien} encarga ${soloEncargo ? `${productosDelEncargo} productos` : `${cant} × ${nombreProducto}`}. ${[...lineas, renglonDePantalla].some((l) => l?.nuevo) ? 'Bodega responde el precio y para cuándo' : 'Compras confirma el precio y la fecha'}; ahora no se cobra nada.`
          : cobroEn === 'enlace' ? `${quien} aparta ${cant} × ${nombreProducto}. Queda separado 3 días mientras paga; al pagar, el plazo pasa a 7.${modo === 'traslado' ? ` Se pide a ${traslado.sala}.` : ''}`
            : `${quien} aparta ${cant} × ${nombreProducto}.\nAnticipo ${formatMoney(montoAnticipo)} (${metodo}) · falta ${formatMoney(Math.max(totalCobro - montoAnticipo, 0))} al retirar.${modo === 'traslado' ? ` Se pide a ${traslado.sala}.` : modo === 'viene' ? ' Queda en camino.' : ' 7 días.'}${estadoPago.noEfectivo ? ' No entra a la caja.' : ` Entra a la caja de ${nombreSala}.`}`;
    Alert.alert(`¿${etiqueta}?`, texto, [{ text: 'Volver', style: 'cancel' }, { text: 'Sí', onPress: hacer }]);
  };

  return (
    <>
      <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
        {`Si hay en ${nombreSala || 'la sucursal'}, se aparta con anticipo y tiene ${plazoAlApartar(reglasDeReserva)} para retirarlo. Si no hay, se encarga y Compras confirma el precio. Todo sale con su papel.`}
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
          <ProductoNuevo key={lineas.length} nombre={nombreNuevo} srs={srs} noAparece={srsNoAparece}
            puedeAgregar={puedeAgregarNuevo} agregando={agregandoNuevo} onAgregar={agregarNuevo} opcional={soloEncargo}
            onNombre={(v) => { setNombreNuevo(v); setSrs(null); setSrsNoAparece(false); }}
            onSrs={(r) => { setSrs(r); setSrsNoAparece(false); if (!nombreNuevo.trim()) setNombreNuevo(r.nombre ?? ''); }} onNoAparece={() => { setSrs(null); setSrsNoAparece(true); }}
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
            {presentaciones == null ? <Indicador /> : !presentaciones.length ? <Aviso tono="cuidado" texto="Ese producto no tiene precio." /> : (
              presentaciones.length > 1 ? (
                <Opciones opciones={presentaciones.map((p) => ({ id: clavePresentacion(p), label: p.tipo }))} valor={pres} onCambiar={(v) => { setPres(v); setLista(null); }} />
              ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{presentaciones[0].tipo}</Text>
            )}
            {/* El precio, de la lista que le toca al cliente (se puede cambiar), como en el portal. */}
            {presElegida ? (
              <>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>Precio</Text>
                <Opciones opciones={(presElegida.listas?.length ? presElegida.listas : [{ key: 'vineta', label: 'Regular', precio: presElegida.precio }])
                  .map((l) => ({ id: l.key, label: `${l.label} · ${formatMoney(l.precio)}` }))} valor={elegida?.lista ?? 'vineta'} onCambiar={setLista} />
                {(() => {
                  const toca = listaSugerida ? presElegida.listas?.find((l) => l.key === listaSugerida) : null;
                  if (!toca) return null;
                  return elegida?.lista === listaSugerida
                    ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Es el que le toca a este cliente según el reglamento.</Text>
                    : <Aviso tono="cuidado" texto={`Según el reglamento le toca ${toca.label} (${formatMoney(toca.precio)}).`} />;
                })()}
              </>
            ) : null}
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
            {!enPedido ? <Enlace texto="¿No lo tenemos? Consultar un producto nuevo a Bodega" color={MARCA.violetaClaro} onPress={() => setSinCatalogo(true)} /> : null}
          </>
        )}
      </Seccion>

      {!sinCatalogo && producto && elegida && cant > 0 && !opciones ? <Indicador /> : null}
      {!sinCatalogo && producto && elegida && opciones ? (
        <Seccion titulo={modo === 'reserva' ? 'Disponibilidad' : 'Cómo llega'}>
          {vienen.length ? <YaVieneEnCamino vienen={vienen} factor={elegida.factor} cantidad={cant} elegidos={elegidosIds} onCambiar={setVienenElegidos} /> : null}
          {opciones.modo === 'encargo' && !vieneSel.length && !soloEncargo && !enPedido ? (
            <DeOtraSala producto={producto} factor={elegida.factor} cantidad={cant} disponibles={Number(opciones.disponibles)} apiRef={trasladoApi} onCambio={setTraslado} />
          ) : null}
          {modo === 'viene' ? <Aviso texto={`Queda en camino y se marca lista sola al llegar; ahí empieza su plazo.${restoABodega > 0 ? ` Los ${restoABodega} que faltan se encargan a Bodega con la misma reserva.` : ''}`} />
            : modo === 'reserva' ? <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>{`Hay ${Number(opciones.disponibles)} en esta sucursal. Se aparta${sinAnticipo ? '' : ` ${plazoAlApartar(reglasDeReserva)}`} con el precio de hoy.`}</Text>
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

      {!sinCatalogo && seCobra && (opciones || (enPedido && !producto)) ? (
        <>
          <Seccion titulo="Dónde paga">
            <Segmentos opciones={formasDeCobro.map((f) => ({ id: f, label: ROTULO_DE_COBRO[f] }))} activa={cobroEn} onCambiar={setCobroEn} margen={0} />
          </Seccion>
        </>
      ) : null}
      {!sinCatalogo && sinAnticipo && (opciones || (enPedido && !producto)) ? (
        <Seccion titulo="Sin anticipo">
          <Aviso tono="cuidado" texto={`No se cobra nada ahora. El cliente paga ${formatMoney(totalCobro)} completo al retirar.${modo === 'viene' || modo === 'traslado'
            ? ' El plazo para retirar empieza cuando llegue a la sucursal.' : ' Sin anticipo, el plazo para retirar es más corto. La fecha sale al apartar.'}`} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`Quedo como responsable de esta reserva${user?.name ? ` (${shortEmployeeName(user.name)})` : ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si el cliente no la retira, responde quien la apartó.</Text>
            </View>
            <Interruptor value={responsableOk} onValueChange={setResponsableOk} />
          </View>
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
