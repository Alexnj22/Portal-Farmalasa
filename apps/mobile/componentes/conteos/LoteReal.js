// «Lote y vence» de un renglón del SISTEMA en un conteo que ajusta el
// inventario, NATIVO — gemelo de `src/views/inventario/LoteRealDelRenglon.jsx`
// (2026-11-13, «dejemos TODO completamente nativo»). En ese conteo el lote de
// un renglón del sistema no se corrige (la base lo rechaza): se anotan los
// lotes reales de la caja —puede ser más de uno: Alerkem 3 + 2— y el renglón
// queda con lo que no trae lote impreso, que se calcula solo hasta que se
// escribe a mano. El vencimiento es MES y año, lo que trae el empaque.
// La regla vive en `planDeLotesReales`; los pasos, en `anotarLotesRealesConteo`.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, Modal, ScrollView, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { esLoteGenerico, planDeLotesReales, reglaDeLoteYVence, unidadDeConteo } from '@nucleo/utils/conteoDeInventario';
import { fetchReglaDeLoteDelProducto } from '@nucleo/data/conteoInventario';
import { venceDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import Tocable from '../Tocable';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const aMes = (fecha) => (fecha ? String(fecha).slice(0, 7) : '');
const loteVacio = () => ({ lote: '', vence: '', cantidad: '' });

/** Mes y año en dos toques (año, después mes): «AAAA-MM». */
function MesAnio({ valor, onCambiar }) {
  const elegir = () => {
    const hoy = new Date().getFullYear();
    const anios = Array.from({ length: 9 }, (_, i) => String(hoy - 2 + i));
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Año de vencimiento', options: [...anios, 'Cancelar'], cancelButtonIndex: anios.length }, (i) => {
      if (i >= anios.length) return;
      ActionSheetIOS.showActionSheetWithOptions({ title: `Mes de ${anios[i]}`, options: [...MESES, 'Cancelar'], cancelButtonIndex: 12 }, (m) => {
        if (m < 12) onCambiar(`${anios[i]}-${String(m + 1).padStart(2, '0')}`);
      });
    });
  };
  const [a, m] = String(valor || '').split('-');
  return (
    <Tocable onPress={elegir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
      <Text style={{ flex: 1, textAlign: 'right', color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16 }}>
        {a && m ? `${MESES[Number(m) - 1]} ${a}` : 'Mes y año'}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

export default function LoteReal({ conteoId, item, hermanos = [], onCerrar, onListo }) {
  const anotar = useStaffStore((s) => s.anotarLotesRealesConteo);
  const [regla, setRegla] = useState({ pideLote: true, pideVence: true });
  const [lotes, setLotes] = useState([loteVacio()]);
  const [sinLoteEscrito, setSinLoteEscrito] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const sinLote = esLoteGenerico(item?.lote);
  const total = Number(item?.fisico_cantidad ?? item?.sistema_cantidad ?? 0) || 0;

  useEffect(() => {
    if (!item) return undefined;
    setLotes(sinLote ? [loteVacio()] : [{ lote: item.lote, vence: aMes(item.fecha_vencimiento), cantidad: String(total) }]);
    setSinLoteEscrito(null);
    let vivo = true;
    fetchReglaDeLoteDelProducto(item.erp_product_id).then(({ data, error }) => {
      if (vivo && !error && data) setRegla(reglaDeLoteYVence(data));
    });
    return () => { vivo = false; };
  }, [item, sinLote, total]);

  const anotado = lotes.reduce((t, l) => t + (Number(l.cantidad) || 0), 0);
  const sinLoteValor = sinLoteEscrito ?? String(Math.max(0, total - anotado));
  const plan = useMemo(() => (item ? planDeLotesReales({
    item,
    lotes: lotes.map((l) => ({ lote: l.lote, vence: l.vence ? venceDelMes(l.vence) : null, cantidad: l.cantidad })),
    sinLote: sinLoteValor,
    hermanos,
    regla,
  }) : { error: null }), [item, lotes, sinLoteValor, hermanos, regla]);

  const unidad = item ? unidadDeConteo(item) : { nombre: '' };
  const cambiar = (i, campo, valor) => setLotes((p) => p.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const quitar = (i) => setLotes((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));
  const conNuevos = !!(plan.nuevos?.length || plan.aHermanos?.length);

  const guardar = async () => {
    if (plan.error || guardando) return;
    setGuardando(true);
    try {
      await anotar(conteoId, item, plan);
      const n = plan.nuevos.length + plan.aHermanos.length;
      listo(n ? 'Lotes anotados' : 'Lote confirmado',
        n ? `${n} ${n === 1 ? 'lote' : 'lotes'}${sinLote ? `; sin lote impreso: ${plan.original}` : ''}.` : `${plan.original} ${unidad.nombre} en el lote ${item.lote}.`);
      onCerrar();
    } catch (e) {
      fallo('No se guardó todo', mensajeAmigable(e));
    } finally {
      setGuardando(false);
      onListo?.();
    }
  };

  return (
    <Modal visible={!!item} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={sinLote ? 'Anotar lote' : 'Confirmar lote'}
          subtitulo={item ? `${item.product_nombre || ''} · ${unidad.texto ?? ''} · había ${total}` : ''} onCerrar={onCerrar} />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {sinLote
                ? 'Anota cada lote impreso en las cajas, con su vencimiento y cuántas hay. Si hay más de uno, toca «Otro lote».'
                : 'Revisa el lote y el vencimiento contra la caja. Si coinciden, sólo confirma la cantidad; si no, corrígelos o agrega otro lote.'}
            </Text>
            {lotes.map((l, i) => (
              <Seccion key={i} titulo={`${regla.pideLote ? 'Lote' : 'Caja'}${lotes.length > 1 ? ` ${i + 1}` : ''}`}>
                {regla.pideLote ? (
                  <Campo multiline={false} value={l.lote} placeholder="Ej. 260412" autoCapitalize="characters" autoCorrect={false}
                    onChangeText={(v) => cambiar(i, 'lote', v)} />
                ) : null}
                {regla.pideVence ? <MesAnio valor={l.vence} onCambiar={(v) => cambiar(i, 'vence', v)} /> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{`Cantidad (${unidad.nombre})`}</Text>
                <Campo multiline={false} keyboardType="number-pad" value={l.cantidad} onChangeText={(v) => cambiar(i, 'cantidad', v.replace(/[^\d]/g, ''))}
                  style={{ fontSize: 20, fontWeight: '700' }} />
                {lotes.length > 1 ? (
                  <Tocable onPress={() => quitar(i)} style={{ alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14 }}>Quitar este lote</Text>
                  </Tocable>
                ) : null}
              </Seccion>
            ))}
            <BotonGrande texto="Otro lote" borde onPress={() => setLotes((p) => [...p, loteVacio()])} />
            {sinLote ? (
              <Seccion titulo={`Sin lote impreso (${unidad.nombre})`}>
                <Campo multiline={false} keyboardType="number-pad" value={sinLoteValor} onChangeText={(v) => setSinLoteEscrito(v.replace(/[^\d]/g, ''))}
                  style={{ fontSize: 20, fontWeight: '700' }} />
              </Seccion>
            ) : null}
            {sinLote ? <Aviso tono="nota" texto={`Había ${total}; anotaste ${anotado} con lote. Al aprobar, las que tienen lote salen de «Sin lote» y entran a su lote.`} /> : null}
            {plan.error ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{plan.error}</Text> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : conNuevos ? 'Guardar lotes' : 'Confirmar'} color={MARCA.verde}
              deshabilitado={guardando || !!plan.error} onPress={guardar} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}
