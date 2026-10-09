// La diferencia de UN corte, NATIVO — `ResolverDiferencia` + `AbonosDeDiferencia`
// del detalle del corte en el portal:
//
//   · lo que ya se hizo (cada resolución viva, con su causa, sus responsables y
//     sus abonos), con «Anular» donde el portal lo deja;
//   · los abonos: por persona o «cobrar todo»; cada abono hace el INGRESO en la
//     caja de la sala e imprime su comprobante. Si la caja no lo aceptó, queda
//     «Hacer el ingreso» para reintentarlo con la misma clave;
//   · lo que falta resolver: «Se encontró la causa» (con comprobante: número o
//     foto; puede explicar sólo una parte) o, en un faltante, «No se encontró»
//     (responsables propuestos por quién vendió en el tramo, montos que suman
//     exacto).
//
// Las escrituras y el papel son los del núcleo (`useResolverDiferencia`), con
// el aviso y la impresora del teléfono. Las cuentas, `cuentaDeResolucion`.
// Es una reposición voluntaria: nunca se descuenta del salario.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useDiasConDiferencia from '@nucleo/hooks/useDiasConDiferencia';
import useResolverDiferencia from '@nucleo/hooks/useResolverDiferencia';
import { fetchTurnoDelCorte } from '@nucleo/data/cortes';
import { cuentaDeResolucion, pendienteDe, porSigno, propuestaDeResponsables, VIA_LARGO } from '@nucleo/utils/diferenciasDeCaja';
import { repartirEnPartes, severidad } from '@nucleo/utils/cortesDiagnostico';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

const avisar = (titulo, texto, tipo) => (tipo === 'error' ? fallo(titulo, texto) : listo(titulo, texto));
const imprimirTicket = (ticket, { sala }) => imprimirEnLaSala(ticket, sala);
const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');
const centavos = (n) => Math.round(Number(n || 0) * 100);

function Pequeno({ texto, color = MARCA.azulClaro, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

/** Una resolución viva, con sus abonos si tiene responsables. */
function Hecha({ corte, d, puedeResolver, bajoMovimiento, hook, onCambio }) {
  const { anular, imprimir, abonar, anularAbono, imprimirAbonos, hacerIngreso, ocupado } = hook;
  const personas = d.personas || [];
  const abonos = d.abonos || [];
  const vivos = abonos.filter((a) => !a.anulada_at);
  const conAbonos = vivos.length > 0;
  const [montos, setMontos] = useState({});
  const [anulando, setAnulando] = useState(null);   // 'resolucion' | id de abono
  const [motivo, setMotivo] = useState('');

  const montoDe = (p) => (montos[p.persona_id] ?? String(Number(p.saldo || 0).toFixed(2)));
  const filaDe = (p, monto) => ({ persona_id: p.persona_id, monto: Number(monto), nombre: shortEmployeeName({ name: p.nombre }), saldoAntes: Number(p.saldo || 0) });
  const confirmarAbono = (filas) => {
    const total = filas.reduce((t, f) => t + f.monto, 0);
    Alert.alert('¿Registrar el abono?', `${filas.map((f) => `${f.nombre}: ${formatMoney(f.monto)}`).join('\n')}\n\nEntra ${formatMoney(total)} a la caja de la sala y sale el comprobante.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abonar', onPress: async () => { trabajando('Registrando el abono…'); if (await abonar(corte, d, filas)) { setMontos({}); onCambio(); } } },
    ]);
  };
  const abonarA = (p) => {
    const m = Number(dinero(montoDe(p)));
    if (!(m > 0)) return;
    confirmarAbono([filaDe(p, Math.min(m, Number(p.saldo || 0)))]);
  };
  const cobrarTodo = () => {
    const filas = personas.filter((p) => centavos(p.saldo) > 0).map((p) => filaDe(p, Number(p.saldo)));
    if (filas.length) confirmarAbono(filas);
  };
  const confirmarAnular = async () => {
    trabajando('Anulando…');
    const ok = anulando === 'resolucion'
      ? await anular(corte, d, motivo.trim())
      : await anularAbono(corte, abonos.find((a) => a.id === anulando), motivo.trim());
    if (ok) { setAnulando(null); setMotivo(''); onCambio(); }
  };

  return (
    <Seccion titulo={VIA_LARGO[d.via] || 'Resuelta'}>
      {d.causa ? <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{d.causa}</Text> : null}
      {d.monto != null ? <Dato primero rotulo="Cubre" valor={formatMoney(d.monto)} /> : null}
      {d.evidencia_ref ? <Dato rotulo="Comprobante" valor={d.evidencia_ref} /> : null}
      {d.evidencia_foto_url ? <Pequeno texto="Ver la foto del comprobante" onPress={() => Promise.resolve(openStoredFile(d.evidencia_foto_url)).catch(() => {})} /> : null}
      {d.asentado_at ? <Pildora texto={`Anotada en el sistema · ${d.asentado_ref || ''}`} color={MARCA.azulClaro} /> : null}
      {d.registrado_nombre ? <Dato rotulo="Lo anotó" valor={`${shortEmployeeName({ name: d.registrado_nombre })}${d.registrado_at ? ` · ${fechaHora12(d.registrado_at)}` : ''}`} /> : null}

      {d.via === 'REPONE' ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          {personas.map((p) => (
            <View key={p.persona_id} style={{ gap: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName({ name: p.nombre })}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatMoney(p.abonado)} de ${formatMoney(p.monto)}`}</Text>
              </View>
              {puedeResolver && centavos(p.saldo) > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Campo multiline={false} value={montoDe(p)} keyboardType="decimal-pad"
                      onChangeText={(v) => setMontos((m) => ({ ...m, [p.persona_id]: dinero(v) }))} style={{ textAlign: 'center' }} />
                  </View>
                  <Pequeno texto="Abonar" color={MARCA.verde} deshabilitado={ocupado} onPress={() => abonarA(p)} />
                </View>
              ) : centavos(p.saldo) <= 0 ? <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '600' }}>Pagado</Text> : null}
            </View>
          ))}
          {puedeResolver && personas.filter((p) => centavos(p.saldo) > 0).length > 1
            ? <BotonGrande texto="Cobrar todo" color={MARCA.verde} deshabilitado={ocupado} onPress={cobrarTodo} /> : null}
          {abonos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginTop: 4 }}>ABONOS</Text> : null}
          {abonos.map((a) => (
            <View key={a.id} style={{ gap: 4, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              <Text style={{ color: a.anulada_at ? colorSistema.texto2 : colorSistema.texto, fontSize: 14, textDecorationLine: a.anulada_at ? 'line-through' : 'none' }}>
                {`${formatMoney(a.monto)} · ${shortEmployeeName({ name: a.nombre })} · ${fechaHora12(a.registrado_at)}`}
              </Text>
              {a.anulada_at && a.anulada_motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Motivo: ${a.anulada_motivo}`}</Text> : null}
              {!a.anulada_at ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {a.asentado_at ? <Pildora texto={`En caja · ${a.asentado_ref}`} color={MARCA.azulClaro} />
                    : puedeResolver ? <Pequeno texto="Hacer el ingreso" deshabilitado={ocupado} onPress={async () => { trabajando('Haciendo el ingreso…'); if (await hacerIngreso(corte, a)) onCambio(); }} />
                      : <Pildora texto="No entró a la caja" color={MARCA.ambar} />}
                  {puedeResolver ? <Pequeno texto="Imprimir" deshabilitado={ocupado} onPress={() => {
                    const p = personas.find((x) => String(x.persona_id) === String(a.persona_id));
                    imprimirAbonos(corte, [{ id: a.id, nombre: shortEmployeeName({ name: a.nombre }), monto: Number(a.monto), saldo: Number(p?.saldo || 0) }], a.registrado_at);
                  }} /> : null}
                  {puedeResolver && !a.asentado_at ? <Pequeno texto="Anular" color={MARCA.rojo} onPress={() => { setAnulando(a.id); setMotivo(''); }} /> : null}
                </View>
              ) : null}
            </View>
          ))}
          <Aviso texto="Es una reposición voluntaria: nunca se descuenta del salario. Cada abono entra a la caja de la sala y el siguiente corte ya lo cuenta." />
        </View>
      ) : null}

      {puedeResolver ? (
        anulando ? (
          <View style={{ gap: 8, marginTop: 6 }}>
            <Campo value={motivo} onChangeText={setMotivo} placeholder={anulando === 'resolucion' ? 'Por qué se anula (obligatorio)' : 'Por qué se anula el abono (obligatorio)'} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Volver" borde onPress={() => setAnulando(null)} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="Anular" color={MARCA.rojo} deshabilitado={ocupado || !motivo.trim()} onPress={confirmarAnular} /></View>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {d.via === 'RETIRA' ? <Pequeno texto="Imprimir comprobante" deshabilitado={ocupado}
              onPress={() => imprimir(corte, d, personas.map((p) => ({ nombre: p.nombre, monto: p.monto })))} /> : null}
            {!d.asentado_at && !conAbonos && !bajoMovimiento ? <Pequeno texto="Anular" color={MARCA.rojo} onPress={() => { setAnulando('resolucion'); setMotivo(''); }} /> : null}
            {bajoMovimiento ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Para anular esta causa, primero anula la resolución del resto.</Text> : null}
          </View>
        )
      ) : null}
    </Seccion>
  );
}

export default function DiferenciaCorte() {
  const { sala, fecha, signo = 'falta', corte: corteId } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeResolver = hasPermission('cortes_caja_resolver');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = useMemo(() => Object.fromEntries((sucursales || []).map((b) => [b.id, b.name])), [sucursales]);
  const { dias, cargando, recargar } = useDiasConDiferencia({ activo: true, hasta: hoySV() });
  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));
  const hook = useResolverDiferencia({ nombreSala, origen: 'app', avisar, imprimirTicket });
  const { resolver, ocupado } = hook;

  const corte = useMemo(() => {
    const dia = porSigno(dias, signo).find((d) => String(d.branch_id) === String(sala) && d.fecha === fecha);
    return (dia?.cortes || []).find((c) => String(c.id) === String(corteId)) || null;
  }, [dias, signo, sala, fecha, corteId]);

  const clave = `app_corte_dif_${corteId}`;
  const [borrador] = useState(() => loadDraft(clave));
  const [abriendo, setAbriendo] = useState(() => !!borrador?.via);
  const [via, setVia] = useState(() => borrador?.via || null);
  const [causa, setCausa] = useState(() => borrador?.causa || '');
  const [montoCausa, setMontoCausa] = useState(() => borrador?.montoCausa || '');
  const [evidenciaRef, setEvidenciaRef] = useState(() => borrador?.evidenciaRef || '');
  const [fotos, setFotos] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [marcadas, setMarcadas] = useState([]);
  const [montos, setMontos] = useState({});

  useEffect(() => {
    if (abriendo && (via || causa.trim() || evidenciaRef.trim() || String(montoCausa).trim())) saveDraft(clave, { via, causa, montoCausa, evidenciaRef });
  }, [clave, abriendo, via, causa, montoCausa, evidenciaRef]);

  const tramo = Number(corte?.tramo ?? 0);
  const falta = tramo < 0;
  const vivas = (corte?.diferencias || []).filter((d) => d && d.via && !d.anulada_at);
  const pendiente = corte ? pendienteDe(corte) : 0;
  const parcial = vivas.length > 0 && pendiente > 0;
  const hayMovimiento = vivas.some((d) => d.via !== 'JUSTIFICA');

  // Los candidatos y la propuesta: al elegir «No se encontró».
  useEffect(() => {
    if (!abriendo || via !== 'REPONE' || !corte?.id) return undefined;
    let vivo = true;
    fetchTurnoDelCorte(corte.id).then((filas) => {
      if (!vivo) return;
      setCandidatos(filas || []);
      const ids = propuestaDeResponsables(filas, user?.id ?? null);
      const partes = repartirEnPartes(pendiente, ids.length);
      setMarcadas(ids);
      setMontos(Object.fromEntries(ids.map((id, i) => [id, String(partes[i])])));
    });
    return () => { vivo = false; };
  }, [abriendo, via, corte?.id, user?.id, pendiente]);

  const alternar = (id) => {
    const ids = marcadas.includes(id) ? marcadas.filter((x) => x !== id) : [...marcadas, id];
    const partes = repartirEnPartes(pendiente, ids.length);
    setMarcadas(ids);
    setMontos(Object.fromEntries(ids.map((x, i) => [x, String(partes[i])])));
  };
  const cuenta = cuentaDeResolucion({
    via, pendiente, montoCausa, causa, evidenciaRef, conFoto: fotos.length > 0,
    aportes: marcadas.map((id) => montos[id] ?? 0),
  });
  const cerrar = () => { clearDraft(clave); setAbriendo(false); setVia(null); setCausa(''); setEvidenciaRef(''); setFotos([]); setMontoCausa(''); };

  const guardar = () => Alert.alert(via === 'REPONE' ? '¿Asignar responsables?' : '¿Guardar la causa?',
    via === 'REPONE'
      ? `${marcadas.map((id) => `${shortEmployeeName(candidatos.find((c) => c.id === id) || {})}: ${formatMoney(montos[id])}`).join('\n')}\n\nCada uno queda con su saldo; después se abona.`
      : `Explica ${formatMoney(cuenta.montoExplica)} del ${falta ? 'faltante' : 'sobrante'}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        trabajando('Guardando…');
        let evidenciaFoto = null;
        if (via === 'JUSTIFICA' && fotos.length) {
          try { [evidenciaFoto] = await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `cortes/${corte.branch_id ?? 'sin-sala'}/${user?.id ?? 'anon'}` }); }
          catch (e) { fallo('No se pudo subir la foto', e?.message ?? ''); return; }
        }
        const personas = via === 'REPONE' ? marcadas.map((id) => ({ employee_id: id, monto: Number(montos[id] ?? 0), del_turno: !!candidatos.find((c) => c.id === id)?.del_turno })) : [];
        const nombres = personas.map((p) => ({ nombre: candidatos.find((c) => c.id === p.employee_id)?.name || '', monto: p.monto }));
        const r = await resolver(corte, {
          via, causa: causa.trim(), montoVisto: tramo, monto: via === 'JUSTIFICA' ? cuenta.montoExplica : pendiente,
          personas, nombres, evidenciaRef: via === 'JUSTIFICA' ? evidenciaRef.trim() : null, evidenciaFoto,
        });
        if (r) { cerrar(); recargar(); }
      } },
    ]);

  const sev = severidad(tramo);
  const puedeAbrir = corte && pendiente > 0 && sev !== 'ok' && puedeResolver && corte.estado !== 'DESCARTADO';

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: corte ? `Corte de las ${hora12(corte.hora)}` : 'Diferencia' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {!corte ? (cargando ? <ActivityIndicator style={{ marginTop: 40 }} /> : <Aviso texto="Este corte ya no tiene diferencia en esta vista." />) : (
            <>
              <View style={{ gap: 4, marginHorizontal: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`${nombreSala[corte.branch_id] ?? ''} · ${fecha}${corte.empleado_texto ? ` · ${corte.empleado_texto}` : ''}`}</Text>
                <Text style={{ color: falta ? MARCA.rojo : MARCA.ambar, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {`${falta ? '−' : '+'}${formatMoney(Math.abs(tramo))}`}
                </Text>
                {pendiente > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin resolver: ${formatMoney(pendiente)}`}</Text> : <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>Resuelto</Text>}
              </View>

              {vivas.map((d) => (
                <Hecha key={d.id} corte={corte} d={d} puedeResolver={puedeResolver} hook={hook}
                  bajoMovimiento={d.via === 'JUSTIFICA' && hayMovimiento} onCambio={recargar} />
              ))}
              {parcial ? <Aviso texto={falta ? `${formatMoney(pendiente)} siguen sin causa: se explican con otro comprobante o se asignan responsables.` : `${formatMoney(pendiente)} siguen sin causa y quedan en el acumulado de la sala.`} /> : null}

              {puedeAbrir && !abriendo ? (
                <BotonGrande texto={falta ? (parcial ? `Resolver lo que queda: ${formatMoney(pendiente)}` : `Resolver el faltante de ${formatMoney(pendiente)}`) : (parcial ? 'Explicar otra parte' : 'Tiene causa: explicarlo')}
                  onPress={() => { if (!falta) setVia('JUSTIFICA'); setAbriendo(true); }} />
              ) : null}

              {puedeAbrir && abriendo ? (
                <>
                  {falta ? (
                    <Seccion titulo="Qué se hizo">
                      <Opciones opciones={[{ id: 'JUSTIFICA', label: 'Se encontró la causa' }, { id: 'REPONE', label: 'No se encontró', detalle: 'Se asignan responsables y después abonan' }]} valor={via} onCambiar={setVia} />
                    </Seccion>
                  ) : null}
                  {via ? (
                    <Seccion titulo={via === 'JUSTIFICA' ? 'Qué pasó' : 'Qué se revisó'}>
                      <Campo value={causa} onChangeText={setCausa}
                        placeholder={via === 'JUSTIFICA' ? (falta ? 'Ej.: se cobró en efectivo una venta que se registró con tarjeta' : 'De dónde salió el dinero de más') : 'Qué se revisó antes de asignar'} />
                    </Seccion>
                  ) : null}
                  {via === 'JUSTIFICA' ? (
                    <Seccion titulo="El comprobante" pie="El número del documento que se corrigió o una foto: uno de los dos.">
                      <Campo multiline={false} value={montoCausa} onChangeText={(v) => setMontoCausa(dinero(v))} keyboardType="decimal-pad"
                        placeholder={`Cuánto explica (vacío = ${formatMoney(pendiente)})`} />
                      {cuenta.explicaInvalido ? <Aviso tono="freno" texto="Tiene que ser mayor que cero." /> : null}
                      {cuenta.quedaTrasCausa > 0 ? <Aviso texto={`Quedan ${formatMoney(cuenta.quedaTrasCausa)} por resolver después.`} /> : null}
                      <Campo multiline={false} value={evidenciaRef} onChangeText={setEvidenciaRef} placeholder="Ingreso, vale, factura o recibo" autoCapitalize="characters" />
                      <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
                    </Seccion>
                  ) : null}
                  {via === 'REPONE' ? (
                    <Seccion titulo="Responsables" pie={cuenta.restan === 0 ? 'Suma exacto.' : `${cuenta.restan > 0 ? 'Faltan' : 'Sobran'} ${formatMoney(Math.abs(cuenta.restan) / 100)} para llegar a ${formatMoney(pendiente)}.`}>
                      {candidatos.length === 0 ? <ActivityIndicator /> : candidatos.map((c) => {
                        const marcada = marcadas.includes(c.id);
                        return (
                          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
                            <Pressable onPress={() => alternar(c.id)} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, opacity: pressed ? 0.55 : 1 })}>
                              <Text style={{ color: marcada ? MARCA.verde : colorSistema.texto2, fontSize: 20 }}>{marcada ? '☑' : '☐'}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{shortEmployeeName(c)}</Text>
                                {Number(c.ventas) > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`vendió ${c.ventas} en el tramo`}</Text> : null}
                              </View>
                            </Pressable>
                            {marcada ? (
                              <View style={{ minWidth: 110 }}>
                                <Campo multiline={false} value={montos[c.id] ?? ''} keyboardType="decimal-pad"
                                  onChangeText={(v) => setMontos((m) => ({ ...m, [c.id]: dinero(v) }))} style={{ textAlign: 'center' }} />
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </Seccion>
                  ) : null}
                  {via === 'REPONE' ? <Aviso texto="Al guardar, cada responsable queda con su saldo. Después se abona por persona o todo junto, en uno o varios días; cada abono imprime su comprobante." /> : null}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><BotonGrande texto="Volver" borde onPress={cerrar} /></View>
                    <View style={{ flex: 1 }}><BotonGrande texto={via === 'REPONE' ? 'Asignar' : 'Guardar'} color={MARCA.verde} deshabilitado={ocupado || cuenta.faltaGuardar} onPress={guardar} /></View>
                  </View>
                </>
              ) : null}
              {!puedeResolver ? <Aviso texto="Resolver diferencias es de quien tiene el permiso de resolver cortes." /> : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
