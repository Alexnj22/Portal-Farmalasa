// Anonimizar, consultar el resguardo y reactivar, NATIVOS — gemelos de
// `src/views/datos/AnonimizarCliente.jsx`, `ConsultaResguardo.jsx` y el
// `Reactivar` de `AnonimizadosDatos.jsx` (2026-11-13, «dejemos TODO
// completamente nativo»). Qué ficha, qué se borra, qué se resguarda y qué lo
// impide lo decide la base (`datos_anonimizacion_evaluar`); la pantalla sólo
// muestra su respuesta. El resguardo exige motivo y la base anota la lectura
// ANTES de devolver nada.
import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Text, View } from 'react-native';
import {
  RUBROS_ANONIMIZACION, anonimizarCliente, documentoAnonimizado, fetchAnonimizacion, leerResguardo, reactivarCliente,
  reintentarArchivosAnonimizacion,
} from '@nucleo/data/solicitudesDatos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Tocable from '../Tocable';
import { MARCA } from '../inicio/marca';
import { listo } from '../Progreso';

const CONFIRMAR = 'ANONIMIZAR';
const numero = (n) => Number(n ?? 0).toLocaleString('es-SV');
const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const cuando = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const rotuloDeFicha = (ficha) => `#${ficha?.id} · ${ficha?.name ?? ''}`;

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Lista({ titulo, rubros, conteos, color }) {
  const filas = Object.entries(rubros).filter(([k]) => Number(conteos?.[k] ?? 0) > 0);
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{titulo}</Text>
      {filas.length ? filas.map(([k, rotulo]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{rotulo}</Text>
          <Pildora texto={numero(conteos[k])} color={color} />
        </View>
      )) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Nada</Text>}
    </View>
  );
}

const TABLAS = {
  customers: 'Ficha del cliente', solicitudes_datos: 'Solicitud de datos', consentimientos_cliente: 'Consentimientos',
  app_cliente_aceptaciones: 'Aceptaciones en la app', reclamos_clientes: 'Reclamos', encuesta_cliente_respuestas: 'Encuestas',
  customers_changelog: 'Historial de cambios de la ficha', espejo_conflictos: 'Diferencias de ficha por revisar',
  clientes_por_revisar: 'Fichas por revisar', app_chat_conversaciones: 'Conversaciones del chat', app_chat_mensajes: 'Mensajes del chat',
  app_cliente_fotos: 'Fotos', app_cliente_preregistros: 'Pre-registros', app_cliente_avisos: 'Avisos', app_cliente_correos: 'Correos',
  app_cliente_correo_envios: 'Envíos de correo', app_cliente_muestras: 'Muestras', app_tratamientos: 'Tratamientos',
  app_reservas: 'Reservas (dirección de entrega)',
};
const CAMPOS_FICHA = [
  ['name', 'Nombre'], ['dui', 'DUI'], ['nit', 'NIT'], ['nrc', 'NRC'], ['pasaporte', 'Pasaporte'],
  ['phone', 'Teléfono'], ['telefono2', 'Teléfono 2'], ['email', 'Correo'], ['direccion', 'Dirección'],
  ['fecha_nacimiento', 'Nacimiento'], ['notes', 'Notas'],
];

function FilaResguardo({ fila }) {
  const [abierta, setAbierta] = useState(false);
  const d = fila.datos ?? {};
  return (
    <View style={{ gap: 4, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      {fila.tabla === 'customers' ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Ficha #${d.id}`}</Text>
          {CAMPOS_FICHA.filter(([k]) => d[k] != null && d[k] !== '').map(([k, rotulo]) => (
            <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ width: 96, color: colorSistema.texto2, fontSize: 13 }}>{rotulo}</Text>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} selectable>{String(d[k])}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
          {fila.accion === 'vaciada' ? 'Se vaciaron datos de un registro' : 'Registro borrado'}
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{` · ${d.created_at ? cuando(d.created_at) : `#${fila.fila_id}`}`}</Text>
        </Text>
      )}
      <Tocable onPress={() => setAbierta((v) => !v)} style={{ minHeight: 36, justifyContent: 'center' }}>
        <Text style={{ color: colorSistema.acento, fontSize: 14 }}>{abierta ? 'Ocultar el detalle' : 'Ver el detalle completo'}</Text>
      </Tocable>
      {abierta ? <Text selectable style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }}>{JSON.stringify(d, null, 2)}</Text> : null}
    </View>
  );
}

/** Lo guardado al anonimizar. Exige motivo; la base anota quién, cuándo y por qué antes de devolver nada. */
export function ConsultaResguardo({ anonimizacionId }) {
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [r, setR] = useState(null);

  const consultar = async () => {
    setOcupado(true);
    try { setR(await leerResguardo(anonimizacionId, motivo.trim())); } catch (e) {
      Alert.alert('No se pudo consultar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };

  if (!r) {
    return (
      <View style={{ gap: 8 }}>
        <Aviso texto="El resguardo sólo se consulta con un motivo (un requerimiento de autoridad, una reclamación, la propia persona). Queda registrado quién lo consultó, cuándo y por qué." />
        <Rotulo texto="Motivo de la consulta" />
        <Campo value={motivo} onChangeText={(t) => setMotivo(t.slice(0, 500))} style={{ minHeight: 60 }} />
        <BotonGrande texto={ocupado ? 'Consultando…' : 'Consultar el resguardo'} color={MARCA.azul}
          deshabilitado={ocupado || motivo.trim().length < 10} onPress={consultar} />
      </View>
    );
  }

  const grupos = {};
  for (const f of r.filas ?? []) (grupos[f.tabla] ??= []).push(f);
  return (
    <View style={{ gap: 12 }}>
      {Object.entries(grupos).map(([tabla, filas]) => (
        <View key={tabla}>
          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${TABLAS[tabla] ?? tabla} (${filas.length})`}</Text>
          {filas.map((f, i) => <FilaResguardo key={`${f.tabla}-${f.fila_id}-${i}`} fila={f} />)}
        </View>
      ))}
      {!(r.filas ?? []).length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>El resguardo está vacío.</Text> : null}
      <View style={{ gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>Consultas registradas</Text>
        {(r.lecturas ?? []).map((l, i) => (
          <Text key={i} style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${cuando(l.cuando)} · ${l.quien ? shortEmployeeName(l.quien) : 'Personal'} · «${l.motivo}»`}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Hecha({ a, onCambio }) {
  const [ocupado, setOcupado] = useState(false);
  const [verResguardo, setVerResguardo] = useState(false);
  const reintentar = async () => {
    setOcupado(true);
    try {
      const r = await reintentarArchivosAnonimizacion(a.id);
      if (r.archivos_pendientes) Alert.alert('Quedan archivos', `${r.archivos_pendientes} sin borrar todavía.`);
      else listo('Listo', 'Archivos borrados');
      onCambio?.();
    } catch (e) {
      Alert.alert('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };
  return (
    <View style={{ gap: 8, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Pildora texto={a.reactivada_at ? `Reactivada el ${dia(a.reactivada_at)}` : `Anonimizada el ${dia(a.anonimizada_at)}`}
          color={a.reactivada_at ? MARCA.azulClaro : colorSistema.texto2} />
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`Ficha #${a.customer_id}${Number(a.puntos_perdidos) > 0 ? ` · ${numero(a.puntos_perdidos)} puntos perdidos` : ''}`}
        </Text>
      </View>
      {!a.reactivada_at ? (
        <>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
            {Number(a.caja_total) === 0
              ? 'La ficha no existe en la caja: no hubo nada que anonimizar allá.'
              : Number(a.caja_pendientes) > 0
                ? `La ficha de la caja se anonimiza en los próximos minutos (${a.caja_pendientes} de ${a.caja_total} datos pendientes).`
                : 'La ficha de la caja ya quedó anonimizada.'}
          </Text>
          {Number(a.archivos_pendientes) > 0 ? (
            <>
              <Aviso tono="cuidado" texto={`Quedaron ${a.archivos_pendientes} carpeta(s) o archivo(s) sin borrar.`} />
              <BotonGrande texto={ocupado ? 'Reintentando…' : 'Reintentar'} borde color={MARCA.ambar} deshabilitado={ocupado} onPress={reintentar} />
            </>
          ) : null}
        </>
      ) : null}
      {verResguardo ? <ConsultaResguardo anonimizacionId={a.id} /> : (
        <BotonGrande borde color={MARCA.azulClaro} onPress={() => setVerResguardo(true)}
          texto={`Consultar el resguardo${Number(a.lecturas) > 0 ? ` (${a.lecturas} consulta${Number(a.lecturas) === 1 ? '' : 's'})` : ''}`} />
      )}
    </View>
  );
}

/** Ejecuta la cancelación resuelta: sólo en una solicitud RESUELTA, no negada, que pide cancelación. */
export default function AnonimizarCliente({ solicitud }) {
  const [estado, setEstado] = useState(null);
  const [elegida, setElegida] = useState(null);
  const [fichaManual, setFichaManual] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [motivoSinDoc, setMotivoSinDoc] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async (customerId = null) => {
    try {
      const d = await fetchAnonimizacion(solicitud.id, customerId);
      setEstado(d);
      setElegida((prev) => {
        const ids = (d.candidatos ?? []).map((c) => c.ficha?.id);
        if (prev && ids.includes(prev)) return prev;
        return ids.length === 1 ? ids[0] : null;
      });
    } catch (e) {
      setEstado({ hecha: [], candidatos: [], error: mensajeAmigable(e) });
    }
  }, [solicitud.id]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!estado) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Revisando la ficha…</Text>;
  if (estado.error) return <Aviso tono="cuidado" texto={estado.error} />;

  const candidatos = estado.candidatos ?? [];
  const vigente = (estado.hecha ?? []).find((a) => !a.reactivada_at);
  const candidato = candidatos.find((c) => c.ficha?.id === elegida);
  const confirmado = confirmacion.trim().toUpperCase() === CONFIRMAR;
  const faltaMotivo = candidato?.requiere_motivo_sin_documento && motivoSinDoc.trim().length < 15;

  const elegirFicha = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Hay más de una ficha con ese documento', options: [...candidatos.map((c) => rotuloDeFicha(c.ficha)), 'Cancelar'], cancelButtonIndex: candidatos.length },
    (i) => { if (i < candidatos.length) setElegida(candidatos[i].ficha.id); },
  );

  const anonimizar = () => Alert.alert('Anonimizar datos',
    `La ficha #${candidato.ficha.id} queda sin datos que identifiquen a la persona, en el portal y en la caja.${Number(candidato.puntos_que_se_pierden) > 0 ? ` Se pierden ${numero(candidato.puntos_que_se_pierden)} puntos.` : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Anonimizar', style: 'destructive', onPress: async () => {
        setOcupado(true);
        try {
          const r = await anonimizarCliente({
            solicitudId: solicitud.id, customerId: candidato.ficha.id, confirmacion,
            sinDocumentoMotivo: candidato.requiere_motivo_sin_documento ? motivoSinDoc.trim() : null,
          });
          if (r.archivos_pendientes) Alert.alert('Datos anonimizados', `Ficha #${candidato.ficha.id}. Quedaron ${r.archivos_pendientes} archivo(s) por borrar: se pueden reintentar.`);
          else listo('Datos anonimizados', `Ficha #${candidato.ficha.id}`);
          setConfirmacion(''); setMotivoSinDoc('');
          await cargar();
        } catch (e) {
          Alert.alert('No se pudo anonimizar', mensajeAmigable(e, 'Intenta de nuevo.'));
        } finally { setOcupado(false); }
      } },
    ]);

  return (
    <View style={{ gap: 10 }}>
      {(estado.hecha ?? []).map((a) => <Hecha key={a.id} a={a} onCambio={() => cargar()} />)}
      {vigente ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>✓ Esta solicitud ya se ejecutó.</Text> : (
        <>
          {!candidatos.length ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                Ninguna ficha de cliente tiene el documento de esta solicitud. Si la persona es cliente con una ficha sin documento, escribe el número de ficha (aparece en Clientes).
              </Text>
              <Rotulo texto="Número de ficha" />
              <Campo multiline={false} keyboardType="number-pad" value={fichaManual} onChangeText={(t) => setFichaManual(t.replace(/\D/g, ''))} />
              <BotonGrande texto="Revisar" borde color={MARCA.azulClaro} deshabilitado={!fichaManual} onPress={() => cargar(Number(fichaManual))} />
            </View>
          ) : null}
          {candidatos.length > 1 ? (
            <BotonGrande borde color={MARCA.azulClaro} onPress={elegirFicha}
              texto={candidato ? rotuloDeFicha(candidato.ficha) : 'Elegir la ficha'} />
          ) : null}
          {candidato ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{rotuloDeFicha(candidato.ficha)}</Text>
              {(candidato.fichas ?? []).length > 1 ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Incluye ${candidato.fichas.length - 1} ficha(s) que ya se habían unido a esta.`}</Text>
              ) : null}
              {(candidato.bloqueos ?? []).map((b, i) => <Aviso key={i} tono="cuidado" texto={b} />)}
              {Number(candidato.puntos_que_se_pierden) > 0 ? (
                <Aviso tono="freno" texto={`Se pierden ${numero(candidato.puntos_que_se_pierden)} puntos. No vuelven aunque la persona regrese y reactive sus datos.`} />
              ) : null}
              <Lista titulo="Se borra" rubros={RUBROS_ANONIMIZACION.borra} conteos={candidato.conteos?.borra} color={MARCA.rojo} />
              <Lista titulo="Se guarda en el resguardo" rubros={RUBROS_ANONIMIZACION.resguarda} conteos={candidato.conteos?.resguarda} color={MARCA.ambar} />
              <Lista titulo="Se conserva (lo exige la ley)" rubros={RUBROS_ANONIMIZACION.conserva} conteos={candidato.conteos?.conserva} color={colorSistema.texto2} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                La ficha queda como «CLIENTE ANÓNIMO» sin nombre, documentos, teléfonos, correo, dirección ni fecha de nacimiento, también en la caja. Las facturas conservan el nombre con que se emitieron: son documentos fiscales. Si la persona vuelve, sus datos se pueden reactivar presentando el mismo documento.
              </Text>
              {candidato.puede ? (
                <>
                  {candidato.requiere_motivo_sin_documento ? (
                    <>
                      <Rotulo texto="La ficha no tiene documento: ¿por qué es la de esta persona?" />
                      <Campo value={motivoSinDoc} onChangeText={(t) => setMotivoSinDoc(t.slice(0, 500))} style={{ minHeight: 60 }} />
                    </>
                  ) : null}
                  <Rotulo texto={`Para confirmar, escribe ${CONFIRMAR}`} />
                  <Campo multiline={false} autoCapitalize="characters" autoCorrect={false} value={confirmacion} onChangeText={setConfirmacion} />
                  <BotonGrande texto={ocupado ? 'Anonimizando…' : 'Anonimizar datos'} color={MARCA.rojo}
                    deshabilitado={ocupado || !confirmado || faltaMotivo} onPress={anonimizar} />
                </>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Devuelve sus datos a la MISMA ficha de quien pidió anonimizar y vuelve. Los puntos no vuelven. */
export function Reactivar({ onHecho }) {
  const [documento, setDocumento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [hallado, setHallado] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const buscar = async () => {
    setOcupado(true);
    try { setHallado(await documentoAnonimizado(documento)); } catch (e) {
      Alert.alert('No se pudo buscar', mensajeAmigable(e));
    } finally { setOcupado(false); }
  };
  const confirmar = async () => {
    setOcupado(true);
    try {
      const r = await reactivarCliente({ documento, motivo: motivo.trim() });
      listo('Datos reactivados', `Ficha #${r.customer_id}${Number(r.puntos_perdidos) > 0 ? ` · los ${r.puntos_perdidos} puntos no vuelven` : ''}`);
      setDocumento(''); setMotivo(''); setHallado(null);
      onHecho?.();
    } catch (e) {
      Alert.alert('No se pudo reactivar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setOcupado(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      <Rotulo texto="Documento que presenta (DUI, NIT o pasaporte)" />
      <Campo multiline={false} autoCorrect={false} value={documento} onChangeText={(t) => { setDocumento(t); setHallado(null); }} />
      <BotonGrande texto={ocupado && !hallado ? 'Buscando…' : 'Buscar'} borde color={MARCA.azulClaro}
        deshabilitado={ocupado || documento.replace(/[^0-9a-z]/gi, '').length < 7} onPress={buscar} />
      {hallado && !hallado.anonimizado ? <Aviso texto="Con ese documento no hay datos anonimizados." /> : null}
      {hallado?.anonimizado ? (
        <>
          <Aviso tono="cuidado" texto={`Esta persona pidió anonimizar sus datos el ${dia(hallado.anonimizada_at)} (ficha #${hallado.customer_id}). Al reactivar vuelven su nombre, documentos y contacto, en el portal y en la caja. Los puntos que tenía no vuelven.`} />
          <Rotulo texto="Cómo se comprobó que es la persona" />
          <Campo value={motivo} onChangeText={(t) => setMotivo(t.slice(0, 500))} style={{ minHeight: 60 }} />
          <BotonGrande texto={ocupado ? 'Reactivando…' : 'Reactivar'} color={MARCA.azul}
            deshabilitado={ocupado || motivo.trim().length < 10} onPress={confirmar} />
        </>
      ) : null}
    </View>
  );
}
