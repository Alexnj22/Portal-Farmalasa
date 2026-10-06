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
//   · el motivo de quien la envió.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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
      {req?.note ? (
        <Bloque rotulo="Motivo de quien la envió">
          <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{req.note}</Text>
        </Bloque>
      ) : null}
    </>
  );
}
