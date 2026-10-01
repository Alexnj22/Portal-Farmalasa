// Nueva solicitud PERSONAL, NATIVA — los siete tipos del portal
// (`ModalNuevaPersonal.jsx`): vacaciones, permiso, incapacidad, cambio de
// turno, horas extra, anticipo y constancia. Las reglas son las del núcleo
// (`utils/solicitudPersonal`): un año para vacaciones, nada sobre una
// incapacidad aprobada, el compañero disponible ese día… y la creación es la
// del store (`createRequest`), que enruta al aprobador; el aviso lo manda la
// base.
//
// Con alcance «todas» en `requests_personales` se puede pedir a nombre de otra
// persona, como en el portal.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { fetchSolicitudesPersonalesDe } from '@nucleo/data/requests';
import { fetchEmployeeEventsByTypes } from '@nucleo/data/employeeSelfService';
import {
  CERT_TYPES, antiguedadDe, choqueEnDia, choqueEnRango, companeroNoDisponible, diasDe, finDeIncapacidad,
  incapacidadesVigentes, motivoParaNoEnviar, periodoDe,
} from '@nucleo/utils/solicitudPersonal';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Fotos from '../../componentes/formulario/Fotos';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const corto = (d) => (d ? fechaTexto(d, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const largo = (d) => (d ? fechaTexto(d, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const masDias = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function Fila({ rotulo, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{rotulo}</Text>
      {children}
    </View>
  );
}

export default function NuevaPersonal() {
  const { tipo: tipoParam } = useLocalSearchParams();
  const tipo = String(tipoParam || 'VACATION');
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const createRequest = useStaffStore((s) => s.createRequest);
  const puedeElegir = getScope?.('requests_personales') === 'ALL';
  const clave = `solicitud_personal_app_${tipo}`;

  const [empleadoId, setEmpleadoId] = useState(String(user?.id ?? ''));
  const [buscaPersona, setBuscaPersona] = useState('');
  const [payload, setPayload] = useState({});
  const [nota, setNota] = useState('');
  const [fotos, setFotos] = useState([]);
  const [suyas, setSuyas] = useState([]);
  const [diaNuevo, setDiaNuevo] = useState(hoySV());
  const [companeroOcupado, setCompaneroOcupado] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k, v) => setPayload((p) => ({ ...p, [k]: v }));

  // Borrador: la sesión se cierra sola y el formulario vive en memoria.
  // Sin borrador, las fechas arrancan en hoy: el selector del iPhone siempre
  // MUESTRA una fecha, y lo que se ve tiene que ser lo que se manda.
  useEffect(() => {
    const b = loadDraft(clave);
    const hoy = hoySV();
    const inicial = { VACATION: { startDate: hoy, endDate: masDias(hoy, 14) }, DISABILITY: { startDate: hoy },
      SHIFT_CHANGE: { date: hoy }, OVERTIME: { date: hoy } }[tipo] ?? {};
    setPayload(b?.payload && Object.keys(b.payload).length ? b.payload : inicial);
    if (b?.nota) setNota(b.nota);
  }, [clave, tipo]);
  useEffect(() => { saveDraft(clave, { payload, nota }); }, [clave, payload, nota]);

  useEffect(() => {
    let vivo = true;
    fetchSolicitudesPersonalesDe(empleadoId).then((r) => { if (vivo) setSuyas(r || []); });
    return () => { vivo = false; };
  }, [empleadoId]);

  const sujeto = useMemo(() => (empleados || []).find((e) => String(e.id) === String(empleadoId)) ?? null, [empleados, empleadoId]);
  const antiguedad = useMemo(() => antiguedadDe(sujeto?.hireDate ?? sujeto?.hire_date), [sujeto]);
  const incapacidades = useMemo(() => incapacidadesVigentes(suyas, hoySV()), [suyas]);
  const vacacionAprobada = suyas.some((r) => r.type === 'VACATION' && r.status === 'APPROVED');
  const pendienteDelTipo = suyas.find((r) => r.type === tipo && r.status === 'PENDING');
  const companeros = useMemo(() => (empleados || []).filter((e) =>
    String(e.branch_id ?? e.branchId) === String(sujeto?.branch_id ?? sujeto?.branchId)
    && String(e.id) !== String(empleadoId) && e.status === 'ACTIVO'), [empleados, sujeto, empleadoId]);
  const fin = finDeIncapacidad(payload.startDate, payload.days);

  useEffect(() => {
    if (tipo !== 'SHIFT_CHANGE' || !payload.targetEmployeeId || !payload.date) { setCompaneroOcupado(null); return undefined; }
    let vivo = true;
    fetchEmployeeEventsByTypes(payload.targetEmployeeId).then(({ data }) => { if (vivo) setCompaneroOcupado(companeroNoDisponible(data, payload.date)); });
    return () => { vivo = false; };
  }, [tipo, payload.targetEmployeeId, payload.date]);

  const motivo = motivoParaNoEnviar({ empleadoId, tipo, payload, nota, antiguedad, vacacionAprobada, incapacidades, companeroOcupado });

  const enviar = async () => {
    setEnviando(true); trabajando('Enviando la solicitud…');
    try {
      const final = { ...payload };
      if (tipo === 'DISABILITY') {
        final.endDate = fin;
        if (fotos[0]) {
          const f = fotos[0];
          const ext = (f.nombre.split('.').pop() || 'jpg').toLowerCase();
          const datos = await (await fetch(f.uri)).arrayBuffer();
          final.docUrl = await subirArchivo('documents', `solicitudes/${empleadoId}/${Date.now()}.${ext}`, datos, { contentType: f.tipo });
          final.docName = f.nombre;
        }
      }
      if (tipo === 'ADVANCE') final.amount = String(payload.amount);
      const ok = await createRequest(empleadoId, tipo, final, nota.trim());
      if (!ok) throw new Error('No se pudo crear la solicitud. Intenta de nuevo.');
      clearDraft(clave);
      listo('Solicitud enviada', REQUEST_TYPES[tipo]?.label ?? '');
      router.dismissTo('/solicitudes');
    } catch (e) {
      fallo('No se pudo enviar', e?.message);
    } finally {
      setEnviando(false);
    }
  };

  const personas = puedeElegir && buscaPersona.trim().length >= 2
    ? (empleados || []).filter((e) => e.status !== 'INACTIVO' && String(e.name).toLowerCase().includes(buscaPersona.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: REQUEST_TYPES[tipo]?.label ?? 'Solicitud' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">

          {puedeElegir ? (
            <Seccion titulo="A nombre de">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar empleado={sujeto} tamano={36} />
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{sujeto ? shortEmployeeName(sujeto) : '—'}</Text>
              </View>
              <Campo multiline={false} value={buscaPersona} onChangeText={setBuscaPersona} placeholder="Buscar a otra persona" />
              {personas.map((e) => (
                <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setEmpleadoId(String(e.id)); setBuscaPersona(''); setPayload({}); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
                  <Avatar empleado={e} tamano={28} />
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{shortEmployeeName(e)}</Text>
                </Pressable>
              ))}
            </Seccion>
          ) : null}

          {pendienteDelTipo ? <Aviso tono="cuidado" texto={`Ya hay una solicitud de ${REQUEST_TYPES[tipo]?.label?.toLowerCase()} esperando respuesta.`} /> : null}

          {tipo === 'VACATION' ? (
            <Seccion titulo="Las vacaciones">
              {antiguedad && !antiguedad.habilitado ? <Aviso tono="freno" texto={`Faltan ${antiguedad.faltan} días para cumplir un año en la empresa.`} /> : null}
              {antiguedad?.habilitado ? <Dato primero rotulo="Antigüedad" valor={`${antiguedad.anios} año${antiguedad.anios === 1 ? '' : 's'} y ${antiguedad.meses} mes${antiguedad.meses === 1 ? '' : 'es'}`} /> : null}
              {antiguedad?.habilitado ? <Dato rotulo="Ventana para tomarlas" valor={`${largo(antiguedad.inicioVentana)} – ${largo(antiguedad.finVentana)}`} /> : null}
              {vacacionAprobada ? <Aviso tono="freno" texto="Ya hay vacaciones aprobadas." /> : null}
              <Fila rotulo="Desde"><Fecha valor={payload.startDate} desde={hoySV()} onCambiar={(v) => setPayload((p) => ({ ...p, startDate: v, endDate: p.endDate && p.endDate >= v ? p.endDate : masDias(v, 14) }))} /></Fila>
              <Fila rotulo="Hasta"><Fecha valor={payload.endDate} desde={payload.startDate || hoySV()} onCambiar={(v) => set('endDate', v)} /></Fila>
              {payload.startDate && payload.endDate ? <Dato rotulo="Días" valor={`${diasDe(payload.startDate, payload.endDate)}`} fuerte /> : null}
            </Seccion>
          ) : null}

          {tipo === 'PERMIT' ? (
            <Seccion titulo="Los días de permiso">
              <Fila rotulo="Día"><Fecha valor={diaNuevo} desde={hoySV()} onCambiar={setDiaNuevo} /></Fila>
              <BotonGrande texto="Agregar el día" borde onPress={() => {
                const choque = choqueEnDia(incapacidades, diaNuevo);
                if (choque) { fallo('Ese día no se puede', `Hay una incapacidad del ${periodoDe(choque)}.`); return; }
                if (diaNuevo < hoySV()) return;
                setPayload((p) => { const ya = p.permissionDates || []; return ya.includes(diaNuevo) ? p : { ...p, permissionDates: [...ya, diaNuevo].sort() }; });
              }} />
              {(payload.permissionDates || []).map((d) => (
                <View key={d} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{corto(d)}</Text>
                  <Pressable hitSlop={8} onPress={() => setPayload((p) => ({ ...p, permissionDates: (p.permissionDates || []).filter((x) => x !== d) }))}>
                    <Text style={{ color: MARCA.rojo, fontSize: 15 }}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
            </Seccion>
          ) : null}

          {tipo === 'DISABILITY' ? (
            <Seccion titulo="La incapacidad">
              <Fila rotulo="Desde"><Fecha valor={payload.startDate} onCambiar={(v) => set('startDate', v)} /></Fila>
              <Fila rotulo="Días">
                <View style={{ width: 100 }}><Campo multiline={false} value={String(payload.days ?? '')} keyboardType="number-pad" style={{ textAlign: 'center' }}
                  onChangeText={(t) => set('days', t.replace(/\D/g, '').slice(0, 3))} /></View>
              </Fila>
              {fin ? <Dato rotulo="Último día" valor={largo(fin)} fuerte /> : null}
              {fin && choqueEnRango(incapacidades, payload.startDate, fin) ? <Aviso tono="freno" texto="Se cruza con una incapacidad ya aprobada." /> : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{Number(payload.days) > 3 ? 'Boleta del ISSS (desde el cuarto día)' : 'Boleta o constancia (opcional)'}</Text>
              <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
            </Seccion>
          ) : null}

          {tipo === 'SHIFT_CHANGE' ? (
            <Seccion titulo="El cambio">
              <Fila rotulo="Fecha"><Fecha valor={payload.date} desde={hoySV()} onCambiar={(v) => set('date', v)} /></Fila>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Con quién (de tu sala)</Text>
              <Opciones opciones={companeros.map((e) => ({ id: String(e.id), label: shortEmployeeName(e) }))} valor={String(payload.targetEmployeeId ?? '')}
                onCambiar={(v) => set('targetEmployeeId', v)} />
              {companeroOcupado ? <Aviso tono="freno" texto={`Está ${companeroOcupado.motivo} ese día.`} /> : null}
            </Seccion>
          ) : null}

          {tipo === 'OVERTIME' ? (
            <Seccion titulo="Las horas extra">
              <Fila rotulo="Fecha"><Fecha valor={payload.date} onCambiar={(v) => set('date', v)} /></Fila>
              <Fila rotulo="Horas">
                <View style={{ width: 100 }}><Campo multiline={false} value={String(payload.hours ?? '')} keyboardType="number-pad" style={{ textAlign: 'center' }}
                  onChangeText={(t) => { const n = t.replace(/\D/g, '').slice(0, 2); set('hours', n && Number(n) > 12 ? '12' : n); }} /></View>
              </Fila>
            </Seccion>
          ) : null}

          {tipo === 'ADVANCE' ? (
            <Seccion titulo="El anticipo">
              <Fila rotulo="Monto">
                <View style={{ width: 130 }}><Campo multiline={false} value={String(payload.amount ?? '')} keyboardType="decimal-pad" style={{ textAlign: 'center' }} placeholder="$0.00"
                  onChangeText={(t) => set('amount', t.replace(/[^\d.]/g, ''))} /></View>
              </Fila>
              {Number(payload.amount) > 0 ? <Dato rotulo="Pides" valor={formatMoney(Number(payload.amount))} fuerte /> : null}
            </Seccion>
          ) : null}

          {tipo === 'CERTIFICATE' ? (
            <Seccion titulo="La constancia">
              <Opciones opciones={CERT_TYPES.map((c) => ({ id: c.key, label: c.label, detalle: c.desc }))} valor={payload.certificateType} onCambiar={(v) => set('certificateType', v)} />
            </Seccion>
          ) : null}

          <Seccion titulo="Motivo (obligatorio)">
            <Campo value={nota} onChangeText={setNota} placeholder="Por qué lo pides" />
          </Seccion>

          {motivo && (nota.trim() || Object.keys(payload).length) ? <Aviso tono="cuidado" texto={motivo} /> : null}
          <BotonGrande texto={enviando ? 'Enviando…' : 'Enviar solicitud'} color={MARCA.violeta} deshabilitado={enviando || !!motivo} onPress={enviar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
