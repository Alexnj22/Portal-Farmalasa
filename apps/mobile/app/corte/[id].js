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
//
// ── Y se LEE como en el portal ─────────────────────────────────────────────
// La cifra se explica paso a paso: lo que debía haber, los cobros de crédito
// en efectivo que el comprobante no cuenta, lo que se contó y lo acumulado del
// día. El cierre (Z) dice lo vendido por forma de pago y lo que entró en
// efectivo —no es un conteo—; la lectura (X) dice que no cuenta dinero. Abajo,
// quién firmó (con su cara y la hora), los cobros de crédito uno por uno con su
// hora y «Qué revisar» (`sugerenciasDeCorte`). Todo sale del núcleo
// (`cortesDiagnostico`), las mismas funciones del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchAbonosDelDia, fetchCortes, fetchMovimientos, fetchPersonas, fetchVentasPorPago, reabrirCorte, resolverCorte, salaConCajaAbierta, salaYaCerro } from '@nucleo/data/cortes';
import { cerrarElDia } from '@nucleo/data/bolsas';
import {
  cobrosDeCredito, conTramoPorSalaYDia, desgloseDelCierre, diferenciaDelCorte, entroEnEfectivo, formasFueraDelComprobante,
  noContoEfectivo, notaDeCifra, seConfirmaDeUnClic, severidad, sugerenciasDeCorte,
} from '@nucleo/utils/cortesDiagnostico';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
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
  const [ventas, setVentas] = useState(null);
  const [abonos, setAbonos] = useState(null);
  const [movs, setMovs] = useState([]);
  const [firmo, setFirmo] = useState(null);

  const cargar = useCallback(async () => {
    const fecha = String(fechaParam || hoySV());
    const filas = await fetchCortes({ desde: fecha, hasta: fecha }).catch(() => null);
    const todos = conTramoPorSalaYDia(filas || []);
    setCorte(todos.find((c) => String(c.id) === String(id)) ?? null);
  }, [id, fechaParam]);
  useEffect(() => { cargar(); }, [cargar]);

  // Lo que explica la cifra: las ventas por forma de pago, los cobros de
  // crédito del día y los movimientos de la caja. Van aparte del corte —el
  // corte se pinta sin ellos— y nunca cambian el número, sólo lo explican.
  const branchId = corte?.branch_id ?? null;
  const fechaCorte = corte?.fecha ?? null;
  const resueltoPor = corte?.resuelto_por ?? null;
  useEffect(() => {
    if (branchId == null || !fechaCorte) return undefined;
    let vivo = true;
    Promise.all([
      fetchVentasPorPago({ desde: fechaCorte, hasta: fechaCorte }).catch(() => null),
      fetchAbonosDelDia({ branchId, fecha: fechaCorte }).catch(() => null),
      Promise.resolve(fetchMovimientos({ branchId, fecha: fechaCorte })).catch(() => []),
    ]).then(([v, a, m]) => {
      if (!vivo) return;
      setVentas((v || []).filter((x) => String(x.branch_id) === String(branchId)));
      setAbonos(a);
      setMovs(m || []);
    });
    return () => { vivo = false; };
  }, [branchId, fechaCorte]);
  useEffect(() => {
    if (!resueltoPor) { setFirmo(null); return undefined; }
    let vivo = true;
    fetchPersonas([resueltoPor]).then((f) => { if (vivo) setFirmo(f?.[0] || null); }).catch(() => {});
    return () => { vivo = false; };
  }, [resueltoPor]);

  const sala = (sucursales || []).find((b) => Number(b.id) === Number(corte?.branch_id))?.name ?? '';
  const puedeResolver = hasPermission('cortes_caja', 'can_edit');
  const sinConteo = corte ? noContoEfectivo(corte) : false;
  const esZ = corte?.tipo === 'Z';
  const esX = corte?.tipo === 'X';
  const pendiente = corte?.estado === 'PENDIENTE';
  const puedeFirmar = pendiente && !esZ && !esX && puedeResolver;
  const descartado = corte?.estado === 'DESCARTADO';
  const propia = useMemo(() => (corte ? diferenciaDelCorte(corte) : null), [corte]);
  const dif = corte ? (descartado ? propia?.valor ?? null : corte.tramo) : null;
  const esperado = descartado ? propia?.esperado : (corte?.esperadoUsado ?? corte?.esperado);
  const sev = severidad(dif);
  const noEsConteo = esZ || esX || sinConteo;
  const invisibles = useMemo(() => formasFueraDelComprobante(ventas), [ventas]);
  const cobros = useMemo(() => (corte ? cobrosDeCredito(corte, abonos?.filas || []) : null), [corte, abonos]);
  const sugerencias = useMemo(() => (corte ? sugerenciasDeCorte(corte, movs, invisibles, cobros) : []), [corte, movs, invisibles, cobros]);
  const explicacion = useMemo(() => (corte ? notaDeCifra(corte) : null), [corte]);
  const cierre = useMemo(() => (corte ? desgloseDelCierre(corte, ventas) : null), [corte, ventas]);

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

          <Vidrio radio={24} tinte={!noEsConteo && !descartado && sev !== 'ok' ? (sev === 'falta' ? 'rgba(240,68,56,0.10)' : 'rgba(247,144,9,0.10)') : undefined}>
            <View style={{ padding: 18, gap: 10 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {`${fechaTexto(corte.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} · ${hora12(corte.hora)}`}
              </Text>
              <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                {corte.hizo?.name ? shortEmployeeName({ name: corte.hizo.name }) : (corte.empleado_texto || 'Se hizo desde la caja')}
                {corte.recibe?.name ? <Text style={{ color: MARCA.verde, fontWeight: '700' }}>{`  →  ${shortEmployeeName({ name: corte.recibe.name })}`}</Text> : null}
              </Text>
              {esZ || esX ? (
                <Pildora texto={esZ ? 'Cierre del día (Z)' : 'Lectura (X)'} color={MARCA.violeta} />
              ) : sinConteo ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 28, fontWeight: '800' }}>Sin conteo</Text>
              ) : (
                <View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                    {descartado ? 'Diferencia que tenía este conteo' : corte.tramo === corte.acumulado ? 'Diferencia de este corte' : 'Diferencia desde el corte anterior'}
                  </Text>
                  <Text style={{ color: descartado ? colorSistema.texto2 : TONO[sev], fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'],
                    textDecorationLine: descartado ? 'line-through' : 'none' }}>{conSigno(dif ?? 0)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{sev === 'ok' ? 'Cuadra' : sev === 'falta' ? 'Faltante' : 'Sobrante'}</Text>
                </View>
              )}
              <Pildora texto={corte.estado === 'PENDIENTE' ? 'Por confirmar' : corte.estado === 'CONFIRMADO' ? 'Confirmado' : 'Descartado'}
                color={corte.estado === 'PENDIENTE' ? MARCA.ambar : corte.estado === 'CONFIRMADO' ? MARCA.verde : MARCA.rojo} />
            </View>
          </Vidrio>

          {descartado ? <Aviso tono="nota" texto="Este conteo se descartó: no cuenta para el día ni para los cortes que siguen." /> : null}

          {/* El cierre NO es un conteo de caja: su monto es todo lo vendido, con
              la tarjeta y el crédito adentro. Las formas se pintan como vengan. */}
          {esZ && cierre ? (
            <Seccion titulo="Se vendió en el día" pie="La tarjeta y el crédito no pasan por la caja: la tarjeta se cobra por el POS y el crédito entra cuando el cliente paga, como cobro de crédito. Los cortes del día sólo cuentan el efectivo.">
              <Dato primero rotulo="Total" valor={formatMoney(cierre.total)} fuerte />
              {cierre.formas.map((f) => <Dato key={f.tipo} rotulo={String(f.tipo).charAt(0).toUpperCase() + String(f.tipo).slice(1)} valor={formatMoney(f.total)} />)}
              <Dato rotulo="Entró en efectivo" valor={formatMoney(cierre.efectivo)} fuerte />
            </Seccion>
          ) : esX ? (
            <Aviso texto="Esto es una lectura, no un corte: sólo imprime las ventas del turno. No cuenta el efectivo, así que no tiene diferencia ni hay nada que confirmar." />
          ) : sinConteo ? (
            <Aviso tono="cuidado" texto="Este corte quedó con $0.00 de efectivo contado y aun así se dio por exacto, así que no hay diferencia que firmar. Lo que corresponde es descartarlo y volver a hacerlo contando." />
          ) : (
            <Seccion titulo="La cuenta">
              <Dato primero rotulo="Debía haber en caja" valor={formatMoney(esperado)} />
              {cobros?.sinContar > 0.005 ? (
                <>
                  <Dato rotulo="   Ventas y movimientos del día" valor={formatMoney(corte.tk_total_caja)} />
                  <Dato rotulo="   Cobros de crédito en efectivo" valor={`+${formatMoney(cobros.sinContar)}`} />
                </>
              ) : null}
              <Dato rotulo="Se contó" valor={formatMoney(corte.total_declarado)} fuerte />
              {corte.tramo !== corte.acumulado ? <Dato rotulo="Acumulado hasta esta hora" valor={conSigno(corte.acumulado ?? 0)} /> : null}
            </Seccion>
          )}

          {explicacion && !esZ ? (
            explicacion.alerta
              ? <Aviso tono="freno" texto={`${explicacion.titulo}. ${explicacion.detalle}`} />
              : <Aviso texto={`${explicacion.titulo}. ${explicacion.detalle}`} />
          ) : null}
          {sev === 'ok' && pendiente && !noEsConteo ? <Aviso tono="nota" texto="Este corte cuadra al centavo. No hay nada que investigar." /> : null}

          {/* Quién firmó: nombre, cara y hora. Nunca un id suelto. */}
          {!pendiente ? (
            <Vidrio radio={20}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                <Avatar empleado={firmo ?? { name: '?' }} tamano={42} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pildora texto={corte.estado === 'CONFIRMADO' ? 'Confirmado' : 'Descartado'} color={corte.estado === 'CONFIRMADO' ? MARCA.verde : colorSistema.texto2} />
                    {corte.resuelto_at ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fechaHora12(corte.resuelto_at)}</Text> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{firmo?.name ? shortEmployeeName(firmo) : 'Sin registrar quién'}</Text>
                  {corte.motivo_descarte || corte.observaciones ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[corte.motivo_descarte, corte.observaciones].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                </View>
              </View>
            </Vidrio>
          ) : corte.observaciones ? <Aviso texto={`Nota: ${corte.observaciones}`} /> : null}

          {!esZ && invisibles.length ? (
            <Aviso texto={`Este día se cobraron ${invisibles.map((f) => `${formatMoney(Math.abs(f.total))} por ${f.tipo}`).join(' y ')}. Ese dinero no pasa por la caja, así que no entra en la cuenta del día.`} />
          ) : null}

          {/* Los cobros de crédito con su hora: el comprobante los imprime como
              un solo número del día, y desde el portal la hora es un dato. */}
          {!noEsConteo && cobros && (cobros.cobros > 0 || cobros.antes.length > 0 || cobros.despues.length > 0) ? (
            <Seccion titulo={`Cobros de crédito · ${formatMoney(cobros.antes.length ? cobros.hasta : (cobros.cobros ?? 0))}`}>
              {abonos && !abonos.pude ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No puedes ver el detalle de estos cobros. El total ya está sumado.</Text>
              ) : !cobros.antes.length && !cobros.despues.length ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Ninguno se cobró desde el portal, así que no se sabe a qué hora entró cada uno.</Text>
              ) : (
                <>
                  {cobros.antes.map((a, i) => (
                    <View key={a.id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{hora12(a.hora)}</Text>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{a.cliente}</Text>
                      {!entroEnEfectivo(a) ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{a.forma}</Text> : null}
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(a.monto)}</Text>
                    </View>
                  ))}
                  {cobros.despues.length ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${cobros.despues.length} cobro${cobros.despues.length === 1 ? '' : 's'} después de este corte: los cuenta el siguiente.`}</Text>
                  ) : null}
                </>
              )}
            </Seccion>
          ) : null}

          {sugerencias.length ? (
            <Seccion titulo="Qué revisar">
              {sugerencias.map((x, i) => (
                <View key={`${i}-${x.titulo}`} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}2E` }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '800' }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.titulo}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{x.detalle}</Text>
                  </View>
                </View>
              ))}
            </Seccion>
          ) : null}

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
