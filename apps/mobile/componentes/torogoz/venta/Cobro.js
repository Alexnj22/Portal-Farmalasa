// El COBRO de la venta (el F2 del portal), como hoja: las formas de pago —una
// o varias, y parte a crédito si el cliente lo tiene—, el efectivo que entrega
// con su cambio, las observaciones y el desglose fiscal. Con un descuento por
// aprobar no se cobra: se pide el motivo y se manda a aprobación.
//
// La ÚLTIMA forma es siempre «lo que falta»: no se escribe, se calcula (las
// cuentas son las de `distribucionPagos`, las mismas del portal).
//
// ⚠️ Facturar mueve dinero y transmite a Hacienda, y no se deshace: el botón
// pide confirmación con el total y la forma de pago antes de escribir.
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { FORMA_PAGO, TIPO_DOCUMENTO, leerMonto } from '@nucleo/utils/distribucionComun';
import { filaNueva, montosDePagos } from '@nucleo/utils/distribucionPagos';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Desglose, Eleccion, PETROLEO } from './Piezas';
import { Hoja } from './Hojas';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

const LLEVA_REFERENCIA = new Set(['02', '03', '04', '05']);

function FilaDePago({ f, i, ultima, monto, opciones, onCambiar, onQuitar, varias }) {
  return (
    <View style={{ gap: 8, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
      <Eleccion rotulo={varias ? `Forma ${i + 1}` : 'Forma de pago'} valor={f.forma} opciones={opciones} onCambiar={(v) => onCambiar({ forma: v })} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{ultima ? (varias ? 'Lo que falta' : 'Monto') : 'Monto'}</Text>
        {ultima ? (
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(monto)}</Text>
        ) : (
          <Campo multiline={false} keyboardType="decimal-pad" value={f.monto} placeholder="0.00" selectTextOnFocus
            onChangeText={(t) => onCambiar({ monto: t })} onEndEditing={() => { const m = leerMonto(f.monto); if (m != null) onCambiar({ monto: m.toFixed(2) }); }}
            style={{ width: 110, textAlign: 'right' }} />
        )}
      </View>
      {f.forma === '01' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Entrega</Text>
          <Campo multiline={false} keyboardType="decimal-pad" value={f.recibido} placeholder={formatMoney(monto)} selectTextOnFocus
            onChangeText={(t) => onCambiar({ recibido: t })} style={{ width: 110, textAlign: 'right' }} />
        </View>
      ) : null}
      {LLEVA_REFERENCIA.has(f.forma) ? (
        <Campo multiline={false} value={f.referencia} onChangeText={(t) => onCambiar({ referencia: t })}
          placeholder={f.forma === '04' ? 'Número de cheque' : 'Referencia o autorización'} autoCorrect={false} />
      ) : null}
      {f.existente?.comprobante_url ? <Aviso texto="Tiene comprobante adjunto." /> : null}
      {varias ? (
        <Pressable onPress={onQuitar} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.rojo, fontSize: 15 }}>Quitar esta forma</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Cobro({ venta: s, imprimir, setImprimir, onCerrar, onProcesar }) {
  const {
    cliente, pagos, setPagos, plazo, setPlazo, notas, setNotas, venta, conIva, porAprobar, montoPorAprobar, cambio,
    excedeCredito, credito, disponibleCredito, bloqueo, guardando, error, motivoDescuento, setMotivoDescuento,
    puedeDescontar, emisor, tipoDoc, tieneCredito, miCaja,
  } = s;
  const aprobacion = porAprobar.length > 0;
  const opciones = [...FORMA_PAGO, ...(tieneCredito ? [{ value: '13', label: `A crédito · ${cliente.plazo_dias} días` }] : [])];
  const montos = montosDePagos(pagos, venta.total);
  const set = (clave, cambios) => setPagos(fs => fs.map(f => (f.clave === clave ? { ...f, ...cambios } : f)));
  const quitar = (clave) => setPagos(fs => (fs.length === 1 ? [filaNueva()] : fs.filter(f => f.clave !== clave)));
  // La nueva entra ARRIBA de la última: la última sigue siendo «lo que falta».
  const agregar = () => setPagos(fs => [...fs.slice(0, -1), filaNueva(fs.some(f => f.forma === '01') ? '05' : '01'), fs[fs.length - 1]]);
  const conCredito = pagos.some(f => f.forma === '13');

  const procesar = () => {
    if (guardando) return;
    if (aprobacion) {
      Alert.alert('Enviar a aprobación', `Se guarda como preventa, sin el descuento de ${formatMoney(montoPorAprobar)}, y se actualiza sola al aprobarse.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: () => onProcesar('aprobacion') },
      ]);
      return;
    }
    if (!ACCIONES_DE_DINERO) return;
    if (bloqueo) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
    const formas = pagos.map((f, i) => `${opciones.find(o => o.value === f.forma)?.label ?? f.forma} ${formatMoney(montos[i])}`).join(' · ');
    Alert.alert(`Facturar ${formatMoney(venta.total)}`,
      `${TIPO_DOCUMENTO[tipoDoc]?.largo ?? 'Documento'} a ${cliente.nombre}.\n${formas}${cambio > 0 ? `\nCambio: ${formatMoney(cambio)}` : ''}\n\nSe transmite a Hacienda y no se deshace.`, [
        { text: 'Revisar', style: 'cancel' },
        { text: 'Facturar', style: 'destructive', onPress: () => onProcesar('facturar') },
      ]);
  };

  return (
    <Hoja titulo={`${aprobacion ? 'Enviar a aprobación' : 'Cobrar'} · ${formatMoney(venta.total)}`} subtitulo={cliente?.nombre}
      onCerrar={onCerrar} bloqueada={!!guardando} cerrarTexto="Volver">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {aprobacion ? (
          <Seccion titulo="Descuento por aprobar">
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
              {`${formatMoney(montoPorAprobar)} de descuento necesita${porAprobar.length === 1 ? '' : 'n'} aprobación${puedeDescontar ? ` (pasa del tope de ${Number(emisor?.descuento_max_pct ?? 0)}%)` : ''}. Se guarda como preventa, sin el descuento, y se actualiza sola al aprobarse.`}
            </Text>
            <Campo value={motivoDescuento} onChangeText={setMotivoDescuento} placeholder="¿Por qué el descuento? (lo ve quien aprueba)" style={{ minHeight: 64 }} />
          </Seccion>
        ) : (
          <Seccion titulo="Formas de pago" pie={pagos.length > 1 ? 'La última se calcula sola: es lo que falta.' : undefined}>
            {pagos.map((f, i) => (
              <FilaDePago key={f.clave} f={f} i={i} ultima={i === pagos.length - 1} monto={montos[i]} opciones={opciones}
                varias={pagos.length > 1} onCambiar={(c) => set(f.clave, c)} onQuitar={() => quitar(f.clave)} />
            ))}
            <Pressable onPress={agregar} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
              <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '600' }}>＋ Dividir el pago</Text>
            </Pressable>
            {conCredito ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{`Plazo (hasta ${cliente.plazo_dias} días)`}</Text>
                <Campo multiline={false} keyboardType="number-pad" value={plazo} onChangeText={setPlazo} style={{ width: 80, textAlign: 'right' }} />
              </View>
            ) : null}
          </Seccion>
        )}
        {excedeCredito ? (
          <Aviso tono="freno" texto={`Ya debe ${formatMoney(credito?.saldo ?? 0)} de un límite de ${formatMoney(cliente.limite_credito)}: a crédito puede llevar hasta ${formatMoney(disponibleCredito)}.`} />
        ) : null}
        {miCaja === null && pagos.some(p => p.forma === '01') ? (
          <Aviso tono="cuidado" texto="No tienes caja abierta hoy: pide a quien administra que te la abra con el fondo de cambio." />
        ) : null}
        <Seccion titulo="Observaciones">
          <Campo value={notas} onChangeText={setNotas} placeholder="Sale impresa en el documento." style={{ minHeight: 56 }} />
        </Seccion>
        <Seccion titulo={TIPO_DOCUMENTO[tipoDoc]?.largo ?? 'Resumen'}>
          <Desglose venta={venta} conIva={conIva} porAprobar={montoPorAprobar} />
          {cambio > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: `${MARCA.verde}22` }}>
              <Text style={{ color: MARCA.verde, fontSize: 16, fontWeight: '700' }}>Cambio</Text>
              <Text style={{ color: MARCA.verde, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(cambio)}</Text>
            </View>
          ) : null}
          {!aprobacion && ACCIONES_DE_DINERO ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Imprimir el ticket al facturar</Text>
              <Switch value={imprimir} onValueChange={setImprimir} />
            </View>
          ) : null}
        </Seccion>
        {!aprobacion && bloqueo ? <Aviso tono="freno" texto={bloqueo} /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {/* Sólo consulta (soloConsulta.js): facturar se hace en el portal; acá queda la preventa. */}
        {!aprobacion && !ACCIONES_DE_DINERO ? (
          <SeHaceEnElPortal texto="Facturar se hace desde el portal. Guarda la venta como preventa para facturarla allá." />
        ) : (
          <BotonGrande color={aprobacion ? MARCA.ambar : PETROLEO} deshabilitado={!!guardando || (!aprobacion && !!bloqueo)} onPress={procesar}
            texto={guardando ? (guardando === 'facturar' ? 'Facturando…' : 'Guardando…') : aprobacion ? 'Enviar a aprobación' : `Facturar ${formatMoney(venta.total)}`} />
        )}
      </ScrollView>
    </Hoja>
  );
}
