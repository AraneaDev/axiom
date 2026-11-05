export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~';

export type Value =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'function'; name: string; args: Value[] }
  | { type: 'null' };

export type Expression =
  | { type: 'comparison'; field: string; operator: ComparisonOp; value: Value }
  | { type: 'in'; field: string; values: Value[]; negated: boolean }
  | { type: 'and'; left: Expression; right: Expression }
  | { type: 'or'; left: Expression; right: Expression }
  | { type: 'not'; operand: Expression }
  | { type: 'freetext'; value: string };

export interface QueryParseError {
  message: string;
  position: number;
  token?: string;
}

export interface FieldDefinition {
  column: string;
  /** `derived`: no single column answers it, see derived-fields.ts */
  type: 'enum' | 'string' | 'number' | 'date' | 'relation' | 'user' | 'derived';
  values?: string[];
  ordinal?: boolean;
  join?: string;
  many?: boolean;
  aliasField?: string;
  /** The column can be empty, so `= null` is a question it can answer */
  nullable?: boolean;
}

export type FieldRegistry = Record<string, FieldDefinition>;

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'MULTI_SELECT' | 'USER';

export interface QueryContext {
  currentUserId?: string;
  projectId?: string;
  /** Per custom field name in lower case, the types it has among what the query may see */
  customFields?: Map<string, CustomFieldType[]>;
  /** Per key as written in the query, the issue it names, or null for nothing visible */
  linkedIssues?: Map<string, string | null>;
}
