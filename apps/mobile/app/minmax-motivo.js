// Por qué un MIN·MAX está puesto a mano, NATIVO — `MotivoAjusteModal` del
// portal. El motivo es OPCIONAL a propósito (ver el comentario del portal): sin
// él la fila igual queda marcada y nadie la pisa al publicar; con él, el
// cálculo del mes que viene lo respeta.
//
// Los frenos y lo que se escribe salen del núcleo (`faltaEnMotivoDeAjuste`,
// `patchDeMotivoDeAjuste`), los mismos del portal. `manual_at`/`manual_por` no
// se mandan: los pone el trigger con la sesión. «Ya no rota» se ofrece sólo con
// alcance total, igual que en el portal y en la base.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchStockParams, updateStockParams } from '@nucleo/data/stockParams';
import { faltaEnMotivoDeAjuste, patchDeMotivoDeAjuste } from '@nucleo/utils/revisionDeSala';
import { MOTIVO_AJUSTE } from '@nucleo/constants/minmax';
import { BRANCH_A_ERP, ERP_NAMES } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion, Cargando } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { ErrorConReintento } from '../componentes/ListaPaginada';

const COLUMNAS = 'manual_motivo, manual_nota, manual_cliente_unidades, manual_cliente_dias, manual_at, manual_por';

export default function MinMaxMotivo() {
  const { producto, sala, nombre } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const todas = getScope?.('minmax') === 'ALL';
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const puede = hasPermission('minmax', 'can_edit') && (todas || Number(sala) === Number(miErp));
  const puedeYaNoRota = todas;
  const [fila, setFila] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [unidades, setUnidades] = useState('');
  const [dias, setDias] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // La carga que falló (2026-11-23): el `error` se ignoraba y la excepción
  // dejaba `{}`; el formulario salía en «Sin motivo» y «Guardar» borraba el
  // motivo real. Sin la fila leída no hay formulario.
  const [fallaCarga, setFallaCarga] = useState(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    setFallaCarga(null); // eslint-disable-line react-hooks/set-state-in-effect -- reintento
    fetchStockParams(Number(producto), Number(sala), COLUMNAS).then(({ data, error }) => {
      if (error) throw error;
      if (!data) throw new Error('No se encontró el producto en esta sucursal.');
      const d = data;
      setFila(d);
      setMotivo(d.manual_motivo ?? '');
      setNota(d.manual_nota ?? '');
      setUnidades(d.manual_cliente_unidades != null ? String(d.manual_cliente_unidades) : '');
      setDias(d.manual_cliente_dias != null ? String(d.manual_cliente_dias) : '');
    }).catch((e) => setFallaCarga(mensajeAmigable(e, 'No se pudo cargar el motivo.')));
  }, [producto, sala, intento]);

  const falta = faltaEnMotivoDeAjuste({ motivo, nota, unidades, dias });
  const opciones = [
    { id: '', label: 'Sin motivo', detalle: 'Se revisa a mano' },
    ...Object.entries(MOTIVO_AJUSTE)
      .filter(([k]) => k !== 'ya_no_rota' || puedeYaNoRota)
      .map(([k, c]) => ({ id: k, label: c.label, detalle: c.detalle })),
  ];

  const guardar = async () => {
    if (falta || ocupado || !fila) return;
    const patch = patchDeMotivoDeAjuste({ motivo, nota, unidades, dias });
    setOcupado(true);
    trabajando('Guardando el motivo…');
    const { error } = await updateStockParams(Number(producto), Number(sala), { ...patch, updated_at: new Date().toISOString() });
    setOcupado(false);
    if (error) { fallo(nombre || 'Producto', mensajeAmigable(error)); return; }
    useStaffStore.getState().appendAuditLog?.('MINMAX_MOTIVO_AJUSTE', String(producto), {
      product: nombre, sucursal_id: Number(sala),
      motivo: patch.manual_motivo, nota: patch.manual_nota,
      cliente_unidades: patch.manual_cliente_unidades, cliente_dias: patch.manual_cliente_dias, desde: 'app',
    });
    listo('Motivo guardado', `${ERP_NAMES[Number(sala)] ?? ''}`);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Motivo del ajuste' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4, marginTop: -10 }}>{`${ERP_NAMES[Number(sala)] ?? ''} · Por qué está puesto a mano`}</Text>
          {fila == null && fallaCarga ? <ErrorConReintento mensaje={fallaCarga} onReintentar={() => setIntento((n) => n + 1)} />
            : fila == null ? <Cargando /> : !puede ? (
            <>
              <Aviso tono="nota" texto={fila.manual_motivo ? `Motivo: ${MOTIVO_AJUSTE[fila.manual_motivo]?.label ?? fila.manual_motivo}${fila.manual_nota ? ` · ${fila.manual_nota}` : ''}` : 'Sin motivo.'} />
              <Aviso tono="freno" texto="Solo quien edita el Mín/Máx de esta sucursal puede poner el motivo." />
            </>
          ) : (
            <>
              <Seccion titulo="Motivo" pie={puedeYaNoRota ? undefined : '«Ya no rota» solo lo puede poner quien decide sobre todas las sucursales.'}>
                <Opciones opciones={opciones} valor={motivo} onCambiar={setMotivo} />
              </Seccion>
              {motivo === 'cliente_fijo' ? (
                <Seccion titulo="El cliente">
                  <Campo multiline={false} value={unidades} onChangeText={(v) => setUnidades(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Unidades (ej. 20)" />
                  <Campo multiline={false} value={dias} onChangeText={(v) => setDias(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Cada cuántos días (ej. 60)" />
                </Seccion>
              ) : null}
              {motivo ? (
                <Seccion titulo={motivo === 'otro' ? 'Nota' : 'Nota (opcional)'}>
                  <Campo value={nota} onChangeText={setNota} maxLength={300} placeholder="Lo que haga falta saber dentro de seis meses" />
                </Seccion>
              ) : null}
              {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
              {fila.manual_por ? (
                <Aviso tono="nota" texto={`Lo ajustó ${String(fila.manual_por).split('@')[0]}${fila.manual_at ? ` el ${fechaTexto(fila.manual_at, { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}.`} />
              ) : null}
              <BotonGrande texto={ocupado ? 'Guardando…' : 'Guardar'} color={MARCA.azul} deshabilitado={ocupado || !!falta} onPress={guardar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
