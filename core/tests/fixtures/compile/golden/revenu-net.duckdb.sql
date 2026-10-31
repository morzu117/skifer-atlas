-- atlas: revenu-net v4, duckdb
WITH n01 AS (
  SELECT
    facture_id,
    commande_id,
    entite,
    statut,
    date_facture,
    montant_ttc,
    montant_taxes,
    avoirs
  FROM gold.finance.fact_facturation
), n02 AS (
  SELECT
    facture_id,
    commande_id,
    entite,
    statut,
    date_facture,
    montant_ttc,
    montant_taxes,
    avoirs
  FROM n01
  WHERE
    statut = 'validée'
), n03 AS (
  SELECT
    facture_id,
    commande_id,
    entite,
    statut,
    date_facture,
    montant_ttc,
    montant_taxes,
    avoirs,
    montant_ttc - montant_taxes - avoirs AS montant_ht
  FROM n02
), n06 AS (
  SELECT
    date_jour,
    date_comptable
  FROM gold.finance.dim_date
), n07 AS (
  SELECT
    l.facture_id,
    l.commande_id,
    l.entite,
    l.statut,
    l.date_facture,
    l.montant_ttc,
    l.montant_taxes,
    l.avoirs,
    l.montant_ht,
    r.date_jour,
    r.date_comptable
  FROM n03 AS l
  INNER JOIN n06 AS r
    ON l.date_facture = r.date_jour
), cal_fiscal_nordis AS (
  SELECT
    period_name,
    start_date,
    end_date
  FROM (VALUES
    ('FY2026_Q1', CAST('2025-10-01' AS DATE), CAST('2025-12-31' AS DATE)),
    ('FY2026_Q2', CAST('2026-01-01' AS DATE), CAST('2026-03-31' AS DATE)),
    ('FY2026_Q3', CAST('2026-04-01' AS DATE), CAST('2026-06-30' AS DATE)),
    ('FY2026_Q4', CAST('2026-07-01' AS DATE), CAST('2026-09-30' AS DATE))) AS c(period_name, start_date, end_date)
), n04 AS (
  SELECT
    i.facture_id,
    i.commande_id,
    i.entite,
    i.statut,
    i.date_facture,
    i.montant_ttc,
    i.montant_taxes,
    i.avoirs,
    i.montant_ht,
    i.date_jour,
    i.date_comptable,
    CAST(DATE_TRUNC('MONTH', i.date_comptable) AS DATE) AS mois_fiscal
  FROM n07 AS i
), n05 AS (
  SELECT
    mois_fiscal,
    entite,
    SUM(montant_ht) AS revenu_net
  FROM n04
  GROUP BY
    mois_fiscal,
    entite
), chk_n07_right AS (
  SELECT
    COUNT(*) AS problems
  FROM (
    SELECT
      date_jour
    FROM n06
    WHERE
      NOT date_jour IS NULL
    GROUP BY
      date_jour
    HAVING
      COUNT(*) > 1
  ) AS d
), chk_n04_calendar AS (
  SELECT
    COUNT(*) AS problems
  FROM n07 AS i
  WHERE
    NOT i.date_comptable IS NULL
    AND NOT EXISTS(
      SELECT
        1
      FROM cal_fiscal_nordis AS c
      WHERE
        i.date_comptable BETWEEN c.start_date AND c.end_date
    )
), atlas_guard AS (
  SELECT
    CASE
      WHEN chk_n07_right.problems > 0
      THEN ERROR(
        'atlas: cardinalité N:1 non respectée en n07, clés en double à droite : ' || CAST(chk_n07_right.problems AS TEXT)
      )
      WHEN chk_n04_calendar.problems > 0
      THEN ERROR(
        'atlas: dates hors du calendrier fiscal-nordis 2026.1 en n04 : ' || CAST(chk_n04_calendar.problems AS TEXT)
      )
    END AS failure
  FROM chk_n07_right
  CROSS JOIN chk_n04_calendar
)
SELECT
  mois_fiscal,
  entite,
  revenu_net
FROM n05
WHERE
  (
    SELECT
      failure
    FROM atlas_guard
  ) IS NULL
UNION ALL
SELECT
  NULL AS mois_fiscal,
  NULL AS entite,
  NULL AS revenu_net
FROM atlas_guard
WHERE
  NOT atlas_guard.failure IS NULL
