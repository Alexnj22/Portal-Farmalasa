// El correo al cliente, dentro del documento —el `CorreoDocumento` del portal
// (borrador 0019)—: a quién se le mandó, si falló, y el botón. Hacienda exige
// entregarle el documento SELLADO, así que antes del sello no se ofrece.
//
// ⚠ Envía de verdad (con el PDF y el JSON): el entorno de pruebas no tiene la
// función de correo, así que ahí no se puede probar.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { correoValido, destinoDelCorreo, estadoDelCorreo } from '@nucleo/utils/distribucionFacturacion';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../formulario/Piezas';
import { Pildora } from '../../avisos/Piezas';
import { colorDeVariante } from '../../colorDeVariante';
import { fallo, listo, trabajando } from '../../Progreso';
import { enviarDocumentoPorCorreo } from './papel';

const PETROLEO = '#0f6e7d';

export default function CorreoDocumento({ dte, puedeEnviar, onEnviado }) {
  const vigente = Array.isArray(dte.correo) ? dte.correo[0] : dte.correo;
  const est = estadoDelCorreo(vigente);
  const [destino, setDestino] = useState(() => destinoDelCorreo(dte));
  const [enviando, setEnviando] = useState(false);
  const sellado = dte.estado === 'sellado';
  const valido = correoValido(destino);

  const enviar = () => Alert.alert(vigente?.estado === 'enviado' ? '¿Reenviar el documento?' : '¿Enviar el documento?',
    `Le llega a ${destino.trim()} con el PDF y el archivo JSON.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        setEnviando(true); trabajando('Enviando el correo…');
        try {
          const r = await enviarDocumentoPorCorreo(dte, { destinatario: destino.trim() });
          useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_DTE_CORREO', String(dte.id), { destinatario: r?.destinatario, simulado: !!r?.simulado, via: 'app' });
          listo('Documento enviado', `${r?.destinatario ?? destino.trim()}${r?.simulado ? ' (envío simulado del entorno de pruebas)' : ''}`);
          onEnviado?.();
        } catch (e) {
          fallo('No se pudo enviar', mensajeDeDistribucion(e));
        } finally { setEnviando(false); }
      } },
    ]);

  return (
    <Seccion titulo="Correo al cliente">
      <Pildora texto={est.texto} color={colorDeVariante(est.variant)} />
      {vigente?.estado === 'enviado' && vigente.enviado_at ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`El ${fechaNumerica(vigente.enviado_at)} a las ${hora12(vigente.enviado_at)}, con el archivo JSON y el PDF.`}</Text>
      ) : null}
      {vigente?.estado === 'fallido' && vigente.ultimo_error ? <Aviso tono="freno" texto={vigente.ultimo_error} /> : null}
      {puedeEnviar && sellado ? (
        <View style={{ gap: 8 }}>
          <Campo multiline={false} value={destino} onChangeText={setDestino} placeholder="correo@cliente.com"
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" />
          {destino !== '' && !valido ? <Aviso tono="freno" texto="Revisa el correo." /> : null}
          <BotonGrande borde color={PETROLEO} texto={enviando ? 'Enviando…' : vigente?.estado === 'enviado' ? 'Reenviar' : 'Enviar'}
            deshabilitado={!valido || enviando} onPress={enviar} />
        </View>
      ) : !sellado ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se envía cuando Hacienda lo selle: el cliente tiene que recibir el sello.</Text>
      ) : null}
    </Seccion>
  );
}
