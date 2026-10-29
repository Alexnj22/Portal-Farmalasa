// Los documentos del expediente DENTRO del formulario de la ficha — en el alta
// y al editar, como en el portal (`EmployeeFormModal`, pestaña Documentos).
//
// Antes vivían sólo en «Expediente», que exige una ficha ya guardada: al crear
// un empleado desde la app no había dónde subir licencias, AFP ni contrato
// (reporte de Talento Humano, 2026-10-28). Acá no se guarda nada al momento:
// todo va a `form.employee_documents` y se guarda con la ficha, igual que el
// DUI por caras y los comprobantes de Acreditaciones. En un alta el archivo
// sube a `employee-documents/unassigned` (`carpetaDeDocumentos`), la carpeta
// que usa el portal cuando todavía no hay id.
//
// Mismas secciones (`SECCIONES_DE_DOCUMENTOS`), misma regla de versiones
// (`documentoReemplazado`) y mismas hojas (`DOS_CARAS`, `VARIAS_HOJAS`) que el
// portal y que `app/empleado/expediente.js`.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { DOS_CARAS, SECCIONES_DE_DOCUMENTOS, VARIAS_HOJAS, documentoReemplazado, parcheDeArchivoNuevo,
  rotuloDelDocumento } from '@nucleo/utils/documentosDelExpediente';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Seccion } from '../../formulario/Piezas';
import { fallo } from '../../Progreso';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { CampoConRotulo, CampoFecha } from '../Formulario';
import { Enlace, Nota } from './Piezas';
import { elegirYSubir } from './documentos';

const Pildora = ({ texto, color }) => (
  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: `${color}22` }}>
    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
  </View>
);

export default function DocumentosDeLaFicha({ form, setForm, empleadoId, quien }) {
  const [subiendo, setSubiendo] = useState(null);
  const [nuevoExtra, setNuevoExtra] = useState('');
  const docs = form.employee_documents || [];
  const docDe = (cat) => docs.find((d) => d.category === cat);
  const firma = { quien: quien?.name || '', quienId: quien?.id || null, hoy: hoySV() };
  const abrir = (url) => openStoredFile(url).catch((e) => fallo('No se pudo abrir', e?.message || ''));

  const conSubida = async (clave, alSubir) => {
    setSubiendo(clave);
    try {
      const r = await elegirYSubir(empleadoId);
      if (r) alSubir(r);
    } catch (e) { fallo('No se pudo subir', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setSubiendo(null); }
  };

  const subirDocumento = (cat) => conSubida(cat, (r) => setForm((prev) => ({ ...prev,
    employee_documents: documentoReemplazado(prev.employee_documents, cat,
      parcheDeArchivoNuevo((prev.employee_documents || []).find((d) => d.category === cat), r), firma) })));

  // Las hojas que siguen a la primera no pasan por `documentoReemplazado`:
  // agregar el reverso no es reemplazar el frente (misma regla de Expediente).
  const conHojas = (lista, cat, cambiarHojas) => {
    const l = [...(lista || [])];
    const i = l.findIndex((d) => d.category === cat);
    const base = i >= 0 ? l[i] : { category: cat, title: rotuloDelDocumento(cat), file_name: '', url: null, expiry_date: '' };
    const nuevo = { ...base, hojas: cambiarHojas([...(base.hojas || [])]) };
    if (i >= 0) l[i] = nuevo; else l.push(nuevo);
    return l;
  };
  const subirHoja = (cat, idx) => conSubida(`${cat}#${idx}`, (r) => setForm((prev) => ({ ...prev,
    employee_documents: conHojas(prev.employee_documents, cat, (h) => { while (h.length <= idx) h.push({ url: null, file_name: '' }); h[idx] = r; return h; }) })));
  const quitarHoja = (cat, idx, fija) => setForm((prev) => ({ ...prev,
    employee_documents: conHojas(prev.employee_documents, cat, (h) => { if (fija) h[idx] = { url: null, file_name: '' }; else h.splice(idx, 1); return h; }) }));
  const cambiarVencimiento = (cat, fecha) => setForm((prev) => ({ ...prev,
    employee_documents: documentoReemplazado(prev.employee_documents, cat, { expiry_date: fecha }, firma) }));

  const extras = docs.filter((d) => d.category?.startsWith('EXTRA_'));
  const agregarExtra = () => {
    const titulo = nuevoExtra.trim();
    if (!titulo) { fallo('Falta el nombre', 'Escribe cómo se llama el documento.'); return; }
    conSubida('EXTRA', (r) => {
      setForm((prev) => ({ ...prev, employee_documents: [...(prev.employee_documents || []), { category: `EXTRA_${Date.now()}`, title: titulo, expiry_date: '', ...r,
        subido_por: firma.quien, subido_por_id: firma.quienId, subido_el: firma.hoy }] }));
      setNuevoExtra('');
    });
  };
  const quitarExtra = (cat) => Alert.alert('Quitar el documento', '¿Quitarlo del expediente?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: () => setForm((prev) => ({ ...prev, employee_documents: (prev.employee_documents || []).filter((d) => d.category !== cat) })) },
  ]);

  const Hoja = ({ cat, idx, rotulo, fija }) => {
    const hoja = docDe(cat)?.hojas?.[idx];
    const clave = `${cat}#${idx}`;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 12 }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }}>{`${rotulo} · ${hoja?.url ? 'cargado' : 'falta'}`}</Text>
        {hoja?.url ? <Enlace texto="Ver" onPress={() => abrir(hoja.url)} /> : null}
        <Enlace texto={subiendo === clave ? 'Subiendo…' : hoja?.url ? 'Cambiar' : 'Subir'} onPress={() => subirHoja(cat, idx)} deshabilitado={!!subiendo} />
        {hoja?.url ? <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => quitarHoja(cat, idx, fija)} /> : null}
      </View>
    );
  };

  return (
    <>
      <Nota texto="Se guardan con la ficha, al tocar el botón de abajo. El DUI se sube en Personal y los comprobantes de las juntas en Laboral." />
      {SECCIONES_DE_DOCUMENTOS.map((sec) => (
        <Seccion key={sec.id} titulo={sec.titulo} pie={sec.bajada}>
          {sec.claves.map((cat, i) => {
            const d = docDe(cat);
            const vencido = d?.expiry_date && d.expiry_date < hoySV();
            return (
              <View key={cat} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{d?.title || rotuloDelDocumento(cat)}</Text>
                  {d?.url ? <Pildora texto={vencido ? 'Vencido' : 'Cargado'} color={vencido ? MARCA.rojo : MARCA.verde} /> : <Pildora texto="Falta" color={MARCA.ambar} />}
                </View>
                <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  {d?.url ? <Enlace texto="Ver" onPress={() => abrir(d.url)} /> : null}
                  <Enlace texto={subiendo === cat ? 'Subiendo…' : d?.url ? 'Reemplazar' : 'Subir'} onPress={() => subirDocumento(cat)} deshabilitado={!!subiendo} />
                </View>
                {d?.url ? <CampoFecha rotulo="Vence" valor={d.expiry_date || ''} onCambiar={(v) => cambiarVencimiento(cat, v)} /> : null}
                {DOS_CARAS.has(cat) ? <Hoja cat={cat} idx={0} rotulo="Reverso" fija /> : null}
                {VARIAS_HOJAS.has(cat) ? (
                  <>
                    {(d?.hojas || []).map((h, k) => <Hoja key={k} cat={cat} idx={k} rotulo={`Hoja ${k + 2}`} />)}
                    {d?.url ? <Enlace texto="Agregar hoja" onPress={() => subirHoja(cat, (d?.hojas || []).length)} deshabilitado={!!subiendo} /> : null}
                  </>
                ) : null}
              </View>
            );
          })}
        </Seccion>
      ))}
      <Seccion titulo="Otros documentos">
        {extras.map((d) => (
          <View key={d.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{d.title || 'Documento'}</Text>
            {d.url ? <Enlace texto="Ver" onPress={() => abrir(d.url)} /> : null}
            <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => quitarExtra(d.category)} />
          </View>
        ))}
        <CampoConRotulo rotulo="Nombre del documento" value={nuevoExtra} onChangeText={setNuevoExtra} placeholder="Ej. Constancia de estudios" />
        <Pressable onPress={agregarExtra} disabled={!!subiendo} hitSlop={6}>
          <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{subiendo === 'EXTRA' ? 'Subiendo…' : 'Agregar documento'}</Text>
        </Pressable>
      </Seccion>
    </>
  );
}
