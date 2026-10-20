// Cómo pagó el cliente un ingreso — la gemela nativa de
// `src/components/caja/FormaDePago.jsx` (2026-10-19).
//
// Hasta hoy todo ingreso anotado desde el teléfono entraba como EFECTIVO: una
// inyección cobrada con tarjeta sumaba al esperado del cajón y el corte la
// mostraba como faltante. La regla de qué falta es la MISMA del portal
// (`estadoDeFormaDePago`, en el núcleo); acá sólo se dibuja.
//
// Controlado: el padre guarda el valor (`FORMA_DE_PAGO_INICIAL`) y sube la
// foto al anotar con `fotoDelPago`. `foto` es el archivo elegido.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { leerBoleta } from '@nucleo/data/bolsas';
import { lecturaDeBoleta } from '@nucleo/utils/ingresoDeCaja';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO, nombreDelComprobante } from '@nucleo/utils/formaDePago';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Fotos from './Fotos';
import { Aviso, Campo, Seccion } from './Piezas';

function Enlace({ texto, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.acento, fontSize: 15, textDecorationLine: 'underline' }}>{texto}</Text>
    </Pressable>
  );
}

/**
 * `onMontoLeido(total)`: el total que leyó la foto, para que el padre llene el
 * cobro si está vacío. `montoFijo`: el cobro lo pone el servidor (la inyección).
 */
export default function FormaDePago({ valor, onCambiar, monto, onMontoLeido, montoFijo = false }) {
  const v = valor ?? FORMA_DE_PAGO_INICIAL;
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const estado = estadoDeFormaDePago(v, monto);
  const papel = nombreDelComprobante(v.forma);
  const poner = (cambios) => onCambiar({ ...v, ...cambios });

  const elegirForma = (forma) => {
    Haptics.selectionAsync().catch(() => {});
    setAviso(null);
    // Volver a efectivo limpia el papel, igual que en el portal.
    onCambiar(forma === 'EFECTIVO' ? { ...FORMA_DE_PAGO_INICIAL } : { ...FORMA_DE_PAGO_INICIAL, forma });
  };

  const alCambiarFotos = async (lista) => {
    const f = lista[0] ?? null;
    setAviso(null);
    if (!f) { poner({ foto: null, lectura: null }); return; }
    poner({ foto: f, lectura: null, sinComprobante: false });
    setLeyendo(true);
    const r = await leerBoleta(f, { entidad: null, numeroBoleta: null, monto: null }).catch(() => null);
    setLeyendo(false);
    const l = r ? lecturaDeBoleta(r, { pideBoleta: true }) : { error: true };
    if (l.error) {
      setAviso('No se pudo leer la foto. Escribe el total y el número a mano.');
      onCambiar({ ...v, foto: f, sinComprobante: false });
      return;
    }
    onCambiar({ ...v, foto: f, sinComprobante: false, lectura: l.lectura,
      comprobanteTotal: l.monto ?? v.comprobanteTotal, numero: l.boleta ?? v.numero });
    if (l.monto != null) onMontoLeido?.(l.monto);
    setAviso(l.monto != null
      ? `La foto leyó ${formatMoney(Number(l.monto))}${l.boleta ? `, número ${l.boleta}` : ''}. Compáralo con el papel.`
      : 'La foto no leyó el total: escríbelo.');
  };

  return (
    <Seccion titulo="Cómo pagó"
      pie={estado.noEfectivo ? `No entra al cajón: ${v.forma === 'TARJETA' ? 'el dinero llega por el POS' : 'el dinero llega al banco'}.` : null}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {FORMAS_DE_PAGO.map((f) => {
          const activa = v.forma === f.value;
          return (
            <Pressable key={f.value} onPress={() => elegirForma(f.value)} accessibilityRole="button" accessibilityState={{ selected: activa }}
              style={({ pressed }) => ({ flex: 1, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
                borderWidth: 1.2, borderColor: MARCA.azulClaro, backgroundColor: activa ? MARCA.azulClaro : 'transparent',
                opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <Text style={{ color: activa ? '#fff' : MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {estado.noEfectivo && !v.sinComprobante ? (
        <>
          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`Foto del ${papel}`}</Text>
          <Fotos fotos={v.foto ? [v.foto] : []} onCambiar={alCambiarFotos} max={1} />
          {leyendo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Leyendo la foto…</Text> : null}
          {aviso ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{aviso}</Text> : null}
        </>
      ) : null}

      {estado.noEfectivo && v.foto ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Campo multiline={false} value={String(v.comprobanteTotal ?? '')} keyboardType="decimal-pad"
              onChangeText={(t) => poner({ comprobanteTotal: t.replace(/[^\d.,]/g, '').replace(',', '.') })}
              placeholder={`Total del ${papel}`} />
          </View>
          <View style={{ flex: 1 }}>
            <Campo multiline={false} value={v.numero} maxLength={40} autoCapitalize="characters"
              onChangeText={(t) => poner({ numero: t })} placeholder={v.forma === 'TARJETA' ? 'Número del voucher' : 'Referencia'} />
          </View>
        </View>
      ) : null}

      {/* Lo que el voucher cubre además de este cobro: tiene que ser una venta
          con tarjeta de hoy. No frena — la cuadra `caja_vouchers_del_dia`. */}
      {estado.noEfectivo && v.foto && estado.resto > 0 ? (
        <Aviso tono="nota" texto={`El ${papel} es por más que este cobro: los ${formatMoney(estado.resto)} que sobran tienen que ser una venta con tarjeta de hoy. Si no aparece, queda marcado para revisar.${montoFijo ? ' El cobro de este ingreso no cambia.' : ''}`} />
      ) : null}

      {estado.noEfectivo && !v.foto && !v.sinComprobante ? (
        <Enlace texto={`No tengo el ${papel}`} onPress={() => poner({ sinComprobante: true })} />
      ) : null}

      {estado.noEfectivo && v.sinComprobante ? (
        <>
          <Aviso tono="cuidado" texto={`Sin el ${papel}, el ingreso se anota pero queda pendiente de autorización. Lo revisa Supervisión o Talento Humano.`} />
          <Campo value={v.motivo} onChangeText={(t) => poner({ motivo: t })}
            placeholder={`Por qué no hay ${papel} — p. ej. el cliente no mandó la captura`} />
          <Enlace texto={`Sí tengo el ${papel}: subir la foto`} onPress={() => poner({ sinComprobante: false, motivo: '' })} />
        </>
      ) : null}
    </Seccion>
  );
}
