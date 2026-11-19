// Pedir una corrección de un movimiento de caja, NATIVO — `DialogoCorregir` de
// «Mi caja»: anularlo, corregir su monto o, si es un ingreso, cambiar cómo se
// pagó, con motivo. No corrige nada por sí mismo: queda PEDIDO y alguien tiene
// que aprobarlo (`operar-caja`, acción `corregir`), igual que en el portal.
//
// La pantalla sólo recibe el id: el movimiento se lee aquí
// (`fetchMovimientoDelPortal`) para saber cómo se pagó, si es un ingreso y si
// llegó a la caja (`erp_movimiento_id`). Sin esa lectura sólo se ofrece anular
// o corregir el monto, que no dependen de nada de eso.
//
// Cambiar cómo se pagó (portal, 2026-10-17): salir del efectivo exige la foto
// del comprobante —es lo que prueba que el dinero llegó por otra vía—; volver
// al efectivo no. La foto se sube ANTES de pedir: quien decide la tiene que ver
// en la solicitud. Sin señal queda en el teléfono y se sube sola.
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchMovimientoDelPortal, pedirCorreccion } from '@nucleo/data/bolsas';
import { FORMAS_DE_PAGO, nombreDelComprobante } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion, exigeParametro } from '../componentes/formulario/Piezas';
import Fotos, { subirFotosOEncolar } from '../componentes/formulario/Fotos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const NOMBRE_DE_FORMA = Object.fromEntries(FORMAS_DE_PAGO.map((f) => [f.value, f.label]));

function CorregirMovimiento() {
  const { sala, id, concepto, monto } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const [mov, setMov] = useState(undefined);   // undefined = leyendo · null = no se pudo leer
  const [que, setQue] = useState('ANULAR');
  const [motivo, setMotivo] = useState('');
  const [montoNuevo, setMontoNuevo] = useState('');
  const [formaNueva, setFormaNueva] = useState('');
  const [fotos, setFotos] = useState([]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchMovimientoDelPortal(id).then((r) => { if (vivo) setMov(r?.movimiento ?? null); }).catch(() => { if (vivo) setMov(null); });
    return () => { vivo = false; };
  }, [id]);

  const formaActual = mov?.forma_pago || 'EFECTIVO';
  const puedeCambiarForma = mov?.tipo === 'ENTRADA';
  const otrasFormas = FORMAS_DE_PAGO.filter((f) => f.value !== formaActual).map((f) => ({ id: f.value, label: f.label }));
  const pideFoto = que === 'FORMA' && !!formaNueva && formaNueva !== 'EFECTIVO';
  const nuevo = Number(montoNuevo.replace(',', '.'));
  const valido = motivo.trim().length >= 5
    && (que === 'ANULAR'
      || (que === 'MONTO' && nuevo > 0)
      || (que === 'FORMA' && !!formaNueva && (!pideFoto || fotos.length > 0)));
  const titulo = `${mov?.concepto || concepto} · ${formatMoney(mov?.monto ?? monto)}`;
  const queTexto = que === 'ANULAR' ? 'Anular' : que === 'MONTO' ? `Cambiar a ${formatMoney(nuevo)}` : `Cambiar a ${NOMBRE_DE_FORMA[formaNueva] || formaNueva}`;

  const pedir = () => Alert.alert('¿Pedir la corrección?',
    `${queTexto}: ${titulo}.\nQueda pedido. Alguien tiene que aprobarlo.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Pedir', onPress: async () => {
        setOcupado(true);
        trabajando('Pidiendo la corrección…');
        let fotoUrl = null;
        if (pideFoto) {
          try {
            const subida = await subirFotosOEncolar(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${sala}/${user?.id ?? 'anon'}` });
            fotoUrl = subida.urls[0] ?? null;
          } catch (e) {
            setOcupado(false);
            fallo('No se subió la foto', mensajeAmigable(e));
            return;
          }
          if (!fotoUrl) { setOcupado(false); fallo('No se subió la foto', 'Vuelve a intentarlo.'); return; }
        }
        const r = await pedirCorreccion({
          sala, movimiento: id, que, motivo: motivo.trim(),
          montoNuevo: que === 'MONTO' ? nuevo : null,
          formaNueva: que === 'FORMA' ? formaNueva : null, fotoUrl,
        }).catch((e) => ({ error: e }));
        setOcupado(false);
        if (r?.error) { fallo('No se pudo pedir', mensajeAmigable(r.error)); return; }
        listo('Queda pedido', 'Alguien tiene que aprobarlo.');
        router.back();
      } },
    ]);

  const opciones = [
    { id: 'ANULAR', label: 'Anularlo' },
    { id: 'MONTO', label: 'Corregir el monto' },
    ...(puedeCambiarForma ? [{ id: 'FORMA', label: 'Cambiar cómo pagó' }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pedir una corrección' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>{titulo}</Text>
          {/* Cuál de dos anotados iguales es el que está en la caja (portal,
              23-oct): se anuló el que estaba y quedó vivo el que nunca llegó.
              Igual que en el portal, sólo para lo que es efectivo. */}
          {mov && formaActual === 'EFECTIVO' ? (
            <Aviso tono={mov.erp_movimiento_id ? 'nota' : 'cuidado'} texto={mov.erp_movimiento_id
              ? `Este está en la caja (n.º ${mov.erp_movimiento_id}).`
              : 'Este no llegó a la caja. Si lo anulas, solo se quita del portal.'} />
          ) : null}
          {mov === null ? <Aviso tono="cuidado" texto="No se pudo leer el movimiento. Puedes anularlo o corregir el monto." /> : null}
          {!puedeOperar ? <Aviso tono="freno" texto="Pedir correcciones es de quien opera la caja." /> : (
            <>
              <Seccion titulo="Qué hay que corregir">
                <Opciones opciones={opciones} valor={que} onCambiar={setQue} />
                {que === 'MONTO' ? (
                  <Campo multiline={false} value={montoNuevo} onChangeText={(v) => setMontoNuevo(v.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad" placeholder="Monto correcto" style={{ textAlign: 'center' }} />
                ) : null}
              </Seccion>
              {que === 'FORMA' ? (
                <Seccion titulo="Cómo pagó en realidad" pie={!formaNueva ? `Ahora dice ${NOMBRE_DE_FORMA[formaActual] || formaActual}.`
                  : formaNueva === 'EFECTIVO' ? 'Al aprobarse, el monto se suma a la caja del día. El dinero tiene que estar en la caja.'
                  : formaActual === 'EFECTIVO' ? 'Al aprobarse, el monto sale de la caja del día.'
                  : 'No cambia la caja. Solo cambia el comprobante.'}>
                  <Opciones opciones={otrasFormas} valor={formaNueva} onCambiar={(v) => { setFormaNueva(v); if (v === 'EFECTIVO') setFotos([]); }} />
                </Seccion>
              ) : null}
              {pideFoto ? (
                <Seccion titulo={`Foto del ${nombreDelComprobante(formaNueva)}`} pie="Es obligatoria.">
                  <Fotos documento max={1} fotos={fotos} onCambiar={setFotos} />
                </Seccion>
              ) : null}
              <Seccion titulo="Motivo" pie="Al menos cinco letras. Es lo que lee quien aprueba.">
                <Campo value={motivo} onChangeText={setMotivo} maxLength={200} placeholder="Se anotó dos veces" />
              </Seccion>
              <BotonGrande texto={ocupado ? 'Pidiendo…' : 'Pedir'} color={MARCA.ambar} deshabilitado={ocupado || !valido || mov === undefined} onPress={pedir} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default exigeParametro(CorregirMovimiento, 'id', { titulo: 'Corregir', texto: 'No se encontró el movimiento.' });
