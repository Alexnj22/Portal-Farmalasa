// Regencia de Bitácoras, NATIVO — `src/views/bitacoras/TabRegencia.jsx` del
// portal, con sus mismas funciones del núcleo (`data/regencia`,
// `utils/papelDeRegencia`).
//
// Quién es el regente y el referente de farmacovigilancia, cuántas horas al mes
// pide la categoría de la sala, cuántas lleva anotadas y sus visitas del mes.
// El regente anota las suyas; quien administra (`bitacoras_tab_regencia`
// can_edit) puede anotarlas en su nombre y anular una mal hecha (con motivo:
// nunca se borra). Dos papeles, los mismos del portal: el rótulo de la entrada
// y la hoja de asistencia del mes que el regente firma y sella (AirPrint, PDF
// o Guardar, anotado como salida de datos).
//
// El regente y el referente se asignan en los datos de la sucursal; aquí se
// leen, y un botón lleva ahí.
//
// `?sala=` la sucursal que se miraba en Bitácoras.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularVisitaDeRegencia, fetchRegenciaDeSala, mensajeDeRegencia, rotuloDeActividad } from '@nucleo/data/regencia';
import { htmlDeLaHojaDeAsistencia, htmlDelRotulo } from '@nucleo/utils/papelDeRegencia';
import { registrarEgreso } from '@nucleo/data/egreso';
import { nombreDelPeriodo } from '@nucleo/utils/cierreDeBitacoras';
import { fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { rango12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Refrescar from '../componentes/Refrescar';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Cargando, Seccion, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import PasoDeMes from '../componentes/PasoDeMes';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { FONDO_CONTROL, MARCA } from '../componentes/inicio/marca';
import { ofrecerPapel } from '../componentes/pdf';
import { fallo, listo } from '../componentes/Progreso';
import { BotonChico, pedirMotivo } from '../componentes/bitacoras/Piezas';
import RegistrarVisita from '../componentes/bitacoras/RegistrarVisita';

const VACIO = [];
const T = ({ children, tenue, fuerte, tam = 15, color, style }) => (
  <Text style={[{ color: color ?? (tenue ? colorSistema.texto2 : colorSistema.texto), fontSize: tam, fontWeight: fuerte ? '700' : '400' }, style]}>{children}</Text>
);

export default function RegenciaDeBitacoras() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const puedeAdministrar = hasPermission('bitacoras_tab_regencia', 'can_edit');
  const alcanceTodas = getScope('bitacoras') === 'ALL';
  const salas = useMemo(() => salasDeBitacora(branches), [branches]);
  const pedida = String(salaParam || salaDelUsuario(user) || '');
  const [elegida, setElegida] = useState(null);
  const sala = elegida ?? (salas.some((o) => o.value === pedida) || !alcanceTodas ? pedida : (salas[0]?.value ?? ''));
  const salaValida = Boolean(sala) && salas.some((o) => o.value === String(sala));
  const nombreSala = branches.find((b) => String(b.id) === String(sala))?.name || '';

  const [mes, setMes] = useState(() => mesSV());
  const [regencia, setRegencia] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [anotando, setAnotando] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!salaValida) { setRegencia(null); setCargando(false); return; }
    setCargando(true); setError(null);
    const { regencia: r, error: e } = await fetchRegenciaDeSala(sala, `${mes}-01`);
    setCargando(false);
    if (e) { setError(mensajeDeRegencia(e)); return; }
    setRegencia(r);
  }, [salaValida, sala, mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const imprimir = (cual) => {
    if (!regencia) return;
    const html = cual === 'rotulo' ? htmlDelRotulo(regencia) : htmlDeLaHojaDeAsistencia(regencia);
    ofrecerPapel({
      html, titulo: cual === 'rotulo' ? 'Rótulo de entrada' : 'Hoja del mes',
      nombre: cual === 'rotulo' ? `Rótulo del regente ${regencia.sala || nombreSala}` : `Asistencia del regente ${regencia.sala || nombreSala} ${nombreDelPeriodo(mes)}`,
      alTerminar: (via) => registrarEgreso('bitacoras', {
        formato: 'pdf',
        filas: cual === 'rotulo' ? 1 : (regencia?.visitas?.length ?? 0),
        detalle: { papel: cual === 'rotulo' ? 'rotulo_regente' : 'asistencia_regente', branch_id: sala, periodo: mes, via: `app-${via}` },
      }),
      alFallar: (e) => fallo('No se pudo preparar el papel', e?.message || ''),
    });
  };

  const anular = async (v) => {
    const motivo = await pedirMotivo({ titulo: 'Anular visita', mensaje: 'La visita queda anulada con este motivo. ¿Por qué se anula?', confirmar: 'Anular', destructivo: true });
    if (!motivo) return;
    const { error: e } = await anularVisitaDeRegencia(v.id, motivo);
    if (e) { fallo('No se pudo anular', mensajeDeRegencia(e)); return; }
    listo('Visita anulada', regencia?.sala);
    cargar();
  };

  const grupos = alcanceTodas ? [{ id: 'sala', titulo: 'Sucursal', activa: String(sala), porDefecto: pedida || String(sala), onCambiar: setElegida,
    opciones: salas.map((o) => ({ id: o.value, label: o.label })) }] : [];

  const horas = Number(regencia?.horas_registradas || 0);
  const minimo = regencia?.minimo ? Number(regencia.minimo) : null;
  const pct = minimo ? Math.min(100, Math.round((horas / minimo) * 100)) : null;
  const cumple = minimo !== null && horas >= minimo;
  const puedeAnotar = !!regencia?.regente && (regencia.soy_el_regente || puedeAdministrar);
  const faltaEnDatos = regencia ? [
    !regencia.regente && 'regente',
    !regencia.referente && 'referente de farmacovigilancia',
    regencia.regente && !regencia.jvpqf && 'número JVPQF del regente',
    regencia.regente && !regencia.horario && 'horario del regente',
  ].filter(Boolean) : [];
  const irALosDatos = () => router.push(`/sucursal/${sala}`);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Regencia', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombreSala}</Text> : null}
        <PasoDeMes mes={mes} onCambiar={setMes} />

        {!salaValida ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono="cuidado" texto={!sala ? 'Elige una sucursal para ver su bitácora.' : `${nombreSala || 'Esa sucursal'} no guarda medicamentos. No lleva bitácora de ambiente.`} />
          </View>
        ) : cargando && !regencia ? <Cargando /> : error && !regencia ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>
        ) : !regencia ? null : (
          <>
            {faltaEnDatos.length ? (
              <View style={{ marginHorizontal: 16, gap: 8 }}>
                <Aviso tono="cuidado" texto={`Falta en los datos de la sucursal: ${faltaEnDatos.join(', ')}.`} />
                <View style={{ alignSelf: 'flex-start' }}><BotonChico texto="Completar" onPress={irALosDatos} /></View>
              </View>
            ) : null}

            {[
              { titulo: 'Regente', persona: regencia.regente },
              { titulo: 'Referente de farmacovigilancia', persona: regencia.referente },
            ].map(({ titulo, persona }) => (
              <View key={titulo} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={20}>
                  <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {persona ? <Avatar empleado={{ id: persona.id, name: persona.nombre, photo: persona.foto }} tamano={48} />
                      : <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: FONDO_CONTROL }} />}
                    <View style={{ flex: 1 }}>
                      <T tenue tam={13} fuerte>{titulo}</T>
                      <T fuerte tam={16}>{persona ? shortEmployeeName({ name: persona.nombre }) : 'Sin asignar'}</T>
                      {titulo === 'Regente' && regencia.horario ? <T tenue tam={13}>{regencia.horario}</T> : null}
                    </View>
                    {!persona ? <BotonChico texto="Asignar" relleno color={MARCA.azul} onPress={irALosDatos} /> : null}
                  </View>
                </Vidrio>
              </View>
            ))}

            <Seccion titulo={nombreDelPeriodo(mes)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T fuerte style={{ flex: 1 }}>{`${horas.toFixed(1)} h anotadas${minimo ? ` de ${minimo} h que pide la categoría` : ''}`}</T>
                {minimo !== null ? <Pildora texto={cumple ? 'Cumple' : `Faltan ${(minimo - horas).toFixed(1)} h`} color={cumple ? MARCA.verde : MARCA.ambar} /> : null}
              </View>
              {pct !== null ? (
                <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} accessibilityLabel="Horas del mes"
                  style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: FONDO_CONTROL }}>
                  <View style={{ height: 8, width: `${pct}%`, backgroundColor: cumple ? MARCA.verde : MARCA.ambar }} />
                </View>
              ) : null}
              {minimo === null ? <Aviso texto="La sucursal no tiene categoría en sus datos. No se puede calcular el mínimo." /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <BotonChico texto="Rótulo de entrada" deshabilitado={!regencia.regente} onPress={() => imprimir('rotulo')} />
                <BotonChico texto="Hoja del mes" deshabilitado={!regencia.regente} onPress={() => imprimir('hoja')} />
                {puedeAnotar ? <BotonChico texto="Anotar visita" relleno color={MARCA.azul} onPress={() => setAnotando(true)} /> : null}
              </View>
              {error ? <Aviso tono="freno" texto={error} /> : null}
            </Seccion>

            {!regencia.visitas?.length ? (
              <Vacio titulo="Sin visitas anotadas este mes" detalle={puedeAnotar ? 'Cada visita del regente se anota con su horario y lo que revisó.' : undefined} />
            ) : regencia.visitas.map((v) => (
              <View key={v.id} style={{ marginHorizontal: 16, opacity: v.anulada_at ? 0.6 : 1 }}>
                <Vidrio radio={20}>
                  <View style={{ padding: 14, gap: 4 }}>
                    <T fuerte>
                      {`${fechaTexto(v.fecha, { weekday: 'short', day: '2-digit', month: 'short' })} · ${rango12(v.entrada, v.salida)}`}
                      <T tenue>{` · ${Number(v.horas).toFixed(1)} h`}</T>
                    </T>
                    <T tenue tam={14}>{(v.actividades || []).map(rotuloDeActividad).join(' · ')}</T>
                    {v.notas ? <T tenue tam={13}>{v.notas}</T> : null}
                    {v.registrado_por && v.registrado_por !== v.regente_id ? (
                      <T tenue tam={13}>{`Anotada por ${shortEmployeeName({ name: v.registrado_por_nombre })} en nombre del regente`}</T>
                    ) : null}
                    {v.anulada_at ? <T tam={13} color={MARCA.rojo}>{`Anulada: ${v.anulada_motivo}`}</T> : null}
                    {!v.anulada_at && (regencia.soy_el_regente || puedeAdministrar) ? (
                      <View style={{ alignSelf: 'flex-end' }}><BotonChico texto="Anular" color={MARCA.rojo} onPress={() => anular(v)} /></View>
                    ) : null}
                  </View>
                </Vidrio>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {anotando && regencia ? (
        <RegistrarVisita branchId={sala} sala={regencia.sala}
          regente={regencia.regente ? shortEmployeeName({ name: regencia.regente.nombre }) : null}
          enSuNombre={!regencia.soy_el_regente}
          onCerrar={() => setAnotando(false)}
          onHecho={() => { setAnotando(false); cargar(); }} />
      ) : null}
    </>
  );
}
