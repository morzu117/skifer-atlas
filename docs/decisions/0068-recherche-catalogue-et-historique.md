# 0068 — Recherche du catalogue et historique

## Contexte

La recherche est publiée dans l'adresse après une pause de frappe. React peut traiter cette publication après une nouvelle frappe : recopier systématiquement l'adresse dans le champ efface alors cette frappe.

## Décision

La publication temporisée de la recherche ne remplace pas le texte plus récent déjà saisi. Un changement de recherche venant de l'historique reste prioritaire et met à jour le champ. Le chargement et les relectures du catalogue conservent la saisie.

## Conséquences

L'adresse et les résultats suivent la dernière saisie après la temporisation habituelle, sans ajouter d'entrée d'historique. Le retour arrière restaure la recherche associée à l'entrée visitée.
