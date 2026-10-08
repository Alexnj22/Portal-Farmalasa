// La VENTA de Torogoz, nativa — la misma vista del portal
// (`views/DistribucionVentaView.jsx`) pensada para el teléfono en ruta.
//
// Arriba lo que se elige antes de vender, en el orden de la caja: cliente,
// de dónde sale (camión o bodega), documento, lista de precios y forma de
// pago. En medio, los renglones como tarjetas. Abajo, fija, la barra del total
// con «Cobrar» (o «Enviar a aprobación»), que abre el cobro como hoja.
//
// Todo lo que decide —precios, descuentos, lotes, existencia, crédito, qué
// impide guardar o facturar— sale del núcleo, lo mismo que en el portal. Ver
// `useVenta.js` para lo que el teléfono no hace todavía y por qué.
//
// Rutas: `/torogoz/venta` (nueva; `?cliente=` y `?desde=` como en el portal)
// y `/torogoz/venta/<pedido>` (finalizar o corregir una preventa).
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { FORMA_PAGO, TIPO_DOCUMENTO, soloVentaLibre } from '@nucleo/utils/distribucionComun';
import { presentacionesDe, precioDe } from '@nucleo/utils/distribucionPrecios';
import { conCantidad } from '@nucleo/utils/distribucionVenta';
import { BARRA_NATIVA } from '../../PilaDePestana';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import Segmentos from '../../Segmentos';
import Vidrio from '../../Vidrio';
import Escaner from '../../Escaner';
import { MARCA } from '../../inicio/marca';
import { iconoDe } from '../../../tema/iconos';
import { listo } from '../../Progreso';
import { volver } from '../../volver';
import VentaPerdida from '../bodega/VentaPerdida';
import Existencias from '../bodega/Existencias';
import useVenta from './useVenta';
import Renglon from './Renglon';
import Cobro from './Cobro';
import { ElegirCliente, Pendientes } from './Hojas';
import { Desglose, Eleccion, Etiqueta, PETROLEO } from './Piezas';
import { AvisoSinSenal, useColaSinSenal } from './SinSenal';
import { ACCIONES_DE_DINERO } from '../soloConsulta';

const RESULTADOS = 8;

function BotonIcono({ icono, etiqueta, onPress, color = colorSistema.acento }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <Host matchContents><Icon name={iconoDe(icono)} size={22} color={color} /></Host>
    </Pressable>
  );
}

function Accion({ texto, color = colorSistema.acento, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button" hitSlop={6}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: deshabilitado ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function PantallaVenta({ pedidoId = null, desde = null, cliente: clienteInicial = null }) {
  const s = useVenta({ pedidoId, desde, clienteInicial });
  // Sólo consulta (soloConsulta.js): sin facturar no hay venta sin señal, y la
  // cola guardada no se manda (enviarla es facturar en contingencia).
  const cola = useColaSinSenal({ automatico: ACCIONES_DE_DINERO });
  const margen = useSafeAreaInsets();
  const [buscar, setBuscar] = useState('');
  const [verCliente, setVerCliente] = useState(false);
  const [verCobro, setVerCobro] = useState(false);
  const [verPendientes, setVerPendientes] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [perdida, setPerdida] = useState(null);
  const [imprimir, setImprimir] = useState(true);
  const [verExistencias, setVerExistencias] = useState(null); // null, o el texto con que abre

  const {
    corrigiendo, cargando, errorCarga, puedeVender, cliente, catalogo, permitido, idx, listaEfectiva, existencias, quienTiene,
    lineas, venta, conIva, porAprobar, montoPorAprobar, unidadesTotal, bloqueoGuardar, puedeGuardar, guardando, pedido,
  } = s;

  const resultados = useMemo(() => {
    const q = buscar.trim();
    if (!q || !cliente) return [];
    return catalogo.filter(p => permitido(p) && tokenMatch(q, p.nombre, p.codigo_barras)).slice(0, RESULTADOS);
  }, [buscar, catalogo, cliente, permitido]);

  const titulo = corrigiendo
    ? (pedido?.pedido.reemplaza_dte_id ? `Corregir documento` : `Finalizar venta ${pedidoId}`)
    : 'Nueva venta';

  const agregar = (p) => {
    setBuscar('');
    const r = s.agregar(p);
    if (r?.perdida) {
      const quien = quienTiene(p.product_id);
      if (quien.length) Alert.alert('No hay más', `${quien.join(' y ')} lo está vendiendo.`);
      setPerdida(r.perdida);
    } else {
      Haptics.selectionAsync().catch(() => {});
    }
  };

  // Un código leído: si es el de un producto que se le puede vender, se
  // agrega; si no, queda escrito en el buscador para verlo.
  const alEscanear = (codigo) => {
    const c = String(codigo ?? '').trim();
    const p = catalogo.find(x => String(x.codigo_barras ?? '') === c && permitido(x));
    setEscaneando(false);
    if (p) agregar(p);
    else setBuscar(c);
  };

  const ir = (r) => {
    if (!r) return;
    if (r.documento) { setVerCobro(false); router.replace(`/torogoz/documento/${r.documento}${imprimir ? '?imprimir=1' : ''}`); return; }
    if (r.inicio) { setVerCobro(false); router.replace('/torogoz/pedidos'); return; }
    if (r.sinSenal) {
      setVerCobro(false);
      Alert.alert('Venta guardada sin señal',
        `Se factura en contingencia sola al volver la señal.\nCódigo de generación ${r.sinSenal.codigo_generacion.slice(0, 8)}…`);
      return;
    }
    if (r.otra) { setVerCobro(false); if (corrigiendo) router.replace('/torogoz/venta'); }
  };

  const guardarPreventa = () => {
    Alert.alert('Guardar preventa', 'Queda en Pendientes para facturarla después, con lo que lleva apartado.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => ir(await s.guardar('preventa')) },
    ]);
  };

  const puedeBorrarPreventa = corrigiendo && !!pedido && !pedido.pedido.reemplaza_dte_id && puedeVender;
  const hayAlgo = !!s.clienteId || s.carrito.length > 0;
  const borrar = () => {
    if (!corrigiendo) {
      Alert.alert('Vaciar la venta', `Se quitan el cliente y ${s.carrito.length === 1 ? 'el producto' : `los ${s.carrito.length} productos`}. Todavía no se había guardado nada.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Vaciar', style: 'destructive', onPress: async () => ir(await s.borrar()) },
      ]);
      return;
    }
    const texto = `La venta de ${cliente?.nombre ?? ''} por ${formatMoney(venta.total)} deja de salir en Pendientes. Queda anulada en Pedidos, con el motivo${s.esperandoAprobacion ? ', y se cancela la solicitud de descuento' : ''}.`;
    if (Platform.OS === 'web') {
      Alert.alert(`Borrar la preventa ${pedido.pedido.id}`, texto, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar preventa', style: 'destructive', onPress: async () => ir(await s.borrar('')) },
      ]);
      return;
    }
    Alert.prompt(`Borrar la preventa ${pedido.pedido.id}`, texto, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar preventa', style: 'destructive', onPress: async (motivo) => ir(await s.borrar(motivo)) },
    ], 'plain-text', '', 'default');
  };

  const opcionesDoc = [
    { value: '01', label: TIPO_DOCUMENTO['01'].largo },
    { value: '03', label: TIPO_DOCUMENTO['03'].largo, deshabilitada: !cliente?.contribuyente },
  ];
  const opcionesListas = idx.listas.map(l => ({ value: String(l.id), label: `${l.nombre}${l.id === s.listaBase ? ' (base)' : ''}` }));
  const opcionesPago = [...FORMA_PAGO, ...(s.tieneCredito ? [{ value: '13', label: `A crédito · ${cliente.plazo_dias} días` }] : [])];

  if (cargando) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: titulo }} /><ActivityIndicator style={{ marginTop: 120 }} /></>);
  }

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: titulo, headerLargeTitle: false,
        headerRight: !corrigiendo && s.pendientes?.length ? () => (
          <Pressable onPress={() => { s.releerPendientes(); setVerPendientes(true); }} hitSlop={8} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
            <Text style={{ color: colorSistema.acento, fontSize: 16 }}>Pendientes</Text>
            <Etiqueta tono="cuidado" texto={String(s.pendientes.length)} />
          </Pressable>
        ) : undefined,
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 150 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
        <AvisoSinSenal lista={cola.lista} enviando={cola.enviando} onEnviar={ACCIONES_DE_DINERO ? cola.enviar : null} />
        {errorCarga ? (
          <>
            <Aviso tono="freno" texto={errorCarga} />
            <BotonGrande texto="Volver" borde color={PETROLEO} onPress={() => volver('/torogoz')} />
          </>
        ) : (
          <>
            {!puedeVender ? <Aviso tono="freno" texto="No tienes permiso para vender en Distribución." /> : null}
            {s.avisoReserva ? <Aviso tono="cuidado" texto={s.avisoReserva} /> : null}

            <Seccion titulo="Cliente">
              <Pressable disabled={corrigiendo} onPress={() => setVerCliente(true)} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ flex: 1, color: cliente ? colorSistema.texto : colorSistema.texto2, fontSize: 17, fontWeight: cliente ? '700' : '400' }} numberOfLines={2}>
                  {cliente ? cliente.nombre : 'Elegir cliente…'}
                </Text>
                {!corrigiendo ? <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{cliente ? 'Cambiar ›' : '›'}</Text> : null}
              </Pressable>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {s.minutosReserva != null ? <Etiqueta tono={s.minutosReserva <= 5 ? 'cuidado' : 'marca'} texto={s.minutosReserva > 0 ? `Reservado · ${s.minutosReserva} min` : 'Reserva vencida'} /> : null}
                {s.miCaja === null && s.pagos.some(p => p.forma === '01') ? <Etiqueta tono="cuidado" texto="Sin caja abierta hoy" /> : null}
                {cliente && !cliente.contribuyente ? <Etiqueta texto="Sin NRC: sólo Factura" /> : null}
                {cliente?.gran_contribuyente && s.tipoDoc === '03' ? <Etiqueta tono="cuidado" texto="Retiene 1%" /> : null}
                {cliente && soloVentaLibre(cliente.tipo) ? <Etiqueta texto="Sólo venta libre" /> : null}
                {s.rotuloCredito ? (
                  <Etiqueta texto={s.rotuloCredito}
                    tono={s.credito && Number(s.credito.saldo) > 0 ? (Number(s.credito.disponible) <= 0 ? 'freno' : Number(s.credito.vencido) > 0 ? 'cuidado' : 'nota') : 'nota'} />
                ) : null}
                {cliente?.lista_id && String(cliente.lista_id) !== String(listaEfectiva) ? <Etiqueta tono="cuidado" texto="Lista distinta de la del cliente" /> : null}
              </View>
              {s.sinLicencia ? (
                <Aviso tono="freno" texto={s.licenciaVencida ? 'La licencia de la SRS de este cliente está vencida.' : 'Este cliente no tiene licencia de la SRS registrada.'} />
              ) : null}
            </Seccion>

            {(s.tieneCamion || s.desdeCamion) ? (
              <View style={{ gap: 6 }}>
                {!corrigiendo && !s.carrito.length ? (
                  <Segmentos activa={s.desdeCamion ? 'camion' : 'bodega'} onCambiar={(v) => s.setDesdeCamion(v === 'camion')}
                    opciones={[{ id: 'camion', label: 'De mi camión' }, { id: 'bodega', label: 'Preventa (bodega)' }]} />
                ) : (
                  <Etiqueta tono="marca" texto={s.desdeCamion ? 'Sale de tu camión' : 'Preventa: sale de bodega'} />
                )}
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 16 }}>
                  {corrigiendo ? 'Sale de donde se tomó el pedido.'
                    : s.carrito.length ? 'Para cambiar de dónde sale, vacía la venta.'
                    : s.desdeCamion ? 'Se entrega ahora, con lo que llevas cargado.' : 'Se entrega después, desde bodega.'}
                </Text>
              </View>
            ) : null}

            <Seccion titulo="Documento y pago">
              <Eleccion rotulo="Documento" valor={s.tipoDoc} opciones={opcionesDoc} onCambiar={s.setTipoDoc} />
              <Eleccion rotulo="Lista de precios" valor={listaEfectiva != null ? String(listaEfectiva) : ''} opciones={opcionesListas}
                mensaje="Cambia el precio de todos los productos." onCambiar={s.cambiarLista} deshabilitado={!opcionesListas.length} />
              {s.pagos.length > 1 ? (
                <Pressable onPress={() => setVerCobro(true)} style={{ flexDirection: 'row', minHeight: 44, alignItems: 'center' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Forma de pago</Text>
                  <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{`Pago dividido · ${s.pagos.length}  ›`}</Text>
                </Pressable>
              ) : (
                <Eleccion rotulo="Forma de pago" valor={s.pagos[0].forma} opciones={opcionesPago} onCambiar={s.cambiarFormaPago} deshabilitado={!cliente} />
              )}
            </Seccion>

            <Seccion titulo="Productos">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <Campo multiline={false} value={buscar} onChangeText={setBuscar} editable={!!cliente} autoCorrect={false} clearButtonMode="while-editing"
                    placeholder={cliente ? 'Producto o código de barras' : 'Elige primero el cliente'} returnKeyType="search"
                    onSubmitEditing={() => { if (resultados[0]) agregar(resultados[0]); }} />
                </View>
                {cliente ? <BotonIcono icono="ScanLine" etiqueta="Escanear un código" onPress={() => setEscaneando(true)} /> : null}
              </View>
              {buscar.trim() && cliente ? (
                <View>
                  {resultados.length === 0 ? (
                    <View style={{ gap: 4, paddingVertical: 6 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                        {`Nada que coincida${soloVentaLibre(cliente.tipo) ? ' entre los productos de venta libre' : ''}.`}
                      </Text>
                      <Accion texto="Buscar en todas las sucursales" onPress={() => setVerExistencias(buscar)} />
                      <Accion texto="Anotar venta perdida" color={MARCA.ambar} onPress={() => { setPerdida({ buscado: buscar, cantidad: 1 }); setBuscar(''); }} />
                    </View>
                  ) : resultados.map((p, k) => {
                    const pres = presentacionesDe(idx, p.product_id);
                    const r = precioDe(idx, p, pres[0].presentacion, listaEfectiva);
                    const hay = existencias?.get(String(p.product_id));
                    const quien = hay != null && !(hay > 0) ? quienTiene(p.product_id) : [];
                    return (
                      <Pressable key={p.product_id} onPress={() => agregar(p)} accessibilityRole="button"
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8,
                          borderTopWidth: k ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{p.nombre}</Text>
                          <Text style={{ color: hay != null && !(hay > 0) ? MARCA.rojo : colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                            {pres.map(x => x.presentacion).join(' · ')}
                            {hay != null ? ` · ${hay > 0 ? `hay ${hay}` : quien.length ? `reservado por ${quien.join(' y ')}` : 'sin existencia'}` : ''}
                          </Text>
                        </View>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                          {r ? formatMoney(conIva ? r.precio : r.precio / 1.13) : 'Sin precio'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {!lineas.length && !buscar.trim() ? (
                <View style={{ alignItems: 'center', paddingVertical: 14, gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{cliente ? 'Agrega productos' : 'Elige el cliente para empezar'}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>
                    {cliente ? 'Escribe el nombre o escanea el código de barras.' : 'Lo que se le puede vender depende de él.'}
                  </Text>
                </View>
              ) : null}
            </Seccion>

            {lineas.map(l => (
              <Renglon key={l.clave} l={l} lineas={lineas} idx={idx} conIva={conIva} listaEfectiva={listaEfectiva} existencias={existencias}
                onCambiar={(c) => s.cambiar(l.clave, c)} onRepartir={(c) => s.cambiarYRepartir(l.clave, c)} onSumar={(d) => s.sumar(l.clave, d)}
                onQuitar={() => { Haptics.selectionAsync().catch(() => {}); s.quitar(l.clave); }} onPerdida={setPerdida} />
            ))}

            {lineas.length ? (
              <Seccion titulo={TIPO_DOCUMENTO[s.tipoDoc]?.largo ?? 'Resumen'}
                pie={bloqueoGuardar ?? `${lineas.length} producto${lineas.length === 1 ? '' : 's'} · ${conCantidad(unidadesTotal)} pieza${unidadesTotal === 1 ? '' : 's'}`}>
                <Desglose venta={venta} conIva={conIva} porAprobar={montoPorAprobar} />
              </Seccion>
            ) : null}
            {s.error && !verCobro ? <Aviso tono="freno" texto={s.error} /> : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, marginHorizontal: 4 }}>
              <Accion texto="Guardar preventa" onPress={guardarPreventa} deshabilitado={!puedeGuardar} />
              <Accion texto="Existencias en sucursales" onPress={() => setVerExistencias(buscar)} />
              {puedeVender && s.emisor ? <Accion texto="Venta perdida" color={MARCA.ambar} onPress={() => setPerdida({ buscado: buscar, cantidad: 1 })} /> : null}
              {(corrigiendo ? puedeBorrarPreventa : hayAlgo) ? (
                <Accion texto={corrigiendo ? 'Borrar preventa' : 'Vaciar'} color={MARCA.rojo} onPress={borrar} deshabilitado={!!guardando} />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      {!errorCarga && lineas.length ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(margen.bottom, 12) }}>
          <Vidrio radio={26} interactivo>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingLeft: 18 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                  {conIva ? `IVA incluido ${formatMoney(venta.iva)}` : `Sub-total ${formatMoney(venta.subTotal)} + IVA ${formatMoney(venta.iva)}`}
                </Text>
                <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(venta.total)}</Text>
              </View>
              {/* Sin facturar en la app (soloConsulta.js), el botón de abajo guarda la preventa; un descuento por aprobar sigue su camino. */}
              <Pressable disabled={!puedeGuardar} onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                if (!ACCIONES_DE_DINERO && !porAprobar.length) guardarPreventa(); else setVerCobro(true);
              }}
                accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 48, borderRadius: 24, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: porAprobar.length ? MARCA.ambar : PETROLEO, opacity: !puedeGuardar ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{porAprobar.length ? 'Enviar a aprobación' : ACCIONES_DE_DINERO ? 'Cobrar' : 'Guardar preventa'}</Text>
              </Pressable>
            </View>
          </Vidrio>
        </View>
      ) : null}

      {verCliente ? (
        <ElegirCliente clientes={s.clientes} clienteId={s.clienteId} onCerrar={() => setVerCliente(false)}
          onElegir={(id) => { s.cambiarCliente(id); setVerCliente(false); }} />
      ) : null}
      {verPendientes ? (
        <Pendientes pendientes={s.pendientes} onCerrar={() => setVerPendientes(false)}
          onElegir={(id) => { setVerPendientes(false); router.push(`/torogoz/venta/${id}`); }} />
      ) : null}
      {verCobro && cliente && lineas.length ? (
        <Cobro venta={s} imprimir={imprimir} setImprimir={setImprimir} onCerrar={() => setVerCobro(false)}
          onProcesar={async (modo) => ir(await s.guardar(modo))} />
      ) : null}
      {perdida && s.emisor ? (
        <VentaPerdida visible emisorId={s.emisor.id} cliente={cliente} pedidoId={pedido?.pedido.id ?? null}
          producto={perdida.producto ?? null} cantidad={perdida.cantidad} buscado={perdida.buscado ?? ''}
          onCerrar={() => setPerdida(null)}
          onGuardado={({ producto, cantidad }) => {
            s.alAnotarPerdida(perdida.clave, cantidad);
            setPerdida(null);
            listo('Venta perdida anotada', `${producto} · ${conCantidad(cantidad)}`);
          }} />
      ) : null}
      {verExistencias != null ? <Existencias visible terminoInicial={verExistencias} onCerrar={() => setVerExistencias(null)} /> : null}
      <Escaner visible={escaneando} titulo="Agregar un producto" ayuda="Apunta al código de barras del producto"
        onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} />
    </>
  );
}
