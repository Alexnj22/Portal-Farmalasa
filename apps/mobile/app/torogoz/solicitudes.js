// Torogoz · Solicitudes de descuento, NATIVO — `SolicitudesDescuento` del
// portal: el vendedor pide un descuento que no puede dar solo y la venta
// espera como preventa. Por decidir · Resueltas en el control segmentado;
// cada tarjeta trae los renglones con su descuento, el total pedido y el tope.
//
// Decidir lo hace `dist_resolver_descuento` en la base (`resolverDescuento`,
// la MISMA función del portal): aplica o descarta, firma, avisa al vendedor y
// no deja que quien pidió se lo apruebe — acá se esconde el botón en ese caso.
// Rechazar pide el motivo, que lo lee el vendedor. Un aviso abre la pantalla
// con `?solicitud=` y esa tarjeta sale primero y resaltada.
//
// Desde la auditoría H3 llegan también las de invalidar un documento sellado
// (corregirlo o deshacer la venta): las decide `resolverSolicitudDistribucion`,
// la misma del portal, y la tarjeta dice qué pasa con el dinero.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { avisoDeDecision, fetchSolicitudesDescuento, mensajeDeDistribucion, resolverSolicitudDistribucion } from '@nucleo/data/distribucion';
import { ESTADO_SOLICITUD_DESCUENTO } from '@nucleo/utils/distribucionComercial';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Campo } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { PETROLEO, colorDe } from '../../componentes/torogoz/comercial/Piezas';
import { BandaSinSenal } from '../../componentes/torogoz/venta/SinSenal';

function Boton({ texto, color, relleno, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
        backgroundColor: relleno ? color : `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: relleno ? '#fff' : color, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Tarjeta({ f, mia, puedeDecidir, destacada, ocupado, onDecidir }) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const m = f.metadata ?? {};
  const est = ESTADO_SOLICITUD_DESCUENTO[f.status] ?? ESTADO_SOLICITUD_DESCUENTO.PENDING;
  const renglones = Array.isArray(m.renglones) ? m.renglones : [];
  const pendiente = f.status === 'PENDING';
  const invalida = f.type === 'DIST_INVALIDACION';
  const filaDinero = (texto, monto, ultimo = false) => (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: ultimo ? 0 : 0.5, borderBottomColor: colorSistema.separador }}>
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{texto}</Text>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(monto ?? 0)}</Text>
    </View>
  );
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22} tinte={destacada ? `${PETROLEO}40` : undefined}>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>{m.cliente || 'Cliente'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {`${invalida ? `${m.accion === 'corregir' ? 'Corregir' : 'Deshacer'} ${m.numero_control ?? ''}` : `Venta ${m.pedido_id}`} · pidió ${shortEmployeeName(f.solicitante?.name) || '—'} · ${fechaHora12(f.created_at)}`}
              </Text>
            </View>
            <Pildora texto={est.label} color={colorDe(est.variant)} />
          </View>

          {invalida ? (
            <View style={{ borderRadius: 14, borderWidth: 0.5, borderColor: colorSistema.separador, overflow: 'hidden' }}>
              {filaDinero(`${m.tipo_documento === '03' ? 'Crédito Fiscal' : 'Factura'} · total del documento`, m.total)}
              {m.accion === 'corregir'
                ? filaDinero('Abonado (pasa a la cuenta nueva)', m.abonado, true)
                : (<>
                  {filaDinero('Efectivo que se le devuelve (sale de la caja del vendedor)', m.devolver_efectivo)}
                  {filaDinero('Queda a favor del cliente', m.a_favor, true)}
                </>)}
            </View>
          ) : (
          <View style={{ borderRadius: 14, borderWidth: 0.5, borderColor: colorSistema.separador, overflow: 'hidden' }}>
            {renglones.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: colorSistema.separador }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r?.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`${Number(r?.cantidad)} × ${formatMoney(r?.precio)} con IVA`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`−${formatMoney(r?.descuento)}`}</Text>
                  {r?.pct != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${Number(r.pct)}%`}</Text> : null}
                </View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(127,127,127,0.10)' }}>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`Descuento pedido${m.tope_pct != null ? ` · tope ${Number(m.tope_pct)}%` : ''}`}</Text>
              <Text style={{ color: PETROLEO, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(m.total)}</Text>
            </View>
          </View>
          )}

          {f.note ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}><Text style={{ color: colorSistema.texto2 }}>Motivo: </Text>{`«${f.note}»`}</Text> : null}
          {!pendiente ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`${est.label} por ${shortEmployeeName(f.decidio?.name) || '—'} · ${fechaHora12(f.updated_at)}${f.approver_note ? ` — «${f.approver_note}»` : ''}`}
            </Text>
          ) : null}

          {rechazando ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>¿Por qué se rechaza? (lo lee el vendedor)</Text>
              <Campo value={motivo} onChangeText={setMotivo} autoFocus placeholder="Ej.: pasa del margen de este producto" />
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Boton texto="Ver la venta" color={PETROLEO}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(`/torogoz/venta/${m.pedido_id}`); }} />
            {pendiente && puedeDecidir && !mia ? (rechazando ? (
              <>
                <Boton texto="Cancelar" color={MARCA.azulClaro} onPress={() => { setRechazando(false); setMotivo(''); }} />
                <Boton texto="Rechazar" color={MARCA.rojo} relleno deshabilitado={!motivo.trim() || !!ocupado}
                  onPress={() => onDecidir(f, false, motivo, () => { setRechazando(false); setMotivo(''); })} />
              </>
            ) : (
              <>
                <Boton texto="Rechazar" color={MARCA.rojo} deshabilitado={!!ocupado} onPress={() => { setRechazando(true); setMotivo(''); }} />
                <Boton texto="Aprobar" color={MARCA.verde} relleno deshabilitado={!!ocupado} onPress={() => onDecidir(f, true)} />
              </>
            )) : null}
          </View>
          {pendiente && mia && puedeDecidir ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>La pediste tú: la decide otra persona.</Text> : null}
        </View>
      </Vidrio>
    </View>
  );
}

export default function SolicitudesTorogoz() {
  const { hasPermission, user } = useAuth();
  const puedeDecidir = !!hasPermission?.('requests_distribucion', 'can_approve');
  const { solicitud } = useLocalSearchParams();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('pendientes');
  const [ocupado, setOcupado] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setFilas(await fetchSolicitudesDescuento()); setError(''); }
    catch { setError('No se pudieron cargar las solicitudes. Revisa la conexión e intenta de nuevo.'); setFilas((x) => x ?? []); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // El aviso trae `?solicitud=`: se abre en su pestaña.
  useEffect(() => {
    if (!solicitud || !filas) return;
    const fila = filas.find((f) => String(f.id) === String(solicitud));
    if (fila) setFiltro(fila.status === 'PENDING' ? 'pendientes' : 'resueltas');
  }, [solicitud, filas]);

  const pendientes = useMemo(() => (filas ?? []).filter((f) => f.status === 'PENDING').length, [filas]);
  const visibles = useMemo(() => {
    const v = (filas ?? []).filter((f) => (filtro === 'pendientes' ? f.status === 'PENDING' : f.status !== 'PENDING'));
    // La del aviso, primero.
    return solicitud ? [...v].sort((a, b) => (String(b.id) === String(solicitud)) - (String(a.id) === String(solicitud))) : v;
  }, [filas, filtro, solicitud]);

  const decidir = (f, aprobar, motivo = '', alTerminar) => {
    const m = f.metadata ?? {};
    const invalida = f.type === 'DIST_INVALIDACION';
    const queHace = invalida
      ? (aprobar
        ? (m.accion === 'corregir'
          ? 'Se abre una venta nueva con lo mismo; al facturarla, este documento se invalida ante Hacienda con tu nombre.'
          : 'Se invalida ante Hacienda con tu nombre y el pedido queda anulado. El efectivo sale de la caja del vendedor; lo demás queda a favor del cliente.')
        : 'El documento queda como estaba y se le avisa al vendedor.')
      : (aprobar ? 'La venta se podrá facturar con el descuento y se le avisa al vendedor.' : 'La venta queda sin el descuento y se le avisa al vendedor.');
    Alert.alert(aprobar ? (invalida ? 'Aprobar la solicitud' : 'Aprobar el descuento') : (invalida ? 'Rechazar la solicitud' : 'Rechazar el descuento'),
      `${m.cliente || 'Cliente'} · ${formatMoney(m.total)}\n\n${queHace}`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: aprobar ? 'Aprobar' : 'Rechazar', style: aprobar ? 'default' : 'destructive', onPress: async () => {
          setOcupado(f.id);
          trabajando(aprobar ? 'Aprobando…' : 'Rechazando…');
          try {
            const r = await resolverSolicitudDistribucion(f.id, f.type, aprobar, aprobar ? null : motivo);
            const av = avisoDeDecision(f.type, m.accion, aprobar, r);
            if (av.tono === 'warning') fallo(av.titulo, av.texto); else listo(av.titulo, av.texto);
            alTerminar?.();
            await cargar();
          } catch (e) {
            fallo(aprobar ? 'No se aprobó' : 'No se rechazó', mensajeDeDistribucion(e));
          } finally { setOcupado(null); }
        } },
      ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Solicitudes', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {/* «N ventas sin señal» en todo el marco de Torogoz, como `TorogozLayout` del portal. */}
        <BandaSinSenal style={{ marginHorizontal: 16 }} />
        <Segmentos activa={filtro} onCambiar={setFiltro}
          opciones={[{ id: 'pendientes', label: pendientes ? `Por decidir · ${pendientes}` : 'Por decidir' }, { id: 'resueltas', label: 'Resueltas' }]} />
        {!puedeDecidir ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Ves las que pediste. Las decide quien tiene permiso para aprobar solicitudes de Distribución.</Text>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas === null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {visibles.map((f) => (
          <Tarjeta key={f.id} f={f} mia={!!user?.id && f.employee_id === user.id} puedeDecidir={puedeDecidir}
            destacada={!!solicitud && String(f.id) === String(solicitud)} ocupado={ocupado} onDecidir={decidir} />
        ))}
        {filas !== null && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 32, fontSize: 15, marginHorizontal: 24 }}>
            {filtro === 'pendientes' ? 'No hay solicitudes esperando decisión.' : 'Todavía no hay solicitudes resueltas.'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}
