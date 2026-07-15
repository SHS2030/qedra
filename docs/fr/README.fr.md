# QEDRA — résumé français

> Le code autonome doit faire ses preuves.

QEDRA est une couche de preuve open core pour l’ingénierie logicielle autonome. Elle transforme une loi métier non négociable en invariant exécutable, attaque réellement le code, conserve un contre-exemple reproductible, encadre une réparation dans un worktree Git isolé, rejoue exactement la même attaque et produit un passeport de preuves vérifiable par une personne.

Le cycle est :

> Qualifier → Exécuter → Détecter → Réparer → Attester

## Tranche verticale Genesis

La version 0.1 protège `TRANSFER_IDEMPOTENCY` : une même demande de transfert ne doit jamais débiter deux fois un portefeuille, même après un délai réseau, une nouvelle tentative, un callback dupliqué ou deux demandes concurrentes.

Le scénario déterministe utilise `TX-001` pour transférer 1 000 FCFA de A vers B :

| État                    |     A |     B | Débits | Crédits | Résultat |
| ----------------------- | ----: | ----: | -----: | ------: | -------- |
| Attendu                 | 9 000 | 6 000 |      1 |       1 | PASS     |
| Fixture vulnérable      | 8 000 | 7 000 |      2 |       2 | FAIL     |
| Implémentation corrigée | 9 000 | 6 000 |      1 |       1 | PASS     |

L’implémentation corrigée emploie SQLite, une contrainte unique sur `request_id`, une transaction atomique et le stockage de la première réponse. Toute répétition reçoit cette réponse sans nouvelle mutation.

## Démonstration sans identifiants

Avec les versions épinglées dans `docs/environment.md` :

```powershell
pnpm install --frozen-lockfile
pnpm demo
pnpm evidence:verify
```

Le mode par défaut est un record/replay déterministe. Il applique un patch enregistré et haché dans un worktree détaché, exécute le test de non-régression, rejoue l’attaque exacte, capture le diff, puis supprime le worktree. Il ne committe et ne fusionne rien.

La commande ciblée suivante confirme volontairement la violation avec le code de sortie `10` :

```powershell
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
```

## Preuves produites

La démonstration génère notamment :

- `evidence/counterexample.json` ;
- `evidence/repair-request.json` ;
- `evidence/recorded-change-set.json` ;
- `evidence/repair-report.json` ;
- `evidence/repair.diff` ;
- `evidence/repair-evidence.json` ;
- `evidence/replay-result.json` ;
- `evidence/verification-result.json` ;
- `evidence/live-repair-blocker.json` ;
- `evidence/passport.json` ;
- `evidence/passport.html` ;
- le tableau de bord statique généré sous `evidence/dashboard/`.

Les schémas sont stricts, les objets et fichiers sont liés par SHA-256, les métriques inconnues restent `null`, et `humanApprovalRequired: true` est obligatoire. Le passeport constitue une aide à la décision, jamais une autorisation de merge.

## Intégration Codex

Le chemin live utilise le SDK officiel `@openai/codex-sdk`. Il impose un worktree isolé, une liste de fichiers autorisés, trois tentatives au maximum, 120 secondes par tentative, un arrêt après deux constats sans progrès, l’annulation, une validation déterministe, le rejet d’un commit candidat et l’absence de merge automatique.

Aucune clé `OPENAI_API_KEY` n’a été fournie pour la mission Genesis. Aucun appel live, résultat Codex, modèle, volume de tokens ou coût n’est donc revendiqué. QEDRA détecte uniquement la présence et la source de la clé sans jamais afficher sa valeur. L’absence d’authentification bloque seulement `repair --live` ; toutes les phases déterministes continuent.

Activation ultérieure, sous responsabilité humaine :

```powershell
$env:OPENAI_API_KEY = "<your key>"
pnpm --silent qedra doctor --json
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
pnpm --silent qedra repair TRANSFER_IDEMPOTENCY --live --json
```

La création de clé, la facturation, les droits d’accès et l’approbation finale restent des décisions humaines.

## Validation

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:adversarial
pnpm test:e2e
pnpm build
pnpm demo
pnpm evidence:verify
```

La CI par défaut n’utilise aucun secret OpenAI. Un job live existe uniquement sur déclenchement manuel explicite, protégé par secret et désactivé par défaut.

## Limites

- La version 0.1 protège un invariant et un scénario canonique.
- Le chemin Codex live reste non exécuté tant qu’une authentification n’est pas fournie.
- SHA-256 détecte une altération, mais ne constitue pas une signature numérique.
- Le tableau de bord et l’application Flutter sont des surfaces de démonstration, pas des contrôles de production.
- Une revue humaine demeure obligatoire avant toute intégration d’une réparation.

Pour les détails techniques, consulter le [README principal](../../README.md), l’[architecture](../architecture.md), le [script de démonstration](../demo-script.md), les [instructions de test](../testing-instructions.md), la [collaboration Codex](../codex-collaboration.md) et le [modèle de menace](../threat-model.md).
