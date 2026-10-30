-- atlas: ventes-contre-objectif v1, databricks
-- atlas: cardinality bypass n15
WITH n01 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le
  FROM ventes.commandes
), n02 AS (
  SELECT
    id,
    client,
    montant_web,
    horodatage
  FROM ventes.commandes_web
), n03 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le
  FROM n01
  UNION ALL
  SELECT
    id AS commande_id,
    client AS client_id,
    CAST(NULL AS STRING) AS statut,
    montant_web AS montant,
    horodatage AS passee_le
  FROM n02
), n04 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le
  FROM n03
  WHERE
    (
      NOT statut IN ('annulée', 'test')
    ) OR statut IS NULL
), n05 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le
  FROM n04
  QUALIFY
    ROW_NUMBER() OVER (
      PARTITION BY commande_id
      ORDER BY passee_le DESC NULLS FIRST, client_id ASC NULLS LAST, statut ASC NULLS LAST, montant ASC NULLS LAST
    ) = 1
), n06 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le,
    CONVERT_TIMEZONE('UTC', 'Europe/Paris', passee_le) AS passee_le_paris
  FROM n05
), n07 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le,
    passee_le_paris,
    CAST(CONVERT_TIMEZONE('UTC', 'Europe/Paris', passee_le) AS DATE) AS jour
  FROM n06
), n08 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le,
    passee_le_paris,
    jour,
    montant / 1.2 AS montant_ht
  FROM n07
), n09 AS (
  SELECT
    id_client,
    segment
  FROM ventes.clients
), n10 AS (
  SELECT
    l.commande_id,
    l.client_id,
    l.statut,
    l.montant,
    l.passee_le,
    l.passee_le_paris,
    l.jour,
    l.montant_ht,
    r.id_client,
    r.segment
  FROM n08 AS l
  LEFT JOIN n09 AS r
    ON l.client_id = r.id_client
), n11 AS (
  SELECT
    commande_id,
    client_id,
    statut,
    montant,
    passee_le,
    passee_le_paris,
    jour,
    montant_ht,
    id_client,
    segment,
    SUM(montant_ht) OVER (
      PARTITION BY client_id
      ORDER BY jour ASC NULLS LAST, commande_id ASC NULLS LAST
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumul_client
  FROM n10
), n12 AS (
  SELECT
    i.commande_id,
    i.client_id,
    i.statut,
    i.montant,
    i.passee_le,
    i.passee_le_paris,
    i.jour,
    i.montant_ht,
    i.id_client,
    i.segment,
    i.cumul_client,
    CAST(DATE_TRUNC('MONTH', i.jour) AS DATE) AS mois
  FROM n11 AS i
), n13 AS (
  SELECT
    mois,
    segment,
    ca,
    clients
  FROM (
    SELECT
      mois,
      segment,
      SUM(montant_ht) AS ca,
      COUNT(DISTINCT client_id) AS clients
    FROM n12
    GROUP BY
      mois,
      segment
  ) AS a
  WHERE
    ca > 0
), r_objectifs_mensuels_v2_n01 AS (
  SELECT
    mois,
    segment,
    objectif
  FROM ventes.objectifs
), r_objectifs_mensuels_v2_n02 AS (
  SELECT
    mois,
    segment,
    SUM(objectif) AS objectif
  FROM r_objectifs_mensuels_v2_n01
  GROUP BY
    mois,
    segment
), n14 AS (
  SELECT
    mois,
    segment,
    objectif
  FROM r_objectifs_mensuels_v2_n02
), n15 AS (
  SELECT
    l.mois,
    l.segment,
    l.ca,
    l.clients,
    r.objectif
  FROM n13 AS l
  LEFT JOIN n14 AS r
    ON l.mois = r.mois AND l.segment = r.segment
), n16 AS (
  SELECT
    mois,
    segment,
    ca,
    clients,
    objectif,
    ca - objectif AS ecart,
    ca / objectif AS taux_atteinte
  FROM n15
), chk_n10_right AS (
  SELECT
    COUNT(*) AS problems
  FROM (
    SELECT
      id_client
    FROM n09
    WHERE
      NOT id_client IS NULL
    GROUP BY
      id_client
    HAVING
      COUNT(*) > 1
  ) AS d
), atlas_guard AS (
  SELECT
    CASE
      WHEN chk_n10_right.problems > 0
      THEN RAISE_ERROR(
        'atlas: cardinalité N:1 non respectée en n10, clés en double à droite : ' || CAST(chk_n10_right.problems AS STRING)
      )
    END AS failure
  FROM chk_n10_right
)
SELECT
  mois,
  segment,
  ca,
  clients,
  objectif,
  ecart,
  taux_atteinte
FROM n16
WHERE
  (
    SELECT
      failure
    FROM atlas_guard
  ) IS NULL
