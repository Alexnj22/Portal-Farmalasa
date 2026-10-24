// Puntos → Niveles, NATIVO — `NivelesDelPrograma` del portal (2026-10-19).
// Todo lo que el programa promete por nivel, en un solo lugar y sin migración:
//
//   · Estado — desde cuándo rigen los niveles y lo del Cliente Mayorista (la
//     fecha del Reglamento v2; desde el 2026-10-24 ya no hay interruptores) y
//     el tope del raspable del mes en dólares, con lo que va usado.
//   · Cada nivel y cada rango de mayoreo, resumido; tocarlo abre su editor
//     (`app/puntos-nivel`), con los premios del raspable en los dos más altos.
//   · Historial — los últimos cambios: quién (foto y nombre corto), qué y el
//     antes → después en palabras.
//
// Las cuentas y los textos salen del núcleo (`nivelesDePuntos`), los mismos del
// portal. Escribir exige `puntos_tab_niveles` can_edit; la base lo vuelve a exigir.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPanelDeNiveles, guardarConfigDePuntos } from '@nucleo/data/puntos';
import {
  CAMPOS_NIVEL, costoDelRaspableTexto, diferenciasDeConfig, premiosTexto, sujetoDelHistorial,
  usoDelTopeTexto, vigenciaDelReglamentoTexto,
} from '@nucleo/utils/nivelesDePuntos';
import { puntosTexto } from '@nucleo/utils/puntosTexto';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { guardar as dejar } from '../comercial/elegido';

const Titulo = ({ children }) => (
  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 32, marginTop: 6 }}>{children}</Text>
);

function Estado({ config, usadoUsd, puedeEditar, alGuardar }) {
  const topeActual = config?.raspable_presupuesto_usd;
  const [tope, setTope] = useState(topeActual == null ? '' : String(topeActual));
  useEffect(() => { setTope(topeActual == null ? '' : String(topeActual)); }, [topeActual]); // eslint-disable-line react-hooks/set-state-in-effect -- vuelve al guardado al recargar
  const topeCambio = (tope === '' ? null : Number(tope)) !== (topeActual == null ? null : Number(topeActual));

  const guardar = async () => {
    trabajando('Guardando…');
    try { await guardarConfigDePuntos({ raspable_presupuesto_usd: tope === '' ? null : Number(tope) }); listo('Guardado', 'Tope del raspable'); alGuardar(); }
    catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
  };

  return (
    <Seccion titulo="Estado del programa">
      <View style={{ gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Niveles y beneficios del Cliente Mayorista</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{vigenciaDelReglamentoTexto(config)}</Text>
      </View>
      <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>Tope del raspable al mes ($)</Text>
        <Campo multiline={false} value={tope} editable={puedeEditar} keyboardType="decimal-pad" placeholder="Sin tope"
          onChangeText={(v) => setTope(v.replace(/[^\d.]/g, ''))} accessibilityLabel="Tope del raspable al mes, en dólares" />
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Cuenta los puntos ($1 cada 100), el costo de los productos y el de los promocionales que lo tienen. Vacío = sin tope. ${usoDelTopeTexto(config, usadoUsd)}`}</Text>
        {puedeEditar ? <BotonGrande texto="Guardar tope" borde deshabilitado={!topeCambio} onPress={guardar} /> : null}
      </View>
    </Seccion>
  );
}

function valorDeCampo(c, v) {
  if (v == null || v === '') return '—';
  if (c.key === 'desde') return formatMoney(Number(v));
  return String(v);
}

function TarjetaDeNivel({ fila, tipo, conRaspable, esEntrada, onAbrir }) {
  const costo = conRaspable ? costoDelRaspableTexto(fila.cupon_premios ?? [], fila.cupon_mensual) : null;
  return (
    <Pressable onPress={onAbrir} accessibilityRole="button" accessibilityLabel={`${tipo === 'nivel' ? 'Nivel' : 'Rango'} ${fila.nombre}`}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', marginRight: 4 }}>{fila.nombre}</Text>
            {esEntrada ? <Pildora texto="Entrada" color="#8E8E93" /> : null}
            {conRaspable ? <Pildora texto="Con raspable" color={MARCA.azulClaro} /> : null}
          </View>
          {tipo === 'nivel' ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 19 }}>
              {CAMPOS_NIVEL.filter((c) => c.key !== 'nombre').map((c) => `${c.label}: ${valorDeCampo(c, fila[c.key])}`).join('\n')}
            </Text>
          ) : (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Puntos de cumpleaños: ${puntosTexto(fila.puntos_cumpleanos ?? 0)}`}</Text>
          )}
          {conRaspable ? <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{`Raspable: ${premiosTexto(fila.cupon_premios)}`}</Text> : null}
          {costo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{costo}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

const PASO = 25;

export default function Niveles({ puedeEditar }) {
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [ver, setVer] = useState(PASO);
  const cargar = useCallback(() => {
    fetchPanelDeNiveles().then((p) => { setPanel(p); setError(null); }).catch((e) => setError(mensajeAmigable(e)));
  }, []);
  // Se relee al volver del editor: lo guardado tiene que verse.
  useFocusEffect(cargar);

  if (error && !panel) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!panel) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const niveles = panel.niveles ?? [];
  const mayoreo = panel.mayoreo ?? [];
  const ordenMax = Math.max(0, ...niveles.map((n) => n.orden));
  const ordenMin = Math.min(...niveles.map((n) => n.orden));
  const ordenMaxMay = Math.max(0, ...mayoreo.map((n) => n.orden));
  const historial = panel.historial ?? [];
  const abrir = (tipo, fila, conRaspable, esEntrada) => {
    Haptics.selectionAsync().catch(() => {});
    dejar('puntos-nivel', { tipo, fila, conRaspable, esEntrada, puedeEditar });
    router.push({ pathname: '/puntos-nivel', params: { tipo, clave: fila.clave } });
  };

  return (
    <>
      {!puedeEditar ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Puedes ver la configuración, pero no cambiarla." /></View> : null}
      <View style={{ marginHorizontal: 16 }}>
        <Estado config={panel.config} usadoUsd={panel.raspable_usado_usd} puedeEditar={puedeEditar} alGuardar={cargar} />
      </View>

      <Titulo>Niveles de Puntos Salud</Titulo>
      {niveles.map((n) => (
        <TarjetaDeNivel key={n.clave} fila={n} tipo="nivel" conRaspable={n.orden >= ordenMax - 1} esEntrada={n.orden === ordenMin}
          onAbrir={() => abrir('nivel', n, n.orden >= ordenMax - 1, n.orden === ordenMin)} />
      ))}

      <Titulo>Cliente Mayorista, por rango</Titulo>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 32 }}>
        Cumpleaños y raspable del Cliente Mayorista aprobado (Condiciones §5). Sólo se dan con «Beneficios del Cliente Mayorista» encendido; mientras tanto recibe lo de cualquier cliente. El rango y los puntos por dólar de cada rango no se cambian aquí.
      </Text>
      {mayoreo.map((r) => (
        <TarjetaDeNivel key={r.clave} fila={r} tipo="rango" conRaspable={r.orden >= ordenMaxMay - 1}
          onAbrir={() => abrir('rango', r, r.orden >= ordenMaxMay - 1, false)} />
      ))}

      <Titulo>Historial de cambios</Titulo>
      {!historial.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 32 }}>Todavía no hay cambios.</Text> : null}
      {historial.slice(0, ver).map((h) => (
        <View key={h.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{sujetoDelHistorial(h, niveles, mayoreo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(h.created_at)}</Text>
              </View>
              {h.quien ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Avatar empleado={{ id: h.employee_id, name: h.quien }} tamano={18} />
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{shortEmployeeName({ name: h.quien })}</Text>
                </View>
              ) : null}
              {diferenciasDeConfig(h.antes, h.despues).map((d) => (
                <Text key={d} style={{ color: colorSistema.texto, fontSize: 13 }}>{d}</Text>
              ))}
              {h.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Motivo: ${h.nota}`}</Text> : null}
            </View>
          </Vidrio>
        </View>
      ))}
      {historial.length > ver ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más · quedan ${historial.length - ver}`} borde onPress={() => setVer((n) => n + PASO)} /></View> : null}
    </>
  );
}
