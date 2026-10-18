# ADR 0004 — Trois documents distincts et immuabilité du document envoyé

- Statut : accepté (mis en œuvre en T7-T9)
- Date : 18/10/2026

## Décision

- **Profil maître** : versions validées immuables ; la courante est la plus récente. Seul l'utilisateur le modifie, jamais l'éditeur de CV.
- **CV personnalisé** : versions numérotées par offre, basées sur une version de profil précise ; enregistrée ou finalisée = immuable (ADR 0008).
- **CV envoyé** : copie du fichier exact (export PDF reproductible de la version finalisée, ou fichier joint par l'utilisateur, PDF ou DOCX reconnu par signature), empreinte SHA-256, rattachée à la candidature ; un trigger SQL interdit sa modification et sa suppression ; l'empreinte est revérifiée à chaque téléchargement.
- Une candidature ne passe à « envoyée » que par une confirmation explicite de l'utilisateur, sauf future intégration d'envoi officiellement autorisée.

## Conséquences

Pour toute candidature, on peut répondre : quel fichier exact a été envoyé, quand, par quel canal, à partir de quelle version de profil et avec quel score.
