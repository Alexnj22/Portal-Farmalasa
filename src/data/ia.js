import { supabase } from '../supabaseClient';

// ── Lo que el portal le pide leer o analizar a la IA ────────────────────────
//
// Estas llamadas vivían dentro de las pantallas (F3 del núcleo portable,
// `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`): la app del teléfono no podía
// reutilizarlas sin copiarlas. Devuelven lo mismo que `functions.invoke`
// —`{ data, error }`— para que cada pantalla siga decidiendo qué hacer con un
// fallo, que en todas es distinto (en el alta de un empleado, que no se pueda
// leer el DUI NO es un error: los campos se teclean).

/** Resume un documento ya subido (`filePath` dentro de `bucketName`). */
export const analizarDocumento = (body) => supabase.functions.invoke('analyze-document', { body });

/** Lee un DUI: `{ frente }` o las dos caras. */
export const leerDui = (body) => supabase.functions.invoke('leer-dui', { body });

/** El análisis de una sucursal: `{ branchName, branchData }`. */
export const analizarSucursal = (body) => supabase.functions.invoke('analyze-branch', { body });

/** El análisis del historial de una sucursal: `{ branchName, historyData }`. */
export const analizarHistorial = (body) => supabase.functions.invoke('analyze-history', { body });

/** Una consulta a Saly: `{ action, payload }`. */
export const preguntarASaly = (body) => supabase.functions.invoke('saly-ai', { body });
