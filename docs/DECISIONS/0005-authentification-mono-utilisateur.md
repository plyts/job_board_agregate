# ADR 0005 — Authentification : sessions en base, sans inscription publique

- Statut : accepté
- Date : 18/10/2026

## Contexte

MVP mono-utilisateur. L'ARCHITECTURE prévoyait une bibliothèque d'authentification (Auth.js ou Better Auth). Besoin réel : un compte, un mot de passe, des sessions révocables, une protection contre le bourrage d'identifiants.

## Options

1. Auth.js / Better Auth : fonctionnalités (OAuth, MFA, inscription) inutiles ici, surface d'attaque et dépendances plus larges, compatibilité Next 16 à vérifier à chaque montée de version.
2. **Sessions en base, selon le modèle décrit par la documentation Next.js 16 (« Database Sessions ») et les recommandations OWASP** : quelques fonctions testées, aucune dépendance native.

## Décision

Option 2 :
- Jeton de 32 octets aléatoires dans un cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ; seule son empreinte SHA-256 est stockée (`sessions.id`).
- Mots de passe hachés avec scrypt (N = 2^16, r = 8, p = 1, sel de 16 octets), comparaison à temps constant.
- Verrouillage après 5 échecs en 15 minutes par e-mail ; message identique pour e-mail inconnu et mauvais mot de passe.
- Session de 30 jours prolongée à l'usage ; déconnexion = suppression en base.
- Pas d'inscription : le compte est créé par `npm run user:create`.
- `proxy.ts` ne fait qu'un contrôle optimiste (présence du cookie) ; la vérification en base est faite par `requireUser()` dans chaque page, action et route.

## Conséquences

- Passage au multi-utilisateur : ajouter inscription, vérification d'e-mail et réinitialisation du mot de passe, ou migrer vers une bibliothèque à ce moment-là. Le schéma `users`/`sessions` reste compatible.
- MFA (TOTP ou passkey) à ajouter avant toute exposition publique large.
