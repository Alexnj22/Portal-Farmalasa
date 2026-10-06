// Las pestañas secundarias de Promociones en la app — Descuentos, Excedentes y
// Pagos —, con los mismos datos que el portal (`TabDescuentos`, `TabExcedentes`,
// `TabPagos`). Descuentos y Pagos se miran; un excedente se aprueba o se niega
// con `decidirExcedente`, la misma llamada del portal (negar exige el motivo,
// como lo exige la base).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchDescuentos } from '@nucleo/data/descuentos';
import { decidirExcedente, fetchExcedentes } from '@nucleo/data/promociones';
import { fetchPagosBonoProducto } from '@nucleo/data/bonosProducto';
import { estadoDescuento, fmtMoneda, fmtUnidades, fmtVigencia, mensajeDeCarga } from '@nucleo/utils/promocionesUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';

const Vacio = ({ texto }) => <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>{texto}</Text>;
const Tarjeta = ({ children }) => <View style={{ marginHorizontal: 16 }}><Vidrio radio={18}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio></View>;

// ── Descuentos: lo que baja el precio en la caja ────────────────────────────
export function Descuentos({ busqueda, salaDe }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchDescuentos().then((d) => { if (vivo) setDatos(d.descuentos); }).catch((e) => { if (vivo) { setError(mensajeDeCarga(e, 'No se pudieron cargar los descuentos.')); setDatos([]); } });
    return () => { vivo = false; };
  }, []);
  const hoy = hoySV();
  const filas = useMemo(() => (datos || []).filter((d) => !busqueda || tokenMatch(busqueda, d.descripcion, ...(d.productos || []).map((p) => p.nombre))), [datos, busqueda]);
  if (datos == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const n = (f) => filas.filter(f).length;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Percent" rotulo="Descontando" valor={String(n((d) => d.inicio <= hoy && d.fin >= hoy))} color={MARCA.verde} />
        <Kpi icono="CalendarClock" rotulo="Programados" valor={String(n((d) => d.inicio > hoy))} color={MARCA.azulClaro}
          apoyo={`${n((d) => d.fin < hoy)} terminados`} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.map((d) => {
        const e = estadoDescuento(d, hoy);
        const productos = d.productos || [];
        return (
          <Tarjeta key={d.id ?? `${d.descripcion}-${d.inicio}`}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{d.descripcion}</Text>
              <Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[fmtVigencia(d.inicio, d.fin), d.todas_las_salas ? 'Todas las salas' : salaDe(d.branch_id), `${productos.length} producto${productos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </Text>
            {productos.slice(0, 6).map((p) => (
              <Text key={p.id ?? p.nombre} style={{ color: colorSistema.texto, fontSize: 13 }}>
                {`· ${p.nombre}${p.precio != null ? ` — ${formatMoney(p.precio)}` : ''}`}
              </Text>
            ))}
            {productos.length > 6 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`y ${productos.length - 6} más`}</Text> : null}
          </Tarjeta>
        );
      })}
      {!filas.length && !error ? <Vacio texto={busqueda ? 'Ningún descuento con esa búsqueda' : 'Sin descuentos'} /> : null}
    </>
  );
}

// ── Excedentes: lo vendido por encima del lote ──────────────────────────────
export function Excedentes({ busqueda, puedeAprobar }) {
  const [todas, setTodas] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const cargar = useCallback(() => fetchExcedentes('por_decidir').then(setTodas).catch((e) => { setError(mensajeDeCarga(e, 'No se pudieron cargar los excedentes.')); setTodas([]); }), []);
  useEffect(() => { cargar(); }, [cargar]);
  const filas = useMemo(() => (todas || []).filter((f) => !busqueda || tokenMatch(busqueda, f.persona, f.promocion, f.producto, f.sala)), [todas, busqueda]);
  const total = filas.reduce((a, f) => a + (Number(f.monto) || 0), 0);
  const personas = new Set(filas.map((f) => f.persona)).size;

  const decidir = async (f, aprobar, motivo) => {
    setOcupado(f.id);
    try {
      await decidirExcedente(f.id, aprobar, motivo);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(aprobar ? 'Excedente aprobado' : 'Excedente negado', aprobar ? 'Suma a lo de esa persona.' : 'Queda el motivo para quien vendió.');
      setTodas((xs) => (xs || []).filter((x) => x.id !== f.id));
    } catch (e) {
      fallo('No se pudo registrar la decisión', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(null);
    }
  };
  const aprobar = (f) => Alert.alert('Aprobar el excedente', `${shortEmployeeName(f.persona)} cobra ${fmtMoneda(f.monto)} por ${fmtUnidades(f.unidades)} unidades de más. No está acordado con el laboratorio.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Aprobar', onPress: () => decidir(f, true, null) },
  ]);
  const negar = (f) => Alert.prompt('Negar el excedente', 'El motivo es obligatorio: es lo único que le queda a quien vendió para reclamar.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Negar', style: 'destructive', onPress: (m) => { const t = String(m ?? '').trim(); if (!t) { fallo('Falta el motivo', ''); return; } decidir(f, false, t); } },
  ], 'plain-text');

  if (todas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {filas.length ? (
        <FilaDeKpis>
          <Kpi icono="Package" rotulo="Por decidir" valor={String(filas.length)} color={MARCA.ambar} pide
            apoyo={`${fmtUnidades(filas.reduce((a, f) => a + (Number(f.unidades) || 0), 0))} unidades de más`} />
          <Kpi icono="DollarSign" rotulo="Serían" valor={fmtMoneda(total)} color={MARCA.azulClaro} apoyo={`${personas} persona${personas === 1 ? '' : 's'}`} />
        </FilaDeKpis>
      ) : null}
      {filas.length ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto="Ese bono no está acordado con el laboratorio: no se paga hasta que alguien lo apruebe, y mientras tanto no suma a lo de nadie." />
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.map((f) => (
        <Tarjeta key={f.id}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{shortEmployeeName(f.persona)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[f.sala, f.promocion].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={{ color: MARCA.azulClaro, fontSize: 17, fontWeight: '800' }}>{fmtMoneda(f.monto)}</Text>
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{f.producto}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fmtUnidades(f.unidades)} de más${f.lote_total != null ? ` · lote ${fmtUnidades(f.lote_total)}` : ''}`}</Text>
          {puedeAprobar ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable disabled={ocupado === f.id} onPress={() => aprobar(f)} style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.verde, opacity: ocupado === f.id ? 0.5 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Aprobar</Text>
              </Pressable>
              <Pressable disabled={ocupado === f.id} onPress={() => negar(f)} style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: MARCA.rojo, opacity: ocupado === f.id ? 0.5 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Negar</Text>
              </Pressable>
            </View>
          ) : null}
        </Tarjeta>
      ))}
      {!filas.length && !error ? <Vacio texto={busqueda ? 'Ningún excedente con esa búsqueda' : 'Sin excedentes por decidir'} /> : null}
    </>
  );
}

// ── Pagos: el bono de las promociones terminadas ────────────────────────────
const PAGADO = new Set(['pagado', 'fuera_del_portal']);
const tienePendiente = (p) => (p.salas || []).some((s) => Number(s.pendientes) > 0);

export function Pagos({ busqueda, soloPendientes }) {
  const [todas, setTodas] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchPagosBonoProducto().then((d) => { if (vivo) setTodas(d); }).catch((e) => { if (vivo) { setError(mensajeDeCarga(e, 'No se pudieron cargar los pagos.')); setTodas([]); } });
    return () => { vivo = false; };
  }, []);
  const promos = useMemo(() => (todas || []).filter((p) => (!soloPendientes || tienePendiente(p)) && (!busqueda || tokenMatch(busqueda, p.promocion))), [todas, busqueda, soloPendientes]);
  if (todas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const pendiente = promos.reduce((a, p) => a + (p.salas || []).reduce((b, s) => b + Number(s.total || 0) - Number(s.pagado || 0), 0), 0);
  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto="El bono de los vendedores se paga en «Mi caja» de cada sala; el de bodega, desde la caja de Salud 3; el de administración va a la planilla." />
      </View>
      {promos.length ? (
        <FilaDeKpis>
          <Kpi icono="Wallet" rotulo="Por pagar en salas" valor={fmtMoneda(pendiente)} color={pendiente > 0 ? MARCA.ambar : MARCA.verde} pide={pendiente > 0} apoyo={`${promos.length} promoción${promos.length === 1 ? '' : 'es'}`} />
        </FilaDeKpis>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {promos.map((p) => (
        <Tarjeta key={p.promocion_id}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.promocion}</Text>
          {(p.salas || []).map((s, i) => (
            <View key={s.branch_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{s.sala}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${s.personas} persona${Number(s.personas) === 1 ? '' : 's'} · bono ${fmtMoneda(s.total)} · pagado ${fmtMoneda(s.pagado)}`}</Text>
              </View>
              <Pildora texto={Number(s.pendientes) > 0 ? `${s.pendientes} por pagar` : 'Pagado'} color={Number(s.pendientes) > 0 ? MARCA.ambar : MARCA.verde} />
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 12, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12 }}>
              {`Bodega (sale de Salud 3): ${fmtMoneda(p.bodega?.monto)}${p.bodega && Number(p.bodega.monto) > 0 ? (PAGADO.has(p.bodega.estado) ? ' · pagado' : ' · por pagar') : ''}`}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Administración (planilla): ${fmtMoneda(p.administracion)}`}</Text>
          </View>
        </Tarjeta>
      ))}
      {!promos.length && !error ? <Vacio texto={busqueda ? 'Ningún pago con esa búsqueda' : soloPendientes ? 'Sin pagos pendientes' : 'Sin promociones con bono terminadas'} /> : null}
    </>
  );
}
