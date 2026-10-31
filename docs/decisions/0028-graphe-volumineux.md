# ADR 0028 — Rendu des graphes volumineux

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0024)

## Contexte

Le plan 0013 a mesuré la validation sur 50 nœuds, pas le rendu. Le canevas de l'éditeur reconstruisait à chaque rendu tous ses nœuds React Flow, chacun avec un nouvel objet `data`. React Flow redessinait donc chaque carte à chaque pas d'un déplacement, à chaque frappe dans le panneau de propriétés et à chaque réponse de la validation. Le coût grandissait avec la taille du graphe, quel que soit le changement. L'éditeur recopie le document à chaque modification (`apply`, `structuredClone`) : l'identité des objets ne dit pas si un nœud a changé.

## Décision

- **Cartes mémoïsées.** `Card` (éditeur et graphe en lecture) passe par `React.memo` : une carte ne se redessine que si ses `data` ou sa sélection changent.
- **Nœuds et arêtes stables.** `useStable` (`app/src/stable.ts`) garde l'objet d'un nœud ou d'une arête tant que son contenu, comparé en JSON, ne change pas, et garde aussi le tableau si rien n'a changé.
  - On compare le contenu plutôt que l'identité, parce que le document est recopié à chaque modification.
  - Sérialiser 200 petits nœuds coûte bien moins que redessiner 200 cartes.
- **Seules les cartes visibles sont dessinées au-delà de 50 nœuds.** `onlyRenderVisibleElements` est activé quand le graphe dépasse `LARGE_GRAPH` (50), le volume que le plan 0013 a validé. En dessous, tout reste dessiné, comme avant.
- **Le graphe en lecture garde un rendu complet.** Il défile dans son conteneur au lieu de se déplacer dans React Flow (ADR 0017). Pour React Flow, tout le graphe est donc toujours visible, et seules la mémoïsation et la stabilité s'y appliquent.

## Conséquences

- Un déplacement ne redessine que la carte déplacée. Une modification ne redessine que le nœud modifié, un changement de sélection que les deux cartes concernées.
- Au-delà de 50 nœuds, une carte hors de la zone visible n'est pas dans le DOM.
  - On ne l'atteint donc pas à la tabulation. On la retrouve par le panneau Problèmes, qui centre le nœud (`goTo`), par la mini-carte ou par un déplacement de la vue.
  - Un lecteur d'écran garde l'accès au document entier par la vue « Éditer en YAML ».
- Le seuil est une constante (`LARGE_GRAPH`) : à revoir si une session réelle montre une gêne.
- Tests :
  - `app/src/editor/Canvas.test.tsx` (5 tests : rendus comptés par carte, et cartes dessinées au-delà du seuil) ;
  - `app/e2e/graphe-volumineux.spec.ts` (200 nœuds dans l'éditeur, temps notés au plan 0024).
