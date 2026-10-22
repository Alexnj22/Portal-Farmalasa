// El DUI por caras, con el lector — lo mismo que el bloque «DUI — los dos
// lados» del alta del portal (`EmployeeFormModal`), que va AL INICIO porque el
// documento llena media ficha: el anverso trae el número, los nombres, el sexo
// y las fechas; el reverso, el domicilio, la profesión, el estado familiar y el
// tipo de sangre.
//
// Dos formas, como en el portal: frente y reverso sueltos (se leen JUNTOS en
// una sola llamada cuando están los dos: el modelo cruza que sean del mismo
// documento) o un solo archivo con las dos caras. A un menor de edad no se le
// pide DUI: se sube su documento alterno, que no se lee (no tiene forma fija).
//
// Lo que el lector trae lo aplica `aplicarDuiLeido` (núcleo): el documento
// gana, pero no en silencio — se lista lo que sustituyó, con lo que había, y
// «Dejar lo que estaba» lo deshace en el acto. Que no se pueda leer NO es un
// error del alta: el archivo ya quedó subido y los campos se escriben a mano.
//
// Los archivos quedan en `form.employee_documents`; se guardan con la ficha.
//
// Renovar el DUI (2026-10-22, igual que el portal): la cara nueva NO hereda el
// vencimiento del archivo anterior —lo toma del documento leído, o de la ficha
// si confirmó lo que había (`carasConElVencimientoDelDui`)—, la cara anterior
// queda en el historial del documento, y lo que la lectura cambió en la ficha
// se junta en `form._cambiosDelDui`: al guardar, el store lo deja en su propio
// asiento de bitácora (`DATOS_DEL_DUI_ACTUALIZADOS`).
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { leerDui } from '@nucleo/data/ia';
import { aplicarDuiLeido, avisoDeCaras, juntarCambiosDelDui } from '@nucleo/utils/duiLeido';
import { carasConElVencimientoDelDui, documentoReemplazado, parcheDeArchivoNuevo } from '@nucleo/utils/documentosDelExpediente';
import { getStoragePathFromUrl, openStoredFile } from '@nucleo/utils/storageFiles';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../../Formulario';
import { Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { fallo } from '../../Progreso';
import Segmentos from '../../Segmentos';
import { elegirYSubir } from './documentos';
import { Enlace, Nota } from './Piezas';

const MODOS = [{ id: 'caras', label: 'Frente y reverso' }, { id: 'uno', label: 'Un solo archivo' }];

function Casilla({ rotulo, doc, ocupado, onSubir }) {
  const abrir = async () => { try { await openStoredFile(doc.url); } catch (e) { fallo('No se pudo abrir', e?.message || ''); } };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{rotulo}</Text>
        <Text style={{ color: doc?.url ? MARCA.verde : MARCA.ambar, fontSize: 13 }}>{doc?.url ? 'Cargado' : 'Pendiente'}</Text>
      </View>
      {ocupado ? <ActivityIndicator /> : null}
      {doc?.url ? <Enlace texto="Ver" onPress={abrir} /> : null}
      <Enlace texto={doc?.url ? 'Cambiar' : 'Subir'} onPress={onSubir} deshabilitado={ocupado} />
    </View>
  );
}

export default function DuiPorCaras({ form, setForm, empleadoId, esMenor, quien, rotuloAlterno }) {
  const [modo, setModo] = useState(() => ((form.employee_documents || []).some((d) => d.category === 'DUI_COMPLETO' && d.url) ? 'uno' : 'caras'));
  const [subiendo, setSubiendo] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);   // { aplicados, camposLeidos, descartados, reemplazos, numeroIlegible }
  const [caras, setCaras] = useState(null);
  const [falloLectura, setFalloLectura] = useState(null);
  const docs = form.employee_documents || [];
  const doc = (cat) => docs.find((d) => d.category === cat) || null;

  // Un archivo nuevo en la casilla: si reemplaza a otro, no hereda su vencimiento.
  const ponerDoc = (cat, subida) => setForm((prev) => ({
    ...prev,
    employee_documents: documentoReemplazado(prev.employee_documents, cat,
      parcheDeArchivoNuevo((prev.employee_documents || []).find((d) => d.category === cat), subida),
      { quien: quien?.name || '', quienId: quien?.id || null, hoy: hoySV() }),
  }));

  const leer = async (cuerpo, unArchivo) => {
    setFalloLectura(null); setCaras(null); setLeyendo(true);
    try {
      const { data, error } = await leerDui(cuerpo);
      if (error || !data?.ok) {
        setFalloLectura(data?.details || (data?.error === 'NO_ES_DUI'
          ? (unArchivo ? 'El archivo no parece un DUI. Revisa que traiga las dos caras.' : 'Las imágenes no parecen un DUI. Revisa que sean las dos caras.')
          : 'No se pudo leer. Escribe los datos a mano; el documento quedó guardado.'));
        return;
      }
      setCaras(avisoDeCaras(data, unArchivo));
      const leido = { ...data.datos, nacionalidad: data.nacionalidad, numeroIlegible: data.numeroIlegible };
      let resumen = null;
      setForm((prev) => {
        const r = aplicarDuiLeido(leido, prev);
        resumen = r;
        const next = { ...prev, ...r.parche };
        // Para el asiento de bitácora al guardar: el panel se cierra, la bitácora queda.
        if (r.reemplazos.length) next._cambiosDelDui = juntarCambiosDelDui(prev._cambiosDelDui, r.reemplazos);
        // Las caras vencen cuando vence el DUI.
        next.employee_documents = carasConElVencimientoDelDui(next.employee_documents || [], next.dui_fecha_vencimiento || null);
        return next;
      });
      // El `setForm` corre en el mismo ciclo: `resumen` ya está.
      setTimeout(() => setLectura({
        aplicados: Object.keys(resumen?.parche || {}).length,
        camposLeidos: Object.values(data.datos || {}).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length,
        descartados: resumen?.descartados || [],
        reemplazos: resumen?.reemplazos || [],
        numeroIlegible: leido.numeroIlegible,
      }), 0);
    } catch {
      setFalloLectura('No se pudo leer. Escribe los datos a mano; el documento quedó guardado.');
    } finally { setLeyendo(false); }
  };

  const subir = async (cat) => {
    setSubiendo(cat);
    try {
      const r = await elegirYSubir(empleadoId);
      if (!r) return;
      ponerDoc(cat, r);
      const stored = getStoragePathFromUrl(r.url);
      if (!stored || esMenor) return;
      if (cat === 'DUI_COMPLETO') { await leer({ frente: stored }, true); return; }
      const otra = doc(cat === 'DUI_FRENTE' ? 'DUI_REVERSO' : 'DUI_FRENTE');
      const guardadaOtra = getStoragePathFromUrl(otra?.url);
      if (guardadaOtra) {
        await leer(cat === 'DUI_FRENTE' ? { frente: stored, reverso: guardadaOtra } : { frente: guardadaOtra, reverso: stored }, false);
      }
    } catch (e) {
      fallo('No se pudo subir el documento', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally { setSubiendo(null); }
  };

  const dejarLoQueEstaba = () => {
    setForm((prev) => { const next = { ...prev }; for (const d of lectura.reemplazos) next[d.campo] = d.actual; return next; });
    setLectura((l) => ({ ...l, reemplazos: [], aplicados: Math.max(0, (l.aplicados || 0) - l.reemplazos.length) }));
  };

  const dudoso = lectura && (lectura.numeroIlegible || lectura.descartados.length || !lectura.camposLeidos);
  const completo = esMenor ? !!doc('DOCUMENTO_IDENTIDAD')?.url
    : modo === 'uno' ? !!doc('DUI_COMPLETO')?.url : !!(doc('DUI_FRENTE')?.url && doc('DUI_REVERSO')?.url);

  return (
    <Seccion titulo={esMenor ? (rotuloAlterno || 'Documento de identidad') : 'DUI — los dos lados'}
      pie={esMenor ? 'Súbelo y después escribe los datos: un documento alterno no tiene formato fijo.'
        : 'Sube las dos caras y la app lee los datos. Lo que el documento dice reemplaza lo escrito, y se puede deshacer.'}>
      {!completo ? <Nota tono="cuidado" texto="Pendiente" /> : null}
      {esMenor ? (
        <Casilla rotulo={rotuloAlterno || 'Documento'} doc={doc('DOCUMENTO_IDENTIDAD')} ocupado={subiendo === 'DOCUMENTO_IDENTIDAD'} onSubir={() => subir('DOCUMENTO_IDENTIDAD')} />
      ) : (
        <>
          <Segmentos opciones={MODOS} activa={modo} onCambiar={setModo} margen={0} />
          {modo === 'uno' ? (
            <Casilla rotulo="Documento completo (las dos caras)" doc={doc('DUI_COMPLETO')} ocupado={subiendo === 'DUI_COMPLETO'} onSubir={() => subir('DUI_COMPLETO')} />
          ) : (
            <>
              <Casilla rotulo="Frente" doc={doc('DUI_FRENTE')} ocupado={subiendo === 'DUI_FRENTE'} onSubir={() => subir('DUI_FRENTE')} />
              <Casilla rotulo="Reverso" doc={doc('DUI_REVERSO')} ocupado={subiendo === 'DUI_REVERSO'} onSubir={() => subir('DUI_REVERSO')} />
            </>
          )}
        </>
      )}
      {leyendo ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Nota texto="Leyendo el documento…" /></View>
      ) : null}
      {falloLectura && !leyendo ? <Nota tono="cuidado" texto={falloLectura} /> : null}
      {caras && !leyendo && !falloLectura ? <Nota tono={caras.grave ? 'cuidado' : null} texto={caras.texto} /> : null}
      {lectura && !leyendo ? (
        <View style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: dudoso ? `${MARCA.ambar}1F` : `${MARCA.verde}1F` }}>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
            {lectura.aplicados > 0 ? `Se completaron ${lectura.aplicados} dato${lectura.aplicados === 1 ? '' : 's'} con el documento.`
              : lectura.camposLeidos === 0 ? 'El documento no aportó ningún dato. Vuelve a subirlo —o escribe los campos a mano.'
                : 'Lo que dice el documento ya estaba escrito en la ficha.'}
          </Text>
          {lectura.reemplazos.length ? (
            <>
              <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>El documento sustituyó lo que había</Text>
              {lectura.reemplazos.map((d) => (
                <Text key={d.campo} style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  <Text style={{ fontWeight: '700', color: colorSistema.texto }}>{d.rotulo}: </Text>
                  <Text style={{ textDecorationLine: 'line-through' }}>{d.actual}</Text>{' → '}
                  <Text style={{ fontWeight: '700', color: colorSistema.texto }}>{d.documento}</Text>
                </Text>
              ))}
              <Enlace texto="Dejar lo que estaba" onPress={dejarLoQueEstaba} />
            </>
          ) : null}
          {lectura.numeroIlegible ? <Nota texto="El número no se leyó bien —el dígito verificador no cuadra—: escríbelo a mano." /> : null}
          {lectura.descartados.map((d) => <Nota key={d} texto={`No se usó el ${d}: no coincide con ninguna opción del portal.`} />)}
          <Pressable onPress={() => setLectura(null)} hitSlop={8}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Entendido</Text></Pressable>
        </View>
      ) : null}
    </Seccion>
  );
}
