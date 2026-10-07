// Torogoz › un documento, NATIVO — el `DocumentoModal` del portal. Lo primero:
// ¿está bien con Hacienda? (la lista de chequeo con el botón de lo que toca).
// Después, lo vendido (Detalle), sus dos papeles a la vista —el TICKET y la
// hoja del documento, armados del JSON firmado— y sus datos. Abajo, lo que se
// puede hacer, con la MISMA regla que el portal (`accionesDelDocumento`):
//
//   · sin sello o rechazado → «Corregir»: el pedido vuelve a la venta;
//   · sellado → «Corregir» abre un pedido nuevo que lo reemplaza; «Deshacer la
//     venta» lo invalida sin reemplazo; un Crédito Fiscal admite «Devolución»
//     (Nota de Crédito). Pasado el plazo para invalidar, sólo la devolución.
//
// `?imprimir=1` (al venir de facturar) abre la impresión del ticket una vez,
// cuando ya llegaron los pagos —así sale con lo entregado y el cambio—.
//
// ⚠ Reenviar, corregir, deshacer, la invalidación y el aviso de contingencia le
// hablan a Hacienda DE VERDAD: el entorno de pruebas no tiene esas funciones y
// no se pueden probar ahí. Cada una pide confirmar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  anularVenta, corregirDocumentoSellado, descartarDocumento, enviarContingencia, fetchDocumento, fetchPagos,
  fetchPlazoInvalidacion, mensajeDeDistribucion, reenviarInvalidacion, reintentarDocumento,
} from '@nucleo/data/distribucion';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO } from '@nucleo/utils/distribucionComun';
import {
  accionesDelDocumento, avisoDeAccion, avisoDelPlazo, ayudaDelSellado, queHaceCorregir, resumenDeContingencia,
} from '@nucleo/utils/distribucionFacturacion';
import { ticketDeVenta, urlConsultaPublica } from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from '@nucleo/utils/distribucionMarca';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../../componentes/formulario/Piezas';
import { Pildora } from '../../../componentes/avisos/Piezas';
import { colorDeVariante } from '../../../componentes/colorDeVariante';
import Segmentos from '../../../componentes/Segmentos';
import Vidrio from '../../../componentes/Vidrio';
import { MARCA } from '../../../componentes/inicio/marca';
import { cerrarProgreso, fallo, listo, trabajando } from '../../../componentes/Progreso';
import EstadoHacienda from '../../../componentes/torogoz/fiscal/EstadoHacienda';
import DetalleDeVenta from '../../../componentes/torogoz/fiscal/DetalleDeVenta';
import CorreoDocumento from '../../../componentes/torogoz/fiscal/CorreoDocumento';
import PagosDelPedido from '../../../componentes/torogoz/fiscal/PagosDelPedido';
import VistaPapel from '../../../componentes/torogoz/fiscal/VistaPapel';
import {
  compartirDocumento, compartirJson, compartirTicket, elegir, htmlDelDocumento, htmlDelTicket, imprimirDocumentoCarta, imprimirTicket,
} from '../../../componentes/torogoz/fiscal/papel';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';

const PETROLEO = '#0f6e7d';
const VISTAS = [
  { id: 'detalle', label: 'Detalle' },
  { id: 'ticket', label: 'Ticket' },
  { id: 'hoja', label: 'Documento' },
  { id: 'datos', label: 'Datos' },
];
const TONO_PLAZO = { freno: 'freno', cuidado: 'cuidado', nota: 'nota' };

export default function Documento() {
  const p = useLocalSearchParams();
  const id = Number(p.id);
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const [d, setD] = useState(undefined);
  const [pagos, setPagos] = useState(null);
  const [plazo, setPlazo] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('detalle');
  const [ocupado, setOcupado] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ticketHtml, setTicketHtml] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const yaImprimio = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const doc = await fetchDocumento(id);
      setD(doc); setError(null);
      if (!doc?.pedido_id) setPagos([]);
      else fetchPagos(doc.pedido_id).then(setPagos).catch(() => setPagos([]));
      if (doc?.estado === 'sellado') fetchPlazoInvalidacion(id).then(setPlazo).catch(() => setPlazo(null));
      else setPlazo(null);
    } catch (e) {
      setD(null); setError(mensajeDeDistribucion(e));
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const base = accionesDelDocumento(d, { puedeVender, plazo });
  // Sólo consulta (soloConsulta.js): devolver, corregir y deshacer le hablan a
  // Hacienda; se hacen desde el portal.
  const a = ACCIONES_DE_DINERO ? base : { ...base, puedeDevolver: false, puedeCorregir: false, puedeDeshacer: false };
  const enElPortal = !ACCIONES_DE_DINERO && (base.puedeDevolver || (base.puedeCorregir && d?.estado !== 'rechazado') || base.puedeDeshacer);
  const ticket = useMemo(() => (d && a.conArchivo && pagos != null ? ticketDeVenta(d, MARCA_PAPEL, { pagos }) : null), [d, a.conArchivo, pagos]);
  useEffect(() => {
    let vivo = true;
    if (vista === 'ticket' && ticket) htmlDelTicket(ticket).then((h) => { if (vivo) setTicketHtml(h); }).catch(() => {});
    return () => { vivo = false; };
  }, [vista, ticket]);
  const hojaHtml = useMemo(() => (vista === 'hoja' && d && a.conArchivo ? htmlDelDocumento(d) : null), [vista, d, a.conArchivo]);

  const anotar = (accion, detalle) => useStaffStore.getState().appendAuditLog?.(accion, String(id), { ...detalle, via: 'app' });

  // Recién facturado con «imprimir»: el ticket sale una vez, con los pagos ya leídos.
  useEffect(() => {
    if (p.imprimir !== '1' || !ticket || yaImprimio.current) return;
    yaImprimio.current = true;
    imprimirTicket(ticket).then(() => anotar('DISTRIBUCION_TICKET_IMPRESO', { ok: true })).catch(() => {});
  }, [p.imprimir, ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  const nombre = d ? `${TIPO_DOCUMENTO[d.tipo]?.largo ?? 'Documento'} ${String(d.numero_control).slice(-6)} ${d.dist_clientes?.nombre ?? ''}` : '';

  // Una acción ante Hacienda: confirmar, mandar, contar cómo volvió y releer.
  const ante = (titulo, mensaje, boton, fn, auditoria, despues) => Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, style: boton.startsWith('Deshacer') || boton.startsWith('Invalidar') ? 'destructive' : 'default', onPress: async () => {
      setOcupado(true); trabajando('Hablando con Hacienda…');
      try {
        const r = await fn();
        anotar(auditoria, { estado: r?.estado });
        const av = avisoDeAccion(r, ESTADO_DOCUMENTO);
        // Sellado es un ✓; cualquier otro estado se LEE (dice qué falta).
        if (av.bien) listo(av.titulo, av.texto); else { cerrarProgreso(); Alert.alert(av.titulo, av.texto || undefined); }
        await despues?.(r);
      } catch (e) {
        fallo('No se pudo', mensajeDeDistribucion(e));
      } finally { setOcupado(false); cargar(); }
    } },
  ]);

  const reintentar = () => ante('¿Reenviar a Hacienda?', 'Se firma (si falta) y se manda otra vez.', 'Reenviar',
    () => reintentarDocumento(id), 'DISTRIBUCION_DTE_REINTENTO');
  const reenviarInv = () => ante('¿Enviar la invalidación?', 'Hacienda anula este documento.', 'Enviar',
    () => reenviarInvalidacion(id), 'DISTRIBUCION_INVALIDACION_REENVIO');
  const contingencia = () => Alert.alert('¿Enviar el aviso de contingencia?', 'Le avisa a Hacienda de lo emitido sin poder transmitirlo, y después lo manda.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Enviar', onPress: async () => {
      setOcupado(true); trabajando('Enviando el aviso…');
      try {
        const r = await enviarContingencia();
        anotar('DISTRIBUCION_CONTINGENCIA_AVISO', { avisos: r?.avisos?.length ?? 0, sellados: r?.sellados });
        const av = resumenDeContingencia(r);
        if (av.bien) listo(av.titulo, av.texto); else fallo(av.titulo, av.texto);
      } catch (e) { fallo('No se pudo enviar el aviso', mensajeDeDistribucion(e)); }
      finally { setOcupado(false); cargar(); }
    } },
  ]);
  const corregir = () => {
    if (d.estado === 'rechazado') { router.push(`/torogoz/venta/${d.pedido_id}`); return; }
    if (d.estado === 'sellado') {
      ante('¿Corregir el documento?', queHaceCorregir(d), 'Corregir', () => corregirDocumentoSellado(id), 'DISTRIBUCION_CORRECCION_ABIERTA',
        (r) => { if (r?.pedido_id) router.push(`/torogoz/venta/${r.pedido_id}`); });
      return;
    }
    ante('¿Corregir el documento?', queHaceCorregir(d), 'Corregir', () => descartarDocumento(id), 'DISTRIBUCION_DTE_DESCARTADO',
      (r) => { if (r?.estado === 'descartado') router.push(`/torogoz/venta/${d.pedido_id}`); });
  };
  const deshacer = () => ante('¿Deshacer la venta?', `${nombre}. Se invalida ante Hacienda, el pedido queda anulado y las unidades vuelven al inventario. No se puede volver atrás.`,
    'Invalidar ante Hacienda', () => anularVenta(id, motivo.trim()), 'DISTRIBUCION_VENTA_DESHECHA', () => { setDeshaciendo(false); setMotivo(''); });

  const papeles = () => elegir('Papeles del documento', [
    { texto: 'Compartir el documento (PDF)', accion: () => compartirDocumento(d).catch((e) => fallo('No se pudo armar el PDF', e?.message ?? '')) },
    { texto: 'Imprimir el documento', accion: () => imprimirDocumentoCarta(d).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
    { texto: 'Imprimir el ticket', accion: () => imprimirTicket(ticket).then(() => anotar('DISTRIBUCION_TICKET_IMPRESO', { ok: true })).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
    { texto: 'Compartir el ticket', accion: () => compartirTicket(ticket, `Ticket ${nombre}`).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
    { texto: 'Archivo JSON', accion: () => compartirJson(d).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
    ...(d.estado === 'sellado' ? [{ texto: 'Ver en Hacienda', accion: () => WebBrowser.openBrowserAsync(urlConsultaPublica(d)).catch(() => {}) }] : []),
  ]);

  const est = d ? ESTADO_DOCUMENTO[d.estado] : null;
  const aviso = d?.estado === 'sellado' && !a.invalidando ? avisoDelPlazo(plazo, d.tipo) : null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: d ? (TIPO_DOCUMENTO[d.tipo]?.largo ?? 'Documento') : 'Documento' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 16, paddingBottom: 56 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {d === undefined ? <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 24 }}>Cargando…</Text> : null}
        {d ? (
          <>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={24}>
                <View style={{ padding: 18, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{d.dist_clientes?.nombre ?? '—'}</Text>
                    {est ? <Pildora texto={est.label} color={colorDeVariante(est.variant)} /> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.total_pagar)}</Text>
                  <Text selectable style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }}>{d.numero_control}</Text>
                </View>
              </Vidrio>
            </View>
            {d.ambiente === '00' ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="Documento de PRUEBA: no tiene validez fiscal." /></View> : null}
            <View style={{ marginHorizontal: 16 }}>
              <EstadoHacienda documento={d} ocupado={ocupado} puedeActuar={puedeVender}
                onReenviar={reintentar} onCorregir={corregir} onInvalidacion={reenviarInv} onContingencia={contingencia} />
            </View>

            <Segmentos activa={vista} onCambiar={setVista} opciones={VISTAS} />

            {!a.conArchivo && vista !== 'datos' ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="Este documento no tiene guardado su archivo: sólo se pueden ver sus datos." /></View> : null}
            {a.conArchivo && vista === 'detalle' ? (
              <View style={{ marginHorizontal: 16, gap: 16 }}>
                <DetalleDeVenta dte={d} pagos={pagos} />
                {a.conCorreo ? <CorreoDocumento key={d.correo?.[0]?.enviado_at ?? d.id} dte={d} puedeEnviar={puedeVender} onEnviado={cargar} /> : null}
              </View>
            ) : null}
            {a.conArchivo && vista === 'ticket' ? <VistaPapel html={ticketHtml} ancho={320} /> : null}
            {a.conArchivo && vista === 'hoja' ? <VistaPapel html={hojaHtml} alto={520} /> : null}
            {vista === 'datos' ? (
              <View style={{ marginHorizontal: 16, gap: 16 }}>
                <Seccion titulo="Datos">
                  <Dato primero rotulo="Número de control" valor={d.numero_control} />
                  <Dato rotulo="Código de generación" valor={String(d.codigo_generacion).toUpperCase()} />
                  <Dato rotulo="Sello de recepción" valor={d.sello_recibido ?? '—'} />
                  <Dato rotulo="Emitido" valor={`${fechaTexto(d.fec_emi, { day: 'numeric', month: 'long', year: 'numeric' })}, ${hora12(d.hor_emi)}`} />
                  <Dato rotulo="Total" valor={formatMoney(d.total_pagar)} fuerte />
                  {d.intentos > 0 ? <Dato rotulo="Envíos a Hacienda" valor={String(d.intentos)} /> : null}
                </Seccion>
                {d.pedido_id ? <PagosDelPedido pedidoId={d.pedido_id} puedeEditar={puedeVender} onCambio={cargar} /> : null}
              </View>
            ) : null}

            <View style={{ marginHorizontal: 16, gap: 10 }}>
              {aviso ? <Aviso tono={TONO_PLAZO[aviso.tono]} texto={aviso.texto} /> : null}
              {ACCIONES_DE_DINERO && d.estado === 'sellado' && puedeVender && !a.invalidando && !a.vencido ? <Aviso tono="nota" texto={ayudaDelSellado(d.tipo)} /> : null}
              {a.conArchivo ? <BotonGrande color={PETROLEO} texto="Compartir o imprimir" deshabilitado={!ticket} onPress={papeles} /> : null}
              {puedeVender && d.pedido_id ? <BotonGrande borde color={PETROLEO} texto="Volver a vender" onPress={() => router.push(`/torogoz/venta?desde=${d.pedido_id}`)} /> : null}
              {enElPortal ? <SeHaceEnElPortal texto="Corregirlo, deshacer la venta o hacer una devolución se hace desde el portal." /> : null}
              {a.puedeDevolver && !deshaciendo ? <BotonGrande borde color={PETROLEO} texto="Devolución" deshabilitado={ocupado} onPress={() => router.push(`/torogoz/devolucion/${id}`)} /> : null}
              {a.puedeCorregir && d.estado !== 'rechazado' ? <BotonGrande borde color={PETROLEO} texto="Corregir" deshabilitado={ocupado} onPress={corregir} /> : null}
              {a.puedeDeshacer && !deshaciendo ? <BotonGrande borde color={MARCA.rojo} texto="Deshacer la venta" deshabilitado={ocupado} onPress={() => setDeshaciendo(true)} /> : null}
              {deshaciendo ? (
                <Seccion titulo="¿Por qué se deshace la venta? (lo lee Hacienda)">
                  <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej.: el cliente devolvió toda la mercadería" />
                  <BotonGrande color={MARCA.rojo} texto="Invalidar ante Hacienda" deshabilitado={!motivo.trim() || ocupado} onPress={deshacer} />
                  <BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={() => { setDeshaciendo(false); setMotivo(''); }} />
                </Seccion>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
