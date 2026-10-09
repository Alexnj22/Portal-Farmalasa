// Un depósito al banco, NATIVO — el detalle de `DepositosAlBanco`: la misma
// cuenta que se vio al cerrarlo y en el mismo orden, los días y las bolsas que
// se fueron adentro, la boleta del banco (verla o anexarla) y «Corregir el
// cierre».
//
// Corregir no borra: deja el cierre anulado con su motivo y devuelve sus bolsas
// a «por cerrar», igual que en el portal. La boleta se anexa DESPUÉS de cerrar
// (sale al volver de la ventanilla) y sólo donde hubo algo al banco.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { adjuntarComprobanteDeposito, anularDeposito, fetchDepositos } from '@nucleo/data/bolsas';
import { rangoDeDiasDelDeposito } from '@nucleo/utils/depositoDeEfectivo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../../componentes/formulario/Fotos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { depositoRecordado } from '../../componentes/caja/depositoElegido';

const larga = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');

export default function Deposito() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeContar = hasPermission('bolsas_conteo', 'can_edit');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (bid) => (sucursales || []).find((b) => String(b.id) === String(bid))?.name ?? '';
  const [d, setD] = useState(() => depositoRecordado(id) ?? undefined);
  const [fotos, setFotos] = useState([]);
  const [motivo, setMotivo] = useState('');
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const releer = useCallback(async () => {
    const filas = await Promise.resolve(fetchDepositos({})).catch(() => []);
    setD((filas || []).find((x) => String(x.id) === String(id)) ?? null);
  }, [id]);
  useEffect(() => { if (!depositoRecordado(id)) releer(); }, [id, releer]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

  if (d === undefined) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (!d) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Depósito' }} />
      <View style={{ padding: 20 }}><Aviso tono="freno" texto="No se encontró este depósito." /></View></>);
  }
  const anulado = !!d.anulado_at;
  const anterior = d.destino === 'ANTERIOR';

  const anexar = async () => {
    if (!fotos.length) return;
    setOcupado(true);
    trabajando('Anexando la boleta…');
    try {
      const [url] = await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `bolsas/cierres/${d.id}` });
      const { error } = await adjuntarComprobanteDeposito(d.id, url);
      if (error) throw error;
      listo('Comprobante anexado', d.folio);
      setFotos([]);
      await releer();
    } catch (e) {
      fallo('No se pudo anexar el comprobante', mensajeAmigable(e));
    } finally { setOcupado(false); }
  };

  const corregir = () => Alert.alert(`¿Corregir el cierre ${d.folio}?`,
    `Queda anulado con su motivo y sus ${d.cuantas} ${Number(d.cuantas) === 1 ? 'bolsa vuelve' : 'bolsas vuelven'} a estar por cerrar. No se borra.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Corregir', style: 'destructive', onPress: async () => {
        setOcupado(true);
        trabajando('Corrigiendo el cierre…');
        const { error } = await Promise.resolve(anularDeposito(d.id, motivo.trim())).catch((e) => ({ error: e }));
        setOcupado(false);
        if (error) { fallo('No se pudo corregir el cierre', mensajeAmigable(error)); return; }
        listo('Cierre corregido', d.folio);
        router.back();
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: d.folio }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>
          {`${larga(d.fecha)} · cerrado por ${d.cerrado_por || '—'} · ${d.cerrado_at ? fechaHora12(d.cerrado_at) : ''}`}
        </Text>
        {anulado ? <Aviso tono="cuidado" texto={`Este cierre se corrigió: ${d.anulado_motivo} · ${d.anulado_por || '—'} · ${fechaHora12(d.anulado_at)}. Sus bolsas volvieron a estar por cerrar.`} /> : null}

        <Seccion titulo="La cuenta">
          <Dato primero rotulo="Contado" valor={formatMoney(d.total_contado)} />
          {Number(d.aporte) > 0 ? <Dato rotulo="Entró de afuera" valor={formatMoney(d.aporte)} /> : null}
          <Dato rotulo={d.banco ? `Al banco (${d.banco})` : 'Al banco'} valor={formatMoney(d.monto_deposito)} />
          {Number(d.monto_efectivo) > 0 ? <Dato rotulo="En mano" valor={formatMoney(d.monto_efectivo)} /> : null}
          <Dato rotulo="Remanente" valor={formatMoney(d.remanente)} fuerte />
        </Seccion>
        {Number(d.aporte) > 0 && d.aporte_nota ? <Aviso texto={`De dónde salió lo que entró: ${d.aporte_nota}`} /> : null}
        {d.destino === 'EFECTIVO' && d.entregado_a ? <Aviso texto={`Se le entregó en mano a: ${d.entregado_a}.`} /> : null}
        {d.llevado_por ? <Aviso texto={`Lo llevó al banco: ${d.llevado_por}.`} /> : null}
        {Number(d.remanente) >= 0.01 ? <Aviso texto={`Quedaron ${formatMoney(d.remanente)} sin salir por el portal.`} /> : null}
        {d.nota ? <Aviso texto={`Nota: ${d.nota}`} /> : null}

        {(d.por_dia?.length || 0) > 1 ? (
          <Seccion titulo="Por día">
            {d.por_dia.map((x, i) => <Dato key={x.fecha} primero={!i} rotulo={`${corta(x.fecha)} · ${x.cuantas} ${Number(x.cuantas) === 1 ? 'bolsa' : 'bolsas'}`} valor={formatMoney(x.contado)} />)}
          </Seccion>
        ) : null}
        <Seccion titulo={`${d.bolsas?.length || 0} ${d.bolsas?.length === 1 ? 'bolsa' : 'bolsas'} · días ${rangoDeDiasDelDeposito(d, corta)}`}>
          {(d.bolsas || []).map((b, i) => (
            <Dato key={b.id} primero={!i} rotulo={`${b.folio} · ${nombreSala(b.branch_id)} · ${corta(b.fecha)} ${b.hora ? hora12(b.hora) : ''}`} valor={formatMoney(b.contado)} />
          ))}
        </Seccion>

        {!anterior && Number(d.monto_deposito) > 0 ? (
          <Seccion titulo="Boleta del banco">
            {d.comprobante_url ? <BotonGrande texto="Ver la boleta" borde onPress={() => Promise.resolve(openStoredFile(d.comprobante_url)).catch(() => {})} /> : null}
            {!anulado && puedeContar ? (
              <>
                <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
                {fotos.length ? <BotonGrande texto={ocupado ? 'Anexando…' : d.comprobante_url ? 'Reemplazar la boleta' : 'Anexar la boleta'} color={MARCA.verde} deshabilitado={ocupado} onPress={anexar} /> : null}
              </>
            ) : !d.comprobante_url ? <Aviso texto="Todavía no se anexó la boleta." /> : null}
          </Seccion>
        ) : null}

        {!anulado && !anterior && puedeContar ? (
          corrigiendo ? (
            <Seccion titulo="Corregir el cierre" pie="Queda anulado con su motivo y sus bolsas vuelven a estar por cerrar.">
              <Campo value={motivo} onChangeText={setMotivo} placeholder="Por qué se corrige (obligatorio)" />
              <BotonGrande texto={ocupado ? 'Corrigiendo…' : 'Corregir el cierre'} color={MARCA.rojo} deshabilitado={ocupado || !motivo.trim()} onPress={corregir} />
              <BotonGrande texto="Cancelar" borde onPress={() => { setCorrigiendo(false); setMotivo(''); }} />
            </Seccion>
          ) : <BotonGrande texto="Corregir el cierre" borde color={MARCA.rojo} onPress={() => setCorrigiendo(true)} />
        ) : null}
      </ScrollView>
    </>
  );
}
