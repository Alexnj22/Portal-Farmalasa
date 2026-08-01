"""Barrido de SOLO LECTURA sobre una muestra del catálogo de fichas del ERP.

Objetivo: saber qué hay realmente en dui / telefono1 / municipio / direccion
ANTES de activar las ramas que rellenan o borran. La rama del DUI es
destructiva, así que la pregunta no es "¿funciona?" —eso ya está probado— sino
"¿qué va a borrar?".

Muestra determinista (semilla fija) para que sea reproducible y auditable.
No escribe nada en el ERP.
"""
import collections, json, os, random, re, sys, time

D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
import bloque  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 120

idx = bloque.indice_erp()
todos = sorted({v for lista in idx.values() for v in lista}, key=int)
random.seed(20260731)
muestra = random.sample(todos, min(N, len(todos)))
print(f'catálogo: {len(todos)} fichas · muestra: {len(muestra)}\n')

filas, duis_malos, err = [], [], 0
for i, eid in enumerate(muestra, 1):
    try:
        campos, ops = bloque.leer_ficha(eid)
    except SystemExit:
        print('SESIÓN CAÍDA — refrescá erp.env'); break
    except Exception as e:
        err += 1
        continue
    cat = dict(ops.get('categoria', [])).get(campos.get('categoria', ''), '?')
    dui = (campos.get('dui') or '').strip()
    v = bloque.dui_valido(dui)
    tel = (campos.get('telefono1') or '').strip()
    filas.append({
        'erp_id': eid, 'categoria': cat,
        'telefono1': tel, 'tel_digitos': len(re.sub(r'\D', '', tel)),
        'tel_ok': bloque.telefono_valido(tel),
        'departamento': dict(ops.get('departamento', [])).get(campos.get('departamento', '')),
        'tel_vacio': not tel,
        'dui_estado': 'vacío' if v is None else ('válido' if v else 'INVÁLIDO'),
        'dui': dui,
        'sin_municipio': not campos.get('municipio'),
        'sin_distrito': bool(campos.get('municipio')) and not campos.get('distrito'),
        'sin_direccion': not (campos.get('direccion') or '').strip(),
        'direccion': (campos.get('direccion') or '').strip(),
    })
    if v is False:
        duis_malos.append((eid, dui, cat))
    if i % 20 == 0:
        print(f'   … {i}/{len(muestra)}')
    time.sleep(0.35)

json.dump(filas, open(f'{D}/barrido.json', 'w'), ensure_ascii=False, indent=1)
n = len(filas)
print(f'\nleídas {n} fichas ({err} errores)\n')

print('CATEGORÍA')
for k, c in collections.Counter(f['categoria'] for f in filas).most_common():
    print(f'   {c:>4} ({c*100//n:>3}%)  {k}')

cons = [f for f in filas if f['categoria'] == 'Consumidor']
print(f'\nSOBRE LOS {len(cons)} CONSUMIDORES (los únicos que se editan)')
print('   DEPARTAMENTO (importa: el matcher y el default asumen Chalatenango)')
for k, c in collections.Counter(f['departamento'] or '(vacío)' for f in cons).most_common(6):
    print(f'   {c:>4} ({c*100//max(len(cons),1):>3}%)  {k}')
print()
print('   TELÉFONO — regla nueva: 8 dígitos o se reemplaza')
for k, c in collections.Counter(
        'OK (8 dígitos)' if f['tel_ok'] else
        ('vacío' if f['tel_vacio'] else f'{f["tel_digitos"]} dígitos → SE PISA')
        for f in cons).most_common():
    print(f'   {c:>4} ({c*100//max(len(cons),1):>3}%)  {k}')
malos_tel = [f for f in cons if not f['tel_ok'] and not f['tel_vacio']]
if malos_tel:
    print('   los que se pisarían:')
    for f in malos_tel[:12]:
        print(f'      erp {f["erp_id"]:>7}  {f["telefono1"]!r}')
print()
for etiq, cond in (('teléfono 1 vacío  → 23010013', lambda f: f['tel_vacio']),
                   ('sin municipio     → default',   lambda f: f['sin_municipio']),
                   ('sin distrito      → matcher',   lambda f: f['sin_distrito']),
                   ('sin dirección     (no se toca)', lambda f: f['sin_direccion'])):
    c = sum(1 for f in cons if cond(f))
    print(f'   {c:>4} ({c*100//max(len(cons),1):>3}%)  {etiq}')
print('\n   DUI:')
for k, c in collections.Counter(f['dui_estado'] for f in cons).most_common():
    print(f'   {c:>4} ({c*100//max(len(cons),1):>3}%)  {k}')

if duis_malos:
    print(f'\nLOS {len(duis_malos)} DUI INVÁLIDOS — esto es lo que la rama BORRARÍA')
    print(f'   {"erp":>7}  {"valor":<22} {"dígitos":>7}  diagnóstico')
    for eid, dui, cat in duis_malos:
        d = re.sub(r'\D', '', dui)
        if len(d) == 14:
            diag = 'parece un NIT, no un DUI'
        elif len(d) == 9:
            diag = 'dígito verificador incorrecto'
        elif len(d) == 8:
            diag = 'le falta un dígito (¿cero inicial?)'
        elif not d:
            diag = 'sin dígitos'
        else:
            diag = f'longitud inesperada'
        marca = '' if cat == 'Consumidor' else f'  [{cat} → SE SALTA]'
        print(f'   {eid:>7}  {dui[:22]:<22} {len(d):>7}  {diag}{marca}')
else:
    print('\nDUI inválidos en la muestra: NINGUNO')
