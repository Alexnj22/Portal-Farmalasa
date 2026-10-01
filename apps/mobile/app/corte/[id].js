// Un corte de caja, NATIVO: ver cuánto es y decidirlo. Lo mismo que el portal
// (`CorteDetalleModal` + `useResolverCorte`), con las mismas reglas del núcleo:
//
//   · la cifra es el TRAMO del corte (`conTramoPorSalaYDia`): lo que cambió
//     desde el anterior del día, no el acumulado;
//   · cuadra al centavo → se confirma de un toque (`seConfirmaDeUnClic`); si no,
//     el sistema pregunta antes con la cifra a la vista;
//   · descartar pide motivo; uno sin conteo lleva el suyo, que no se elige;
//   · al confirmar, si la sala sigue abierta, la caja se ENTREGA: quien recibe
//     escanea su carné (o se dice por qué no hay quien reciba);
//   · después sale el comprobante y la etiqueta de la bolsa por la caja de la
//     sala, y si la sala ya cerró su turno se ofrece cerrar el día.
//
// La bitácora la escribe la capa de datos (`resolverCorte`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchCortes, reabrirCorte, resolverCorte, salaConCajaAbierta, salaYaCerro } from '@nucleo/data/cortes';
import { cerrarElDia } from '@nucleo/data/bolsas';
import { conTramoPorSalaYDia, contraste, diferenciaDelCorte, noContoEfectivo, seConfirmaDeUnClic, severidad } from '@nucleo/utils/cortesDiagnostico';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { Grilla, Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import Identidad from '../../componentes/Identidad';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { comprobanteDelCorte, etiquetaDeLaBolsa } from '../../componentes/cortes/papel';

const MOTIVOS = ['Conteo de prueba', 'Se contó mal', 'Corte repetido'];
const MOTIVO_SIN_CONTEO = 'No se contó el efectivo';
const MOTIVOS_REABRIR = ['Se firmó por error', 'El corte se rehizo', 'Apareció la causa'];
const TONO = { ok: MARCA.verde, sobra: MARCA.ambar, falta: MARCA.rojo };
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : n < 0 ? `−${formatMoney(Math.abs(n))}` : formatMoney(0));

export default function Corte() {
  const { id, fecha: fechaParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const [corte, setCorte] = useState(undefined);
  const [modo, setModo] = useState(null);           // null | 'descartar' | 'entrega' | 'reabrir'
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [nota, setNota] = useState('');
  const [identidad, setIdentidad] = useState(null);
  const [sinEntrega, setSinEntrega] = useState(false);
  const [motivoSinEntrega, setMotivoSinEntrega] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const fecha = String(fechaParam || hoySV());
    const filas = await fetchCortes({ desde: fecha, hasta: fecha }).catch(() => null);
    const todos = conTramoPorSalaYDia(filas || []);
    setCorte(todos.find((c) => String(c.id) === String(id)) ?? null);
  }, [id, fechaParam]);
  useEffect(() => { cargar(); }, [cargar]);

  const sala = (sucursales || []).find((b) => Number(b.id) === Number(corte?.branch_id))?.name ?? '';
  const puedeResolver = hasPermission('cortes_caja', 'can_edit');
  const sinConteo = corte ? noContoEfectivo(corte) : false;
  const esZ = corte?.tipo === 'Z';
  const esX = corte?.tipo === 'X';
  const pendiente = corte?.estado === 'PENDIENTE';
  const puedeFirmar = pendiente && !esZ && !esX && puedeResolver;
  const c = useMemo(() => (corte ? contraste(corte) : null), [corte]);
  const dif = corte ? (corte.estado === 'DESCARTADO' ? diferenciaDelCorte(corte).valor : corte.tramo) : null;
  const sev = severidad(dif);

  // El cierre del día se ofrece igual que en el portal: con permiso de caja,
  // de la propia sala (o alcance todas), del día de hoy y con la caja abierta.
  const ofrecerElCierre = async () => {
    if (!hasPermission('caja_vales', 'can_edit')) return;
    if (getScope?.('caja_vales') !== 'ALL' && String(user?.branchId ?? user?.branch_id ?? '') !== String(corte.branch_id)) return;
    if (String(corte.fecha || '') !== hoySV()) return;
    if (await salaConCajaAbierta(corte.branch_id) !== true) return;
    Alert.alert(`¿Cerrar el día en ${sala}?`,
      'Se emite el cierre (Z) y la caja no vuelve a abrir hoy. No se deshace.',
      [{ text: 'Después', style: 'cancel' }, {
        text: 'Cerrar el día', style: 'destructive', onPress: async () => {
          trabajando('Cerrando el día…');
          const r = await cerrarElDia(corte.branch_id);
          if (r?.error) fallo('No se pudo cerrar el día', mensajeAmigable(r.error));
          else if (r?.aviso) fallo('Quedó algo pendiente', r.aviso);
          else listo('El día quedó cerrado', sala);
        },
      }]);
  };

  const escribir = async (estado, extra = {}) => {
    setOcupado(true);
    trabajando(estado === 'CONFIRMADO' ? 'Confirmando el corte…' : 'Descartando el corte…');
    const { error } = await resolverCorte(corte.id, estado, {
      motivo: estado === 'DESCARTADO' ? (sinConteo ? MOTIVO_SIN_CONTEO : motivo) : null,
      observaciones: nota.trim() || null, ...extra,
    }, { sucursal: sala, fecha: corte.fecha, hora: corte.hora, diferencia: corte.tramo, origen: 'app' });
    setOcupado(false);
    if (error) { fallo('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.')); return false; }
    if (estado !== 'CONFIRMADO') { listo('Corte descartado', `${sala} · ${hora12(corte.hora)}`); return true; }

    // El papel: si no sale, se dice — la firma ya quedó.
    trabajando('Mandando el comprobante a la caja…');
    const quien = user?.name || '';
    const [comp, etiq] = [await comprobanteDelCorte(corte, sala, quien), await etiquetaDeLaBolsa(corte.id, corte.branch_id, sala, quien)];
    const problemas = [!comp.ok && `El comprobante no salió: ${comp.detalle}`, !etiq.ok && `La etiqueta${etiq.folio ? ` de ${etiq.folio}` : ''} no salió: ${etiq.detalle} Imprímela desde Bolsas.`].filter(Boolean);
    if (problemas.length) fallo('Corte confirmado, pero falta el papel', problemas.join('\n\n'));
    else listo('Corte confirmado', etiq.folio ? `${sala} · pega la etiqueta en la bolsa ${etiq.folio}` : `${sala} · ${hora12(corte.hora)}`);
    return true;
  };

  const terminar = async (ok, ofrecer) => {
    if (!ok) return;
    if (ofrecer) await ofrecerElCierre();
    router.back();
  };

  const confirmar = async () => {
    const cerro = await salaYaCerro(corte.branch_id);
    if (cerro === true) { await terminar(await escribir('CONFIRMADO'), true); return; }
    setModo('entrega');   // la caja se entrega a alguien, o se dice por qué no
  };

  const alConfirmar = () => {
    if (seConfirmaDeUnClic(corte)) { confirmar(); return; }
    Alert.alert(sev === 'falta' ? `Faltan ${formatMoney(Math.abs(dif))}` : `Sobran ${formatMoney(Math.abs(dif))}`,
      'Al confirmar, la diferencia queda firmada con tu nombre.',
      [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: confirmar }]);
  };

  if (corte === undefined) return <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Corte' }} />;
  if (corte === null) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Corte' }} />
        <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 120 }}>No se encontró este corte.</Text>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: sala || 'Corte' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>

          <Vidrio radio={24}>
            <View style={{ padding: 18, gap: 12 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {`${fechaTexto(corte.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} · ${hora12(corte.hora)}`}
              </Text>
              {esZ || esX ? (
                <Pildora texto={esZ ? 'Cierre del día (Z)' : 'Lectura (X)'} color={MARCA.violeta} />
              ) : sinConteo ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 28, fontWeight: '800' }}>Sin conteo</Text>
              ) : (
                <View>
                  <Text style={{ color: TONO[sev], fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{conSigno(dif ?? 0)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{sev === 'ok' ? 'Cuadra' : sev === 'falta' ? 'Faltante' : 'Sobrante'}</Text>
                </View>
              )}
              <Pildora texto={corte.estado === 'PENDIENTE' ? 'Por confirmar' : corte.estado === 'CONFIRMADO' ? 'Confirmado' : 'Descartado'}
                color={corte.estado === 'PENDIENTE' ? MARCA.ambar : corte.estado === 'CONFIRMADO' ? MARCA.verde : MARCA.rojo} />
            </View>
          </Vidrio>

          <Grilla celdas={[
            { k: 'h', rotulo: 'Lo hizo', valor: corte.hizo?.name ?? corte.empleado_texto ?? 'Desde la caja', fila: true },
            corte.total_declarado != null && { k: 'c', rotulo: 'Se contó', valor: formatMoney(corte.total_declarado) },
            c?.esperado != null && { k: 'e', rotulo: 'Debía haber', valor: formatMoney(c.esperado) },
            corte.recibe?.name && { k: 'r', rotulo: 'Lo recibió', valor: corte.recibe.name, fila: true },
            corte.motivo_descarte && { k: 'm', rotulo: 'Por qué se descartó', valor: corte.motivo_descarte, fila: true },
            corte.observaciones && { k: 'o', rotulo: 'Nota', valor: corte.observaciones, fila: true, lineas: 4 },
          ]} />

          {c?.enDisputa && !c.porCobrosCredito ? (
            <Aviso tono="cuidado" texto="El comprobante de la caja y el sistema no dan la misma cifra. Revísalo antes de firmar." />
          ) : null}
          {corte.arrastre ? <Aviso tono="nota" texto={`Viene arrastrando ${conSigno(corte.arrastre)} de los cortes anteriores del día.`} /> : null}

          {!puedeResolver ? null : modo === 'entrega' ? (
            <Seccion titulo="Entrega de la caja">
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Quien recibe el efectivo escanea su carné. No puede ser quien hizo el corte.</Text>
              {!sinEntrega ? (
                <>
                  <Identidad identidad={identidad} onIdentidad={setIdentidad} />
                  {identidad ? (
                    <BotonGrande texto={ocupado ? 'Confirmando…' : 'Confirmar y entregar'} color={MARCA.verde} deshabilitado={ocupado}
                      onPress={async () => terminar(await escribir('CONFIRMADO', { recibidoPor: identidad.persona?.id, vale: identidad.vale }), false)} />
                  ) : (
                    <BotonGrande texto="No hay quien reciba ahora" borde color={MARCA.ambar} onPress={() => setSinEntrega(true)} />
                  )}
                </>
              ) : (
                <>
                  <Campo value={motivoSinEntrega} onChangeText={setMotivoSinEntrega} placeholder="¿Por qué no hay quien reciba? Ej.: quedó sola en la sala" />
                  <BotonGrande texto={ocupado ? 'Confirmando…' : 'Confirmar sin entregar'} color={MARCA.ambar} deshabilitado={ocupado || !motivoSinEntrega.trim()}
                    onPress={async () => terminar(await escribir('CONFIRMADO', { sinEntregaMotivo: motivoSinEntrega.trim() }), false)} />
                  <BotonGrande texto="Volver a escanear" borde onPress={() => setSinEntrega(false)} />
                </>
              )}
            </Seccion>
          ) : modo === 'descartar' ? (
            <Seccion titulo="Descartar el corte">
              {sinConteo ? <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{MOTIVO_SIN_CONTEO}</Text>
                : <Opciones opciones={MOTIVOS} valor={motivo} onCambiar={setMotivo} color={MARCA.rojo} />}
              <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional)" />
              <BotonGrande texto={ocupado ? 'Descartando…' : 'Descartar'} color={MARCA.rojo} deshabilitado={ocupado}
                onPress={async () => terminar(await escribir('DESCARTADO'), false)} />
              <BotonGrande texto="Cancelar" borde onPress={() => setModo(null)} />
            </Seccion>
          ) : modo === 'reabrir' ? (
            <Seccion titulo="Reabrir la firma">
              <Opciones opciones={MOTIVOS_REABRIR} valor={motivo} onCambiar={setMotivo} />
              <BotonGrande texto={ocupado ? 'Reabriendo…' : 'Reabrir'} color={MARCA.ambar} deshabilitado={ocupado} onPress={async () => {
                setOcupado(true); trabajando('Reabriendo el corte…');
                const { error } = await reabrirCorte(corte.id, motivo);
                setOcupado(false);
                if (error) { fallo('No se pudo reabrir', mensajeAmigable(error, 'Vuelve a intentar.')); return; }
                listo('Corte reabierto', 'Vuelve a quedar pendiente de confirmar.');
                setModo(null); cargar();
              }} />
              <BotonGrande texto="Cancelar" borde onPress={() => setModo(null)} />
            </Seccion>
          ) : puedeFirmar ? (
            <View style={{ gap: 10 }}>
              {!sinConteo ? <BotonGrande texto="Confirmar" color={MARCA.verde} deshabilitado={ocupado} onPress={alConfirmar} /> : null}
              <BotonGrande texto="Descartar" borde color={MARCA.rojo} onPress={() => { setMotivo(MOTIVOS[0]); setModo('descartar'); }} />
              {sinConteo ? <Aviso tono="nota" texto="Un corte sin conteo no se confirma: se descarta, y la sala hace uno contando el efectivo." /> : null}
            </View>
          ) : !pendiente && !esZ && !esX ? (
            <BotonGrande texto="Reabrir la firma" borde color={MARCA.ambar} onPress={() => { setMotivo(MOTIVOS_REABRIR[0]); setModo('reabrir'); }} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
