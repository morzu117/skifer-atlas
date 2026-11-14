# 0060 — Mesure de Cmd-Q au test de fumée

## Contexte

Le test de fumée de l'app (`scripts/smoke-app.sh`) quitte l'app de deux façons et exigeait
une sortie en moins de 4 s : un Apple Event « quit » et la frappe de Cmd-Q. Sur le runner
macOS x64 de la CI, Cmd-Q dépassait régulièrement le seuil (3,6 à 4 s), alors que l'Apple
Event prenait 0,1 s. L'horodatage des étapes du journal a situé l'écart : « quitter
intercepté » apparaît 3,8 s après la frappe, puis l'app se ferme dans la même fraction de
seconde. Sur arm64, l'interception arrive après 0,45 s.

Les deux chemins aboutissent au même `applicationShouldTerminate:`. Le délai se trouve donc
avant notre code, entre macOS et l'app : le raccourci passe d'abord par la vue web, puis
revient au menu natif. Ce trajet est lent sur la machine virtuelle Intel, juste après le
démarrage.

## Décision

Pour l'Apple Event, le seuil reste de 4 s, exécution d'AppleScript comprise. Pour Cmd-Q,
les 4 s courent à partir de l'interception (`[atlas] quitter intercepté`) : c'est la part
de l'app. La remise du raccourci par macOS est bornée séparément à 15 s, pour qu'un
raccourci perdu ou bloqué échoue toujours. Le test affiche l'instant de chaque étape, en
cas de succès comme d'échec.

## Conséquences

Le seuil de 4 s mesure de nouveau ce qu'il prétend mesurer, la fermeture par l'app, et non
la vitesse de la machine de CI. Une lenteur du raccourci sur un vrai Mac Intel resterait
visible dans les étapes affichées, mais ne ferait échouer le test qu'au-delà de 15 s.
