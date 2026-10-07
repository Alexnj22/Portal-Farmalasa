// Inventario de Torogoz por lote y vencimiento, NATIVO — `TabInventario` del
// portal. Lo que entra se carga con «Entrada de lote»; lo que sale lo descuenta
// solo el documento al facturarse, así que acá no hay «Salida». Lo que no
// cuadra se corrige en el lote (`/torogoz/lote/[id]`), con su motivo.
//
// Las cifras, el filtro y el costo salen del núcleo (`distribucionBodega`),
// los mismos del portal. El costo sólo lo ve quien administra.
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { fetchCatalogo, fetchCuarentena } from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import {
  POR_VENCER, costosDelCatalogo, estadoDeVencimiento, filtrarLotes, lotesConDias, resumenDeLotes,
} from '@nucleo/utils/distribucionBodega';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { FiltrosActivos, MenuDeFiltros } from '../../Filtros';
import { colorSistema } from '../../Formulario';
import { Aviso } from '../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { MARCA } from '../../inicio/marca';
import Cuarentena from './Cuarentena';
import Existencias from './Existencias';
import { Chapa, Ficha, PETROLEO, Vacio } from './piezas';

const PAGINA = 60;
const FILTROS = [
  { id: '', label: 'Con existencia' },
  { id: 'porVencer', label: `Por vencer (${POR_VENCER} días)` },
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'agotados', label: 'Lotes agotados' },
];

export default function Lotes({ emisor, puedeVender, puedeConfigurar, buscar }) {
  const [lotes, setLotes] = useState(null);
  const [costos, setCostos] = useState(new Map());
  const [cuarentena, setCuarentena] = useState([]);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('');
  const [verCuarentena, setVerCuarentena] = useState(false);
  const [verExistencias, setVerExistencias] = useState(false);
  const [cuantos, setCuantos] = useState(PAGINA);
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    const mio = ++pedido.current;
    setError('');
    try {
      const [r, cat, cua] = await Promise.all([fetchLotes(), puedeConfigurar ? fetchCatalogo() : Promise.resolve([]), fetchCuarentena()]);
      if (mio !== pedido.current) return;
      // Bodega: lo que va en un camión se mira en «Camiones».
      setLotes(r.filter((l) => !l.en_camion_de));
      setCuarentena(cua);
      setCostos(costosDelCatalogo(cat));
    } catch {
      if (mio === pedido.current) setError('No se pudo cargar el inventario. Revisa la conexión e intenta de nuevo.');
    }
  }, [puedeConfigurar]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const conDias = useMemo(() => lotesConDias(lotes, costos), [lotes, costos]);
  const filtrados = useMemo(() => filtrarLotes(conDias, { buscar, filtro }), [conDias, buscar, filtro]);
  const stats = useMemo(() => resumenDeLotes(conDias), [conDias]);
  const enCuarentena = cuarentena.reduce((t, q) => t + q.unidades, 0);
  const alternar = (f) => { setCuantos(PAGINA); setFiltro((v) => (v === f ? '' : f)); };

  const grupos = [{ id: 'filtro', titulo: 'Lotes', activa: filtro, porDefecto: '', onCambiar: (v) => { setCuantos(PAGINA); setFiltro(v); }, opciones: FILTROS }];
  const extra = puedeVender && emisor
    ? { icono: 'plus', etiqueta: 'Entrada de lote', onPress: () => router.push(`/torogoz/entrada-lote?emisor=${emisor.id}`) }
    : null;
  const cargando = lotes == null;

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={grupos} extra={extra} />
      <FiltrosActivos grupos={grupos} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="Boxes" rotulo="Productos" color={PETROLEO} valor={cargando ? '…' : formatQty(stats.productos)} apoyo={`${formatQty(stats.unidades)} unidades`} />
        <Kpi icono="ShieldAlert" rotulo="En cuarentena" color={MARCA.ambar} valor={cargando ? '…' : formatQty(enCuarentena)}
          apoyo={cuarentena.length ? `${cuarentena.length} por decidir` : 'Nada por decidir'} pide={cuarentena.length > 0}
          onPress={() => setVerCuarentena(true)} />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="CalendarClock" rotulo="Por vencer" color={MARCA.ambar} valor={cargando ? '…' : formatQty(stats.porVencer)}
          apoyo={filtro === 'porVencer' ? 'Filtrando · tocar quita' : `Lotes en ${POR_VENCER} días o menos`} pide={filtro === 'porVencer'} onPress={() => alternar('porVencer')} />
        <Kpi icono="AlertTriangle" rotulo="Vencidos" color={MARCA.rojo} valor={cargando ? '…' : formatQty(stats.vencidos)}
          apoyo={filtro === 'vencidos' ? 'Filtrando · tocar quita' : 'Con existencia: no se venden'} pide={filtro === 'vencidos' || stats.vencidos > 0} onPress={() => alternar('vencidos')} />
      </FilaDeKpis>
      {puedeConfigurar ? (
        <FilaDeKpis>
          <Kpi icono="DollarSign" rotulo="Valor al costo" color={MARCA.verde} valor={cargando ? '…' : formatMoney(stats.valor)}
            apoyo={stats.sinCosto ? `${stats.sinCosto} productos todavía sin costo` : 'Costo promedio, sin IVA'} />
        </FilaDeKpis>
      ) : null}

      <Pressable onPress={() => setVerExistencias(true)} style={{ marginHorizontal: 20, minHeight: 36, justifyContent: 'center' }} accessibilityRole="link">
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>¿Hay en alguna sucursal? Ver existencias en las siete ›</Text>
      </Pressable>

      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : filtrados.length === 0 ? (
        buscar || filtro
          ? <Vacio titulo="Sin resultados" texto="Ningún lote coincide con la búsqueda o el filtro." />
          : <Vacio titulo="Sin existencias" texto={puedeVender ? 'Registra lo que llega con «Entrada de lote» (el + de arriba).' : undefined} />
      ) : (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${formatQty(filtrados.length)} lotes`}</Text>
          {filtrados.slice(0, cuantos).map((l) => {
            const v = estadoDeVencimiento(l.vence);
            return (
              <Ficha key={l.id} onPress={() => router.push({ pathname: '/torogoz/lote/[id]', params: { id: String(l.id), nombre: l.nombre, lote: l.lote, vence: l.vence ?? '', existencia: String(l.existencia) } })}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{l.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontFamily: 'Menlo' }}>{`Lote ${l.lote}`}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{l.vence ? fechaNumerica(l.vence) : 'Sin fecha'}</Text>
                      <Chapa variante={v.variant} texto={v.texto} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={{ color: l.existencia ? colorSistema.texto : colorSistema.texto2, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(l.existencia)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>unidades</Text>
                    {puedeConfigurar ? (
                      l.costo === null
                        ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Sin costo</Text>
                        : <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{`${formatMoney(l.valor)} · ${formatMoney(l.costo)} c/u`}</Text>
                    ) : null}
                  </View>
                </View>
              </Ficha>
            );
          })}
          {filtrados.length > cuantos ? (
            <Pressable onPress={() => setCuantos((n) => n + PAGINA)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>{`Ver ${Math.min(PAGINA, filtrados.length - cuantos)} más`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {verCuarentena ? (
        <Cuarentena filas={cuarentena} puedeResolver={puedeConfigurar} onCerrar={() => setVerCuarentena(false)} onCambio={cargar} />
      ) : null}
      {verExistencias ? <Existencias terminoInicial={buscar} onCerrar={() => setVerExistencias(false)} /> : null}
    </View>
  );
}
