# ADR 0026 — Comparer une déclinaison from scratch

Date : 2026-10-31 · Statut : **acceptée** (mise en œuvre du plan 0022)

## Contexte

En mode `from_scratch`, l'ADR 0012 rebranche chaque source du canonique sur la source de la déclinaison rattachée au même concept. Chaque colonne s'y retrouve par son `binding`, sinon par son nom, avec le même type. Nordis ES ne se comparait pas : `canonical_not_rebindable`. Le diagnostic montre deux causes.

- **Le moteur était trop strict** :
  - il exigeait toutes les colonnes déclarées par la source du canonique, même `facture_id`, qu'aucun nœud ne lit ;
  - il ne cherchait une colonne par son attribut que si le canonique la rattachait explicitement. `statut`, attribut de Commande sans `binding` dans le canonique, ne pouvait donc se retrouver que par son nom ;
  - une source du canonique sans source de la déclinaison pour son concept (n06, Date de référence) bloquait tout.
- **Les données manquaient vraiment.** La table espagnole n'avait ni montant TTC, ni taxes, ni avoirs, ni date de facture. Elle n'avait qu'un `fecha` en `timestamp`, et un statut local (`cerrada`) qui n'est pas celui du groupe (`validée`). Aucun moteur ne peut évaluer `montant_ttc - montant_taxes - avoirs` sur ces colonnes.

Points à trancher :
- la correspondance des colonnes ;
- les colonnes exigées ;
- les types compatibles ;
- une source sans équivalent dans la déclinaison ;
- les données de la démonstration.

## Décision

- **Une colonne compte pour son attribut de concept.** C'est celui que lui donne son `binding`, sinon son propre nom (convention du diff, plan 0003), des deux côtés. Une colonne du canonique se retrouve dans la source candidate par cet attribut, sinon par son nom. Si plusieurs sources de la déclinaison sont rattachées au concept, Atlas garde celle qui laisse le moins de colonnes manquantes.
- **Seules comptent les colonnes nécessaires** :
  - celles que le graphe du canonique lit. Une colonne est lue si son retrait fait échouer la propagation des colonnes (`propagate`) : le contrôle est celui du modèle, sans liste de références à tenir à part ;
  - celles que le canonique rattache au concept, parce que le scope filtre et regroupe sur elles.

  Une autre colonne introuvable est retirée de la source rebranchée, et du SQL compilé.
- **Types : égaux, ou un entier élargi.** `integer` est admis là où le canonique attend `decimal` ou `double`, sans perte. Rien d'autre : un `timestamp` pour une `date` serait une conversion de fuseau implicite, que Skifer refuse. Les types n'ont pas de précision dans le modèle : il n'y a pas d'écart de précision à tolérer.
- **Source commune.** Une source du canonique dont le concept n'a aucune source dans la déclinaison garde sa table. Une source sans concept est traitée de même. Elle est lue sur la plateforme de la déclinaison, comme une source non surchargée en mode `override` (ADR 0022 : même table, à la plateforme près). `Rebound.common` les liste. Au moins une source doit être rebranchée : une déclinaison qui ne partage aucun concept avec le canonique est refusée.
- **Un refus dit quoi rattacher.** Le message de `canonical_not_rebindable` nomme la source, la table candidate et chaque colonne manquante. Une colonne d'un autre type porte les deux types : « montant_taxes (decimal attendu, string dans iva) ». Le message invite à rattacher la colonne au concept par un `binding`.
- **Les données de la démonstration sont complétées, pas contournées.**
  - La source ES déclare `estado_grupo`, `fecha_factura`, `importe_bruto`, `iva` et `abonos`.
  - Son `binding` les rattache à `statut`, `date_facture`, `montant_ttc`, `montant_taxes` et `avoirs`.
  - Le concept Commande déclare ces quatre derniers attributs : un `binding` vise un attribut déclaré. Sa version reste la 5, car la démonstration n'a pas d'historique de Commande.
  - Le graphe d'ES ne change pas : il calcule toujours sur `importe_neto`, `estado` et `fecha`.
  - `core/tests/fixtures/compare/revenu-net/nordis-es/` donne les factures et les jours comptables. La facture du 30 juin, clôturée le 1er juillet à 0 h 30 à Madrid, compte en juin pour le canonique (date comptable) et en juillet pour ES (date locale de clôture). ES obtient 75 % sur 8 cellules, avec un écart maximal de 2,93 %.

## Conséquences

- Une déclinaison from scratch se compare dès que sa source porte, sous un nom quelconque rattaché par `binding`, les colonnes que le canonique lit. Le pourcentage mesure alors la seule différence de définition (analyse Q11).
- Une table commune doit exister sur la plateforme de la déclinaison. Sinon, la requête du canonique échoue à l'exécution (`query_failed`), et la déclinaison est marquée `skipped`. Aucun refus n'a lieu à la préparation, faute de catalogue des tables par point d'accès.
- Les valeurs ne sont pas traduites. Un statut local (`cerrada`) ne vaut pas le statut du groupe : la source doit porter la colonne du groupe, sinon le canonique ne retient aucune ligne.
- Retirer une colonne non lue peut changer l'ordre de départage d'un `deduplicate`, qui trie aussi sur les colonnes non citées. L'effet est limité aux ex æquo.
- Le rebranchement propage les colonnes une fois par colonne manquante. Le coût est négligeable sur des graphes de quelques dizaines de nœuds.
- La piste « Nœud divergent » reste vide pour une déclinaison from scratch : ses écarts sont justifiés, et le catalogue la laisse `candidates:n` (ADR 0015).
