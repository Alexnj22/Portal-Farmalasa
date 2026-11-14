// Cumplimiento sanitario, NATIVO — gemelo de `src/views/CumplimientoView.jsx`
// (2026-11-13, «dejemos TODO completamente nativo»). Lo que la norma pide
// llevar en cada sala:
//
//   · Resumen: por sala, qué está al día y qué no; tocar un pendiente lleva a
//     donde se resuelve (`pendientesDeSala`, núcleo).
//   · Vencimientos: permisos, credenciales, contratos y extintores del
//     expediente, ordenados por fecha (`calendarioDeVencimientos`).
//   · Registros: farmacovigilancia, bajas y destrucción, retiros de lote,
//     autoinspección y capacitación — con un subfiltro por tema, como las
//     pestañas del portal. Se crean, se corrigen mientras están abiertos, se
//     cierran, se anulan con motivo y se imprimen (el papel lleva la firma y
//     el sello: `htmlDelRegistro`, el mismo del portal).
//   · Acreditaciones: quién atiende el mostrador y si tiene su acreditación.
//   · Mercado (2026-11-14): la pareja de cada producto con el catálogo de la
//     SRS para la Captura de Datos de Mercado — confirmar, elegir otra de las
//     opciones del emparejador, marcar «no es medicamento» o deshacer. La
//     búsqueda libre en el catálogo queda en el portal.
//
// Mismos permisos que el portal (`cumplimiento_tab_*`); la base vuelve a
// decidir en cada llamada. Quien ve una sola sala no elige sala.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  anularRegistroDeCumplimiento, fetchDependientesDeSala, fetchRegistrosDeCumplimiento, fetchResumenDeCumplimiento, mensajeDeCumplimiento,
} from '@nucleo/data/cumplimiento';
import {
  REGISTROS_DE_CUMPLIMIENTO, TIPOS, calendarioDeVencimientos, camposAlCerrar, estadoDelPlazo, pendientesDeSala, resumenDelRegistro, tonoDeVencimiento,
} from '@nucleo/utils/cumplimiento';
import { htmlDelRegistro } from '@nucleo/utils/papelDeCumplimiento';
import { documentosDeSucursal } from '@nucleo/utils/expedienteDeSucursal';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { registrarEgreso } from '@nucleo/data/egreso';
import { fetchParejasSrs, mensajeDeDatosMercado, revisarParejaSrs } from '@nucleo/data/datosMercadoSrs';
import { coincide } from '@nucleo/utils/busqueda';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Segmentos from '../componentes/Segmentos';
import Subfiltro from '../componentes/Subfiltro';
import FijoArriba from '../componentes/FijoArriba';
import Refrescar from '../componentes/Refrescar';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { ofrecerPapel } from '../componentes/pdf';
import { guardar as dejar } from '../componentes/comercial/elegido';

const VACIO = [];
const TONO = { danger: MARCA.rojo, warning: MARCA.ambar, get info() { return MARCA.azulClaro; }, success: MARCA.verde, neutral: MARCA.gris };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TEMAS = [
  { id: 'farmacovigilancia', label: 'Farmacovigilancia' },
  { id: 'vencidos', label: 'Bajas' },
  { id: 'retiros', label: 'Retiros' },
  { id: 'autoinspeccion', label: 'Autoinspección' },
  { id: 'capacitacion', label: 'Capacitación' },
];

function Tarjeta({ children, apagada }) {
  return (
    <View style={{ marginHorizontal: 16, opacity: apagada ? 0.6 : 1 }}>
      <Vidrio><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio>
    </View>
  );
}

function Accion({ texto, color = MARCA.azulClaro, onPress }) {
  return (
    <Tocable accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${color}2E` }}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
}

function Resumen({ temas, onIr, recarga }) {
  const [salas, setSalas] = useState(null);
  const [error, setError] = useState(null);
  const hoy = hoySV();
  useEffect(() => {
    let vivo = true;
    fetchResumenDeCumplimiento().then(({ salas: s, error: e }) => {
      if (!vivo) return;
      setError(e ? mensajeDeCumplimiento(e) : null);
      setSalas(s);
    });
    return () => { vivo = false; };
  }, [recarga]);
  if (!salas && !error) return <Cargando />;
  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!salas.length) return <Vacio titulo="Sin salas para revisar" />;
  return salas.map((s) => {
    const renglones = pendientesDeSala(s, hoy, (f) => fechaTexto(f)).filter((x) => temas.has(x.tab));
    const grave = renglones.some((x) => x.tono === 'danger');
    return (
      <Tarjeta key={s.branch_id}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{s.sala}</Text>
          <Pildora texto={renglones.length ? `${renglones.length} pendiente${renglones.length === 1 ? '' : 's'}` : 'Al día'}
            color={grave ? MARCA.rojo : renglones.length ? MARCA.ambar : MARCA.verde} />
        </View>
        {!renglones.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Todo lo que se lleva en el portal está al día.</Text> : null}
        {renglones.map((x) => (
          <Tocable key={x.texto} onPress={() => { Haptics.selectionAsync().catch(() => {}); onIr(x.tab, s.branch_id); }}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 44, paddingVertical: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: TONO[x.tono] }} />
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{x.texto}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
          </Tocable>
        ))}
      </Tarjeta>
    );
  });
}

function Vencimientos({ branches, sala }) {
  const hoy = hoySV();
  const filas = useMemo(() => calendarioDeVencimientos(
    (branches || []).filter((b) => !sala || String(b.id) === String(sala)), documentosDeSucursal, hoy,
  ), [branches, sala, hoy]);
  const grupos = useMemo(() => {
    const g = new Map();
    for (const f of filas) {
      const clave = f.dias < 0 ? 'vencido' : f.vence.slice(0, 7);
      if (!g.has(clave)) g.set(clave, []);
      g.get(clave).push(f);
    }
    return [...g.entries()];
  }, [filas]);
  if (!filas.length) return <Vacio titulo="Sin fechas de vencimiento" detalle="Las fechas se anotan en el expediente de cada sucursal." />;
  return grupos.map(([clave, lista]) => {
    const [a, m] = clave.split('-').map(Number);
    return (
      <View key={clave} style={{ gap: 8 }}>
        <Text style={{ marginHorizontal: 20, marginTop: 4, color: clave === 'vencido' ? MARCA.rojo : colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>
          {clave === 'vencido' ? 'Ya vencidos' : `${MESES[m - 1]} de ${a}`}
        </Text>
        {lista.map((f) => (
          <Tarjeta key={`${f.branchId}-${f.docId}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.documento}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${f.sala} · vence el ${fechaTexto(f.vence, { day: '2-digit', month: 'long', year: 'numeric' })}`}</Text>
              </View>
              <Pildora texto={f.dias < 0 ? `Venció hace ${-f.dias} d` : f.dias === 0 ? 'Vence hoy' : `Faltan ${f.dias} d`} color={TONO[tonoDeVencimiento(f.dias)]} />
            </View>
          </Tarjeta>
        ))}
      </View>
    );
  });
}

function Dependientes({ sala, recarga }) {
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!sala) return undefined;
    let vivo = true;
    setPersonas(null);
    fetchDependientesDeSala(sala).then(({ personas: p, error: e }) => {
      if (!vivo) return;
      setError(e ? mensajeDeCumplimiento(e) : null);
      setPersonas(p);
    });
    return () => { vivo = false; };
  }, [sala, recarga]);
  if (!sala) return <Vacio titulo="Elige una sala" detalle="En el filtro de arriba, para ver a su personal de mostrador." icono="Filtro" />;
  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!personas) return <Cargando />;
  if (!personas.length) return <Vacio titulo="Sin personal de mostrador en esta sala" />;
  const faltan = personas.filter((p) => !p.acreditado && !p.practicante).length;
  return (
    <>
      {faltan ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${faltan} persona${faltan === 1 ? '' : 's'} sin acreditación. Se carga en Personal → la persona → Acreditaciones.`} /></View> : null}
      {personas.map((p) => (
        <Tarjeta key={p.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar empleado={{ id: p.id, name: p.nombre, photo: p.foto }} tamano={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName({ name: p.nombre })}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{p.cargo}</Text>
            </View>
            {p.acreditado
              ? <Pildora texto={p.carne ? 'Acreditado' : 'Acreditado, falta el carné'} color={MARCA.verde} />
              : <Pildora texto="Sin acreditación" color={p.practicante ? MARCA.gris : MARCA.rojo} />}
          </View>
        </Tarjeta>
      ))}
    </>
  );
}

function Registros({ tema, sala, nombreSala, puedeEditar, retiroATodas, recarga }) {
  const def = REGISTROS_DE_CUMPLIMIENTO[tema];
  const claves = useMemo(() => def.tipos.map((t) => t.tipo), [def]);
  const [registros, setRegistros] = useState(null);
  const [error, setError] = useState(null);
  const [vuelta, setVuelta] = useState(0);
  const hoy = hoySV();
  useEffect(() => {
    let vivo = true;
    setRegistros(null);
    fetchRegistrosDeCumplimiento({ tipos: claves, branchId: sala || null }).then(({ registros: r, error: e }) => {
      if (!vivo) return;
      setError(e ? mensajeDeCumplimiento(e) : null);
      setRegistros(r);
    });
    return () => { vivo = false; };
  }, [claves, sala, recarga, vuelta]);

  const abrir = (params) => {
    Haptics.selectionAsync().catch(() => {});
    dejar('cumplimiento-registro', params);
    router.push('/cumplimiento-registro');
  };
  const imprimir = (r) => ofrecerPapel({
    html: htmlDelRegistro(r),
    nombre: `${TIPOS[r.tipo]?.corto ?? 'Registro'} ${r.sala ?? ''} ${r.fecha ?? ''}`.trim(),
    titulo: TIPOS[r.tipo]?.titulo ?? 'El papel',
    alTerminar: (via) => registrarEgreso('cumplimiento', { formato: 'pdf', filas: 1, detalle: { tipo: r.tipo, id: r.id, branch_id: r.branch_id, via: `app-${via}` } }),
    alFallar: (e) => fallo('No se pudo preparar el papel', mensajeDeCumplimiento(e)),
  });
  const anular = (r) => Alert.prompt('Anular registro', 'El registro no se borra: queda anulado con este motivo.', [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Anular', style: 'destructive', onPress: async (motivo) => {
        if (!String(motivo || '').trim()) { fallo('Falta el motivo', 'Escribe por qué se anula.'); return; }
        const { error: e } = await anularRegistroDeCumplimiento(r.id, motivo.trim());
        if (e) { fallo('No se pudo anular', mensajeDeCumplimiento(e)); return; }
        listo('Registro anulado', r.sala);
        setVuelta((v) => v + 1);
      },
    },
  ], 'plain-text');

  const abiertos = (registros || []).filter((r) => r.estado === 'abierto' && !r.anulado_at).length;
  return (
    <>
      <View style={{ marginHorizontal: 16 }}><Aviso texto={def.aviso} /></View>
      {puedeEditar ? (
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          {def.tipos.map((t) => (
            <BotonGrande key={t.tipo} texto={t.boton} borde={!t.principal} color={MARCA.azul} deshabilitado={!sala}
              onPress={() => abrir({ tipo: t.tipo, modo: 'crear', branchId: sala, sala: nombreSala })} />
          ))}
          {retiroATodas ? <BotonGrande texto="Avisar retiro a todas las salas" borde color={MARCA.azulClaro} onPress={() => abrir({ tipo: 'retiro', modo: 'crear', aTodas: true })} /> : null}
          {!sala ? <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>Para anotar, elige una sala en el filtro.</Text> : null}
          {abiertos ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${abiertos} abierto${abiertos === 1 ? '' : 's'}`}</Text> : null}
        </View>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {!registros && !error ? <Cargando /> : null}
      {registros && !registros.length && !error ? <Vacio titulo={def.vacio?.titulo || 'Sin registros'} detalle={def.vacio?.subtitulo} /> : null}
      {(registros || []).map((r) => {
        const plazo = estadoDelPlazo(r, hoy);
        const abierto = r.estado === 'abierto' && !r.anulado_at;
        const seCierra = camposAlCerrar(r.tipo).length > 0;
        return (
          <Tarjeta key={r.id} apagada={!!r.anulado_at}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{TIPOS[r.tipo]?.corto}</Text>
              <Pildora texto={plazo.texto} color={TONO[plazo.tono]} />
              {!sala ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{r.sala}</Text> : null}
            </View>
            {resumenDelRegistro(r) ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{resumenDelRegistro(r)}</Text> : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {[fechaTexto(r.fecha, { day: '2-digit', month: 'short', year: 'numeric' }),
                r.registrado_por_nombre && `anotó ${shortEmployeeName({ name: r.registrado_por_nombre })}`,
                r.cerrado_por_nombre && `cerró ${shortEmployeeName({ name: r.cerrado_por_nombre })}`].filter(Boolean).join(' · ')}
            </Text>
            {r.anulado_at ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Anulado: ${r.anulado_motivo}`}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <Accion texto="Imprimir" onPress={() => imprimir(r)} />
              {puedeEditar && abierto && seCierra ? (
                <Accion texto={r.tipo === 'farmacovigilancia' ? 'Notificada' : 'Cerrar'} color={MARCA.verde}
                  onPress={() => abrir({ tipo: r.tipo, modo: 'cerrar', registro: r, branchId: r.branch_id, sala: r.sala })} />
              ) : null}
              {puedeEditar && abierto ? (
                <Accion texto="Corregir" onPress={() => abrir({ tipo: r.tipo, modo: 'crear', registro: r, branchId: r.branch_id, sala: r.sala })} />
              ) : null}
              {puedeEditar && !r.anulado_at ? <Accion texto="Anular" color={MARCA.rojo} onPress={() => anular(r)} /> : null}
            </View>
          </Tarjeta>
        );
      })}
    </>
  );
}

const GRUPOS_MERCADO = [
  { id: 'alta', label: 'Alta' },
  { id: 'media', label: 'Media' },
  { id: 'baja', label: 'Baja' },
  { id: 'sin_pareja', label: 'Sin pareja' },
  { id: 'confirmados', label: 'Confirmados' },
  { id: 'no_aplica', label: 'No es medicamento' },
];
const POR_PAGINA = 40;

function grupoDeMercado(f) {
  if (f.estado === 'confirmado') return 'confirmados';
  if (f.estado === 'no_aplica') return 'no_aplica';
  if (!f.crp) return 'sin_pareja';
  return f.confianza === 'alta' ? 'alta' : f.confianza === 'media' ? 'media' : 'baja';
}

function Mercado({ puedeEditar, texto, recarga }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [grupo, setGrupo] = useState('alta');
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const [masivo, setMasivo] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetchParejasSrs().then(({ filas: f, error: e }) => {
      if (!vivo) return;
      setError(e ? mensajeDeDatosMercado(e) : null);
      if (!e) setFilas(f);
    });
    return () => { vivo = false; };
  }, [recarga]);

  const conteo = useMemo(() => {
    const c = { alta: 0, media: 0, baja: 0, sin_pareja: 0, confirmados: 0, no_aplica: 0 };
    for (const f of filas ?? VACIO) c[grupoDeMercado(f)] += 1;
    return c;
  }, [filas]);
  const lista = useMemo(() => (filas ?? VACIO)
    .filter((f) => grupoDeMercado(f) === grupo)
    .filter((f) => coincide(texto, f.nombre, f.laboratorio, f.nombre_srs, f.crp)), [filas, grupo, texto]);

  const reemplazar = (fila) => setFilas((prev) => prev.map((f) => (f.product_id === fila.product_id ? { ...f, ...fila } : f)));
  const decidir = async (f, estado, producto = null) => {
    const { fila, error: e } = await revisarParejaSrs(f.product_id, estado, producto);
    if (e) { fallo('No se guardó', mensajeDeDatosMercado(e)); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    reemplazar(fila);
    useStaffStore.getState().appendAuditLog('SRS_MERCADO_PAREJA', String(f.product_id), { producto: f.nombre, estado, crp: fila?.crp ?? null, via: 'app' });
  };
  const elegirOtro = (f) => {
    const alts = (Array.isArray(f.alternativas) ? f.alternativas : VACIO).slice(0, 2);
    if (!alts.length) { fallo('Sin otras opciones', 'Búscalo en el catálogo desde el portal: Cumplimiento → Datos de mercado.'); return; }
    Alert.alert('Elegir otro producto', f.nombre, [
      ...alts.map((a) => ({ text: `${a.nombre_comercial} · ${a.presentacion}`.slice(0, 90), onPress: () => decidir(f, 'confirmado', a) })),
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };
  const confirmarAltas = () => {
    const pendientes = (filas ?? VACIO).filter((f) => grupoDeMercado(f) === 'alta');
    Alert.alert(`¿Confirmar ${pendientes.length} productos?`, 'Se confirman todas las parejas de confianza alta. Cualquiera se puede deshacer después.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar', onPress: async () => {
          const cola = [...pendientes];
          let hechos = 0;
          let fallas = 0;
          setMasivo(`0 de ${pendientes.length}`);
          const trabajar = async () => {
            while (cola.length) {
              const f = cola.shift();
              const { fila, error: e } = await revisarParejaSrs(f.product_id, 'confirmado');
              if (e) fallas += 1; else reemplazar(fila);
              hechos += 1;
              setMasivo(`${hechos} de ${pendientes.length}`);
            }
          };
          await Promise.all(Array.from({ length: 6 }, trabajar));
          setMasivo(null);
          useStaffStore.getState().appendAuditLog('SRS_MERCADO_CONFIRMAR_ALTAS', 'srs_mercado', { confirmadas: pendientes.length - fallas, fallas, via: 'app' });
          if (fallas) fallo('Confirmación incompleta', `${fallas} no se pudieron confirmar. Vuelve a intentar.`);
          else listo('Listo', `${pendientes.length} productos confirmados.`);
        },
      },
    ]);
  };

  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!filas) return <Cargando />;
  const opciones = GRUPOS_MERCADO.map((g) => ({ ...g, label: `${g.label} · ${conteo[g.id]}` }));
  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto={`La SRS pide cada año existencias y precio de venta de todo medicamento, por farmacia. Aquí se elige qué producto de su catálogo es cada uno nuestro. Revisados ${conteo.confirmados + conteo.no_aplica} de ${filas.length}.`} />
      </View>
      <View style={{ marginHorizontal: 16 }}>
        <Subfiltro opciones={opciones} activa={grupo} onCambiar={(g) => { setGrupo(g); setVisibles(POR_PAGINA); }} />
      </View>
      {grupo === 'alta' && puedeEditar && conteo.alta > 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto={masivo ? `Confirmando ${masivo}…` : `Confirmar las ${conteo.alta}`} color={MARCA.verde}
            deshabilitado={!!masivo} onPress={confirmarAltas} />
        </View>
      ) : null}
      {!lista.length ? <Vacio titulo={texto ? 'Nada coincide con la búsqueda' : 'No hay productos en este grupo'} /> : null}
      {lista.slice(0, visibles).map((f) => {
        const g = grupoDeMercado(f);
        const decidido = g === 'confirmados' || g === 'no_aplica';
        return (
          <Tarjeta key={f.product_id}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${f.laboratorio || 'Sin laboratorio'} · Existencia ${f.existencia}`}</Text>
            {g === 'no_aplica' ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No es medicamento: la SRS no lo pide.</Text>
              : f.crp ? (
                <View style={{ gap: 2, marginTop: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`→ ${f.nombre_srs}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{f.presentacion_srs}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${f.laboratorio_srs || '—'} · Reg. ${f.n_registro} · ${f.crp}`}</Text>
                </View>
              ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin producto de la SRS.</Text>}
            {puedeEditar ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {!decidido && f.crp ? <Accion texto="Es éste" color={MARCA.verde} onPress={() => decidir(f, 'confirmado')} /> : null}
                {!decidido || g === 'confirmados' ? <Accion texto="Elegir otro" onPress={() => elegirOtro(f)} /> : null}
                {!decidido ? <Accion texto="No es medicamento" color={MARCA.gris} onPress={() => decidir(f, 'no_aplica')} /> : null}
                {decidido ? <Accion texto="Deshacer" color={MARCA.ambar} onPress={() => decidir(f, 'propuesto')} /> : null}
              </View>
            ) : null}
          </Tarjeta>
        );
      })}
      {lista.length > visibles ? (
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto={`Ver más (${lista.length - visibles})`} borde color={MARCA.azul} onPress={() => setVisibles((v) => v + POR_PAGINA)} />
        </View>
      ) : null}
    </>
  );
}

export default function Cumplimiento() {
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const alcanceTodas = getScope?.('cumplimiento') === 'ALL';
  const miSala = salaDelUsuario(user);
  const [salaElegida, setSalaElegida] = useState('todas');
  const sala = alcanceTodas ? (salaElegida === 'todas' ? null : salaElegida) : (miSala ? String(miSala) : null);
  const salas = useMemo(() => salasDeBitacora(branches), [branches]);
  const nombreSala = salas.find((o) => o.value === String(sala))?.label || '';

  const ver = useCallback((k) => hasPermission(`cumplimiento_tab_${k}`, 'can_view'), [hasPermission]);
  const editar = (k) => hasPermission('cumplimiento', 'can_edit') && hasPermission(`cumplimiento_tab_${k}`, 'can_edit');
  const temasVisibles = useMemo(() => TEMAS.filter((t) => ver(t.id)), [ver]);
  const temas = useMemo(() => new Set([...temasVisibles.map((t) => t.id), ...(ver('dependientes') ? ['dependientes'] : [])]), [temasVisibles, ver]);
  const secciones = useMemo(() => [
    ver('resumen') && { id: 'resumen', label: 'Resumen' },
    ver('vencimientos') && { id: 'vencimientos', label: 'Fechas' },
    temasVisibles.length && { id: 'registros', label: 'Registros' },
    ver('dependientes') && { id: 'dependientes', label: 'Acreditación' },
    ver('datos_mercado') && { id: 'mercado', label: 'Mercado' },
  ].filter(Boolean), [ver, temasVisibles]);
  const [textoMercado, setTextoMercado] = useState('');
  const [elegida, setSeccion] = useState(null);
  const seccion = elegida && secciones.some((s) => s.id === elegida) ? elegida : secciones[0]?.id;
  const [temaElegido, setTema] = useState(null);
  const tema = temaElegido && temasVisibles.some((t) => t.id === temaElegido) ? temaElegido : temasVisibles[0]?.id;

  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);
  // Al volver del formulario, la lista se relee.
  useFocusEffect(useCallback(() => { setLlave((k) => k + 1); }, []));

  const irA = (t, branchId) => {
    if (alcanceTodas) setSalaElegida(String(branchId));
    if (t === 'dependientes') setSeccion('dependientes');
    else { setTema(t); setSeccion('registros'); }
  };

  const grupos = alcanceTodas && seccion !== 'resumen' && seccion !== 'mercado' ? [{
    id: 'sala', titulo: 'Sucursal', activa: salaElegida, porDefecto: 'todas', onCambiar: setSalaElegida,
    opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((o) => ({ id: o.value, label: o.label }))],
  }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Cumplimiento sanitario',
        ...(seccion === 'mercado' ? {
          headerSearchBarOptions: {
            placeholder: 'Buscar producto', hideWhenScrolling: false,
            onChangeText: (e) => setTextoMercado(e.nativeEvent.text), onCancelButtonPress: () => setTextoMercado(''),
          },
        } : {}),
      }} />
      <MenuDeFiltros grupos={grupos} />
      {secciones.length > 1 ? <FijoArriba><Segmentos activa={seccion} onCambiar={setSeccion} opciones={secciones} /></FijoArriba> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        <FiltrosActivos grupos={grupos} />
        {!seccion ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu cargo no tiene acceso a Cumplimiento." /></View>
          : seccion === 'resumen' ? <Resumen temas={temas} onIr={irA} recarga={llave} />
            : seccion === 'vencimientos' ? <Vencimientos branches={branches} sala={sala} />
              : seccion === 'dependientes' ? <Dependientes sala={sala} recarga={llave} />
                : seccion === 'mercado' ? <Mercado puedeEditar={hasPermission('cumplimiento_tab_datos_mercado', 'can_edit')} texto={textoMercado} recarga={llave} />
                : (
                  <>
                    {temasVisibles.length > 1 ? <View style={{ marginHorizontal: 16 }}><Subfiltro opciones={temasVisibles} activa={tema} onCambiar={setTema} /></View> : null}
                    <Registros key={tema} tema={tema} sala={sala} nombreSala={nombreSala} puedeEditar={editar(tema)}
                      retiroATodas={tema === 'retiros' && alcanceTodas && editar('retiros')} recarga={llave} />
                  </>
                )}
      </ScrollView>
    </>
  );
}
