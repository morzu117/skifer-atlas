# ADR 0045 — Calendrier civil dans l'éditeur

Date : 9 novembre 2026

## Contexte et décision

Le calendrier civil est intégré au compilateur et ne possède pas de fichier (ADR 0010). L'éditeur le propose toujours après « À déclarer » et écrit `{key: civil}` sans version. Un calendrier chargé dont la clé est `civil` est écarté de la liste : le compilateur réserve déjà cette clé au calendrier intégré, même en présence d'un fichier ou d'une version. L'afficher comme calendrier versionné laisserait croire à un comportement distinct qui n'existe pas.

Les autres calendriers restent proposés avec leur version. Les références civiles existantes avec version restent reconnues comme civiles ; sélectionner à nouveau civil produit la forme sans version.
