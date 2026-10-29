/**
 * Server entry for the editor core bundle (`dist-editor-core/editor-core.cjs`).
 * Installs the DOM globals the editor needs, then exposes the converter.
 */

import './dom-globals';

export * from './converter';
