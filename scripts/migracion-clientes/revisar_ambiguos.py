"""Revisa las fichas cuyo distrito se resolvió por DESEMPATE, y reencola las malas.

Un desempate no es "50% de acierto": es 50% de error **en los casos donde la
dirección sí decía cuál era**. Por eso el contador de ambiguos no es ruido, es
una lista de trabajo — y dos bloques seguidos encontraron un defecto del matcher
mirándola:

  bloque 4 · "DISTRITO, DEPARTAMENTO"  -> 2 de 5 mal (erp 176, 380)
  bloque 5 · los dos comparten palabra -> 2 de 4 mal (erp 2112, 2304)

Este script cierra ese ciclo sin trabajo manual:

    python3 revisar_ambiguos.py             # solo informa
    python3 revisar_ambiguos.py --reencolar # borra del checkpoint las que cambian

Reencolar = borrar su entrada del checkpoint. El próximo bloque las vuelve a
tomar (van primeras, porque el orden es por erp_id) y las rehace con las reglas
de hoy. Es más barato que subir `REGLAS`, que relee TODO el catálogo procesado
para corregir un puñado.

Cómo sabe cuáles mirar: el checkpoint guarda el MOTIVO de cada distrito, así que
las resueltas por desempate quedan marcadas con 'ambiguo' en `cambios.distrito`.
No hace falta una lista aparte — que además se desincronizaría.
"""
import argparse
import os
import sys
import time

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402


def candidatas(ck):
    """Las fichas que se resolvieron por desempate, en orden de erp_id."""
    return sorted((k for k, v in ck.items()
                   if 'ambiguo' in str(v.get('cambios', {}).get('distrito', ''))),
                  key=int)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--reencolar', action='store_true')
    ap.add_argument('--pausa', type=float, default=0.4)
    a = ap.parse_args()

    ck = bloque.cargar_checkpoint()
    fichas = candidatas(ck)
    print(f'{len(fichas)} fichas se resolvieron por desempate. Releyéndolas del ERP…\n')

    cambian, iguales = [], 0
    for eid in fichas:
        campos, ops = bloque.leer_ficha(eid)
        etiq = dict(ops.get('distrito', []))
        actual = campos.get('distrito', '')
        nuevo, motivo, _ = bloque.elegir_distrito(
            eid, campos.get('direccion', ''), ops.get('distrito', []),
            bloque.ubicacion_de(campos, ops))
        marca = 'igual' if nuevo == actual else 'CAMBIA'
        if nuevo == actual:
            iguales += 1
        else:
            cambian.append(eid)
        print(f'  {marca:<6} erp {eid:<6} {(campos.get("direccion") or "")[:38]:<40} '
              f'{etiq.get(actual, "(vacío)"):<26} -> {etiq.get(nuevo, "?")}')
        if 'ambiguo' in motivo:
            print(f'         (sigue ambigua: {motivo})')
        time.sleep(a.pausa)

    print(f'\n{iguales} quedaron bien · {len(cambian)} cambian con las reglas de hoy')
    if not cambian:
        return
    print(f'   {cambian}')
    if not a.reencolar:
        print('\n(no se tocó el checkpoint — agregá --reencolar)')
        return

    for eid in cambian:
        ck.pop(eid, None)
    bloque.volcar_json(bloque.CHECKPOINT, ck)
    print(f'\nreencoladas: el checkpoint queda con {len(ck)} fichas.')
    print('Las toma el próximo bloque, y van primeras porque el orden es por erp_id.')


if __name__ == '__main__':
    main()
