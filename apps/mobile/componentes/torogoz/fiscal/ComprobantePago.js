// Adjuntar el comprobante de un pago y decidir qué pasa si no cuadra — el
// `ComprobantePago` del portal. La foto se LEE (el mismo lector del portal) y
// el veredicto sale del núcleo (`revisionDelComprobante`):
//   · coincide → «Adjuntar»;
//   · no coincide → usar el del comprobante (si el pago se puede cambiar) o
//     dejar el del pago diciendo POR QUÉ;
//   · no se pudo leer → se escribe el monto del papel y se compara igual. Un
//     comprobante que nadie leyó no queda marcado como verificado.
// Devuelve con `onListo({ foto, lectura, montoLeido, verificacion, nota, montoNuevo })`.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { leerComprobanteBase64 } from '@nucleo/data/distribucion';
import { leerMonto } from '@nucleo/utils/distribucionComun';
import { revisionDelComprobante, TEXTO_FORMA_COMPROBANTE } from '@nucleo/utils/distribucionFacturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { aBase64Reducido } from '@plataforma/fotoParaLeer';
import { Aviso, BotonGrande, Campo } from '../../formulario/Piezas';
import Fotos from '../../formulario/Fotos';
import { colorSistema } from '../../Formulario';

const PETROLEO = '#0f6e7d';

export default function ComprobantePago({ forma, montoEsperado, puedeCambiarMonto = false, onListo, onCancelar }) {
  const [fotos, setFotos] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [montoPapel, setMontoPapel] = useState('');
  const [nota, setNota] = useState('');

  const leer = async (nuevas) => {
    setFotos(nuevas); setResultado(null); setNota(''); setMontoPapel('');
    const f = nuevas[0];
    if (!f) return;
    setLeyendo(true);
    try {
      setResultado(await leerComprobanteBase64(await aBase64Reducido(f), 'image/jpeg', montoEsperado, forma));
    } catch (e) {
      // Leer es ayuda: si falla, se sigue a mano con el monto escrito.
      setResultado({ sinLector: true, leido: null, coincide: null, error: e?.message });
    } finally { setLeyendo(false); }
  };

  const rev = revisionDelComprobante(resultado, { montoEsperado, montoPapel: leerMonto(montoPapel) });
  const terminar = ({ verificacion, notaFinal, montoNuevo = null }) => onListo?.({
    foto: fotos[0], lectura: rev.leido, montoLeido: rev.montoLeido, verificacion, nota: notaFinal ?? null, montoNuevo,
  });

  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.12)' }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`Comprobante ${TEXTO_FORMA_COMPROBANTE[forma] ?? 'del pago'}`}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Foto del voucher, captura de la transferencia o del cheque. El monto se lee solo.</Text>
      <Fotos fotos={fotos} onCambiar={leer} max={1} />
      {leyendo ? <Aviso tono="nota" texto="Leyendo el monto…" /> : null}
      {rev.noEsComprobante ? <Aviso tono="cuidado" texto={`${rev.motivoNoEs} Toma otra foto.`} /> : null}
      {fotos.length && rev.pideMontoAMano ? (
        <View style={{ gap: 6 }}>
          <Aviso tono="nota" texto={`${rev.motivoSinLectura} Escribe el monto que dice el papel.`} />
          <Campo multiline={false} value={montoPapel} onChangeText={setMontoPapel} keyboardType="decimal-pad" placeholder="Monto del comprobante" />
        </View>
      ) : null}
      {fotos.length && rev.estado === 'sin_comparar' ? (
        <View style={{ gap: 8 }}>
          <Aviso tono="nota" texto={`El comprobante dice ${formatMoney(rev.montoLeido)}. Esta forma de pago es «el resto»: se compara al facturar.`} />
          <BotonGrande color={PETROLEO} texto="Adjuntar" onPress={() => terminar({ verificacion: rev.verificacion, notaFinal: rev.notaSinLectura })} />
        </View>
      ) : null}
      {fotos.length && rev.estado === 'coincide' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colorSistema.verde, fontSize: 15, fontWeight: '700' }}>{`El comprobante dice ${formatMoney(rev.montoLeido)}: coincide con el pago.`}</Text>
          <BotonGrande color={PETROLEO} texto="Adjuntar" onPress={() => terminar({ verificacion: rev.verificacion, notaFinal: rev.notaSinLectura })} />
        </View>
      ) : null}
      {fotos.length && rev.estado === 'diferencia' ? (
        <View style={{ gap: 8 }}>
          <Aviso tono="cuidado" texto={`El comprobante dice ${formatMoney(rev.montoLeido)} y el pago es ${formatMoney(rev.esperado)}. ¿Cuál es el correcto?`} />
          {puedeCambiarMonto ? (
            <BotonGrande borde color={PETROLEO} texto={`Usar ${formatMoney(rev.montoLeido)} (el del comprobante)`}
              onPress={() => terminar({ verificacion: rev.verificacion, notaFinal: rev.notaSinLectura, montoNuevo: rev.montoLeido })} />
          ) : null}
          <Campo value={nota} onChangeText={setNota} placeholder={`Dejar ${formatMoney(rev.esperado)}: ¿por qué no coincide?`} />
          <BotonGrande color={PETROLEO} texto={`Dejar ${formatMoney(rev.esperado)} y adjuntar`} deshabilitado={!nota.trim()}
            onPress={() => terminar({ verificacion: 'diferencia_aceptada', notaFinal: nota })} />
        </View>
      ) : null}
      {onCancelar ? <BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={onCancelar} /> : null}
    </View>
  );
}
