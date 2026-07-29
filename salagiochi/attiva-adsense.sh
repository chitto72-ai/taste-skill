#!/usr/bin/env bash
#
# Attiva Google AdSense su tutti i giochi di Sala Giochi con un solo comando.
#
# USO:
#   ./attiva-adsense.sh ca-pub-1234567890123456 [SLOT_SOPRA] [SLOT_SOTTO]
#
#   - ca-pub-...   (OBBLIGATORIO) il tuo Publisher ID AdSense
#   - SLOT_SOPRA   (facoltativo)  ID dell'unità annuncio in alto
#   - SLOT_SOTTO   (facoltativo)  ID dell'unità annuncio in basso
#
# Se non passi gli slot, lascia i placeholder: in quel caso attiva gli
# "Auto ads" dalla dashboard AdSense (basta un interruttore) e gli annunci
# compaiono comunque grazie allo script del publisher.
#
set -euo pipefail
cd "$(dirname "$0")"

PUB="${1:-}"
SLOT_TOP="${2:-}"
SLOT_BOTTOM="${3:-}"

if [[ -z "$PUB" ]]; then
  echo "❌ Manca il Publisher ID."
  echo "   Esempio: ./attiva-adsense.sh ca-pub-1234567890123456"
  exit 1
fi
if [[ ! "$PUB" =~ ^ca-pub-[0-9]{16}$ ]]; then
  echo "❌ Publisher ID non valido: deve essere tipo ca-pub-1234567890123456 (16 cifre)."
  exit 1
fi

echo "▶ Attivo AdSense con Publisher ID: $PUB"

# Sostituisci il Publisher ID in tutti i file HTML (home + giochi)
FILES=$(grep -rl 'ca-pub-XXXXXXXXXXXXXXXX' . --include='*.html' || true)
if [[ -z "$FILES" ]]; then
  echo "ℹ Nessun placeholder ca-pub-XXXXXXXXXXXXXXXX trovato (forse già attivato)."
else
  echo "$FILES" | xargs sed -i "s/ca-pub-XXXXXXXXXXXXXXXX/$PUB/g"
  echo "✔ Publisher ID inserito in tutte le pagine."
fi

# Sostituisci gli slot se forniti
if [[ -n "$SLOT_TOP" ]]; then
  grep -rl 'data-ad-slot="1111111111"' . --include='*.html' | xargs -r sed -i "s/data-ad-slot=\"1111111111\"/data-ad-slot=\"$SLOT_TOP\"/g"
  echo "✔ Slot superiore impostato: $SLOT_TOP"
fi
if [[ -n "$SLOT_BOTTOM" ]]; then
  grep -rl 'data-ad-slot="2222222222"' . --include='*.html' | xargs -r sed -i "s/data-ad-slot=\"2222222222\"/data-ad-slot=\"$SLOT_BOTTOM\"/g"
  echo "✔ Slot inferiore impostato: $SLOT_BOTTOM"
fi

echo
echo "✅ Fatto. Ora ridistribuisci il sito (deploy) e verifica che il dominio"
echo "   sia APPROVATO nella dashboard AdSense. Gli annunci reali compaiono solo"
echo "   dopo l'approvazione di Google."
