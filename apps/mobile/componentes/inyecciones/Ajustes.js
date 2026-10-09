// Inyecciones · Ajustes, NATIVO — `TabAjustes` del portal:
//   · Precio por aplicación (gerencia, `inyecciones_precios`): comprada aquí o
//     traída por el cliente. Rige desde el próximo cobro.
//   · Aplicaciones por producto (supervisión, `inyecciones_dosis`): cuántas trae
//     UNA unidad suelta; mientras nadie confirma, rige la sugerencia. «Por ml»
//     para un vial que rinde según la dosis. Agregar un inyectable que el nombre
//     no delata, quitar uno que no lo es, y volver a incluir los quitados.
// Qué está sin decidir, cómo se vende y qué vale al quitar salen del núcleo
// (`inyeccionesAjustes`), los mismos del portal; las escrituras, las mismas
// funciones de la base.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  clasificarProducto, fetchCatalogoDeDosis, fetchPreciosDeAplicacion, fijarDosis, fijarPrecioDeAplicacion,
} from '@nucleo/data/inyecciones';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import {
  APLICACIONES_MAX, APLICACIONES_MIN, comoSeVende, partirCatalogoDeDosis, preciosCambiados, sinDecidirDosis, valorAlQuitar,
} from '@nucleo/utils/inyeccionesAjustes';
import { aplicacionesPorDosis, fmtMl } from '@nucleo/utils/inyeccionDosis';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { guardar } from '../comercial/elegido';
import Tocable from '../Tocable';

const audit = (...a) => useStaffStore.getState().appendAuditLog(...a);

function Precios() {
  const [precios, setPrecios] = useState(null);
  const [borrador, setBorrador] = useState({});
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    fetchPreciosDeAplicacion()
      .then((p) => { setPrecios(p); setBorrador({ COMPRADA: String(p.COMPRADA ?? ''), TRAIDA: String(p.TRAIDA ?? '') }); })
      .catch((e) => fallo('No se pudo leer el precio', mensajeAmigable(e)));
  }, []);
  const cambiados = preciosCambiados(precios, borrador);
  const invalido = cambiados.some((o) => !(Number(borrador[o]) >= 0));

  const guardarPrecio = () => Alert.alert('Guardar el precio',
    cambiados.map((o) => `${o === 'COMPRADA' ? 'Comprada aquí' : 'Traída'}: $${precios[o]} → $${Number(borrador[o])}`).join('\n') + '\nRige desde el próximo cobro.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); trabajando('Guardando…');
        try {
          for (const origen of cambiados) {
            await fijarPrecioDeAplicacion({ origen, precio: Number(borrador[origen]) });
            audit('INYECCION_PRECIO', origen, { antes: precios[origen], despues: Number(borrador[origen]), desde: 'app' });
          }
          setPrecios(await fetchPreciosDeAplicacion());
          listo('Precio guardado', 'Rige desde el próximo cobro.');
        } catch (e) { fallo('No se pudo guardar el precio', mensajeAmigable(e)); }
        setGuardando(false);
      } },
    ]);

  if (!precios) return <ActivityIndicator style={{ marginTop: 12 }} />;
  return (
    <Seccion titulo="Precio por aplicación">
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Comprada aquí ($)</Text>
      <Campo multiline={false} keyboardType="decimal-pad" value={borrador.COMPRADA ?? ''} onChangeText={(t) => setBorrador((b) => ({ ...b, COMPRADA: t.replace(',', '.') }))} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Traída por el cliente ($)</Text>
      <Campo multiline={false} keyboardType="decimal-pad" value={borrador.TRAIDA ?? ''} onChangeText={(t) => setBorrador((b) => ({ ...b, TRAIDA: t.replace(',', '.') }))} />
      <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar precio'} deshabilitado={guardando || !cambiados.length || invalido} onPress={guardarPrecio} />
    </Seccion>
  );
}

function Contador({ valor, onCambiar }) {
  const boton = (t, d, off) => (
    <Tocable disabled={off} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(valor + d); }} accessibilityLabel={d < 0 ? 'Una menos' : 'Una más'}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', opacity: off ? 0.3 : pressed ? 0.5 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600' }}>{t}</Text>
    </Tocable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {boton('−', -1, valor <= APLICACIONES_MIN)}
      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', minWidth: 24, textAlign: 'center' }}>{valor}</Text>
      {boton('+', 1, valor >= APLICACIONES_MAX)}
    </View>
  );
}

function Agregar({ filas, onElegir }) {
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 300).trim();
  const [resultados, setResultados] = useState([]);
  useEffect(() => {
    if (q.length < 2) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- búsqueda vacía
    let vivo = true;
    buscarProductosMinMax(q, 20).then((r) => { if (vivo) setResultados(r.filas || []); });
    return () => { vivo = false; };
  }, [q]);
  // Los que ya están en la lista salen igual, marcados y sin poder elegirse.
  const ya = useMemo(() => new Map((filas || []).map((f) => [String(f.erp_product_id), f.clasificacion === 'quitado' ? 'Quitado' : 'Ya está'])), [filas]);
  return (
    <Seccion titulo="Agregar un producto" pie="Para un inyectable que no aparece porque su nombre no lo dice. Queda marcado a mano.">
      <Campo multiline={false} placeholder="Buscar en el catálogo…" value={texto} onChangeText={setTexto} autoCorrect={false} />
      {resultados.map((p) => {
        const marca = ya.get(String(p.id));
        return (
          <Tocable key={p.id} disabled={!!marca} onPress={() => onElegir(p)}
            style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: marca ? 0.45 : pressed ? 0.6 : 1 })}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{p.nombre}{marca ? ` · ${marca}` : ''}</Text>
          </Tocable>
        );
      })}
    </Seccion>
  );
}

function CatalogoDeDosis({ recarga }) {
  const [filas, setFilas] = useState(null);
  const [editando, setEditando] = useState({});
  const [ocupado, setOcupado] = useState(null);
  const [soloSinConfirmar, setSoloSinConfirmar] = useState(true);
  const [agregando, setAgregando] = useState(false);
  const [verQuitados, setVerQuitados] = useState(false);
  const cargar = useCallback(() => fetchCatalogoDeDosis().then(setFilas)
    .catch((e) => { setFilas([]); fallo('No se pudo cargar el catálogo', mensajeAmigable(e)); }), []);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  const { activas, quitados, sinConfirmar } = useMemo(() => partirCatalogoDeDosis(filas), [filas]);
  const visibles = useMemo(() => activas.filter((f) => !soloSinConfirmar || sinDecidirDosis(f)), [activas, soloSinConfirmar]);
  const clave = (f) => String(f.erp_product_id);

  const clasificar = (erpProductId, esInyeccion, nombre, accion) => {
    const titulo = accion === 'agregar' ? 'Agregar como inyección' : accion === 'quitar' ? 'No es una inyección' : 'Volver a incluir';
    const texto = accion === 'quitar' ? `«${nombre}» deja de ofrecerse para cobrar la aplicación.` : `«${nombre}» se ofrece para cobrar la aplicación.`;
    Alert.alert(titulo, texto, [
      { text: 'Cancelar', style: 'cancel' },
      { text: accion === 'quitar' ? 'Quitar' : 'Confirmar', style: accion === 'quitar' ? 'destructive' : 'default', onPress: async () => {
        setOcupado(String(erpProductId)); trabajando('Guardando…');
        try {
          await clasificarProducto({ erpProductId, esInyeccion });
          audit('INYECCION_CLASIFICAR', String(erpProductId), { producto: nombre, accion, es_inyeccion: esInyeccion, desde: 'app' });
          listo(accion === 'agregar' ? 'Producto agregado' : accion === 'quitar' ? 'Producto quitado' : 'Producto incluido de nuevo',
            accion === 'quitar' ? 'Ya no se ofrece para cobrar la aplicación.' : 'Ya se ofrece para cobrar la aplicación.');
          setAgregando(false);
          await cargar();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e)); }
        setOcupado(null);
      } },
    ]);
  };

  const confirmar = (f) => {
    const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
    Alert.alert('Confirmar aplicaciones', `«${f.descripcion}»: ${n} ${n === 1 ? 'aplicación' : 'aplicaciones'} por unidad suelta.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: async () => {
        setOcupado(clave(f)); trabajando('Guardando…');
        try {
          await fijarDosis({ erpProductId: f.erp_product_id, aplicaciones: n });
          audit('INYECCION_DOSIS', String(f.erp_product_id), { producto: f.descripcion, aplicaciones_por_unidad: n, desde: 'app' });
          listo('Confirmado', `${n} por unidad suelta.`);
          await cargar();
        } catch (e) { fallo('No se pudo confirmar', mensajeAmigable(e)); }
        setOcupado(null);
      } },
    ]);
  };

  const porMl = (f) => { guardar('inyeccion-ml', f); router.push('/inyeccion-ml'); };

  if (filas == null) return <ActivityIndicator style={{ marginTop: 12 }} />;
  return (
    <>
      <View style={{ marginHorizontal: 16, gap: 6 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>Aplicaciones por producto</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`Cuántas aplicaciones trae UNA unidad suelta. Una caja multiplica por lo que trae. Lo que sólo se vende entero —un TRI PACK— es su propia unidad. Un vial que rinde según la dosis se cuenta «por ml». Mientras no se confirma, rige la sugerencia. ${sinConfirmar} sin confirmar.`}
        </Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Tocable onPress={() => setSoloSinConfirmar((v) => !v)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{soloSinConfirmar ? 'Ver también las confirmadas' : 'Ver sólo las sin confirmar'}</Text>
          </Tocable>
          <Tocable onPress={() => setAgregando((v) => !v)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{agregando ? 'Cerrar' : 'Agregar un producto'}</Text>
          </Tocable>
        </View>
      </View>
      {agregando ? <Agregar filas={filas} onElegir={(p) => clasificar(p.id, true, p.nombre, 'agregar')} /> : null}
      {visibles.slice(0, 150).map((f) => {
        const n = editando[clave(f)] ?? f.confirmadas ?? f.sugeridas;
        const ml = f.contenido_ml != null;
        return (
          <View key={clave(f)} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 6 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.descripcion}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  {`${comoSeVende(f.factores)} · ${f.ventas} ventas en 90 días${f.clasificacion === 'incluido' ? ` · agregado a mano${f.clasificado_por ? ` por ${shortEmployeeName(f.clasificado_por)}` : ''}` : ''}`}
                </Text>
                {ml ? (
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>
                    {`${fmtMl(f.contenido_ml)} ml · ${(f.opciones_ml || []).map((d) => `${fmtMl(d)} ml`).join(' o ')} → ${(f.opciones_ml || []).map((d) => aplicacionesPorDosis(f.contenido_ml, d)).join(' o ')} aplicaciones por unidad${f.ml_por ? ` · ${shortEmployeeName(f.ml_por)}` : ''}`}
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Contador valor={n} onCambiar={(v) => setEditando((e) => ({ ...e, [clave(f)]: v }))} />
                    {f.confirmadas == null
                      ? <Pildora texto="Sugerida" color={MARCA.ambar} />
                      : <Pildora texto={f.confirmado_por ? shortEmployeeName(f.confirmado_por) : 'Confirmada'} color={MARCA.verde} />}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
                  <Tocable disabled={ocupado != null} onPress={() => clasificar(f.erp_product_id, valorAlQuitar(f), f.descripcion, 'quitar')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                  </Tocable>
                  <Tocable disabled={ocupado != null} onPress={() => porMl(f)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{ml ? 'Cambiar ml' : 'Por ml'}</Text>
                  </Tocable>
                  {!ml ? (
                    <Tocable disabled={ocupado != null || (f.confirmadas != null && n === f.confirmadas)} onPress={() => confirmar(f)} hitSlop={8}
                      style={{ minHeight: 36, justifyContent: 'center', opacity: f.confirmadas != null && n === f.confirmadas ? 0.4 : 1 }}>
                      <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>Confirmar</Text>
                    </Tocable>
                  ) : null}
                </View>
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!visibles.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto={soloSinConfirmar ? 'Todas confirmadas.' : 'Sin inyecciones vendidas en 90 días.'} /></View> : null}
      {quitados.length ? (
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          <Tocable onPress={() => setVerQuitados((v) => !v)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '700' }}>{verQuitados ? 'Ocultar los quitados' : `Quitados a mano (${quitados.length})`}</Text>
          </Tocable>
          {verQuitados ? quitados.map((f) => (
            <Vidrio key={clave(f)} radio={16}>
              <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{f.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`No cuenta como inyección${f.clasificado_por ? ` · lo quitó ${shortEmployeeName(f.clasificado_por)}` : ''}`}</Text>
                </View>
                <Tocable disabled={ocupado != null} onPress={() => clasificar(f.erp_product_id, null, f.descripcion, 'incluir')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Volver a incluir</Text>
                </Tocable>
              </View>
            </Vidrio>
          )) : null}
        </View>
      ) : null}
    </>
  );
}

export default function Ajustes({ puedePrecio, puedeDosis, recarga }) {
  return (
    <>
      {puedePrecio ? <Precios key={`p${recarga}`} /> : null}
      {puedeDosis ? <CatalogoDeDosis recarga={recarga} /> : null}
    </>
  );
}
