// Facturación · Saltos, NATIVO — `TabSaltos` del portal: los saltos de
// correlativo (números que faltan entre una factura y la siguiente) y los
// documentos con campos nulos, con sus cuatro cifras (Saltos / Sin resolver /
// Solventados / Campos nulos). Con `facturacion` editar, «Solventar» cada uno
// con un comentario opcional —la MISMA escritura del portal
// (`insertGapResolution` / `insertNullResolution`)— y el historial de lo
// solventado, este mes o todo. Qué está pendiente y la fila que se escribe
// salen del núcleo (`colasDeFacturacion`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import {
  fetchGapResolutions, fetchNullResolutionIds, fetchSalesInvoiceGaps, fetchSalesInvoiceNulls, insertGapResolution, insertNullResolution,
} from '@nucleo/data/facturacion';
import {
  claveDeSalto, correlativo7, filaDeSaltoSolventado, nulosPendientes, saltosPendientes, saltosSolventados,
} from '@nucleo/utils/colasDeFacturacion';
import { fechaTexto, relojSV } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import Tocable from '../Tocable';

const pedirComentario = (titulo, mensaje) => new Promise((resolve) => {
  Alert.prompt(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
    { text: 'Solventar', onPress: (t) => resolve(t ?? '') },
  ], 'plain-text', '');
});

export default function Saltos({ sala, nombreSala, recarga, canEdit = false, user = null }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [todos, setTodos] = useState(false);
  const cargar = useCallback(async () => {
    const [g, n, r, nr] = await Promise.all([fetchSalesInvoiceGaps(sala), fetchSalesInvoiceNulls(sala), fetchGapResolutions(), fetchNullResolutionIds()]);
    setError(g.error?.message || n.error?.message || r.error?.message || nr.error?.message || null);
    setD({ gaps: g.data || [], nulls: n.data || [], res: r.data || [], nullRes: new Set((nr.data || []).map((x) => x.null_id)) });
  }, [sala]);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const pendientes = useMemo(() => saltosPendientes(d?.gaps, d?.res), [d]);
  const nulos = useMemo(() => nulosPendientes(d?.nulls, d?.nullRes), [d]);
  const mes = relojSV().toISOString().slice(0, 7);
  const solventados = useMemo(() => saltosSolventados(d?.gaps, d?.res, todos ? null : mes), [d, todos, mes]);
  const quien = user?.name || user?.email || 'Desconocido';

  const solventarSalto = async (g) => {
    const comentario = await pedirComentario('Solventar el salto', `${g.tipo_documento} ${correlativo7(g.gap_from)} → ${correlativo7(g.gap_to)} en ${nombreSala(g.branch_id)}. Revisa el talonario. Comentario opcional:`);
    if (comentario == null) return;
    trabajando('Guardando…');
    const { error: e } = await insertGapResolution(filaDeSaltoSolventado(g, comentario, quien), { branch_name: nombreSala(g.branch_id), desde: 'app' });
    if (e) { fallo('No se pudo solventar', mensajeAmigable(e)); return; }
    listo('Salto solventado', `${g.tipo_documento} ${g.gap_from}–${g.gap_to}`);
    cargar();
  };
  const solventarNulo = async (n) => {
    const comentario = await pedirComentario('Solventar campos nulos', `${n.correlativo || `ID ${n.erp_invoice_id ?? n.id}`}: ${(n.campos_nulos || []).join(', ')}. Comentario opcional:`);
    if (comentario == null) return;
    trabajando('Guardando…');
    const { error: e } = await insertNullResolution({ null_id: n.id, comment: comentario.trim() || null, resolved_by: quien },
      { branch: nombreSala(n.branch_id), correlativo: n.correlativo, campos: n.campos_nulos, desde: 'app' });
    if (e) { fallo('No se pudo solventar', mensajeAmigable(e)); return; }
    listo('Campos nulos solventados', n.correlativo || '');
    cargar();
  };

  if (!d) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const accion = (texto, onPress) => (
    <Tocable onPress={onPress} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
      <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );

  return (
    <View style={{ gap: 10 }}>
      <FilaDeKpis>
        <Kpi icono="Hourglass" rotulo="Saltos" valor={String(d.gaps.length)} color={MARCA.azulClaro} apoyo={`${d.res.length} solventados`} />
        <Kpi icono="AlertTriangle" rotulo="Sin resolver" valor={String(pendientes.length)} color={pendientes.length ? MARCA.rojo : MARCA.verde} pide={pendientes.length > 0} apoyo={`${nulos.length} con campos nulos`} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {pendientes.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Cada salto indica correlativos que faltan entre dos documentos consecutivos. Solventarlo es decir que se revisó el talonario." /></View> : null}
      {pendientes.map((g) => {
        const n = Number(g.gap_count ?? (Number(g.gap_to) - Number(g.gap_from) + 1));
        return (
          <View key={claveDeSalto(g)} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} tinte="rgba(240,68,56,0.08)">
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${g.tipo_documento} · ${correlativo7(g.gap_from)} → ${correlativo7(g.gap_to)}`}</Text>
                  <Pildora texto={`${n} faltante${n === 1 ? '' : 's'}`} color={MARCA.rojo} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[nombreSala(g.branch_id), g.siguiente_correlativo ? `sigue el ${g.siguiente_correlativo}` : null].filter(Boolean).join(' · ')}</Text>
                {canEdit ? accion('Solventar', () => solventarSalto(g)) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {nulos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginHorizontal: 20, marginTop: 6 }}>{`Campos nulos · ${nulos.length}`}</Text> : null}
      {nulos.map((n) => (
        <View key={n.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${n.correlativo ?? 'Sin número'}${n.erp_invoice_id ? ` · ID ${n.erp_invoice_id}` : ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[nombreSala(n.branch_id), n.fecha ? fechaTexto(n.fecha, { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(Array.isArray(n.campos_nulos) ? n.campos_nulos : String(n.campos_nulos || '').split(',')).filter(Boolean).map((c) => <Pildora key={c} texto={String(c).trim()} color={MARCA.ambar} />)}
              </View>
              {canEdit ? accion('Solventar', () => solventarNulo(n)) : null}
            </View>
          </Vidrio>
        </View>
      ))}
      {!pendientes.length && !nulos.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin saltos ni campos nulos</Text> : null}

      {d.res.length ? (
        <View style={{ marginHorizontal: 16, gap: 8, marginTop: 8 }}>
          <Tocable onPress={() => setVerHistorial((v) => !v)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
              {`${verHistorial ? '▾' : '▸'} ${solventados.length} salto${solventados.length === 1 ? '' : 's'} solventado${solventados.length === 1 ? '' : 's'} ${todos ? 'en total' : 'este mes'}`}
            </Text>
          </Tocable>
          {verHistorial ? (
            <>
              {solventados.map((r) => (
                <Vidrio key={r.id} radio={16}>
                  <View style={{ padding: 12, gap: 3 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${r.tipo_documento} · ${nombreSala(r.branch_id)} · ${correlativo7(r.gap_from)} → ${correlativo7(r.gap_to)}`}</Text>
                    {r.comment ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${r.comment}»`}</Text> : null}
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${r.resolved_by ? shortEmployeeName({ name: r.resolved_by }) : '—'}${r.resolved_at ? ` · ${fechaHora12(r.resolved_at)}` : ''}`}</Text>
                  </View>
                </Vidrio>
              ))}
              <Tocable onPress={() => setTodos((v) => !v)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{todos ? 'Ver solo este mes' : `Ver todos (${d.res.length})`}</Text>
              </Tocable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
