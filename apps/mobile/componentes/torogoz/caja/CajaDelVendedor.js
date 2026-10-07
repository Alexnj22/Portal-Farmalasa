// La caja del día de un vendedor —el `CajaDelVendedor` del portal (borrador
// 0024)—: el fondo de cambio que se le entregó, los gastos de ruta, las
// entregas parciales (el «corte» a media jornada: se cuenta y se compara con lo
// que debería tener) y el desglose de lo que tiene que entregar al liquidar.
//
// Abrir y recibir una entrega es de quien administra; el gasto lo anota el
// vendedor. El esperado de un corte lo calcula la base. Las reglas salen del
// núcleo (`distribucionCaja`). Un movimiento a medio escribir se guarda.
//
// ⚠ Abrir la caja, registrar un movimiento y anularlo mueven DINERO de verdad.
// En el entorno de pruebas no se hacen.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { abrirCaja, anularMovimientoCaja, mensajeDeDistribucion, movimientoCaja } from '@nucleo/data/distribucion';
import { leerMonto } from '@nucleo/utils/distribucionComun';
import {
  avisoDeEntrega, desgloseDeCaja, ejemploDeConcepto, movimientoListo, ROTULO_MOVIMIENTO_CAJA, tiposDeMovimiento,
} from '@nucleo/utils/distribucionCaja';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../formulario/Piezas';
import { Pildora } from '../../avisos/Piezas';
import Segmentos from '../../Segmentos';
import { MARCA } from '../../inicio/marca';
import { fallo, listo, trabajando } from '../../Progreso';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

const PETROLEO = '#0f6e7d';
const soloMonto = (v) => v.replace(',', '.').replace(/[^0-9.]/g, '');

export default function CajaDelVendedor({ liq, fecha, esHoy, puedeAdministrar, onCambio }) {
  const caja = liq?.caja;
  const e = liq?.efectivo ?? {};
  const abierta = caja?.estado === 'abierta';
  const clave = caja?.id ? `distribucion-caja-mov-${caja.id}` : null;
  const [fondo, setFondo] = useState('');
  const [notaFondo, setNotaFondo] = useState('');
  const [tipo, setTipo] = useState('gasto');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [contado, setContado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState('');

  // Un gasto o una entrega a medio escribir sobrevive a que la sesión se cierre sola.
  useEffect(() => {
    if (!clave) return;
    const b = loadDraft(clave);
    if (b && (b.monto || b.concepto)) { setTipo(b.tipo ?? 'gasto'); setMonto(b.monto ?? ''); setConcepto(b.concepto ?? ''); setContado(b.contado ?? ''); }
  }, [clave]);
  useEffect(() => { if (clave && (monto || concepto)) saveDraft(clave, { tipo, monto, concepto, contado }); }, [clave, tipo, monto, concepto, contado]);

  const tipos = tiposDeMovimiento(puedeAdministrar);
  const mov = movimientoListo({ tipo, monto, concepto, contado });
  const nFondo = leerMonto(fondo);

  const correr = async (texto, fn, ok) => {
    setOcupado(true); trabajando(texto);
    try { const r = await fn(); await ok?.(r); await onCambio?.(); }
    catch (err) { fallo('No se pudo', mensajeDeDistribucion(err)); }
    finally { setOcupado(false); }
  };
  const anotar = (accion, id, detalle) => useStaffStore.getState().appendAuditLog?.(accion, id, { ...detalle, via: 'app' });

  const abrir = () => Alert.alert('¿Abrir la caja?', `Se le entrega un fondo de cambio de ${formatMoney(nFondo ?? 0)}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Abrir caja', onPress: () => correr('Abriendo la caja…', () => abrirCaja(liq.vendedor.id, fecha, nFondo ?? 0, notaFondo.trim()), () => {
      anotar('DISTRIBUCION_CAJA_ABIERTA', liq.vendedor.id, { fecha, fondo: nFondo ?? 0 });
      listo('Caja abierta', `Fondo de cambio: ${formatMoney(nFondo ?? 0)}`);
      setFondo(''); setNotaFondo('');
    }) },
  ]);
  const registrar = () => Alert.alert(`¿Registrar ${ROTULO_MOVIMIENTO_CAJA[tipo].toLowerCase()}?`, `${formatMoney(mov.monto)} · ${concepto.trim()}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Registrar', onPress: () => correr('Registrando…', () => movimientoCaja(caja.id, tipo, mov.monto, concepto.trim(), tipo === 'entrega' ? mov.contado : null), (r) => {
      anotar('DISTRIBUCION_CAJA_MOVIMIENTO', String(r?.id ?? ''), { caja: caja.id, tipo, monto: mov.monto, concepto: concepto.trim() });
      const descuadre = tipo === 'entrega' ? avisoDeEntrega(r, mov.contado, formatMoney) : null;
      if (descuadre) fallo('Entrega registrada', descuadre);
      else listo(`${ROTULO_MOVIMIENTO_CAJA[tipo]} registrado`, formatMoney(mov.monto));
      setMonto(''); setConcepto(''); setContado('');
      clearDraft(clave);
    }) },
  ]);
  const anular = (id) => Alert.alert('¿Anular el movimiento?', 'Deja de contar en la caja del día.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: () => correr('Anulando…', () => anularMovimientoCaja(id, motivo.trim()), () => {
      anotar('DISTRIBUCION_CAJA_MOVIMIENTO_ANULADO', String(id), { motivo: motivo.trim() });
      setAnulando(null); setMotivo('');
    }) },
  ]);

  return (
    <Seccion titulo="Caja del día">
      <Pildora texto={caja ? (abierta ? `Abierta · fondo ${formatMoney(Number(caja.fondo))}` : 'Liquidada') : 'Sin abrir'}
        color={caja ? (abierta ? MARCA.verde : colorSistema.texto2) : MARCA.ambar} />

      {!caja && esHoy && puedeAdministrar ? (
        <View style={{ gap: 8 }}>
          <Campo multiline={false} value={fondo} onChangeText={(v) => setFondo(soloMonto(v))} keyboardType="decimal-pad" placeholder="Fondo de cambio $0.00" />
          {fondo !== '' && nFondo == null ? <Aviso tono="freno" texto="Escribe un monto." /> : null}
          <Campo multiline={false} value={notaFondo} onChangeText={setNotaFondo} placeholder="Nota (opcional) — monedas y billetes de $1" />
          <BotonGrande color={PETROLEO} texto="Abrir caja" deshabilitado={ocupado || (fondo !== '' && nFondo == null)} onPress={abrir} />
        </View>
      ) : !caja ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
          {`${esHoy ? 'Todavía no tiene caja: quien administra la abre al entregarle el fondo de cambio.' : 'Ese día no se abrió caja.'} Las ventas y cobros cuentan igual en la liquidación.`}
        </Text>
      ) : null}

      {caja ? (
        <View style={{ gap: 8 }}>
          {desgloseDeCaja(e).map(([r, v], i) => <Dato key={r} primero={i === 0} rotulo={r} valor={formatMoney(v)} />)}
          <Dato rotulo="En mano ahora" valor={formatMoney(Number(e.esperado))} fuerte />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Abrió ${shortEmployeeName(caja.abierta_por)} a las ${hora12(caja.abierta_at)}${caja.nota ? ` · ${caja.nota}` : ''}.`}</Text>
        </View>
      ) : null}

      {(liq?.movimientos ?? []).map((m) => (
        <View key={m.id} style={{ gap: 4, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>
              <Text style={{ fontWeight: '700' }}>{ROTULO_MOVIMIENTO_CAJA[m.tipo]}</Text>{` · ${m.concepto}`}
            </Text>
            <Text style={{ color: m.tipo === 'ingreso' ? MARCA.verde : colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {`${m.tipo === 'ingreso' ? '+' : '−'}${formatMoney(Number(m.monto))}`}
            </Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${hora12(m.hora)} · ${shortEmployeeName(m.quien)}${m.tipo === 'entrega' && m.esperado != null ? ` · al contar tenía ${formatMoney(Number(m.contado ?? 0))} de ${formatMoney(Number(m.esperado))}` : ''}`}
          </Text>
          {puedeAdministrar && abierta ? (anulando === m.id ? (
            <View style={{ gap: 8 }}>
              <Campo value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se anula?" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={() => setAnulando(null)} /></View>
                <View style={{ flex: 1 }}><BotonGrande color={MARCA.rojo} texto="Anular" deshabilitado={!motivo.trim() || ocupado} onPress={() => anular(m.id)} /></View>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => { setAnulando(m.id); setMotivo(''); }} hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>Anular</Text>
            </Pressable>
          )) : null}
        </View>
      ))}

      {abierta && esHoy && ACCIONES_DE_DINERO ? (
        <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          {tipos.length > 1 ? <Segmentos margen={14} activa={tipo} onCambiar={setTipo} opciones={tipos.map((t) => ({ id: t.value, label: t.label }))} /> : null}
          <Campo multiline={false} value={monto} onChangeText={(v) => setMonto(soloMonto(v))} keyboardType="decimal-pad" placeholder="Monto $0.00" />
          <Campo multiline={false} value={concepto} onChangeText={setConcepto} placeholder={ejemploDeConcepto(tipo)} />
          {tipo === 'entrega' ? (
            <>
              <Campo multiline={false} value={contado} onChangeText={(v) => setContado(soloMonto(v))} keyboardType="decimal-pad" placeholder="Contado en mano $0.00" />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Debería: ${formatMoney(Number(e.esperado))}`}</Text>
            </>
          ) : null}
          <BotonGrande borde color={PETROLEO} texto="Registrar" deshabilitado={!mov.listo || ocupado} onPress={registrar} />
        </View>
      ) : null}
      {/* Sólo consulta (soloConsulta.js): abrir la caja, gastos, entregas e ingresos se registran en el portal. */}
      {!ACCIONES_DE_DINERO && abierta && esHoy ? <SeHaceEnElPortal texto="Los gastos, entregas e ingresos de la caja se registran desde el portal." /> : null}
    </Seccion>
  );
}
