// Lo que el detalle del portal muestra y el de la campana no — el resto de
// `DetalleSolicitud` cuando NO va dentro de un aviso (`enCampana` falso).
//
// El cuerpo de la solicitud en la app es `DetalleDeAviso`, que es la versión de
// la campana: ahí la tarjeta de arriba ya dice el motivo y la venta, así que se
// omiten. En la pantalla de la solicitud no hay tarjeta arriba, y sin esto se
// perdían cuatro cosas que el portal sí pinta:
//   · el motivo de una anulación;
//   · la forma de pago actual y la nueva, en un cambio de pago;
//   · qué pasa con los PUNTOS en un cambio de cliente (antes de aprobar se le
//     pregunta a la base con la misma función que hace el traspaso, en modo
//     consulta; después, lo que quedó en `erp_aplicado.puntos`);
//   · el motivo de quien la envió;
//   · un movimiento sin comprobante (`CAJA_INGRESO_AUTORIZACION`, del cajón o
//     de una bolsa): si entra o sale, de qué, cuánto, con qué, por qué se
//     rechazó la vez anterior y la foto si la hay — lo único que tiene quien
//     decide sobre dinero que no está en ningún cajón.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { Host, Icon } from '@expo/ui';
import { fetchPuntosDelCambioDeCliente } from '@nucleo/data/puntos';
import { avisoDeCambioDeCliente } from '@nucleo/utils/puntosTexto';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';
import { ICONO } from './iconos';

const TONO = { info: MARCA.azulClaro, warning: MARCA.ambar, success: MARCA.verde };

function Bloque({ rotulo, children, color }) {
  return (
    <Vidrio radio={20} tinte={color ? `${color}1A` : undefined}>
      <View style={{ padding: 14, gap: 4 }}>
        <Text style={{ color: color ?? colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{rotulo}</Text>
        {children}
      </View>
    </Vidrio>
  );
}

const Valor = ({ children }) => <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>{children}</Text>;

function PuntosDelCambio({ invoiceId, customerNuevo, aplicado }) {
  const [vista, setVista] = useState(null);
  useEffect(() => {
    if (aplicado || !invoiceId || !customerNuevo) return undefined;
    let vivo = true;
    // Si la consulta falla no se muestra nada: un recuadro de puntos que no se
    // pudo calcular no puede frenar ni confundir una solicitud de facturación.
    fetchPuntosDelCambioDeCliente(invoiceId, customerNuevo)
      .then((v) => { if (vivo) setVista(v); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [invoiceId, customerNuevo, aplicado]);
  const aviso = avisoDeCambioDeCliente({ vista, aplicado });
  if (!aviso) return null;
  const color = TONO[aviso.tono] ?? MARCA.azulClaro;
  return (
    <Vidrio radio={20} tinte={`${color}1A`}>
      <View style={{ padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Host matchContents><Icon name={ICONO.puntos} size={18} color={color} /></Host>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, lineHeight: 20 }}>{aviso.texto}</Text>
      </View>
    </Vidrio>
  );
}

/** Lo que la sala dijo de un movimiento sin comprobante (`DetalleSolicitud` del portal). */
function MovimientoSinComprobante({ meta }) {
  const forma = meta.forma_pago === 'TRANSFERENCIA' ? 'Por transferencia' : meta.forma_pago === 'TARJETA' ? 'Con tarjeta' : 'En efectivo';
  const sale = meta.sentido === 'SALIDA';
  const linea = [forma, meta.fecha ? fechaTexto(meta.fecha) : null, meta.numero_boleta ? `comprobante ${meta.numero_boleta}` : null,
    meta.operacion_bolsa ? 'de una bolsa' : null].filter(Boolean).join(' · ');
  const foto = meta.foto_url || meta.foto_nueva || null;
  return (
    <>
      <Bloque rotulo={sale ? 'Salida sin comprobante' : 'Ingreso sin comprobante'} color={MARCA.ambar}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{meta.detalle || meta.concepto || 'Sin concepto'}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(meta.monto)}</Text>
        </View>
        {linea ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{linea}</Text> : null}
        {foto ? (
          <Pressable onPress={() => Promise.resolve(openStoredFile(foto)).catch(() => {})} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Ver la foto</Text>
          </Pressable>
        ) : null}
      </Bloque>
      {meta.reenvio && meta.rechazo_anterior ? (
        <Bloque rotulo="Se reenvía. Antes no se autorizó porque">
          <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{meta.rechazo_anterior}</Text>
        </Bloque>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18, marginHorizontal: 4 }}>
        {sale
          ? 'El dinero ya salió. Autorizarlo dice que la salida está bien; rechazarlo la anula y el dinero vuelve a contar donde estaba.'
          : 'No entra al cajón. Autorizarlo dice que el dinero sí llegó; si no, explica qué prueba hace falta y la sala lo puede volver a mandar.'}
      </Text>
    </>
  );
}

export default function ExtrasDelDetalle({ req }) {
  const meta = (typeof req?.metadata === 'object' && req.metadata) ? req.metadata : {};
  const t = req?.type;
  return (
    <>
      {t === 'ANNULMENT_REQUEST' && meta.reason ? (
        <Bloque rotulo="Motivo de anulación"><Valor>{meta.reason}</Valor></Bloque>
      ) : null}
      {t === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Bloque rotulo="Pago actual"><Valor>{meta.current_pago || '—'}</Valor></Bloque></View>
          <View style={{ flex: 1 }}><Bloque rotulo="Cambiar a" color={MARCA.azulClaro}><Valor>{meta.new_pago || '—'}</Valor></Bloque></View>
        </View>
      ) : null}
      {t === 'CLIENT_CHANGE_REQUEST' && meta.correlativo ? (
        <PuntosDelCambio invoiceId={meta.invoice_id} customerNuevo={meta.new_client_id} aplicado={meta.erp_aplicado?.puntos} />
      ) : null}
      {t === 'CAJA_INGRESO_AUTORIZACION' ? <MovimientoSinComprobante meta={meta} /> : null}
      {req?.note ? (
        <Bloque rotulo="Motivo de quien la envió">
          <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{req.note}</Text>
        </Bloque>
      ) : null}
    </>
  );
}
