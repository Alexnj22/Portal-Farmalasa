"""Empuja al ERP las ediciones hechas desde el portal. (Fase 2)

La otra mitad del espejo. Hasta ahora el flujo era ERP -> portal y una edición
hecha en el portal quedaba protegida pero congelada: no se perdía, pero tampoco
llegaba nunca al ERP.

    python3 empujar_al_erp.py             # SIMULACIÓN: muestra qué mandaría
    python3 empujar_al_erp.py --escribir  # lo manda, verifica y salda la cola

La cola sale de `cola_espejo_portal_erp()`: `customers_changelog` con
`erp_synced_at IS NULL` **y `descartado_at IS NULL`**, o sea lo que todavía
puede viajar. Lo segundo lo escribe el espejo cuando el campo pierde una carrera
contra el ERP; antes eso se recalculaba cruzando contra `espejo_conflictos`, y
como la entrada nunca se cerraba, el espejo la volvía a descartar en cada
corrida. Al terminar se llama a `marcar_empujado_al_erp()`, y con eso
`aplicar_espejo_erp` deja de proteger ese campo — el ERP vuelve a mandar.

DOS COSAS QUE NO SE INVENTAN
---------------------------
1. El POST del ERP borra lo que no se le manda, así que la ficha se LEE entera,
   se le aplican los campos cambiados y se reenvían los 21. Es el mismo patrón
   de `bloque.py` y por la misma razón (incidente 6317).
2. Los selects del ERP van por VALUE ('7') y el portal guarda la ETIQUETA
   ('CHALATENANGO'). Para volver hay que buscar la etiqueta en las opciones de
   ESA ficha. El emparejamiento es por `norm()`, o sea sin acentos ni
   mayúsculas: así 'Chalatenango' del catálogo oficial encuentra el
   'CHALATENANGO' del ERP. Lo que NO se hace es adivinar una abreviatura
   ('SN MIG MERCEDES'): si no hay coincidencia exacta tras normalizar, el campo
   NO se empuja y se reporta. Inventar un distrito en una ficha fiscal es
   exactamente lo que este proyecto tiene prohibido.
"""
import argparse
import json
import os
import sys

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque          # noqa: E402  (cliente del ERP: login, POST, reintento)
import aplicar_espejo  # noqa: E402  (credenciales del portal)

# Columna del portal -> campo de texto del ERP.
COLUMNA_A_TEXTO = {col: campo for campo, col in bloque.CAMPO_A_COLUMNA.items()}
COLUMNA_A_TEXTO['name'] = 'nombre'

# Columna del portal -> select del ERP (se resuelve etiqueta -> value).
COLUMNA_A_SELECT = {col: campo for campo, col in bloque.SELECT_A_COLUMNA.items()}
COLUMNA_A_SELECT['retencion_pct'] = 'porcentaje'

# Campos que solo existen en el portal. No es un fallo que no viajen.
SOLO_PORTAL = {'notes'}


def valor_de_select(ops, campo_erp, etiqueta):
    """Etiqueta del portal -> value del ERP. None si no hay coincidencia.

    Compara con `norm()` (sin acentos, sin mayúsculas) porque el portal guarda
    el catálogo oficial y el ERP su propia rotulación. No hace fuzzy: una
    abreviatura del ERP que no coincida devuelve None a propósito.
    """
    objetivo = bloque.norm(etiqueta or '')
    if not objetivo:
        return ''          # vaciar el campo es una intención válida
    for value, texto in ops.get(campo_erp, []):
        if bloque.norm(texto) == objetivo:
            return value
    # `retencion_pct` llega como número y la etiqueta del ERP suele ser '10%'.
    for value, texto in ops.get(campo_erp, []):
        if ''.join(c for c in texto if c.isdigit()) == objetivo:
            return value
    return None


def preparar(campos, ops, cambios):
    """(nuevos, aplicados, sin_resolver) para una ficha ya leída del ERP."""
    nuevos = dict(campos)
    aplicados, sin_resolver = [], []
    for c in cambios:
        col, valor = c['campo'], c['valor']
        if col in SOLO_PORTAL:
            sin_resolver.append({**c, 'motivo': 'campo que solo existe en el portal'})
            continue
        if col in COLUMNA_A_TEXTO:
            campo_erp = COLUMNA_A_TEXTO[col]
            nuevos[campo_erp] = valor if valor is not None else ''
            aplicados.append({**c, 'campo_erp': campo_erp,
                              'antes': campos.get(campo_erp, ''),
                              'envia': nuevos[campo_erp]})
        elif col in COLUMNA_A_SELECT:
            campo_erp = COLUMNA_A_SELECT[col]
            v = valor_de_select(ops, campo_erp, valor)
            if v is None:
                sin_resolver.append({
                    **c, 'motivo': f'{valor!r} no coincide con ninguna opción de '
                                   f'{campo_erp} en esta ficha (no se adivina)'})
                continue
            nuevos[campo_erp] = v
            aplicados.append({**c, 'campo_erp': campo_erp,
                              'antes': campos.get(campo_erp, ''), 'envia': v})
        else:
            sin_resolver.append({**c, 'motivo': 'sin equivalente en el ERP'})
    return nuevos, aplicados, sin_resolver


def verificar(aplicados, despues):
    """Lo que se mandó, ¿quedó? Devuelve la lista de los que NO."""
    return [a for a in aplicados
            if (despues.get(a['campo_erp']) or '') != (a['envia'] or '')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--escribir', action='store_true')
    ap.add_argument('--limite', type=int, default=0, help='0 = toda la cola')
    ap.add_argument('--pausa', type=float, default=1.0)
    a = ap.parse_args()

    url, key, usuario, clave = aplicar_espejo.credenciales()
    jwt = aplicar_espejo.token(url, key, usuario, clave)
    cab = {'apikey': key, 'Authorization': f'Bearer {jwt}',
           'Content-Type': 'application/json'}
    print(f'portal: autenticado como {usuario}')

    r = aplicar_espejo.pedir_json(f'{url}/rest/v1/rpc/cola_espejo_portal_erp',
                                  {'p_limite': a.limite or None}, cab)
    cola, excluidos = r.get('cola') or [], r.get('excluidos') or []
    print(f'cola: {len(cola)} ficha(s) con ediciones del portal por empujar\n')

    for x in excluidos:
        print(f'  excluido  {str(x["name"])[:34]:<36} {x["campo"]:<14} {x["motivo"]}')
    if excluidos:
        print()

    if not cola:
        print('nada que empujar.')
        return

    print('═' * 78)
    print(f'{"ESCRITURA" if a.escribir else "SIMULACIÓN"} — portal -> ERP')
    print('═' * 78)

    saldar, fallidas = [], 0
    for f in cola:
        campos, ops = bloque.leer_ficha(f['erp_id'])
        nuevos, aplicados, sin_resolver = preparar(campos, ops, f['cambios'])

        print(f'\n{f["name"][:52]}  (portal {f["customer_id"]}, erp {f["erp_id"]})')
        for x in aplicados:
            print(f'   · {x["campo"]} -> {x["campo_erp"]}: '
                  f'{x["antes"]!r} -> {x["envia"]!r}   (portal: {x["valor"]!r})')
        for x in sin_resolver:
            print(f'   ! {x["campo"]}: {x["motivo"]}')

        if not aplicados:
            print('   sin nada que mandar')
            continue
        if not a.escribir:
            continue

        payload = {**nuevos, 'process': 'edit', 'id_cliente': f['erp_id']}
        resp = bloque.escribir_ficha(payload)
        if resp.get('typeinfo') != 'Success':
            print(f'   RECHAZO del ERP: {resp.get("msg")} '
                  f'({resp.get("intentos")} intento/s) — NO se salda la cola')
            fallidas += 1
            continue

        despues, _ = bloque.leer_ficha(f['erp_id'])
        mal = verificar(aplicados, despues)
        # Y que no se haya llevado nada puesto de paso.
        perdidos = [k for k, v in campos.items()
                    if k not in bloque.NO_SON_CAMPOS and v
                    and not despues.get(k) and nuevos.get(k, '') != '']
        if mal or perdidos:
            print(f'   REVISAR  no quedó: {[x["campo_erp"] for x in mal]} · '
                  f'perdidos: {perdidos} — NO se salda la cola')
            fallidas += 1
            continue

        print(f'   OK  aplicado y verificado en el ERP')
        # Solo se saldan los ids de los campos que SÍ viajaron. Uno sin resolver
        # sigue pendiente, que es lo correcto: todavía no llegó al ERP.
        for x in aplicados:
            saldar.extend(x['changelog_ids'])

    if not a.escribir:
        print('\n(simulación — no se mandó nada y la cola quedó intacta)')
        return

    if saldar:
        m = aplicar_espejo.pedir_json(f'{url}/rest/v1/rpc/marcar_empujado_al_erp',
                                      {'p_ids': sorted(set(saldar))}, cab)
        print(f'\ncola saldada: {m.get("marcadas")} entrada(s) de changelog '
              f'marcadas como sincronizadas')
        print('   (con eso el espejo ERP -> portal deja de protegerlas: '
              'el ERP vuelve a mandar)')
    if fallidas:
        print(f'{fallidas} ficha(s) no se saldaron — se reintentan en la próxima corrida')


if __name__ == '__main__':
    main()
