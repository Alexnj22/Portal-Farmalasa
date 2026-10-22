// Acreditaciones e ISSS/AFP, como en el alta del portal.
//
// Las juntas que le corresponden a la persona se DETECTAN por cargo y
// profesión (`acreditacionesDe`, núcleo): no se pregunta «¿es enfermero?»,
// se pregunta si la TIENE. Cada una lleva su número, su comprobante (sube al
// expediente con la ficha), cuál tiene —definitiva o provisional— y, si es
// provisional, «Ya se graduó» (`promoverADefinitiva`, que guarda el número
// provisional que se reemplaza).
//
// La de dependiente de farmacia no depende de la profesión: es una casilla, y
// su carné es DIGITAL — se escanea el QR del Consejo y se guarda la dirección
// de su ficha (`normalizarCarne`, núcleo).
//
// ISSS y AFP: primero si ya lo tiene (`ESTADO_PREVISIONAL_OPTIONS`) y sólo
// entonces el número. El NUP lo revisa `revisarNup` (el DUI desde 2023, o 12
// dígitos si es de antes); «Es el DUI» lo pone de un toque.
import { useState } from 'react';
import { View } from 'react-native';
import { ESTADO_PREVISIONAL_OPTIONS, TIPO_ACREDITACION_OPTIONS, fijarTipoAcreditacion, pendientesPrevisionales,
  promoverADefinitiva, tipoDeAcreditacion } from '@nucleo/utils/acreditaciones';
import { AFP_OPTIONS } from '@nucleo/utils/fichaDelEmpleado';
import { revisarNup } from '@nucleo/utils/nupAfp';
import { documentoReemplazado, parcheDeArchivoNuevo } from '@nucleo/utils/documentosDelExpediente';
import { normalizarCarne, porQueNoSirve } from '@nucleo/utils/carneDeDependiente';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Seccion } from '../../formulario/Piezas';
import { fallo } from '../../Progreso';
import Escaner from '../../Escaner';
import { Interruptor } from '../Formulario';
import { elegirYSubir } from './documentos';
import { CampoConRotulo, Elegir, Enlace, Nota, Subtarjeta, Subtitulo, op } from './Piezas';

function Comprobante({ form, setForm, categoria, empleadoId, quien }) {
  const [subiendo, setSubiendo] = useState(false);
  const doc = (form.employee_documents || []).find((d) => d.category === categoria);
  const subir = async () => {
    setSubiendo(true);
    try {
      const r = await elegirYSubir(empleadoId);
      if (r) setForm((prev) => ({ ...prev, employee_documents: documentoReemplazado(prev.employee_documents, categoria,
        parcheDeArchivoNuevo((prev.employee_documents || []).find((d) => d.category === categoria), r), { quien: quien?.name || '', quienId: quien?.id || null, hoy: hoySV() }) }));
    } catch (e) { fallo('No se pudo subir', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setSubiendo(false); }
  };
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
      <Nota tono={doc?.url ? 'bien' : 'cuidado'} texto={doc?.url ? 'Comprobante cargado' : 'Sin comprobante'} />
      {doc?.url ? <Enlace texto="Ver" onPress={() => openStoredFile(doc.url).catch((e) => fallo('No se pudo abrir', e?.message || ''))} /> : null}
      <Enlace texto={subiendo ? 'Subiendo…' : doc?.url ? 'Cambiar' : 'Subir'} onPress={subir} deshabilitado={subiendo} />
    </View>
  );
}

export default function Acreditaciones({ form, setForm, cambiar, aplicables, empleadoId, quien }) {
  const [escaneando, setEscaneando] = useState(false);
  const nup = revisarNup(form.afp_number, form.dui);
  const duiDigitos = String(form.dui || '').replace(/\D/g, '');
  const conBotonDui = duiDigitos.length === 9 && String(form.afp_number || '').replace(/\D/g, '') !== duiDigitos;
  const pendientes = pendientesPrevisionales(form);
  const problemaCarne = form.carne_dependiente_url && !normalizarCarne(form.carne_dependiente_url) ? porQueNoSirve(form.carne_dependiente_url) : null;

  return (
    <Seccion titulo="Acreditaciones" pie="El comprobante se sube aquí: de él salen el número y el vencimiento.">
      {form.is_studying && aplicables.length ? <Nota texto="Esta persona todavía estudia: si aún no tiene el título, lo que puede tener es la acreditación provisional." /> : null}
      {!aplicables.length && !form.tiene_acreditacion_dependiente ? (
        <Nota texto="Por el cargo y la profesión de esta persona no corresponde ninguna junta profesional. Si tiene la acreditación de dependiente de farmacia, márcala abajo." />
      ) : null}
      {aplicables.map((a) => {
        const tipo = tipoDeAcreditacion(form, a.id);
        const provisional = tipo === 'PROVISIONAL';
        const previo = form.acreditaciones?.[a.id]?.provisional_numero;
        return (
          <Subtarjeta key={a.id} titulo={a.label}>
            <Nota texto={a.organismo} />
            {provisional ? <Nota tono="cuidado" texto="Provisional" /> : !form[a.campo] ? <Nota tono="cuidado" texto="Pendiente" /> : null}
            <CampoConRotulo rotulo={`Número ${a.junta}`} value={form[a.campo] || ''} onChangeText={cambiar(a.campo)} placeholder={`N° ${a.junta}`} />
            <Comprobante form={form} setForm={setForm} categoria={a.doc} empleadoId={empleadoId} quien={quien} />
            <Elegir rotulo="¿Cuál tiene?" valor={tipo || ''} opciones={op(TIPO_ACREDITACION_OPTIONS)} vacio="Preguntar…"
              onCambiar={(v) => setForm((prev) => ({ ...prev, ...fijarTipoAcreditacion(prev, a.id, v) }))} />
            {provisional ? (
              <>
                <Nota texto="Al graduarse hay que reemplazarla por la definitiva." />
                <Enlace texto="Ya se graduó" onPress={() => setForm((prev) => ({ ...prev, ...promoverADefinitiva(prev, a.id, a.campo, hoySV()) }))} />
              </>
            ) : null}
            {previo && !provisional ? <Nota texto={`Antes tuvo el provisional N° ${previo}.`} /> : null}
          </Subtarjeta>
        );
      })}

      <Interruptor primero={!aplicables.length} titulo="Acreditación de dependiente de farmacia" detalle="La tiene quien atiende el mostrador. El carné es digital: un QR del Consejo."
        valor={!!form.tiene_acreditacion_dependiente} onCambiar={cambiar('tiene_acreditacion_dependiente')} />
      {form.tiene_acreditacion_dependiente ? (
        <>
          <CampoConRotulo rotulo="Carné digital (dirección del QR)" value={form.carne_dependiente_url || ''} autoCapitalize="none" keyboardType="url"
            onChangeText={(t) => cambiar('carne_dependiente_url')(t)} placeholder="Escanea el QR o pega la dirección"
            error={problemaCarne} />
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Enlace texto="Escanear el QR" onPress={() => setEscaneando(true)} />
            {form.carne_dependiente_url ? <Enlace texto="Quitar" onPress={() => cambiar('carne_dependiente_url')('')} /> : null}
          </View>
          {(form.employee_documents || []).some((d) => d.category === 'DEPENDIENTE_FARMACIA' && d.url) ? (
            <>
              <Nota texto="Comprobante en papel (de antes de que fuera digital):" />
              <Comprobante form={form} setForm={setForm} categoria="DEPENDIENTE_FARMACIA" empleadoId={empleadoId} quien={quien} />
            </>
          ) : null}
          <Escaner visible={escaneando} titulo="Carné de dependiente" ayuda="Apunta al QR del carné digital"
            onCerrar={() => setEscaneando(false)}
            onCodigo={(codigo) => {
              const url = normalizarCarne(codigo);
              if (!url) { fallo('Ese QR no es el del carné', porQueNoSirve(codigo) || ''); return false; }
              cambiar('carne_dependiente_url')(url);
              setEscaneando(false);
              return true;
            }} />
        </>
      ) : null}

      <Subtitulo texto="ISSS y AFP" />
      <Elegir rotulo="¿Ya tiene ISSS?" valor={form.isss_estado || ''} opciones={op(ESTADO_PREVISIONAL_OPTIONS)} onCambiar={cambiar('isss_estado')} vacio="Preguntar…" />
      {form.isss_estado !== 'NO_TIENE' ? (
        <CampoConRotulo rotulo="Número ISSS" value={form.isss_number || ''} keyboardType="number-pad" placeholder="9 dígitos"
          onChangeText={(t) => cambiar('isss_number')(t.replace(/\D/g, '').substring(0, 9))}
          error={form.isss_number && form.isss_number.length !== 9 ? 'Lleva 9 dígitos' : null} />
      ) : null}
      <Elegir rotulo="¿Ya tiene AFP?" valor={form.afp_estado || ''} opciones={op(ESTADO_PREVISIONAL_OPTIONS)} onCambiar={cambiar('afp_estado')} vacio="Preguntar…" />
      {form.afp_estado !== 'NO_TIENE' ? (
        <>
          <CampoConRotulo rotulo={`NUP (AFP)${nup.esElDui ? ' · es el DUI' : ''}`} value={form.afp_number || ''} keyboardType="number-pad"
            placeholder="El DUI, o 12 dígitos si es de antes de 2023" onChangeText={(t) => cambiar('afp_number')(t.replace(/[^0-9-]/g, ''))}
            error={!nup.ok ? (nup.motivo || 'No cuadra') : null} />
          {conBotonDui ? <Enlace texto="Es el DUI" onPress={() => cambiar('afp_number')(form.dui)} /> : null}
          <Elegir rotulo="Institución AFP" valor={form.afp_institution || ''} opciones={op(AFP_OPTIONS)} onCambiar={cambiar('afp_institution')} vacio="Sin indicar" />
        </>
      ) : null}
      {pendientes.map((t) => (
        <Nota key={t.clave} tono={t.estado === 'SIN_PREGUNTAR' ? null : 'cuidado'}
          texto={`${t.label}: ${t.estado === 'SIN_PREGUNTAR' ? 'Todavía no se preguntó.' : t.estado === 'EN_TRAMITE' ? 'En trámite.' : 'No tiene.'} ${t.orientacion}`} />
      ))}
    </Seccion>
  );
}
