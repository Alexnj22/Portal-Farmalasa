// El seguro de vida colectivo, NATIVO — el `SeguroDeVidaColectivo` del portal
// (Personal › la franja del seguro). Tres bloques en el orden en que se usan:
//   1. el pago del periodo vigente (el único que cambia cada año), con el
//      listado de la aseguradora;
//   2. las personas: solventes, sin cubrir y a quién le falta el certificado;
//   3. la póliza, que se carga una vez;
// y debajo los pagos de años anteriores con su comprobante.
//
// Mismos datos y mismo guardado que el portal (`@nucleo/data/seguroDeVida`):
// la póliza por `guardarPoliza`, el pago con su listado por `registrarPago`
// (la función de la base que mete el pago y el listado juntos o ninguno).
// Mismo permiso para editar: `staff_list` o `staff_detail` con edición.
//
// El listado se PROPONE, no se aplica solo — igual que el portal: se sube el
// documento, la lectura saca los nombres, se cruzan con las fichas
// (`cruzarConElPadron`) y quien mira confirma cada uno. Alguien marcado
// «solvente» por un error de lectura queda sin seguro sin que nadie lo note.
//
// La póliza y el pago a medio registrar guardan borrador (las mismas claves
// del portal): la sesión de sala se cierra sola a los pocos minutos.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPoliza, fetchPagos, guardarPoliza, subirArchivoDelSeguro, registrarPago } from '@nucleo/data/seguroDeVida';
import { primaPorPersona, periodoVigente, rotuloDelPeriodo, estadoEnElSeguro } from '@nucleo/utils/seguroDeVida';
import { cruzarConElPadron } from '@nucleo/data/documentosCompartidos';
import { analizarDocumento } from '@nucleo/data/ia';
import { getStoragePathFromUrl, openStoredFile } from '@nucleo/utils/storageFiles';
import { soloPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import { CampoConRotulo, CampoFecha, Elegir } from '../componentes/personas/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { elegirOrigen, leerComoArchivo } from '../componentes/sucursal/elegirArchivo';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dinero = (n) => formatMoney(n === '' ? null : n);
const tieneCertificado = (e) => (e.employee_documents || []).some((d) => d?.category === 'CERTIFICADO_SEGURO_VIDA' && d?.url);
const abrir = (url) => Promise.resolve(openStoredFile(url)).catch(() => fallo('No se pudo abrir', 'Intenta de nuevo.'));

function Enlace({ texto, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Vidrio radio={16}>
        <View style={{ padding: 10, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }} numberOfLines={1}>{rotulo}</Text>
          <Text style={{ color: color || colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
        </View>
      </Vidrio>
    </View>
  );
}

export default function SeguroDeVida() {
  const { hasPermission } = useAuth();
  const puedeEditar = !!hasPermission?.('staff_list', 'can_edit') || !!hasPermission?.('staff_detail', 'can_edit');
  const employees = useStaffStore((s) => s.employees);
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const activos = useMemo(() => soloPersonalEnPlanilla((employees || []).filter((e) => e.status === 'ACTIVO'))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))), [employees]);

  const [poliza, setPoliza] = useState(null);
  const [pagos, setPagos] = useState(null);   // null = cargando
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const cargar = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(useCallback(() => {
    let vivo = true;
    Promise.all([fetchPoliza(), fetchPagos()])
      .then(([p, g]) => { if (vivo) { setError(null); setPoliza(p); setPagos(g); } })
      .catch((e) => { if (vivo) { setError(mensajeAmigable(e) || 'No se pudo cargar el seguro.'); setPagos([]); } });
    return () => { vivo = false; };
  }, [version])); // eslint-disable-line react-hooks/exhaustive-deps

  const mes = poliza?.mes_de_pago || 11;
  const vigente = periodoVigente(new Date(), mes);
  const pagoVigente = (pagos || []).find((p) => p.anio === vigente) || null;
  const prima = primaPorPersona(poliza);
  const [registrando, setRegistrando] = useState(null);   // null o el año
  const solventes = activos.filter((e) => estadoEnElSeguro(e.id, pagoVigente).clave === 'solvente').length;
  const sinCertificado = activos.filter((e) => !tieneCertificado(e)).length;
  const anteriores = (pagos || []).filter((p) => p.anio !== vigente);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Seguro de vida', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
            {poliza ? `${poliza.aseguradora} · se paga cada ${MESES[mes - 1]}` : pagos === null ? 'Cargando…' : 'Sin póliza registrada'}
          </Text>
          {error ? <Aviso tono="freno" texto={error} /> : null}

          {pagos === null ? null : registrando !== null ? (
            <RegistrarPago anio={registrando} pagoExistente={(pagos || []).find((p) => p.anio === registrando) || null}
              prima={prima} activos={activos} onCancelar={() => setRegistrando(null)}
              onGuardado={(r) => {
                appendAuditLog?.('SEGURO_VIDA_PAGO', String(registrando), { cubiertos: r?.cubiertos });
                listo('Pago registrado', `${r?.cubiertos ?? 0} personas en el listado de ${registrando}.`);
                setRegistrando(null);
                cargar();
              }} />
          ) : (
            <>
              {/* 1. El pago del periodo vigente */}
              <Seccion titulo={`Pago ${vigente}`} pie={`Cubre ${rotuloDelPeriodo(vigente, mes)}`}>
                {pagoVigente ? (
                  <>
                    <Dato primero rotulo="Pagado el" valor={fechaNumerica(pagoVigente.fecha_pago, { vacio: '—' })} />
                    <Dato rotulo="Monto" valor={dinero(pagoVigente.monto_total)} />
                    <Dato rotulo="Por persona" valor={dinero(pagoVigente.prima_por_persona)} />
                    <Dato rotulo="En el listado" valor={`${(pagoVigente.cubiertos || []).length}`} />
                    {pagoVigente.comprobante_url ? <Enlace texto="Ver el listado de la aseguradora" onPress={() => abrir(pagoVigente.comprobante_url)} /> : null}
                  </>
                ) : (
                  <Aviso tono="cuidado" texto={`Todavía no se registró el pago de ${vigente}. Cuando llegue el listado de la aseguradora, súbelo y la app deja a cada persona como solvente.${prima != null ? ` Estimado: ${activos.length} personas × ${dinero(prima)} = ${dinero(prima * activos.length)}.` : ''}`} />
                )}
                {puedeEditar ? (
                  <BotonGrande texto={pagoVigente ? 'Corregir listado' : `Registrar pago ${vigente}`} borde={!!pagoVigente} color={MARCA.azulClaro}
                    onPress={() => setRegistrando(vigente)} />
                ) : null}
              </Seccion>

              {/* 2. Las personas */}
              <View style={{ gap: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Personas</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Cifra rotulo="Solventes" valor={`${solventes}/${activos.length}`} color={pagoVigente && solventes === activos.length ? MARCA.verde : MARCA.ambar} />
                  <Cifra rotulo="Sin cubrir" valor={pagoVigente ? String(activos.length - solventes) : '—'} color={pagoVigente && activos.length - solventes > 0 ? MARCA.rojo : undefined} />
                  <Cifra rotulo="Certificados" valor={`${activos.length - sinCertificado}/${activos.length}`} color={sinCertificado ? MARCA.ambar : MARCA.verde} />
                </View>
                {sinCertificado > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 16 }}>«Sin certificado»: le falta el certificado de asegurado en su expediente.</Text> : null}
                <Vidrio radio={20}>
                  <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
                    {activos.map((e, i) => {
                      const est = estadoEnElSeguro(e.id, pagoVigente);
                      return (
                        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                          <Avatar empleado={e} tamano={30} />
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(e)}</Text>
                          {pagoVigente ? <Pildora texto={est.clave === 'solvente' ? 'Solvente' : 'No cubierto'} color={colorDeVariante(est.variant)} /> : null}
                          {!tieneCertificado(e) ? <Pildora texto="Sin certificado" color={MARCA.ambar} /> : null}
                        </View>
                      );
                    })}
                  </View>
                </Vidrio>
              </View>

              {/* 3. La póliza */}
              <Poliza poliza={poliza} puedeEditar={puedeEditar}
                onGuardada={(p) => {
                  setPoliza(p);
                  appendAuditLog?.('SEGURO_VIDA_POLIZA', String(p.id), { suma: p.suma_asegurada, tasa: p.tasa_por_millar });
                  listo('Póliza guardada', '');
                }} />

              {/* Los años anteriores */}
              {anteriores.length ? (
                <Seccion titulo="Pagos anteriores">
                  {anteriores.map((p, i) => (
                    <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{p.anio}</Text>
                      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${dinero(p.monto_total)} · ${(p.cubiertos || []).length} personas`}</Text>
                      {p.comprobante_url ? <Enlace texto="Ver" onPress={() => abrir(p.comprobante_url)} /> : null}
                      {puedeEditar ? <Enlace texto="Corregir" onPress={() => setRegistrando(p.anio)} /> : null}
                    </View>
                  ))}
                </Seccion>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/* ── La póliza: se carga una vez ─────────────────────────────────────────── */
const BORRADOR_POLIZA = 'seguro-vida-poliza';
function Poliza({ poliza, puedeEditar, onGuardada }) {
  const [f, setF] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const base = poliza ? { ...poliza } : { aseguradora: 'MAPFRE', suma_asegurada: 5000, tasa_por_millar: 6.5 };
    const borrador = loadDraft(BORRADOR_POLIZA);
    setF(borrador && borrador.id === base.id ? { ...base, ...borrador } : base);
  }, [poliza]);
  if (!f) return null;
  const set = (k, v) => setF((prev) => { const n = { ...prev, [k]: v }; saveDraft(BORRADOR_POLIZA, n); return n; });
  const calculada = primaPorPersona({ ...f, prima_por_persona: null });
  const sumaMala = !(Number(f.suma_asegurada) > 0);
  const tasaMala = !(Number(f.tasa_por_millar) > 0);
  const decimal = (t) => String(t).replace(/[^0-9.]/g, '');

  const subir = async () => {
    const origen = await elegirOrigen();
    if (!origen) return;
    setOcupado(true);
    trabajando('Subiendo la póliza…');
    try {
      const archivo = await leerComoArchivo(origen, 'poliza');
      if (!archivo) return;
      const url = await subirArchivoDelSeguro(archivo, 'poliza');
      setF((prev) => ({ ...prev, documento_url: url, documento_nombre: origen.nombre }));
      listo('Documento subido', 'Guarda la póliza para que quede.');
    } catch (e) { fallo('No se pudo subir', mensajeAmigable(e) || ''); }
    finally { setOcupado(false); }
  };
  const guardar = async () => {
    setOcupado(true);
    trabajando('Guardando…');
    try { onGuardada(await guardarPoliza(f)); clearDraft(BORRADOR_POLIZA); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e) || e?.message || ''); }
    finally { setOcupado(false); }
  };

  return (
    <Seccion titulo="La póliza" pie="El documento general — es el mismo cada año. La suma asegurada es igual para todos.">
      <CampoConRotulo rotulo="Aseguradora" value={f.aseguradora || ''} editable={puedeEditar} onChangeText={(t) => set('aseguradora', t)} />
      <CampoConRotulo rotulo="Número de póliza" value={f.numero_poliza || ''} editable={puedeEditar} placeholder="Opcional" onChangeText={(t) => set('numero_poliza', t)} />
      <CampoConRotulo rotulo="Suma asegurada por persona ($)" value={String(f.suma_asegurada ?? '')} editable={puedeEditar} keyboardType="decimal-pad"
        error={sumaMala ? 'Mayor a 0' : null} onChangeText={(t) => set('suma_asegurada', decimal(t))} />
      <CampoConRotulo rotulo="Tasa (por millar, anual)" value={String(f.tasa_por_millar ?? '')} editable={puedeEditar} keyboardType="decimal-pad"
        error={tasaMala ? 'Mayor a 0' : null} onChangeText={(t) => set('tasa_por_millar', decimal(t))} />
      <CampoConRotulo rotulo="Prima por persona ($) · vacío = suma × tasa" value={String(f.prima_por_persona ?? '')} editable={puedeEditar} keyboardType="decimal-pad"
        placeholder={calculada != null ? `${calculada.toFixed(2)} (calculada)` : ''} onChangeText={(t) => set('prima_por_persona', decimal(t))} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{f.documento_url ? (f.documento_nombre || 'Documento de la póliza') : 'Sin documento de la póliza'}</Text>
        {f.documento_url ? <Enlace texto="Ver" onPress={() => abrir(f.documento_url)} /> : null}
        {puedeEditar ? <Enlace texto={f.documento_url ? 'Reemplazar' : 'Subir'} onPress={subir} /> : null}
      </View>
      {puedeEditar ? <BotonGrande texto="Guardar póliza" onPress={guardar} deshabilitado={ocupado || sumaMala || tasaMala} /> : null}
    </Seccion>
  );
}

/* ── Registrar el pago de un año con su listado ─────────────────────────── */
function RegistrarPago({ anio, pagoExistente, prima, activos, onCancelar, onGuardado }) {
  const claveBorrador = `seguro-vida-pago-${anio}`;
  const [borrador] = useState(() => loadDraft(claveBorrador));
  const [filas, setFilas] = useState(() => borrador?.filas || (pagoExistente?.cubiertos || []).map((c) => ({
    clave: c.employee_id || c.nombre_en_documento, nombre: c.nombre_en_documento, employee_id: c.employee_id,
  })));
  const [comprobante, setComprobante] = useState(() => borrador?.comprobante || { url: pagoExistente?.comprobante_url || null, nombre: pagoExistente?.comprobante_nombre || null });
  const [fecha, setFecha] = useState(() => borrador?.fecha ?? (pagoExistente?.fecha_pago || ''));
  const [monto, setMonto] = useState(() => String(borrador?.monto ?? (pagoExistente?.monto_total ?? '')));
  const [primaPago, setPrimaPago] = useState(() => String(borrador?.primaPago ?? (pagoExistente?.prima_por_persona ?? (prima ?? ''))));
  useEffect(() => { saveDraft(claveBorrador, { filas, comprobante, fecha, monto, primaPago }); },
    [claveBorrador, filas, comprobante, fecha, monto, primaPago]);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const porId = useMemo(() => new Map(activos.map((e) => [e.id, e])), [activos]);
  const tomados = new Set(filas.map((f) => f.employee_id).filter(Boolean));
  const faltan = activos.filter((e) => !tomados.has(e.id));
  const conFicha = filas.filter((f) => f.employee_id).length;
  const estimado = filas.length && primaPago !== '' && Number.isFinite(Number(primaPago)) ? Number(primaPago) * filas.length : null;
  const decimal = (t) => String(t).replace(/[^0-9.]/g, '');

  const leerListado = async () => {
    const origen = await elegirOrigen();
    if (!origen) return;
    setLeyendo(true); setAviso(null);
    trabajando('Leyendo el listado…');
    try {
      const archivo = await leerComoArchivo(origen, `listado-${anio}`);
      if (!archivo) return;
      const url = await subirArchivoDelSeguro(archivo, `pago-${anio}`);
      setComprobante({ url, nombre: origen.nombre });
      const stored = getStoragePathFromUrl(url);
      const { data, error } = await analizarDocumento({ filePath: stored.path, bucketName: stored.bucket, buscarPersonas: true });
      const nombres = !error && data?.success && Array.isArray(data.aiData?.personas) ? data.aiData.personas.filter((n) => String(n || '').trim()) : [];
      if (!nombres.length) { setAviso('No se pudo leer el listado del documento. Marca a las personas a mano.'); listo('Listado subido', ''); return; }
      const cruce = cruzarConElPadron(nombres, activos);
      setFilas(cruce.map((c) => ({ clave: c.nombre, nombre: c.nombre, employee_id: c.empleado?.id || null, posible: c.posible || null, ambiguo: c.ambiguo })));
      const sin = cruce.filter((c) => !c.empleado).length;
      setAviso(`Se leyeron ${nombres.length} nombres${sin ? `; ${sin} sin ficha reconocida — revísalos` : ', todos con ficha'}.`);
      listo('Listado leído', '');
    } catch (e) {
      fallo('No se pudo subir el listado', mensajeAmigable(e) || '');
    } finally { setLeyendo(false); }
  };

  const elegir = (clave, id) => setFilas((prev) => prev.map((f) => (f.clave === clave ? { ...f, employee_id: id || null, posible: null } : f)));
  const quitar = (clave) => setFilas((prev) => prev.filter((f) => f.clave !== clave));
  const agregar = (id) => {
    const e = porId.get(id);
    if (e) setFilas((prev) => [...prev, { clave: id, nombre: e.name, employee_id: id }]);
  };

  const guardar = async () => {
    setGuardando(true);
    trabajando('Guardando el pago…');
    try {
      const r = await registrarPago({
        anio,
        fecha_pago: fecha || null,
        monto_total: monto === '' ? (estimado ?? null) : Number(monto),
        prima_por_persona: primaPago === '' ? null : Number(primaPago),
        comprobante_url: comprobante.url, comprobante_nombre: comprobante.nombre,
        cubiertos: filas.map((f) => ({ employee_id: f.employee_id || null, nombre: f.nombre })),
      });
      clearDraft(claveBorrador);
      onGuardado(r);
    } catch (e) {
      fallo('No se pudo guardar el pago', mensajeAmigable(e) || e?.message || '');
    } finally { setGuardando(false); }
  };
  const cancelar = () => Alert.alert('¿Descartar lo de este pago?', 'Se pierde el listado revisado.', [
    { text: 'Seguir', style: 'cancel' },
    { text: 'Descartar', style: 'destructive', onPress: () => { clearDraft(claveBorrador); onCancelar(); } },
  ]);

  return (
    <>
      <Seccion titulo={`${pagoExistente ? 'Corregir' : 'Registrar'} el pago ${anio}`}
        pie="Sube el documento con el listado que envía la aseguradora: se leen los nombres y se cruzan con las fichas. Revisa la lista antes de guardar — quien quede afuera no aparece como solvente.">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{comprobante.url ? (comprobante.nombre || 'Listado de la aseguradora') : 'Sin listado'}</Text>
          {comprobante.url ? <Enlace texto="Ver" onPress={() => abrir(comprobante.url)} /> : null}
          <Enlace texto={leyendo ? 'Leyendo…' : comprobante.url ? 'Reemplazar' : 'Subir'} onPress={leyendo ? undefined : leerListado} />
        </View>
        {aviso ? <Aviso texto={aviso} /> : null}
        <CampoFecha rotulo="Fecha de pago" valor={fecha} onCambiar={setFecha} />
        <CampoConRotulo rotulo="Prima por persona ($)" value={primaPago} keyboardType="decimal-pad" onChangeText={(t) => setPrimaPago(decimal(t))} />
        <CampoConRotulo rotulo="Monto total pagado ($)" value={monto} keyboardType="decimal-pad" onChangeText={(t) => setMonto(decimal(t))}
          placeholder={estimado != null ? `${estimado.toFixed(2)} (estimado)` : ''} />
      </Seccion>

      <Seccion titulo={`${filas.length} en el listado · ${conFicha} con ficha`}>
        {!filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Todavía nadie en el listado.</Text> : null}
        {filas.map((f, i) => {
          const e = f.employee_id ? porId.get(f.employee_id) : null;
          const opciones = activos.filter((x) => x.id === f.employee_id || !tomados.has(x.id)).map((x) => ({ id: x.id, label: x.name }));
          return (
            <View key={f.clave} style={{ gap: 8, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{f.nombre}</Text>
                  <Text style={{ color: e ? MARCA.verde : MARCA.ambar, fontSize: 12 }}>{e ? `Ficha: ${shortEmployeeName(e)}` : 'Sin ficha — elige a quién corresponde, o déjalo así'}</Text>
                </View>
                {f.ambiguo ? <Pildora texto="Hay dos iguales" color={MARCA.ambar} /> : null}
                <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => quitar(f.clave)} />
              </View>
              {!e ? (
                <>
                  {f.posible && !tomados.has(f.posible.id) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{`¿Es ${shortEmployeeName(f.posible)}?`}</Text>
                      <Enlace texto="Sí" onPress={() => elegir(f.clave, f.posible.id)} />
                    </View>
                  ) : null}
                  <Elegir rotulo="Su ficha" valor="" opciones={opciones} onCambiar={(id) => elegir(f.clave, id)} vacio="Sin ficha" />
                </>
              ) : null}
            </View>
          );
        })}
        {faltan.length ? (
          <Elegir rotulo={`Agregar a alguien que no salió en la lectura (${faltan.length} sin listar)`} valor="" opciones={faltan.map((x) => ({ id: x.id, label: x.name }))} onCambiar={(id) => id && agregar(id)} />
        ) : null}
      </Seccion>

      <BotonGrande texto={guardando ? 'Guardando…' : `Guardar pago ${anio}`} onPress={guardar} deshabilitado={guardando || leyendo || !filas.length} />
      <BotonGrande texto="Cancelar" borde color={MARCA.rojo} onPress={cancelar} deshabilitado={guardando} />
    </>
  );
}
