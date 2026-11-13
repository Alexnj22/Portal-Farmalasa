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
import { Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { Host, Icon } from '@expo/ui';
import { fetchPuntosDelCambioDeCliente } from '@nucleo/data/puntos';
import { avisoDeCambioDeCliente } from '@nucleo/utils/puntosTexto';
import { useStaffStore } from '@nucleo/store/staffStore';
import { Dato } from '../formulario/Piezas';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';
import { ICONO } from './iconos';
import IconoFijo from '../IconoFijo';
import { MAYUSCULAS } from '../../tema/mayusculas';

const TONO = { get info() { return MARCA.azulClaro; }, warning: MARCA.ambar, success: MARCA.verde };

function Bloque({ rotulo, children, color }) {
  return (
    <Vidrio radio={20} tinte={color ? `${color}1A` : undefined}>
      <View style={{ padding: 14, gap: 4 }}>
        <Text style={{ color: color ?? colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: MAYUSCULAS }}>{rotulo}</Text>
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
        <IconoFijo name={ICONO.puntos} size={18} color={color} />
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, lineHeight: 20 }}>{aviso.texto}</Text>
      </View>
    </Vidrio>
  );
}

/** Lo que la sala dijo de un movimiento sin comprobante (`DetalleSolicitud` del portal).
 *  Rediseño del 2026-11-11 (usuario: «que los datos sean completos y toda la
 *  información muy bien organizada»): el monto grande arriba y después cada
 *  dato en su renglón — de qué, para qué, sala, cómo, cuándo, comprobante. */
function MovimientoSinComprobante({ meta }) {
  const sucursales = useStaffStore((s) => s.branches);
  const forma = meta.forma_pago === 'TRANSFERENCIA' ? 'Transferencia' : meta.forma_pago === 'TARJETA' ? 'Tarjeta' : 'Efectivo';
  const sale = meta.sentido === 'SALIDA';
  const color = sale ? MARCA.rojo : MARCA.verde;
  // «Gasto o compra urgente · ENCARGO DE …»: el tipo y lo que escribió la sala.
  const texto = String(meta.detalle || meta.concepto || '');
  const corte = texto.indexOf(' · ');
  const tipo = corte > 0 ? texto.slice(0, corte) : null;
  const para = corte > 0 ? texto.slice(corte + 3) : texto;
  const sala = (sucursales ?? []).find((b) => String(b.id) === String(meta.branch_id))?.name ?? null;
  const foto = meta.foto_url || meta.foto_nueva || null;
  const datos = [
    tipo ? ['Tipo', tipo] : null,
    para ? ['Detalle', para] : null,
    sala ? ['Sala', sala] : null,
    ['Forma de pago', forma],
    meta.fecha ? ['Fecha', fechaTexto(meta.fecha)] : null,
    ['Comprobante', meta.numero_boleta || 'No tiene'],
    meta.operacion_bolsa ? ['De dónde', 'De una bolsa'] : null,
  ].filter(Boolean);
  return (
    <>
      <Vidrio radio={20} tinte={`${color}14`}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text style={{ color, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: MAYUSCULAS }}>
              {sale ? 'Salió de la caja' : 'Dice que entró'}
            </Text>
            <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {`${sale ? '−' : '+'}${formatMoney(meta.monto)}`}
            </Text>
          </View>
          <View style={{ gap: 0 }}>
            {datos.map(([r, v], i) => <Dato key={r} rotulo={r} valor={v} primero={i === 0} />)}
          </View>
          {foto ? (
            <Pressable onPress={() => Promise.resolve(openStoredFile(foto)).catch(() => {})} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Ver la foto</Text>
            </Pressable>
          ) : null}
        </View>
      </Vidrio>
      {meta.reenvio && meta.rechazo_anterior ? (
        <Bloque rotulo="Se reenvía. Antes no se autorizó porque" color={MARCA.ambar}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{meta.rechazo_anterior}</Text>
        </Bloque>
      ) : null}
    </>
  );
}

/** Lo que significa decidir sobre un movimiento sin comprobante: va justo antes de los botones. */
export function QueSignificaDecidir({ req }) {
  if (req?.type !== 'CAJA_INGRESO_AUTORIZACION' || req.status !== 'PENDING') return null;
  const sale = req.metadata?.sentido === 'SALIDA';
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18, marginHorizontal: 4 }}>
      {sale
        ? 'El dinero ya salió. Autorizarlo dice que la salida está bien; rechazarlo la anula y el dinero vuelve a contar donde estaba.'
        : 'No entra al cajón. Autorizarlo dice que el dinero sí llegó; si no, explica qué prueba hace falta y la sala lo puede volver a mandar.'}
    </Text>
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
        <Bloque rotulo={t === 'CAJA_INGRESO_AUTORIZACION' ? 'Por qué no hay comprobante' : 'Motivo de quien la envió'}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }}>{req.note}</Text>
        </Bloque>
      ) : null}
    </>
  );
}
