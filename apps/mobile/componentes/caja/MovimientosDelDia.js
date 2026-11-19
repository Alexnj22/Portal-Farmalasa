// Todo lo que movió efectivo en el día de la caja — `MovimientosDelDia` del
// portal: lo que entró y salió del cajón, lo pagado con una bolsa y los cobros
// de crédito, en UNA lista (núcleo: `lineasDelDia`), repartida por el corte que
// lo contó (`repartirPorCorte`). El tramo de arriba es lo que el próximo corte
// va a medir, y por eso lleva su suma (`netoDelTramo`).
//
// Cada movimiento dice quién lo anotó (con su cara), de dónde salió el monto,
// si alguien pidió corregirlo y en qué quedó, y se abre para ver el detalle y
// la boleta. Desde aquí, igual que en el portal, quien opera la caja puede
// pedir una corrección, reenviar con más pruebas un ingreso rechazado y mandar
// a la caja un ingreso que no llegó (`mandarALaCaja`: el servidor mira si la
// caja ya lo tiene y, si no, lo manda; nunca lo cobra dos veces).
import { useState } from 'react';
import { Alert, Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Presionable as Pressable } from '../Tocable';
import Indicador from '../Indicador';
import * as Haptics from 'expo-haptics';
import { lineasDelDia, netoDelTramo, ORIGEN_DEL_MONTO, ROTULO_DE_ORIGEN, tituloDeCorreccion } from '@nucleo/utils/cajaDelDia';
import { repartirPorCorte } from '@nucleo/utils/cortesDiagnostico';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { mandarALaCaja } from '@nucleo/data/bolsas';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fallo, listo, trabajando } from '../Progreso';
import { colorSistema } from '../Formulario';
import { Aviso, Vacio } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { Chip } from '../inicio/Widget';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { MAYUSCULAS } from '../../tema/mayusculas';

const conSigno = (n) => (n > 0.004 ? `+${formatMoney(n)}` : n < -0.004 ? `−${formatMoney(Math.abs(n))}` : formatMoney(0));
const CLASE = {
  entra: { icono: 'DollarSign', color: MARCA.verde },
  sale: { icono: 'ArrowLeftRight', color: MARCA.ambar },
  bolsa: { icono: 'Package', color: MARCA.ambar },
  get cobro() { return { icono: 'Wallet', color: MARCA.azulClaro }; },
};

function Firma({ persona, rotulo, cuando }) {
  if (!persona?.id) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Avatar empleado={persona} tamano={20} />
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
        {`${rotulo} ${shortEmployeeName(persona)}${cuando ? ` · ${hora12(cuando)}` : ''}`}
      </Text>
    </View>
  );
}

function Correccion({ dato }) {
  const pendiente = dato.estado === 'PENDING';
  const rechazada = dato.estado === 'REJECTED';
  return (
    <View style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.1)' }}>
      <Text style={{ color: pendiente ? MARCA.ambar : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{tituloDeCorreccion(dato)}</Text>
      {dato.motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${dato.motivo}»`}</Text> : null}
      <Firma persona={dato.pidio} rotulo="Lo pidió" cuando={dato.pedida_at} />
      {dato.decidio ? <Firma persona={dato.decidio} rotulo={rechazada ? 'Lo rechazó' : 'Lo aprobó'} cuando={dato.decidida_at} /> : null}
      {dato.nota_de_quien_decidio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${dato.nota_de_quien_decidio}»`}</Text> : null}
    </View>
  );
}

function Accion({ texto, color, onPress, deshabilitado = false }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button" accessibilityState={{ disabled: deshabilitado }}
      style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: `${color}26`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Movimiento({ l, corte, quien, puedeOperar, onCorregir, sala, onRecargar }) {
  const [abierto, setAbierto] = useState(false);
  const [foto, setFoto] = useState(null);       // null | 'cargando' | { url } | { error }
  const [mandando, setMandando] = useState(false);
  const [mandado, setMandado] = useState(false);
  const salaDelMovimiento = sala ?? l.movimiento?.branch_id ?? null;
  // Las mismas condiciones que el portal (`Movimiento` de MiCajaView).
  // Rechazado no es anulado: espera más pruebas y se puede volver a mandar.
  const puedeReenviar = puedeOperar && l.movimiento && !l.anulado && l.autorizacion === 'RECHAZADA';
  // Una salida sin número no se manda desde aquí: se revisa en la caja.
  const puedeMandar = puedeOperar && l.sinCaja && l.movimiento?.tipo === 'ENTRADA' && !mandado && salaDelMovimiento != null;

  const reenviar = () => router.push({ pathname: '/reenviar-ingreso', params: { id: String(l.movimiento.id), sala: String(salaDelMovimiento ?? '') } });
  const mandar = () => Alert.alert('¿Mandarlo a la caja?',
    `${l.titulo || 'Este ingreso'} · ${formatMoney(l.monto)}.\nSi la caja ya lo tiene, no se cobra dos veces.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Mandarlo', onPress: async () => {
        setMandando(true);
        trabajando('Mandándolo a la caja…');
        const r = await mandarALaCaja({ sala: salaDelMovimiento, movimiento: l.movimiento.id }).catch((e) => ({ error: e }));
        setMandando(false);
        if (r?.error) { fallo('No se pudo mandar', mensajeAmigable(r.error)); return; }
        setMandado(true);
        listo('Quedó en la caja');
        onRecargar?.();
      } },
    ]);
  const clase = l.anulado ? { icono: 'Ban', color: colorSistema.texto2 } : (CLASE[l.clase] || CLASE.entra);
  const pendiente = (l.correcciones || []).some((c) => c.estado === 'PENDING');
  const corregido = (l.correcciones || []).some((c) => c.estado !== 'PENDING' && c.estado !== 'REJECTED');
  const colorMonto = l.anulado || l.sinEfectivo ? colorSistema.texto2 : l.entra ? MARCA.verde : MARCA.ambar;
  const datos = [
    ['Hora', l.cuando ? hora12(l.cuando) : null],
    ['Tipo', l.tipoTexto || l.origen],
    ...(l.datos || []),
    ['Monto', l.montoOrigen ? ORIGEN_DEL_MONTO[l.montoOrigen] || null : null, l.montoOrigen && !['FOTO_CONFIRMADA', 'FOTO_COTEJADA'].includes(l.montoOrigen)],
    ['Corte', !corte ? 'sin cortar todavía' : corte.tipo === 'Z' ? `después del cierre · ${hora12(corte.hora)}` : `contado en el de las ${hora12(corte.hora)}`],
    ['Estado', l.anulado ? 'anulado' : null, true],
  ].filter(([, v]) => v != null && v !== '');

  const verBoleta = async () => {
    if (foto && foto !== 'cargando') { setFoto(null); return; }
    setFoto('cargando');
    try { const url = await getSignedFileUrl(l.foto); setFoto(url ? { url } : { error: true }); } catch { setFoto({ error: true }); }
  };

  return (
    <Vidrio radio={20} interactivo>
      <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto((v) => !v); }}
        accessibilityRole="button" accessibilityState={{ expanded: abierto }}
        style={({ pressed }) => ({ padding: 12, gap: 6, opacity: pressed ? 0.75 : 1 })}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Chip icono={clase.icono} color={clase.color} tamano={34} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: l.anulado ? colorSistema.texto2 : colorSistema.texto, fontSize: 15, fontWeight: '600', textDecorationLine: l.anulado ? 'line-through' : 'none' }}>
              {l.titulo || '—'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[l.cuando ? hora12(l.cuando) : null, l.origen, ...(l.detalle || [])].filter(Boolean).join(' · ')}
            </Text>
            {quien ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Avatar empleado={quien} tamano={20} />
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{shortEmployeeName(quien)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colorMonto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], textDecorationLine: l.anulado ? 'line-through' : 'none' }}>
            {`${l.entra ? '+' : '−'}${formatMoney(l.monto)}`}
          </Text>
        </View>
        {l.anulado || pendiente || corregido || l.sinEfectivo || l.sinCaja || mandado || ROTULO_DE_ORIGEN[l.montoOrigen] ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 44 }}>
            {l.anulado ? <Pildora texto="Anulado" color={colorSistema.texto2} /> : null}
            {pendiente ? <Pildora texto="Corrección pendiente" color={MARCA.ambar} /> : null}
            {!pendiente && corregido ? <Pildora texto="Corregido" color={colorSistema.texto2} /> : null}
            {l.sinEfectivo ? <Pildora texto="No entra a la caja" color={colorSistema.texto2} /> : null}
            {l.sinCaja && !mandado ? <Pildora texto="No llegó a la caja" color={MARCA.ambar} /> : null}
            {mandado ? <Pildora texto="Mandado a la caja" color={MARCA.verde} /> : null}
            {ROTULO_DE_ORIGEN[l.montoOrigen] ? <Pildora texto={ROTULO_DE_ORIGEN[l.montoOrigen]} color={MARCA.ambar} /> : null}
          </View>
        ) : null}
      </Pressable>
      {abierto ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
          {(l.correcciones || []).map((c) => <Correccion key={c.solicitud} dato={c} />)}
          {datos.map(([rotulo, valor, resalta]) => (
            <View key={rotulo} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ width: 120, color: colorSistema.texto2, fontSize: 14 }}>{rotulo}</Text>
              <Text style={{ flex: 1, color: resalta ? MARCA.ambar : colorSistema.texto, fontSize: 14, fontWeight: resalta ? '700' : '500' }}>{valor}</Text>
            </View>
          ))}
          {quien ? <Firma persona={quien} rotulo="Lo anotó" /> : null}
          {(l.reparto || []).length ? (
            <View style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.1)' }}>
              {l.reparto.map((b) => (
                <View key={b.folio} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13 }}>
                    {b.folio}<Text style={{ color: colorSistema.texto2 }}>{b.fecha ? ` · ${fechaTexto(b.fecha, { day: 'numeric', month: 'short' })}` : ''}</Text>
                  </Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(b.monto)}</Text>
                  <Text style={{ color: b.deHoy ? MARCA.ambar : colorSistema.texto2, fontSize: 13, fontWeight: b.deHoy ? '700' : '400' }}>{b.deHoy ? 'entra al corte' : 'ya cerrada'}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {l.foto ? (
            <Pressable onPress={verBoleta} accessibilityRole="button"
              style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}26`, opacity: pressed ? 0.7 : 1 })}>
              {foto === 'cargando' ? <Indicador /> : <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{foto ? 'Ocultar la boleta' : 'Ver la boleta'}</Text>}
            </Pressable>
          ) : null}
          {foto?.error ? <Aviso tono="freno" texto="No se pudo abrir la boleta. Vuelve a intentarlo." /> : null}
          {foto?.url ? <Image source={{ uri: foto.url }} resizeMode="contain" style={{ width: '100%', height: 280, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.1)' }} /> : null}
          {puedeReenviar || puedeMandar || (puedeOperar && onCorregir && l.movimiento && !l.anulado) ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {puedeReenviar ? <Accion texto="Reenviar con más pruebas" color={MARCA.azulClaro} onPress={reenviar} /> : null}
              {puedeMandar ? <Accion texto={mandando ? 'Mandando…' : 'Mandarlo a la caja'} color={MARCA.azulClaro} deshabilitado={mandando} onPress={mandar} /> : null}
              {puedeOperar && onCorregir && l.movimiento && !l.anulado ? <Accion texto="Pedir una corrección" color={MARCA.ambar} onPress={() => onCorregir(l.movimiento)} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Vidrio>
  );
}

export default function MovimientosDelDia({ movimientos, deBolsas, cobros, dia, etiquetaDe, correcciones, cortes, anotaron, puedeVerBolsas, puedeOperar = false, onCorregir, sala = null, onRecargar }) {
  const lineas = lineasDelDia({ movimientos, deBolsas, cobros, etiquetaDe, correcciones });
  if (!lineas.length && puedeVerBolsas) return null;
  const grupos = repartirPorCorte(lineas, cortes);

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: MAYUSCULAS, letterSpacing: 0.5, marginHorizontal: 4 }}>
        {`Movimientos de este día${dia ? ` · ${fechaTexto(dia, { day: 'numeric', month: 'long' })}` : ''}`}
      </Text>
      {!puedeVerBolsas ? <Aviso texto="Aquí solo ves lo que entró y salió de la caja. Para ver las salidas pagadas con una bolsa necesitas el permiso de Bolsas." /> : null}
      {!lineas.length ? <Vacio enSeccion>Todavía no se ha movido efectivo en este día.</Vacio> : null}
      {grupos.filter((g) => g.lineas.length || (!g.corte && lineas.length)).map((g) => (
        <View key={g.corte?.id ?? 'sin-cortar'} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginHorizontal: 4, marginTop: 4 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>
              {!g.corte ? 'Sin cortar todavía' : g.corte.tipo === 'Z' ? `Después del cierre del día · ${hora12(g.corte.hora)}` : `Ya contados en el corte de las ${hora12(g.corte.hora)}`}
              {g.corte?.recibe ? <Text style={{ color: colorSistema.texto2, fontWeight: '400' }}>{` · la recibió ${g.corte.recibe}`}</Text> : null}
              {g.corte?.entrega === 'SIN_ENTREGA' ? <Text style={{ color: MARCA.ambar, fontWeight: '400' }}> · se confirmó sin entregar la caja</Text> : null}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {`${g.lineas.length} ${g.lineas.length === 1 ? 'movimiento' : 'movimientos'}${!g.corte ? ` · ${conSigno(netoDelTramo(g.lineas))}` : ''}`}
            </Text>
          </View>
          {g.lineas.map((l) => <Movimiento key={l.clave} l={l} corte={g.corte} quien={anotaron?.get(l.quien)} puedeOperar={puedeOperar} onCorregir={onCorregir} sala={sala} onRecargar={onRecargar} />)}
        </View>
      ))}
    </View>
  );
}
