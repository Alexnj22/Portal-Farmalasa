// Finalizar el efectivo, NATIVO — `DepositoAlBanco` del circuito de bolsas:
// lo contado y sin cerrar se REPARTE en hasta tres partes, que pueden convivir
// el mismo día:
//
//     contado + lo que entró de afuera
//       − al banco    (exige banco; quién lo lleva es opcional)
//       − en mano     (exige a quién, y sólo administración)
//       = remanente   (siempre del Gerente General, lo resuelve el servidor)
//
// El total no se escribe: sale de las bolsas confirmadas y el servidor lo
// vuelve a sumar al cerrar. Los topes y lo que falta salen del núcleo
// (`repartoDelDeposito`, `faltasDelDeposito`), la misma regla del portal. El
// aviso al Gerente General lo emite la base dentro de la misma transacción.
//
// Mueve dinero y no se deshace desde acá (anular un depósito es otro acto, en
// `depositos-banco`), así que pide una confirmación que dice el reparto entero.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBancos, fetchPersonasDeAdministracion, fetchPorDepositar, registrarDeposito } from '@nucleo/data/bolsas';
import { contadoDeBolsas, faltasDelDeposito, repartoDelDeposito } from '@nucleo/utils/depositoDeEfectivo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const BORRADOR = 'app-finalizar-efectivo';
const VACIO = { monto: '', montoEfectivo: '', banco: '', entregadoA: '', aporte: '', aporteNota: '', llevadoPor: '', nota: '', ultimo: 'banco' };
const limpio = (v) => v.replace(/[^\d.,]/g, '');

function FilaMonto({ rotulo, valor, onCambiar, pie }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
        <View style={{ width: 150 }}>
          <Campo multiline={false} value={valor} onChangeText={(v) => onCambiar(limpio(v))}
            keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} />
        </View>
      </View>
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{pie}</Text> : null}
    </View>
  );
}

export default function FinalizarEfectivo() {
  const { hasPermission } = useAuth();
  const puedeContar = hasPermission('bolsas_conteo', 'can_edit');
  const empleados = useStaffStore((s) => s.employees);
  const [bolsas, setBolsas] = useState(null);
  const [bancos, setBancos] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [f, setF] = useState(() => ({ ...VACIO, ...(loadDraft(BORRADOR) || {}) }));
  const [buscar, setBuscar] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([fetchPorDepositar(), fetchBancos(), fetchPersonasDeAdministracion()])
      .then(([b, k, a]) => { if (!vivo) return; setBolsas(b || []); setBancos(k || []); setAdmins(a || []); })
      .catch(() => { if (vivo) setBolsas([]); });
    return () => { vivo = false; };
  }, []);

  const cambiar = (campo, valor, extra = {}) => setF((x) => {
    const nuevo = { ...x, [campo]: valor, ...extra };
    saveDraft(BORRADOR, nuevo);
    return nuevo;
  });

  const contado = useMemo(() => contadoDeBolsas(bolsas), [bolsas]);
  const r = repartoDelDeposito({ contado, aporte: f.aporte, escritoBanco: f.monto, escritoEfectivo: f.montoEfectivo, ultimo: f.ultimo });
  const { faltaNota, faltaBanco, faltaQuien } = faltasDelDeposito({ ...r, banco: f.banco, entregadoA: f.entregadoA, aporteNota: f.aporteNota });
  const nada = r.nMonto <= 0 && r.nEfectivo <= 0;
  const falta = !bolsas?.length ? 'No hay efectivo contado y sin cerrar.'
    : nada ? 'Escribe cuánto va al banco o cuánto se entrega en mano.'
      : faltaBanco ? 'Falta elegir el banco.' : faltaQuien ? 'Falta elegir a quién se le entrega el efectivo.'
        : faltaNota ? 'Falta decir de dónde vino lo que entró de afuera.' : r.noAlcanza ? 'Lo repartido pasa lo que hay.' : null;

  const gente = useMemo(() => [...(empleados || [])]
    .filter((p) => !buscar.trim() || tokenMatch(buscar, p.name))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    .slice(0, 8), [empleados, buscar]);
  const llevador = (empleados || []).find((p) => String(p.id) === String(f.llevadoPor));
  const bancoElegido = bancos.find((b) => String(b.id) === String(f.banco));
  const adminElegido = admins.find((p) => String(p.id) === String(f.entregadoA));

  const cerrar = () => {
    const partes = [
      r.nMonto > 0 ? `${formatMoney(r.nMonto)} al banco (${bancoElegido?.nombre ?? ''})` : null,
      r.nEfectivo > 0 ? `${formatMoney(r.nEfectivo)} en mano a ${adminElegido ? shortEmployeeName(adminElegido) : ''}` : null,
      r.remanente > 0 ? `${formatMoney(r.remanente)} de remanente` : null,
    ].filter(Boolean);
    Alert.alert('¿Finalizar el efectivo?',
      `${bolsas.length} ${bolsas.length === 1 ? 'bolsa' : 'bolsas'} · ${formatMoney(r.disponible)}\n\n${partes.join('\n')}\n\nSe le avisa al Gerente General.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Finalizar', onPress: async () => {
          setGuardando(true);
          trabajando('Cerrando el efectivo…');
          const { data, error } = await Promise.resolve(registrarDeposito({
            bolsaIds: bolsas.map((b) => b.id),
            monto: r.nMonto, montoEfectivo: r.nEfectivo,
            bancoId: f.banco ? Number(f.banco) : null,
            aporte: r.nAporte, aporteNota: f.aporteNota.trim() || null,
            nota: f.nota.trim() || null,
            llevadoPor: r.nMonto > 0 ? (f.llevadoPor || null) : null,
            entregadoA: f.entregadoA || null,
          })).catch((e) => ({ error: e }));
          setGuardando(false);
          if (error) { fallo('No se pudo cerrar el efectivo', mensajeAmigable(error, 'Vuelve a intentar en un momento.')); return; }
          clearDraft(BORRADOR);
          listo('Efectivo cerrado', [
            data?.folio,
            Number(data?.monto_deposito) > 0 ? `${formatMoney(data.monto_deposito)} al banco` : null,
            Number(data?.monto_efectivo) > 0 ? `${formatMoney(data.monto_efectivo)} en mano` : null,
          ].filter(Boolean).join(' · '));
          router.back();
        } },
      ]);
  };

  if (!puedeContar) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Finalizar el efectivo' }} />
      <View style={{ padding: 20 }}><Aviso tono="freno" texto="Finalizar el efectivo es de quien cuenta las bolsas." /></View></>);
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Finalizar el efectivo' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {bolsas == null ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
            <>
              <Seccion titulo="Contado y sin cerrar" pie="Lo que no salga al banco ni en mano queda como remanente del Gerente General.">
                <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(contado)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`en ${bolsas.length} ${bolsas.length === 1 ? 'bolsa contada' : 'bolsas contadas'}`}</Text>
                {bolsas.slice(0, 12).map((b, i) => (
                  <Dato key={b.id} primero={!i} rotulo={b.folio || `Bolsa ${b.id}`} valor={formatMoney(b.contado)} />
                ))}
              </Seccion>

              <Seccion titulo="Lo que entró de afuera (opcional)" pie="Un vale, el cambio de moneda que faltó: suma a lo que se puede repartir.">
                <FilaMonto rotulo="Entró" valor={f.aporte} onCambiar={(v) => cambiar('aporte', v)} />
                {r.nAporte > 0 ? <Campo value={f.aporteNota} onChangeText={(v) => cambiar('aporteNota', v)} placeholder="De dónde vino (obligatorio)" /> : null}
              </Seccion>

              <Seccion titulo="El reparto">
                <FilaMonto rotulo="Al banco" valor={r.bancoRecortado ? r.nMonto.toFixed(2) : f.monto}
                  onCambiar={(v) => cambiar('monto', v, { ultimo: 'banco' })}
                  pie={r.bancoRecortado ? `Escribiste ${formatMoney(r.escritoBanco)} y alcanza hasta ${formatMoney(r.topeBanco)}.` : r.topeBanco > 0 ? `Hasta ${formatMoney(r.topeBanco)}.` : null} />
                <FilaMonto rotulo="En mano" valor={r.efectivoRecortado ? r.nEfectivo.toFixed(2) : f.montoEfectivo}
                  onCambiar={(v) => cambiar('montoEfectivo', v, { ultimo: 'efectivo' })}
                  pie={r.efectivoRecortado ? `Escribiste ${formatMoney(r.escritoEfectivo)} y alcanza hasta ${formatMoney(r.topeEfectivo)}.` : r.topeEfectivo > 0 ? `Hasta ${formatMoney(r.topeEfectivo)}.` : null} />
                <Dato rotulo="Remanente" valor={formatMoney(r.remanente)} fuerte />
              </Seccion>

              {r.nMonto > 0 ? (
                <Seccion titulo="Banco">
                  <Opciones opciones={bancos.map((b) => ({ id: String(b.id), label: b.nombre }))} valor={f.banco} onCambiar={(v) => cambiar('banco', v)} />
                </Seccion>
              ) : null}
              {r.nMonto > 0 ? (
                <Seccion titulo="Quién lo lleva al banco (opcional)">
                  {llevador ? <Dato primero rotulo="Lo lleva" valor={shortEmployeeName(llevador)} /> : null}
                  <Campo multiline={false} value={buscar} onChangeText={setBuscar} placeholder="Buscar persona" autoCapitalize="words" />
                  <Opciones opciones={gente.map((p) => ({ id: String(p.id), label: shortEmployeeName(p) }))} valor={String(f.llevadoPor)}
                    onCambiar={(v) => cambiar('llevadoPor', v === String(f.llevadoPor) ? '' : v)} />
                </Seccion>
              ) : null}
              {r.nEfectivo > 0 ? (
                <Seccion titulo="A quién se le entrega en mano" pie="Sólo administración.">
                  <Opciones opciones={admins.map((p) => ({ id: String(p.id), label: shortEmployeeName(p), detalle: p.cargo }))}
                    valor={String(f.entregadoA)} onCambiar={(v) => cambiar('entregadoA', v)} />
                </Seccion>
              ) : null}

              <Seccion titulo="Nota (opcional)">
                <Campo value={f.nota} onChangeText={(v) => cambiar('nota', v)} placeholder="Algo que deba quedar escrito" />
              </Seccion>

              {falta ? <Aviso tono={r.noAlcanza ? 'freno' : 'cuidado'} texto={falta} /> : null}
              <BotonGrande texto={guardando ? 'Cerrando…' : 'Finalizar el efectivo'} color={MARCA.verde} deshabilitado={guardando || !!falta} onPress={cerrar} />
              <BotonGrande texto="Ver depósitos" borde onPress={() => router.push('/depositos-banco')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
