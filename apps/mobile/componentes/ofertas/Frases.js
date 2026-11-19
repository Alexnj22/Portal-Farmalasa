// Ofertas para clientes · Frases del día, NATIVO — `FrasesPanel` del portal.
// La app de clientes trae ~300 frases propias y cambia a las 8:00; las de aquí
// le ganan el día que hay una: la programada para ese día o, si no, la
// siguiente de la cola. Estados, «qué sale hoy/mañana» y la fila que se guarda
// salen del núcleo (`estadosDeFrases`, `fraseDeUnDia`, `filaDeFrase`), los
// mismos del portal. Tocar edita (`frase/[id]`); mantener presionado pausa,
// activa o borra. La de hoy no se borra: haría salir otra de la cola ese día.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { borrarFrase, fetchFrases, pausarFrase } from '@nucleo/data/ofertasClientes';
import { CATEGORIAS_DE_FRASE, diaDeFrase, estadosDeFrases, fraseDeUnDia } from '@nucleo/utils/ofertasClientes';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, sumarDias } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Cargando, Vacio } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';
import { guardar } from '../comercial/elegido';

const CATEGORIA = Object.fromEntries(CATEGORIAS_DE_FRASE.map((c) => [c.value, c.label]));

export const ESTADOS_DE_FRASE = [
  { id: 'todas', label: 'Todas' }, { id: 'hoy', label: 'En la app hoy' }, { id: 'cola', label: 'En la cola' },
  { id: 'programada', label: 'Programada' }, { id: 'salio', label: 'Ya salió' }, { id: 'pausada', label: 'Pausada' },
];

/** Abre el editor. Lleva la lista para avisar si el día ya tiene frase. */
export function abrirFrase(f, frases) {
  guardar('frase-app', { frase: f ?? {}, frases: frases ?? [] });
  router.push({ pathname: '/frase/[id]', params: { id: f?.id ? String(f.id) : 'nueva' } });
}

// La lista la necesita también el «+» de la pantalla: se deja aquí al cargarla.
let ultimas = [];
export const frasesCargadas = () => ultimas;

export default function Frases({ busqueda, estado, puedeEditar, recarga }) {
  const [frases, setFrases] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try { const r = await fetchFrases(); ultimas = r ?? []; setFrases(r ?? []); setError(null); }
    catch (e) { setFrases((x) => x ?? []); setError(mensajeAmigable(e, 'No se pudieron cargar las frases.')); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const hoy = diaDeFrase();
  const estados = useMemo(() => estadosDeFrases(frases ?? [], hoy), [frases, hoy]);
  const filas = useMemo(() => (frases ?? [])
    .filter((f) => estado === 'todas' || estados.get(f.id)?.key === estado)
    .filter((f) => !busqueda || tokenMatch(busqueda, f.texto)), [frases, estados, estado, busqueda]);
  const deHoy = useMemo(() => fraseDeUnDia(frases ?? [], hoy, hoy), [frases, hoy]);
  const deManana = useMemo(() => fraseDeUnDia(frases ?? [], sumarDias(hoy, 1), hoy), [frases, hoy]);
  const enCola = useMemo(() => [...estados.values()].filter((e) => e.key === 'cola').length, [estados]);

  const pausar = async (f) => {
    try {
      await pausarFrase(f.id, !f.activa);
      listo(f.activa ? 'Frase pausada' : 'Frase activa', f.activa ? 'No va a salir en la app.' : 'Vuelve a su lugar.');
      cargar();
    } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  const borrar = (f) => Alert.alert('Borrar frase', `«${f.texto}» se borra y no va a salir en la app.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: async () => {
      try { await borrarFrase(f); listo('Frase borrada', ''); cargar(); }
      catch (e) { fallo('No se pudo borrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    } },
  ]);
  const menu = (f) => {
    if (!puedeEditar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const borrable = estados.get(f.id)?.key !== 'hoy';
    const opciones = [f.activa ? 'Pausar: que no salga' : 'Volver a activar', 'Editar', ...(borrable ? ['Borrar'] : []), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({
      title: `«${f.texto}»`, options: opciones,
      ...(borrable ? { destructiveButtonIndex: 2 } : null), cancelButtonIndex: opciones.length - 1,
    }, (i) => {
      if (i === 0) pausar(f);
      else if (i === 1) abrirFrase(f, frases);
      else if (borrable && i === 2) borrar(f);
    });
  };

  if (frases == null) return <Cargando />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <View style={{ marginHorizontal: 16 }}>
        <Vidrio radio={20}>
          <View style={{ padding: 14, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
              {deHoy ? `Hoy en la app: «${deHoy.texto}»` : 'Hoy sale una frase de las que trae la app'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {deManana ? `Mañana a las 8:00: «${deManana.texto}».` : 'Mañana sale una de las que trae la app.'}
              {' '}{enCola ? `La cola alcanza para ${enCola} día${enCola === 1 ? '' : 's'} más.` : 'La cola está vacía. La app usa sus propias frases.'}
            </Text>
          </View>
        </Vidrio>
      </View>
      {filas.map((f) => {
        const est = estados.get(f.id);
        const dia = f.fecha ?? f.mostrada_el;
        return (
          <Pressable key={f.id} onPress={() => (puedeEditar ? abrirFrase(f, frases) : null)} onLongPress={() => menu(f)} delayLongPress={350}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={20} interactivo={puedeEditar}>
              <View style={{ padding: 14, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>«{f.texto}»</Text>
                  {est ? <Pildora texto={est.label} color={colorDeVariante(est.variant)} /> : null}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[CATEGORIA[f.categoria] ?? f.categoria, dia ? fechaTexto(dia, { weekday: 'short', day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {!filas.length && !error ? <Vacio>{(frases ?? []).length ? 'Sin frases con ese filtro' : 'Sin frases cargadas. La app usa las suyas; agrega una para que salga primero.'}</Vacio> : null}
      {puedeEditar && filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionada una frase para pausarla, activarla o borrarla.</Text> : null}
    </>
  );
}
