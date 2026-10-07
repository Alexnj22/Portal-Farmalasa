// Los gastos por recuperar, NATIVO — `TabGastos` del portal: lo que la empresa
// invierte y quiere que la venta devuelva, sumado a la meta de las salas.
// Acá NO se calcula nada: las cuotas vienen como el servidor las guardó, con el
// residuo del redondeo en el último mes. Agregar un gasto abre `meta-gasto`;
// quitarlo pide motivo y deja los meses ya arrancados como estaban.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { anularMetaGasto, fetchMetasGastos } from '@nucleo/data/metas';
import { resumenDeGastos, ymHoySV, ymLabel, ymLabelCorto } from '@nucleo/utils/metasUtils';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function Gastos({ canEdit, onCambio }) {
  const ymActual = ymHoySV();
  const [gastos, setGastos] = useState(null);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);
  const [ocupado, setOcupado] = useState(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    fetchMetasGastos()
      .then((gs) => { if (vivo) setGastos(gs); })
      .catch((err) => { if (vivo) { setError(mensajeAmigable(err, 'Error al cargar los gastos')); setGastos([]); } });
    return () => { vivo = false; };
  }, [intento]);

  const resumen = useMemo(() => resumenDeGastos(gastos || []), [gastos]);

  const quitar = (g) => Alert.prompt('Quitar este gasto',
    'Los meses que todavía no arrancaron vuelven a su meta anterior. Los que ya empezaron conservan su parte. ¿Por qué se quita?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Quitar', style: 'destructive', onPress: async (texto) => {
        const nota = String(texto || '').trim();
        if (!nota) { Alert.alert('Falta el motivo', 'Escribe por qué se quita el gasto.'); return; }
        setOcupado(g.id);
        try {
          const res = await anularMetaGasto({ id: g.id, nota }, { concepto: g.concepto });
          listo('Gasto quitado', res?.cuotas_anuladas
            ? `Las metas de ${res.cuotas_anuladas} mes(es) que no arrancaron volvieron a su monto anterior.`
            : 'No quedaban meses por delante, así que ninguna meta cambió.');
          onCambio?.();
          setIntento((n) => n + 1);
        } catch (err) {
          fallo('No se pudo quitar', mensajeAmigable(err));
        } finally {
          setOcupado(null);
        }
      } },
    ], 'plain-text');

  if (gastos == null) return <ActivityIndicator style={{ marginTop: 20 }} />;
  return (
    <View style={{ gap: 12 }}>
      {error ? (
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          <Aviso tono="freno" texto={error} />
          <BotonGrande texto="Reintentar" borde onPress={() => setIntento((n) => n + 1)} />
        </View>
      ) : null}
      {gastos.length ? (
        <>
          <FilaDeKpis>
            <Kpi icono="HandCoins" rotulo="Por recuperar" valor={formatMoney(resumen.porRecuperar)} color={MARCA.azulClaro}
              apoyo={`en ${resumen.cuantos} gasto${resumen.cuantos !== 1 ? 's' : ''} activo${resumen.cuantos !== 1 ? 's' : ''}`} />
            <Kpi icono="TrendingUp" rotulo="Agrega a metas" valor={formatMoney(resumen.agregaAMetas)} color={MARCA.verde} apoyo="en los meses que faltan" />
          </FilaDeKpis>
          <View style={{ marginHorizontal: 16 }}>
            <Aviso texto={`Con ganancia de ${formatPct(resumen.margen, { decimales: 0 })}: el gasto se convierte en la venta que lo devuelve.`} />
          </View>
        </>
      ) : null}
      {canEdit ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto="Agregar gasto" onPress={() => router.push('/meta-gasto')} />
        </View>
      ) : null}
      {gastos.map((g) => {
        const anulado = g.estado === 'anulado';
        const salas = g.salas || [];
        return (
          <View key={g.id} style={{ marginHorizontal: 16, opacity: anulado ? 0.7 : 1 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{g.concepto}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {`${salas.map((s) => s.sala).join(' y ')} · ${g.meses === 1 ? `se recupera en ${ymLabel(g.ym_inicio).toLowerCase()}` : `se recupera en ${g.meses} meses, desde ${ymLabel(g.ym_inicio).toLowerCase()}`}`}
                    </Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{anulado ? `Se quitó — ${g.anulado_nota || 'sin motivo anotado'}` : `Lo cargó ${g.creado_por_nombre || 'el portal'}`}</Text>
                  </View>
                  <Pildora texto={anulado ? 'Quitado' : 'Activo'} color={anulado ? colorSistema.texto2 : MARCA.verde} />
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                  {`${formatMoney(g.monto_total)} → `}<Text style={{ color: MARCA.azulClaro }}>{formatMoney(g.venta_total)}</Text>{' de meta'}
                </Text>
                {(g.cuotas || []).map((c, i) => {
                  const fuera = c.estado === 'anulada';
                  return (
                    <View key={`${c.year_month}-${c.branch_id}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 6 }}>
                      <Text style={{ width: 72, color: fuera ? colorSistema.texto2 : colorSistema.texto, fontSize: 13, fontWeight: '700', textDecorationLine: fuera ? 'line-through' : 'none' }}>{ymLabelCorto(c.year_month)}</Text>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13 }}>{c.sala}</Text>
                      <Text style={{ color: fuera ? colorSistema.texto2 : MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>
                        {fuera ? 'ya no cuenta' : `+${formatMoney(c.monto_venta)}`}
                      </Text>
                      <Text style={{ width: 92, textAlign: 'right', color: colorSistema.texto2, fontSize: 12 }}>
                        {c.monto_meta != null ? `meta ${formatMoney(c.monto_meta)}` : c.year_month <= ymActual ? 'sin meta' : 'se calcula el 25'}
                      </Text>
                    </View>
                  );
                })}
                {canEdit && !anulado ? (
                  <BotonGrande texto={ocupado === g.id ? 'Quitando…' : 'Quitar este gasto'} borde color={MARCA.rojo} onPress={() => quitar(g)} deshabilitado={ocupado != null} />
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!gastos.length && !error ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 8 }}>Sin gastos cargados.</Text> : null}
    </View>
  );
}
