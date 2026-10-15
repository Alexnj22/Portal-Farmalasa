// Anotar la causa de una bolsa que no cuadró — el `Resolver` del circuito de
// bolsas del portal, para la app: lo usan administración (`bolsas`, en «Contar»
// antes de confirmar y en «Cuadre») y la sala (`bolsas-sala`, «Diferencias»).
// `resolver_diferencia_bolsa` acepta a quien tenga `bolsas_conteo` o `bolsas`
// con can_edit sobre una bolsa de su sala; la firma la pone el servidor.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { resolverDiferenciaBolsa } from '@nucleo/data/bolsas';
import { diferenciaDeBolsa, rotuloDeVia } from '@nucleo/utils/bolsasReparto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo } from '../formulario/Piezas';
import Fotos, { subirFotos } from '../formulario/Fotos';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

/** La causa de una diferencia: justificar, o repuesto/retirado, con foto opcional
 *  de respaldo. La foto se sube ANTES de resolver: saldar diciendo que hay
 *  respaldo cuando no llegó es peor que no adjuntarlo (igual que el portal). */
export default function ResolverDiferencia({ bolsa, userId, onResuelta, onCancelar }) {
  const [causa, setCausa] = useState('');
  const [fotos, setFotos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const dif = diferenciaDeBolsa(bolsa) ?? 0;
  const falta = dif < 0;
  const saldar = (via) => Alert.alert(`¿${rotuloDeVia(via)}?`, `${bolsa.folio}: ${falta ? 'faltaron' : 'sobraron'} ${formatMoney(Math.abs(dif))}.\n«${causa.trim()}»`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: rotuloDeVia(via), onPress: async () => {
      setOcupado(true);
      try {
        const url = fotos.length
          ? (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/${bolsa.branch_id ?? 'sin-sala'}/${userId ?? 'anon'}` }))[0] ?? null : null;
        const { error } = await resolverDiferenciaBolsa(bolsa.id, via, causa.trim(), url);
        if (error) throw error;
        listo(`${bolsa.folio} · ${rotuloDeVia(via).toLowerCase()}`);
        onResuelta();
      } catch (e) {
        fallo('No se pudo resolver', mensajeAmigable(e));
      } finally { setOcupado(false); }
    } },
  ]);
  return (
    <View style={{ gap: 8 }}>
      <Campo value={causa} onChangeText={setCausa} placeholder={falta ? 'Por qué faltó y qué se hizo…' : 'Por qué sobró y qué se hizo…'} />
      <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><BotonGrande texto="Justificar" borde deshabilitado={ocupado || !causa.trim()} onPress={() => saldar('JUSTIFICA')} /></View>
        <View style={{ flex: 1 }}><BotonGrande texto={falta ? 'Repuesto' : 'Retirado'} color={MARCA.verde} deshabilitado={ocupado || !causa.trim()} onPress={() => saldar(falta ? 'REPONE' : 'RETIRA')} /></View>
      </View>
      <BotonGrande texto="Cancelar" borde color={colorSistema.texto2} onPress={onCancelar} />
    </View>
  );
}
