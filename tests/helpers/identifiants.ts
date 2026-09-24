/**
 * `getCredentials` for the test contexts, answered the way n8n answers it.
 *
 * The stub this replaces returned the wallet for ANY credential name. That is
 * how 0.13.0 and 0.14.0 shipped a trigger that read the wallet credential on
 * the API-key rail: the tests could not tell which credential was asked for.
 * n8n can. Its execution context (n8n-core, `_getCredentials`) refuses, in this
 * order, a credential type the node does not declare, one the node declares
 * but does not DISPLAY for the current parameters ("Credentials not found"),
 * and one that is displayed but was never configured on the node.
 *
 * The display rule is n8n's own `NodeHelpers.displayParameter`, not a copy of
 * it, so the tests read the `displayOptions` of the node description exactly
 * as the product does.
 */
import {
	NodeHelpers,
	type ICredentialDataDecryptedObject,
	type INodeParameters,
	type INodeTypeDescription,
} from 'n8n-workflow';

/** Credential data by credential name: what the user configured on the node. */
export type Identifiants = Record<string, ICredentialDataDecryptedObject>;

export function lecteurIdentifiants(
	description: INodeTypeDescription,
	params: INodeParameters,
	configures: Identifiants,
): (type: string) => Promise<ICredentialDataDecryptedObject> {
	return async (type: string) => {
		const declare = description.credentials?.find((c) => c.name === type);
		if (!declare) {
			throw new Error(
				`Node type "${description.name}" does not have any credentials of type "${type}" defined`,
			);
		}
		if (!NodeHelpers.displayParameter(params, declare, { typeVersion: 1 }, description, params)) {
			throw new Error('Credentials not found');
		}
		const donnees = configures[type];
		if (!donnees) throw new Error(`Node does not have any credentials set for "${type}"`);
		return donnees;
	};
}
