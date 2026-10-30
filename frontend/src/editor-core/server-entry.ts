/**
 * Server entry for the editor core bundle (`dist-editor-core/editor-core.cjs`).
 * Gives the converter a happy-dom DOM for the duration of each conversion, then
 * exposes the converter and the merge.
 */

import { setDomScope } from './converter';
import { withHappyDom } from './dom-globals';

setDomScope(withHappyDom);

export * from './converter';
export * from './merge';
