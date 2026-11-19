// Fijar a mano de qué molécula es un producto y por qué vía se usa — lo mismo
// que `src/views/bitacoras/EditarAntibioticoModal.jsx` del portal, con las
// mismas funciones del núcleo. Lo que se guarda aquí manda sobre lo que
// proponga el nombre. Sin `producto`, primero se busca (agregar uno que el
// listado no ve). «No es antibiótico» lo saca del listado sin borrar nada.
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarProductos } from '@nucleo/data/busquedaProductos';
import {
  GRUPOS_AWARE, VIAS_ANTIBIOTICO, agregarMoleculaAntibiotico, antibioticoAutomatico, asignarAntibiotico,
  fetchMoleculasAware,
} from '@nucleo/data/bitacoras';
import { Presionable as Pressable } from '../Tocable';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../formulario/Piezas';
import Segmentos from '../Segmentos';
import { MARCA } from '../inicio/marca';
import { listo } from '../Progreso';
import { BotonChico, Hoja, Rotulo } from './Piezas';

const GRUPOS = Object.entries(GRUPOS_AWARE).map(([id, g]) => ({ id, label: g.label }));

export default function EditarAntibiotico({ producto: inicial = null, onCerrar, onHecho }) {
  const [producto, setProducto] = useState(inicial);
  const [molecula, setMolecula] = useState(inicial?.molecula || '');
  const [via, setVia] = useState(inicial?.via || 'oral');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [extra, setExtra] = useState([]);
  const [moleculas, setMoleculas] = useState([]);
  const [nueva, setNueva] = useState(null);
  const [eligiendo, setEligiendo] = useState(false);
  useEffect(() => {
    fetchMoleculasAware().then(({ moleculas: m, error: e }) => { if (e) setError(e); setMoleculas(m); });
  }, []);

  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 300);
  const [resultados, setResultados] = useState([]);
  useEffect(() => {
    let vivo = true;
    if (producto || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
    buscarProductos(q, { select: 'id, nombre', limite: 8 }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) setError('No se pudo buscar. Revisa tu conexión.');
      setResultados(data ?? []);
    });
    return () => { vivo = false; };
  }, [q, producto]);

  const opciones = useMemo(() => [...moleculas, ...extra.filter((x) => !moleculas.some((m) => m.molecula === x.molecula))]
    .map((m) => ({ id: m.molecula, label: `${m.molecula}${m.grupo ? ` · ${GRUPOS_AWARE[m.grupo]?.label}` : ''}` }))
    .sort((a, b) => a.id.localeCompare(b.id)), [moleculas, extra]);

  const guardar = async (mol) => {
    setGuardando(true); setError(null);
    const { error: e } = await asignarAntibiotico({ productId: producto.product_id, molecula: mol, via });
    setGuardando(false);
    if (e) { setError(e); return; }
    listo(mol ? 'Guardado' : 'Sacado del listado', producto.producto);
    onHecho?.();
  };
  const automatico = async () => {
    setGuardando(true);
    const { error: e } = await antibioticoAutomatico(producto.product_id);
    setGuardando(false);
    if (e) { setError(e); return; }
    listo('Vuelve a lo que dice su nombre', producto.producto);
    onHecho?.();
  };
  const crearMolecula = async () => {
    setGuardando(true); setError(null);
    const r = await agregarMoleculaAntibiotico(nueva);
    setGuardando(false);
    if (r.error) { setError(r.error); return; }
    setExtra((x) => [...x, { molecula: r.molecula, grupo: nueva.grupo || null }]);
    setMolecula(r.molecula);
    setNueva(null);
  };

  const pie = producto ? (
    <>
      <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} onPress={() => guardar(molecula)} deshabilitado={guardando || !molecula} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        <BotonChico texto="No es antibiótico" deshabilitado={guardando} onPress={() => guardar(null)} />
        {producto.origen === 'manual' ? <BotonChico texto="Volver a lo automático" deshabilitado={guardando} onPress={automatico} /> : null}
      </View>
    </>
  ) : null;

  return (
    <Hoja titulo={producto ? producto.producto : 'Agregar un producto'}
      subtitulo={producto?.origen === 'nombre' ? 'Hoy está en el listado por su nombre. Lo que guardes aquí manda.' : undefined}
      onCerrar={onCerrar} ocupado={guardando} pie={pie}>
      {!producto ? (
        <Seccion titulo="Buscar">
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre del producto" autoFocus />
          {resultados.map((p, i) => (
            <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto({ product_id: p.id, producto: p.nombre }); }}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{p.nombre}</Text>
            </Pressable>
          ))}
        </Seccion>
      ) : (
        <>
          <Seccion titulo="Molécula">
            <Pressable onPress={() => setEligiendo((v) => !v)} accessibilityRole="button"
              style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ flex: 1, color: molecula ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>
                {opciones.find((o) => o.id === molecula)?.label || molecula || 'Elegir la molécula'}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>{eligiendo ? '⌃' : '›'}</Text>
            </Pressable>
            {eligiendo ? <Opciones opciones={opciones} valor={molecula} onCambiar={(v) => { setMolecula(v); setEligiendo(false); }} /> : null}
            {!nueva ? <BotonChico texto="Agregar una molécula nueva" onPress={() => setNueva({ molecula: '', grupo: '', atc: '' })} /> : null}
          </Seccion>
          {nueva ? (
            <Seccion titulo="Molécula nueva">
              <Campo multiline={false} value={nueva.molecula} maxLength={40} placeholder="Molécula"
                onChangeText={(v) => setNueva((n) => ({ ...n, molecula: v }))} />
              <Rotulo>Grupo AWaRe (lo confirma el regente)</Rotulo>
              <Segmentos margen={0} opciones={GRUPOS} activa={nueva.grupo || null} onCambiar={(g) => setNueva((n) => ({ ...n, grupo: g }))} />
              <Campo multiline={false} value={nueva.atc} maxLength={10} placeholder="Código ATC (opcional)"
                onChangeText={(v) => setNueva((n) => ({ ...n, atc: v }))} />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <BotonChico texto="Cancelar" deshabilitado={guardando} onPress={() => setNueva(null)} />
                <BotonChico texto="Agregar" relleno color={MARCA.azul} deshabilitado={guardando || nueva.molecula.trim().length < 4} onPress={crearMolecula} />
              </View>
            </Seccion>
          ) : null}
          <Seccion titulo="Vía">
            <Segmentos margen={0} opciones={VIAS_ANTIBIOTICO.map((v) => ({ id: v.value, label: v.label }))} activa={via} onCambiar={setVia} />
          </Seccion>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
            Va al libro: cefixima, azitromicina, claritromicina, levofloxacina, moxifloxacina y norfloxacina en cualquier presentación, y todo antibiótico inyectable. El resto pide receta pero no va al libro. Los de uso local no tienen grupo AWaRe.
          </Text>
        </>
      )}
      {error ? <Aviso tono="freno" texto={error} /> : null}
    </Hoja>
  );
}
