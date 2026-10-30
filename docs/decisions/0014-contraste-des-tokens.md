# ADR 0014 — Contraste des tokens `--atlas-mid` et `--atlas-warn`

Date : 2026-10-30 · Statut : **acceptée** (tranche l'écart laissé ouvert par l'ADR 0013)

## Contexte

L'ADR 0013 relevait trois couples de couleurs sous le seuil de 4,5:1 que la section 6 du guide fixe pour tout texte :

- blanc sur `--atlas-mid` (élément actif de la navigation) : 4,04:1 ;
- blanc sur `--atlas-warn` (compteur de la navigation) : 4,09:1 ;
- `--atlas-warn` sur blanc (propositions en attente sur les cartes) : 4,09:1.

Le guide annonçait des contrastes faux : 4,6:1 pour `--atlas-warn` sur blanc, et pour les autres couleurs des valeurs qui ne correspondaient pas au calcul. Le test axe-core tolérait ces trois usages.

## Décision

- **Les deux couleurs foncent d'environ 10 %**, teinte conservée :
  - `--atlas-mid` passe de `#2E8C83` à `#297E76` ;
  - `--atlas-warn` passe de `#C2641E` à `#AF5A1B`.
- **Les tokens qui partagent ces valeurs suivent** pour que la palette reste cohérente : `--atlas-ok` et `--atlas-node-ref` (même vert que `--atlas-mid`), `--atlas-node-combine` (même orange que `--atlas-warn`).
- **Les maquettes HTML et le tableau du guide** prennent les nouvelles valeurs.
- **La ligne des contrastes du guide** donne les valeurs calculées (WCAG 2.1, arrondies au dixième) :

  | Couple | Contraste |
  |---|---|
  | blanc sur `--atlas-mid` | 4,8:1 |
  | blanc sur `--atlas-warn`, `--atlas-warn` sur blanc | 4,9:1 |
  | `--atlas-warn` sur `--atlas-warn-bg` | 4,6:1 |
  | `--atlas-muted` sur blanc | 5,0:1 |
  | `--atlas-pale` sur `--atlas-brand` | 8,2:1 |
  | `--atlas-bad` sur blanc | 5,9:1 |

- **Limite d'usage écrite dans le guide.** `--atlas-mid` et `--atlas-warn` restent sous 4,5:1 sur trois fonds :
  - `--atlas-pale` (4,3:1) ;
  - `--atlas-ground` (4,48:1) ;
  - `--atlas-warn-cell` (4,0:1).

  Sur ces fonds, le texte reste en `--atlas-ink`. Aucune maquette ne fait autrement aujourd'hui.
- **Le test axe-core n'a plus d'exception.** Toute violation sérieuse le fait échouer, contraste compris.

## Conséquences

- Toutes les teintes vertes et orange de l'interface et des maquettes changent légèrement. Le survol des liens et le contour de focus utilisent aussi `--atlas-mid`, et foncent donc avec lui.
- Une nouvelle couleur de texte, ou un nouveau fond sous `--atlas-mid` ou `--atlas-warn`, doit vérifier son contraste avant d'entrer dans le guide.
