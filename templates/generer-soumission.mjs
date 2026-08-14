/**
 * Regenerates SUBMISSION.md — the titles and descriptions to paste into the n8n
 * template submission form.
 *
 * The description is READ from each workflow's main sticky note, never retyped:
 * n8n requires the sticky to carry the entire description, so the only way the
 * two cannot drift is to have a single source. Run it again after editing any
 * sticky:  node templates/generer-soumission.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BRUT = 'https://raw.githubusercontent.com/sirenic-eu/n8n-nodes-sirenic/main/templates';

const TEMPLATES = [
	{
		id: 'T01',
		fichier: 'T01-verify-french-suppliers.json',
		alt: 'Verify French suppliers before paying invoices - n8n workflow',
		intro:
			'Every new supplier row in your sheet is checked against the official French registries before you pay it: legal identity, VAT live against VIES, IBAN with bank identification, and a deterministic ready-to-invoice verdict. Wire-transfer fraud and deregistered companies are caught before the payment run, not after it.',
	},
	{
		id: 'T02',
		fichier: 'T02-enrich-hubspot-companies.json',
		alt: 'Enrich new HubSpot companies with official French registry data - n8n workflow',
		intro:
			'New HubSpot companies are filled in from the official French registry - SIREN, legal form, NAF activity code, workforce, administrative status - and the SIREN becomes a dedup key your CRM can trust. Homonyms go to a ten-second human review instead of a confident wrong guess.',
	},
	{
		id: 'T03',
		fichier: 'T03-kyb-client-onboarding.json',
		alt: 'Automate French company KYB checks for client onboarding - n8n workflow',
		intro:
			'Your onboarding form posts a SIREN and gets a full KYB file back in one call: legal identity, officers, insolvency proceedings, financials and sanctions screening, signed so it can be kept as audit evidence. The applicant is then auto-approved, queued for human review, or hard-stopped.',
	},
	{
		id: 'T07',
		fichier: 'T07-score-customer-credit-risk.json',
		alt: 'Score French customer credit risk weekly - n8n workflow',
		intro:
			'Every Monday your customer book is scored for default risk against official French financials, and Slack receives a digest of the customers whose risk class actually changed. A stable portfolio produces no noise at all.',
	},
	{
		id: 'T08',
		fichier: 'T08-einvoicing-readiness-2026.json',
		alt: 'Check French e-invoicing readiness for all your customers - n8n workflow',
		intro:
			'From 1 September 2026 every French company must be able to receive electronic invoices. This audit walks your customer list and tells you, customer by customer, the invoicing identity, the computed intra-EU VAT number and the indicative obligation dates - so you know who to chase.',
	},
	{
		id: 'T10',
		fichier: 'T10-chat-french-registry-mcp.json',
		// No image: T10 uses core nodes only, so n8n.io renders its canvas preview by itself
		// (the image exists for the 5 others because n8n.io serves no icon for a community node).
		// No intro either: T10 carries it inside its sticky, the only text n8n publishes unrewritten.
		image: false,
	},
];

/** The main sticky IS the description: n8n requires the two to say the same thing. */
function description(fichier) {
	const w = JSON.parse(readFileSync(new URL(fichier, import.meta.url), 'utf8'));
	const sticky = w.nodes.filter((n) => n.type.includes('stickyNote'))[0].parameters.content;
	const lignes = sticky.split('\n');
	// The heading exists for the canvas; the submission form has its own title field.
	const sansTitre = lignes[0].startsWith('## ') ? lignes.slice(1) : lignes;
	return { titre: lignes[0].replace(/^##\s*/, ''), corps: sansTitre.join('\n').trim(), nom: w.name };
}

const mots = (s) => s.split(/\s+/).filter(Boolean).length;

let out = `# Kit de soumission des templates au portail n8n

**Généré le 2026-08-06** depuis les workflows eux-mêmes : la description à coller EST le
contenu du sticky jaune de chaque template, comme n8n l'exige (« include the entire
description in it »). Si tu modifies un sticky, régénère ce fichier plutôt que de recopier
à la main — c'est la seule façon d'éviter que les deux divergent.

Règles appliquées, tirées des deux pages officielles :
[Template submission guidelines](https://n8n.notion.site/Template-submission-guidelines-9959894476734da3b402c90b124b1f77)
et [description template](https://n8n.notion.site/n8n-workflow-template-description-template-b4c008b47eb74846b48c37c652ec2650).

| Règle n8n | État |
|---|---|
| Titre « verbe d'action + objet + où », capitalisation de phrase, sans emoji | ✅ les 6 |
| Description en Markdown, sans balise HTML | ✅ les 6 |
| Sections Who's it for / How it works / How to set up / Requirements / How to customize | ✅ les 6 |
| Phrase d'accroche 1-2 lignes en tête (qui / quoi / pourquoi) | ✅ ajoutée ici |
| Un sticky jaune portant TOUTE la description | ✅ les 6 |
| Stickies neutres pour les étapes | ✅ les 6 (couleur 7) |
| Community node → disclaimer « self-hosted only » | ✅ les 5 concernés (T10 n'en a pas besoin) |
| Community node → image du workflow EN TÊTE de la description (l'aperçu ne s'affiche pas) | ✅ ajoutée ici |
| Pas de clé API en dur, pas d'identifiant personnel (Sheet ID, canal Slack, e-mail) | ✅ vérifié : aucun identifiant dans les 6 JSON |
| Nœuds renommés pour dire ce qu'ils font | ✅ les 6 |

**Un écart assumé :** n8n vise « ~200 mots » ; nos descriptions font 256 à 331 mots
(T08 est la plus longue). La densité vient de ce qu'on refuse d'enlever : le prix de chaque
appel, le disclaimer « Sirenic n'est pas une plateforme agréée (PDP) », le rappel que les
correspondances de sanctions ne sont jamais une décision automatique, et les dates du mandat.
Si un relecteur le demande, c'est T08 qu'il faut raccourcir en premier — et il faudra alors
refaire sa capture de canvas, puisque le sticky et la description doivent rester identiques.

Deux points **facultatifs** non appliqués, à décider :
- n8n conseille un nœud **Set Fields** regroupant les variables à configurer. Aucun des 6 n'en a
  (la config vit dans les nœuds Google Sheets / HubSpot). L'ajouter obligerait à refaire les
  captures de canvas.
- n8n encourage une **vidéo Loom** de mise en route. Il existe déjà une démo du node
  (\`/home/ubuntu/n8n-local/demo-sirenic-node.mp4\`), pas des templates.

## Comment soumettre

1. Portail créateur → **Templates** → soumettre, un template à la fois.
2. Coller le **titre** puis la **description** ci-dessous, et le **JSON du workflow**
   (\`templates/<fichier>.json\`).
3. Ne pas retoucher le texte après collage : il est identique au sticky du workflow.

Pour régénérer ce fichier après avoir modifié un sticky : \`node templates/generer-soumission.mjs\`
depuis la racine du dépôt.

`;

for (const t of TEMPLATES) {
	const d = description(t.fichier);
	const corps = [
		t.image === false ? null : `![${t.alt}](${BRUT}/${t.id}-canvas.png)`,
		t.intro ?? null,
		d.corps,
	]
		.filter(Boolean)
		.join('\n\n');
	out += `---

## ${t.id} — \`${t.fichier}\`

**Titre à coller**

${d.nom}

**Description à coller** (${mots(corps)} mots${t.image === false ? '' : ', image comprise'})

~~~markdown
${corps}
~~~

`;
}

writeFileSync(new URL('SUBMISSION.md', import.meta.url), out);
console.log('SUBMISSION.md écrit');
