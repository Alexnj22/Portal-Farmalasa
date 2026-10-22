// Cómo llega lo que se aparta sin existencia en la sala — gemelas de
// `YaVieneEnCamino` (dentro de `DialogoApartar`) y `DeOtraSala` del portal:
//   · lo que YA viene en camino a la sala y nadie apartó (uno o varios
//     traslados; las cuentas, `tomaDeCadaTraslado` del núcleo);
//   · pedirlo a OTRA sala que lo tenga, con el MISMO armado que «Pedir a otra
//     sala» (`usePedirTraslado`): sala, estante y reparto por lote salen de
//     ahí, y sólo se manda ESTE renglón (`enviarSoloEsta`).
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { tomaDeCadaTraslado } from '@nucleo/utils/apartar';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Enlace, Marcable } from './piezas';

export function YaVieneEnCamino({ vienen, factor, cantidad, elegidos, onCambiar }) {
  const [abierta, setAbierta] = useState(false);
  const f = factor || 1;
  const necesita = cantidad * f;
  const tomadas = vienen.filter((v) => elegidos.includes(v.id)).reduce((t, v) => t + Number(v.unidades), 0);
  const cubierto = elegidos.length > 0 && tomadas >= necesita;
  // Decidido, la lista se pliega a lo elegido; tocar «Cambiar» la vuelve a abrir.
  const plegada = !abierta && (cubierto || elegidos.length === 0);
  const elegir = (ids) => { onCambiar(ids); setAbierta(false); };
  const tomaDe = tomaDeCadaTraslado(vienen, elegidos, f, cantidad);
  const elegidosV = vienen.filter((v) => elegidos.includes(v.id));
  const estado = (v) => (v.estado === 'enviado' ? 'ya salió' : 'pedido, todavía no sale');

  if (plegada) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
            {elegidosV.length ? `Viene de ${elegidosV.map((v) => v.origen).join(' y ')}` : 'No se toma lo que viene en camino'}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {elegidosV.length ? `${Math.min(Math.floor(tomadas / f), cantidad)} de ${cantidad} · ${elegidosV.every((v) => v.estado === 'enviado') ? 'ya salió' : 'pedido, todavía no sale'}`
              : 'Se pide a otra sala o se encarga'}
          </Text>
        </View>
        <Enlace texto="Cambiar" onPress={() => setAbierta(true)} />
      </View>
    );
  }
  return (
    <View>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginBottom: 4 }}>
        {`Aquí no hay, pero ya viene en camino${vienen.length > 1 && cantidad > 1 ? ' · marca los que hagan falta' : ''}:`}
      </Text>
      {vienen.map((v, i) => {
        const activa = elegidos.includes(v.id);
        const hay = Math.floor(Number(v.unidades) / f);
        const toma = tomaDe.get(v.id) ?? 0;
        return (
          <Marcable key={v.id} primero={i === 0} activa={activa} titulo={`De ${v.origen}`}
            detalle={`${hay} en camino${activa && toma < hay ? ` · se apartan ${toma}` : ''} · ${estado(v)}`}
            onPress={() => (activa ? elegir(elegidos.filter((x) => x !== v.id)) : cubierto ? elegir([v.id]) : elegir([...elegidos, v.id]))} />
        );
      })}
      <Marcable activa={elegidos.length === 0} titulo="No: pedirlo a otra sala o encargarlo" detalle="Lo que viene queda para quien lo pidió"
        onPress={() => elegir([])} />
    </View>
  );
}

// `apiRef.current.enviar(causa, extra)` pide el traslado de este renglón;
// `onCambio` recibe `{ branch_id, sala, lista }` o null (se encarga).
export function DeOtraSala({ producto, factor, cantidad, disponibles = null, apiRef, onCambio }) {
  const productoInicial = useMemo(() => ({ erp_product_id: producto.id, descripcion: producto.nombre }), [producto.id, producto.nombre]);
  const h = usePedirTraslado({ productoInicial });
  const { setCantidad, setPresIdx, setOrigenId, presentaciones, enviarSoloEsta } = h;
  const necesita = cantidad * factor;
  // Sólo el estante de operación (lo próximo a vencer no se aparta) y sólo quien alcanza.
  const candidatos = useMemo(() => h.donde.filter((d) => !d.vencidos && d.branch_id && Number(d.unidades) >= necesita), [h.donde, necesita]);
  const [eleccion, setEleccion] = useState(null);

  useEffect(() => { setCantidad(String(cantidad)); }, [cantidad, setCantidad]);
  useEffect(() => {
    const i = (presentaciones ?? []).findIndex((p) => Number(p.factor || 1) === Number(factor));
    if (i >= 0) setPresIdx(String(i));
  }, [presentaciones, factor, setPresIdx]);
  // Sugerida mientras nadie elija: la primera que alcanza (la de más unidades).
  const efectiva = eleccion ?? (candidatos[0] ? String(candidatos[0].erp_sucursal_id) : null);
  const elegido = candidatos.find((d) => String(d.erp_sucursal_id) === efectiva) ?? null;
  useEffect(() => { if (elegido) setOrigenId(`${elegido.erp_sucursal_id}`); }, [elegido, setOrigenId]);
  useEffect(() => { apiRef.current = { enviar: enviarSoloEsta }; });
  const lista = Boolean(elegido && h.lineaLista && String(h.origenId) === String(elegido.erp_sucursal_id));
  useEffect(() => {
    onCambio(elegido ? { branch_id: elegido.branch_id, sala: elegido.sala, lista } : null);
  }, [elegido, lista, onCambio]);

  const aqui = disponibles == null ? 'Ninguna sala' : disponibles > 0 ? `En esta sala hay sólo ${disponibles} y ninguna otra` : 'En esta sala no hay y ninguna otra';
  // Sin sala asignada no se pregunta a las demás: decir «ninguna lo tiene» ahí sería afirmar algo que no se miró.
  if (!h.miErp) return <Aviso texto="Pedir a otra sala lo hace alguien asignado a una sala." />;
  if (h.dondeCargando) return <Aviso texto="Revisando qué salas lo tienen…" />;
  if (h.dondeError) return <Aviso tono="cuidado" texto="No se pudo revisar qué salas lo tienen." />;
  if (!candidatos.length) return <Aviso texto={`${aqui} sala tiene ${necesita}.`} />;
  return (
    <View>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginBottom: 4 }}>
        {`${disponibles > 0 ? `Aquí hay sólo ${disponibles}` : 'Aquí no hay'} · ¿Lo pedimos a otra sala?`}
      </Text>
      {candidatos.map((d, i) => (
        <Marcable key={d.erp_sucursal_id} primero={i === 0} activa={efectiva === String(d.erp_sucursal_id)}
          titulo={`Pedir a ${d.sala} y apartar`} detalle={`Tiene ${Number(d.unidades)} unidades`} onPress={() => setEleccion(String(d.erp_sucursal_id))} />
      ))}
      <Marcable activa={efectiva === 'encargo'} titulo="No pedir: encargar a Compras" detalle="Compras confirma el precio y la fecha"
        onPress={() => setEleccion('encargo')} />
      {elegido && h.avisoVence ? <Aviso tono={h.avisoVence.grave ? 'freno' : 'cuidado'} texto={h.avisoVence.texto} /> : null}
    </View>
  );
}
