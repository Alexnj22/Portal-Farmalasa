// La pestaña Confirmación de Metas, NATIVA — `TabConfirmacion` del portal: el
// ciclo del mes siguiente (el supervisor ajusta ±1% y confirma, el gerente
// aprueba o devuelve con nota), más el mes en curso si quedó alguna sin
// oficializar. Mismas funciones de datos y mismas reglas del núcleo
// (`montoAjustadoDeMeta`, ±10 pasos).
//
// Quien NO puede aprobar pero sí editar ve «Registrar autorización del
// gerente»: el camino para cuando el gerente aprueba de palabra —una o todas
// las del mes de golpe—. Queda asentado quién autorizó y a esa persona le
// llega el aviso. Cada tarjeta lleva su historial: quién la movió y cuánto
// (`cambioDeMeta`, núcleo, el mismo del portal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  aprobarMeta, aprobarMetaPorAutorizacion, aprobarMetasLote, aprobarMetasPorAutorizacionLote, confirmarMeta, confirmarMetasLote, devolverMeta,
  fetchAutorizadores, fetchMetasCambios, fetchMetasRows, generarPropuestas,
} from '@nucleo/data/metas';
import {
  ESTADO_DE_META, PASOS_MAX_META, baseDeMeta, cambioDeMeta, cambiosPorMeta, diaHoySV, montoAjustadoDeMeta, ymHoySV, ymLabel, ymSumar,
} from '@nucleo/utils/metasUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';

const DIA_PROPUESTA = 28;

function Paso({ texto, onPress, desactivado }) {
  return (
    <Pressable onPress={onPress} disabled={desactivado} hitSlop={6}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: desactivado ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

function Boton({ texto, color = MARCA.azul, borde, onPress, desactivado }) {
  return (
    <Pressable onPress={onPress} disabled={desactivado}
      style={({ pressed }) => ({ flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.4 : 0, borderColor: color, opacity: desactivado ? 0.4 : pressed ? 0.8 : 1 })}>
      <Text style={{ color: borde ? color : '#fff', fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function Confirmacion({ salaNombre, canEdit, canApprove, onCambio }) {
  const ymActual = ymHoySV();
  const ymSig = ymSumar(ymActual, 1);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [ajustes, setAjustes] = useState({});
  const [autorizadores, setAutorizadores] = useState([]);
  const [ocupado, setOcupado] = useState(null);
  // meta_id → sus cambios. `null` = no se pudo leer: distinto de «sin cambios».
  const [cambios, setCambios] = useState({});
  const empleados = useStaffStore((st) => st.employees);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [e.id, e])), [empleados]);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchMetasRows([ymActual, ymSig]);
      setRows(r); setAjustes({}); setError(null);
      // El historial va después y aparte: si falla, la pantalla sigue sirviendo para confirmar.
      fetchMetasCambios(r.map((x) => x.id)).then((l) => setCambios(cambiosPorMeta(l))).catch(() => setCambios(null));
    }
    catch (e) { setError(mensajeAmigable(e, 'Error al cargar el flujo')); setRows([]); }
  }, [ymActual, ymSig]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { fetchAutorizadores().then(setAutorizadores).catch(() => {}); }, []);

  const montoDe = useCallback((r) => montoAjustadoDeMeta(r, ajustes[r.id] ?? 0), [ajustes]);
  const recup = (r) => Number(r.monto_recuperacion || 0);
  const confirmable = (r) => canEdit && ['propuesta', 'devuelta'].includes(r.estado) && montoDe(r) > 0;

  const accion = async (clave, fn, titulo, cuerpo) => {
    setOcupado(clave);
    try { await fn(); listo(titulo, cuerpo); onCambio?.(); await cargar(); }
    catch (e) { fallo('No se pudo', mensajeAmigable(e)); }
    finally { setOcupado(null); }
  };

  // Elegir quién autorizó y cómo: la hoja del sistema y un aviso con texto.
  const pedirAutorizacion = (al) => {
    if (!autorizadores.length) { fallo('Sin autorizadores', 'No se pudo leer la lista de quién puede autorizar.'); return; }
    ActionSheetIOS.showActionSheetWithOptions(
      { title: '¿Quién autorizó?', options: [...autorizadores.map((a) => a.name), 'Cancelar'], cancelButtonIndex: autorizadores.length },
      (i) => {
        if (i >= autorizadores.length) return;
        const quien = autorizadores[i];
        Alert.prompt('¿Cómo lo autorizó?', 'Ej. lo aprobó por teléfono el 4 de agosto', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Dejar oficial', onPress: (nota) => { if (nota?.trim()) al(quien, nota.trim()); } },
        ], 'plain-text');
      },
    );
  };

  const grupos = useMemo(() => {
    if (!rows) return [];
    const actual = rows.filter((r) => r.year_month === ymActual && r.estado !== 'oficial');
    const sig = rows.filter((r) => r.year_month === ymSig);
    const g = [];
    if (actual.length) g.push({ ym: ymActual, filas: actual, titulo: `${ymLabel(ymActual)} · sin oficializar` });
    if (sig.length || diaHoySV() >= DIA_PROPUESTA) g.push({ ym: ymSig, filas: sig, titulo: ymLabel(ymSig) });
    return g;
  }, [rows, ymActual, ymSig]);

  if (rows == null) return <ActivityIndicator style={{ marginTop: 24 }} />;

  return (
    <View style={{ gap: 12 }}>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!grupos.length ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 20, marginHorizontal: 24 }}>
          {`Nada por confirmar. Las propuestas de ${ymLabel(ymSig)} se arman a partir del día ${DIA_PROPUESTA}.`}
        </Text>
      ) : null}
      {grupos.map((g) => {
        const porConfirmar = g.filas.filter(confirmable);
        const porAprobar = g.filas.filter((r) => r.estado === 'confirmada_supervisor');
        const totConf = porConfirmar.reduce((s, r) => s + montoDe(r) + recup(r), 0);
        const totApr = porAprobar.reduce((s, r) => s + Number(r.monto_meta || 0), 0);
        return (
          <View key={g.ym} style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>{g.titulo}</Text>
            {!g.filas.length && canEdit ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={ocupado === 'generar' ? 'Generando…' : `Generar las propuestas de ${ymLabel(g.ym)}`} deshabilitado={ocupado != null}
                  onPress={() => accion('generar', async () => { const n = await generarPropuestas({ mes: g.ym }); if (!n) throw new Error('No había nada que proponer'); },
                    'Propuestas listas', 'Cada sala tiene su propuesta para ajustar y confirmar.')} />
              </View>
            ) : null}
            {g.filas.map((r) => {
              const pasos = ajustes[r.id] ?? 0;
              const ajustable = ['propuesta', 'devuelta'].includes(r.estado) ? canEdit : r.estado === 'confirmada_supervisor' && (canApprove || canEdit);
              const monto = montoDe(r);
              const est = ESTADO_DE_META[r.estado] ?? { label: r.estado, variante: 'neutral' };
              const mover = (d) => { Haptics.selectionAsync().catch(() => {}); setAjustes((a) => ({ ...a, [r.id]: Math.max(-PASOS_MAX_META, Math.min(PASOS_MAX_META, (a[r.id] ?? 0) + d)) })); };
              const sala = salaNombre(r.branch_id);
              const ctx = { sala, mes: r.year_month, desde: 'app' };
              return (
                <View key={r.id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18}>
                    <View style={{ padding: 14, gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{sala}</Text>
                        <Pildora texto={est.label} color={colorDeVariante(est.variante)} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {ajustable ? <Paso texto="−" onPress={() => mover(-1)} desactivado={pasos <= -PASOS_MAX_META} /> : null}
                        <View style={{ flex: 1, alignItems: 'center' }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(monto + recup(r))}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                            {[pasos ? `${pasos > 0 ? '+' : ''}${pasos}% sobre ${formatMoney(baseDeMeta(r))}` : `propuesta ${formatMoney(baseDeMeta(r))}`,
                              recup(r) ? `+ ${formatMoney(recup(r))} de gastos` : null].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        {ajustable ? <Paso texto="+" onPress={() => mover(1)} desactivado={pasos >= PASOS_MAX_META} /> : null}
                      </View>
                      {r.estado === 'devuelta' && r.nota_devolucion ? <Aviso tono="cuidado" texto={`Devuelta: ${r.nota_devolucion}`} /> : null}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {confirmable(r) ? (
                          <Boton texto={ocupado === r.id ? 'Confirmando…' : 'Confirmar'} desactivado={ocupado != null}
                            onPress={() => accion(r.id, () => confirmarMeta({ id: r.id, monto }, ctx), 'Meta confirmada', `${sala} · ${formatMoney(monto)}. Al confirmar todas, le llega al gerente.`)} />
                        ) : null}
                        {canApprove && r.estado === 'confirmada_supervisor' ? (
                          <>
                            <Boton texto={ocupado === r.id ? 'Aprobando…' : 'Aprobar'} color={MARCA.verde} desactivado={ocupado != null}
                              onPress={() => accion(r.id, () => aprobarMeta({ id: r.id, monto: pasos !== 0 ? monto : null }, { ...ctx, monto: monto + recup(r), ajustado: pasos !== 0 ? `${pasos}%` : undefined }),
                                'Meta aprobada', `${sala} quedó oficial.`)} />
                            <Boton texto="Devolver" color={MARCA.rojo} borde desactivado={ocupado != null}
                              onPress={() => Alert.prompt('¿Por qué se devuelve?', 'Ej. la meta quedó baja para la temporada', [
                                { text: 'Cancelar', style: 'cancel' },
                                { text: 'Devolver', style: 'destructive', onPress: (nota) => { if (nota?.trim()) accion(r.id, () => devolverMeta({ id: r.id, nota: nota.trim() }, ctx), 'Meta devuelta', `${sala} vuelve al supervisor.`); } },
                              ], 'plain-text')} />
                          </>
                        ) : null}
                        {!canApprove && canEdit && r.estado === 'confirmada_supervisor' ? (
                          <Boton texto="Registrar autorización del gerente" borde desactivado={ocupado != null}
                            onPress={() => pedirAutorizacion((quien, nota) => accion(r.id,
                              () => aprobarMetaPorAutorizacion({ id: r.id, autorizoPor: quien.id, nota, monto: pasos !== 0 ? monto : null }, { ...ctx, monto: monto + recup(r), autorizo: quien.name }),
                              'Meta oficial', 'Quedó registrada con la autorización, y a quien autorizó le llegó el aviso.'))} />
                        ) : null}
                      </View>
                      {r.estado === 'oficial' && r.autorizado_por ? (
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {`Autorizó ${(() => { const a = autorizadores.find((x) => x.id === r.autorizado_por); return a ? shortEmployeeName(a) : 'la gerencia'; })()}${r.autorizado_nota ? ` — ${r.autorizado_nota}` : ''}`}
                        </Text>
                      ) : null}
                      {cambios === null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>No se pudo cargar quién cambió esta meta.</Text>
                        : (cambios[r.id] || []).some((c) => c.actor) ? (
                          <View style={{ gap: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Cambios</Text>
                            {(cambios[r.id] || []).map((cb) => {
                              const c = cambioDeMeta(cb);
                              const emp = cb.actor ? porId.get(cb.actor) : null;
                              return (
                                <View key={cb.id} style={{ gap: 1 }}>
                                  <Text style={{ color: colorSistema.texto, fontSize: 13 }}>
                                    {`${cb.actor ? (emp ? shortEmployeeName(emp) : 'Alguien') : 'El sistema'} ${c.texto}${c.despues != null ? ` ${formatMoney(c.despues)}` : ''}`}
                                  </Text>
                                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                                    {`${c.mov ? `${c.mov > 0 ? 'subió' : 'bajó'} ${formatMoney(Math.abs(c.mov))} (${formatPct(c.pct)}) · ` : ''}${fechaHora12(cb.created_at)}`}
                                  </Text>
                                  {cb.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`«${cb.nota}»`}</Text> : null}
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {porConfirmar.length >= 2 ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={ocupado === `c${g.ym}` ? 'Confirmando…' : `Confirmar las ${porConfirmar.length} · ${formatMoney(totConf)}`} deshabilitado={ocupado != null}
                  onPress={() => Alert.alert('Confirmar todas', `${porConfirmar.length} salas por ${formatMoney(totConf)}. Al confirmar todas, le llega al gerente.`, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Confirmar', onPress: () => accion(`c${g.ym}`, () => confirmarMetasLote(porConfirmar.map((r) => ({ id: r.id, monto: montoDe(r) })),
                      { mes: g.ym, total: totConf, salas: porConfirmar.map((r) => `${salaNombre(r.branch_id)}=${montoDe(r)}`).join(', '), desde: 'app' }),
                      'Metas confirmadas', `${porConfirmar.length} salas · ${formatMoney(totConf)}.`) },
                  ])} />
              </View>
            ) : null}
            {!canApprove && canEdit && porAprobar.length >= 2 ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={ocupado === `la${g.ym}` ? 'Registrando…' : `Registrar la autorización de las ${porAprobar.length}`} borde color={MARCA.verde} deshabilitado={ocupado != null}
                  onPress={() => pedirAutorizacion((quien, nota) => Alert.alert('Dejar oficiales todas',
                    `Las ${porAprobar.length} metas (${formatMoney(totApr)}) quedan oficiales de golpe. Queda asentado que las ejecutaste tú con autorización de ${shortEmployeeName(quien)}, y le llega el aviso.`, [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Dejar oficiales', onPress: () => accion(`la${g.ym}`, () => aprobarMetasPorAutorizacionLote({ ids: porAprobar.map((r) => r.id), autorizoPor: quien.id, nota },
                        { mes: g.ym, cuantas: porAprobar.length, total: totApr, salas: porAprobar.map((r) => salaNombre(r.branch_id)).join(', '), autorizo: quien.name, desde: 'app' }),
                        'Metas oficiales', `${porAprobar.length} salas quedaron registradas con esa autorización, y a quien autorizó le llegó el aviso.`) },
                    ]))} />
              </View>
            ) : null}
            {canApprove && porAprobar.length >= 2 ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={ocupado === `a${g.ym}` ? 'Aprobando…' : `Aprobar las ${porAprobar.length} · ${formatMoney(totApr)}`} color={MARCA.verde} deshabilitado={ocupado != null}
                  onPress={() => Alert.alert('Aprobar todas', `${porAprobar.length} salas quedan oficiales.`, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Aprobar', onPress: () => accion(`a${g.ym}`, () => aprobarMetasLote(porAprobar.map((r) => r.id),
                      { mes: g.ym, cuantas: porAprobar.length, total: totApr, salas: porAprobar.map((r) => salaNombre(r.branch_id)).join(', '), desde: 'app' }),
                      'Metas aprobadas', `${porAprobar.length} salas quedaron oficiales.`) },
                  ])} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
