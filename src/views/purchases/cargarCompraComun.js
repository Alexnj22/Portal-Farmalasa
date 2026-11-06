// Datos de «Cargar compra» que usan la pantalla y la propuesta
// (`PropuestaDeCompra.jsx`). Aparte para que la propuesta se cargue al abrirla
// sin duplicarlos (2026-11-06).

import { ScanBarcode, BookMarked, Search } from 'lucide-react';
import { fechaNumerica } from '@nucleo/utils/fecha';

export const ORIGEN = {
    codigo_barras: { label: 'Código de barras', icon: ScanBarcode, variant: 'success' },
    aprendido:     { label: 'Ya confirmado',    icon: BookMarked,  variant: 'success' },
    parecido:      { label: 'Por parecido',     icon: Search,      variant: 'warning' },
};

/**
 * Cómo entra el renglón: «5 × CAJA (5)». Reemplaza al par «Se carga como» +
 * «Total en unidades», que decían lo mismo dos veces y se leían como dos
 * preguntas distintas (Bodega, 2026-11-05). Las unidades se dicen debajo; si
 * ninguna presentación sirve, «Otra cantidad…» abre el campo de unidades.
 */
export const OTRA = 'otra';
// Lo que pasó con el documento en Bodega. Sin envío desde el portal, está
// pendiente; una revisión sola no lo cambia. Una compra ya cargada sale de
// esta lista cuando el portal la ve en Bodega (≤10 min).
export const ESTADO_CARGA = {
    pendiente:     { label: 'Pendiente',          variant: 'neutral' },
    enviando:      { label: 'Mandándose…',        variant: 'info'    },
    verificada:    { label: 'Cargada en Bodega',  variant: 'success' },
    sin_verificar: { label: 'Por confirmar',      variant: 'warning' },
    fallida:       { label: 'No entró',           variant: 'danger'  },
};
export const estadoDeCarga = (fila) => ESTADO_CARGA[fila?.estado] ?? ESTADO_CARGA.pendiente;

export const fmtFecha = (iso) => fechaNumerica(iso, { anio: 'corto', vacio: '—' });
