// Pedir una baja de un lote de Torogoz, NATIVO — el formulario «Bajas» de
// `TabConteo`: el lote (con buscador), cuántas unidades (no más de las que
// hay), el motivo y qué pasó. Queda esperando a quien administra; recién
// aprobada sale del lote. Lo escrito se guarda como borrador: la sesión se
// cierra sola a los pocos minutos.
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { mensajeDeDistribucion, solicitarBaja } from '@nucleo/data/distribucion';
import { MOTIVOS_BAJA, leerEntero } from '@nucleo/utils/distribucionBodega';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import ConAurora from '../../ConAurora';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo, listo } from '../../Progreso';
import { PETROLEO, confirmar } from './piezas';

// La misma clave que el borrador del portal: una baja a medio escribir en un
// lado no se mezcla con la del otro, porque cada uno guarda en su dispositivo.
const BORRADOR = 'distribucion-baja-nueva';
const VACIA = { lote: '', unidades: '', motivo: 'vencido', detalle: '' };

export default function PedirBaja({ lotes, puedeConfigurar, onCerrar, onGuardado }) {
  const [baja, setBaja] = useState(() => ({ ...VACIA, ...(loadDraft(BORRADOR) ?? {}) }));
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (baja.lote || baja.detalle) saveDraft(BORRADOR, baja); }, [baja]);

  const loteSel = lotes.find((l) => String(l.id) === String(baja.lote));
  const opciones = useMemo(() => {
    const q = texto.trim();
    return lotes.filter((l) => !q || tokenMatch(q, l.nombre, l.lote)).slice(0, 40)
      .map((l) => ({ id: String(l.id), label: `${l.nombre} · ${l.lote}`, detalle: `${l.existencia} unidades${l.vence ? ` · vence ${fechaNumerica(l.vence)}` : ''}` }));
  }, [lotes, texto]);
  const n = leerEntero(baja.unidades);
  const falta = !baja.lote ? 'Elige el lote.' : !(n > 0) ? 'Escribe cuántas unidades.' : loteSel && n > loteSel.existencia ? `Hasta ${loteSel.existencia} unidades.`
    : !baja.detalle.trim() ? 'Cuenta qué pasó.' : null;

  const pedir = async () => {
    if (falta || guardando) return;
    const motivo = MOTIVOS_BAJA.find((m) => m.value === baja.motivo)?.label;
    const ok = await confirmar('¿Pedir la baja?', `${loteSel?.nombre} · lote ${loteSel?.lote} · ${n} u · ${motivo}.`, 'Pedir baja');
    if (!ok) return;
    setGuardando(true);
    try {
      const id = await solicitarBaja(Number(baja.lote), n, baja.motivo, baja.detalle.trim());
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_BAJA_SOLICITADA', String(id), { lote: Number(baja.lote), unidades: n, motivo: baja.motivo, desde: 'app' });
      clearDraft(BORRADOR);
      listo('Baja pedida', puedeConfigurar ? 'Apruébala en la lista para que salga del lote.' : 'Queda esperando la aprobación de quien administra.');
      onGuardado();
    } catch (e) {
      fallo('No se pudo pedir', mensajeDeDistribucion(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={guardando ? undefined : onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 4 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Pedir una baja</Text>
            <Pressable onPress={onCerrar} disabled={guardando} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
            </Pressable>
          </View>
          <Seccion titulo="Lote">
            {loteSel ? (
              <Pressable onPress={() => setBaja((b) => ({ ...b, lote: '' }))} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${loteSel.nombre} · ${loteSel.lote}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${loteSel.existencia} unidades · tocar para cambiar`}</Text>
              </Pressable>
            ) : (
              <>
                <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar producto o lote" autoCorrect={false} />
                <Opciones opciones={opciones} valor={baja.lote} color={PETROLEO} onCambiar={(v) => setBaja((b) => ({ ...b, lote: v }))} />
              </>
            )}
          </Seccion>
          <Seccion titulo="Unidades">
            <Campo multiline={false} keyboardType="number-pad" value={baja.unidades} placeholder={loteSel ? `Hasta ${loteSel.existencia}` : 'Unidades'}
              onChangeText={(t) => setBaja((b) => ({ ...b, unidades: t }))} />
          </Seccion>
          <Seccion titulo="Motivo">
            <Opciones opciones={MOTIVOS_BAJA.map((m) => ({ id: m.value, label: m.label }))} valor={baja.motivo} color={PETROLEO}
              onCambiar={(v) => setBaja((b) => ({ ...b, motivo: v }))} />
          </Seccion>
          <Seccion titulo="Qué pasó">
            <Campo value={baja.detalle} onChangeText={(t) => setBaja((b) => ({ ...b, detalle: t }))} placeholder="Caja mojada, vencido en la bodega…" />
          </Seccion>
          {falta ? <Aviso texto={falta} /> : null}
          <BotonGrande texto={guardando ? 'Pidiendo…' : 'Pedir baja'} color={MARCA.rojo} onPress={pedir} deshabilitado={!!falta || guardando} />
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
