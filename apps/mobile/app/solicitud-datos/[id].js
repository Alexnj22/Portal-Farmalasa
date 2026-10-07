// Registrar y resolver una solicitud sobre datos personales, NATIVO —
// `SolicitudModal` del portal: transcribir la hoja que volvió llena (quién
// pide, qué derechos ejerce, con qué documento se comprobó), marcarla
// recibida para que corra el plazo, y darla por resuelta con su resolución.
//
// Buscar a la persona llena los campos y arma la RESPUESTA: el mismo papel que
// imprime el portal (`papelDeRespuesta`, del núcleo), acá como PDF para
// imprimir por AirPrint o compartir. La validación, el registro y la búsqueda
// son del núcleo (`solicitudesDatos`), lo mismo del portal. El borrador usa la
// MISMA clave que el portal: transcribir una hoja lleva más que la sesión.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  DERECHOS, DOCUMENTOS_DE_IDENTIDAD, ORIGEN_DE_PERSONA, VIAS_DE_RESPUESTA, buscarPersona, camposDeSolicitud, comoPersona,
  erroresDeForma, faltaParaRecibir, fetchSolicitudes, formularioDeSolicitud, guardarSolicitud, llenarConPersona, plazoDe,
  resumenDeCliente, terminoDeBusqueda,
} from '@nucleo/data/solicitudesDatos';
import { papelDeRespuesta } from '@nucleo/utils/respuestaDeDatos';
import { useStaffStore } from '@nucleo/store/staffStore';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { diaSV, fechaTexto, hoySV, horaSV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Hora from '../../componentes/personas/Hora';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import { compartirPdf, imprimirPapel } from '../../componentes/pdf';

// El acuse es un instante; en pantalla se elige como día y hora de la sala.
const diaDe = (iso) => (iso ? diaSV(iso) : hoySV());
const horaDe = (iso) => (iso ? horaSV(iso) : horaSV()).slice(0, 5);
const instante = (dia, hora) => new Date(`${dia}T${hora}:00-06:00`).toISOString();

const hoja = (titulo, opciones, onElegir) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
  (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
);

function Rotulo({ texto, error }) {
  return <Text style={{ color: error ? MARCA.rojo : colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Elegir({ rotulo, valor, onPress, deshabilitado }) {
  return (
    <Pressable disabled={deshabilitado} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ flex: 1, color: deshabilitado ? colorSistema.texto2 : colorSistema.acento, fontSize: 16, textAlign: 'right' }}>{valor}</Text>
      {deshabilitado ? null : <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>}
    </Pressable>
  );
}

export default function SolicitudDeDatos() {
  const { id } = useLocalSearchParams();
  const [solicitud, setSolicitud] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSolicitudes()
      .then((filas) => {
        const s = filas.find((x) => String(x.id) === String(id));
        if (s) setSolicitud(s); else setError('No se encontró la solicitud.');
      })
      .catch((e) => setError(mensajeAmigable(e, 'No se pudo cargar la solicitud.')));
  }, [id]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: solicitud ? `Solicitud ${solicitud.folio_txt}` : 'Solicitud', headerLargeTitle: false }} />
      {error ? <View style={{ padding: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!solicitud && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {solicitud ? <Cuerpo key={solicitud.id} solicitud={solicitud} /> : null}
    </>
  );
}

function Cuerpo({ solicitud }) {
  const borrador = `solicitud_datos_${solicitud.id}`;
  const resuelta = solicitud.estado === 'RESUELTA';
  const [f, setF] = useState(() => {
    const b = loadDraft(borrador);
    // El borrador del portal guarda el acuse como «AAAA-MM-DDTHH:MM» local; acá, ISO.
    const base = b ?? formularioDeSolicitud(solicitud);
    return { ...base, recibida_at: base.recibida_at ? new Date(base.recibida_at).toISOString() : new Date().toISOString() };
  });
  const [guardando, setGuardando] = useState(false);
  const [termino, setTermino] = useState(solicitud.solicitante_numero || solicitud.solicitante_nombre || '');
  const [buscando, setBuscando] = useState(false);
  const [hallazgo, setHallazgo] = useState(null);
  const [candidatos, setCandidatos] = useState([]);

  useEffect(() => { if (!resuelta) saveDraft(borrador, f); }, [borrador, f, resuelta]);

  // Busca MIENTRAS se escribe, como el portal: 300 ms y tres letras.
  useEffect(() => {
    const t = termino.trim();
    if (t.length < 3) { setCandidatos([]); return undefined; }
    let vivo = true;
    const espera = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarPersona(terminoDeBusqueda(t));
        if (!vivo) return;
        setCandidatos((r.donde ?? []).flatMap((d) => d.filas.map((x) => comoPersona(d.clave, x))));
        // El resumen sólo con UNA ficha de cliente: con varias, elegir sería adivinar.
        const resumen = r.cliente ? await resumenDeCliente(r.cliente.id) : null;
        if (vivo) setHallazgo({ ...r, resumen });
      } catch (e) {
        if (vivo) fallo('No se pudo buscar', mensajeAmigable(e));
      } finally {
        if (vivo) setBuscando(false);
      }
    }, 300);
    return () => { vivo = false; clearTimeout(espera); };
  }, [termino]);

  const set = useCallback((k) => (v) => setF((p) => ({ ...p, [k]: v })), []);
  const alternarDerecho = (clave) => setF((p) => {
    const y = p.derechos ?? [];
    return { ...p, derechos: y.includes(clave) ? y.filter((d) => d !== clave) : [...y, clave] };
  });
  const errores = useMemo(() => erroresDeForma(f), [f]);
  const faltan = useMemo(() => faltaParaRecibir(f), [f]);
  const plazo = useMemo(() => plazoDe(solicitud), [solicitud]);

  const guardar = (estado) => {
    const resolver = estado === 'RESUELTA';
    Alert.alert(resolver ? 'Dar por resuelta' : 'Registrar la solicitud',
      resolver ? 'Queda resuelta con la resolución escrita y ya no se puede editar.' : 'Queda en trámite y su plazo corre desde el acuse.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: resolver ? 'Resolver' : 'Registrar', onPress: async () => {
          setGuardando(true);
          try {
            // La bitácora (`REGISTRAR_…` / `RESOLVER_SOLICITUD_DATOS`) la anota `guardarSolicitud`.
            await guardarSolicitud(solicitud.id, camposDeSolicitud(f, estado));
            clearDraft(borrador);
            listo(resolver ? 'Solicitud resuelta' : 'Solicitud registrada', `Solicitud ${solicitud.folio_txt}`);
            router.back();
          } catch (e) {
            fallo('No se pudo guardar', mensajeAmigable(e));
          } finally {
            setGuardando(false);
          }
        } },
      ]);
  };

  const respuesta = () => {
    const html = papelDeRespuesta({
      solicitud: { ...solicitud, solicitante_nombre: f.solicitante_nombre, recibida_at: f.recibida_at },
      cliente: hallazgo?.cliente ?? null, empleado: hallazgo?.empleado ?? null,
      resumen: hallazgo?.resumen ?? null, donde: hallazgo?.donde ?? [],
    });
    const anotar = (formato) => useStaffStore.getState().appendAuditLog?.('ENTREGAR_DATOS_SOLICITUD', String(solicitud.id), { folio: solicitud.folio_txt, formato });
    hoja('La respuesta', [{ value: 'imprimir', label: 'Imprimir' }, { value: 'pdf', label: 'Compartir en PDF' }], async (v) => {
      try {
        if (v === 'imprimir') { await imprimirPapel(html); anotar('papel'); }
        else if (await compartirPdf({ html, nombre: `Respuesta ${solicitud.folio_txt}` })) anotar('pdf');
      } catch (e) {
        fallo('No se pudo preparar la respuesta', mensajeAmigable(e));
      }
    });
  };

  const dia = diaDe(f.recibida_at);
  const hora = horaDe(f.recibida_at);

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        {plazo ? <Aviso tono={plazo.vencida ? 'freno' : plazo.apremia ? 'cuidado' : 'nota'}
          texto={plazo.vencida ? `El plazo venció hace ${Math.abs(plazo.restan)} días hábiles.` : `Quedan ${plazo.restan} días hábiles (vence el ${fechaTexto(plazo.vence, { day: 'numeric', month: 'long' })}).`} /> : null}
        {resuelta ? <Aviso texto={`Resuelta el ${fechaTexto(solicitud.resuelta_at, { day: 'numeric', month: 'long', year: 'numeric' })}. Ya no se edita.`} /> : null}

        {!resuelta ? (
          <Seccion titulo="Buscar a la persona en el portal">
            <Campo multiline={false} value={termino} onChangeText={setTermino} placeholder="DUI, teléfono o nombre" />
            {buscando ? <ActivityIndicator /> : null}
            {candidatos.slice(0, 12).map((c, i) => (
              <Pressable key={`${c.origen}-${i}`} onPress={() => { Haptics.selectionAsync().catch(() => {}); setF((p) => llenarConPersona(p, c)); setCandidatos([]); }}
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador })}>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.nombre || '—'}<Text style={{ color: colorSistema.texto2 }}>{` · ${ORIGEN_DE_PERSONA[c.origen] ?? c.origen}${c.numero ? ` · ${c.numero}` : ''}`}</Text></Text>
              </Pressable>
            ))}
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Nueve dígitos busca un DUI, ocho un teléfono; lo demás, un nombre. Tocar a alguien llena los campos.</Text>
          </Seccion>
        ) : null}

        <Seccion titulo="Quién la presenta">
          <Rotulo texto="Nombre" />
          <Campo multiline={false} editable={!resuelta} value={f.solicitante_nombre} onChangeText={set('solicitante_nombre')} />
          <Elegir rotulo="Documento" deshabilitado={resuelta} valor={f.solicitante_documento || 'Elegir'}
            onPress={() => hoja('Documento', [...DOCUMENTOS_DE_IDENTIDAD.map((d) => ({ value: d.value, label: d.label })), { value: 'NIT', label: 'NIT' }], set('solicitante_documento'))} />
          <Rotulo texto={errores.malDui ? 'Número — ese DUI no es válido' : 'Número'} error={errores.malDui} />
          <Campo multiline={false} editable={!resuelta} value={f.solicitante_numero} onChangeText={set('solicitante_numero')} keyboardType="numbers-and-punctuation" />
          <Rotulo texto="Dirección" />
          <Campo multiline={false} editable={!resuelta} value={f.solicitante_direccion} onChangeText={set('solicitante_direccion')} />
          <Rotulo texto={errores.malTel ? 'Teléfono — debe tener ocho dígitos' : 'Teléfono'} error={errores.malTel} />
          <Campo multiline={false} editable={!resuelta} value={f.solicitante_telefono} onChangeText={set('solicitante_telefono')} keyboardType="phone-pad" />
          <Rotulo texto={errores.malCorreo ? 'Correo — no tiene forma de correo' : 'Correo'} error={errores.malCorreo} />
          <Campo multiline={false} editable={!resuelta} value={f.solicitante_correo} onChangeText={set('solicitante_correo')} keyboardType="email-address" autoCapitalize="none" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Solicita por otra persona, a quien representa</Text>
            <Switch value={!!f.por_representacion} disabled={resuelta} onValueChange={set('por_representacion')} />
          </View>
          {f.por_representacion ? (
            <>
              <Rotulo texto="Documento que lo autoriza a representar" />
              <Campo multiline={false} editable={!resuelta} value={f.representacion_doc} onChangeText={set('representacion_doc')} />
            </>
          ) : null}
        </Seccion>

        <Seccion titulo="Qué solicita">
          {DERECHOS.map((d, i) => (
            <View key={d.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{d.rotulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{d.que}</Text>
              </View>
              <Switch value={(f.derechos ?? []).includes(d.clave)} disabled={resuelta} onValueChange={() => alternarDerecho(d.clave)} />
            </View>
          ))}
          <Rotulo texto="Lo que describe (opcional)" />
          <Campo editable={!resuelta} value={f.descripcion} onChangeText={set('descripcion')} style={{ minHeight: 70 }} />
          <Elegir rotulo="Cómo desea la respuesta" deshabilitado={resuelta}
            valor={VIAS_DE_RESPUESTA.find((v) => v.value === f.via_respuesta)?.label ?? 'Elegir'}
            onPress={() => hoja('Cómo desea la respuesta', VIAS_DE_RESPUESTA, set('via_respuesta'))} />
        </Seccion>

        <Seccion titulo="Acuse e identidad">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Se recibió</Text>
            {resuelta ? <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`${fechaTexto(f.recibida_at, { day: 'numeric', month: 'short', year: 'numeric' })} · ${hora12(hora)}`}</Text> : (
              <>
                <Fecha valor={dia} hasta={hoySV()} onCambiar={(d) => set('recibida_at')(instante(d, hora))} />
                <Hora valor={hora} onCambiar={(h) => set('recibida_at')(instante(dia, String(h).slice(0, 5)))} />
              </>
            )}
          </View>
          <Elegir rotulo="Documento cotejado" deshabilitado={resuelta}
            valor={DOCUMENTOS_DE_IDENTIDAD.find((d) => d.value === f.identidad_documento)?.label ?? 'Elegir'}
            onPress={() => hoja('Documento cotejado', DOCUMENTOS_DE_IDENTIDAD, set('identidad_documento'))} />
          <Rotulo texto={errores.malIdent ? 'Número cotejado — ese DUI no es válido' : 'Número del documento cotejado'} error={errores.malIdent} />
          <Campo multiline={false} editable={!resuelta} value={f.identidad_numero} onChangeText={set('identidad_numero')} keyboardType="numbers-and-punctuation" />
        </Seccion>

        <Seccion titulo="Qué consta en el portal">
          {!hallazgo ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{resuelta ? 'Busca a la persona desde el portal para volver a armar la respuesta.' : 'Todavía no se ha buscado. Usa el buscador de arriba.'}</Text> : (
            <>
              {hallazgo.fallaron?.length ? <Aviso tono="freno" texto={`No se pudo consultar ${hallazgo.fallaron.join(', ')}. Esta búsqueda está incompleta: no la uses para responder que no hay información.`} /> : null}
              {hallazgo.porNombre ? <Aviso tono="cuidado" texto="Se buscó por nombre. Un nombre trae homónimos: comprueba que la ficha sea la de esta persona antes de entregarle nada." /> : null}
              {(hallazgo.donde ?? []).map((d, i) => (
                <Dato key={d.clave} primero={!i} rotulo={d.rotulo}
                  valor={d.falló ? 'no se pudo consultar' : !d.filas.length ? 'sin coincidencias' : d.filas.length === 1 ? (comoPersona(d.clave, d.filas[0]).nombre || '1 coincidencia') : `${d.filas.length} coincidencias`} />
              ))}
              <BotonGrande texto="Imprimir o compartir la respuesta" borde color={MARCA.azulClaro} onPress={respuesta} />
            </>
          )}
        </Seccion>

        <Seccion titulo="Resolución">
          <Rotulo texto="Qué se resolvió y con qué fundamento" />
          <Campo editable={!resuelta} value={f.resolucion} onChangeText={set('resolucion')} style={{ minHeight: 90 }} />
          <Rotulo texto="Notas internas (opcional)" />
          <Campo editable={!resuelta} value={f.notas} onChangeText={set('notas')} style={{ minHeight: 60 }} />
        </Seccion>

        {!resuelta ? (
          <>
            <Text style={{ color: faltan.length ? colorSistema.texto2 : MARCA.verde, fontSize: 13, textAlign: 'center' }}>
              {faltan.length ? `Falta ${faltan.join(', ')}.` : 'Listo para registrar.'}
            </Text>
            <BotonGrande texto={guardando ? 'Guardando…' : 'Registrar (en trámite)'} borde onPress={() => guardar('RECIBIDA')} deshabilitado={guardando || faltan.length > 0} />
            <BotonGrande texto="Dar por resuelta" color={MARCA.verde} onPress={() => guardar('RESUELTA')} deshabilitado={guardando || faltan.length > 0 || !f.resolucion?.trim()} />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
