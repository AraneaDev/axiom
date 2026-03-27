import { decision } from './decision';
import { meetingNotes } from './meeting-notes';
import { productRequirements } from './product-requirements';
import { retrospective } from './retrospective';
import { runbook } from './runbook';

export interface BlueprintDefinition {
  name: string;
  description: string;
  body: string;
}

export const builtInBlueprints: BlueprintDefinition[] = [
  meetingNotes,
  retrospective,
  decision,
  productRequirements,
  runbook,
];
