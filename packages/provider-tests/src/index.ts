/**
 * @agentdocstore/provider-tests — reusable provider conformance suite.
 *
 * Third-party storage backends import {@link runProviderConformance} and call
 * it from their own test file to prove SPI compliance.
 */
export { runProviderConformance } from './conformance.js';
