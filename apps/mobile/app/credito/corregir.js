// Pedir la corrección de un abono, NATIVO — el `PedirCorreccion` del portal.
// Anularlo, corregir el monto o la forma de pago; con su motivo. No escribe en
// la caja: crea la solicitud (`pedirCorreccionDeAbono`) y la decide quien
// tenga el permiso de cuentas por cobrar.
//
// Se dice ANTES de elegir: corregir un abono se aplica BORRÁNDOLO y volviéndolo
// a hacer —lo único que la caja permite—, así que allá quedan los dos renglones.
// Si cambia la forma a una que no es efectivo, va el comprobante y se lee con el
// mismo lector del cobro (`leerPagoDeCredito`); si no lo da por bueno, no se pide.
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { leerPagoDeCredito, pedirCorreccionDeAbono } from '@nucleo/data/creditos';
import { FORMAS_DE_COBRO, MOTIVO_DEL_FRENO } from '@nucleo/utils/abonoDeCredito';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaCorta } from '@nucleo/utils/ticketCampos';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fotos from '../../componentes/formulario/Fotos';
import { leer } from '../../componentes/comercial/elegido';
import { fallo, listo } from '../../componentes/Progreso';

const QUE = [
  { id: 'ANULAR', label: 'Anularlo', detalle: 'No debió cobrarse' },
  { id: 'MONTO', label: 'Corregir el monto' },
  { id: 'FORMA', label: 'Corregir la forma de pago' },
];
// «Solicitar aprobación» no es una forma real de pago: no se ofrece acá.
const FORMAS = FORMAS_DE_COBRO.filter((f) => !/aprobaci/i.test(f));

export default function CorregirAbono() {
  const sel = leer('abono-a-corregir');
  const credito = sel?.credito;
  const abono = sel?.abono;
  const [que, setQue] = useState('ANULAR');
  const [montoNuevo, setMontoNuevo] = useState(String(abono?.monto ?? ''));
  const [formaNueva, setFormaNueva] = useState(abono?.forma || 'Efectivo');
  const [documento, setDocumento] = useState(abono?.documento || '');
  const [motivo, setMotivo] = useState('');
  const [fotos, setFotos] = useState([]);
  const [lectura, setLectura] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [errorLectura, setErrorLectura] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const conPapel = que === 'FORMA' && formaNueva !== 'Efectivo';

  const alCambiarFotos = useCallback(async (nuevas) => {
    setFotos(nuevas); setLectura(null); setErrorLectura(null);
    const f = nuevas[0];
    if (!f) return;
    setLeyendo(true);
    const r = await leerPagoDeCredito(f, { forma: formaNueva, saldo: Number(abono?.monto) || 0 });
    setLeyendo(false);
    if (r?.error) { setErrorLectura(mensajeAmigable(r.error)); return; }
    setLectura(r);
    if (r.sugerido?.documento) setDocumento(String(r.sugerido.documento));
  }, [formaNueva, abono]);

  if (!credito || !abono) return <Aviso tono="freno" texto="No se encontró el abono." />;

  const bloqueado = lectura && lectura.veredicto !== 'OK';
  const valido = motivo.trim().length >= 5 && !bloqueado
    && (que !== 'MONTO' || Number(montoNuevo) > 0)
    && (!conPapel || (fotos.length && lectura));

  const pedir = async () => {
    setOcupado(true);
    const r = await pedirCorreccionDeAbono({
      sala: credito.branch_id, credito: credito.credito,
      abonoErp: abono.erp_id_borrable, que, motivo: motivo.trim(),
      montoActual: Number(abono.monto), montoNuevo: Number(montoNuevo),
      formaActual: abono.forma, formaNueva,
      documentoNuevo: documento || null,
      fechaDocumento: lectura?.sugerido?.fecha || null,
      pos: lectura?.sugerido?.pos || null,
      lectura: lectura || null,
      cliente: credito.cliente,
    }).catch((e) => ({ error: e }));
    setOcupado(false);
    if (r?.error || r?.ok === false) { fallo('No se pudo pedir', mensajeAmigable(r.error || r)); return; }
    listo('Solicitud enviada', 'La decide quien tenga el permiso de cuentas por cobrar.');
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir una corrección', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={{ gap: 4, marginHorizontal: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(abono.monto)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[abono.forma, fechaCorta(abono.fecha), credito.cliente].filter(Boolean).join(' · ')}</Text>
          </View>
          <Aviso texto="Corregir un abono se aplica borrándolo y volviéndolo a hacer —es lo único que el sistema de la caja permite—, así que en su historial van a quedar los dos renglones." />
          <Seccion titulo="Qué hay que hacer">
            <Opciones opciones={QUE} valor={que} onCambiar={setQue} />
          </Seccion>
          {que === 'MONTO' ? (
            <Seccion titulo="Monto correcto">
              <Campo multiline={false} keyboardType="decimal-pad" value={montoNuevo} onChangeText={setMontoNuevo} placeholder="0.00" />
            </Seccion>
          ) : null}
          {que === 'FORMA' ? (
            <Seccion titulo="Forma correcta">
              <Opciones opciones={FORMAS} valor={formaNueva} onCambiar={(f) => { setFormaNueva(f); setFotos([]); setLectura(null); setErrorLectura(null); }} />
            </Seccion>
          ) : null}
          {conPapel ? (
            <Seccion titulo="Comprobante" pie="Una foto del voucher o de la transferencia.">
              <Fotos fotos={fotos} onCambiar={alCambiarFotos} max={1} />
              {leyendo ? <Aviso texto="Leyendo el comprobante…" /> : null}
              {errorLectura ? <Aviso tono="cuidado" texto={`No se pudo leer el comprobante: ${errorLectura}`} /> : null}
              {bloqueado ? <Aviso tono="freno" texto={MOTIVO_DEL_FRENO[lectura.veredicto] || 'El comprobante no se pudo dar por bueno.'} /> : null}
              <Campo multiline={false} value={documento} onChangeText={setDocumento} maxLength={40} placeholder="Número del comprobante" />
            </Seccion>
          ) : null}
          <Seccion titulo="Por qué">
            <Campo value={motivo} onChangeText={setMotivo} placeholder="Qué pasó, en una frase" style={{ minHeight: 80 }} />
          </Seccion>
          <BotonGrande texto={ocupado ? 'Enviando…' : 'Pedir'} onPress={pedir} deshabilitado={ocupado || !valido} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
