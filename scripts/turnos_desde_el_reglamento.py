#!/usr/bin/env python3
"""
Los turnos salen del REGLAMENTO INTERNO, no de la cabeza de nadie.

── Por qué existe este script ──────────────────────────────────────────────

Durante varios días pedí los turnos como si hubiera que inventarlos, y estaban
escritos y aprobados: el Art. 18 del reglamento interno los define uno por uno,
por sucursal, con hora de entrada, pausa alimenticia, hora de salida y día de
descanso — y dice «los horarios son rotativos cada 15 días».

El Código de Trabajo es el que manda el dato ahí: su **Art. 304** obliga al
reglamento a contener «Horas de entrada y salida de los trabajadores» y «Horas y
lapsos destinados para las comidas». Por eso el CONTRATO no lleva el horario
escrito: lleva la remisión (sucursal + turno), y el horario vive donde la ley lo
puso. Escribirlo en el contrato lo volvería falso a los 15 días.

── Tres trampas del PDF, las tres medidas ──────────────────────────────────

 1. El marcador del MEDIODÍA se escribe «m.d.» y rompía el patrón de hora. Un
    turno de El Paraíso salía empezando a las 19:00 en vez de las 12:30, porque
    su primera franja —«de 12:30 m.d. a 6:00 p.m.»— no se reconocía.
 2. La pausa NO se deduce del hueco entre dos franjas. Con tres franjas, la del
    medio ES la pausa, y deducirla daba «13:00–13:00». Se lee por su nombre.
 3. El SELLO de la Dirección General de Trabajo y el número de página se cuelan
    EN MEDIO de la frase: «pausa alimenticia de 12:00 m.d. a - 9- APROBADO
    DIRECCIÓN GENERAL DE TRABAJO 1:00 p.m.». Por eso el patrón tolera ruido
    entre el «a» y la hora.

Las tres se encontraron mirando el resultado contra el texto crudo, no leyendo
el código. Un parseo de un PDF escaneado que «anda» es un parseo que todavía no
se comparó con su fuente.

── Qué NO hace ─────────────────────────────────────────────────────────────

No escribe en la base. Imprime lo que leyó para que alguien lo compare, que es
justo el paso que las tres trampas de arriba hacen indispensable.

── Lo que el reglamento NO cubre ───────────────────────────────────────────

Sólo nombra 4 farmacias. Hoy hay 6 más Bodega y Administración:

  · Salud 3 y Salud 5 no están. Decisión del usuario (27-ago-2026): Salud 3 toma
    los turnos de Salud 4 (El Paraíso) y Salud 5 los de Salud 2.
  · Bodega no está y no se definió.
  · El reglamento dice que la casa matriz es la de Calle Morazán (hoy Salud 2);
    el usuario confirmó que **hoy es Salud 3**. El reglamento está en
    modificación y mientras tanto se trabaja sobre él.

Eso NO lo arregla el portal: el Art. 302 exige que la modificación del
reglamento también la apruebe la Dirección General de Trabajo.

    python3 scripts/turnos_desde_el_reglamento.py
"""
import io,re,json
s=io.open('docs/legal/reglamento_interno_de_trabajo.txt',encoding='utf-8').read()
i=s.find('Art. 18.-'); j=s.find('Art. 19.-')
txt=' '.join(s[i:j].split())

anclas=[('Casa Matriz','Calle Morazán #39'),('Cuarta Calle Oriente','4a Calle Oriente #3'),
        ('La Popular','La Popular'),('El Paraíso, departamento','El Paraíso')]
cortes=[txt.find(a) for a,_ in anclas]+[len(txt)]

# El marcador del mediodía se escribe «m.d.» y rompía el patrón: el turno de
# El Paraíso arrancaba a las 19:00 en vez de las 12:30 porque su primera franja
# —«de 12:30 m.d. a 6:00 p.m.»— no se reconocía. Y por lo mismo ningún almuerzo
# de 12:00 m.d. se leía.
MARCA = r'(a\.?\s?m\.?|p\.?\s?m\.?|m\.?\s?d\.?|m\.?)'
RE_DIA=re.compile(r'(De lunes a viernes|De lunes a jueves|Sábado y domingo|Sábado|Domingo|Viernes)\s*:\s*(.*?)(?=(?:De lunes|Sábado|Domingo|Viernes|TURNO|$))')
RE_PAUSA=re.compile(r'pausa alimenticia de (\d{1,2}:\d{2})\s*'+MARCA+r'\s*a\s*(?:.{0,120}?)(\d{1,2}:\d{2})\s*'+MARCA)
RE_FRANJA=re.compile(r'de (\d{1,2}:\d{2})\s*'+MARCA+r'\s*a\s*(\d{1,2}:\d{2})\s*'+MARCA)

def h24(t,marca):
    hh,mm=t.split(':'); hh=int(hh); m=marca.replace('.','').replace(' ','')
    if m.startswith('p') and hh!=12: hh+=12
    elif m.startswith('a') and hh==12: hh=0
    # «m» y «md» son el mediodía: 12:00 se queda en 12, y 12:30 también.
    return f'{hh:02d}:{mm}'

salida={}
for idx,(a,nombre) in enumerate(anclas):
    bloque=txt[cortes[idx]:cortes[idx+1]]
    partes=re.split(r'TURNO\s*(\d)\s*:', bloque)
    lista=[]
    for t in range(1,len(partes),2):
        num=int(partes[t]); cuerpo=partes[t+1]
        dias={}
        for d,resto in RE_DIA.findall(cuerpo):
            if 'descanso' in resto: dias[d]='descanso'; continue
            pausa=RE_PAUSA.search(resto)
            fr=RE_FRANJA.findall(RE_PAUSA.sub(' ', resto))
            if not fr: continue
            dias[d]={'entra':h24(fr[0][0],fr[0][1]),'sale':h24(fr[-1][2],fr[-1][3]),
                     'almuerzo':(h24(pausa.group(1),pausa.group(2)),h24(pausa.group(3),pausa.group(4))) if pausa else None}
        lista.append({'turno':num,'dias':dias})
    salida[nombre]=lista
io.open('/tmp/turnos_rit.json','w').write(json.dumps(salida,ensure_ascii=False,indent=1))
for suc,ts in salida.items():
    print(f'\n══ {suc} ══')
    for t in ts:
        for d,v in t['dias'].items():
            if v=='descanso': print(f"  T{t['turno']} · {d:20} descanso"); continue
            alm=f"  almuerzo {v['almuerzo'][0]}–{v['almuerzo'][1]}" if v['almuerzo'] else '  SIN PAUSA'
            print(f"  T{t['turno']} · {d:20} {v['entra']} → {v['sale']}{alm}")
