// ── Puente temporal — NO agregar nada acá ─────────────────────────────────────
// Otra sesión está moviendo esta pestaña a `src/views/inventario/`. El traslado
// se coló a `main` a medias (ver v2.520.2): los archivos ya viajaron pero el
// `ProductosView.jsx` que los importa todavía apunta a la ruta vieja, así que el
// build de producción quedó roto.
//
// Este re-export deja compilar sin duplicar el componente —copiarlo entero
// duplicaba también sus hallazgos y el gate de diseño lo rechazaba, con razón— y
// sin tocarle el árbol a la sesión que está trabajando.
//
// Se borra cuando aterrice ese refactor con sus imports corregidos.
export { default } from '../inventario/TabInventario';
