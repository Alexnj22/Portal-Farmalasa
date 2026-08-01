"""Baja el catálogo de fichas del ERP a rep_cli.html.

`rep_cli.html` es el índice del que salen los bloques: 2.6 MB de
`<option value="id">NOMBRE</option>`. No se versiona —es un volcado de datos que
además envejece— así que se regenera acá. Al 2026-08-01 traía 27,569 fichas.

Requiere `erp.env` con una cookie de sesión viva. Ver README.
"""
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402

destino = f'{D}/rep_cli.html'
h = bloque.pedir(f'{bloque.BASE}/reporte_clientes.php')
if 'password' in h.lower()[:4000]:
    raise SystemExit('SESIÓN CAÍDA: refrescá la cookie en erp.env (ver README).')

open(destino, 'w').write(h)
idx, nombres = bloque.indice_erp()
print(f'{len(h):,} bytes -> {destino}')
print(f'fichas indexadas: {len(nombres)} · nombres únicos: {len(idx)} · '
      f'duplicados: {sum(1 for v in idx.values() if len(v) > 1)}')
