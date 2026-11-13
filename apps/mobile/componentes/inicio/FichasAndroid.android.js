import * as Haptics from 'expo-haptics';
import { FilterChip, Host, LazyRow, Text as TextoCompose } from '@expo/ui/jetpack-compose';
import { SEMILLA, usePaleta } from '../../tema/material';

// En Android: las fichas de filtro de Material 3 (FilterChip de Compose) en
// una fila que se desplaza, con la ✓ del sistema en la elegida.
export default function FichasAndroid({ opciones, activa, onCambiar }) {
  const p = usePaleta();
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }} seedColor={SEMILLA}>
      <LazyRow horizontalArrangement={{ spacedBy: 8 }} contentPadding={{ start: 16, end: 16 }}>
        {opciones.map((o) => (
          <FilterChip key={o.id} selected={o.id === activa}
            onClick={() => { if (o.id !== activa) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
            colors={{ selectedContainerColor: p.secondaryContainer, selectedLabelColor: p.onSecondaryContainer, selectedLeadingIconColor: p.onSecondaryContainer, labelColor: p.onSurfaceVariant }}>
            <FilterChip.Label><TextoCompose>{o.label}</TextoCompose></FilterChip.Label>
          </FilterChip>
        ))}
      </LazyRow>
    </Host>
  );
}

