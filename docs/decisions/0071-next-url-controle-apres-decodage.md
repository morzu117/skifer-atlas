# ADR 0071 — Garde des caractères de contrôle de next_url après décodage

Date : 2026-11-26 · Statut : **acceptée**

## Contexte

Relevé pendant les tests de mutation du connecteur REST (ADR 0070, #208) et suivi en #220.

Dans `RestRunner._fetch` (`core/src/skifer_atlas/compare/rest_runner.py`), la garde contre les
caractères de contrôle de l'adresse de pagination —
`re.search(r"[\x00-\x20\x7f]", next_url)` — s'applique au `next_url` **brut**, avant le
`unquote` du chemin. La condition de rejet qui suit (origine, préfixe de base, `..`, `\`) ne
revérifiait pas les caractères de contrôle sur le chemin **décodé**. Un caractère de contrôle
**percent-encodé** (`%00`, `%20`) échappait donc à la garde, alors que la même séquence en clair
est refusée — incohérence : en clair refusé, encodé accepté.

Portée limitée (l'URL réellement appelée garde la forme encodée, et seuls `scheme`/`netloc` et
le préfixe de base sont validés), mais la garde doit être cohérente.

## Décision

Ajouter une seule clause à la condition de rejet, sur le chemin **décodé**, avec la même classe
de caractères que la garde brute :

```python
or re.search(r"[\x00-\x20\x7f]", path)
```

La vérification reste limitée au **chemin** : un `%20` encodé est légitime dans une query
(espaces de paramètres), et la query n'entre pas dans la validation d'origine. La garde brute de
la ligne 271 est conservée (elle protège l'`urljoin` en amont).

## Résultat

`tests/compare/test_rest_runner.py` ajoute un test paramétré
(`test_next_url_encoded_path_control_refused_without_secret`, `%00` et `%20` dans le chemin) qui
asserte le refus `rest_next_url_refused`, l'unique appel, le comptage d'usage
(`calls == 1`, `errors == 1`) et l'absence de la clé d'API dans le message et la trace. Sans le
correctif, le test échoue (le `next_url` encodé est suivi et aboutit à `rest_bad_response`) ;
avec, il passe.

## Conséquences

Clair et encodé sont désormais traités de la même façon pour les caractères de contrôle du
chemin de pagination. Aucune incidence sur les `next_url` légitimes, qui ne contiennent pas de
caractère de contrôle dans leur chemin.
