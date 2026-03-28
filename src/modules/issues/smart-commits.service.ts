export interface SmartCommitDirective {
  type: 'time' | 'comment' | 'transition' | 'assign' | 'label';
  value: string;
}

export interface SmartCommitResult {
  issueKey: string;
  directives: SmartCommitDirective[];
}

const ISSUE_KEY_PATTERN = /[A-Z]+-\d+/g;
const DIRECTIVE_PATTERN = /#(time|comment|resolve|close|reopen|assign|label)\s*/i;

/**
 *
 * @param message
 */
export function parseSmartCommit(message: string): SmartCommitResult[] {
  const issueKeys = [...new Set(message.match(ISSUE_KEY_PATTERN) || [])];
  if (issueKeys.length === 0) return [];

  const directives = parseDirectives(message);

  return issueKeys.map((issueKey) => ({
    issueKey,
    directives: [...directives],
  }));
}

function parseDirectives(message: string): SmartCommitDirective[] {
  const directives: SmartCommitDirective[] = [];
  const parts = message.split(DIRECTIVE_PATTERN);

  // parts alternates: [prefix, directive_name, value_text, directive_name, value_text, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i].toLowerCase();
    const rawValue = (parts[i + 1] || '').trim();

    if (name === 'time') {
      directives.push({ type: 'time', value: rawValue.split(/\s/)[0] });
    } else if (name === 'comment') {
      directives.push({ type: 'comment', value: rawValue });
    } else if (name === 'resolve' || name === 'close' || name === 'reopen') {
      directives.push({ type: 'transition', value: name });
    } else if (name === 'assign') {
      directives.push({ type: 'assign', value: rawValue.split(/\s/)[0] });
    } else if (name === 'label') {
      directives.push({ type: 'label', value: rawValue.split(/\s/)[0] });
    }
  }

  return directives;
}

/**
 *
 * @param duration
 */
export function parseTimeDuration(duration: string): number {
  const hoursMatch = duration.match(/(\d+)h/);
  const minutesMatch = duration.match(/(\d+)m/);
  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  return hours * 60 + minutes;
}
