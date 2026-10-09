// Efectivo de la sala, NATIVO — la pestaña «Hoy» de «Mi caja» del portal:
//
//   · las CUATRO preguntas con que se entra (¿cuánto hay?, ¿está abierta y
//     quién la abrió?, ¿se cortó y quién?, ¿alguien lo confirmó?);
//   · cómo va la sala contra la meta de hoy;
//   · el panel del día: por qué manos pasó la caja, lo vendido por forma de
//     pago y la cuenta del cajón renglón por renglón;
//   · los bonos de promoción que la sala debe;
//   · todos los movimientos del día, repartidos por el corte que los contó,
//     con quién los anotó y sus correcciones.
// Más ABRIR LA CAJA, INICIAR EL TURNO, HACER CORTE (`hacer-corte`), SACAR y
// METER DINERO y CERRAR EL DÍA. Qué se ofrece lo decide `accionDeLaCaja` del
// núcleo, en el orden del portal: sin saber si está abierta no se ofrece nada.
//
// ── El conteo a ciegas ──────────────────────────────────────────────────────
// Regla del usuario (1-sep): quien cuenta ese cajón no puede ver antes cuánto
// debería haber. Los montos son de quien mira TODAS las salas (`cortes_caja`
// con alcance ALL), igual que en el portal. Hasta esta versión la app ponía
// «$… en la caja» a cualquiera: era justo el número que el portal esconde.
//
// El estado sale de `caja_estado` (la base, ~18 ms) y DESPUÉS de pintar se le
// pregunta al sistema de la caja (`estadoDeCajaEnElOrigen`), que lo corrige:
// una lectura por vez que alguien abre la pantalla, como en el portal.
//
// Cerrar el día emite el Z y no se deshace, así que pasa por los TRES frenos
// del portal (`DialogoCerrar` de `MiCajaView`), en el mismo orden:
//   1. un corte sin resolver (ni confirmado ni descartado);
//   2. ningún corte confirmado hoy;
//   3. efectivo que entró desde el último conteo firmado (`falta_por_contar`)
//      — o que no se pudo medir, que también frena.
// El servidor los vuelve a aplicar (`hacer-corte-caja` / `operar-caja`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  abrirCaja, cerrarElDia, estadoDeCaja, estadoDeCajaEnElOrigen, fetchCorreccionesDeCaja, fetchMovimientosDelPortal, iniciarTurno,
  fetchSalidasDeSalaDelDia, fetchTiposDeSalida,
} from '@nucleo/data/bolsas';
import { fetchCortes, fetchPersonas, fetchVentasPorPago } from '@nucleo/data/cortes';
import { fetchCobrosDelPortal } from '@nucleo/data/creditos';
import { conMayuscula } from '@nucleo/utils/cajaDelDia';
import { accionDeLaCaja } from '@nucleo/utils/corteDeCaja';
import { BRANCH_A_ERP, ERP_BODEGA, ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MenuDeFiltros } from '../componentes/Filtros';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { Chip } from '../componentes/inicio/Widget';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import MetaDelDia from '../componentes/caja/MetaDelDia';
import PanelDelDia from '../componentes/caja/PanelDelDia';
import BonosPorPagar from '../componentes/caja/BonosPorPagar';
import MovimientosDelDia from '../componentes/caja/MovimientosDelDia';

// Las otras tres pestañas de Efectivo del portal, para quien puede MIRAR la
// caja (`cortes_caja`): los cortes, los días con diferencia y los movimientos.
const SECCIONES = [
  { ruta: '/cortes', titulo: 'Cortes', icono: 'Calculator', color: MARCA.azul },
  { ruta: '/caja-diferencias', titulo: 'Diferencias', icono: 'HandCoins', color: MARCA.ambar },
  { ruta: '/caja-movimientos', titulo: 'Movimientos', icono: 'ArrowLeftRight', color: MARCA.violeta },
];
function Secciones() {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {SECCIONES.map((x) => (
        <Pressable key={x.ruta} style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(x.ruta); }}>
          <Vidrio radio={18} interactivo>
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }}>
              <Chip icono={x.icono} color={x.color} tamano={32} />
              <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{x.titulo}</Text>
            </View>
          </Vidrio>
        </Pressable>
      ))}
    </View>
  );
}

const ESTADO = { PENDIENTE: ['Por confirmar', MARCA.ambar], CONFIRMADO: ['Confirmado', MARCA.verde], DESCARTADO: ['Descartado', MARCA.rojo] };
const VACIO = [];

/** Primer nombre y primer apellido, con mayúscula normal: la caja escribe
 *  «RODRIGO EDUARDO MARQUEZ» y en una tarjeta lo que se pierde es el apellido. */
const corto = (texto) => {
  const limpio = String(texto || '').trim();
  if (!limpio) return null;
  return shortEmployeeName({ name: limpio }).toLowerCase().split(/\s+/).map(conMayuscula).join(' ');
};

export default function Efectivo() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const puedeVerBolsas = hasPermission('bolsas', 'can_view');
  const puedeVerCortes = hasPermission('cortes_caja', 'can_view');
  // El conteo a ciegas: los montos sólo para quien mira todas las salas.
  const veLosMontos = getScope?.('cortes_caja') === 'ALL';
  const todas = getScope?.('caja_vales') === 'ALL';
  const miSala = String(salaDelUsuario(user) ?? '');
  const salas = (sucursales || []).filter((b) => BRANCH_A_ERP[Number(b.id)] != null && BRANCH_A_ERP[Number(b.id)] !== ERP_BODEGA)
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id));
  const [elegida, setElegida] = useState(null);
  const sala = todas ? (elegida ?? (salas.some((b) => String(b.id) === miSala) ? miSala : String(salas[0]?.id ?? ''))) : miSala;
  const nombre = salas.find((b) => String(b.id) === sala)?.name ?? '';
  const [estado, setEstado] = useState(undefined);
  const [dia, setDia] = useState({ sala: null, movimientos: VACIO, deBolsas: VACIO, cobros: VACIO, ventas: VACIO, cortes: VACIO });
  const [personas, setPersonas] = useState(() => new Map());
  const [correcciones, setCorrecciones] = useState(null);
  const [tipos, setTipos] = useState(VACIO);
  const [recargando, setRecargando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [abriendo, setAbriendo] = useState(null);
  const carga = useRef(0);

  useEffect(() => { fetchTiposDeSalida().then((t) => setTipos(t || VACIO)).catch(() => {}); }, []);

  const cargar = useCallback(async () => {
    const mia = ++carga.current;
    if (!sala) { setEstado(null); return; }
    const e = await estadoDeCaja(sala);
    if (mia !== carga.current) return;
    const vivo = e?.error ? null : e;
    const delDia = vivo?.dia || hoySV();
    const [movimientos, deBolsas, cobros, porPago, cortes] = await Promise.all([
      fetchMovimientosDelPortal(sala, delDia),
      // Sin el permiso de bolsas la policy devuelve cero filas, no un error:
      // preguntar antes separa «no hubo» de «no las puedo ver».
      puedeVerBolsas ? fetchSalidasDeSalaDelDia({ sala, dia: delDia }) : Promise.resolve(VACIO),
      fetchCobrosDelPortal({ desde: delDia, hasta: delDia, branchId: sala }),
      fetchVentasPorPago({ desde: delDia, hasta: delDia }),
      puedeVerCortes ? fetchCortes({ desde: delDia, hasta: delDia }).then((f) => (f || []).filter((c) => String(c.branch_id) === String(sala))) : Promise.resolve(VACIO),
    ]).catch(() => [VACIO, VACIO, VACIO, VACIO, VACIO]);
    if (mia !== carga.current) return;
    setEstado(e?.error ? { error: mensajeAmigable(e.error) } : e);
    setDia({
      sala, movimientos: movimientos || VACIO, deBolsas: deBolsas || VACIO, cobros: cobros || VACIO,
      ventas: (porPago || []).filter((p) => String(p.branch_id) === String(sala)), cortes: cortes || VACIO,
    });

    // Lo que no cambia ninguna cifra va después de pintar: las caras y las
    // correcciones pedidas sobre cada movimiento.
    const [quienes, corregidos] = await Promise.all([
      fetchPersonas([
        ...(movimientos || []).map((m) => m.registrado_por),
        ...(deBolsas || []).map((o) => o.registrado_por),
        ...(cobros || []).map((c) => c.abonado_por),
        ...(cortes || []).flatMap((c) => [c.resuelto_por, c.recibido_por, c.employee_id]),
      ]).catch(() => []),
      fetchCorreccionesDeCaja((movimientos || []).map((m) => m.id)).catch(() => null),
    ]);
    if (mia !== carga.current) return;
    setPersonas(new Map((quienes || []).map((q) => [q.id, q])));
    setCorrecciones(corregidos == null ? null : (corregidos || []).reduce((mapa, c) => {
      const ya = mapa.get(c.movimiento);
      if (ya) ya.push(c); else mapa.set(c.movimiento, [c]);
      return mapa;
    }, new Map()));

    // Y recién acá el sistema de la caja: su respuesta CORRIGE la tarjeta.
    const delOrigen = await estadoDeCajaEnElOrigen(sala).catch(() => ({ error: true }));
    if (mia !== carga.current || delOrigen?.error || delOrigen?.ok !== true) return;
    setEstado(delOrigen);
  }, [sala, puedeVerBolsas, puedeVerCortes]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const noSePudo = estado?.error ?? null;
  const cortes = estado?.cortes || [];
  const cortesC = cortes.filter((c) => c.tipo === 'C');
  const diaCerrado = cortes.some((c) => c.tipo === 'Z');
  const sinResolver = cortesC.filter((c) => c.estado === 'PENDIENTE');
  const sinCorte = !cortesC.some((c) => c.estado === 'CONFIRMADO');
  const falta = estado?.falta_por_contar ?? null;
  const turnoParado = estado?.abierta === true && estado?.turno_corriendo === false;
  const delDia = dia.sala === sala ? dia : { movimientos: VACIO, deBolsas: VACIO, cobros: VACIO, ventas: VACIO, cortes: VACIO };
  const ventasDelDia = delDia.ventas.reduce((n, v) => n + (Number(v.documentos) || 0), 0);
  const ultimoCorte = useMemo(() => [...delDia.cortes].filter((c) => c.tipo === 'C').pop() || null, [delDia.cortes]);
  const entregas = useMemo(() => delDia.cortes.filter((c) => c.entrega === 'RECIBIDO' || c.entrega === 'SIN_ENTREGA'), [delDia.cortes]);
  const etiquetaDe = useCallback((codigo) => tipos.find((t) => t.codigo === codigo)?.etiqueta || conMayuscula(codigo), [tipos]);
  // La lista de cortes de hoy: los de la base (con quién) si se pueden ver; si
  // no, los que trae el estado de la caja.
  const cortesDeHoy = puedeVerCortes && delDia.cortes.length ? delDia.cortes : cortes;
  const cargando = estado === undefined;

  const cerrar = () => {
    if (sinResolver.length) {
      Alert.alert(sinResolver.length === 1 ? 'Falta resolver un corte' : 'Faltan cortes por resolver',
        `${sinResolver.length === 1 ? `El corte de las ${hora12(sinResolver[0].hora)} no está` : `Quedaron ${sinResolver.length} cortes sin`} confirmar ni descartar. Los cortes del día se suman entre sí: resuélvelo antes de cerrar — el cierre no se deshace.`,
        [{ text: 'Entendido', style: 'cancel' }, { text: 'Ver el corte', onPress: () => router.push({ pathname: '/corte/[id]', params: { id: String(sinResolver[0].id), fecha: hoySV() } }) }]);
      return;
    }
    if (sinCorte) {
      Alert.alert(cortesC.length ? 'El corte no está confirmado' : 'Falta el corte',
        cortesC.length ? 'Un corte descartado o sin revisar no cuenta como conteo del día. Confírmalo antes de cerrar — el cierre no se deshace.'
          : 'Si cierras ahora, el efectivo de toda la jornada queda sin contar ni una vez, y el cierre no se deshace. Haz el corte primero.',
        cortesC.length ? [{ text: 'Entendido' }] : [{ text: 'Ahora no', style: 'cancel' }, { text: 'Hacer el corte', onPress: () => router.push({ pathname: '/hacer-corte', params: { sala } }) }]);
      return;
    }
    const noSeMidio = falta && falta.medido === false;
    const pendiente = Number(falta?.falta);
    if (noSeMidio || (Number.isFinite(pendiente) && pendiente >= 0.01)) {
      Alert.alert(noSeMidio ? 'No se pudo revisar la caja' : 'Falta contar el efectivo',
        noSeMidio ? 'No se pudo comprobar si quedó dinero sin contar. El día no se cierra sin saberlo: vuelve a intentarlo en un momento.'
          : `${falta?.desde ? `Desde el corte de las ${hora12(falta.desde)} entraron` : 'Hoy entraron'} ${formatMoney(pendiente)} que nadie ha contado. Si cierras ahora, ese dinero queda fuera de todo conteo. Haz el corte primero.`,
        noSeMidio ? [{ text: 'Entendido' }] : [{ text: 'Ahora no', style: 'cancel' }, { text: 'Hacer el corte', onPress: () => router.push({ pathname: '/hacer-corte', params: { sala } }) }]);
      return;
    }
    Alert.alert(`¿Cerrar el día en ${nombre}?`, 'Se emite el cierre (Z) y la caja no vuelve a abrir hasta mañana. No se deshace.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar el día', style: 'destructive', onPress: async () => {
        trabajando('Cerrando el día…');
        const r = await cerrarElDia(sala);
        if (r?.error) fallo('No se pudo cerrar el día', mensajeAmigable(r.error));
        else if (r?.aviso) fallo('Quedó algo pendiente', r.aviso);
        else listo('El día quedó cerrado', nombre);
        cargar();
      } },
    ]);
  };

  const accion = accionDeLaCaja({ puedeOperar, sala, noSePudo, estado: cargando ? null : estado });
  const abrir = () => {
    const monto = Number(String(abriendo || '').replace(',', '.')) || 0;
    Alert.alert(`¿Abrir la caja de ${nombre}?`, `Arranca con ${formatMoney(monto)} de efectivo.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir', onPress: async () => {
        trabajando('Abriendo la caja…');
        const r = await abrirCaja({ sala, montoApertura: monto }).catch((e) => ({ error: e }));
        if (r?.error) fallo('No se pudo abrir la caja', mensajeAmigable(r.error));
        else if (r?.aviso) fallo('La caja abrió, con un pendiente', r.aviso);
        else listo('La caja quedó abierta', nombre);
        setAbriendo(null);
        cargar();
      } },
    ]);
  };
  const iniciar = () => Alert.alert(`¿Iniciar el turno en ${nombre}?`, 'La caja sigue abierta; el turno es lo que deja vender, cortar y cerrar.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Iniciar', onPress: async () => {
      trabajando('Iniciando el turno…');
      const r = await iniciarTurno(sala).catch((e) => ({ error: e }));
      if (r?.error) fallo('No se pudo iniciar el turno', mensajeAmigable(r.error));
      else if (r?.aviso) fallo('Quedó algo pendiente', r.aviso);
      else listo('El turno quedó iniciado', nombre);
      cargar();
    } },
  ]);

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: sala, onCambiar: setElegida, opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : [];
  const abierta = estado?.abierta && !turnoParado && !noSePudo;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Efectivo', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setRecarga((n) => n + 1); await cargar(); setRecargando(false); }} />}>
        {puedeVerCortes ? <View style={{ marginHorizontal: 16 }}><Secciones /></View> : null}
        {!sala ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu usuario no tiene una sala con caja." /></View> : null}
        {nombre ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombre}</Text> : null}

        {sala ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Landmark" color={MARCA.verde}
                rotulo={veLosMontos ? 'En la caja' : 'Ventas de hoy'}
                valor={cargando || noSePudo ? '—' : veLosMontos ? (estado?.efectivo != null ? formatMoney(estado.efectivo) : '—') : String(ventasDelDia)}
                apoyo={veLosMontos ? 'lo que debería haber' : 'se cuenta al cortar'} />
              <Kpi icono={abierta ? 'Check' : noSePudo ? 'AlertTriangle' : 'Lock'} color={abierta ? MARCA.verde : MARCA.ambar} pide={!abierta && !cargando}
                rotulo={cargando ? 'La caja' : noSePudo ? 'Sin respuesta' : turnoParado ? 'Turno cerrado' : estado?.abierta ? 'Abierta' : diaCerrado ? 'Día cerrado' : 'Cerrada'}
                valor={cargando ? '—' : noSePudo ? 'No se leyó' : turnoParado ? 'Hay que iniciarlo' : estado?.abierta ? (estado.desde || 'Abierta') : diaCerrado ? 'Salió el Z' : 'Sin turno'}
                apoyo={cargando || noSePudo ? undefined : turnoParado ? 'la caja sigue abierta'
                  : estado?.abierta ? (corto(estado.quien) || 'se abrió fuera del portal')
                    : diaCerrado ? 'vuelve a abrir mañana' : 'nadie puede vender'} />
            </FilaDeKpis>
            {puedeVerCortes ? (
              <FilaDeKpis>
                <Kpi icono="Calculator" color={ultimoCorte ? MARCA.azulClaro : MARCA.ambar} pide={!ultimoCorte && !cargando}
                  rotulo="Último corte" valor={cargando ? '—' : ultimoCorte ? hora12(ultimoCorte.hora) : 'Sin cortar'}
                  apoyo={ultimoCorte ? (corto(ultimoCorte.hizo?.name) || 'se hizo desde la caja') : undefined}
                  onPress={ultimoCorte ? () => router.push({ pathname: '/corte/[id]', params: { id: String(ultimoCorte.id), fecha: ultimoCorte.fecha } }) : undefined} />
                <Kpi icono="ShieldCheck" color={ultimoCorte?.estado === 'CONFIRMADO' ? MARCA.verde : MARCA.ambar}
                  pide={!!ultimoCorte && ultimoCorte.estado !== 'CONFIRMADO'}
                  rotulo="Confirmado"
                  valor={!ultimoCorte ? '—' : ultimoCorte.estado === 'CONFIRMADO' ? 'Sí' : ultimoCorte.estado === 'DESCARTADO' ? 'Descartado' : 'Falta'}
                  apoyo={ultimoCorte?.resuelto_por ? (corto(personas.get(ultimoCorte.resuelto_por)?.name) || 'sin nombre') : ultimoCorte ? 'nadie lo ha revisado' : undefined} />
              </FilaDeKpis>
            ) : null}
          </>
        ) : null}

        <View style={{ marginHorizontal: 16, gap: 16 }}>
          {sala ? <MetaDelDia sala={sala} /> : null}

          {noSePudo ? (
            <Vidrio radio={20} tinte="rgba(240,68,56,0.12)">
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={{ color: MARCA.rojo, fontSize: 16, fontWeight: '700' }}>No se pudo leer la caja de esta sala.</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${noSePudo} — no se sabe si está abierta, así que no se ofrece ninguna acción: abrir una caja que ya está abierta la deja partida en dos.`}</Text>
                <BotonGrande texto="Volver a intentar" borde onPress={cargar} />
              </View>
            </Vidrio>
          ) : null}

          {sala && !cargando && !noSePudo ? (
            <>
              <PanelDelDia estado={estado} ventas={delDia.ventas} veLosMontos={veLosMontos} entregas={entregas} personas={personas} />
              <BonosPorPagar sala={sala} cajaAbierta={estado?.abierta === true} recarga={recarga} puedeOperar={puedeOperar} />
            </>
          ) : null}

          {cortesDeHoy.length ? (
            <Seccion titulo="Cortes de hoy">
              {cortesDeHoy.map((c, i) => {
                const [rotulo, color] = c.tipo === 'Z' ? ['Cierre (Z)', MARCA.violeta] : (ESTADO[c.estado] ?? [c.estado, MARCA.azulClaro]);
                const quien = [corto(c.hizo?.name), c.recibe?.name ? corto(c.recibe.name) : null].filter(Boolean).join(' → ');
                return (
                  <Pressable key={c.id} disabled={c.tipo !== 'C'}
                    onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha: c.fecha || hoySV() } }); }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{hora12(c.hora)}</Text>
                      {quien ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{quien}</Text> : null}
                    </View>
                    <Pildora texto={rotulo} color={color} />
                    {c.tipo === 'C' ? <Text style={{ color: colorSistema.texto2, fontSize: 17 }}>›</Text> : null}
                  </Pressable>
                );
              })}
            </Seccion>
          ) : null}

          {accion === 'abrir' ? (
            abriendo == null ? <BotonGrande texto="Abrir la caja" color={MARCA.verde} onPress={() => setAbriendo('')} /> : (
              <Seccion titulo="Abrir la caja" pie="Con cuánto efectivo arranca la caja. Si arranca en cero, déjalo vacío.">
                <Campo multiline={false} value={abriendo} onChangeText={(v) => setAbriendo(v.replace(/[^\d.,]/g, ''))}
                  keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} />
                <BotonGrande texto="Abrir" color={MARCA.verde} onPress={abrir} />
                <BotonGrande texto="Cancelar" borde onPress={() => setAbriendo(null)} />
              </Seccion>
            )
          ) : null}
          {accion === 'iniciar-turno' ? <BotonGrande texto="Iniciar el turno" color={MARCA.verde} onPress={iniciar} /> : null}
          {accion === 'operar' ? (
            <View style={{ gap: 10 }}>
              <BotonGrande texto="Hacer corte" color={MARCA.azul} onPress={() => router.push({ pathname: '/hacer-corte', params: { sala } })} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Meter dinero" color={MARCA.verde} onPress={() => router.push({ pathname: '/meter-dinero', params: { sala } })} /></View>
                <View style={{ flex: 1 }}><BotonGrande texto="Sacar dinero" color={MARCA.azul} onPress={() => router.push({ pathname: '/sacar-dinero', params: { sala } })} /></View>
              </View>
              <BotonGrande texto="Cerrar el día" borde color={MARCA.rojo} deshabilitado={!estado || !!estado.error} onPress={cerrar} />
            </View>
          ) : null}

          {sala && !cargando && !noSePudo ? (
            <MovimientosDelDia movimientos={delDia.movimientos} deBolsas={delDia.deBolsas} cobros={delDia.cobros}
              dia={estado?.dia} etiquetaDe={etiquetaDe} correcciones={correcciones} cortes={delDia.cortes}
              anotaron={personas} puedeVerBolsas={puedeVerBolsas} puedeOperar={puedeOperar}
              onCorregir={(m) => router.push({ pathname: '/corregir-movimiento', params: { sala, id: String(m.id), concepto: m.concepto || '', monto: String(m.monto ?? '') } })} />
          ) : null}

          {!puedeOperar ? <Aviso tono="nota" texto="Puedes ver el estado de la caja, pero no operarla." /> : null}
        </View>
      </ScrollView>
    </>
  );
}
