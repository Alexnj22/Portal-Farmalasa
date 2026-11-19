// Reenviar con más pruebas, NATIVO — `DialogoReenviarIngreso` del portal:
// volver a pedir la autorización de un ingreso con tarjeta o transferencia que
// no se autorizó.
//
// Rechazado NO es anulado (decisión del usuario): el ingreso sigue anotado y
// espera más pruebas. Se pide lo que cambió: una foto nueva, una explicación,
// o las dos. Mandar lo mismo otra vez es pedir el mismo rechazo, y por eso el
// servidor exige al menos una (`caja_ingreso_reenviar`).
//
// Sólo recibe el id: el movimiento se lee aquí para mostrar por qué no se
// autorizó y qué papel pedir.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchMovimientoDelPortal, reenviarIngreso } from '@nucleo/data/bolsas';
import { nombreDelComprobante } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Cargando, Seccion, exigeParametro } from '../componentes/formulario/Piezas';
import Fotos, { subirFotosOEncolar } from '../componentes/formulario/Fotos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

function ReenviarIngreso() {
  const { sala, id } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const [mov, setMov] = useState(undefined);   // undefined = leyendo · null = no se pudo leer
  const [fotos, setFotos] = useState([]);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchMovimientoDelPortal(id).then((r) => { if (vivo) setMov(r?.movimiento ?? null); }).catch(() => { if (vivo) setMov(null); });
    return () => { vivo = false; };
  }, [id]);

  const papel = nombreDelComprobante(mov?.forma_pago);
  // Basta una de las dos (portal, 2026-11-14).
  const falta = fotos.length || nota.trim().length >= 5 ? null
    : nota.trim() ? 'Explica un poco más qué cambió.'
    : `Sube una foto nueva del ${papel} o explica qué cambió.`;

  const enviar = async () => {
    if (enviando || falta) return;
    setEnviando(true);
    trabajando('Reenviando…');
    try {
      const url = fotos.length
        ? (await subirFotosOEncolar(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? mov?.branch_id ?? 'sin-sala'}/${user?.id ?? 'anon'}` })).urls[0] ?? null
        : null;
      await reenviarIngreso(id, nota, url);
      listo('Reenviado', 'Lo vuelve a revisar un supervisor, un administrador o Talento Humano.');
      router.back();
    } catch (e) {
      fallo('No se pudo reenviar', mensajeAmigable(e));
    } finally {
      setEnviando(false);
    }
  };

  let cuerpo;
  if (!puedeOperar) cuerpo = <Aviso tono="freno" texto="Reenviar un ingreso es de quien opera la caja." />;
  else if (mov === undefined) cuerpo = <Cargando />;
  else if (mov === null) cuerpo = <Aviso tono="freno" texto="No se pudo leer el ingreso. Vuelve a intentarlo." />;
  else {
    cuerpo = (
      <>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>
          {`${mov.detalle || mov.concepto} · ${formatMoney(Number(mov.monto || 0))}`}
        </Text>
        {mov.autorizacion_nota ? <Aviso tono="cuidado" texto={`No se autorizó porque: ${mov.autorizacion_nota}`} /> : null}
        <Seccion titulo={`Foto del ${papel}`} pie="Si ya la tienes.">
          <Fotos documento max={1} fotos={fotos} onCambiar={setFotos} />
        </Seccion>
        <Seccion titulo="Qué cambió">
          <Campo value={nota} onChangeText={setNota} maxLength={500} placeholder="El cliente mandó la captura de la transferencia" />
        </Seccion>
        {falta ? <Aviso texto={falta} /> : null}
        <BotonGrande texto={enviando ? 'Enviando…' : 'Reenviar'} color={MARCA.azul} deshabilitado={enviando || !!falta} onPress={enviar} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reenviar con más pruebas' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {cuerpo}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default exigeParametro(ReenviarIngreso, 'id', { titulo: 'Reenviar', texto: 'No se encontró el ingreso.' });
