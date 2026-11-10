# ADR 0047 — Compilation d'un concept sans graphe

Date : 9 novembre 2026

## Contexte et décision

Un concept peut ne pas avoir de graphe. Dans la validation de l'éditeur, chaque dialecte reçoit alors le statut `not_applicable` : aucune compilation SQL n'est attendue. L'interface le présente sans alerte, y compris dans l'onglet SQL.

Les erreurs du document restent indépendantes de ce statut et continuent à empêcher la soumission. Un KPI, une déclinaison ou un concept avec un graphe incomplet reste soumis aux contrôles habituels. La fiche et les propositions ne consomment pas ce statut de l'éditeur.
