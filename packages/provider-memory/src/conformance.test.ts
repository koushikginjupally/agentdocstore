/**
 * Runs the shared provider conformance suite against the in-memory provider.
 *
 * The suite in `@agentdocstore/provider-tests` is the executable definition of the
 * SPI contract; passing it is what makes this provider substitutable for any
 * other. It is deliberately authored independently of this implementation, so it
 * is stronger evidence than the provider's own unit tests.
 */
import { runProviderConformance } from '@agentdocstore/provider-tests';
import { createMemoryProvider } from './index.js';

runProviderConformance('provider-memory', () => createMemoryProvider());
