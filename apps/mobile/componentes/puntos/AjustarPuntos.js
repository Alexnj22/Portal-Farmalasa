// Dar o quitar puntos a mano, NATIVO — `AjustarPuntos` de la cuenta del cliente
// en el portal. Con motivo (los mismos cinco; «Otro» exige el detalle) y sin
// dejar la cuenta en negativo; las tres cosas las vuelve a exigir la base
// (`puntos_ajustar`). Se habilita cuando el programa vive en el portal, igual
// que allá. Pide confirmación: mueve el saldo del cliente y no se deshace solo.
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { ajustarPuntos, fetchResumenDePuntos } from '@nucleo/data/puntos';
import { MOTIVOS_DE_AJUSTE_PUNTOS, puntosTexto } from '@nucleo/utils/puntosTexto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../formulario/Piezas';
import Segmentos from '../Segmentos';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

const pts = puntosTexto;

export default function AjustarPuntos({ customerId, nombre, saldo, onHecho }) {
  const [enPortal, setEnPortal] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [sentido, setSentido] = useState('dar');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchResumenDePuntos()).then((r) => { if (vivo) setEnPortal(r?.config?.fuente === 'portal'); }).catch(() => { if (vivo) setEnPortal(false); });
    return () => { vivo = false; };
  }, []);

  if (enPortal === false) return <Aviso texto="Dar o quitar puntos se habilita cuando el programa pasa al portal." />;
  if (!abierto) return <BotonGrande texto="Dar o quitar puntos" borde color={MARCA.azulClaro} deshabilitado={enPortal == null} onPress={() => setAbierto(true)} />;

  const n = Math.floor(Number(cantidad) || 0);
  const quitaDeMas = sentido === 'quitar' && n > saldo;
  const falta = !n ? 'Escribe cuántos puntos.' : !motivo ? 'Elige el motivo.'
    : motivo === 'Otro' && !nota.trim() ? 'Con «Otro», escribe el detalle.'
      : quitaDeMas ? `Tiene ${pts(saldo)} puntos; no se le pueden quitar ${pts(n)}.` : null;

  const guardar = () => Alert.alert(sentido === 'dar' ? `¿Darle ${pts(n)} puntos?` : `¿Quitarle ${pts(n)} puntos?`, `${nombre} · ${motivo}${nota.trim() ? ` · ${nota.trim()}` : ''}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: sentido === 'dar' ? 'Dar' : 'Quitar', style: sentido === 'quitar' ? 'destructive' : 'default', onPress: async () => {
      setGuardando(true);
      trabajando('Ajustando…');
      try {
        const r = await ajustarPuntos({ customerId, puntos: sentido === 'dar' ? n : -n, motivo, nota }, { nombre, desde: 'app' });
        listo(sentido === 'dar' ? 'Puntos dados' : 'Puntos quitados', `Ahora tiene ${pts(r?.saldo)} puntos.`);
        setAbierto(false); setCantidad(''); setMotivo(''); setNota('');
        onHecho?.();
      } catch (e) {
        fallo('No se pudo ajustar', mensajeAmigable(e));
      } finally { setGuardando(false); }
    } },
  ]);

  return (
    <Seccion titulo="Dar o quitar puntos">
      <Segmentos opciones={[{ id: 'dar', label: 'Dar' }, { id: 'quitar', label: 'Quitar' }]} activa={sentido} onCambiar={setSentido} margen={0} />
      <Campo multiline={false} value={cantidad} onChangeText={(v) => setCantidad(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Cuántos puntos" style={{ textAlign: 'center' }} />
      <Opciones opciones={MOTIVOS_DE_AJUSTE_PUNTOS} valor={motivo} onCambiar={setMotivo} />
      <Campo value={nota} onChangeText={setNota} placeholder={motivo === 'Otro' ? 'Obligatorio con «Otro»' : 'Opcional: ticket, promoción, quién lo pidió'} />
      {falta ? <Aviso tono={quitaDeMas ? 'freno' : 'cuidado'} texto={falta} /> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" borde onPress={() => setAbierto(false)} /></View>
        <View style={{ flex: 1 }}><BotonGrande texto={guardando ? 'Guardando…' : sentido === 'dar' ? 'Dar' : 'Quitar'} color={sentido === 'dar' ? MARCA.verde : MARCA.rojo} deshabilitado={guardando || !!falta} onPress={guardar} /></View>
      </View>
    </Seccion>
  );
}
