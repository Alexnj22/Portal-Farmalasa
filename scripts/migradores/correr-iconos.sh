set -e
cd /Users/alexnunez/Documents/Portal-Farmalasa
S=/private/tmp/claude-501/-Users-alexnunez-Documents-Portal-Farmalasa/e56167b9-fb3a-4c60-949f-c36ef2d30f1c/scratchpad
RUTAS=$(python3 -c "
import sys, re, pathlib
sys.path.insert(0,'$S')
from btnlib import botones, limpiar_comentarios
for f in sorted(pathlib.Path('src').rglob('*.jsx')):
    if 'components/common/' in str(f): continue
    txt=pathlib.Path(f).read_text()
    for ini,ft,fin,cuerpo,cont in botones(f):
        if 'className' not in cuerpo: continue
        c2=limpiar_comentarios(cont)
        if re.sub(r'<[^>]*>','',c2).strip() or not re.search(r'<[A-Z]\w*',c2): continue
        if 'w-px bg-divider' in txt[max(0,ini-900):ini]: continue
        print(f); break
")
OK=0; MAL=0
for r in $RUTAS; do
  ANTES=$(wc -c < "$r")
  python3 -c "
import sys; sys.path.insert(0,'$S')
from migicon import migra
migra('$r')" >/dev/null
  DESPUES=$(wc -c < "$r")
  if npx eslint "$r" 2>&1 | grep -q 'Parsing error'; then
    git checkout -- "$r"; MAL=$((MAL+1)); echo "  REVERTIDO (parse) $r"
  elif [ "$DESPUES" -lt $((ANTES / 2)) ]; then
    git checkout -- "$r"; MAL=$((MAL+1)); echo "  REVERTIDO (truncado $ANTES→$DESPUES) $r"
  else
    OK=$((OK+1)); echo "  ok  $r  ($ANTES→$DESPUES)"
  fi
done
echo; echo "migrados $OK · revertidos $MAL"
