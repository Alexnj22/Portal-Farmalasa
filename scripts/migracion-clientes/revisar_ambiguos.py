"""Revisa las fichas cuyo distrito se resolvió por DESEMPATE, y reencola las malas.

Un desempate no es "50% de acierto": es 50% de error **en los casos donde la
dirección sí decía cuál era**. Por eso el contador de ambiguos no es ruido, es
una lista de trabajo — y dos bloques seguidos encontraron un defecto del matcher
mirándola:

  bloque 4 · "DISTRITO, DEPARTAMENTO"  -> 2 de 5 mal (erp 176, 380)
  bloque 5 · los dos comparten palabra -> 2 de 4 mal (erp 2112, 2304)

Este script cierra ese ciclo sin trabajo manual:

    python3 revisar_ambiguos.py            # solo informa
    python3 revisar_ambiguos.py --corregir  # escribe la corrección en el ERP

**No alcanza con reencolarlas** (borrar su entrada del checkpoint para que el
próximo bloque las rehaga). Se intentó así primero y no corrigió nada: la regla
del distrito solo actúa si el campo está VACÍO —`elif not campos.get('distrito')`
en `planificar`— y estas fichas ya tienen uno, el equivocado. Salen "sin
cambios" y el error queda.

Por eso este script ESCRIBE. Usa el mismo camino verificado que un bloque
(`bloque.aplicar_ficha`): reenvía los 21 campos, relee para verificar, espeja al
portal y anota el checkpoint. Nada de eso se reimplementa acá.

Cómo sabe cuáles mirar: el checkpoint guarda el MOTIVO de cada distrito, así que
las resueltas por desempate quedan marcadas con 'ambiguo' en `cambios.distrito`.
No hace falta una lista aparte — que además se desincronizaría.
"""
import argparse
import os
import re
import sys
import time

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402


# El motivo real viene de `elegir_distrito` como 'ambiguo (N candidatos)', y en
# el checkpoint queda entre paréntesis: "SAN J CANCASQUE (ambiguo (2 ...))".
# Buscar la subcadena pelada 'ambiguo' se detectaba a sí misma: el texto que
# escribe la corrección dice "(corregido por revisar_ambiguos)", así que cada
# ficha corregida volvía a la lista para siempre y se releía del ERP en cada
# pasada. Una lista de trabajo que nunca se vacía deja de leerse.
MARCA_AMBIGUO = re.compile(r'\(ambiguo\b')


def candidatas(ck):
    """Las fichas que se resolvieron por desempate, en orden de erp_id."""
    return sorted((k for k, v in ck.items()
                   if MARCA_AMBIGUO.search(str(v.get('cambios', {}).get('distrito', '')))),
                  key=int)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corregir', action='store_true',
                    help='escribe la corrección en el ERP (por defecto solo informa)')
    ap.add_argument('--fichas', default='',
                    help='erp_id separados por coma, para revisar fichas que ya '
                         'no traen la marca de ambiguo en el checkpoint')
    ap.add_argument('--pausa', type=float, default=0.4)
    a = ap.parse_args()

    ck = bloque.cargar_checkpoint()
    # Con `--fichas` se revisan las que se pidan. Hace falta porque la marca de
    # 'ambiguo' vive en el checkpoint y se pierde si la ficha se reprocesa: pasó
    # el 2026-08-01 al reencolar cuatro, que volvieron a salir "sin cambios" —el
    # distrito ya no estaba vacío— y quedaron sin rastro. La detección
    # automática es de una sola oportunidad; esta puerta es la de atrás.
    fichas = ([e.strip() for e in a.fichas.split(',') if e.strip()]
              if a.fichas else candidatas(ck))
    print(f'{len(fichas)} fichas se resolvieron por desempate. Releyéndolas del ERP…\n')

    cambian, iguales, sorteos = [], 0, 0
    for eid in fichas:
        campos, ops = bloque.leer_ficha(eid)
        etiq = dict(ops.get('distrito', []))
        actual = campos.get('distrito', '')
        # La semilla del sorteo es el `portal_id` con el que se PLANIFICÓ la
        # ficha ('erp:4420'), no el erp_id pelado ('4420') — `planificar` pasa
        # `cliente['id']`. Con la semilla equivocada esto era otro sorteo: para
        # una ficha que ninguna regla resuelve reportaba "CAMBIA" la mitad de
        # las veces, y con --corregir escribía la otra cara de la misma moneda.
        # El checkpoint guarda el portal_id justamente porque los primeros
        # bloques se armaron desde el portal y ahí NO es 'erp:N'.
        semilla = (ck.get(eid) or {}).get('portal_id') or f'erp:{eid}'
        nuevo, motivo, _ = bloque.elegir_distrito(
            semilla, campos.get('direccion', ''), ops.get('distrito', []),
            bloque.ubicacion_de(campos, ops))
        ambigua = 'ambiguo' in motivo
        marca = 'igual' if nuevo == actual else ('SORTEO' if ambigua else 'CAMBIA')
        if nuevo == actual:
            iguales += 1
        elif ambigua:
            # Ninguna regla la resuelve: el valor nuevo es otro sorteo entre los
            # mismos candidatos, no una corrección. Escribirlo haría oscilar la
            # ficha en el ERP a cada pasada sin acercarse a la respuesta.
            sorteos += 1
        else:
            cambian.append({'eid': eid, 'campos': campos, 'ops': ops,
                            'nuevo': nuevo, 'antes': etiq.get(actual, '(vacío)'),
                            'despues': etiq.get(nuevo, '?')})
        print(f'  {marca:<6} erp {eid:<6} {(campos.get("direccion") or "")[:38]:<40} '
              f'{etiq.get(actual, "(vacío)"):<26} -> {etiq.get(nuevo, "?")}')
        if ambigua:
            print(f'         (sigue ambigua: {motivo} — leerla a mano; '
                  f'{"no se escribe: sería otro sorteo" if nuevo != actual else "el valor de hoy coincide"})')
        time.sleep(a.pausa)

    print(f'\n{iguales} quedaron bien · {len(cambian)} cambian con las reglas de hoy'
          + (f' · {sorteos} sin regla que las resuelva (NO se escriben)' if sorteos else ''))
    if not cambian:
        return
    if not a.corregir:
        print('\n(no se escribió nada — agregá --corregir)')
        return

    print('\n' + '═' * 70)
    print('CORRIGIENDO EN EL ERP')
    print('═' * 70)
    class Opciones:                      # lo que `aplicar_ficha` espera
        pausa_escritura = 1.0
        pausa_reintento = bloque.PAUSA_REINTENTO
    ambiguos = []
    for c in cambian:
        nuevos = dict(c['campos'])
        nuevos['distrito'] = c['nuevo']
        fila = {'id': f"erp:{c['eid']}", 'name': (c['campos'].get('nombre') or '').strip(),
                'erp_id': c['eid'], 'campos': dict(c['campos']), 'ops': dict(c['ops']),
                'nuevos': nuevos, 'estado': 'listo',
                'cambios': {'distrito': f"{c['antes']} -> {c['despues']} "
                                        f"(corregido por revisar_ambiguos)"},
                'portal': None}
        bloque.aplicar_ficha(fila, ck, ambiguos, Opciones())
    print('\nListo. El espejo al portal queda en portal_pendiente.jsonl: '
          'corré `python3 aplicar_espejo.py --aplicar`.')


if __name__ == '__main__':
    main()
