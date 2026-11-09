/**
 * Rules a custom field value must meet, shared by every path that writes one (REST, MCP
 * through the service, automation `custom:<name>`). A USER field may only name someone who
 * can read the project: a team member, an org OWNER/ADMIN or a platform admin, and never a bot.
 */
import { AppError } from '../../middleware/errorHandler';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { assertPersonTarget } from '../service-accounts/person';

/**
 * @param definition - The field's type and project
 * @param definition.type
 * @param definition.projectId
 * @param value - The value to store
 * @throws {AppError} 400 when the value doesn't fit the field
 */
export async function assertCustomFieldValue(
  definition: { type: string; projectId: string },
  value: string,
): Promise<void> {
  if (definition.type !== 'USER' || value === '') return;
  // Access first: an unknown id, like anyone who can't read the project, gets the same message
  if ((await checkProjectAccess(value, definition.projectId)) !== 'ok') {
    throw new AppError(400, 'A user field can only name someone who can read this project');
  }
  // A USER field is an assignment in all but name: only people
  await assertPersonTarget(
    value,
    'SERVICE_ACCOUNT_NOT_ASSIGNABLE',
    'A user field can only name a person',
  );
}
