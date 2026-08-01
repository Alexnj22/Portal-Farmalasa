"""Lee las dos (o más) fichas de cada nombre duplicado y dice cuál debería ganar.

El espejo al portal empareja por nombre, y `customers` tiene UNA fila por
cliente. Cuando dos fichas del ERP normalizan al mismo nombre no hay a dónde
mandar las dos, así que hoy se omiten las dos y esos clientes se quedan sin
espejar. Para desbloquearlos hay que decidir cuál `erp_id` gana.

La decisión NO es a dedo. Se lee cada ficha y se compara campo por campo:

  IDÉNTICAS     los datos coinciden y solo difiere el nombre crudo (un espacio,
                un tabulador, una minúscula). No hay nada que decidir.
  SUPERSET      una tiene todo lo de la otra y algo más. Gana la más completa.
  CONFLICTO     las dos tienen valor y son distintos en un campo que identifica
                a la persona (DUI, NIT, NRC). Eso ya no es un duplicado
                tipográfico: puede que sean dos personas. Va a una persona.

Salida: `duplicados_resueltos.json`, que es lo que consume `aplicar_espejo.py`
para mandar UNA fila por nombre en vez de omitir las dos.

    python3 revisar_duplicados.py
"""
import json
import os
import sys
import time

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402

# Campos que identifican a la persona: si dos fichas difieren acá, no es un
# duplicado tipográfico y no lo resuelve un script.
IDENTIFICAN = ('dui', 'nit', 'nrc', 'pasaporte')
# Los que se comparan para medir "más completa". El nombre queda afuera a
# propósito: es justo lo que difiere en todos estos casos.
COMPARABLES = IDENTIFICAN + ('telefono1', 'telefono2', 'correo', 'direccion',
                             'departamento', 'municipio', 'distrito', 'categoria')


def limpio(campos, k):
    return (campos.get(k) or '').strip()


def llenos(campos):
    return {k for k in COMPARABLES if limpio(campos, k)}


def comparar(fichas):
    """fichas: {erp_id: campos}. Devuelve (veredicto, ganador, detalle)."""
    ids = list(fichas)
    choques = {}
    for k in IDENTIFICAN:
        valores = {limpio(fichas[i], k) for i in ids if limpio(fichas[i], k)}
        if len(valores) > 1:
            choques[k] = {i: limpio(fichas[i], k) for i in ids}
    if choques:
        return 'CONFLICTO', None, choques

    difs = {k: {i: limpio(fichas[i], k) for i in ids}
            for k in COMPARABLES
            if len({limpio(fichas[i], k) for i in ids}) > 1}
    if not difs:
        # Datos idénticos: gana la de id más bajo, que es la original — la que
        # viene arrastrando el historial de ventas.
        return 'IDÉNTICAS', min(ids, key=int), {}

    conjuntos = {i: llenos(fichas[i]) for i in ids}
    for i in ids:
        if all(conjuntos[i] >= conjuntos[j] for j in ids) and \
           any(conjuntos[i] > conjuntos[j] for j in ids):
            return 'SUPERSET', i, difs
    # Ninguna contiene a la otra, pero tampoco chocan en los identificadores:
    # difieren en un dato blando (dirección, teléfono). Gana la más completa y,
    # a igualdad, la original.
    tope = max(len(conjuntos[i]) for i in ids)
    empatadas = [i for i in ids if len(conjuntos[i]) == tope]
    return 'MÁS COMPLETA', min(empatadas, key=int), difs


def main():
    dups = json.load(open(f'{D}/duplicados_erp.json'))
    print(f'{len(dups)} nombres duplicados · '
          f'{sum(len(d["erp_ids"]) for d in dups)} fichas a leer\n')

    resueltos, pendientes, filas = {}, [], []
    for d in dups:
        fichas, opciones = {}, {}
        for eid in d['erp_ids']:
            campos, ops = bloque.leer_ficha(eid)
            fichas[eid], opciones[eid] = campos, ops
            time.sleep(0.4)
        veredicto, ganador, detalle = comparar(fichas)
        nombre = (fichas[d['erp_ids'][0]].get('nombre') or '').strip()
        filas.append({'nombre': nombre, 'normalizado': d['nombre_normalizado'],
                      'erp_ids': d['erp_ids'], 'difieren_en': d['difieren_en'],
                      'veredicto': veredicto, 'ganador': ganador,
                      'detalle': detalle})

        print(f'{veredicto:<13} {nombre[:44]:<46} {d["erp_ids"]}'
              f'{"" if not ganador else f"  -> gana {ganador}"}')
        for k, porficha in detalle.items():
            print(f'                 · {k}: ' +
                  ' | '.join(f'{i}={v!r}' for i, v in porficha.items()))

        if ganador:
            # La llave es la del espejo: `customers.search_name`.
            resueltos[(fichas[ganador].get('nombre') or '').strip().lower()] = ganador
            # Y se encola la fila de la ganadora. Estas fichas ya están en el
            # checkpoint —se corrigieron en bloques anteriores— así que ninguna
            # corrida las va a volver a leer: si no se encolan acá, la decisión
            # no llega nunca al portal.
            bloque.anotar_portal(bloque.fila_portal(
                {'id': f'erp:{ganador}'}, ganador, fichas[ganador], opciones[ganador]))
        else:
            pendientes.append(nombre)

    bloque.volcar_json(f'{D}/duplicados_resueltos.json', resueltos)
    print(f'\nresueltos: {len(resueltos)} -> duplicados_resueltos.json '
          f'(y encolados en portal_pendiente.jsonl)')
    if pendientes:
        print(f'requieren una persona ({len(pendientes)}): '
              f'{", ".join(p[:30] for p in pendientes)}')
        print('  (chocan en DUI/NIT/NRC: pueden ser dos personas distintas)')


if __name__ == '__main__':
    main()
