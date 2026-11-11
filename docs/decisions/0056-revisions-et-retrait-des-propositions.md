# ADR 0056 — Révisions et retrait des propositions

## Contexte

Après une demande de changements, l'auteur doit pouvoir corriger une proposition sans en ouvrir une autre. L'auteur ou un référent doit aussi pouvoir la retirer.

## Décision

Une révision est un commit sur la branche existante, enfant de sa tête. Seul l'auteur peut l'envoyer. Le document conserve son identité et passe les mêmes contrôles que lors de la création avant la poussée. Un bail Git refuse une tête concurrente. Le bloc Atlas est recalculé à la lecture à partir de la tête et de la base, sans mise à jour du corps de la PR après le push ; la classification utilisée pour le décompte et la fusion est elle aussi recalculée. Les revues portant sur une tête antérieure sont signalées comme telles.

Le détail présente les commits, revues et commentaires dans l'ordre chronologique. Les commits manuels appartiennent aussi à l'historique et gardent leur auteur Git. Pour les révisions créées par Atlas, les noms Git de l'auteur et du committer portent le compte qui les a envoyées, indépendamment du nom Git configuré sur le poste. La note accompagne le commit.

L'auteur, un référent du domaine ou un référent d'espace peut fermer la proposition ouverte, avec un motif facultatif. La branche reste disponible ; Atlas ne propose pas de réouverture. GitHub conserve la fermeture dans la pull request et le motif dans un commentaire.

## Conséquences

Les approbations d'un ancien commit ne comptent plus. Une demande de changements reste bloquante jusqu'à ce que son auteur approuve la nouvelle tête, comme sur GitHub. La branche et son historique restent consultables après retrait.
