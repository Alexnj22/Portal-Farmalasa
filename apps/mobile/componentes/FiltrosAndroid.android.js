// Los filtros de la barra de arriba, en ANDROID.
//
// En iPhone van en el menú de la barra (`Stack.Toolbar.Menu`, en Filtros.js),
// pero esa barra es sólo de iOS: en Android no se pintaba NADA —ni el botón de
// filtros, ni el botón extra, ni la campana de la pantalla— y los filtros de
// sala, tipo o semana quedaban fuera de alcance (visto en el emulador el
// 2026-10-12). Acá van como en cualquier app de Material 3: un ícono de filtro
// en la barra (relleno cuando hay algo aplicado) que abre la hoja inferior del
// sistema (ModalBottomSheet de Compose) con un grupo por filtro y sus opciones
// como botones de radio.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host as HostUi, Icon } from '@expo/ui';
import { Host, LazyColumn, ListItem, ModalBottomSheet, RadioButton, Text } from '@expo/ui/jetpack-compose';
import { clickable, padding } from '@expo/ui/jetpack-compose/modifiers';
import BotonCampana from './BotonCampana';
import { colorSistema } from './Formulario';
import { iconoDe } from '../tema/iconos';
import { MARCA } from './inicio/marca';

// El botón extra trae su ícono de iPhone (SF Symbol); éste es su par de Material.
const DE_SF = { banknote: 'Banknote', eye: 'Eye', 'eye.slash': 'EyeOff', 'square.and.arrow.up': 'Share', plus: 'Plus', paperplane: 'Send', printer: 'Printer', 'ellipsis.circle': 'MoreVertical' };

function BotonDeBarra({ icono, etiqueta, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={etiqueta}
      android_ripple={{ color: 'rgba(127,127,127,0.25)', borderless: true, radius: 22 }}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <HostUi matchContents><Icon name={iconoDe(icono)} size={24} color={colorSistema.texto} /></HostUi>
    </Pressable>
  );
}

function HojaDeFiltros({ grupos, onCerrar }) {
  const elegir = (g, o) => { Haptics.selectionAsync().catch(() => {}); g.onCambiar(o.id); };
  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ModalBottomSheet onDismissRequest={onCerrar} containerColor={colorSistema.fila} contentColor={colorSistema.texto}>
        <LazyColumn contentPadding={{ bottom: 24 }}>
          {grupos.flatMap((g) => [
            <Text key={`t-${g.id}`} color={colorSistema.texto2} style={{ fontSize: 14, fontWeight: '600' }}
              modifiers={[padding(24, 16, 24, 4)]}>{g.titulo}</Text>,
            ...g.opciones.map((o) => (
              <ListItem key={`${g.id}-${o.id}`} colors={{ containerColor: colorSistema.fila }} modifiers={[clickable(() => elegir(g, o))]}>
                <ListItem.LeadingContent>
                  <RadioButton selected={g.activa === o.id} onClick={() => elegir(g, o)} colors={{ selectedColor: MARCA.azul }} />
                </ListItem.LeadingContent>
                <ListItem.HeadlineContent>
                  <Text color={colorSistema.texto} style={{ fontSize: 16 }}>{o.label}</Text>
                </ListItem.HeadlineContent>
              </ListItem>
            )),
          ])}
        </LazyColumn>
      </ModalBottomSheet>
    </Host>
  );
}

/** Lo mismo que `MenuDeFiltros` de iOS: filtros, botón extra y campana, en la barra de Android. */
export default function FiltrosAndroid({ grupos, extra }) {
  const [abierta, setAbierta] = useState(false);
  const visibles = grupos.filter((g) => g.opciones.length > 1);
  const hayActivo = visibles.some((g) => g.activa !== g.porDefecto);
  return (
    <>
      <Stack.Screen options={{
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {visibles.length ? (
              <BotonDeBarra icono={hayActivo ? 'FiltroActivo' : 'Filtro'} etiqueta="Filtros" onPress={() => setAbierta(true)} />
            ) : null}
            {extra ? <BotonDeBarra icono={DE_SF[extra.icono] ?? 'MoreVertical'} etiqueta={extra.etiqueta} onPress={extra.onPress} /> : null}
            <View style={{ marginLeft: 8, marginRight: 4 }}><BotonCampana /></View>
          </View>
        ),
      }} />
      {abierta ? <HojaDeFiltros grupos={visibles} onCerrar={() => setAbierta(false)} /> : null}
    </>
  );
}
