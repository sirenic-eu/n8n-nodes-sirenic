import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Sirenic is paid per call over x402 — there is no API key and no account.
 * What this credential holds is a wallet: a Base private key that signs a USDC
 * payment for each request.
 *
 * That is a heavier trust decision than an API key, so the spending caps below
 * are NOT optional. A node able to sign payments without a ceiling is a
 * liability; the same belt-and-braces policy guards Sirenic's own release
 * tooling.
 *
 * The key never leaves this n8n instance: payments are signed locally and only
 * the resulting signature travels to the API.
 */
export class SirenicApi implements ICredentialType {
	name = 'sirenicApi';

	displayName = 'Sirenic API';

	documentationUrl = 'https://api.sirenic.eu/llms.txt';

	icon = { light: 'file:../nodes/Sirenic/sirenic.light.svg', dark: 'file:../nodes/Sirenic/sirenic.dark.svg' } as const;

	/**
	 * Reaches a FREE endpoint to confirm the base URL is live.
	 *
	 * It deliberately does not spend anything, so it proves connectivity — not
	 * that the wallet holds USDC. There is no way to check a balance without
	 * either a paid call or an RPC dependency, and neither belongs in a
	 * credential test.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/reperer',
			qs: { texte: 'sirenic credential test' },
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Wallet Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '0x…',
			description:
				'Private key of a Base (mainnet) wallet holding USDC. Used only to sign payments locally — never sent to Sirenic or to any third party. Use a dedicated wallet funded with a small amount, never your main one.',
		},
		{
			displayName: 'Max Amount Per Call (USD)',
			name: 'maxAmountPerCall',
			type: 'number',
			default: 0.2,
			required: true,
			typeOptions: { minValue: 0.000001, numberPrecision: 6 },
			description:
				'Hard ceiling for a single request. The node refuses to sign a quote above this amount, whatever the API asks for. Sirenic prices range from $0.001 to $2.00 per call.',
		},
		{
			displayName: 'Max Amount Per Execution (USD)',
			name: 'maxAmountPerExecution',
			type: 'number',
			default: 5,
			required: true,
			typeOptions: { minValue: 0.000001, numberPrecision: 6 },
			description:
				'Hard ceiling for one workflow execution, across all items. Protects you from a loop over thousands of rows spending far more than intended.',
		},
		{
			displayName: 'API Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.sirenic.eu',
			description: 'Change only if you were given a different endpoint.',
		},
		{
			displayName: 'Expected Payment Address',
			name: 'payTo',
			type: 'string',
			default: '0x76A672EEe56D29D475b0715cc03B8C99D70EC8A2',
			description:
				"Sirenic's receiving address on Base. The node refuses to sign a payment to any other address, so a spoofed or compromised endpoint cannot redirect your funds.",
		},
	];
}
