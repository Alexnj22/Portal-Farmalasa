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
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
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
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

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

  useEffect(() => {
    fetchStockParams(Number(producto), Number(sala), COLUMNAS).then(({ data }) => {
      const d = data ?? {};
      setFila(d);
      setMotivo(d.manual_motivo ?? '');
      setNota(d.manual_nota ?? '');
      setUnidades(d.manual_cliente_unidades != null ? String(d.manual_cliente_unidades) : '');
      setDias(d.manual_cliente_dias != null ? String(d.manual_cliente_dias) : '');
    }).catch(() => setFila({}));
  }, [producto, sala]);

  const falta = faltaEnMotivoDeAjuste({ motivo, nota, unidades, dias });
  const opciones = [
    { id: '', label: 'Sin motivo', detalle: 'Se revisa a mano' },
    ...Object.entries(MOTIVO_AJUSTE)
      .filter(([k]) => k !== 'ya_no_rota' || puedeYaNoRota)
      .map(([k, c]) => ({ id: k, label: c.label, detalle: c.detalle })),
  ];

  const guardar = async () => {
    if (falta || ocupado) return;
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
          {fila == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : !puede ? (
            <>
              <Aviso tono="nota" texto={fila.manual_motivo ? `Motivo: ${MOTIVO_AJUSTE[fila.manual_motivo]?.label ?? fila.manual_motivo}${fila.manual_nota ? ` · ${fila.manual_nota}` : ''}` : 'Sin motivo declarado.'} />
              <Aviso tono="freno" texto="Poner el motivo es de quien edita el MIN·MAX de esta sala." />
            </>
          ) : (
            <>
              <Seccion titulo="Motivo" pie={puedeYaNoRota ? undefined : '«Ya no rota» lo pone quien decide sobre todas las salas: es el que hace que el cálculo deje de contar lo que este producto vendió antes.'}>
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
