cd /Users/alexnunez/Documents/Portal-Farmalasa
S=/private/tmp/claude-501/-Users-alexnunez-Documents-Portal-Farmalasa/e56167b9-fb3a-4c60-949f-c36ef2d30f1c/scratchpad
RUTAS=$(python3 -c "
import sys, pathlib; sys.path.insert(0,'$S')
from migA import candidatos
for f in sorted(pathlib.Path('src').rglob('*.jsx')):
    if 'components/common/' in str(f): continue
    _,o=candidatos(str(f))
    if o: print(f)
")
OK=0; MAL=0; N=0
for r in $RUTAS; do
  ANTES=$(wc -c < "$r")
  CNT=$(python3 -c "
import sys; sys.path.insert(0,'$S')
from migA import migra
print(migra('$r'))")
  DESPUES=$(wc -c < "$r")
  if npx eslint "$r" 2>&1 | grep -q 'Parsing error\|no-undef'; then
    git checkout -- "$r"; MAL=$((MAL+1)); echo "  REVERTIDO $r"
  elif [ "$DESPUES" -lt $((ANTES / 2)) ]; then
    git checkout -- "$r"; MAL=$((MAL+1)); echo "  REVERTIDO (truncado) $r"
  else
    OK=$((OK+1)); N=$((N+CNT)); echo "  ok ($CNT) $r"
  fi
done
echo; echo "archivos $OK · botones $N · revertidos $MAL"
