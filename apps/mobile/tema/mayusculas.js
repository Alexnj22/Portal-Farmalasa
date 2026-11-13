// Los rótulos de sección «EN MAYÚSCULAS» son de iOS (el encabezado de una
// lista agrupada). Material 3 los escribe como una oración, sin mayúsculas
// forzadas (2026-11-13, «TODO debe ser material nuevo en android»). Las
// pantallas escriben `textTransform: MAYUSCULAS` en vez de 'uppercase'.
import { Platform } from 'react-native';

export const MAYUSCULAS = Platform.OS === 'ios' ? 'uppercase' : 'none';
