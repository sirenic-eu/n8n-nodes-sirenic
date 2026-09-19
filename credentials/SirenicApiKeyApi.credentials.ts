import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * The other rail: an API key and prepaid credits, instead of a wallet.
 *
 * Same routes, same prices, same responses — only the way you pay changes.
 * Create a key at https://api.sirenic.eu/compte (e-mail and a magic link, no
 * card), top it up in euros, and send it as `X-Api-Key`. Nothing is signed,
 * nothing touches a blockchain, and no private key ever reaches this instance.
 *
 * Why it exists (0.13.0): the wallet credential asks a finance or CRM team to
 * hold a Base private key funded with USDC before it can look up a SIREN. That
 * is a heavy first step for a workflow whose whole point is to check a supplier,
 * and it is the reason the twelve ready-made workflows on api.sirenic.eu/workflows
 * use a plain HTTP Request node with this header instead of the community node.
 *
 * 150 calls a month are free on routes priced $0.05 or less with a verified
 * account, so most enrichment workflows cost nothing until they scale.
 */
export class SirenicApiKeyApi implements ICredentialType {
	name = 'sirenicApiKeyApi';

	displayName = 'Sirenic API Key API';

	documentationUrl = 'https://api.sirenic.eu/auth.md';

	icon = { light: 'file:../nodes/Sirenic/sirenic.light.svg', dark: 'file:../nodes/Sirenic/sirenic.dark.svg' } as const;

	/**
	 * Sends the key on every request made through n8n's HTTP helpers, and on the
	 * credential test below. The node's own calls set the same header by hand,
	 * because they read `x-credits-charged` off the response to enforce the
	 * spending ceiling.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: { 'X-Api-Key': '={{$credentials.apiKey}}' },
		},
	};

	/**
	 * `GET /compte/solde` is the ONLY honest connection test on this rail.
	 *
	 * It is free, and it REQUIRES the key: a paid route would have validated the
	 * key by charging for it, and a free route like `/v1/reperer` never reads it
	 * at all — it would answer 200 for a key that does not exist. This one
	 * answers 401 for a wrong key and returns the balance for a good one.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/compte/solde',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'srn_live_…',
			description:
				'Key created at https://api.sirenic.eu/compte. It is sent as the X-Api-Key header and charged against your prepaid credits (1 credit = 1 euro). Revoke it from the same page at any time.',
		},
		{
			/**
			 * A ceiling still matters on this rail. It cannot refuse a quote — there
			 * is none — so it counts what the API says it charged (`x-credits-charged`,
			 * one header per response) and stops before the call that would cross the
			 * line. That is what stands between a loop over 10 000 rows and an empty
			 * balance.
			 */
			displayName: 'Max Spend Per Execution (USD)',
			name: 'maxSpendPerExecution',
			type: 'number',
			default: 5,
			required: true,
			typeOptions: { minValue: 0, numberPrecision: 3 },
			description:
				'Ceiling across every item of one execution, counted from what the API reports it charged. Set it to 0 to allow an uncapped execution — only do that when something else bounds the number of items.',
		},
		{
			displayName: 'API Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.sirenic.eu',
			description: 'Change it only to reach a staging instance.',
		},
	];
}
